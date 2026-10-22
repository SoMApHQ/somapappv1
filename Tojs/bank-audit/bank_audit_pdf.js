(function(global) {
  'use strict';
  // Bank audit PDF reports. `createDocument(audit, {report, detail, category})`:
  //   report: 'summary' (default) | 'income' | 'category' | 'withdrawals' | 'review' | 'all'
  //   detail: 'short' (overview only) | 'full' (overview + complete register)
  // Registers are compact tables (one row per payment), never one block per transaction.
  // Only ASCII text is drawn: jsPDF's built-in Helvetica cannot render symbols like "•" or "—".
  const E = () => global.SomapBankAuditEngine;
  const COLOR = {
    navy: [15, 23, 42], blue: [29, 78, 216], teal: [15, 118, 110], green: [21, 128, 61], red: [190, 18, 60],
    amber: [180, 83, 9], slate: [100, 116, 139], ink: [30, 41, 59], line: [226, 232, 240], soft: [248, 250, 252],
    amberSoft: [255, 251, 235], amberLine: [252, 211, 77]
  };
  const PALETTE = [[29, 78, 216], [15, 118, 110], [124, 58, 237], [219, 39, 119], [234, 88, 12], [2, 132, 199], [101, 163, 13], [71, 85, 105]];
  const CATEGORY_COLOR = { 'Transport / Usafiri': [2, 132, 199], Remedial: [124, 58, 237], Graduation: [15, 118, 110], 'Unknown income': [180, 83, 9], 'Transfer reversal': [100, 116, 139] };
  const INCOME_ORDER = ['Transport / Usafiri', 'Remedial', 'Graduation'];
  const num = v => Number(v || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const tsh = v => v == null ? 'Not reported' : `TSh ${num(v)}`;
  const ascii = v => String(v ?? '').replace(/[–—]/g, '-').replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/…/g, '...').replace(/[^\x20-\x7e\n]/g, '');
  const round = v => Math.round(Number(v || 0) * 100) / 100;
  function day(value, withYear) {
    const d = E().parseDate(value);
    return d ? d.toLocaleDateString('en-GB', withYear ? { day: '2-digit', month: 'short', year: 'numeric' } : { day: '2-digit', month: 'short' }) : String(value || '');
  }
  function period(audit) {
    const from = audit.statementPeriodFrom, to = audit.statementPeriodTo;
    return from || to ? `${day(from, true)} to ${day(to, true)}` : 'Period not set';
  }
  function maskedAccount(audit) {
    const n = String(audit.statement?.accountNumber || '');
    return n ? `****${n.slice(-4)}` : 'Not reported';
  }
  const sum = (rows, key) => round(rows.reduce((n, t) => n + (Number(t[key]) || 0), 0));
  const payerName = t => t.detectedStudentName || t.sender || 'Not stated';

  // ---- Report data (pure; exported for tests) ----
  function incomeByCategory(audit) {
    const income = (audit.transactions || []).filter(t => t.moneyIn > 0), map = new Map();
    income.forEach(t => { const g = map.get(t.category) || { name: t.category, count: 0, total: 0 }; g.count += 1; g.total = round(g.total + t.moneyIn); map.set(t.category, g); });
    const rank = name => name === 'Unknown income' ? 2 : name === 'Transfer reversal' ? 3 : INCOME_ORDER.includes(name) ? 0 : 1;
    return [...map.values()].sort((a, b) => rank(a.name) - rank(b.name) || b.total - a.total);
  }
  function recipients(audit) {
    const map = new Map();
    (audit.withdrawalEvents || []).forEach(w => {
      const name = ascii(w.recipient || 'Recipient not stated in narration').trim();
      const g = map.get(name) || { name, accounts: new Set(), channels: new Set(), reasons: new Set(), count: 0, principal: 0, charges: 0, total: 0 };
      if (w.recipientAccount) g.accounts.add(w.recipientAccount);
      g.channels.add(channel(w));
      (w.rawLines || [w]).forEach(t => { if (t.statedReason) g.reasons.add(t.statedReason); });
      g.count += 1; g.principal = round(g.principal + w.amountWithdrawn); g.charges = round(g.charges + w.charges); g.total = round(g.total + w.totalImpact);
      map.set(name, g);
    });
    return [...map.values()].sort((a, b) => b.total - a.total);
  }
  function channel(w) {
    const type = String(w.transactionType || w.description || '');
    if (/MPESA/i.test(type)) return 'M-Pesa';
    if (/AIRTEL/i.test(type)) return 'Airtel Money';
    if (/TIGO/i.test(type)) return 'Tigo Pesa';
    if (/HALO/i.test(type)) return 'HaloPesa';
    if (/TIPS/i.test(type)) return 'Bank transfer (TIPS)';
    if (/\bIB\s+FT\b/i.test(type)) return 'Internet banking';
    return ascii(type).trim() || 'Not stated';
  }
  const hasFlag = (t, pattern) => (t.reviewFlags || []).some(f => pattern.test(f));
  function attention(audit) {
    const txns = audit.transactions || [], income = txns.filter(t => t.moneyIn > 0), items = [];
    const unknown = income.filter(t => t.category === 'Unknown income');
    const internal = unknown.filter(t => hasFlag(t, /owner \/ internal/));
    if (unknown.length) {
      const labels = {};
      unknown.forEach(t => { const l = t.writtenPurpose || 'no purpose written'; labels[l] = (labels[l] || 0) + 1; });
      const top = Object.entries(labels).sort((a, b) => b[1] - a[1]).slice(0, 6).map(([l, n]) => `"${l}" x${n}`).join(', ');
      items.push(['Unknown income', `${unknown.length} payment(s), ${tsh(sum(unknown, 'moneyIn'))}, purpose not recognised${internal.length ? ` (${tsh(sum(internal, 'moneyIn'))} of it is the owner / internal money below)` : ''}. Labels used: ${top}.`]);
    }
    txns.filter(t => t.moneyIn > 0 && hasFlag(t, /owner \/ internal/)).forEach(t =>
      items.push(['Owner / internal money in', `${day(t.date)}: ${tsh(t.moneyIn)} from ${t.sender || 'unstated sender'} (${t.transactionType || 'transfer'}). Not school fees until confirmed.`]));
    txns.filter(t => t.moneyOut > 0 && hasFlag(t, /loan/i)).forEach(t =>
      items.push(['Loan mentioned', `${day(t.date)}: ${tsh(t.moneyOut)} to ${t.recipient || 'unstated payee'} - narration says "${t.statedReason || 'loan'}". Keep the loan agreement on file.`]));
    const reversals = txns.filter(t => t.reversalOf);
    if (reversals.length) items.push(['Returned transfers', `${reversals.length} credit(s), ${tsh(sum(reversals, 'moneyIn'))}, are the bank returning outgoing transfer(s) (ref ${[...new Set(reversals.map(t => t.reversalOf))].join(', ')}). Not income.`]);
    const threshold = Number(audit.settings?.largeWithdrawalThreshold) || 500000;
    const large = (audit.withdrawalEvents || []).filter(w => w.amountWithdrawn >= threshold);
    if (large.length) items.push(['Large withdrawals', `${large.length} transfer(s) of ${tsh(threshold)} or more, total ${tsh(sum(large, 'amountWithdrawn'))}.`]);
    const weekend = (audit.withdrawalEvents || []).filter(w => ['Saturday', 'Sunday'].includes(w.dayOfWeek));
    if (weekend.length) items.push(['Weekend withdrawals', `${weekend.length} transfer(s) made on a Saturday or Sunday, total ${tsh(sum(weekend, 'totalImpact'))}.`]);
    const noReason = (audit.withdrawalEvents || []).filter(w => !(w.rawLines || [w]).some(t => t.statedReason));
    if (noReason.length) items.push(['No reason in bank narration', `${noReason.length} of ${(audit.withdrawalEvents || []).length} withdrawals give no reason. Supporting documents are needed for company records.`]);
    const unnamed = income.filter(t => !t.detectedStudentName && !['Unknown income', 'Transfer reversal'].includes(t.category));
    if (unnamed.length) items.push(['Child name missing', `${unnamed.length} payment(s) with a known purpose but no child name.`]);
    if ((audit.discontinuities || []).length) items.push(['Balance gaps', `${audit.discontinuities.length} printed balance(s) do not follow from the previous row (dates: ${[...new Set(audit.discontinuities.map(d => day(d.date)))].join(', ')}). Check with the bank.`]);
    if ((audit.postingOrderNotes || []).length) items.push(['Posting order', `${audit.postingOrderNotes.length} row(s) were posted by the bank in a different order than printed. Balances still reconcile; no action needed.`]);
    return items;
  }

  // ---- Drawing ----
  async function loadLogo(audit) {
    for (const url of [audit.schoolLogoUrl, '../images/somap-logo.png.jpg'].filter(Boolean)) {
      try {
        const response = await fetch(url);
        if (!response.ok) continue;
        const blob = await response.blob();
        return await new Promise((resolve, reject) => { const r = new FileReader(); r.onload = () => resolve(r.result); r.onerror = reject; r.readAsDataURL(blob); });
      } catch (_) { /* try next */ }
    }
    return null;
  }

  async function createDocument(audit, opts = {}) {
    if (!global.jspdf?.jsPDF) throw new Error('PDF library missing.');
    if (!audit.validation?.valid) throw new Error('Reparse and validate this statement before generating a report.');
    const report = opts.report || 'summary', full = opts.detail === 'full';
    const doc = new global.jspdf.jsPDF({ orientation: 'portrait', unit: 'pt', format: 'a4', compress: true });
    const W = doc.internal.pageSize.getWidth(), H = doc.internal.pageSize.getHeight(), M = 34, CW = W - 2 * M;
    const logo = await loadLogo(audit);
    const title = titleFor(report, opts.category, full);
    let y = 0;

    const font = (size, style, color) => { doc.setFont('helvetica', style || 'normal'); doc.setFontSize(size); doc.setTextColor(...(color || COLOR.ink)); };
    function banner() {
      doc.setFillColor(...COLOR.navy); doc.rect(0, 0, W, 96, 'F');
      doc.setFillColor(...COLOR.blue); doc.rect(0, 96, W, 4, 'F');
      let x = M;
      if (logo) { doc.setFillColor(255, 255, 255); doc.roundedRect(M, 18, 58, 58, 8, 8, 'F'); try { doc.addImage(logo, M + 5, 23, 48, 48); } catch (_) {} x = M + 72; }
      font(8, 'bold', [148, 163, 184]); doc.text('SoMAp BANK AUDIT & ANALYZER', x, 30);
      font(18, 'bold', [255, 255, 255]); doc.text(ascii(title), x, 52);
      font(9, 'normal', [203, 213, 225]);
      doc.text(ascii(`${audit.schoolName || audit.statement?.accountName || 'School'}  |  ${audit.bankName || 'CRDB'} account ${maskedAccount(audit)}  |  ${period(audit)}`), x, 70);
      doc.text(ascii(`Generated ${day(new Date().toISOString().slice(0, 10), true)}  |  Source: ${audit.uploadedFileName || 'bank statement'}`), x, 84);
      y = 122;
    }
    function pageHeader() {
      doc.setFillColor(...COLOR.navy); doc.rect(0, 0, W, 26, 'F');
      font(8, 'bold', [255, 255, 255]); doc.text(ascii(`SoMAp  |  ${title}`), M, 17);
      font(8, 'normal', [203, 213, 225]); doc.text(ascii(period(audit)), W - M, 17, { align: 'right' });
    }
    function ensure(space) { if (y + space > H - 46) { doc.addPage(); pageHeader(); y = 44; } }
    function section(text, color, note) {
      ensure(70);
      doc.setFillColor(...(color || COLOR.blue)); doc.rect(M, y - 9, 4, 13, 'F');
      font(12, 'bold', COLOR.navy); doc.text(ascii(text), M + 10, y + 2);
      if (note) { font(8, 'normal', COLOR.slate); doc.text(ascii(note), W - M, y + 2, { align: 'right' }); }
      y += 14;
    }
    function paragraph(text, size) {
      font(size || 9, 'normal', COLOR.slate);
      const lines = doc.splitTextToSize(ascii(text), CW);
      ensure(lines.length * 12 + 4); doc.text(lines, M, y); y += lines.length * 12 + 6;
    }
    function tiles(items) {
      const perRow = 4, gap = 8, w = (CW - gap * (perRow - 1)) / perRow, h = 54;
      for (let i = 0; i < items.length; i += perRow) {
        ensure(h + 8);
        items.slice(i, i + perRow).forEach((t, j) => {
          const x = M + j * (w + gap), c = t.color || COLOR.blue;
          doc.setFillColor(...COLOR.soft); doc.setDrawColor(...COLOR.line); doc.roundedRect(x, y, w, h, 5, 5, 'FD');
          doc.setFillColor(...c); doc.rect(x, y + 6, 3, h - 12, 'F');
          font(7, 'bold', COLOR.slate); doc.text(ascii(t.label).toUpperCase(), x + 10, y + 15);
          font(t.value.length > 18 ? 10.5 : 12, 'bold', c); doc.text(ascii(t.value), x + 10, y + 32);
          if (t.note) { font(7, 'normal', COLOR.slate); doc.text(doc.splitTextToSize(ascii(t.note), w - 16)[0], x + 10, y + 45); }
        });
        y += h + gap;
      }
      y += 4;
    }
    // shareCol: draws a proportional coloured bar in that column (value 0..1 in row.raw[shareCol]).
    function table(head, body, o = {}) {
      ensure(40);
      const amountCols = o.amountCols || [];
      // Merge per column so a width setting never drops the right-alignment of an amount column.
      const columnStyles = {};
      amountCols.forEach(i => { columnStyles[i] = { halign: 'right', fontStyle: 'bold' }; });
      Object.entries(o.columnStyles || {}).forEach(([i, style]) => { columnStyles[i] = { ...(columnStyles[i] || {}), ...style }; });
      doc.autoTable({
        startY: y, head: [head.map(ascii)], body: body.length ? body.map(r => r.map(c => typeof c === 'object' && c ? c : ascii(c))) : [[{ content: 'No records.', colSpan: head.length }]],
        foot: o.foot ? [o.foot.map(ascii)] : undefined, showFoot: 'lastPage', showHead: 'everyPage',
        margin: { left: M, right: M, top: 40, bottom: 46 }, theme: 'grid',
        styles: { font: 'helvetica', fontSize: o.fontSize || 8, cellPadding: 3.5, textColor: COLOR.ink, lineColor: COLOR.line, lineWidth: 0.5, overflow: 'linebreak', valign: 'middle' },
        headStyles: { fillColor: o.color || COLOR.navy, textColor: 255, fontStyle: 'bold', fontSize: 7.5 },
        footStyles: { fillColor: [241, 245, 249], textColor: COLOR.navy, fontStyle: 'bold' },
        alternateRowStyles: { fillColor: COLOR.soft }, columnStyles, rowPageBreak: 'avoid',
        didParseCell: data => {
          if (data.section === 'foot' && amountCols.includes(data.column.index)) data.cell.styles.halign = 'right';
          if (o.shareCol != null && data.section === 'body' && data.column.index === o.shareCol) data.cell.styles.textColor = [255, 255, 255];
        },
        didDrawCell: data => {
          if (o.shareCol == null || data.section !== 'body' || data.column.index !== o.shareCol) return;
          const share = Number(data.row.raw[o.shareCol]?.share) || 0, c = data.row.raw[o.shareCol]?.color || COLOR.blue;
          const barW = Math.max(1.5, (data.cell.width - 44) * share);
          doc.setFillColor(...COLOR.line); doc.rect(data.cell.x + 4, data.cell.y + data.cell.height / 2 - 3, data.cell.width - 44, 6, 'F');
          doc.setFillColor(...c); doc.rect(data.cell.x + 4, data.cell.y + data.cell.height / 2 - 3, barW, 6, 'F');
          font(7.5, 'bold', COLOR.ink); doc.text(`${(share * 100).toFixed(1)}%`, data.cell.x + data.cell.width - 4, data.cell.y + data.cell.height / 2 + 2.5, { align: 'right' });
        },
        didDrawPage: () => { if (doc.internal.getCurrentPageInfo().pageNumber > 1) pageHeader(); }
      });
      y = doc.lastAutoTable.finalY + 16;
    }
    function callout(heading, items, color, soft, border) {
      if (!items.length) { section(heading, COLOR.green); paragraph('Nothing unusual found in this statement.'); return; }
      section(heading, color || COLOR.amber);
      table(['Check', 'What we found'], items, { color: color || COLOR.amber, columnStyles: { 0: { cellWidth: 118, fontStyle: 'bold', fillColor: soft || COLOR.amberSoft } }, fontSize: 8 });
    }
    function shareRow(name, total, grand) { return { content: '', share: grand ? total / grand : 0, color: CATEGORY_COLOR[name] || PALETTE[Math.abs(hash(name)) % PALETTE.length] }; }

    // ---- Content blocks ----
    const txns = audit.transactions || [], income = txns.filter(t => t.moneyIn > 0), totals = audit.totals || {};
    const events = audit.withdrawalEvents || [], bankCharges = txns.filter(t => t.bankChargeRow);
    function incomeTable() {
      const rows = incomeByCategory(audit), grand = sum(income, 'moneyIn');
      table(['Purpose', 'Payments', 'Amount (TSh)', 'Share of money in'], rows.map(r => [r.name, String(r.count), num(r.total), shareRow(r.name, r.total, grand)]),
        { amountCols: [1, 2], shareCol: 3, columnStyles: { 0: { cellWidth: 150, fontStyle: 'bold' }, 1: { cellWidth: 60 }, 2: { cellWidth: 100 } }, foot: ['Total received', String(income.length), num(grand), ''] });
    }
    function recipientTable() {
      const rows = recipients(audit);
      table(['Sent to', 'Account / channel', 'Transfers', 'Amount sent', 'Charges', 'Reason in bank narration'],
        rows.map(r => [r.name, [[...r.accounts].join(', '), [...r.channels].join(', ')].filter(Boolean).join('\n'), String(r.count), num(r.principal), num(r.charges), [...r.reasons].join(', ') || 'Not stated']),
        { amountCols: [2, 3, 4], color: COLOR.red, columnStyles: { 0: { cellWidth: 118, fontStyle: 'bold' }, 1: { cellWidth: 95 }, 2: { cellWidth: 52 }, 3: { cellWidth: 75 }, 4: { cellWidth: 60 } },
          foot: ['Total', '', String(events.length), num(sum(events, 'amountWithdrawn')), num(sum(events, 'charges')), ''] });
    }
    function bankChargeTable() {
      if (!bankCharges.length) return;
      section("Bank's own charges", COLOR.slate, 'Rows without a bank reference');
      table(['Date', 'Description', 'Amount (TSh)'], bankCharges.map(t => [day(t.date, true), t.description, num(t.moneyOut)]),
        { amountCols: [2], color: COLOR.slate, columnStyles: { 0: { cellWidth: 80 }, 2: { cellWidth: 100 } }, foot: ['Total', '', num(sum(bankCharges, 'moneyOut'))] });
    }
    function statementCheck() {
      const s = audit.statement || {};
      section('Statement check', COLOR.teal, 'Totals read from the bank header must match every row');
      const ok = (a, b) => Math.abs(round(a) - round(b)) <= 0.02 ? 'Matches' : 'MISMATCH';
      table(['Item', 'Bank header', 'SoMAp count', 'Result'], [
        ['Total credits', num(s.totalCredits), num(totals.totalDeposits), ok(s.totalCredits, totals.totalDeposits)],
        ['Total debits', num(s.totalDebits), num(totals.totalWithdrawals), ok(s.totalDebits, totals.totalWithdrawals)],
        ['Closing book balance', num(s.bookBalance), num(txns.at(-1)?.balance), ok(s.bookBalance, txns.at(-1)?.balance)],
        ['Rows read', '', String(txns.length), (audit.discontinuities || []).length ? `${audit.discontinuities.length} balance gap(s)` : 'Running balance reconciles']
      ], { amountCols: [1, 2], color: COLOR.teal, columnStyles: { 0: { fontStyle: 'bold' } } });
    }
    const kpiMain = () => [
      { label: 'Money in', value: tsh(totals.totalDeposits), color: COLOR.green, note: `${income.length} payments received` },
      { label: 'Money out', value: tsh(totals.totalWithdrawals), color: COLOR.red, note: `${events.length} transfers, ${bankCharges.length} bank charges` },
      { label: 'Net movement', value: tsh(totals.netMovement), color: totals.netMovement < 0 ? COLOR.red : COLOR.blue, note: 'Money in minus money out' },
      { label: 'Closing book balance', value: tsh(audit.statement?.bookBalance), color: COLOR.navy, note: `Available: ${tsh(audit.statement?.availableBalance)}` }
    ];

    banner();
    if (report === 'summary') {
      const unknown = income.filter(t => t.category === 'Unknown income'), known = income.filter(t => !['Unknown income', 'Transfer reversal'].includes(t.category));
      tiles([...kpiMain(),
        { label: 'Known purpose', value: tsh(sum(known, 'moneyIn')), color: COLOR.teal, note: `${known.length} payments` },
        { label: 'Unknown income', value: tsh(sum(unknown, 'moneyIn')), color: COLOR.amber, note: `${unknown.length} payments to confirm` },
        { label: 'Transfer charges', value: tsh(totals.totalCharges), color: COLOR.slate, note: 'Fees + tax on transfers' },
        { label: 'Bank charges', value: tsh(totals.bankCharges), color: COLOR.slate, note: "Bank's own fees and taxes" }]);
      section('Money received, by purpose', COLOR.green, 'From the purpose parents wrote on the bank slip');
      incomeTable();
      section('Money sent out, by recipient', COLOR.red, 'Who received money from this account');
      recipientTable();
      bankChargeTable();
      callout('Needs attention', attention(audit));
      statementCheck();
    } else if (report === 'income') {
      paragraph('All money received into the account in this period, grouped by the purpose written on the bank slip. Payments whose purpose could not be recognised are listed as Unknown income so they can be confirmed with the payer.');
      const named = income.filter(t => t.detectedStudentName);
      tiles([{ label: 'Money in', value: tsh(sum(income, 'moneyIn')), color: COLOR.green, note: `${income.length} payments` },
        { label: 'Average payment', value: tsh(income.length ? sum(income, 'moneyIn') / income.length : 0), color: COLOR.blue },
        { label: 'Child named', value: `${named.length} of ${income.length}`, color: COLOR.teal, note: 'Payments that name a child' },
        { label: 'Unknown income', value: tsh(sum(income.filter(t => t.category === 'Unknown income'), 'moneyIn')), color: COLOR.amber }]);
      section('By purpose', COLOR.green); incomeTable();
      section('Largest payments', COLOR.blue);
      table(['Date', 'Child / payer', 'Purpose', 'Amount (TSh)'], [...income].sort((a, b) => b.moneyIn - a.moneyIn).slice(0, 8).map(t => [day(t.date), payerName(t), t.category, num(t.moneyIn)]), { amountCols: [3] });
      if (full) { section('Full income register', COLOR.navy, `${income.length} payments`); incomeRegister(income, true); }
    } else if (report === 'category') {
      categoryReport(opts.category);
    } else if (report === 'withdrawals') {
      paragraph('All money that left the account: transfers to people and wallets (with the fee and tax the bank charged on each) and the bank\'s own charges. The reason column shows only what the bank narration states; anything else needs supporting documents.');
      tiles([{ label: 'Money out', value: tsh(totals.totalWithdrawals), color: COLOR.red, note: `${events.length} transfers` },
        { label: 'Amount sent', value: tsh(sum(events, 'amountWithdrawn')), color: COLOR.blue, note: 'Paid to recipients' },
        { label: 'Transfer charges', value: tsh(sum(events, 'charges')), color: COLOR.slate },
        { label: 'Bank charges', value: tsh(totals.bankCharges), color: COLOR.slate }]);
      section('By recipient', COLOR.red); recipientTable();
      section('By channel', COLOR.blue);
      const byChannel = new Map();
      events.forEach(w => { const c = channel(w), g = byChannel.get(c) || [c, 0, 0, 0]; g[1] += 1; g[2] = round(g[2] + w.amountWithdrawn); g[3] = round(g[3] + w.charges); byChannel.set(c, g); });
      table(['Channel', 'Transfers', 'Amount sent', 'Charges'], [...byChannel.values()].map(g => [g[0], String(g[1]), num(g[2]), num(g[3])]), { amountCols: [1, 2, 3] });
      bankChargeTable();
      if (full) {
        section('Full withdrawal register', COLOR.navy, `${events.length} transfers`);
        table(['Date / time', 'Sent to', 'Account / channel', 'Reason', 'Amount sent', 'Charges', 'Bank ref'],
          events.map(w => [`${day(w.date)} ${String(w.postingTime || '').slice(0, 5)}\n${w.dayOfWeek || ''}`, w.recipient || 'Not stated', [w.recipientAccount, channel(w)].filter(Boolean).join('\n'),
            (w.rawLines || [w]).map(t => t.statedReason).find(Boolean) || 'Not stated', num(w.amountWithdrawn), num(w.charges), w.bankReference || '']),
          { amountCols: [4, 5], fontSize: 7.5, columnStyles: { 0: { cellWidth: 58 }, 1: { cellWidth: 100 }, 6: { cellWidth: 78, fontSize: 6.5 } },
            foot: ['Total', '', '', '', num(sum(events, 'amountWithdrawn')), num(sum(events, 'charges')), ''] });
      }
    } else if (report === 'review') {
      const items = audit.reviewItems || txns.filter(t => (t.reviewFlags || []).length);
      paragraph('Transactions SoMAp flagged for a person to check: unclear purposes, missing names, withdrawals without a stated reason, and anything unusual.');
      callout('Needs attention', attention(audit));
      const counts = {};
      items.forEach(t => (t.reviewFlags || []).forEach(f => { counts[f] = (counts[f] || 0) + 1; }));
      section('Flags raised', COLOR.amber);
      table(['Flag', 'Transactions'], Object.entries(counts).sort((a, b) => b[1] - a[1]), { amountCols: [1], color: COLOR.amber });
      if (full) {
        section('Full list of flagged transactions', COLOR.navy, `${items.length} transactions`);
        table(['Date', 'Name / details', 'In', 'Out', 'Flags'], items.map(t => [day(t.date), t.moneyIn > 0 ? `${payerName(t)}\n${t.writtenPurpose || ''}` : (t.recipient || t.description), t.moneyIn ? num(t.moneyIn) : '', t.moneyOut ? num(t.moneyOut) : '', (t.reviewFlags || []).join('; ')]),
          { amountCols: [2, 3], fontSize: 7, columnStyles: { 0: { cellWidth: 42 }, 1: { cellWidth: 130 }, 2: { cellWidth: 62 }, 3: { cellWidth: 62 } } });
      }
    } else if (report === 'all') {
      tiles(kpiMain());
      section('All transactions', COLOR.navy, `${txns.length} rows, in bank order`);
      table(['Date', 'Details', 'Category', 'In', 'Out', 'Balance'], txns.map(t => [`${day(t.date)}\n${String(t.postingTime || '').slice(0, 5)}`,
        t.moneyIn > 0 ? [payerName(t), t.writtenPurpose].filter(Boolean).join(' - ') : [t.recipient, t.statedReason].filter(Boolean).join(' - ') || t.description,
        t.category, t.moneyIn ? num(t.moneyIn) : '', t.moneyOut ? num(t.moneyOut) : '', num(t.balance)]),
        { amountCols: [3, 4, 5], fontSize: 7, columnStyles: { 0: { cellWidth: 40 }, 2: { cellWidth: 80 } }, foot: ['Total', '', '', num(totals.totalDeposits), num(totals.totalWithdrawals), ''] });
    }

    function incomeRegister(rows, withCategory) {
      const head = ['#', 'Date', 'Child / payer', 'Class', 'Written purpose', ...(withCategory ? ['Category'] : []), 'Sender', 'Amount (TSh)'];
      const amountCol = head.length - 1;
      table(head, rows.map((t, i) => [String(i + 1), day(t.date), payerName(t), t.extractedClass || '', t.writtenPurpose || '-', ...(withCategory ? [t.category] : []), t.sender || '', num(t.moneyIn)]),
        { amountCols: [amountCol], fontSize: 7.5, columnStyles: { 0: { cellWidth: 20, halign: 'right' }, 1: { cellWidth: 40 } }, foot: ['', 'Total', `${rows.length} payments`, '', '', ...(withCategory ? [''] : []), '', num(sum(rows, 'moneyIn'))] });
    }
    function categoryReport(name) {
      const rows = txns.filter(t => t.category === name), credits = rows.every(t => t.moneyIn > 0);
      const color = CATEGORY_COLOR[name] || PALETTE[Math.abs(hash(name)) % PALETTE.length];
      const intro = name === 'Unknown income' ? 'Payments whose purpose on the bank slip could not be recognised. Confirm each with the payer, or approve the label as a payment type in SoMAp so future statements classify it automatically.'
        : name === 'Transfer reversal' ? 'Credits that are the bank returning an outgoing transfer with the same reference. They are not income.'
        : credits ? `Payments whose bank slip states the purpose "${name}" (including the spellings shown below). One row per payment; match each to a child before recording it in the fee ledger.`
        : `Money out of the account classified as "${name}".`;
      paragraph(intro);
      const amount = t => t.moneyIn || t.moneyOut;
      const total = round(rows.reduce((n, t) => n + amount(t), 0));
      const dates = rows.map(t => t.date).filter(Boolean).sort();
      tiles([{ label: credits ? 'Collected' : 'Total', value: tsh(total), color, note: `${rows.length} ${credits ? 'payments' : 'rows'}` },
        { label: 'Average', value: tsh(rows.length ? total / rows.length : 0), color: COLOR.blue },
        credits ? { label: 'Child named', value: `${rows.filter(t => t.detectedStudentName).length} of ${rows.length}`, color: COLOR.teal } : { label: 'Rows', value: String(rows.length), color: COLOR.teal },
        { label: 'First / last', value: dates.length ? `${day(dates[0])} - ${day(dates.at(-1))}` : '-', color: COLOR.slate }]);
      if (credits) {
        const spellings = {};
        rows.forEach(t => { const l = t.writtenPurpose || '(none written)'; spellings[l] = spellings[l] || [l, 0, 0]; spellings[l][1] += 1; spellings[l][2] = round(spellings[l][2] + t.moneyIn); });
        section('What payers wrote', color);
        table(['Written on slip', 'Payments', 'Amount (TSh)'], Object.values(spellings).sort((a, b) => b[1] - a[1]).map(r => [r[0], String(r[1]), num(r[2])]), { amountCols: [1, 2], color });
        const byDay = {};
        rows.forEach(t => { byDay[t.date] = byDay[t.date] || [day(t.date, true), 0, 0]; byDay[t.date][1] += 1; byDay[t.date][2] = round(byDay[t.date][2] + t.moneyIn); });
        if (!full) { section('By date', color); table(['Date', 'Payments', 'Amount (TSh)'], Object.keys(byDay).sort().map(d => [byDay[d][0], String(byDay[d][1]), num(byDay[d][2])]), { amountCols: [1, 2], color }); }
        if (full) { section(`Everyone who paid: ${name}`, COLOR.navy, `${rows.length} payments`); incomeRegister(rows, false); }
      } else if (full || rows.length <= 30) {
        section('Rows', COLOR.navy);
        table(['Date', 'Details', 'Amount (TSh)'], rows.map(t => [day(t.date), t.recipient ? `${t.recipient}${t.statedReason ? ' - ' + t.statedReason : ''}` : t.description, num(amount(t))]), { amountCols: [2], foot: ['Total', '', num(total)] });
      }
    }

    const pages = doc.getNumberOfPages();
    for (let n = 1; n <= pages; n += 1) {
      doc.setPage(n);
      doc.setDrawColor(...COLOR.line); doc.line(M, H - 32, W - M, H - 32);
      font(7.5, 'normal', COLOR.slate);
      doc.text(ascii(`SoMAp Bank Audit & Analyzer  |  Confidential  |  ${audit.bankName || 'CRDB'} ${maskedAccount(audit)}`), M, H - 20);
      doc.text(`Page ${n} of ${pages}`, W - M, H - 20, { align: 'right' });
    }
    return doc;
  }

  function hash(s) { let h = 0; for (const c of String(s)) h = (h * 31 + c.charCodeAt(0)) | 0; return h; }
  function titleFor(report, category, full) {
    const t = { summary: 'Bank Statement Summary', income: 'Income Report', withdrawals: 'Withdrawals Report', review: 'Review Items', all: 'All Transactions' }[report]
      || `${category || 'Category'} Report`;
    return report === 'summary' || report === 'all' ? t : `${t}${full ? ' (full)' : ' (summary)'}`;
  }
  function fileName(audit, opts = {}) {
    const report = opts.report || 'summary';
    const part = report === 'category' ? opts.category || 'category' : report;
    const when = [audit.statementPeriodFrom, audit.statementPeriodTo].filter(Boolean).join('_to_') || audit.year || '';
    return `SoMAp_${audit.bankName || 'Bank'}_${part}${opts.detail === 'full' ? '_full' : ''}_${when}.pdf`.replace(/[^\w.-]+/g, '_');
  }
  async function toBlob(audit, opts) { return (await createDocument(audit, opts)).output('blob'); }
  async function download(audit, opts) { (await createDocument(audit, opts)).save(fileName(audit, opts)); }
  global.SomapBankAuditPdf = { createDocument, toBlob, download, fileName, incomeByCategory, recipients, attention };
})(window);
