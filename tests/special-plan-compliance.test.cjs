const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { webcrypto } = require('node:crypto');
const copy = v => v == null ? null : JSON.parse(JSON.stringify(v));
const getAt = (tree, path) => path.split('/').filter(Boolean).reduce((o, k) => o?.[k], tree) ?? null;
function putAt(tree, path, value) {
  const keys = path.split('/').filter(Boolean); const key = keys.pop();
  let obj = tree;
  for (const part of keys) obj = obj[part] ||= {};
  if (value == null) delete obj[key]; else obj[key] = copy(value);
}
const rows = (fee = 680000) => [
  { label: '1-INSTALLMENT', from: '2025-12-01', to: '2026-01-15', amount: fee === 844000 ? 420000 : fee / 2 },
  { label: '2-INSTALLMENT', from: '2026-07-01', to: '2026-07-15', amount: fee === 844000 ? 424000 : fee / 2 }
];
function payment(amount, date, extra = {}) { return { amount, timestamp: new Date(date + 'T12:00:00').getTime(), academicYear: 2026, approvedAt: 1, status: 'approved', ...extra }; }
const timely = () => ({ a: payment(340000, '2026-01-13'), b: payment(340000, '2026-07-07') });
const late = () => ({ a: payment(300000, '2026-02-02'), b: payment(120000, '2026-03-17'), c: payment(245000, '2026-07-20'), d: payment(100000, '2026-07-20'), e: payment(79000, '2026-07-31') });
function fixture(payments = late(), fee = 844000, defaultFee = 844000) {
  const schedule = rows(fee);
  const school = {
    students: { kid: { firstName: 'JEYDEN', middleName: 'JULIUS', lastName: 'SHIRIMA', admissionNumber: 'ADM-1', classLevel: 'Class 5', academicYear: 2026, schoolId: 'school-a', payments: copy(payments) } },
    enrollments: { 2026: { kid: { className: 'Class 5' } } },
    feesStructure: { 2026: { 'Class 5': { feePerYear: defaultFee, defaultPlanId: 'default-six' } } },
    installmentPlans: { 2026: { 'default-six': { name: 'Default Six', schedule: Array.from({ length: 6 }, (_, i) => ({ label: 'Default ' + i, from: `0${i + 1}-01`, to: `0${i + 1}-15`, amount: defaultFee / 6 })) }, '2-INSTALLMENT': { name: '2-INSTALLMENT', schedule } } },
    studentOverrides: { 2025: { closed: { feePerYear: 123 } }, 2026: { kid: { feePerYear: fee, planId: '2-INSTALLMENT', customSchedule: schedule, note: 'Keep this note', updatedAt: 1 } } },
    studentFees: { 2026: { kid: { feePerYear: fee } } },
    finance: { 2025: { closed: 'byte-for-byte' }, 2026: { studentFees: { kid: { feePerYear: fee } }, studentPlans: { kid: { planId: '2-INSTALLMENT' } }, studentCustomSchedules: { kid: { rows: schedule } } } },
    financeLedgers: { 2025: { old: { payment: 999 } }, 2026: { kid: copy(payments) } }
  };
  return { schools: { 'school-a': school, 'school-b': copy(school) } };
}
function harness(data = fixture()) {
  const reads = [], writes = []; let schoolId = 'school-a', failUpdate = false;
  let keyCounter = 0;
  const db = { ref(path = '') {
    const snap = () => ({ val: () => copy(getAt(data, path)), exists: () => getAt(data, path) != null });
    return {
      key: path.split('/').at(-1),
      push() { return db.ref(`${path}/test-${++keyCounter}`); },
      async set(value) { writes.push(path); putAt(data, path, value); },
      async once() { reads.push(path); return snap(); },
      async transaction(fn) {
        reads.push(path);
        const next = fn(copy(getAt(data, path)));
        if (next === undefined) return { committed: false, snapshot: snap() };
        writes.push(path); putAt(data, path, next); return { committed: true, snapshot: snap() };
      },
      async update(updates) {
        if (failUpdate) { failUpdate = false; throw new Error('Simulated write failure'); }
        for (const [key, value] of Object.entries(updates)) { const full = [path, key].filter(Boolean).join('/'); writes.push(full); putAt(data, full, value); }
      },
      on() {}, off() {}
    };
  } };
  const NativeDate = Date;
  class ClockDate extends NativeDate { constructor(...args) { super(...(args.length ? args : ['2026-09-06T12:00:00'])); } static now() { return new NativeDate('2026-09-06T12:00:00').getTime(); } }
  const scope = { console, Date: ClockDate, crypto: webcrypto, TextEncoder, db, setTimeout, clearTimeout, SOMAP: { getSchool: () => ({ id: schoolId }), P: path => `schools/${schoolId}/${path}` } };
  scope.window = scope;
  vm.createContext(scope);
  for (const file of ['js/finance_dedupe.js', 'shared/finance_math.js', 'js/special_plan_compliance.js']) vm.runInContext(fs.readFileSync(file, 'utf8'), scope, { filename: file });
  const api = scope.SomapSpecialPlans;
  api.setAuthorizer(async () => true);
  scope.normalizePath = value => String(value).replace(/^\/+/, '');
  scope.P = path => scope.SOMAP.P(path);
  scope.sref = path => db.ref(scope.P(path));
  scope.actorEmail = () => 'admin@test';
  scope.state = { selectedYear: '2026' };
  scope.getContextYear = () => '2026';
  scope.somapYearContext = { getSelectedYear: () => '2026' };
  const approvalSource = fs.readFileSync('Todashboardhtml/approvals.js', 'utf8');
  vm.runInContext(approvalSource.slice(approvalSource.indexOf('  async function commitFinanceConfig('), approvalSource.indexOf('  async function commitTransportPricingChange(')), scope);
  return { api, data, reads, writes, scope, school: () => data.schools[schoolId], switchSchool: id => { schoolId = id; }, failNextUpdate: () => { failUpdate = true; }, pending: () => Object.values(data.schools[schoolId].approvalsPending || {}) };
}
test('1 Gracious: timely payments retain discounted fee and two-instalment plan', async () => {
  const h = harness(fixture(timely(), 680000, 709000)); const original = copy(h.school());
  const counts = await h.api.review(2026);
  assert.equal(counts.compliant, 1); assert.equal(h.pending().length, 0); assert.deepEqual(h.school(), original);
});
test('2 Jeyden: late full settlement queues one proposal, no live change', async () => {
  const h = harness(); const original = copy(h.school());
  const result = await h.api.review(2026);
  assert.equal(result.breached, 1); assert.equal(result.queued, 1);
  const [record] = h.pending(); assert.equal(record.sourceModule, 'financeconfig');
  assert.equal(record.modulePayload.compliance.breaches.length, 2);
  for (const key of ['finance', 'studentOverrides', 'financeLedgers', 'students', 'feesStructure']) assert.deepEqual(h.school()[key], original[key]);
  assert.match(h.api.details(record), /Shortfall/); assert.match(await h.api.notice(2026, 'kid'), /awaiting approval/);
});
test('3 Approved: every payment preserved, class default restored, shared engine recalculates difference', async () => {
  const h = harness(fixture(late(), 844000, 890000)); const ledger = copy(h.school().financeLedgers); const students = copy(h.school().students);
  await h.api.review(2026); await h.api.decide(h.pending()[0], 'approved', 'admin@test');
  assert.equal(h.pending().length, 0); assert.deepEqual(h.school().financeLedgers, ledger); assert.deepEqual(h.school().students, students);
  assert.equal(h.school().studentOverrides[2026].kid.planId, undefined); assert.equal(h.school().studentOverrides[2026].kid.note, 'Keep this note');
  assert.equal(h.school().finance[2026].studentFees.kid, undefined); assert.equal(h.school().studentFees[2026].kid, undefined);
  // Reload through the exact pure builder used by the Finance data preparation.
  const s = h.school();
  const built = h.scope.SomapFinance.buildFinanceStudentsForCompliance(s.students, {}, s.enrollments[2026], s.feesStructure[2026], s.studentOverrides[2026], s.installmentPlans[2026], s.financeLedgers[2026], {}, s.studentFees[2026], {}, 2026);
  const finance = h.scope.SomapFinance.computeStudentFinancials(built.kid, 2026);
  assert.equal(finance.feePerYear, 890000); assert.equal(finance.paidAmount, 844000); assert.equal(finance.balance, 46000); assert.equal(finance.scheduleItems.length, 6);
  assert.match(await h.api.notice(2026, 'kid'), /after approval/);
  assert.equal(s.specialPlanCompliance[2026].kid.latest.by, 'admin@test');
});
test('4 Rejected: agreement unchanged and refresh does not requeue same breach', async () => {
  const h = harness(); const before = copy(h.school().studentOverrides);
  await h.api.review(2026); await h.api.decide(h.pending()[0], 'rejected', 'admin@test');
  await h.api.review(2026); assert.equal(h.pending().length, 0); assert.deepEqual(h.school().studentOverrides, before);
  assert.equal(h.school().specialPlanCompliance[2026].kid.latest.status, 'rejected');
});
test('Correcting one rejected deadline does not requeue the other already rejected breach', async () => {
  const h = harness(); await h.api.review(2026); await h.api.decide(h.pending()[0], 'rejected', 'admin@test');
  h.school().financeLedgers[2026].kid = { first: payment(420000, '2026-01-10'), second: payment(424000, '2026-07-31') };
  await h.api.review(2026); assert.equal(h.pending().length, 0);
});
test('5 Several partial payments before deadlines are compliant', async () => {
  const h = harness(fixture({ a: payment(100000, '2026-01-10'), b: payment(240000, '2026-01-15'), c: payment(140000, '2026-06-01'), d: payment(200000, '2026-07-15') }, 680000, 709000));
  assert.equal((await h.api.review(2026)).compliant, 1);
});
test('6 Partial and late, eventually cleared, is breached', async () => {
  const h = harness(fixture({ a: payment(340000, '2026-01-15'), b: payment(300000, '2026-07-15'), c: payment(40000, '2026-08-01') }, 680000, 709000));
  await h.api.review(2026); const [breach] = h.pending()[0].modulePayload.compliance.breaches;
  assert.equal(breach.deadline, '2026-07-15'); assert.equal(breach.shortfall, 40000);
});
test('7 Repeated and simultaneous reviews produce one pending request', async () => {
  const h = harness(); await Promise.all([h.api.review(2026), h.api.review(2026)]); await h.api.review(2026);
  assert.equal(h.pending().length, 1);
});
test('8 Closed years reject before any database access and remain identical', async () => {
  const h = harness(); const closed = copy(h.school().finance[2025]);
  await assert.rejects(h.api.review(2025), /2026/); assert.equal(h.reads.length, 0); assert.equal(h.writes.length, 0);
  await h.api.review(2026); await h.api.decide(h.pending()[0], 'approved', 'admin@test');
  assert.deepEqual(h.school().finance[2025], closed); assert.ok(h.reads.every(p => !p.includes('/2025'))); assert.ok(h.writes.every(p => !p.includes('/2025')));
});
test('9 Tenant isolation and cross-tenant approval rejection', async () => {
  const h = harness(); const other = copy(h.data.schools['school-b']); await h.api.review(2026); const record = h.pending()[0];
  assert.ok(h.reads.every(p => p.startsWith('schools/school-a/'))); assert.deepEqual(h.data.schools['school-b'], other);
  h.switchSchool('school-b'); await assert.rejects(h.api.decide(record, 'approved', 'admin@test'), /School/); assert.deepEqual(h.data.schools['school-b'], other);
});
test('10 New approved agreement after reversion remains configurable and can be reviewed', async () => {
  const h = harness(); await h.api.review(2026); await h.api.decide(h.pending()[0], 'approved', 'admin@test');
  // Execute the actual existing Finance Configuration commit handler.
  await h.scope.commitFinanceConfig({ sourceModule: 'financeconfig', forYear: 2026, modulePayload: {
    operations: [{ op: 'set', path: 'studentOverrides/2026/kid', value: { feePerYear: 844000, planId: '2-INSTALLMENT', customSchedule: rows(844000), updatedAt: 200 } }],
    historyEntries: [{ year: 2026, category: 'overrides', id: 'kid', action: 'update', before: null, after: { planId: '2-INSTALLMENT' } }]
  } }, 2026);
  assert.equal((await h.api.review(2026)).queued, 1);
});
test('Payment and paymentedits shared resolver sees class defaults after approval', async () => {
  const h = harness(fixture(late(), 844000, 890000));
  const module = fs.readFileSync('js/financeplans.js', 'utf8').replace('export default financePlansService;', '').replace(/^export /gm, '');
  vm.runInContext(`(function(){${module}\n})();`, h.scope);
  const before = await h.scope.financePlansService.resolveEffectiveFinance('kid', 'Class 5', { year: 2026 });
  assert.equal(before.fee, 844000); assert.equal(before.planId, '2-INSTALLMENT');
  await h.api.review(2026); await h.api.decide(h.pending()[0], 'approved', 'admin@test');
  h.scope.financePlansService.invalidateCache(2026);
  const after = await h.scope.financePlansService.resolveEffectiveFinance('kid', 'Class 5', { year: 2026 });
  assert.equal(after.fee, 890000); assert.equal(after.planId, 'default-six'); assert.equal(after.feeOverride, null); assert.equal(after.planOverride, null);
  assert.equal(await h.scope.financePlansService.getCustomSchedule('kid', { year: 2026 }), null);
});
test('A new missed deadline can be reviewed after rejecting the first breach', async () => {
  const h = harness(); const input = (await h.api.load(h.api.context(2026))).kid;
  const originalNow = h.scope.Date.now;
  h.scope.Date.now = () => new Date('2026-02-01T12:00:00').getTime();
  await h.api.review(2026); assert.equal(h.pending()[0].modulePayload.compliance.breaches.length, 1);
  await h.api.decide(h.pending()[0], 'rejected', 'admin@test');
  h.scope.Date.now = originalNow;
  assert.equal((await h.api.review(2026)).queued, 1); assert.equal(h.pending()[0].modulePayload.compliance.breaches.length, 2);
});
test('Existing carry allocation retained and malformed credits skipped', async () => {
  const h = harness(fixture(timely(), 680000, 709000));
  h.school().financeCarryForward = { 2026: { kid: { amount: 30000 } } };
  assert.equal((await h.api.review(2026)).compliant, 1);
  assert.equal(h.school().financeCarryForward[2026].kid.amount, 30000);
  h.school().financeCarryForward[2026].kid = { amount: -5000 };
  assert.equal((await h.api.review(2026)).skipped, 1);
});
test('Approved history fallback uses received date, never approval timestamp', async () => {
  const h = harness(fixture({}, 680000, 709000));
  h.school().approvalsHistory = { 2026: { '02': { p: { sourceModule: 'finance', studentId: 'kid', finalStatus: 'approved', forYear: 2026, amountPaidNow: 680000, datePaid: new Date('2026-01-10T12:00:00').getTime(), approvedAt: new Date('2026-02-01T12:00:00').getTime() } } } };
  assert.equal((await h.api.review(2026)).compliant, 1);
});
test('Pure-only helper loading leaves the Finance roster fallback inactive', () => {
  const scope = { document: { currentScript: { hasAttribute: name => name === 'data-compliance-only' } } };
  scope.window = scope; vm.createContext(scope);
  vm.runInContext(fs.readFileSync('shared/finance_math.js', 'utf8'), scope);
  assert.equal(scope.SomapFinance, undefined); assert.equal(typeof scope.SomapFinanceComplianceMath.computeStudentFinancials, 'function');
});
test('Stale agreement blocks approval; corrected backdated evidence blocks reversal', async () => {
  const h = harness(); await h.api.review(2026); const record = h.pending()[0];
  h.school().studentOverrides[2026].kid.updatedAt = 2;
  await assert.rejects(h.api.decide(record, 'approved', 'admin@test'), /Agreement or class changed/);
  h.school().studentOverrides[2026].kid.updatedAt = 1;
  h.school().financeLedgers[2026].kid = { a: payment(844000, '2026-01-10') };
  await assert.rejects(h.api.decide(record, 'approved', 'admin@test'), /no longer supports/);
  assert.equal(h.pending().length, 1);
});
test('Current class defaults, not stale proposed fee, are restored', async () => {
  const h = harness(); await h.api.review(2026);
  h.school().feesStructure[2026]['Class 5'].feePerYear = 900000;
  await h.api.decide(h.pending()[0], 'approved', 'admin@test');
  assert.equal(h.school().specialPlanCompliance[2026].kid.latest.after.feePerYear, 900000);
});
test('Pending/rejected/deleted/reversed payments do not count', async () => {
  for (const extra of [{ status: 'pending' }, { status: 'rejected' }, { deleted: true }, { reversed: true }, { approved: false }]) {
    const h = harness(fixture({ a: payment(680000, '2026-01-10', extra) }, 680000, 709000));
    assert.equal((await h.api.review(2026)).breached, 1);
  }
});
test('Deadline day is inclusive, no breach before the deadline expires', async () => {
  const h = harness(fixture({}, 680000, 709000)); const input = (await h.api.load(h.api.context(2026))).kid;
  assert.equal(h.api.evaluate(input, new Date(2026, 0, 15, 23, 59, 59, 999).getTime()).status, 'compliant');
  assert.equal(h.api.evaluate(input, new Date(2026, 0, 16).getTime()).status, 'breached');
});
test('Future academic years use their own deadlines without touching closed years', async () => {
  const data = JSON.parse(JSON.stringify(fixture()).replaceAll('2026', '2027'));
  for (const school of Object.values(data.schools)) for (const p of Object.values(school.financeLedgers[2027].kid)) {
    const date = new Date(p.timestamp); date.setFullYear(2027); p.timestamp = date.getTime();
  }
  const h = harness(data);
  assert.equal((await h.api.review(2027)).compliant, 1); assert.equal(h.pending().length, 0);
  h.scope.Date.now = () => new Date('2027-09-06T12:00:00').getTime();
  assert.equal((await h.api.review(2027)).queued, 1);
  assert.equal(h.pending()[0].forYear, 2027);
  assert.ok(h.writes.every(p => !p.includes('/2025/')));
});
test('Unknown payment dates, default-plan students, invalid schedule safely skipped', async () => {
  const h = harness(); h.school().financeLedgers[2026].kid.a.timestamp = 'bad date';
  assert.equal((await h.api.review(2026)).skipped, 1);
  const clean = harness(); clean.school().finance[2026].studentPlans.kid.planId = 'default-six';
  assert.equal((await clean.api.review(2026)).skipped, 1);
});
test('Inactive old custom schedule on a monthly plan is not treated as a special agreement', async () => {
  const h = harness();
  h.school().finance[2026].studentPlans.kid = { planId: 'monthly' };
  h.school().installmentPlans[2026].monthly = { name: 'Malipo kwa mwezi', schedule: [] };
  assert.equal((await h.api.review(2026)).skipped, 1); assert.equal(h.pending().length, 0);
});
test('Denied role cannot review or apply; failed commit preserves agreement and permits retry', async () => {
  const h = harness(); h.api.setAuthorizer(async () => false);
  await assert.rejects(h.api.review(2026), /administrator/); assert.equal(h.writes.length, 0);
  h.api.setAuthorizer(async () => true); await h.api.review(2026); const record = h.pending()[0];
  h.failNextUpdate(); await assert.rejects(h.api.decide(record, 'approved', 'admin@test'), /Simulated/);
  assert.equal(h.school().studentOverrides[2026].kid.planId, '2-INSTALLMENT'); assert.equal(h.pending().length, 1);
  await h.api.decide(record, 'approved', 'admin@test'); assert.equal(h.pending().length, 0);
});
