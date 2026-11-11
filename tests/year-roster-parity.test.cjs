// The light roster (shared/year_roster.js) must list the same learners in the same classes as
// SomapFinance.getFinanceRoster for 2026+. Run: node tests/year-roster-parity.test.cjs
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const ROOT = path.join(__dirname, '..');

const CLASSES = ['Baby Class', 'Middle Class', 'Pre Unit Class', 'Class 1', 'Class 2', 'Class 3', 'Class 4', 'Class 5', 'Class 6', 'Class 7'];
let seed = 99;
const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
const pick = (a) => a[Math.floor(rnd() * a.length)];

function makeDb() {
  const students = {}; const enr2025 = {}; const enr2026 = {}; const enr2027 = {};
  for (let i = 0; i < 260; i += 1) {
    const id = `s${i}`;
    const s = { firstName: `F${i}`, lastName: `L${i}`, admissionNumber: `ADM${i}`, className: pick([...CLASSES, 'Pre-Unit', 'class 3', 'Std 4']) };
    const r = rnd();
    if (r < 0.25) s.createdAt = Date.UTC(2024, 3, 1);
    else if (r < 0.5) s.createdAt = Date.UTC(2025, 5, 1);
    else if (r < 0.7) s.createdAt = Date.UTC(2026, 1, 10);
    else if (r < 0.8) s.admissionYear = pick([2024, 2025, 2026]);
    if (rnd() < 0.06) s.status = pick(['shifted', 'graduated', 'deleted']);
    if (rnd() < 0.03) s.lastName = '';
    if (rnd() < 0.05) s.lastClassTransfer = { toClass: pick(CLASSES), effectiveDate: '2026-03-01' };
    if (rnd() < 0.03) s.isGraduated = true;
    students[id] = s;
    if (rnd() < 0.5) enr2025[id] = { className: pick(CLASSES) };
    if (rnd() < 0.2) enr2026[id] = { className: pick(CLASSES) };
    if (rnd() < 0.1) enr2027[id] = { className: pick(CLASSES) };
  }
  return { students, enrollments: { 2025: enr2025, 2026: enr2026, 2027: enr2027 } };
}

function context(data) {
  const get = (p) => p.split('/').filter(Boolean).reduce((o, k) => (o == null ? undefined : o[k]), data);
  const ref = (p) => ({ once: async () => ({ val: () => get(p) ?? null, exists: () => get(p) != null, forEach: () => false }), orderByChild: () => ref(p), equalTo: () => ref(p), limitToLast: () => ref(p) });
  const db = { ref };
  const ctx = { console: { ...console, warn() {}, log() {} }, Date, Math, JSON, Promise, Number, String, Object, Array, Set, Map, setTimeout, clearTimeout, currentSchoolId: 'socrates-school', SOMAP: { getSchoolId: () => 'socrates-school', getSchool: () => ({ id: 'socrates-school' }) }, db };
  ctx.window = ctx; ctx.globalThis = ctx;
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'shared', 'finance_math.js'), 'utf8'), ctx);
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'shared', 'year_roster.js'), 'utf8'), ctx);
  return ctx;
}

(async () => {
  const data = makeDb();
  for (const year of [2026, 2027]) {
    const ctx = context(data);
    const full = await ctx.SomapFinance.getFinanceRoster(year);
    const light = await ctx.SomapYearRoster.getYearRoster(year);
    // Award pages drop learners who already left (graduated / shifted / deleted). The finance
    // roster still lists some of them; the light roster drops them at source.
    const left = (r) => ['graduated', 'shifted', 'deleted', 'archived', 'removed'].includes(String(r.status || '').toLowerCase()) || r.isGraduated;
    const norm = (rows) => Object.fromEntries(rows
      .filter((r) => !left(r))
      .filter((r) => !['GRADUATED', 'PRE-ADMISSION', 'N/A', ''].includes(String(r.classLevel).toUpperCase()))
      .map((r) => [r.id, String(r.classLevel)]));
    const a = norm(full); const b = norm(light);
    const missing = Object.keys(a).filter((k) => !(k in b));
    const extra = Object.keys(b).filter((k) => !(k in a));
    const diffClass = Object.keys(a).filter((k) => k in b && a[k] !== b[k]).map((k) => `${k}: ${a[k]} vs ${b[k]}`);
    if (process.env.DEBUG_ROSTER) missing.forEach((k) => console.log(JSON.stringify({ k, s: data.students[k], cls: a[k], status: full.find((r) => r.id === k)?.status })));
    assert.deepEqual({ missing, extra, diffClass }, { missing: [], extra: [], diffClass: [] }, `year ${year} roster differs`);
    console.log(`year ${year}: ${Object.keys(a).length} learners, identical classes`);
  }
  console.log('year-roster parity OK');
})().catch((e) => { console.error(e); process.exit(1); });
