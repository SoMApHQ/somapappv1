const fs=require('fs'),vm=require('vm'),assert=require('node:assert/strict'),{test}=require('node:test');
global.window=global;
for(const n of ['crdb','engine'])vm.runInThisContext(fs.readFileSync(`Tojs/bank-audit/bank_audit_${n}.js`,'utf8'));
// Real accountTransactionHistory (6).pdf (CRDB, 01.10.2026-21.10.2026), pdf.js 3.11.174 items captured headlessly.
const C=SomapCrdb,E=SomapBankAuditEngine,fixture=require('./fixtures/october-pdfjs-items.json');
function extract(pages){let columns;return pages.map(p=>{const e=C.extractPage(p.items,p.viewport,columns);columns=e.columns;return e;});}
const pages=extract(fixture.pages),parsed=C.parseExtractedPages(pages),audit=E.analyze(parsed.rows,{meta:parsed.meta});

test('October statement passes strict header validation including non-REF bank charges',()=>{
  assert.equal(audit.validation.valid,true,JSON.stringify(audit.validation.errors));
  assert.equal(audit.totals.totalDeposits,1712500);
  assert.equal(audit.totals.totalWithdrawals,1634589.72);
  assert.equal(audit.transactions.at(-1).balance,177531.83);
  assert.equal(audit.statement.bookBalance,177531.83);
  assert.deepEqual(parsed.meta.counts,{postingDateCandidates:169,postingTimeCandidates:169,refBlocks:167,accountingRows:169,validTransactions:169,rejectedBlocks:0,nonRefRows:2,nonRefDebitTotal:4999.66,nonRefCreditTotal:0,zeroValueRows:0});
});
test('both independent extraction paths recover the two charge rows',()=>{
  for(const get of [p=>p.itemLines,p=>p.logicalLines]){const r=C.parsePages(pages.map(p=>get(p).join('\n')));assert.equal(C.validate(r.rows,r.meta).valid,true);assert.equal(r.rows.length,169);}
  const charges=audit.transactions.filter(t=>t.bankChargeRow);
  assert.deepEqual(charges.map(t=>[t.description,t.moneyOut,t.balance,t.category]),[['Debit Arrangement Tax',762.66,480758.88,'Bank charge'],['Charge - Capitalise Maintenance Fee AA26189KPLJH',4237,476521.88,'Bank charge']]);
  assert.equal(audit.totals.bankCharges,4999.66);
  assert.ok(audit.withdrawalEvents.every(g=>!g.rawLines.some(t=>t.bankChargeRow)));
});
test('running balance reconciles; same-day bank posting order is noted, not a discontinuity',()=>{
  assert.equal(audit.discontinuities.length,0);
  assert.equal(audit.postingOrderNotes.length,3);
  assert.ok(audit.postingOrderNotes.every(n=>n.date==='2026-10-13'));
});
test('AB reference without a preceding space keeps name and purpose',()=>{
  const t=audit.income.find(t=>t.paymentReference==='AB17908713911675853994');
  assert.equal(t.writtenPurpose,'Graduation');assert.equal(t.category,'Graduation');
});
test('misspelt purposes map to existing categories; transfer reversal and owner flags',()=>{
  for(const p of ['Grqduation','Gradution','Graduatin','Gradu ation'])assert.equal(C.category(p),'Graduation',p);
  assert.equal(C.category('Remidial'),'Remedial');
  assert.equal(audit.categoryTotals.Graduation,620000);
  assert.equal(audit.categoryTotals['Transfer reversal'],30000);
  const simapp=audit.income.find(t=>/Uhamishaji/.test(t.description));
  assert.equal(simapp.category,'Unknown income');assert.ok(simapp.reviewFlags.some(f=>/owner \/ internal/.test(f)));
  const loan=audit.transactions.find(t=>t.moneyOut===45000&&/Loan/.test(t.description));
  assert.ok(loan.reviewFlags.some(f=>/loan/i.test(f)));
  assert.notEqual(audit.transactions.find(t=>t.moneyOut>0&&/REHEMA/.test(t.description)).category,'Transport / Usafiri');
});
test('new purpose suggestions, then Yes / Merge / No decisions reclassify',()=>{
  const pre=audit.purposeSuggestions.find(s=>s.label==='Pre form one');
  assert.equal(pre.count,4);assert.equal(pre.total,55000);
  assert.ok(audit.purposeSuggestions.find(s=>s.label==='Kuweka').variants.includes('Kuwek a'));
  const config={categories:{a:{name:'Pre Form One'}},aliases:{preformone:{category:'Pre Form One',label:'Pre form one'},dp:{category:'Transport / Usafiri',label:'Dp'}},rejectedLabels:{cash:{label:'Cash'}}};
  const again=E.applyPurposes(JSON.parse(JSON.stringify(audit)),config);
  assert.equal(again.categoryTotals['Pre Form One'],55000);
  assert.equal(again.categoryTotals['Transport / Usafiri'],363000+65000);
  assert.ok(!again.purposeSuggestions.some(s=>['Pre form one','Cash','Dp'].includes(s.label)));
  assert.equal(C.category('Pre-Form one',config),'Pre Form One');
  assert.equal(C.category('Cash',config),'Unknown income');
  assert.equal(C.category('Pre Form One',{...config,categories:{}}),'Unknown income','deleted category falls back');
});
