const fs = require('fs');
const vm = require('vm');
const assert = require('node:assert/strict');
const {test} = require('node:test');
global.window = global;
for (const f of ['crdb', 'engine', 'xls']) vm.runInThisContext(fs.readFileSync(`Tojs/bank-audit/bank_audit_${f}.js`, 'utf8'));
const X = SomapXls, E = SomapBankAuditEngine;
// Real accountTransactionHistory (5).xls, read once via SheetJS (header:1) and stored as
// rows-of-arrays so this suite runs without an xlsx node devDependency, exactly the way
// actual-crdb.test.cjs replays pre-extracted pdf.js items instead of depending on pdfjs-dist.
const rows = JSON.parse(fs.readFileSync('tests/bank-audit/fixtures/september-xls-rows.json', 'utf8'));

const parsed = X.parseRows(rows, 'xls');
const audit = E.analyze(parsed.rows, {meta: parsed.meta});

test('locates the real header row and reads statement metadata, not header rows as transactions', () => {
  assert.equal(parsed.meta.headerRowIndex, 12);
  assert.equal(parsed.meta.statement.accountName, 'SOCRATES INVESTMENT LIMITED');
  assert.equal(parsed.meta.statement.accountNumber, '10431586897');
  assert.equal(parsed.meta.statement.availableBalance, 104841.28);
  assert.equal(parsed.meta.statement.totalCredits, 552400);
  assert.equal(parsed.meta.statement.totalDebits, 449700.02);
  assert.equal(parsed.meta.statement.bookBalance, -83400.01);
  assert.equal(parsed.meta.statement.clearedBalance, -83400.01);
  assert.ok(parsed.rows.every(r => !r.description.includes('Total Value') && !r.description.includes('Summary')));
});

test('exact acceptance totals for accountTransactionHistory (5).xls', () => {
  assert.equal(parsed.rows.length, 37);
  assert.equal(audit.totals.creditsCount, 16);
  assert.equal(audit.totals.debitsCount, 21);
  assert.equal(audit.totals.totalDeposits, 552400);
  assert.equal(audit.totals.totalWithdrawals, 449700.02);
  assert.equal(audit.totals.netMovement, 102699.98);
  assert.equal(audit.validation.valid, true, JSON.stringify(audit.validation));
  assert.equal(parsed.meta.diagnostics.length, 0);
});

test('narration parser is reused unchanged: bank/AB references, sender, class, purpose survive', () => {
  const first = audit.income[0];
  assert.equal(first.bankReference, '1a05cc6285a25b33');
  assert.equal(first.paymentReference, 'AB17882628850752276675');
  assert.equal(first.sender, 'ZEBEDAYO DODO TATIAYA');
  assert.equal(first.detectedStudentName, 'Suhailathatibu Kimeza');
  assert.equal(first.writtenPurpose, 'Usafiri');
  assert.equal(first.category, 'Transport / Usafiri');

  const remedial = audit.income.find(t => t.paymentReference === 'AB17883339746205188493');
  assert.equal(remedial.detectedStudentName, 'Elia Elichilia');
  assert.equal(remedial.extractedClass, 'Standard 4');
  assert.equal(remedial.writtenPurpose, 'Remidial');
  assert.equal(remedial.category, 'Remedial');

  const giana = audit.income.find(t => t.paymentReference === 'AB17884225540595287590');
  assert.equal(giana.detectedStudentName, 'Giana');
  assert.equal(giana.writtenPurpose, 'Usafiri');
  assert.equal(giana.category, 'Transport / Usafiri');
  assert.equal(giana.moneyIn, 13600);
  assert.equal(giana.date, '2026-09-03');
});

test('grouped withdrawals: 7 events, three-line MPESA groups split principal from charges', () => {
  assert.equal(audit.withdrawalEvents.length, 7);
  assert.ok(audit.withdrawalEvents.every(w => w.rawLines.length === 3 && w.recipient === 'MUSSA FARAJI MVUNGI' && w.recipientAccount === '0756877887'));
  const byDate = (date, time) => audit.withdrawalEvents.find(w => w.date === date && w.postingTime === time);
  assert.equal(byDate('2026-09-03', '17:44:00').amountWithdrawn, 37000);
  assert.equal(byDate('2026-09-03', '17:47:00').amountWithdrawn, 90000);
  assert.equal(byDate('2026-09-04', '19:05:00').amountWithdrawn, 58000);
});

test('dates normalize to DD.MM.YYYY / HH:mm:ss on raw rows and years never become money', () => {
  assert.ok(parsed.rows.every(r => /^\d{2}\.\d{2}\.\d{4}$/.test(r.date)));
  assert.ok(parsed.rows.every(r => /^\d{2}:\d{2}:\d{2}$/.test(r.postingTime)));
  assert.ok(parsed.rows.every(r => Number.isFinite(r.moneyIn) && Number.isFinite(r.moneyOut)));
  assert.ok(!parsed.rows.some(r => r.moneyIn === 2026 || r.moneyOut === 2026));
});

test('date/time cell parser supports ISO, serial and bare forms in addition to the real DD.MM.YYYY HH:mm:ss cells', () => {
  assert.deepEqual(X.parseDateTimeCell('01.09.2026 14:41:00'), {date: '01.09.2026', time: '14:41:00'});
  assert.deepEqual(X.parseDateTimeCell('2026-09-01T14:41:00'), {date: '01.09.2026', time: '14:41:00'});
  assert.deepEqual(X.parseDateTimeCell(new Date(2026, 8, 1, 14, 41, 0)), {date: '01.09.2026', time: '14:41:00'});
  const serial = X.parseDateTimeCell(46266.611805555556);
  assert.equal(serial.date, '01.09.2026');
});

test('blank rows and repeated table headers are ignored, not parsed as transactions', () => {
  const withNoise = rows.slice(0, 13)
    .concat([['', '', '', '', '', '']])
    .concat(rows.slice(13, 20))
    .concat([['Posting Date', 'Details', 'Value Date', 'Debit', 'Credit', 'Book Balance']])
    .concat(rows.slice(20));
  const result = X.parseRows(withNoise, 'xls');
  assert.equal(result.rows.length, 37);
});

test('validation fails and reports diagnostics when the header table cannot be located', () => {
  const noHeader = X.parseRows(rows.slice(0, 12), 'xls');
  assert.equal(noHeader.rows.length, 0);
  assert.ok(noHeader.meta.diagnostics[0].includes('Posting Date'));
});

test('source-aware validate() skips PDF-only accounting-block checks for the xls parser version', () => {
  assert.notEqual(parsed.meta.parserVersion, SomapCrdb.VERSION);
  assert.equal(audit.parserVersion, parsed.meta.parserVersion);
});
