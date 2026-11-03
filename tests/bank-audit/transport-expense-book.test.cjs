const fs=require('fs'),vm=require('vm'),assert=require('node:assert/strict'),{test}=require('node:test');
global.window=global;
vm.runInThisContext(fs.readFileSync('transporthtml/modules/transport_expense_book.js','utf8'));
const B=SomapTransportExpenseBook;
const fakeDb=(data)=>({ref:(p)=>({once:async()=>({val:()=>p.split('/').reduce((o,k)=>o&&o[k],data)??null})})});
const ts=s=>new Date(s+'T10:00:00').getTime();

const ledger={
  a:{category:'FUEL',amount:44500,description:'08/05-fuel both vans',timestamp:ts('2026-05-08'),year:2026,approvalId:'q1'},
  b:{category:'MAINTENANCE',amount:113000,description:'yasins van',timestamp:ts('2026-05-08'),year:2026},
  old:{category:'FUEL',amount:9000,description:'2025 entry',timestamp:ts('2025-11-01'),year:2025}
};
const data={years:{2026:{expenseApprovals:{
  q1:{module:'transport',status:'approved',amount:44500,description:'08/05-fuel both vans',targetPayload:{amount:44500,description:'08/05-fuel both vans',timestamp:ts('2026-05-08')}},
  q2:{module:'transport',status:'approved',amount:113000,description:'yasins van',recordedPath:'schools/socrates-school/years/2026/transport_expenses/b',targetPayload:{amount:113000,description:'yasins van'}},
  q3:{module:'transport',status:'approved',amount:90000,description:'13/10-fuel both van',requestedBy:'ssclass52023@gmail.com',approvedBy:'mnyorej@gmail.com',targetPayload:{category:'FUEL',amount:90000,description:'13/10-fuel both van',timestamp:ts('2026-10-15'),addedBy:'ssclass52023@gmail.com'}},
  q4:{module:'transport',status:'pending',amount:20000,description:'pending fuel'},
  q5:{module:'transport',status:'rejected',amount:50000,description:'rejected'},
  q6:{module:'finance',status:'approved',category:'TRANSPORT',amount:135000,description:'FUEL SCHOOL BUS'}
}}},expenses:{2026:{
  f1:{category:'TRANSPORT',amount:135000,description:'FUEL SCHOOL BUS',date:'2026-10-28'},
  f2:{category:'Usafiri',amount:40000,description:'bus repair',date:'2026-10-20'},
  f3:{category:'SALARY',amount:500000,description:'teacher pay',date:'2026-10-20'}
}}};

test('ledger + missing approvals + Finance transport expenses, nothing counted twice',async()=>{
  const book=await B.collect({db:fakeDb(data),year:2026,ledger});
  assert.deepEqual(book.counts,{transport:2,approval:1,finance:2});
  assert.deepEqual(book.totals,{transport:157500,approval:90000,finance:175000});
  const q3=book.rows.find(r=>r.approvalId==='q3');
  assert.equal(q3.source,'approval');assert.equal(q3.category,'FUEL');assert.equal(q3.timestamp,ts('2026-10-15'));assert.equal(q3.addedBy,'ssclass52023@gmail.com');
  assert.ok(!book.rows.some(r=>/SALARY|pending|rejected|2025/.test(`${r.category} ${r.description}`)));
  assert.equal(book.rows.find(r=>r.id==='finance_f1').timestamp,new Date('2026-10-28T00:00:00').getTime());
});
test('approval matched only by description, amount and timestamp is not added again',async()=>{
  const book=await B.collect({db:fakeDb({years:{2026:{expenseApprovals:{x:{module:'transport',status:'approved',targetPayload:{amount:5000,description:'Fare',timestamp:7}}}}}}),year:2026,
    ledger:{k:{amount:5000,description:'fare ',timestamp:7,year:2026}}});
  assert.equal(book.counts.approval,0);
});
test('unreadable paths become warnings, not failures',async()=>{
  const db={ref:(p)=>({once:async()=>{throw new Error('permission_denied');}})};
  const book=await B.collect({db,year:2026,ledger});
  assert.equal(book.counts.transport,2);assert.equal(book.warnings.length,2);
});
