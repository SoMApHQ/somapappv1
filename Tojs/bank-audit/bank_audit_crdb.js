(function (global) {
  'use strict';
  const VERSION = 'crdb-block-v2';
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
  function amount(value) {
    const s = String(value).trim();
    return /^-?(?:\d+|\d{1,3}(?:,\d{3})+)\.\d{1,2}$/.test(s) ? Number(s.replace(/,/g, '')) : NaN;
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
    const text = lines.join(' ').replace(/Deposi\s+ts/gi, 'Deposits').replace(/Shedr\s+ack/gi, 'Shedrack').replace(/([a-z])([A-Z])/g, '$1 $2');
    const payment = text.match(/\b(AB\d+)\s*:\s*([^:]*)(?::\s*(.*))?/i);
    let name = (payment?.[2] || '').trim();
    const cls = name.match(/\b(?:std|standard|class)\s*(\d+)/i);
    name = name.replace(/\b(?:std|standard|class)\s*\d+/i, '').trim();
    const purpose = (payment?.[3] || '').replace(/\s*N\/A\s*$/i, '').trim();
    const recipient = text.match(/\bTO\s+(?:MPESA|AIRTEL|TIGOPESA|HALOPESA)\s+(\d+)\s+(.+?)(?=\s+AB\d|$)/i);
    return { rawNarration: raw, description: text, bankReference: (text.match(/REF\s*:\s*([a-z0-9]+)/i) || [])[1] || '',
      paymentReference: payment?.[1] || '', detectedStudentName: name.replace(/\b\w/g, c => c.toUpperCase()),
      extractedClass: cls ? `Standard ${cls[1]}` : '', writtenPurpose: purpose,
      sender: (text.match(/\bFROM\s+(.+?)\s+TO\b/i) || [])[1] || '', recipient: recipient?.[2] || '', recipientAccount: recipient?.[1] || '',
      transactionType: (text.match(/REF\s*:\s*\w+\s+(.+?)(?=\s+FROM|\s+TO|$)/i) || [])[1] || '' };
  }
  function parsePages(pages) {
    const text = pages.map(p => typeof p === 'string' ? p : p.text).join('\n');
    const rows = [], errors = [];
    // Coordinate extraction supplies logical column blocks; text fixtures supply the same sequence.
    const lines = text.split(/\r?\n/).flatMap(s => s.trim().split(/\s+(?=-?(?:\d|,)+\.\d{1,2}(?:\s|$))/)).map(s => s.trim()).filter(Boolean);
    for (let i = 0; i < lines.length; i++) {
      if (!dateToken.test(lines[i]) || !timeToken.test(lines[i + 1] || '')) continue;
      const start = i, posting = lines[i++], postingTime = lines[i++];
      const details = [];
      while (i < lines.length && !dateToken.test(lines[i])) details.push(lines[i++]);
      const valueDate = lines[i++], valueTime = lines[i++];
      let tokens = (lines[i] || '').split(/\s+/);
      if (tokens.length === 1 && Number.isFinite(amount(tokens[0]))) tokens = [lines[i], lines[++i], lines[++i]];
      const values = tokens.map(amount);
      if (!date(posting) || !date(valueDate) || !timeToken.test(valueTime || '') || !/\bREF\s*:/i.test(details.join(' ')) || values.length !== 3 || values.some(n => !Number.isFinite(n)) || values[0] < 0 || values[1] < 0 || (values[0] > 0) === (values[1] > 0)) {
        errors.push(`Invalid transaction block at logical line ${start + 1}: ${posting} ${postingTime}`);
        i = start;
        continue;
      }
      rows.push({ ...narration(details), date: posting, postingTime, valueDate, valueTime, moneyOut: values[0], moneyIn: values[1], balance: values[2], sourceRow: rows.length + 1, accountingColumnsExplicit: true });
    }
    const meta = { parserVersion: VERSION, statement: header(text), diagnostics: errors, rawRows: rows.length, pageCount: pages.length };
    return { rows, meta, extractedText: text, sourceType: 'pdf' };
  }
  function logicalPage(items) {
    const sorted = items.filter(x => x.str.trim()).slice().sort((a,b) => b.transform[5] - a.transform[5] || a.transform[4] - b.transform[4]);
    const lines = [];
    sorted.forEach(item => { let line = lines.find(l => Math.abs(l.y - item.transform[5]) < 2); if (!line) lines.push(line = { y: item.transform[5], items: [] }); line.items.push(item); });
    lines.forEach(l => l.items.sort((a,b) => a.transform[4] - b.transform[4]));
    const heading = lines.find(l => /Posting\s*Date/.test(l.items.map(i => i.str).join(' ')) && /Book\s*Balance/.test(l.items.map(i => i.str).join(' ')));
    if (!heading) return lines.map(l => l.items.map(i => i.str).join(' ')).join('\n');
    const value = heading.items.find(i => /Value/.test(i.str));
    const details = heading.items.find(i => /Details/.test(i.str));
    const debit = heading.items.find(i => /^Debit/.test(i.str));
    const credit = heading.items.find(i => /^Credit/.test(i.str));
    const book = heading.items.find(i => /^Book/.test(i.str));
    if (!value || !details || !debit || !credit || !book) return lines.map(l => l.items.map(i => i.str).join(' ')).join('\n');
    const boundaries = [details, value, debit, credit, book].map(i => i.transform[4] - 5);
    const out = [], blocks = []; let block = null;
    lines.forEach(l => {
      if (l.y >= heading.y) { out.push(l.items.map(i => i.str).join(' ')); return; }
      const cols = Array.from({length:6}, () => []);
      l.items.forEach(i => { const at = boundaries.findIndex(x => i.transform[4] < x); cols[at < 0 ? 5 : at].push(i); });
      const strings = cols.map((c,n) => n === 1 ? c.reduce((s,item,i) => {
        const previous = c[i-1];
        const gap = previous ? item.transform[4] - previous.transform[4] - (previous.width || 0) : 0;
        return s + (i && gap > 1 ? ' ' : '') + item.str;
      }, '') : c.map(i => i.str).join('').trim());
      if (dateToken.test(strings[0])) { block = Array.from({length:6}, () => []); blocks.push(block); }
      if (block) strings.forEach((s, n) => { if (s) block[n].push(s); });
    });
    blocks.forEach(b => out.push(...b.flat()));
    return out.join('\n');
  }
  function category(purpose) {
    const p = purpose.toLowerCase();
    if (/\b(usafiri?|usafii|transport|school\s*bus)\b/.test(p)) return 'Transport / Usafiri';
    if (/\b(remedial|remidial|remidio|rimidio|rimedio|remijio|remigial)\b/.test(p)) return 'Remedial';
    if (/\b(graduation|graduat\w*|mahafali)\b/.test(p)) return 'Graduation';
    return 'Unknown income';
  }
  function validate(rows, meta) {
    const errors = [...(meta?.diagnostics || [])];
    if (!rows.length) errors.push('No valid transactions found.');
    rows.forEach((r,i) => { if (!date(r.date) || !Number.isFinite(r.moneyIn) || !Number.isFinite(r.moneyOut) || r.moneyIn < 0 || r.moneyOut < 0 || (r.moneyIn > 0) === (r.moneyOut > 0)) errors.push(`Invalid financial row ${i + 1}.`); });
    if (meta?.parserVersion === VERSION) rows.forEach((r,i) => {
      if (!timeToken.test(r.postingTime || '') || !date(r.valueDate) || !timeToken.test(r.valueTime || '') || !r.bankReference || !Number.isFinite(r.balance) || !r.accountingColumnsExplicit) errors.push(`Incomplete CRDB accounting block ${i + 1}.`);
    });
    const s = meta?.statement;
    if (s) [['totalCredits','moneyIn'], ['totalDebits','moneyOut']].forEach(([key,side]) => {
      const sum = round(rows.reduce((n,r) => n + r[side], 0));
      if (!Number.isFinite(s[key])) errors.push(`Statement ${key} header is missing.`);
      else if (Math.abs(sum - s[key]) > 0.02) errors.push(`${key}: extracted ${sum.toFixed(2)}, statement ${s[key].toFixed(2)}.`);
    });
    return { valid: !errors.length, errors };
  }
  global.SomapCrdb = { VERSION, amount, date, parsePages, logicalPage, category, validate, round };
})(window);
