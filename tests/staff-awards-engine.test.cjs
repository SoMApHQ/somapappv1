// Rules for Best Teacher / Best Worker of the Year. Run: node tests/staff-awards-engine.test.cjs
const assert = require('node:assert/strict');
const S = require('../shared/staff_awards_engine.js');

// ---------- Teachers: mean of class-subject averages, groups separate, ties shared ----------
{
  const res = (pcts, subject) => Object.fromEntries(pcts.map((p, i) => [`L${i}`, { subjects: { [subject]: { attempted: p != null, pct: p || 0 } } }]));
  const merge = (...maps) => {
    const out = {};
    maps.forEach((m) => Object.entries(m).forEach(([k, v]) => { out[k] = out[k] || { subjects: {} }; Object.assign(out[k].subjects, v.subjects); }));
    return out;
  };
  const classResults = {
    'Class 6': merge(res([80, 90, 70], 'Math'), res([60, 70, null], 'English')), // Math 80, English 65 (2 sat)
    'Class 4': res([90, 92], 'Math'), // 91
    'Baby Class': res([95, 85], 'Arithmetic'), // 90
    'Class 5': res([88, 88], 'Science'), // 88
  };
  const r = S.computeTeacherAwards([
    { key: 'amina', name: 'Amina', claims: [{ className: 'Class 6', subject: 'Math' }, { className: 'Class 4', subject: 'Math' }] }, // (80+91)/2 = 85.5
    { key: 'juma', name: 'Juma', claims: [{ className: 'Class 6', subject: 'English' }] }, // 65
    { key: 'neema', name: 'Neema', claims: [{ className: 'Class 5', subject: 'Science' }, { className: 'Baby Class', subject: 'Arithmetic' }] }, // primary 88, pre 90
    { key: 'paul', name: 'Paul', claims: [{ className: 'Class 5', subject: 'Science' }, { className: 'Class 3', subject: 'Kiswahili' }] }, // 88 (Class 3 no data -> gap)
    { key: 'none', name: 'No Setup', claims: [] },
  ], classResults);
  const pos = Object.fromEntries(r.awards.primary.map((x) => [x.key, [x.position, x.rankScore]]));
  assert.deepEqual(pos.neema, [1, 88]);
  assert.deepEqual(pos.paul, [1, 88]); // tie shares position 1
  assert.deepEqual(pos.amina, [2, 85.5]);
  assert.deepEqual(pos.juma, [3, 65]);
  assert.deepEqual(r.awards.prePrimary.map((x) => [x.key, x.position]), [['neema', 1]]);
  assert.ok(r.gaps.some((g) => g.key === 'paul' && /Class 3/.test(g.reason)));
  assert.ok(r.gaps.some((g) => g.key === 'none'));
  const amina = r.awards.primary.find((x) => x.key === 'amina');
  assert.deepEqual(amina.subjects.map((s) => [s.label, s.average]), [['Class 6 · Math', 80], ['Class 4 · Math', 91]]);
}
// Stream claim uses only that stream's learners.
{
  const results = { 'Class 1': { a: { subjects: { Math: { attempted: true, pct: 100 } } }, b: { subjects: { Math: { attempted: true, pct: 50 } } } } };
  const r = S.computeTeacherAwards([{ key: 't', name: 'T', claims: [{ className: 'Class 1', stream: 'A', subject: 'Math', studentKeys: ['a'] }] }], results);
  assert.equal(r.awards.primary[0].rankScore, 100);
}

// ---------- Workers ----------
{
  const ts = (day, hh, mm) => Date.UTC(Number(day.slice(0, 4)), Number(day.slice(4, 6)) - 1, Number(day.slice(6, 8)), hh - 3, mm);
  const days = Array.from({ length: 20 }, (_, i) => `202603${String(i + 1).padStart(2, '0')}`);
  const mk = (fn) => Object.fromEntries(days.map((d, i) => [d, fn(d, i)]).filter(([, v]) => v));
  const perfect = mk((d) => ({ checkInTs: ts(d, 7, 0), lateMinutes: 0, checkOutTs: ts(d, 16, 5) }));
  const lateOnce = mk((d, i) => ({ checkInTs: ts(d, i === 3 ? 8 : 7, 10), lateMinutes: i === 3 ? 40 : 0, checkInReason: i === 3 ? 'traffic' : '', checkOutTs: ts(d, 16, 1) }));
  const noOut = mk((d) => ({ checkInTs: ts(d, 7, 5), lateMinutes: 0 }));
  const permittedLate = mk((d, i) => ({ checkInTs: ts(d, 7, 15), lateMinutes: i === 0 ? 30 : 0, checkInReason: i === 0 ? 'clinic' : '', permissionId: i === 0 ? 'p1' : undefined, checkOutTs: ts(d, 16, 0) }));
  const few = { 20260301: { checkInTs: ts('20260301', 7, 0), checkOutTs: 1 } };
  const r = S.computeWorkerAwards([
    { key: 'perfect', name: 'Perfect', days: perfect },
    { key: 'late', name: 'Late once', days: lateOnce },
    { key: 'noout', name: 'Never signs out', days: noOut },
    { key: 'perm', name: 'Late with permission', days: permittedLate },
    { key: 'few', name: 'New', days: few },
    { key: 'rejected', name: 'Rejected', days: mk((d) => ({ checkInTs: ts(d, 7, 0), checkInStatus: 'rejected' })) },
  ], { from: '20260101', until: '20261231' });
  assert.equal(r.workDays, 20);
  const p = Object.fromEntries(r.ranked.map((x) => [x.key, x]));
  assert.equal(S.round(p.perfect.score), 100);
  assert.equal(p.late.letters, 1);
  assert.equal(S.round(p.late.score), S.round(100 * (0.4 + 0.3 * 19 / 20 + 0.15 + 0.15 * 0.95)));
  assert.equal(p.perm.letters, 0, 'approved permission is not a protocol letter');
  assert.equal(S.round(p.noout.score), S.round(100 * (0.4 + 0.3 + 0 + 0.15)));
  assert.ok(!p.few && r.gaps.some((g) => g.key === 'few'));
  assert.ok(!p.rejected, 'rejected check-ins do not count');
  assert.deepEqual(r.awards.map((x) => [x.key, x.position]), [['perfect', 1], ['perm', 2], ['late', 3]]);
  assert.equal(S.clock(p.perfect.avgArrival), '07:00');
}
console.log('staff-awards engine OK');
