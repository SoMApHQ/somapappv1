// Rules for Top Students awards. Run: node tests/top-awards-engine.test.cjs
const assert = require('node:assert/strict');
const T = require('../shared/top_awards_engine.js');

// --- 1. The school's own example: ties share a position, next score = next position ---
{
  const kids = [
    { name: 'Alex', s: 100 }, { name: 'Eva', s: 100 }, { name: 'Jannet', s: 99 },
    { name: 'Eric', s: 97 }, { name: 'Munene', s: 99 }, { name: 'Zawadi', s: 95 },
  ];
  const top = T.denseTop(kids, (k) => k.s);
  const pos = Object.fromEntries(top.map((k) => [k.name, k.position]));
  assert.deepEqual(pos, { Alex: 1, Eva: 1, Jannet: 2, Munene: 2, Eric: 3 });
  assert.ok(!('Zawadi' in pos), 'Position 4 is not awarded');
}
// Scores compared at 2 decimals; positions are whole numbers.
{
  const top = T.denseTop([{ n: 'a', s: 88.004 }, { n: 'b', s: 88.001 }, { n: 'c', s: 87.996 }], (k) => k.s);
  assert.deepEqual(top.map((t) => t.position), [1, 1, 1]);
  assert.ok(top.every((t) => Number.isInteger(t.position)));
}
// A lonely 30 in a subject is still Position 1.
assert.equal(T.denseTop([{ s: 30 }], (k) => k.s)[0].position, 1);

// --- 2. Academic eligibility: every subject the class sat + 80% of exams (max anyone sat) ---
const subj = (pct, exams, attempted = true) => ({ attempted, pct, exams });
function learner(key, avg, examsSat, subjects) {
  return { key, name: key, annual: { avg, attemptedCount: Object.values(subjects).filter((s) => s.attempted).length, examsSat, subjects } };
}
{
  const cls = {
    className: 'Class 5',
    students: [
      learner('A', 92, 5, { Math: subj(95, 5), English: subj(89, 5) }),
      learner('B', 99, 5, { Math: subj(99, 5) }), // skipped English -> not ranked overall
      learner('C', 90, 4, { Math: subj(90, 4), English: subj(90, 4) }), // 4 of 5 = 80% ok
      learner('D', 98, 3, { Math: subj(98, 3), English: subj(98, 3) }), // 3 of 5 -> not ranked
      learner('E', 85, 5, { Math: subj(80, 5), English: subj(90, 5) }),
      { key: 'F', name: 'F', annual: null },
    ],
  };
  const r = T.computeAcademicAwards([cls]);
  assert.equal(r.classInfo['Class 5'].classExams, 5);
  assert.equal(r.classInfo['Class 5'].needExams, 4);
  assert.deepEqual(r.classOverall['Class 5'].map((x) => [x.key, x.position]), [['A', 1], ['C', 2], ['E', 3]]);
  assert.ok(r.gaps.some((g) => g.key === 'B' && /English/.test(g.reason)));
  assert.ok(r.gaps.some((g) => g.key === 'D' && /3 of 5/.test(g.reason)));
  assert.ok(r.gaps.some((g) => g.key === 'F'));
  // Subject: B's 99 in Math counts (B sat all 5 Math exams); D's 3 Math exams do not.
  assert.deepEqual(r.classSubject['Class 5'].Math.map((x) => [x.key, x.position]), [['B', 1], ['A', 2], ['C', 3]]);
}
// User's example: 6 kids did 5 exams, 2 did 4, 1 did 3 -> class exams 5, need 4.
{
  const students = [];
  for (let i = 0; i < 6; i++) students.push(learner(`k${i}`, 80 + i, 5, { Math: subj(80 + i, 5) }));
  students.push(learner('four1', 99, 4, { Math: subj(99, 4) }), learner('four2', 70, 4, { Math: subj(70, 4) }));
  students.push(learner('three', 100, 3, { Math: subj(100, 3) }));
  const r = T.computeAcademicAwards([{ className: 'Class 2', students }]);
  assert.equal(r.classInfo['Class 2'].needExams, 4);
  assert.equal(r.classOverall['Class 2'][0].key, 'four1');
  assert.ok(!r.classOverall['Class 2'].some((x) => x.key === 'three'));
}

// --- 3. Whole-school academic groups never mix Pre-Primary with Primary ---
{
  const r = T.computeAcademicAwards([
    { className: 'Baby Class', students: [learner('baby', 100, 2, { Arithmetic: subj(100, 2) })] },
    { className: 'Middle Class', students: [learner('mid', 97, 2, { Arithmetic: subj(97, 2) })] },
    { className: 'Class 4', students: [learner('c4', 91, 6, { Math: subj(91, 6) })] },
    { className: 'Class 6', students: [learner('c6', 93, 6, { Math: subj(93, 6) })] },
  ]);
  assert.deepEqual(r.schoolOverall.prePrimary.map((x) => x.key), ['baby', 'mid']);
  assert.deepEqual(r.schoolOverall.primary.map((x) => [x.key, x.position]), [['c6', 1], ['c4', 2]]);
  assert.deepEqual(r.schoolSubject.primary.Math.map((x) => x.key), ['c6', 'c4']);
  assert.ok(r.schoolSubject.prePrimary.Arithmetic);
}
// A child with 100 in English is number 1 in class AND school (if eligible).
{
  const r = T.computeAcademicAwards([
    { className: 'Class 3', students: [learner('star', 90, 4, { English: subj(100, 4), Math: subj(80, 4) }), learner('x', 85, 4, { English: subj(88, 4), Math: subj(82, 4) })] },
    { className: 'Class 5', students: [learner('y', 95, 4, { English: subj(97, 4), Math: subj(93, 4) })] },
  ]);
  assert.equal(r.classSubject['Class 3'].English[0].key, 'star');
  assert.equal(r.schoolSubject.primary.English[0].key, 'star');
  assert.equal(r.schoolSubject.primary.English[0].position, 1);
}

// --- 4. Attendance by half day ---
{
  assert.deepEqual(T.sessionsFromRecord({ daily: 'PA' }), { am: 'P', pm: 'A' });
  assert.deepEqual(T.sessionsFromRecord({ daily: 'SP' }), { am: 'S', pm: 'P' });
  assert.deepEqual(T.sessionsFromRecord({ am: 'P', pm: 'P', daily: 'P' }), { am: 'P', pm: 'P' });
  assert.equal(T.sessionsFromRecord({}), null);

  const days = {};
  const start = new Date('2026-01-05T00:00:00Z');
  for (let i = 0; i < 40; i++) {
    const d = new Date(start.getTime() + i * 86400000).toISOString().slice(0, 10);
    days[d] = {
      perfect: { am: 'P', pm: 'P' },
      half: i === 3 ? { am: 'P', pm: 'A' } : { am: 'P', pm: 'P' },
      sick: i < 2 ? { am: 'S', pm: 'S' } : { am: 'P', pm: 'P' },
      ...(i >= 10 ? { late: { am: 'P', pm: 'P' } } : {}),
      ...(i === 7 ? {} : { gappy: { am: 'P', pm: 'P' } }),
    };
  }
  days['2099-01-01'] = { perfect: { am: 'A', pm: 'A' } }; // future days ignored
  const students = ['perfect', 'half', 'sick', 'late', 'gappy', 'never'].map((k) => ({ key: k, name: k }));
  const r = T.computeAttendanceAwards([{ className: 'Class 1', students, days }], { until: '2026-12-31' });
  const pos = Object.fromEntries(r.classAwards['Class 1'].map((x) => [x.key, [x.position, x.present, x.recorded]]));
  assert.deepEqual(pos.perfect, [1, 80, 80]);
  assert.deepEqual(pos.late, [1, 60, 60]); // 100% since joining
  assert.deepEqual(pos.half, [2, 79, 80]);
  assert.deepEqual(pos.gappy, [3, 78, 80]); // missing mark on day 7 counts as not present
  assert.ok(!pos.sick, 'sick 76/80 is position 4');
  // Whole school: only learners marked from the first register day.
  assert.deepEqual(r.school.map((x) => x.key), ['perfect', 'half', 'gappy']);
  assert.ok(r.gaps.some((g) => g.key === 'never'));
  assert.ok(r.gaps.some((g) => g.key === 'gappy' && /no mark/.test(g.reason)));
}
console.log('top-awards engine OK');
