const fs = require('fs');
const vm = require('vm');
const assert = require('node:assert/strict');
const {test} = require('node:test');
global.window = global;
for(const f of ['crdb','engine','parser']) vm.runInThisContext(fs.readFileSync(`Tojs/bank-audit/bank_audit_${f}.js`,'utf8'));
const C = SomapCrdb, E = SomapBankAuditEngine;
// Reconstructed from the user's acceptance specification; NOT the missing original PDF.
const deposits = [
['01','14:41','17882628850752276675','Suhailathatibu\nkimeza','Usafiri',54000],
['01','17:34','17882732519515287110','Kijanga Adam','Deposits',32800],
['01','21:08','17882861353738343114','Abgael Charles Mahona','Cash',33000],
['01','22:10','17882898277293658161','Nasreen','School bus',33000],
['02','08:39','17883275705711086962','Silivesta Samson','Transport fee',40000],
['02','08:41','17883276666612150912','Gifti\nFrank','Transport fee',40000],
['02','10:26','17883339746205188493','Elia Elichilia\nstd 4','Remidial',18000],
['02','11:28','17883377040434461860','Bright Shayo','Cash',18000],
['02','11:51','17883390834989722544','Nathan','Deposi\nts',56000],
['02','13:17','17883442741626561048','Iiqram Ibrahim','Transport',40000],
['02','13:22','17883445223734530299','Salha Ibrahim','Transport',40000],
['02','17:19','17883587896361972270','Sheilla','Dep',15000],
['02','19:40','17883672173881915810','GraciousShedr\nack','For School Bus',25000],
['02','21:03','17883721997034605449','Gilian Hasasansimba','Usafiri',54000],
['03','00:26','17883843687195587836','Dep','DP',40000]
];
const events = deposits.map((d,i)=>({day:d[0],time:d[1],ref:`credit${i}`,detail:`AGENCY FT\nFROM ANNA EMILY LUKUMAY TO\nSOCRATES\nAB${d[2]}:${d[3]}:${d[4]} N/A`,credit:d[5],debit:0}));
[['01','15:45','1a05d011fddcfaac',[305.09,1694.92,49000]],['01','18:27','1a05d94e7b93b868',[244.07,1355.93,35000]],['02','14:18','1a061d7d0bffa81f',[305.09,1694.92,45000]],['02','15:42','1a06224a8ac44bcd',[533.90,2966.10,120000]]].forEach(([day,time,ref,amounts])=>amounts.forEach(debit=>events.push({day,time,ref,detail:'IB FT TO MPESA\n0756877887 MUSSA FARAJI MVUNGI',credit:0,debit})));
events.sort((a,b)=>(a.day+a.time).localeCompare(b.day+b.time));
let balance=2141.30;
const blocks=events.map(e=>{balance=C.round(balance+e.credit-e.debit); if(e.time==='17:19')balance=C.round(balance-319341.29); return `${e.day}.09.2026\n${e.time}:00\nREF:${e.ref} ${e.detail}\n${e.day}.09.2026\n00:00:00\n${e.debit.toFixed(2)} ${e.credit.toFixed(2)} ${balance.toFixed(2)}`;});
const text=`SOCRATES INVESTMENT LIMITED\nAccount: 10431586897\nAvailable Balance: 282,841.28 TZS\nPeriod: Current Month\nTotal Value for Credit: 538,800.00 TZS\nTotal Value for Debit: 258,100.02 TZS\nSummary of Book Balance as at 03/09/2026 : -36,500.01 TZS\nSummary of Cleared Balance as at 03/09/2026 : -36,500.01 TZS\nAccount Bank Statement\n03/09/2026 09:42:27\nPosting Date Details Value Date Debit Credit Book Balance\n${blocks.join('\n')}`;
const parsed=C.parsePages([text]), audit=E.analyze(parsed.rows,{meta:parsed.meta});
test('dates and years cannot become money',()=>{for(const s of ['2026','01.09.2026','03/09/2026','2026-09-03','01.09.'])assert.ok(Number.isNaN(C.amount(s)));assert.equal(E.parseMoney('2026'),0);});
test('strict calendar dates never roll or fall back',()=>{for(const s of ['31.02.2026','00.00.0000','01.09.','2026','30 November 1999'])assert.equal(E.parseDate(s),null);assert.equal(E.parseDate('2026-09-01').getDate(),1);});
test('all 27 bank lines with correct accounting totals',()=>{assert.equal(parsed.rows.length,27);assert.equal(audit.totals.creditsCount,15);assert.equal(audit.totals.debitsCount,12);assert.equal(audit.totals.totalDeposits,538800);assert.equal(audit.totals.totalWithdrawals,258100.02);assert.equal(audit.totals.netMovement,280699.98);assert.equal(audit.validation.valid,true);});
test('headers stay metadata',()=>{assert.equal(audit.statement.accountName,'SOCRATES INVESTMENT LIMITED');assert.equal(audit.statement.accountNumber,'10431586897');assert.equal(audit.statement.availableBalance,282841.28);assert.equal(audit.statement.bookBalance,-36500.01);assert.ok(audit.transactions.every(t=>!t.description.includes('Summary')));});
test('multiline names, class, purposes and both references retained',()=>{assert.equal(audit.income[0].detectedStudentName,'Suhailathatibu Kimeza');assert.equal(audit.income[6].extractedClass,'Standard 4');assert.equal(audit.income[8].writtenPurpose,'Deposits');assert.equal(audit.income[12].detectedStudentName,'Gracious Shedrack');assert.equal(audit.income[6].paymentReference,'AB17883339746205188493');assert.equal(audit.income[6].bankReference,'credit6');assert.ok(audit.income[0].rawNarration.includes('\n'));});
test('category acceptance totals and ambiguous fees',()=>{assert.equal(audit.categoryTotals['Transport / Usafiri'],326000);assert.equal(audit.categoryTotals.Remedial,18000);assert.equal(audit.categoryTotals['Unknown income'],194800);assert.equal(audit.categoryTotals.Graduation||0,0);for(const p of ['Cash','Deposit','Deposits','Dep','DP','Ada','Fee','Tuition','Save','Kuweka',''])assert.equal(C.category(p),'Unknown income');});
test('12 debit lines group into four events with principal and charges',()=>{assert.equal(audit.withdrawalEvents.length,4);assert.equal(audit.totals.groupedEventCount,19);assert.equal(audit.totals.totalPrincipal,249000);assert.equal(audit.totals.totalCharges,9100.02);assert.ok(audit.withdrawalEvents.every(w=>w.rawLines.length===3&&w.recipient==='MUSSA FARAJI MVUNGI'));assert.ok(!audit.expenses.some(t=>t.reviewFlags.some(f=>f.includes('Weekend'))));});
test('opening balance and discontinuity derived without direction changes',()=>{assert.equal(audit.totals.openingBalance,2141.3);assert.equal(audit.discontinuities.length,1);assert.equal(audit.discontinuities[0].difference,-319341.29);assert.equal(audit.discontinuities[0].expected,163841.28);assert.equal(audit.discontinuities[0].displayed,-155500.01);});
test('missing, corrupt and contradictory rows fail validation',()=>{assert.equal(C.validate([] ,parsed.meta).valid,false);const bad=C.parsePages([text.replace('54000.00','2026')]);assert.equal(C.validate(bad.rows,bad.meta).valid,false);assert.equal(C.validate([{date:'01.09.2026',moneyIn:1,moneyOut:1}],{}).valid,false);});
test('grouping requires identical time and recipient',()=>{const rows=parsed.rows.filter(r=>r.moneyOut>0).slice(0,3).map(r=>({...r}));rows[1].postingTime='15:46:00';assert.equal(E.analyze(rows).withdrawalEvents.length,2);});
fs.writeFileSync('tests/bank-audit/reconstructed-september.txt',text);
test('coordinate columns reconstruct complete rows independent of PDF item order',()=>{
  const item=(str,x,y)=>({str,transform:[1,0,0,1,x,y]});
  const items=[item('Posting Date',10,800),item('Details',100,800),item('Value Date',300,800),item('Debit',390,800),item('Credit',450,800),item('Book Balance',510,800),item('01.09.2026',10,770),item('14:41:00',10,755),item('REF:abc123 AGENCY FT',100,770),item('FROM ANNA TO SOCRATES',100,755),item('AB123:Child:Usafiri N/A',100,740),item('01.09.2026',300,770),item('00:00:00',300,755),item('0.00',390,755),item('54,000.00',450,755),item('56,141.3',510,755)];
  const result=C.parsePages([C.logicalPage(items.reverse())]);assert.equal(result.rows.length,1);assert.equal(result.rows[0].moneyIn,54000);assert.equal(result.rows[0].balance,56141.3);
});
test('value time and three amounts on a single extracted line',()=>{const result=C.parsePages([blocks[0].replace('00:00:00\n','00:00:00 ')]);assert.equal(result.rows.length,1);assert.equal(result.rows[0].moneyIn,54000);});
test('reparse versions preserve prior results and do not add a statement',async()=>{
  let record={id:'saved',totals:{totalDeposits:1658},statementFile:{driveFileId:'original'},parserVersion:'bank-audit-v1'};
  global.firebase={auth:()=>({currentUser:{uid:'reviewer',email:'reviewer@example.test'}}),database:()=>({ref:()=>({push:()=>({key:'version2'}),transaction:async fn=>{record=fn(record);return {committed:true,snapshot:{val:()=>record}};}})})};
  global.localStorage={getItem:()=>null};
  vm.runInThisContext(fs.readFileSync('Tojs/bank-audit/bank_audit_storage.js','utf8'));
  const saved=await SomapBankAuditStorage.reparseAudit('saved',audit,'2026');assert.equal(saved.id,'saved');assert.equal(saved.statementFile.driveFileId,'original');assert.equal(saved.history.version2.totals.totalDeposits,1658);assert.equal(saved.totals.totalDeposits,538800);assert.equal(saved.reparsedBy.uid,'reviewer');
  await assert.rejects(()=>SomapBankAuditStorage.reparseAudit('saved',{validation:{valid:false}},'2026'));
  assert.equal(saved.categoryTotals['Transport / Usafiri'],326000);
  assert.ok(Object.keys(record.categoryTotals).every(k=>!/[.#$\[\]/]/.test(k)),'categoryTotals keys written to Firebase must not contain RTDB-forbidden characters (./ #$[])');
});
test('PDF uses readable font sizes, complete cards, repeated headings and page footers',async()=>{
  const tables=[];let pages=1,footerCount=0;
  class Doc {constructor(){this.internal={pageSize:{getWidth:()=>595,getHeight:()=>842}};this.lastAutoTable={finalY:100};}setFillColor(){}rect(){}setTextColor(){}setFontSize(){}text(text){if(String(text).includes('Confidential'))footerCount++;}addPage(){pages++;}autoTable(options){tables.push(options);this.lastAutoTable.finalY=100;}getNumberOfPages(){return pages;}setPage(){}}
  global.jspdf={jsPDF:Doc};global.fetch=async()=>({ok:false});
  vm.runInThisContext(fs.readFileSync('Tojs/bank-audit/bank_audit_pdf.js','utf8'));
  await SomapBankAuditPdf.createDocument(audit);
  assert.ok(tables.every(t=>t.styles.fontSize>=9&&t.headStyles.fontSize>=9&&t.showHead==='everyPage'));
  for(const t of audit.transactions)assert.ok(tables.some(table=>JSON.stringify(table.body).includes(t.bankReference)));
  assert.equal(footerCount,pages);await assert.rejects(()=>SomapBankAuditPdf.createDocument({validation:{valid:false}}));
});
