/*
 * SoMAp Matokeo — results SMS helpers. Shared by the browser
 * (window.SomapReportSnapshot) and the tests. Pure functions only.
 *
 * The report card itself is NOT rebuilt anywhere: it is the exact PDF that
 * Toacademichtml/generatereportform.html draws (drawReportCard). These helpers
 * only write the SMS, using the figures printed on that card
 * ("Student Avg" e.g. "78.5%" and "position/N" e.g. "3/42").
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./sms_core.js'));
  else root.SomapReportSnapshot = factory(root.SomapSmsCore);
})(typeof self !== 'undefined' ? self : this, function (core) {
  'use strict';

  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const MONTHS_SW = ['Januari', 'Februari', 'Machi', 'Aprili', 'Mei', 'Juni', 'Julai', 'Agosti', 'Septemba', 'Oktoba', 'Novemba', 'Desemba'];
  const REPORT_HOST = 'somapv2i.com/r/?k=';
  const KEY_LENGTH = 14;
  const str = (v, max) => String(v === null || v === undefined ? '' : v).replace(/\s+/g, ' ').trim().slice(0, max || 120);

  function monthIndex(month) {
    const m = String(month || '').trim().slice(0, 3).toLowerCase();
    return MONTHS.findIndex((x) => x.toLowerCase() === m);
  }

  /** Short exam title for the SMS, e.g. "Septemba 2026", "Midterm 1 2026", "Mwaka 2026". */
  function examTitle({ key, examKey, label, examLabel, month, year }) {
    const k = examKey || key;
    const l = examLabel || label;
    const y = str(year, 4);
    if (k === 'monthly') {
      const i = monthIndex(month);
      return i >= 0 ? `${MONTHS_SW[i]} ${y}` : `${str(l, 40)} ${y}`.trim();
    }
    if (k === 'annual') return `Mwaka ${y}`;
    return `${str(l, 40)} ${y}`.trim();
  }

  function reportUrl(key) { return REPORT_HOST + key; }
  const firstName = (name) => String(name || '').trim().split(/\s+/)[0] || '';

  /**
   * One SMS per parent phone. children: [{ name, avgText: "78.5%", posLabel: "3/42", key }]
   *  1 child : "{school}: Matokeo ya AMINA (Septemba 2026): wastani 78.5%, nafasi 3/42. Ona ripoti: somapv2i.com/r/?k=KEY"
   *  several : "{school}: Matokeo (Septemba 2026): AMINA 78.5% nafasi 3/42 somapv2i.com/r/?k=K1; JUMA 64.0% nafasi 10/40 somapv2i.com/r/?k=K2"
   */
  function resultsSms({ school, examTitle: title, children, shortNames }) {
    const nm = (c) => (shortNames === false ? str(c.name, 60) : firstName(c.name));
    if (children.length === 1) {
      const c = children[0];
      return `${school}: Matokeo ya ${nm(c)} (${title}): wastani ${c.avgText}, nafasi ${c.posLabel}. Ona ripoti: ${reportUrl(c.key)}`;
    }
    return `${school}: Matokeo (${title}): ` + children.map((c) => `${nm(c)} ${c.avgText} nafasi ${c.posLabel} ${reportUrl(c.key)}`).join('; ');
  }

  /** Every valid number in the Student List contact fields (not only the first). */
  function allParentPhones(raw) {
    const fields = [raw && raw.primaryParentContact, raw && raw.parentPhone, raw && raw.guardianPhone, raw && raw.contact];
    const out = [];
    fields.forEach((f) => {
      String(f || '').split(/[\/,;|\\]|\s+(?:or|au|na)\s+/i).forEach((part) => {
        const p = core.normalizeTzPhone(part);
        if (p.status === 'VALID' && !out.includes(p.msisdn)) out.push(p.msisdn);
      });
    });
    return out;
  }

  return { examTitle, resultsSms, reportUrl, allParentPhones, KEY_LENGTH, MONTHS, MONTHS_SW };
});
