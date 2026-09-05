// Local isolated preview harness (no Firebase writes): loads the production analyzer UI
// and PDF generator directly with real-fixture-derived audits, one for the actual original
// CRDB PDF and one for the actual accountTransactionHistory (5).xls, and captures screenshots
// plus the generated PDF reports. Modeled on browser-preview.cjs from the prior PDF repair.
const fs=require('fs'),http=require('http'),path=require('path'),{spawn}=require('child_process');
const root=process.cwd(), out=path.join(root,'tests/bank-audit/evidence/repair-2026-09-05');
fs.mkdirSync(out,{recursive:true});

let html=fs.readFileSync('Tofinancehtml/bank-audit-analyzer.html','utf8').replace(/<script[\s\S]*?<\/script>/g,'').replaceAll('../images/','/images/');
let ui=fs.readFileSync('Tojs/bank-audit/bank_audit_ui.js','utf8');
ui=ui.slice(0,ui.indexOf('  document.addEventListener("DOMContentLoaded"'))+`global.renderPreview=(audit)=>{state.readOnly=true;renderAudit(audit);bindTabs();};})(window);`;
const script=['crdb','engine','xls'].map(n=>fs.readFileSync(`Tojs/bank-audit/bank_audit_${n}.js`,'utf8')).join('\n');
const pdfCode=fs.readFileSync('Tojs/bank-audit/bank_audit_pdf.js','utf8');

const pdfItems=JSON.parse(fs.readFileSync('tests/bank-audit/fixtures/september-pdfjs-items.json','utf8'));
const xlsRows=JSON.parse(fs.readFileSync('tests/bank-audit/fixtures/september-xls-rows.json','utf8'));

function buildHtml(auditBuilderExpr, schoolLabel, statusLabel) {
  return html.replace('</body>',`<script>${script}\n${ui}\n${pdfCode}\n${auditBuilderExpr}\nrenderPreview(audit);document.getElementById('schoolName').textContent=${JSON.stringify(schoolLabel)};document.getElementById('parseStatus').textContent=${JSON.stringify(statusLabel)};document.getElementById('userRole').textContent='Test';</script></body>`);
}

const pdfBuilder = `
const fixture = ${JSON.stringify(pdfItems)};
let columns;
const pages = fixture.pages.map(p => { const extracted = SomapCrdb.extractPage(p.items, p.viewport, columns); columns = extracted.columns; return {...extracted, page:p.page, rotation:p.rotate}; });
const parsed = SomapCrdb.parseExtractedPages(pages);
window.audit = {...SomapBankAuditEngine.analyze(parsed.rows,{meta:parsed.meta}), bankName:'CRDB', schoolName:'SOCRATES INVESTMENT LIMITED', uploadedFileName:'accountTransactionHistory (3)(2).pdf', statementPeriodFrom:'2026-09-01', statementPeriodTo:'2026-09-03', sourceType:'pdf', parserMeta:parsed.meta};
`;
const xlsBuilder = `
const rows = ${JSON.stringify(xlsRows)};
const parsed = SomapXls.parseRows(rows, 'xls');
window.audit = {...SomapBankAuditEngine.analyze(parsed.rows,{meta:parsed.meta}), bankName:'CRDB', schoolName:'SOCRATES INVESTMENT LIMITED', uploadedFileName:'accountTransactionHistory (5).xls', statementPeriodFrom:'2026-09-01', statementPeriodTo:'2026-09-05', sourceType:'xls', parserMeta:parsed.meta};
`;

let currentHtml = '';
const server=http.createServer((req,res)=>{
  if(req.url==='/'){res.setHeader('Content-Type','text/html; charset=utf-8');res.end(currentHtml);return;}
  const p=path.resolve(root,'.'+req.url);
  if(!p.startsWith(root+path.sep)){res.writeHead(403).end();return;}
  fs.readFile(p,(e,b)=>{if(e)res.writeHead(404).end();else res.end(b);});
});

async function withBrowser(fn) {
  await new Promise(r=>server.listen(8766,'127.0.0.1',r));
  const edge=spawn('C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',['--headless=new','--disable-gpu','--no-first-run','--remote-debugging-port=9224','--user-data-dir='+path.join(out,'browser-profile'),'about:blank'],{windowsHide:true,stdio:'ignore'});
  let target;
  for(let i=0;i<40;i++){try{target=(await(await fetch('http://127.0.0.1:9224/json')).json()).find(t=>t.type==='page' && !t.url.startsWith('chrome-extension:'));if(target)break;}catch{}await new Promise(r=>setTimeout(r,250));}
  if(!target)throw Error('Browser did not start');
  const ws=new WebSocket(target.webSocketDebuggerUrl);
  await new Promise(r=>ws.addEventListener('open',r,{once:true}));
  let id=0;const pending=new Map();
  ws.addEventListener('message',e=>{const m=JSON.parse(e.data);if(m.id){const pair=pending.get(m.id);pending.delete(m.id);m.error?pair[1](m.error):pair[0](m.result);}});
  const call=(method,params={})=>new Promise((resolve,reject)=>{pending.set(++id,[resolve,reject]);ws.send(JSON.stringify({id,method,params}));});
  try { await fn(call); }
  finally { await call('Browser.close').catch(()=>{}); ws.close(); server.close(); edge.kill(); }
}

async function capture(call, builderExpr, schoolLabel, statusLabel, prefix) {
  currentHtml = buildHtml(builderExpr, schoolLabel, statusLabel);
  await call('Emulation.setDeviceMetricsOverride',{width:1440,height:1200,deviceScaleFactor:1,mobile:false});
  await call('Page.navigate',{url:'http://127.0.0.1:8766/'});
  for(let i=0;i<40;i++){const r=await call('Runtime.evaluate',{expression:'!!window.audit'});if(r.result.value)break;await new Promise(r=>setTimeout(r,100));}
  for(const tab of ['summary','income','withdrawals','review']){
    await call('Runtime.evaluate',{expression:`document.querySelector('[data-tab="${tab}"]').click()`});
    const shot=await call('Page.captureScreenshot',{format:'png',captureBeyondViewport:true});
    fs.writeFileSync(path.join(out,`${prefix}-${tab}.png`),Buffer.from(shot.data,'base64'));
  }
  const pdfResult = await call('Runtime.evaluate',{expression:`(async()=>{for(const src of ['https://cdn.jsdelivr.net/npm/jspdf@2.5.1/dist/jspdf.umd.min.js','https://cdn.jsdelivr.net/npm/jspdf-autotable@3.8.2/dist/jspdf.plugin.autotable.min.js'])await new Promise((resolve,reject)=>{const s=document.createElement('script');s.src=src;s.onload=resolve;s.onerror=reject;document.head.appendChild(s)});const doc=await SomapBankAuditPdf.createDocument(audit);return {pdf:doc.output('datauristring').split(',')[1],pages:doc.getNumberOfPages()};})()`,awaitPromise:true,returnByValue:true});
  if(pdfResult.exceptionDetails)throw Error(JSON.stringify(pdfResult.exceptionDetails));
  fs.writeFileSync(path.join(out,`${prefix}-report.pdf`),Buffer.from(pdfResult.result.value.pdf,'base64'));
  await call('Runtime.evaluate',{expression:`(async()=>{await new Promise((resolve,reject)=>{const s=document.createElement('script');s.src='https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js';s.onload=resolve;s.onerror=reject;document.head.appendChild(s)});pdfjsLib.GlobalWorkerOptions.workerSrc='https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';const doc=await SomapBankAuditPdf.createDocument(audit);window.renderedPdf=await pdfjsLib.getDocument({data:new Uint8Array(doc.output('arraybuffer')),useSystemFonts:false,disableFontFace:true,standardFontDataUrl:'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/standard_fonts/'}).promise;})()`,awaitPromise:true});
  const totalPages = pdfResult.result.value.pages;
  for(let start=1;start<=totalPages;start+=12){
    const result=await call('Runtime.evaluate',{expression:`(async()=>{const canvas=document.createElement('canvas');canvas.width=1200;canvas.height=1720;const ctx=canvas.getContext('2d');ctx.fillStyle='white';ctx.fillRect(0,0,canvas.width,canvas.height);for(let n=`+start+`;n<Math.min(`+(start+12)+`,renderedPdf.numPages+1);n++){const p=await renderedPdf.getPage(n),v=p.getViewport({scale:0.48}),c=document.createElement('canvas');c.width=v.width;c.height=v.height;await p.render({canvasContext:c.getContext('2d'),viewport:v}).promise;const i=n-`+start+`,x=(i%4)*300,y=Math.floor(i/4)*570;ctx.drawImage(c,x,y);ctx.fillStyle='black';ctx.font='16px sans-serif';ctx.fillText('Page '+n,x+10,y+425);}return canvas.toDataURL('image/png').split(',')[1];})()`,awaitPromise:true,returnByValue:true});
    if(result.exceptionDetails)throw Error(JSON.stringify(result.exceptionDetails));
    fs.writeFileSync(path.join(out,`${prefix}-pdf-pages-${start}.png`),Buffer.from(result.result.value,'base64'));
  }
  console.log(`[${prefix}] saved tabs + ${totalPages}-page report to ${out}`);
  return totalPages;
}

(async()=>{
  await withBrowser(async call => {
    await capture(call, pdfBuilder, 'SOCRATES INVESTMENT LIMITED', 'CRDB PDF detected. Using CRDB PDF transaction parser.', 'pdf');
    await capture(call, xlsBuilder, 'SOCRATES INVESTMENT LIMITED', 'Excel statement detected. Reading structured worksheet columns.', 'xls');
  });
})().catch(e=>{console.error(e);server.close();process.exitCode=1;});
