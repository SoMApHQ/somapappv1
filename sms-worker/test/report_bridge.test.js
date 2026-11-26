import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const BRIDGE = readFileSync(fileURLToPath(new URL('../../smshtml/report-bridge.js', import.meta.url)), 'utf8');

// A stand-in for generatereportform.html's globals (same names, same roles).
const PAGE = `
  const state = { year: 2025, className: '', classKey: '', stream: 'B', month: 'Sep', monthRaw: 'Sep', examType: 'Monthly', examKey: 'monthly', students: [], filtered: [], parentMode: true, parentAdm: 'X1' };
  const RUNTIME = { loadSeq: 0 };
  let reportBooted = true;
  const CLASS_ORDER = ['Class 1', 'Class 2'];
  const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const EXAM_KEYS = { 'Monthly': 'monthly', 'Midterm 1': 'midterm1', 'Annual': 'annual' };
  function getAllExamOptions() { return Object.keys(EXAM_KEYS).map((label) => ({ label, key: EXAM_KEYS[label], builtIn: true })); }
  function getExamKeyFromLabel(l) { return EXAM_KEYS[l] || String(l).toLowerCase(); }
  function normalizeDisplayClass(c) { return String(c || '').trim(); }
  function preferredMonthStorage(m) { return m + '-stored'; }
  function subjectListForClass() { return ['Math', 'English']; }
  function gradeFromPercent(p) { return p >= 80.5 ? 'A' : p >= 60.5 ? 'B' : 'C'; }
  function classAveragePct() { return 50; }
  function isNumber(n) { return Number.isFinite(n); }
  function toNormalizedRows(subjects) { return subjects.map((x) => ({ attempted: !!x.attempted, dispScore: x.score || 0, dispMax: x.max || 0 })); }
  function studentPercentFrom() { return { pct: 0 }; }
  async function ensurePdfLibsLoaded() {
    window.jspdf = { jsPDF: class { constructor(opts) { this.opts = opts; this.text = ''; } output(kind) { return new TextEncoder().encode('%PDF-1.3 ' + JSON.stringify(this.opts) + ' ' + this.text).buffer; } } };
  }
  async function drawReportCard(doc, s) { doc.text = 'CARD ' + s.name + ' ' + state.className + ' ' + state.examType; }
  var seen = [];
  async function loadAllData() {
    const token = ++RUNTIME.loadSeq;
    seen.push({ year: state.year, className: state.className, stream: state.stream, examType: state.examType, examKey: state.examKey, month: state.month, monthRaw: state.monthRaw, parentMode: state.parentMode });
    await new Promise((r) => setTimeout(r, 5));
    if (token !== RUNTIME.loadSeq) return;
    if (state.className === 'Broken') { Swal.fire('Load error', 'Could not load class data. boom', 'error'); return; }
    state.students = [
      { adm: 'S1', admissionNo: 'A-1', name: 'AMINA', class: state.className, avg: 81, overallPosition: 1, attemptedCount: 2, parentContact: '0712345678', balance: 999,
        subjectStats: { attemptedCount: 2, subjects: [{ subject: 'Math', score: 90, max: 100, attempted: true }, { subject: 'English', score: 67, max: 100, attempted: true }] } },
      { adm: 'S2', name: 'JUMA', class: state.className, avg: 0, overallPosition: '-', attemptedCount: 0, subjectStats: { attemptedCount: 0, subjects: [] } },
      { adm: 'S3', name: 'NEEMA', class: state.className, avg: 50, overallPosition: 2, attemptedCount: 1, subjectStats: { attemptedCount: 1, subjects: [{ subject: 'Math', score: 50, max: 100, attempted: true }] } },
    ];
    state.filtered = state.students.slice();
  }
  var Swal = { fire() { return Promise.resolve({}); } };
  window.Swal = Swal;
`;

function makePage(source = PAGE) {
  const ctx = { setTimeout, clearTimeout, console, Promise, Date, Number, String, Array, Object, Math, JSON, TextEncoder, Uint8Array };
  ctx.window = ctx;
  vm.createContext(ctx);
  vm.runInContext(source, ctx);
  vm.runInContext(BRIDGE, ctx);
  return ctx;
}
const plain = (v) => JSON.parse(JSON.stringify(v));

test('bridge sets the page exactly like its dropdowns and reads the PRINTED figures (avg + position/N)', async () => {
  const page = makePage();
  const bridge = page.SomapReportBridge;
  await bridge.ready();
  assert.deepEqual(plain(bridge.exams()).map((e) => e.key), ['monthly', 'midterm1', 'annual']);
  const out = await bridge.compute({ year: '2026', className: 'Class 2', examLabel: 'Midterm 1', month: 'Mar' });
  assert.deepEqual(plain(vm.runInContext('seen[seen.length - 1]', page)), { year: 2026, className: 'Class 2', stream: '', examType: 'Midterm 1', examKey: 'midterm1', month: 'Mar', monthRaw: 'Mar-stored', parentMode: false });
  assert.equal(out.cohortSize, 3, 'N = all learners on the page, as drawReportCard prints');
  assert.deepEqual(plain(out.students.map((s) => [s.adm, s.hasResults, s.card.avgText, s.card.posLabel])), [
    ['S1', true, '78.5%', '1/3'], ['S2', false, '0.0%', '-/3'], ['S3', true, '50.0%', '2/3'],
  ]);
  assert.equal(out.students[0].balance, undefined, 'only what the SMS needs leaves the frame');
}, { timeout: 15000 });

test("cardPdf = the page's own drawReportCard on its A4 jsPDF document, bytes returned (not saved)", async () => {
  const page = makePage();
  const bridge = page.SomapReportBridge;
  await bridge.ready();
  const req = { year: 2026, className: 'Class 1', examLabel: 'Monthly', month: 'Oct' };
  await bridge.compute(req);
  const pdf = await bridge.cardPdf(req, 'S1');
  const text = new TextDecoder().decode(pdf.bytes);
  assert.ok(text.startsWith('%PDF-'));
  assert.match(text, /"orientation":"portrait","unit":"mm","format":"a4"/);
  assert.match(text, /CARD AMINA Class 1 Monthly/);
  assert.equal(pdf.filename, 'report_S1_Class 1_2026_monthly_Oct.pdf', 'same file name as "Download PDF"');
  assert.equal(vm.runInContext('seen.length', page), 1, 'no reload needed for the class already computed');

  const other = await bridge.cardPdf({ year: 2026, className: 'Class 2', examLabel: 'Monthly', month: 'Oct' }, 'S3');
  assert.match(new TextDecoder().decode(other.bytes), /CARD NEEMA Class 2 Monthly/);
  assert.equal(vm.runInContext('seen.length', page), 2, 'another class is computed first, like choosing it in the page');
  await assert.rejects(bridge.cardPdf(req, 'NOPE'), /hayupo/);
}, { timeout: 15000 });

test('Annual uses all months; work runs one step at a time', async () => {
  const page = makePage();
  const bridge = page.SomapReportBridge;
  await bridge.ready();
  const [a, b] = await Promise.all([
    bridge.compute({ year: 2026, className: 'Class 1', examLabel: 'Annual' }),
    bridge.compute({ year: 2026, className: 'Class 2', examLabel: 'Monthly', month: 'Oct' }),
  ]);
  assert.equal(a.className, 'Class 1');
  assert.equal(b.className, 'Class 2');
  const seen = plain(vm.runInContext('seen', page));
  assert.equal(seen[0].monthRaw, 'All');
  assert.equal(seen[1].monthRaw, 'Oct-stored');
}, { timeout: 15000 });

test('page errors are reported, not hidden', async () => {
  const page = makePage();
  await page.SomapReportBridge.ready();
  await assert.rejects(page.SomapReportBridge.compute({ year: 2026, className: 'Broken', examLabel: 'Monthly', month: 'Sep' }), /boom/);
}, { timeout: 15000 });

test('if the report page changes (a piece is missing), the bridge refuses instead of guessing', async () => {
  const changed = PAGE.replace('async function drawReportCard(doc, s)', 'async function drawCardV2(doc, s)');
  const page = makePage(changed);
  await assert.rejects(page.SomapReportBridge.ready(), /Ukurasa wa ripoti umebadilika \(haupo: drawReportCard\)/);
}, { timeout: 15000 });
