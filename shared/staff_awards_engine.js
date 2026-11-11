/*
 * SoMAp Staff Awards Engine — pure rules for Best Teacher / Best Worker of the Year.
 * No DOM, no Firebase. Tested by tests/staff-awards-engine.test.cjs.
 *
 * BEST TEACHER (academic):
 *   For each class·(stream)·subject the teacher claimed in workertasks (teachers_config),
 *   take the ANNUAL subject percentage of every learner who sat that subject (report-form
 *   formula, shared/academic_annual.js) and average them = the class-subject average.
 *   Teacher average = sum of class-subject averages / number of class-subjects.
 *   Pre-Primary (Baby, Middle, Pre-Unit) and Primary (Class 1–7) teaching are ranked
 *   separately; a teacher who teaches both is ranked in each with those subjects only.
 *   Class-subjects with no results are left out and listed as data gaps.
 *
 * BEST WORKER (service):
 *   From 1 January to the download date, per worker:
 *     presence    = days signed in / school working days (days at least one worker signed in)
 *     punctuality = on-time sign-ins (not late, 07:30 rule) / days signed in
 *     sign-out    = days signed out / days signed in
 *     protocol    = 100% minus 5 points per explanation letter (late, absence, missed or early
 *                   sign-out, late lesson plan), never below 0
 *   Service score = 40% presence + 30% punctuality + 15% sign-out + 15% protocol.
 *   Average arrival time is shown as supporting evidence.
 *
 * Positions everywhere: ties share a position, next score = next position (1,1,2,2,3),
 * compared at 2 decimals; only positions 1–3 are awarded.
 */
(function (global) {
  'use strict';

  const RANK_DECIMALS = 2;
  const WORKER_WEIGHTS = { presence: 0.4, punctuality: 0.3, signOut: 0.15, protocol: 0.15 };
  const LETTER_PENALTY = 0.05;
  const MIN_WORKER_DAYS = 10;

  const round = (n) => Math.round(Number(n || 0) * 10 ** RANK_DECIMALS) / 10 ** RANK_DECIMALS;
  function denseTop(items, scoreOf, maxPosition = 3) {
    const sorted = items.map((item) => ({ item, score: round(scoreOf(item)) })).filter((x) => Number.isFinite(x.score)).sort((a, b) => b.score - a.score);
    const out = [];
    let position = 0; let last = null;
    for (const row of sorted) {
      if (row.score !== last) { position += 1; last = row.score; }
      if (position > maxPosition) break;
      out.push({ ...row.item, position, rankScore: row.score });
    }
    return out;
  }
  function groupForClass(className) {
    return /baby|middle|pre\s*-?\s*unit|nursery|kg/i.test(String(className || '')) ? 'prePrimary' : 'primary';
  }
  const GROUP_LABELS = { prePrimary: 'Pre-Primary (Baby, Middle & Pre-Unit)', primary: 'Primary (Class 1 – 7)' };

  /**
   * teachers: [{ key, name, photoUrl, claims: [{ className, stream, subject, studentKeys? }] }]
   * classResults: { [className]: { [learnerKey]: { subjects: { [subject]: { attempted, pct } } } } }
   * learnerKeysByStream: optional resolver (className, stream) -> array of learner keys or null.
   */
  function computeTeacherAwards(teachers, classResults) {
    const gaps = [];
    const rowsByGroup = { prePrimary: [], primary: [] };
    const detailByTeacher = {};
    (teachers || []).forEach((t) => {
      const perGroup = { prePrimary: [], primary: [] };
      const seen = new Set();
      (t.claims || []).forEach((c) => {
        const id = `${c.className}|${c.stream || ''}|${c.subject}`;
        if (seen.has(id)) return;
        seen.add(id);
        const results = classResults[c.className] || {};
        let keys = Object.keys(results);
        let note = '';
        if (c.stream) {
          if (Array.isArray(c.studentKeys) && c.studentKeys.length) {
            const set = new Set(c.studentKeys);
            keys = keys.filter((k) => set.has(k));
          } else {
            note = 'stream learners not listed, whole class used';
          }
        }
        const pcts = keys.map((k) => results[k]?.subjects?.[c.subject]).filter((r) => r && r.attempted).map((r) => Number(r.pct) || 0);
        const label = `${c.className}${c.stream ? ` (${c.stream})` : ''} · ${c.subject}`;
        if (!pcts.length) {
          gaps.push({ kind: 'teacher', key: t.key, name: t.name, reason: `${label}: no annual results yet — left out of the average.` });
          return;
        }
        const avg = pcts.reduce((a, b) => a + b, 0) / pcts.length;
        perGroup[groupForClass(c.className)].push({ className: c.className, stream: c.stream || '', subject: c.subject, label, average: avg, learners: pcts.length, note });
      });
      detailByTeacher[t.key] = perGroup;
      if (!perGroup.prePrimary.length && !perGroup.primary.length) {
        if (!(t.claims || []).length) gaps.push({ kind: 'teacher', key: t.key, name: t.name, reason: 'No classes or subjects saved in Worker Tasks (Class & Subjects).' });
        return;
      }
      Object.entries(perGroup).forEach(([group, subjects]) => {
        if (!subjects.length) return;
        const average = subjects.reduce((a, s) => a + s.average, 0) / subjects.length;
        rowsByGroup[group].push({
          key: t.key, name: t.name, photoUrl: t.photoUrl || '', role: t.role || 'Teacher', group,
          score: average, subjects: subjects.map((s) => ({ label: s.label, average: round(s.average), learners: s.learners, note: s.note })),
          detail: `${round(average).toFixed(2)}% across ${subjects.length} class-subject${subjects.length > 1 ? 's' : ''}`,
        });
      });
    });
    const awards = {};
    Object.entries(rowsByGroup).forEach(([g, rows]) => { awards[g] = denseTop(rows, (r) => r.score); });
    return { awards, ranked: rowsByGroup, gaps, detailByTeacher };
  }

  /** Normalise one worker attendance day record into the facts we score. */
  function dayFacts(rec) {
    if (!rec || typeof rec !== 'object') return null;
    const inTs = Number(rec.checkInTs || 0);
    const outTs = Number(rec.checkOutTs || 0);
    const status = String(rec.checkInStatus || '').toLowerCase();
    if (!inTs || status === 'rejected') {
      const absenceLetter = Boolean(rec.absenceExplanation || rec.absenceExplanationText);
      return { signedIn: false, signedOut: false, onTime: false, letters: absenceLetter ? 1 : 0, arrivalMin: null };
    }
    const permitted = Boolean(rec.permissionId) || /permission/i.test(String(rec.attendanceStatus || ''));
    const late = Number(rec.lateMinutes || 0) > 0;
    let letters = 0;
    if (late && !permitted && String(rec.checkInReason || '').trim()) letters += 1;
    if (rec.absenceExplanation || rec.absenceExplanationText) letters += 1;
    if (rec.missedCheckoutExplanation || rec.missedCheckoutExplanationText) letters += 1;
    if (Number(rec.earlyMinutes || 0) > 0 && !permitted && String(rec.checkOutReason || '').trim()) letters += 1;
    return {
      signedIn: true,
      signedOut: outTs > 0,
      onTime: !late,
      letters,
      arrivalMin: nairobiMinutes(inTs),
    };
  }
  function nairobiMinutes(ts) {
    const d = new Date(Number(ts) + 3 * 3600 * 1000); // Africa/Nairobi = UTC+3, no DST
    return d.getUTCHours() * 60 + d.getUTCMinutes();
  }
  const clock = (mins) => (mins == null ? '—' : `${String(Math.floor(mins / 60)).padStart(2, '0')}:${String(Math.round(mins % 60)).padStart(2, '0')}`);

  /**
   * workers: [{ key, name, photoUrl, role, days: { 'YYYYMMDD': record }, extraLetters: n }]
   * options.from 'YYYYMMDD', options.until 'YYYYMMDD'
   */
  function computeWorkerAwards(workers, { from, until } = {}) {
    const inRange = (d) => (!from || d >= from) && (!until || d <= until);
    const workDays = new Set();
    const rows = [];
    const gaps = [];
    (workers || []).forEach((w) => {
      let signIns = 0; let onTime = 0; let signOuts = 0; let letters = Number(w.extraLetters || 0); let arrivalSum = 0; let arrivals = 0;
      Object.entries(w.days || {}).forEach(([day, rec]) => {
        if (!/^\d{8}$/.test(day) || !inRange(day)) return;
        const f = dayFacts(rec);
        if (!f) return;
        letters += f.letters;
        if (!f.signedIn) return;
        workDays.add(day);
        signIns += 1;
        if (f.onTime) onTime += 1;
        if (f.signedOut) signOuts += 1;
        if (f.arrivalMin != null) { arrivalSum += f.arrivalMin; arrivals += 1; }
      });
      rows.push({ key: w.key, name: w.name, photoUrl: w.photoUrl || '', role: w.role || '', signIns, onTime, signOuts, letters, avgArrival: arrivals ? arrivalSum / arrivals : null });
    });
    const totalDays = workDays.size;
    const scored = [];
    rows.forEach((r) => {
      if (r.signIns < MIN_WORKER_DAYS) {
        gaps.push({ kind: 'worker', key: r.key, name: r.name, reason: r.signIns ? `Only ${r.signIns} sign-ins this year — too few to rank (appreciation certificate still available).` : 'No sign-ins recorded this year — appreciation certificate only.' });
        return;
      }
      const presence = totalDays ? Math.min(1, r.signIns / totalDays) : 0;
      const punctuality = r.onTime / r.signIns;
      const signOut = r.signOuts / r.signIns;
      const protocol = Math.max(0, 1 - LETTER_PENALTY * r.letters);
      const score = 100 * (WORKER_WEIGHTS.presence * presence + WORKER_WEIGHTS.punctuality * punctuality + WORKER_WEIGHTS.signOut * signOut + WORKER_WEIGHTS.protocol * protocol);
      scored.push({
        ...r, score, presence, punctuality, signOut, protocol, workDays: totalDays,
        detail: `Score ${round(score).toFixed(2)} · ${r.signIns}/${totalDays} days · ${Math.round(punctuality * 100)}% on time · ${r.signOuts} sign-outs · ${r.letters} letter${r.letters === 1 ? '' : 's'} · avg arrival ${clock(r.avgArrival)}`,
      });
    });
    return { awards: denseTop(scored, (r) => r.score), ranked: scored.sort((a, b) => b.score - a.score), gaps, workDays: totalDays };
  }

  const api = { RANK_DECIMALS, WORKER_WEIGHTS, LETTER_PENALTY, MIN_WORKER_DAYS, GROUP_LABELS, round, denseTop, groupForClass, computeTeacherAwards, dayFacts, nairobiMinutes, clock, computeWorkerAwards };
  global.SomapStaffAwards = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
}(typeof window !== 'undefined' ? window : globalThis));
