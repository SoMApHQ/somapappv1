// Offline browser smoke test: real approval preview/handlers, in-memory Firebase fixture.
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const http = require('node:http');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const source = fs.readFileSync('tests/special-plan-compliance.test.cjs', 'utf8');
const setup = source.slice(source.indexOf('const copy ='), source.indexOf('function harness('));
const fixture = vm.runInNewContext(setup + '\nfixture();');
const approvalSource = fs.readFileSync('Todashboardhtml/approvals.js', 'utf8');
const extract = (start, end) => approvalSource.slice(approvalSource.indexOf(start), approvalSource.indexOf(end));
const handlers = [
  extract('  function summarizeConfigValue(', '  const MONTH_LABELS'),
  extract('  function escapeHtml(', '  function formatMultiplierValue('),
  extract('  function buildFinanceConfigPreview(', '  function approveRecord('),
  extract('  function rejectSelectedRecord(', '  async function processApproval('),
  extract('  async function processApproval(', '  async function commitJoiningPayment(')
].join('\n');
const scripts = ['js/finance_dedupe.js', 'shared/finance_math.js', 'js/special_plan_compliance.js'].map(p => fs.readFileSync(p, 'utf8')).join('\n');
const html = `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Special plan offline verification</title>
<style>body{margin:0;background:#0f172a;color:#e2e8f0;font:15px system-ui}main{max-width:980px;margin:24px auto;padding:20px}button{padding:10px;margin:5px;border-radius:6px;cursor:pointer}table{width:100%;border-collapse:collapse}td,th{padding:12px;text-align:left;border:1px solid #475569}.overflow-x-auto{overflow:auto}.border{border:1px solid #64748b}.p-3{padding:12px}.my-3{margin:12px 0}p{overflow-wrap:anywhere}strong{color:#fbbf24}#result{padding:16px}h1{font-size:22px}</style>
<main><p>OFFLINE TEST FIXTURE — no production connection</p><h1>Finance Configuration — Special Plan Review</h1><button id="review">Review Special Plans</button><div id="queue"></div><div id="detail"></div><button id="approve">Approve</button><button id="reject">Reject</button><div id="result"></div></main>
<script>
${setup}
let data = ${JSON.stringify(fixture)};
const SOMAP = window.SOMAP = { getSchool:()=>({id:'school-a'}), P:p=>'schools/school-a/'+p };
const db = window.db = { ref(path='') { const snap=()=>({val:()=>copy(getAt(data,path))}); return {
  once:async()=>snap(), transaction:async fn=>{const value=fn(copy(getAt(data,path)));if(value===undefined)return {committed:false,snapshot:snap()};putAt(data,path,value);return {committed:true,snapshot:snap()};},
  update:async updates=>{for(const [key,value] of Object.entries(updates))putAt(data,[path,key].filter(Boolean).join('/'),value);}
};}};
${scripts}
const CONFIG_STYLE_MODULES=new Set(['financeconfig']);
const formatCurrency=n=>'TSh '+Number(n).toLocaleString('en-US');
const state={selectedRecord:null};
const actorEmail=()=> 'offline-admin@test';
const resolveSchoolId=()=> 'school-a';
const hideDetailModal=()=>{};
const toast=message=>document.getElementById('result').textContent=message;
const loadSummaries=async()=>{};
const Swal={fire:async()=>({isConfirmed:true})};
${handlers}
SomapSpecialPlans.setAuthorizer(async()=>true);
const initial=JSON.stringify(data);
window.reset=()=>{data=JSON.parse(initial);document.getElementById('detail').innerHTML='';document.getElementById('result').textContent='';};
document.getElementById('review').onclick=async()=>{
 await SomapSpecialPlans.review(2026);
 state.selectedRecord=Object.values(data.schools['school-a'].approvalsPending||{})[0];
 document.getElementById('queue').textContent=state.selectedRecord?.configSummary||'No pending special-plan changes';
 document.getElementById('detail').innerHTML=state.selectedRecord?buildFinanceConfigPreview(state.selectedRecord):'';
};
document.getElementById('approve').onclick=async()=>{try{await processApproval(state.selectedRecord);document.getElementById('detail').innerHTML=await SomapSpecialPlans.notice(2026,'kid');}catch(e){toast('ERROR: '+e.message);}};
document.getElementById('reject').onclick=()=>rejectSelectedRecord();
window.testState=()=>({pending:Object.keys(data.schools['school-a'].approvalsPending||{}).length,plan:data.schools['school-a'].studentOverrides[2026].kid.planId,ledger:JSON.stringify(data.schools['school-a'].financeLedgers),decision:data.schools['school-a'].specialPlanCompliance?.[2026]?.kid.latest?.status});
window.ready=true;
</script>`;
async function main() {
  const server = http.createServer((req, res) => { res.setHeader('Content-Type', 'text/html; charset=utf-8'); res.end(html); });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const output = fs.mkdtempSync(path.join(os.tmpdir(), 'somap-special-plan-browser-'));
  const chrome = process.env.CHROME_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
  const child = spawn(chrome, ['--headless=new', '--disable-gpu', '--no-first-run', '--remote-debugging-port=0', '--user-data-dir=' + path.join(output, 'profile'), 'about:blank'], { windowsHide: true, stdio: 'ignore' });
  let socket;
  try {
    const portFile = path.join(output, 'profile', 'DevToolsActivePort');
    for (let i = 0; i < 80 && !fs.existsSync(portFile); i++) await new Promise(r => setTimeout(r, 100));
    const port = fs.readFileSync(portFile, 'utf8').split('\n')[0];
    console.log('Offline browser started. Connecting to debugger.');
    const targets = await (await fetch(`http://127.0.0.1:${port}/json`, { signal: AbortSignal.timeout(5000) })).json();
    socket = new WebSocket(targets.find(t => t.type === 'page').webSocketDebuggerUrl);
    await new Promise((resolve, reject) => { const timer = setTimeout(() => reject(new Error('Debugger socket timeout')), 10000); socket.addEventListener('open', () => { clearTimeout(timer); resolve(); }, { once: true }); socket.addEventListener('error', reject, { once: true }); });
    let id = 0; const pending = new Map();
    socket.addEventListener('message', event => { const m = JSON.parse(event.data); if (!m.id) return; const callback = pending.get(m.id); pending.delete(m.id); m.error ? callback.reject(m.error) : callback.resolve(m.result); });
    const call = (method, params = {}) => new Promise((resolve, reject) => { const timer = setTimeout(() => reject(new Error('Debugger timeout: ' + method)), 15000); pending.set(++id, { resolve: value => { clearTimeout(timer); resolve(value); }, reject: error => { clearTimeout(timer); reject(error); } }); socket.send(JSON.stringify({ id, method, params })); });
    const evaluate = async expression => { const r = await call('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }); if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails)); return r.result.value; };
    await call('Page.navigate', { url: `http://127.0.0.1:${server.address().port}` });
    for (let i = 0; i < 80 && !(await evaluate('!!window.ready')); i++) await new Promise(r => setTimeout(r, 100));
    assert.equal(await evaluate('!!window.ready'), true);
    console.log('Offline fixture loaded. Reviewing agreement.');
    await evaluate("document.getElementById('review').onclick()");
    assert.equal((await evaluate('testState()')).pending, 1);
    assert.match(await evaluate("document.getElementById('detail').textContent"), /Required.*Paid by deadline.*Shortfall/s);
    for (const width of [1440, 390]) {
      await call('Emulation.setDeviceMetricsOverride', { width, height: 1100, deviceScaleFactor: 1, mobile: width < 500 });
      assert.equal(await evaluate('document.documentElement.scrollWidth <= innerWidth'), true);
      const shot = await call('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true });
      fs.writeFileSync(path.join(output, `review-${width}.png`), Buffer.from(shot.data, 'base64'));
    }
    const ledger = (await evaluate('testState()')).ledger;
    await evaluate("document.getElementById('approve').onclick()");
    const approved = await evaluate('testState()');
    assert.equal(approved.decision, 'approved'); assert.equal(approved.pending, 0); assert.equal(approved.ledger, ledger);
    assert.match(await evaluate("document.getElementById('detail').textContent"), /after approval/);
    await evaluate("reset(); document.getElementById('review').onclick()");
    await evaluate("document.getElementById('reject').click()");
    for (let i = 0; i < 80 && (await evaluate('testState().decision')) !== 'rejected'; i++) await new Promise(r => setTimeout(r, 50));
    assert.equal((await evaluate('testState()')).decision, 'rejected');
    await evaluate("document.getElementById('review').onclick()");
    const rejected = await evaluate('testState()');
    assert.equal(rejected.pending, 0); assert.equal(rejected.plan, '2-INSTALLMENT'); assert.equal(rejected.ledger, ledger);
    console.log(JSON.stringify({ result: 'PASS', cases: ['desktop preview', 'mobile preview without page overflow', 'actual approval handler', 'actual rejection handler', 'no requeue after rejection', 'ledger preservation'], screenshots: output }, null, 2));
    await call('Browser.close');
  } finally { socket?.close(); child.kill(); server.close(); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
