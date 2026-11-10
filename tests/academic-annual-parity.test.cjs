// Proves shared/academic_annual.js computes exactly what the report form computed
// before the move. Reference = generatereportform.html at commit 079d9a8 (pre-refactor).
// Run: node tests/academic-annual-parity.test.cjs
const { execSync } = require('node:child_process');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const REF_COMMIT = '079d9a8';
const html = execSync(`git show ${REF_COMMIT}:Toacademichtml/generatereportform.html`, { cwd: ROOT, maxBuffer: 64 * 1024 * 1024 }).toString();
const AA = require(path.join(ROOT, 'shared', 'academic_annual.js'));

function extractFunction(name) {
  const start = html.indexOf(`function ${name}(`);
  if (start < 0) throw new Error(`function ${name} not found in reference`);
  let i = html.indexOf('{', start);
  let depth = 0;
  for (; i < html.length; i += 1) {
    const ch = html[i];
    if (ch === '{') depth += 1;
    else if (ch === '}') { depth -= 1; if (depth === 0) break; }
  }
  return html.slice(start, i + 1);
}
function extractConst(name) {
  const re = new RegExp(`const ${name} = [\\s\\S]*?;\\n`, 'm');
  const m = html.match(re);
  if (!m) throw new Error(`const ${name} not found`);
  return m[0];
}

const fnNames = [
  'isNumber', 'hasRecordedScorePayload', 'attemptedItem', 'studentPercentFrom', 'toNormalizedRows', 'displayPercentFrom',
  'gradeFromPercent', 'resolveMonthKey', 'normalizeExamLabel', 'slugifyExamKey', 'examLabelFromKey', 'isSyntheticWindowExam',
  'examMonthsForWindow', 'normalizeMonthlyScoreMap', 'examRecordMeta', 'preferredDisplayMaxFromLogs',
  'appendSyntheticExamWindowRecords', 'mergeWindowRecords', 'buildSubjectStats', 'keyFingerprints',
  'buildNormalizedValueLookup', 'pickMapValueByCandidates', 'getClassCandidates',
];
const src = [
  extractConst('MONTHS'), extractConst('MONTH_LABELS'),
  html.match(/const MONTH_ALIAS_TO_KEY = \(\(\) => \{[\s\S]*?\}\)\(\);/)[0],
  extractConst('EXAM_KEYS'), extractConst('SYNTHETIC_WINDOW_EXAM_KEYS'),
  html.match(/const EXAM_MONTH_PLAN = \{[\s\S]*?\n    \};/)[0],
  'function getStoredExamRegistry(){ return REGISTRY; }',
  'function canonicalSubjectName(s){ return CANON(s); }',
  'function formatDate(d){ return "D:" + d; }',
  ...fnNames.map(extractFunction),
  'this.REF = {' + fnNames.join(',') + '};',
].join('\n');

const CANON = (s) => String(s || '').trim().replace(/^maths?$/i, 'Mathematics').replace(/^eng$/i, 'English');
const REGISTRY = [{ key: 'weekly-test', label: 'Weekly Test' }];
const ctx = { state: { examKey: 'annual' }, REGISTRY, CANON, console };
vm.createContext(ctx);
vm.runInContext(src, ctx);
const REF = ctx.REF;

// ---------- deterministic random data ----------
let seed = 20261110;
const rand = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
const pick = (arr) => arr[Math.floor(rand() * arr.length)];
const SUBJECTS = ['Math', 'Mathematics', 'English', 'Eng', 'Science', 'Kiswahili', 'Social Studies', 'CRN', ' Arts '];
const MONTH_KEYS = ['Jan', 'February', 'MAR', '04', '5', 'June', 'Jul', 'Aug', 'Sept', 'Oct', 'Nov', 'Dec', '2026-09'];
const EXAMS = ['monthly', 'midterm1', 'weekly-test', 'End Term', 'annual', 'Quiz_One'];

function randomScore() {
  const r = rand();
  if (r < 0.1) return Math.round(rand() * 100);
  if (r < 0.15) return { Score: Math.round(rand() * 50), Max: 50 };
  if (r < 0.2) return { score: 0, max: 100 };
  if (r < 0.25) return { score: Math.round(rand() * 300), max: 100 };
  if (r < 0.3) return { score: Math.round(rand() * 40) };
  if (r < 0.33) return { max: 100 };
  if (r < 0.36) return { score: 'x', max: 'y' };
  if (r < 0.4) return { score: Math.round(rand() * 30), max: 30, label: pick(SUBJECTS), date: '2026-03-04' };
  return { score: Math.round(rand() * 100), max: pick([100, 100, 50, 60, 20]) };
}
function randomBucket(nStudents) {
  const out = {};
  for (let s = 0; s < nStudents; s += 1) {
    const subj = {};
    const n = 1 + Math.floor(rand() * 6);
    for (let k = 0; k < n; k += 1) subj[pick(SUBJECTS)] = randomScore();
    out[pick(['SS-001', 'ss-001', 'SS 002', 'SS-003', 'SS-004', 'S5', 'S6', 'S7'])] = subj;
  }
  return out;
}
function randomRoot() {
  const root = {};
  const parts = 2 + Math.floor(rand() * 6);
  for (let p = 0; p < parts; p += 1) {
    const layout = rand();
    if (layout < 0.33) root[pick(MONTH_KEYS)] = randomBucket(4 + Math.floor(rand() * 4));
    else if (layout < 0.66) {
      const m = pick(MONTH_KEYS);
      root[m] = root[m] && typeof root[m] === 'object' ? root[m] : {};
      root[m][pick(EXAMS)] = randomBucket(4);
    } else {
      const e = pick(EXAMS);
      root[e] = root[e] || {};
      root[e][pick(MONTH_KEYS)] = randomBucket(5);
    }
  }
  if (rand() < 0.1) root.junk = [1, 2, 3];
  return root;
}
const plain = (x) => (x === undefined ? undefined : JSON.parse(JSON.stringify(x)));
const eq = (a, b, msg) => assert.deepStrictEqual(plain(a), plain(b), msg);

let checks = 0;
for (let iter = 0; iter < 2500; iter += 1) {
  const root = randomRoot();
  const months = REF.examMonthsForWindow(pick(['annual', 'midterm1', 'endterm', 'midterm2']), 'Sep');
  eq(AA.examMonthsForWindow(pick(['annual']), 'Sep'), REF.examMonthsForWindow('annual', 'Sep'));

  const r1 = []; const s1 = new Set();
  REF.appendSyntheticExamWindowRecords(root, months, r1, s1);
  const r2 = []; const s2 = new Set();
  AA.appendSyntheticExamWindowRecords(root, months, r2, s2, { registry: REGISTRY });
  eq(plain(r2), plain(r1), 'records differ');
  eq([...s2], [...s1]);

  for (const synthetic of [true, false]) {
    ctx.state.examKey = synthetic ? 'annual' : 'monthly';
    const m1 = REF.mergeWindowRecords(r1);
    const m2 = AA.mergeWindowRecords(r2, { synthetic, canonicalSubjectName: CANON, formatDate: (d) => 'D:' + d });
    eq(plain(m2), plain(m1), 'merge differs');

    const subjects = Array.from(new Set(SUBJECTS.map(CANON)));
    Object.keys(m1.mergedScores).forEach((adm) => {
      const a = REF.buildSubjectStats(subjects, m1.mergedScores[adm]);
      const b = AA.buildSubjectStats(subjects, m2.mergedScores[adm]);
      eq(plain(b), plain(a));
      eq(AA.displayPercentFrom(b.subjects), REF.displayPercentFrom(a.subjects));
      eq(AA.studentPercentFrom(b.subjects), REF.studentPercentFrom(a.subjects));
      const pct = REF.displayPercentFrom(a.subjects).pct;
      assert.equal(AA.gradeFromPercent(pct), REF.gradeFromPercent(pct));
      checks += 1;
    });
    const lookA = REF.buildNormalizedValueLookup(m1.mergedScores);
    const lookB = AA.buildNormalizedValueLookup(m2.mergedScores);
    ['SS-001', 'ss001', 'SS 002', 'SS002', 'nope'].forEach((k) => {
      eq(plain(AA.pickMapValueByCandidates(m2.mergedScores, lookB, [k])), plain(REF.pickMapValueByCandidates(m1.mergedScores, lookA, [k])));
    });
  }
  const bucket = randomBucket(6);
  eq(AA.normalizeMonthlyScoreMap(bucket), REF.normalizeMonthlyScoreMap(bucket));
}
['Class 3', 'Pre-Unit', '7', 'Baby Class', ''].forEach((c) => eq(AA.getClassCandidates(c), REF.getClassCandidates(c)));
['Jan', 'SEPT', '2026-11', '7', 'nope', '', null].forEach((m) => assert.equal(AA.resolveMonthKey(m), REF.resolveMonthKey(m)));

console.log(`academic-annual parity OK (${checks} learner comparisons across 2500 random score trees)`);
