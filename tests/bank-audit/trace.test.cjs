const fs=require('fs'),vm=require('vm'),assert=require('node:assert/strict'),{test}=require('node:test');
global.window=global;
for(const n of ['crdb','engine','storage','trace'])vm.runInThisContext(fs.readFileSync(`Tojs/bank-audit/bank_audit_${n}.js`,'utf8'));
// Real accountTransactionHistory (6).pdf (CRDB, 01.10.2026-21.10.2026).
const C=SomapCrdb,E=SomapBankAuditEngine,S=SomapBankAuditStorage,T=SomapBankAuditTrace,fixture=require('./fixtures/october-pdfjs-items.json');
let columns;const pages=fixture.pages.map(p=>{const e=C.extractPage(p.items,p.viewport,columns);columns=e.columns;return e;});
const parsed=C.parseExtractedPages(pages),audit=E.analyze(parsed.rows,{meta:parsed.meta});
audit.statementPeriodFrom='2026-10-01';audit.statementPeriodTo='2026-10-21';
const MUSSA='MUSSA FARAJI MVUNGI',ts=s=>new Date(s+'T10:00:00').getTime();

// RTDB rejects a whole write for any key with . # $ / [ ] or an empty key, and for undefined / NaN values.
function assertRtdbSafe(v,path='root'){
  if(v===undefined)assert.fail(`undefined at ${path}`);
  if(typeof v==='number')assert.ok(Number.isFinite(v),`non-finite at ${path}`);
  if(v&&typeof v==='object')for(const [k,x] of Object.entries(v)){assert.ok(k!==''&&!/[.#$/[\]]/.test(k),`bad key "${k}" at ${path}`);assertRtdbSafe(x,`${path}.${k}`);}
}
test('audit with "Tuition fee." purpose label encodes to RTDB-safe keys and decodes back exactly',()=>{
  const a={...audit,purposeSuggestions:[{labels:{'Tuition fee.':2,'a/b':1,'':1,'$x#[y]':1},count:4}],categoryTotals:{'Transport / Usafiri':5},bad:NaN,gone:undefined,list:[1,undefined,Infinity]};
  const enc=S.encodeForDb(a);
  assertRtdbSafe(enc);
  const dec=S.decodeFromDb(enc);
  assert.deepEqual(dec.purposeSuggestions[0].labels,{'Tuition fee.':2,'a/b':1,'':1,'$x#[y]':1});
  assert.equal(dec.categoryTotals['Transport / Usafiri'],5);
  assert.equal(dec.bad,null);assert.equal('gone' in dec,false);assert.deepEqual(dec.list,[1,null,null]);
  assert.equal(dec.transactions.length,audit.transactions.length);
});
test('records saved with the old categoryTotals-only encoding still decode',()=>{
  assert.deepEqual(S.decodeFromDb({categoryTotals:{'Transport __47__ Usafiri':1}}).categoryTotals,{'Transport / Usafiri':1});
});

test('recipients: returned transfer excluded, phones collected',()=>{
  const m=T.recipients(audit).find(r=>r.key===MUSSA);
  assert.equal(m.count,28);assert.equal(m.principal,1315000);assert.equal(m.returned,29000);assert.deepEqual(m.phones,['0756877887']);
});
test('related: one-word and run-together names are pre-ticked, unrelated people are not offered',()=>{
  const list=[...T.recipients(audit),{key:'MUSSAFUELS',name:'MUSSAFUELS',tokens:['MUSSAFUELS'],phones:[],channels:[],count:1,principal:1},
    {key:'MUSSA MVUNGI',name:'MUSSA MVUNGI',tokens:['MUSSA','MVUNGI'],phones:['0689649822'],channels:[],count:1,principal:1},
    {key:'JOHN DOE',name:'JOHN DOE',tokens:['JOHN','DOE'],phones:['0756877887'],channels:[],count:1,principal:1},
    {key:'ALLY FARAJI',name:'ALLY FARAJI',tokens:['ALLY','FARAJI'],phones:[],channels:[],count:1,principal:1}];
  const rel=Object.fromEntries(T.related(list,MUSSA).map(r=>[r.key,r]));
  assert.equal(rel.MUSSA.strong,true);assert.equal(rel.MUSSAFUELS.strong,true);assert.equal(rel['MUSSA MVUNGI'].strong,true);
  assert.equal(rel['JOHN DOE'].strong,true);assert.match(rel['JOHN DOE'].reason,/same number/);
  assert.equal(rel['ALLY FARAJI'].strong,false);
  assert.equal(rel['REHEMA MLEKWA'],undefined);
});
test('expense date: description date beats entry date; implausible dates fall back',()=>{
  assert.equal(T.expenseDate({description:'16/04-fuel fura evening ,morning 17/04(54000)+5000',timestamp:ts('2026-04-21')}).date,'2026-04-16');
  assert.equal(T.expenseDate({description:'7-may jion na asubuhi',timestamp:ts('2026-05-08')}).date,'2026-05-07');
  assert.equal(T.expenseDate({description:'furas car 4-may',timestamp:ts('2026-05-08')}).date,'2026-05-04');
  assert.equal(T.expenseDate({description:'28/12-fuel',timestamp:ts('2027-01-03')}).date,'2026-12-28');
  assert.equal(T.expenseDate({description:'yasins van',timestamp:ts('2026-05-08')}).source,'entry date');
  assert.equal(T.expenseDate({description:'25/12 fuel',timestamp:ts('2026-05-08')}).date,'2026-05-08');
});
test('trace build: totals, paid-back deposit, transport comparison, back-dated and pending entries',()=>{
  const transport={expenses:[{category:'FUEL',amount:90000,description:'02/10-fuel both vans',timestamp:ts('2026-10-05')},
    {category:'REPAIRS',amount:55000,description:'7-oct wishbone',timestamp:ts('2026-10-09')},
    {category:'OTHER',amount:5000,description:'28/09-food',timestamp:ts('2026-10-02')},
    {category:'FUEL',amount:99000,description:'fuel',timestamp:ts('2026-11-02')}],
    pending:[{module:'transport',status:'pending',amount:20000,description:'15/10 fuel',requestedAt:ts('2026-10-16')}],warnings:[]};
  const r=T.build(audit,{subjectKeys:[MUSSA,'MUSSA'],otherKeys:['REHEMA MLEKWA'],transport});
  assert.equal(r.subject.count,29);assert.equal(r.subject.principal,1360000);
  assert.equal(r.subject.mobile,1315000);assert.equal(r.subject.bank,45000);
  assert.equal(r.subject.returned.length,1);assert.equal(r.subject.paidBackTotal,250000);
  assert.equal(r.subject.events.at(-1).running,1360000);
  assert.equal(r.includedPrincipal,1465000);
  assert.equal(r.transport.total,145000);assert.equal(r.transport.backdatedTotal,5000);assert.equal(r.transport.pendingTotal,20000);
  // Unexplained = withdrawn - expenses - paid back; the bank-returned 29,000 is never in "withdrawn".
  assert.equal(r.beforePaidBack,1320000);assert.equal(r.unexplained,1070000);
  assert.deepEqual(r.transport.tail,{from:'2026-10-08',to:'2026-10-21',days:14});
  assert.equal(r.months.length,1);assert.equal(r.months[0].paidBack,250000);assert.equal(r.months[0].gap,1070000);
  assert.equal(r.weeks.reduce((n,w)=>n+w.gap,0),1070000);
  assert.equal(r.weeks.reduce((n,w)=>n+w.withdrawn,0),1465000);
  assert.equal(r.weekdays.reduce((n,d)=>n+d.count,0),29);
});
test('no expenses written: whole period is the gap, everything not paid back is unexplained',()=>{
  const r=T.build(audit,{subjectKeys:[MUSSA],transport:{expenses:[],pending:[]}});
  assert.equal(r.unexplained,r.subject.principal-250000);assert.deepEqual(r.transport.tail,{from:'2026-10-01',to:'2026-10-21',days:21});
});
