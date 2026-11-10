/*
 * SoMAp Top Awards Engine — pure ranking & eligibility rules (no DOM, no Firebase).
 *
 * Rules agreed with the school (2026-11-10):
 *  - Positions: ties share a position; the next distinct score takes the next number.
 *    100,100,99,99,97 -> 1,1,2,2,3. Only positions 1..3 are awarded.
 *  - Scores are compared at RANK_DECIMALS (2) decimal places — the same precision the
 *    report form uses for overall positions. Positions themselves are whole numbers.
 *  - Academic eligibility: a learner must have a result in every subject the class sat
 *    (a subject "sat by the class" = sat by at least half of the learners with results)
 *    AND have sat at least 80% of the class's exams, where the class's exams = the most
 *    exams any learner in the class sat. Subject awards apply the same 80% to that subject.
 *  - Whole-school academic rankings are split into Pre-Primary (Baby, Middle, Pre-Unit)
 *    and Primary (Class 1–7) — unlike scales are never compared.
 *  - Attendance = sessions present / sessions recorded (AM + PM; a half day = 1 of 2).
 *    Whole-school attendance only for learners marked from their class's first register
 *    day of the year; class attendance counts from the learner's first marked day.
 */
(function (global) {
  'use strict';

  const RANK_DECIMALS = 2;
  const MIN_EXAM_SHARE = 0.8;
  const SUBJECT_SAT_SHARE = 0.5;
  const MIN_ATTENDANCE_SESSIONS = 30; // ~15 school days before a class attendance award is meaningful

  const PRE_PRIMARY = ['baby class', 'middle class', 'pre-unit', 'pre unit class', 'pre unit', 'preunit'];
  function groupForClass(className) {
    const c = String(className || '').trim().toLowerCase();
    if (PRE_PRIMARY.includes(c) || /baby|middle|pre\s*-?\s*unit|nursery|kg/.test(c)) return 'prePrimary';
    return 'primary';
  }
  const GROUP_LABELS = { prePrimary: 'Pre-Primary (Baby, Middle & Pre-Unit)', primary: 'Primary (Class 1 – 7)' };

  function roundScore(n) {
    const f = 10 ** RANK_DECIMALS;
    return Math.round(Number(n || 0) * f) / f;
  }

  /** Ties share a position; next distinct score = next position. Returns entries with position <= maxPosition. */
  function denseTop(items, scoreOf, maxPosition = 3) {
    const sorted = items
      .map((item) => ({ item, score: roundScore(scoreOf(item)) }))
      .filter((x) => Number.isFinite(x.score))
      .sort((a, b) => b.score - a.score);
    const out = [];
    let position = 0;
    let last = null;
    for (const row of sorted) {
      if (row.score !== last) { position += 1; last = row.score; }
      if (position > maxPosition) break;
      out.push({ ...row.item, position, rankScore: row.score });
    }
    return out;
  }

  const requiredExams = (max) => (max > 0 ? Math.ceil(MIN_EXAM_SHARE * max - 1e-9) : 0);

  /**
   * classes: [{ className, students: [{ key, name, ...identity, annual: { avg, attemptedCount, examsSat,
   *   subjects: { [subject]: { attempted, pct, exams } } } | null }] }]
   * Returns { classOverall, classSubject, schoolOverall, schoolSubject, gaps, classInfo }.
   */
  function computeAcademicAwards(classes) {
    const gaps = [];
    const classInfo = {};
    const classOverall = {};
    const classSubject = {};
    const eligiblePool = { prePrimary: [], primary: [] };
    const subjectPool = { prePrimary: {}, primary: {} };

    (classes || []).forEach((cls) => {
      const group = groupForClass(cls.className);
      const scored = cls.students.filter((s) => s.annual && s.annual.attemptedCount > 0);
      const noResults = cls.students.filter((s) => !(s.annual && s.annual.attemptedCount > 0));
      noResults.forEach((s) => gaps.push({ kind: 'academic', key: s.key, name: s.name, className: cls.className, reason: 'No exam results recorded this year (January – November).' }));

      const classExams = scored.reduce((m, s) => Math.max(m, s.annual.examsSat || 0), 0);
      const needExams = requiredExams(classExams);
      const subjectNames = Array.from(new Set(scored.flatMap((s) => Object.keys(s.annual.subjects || {}))));
      const satSubjects = subjectNames.filter((sub) => {
        const sat = scored.filter((s) => s.annual.subjects?.[sub]?.attempted).length;
        return scored.length > 0 && sat / scored.length >= SUBJECT_SAT_SHARE;
      });
      const subjectMaxExams = {};
      satSubjects.forEach((sub) => {
        subjectMaxExams[sub] = scored.reduce((m, s) => Math.max(m, s.annual.subjects?.[sub]?.attempted ? (s.annual.subjects[sub].exams || 0) : 0), 0);
      });
      classInfo[cls.className] = { group, learners: cls.students.length, withResults: scored.length, classExams, needExams, subjects: satSubjects, subjectMaxExams };

      const overallEligible = [];
      scored.forEach((s) => {
        const missing = satSubjects.filter((sub) => !s.annual.subjects?.[sub]?.attempted);
        const short = (s.annual.examsSat || 0) < needExams;
        if (missing.length || short) {
          const reasons = [];
          if (missing.length) reasons.push(`No result in ${missing.join(', ')}`);
          if (short) reasons.push(`Sat ${s.annual.examsSat} of ${classExams} exams (needs ${needExams})`);
          gaps.push({ kind: 'academic', key: s.key, name: s.name, className: cls.className, reason: `${reasons.join('; ')} — not ranked overall.` });
          return;
        }
        overallEligible.push(s);
      });
      const overallRow = (s) => ({ key: s.key, name: s.name, className: cls.className, photoUrl: s.photoUrl, admissionNo: s.admissionNo, score: s.annual.avg, detail: `Annual average ${roundScore(s.annual.avg).toFixed(2)}% · ${s.annual.examsSat}/${classExams} exams` });
      classOverall[cls.className] = denseTop(overallEligible.map(overallRow), (r) => r.score);
      overallEligible.forEach((s) => eligiblePool[group].push(overallRow(s)));

      classSubject[cls.className] = {};
      satSubjects.forEach((sub) => {
        const need = requiredExams(subjectMaxExams[sub]);
        const rows = [];
        scored.forEach((s) => {
          const r = s.annual.subjects?.[sub];
          if (!r?.attempted) return;
          if ((r.exams || 0) < need) {
            gaps.push({ kind: 'subject', key: s.key, name: s.name, className: cls.className, subject: sub, reason: `${sub}: sat ${r.exams} of ${subjectMaxExams[sub]} exams (needs ${need}) — not ranked in ${sub}.` });
            return;
          }
          rows.push({ key: s.key, name: s.name, className: cls.className, photoUrl: s.photoUrl, admissionNo: s.admissionNo, subject: sub, score: r.pct, detail: `${sub} ${roundScore(r.pct).toFixed(2)}% · ${r.exams}/${subjectMaxExams[sub]} exams` });
        });
        classSubject[cls.className][sub] = denseTop(rows, (r) => r.score);
        subjectPool[group][sub] = (subjectPool[group][sub] || []).concat(rows.map((row) => ({ ...row, _cls: cls.className })));
      });
    });

    const schoolOverall = {};
    const schoolSubject = {};
    Object.keys(eligiblePool).forEach((group) => {
      if (eligiblePool[group].length) schoolOverall[group] = denseTop(eligiblePool[group], (r) => r.score);
      schoolSubject[group] = {};
      Object.entries(subjectPool[group]).forEach(([sub, rows]) => {
        const classesWithSubject = new Set(rows.map((r) => r._cls));
        if (classesWithSubject.size < 2) return; // a one-class subject is already its class award
        schoolSubject[group][sub] = denseTop(rows.map(({ _cls, ...r }) => r), (r) => r.score);
      });
    });
    return { classOverall, classSubject, schoolOverall, schoolSubject, gaps, classInfo };
  }

  // ---------- attendance ----------
  const isPresentCode = (c) => String(c || '').trim().toUpperCase() === 'P';
  /** Split a daily code into AM/PM halves when only "daily" was saved (PA, AP, PS, SP, PMT, MTP...). */
  function sessionsFromRecord(rec) {
    if (!rec || typeof rec !== 'object') return null;
    let am = String(rec.am || '').trim().toUpperCase();
    let pm = String(rec.pm || '').trim().toUpperCase();
    const daily = String(rec.daily || rec.status || '').trim().toUpperCase();
    if (!am && !pm && daily) {
      if (daily === 'P' || daily === 'PRESENT') { am = 'P'; pm = 'P'; }
      else if (daily === 'A' || daily === 'ABSENT') { am = 'A'; pm = 'A'; }
      else if (daily.length > 1 && daily.startsWith('P')) { am = 'P'; pm = daily.slice(1); }
      else if (daily.length > 1 && daily.endsWith('P')) { am = daily.slice(0, -1); pm = 'P'; }
      else { am = daily; pm = daily; }
    }
    if (!am && !pm) return null;
    return { am, pm };
  }

  /**
   * classes: [{ className, students:[{key,name,...}], days: { 'YYYY-MM-DD': { [studentKey]: record } } }]
   * Student keys in `days` must already be mapped to roster keys.
   */
  function computeAttendanceAwards(classes, { until } = {}) {
    const gaps = [];
    const classInfo = {};
    const classAwards = {};
    const schoolPool = [];
    const untilIso = until || new Date().toISOString().slice(0, 10);

    (classes || []).forEach((cls) => {
      const dates = Object.keys(cls.days || {}).filter((d) => d <= untilIso).sort();
      const registerDays = [];
      dates.forEach((date) => {
        const recs = cls.days[date] || {};
        let amTaken = false; let pmTaken = false;
        Object.values(recs).forEach((rec) => {
          const s = sessionsFromRecord(rec);
          if (!s) return;
          if (s.am) amTaken = true;
          if (s.pm) pmTaken = true;
        });
        if (amTaken || pmTaken) registerDays.push({ date, amTaken, pmTaken });
      });
      const firstDay = registerDays[0]?.date || '';
      const classSessions = registerDays.reduce((n, d) => n + (d.amTaken ? 1 : 0) + (d.pmTaken ? 1 : 0), 0);
      classInfo[cls.className] = { registerDays: registerDays.length, firstDay, lastDay: registerDays[registerDays.length - 1]?.date || '', sessions: classSessions };
      if (!registerDays.length) return;

      const rows = [];
      cls.students.forEach((stu) => {
        let first = '';
        registerDays.forEach((d) => { if (!first && sessionsFromRecord(cls.days[d.date]?.[stu.key])) first = d.date; });
        if (!first) {
          gaps.push({ kind: 'attendance', key: stu.key, name: stu.name, className: cls.className, reason: 'Not marked in any class register this year.' });
          return;
        }
        let present = 0; let recorded = 0; let unmarked = 0;
        registerDays.forEach((d) => {
          if (d.date < first) return;
          const s = sessionsFromRecord(cls.days[d.date]?.[stu.key]);
          [['am', d.amTaken], ['pm', d.pmTaken]].forEach(([half, taken]) => {
            if (!taken) return;
            recorded += 1;
            const code = s ? s[half] : '';
            if (!code) unmarked += 1;
            else if (isPresentCode(code)) present += 1;
          });
        });
        const pct = recorded ? (present * 100) / recorded : 0;
        const fromStart = first === firstDay;
        if (unmarked) gaps.push({ kind: 'attendance-unmarked', key: stu.key, name: stu.name, className: cls.className, reason: `${unmarked} session${unmarked > 1 ? 's' : ''} with no mark on register days (counted as not present).` });
        if (recorded < MIN_ATTENDANCE_SESSIONS) {
          gaps.push({ kind: 'attendance', key: stu.key, name: stu.name, className: cls.className, reason: `Only ${recorded} recorded sessions since ${first} — too few for an attendance award.` });
          return;
        }
        const row = {
          key: stu.key, name: stu.name, className: cls.className, photoUrl: stu.photoUrl, admissionNo: stu.admissionNo,
          score: pct, present, recorded, since: first, fromStart,
          detail: `${present} of ${recorded} sessions (${roundScore(pct).toFixed(2)}%)${fromStart ? '' : ` · since joining ${first}`}`,
        };
        rows.push(row);
        if (fromStart) schoolPool.push(row);
      });
      classAwards[cls.className] = denseTop(rows, (r) => r.score);
    });
    return { classAwards, school: denseTop(schoolPool, (r) => r.score), gaps, classInfo };
  }

  const api = {
    RANK_DECIMALS, MIN_EXAM_SHARE, SUBJECT_SAT_SHARE, MIN_ATTENDANCE_SESSIONS, GROUP_LABELS,
    groupForClass, roundScore, denseTop, requiredExams, computeAcademicAwards, sessionsFromRecord, computeAttendanceAwards,
  };
  global.SomapTopAwards = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
}(typeof window !== 'undefined' ? window : globalThis));
