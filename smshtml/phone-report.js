/*
 * SoMAp — parent phone quality report (READ-ONLY).
 * Uses the same learners and the same contact rule as ToSchoolerp/studentlist.html
 * (SomapYearRoster -> parentContact = primaryParentContact || parentPhone ||
 * guardianPhone || contact) and the shared SMS phone rules (shared/sms_core.js).
 * It never writes anything. Fixes are made by staff in the Student List.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('../shared/sms_core.js'));
  else root.SomapPhoneReport = factory(root.SomapSmsCore);
})(typeof self !== 'undefined' ? self : this, function (core) {
  'use strict';

  const KINDS = {
    MISSING: { sw: 'Hakuna namba', hint: 'Ongeza namba ya mzazi kwenye Student List.' },
    INVALID: { sw: 'Namba si sahihi', hint: 'Namba ni fupi/ndefu au si ya Tanzania. Isahihishe.' },
    FIXED_2550: { sw: 'Imesahihishwa (255 0…)', hint: 'Itatumwa sawasawa. Unaweza kuisafisha kwenye Student List.' },
    FIXED_00: { sw: 'Imesahihishwa (00255…)', hint: 'Itatumwa sawasawa.' },
    MULTIPLE_NUMBERS: { sw: 'Namba mbili', hint: 'SMS itaenda kwa namba ya kwanza tu. Weka namba moja kuu.' },
    NO_PARENT_NAME: { sw: 'Hakuna jina la mzazi', hint: 'Ujumbe wenye {parentName} hautamfikia. Ongeza jina.' },
  };

  /**
   * rows: roster rows { admissionNumber, fullName, classLevel, parentContact, rawStudent }
   * Returns counts and one problem line per learner per issue.
   */
  function buildPhoneReport(rows) {
    const counts = { total: 0, valid: 0, missing: 0, invalid: 0, fixed: 0, multiple: 0, noParentName: 0 };
    const problems = [];
    const phones = new Map();
    (rows || []).forEach((row) => {
      counts.total += 1;
      const raw = String(row.parentContact || '').trim();
      const p = core.normalizeTzPhone(raw);
      const base = {
        admissionNumber: String(row.admissionNumber || ''),
        fullName: String(row.fullName || ''),
        classLevel: String(row.classLevel || row.className || ''),
        raw,
        sendTo: p.status === 'VALID' ? p.local : '',
      };
      if (p.status === 'MISSING') { counts.missing += 1; problems.push({ ...base, kind: 'MISSING' }); return; }
      if (p.status === 'INVALID') { counts.invalid += 1; problems.push({ ...base, kind: 'INVALID' }); return; }
      counts.valid += 1;
      phones.set(p.msisdn, (phones.get(p.msisdn) || 0) + 1);
      if (p.flags.includes('FIXED_2550') || p.flags.includes('FIXED_00')) {
        counts.fixed += 1;
        problems.push({ ...base, kind: p.flags.includes('FIXED_2550') ? 'FIXED_2550' : 'FIXED_00' });
      }
      if (p.flags.includes('MULTIPLE_NUMBERS')) { counts.multiple += 1; problems.push({ ...base, kind: 'MULTIPLE_NUMBERS' }); }
      const parentName = String((row.rawStudent && (row.rawStudent.primaryParentName || row.rawStudent.parentName)) || '').trim();
      if (!parentName) { counts.noParentName += 1; problems.push({ ...base, kind: 'NO_PARENT_NAME' }); }
    });
    const order = Object.keys(KINDS);
    problems.sort((a, b) => order.indexOf(a.kind) - order.indexOf(b.kind) || a.classLevel.localeCompare(b.classLevel) || a.fullName.localeCompare(b.fullName));
    return {
      counts,
      uniquePhones: phones.size,
      familiesWithSeveralChildren: Array.from(phones.values()).filter((n) => n > 1).length,
      smsPerGeneralMessage: phones.size,
      problems,
    };
  }

  // ------------------------------------------------------------------ page
  function initPage() {
    const $ = (id) => document.getElementById(id);
    const esc = (s) => String(s === null || s === undefined ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    const state = { report: null, filter: 'ALL', year: '', school: null };

    function schoolInfo() {
      // ?school= is only adopted when this browser has no school yet (never switches a session).
      if (window.SOMAP && SOMAP.adoptSchoolFromUrl) SOMAP.adoptSchoolFromUrl('school');
      const id = window.SOMAP && SOMAP.getSchoolId ? SOMAP.getSchoolId() : '';
      const s = window.SOMAP && SOMAP.getSchool ? SOMAP.getSchool() : null;
      return { id, name: (s && (s.name || s.schoolName)) || (id === 'socrates-school' ? 'Socrates School' : id) };
    }

    function setStatus(text, isError) {
      $('status').textContent = text || '';
      $('status').className = 'status' + (isError ? ' error' : '');
    }

    function renderCards(r) {
      const c = r.counts;
      const card = (label, value, cls, sub) => `<div class="card ${cls || ''}"><div class="value">${esc(value)}</div><div class="label">${esc(label)}</div>${sub ? `<div class="sub">${esc(sub)}</div>` : ''}</div>`;
      $('cards').innerHTML = [
        card('Wanafunzi', c.total),
        card('Namba sahihi', c.valid, 'ok', `Namba tofauti: ${r.uniquePhones}`),
        card('Hakuna namba', c.missing, c.missing ? 'bad' : ''),
        card('Namba si sahihi', c.invalid, c.invalid ? 'bad' : ''),
        card('Zimesahihishwa', c.fixed, c.fixed ? 'warn' : ''),
        card('Namba mbili', c.multiple, c.multiple ? 'warn' : ''),
        card('Hakuna jina la mzazi', c.noParentName, c.noParentName ? 'warn' : ''),
        card('SMS kwa ujumbe 1 wa wote', r.smsPerGeneralMessage, '', `Familia zenye watoto >1: ${r.familiesWithSeveralChildren}`),
      ].join('');
    }

    function renderFilters(r) {
      const n = (k) => r.problems.filter((p) => p.kind === k).length;
      const chips = [['ALL', 'Zote', r.problems.length], ...Object.keys(KINDS).map((k) => [k, KINDS[k].sw, n(k)])];
      $('filters').innerHTML = chips.map(([k, label, count]) =>
        `<button type="button" class="chip${state.filter === k ? ' active' : ''}" data-k="${k}" ${count || k === 'ALL' ? '' : 'disabled'}>${esc(label)} <b>${count}</b></button>`).join('');
      $('filters').querySelectorAll('button').forEach((b) => { b.onclick = () => { state.filter = b.dataset.k; renderFilters(r); renderTable(r); }; });
    }

    function visibleProblems(r) {
      return state.filter === 'ALL' ? r.problems : r.problems.filter((p) => p.kind === state.filter);
    }

    function renderTable(r) {
      const list = visibleProblems(r);
      $('tbody').innerHTML = list.length ? list.map((p) => `<tr>
          <td>${esc(p.admissionNumber)}</td><td>${esc(p.fullName)}</td><td>${esc(p.classLevel)}</td>
          <td class="mono">${esc(p.raw || '—')}</td><td class="mono">${esc(p.sendTo || '—')}</td>
          <td><span class="tag ${p.kind}">${esc(KINDS[p.kind].sw)}</span><div class="hint">${esc(KINDS[p.kind].hint)}</div></td>
        </tr>`).join('') : '<tr><td colspan="6" class="empty">Hakuna tatizo katika kundi hili. 🎉</td></tr>';
    }

    function downloadCsv() {
      if (!state.report || !window.SomapSms) return;
      const rows = visibleProblems(state.report).map((p) => [p.admissionNumber, p.fullName, p.classLevel, p.raw, p.sendTo ? SomapSms.displayPhone(p.sendTo) : '', KINDS[p.kind].sw, KINDS[p.kind].hint]);
      const csv = SomapSms.toCsv(['Admission No', 'Jina', 'Darasa', 'Namba iliyopo', 'SMS itaenda', 'Tatizo', 'Ushauri'], rows);
      SomapSms.downloadText(`namba-za-wazazi-${state.school.id}-${state.year}.csv`, csv);
    }

    async function load() {
      state.school = schoolInfo();
      if (!state.school.id) { setStatus('Chagua shule kwanza (fungua SoMAp na uchague shule).', true); return; }
      $('schoolName').textContent = state.school.name;
      state.year = $('year').value;
      setStatus('Inapakia wanafunzi…');
      $('content').hidden = true;
      try {
        const rows = await window.SomapYearRoster.getYearRoster(state.year);
        state.report = buildPhoneReport(rows);
        renderCards(state.report);
        renderFilters(state.report);
        renderTable(state.report);
        $('content').hidden = false;
        setStatus(`Mwaka ${state.year} • imesomwa tu, hakuna kilichobadilishwa.`);
      } catch (err) {
        console.error(err);
        setStatus('Imeshindwa kupakia wanafunzi: ' + (err && err.message ? err.message : err), true);
      }
    }

    function fillYears() {
      const now = new Date().getFullYear();
      const selected = String((window.somapYearContext && somapYearContext.getSelectedYear && somapYearContext.getSelectedYear()) || now);
      const years = [];
      for (let y = 2025; y <= now + 1; y++) years.push(String(y));
      if (!years.includes(selected)) years.push(selected);
      $('year').innerHTML = years.map((y) => `<option${y === selected ? ' selected' : ''}>${y}</option>`).join('');
      $('year').onchange = load;
    }

    $('csv').onclick = downloadCsv;
    $('login').onclick = () => firebase.auth().signInWithPopup(new firebase.auth.GoogleAuthProvider()).catch((e) => setStatus('Login imeshindwa: ' + e.message, true));
    fillYears();
    firebase.auth().onAuthStateChanged((user) => {
      $('loginBox').hidden = Boolean(user);
      if (user) load();
      else setStatus('Ingia (login) ili kuona ripoti.');
    });
  }

  if (typeof document !== 'undefined' && document.getElementById('phoneReport')) {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initPage);
    else initPage();
  }

  return { buildPhoneReport, KINDS };
});
