/*
 * SoMAp SMS core (Mawasiliano) — ONE source of truth shared by the browser
 * (window.SomapSmsCore) and the Cloudflare Worker (imported by sms-worker/).
 *
 * Pure functions only: no database, no network, no finance calculations.
 *   normalizeTzPhone  — parent contact text -> { status, msisdn, e164, local, flags }
 *   cleanText         — make a message GSM-7 friendly (quotes, dashes, emoji, accents)
 *   countSmsParts     — GSM-7 160/153, Unicode 70/67
 *   fillTemplate      — {placeholder} filling that REPORTS missing values
 *   hasUnfilledPlaceholder — any { or } left means "do not send"
 *   groupByPhone / buildFeeReminderGroups — one message per phone; fee reminders
 *                       combine all children of one parent (names, each debt, total)
 *   formatNumber / formatTsh
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.SomapSmsCore = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // ---------------------------------------------------------------- phones
  const MISSING_WORDS = new Set(['', '-', '--', '---', 'n/a', 'na', 'none', 'null', 'undefined', 'nil', 'hakuna', '0']);

  function classifyDigits(d) {
    if (/^0[67]\d{8}$/.test(d)) return { msisdn: '255' + d.slice(1), flag: null };
    if (/^[67]\d{8}$/.test(d)) return { msisdn: '255' + d, flag: null };
    if (/^255[67]\d{8}$/.test(d)) return { msisdn: d, flag: null };
    if (/^2550[67]\d{8}$/.test(d)) return { msisdn: '255' + d.slice(4), flag: 'FIXED_2550' };
    if (/^00255[67]\d{8}$/.test(d)) return { msisdn: d.slice(2), flag: 'FIXED_00' };
    return null;
  }

  /**
   * Tanzanian mobile number normaliser.
   *  '--' / 'N/A' / empty           -> MISSING
   *  0XXXXXXXXX, 9 digits 6/7..., 2556/2557 + 8 digits -> VALID
   *  2550 7XX... (extra 0)         -> VALID, flag FIXED_2550
   *  "07../07.." (two numbers)     -> first valid one, flag MULTIPLE_NUMBERS
   *  anything else (short, foreign) -> INVALID
   */
  function normalizeTzPhone(value) {
    const raw = String(value === null || value === undefined ? '' : value).trim();
    if (MISSING_WORDS.has(raw.toLowerCase()) || !/\d/.test(raw)) {
      return { status: 'MISSING', raw, msisdn: '', e164: '', local: '', flags: [] };
    }
    const parts = raw.split(/[\/,;|\\]|\s+(?:or|au|na)\s+/i).map((p) => p.trim()).filter((p) => /\d/.test(p));
    const flags = [];
    if (parts.length > 1) flags.push('MULTIPLE_NUMBERS');
    for (const part of parts.length ? parts : [raw]) {
      const hit = classifyDigits(part.replace(/\D/g, ''));
      if (hit) {
        if (hit.flag) flags.push(hit.flag);
        return { status: 'VALID', raw, msisdn: hit.msisdn, e164: '+' + hit.msisdn, local: '0' + hit.msisdn.slice(3), flags };
      }
    }
    return { status: 'INVALID', raw, msisdn: '', e164: '', local: '', flags };
  }

  // ------------------------------------------------------------- encoding
  const GSM_BASIC =
    '@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !"#¤%&\'()*+,-./0123456789:;<=>?' +
    '¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà';
  const GSM_EXT = '^{}\\[~]|€\f';
  const GSM_BASIC_SET = new Set(Array.from(GSM_BASIC));
  const GSM_EXT_SET = new Set(Array.from(GSM_EXT));
  const isGsm = (ch) => GSM_BASIC_SET.has(ch) || GSM_EXT_SET.has(ch);

  const REPLACEMENTS = [
    [/[‘’‚‛′´`]/g, "'"],
    [/[“”„‟″«»]/g, '"'],
    [/[‐‑‒–—―−]/g, '-'],
    [/…/g, '...'],
    [/[  -   　\t]/g, ' '],
    [/[​-‍⁠﻿­]/g, ''],
    [/\r\n?/g, '\n'],
  ];
  let EMOJI_RE = null;
  try { EMOJI_RE = new RegExp('[\\p{Extended_Pictographic}\\u{1F3FB}-\\u{1F3FF}\\u{FE0E}\\u{FE0F}\\u{20E3}]', 'gu'); } catch (_) { EMOJI_RE = null; }

  /** Clean a message so it stays in cheap GSM-7 where possible. */
  function cleanText(text) {
    let s = String(text === null || text === undefined ? '' : text).normalize('NFC');
    REPLACEMENTS.forEach(([re, to]) => { s = s.replace(re, to); });
    if (EMOJI_RE) s = s.replace(EMOJI_RE, '');
    s = Array.from(s).map((ch) => {
      if (isGsm(ch)) return ch;
      const folded = ch.normalize('NFD').replace(/[̀-ͯ]/g, '');
      return folded && Array.from(folded).every(isGsm) ? folded : ch;
    }).join('');
    return s.replace(/[ ]{2,}/g, ' ').replace(/[ ]+\n/g, '\n').trim();
  }

  /** Characters that force the expensive Unicode (70 chars) encoding. */
  function nonGsmChars(text) {
    return Array.from(new Set(Array.from(String(text || '')).filter((ch) => !isGsm(ch))));
  }

  function packParts(units, perPart) {
    // units: array of unit sizes that must not be split across parts.
    let parts = 1; let used = 0;
    units.forEach((u) => {
      if (used + u > perPart) { parts += 1; used = 0; }
      used += u;
    });
    return parts;
  }

  /** SMS part counter: GSM-7 160 (153 per part when long), Unicode 70 (67). */
  function countSmsParts(text) {
    const s = String(text === null || text === undefined ? '' : text);
    const chars = Array.from(s);
    if (!chars.length) return { encoding: 'GSM-7', parts: 0, units: 0, perPart: 160, remaining: 160, nonGsm: [] };
    const bad = chars.filter((ch) => !isGsm(ch));
    if (!bad.length) {
      const sizes = chars.map((ch) => (GSM_EXT_SET.has(ch) ? 2 : 1));
      const units = sizes.reduce((a, b) => a + b, 0);
      const parts = units <= 160 ? 1 : packParts(sizes, 153);
      const perPart = parts === 1 ? 160 : 153;
      return { encoding: 'GSM-7', parts, units, perPart, remaining: parts === 1 ? 160 - units : parts * 153 - units, nonGsm: [] };
    }
    const sizes = chars.map((ch) => ch.length); // UTF-16 code units; surrogate pairs stay together
    const units = sizes.reduce((a, b) => a + b, 0);
    const parts = units <= 70 ? 1 : packParts(sizes, 67);
    const perPart = parts === 1 ? 70 : 67;
    return { encoding: 'UCS-2', parts, units, perPart, remaining: parts === 1 ? 70 - units : parts * 67 - units, nonGsm: Array.from(new Set(bad)) };
  }

  // ------------------------------------------------------------- templates
  const PLACEHOLDER_RE = /\{\s*([A-Za-z][A-Za-z0-9_]*)\s*\}/g;
  const PLACEHOLDERS = ['parentName', 'studentName', 'class', 'feeDetails', 'debt', 'balance', 'total', 'children', 'date', 'time', 'venue', 'school'];

  function isEmptyValue(v) {
    if (v === null || v === undefined) return true;
    if (typeof v === 'number') return !Number.isFinite(v);
    return String(v).trim() === '';
  }

  /**
   * Fill {placeholders} (case-insensitive). Braces inside values are removed so a
   * value can never create a new placeholder. Returns every missing name so the
   * caller can refuse to send — SwalaSMS would silently drop them.
   */
  function fillTemplate(template, values) {
    const map = {};
    Object.keys(values || {}).forEach((k) => { map[k.toLowerCase()] = values[k]; });
    const missing = [];
    const text = String(template || '').replace(PLACEHOLDER_RE, (whole, name) => {
      const v = map[name.toLowerCase()];
      if (isEmptyValue(v)) { if (!missing.includes(name)) missing.push(name); return whole; }
      return String(v).replace(/[{}]/g, '').trim();
    });
    return { text, missing, ok: missing.length === 0 && !hasUnfilledPlaceholder(text) };
  }

  /** Any brace left means a placeholder was not filled (or typed by mistake). */
  function hasUnfilledPlaceholder(text) {
    return /[{}]/.test(String(text || ''));
  }

  // ----------------------------------------------------------------- money
  function formatNumber(n) {
    const v = Math.round(Number(n) || 0);
    const sign = v < 0 ? '-' : '';
    return sign + String(Math.abs(v)).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  }
  function formatTsh(n) { return 'TSh ' + formatNumber(n); }

  // ------------------------------------------------------------------ dates
  const MONTHS_SW = ['Januari', 'Februari', 'Machi', 'Aprili', 'Mei', 'Juni', 'Julai', 'Agosti', 'Septemba', 'Oktoba', 'Novemba', 'Desemba'];
  /**
   * Date in Swahili words: "2026-12-10" / "10/12/2026" / Date -> "10 Desemba 2026".
   * Anything else (e.g. "Ijumaa hii") is returned unchanged.
   */
  function formatDateSw(value) {
    if (value instanceof Date && !isNaN(value)) return `${value.getDate()} ${MONTHS_SW[value.getMonth()]} ${value.getFullYear()}`;
    const s = String(value === null || value === undefined ? '' : value).trim();
    let m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(s);
    let y; let mo; let d;
    if (m) { y = +m[1]; mo = +m[2]; d = +m[3]; } else {
      m = /^(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{4})$/.exec(s);
      if (!m) return s;
      d = +m[1]; mo = +m[2]; y = +m[3];
    }
    if (mo < 1 || mo > 12 || d < 1 || d > 31) return s;
    return `${d} ${MONTHS_SW[mo - 1]} ${y}`;
  }

  // --------------------------------------------------------------- grouping
  function joinNames(names) {
    const list = names.filter(Boolean);
    if (list.length <= 1) return list[0] || '';
    return list.slice(0, -1).join(', ') + ' na ' + list[list.length - 1];
  }
  function firstWord(name) { return String(name || '').trim().split(/\s+/)[0] || ''; }

  /**
   * One entry per phone. rows: [{ phone, ...anything }]. Unreachable rows (missing
   * or invalid phone) are returned separately with the reason, never dropped silently.
   */
  function groupByPhone(rows) {
    const groups = new Map();
    const unreachable = [];
    (rows || []).forEach((row, index) => {
      const p = normalizeTzPhone(row && row.phone);
      if (p.status !== 'VALID') { unreachable.push({ index, row, reason: p.status, phone: p }); return; }
      if (!groups.has(p.msisdn)) groups.set(p.msisdn, { msisdn: p.msisdn, e164: p.e164, local: p.local, flags: [], rows: [] });
      const g = groups.get(p.msisdn);
      p.flags.forEach((f) => { if (!g.flags.includes(f)) g.flags.push(f); });
      g.rows.push(row);
    });
    return { groups: Array.from(groups.values()), unreachable };
  }

  /**
   * Fee reminders: ONE message per parent phone combining every child.
   * rows: [{ phone, parentName, studentName, className, debt }]
   * values per group: {parentName} {studentName} (joined) {class} {debt} = {total}
   *                   (sum) {children} ("Amina (Darasa 3) 120,000, Juma (Darasa 1) 80,000")
   * options.shortNames: use first names only (helps stay within 160 characters).
   */
  function buildFeeReminderGroups(rows, options) {
    const opts = options || {};
    const { groups, unreachable } = groupByPhone(rows);
    groups.forEach((g) => {
      const name = (r) => (opts.shortNames ? firstWord(r.studentName) : String(r.studentName || '').trim());
      const total = g.rows.reduce((s, r) => s + Math.max(0, Number(r.debt) || 0), 0);
      const classes = Array.from(new Set(g.rows.map((r) => String(r.className || '').trim()).filter(Boolean)));
      const parentName = (g.rows.find((r) => String(r.parentName || '').trim()) || {}).parentName || '';
      g.children = g.rows.map((r) => ({ studentName: name(r), className: String(r.className || '').trim(), debt: Math.max(0, Number(r.debt) || 0) }));
      g.totalDebt = total;
      g.values = {
        parentName: String(parentName).trim(),
        studentName: joinNames(g.children.map((c) => c.studentName)),
        class: classes.join(', '),
        debt: total > 0 ? formatNumber(total) : '',
        total: total > 0 ? formatNumber(total) : '',
        children: g.children.length > 1
          ? g.children.map((c) => `${c.studentName} ${formatNumber(c.debt)}`).join(', ')
          : (g.children[0] ? g.children[0].studentName : ''),
        // Reads naturally for one or several children:
        //   1 child : "deni la ada ni TSh 143,000"
        //   several : "deni la ada: Amina 120,000, Juma 80,000. Jumla TSh 200,000"
        feeDetails: total <= 0 ? ''
          : (g.children.length > 1
            ? `deni la ada: ${g.children.map((c) => `${c.studentName} ${formatNumber(c.debt)}`).join(', ')}. Jumla TSh ${formatNumber(total)}`
            : `deni la ada ni TSh ${formatNumber(total)}`),
        count: g.children.length,
      };
    });
    return { groups, unreachable };
  }

  return {
    normalizeTzPhone,
    cleanText,
    nonGsmChars,
    countSmsParts,
    fillTemplate,
    hasUnfilledPlaceholder,
    formatNumber,
    formatTsh,
    formatDateSw,
    groupByPhone,
    buildFeeReminderGroups,
    PLACEHOLDERS,
  };
});
