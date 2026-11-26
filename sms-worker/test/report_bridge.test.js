import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const BRIDGE = readFileSync(fileURLToPath(new URL('../../smshtml/report-bridge.js', import.meta.url)), 'utf8');

// A stand-in for generatereportform.html: same global names, same roles, and the same
// behaviours that caused the two bugs (Annual month via populateMonthOptions; photos and
// fees arriving only in the page's follow-up loading; no photo cache; failed teacher
// photos cached as null; a creation date + random ID stamped into every PDF).
const PAGE = `
  const state = { year: 2025, className: '', classKey: '', stream: 'B', month: 'Sep', monthRaw: 'Sep', examType: 'Monthly', examKey: 'monthly',
    students: [], filtered: [], rawStudents: {}, parentMode: true, parentAdm: 'X1', selectedAdm: null, logoDataUrl: null, classTeacherPhotoCache: new Map() };
  const RUNTIME = { loadSeq: 0, studentDetailsMap: null };
  let reportBooted = true;
  const CLASS_ORDER = ['Class 1', 'Class 5'];
  const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const EXAM_KEYS = { 'Monthly': 'monthly', 'Midterm 1': 'midterm1', 'Annual': 'annual' };
  var failPhotoCalls = new Set();   // which loadImageAsDataURL calls fail (1-based), to simulate a slow network
  var photoCalls = 0;
  var financeLoads = 0;
  var failNextDrawPhoto = false; // the passport photo fails inside the next drawing only
  function getAllExamOptions() { return Object.keys(EXAM_KEYS).map((label) => ({ label, key: EXAM_KEYS[label], builtIn: true })); }
  function getExamKeyFromLabel(l) { return EXAM_KEYS[l] || String(l).toLowerCase(); }
  function normalizeDisplayClass(c) { return String(c || '').trim(); }
  function preferredMonthStorage(m) { return m + '-stored'; }
  function populateMonthOptions() { if (state.examType === 'Annual') { state.month = 'All'; state.monthRaw = 'All'; } else { state.monthRaw = preferredMonthStorage(state.month); } }
  function subjectListForClass() { return ['Math', 'English']; }
  function gradeFromPercent(p) { return p >= 80.5 ? 'A' : p >= 60.5 ? 'B' : 'C'; }
  function isNumber(n) { return Number.isFinite(n); }
  function toNormalizedRows(subjects) { return subjects.map((x) => ({ attempted: !!x.attempted, dispScore: x.score || 0, dispMax: x.max || 0 })); }
  function studentPercentFrom() { return { pct: 0 }; }
  function resolveStudentPhoto(s) { return s.photoUrl || ''; }
  function transformToJpegIfCloudinary(url) { return url + '?jpg'; }
  async function loadImageAsDataURL(url) { photoCalls++; if (failPhotoCalls.has(photoCalls)) return null; return 'data:image/jpeg;base64,' + url; }
  async function getTeacherPhotoData(person) {
    if (!person || !person.photoUrl) return null;
    if (state.classTeacherPhotoCache.has(person.photoUrl)) return state.classTeacherPhotoCache.get(person.photoUrl);
    const d = await loadImageAsDataURL(person.photoUrl); state.classTeacherPhotoCache.set(person.photoUrl, d || null); return d || null;
  }
  function getAssignmentForStudent() { return { classTeacher: { name: 'Mr A', photoUrl: 'teacherA' }, assistantTeacher: null }; }
  async function fetchStudentDetailsMapCached() { return { S1: { passportPhotoUrl: 'photoS1' } }; }
  function applyStudentDetailsToState(map) { state.students.forEach((s) => { if (map[s.adm]) s.photoUrl = map[s.adm].passportPhotoUrl; }); return true; }
  async function loadFinanceSummaryForStudent(s) { financeLoads++; return { planName: 'Plan A', schedule: [{ due: 1 }] }; }
  function applyFinanceEntryToStudent(adm, entry) { const s = state.students.find((x) => x.adm === adm); s.feePlanName = entry.planName; s.feeSchedule = entry.schedule; return true; }
  async function preloadLogo() { state.logoDataUrl = 'data:image/png;base64,LOGO'; }
  function setSelectedStudent(adm) { state.selectedAdm = adm; }
  // Scores exist for Monthly Sep + Oct and Midterm 1 only (Class 4).
  async function collectExamWindowRecords({ className, examKey, month }) {
    const has = className === 'Class 4' && ((examKey === 'monthly' && (month === 'Sep' || month === 'Oct')) || examKey === 'midterm1');
    return has ? [{ data: { S1: { Math: 80 } } }] : [];
  }
  function mergeWindowRecords(records) { return { mergedScores: records.length ? { S1: {} } : {}, detailsByAdm: {} }; }
  // Faithful to jsPDF 2.5.1 (checked against its source): jsPDF.API is ONLY the plugin store
  // ({ events: [] } + plugins like autoTable); save()/output() are created inside EACH document,
  // then plugins are copied onto it. A real save() must never run inside the hidden frame.
  var realSaves = 0;
  var libLoads = 0;
  function loadJsPdfLibrary() {
    libLoads++;
    function jsPDF(opts) {
      const API = this;
      API.opts = opts; API.parts = [];
      API.output = function () {
        const stamp = '/CreationDate (D:' + Date.now() + Math.random() + ') /ID [ <' + Math.random().toString(16).slice(2) + '> <ab12> ]';
        return new TextEncoder().encode('%PDF-1.3 ' + stamp + ' ' + JSON.stringify(API.opts) + ' ' + API.parts.join(' ')).buffer;
      };
      API.save = function () { realSaves++; throw new Error('a real save() ran inside the hidden frame'); };
      for (const plugin in jsPDF.API) { if (plugin !== 'events') API[plugin] = jsPDF.API[plugin]; }
      return API;
    }
    jsPDF.API = { events: [] };
    jsPDF.API.autoTable = function (o) { this.parts.push('TABLE ' + o); };
    jsPDF.version = '2.5.1';
    window.jspdf = { jsPDF };
  }
  // Same check as the real page: reloads the library if jsPDF or its autoTable plugin is missing.
  async function ensurePdfLibsLoaded() {
    if (!(window.jspdf && window.jspdf.jsPDF)) loadJsPdfLibrary();
    if (!(window.jspdf && window.jspdf.jsPDF && typeof window.jspdf.jsPDF.API?.autoTable === 'function')) loadJsPdfLibrary();
  }
  async function drawReportCard(doc, s) {
    const monthLabel = state.month === 'All' ? 'All Months' : state.month;
    doc.parts.push('/Type /Page CARD ' + s.name + ' Month: ' + monthLabel + ' Plan: ' + (s.feePlanName || 'Not set'));
    doc.autoTable('subjects');
    if (state.logoDataUrl) doc.parts.push('/Subtype /Image LOGO');
    const p = resolveStudentPhoto(s);
    if (p) { const d = failNextDrawPhoto ? (failNextDrawPhoto = false, null) : await loadImageAsDataURL(transformToJpegIfCloudinary(p)); if (d) doc.parts.push('/Subtype /Image ' + d); }
    const t = await getTeacherPhotoData(getAssignmentForStudent(s).classTeacher);
    if (t) doc.parts.push('/Subtype /Image ' + t);
  }
  async function generateSinglePdf(adm) {
    await ensurePdfLibsLoaded();
    const s = state.students.find((x) => x.adm === adm);
    if (!s) return Swal.fire('Not found', 'Student not found.', 'info');
    const doc = new window.jspdf.jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
    await drawReportCard(doc, s);
    const monthSlug = (state.month === 'All' ? 'Annual' : state.month);
    doc.save('report_' + s.adm + '_' + state.className + '_' + state.year + '_' + state.examKey + '_' + monthSlug + '.pdf');
  }
  var seen = [];
  async function loadAllData() {
    const token = ++RUNTIME.loadSeq;
    seen.push({ year: state.year, className: state.className, examType: state.examType, examKey: state.examKey, month: state.month, monthRaw: state.monthRaw, parentMode: state.parentMode, stream: state.stream });
    await new Promise((r) => setTimeout(r, 5));
    if (token !== RUNTIME.loadSeq) return;
    if (state.className === 'Broken') { Swal.fire('Load error', 'Could not load class data. boom', 'error'); return; }
    state.students = [
      { adm: 'S1', name: 'AMINA', class: state.className, overallPosition: 1, attemptedCount: 2, parentContact: '0712345678',
        subjectStats: { attemptedCount: 2, subjects: [{ subject: 'Math', score: 90, max: 100, attempted: true }, { subject: 'English', score: 67, max: 100, attempted: true }] } },
      { adm: 'S2', name: 'JUMA', class: state.className, overallPosition: '-', attemptedCount: 0, subjectStats: { attemptedCount: 0, subjects: [] } },
    ];
    state.filtered = state.students.slice();
  }
  var Swal = { fire() { return Promise.resolve({}); } };
  window.Swal = Swal;
`;

function makePage(source = PAGE) {
  const ctx = { setTimeout, clearTimeout, console, Promise, Date, Number, String, Array, Object, Math, JSON, TextEncoder, Uint8Array, Map, Set };
  ctx.window = ctx;
  ctx.document = { getElementById: () => null };
  vm.createContext(ctx);
  vm.runInContext(source, ctx);
  vm.runInContext(BRIDGE, ctx);
  return ctx;
}
const plain = (v) => JSON.parse(JSON.stringify(v));
const text = (bytes) => new TextDecoder().decode(bytes);

test('REPRO: with the real jsPDF shape (save() per document, jsPDF.API = plugin store) the Download PDF is captured, never saved', async () => {
  const page = makePage();
  const b = page.SomapReportBridge;
  await b.ready();
  vm.runInContext('loadJsPdfLibrary()', page);
  assert.equal(vm.runInContext('typeof window.jspdf.jsPDF.API.save', page), 'undefined', 'like jsPDF 2.5.1: no save() on jsPDF.API');
  const pdf = await b.cardPdf({ year: 2026, className: 'Class 4', examLabel: 'Annual', month: 'Sep' }, 'S1');
  assert.match(text(pdf.bytes), /TABLE subjects/, 'plugins (autoTable) still work through the wrapper');
  assert.equal(pdf.filename, 'report_S1_Class 4_2026_annual_Annual.pdf');
  assert.equal(vm.runInContext('realSaves', page), 0, 'nothing was really saved');
  assert.equal(vm.runInContext('libLoads', page), 1, 'the library was not reloaded behind our back');
  assert.equal(vm.runInContext('window.jspdf.jsPDF.name', page), 'jsPDF', 'the original jsPDF is put back');
  const v = await b.verify({ year: 2026, className: 'Class 4', examLabel: 'Annual', month: 'Sep' }, 'S1');
  assert.equal(v.same, true, JSON.stringify(v));
}, { timeout: 20000 });

test('Annual: month set exactly like the page dropdown (All) -> "All Months" and file name _annual_Annual.pdf', async () => {
  const page = makePage();
  const b = page.SomapReportBridge;
  await b.ready();
  const req = { year: 2026, className: 'Class 5', examLabel: 'Annual', month: 'Sep' };
  const out = await b.compute(req);
  assert.deepEqual(plain(vm.runInContext('seen[0]', page)).month, 'All');
  assert.equal(plain(vm.runInContext('seen[0]', page)).monthRaw, 'All');
  assert.equal(out.month, 'All');
  const pdf = await b.cardPdf(req, 'S1');
  assert.match(text(pdf.bytes), /Month: All Months/);
  assert.equal(pdf.filename, 'report_S1_Class 5_2026_annual_Annual.pdf');
  assert.deepEqual(plain(pdf.card), { avgText: '78.5%', posLabel: '1/2', cohortSize: 2 });
}, { timeout: 15000 });

test('Monthly keeps the chosen month, like the month dropdown', async () => {
  const page = makePage();
  const b = page.SomapReportBridge;
  await b.ready();
  const pdf = await b.cardPdf({ year: 2026, className: 'Class 1', examLabel: 'Monthly', month: 'Oct' }, 'S1');
  assert.match(text(pdf.bytes), /Month: Oct/);
  assert.equal(pdf.filename, 'report_S1_Class 1_2026_monthly_Oct.pdf');
  assert.equal(plain(vm.runInContext('seen[0]', page)).monthRaw, 'Oct-stored');
}, { timeout: 15000 });

test("the link PDF is the page's own Download PDF: photos + logo + teacher photo + fee plan from the follow-up loading", async () => {
  const page = makePage();
  const b = page.SomapReportBridge;
  await b.ready();
  const pdf = await b.cardPdf({ year: 2026, className: 'Class 1', examLabel: 'Monthly', month: 'Oct' }, 'S1');
  const t = text(pdf.bytes);
  assert.match(t, /"orientation":"portrait","unit":"mm","format":"a4"/);
  assert.match(t, /\/Subtype \/Image LOGO/);
  assert.match(t, /photoS1\?jpg/, 'passport photo that only arrives with the student details');
  assert.match(t, /teacherA/, 'class teacher photo');
  assert.match(t, /Plan: Plan A/, "selected child's fee details loaded first");
  assert.deepEqual(pdf.warnings.length, 0);
}, { timeout: 15000 });

test('a failed photo try is retried before drawing; a cached failed teacher photo is forgotten', async () => {
  const page = makePage();
  const b = page.SomapReportBridge;
  await b.ready();
  vm.runInContext('state.classTeacherPhotoCache.set("teacherA", null); failPhotoCalls = new Set([1]);', page);
  const pdf = await b.cardPdf({ year: 2026, className: 'Class 1', examLabel: 'Monthly', month: 'Oct' }, 'S1');
  const t = text(pdf.bytes);
  assert.match(t, /photoS1\?jpg/);
  assert.match(t, /teacherA/);
}, { timeout: 15000 });

test('check passes when the link PDF equals a fresh Download PDF (creation date + random ID ignored)', async () => {
  const page = makePage();
  const b = page.SomapReportBridge;
  await b.ready();
  const v = await b.verify({ year: 2026, className: 'Class 1', examLabel: 'Monthly', month: 'Oct' }, 'S1');
  assert.equal(v.same, true, JSON.stringify(v));
  assert.equal(v.filename, v.buttonFilename);
  assert.equal(v.pages, 1);
  assert.equal(v.images, 3);
}, { timeout: 20000 });

test('check REFUSES when a photo is missing from one of the two PDFs', async () => {
  const page = makePage();
  const b = page.SomapReportBridge;
  await b.ready();
  vm.runInContext('failNextDrawPhoto = true;', page);
  const v = await b.verify({ year: 2026, className: 'Class 1', examLabel: 'Monthly', month: 'Oct' }, 'S1');
  assert.equal(v.same, false);
  assert.match(v.reason, /picha/);
}, { timeout: 20000 });

test('availability lists the months and exams that HAVE results for a class (read-only probe)', async () => {
  const page = makePage();
  const b = page.SomapReportBridge;
  await b.ready();
  const av = plain(await b.availability({ year: 2026, className: 'Class 4' }));
  assert.deepEqual(av, { months: ['Sep', 'Oct'], exams: ['Midterm 1'] });
  assert.deepEqual(plain(await b.availability({ year: 2026, className: 'Class 1' })), { months: [], exams: [] });
  assert.equal(vm.runInContext('seen.length', page), 0, 'probing never runs a full class load');
}, { timeout: 15000 });

test('page errors are reported, not hidden; unknown child refused', async () => {
  const page = makePage();
  const b = page.SomapReportBridge;
  await b.ready();
  await assert.rejects(b.compute({ year: 2026, className: 'Broken', examLabel: 'Monthly', month: 'Sep' }), /boom/);
  await assert.rejects(b.cardPdf({ year: 2026, className: 'Class 1', examLabel: 'Monthly', month: 'Sep' }, 'NOPE'), /hayupo/);
}, { timeout: 15000 });

test('if the report page changes (a piece is missing), the bridge refuses instead of guessing', async () => {
  const changed = PAGE.replace('async function generateSinglePdf(adm)', 'async function makePdfV2(adm)');
  const page = makePage(changed);
  await assert.rejects(page.SomapReportBridge.ready(), /Ukurasa wa ripoti umebadilika \(haupo: generateSinglePdf\)/);
}, { timeout: 15000 });
