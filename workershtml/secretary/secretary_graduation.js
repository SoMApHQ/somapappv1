// Secretary Desk — graduation parent follow-up data layer.
// Reads the school's graduation roster (schools/{id}/graduation/{year}/students,
// the same node graduation.html maintains) and keeps the secretary's call log in
// schools/{id}/graduation/{year}/secretaryCalls:
//   days/{YYYY-MM-DD} = { adms: [...], createdAt, createdBy }   the day's call list
//   reports/{adm}/{pushId} = { outcome, note, promiseDate, ymd, calledAt, by, byWorkerId }
// It never writes payments — payments are recorded in graduation.html and go to
// approvals like every other graduation payment.
(function (global) {
  'use strict';

  const CALLS_PER_DAY = 20;

  const OUTCOMES = [
    { key: 'will_pay', label: 'Ameahidi kulipa', tone: 'good' },
    { key: 'paid_already', label: 'Anasema ameshalipa', tone: 'good' },
    { key: 'call_back', label: 'Apigiwe tena', tone: 'warn' },
    { key: 'no_answer', label: 'Hakupokea simu', tone: 'warn' },
    { key: 'unreachable', label: 'Simu haipatikani', tone: 'bad' },
    { key: 'cannot_pay', label: 'Hana uwezo kwa sasa', tone: 'bad' },
    { key: 'wrong_number', label: 'Namba si sahihi', tone: 'bad' },
    { key: 'other', label: 'Mengineyo', tone: 'neutral' },
  ];
  const OUTCOME_MAP = Object.fromEntries(OUTCOMES.map((o) => [o.key, o]));

  function num(v) {
    const n = Number(String(v ?? '').replace(/[^0-9.-]/g, ''));
    return Number.isFinite(n) ? n : 0;
  }

  function sanitizeKey(v) {
    return String(v || '').trim().replace(/[.#$\[\]\/]/g, '_');
  }

  function todayYmd() {
    const parts = new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Africa/Nairobi', year: 'numeric', month: '2-digit', day: '2-digit',
    }).format(new Date()).split('/');
    return `${parts[2]}-${parts[1]}-${parts[0]}`;
  }

  function gradBase(homeSchoolId, year) {
    const id = global.SomapSecretary.canonicalSchoolId(homeSchoolId);
    return `schools/${id}/graduation/${year}`;
  }

  function callsBase(homeSchoolId, year) {
    return `${gradBase(homeSchoolId, year)}/secretaryCalls`;
  }

  function normalizeClass(c) {
    return String(c || '').trim().toUpperCase().replace(/[-_]+/g, ' ');
  }

  function expectedFeeOf(s, meta) {
    if (s.expectedOverride !== undefined && s.expectedOverride !== null) return num(s.expectedOverride);
    if (s.expectedFee !== undefined && s.expectedFee !== null) return num(s.expectedFee);
    const cls = String(s.class || '').toLowerCase();
    const graduand = ['preunit', 'pre-unit', 'pre unit', 'preparatory', 'class 7', 'std 7', 'grade 7'].some((t) => cls.includes(t));
    return graduand ? num(meta?.feePreunitAnd7 || 45000) : num(meta?.feeOthers || 10000);
  }

  async function loadStudents(db, homeSchoolId, year) {
    const base = gradBase(homeSchoolId, year);
    const [studentsSnap, metaSnap] = await Promise.all([
      db.ref(`${base}/students`).once('value'),
      db.ref(`${base}/meta`).once('value'),
    ]);
    const meta = metaSnap.val() || {};
    const out = [];
    Object.entries(studentsSnap.val() || {}).forEach(([key, s]) => {
      if (!s || typeof s !== 'object' || s.inactive === true) return;
      const cls = normalizeClass(s.class || s.classLevel || s.className);
      if (cls === 'GRADUATED' || cls === 'PRE ADMISSION') return;
      const synced = Number(s.rosterSyncedYear || 0);
      if (synced && synced !== Number(year)) return;
      const name = String(s.name || '').trim();
      if (!name) return;
      const expected = expectedFeeOf(s, meta);
      const paid = Math.max(0, num(s.paid));
      out.push({
        adm: sanitizeKey(s.admissionNo || key),
        name: name.toUpperCase(),
        className: String(s.class || s.classLevel || s.className || '').trim(),
        parentName: String(s.parentName || '').trim(),
        parentPhone: String(s.parentPhone || s.guardianPhone || s.contact || s.parentContact || '').trim(),
        expected,
        paid,
        balance: Math.max(0, expected - paid),
      });
    });
    return out.sort((a, b) => a.name.localeCompare(b.name));
  }

  async function loadReports(db, homeSchoolId, year) {
    const snap = await db.ref(`${callsBase(homeSchoolId, year)}/reports`).once('value');
    const byAdm = {};
    Object.entries(snap.val() || {}).forEach(([adm, entries]) => {
      byAdm[adm] = Object.entries(entries || {})
        .map(([id, r]) => ({ id, adm, ...(r || {}) }))
        .sort((a, b) => num(b.calledAt) - num(a.calledAt));
    });
    return byAdm;
  }

  function lastReport(reports, adm) {
    return (reports[adm] || [])[0] || null;
  }

  function hasActivePromise(report, ymd) {
    return Boolean(report && report.outcome === 'will_pay' && report.promiseDate && report.promiseDate >= ymd);
  }

  // Who to call next: parents with a balance, skipping open promises and anyone
  // already on today's list. Never-called first, then the longest since last call,
  // then the biggest balance.
  function pickNext(students, reports, excludeAdms, count) {
    const ymd = todayYmd();
    const exclude = new Set(excludeAdms || []);
    return students
      .filter((s) => s.balance > 0 && !exclude.has(s.adm))
      .filter((s) => !hasActivePromise(lastReport(reports, s.adm), ymd))
      .map((s) => ({ s, last: num(lastReport(reports, s.adm)?.calledAt) }))
      .sort((a, b) => (a.last - b.last) || (b.s.balance - a.s.balance) || a.s.name.localeCompare(b.s.name))
      .slice(0, count)
      .map((x) => x.s.adm);
  }

  // Returns today's call list, creating it once per day (transaction-safe).
  async function ensureTodayList(db, session, students, reports) {
    const ymd = todayYmd();
    const ref = db.ref(`${callsBase(session.homeSchoolId, session.year)}/days/${ymd}`);
    const fresh = pickNext(students, reports, [], CALLS_PER_DAY);
    const result = await ref.transaction((current) => {
      if (current && Array.isArray(current.adms) && current.adms.length) return undefined;
      return { adms: fresh, createdAt: Date.now(), createdBy: session.name, createdByWorkerId: session.workerId };
    });
    const val = result.snapshot.val() || {};
    return { ymd, adms: Array.isArray(val.adms) ? val.adms : Object.values(val.adms || {}) };
  }

  async function addMoreToToday(db, session, students, reports, currentAdms) {
    const ymd = todayYmd();
    const extra = pickNext(students, reports, currentAdms, CALLS_PER_DAY);
    if (!extra.length) return currentAdms;
    const next = [...currentAdms, ...extra];
    await db.ref(`${callsBase(session.homeSchoolId, session.year)}/days/${ymd}`).update({
      adms: next, extendedAt: Date.now(), extendedBy: session.name,
    });
    return next;
  }

  async function saveReport(db, session, student, { outcome, note, promiseDate }) {
    if (!OUTCOME_MAP[outcome]) throw new Error('Chagua matokeo ya simu.');
    if (!String(note || '').trim()) throw new Error('Andika ripoti ya mzazi alichosema.');
    if (outcome === 'will_pay' && !promiseDate) throw new Error('Weka tarehe aliyoahidi kulipa.');
    const ref = db.ref(`${callsBase(session.homeSchoolId, session.year)}/reports/${student.adm}`).push();
    const record = {
      outcome,
      outcomeLabel: OUTCOME_MAP[outcome].label,
      note: String(note).trim(),
      promiseDate: outcome === 'will_pay' ? promiseDate : '',
      ymd: todayYmd(),
      calledAt: firebase.database.ServerValue.TIMESTAMP,
      by: session.name,
      byWorkerId: session.workerId,
      studentName: student.name,
      className: student.className,
      parentPhone: student.parentPhone,
      balanceAtCall: student.balance,
    };
    await ref.set(record);
    return { id: ref.key, adm: student.adm, ...record, calledAt: Date.now() };
  }

  function summarize(students, reports, todayAdms) {
    const ymd = todayYmd();
    const debtors = students.filter((s) => s.balance > 0);
    const todaySet = new Set(todayAdms || []);
    let calledToday = 0;
    let promises = 0;
    todaySet.forEach((adm) => {
      if ((reports[adm] || []).some((r) => r.ymd === ymd)) calledToday += 1;
    });
    students.forEach((s) => { if (hasActivePromise(lastReport(reports, s.adm), ymd)) promises += 1; });
    return {
      totalStudents: students.length,
      debtors: debtors.length,
      outstanding: debtors.reduce((sum, s) => sum + s.balance, 0),
      collected: students.reduce((sum, s) => sum + Math.min(s.paid, s.expected), 0),
      expected: students.reduce((sum, s) => sum + s.expected, 0),
      todayTotal: todaySet.size,
      calledToday,
      promises,
    };
  }

  function formatTsh(v) {
    return `TSh ${Math.round(num(v)).toLocaleString('en-US')}`;
  }

  global.SecretaryGraduation = {
    CALLS_PER_DAY,
    OUTCOMES,
    OUTCOME_MAP,
    todayYmd,
    gradBase,
    loadStudents,
    loadReports,
    lastReport,
    hasActivePromise,
    ensureTodayList,
    addMoreToToday,
    saveReport,
    summarize,
    formatTsh,
  };
})(window);
