(function (global) {
  'use strict';
  const VERSION = 'crdb-block-v4';
  const round = n => Math.round(n * 100) / 100;
  const dateToken = /^\d{2}[./]\d{2}[./]\d{4}$/;
  const timeToken = /^(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d$/;
  function date(value) {
    if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
    if (typeof value === 'number' && value > 20000 && value < 80000) return new Date(Math.round((value - 25569) * 86400000));
    const s = String(value || '').trim();
    let m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!m) {
      const local = s.match(/^(\d{2})[./](\d{2})[./](\d{4})$/);
      if (local) m = [local[0], local[3], local[2], local[1]];
    }
    if (!m) return null;
    const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
    return d.getFullYear() === +m[1] && d.getMonth() === +m[2] - 1 && d.getDate() === +m[3] ? d : null;
  }
  function amount(value, accountingPosition = false) {
    const s = String(value).trim();
    if (!accountingPosition && /^(?:19|20)\d{2}$/.test(s)) return NaN;
    return /^-?(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d{1,2})?$/.test(s) ? Number(s.replace(/,/g, '')) : NaN;
  }
  function header(text) {
    const get = pattern => (text.match(pattern) || [])[1] || '';
    const num = label => { const s = get(new RegExp(label + '\\s*:\\s*(-?[\\d,]+\\.\\d{1,2})', 'i')); return s ? amount(s) : null; };
    return {
      accountName: get(/(?:^|\n)([^\n]+)\s*\nAccount\s*:/i).trim(),
      accountNumber: get(/Account\s*:\s*(\d+)/i), availableBalance: num('Available Balance'),
      period: get(/Period\s*:\s*([^\n]+)/i), totalCredits: num('Total Value for Credit'), totalDebits: num('Total Value for Debit'),
      bookBalance: num('Summary of Book Balance as at [\\d/]+'), clearedBalance: num('Summary of Cleared Balance as at [\\d/]+'),
      generatedAt: get(/Account Bank Statement\s*\n(\d{2}\/\d{2}\/\d{4}\s+\d{2}:\d{2}:\d{2})/i)
    };
  }
  function narration(lines) {
    const raw = lines.join('\n');
    // Preserve line breaks in the evidence; repair only known split words in the display.
    const text = lines.join(' ').replace(/Deposi\s+ts/gi, 'Deposits').replace(/Shedr\s+ack/gi, 'Shedrack').replace(/Scho\s+olbus/gi, 'Schoolbus').replace(/([a-z])([A-Z])/g, '$1 $2');
    // CRDB sometimes prints "SOCRATESAB179…:" with no space, so AB cannot rely on a word boundary.
    const payment = text.match(/(?:\b|(?<=[A-Z]))(AB\d{6,})\s*:\s*([^:]*)(?::\s*(.*))?/i);
    let name = (payment?.[2] || '').trim();
    const cls = name.match(/\b(?:std|standard|class)\s*(\d+)/i);
    name = name.replace(/\b(?:std|standard|class)\s*\d+/i, '').trim();
    const purpose = (payment?.[3] || '').replace(/\s*N\/A\s*$/i, '').trim();
    const recipient = text.match(/\bTO\s+(?:MPESA|AIRTEL|TIGOPESA|HALOPESA)\s+(\d+)\s+(.+?)(?=\s+AB\d|$)/i);
    return { rawNarration: raw, description: text, bankReference: (text.match(/REF\s*:\s*([a-z0-9]+)/i) || [])[1] || '',
      paymentReference: payment?.[1] || '', detectedStudentName: name.toLowerCase().replace(/\b\w/g, c => c.toUpperCase()),
      extractedClass: cls ? `Standard ${cls[1]}` : '', writtenPurpose: purpose,
      sender: (text.match(/\bFROM\s+(.+?)\s+TO\b/i) || [])[1] || '', recipient: recipient?.[2] || '', recipientAccount: recipient?.[1] || '',
      transactionType: (text.match(/REF\s*:\s*\w+\s+(IB\s+FT\s+TO\s+(?:MPESA|AIRTEL|TIGOPESA|HALOPESA)|.*?)(?=\s+FROM|\s+\d{7,}|$)/i) || [])[1] || '' };
  }
﻿  function normalizeLines(text) {
    const result = [];
    String(text).replace(/[\f\u0000]/g, '\n').replace(/\u00a0/g, ' ').split(/\r?\n/).forEach(line => {
      let rest = line.trim();
      // Separate date/time anchors only at a line's beginning. Never split narration numbers.
      while (rest) {
        const anchor = rest.match(/^(\d{2}[./]\d{2}[./]\d{4}|\d{2}:\d{2}:\d{2})(?=\s|$)/);
        if (!anchor) { result.push(rest); break; }
        result.push(anchor[1]); rest = rest.slice(anchor[0].length).trim();
      }
    });
    return result;
  }
  const isRef = s => /^REF\s*:/i.test(s || '');
  const isAmountLine = s => String(s).split(/\s+/).every(t => Number.isFinite(amount(t, true)));
  // Narration text: anything that is not a date, time or accounting-amount line.
  const isNarration = s => !!s && !dateToken.test(s) && !timeToken.test(s) && !isAmountLine(s);
  // REF rows may use either date style; non-REF rows must use the dotted CRDB row date, which
  // keeps the slash-dated "generated at" header stamp from looking like a row.
  const isPostingAnchor = (lines, i) => dateToken.test(lines[i]) && timeToken.test(lines[i+1] || '') &&
    (isRef(lines[i+2]) || /^\d{2}\.\d{2}\.\d{4}$/.test(lines[i]) && isNarration(lines[i+2]));
  function parsePages(pages) {
    const text = pages.map(p => typeof p === 'string' ? p : p.text).join('\n');
    const lines = normalizeLines(text), rows = [], rejected = [], visitedRefs = new Set();
    // Rows are anchored on posting date + time + narration. Most CRDB rows start with REF:,
    // but bank charges (e.g. "Debit Arrangement Tax", "Charge - Capitalise Maintenance Fee") carry none.
    const counts = {
      postingDateCandidates: lines.filter((s,i) => isPostingAnchor(lines,i)).length,
      postingTimeCandidates: lines.filter((s,i) => i > 0 && isPostingAnchor(lines,i-1)).length,
      refBlocks: lines.filter(isRef).length,
      accountingRows: 0, validTransactions: 0, rejectedBlocks: 0,
      nonRefRows: 0, nonRefDebitTotal: 0, nonRefCreditTotal: 0, zeroValueRows: 0
    };
    function reject(start, refLine, reason, stop) {
      rejected.push({ line: start + 1, refLine: refLine + 1, reason, lines: lines.slice(start, Math.min(stop + 1, start + 30)) });
    }
    for (let i=0; i<lines.length; i++) {
      if (!isPostingAnchor(lines,i)) continue;
      const start=i, posting=lines[i], postingTime=lines[i+1], refLine=i+2, hasRef=isRef(lines[refLine]);
      // An incomplete REF block is a rejection. An incomplete non-REF candidate (e.g. the
      // "generated at" stamp) is simply not a transaction; missed real charges still fail the header totals.
      const fail = (reason, stop) => { if (hasRef) reject(start,refLine,reason,stop); };
      if (hasRef) visitedRefs.add(refLine);
      let cursor=refLine+1;
      while (cursor<lines.length && !dateToken.test(lines[cursor]) && !isRef(lines[cursor])) cursor++;
      const details=lines.slice(refLine,cursor), valueDate=lines[cursor], valueTime=lines[cursor+1];
      if (!date(posting)) { fail('Invalid posting date',cursor); continue; }
      if (!date(valueDate) || !timeToken.test(valueTime || '') || isRef(lines[cursor+2])) {
        fail('Value date/time and accounting section not found before next transaction',cursor+2); continue;
      }
      cursor+=2;
      const tokens=[];
      while(cursor<lines.length && tokens.length<3) {
        if (dateToken.test(lines[cursor]) || timeToken.test(lines[cursor]) || isRef(lines[cursor])) break;
        const next=lines[cursor].split(/\s+/);
        if(next.some(t => !Number.isFinite(amount(t,true)))) break;
        tokens.push(...next); cursor++;
      }
      const values=tokens.map(t=>amount(t,true));
      if (tokens.length!==3) { fail(`Accounting section must contain exactly three amounts; found ${tokens.length}`,cursor); continue; }
      if (values[0]<0 || values[1]<0 || (values[0]>0 && values[1]>0)) { fail('Debit and credit must be non-negative, with at most one positive side',cursor); continue; }
      const detail=narration(details);
      if (hasRef && !detail.bankReference) { fail('Bank reference missing',cursor); continue; }
      counts.accountingRows++;
      // Zero-value rows are kept as evidence; analysis excludes them from totals and grouping.
      const zeroValue = !values[0] && !values[1];
      if (zeroValue) counts.zeroValueRows++;
      if (!hasRef) { counts.nonRefRows++; counts.nonRefDebitTotal=round(counts.nonRefDebitTotal+values[0]); counts.nonRefCreditTotal=round(counts.nonRefCreditTotal+values[1]); }
      rows.push({...detail,date:posting,postingTime,valueDate,valueTime,moneyOut:values[0],moneyIn:values[1],balance:values[2],sourceType:'pdf',sourceRow:rows.length+1,sourceLine:start+1,accountingColumnsExplicit:true,nonRef:!hasRef,zeroValue});
      i=cursor-1;
    }
    lines.forEach((line,index) => { if (isRef(line) && !visitedRefs.has(index)) reject(Math.max(0,index-2),index,'REF block has no valid preceding posting date/time',index+3); });
    counts.validTransactions=rows.length; counts.rejectedBlocks=rejected.length;
    const statement=header(text);
    const meta={parserVersion:VERSION,statement,diagnostics:rejected.map(r=>`Line ${r.line}: ${r.reason}`),rejectedBlocks:rejected,counts,rawRows:rows.length,pageCount:pages.length};
    return {rows,meta,extractedText:text,normalizedLines:lines,sourceType:'pdf'};
  }
  function joinItems(items) {
    return items.reduce((text,item,i) => {
      const previous=items[i-1];
      const gap=previous ? item.x-previous.x-previous.width : 0;
      return text+(i && gap>1 && !/\s$/.test(text) && !/^\s/.test(item.str) ? ' ' : '')+item.str;
    },'').trim();
  }
  function extractPage(items, viewportTransform, inheritedColumns) {
    // PDF coordinates are bottom-up and may be rotated. Viewport coordinates are displayed top-down.
    const v=viewportTransform || [1,0,0,-1,0,0];
    const positioned=items.map((item,index) => ({index,str:item.str || '',rawX:item.transform?.[4] || 0,rawY:item.transform?.[5] || 0,
      x:v[0]*(item.transform?.[4] || 0)+v[2]*(item.transform?.[5] || 0)+v[4],
      y:v[1]*(item.transform?.[4] || 0)+v[3]*(item.transform?.[5] || 0)+v[5],
      width:item.width || 0,height:item.height || 0,hasEOL:!!item.hasEOL}));
    const visual=[];
    positioned.filter(i=>i.str.trim()).sort((a,b)=>a.y-b.y || a.x-b.x).forEach(item=>{
      let line=visual[visual.length-1];
      if(!line || Math.abs(line.y-item.y)>2) visual.push(line={y:item.y,items:[]});
      line.items.push(item);
    });
    visual.forEach((line,i)=>{line.items.sort((a,b)=>a.x-b.x);line.text=joinItems(line.items);line.number=i+1;line.items.forEach(item=>item.visualLine=i+1);});
    const heading=visual.find(l=>/Posting\s*Date/.test(l.text) && /Book\s*Balance/.test(l.text));
    let columns=inheritedColumns;
    if(heading) {
      const find=re=>heading.items.find(i=>re.test(i.str));
      const posting=find(/^Posting/),details=find(/^Details/),value=find(/^Value/),debit=find(/^Debit/),credit=find(/^Credit/),book=find(/^Book/);
      if(posting&&details&&value&&debit&&credit&&book) columns=[posting.width ? posting.x+posting.width+5 : details.x-5,value.x-5,debit.x-5,credit.x-5,book.x-5];
    }
    const sourceLines=[]; let sourceLine='';
    positioned.forEach(item=>{
      // PDF.js content-stream order is preserved as an independent fallback, including hasEOL.
      sourceLine+=item.str;
      if(item.hasEOL){if(sourceLine.trim())sourceLines.push(sourceLine.trim());sourceLine='';}
    });
    if(sourceLine.trim())sourceLines.push(sourceLine.trim());
    // Items without reliable EOL still have a usable content-stream token sequence.
    const itemLines=positioned.map(i=>i.str.trim()).filter(Boolean);
    let logicalLines=[];
    if(columns) {
      const body=visual.filter(l=>!heading || l.y>heading.y);
      const column=item=>{const n=columns.findIndex(x=>item.x<x);return n<0?5:n;};
      logicalLines=(heading ? visual.filter(l=>l.y<=heading.y) : []).map(l=>l.text);
      // A row starts at its REF line, or at a second posting date inside the current row:
      // CRDB bank-charge rows have no REF and their posting date sits above the narration.
      const blocks=[];let current=null;
      body.forEach(line=>{
        const ref=line.items.some(i=>/^REF\s*:/i.test(i.str));
        const posting=line.items.some(i=>column(i)===0 && dateToken.test(i.str.trim()));
        const adoptsRef=ref && current && !current.ref && !current.detail;
        if(ref && !adoptsRef || posting && (!current || current.posting)) blocks.push(current={lines:[],ref:false,posting:false,detail:false});
        if(!current) return;
        current.lines.push(line);
        current.ref=current.ref || ref; current.posting=current.posting || posting;
        current.detail=current.detail || line.items.some(i=>column(i)===1);
      });
      blocks.forEach(block=>{
        const cols=Array.from({length:6},()=>[]);
        block.lines.forEach(line=>{
          const parts=Array.from({length:6},()=>[]);
          line.items.forEach(item=>parts[column(item)].push(item));
          parts.forEach((items,n)=>{if(items.length)cols[n].push(n===1?joinItems(items):items.map(i=>i.str).join('').trim());});
        });
        logicalLines.push(...cols.flat());
      });
    }
    return {items:positioned,visualLines:visual.map(l=>({number:l.number,y:l.y,text:l.text,itemIndices:l.items.map(i=>i.index)})),sourceLines,itemLines,logicalLines,columns};
  }
  function logicalPage(items, viewportTransform) {
    const page=extractPage(items,viewportTransform);
    return (page.logicalLines.length?page.logicalLines:page.visualLines.map(l=>l.text)).join('\n');
  }
  function parseExtractedPages(pages) {
    const candidates=[['content-stream',p=>p.sourceLines],['content-items',p=>p.itemLines],['visual-columns',p=>p.logicalLines]]
      .map(([strategy,get])=>({strategy,result:parsePages(pages.map(p=>get(p).join('\n')))}));
    candidates.forEach(c=>{c.validation=validate(c.result.rows,c.result.meta);});
    candidates.sort((a,b)=>Number(b.validation.valid)-Number(a.validation.valid) || b.result.rows.length-a.result.rows.length || a.result.meta.diagnostics.length-b.result.meta.diagnostics.length);
    const chosen=candidates[0];
    // A valid alternative may recover reading order, but conflicting complete parses require review.
    const signature=c=>JSON.stringify(c.result.rows.map(r=>[r.date,r.postingTime,r.bankReference,r.moneyOut,r.moneyIn,r.balance]));
    if(candidates.some(c=>c.validation.valid && chosen.validation.valid && signature(c)!==signature(chosen))) chosen.result.meta.diagnostics.push('Different complete extraction paths disagree; inspect PDF diagnostics.');
    chosen.result.meta.extractionStrategy=chosen.strategy;
    chosen.result.meta.extractionAttempts=candidates.map(c=>({strategy:c.strategy,counts:c.result.meta.counts,errors:c.validation.errors}));
    chosen.result.extraction={pages,normalizedLines:chosen.result.normalizedLines,rejectedBlocks:chosen.result.meta.rejectedBlocks};
    return chosen.result;
  }

  // Built-in income purposes. School-defined purposes come from `config`:
  // { categories: {id: {name}}, aliases: {labelKey: {category, label}}, rejectedLabels: {labelKey: {label}} }.
  const BUILTIN_PURPOSES = [
    ['Transport / Usafiri', /\b(usafiri?|usafii|transport|school\s*bus)\b/, ['usafiri', 'transport', 'schoolbus']],
    ['Remedial', /\b(remedial|remidial|remidio|rimidio|rimedio|remijio|remigial)\b/, ['remedial']],
    ['Graduation', /\b(graduation|graduat\w*|mahafali)\b/, ['graduation', 'mahafali']]
  ];
  const BUILTIN_NAMES = BUILTIN_PURPOSES.map(p => p[0]);
  // RTDB-safe comparison key: "Pre form one", "PreForm One" and "pre-form one" all become "preformone".
  function purposeKey(label) { return String(label || '').toLowerCase().replace(/[^a-z0-9]+/g, ''); }
  function editDistance(a, b) {
    let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
    for (let i = 1; i <= a.length; i++) {
      const row = [i];
      for (let j = 1; j <= b.length; j++) row[j] = Math.min(prev[j] + 1, row[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = row;
    }
    return prev[b.length];
  }
  // Short labels need exact matches: "dep"/"dp" or "fee"/"fees" must not drift into other purposes.
  function fuzzyLimit(a, b) { const n = Math.min(a.length, b.length); return n >= 6 ? 2 : n >= 4 ? 1 : 0; }
  function similarPurpose(a, b) { return a === b || editDistance(a, b) <= fuzzyLimit(a, b); }
  function purposeNames(config) {
    return [...BUILTIN_NAMES, ...Object.values(config?.categories || {}).map(c => c?.name).filter(Boolean)];
  }
  function category(purpose, config) {
    const p = String(purpose || '').toLowerCase().replace(/\s+/g, ' ').trim();
    for (const [name, pattern] of BUILTIN_PURPOSES) if (pattern.test(p)) return name;
    const key = purposeKey(p);
    if (!key) return 'Unknown income';
    const names = purposeNames(config);
    const candidates = [];
    BUILTIN_PURPOSES.forEach(([name, , aliases]) => aliases.forEach(alias => candidates.push([alias, name])));
    names.forEach(name => candidates.push([purposeKey(name), name]));
    Object.entries(config?.aliases || {}).forEach(([alias, value]) => {
      const name = typeof value === 'string' ? value : value?.category;
      if (names.includes(name)) candidates.push([alias, name]);
    });
    let best = null;
    candidates.forEach(([alias, name]) => {
      if (!alias || !similarPurpose(key, alias)) return;
      const d = editDistance(key, alias);
      if (!best || d < best.d) best = { d, name };
    });
    return best ? best.name : 'Unknown income';
  }
  function validate(rows, meta) {
    const errors = [...(meta?.diagnostics || [])];
    if (!rows.length) errors.push('No valid transactions found.');
    rows.forEach((r,i) => { if (!date(r.date) || !Number.isFinite(r.moneyIn) || !Number.isFinite(r.moneyOut) || r.moneyIn < 0 || r.moneyOut < 0 || (r.moneyIn > 0 && r.moneyOut > 0) || (!r.zeroValue && !r.moneyIn && !r.moneyOut)) errors.push(`Invalid financial row ${i + 1}.`); });
    if (meta?.parserVersion === VERSION) rows.forEach((r,i) => {
      if (!timeToken.test(r.postingTime || '') || !date(r.valueDate) || !timeToken.test(r.valueTime || '') || (!r.bankReference && !r.nonRef) || !Number.isFinite(r.balance) || !r.accountingColumnsExplicit) errors.push(`Incomplete CRDB accounting block ${i + 1}.`);
    });
    const s = meta?.statement;
    if (s) [['totalCredits','moneyIn'], ['totalDebits','moneyOut']].forEach(([key,side]) => {
      const sum = round(rows.reduce((n,r) => n + r[side], 0));
      if (!Number.isFinite(s[key])) errors.push(`Statement ${key} header is missing.`);
      else if (Math.abs(sum - s[key]) > 0.02) errors.push(`${key}: extracted ${sum.toFixed(2)}, statement ${s[key].toFixed(2)}.`);
    });
    return { valid: !errors.length, errors };
  }
  global.SomapCrdb = { VERSION, amount, date, header, narration, parsePages, logicalPage, extractPage, parseExtractedPages, category, validate, round,
    BUILTIN_PURPOSE_NAMES: BUILTIN_NAMES, purposeKey, purposeNames, similarPurpose };
})(window);
