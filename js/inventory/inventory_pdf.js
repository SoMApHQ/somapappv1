// SoMAp Daily Inventory — data collection for a date range and the PDF report
// (daily, weekly, monthly, yearly, custom: one template). Uses jsPDF + autotable,
// already used across SoMAp; loads them from cdnjs when a page does not have them.
(function (global) {
  'use strict';
  const INV = global.SomapInventory;
  const UI = global.SomapInventoryUI;
  if (!INV || !UI) { console.warn('SomapInventoryPDF: core/ui scripts missing'); return; }
  const { n0, todayYMD, addDays, fmtTime, fmtDateTime, fmtDaySw, yearOf } = INV.util;
  const T = INV.T;
  const JSPDF = 'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js';
  const AUTOTABLE = 'https://cdnjs.cloudflare.com/ajax/libs/jspdf-autotable/3.8.2/jspdf.plugin.autotable.min.js';

  async function ensureJsPDF() {
    if (!global.jspdf?.jsPDF) await UI.loadScript(JSPDF);
    const probe = new global.jspdf.jsPDF();
    if (typeof probe.autoTable !== 'function') await UI.loadScript(AUTOTABLE);
    return global.jspdf.jsPDF;
  }
  async function imageData(url) {
    if (!url) return null;
    try {
      const res = await fetch(url, { mode: 'cors' });
      if (!res.ok) return null;
      const blob = await res.blob();
      return await new Promise((resolve) => { const fr = new FileReader(); fr.onload = () => resolve(fr.result); fr.onerror = () => resolve(null); fr.readAsDataURL(blob); });
    } catch (_) { return null; }
  }

  // Everything a report page or PDF needs for [from, to].
  async function collect(ctx, from, to, opts = {}) {
    const years = []; for (let y = Number(yearOf(from)); y <= Number(yearOf(to)); y += 1) years.push(String(y));
    const [reportsRaw, flagsRaw, spotRaw, moves, roster, settings] = await Promise.all([
      INV.loadRange(ctx, 'reports', from, to), INV.loadRange(ctx, 'flags', from, to), INV.loadRange(ctx, 'spotChecks', from, to),
      INV.listMovements(ctx, from, to), INV.loadRoster(ctx, yearOf(to)), INV.loadSettings(ctx, yearOf(to)),
    ]);
    const repairs = (await Promise.all(years.map((y) => INV.listRepairs(ctx, y)))).flat();
    const dockets = await INV.loadDockets(ctx, yearOf(to));
    const reports = [];
    Object.entries(reportsRaw).forEach(([ymd, day]) => Object.entries(day || {}).forEach(([wid, r]) => {
      if (r && r.status && r.status !== 'draft') reports.push(Object.assign({ ymd, workerId: wid }, r));
    }));
    const flags = [];
    Object.entries(flagsRaw).forEach(([ymd, day]) => Object.entries(day || {}).forEach(([id, f]) => { if (f && !f.supersededAt) flags.push(Object.assign({ id, ymd }, f)); }));
    const spotChecks = [];
    Object.entries(spotRaw).forEach(([ymd, day]) => Object.entries(day || {}).forEach(([id, s]) => spotChecks.push(Object.assign({ id, ymd }, s))));
    const problems = [];
    reports.forEach((r) => (r.problems || []).forEach((p) => {
      if (['damaged', 'lost', 'notOk', 'expired'].includes(p.kind) && p.isNew) problems.push(Object.assign({ ymd: r.ymd, workerId: r.workerId, workerName: r.workerName, area: r.area, role: r.role, status: r.status }, p));
    }));
    repairs.filter((x) => x.source === 'spotCheck' && x.reportYmd >= from && x.reportYmd <= to).forEach((x) => problems.push({
      ymd: x.reportYmd, workerId: x.workerId, workerName: x.workerName, area: x.area, role: x.role, itemId: x.itemId, itemName: x.itemName, kind: 'notOk', qty: x.qty, desc: x.description, source: 'spotCheck',
    }));
    const filter = opts.filter || {};
    const keep = (x) => (!filter.role || x.role === filter.role) && (!filter.area || String(x.area || '').toLowerCase() === filter.area.toLowerCase()) && (!filter.workerId || x.workerId === filter.workerId);
    const enabledIds = roster.map((w) => w.workerId).filter((id) => INV.isEnabledFor(settings, id));
    let missing = [];
    if (from === to && opts.includeMissing !== false) {
      const day = {}; reports.filter((r) => r.ymd === from).forEach((r) => { day[r.workerId] = r; });
      missing = (await INV.notSubmitted(ctx, from, enabledIds, day)).map((m) => Object.assign(m, roster.find((w) => w.workerId === m.workerId) || {}));
    }
    const spotWeek = await INV.weekSpotStats(ctx, to).catch(() => null);
    return {
      from, to, settings, roster, dockets,
      reports: reports.filter(keep), flags: flags.filter(keep), spotChecks: spotChecks.filter(keep), problems: problems.filter(keep),
      repairs: repairs.filter(keep), moves: moves.filter((m) => !filter.workerId || m.fromWorkerId === filter.workerId || m.toWorkerId === filter.workerId),
      missing: missing.filter(keep), spotWeek, totals: INV.schoolTotals(dockets),
    };
  }

  function summarize(data) {
    const s = { reports: data.reports.length, approved: 0, pending: 0, returned: 0, damaged: 0, lost: 0, notOk: 0, noChanges: 0, flags: data.flags.filter((f) => !f.resolved).length };
    data.reports.forEach((r) => {
      if (r.status === 'approved') s.approved += 1; else if (r.status === 'submitted') s.pending += 1; else if (r.status === 'returned') s.returned += 1;
      if (r.noChanges) s.noChanges += 1;
    });
    data.problems.forEach((p) => { if (p.kind === 'damaged') s.damaged += n0(p.qty); else if (p.kind === 'lost') s.lost += n0(p.qty); else if (p.kind === 'notOk') s.notOk += 1; });
    const ymd = data.to;
    s.openRepairs = data.repairs.filter((r) => INV.OPEN_REPAIR.includes(r.status)).length;
    s.stalled = data.repairs.filter((r) => INV.isStalled(r, data.settings, ymd)).length;
    s.repairCost = data.repairs.filter((r) => (r.repairedAt && INV.util.ymdOf(r.repairedAt) >= data.from && INV.util.ymdOf(r.repairedAt) <= data.to)).reduce((t, r) => t + n0(r.actualCost), 0);
    s.writeOffs = data.moves.filter((m) => m.type === 'writeOff' && m.status === 'approved').reduce((t, m) => t + n0(m.qty), 0);
    s.spotDone = data.spotChecks.length;
    s.discrepancies = data.spotChecks.filter((x) => x.discrepancy).length;
    return s;
  }

  const ROLE = (r) => (T.ROLE_LABELS[r] ? T.ROLE_LABELS[r].sw : r || '');
  const STATUS = { approved: 'Imeidhinishwa', submitted: 'Inasubiri', returned: 'Imerudishwa', none: 'Hakuna', draft: 'Rasimu' };

  async function buildPdf(ctx, data, opts = {}) {
    const JsPDF = await ensureJsPDF();
    const doc = new JsPDF({ unit: 'mm', format: 'a4' });
    const W = doc.internal.pageSize.getWidth();
    const H = doc.internal.pageSize.getHeight();
    const M = 12;
    const meta = await INV.loadSchoolMeta(ctx).catch(() => ({ name: ctx.schoolName }));
    const [somapLogo, schoolLogo] = await Promise.all([imageData(INV.URLS.logo), imageData(meta.logoUrl)]);
    const brand = [15, 118, 110];
    const title = opts.title || (data.from === data.to ? 'Ripoti ya Mali ya Siku · Daily Inventory Report' : 'Ripoti ya Mali · Inventory Report');
    const range = data.from === data.to ? fmtDaySw(data.from) : `${fmtDaySw(data.from)} — ${fmtDaySw(data.to)}`;

    doc.setFillColor(...brand); doc.rect(0, 0, W, 30, 'F');
    if (somapLogo) { try { doc.addImage(somapLogo, 'JPEG', M, 5, 20, 20); } catch (_) { /* ignore bad image */ } }
    if (schoolLogo) { try { doc.addImage(schoolLogo, W - M - 20, 5, 20, 20); } catch (_) { /* ignore */ } }
    doc.setTextColor(255, 255, 255);
    doc.setFont('helvetica', 'bold'); doc.setFontSize(14); doc.text(title, M + 24, 12);
    doc.setFont('helvetica', 'normal'); doc.setFontSize(9);
    doc.text(range, M + 24, 18);
    doc.text(`Imetolewa na · Generated by: ${ctx.actorName || ''} · ${fmtDateTime(Date.now())}`, M + 24, 23);
    const right = schoolLogo ? W - M - 23 : W - M;
    doc.setFont('helvetica', 'bold'); doc.setFontSize(10); doc.text(String(meta.name || ctx.schoolName || ''), right, 12, { align: 'right' });
    doc.setFont('helvetica', 'normal'); doc.setFontSize(8);
    if (meta.registrationNumber) doc.text(`Reg. No: ${meta.registrationNumber}`, right, 17, { align: 'right' });
    doc.text(`Mwaka · Year ${yearOf(data.to)}`, right, 22, { align: 'right' });

    const s = summarize(data);
    const cards = [
      ['Ripoti · Reports', s.reports], ['Zimeidhinishwa · Approved', s.approved], ['Vibovu · Damaged', s.damaged],
      ['Vimepotea · Lost', s.lost], ['Si sawa · Not OK', s.notOk], [data.from === data.to ? 'Hawakujaza · Missing' : 'Matengenezo wazi', data.from === data.to ? data.missing.length : s.openRepairs],
    ];
    const cw = (W - 2 * M - 5 * 3) / 6;
    let y = 36;
    cards.forEach(([label, value], i) => {
      const x = M + i * (cw + 3);
      const bad = (i >= 2 && Number(value) > 0);
      doc.setDrawColor(226, 232, 240); doc.setFillColor(bad ? 254 : 248, bad ? 242 : 250, bad ? 242 : 252);
      doc.roundedRect(x, y, cw, 18, 2, 2, 'FD');
      doc.setTextColor(100, 116, 139); doc.setFontSize(6.5); doc.text(label, x + 2.5, y + 5);
      doc.setTextColor(bad ? 185 : 15, bad ? 28 : 23, bad ? 28 : 42); doc.setFont('helvetica', 'bold'); doc.setFontSize(14); doc.text(String(value), x + 2.5, y + 14);
      doc.setFont('helvetica', 'normal');
    });
    y += 24;
    doc.setTextColor(15, 23, 42);
    const line2 = `Matengenezo yaliyo wazi: ${s.openRepairs} (yaliyokwama ${s.stalled}) · Gharama za matengenezo: TZS ${s.repairCost.toLocaleString('en-US')} · Write-offs: ${s.writeOffs} · Ukaguzi wa ghafla: ${s.spotDone}${data.spotWeek ? ` (wiki hii ${data.spotWeek.done}/${data.spotWeek.planned})` : ''} · Hitilafu: ${s.flags}`;
    doc.setFontSize(8); doc.text(doc.splitTextToSize(line2, W - 2 * M), M, y); y += 8;
    if (data.spotWeek && data.spotWeek.done < data.spotWeek.planned) {
      doc.setTextColor(185, 28, 28); doc.text(`Ukaguzi wa ghafla wiki hii haujakamilika: ${data.spotWeek.done} kati ya ${data.spotWeek.planned} · Management spot checks behind plan`, M, y); y += 6; doc.setTextColor(15, 23, 42);
    }

    const head = { fillColor: brand, textColor: 255, fontStyle: 'bold', fontSize: 7.5 };
    const table = (titleText, columns, rows, extra = {}) => {
      if (y > H - 40) { doc.addPage(); y = 16; }
      doc.setFont('helvetica', 'bold'); doc.setFontSize(10.5); doc.setTextColor(15, 23, 42); doc.text(titleText, M, y); doc.setFont('helvetica', 'normal');
      if (!rows.length) { doc.setFontSize(8); doc.setTextColor(100, 116, 139); doc.text('Hakuna · None', M, y + 5); y += 11; return; }
      doc.autoTable(Object.assign({ startY: y + 2, head: [columns], body: rows, margin: { left: M, right: M, bottom: 16 }, styles: { fontSize: 7.2, cellPadding: 1.6, overflow: 'linebreak' }, headStyles: head, alternateRowStyles: { fillColor: [248, 250, 252] } }, extra));
      y = doc.lastAutoTable.finalY + 8;
    };

    // Per worker / area
    if (data.from === data.to) {
      table('Ripoti kwa kila mfanyakazi · Reports by worker and area', ['Mfanyakazi', 'Jukumu', 'Eneo', 'Hali', 'Vizima', 'Vibovu', 'Vimepotea', 'Si sawa', 'Saa', 'Aliyeidhinisha'],
        data.reports.sort((a, b) => String(a.role).localeCompare(String(b.role)) || String(a.area).localeCompare(String(b.area))).map((r) => [
          r.workerName, ROLE(r.role), r.area, `${STATUS[r.status] || r.status}${r.noChanges ? ' (hakuna mabadiliko)' : ''}`, n0(r.counts?.good), n0(r.counts?.damaged), n0(r.counts?.lost), n0(r.counts?.notOk), fmtTime(r.submittedAt),
          r.approvedAt ? `${r.approvedByName || ''} ${fmtTime(r.approvedAt)}${r.approvalMode === 'bulk' ? ' (zote safi)' : ''}` : (r.returnComment ? `Imerudishwa: ${r.returnComment}` : ''),
        ]));
    } else {
      const per = {};
      data.reports.forEach((r) => {
        const k = r.workerId;
        const p = per[k] || (per[k] = { name: r.workerName, role: r.role, area: r.area, n: 0, approved: 0, returned: 0, noChanges: 0, damaged: 0, lost: 0, notOk: 0 });
        p.n += 1; if (r.status === 'approved') p.approved += 1; if (r.status === 'returned') p.returned += 1; if (r.noChanges) p.noChanges += 1;
      });
      data.problems.forEach((x) => { const p = per[x.workerId]; if (!p) return; if (x.kind === 'damaged') p.damaged += n0(x.qty); else if (x.kind === 'lost') p.lost += n0(x.qty); else p.notOk += 1; });
      table('Muhtasari kwa kila mfanyakazi · Summary by worker', ['Mfanyakazi', 'Jukumu', 'Eneo', 'Ripoti', 'Zimeidhinishwa', 'Zimerudishwa', 'Hakuna mabadiliko', 'Vibovu', 'Vimepotea', 'Si sawa'],
        Object.values(per).sort((a, b) => (b.damaged + b.lost + b.notOk) - (a.damaged + a.lost + a.notOk)).map((p) => [p.name, ROLE(p.role), p.area, p.n, p.approved, p.returned, p.noChanges, p.damaged, p.lost, p.notOk]));
    }
    // School totals by category
    const totRows = [];
    Object.keys(T.CATEGORIES).forEach((cat) => (data.totals.byCategory[cat] || []).forEach((it) => totRows.push([
      `${T.CATEGORIES[cat].sw}`, it.sw, it.total, it.good, it.damaged, it.lost, Object.entries(it.byRole).map(([r, n]) => `${ROLE(r)} ${n}`).join(', '), it.pending ? `${it.confirmed} imethibitishwa / ${it.pending} inasubiri` : 'Imethibitishwa',
    ])));
    table('Jumla ya mali ya shule · School totals by category', ['Kundi', 'Kitu', 'Jumla', 'Vizima', 'Vibovu', 'Vimepotea', 'Kulingana na', 'Uthibitisho'], totRows);
    // Damages & losses
    table('Uharibifu na upotevu pamoja na maelezo · Damages & losses with explanations', ['Tarehe', 'Mfanyakazi', 'Eneo', 'Kitu', 'Tatizo', 'Idadi', 'Maelezo', 'Nani/jinsi', 'Chanzo'],
      data.problems.sort((a, b) => a.ymd.localeCompare(b.ymd)).map((p) => [p.ymd, p.workerName, p.area, p.itemName || p.itemId, INV.PROBLEM_LABELS[p.kind] || p.kind, n0(p.qty), p.desc || '', p.who || '', p.source === 'spotCheck' ? 'Ukaguzini (spot check)' : 'Mhusika (self)']),
      { didParseCell: (h) => { if (h.section === 'body' && h.column.index === 8) h.cell.styles.textColor = String(h.cell.raw).startsWith('Ukaguzini') ? [185, 28, 28] : [21, 128, 61]; } });
    // Inconsistencies
    const FLAG = { count_mismatch: 'Idadi imebadilika', reappeared: 'Vimerudi bila matengenezo', repeat_damage: 'Uharibifu unajirudia', spot_discrepancy: 'Ukaguzi umepinga ripoti', handover_difference: 'Tofauti ya makabidhiano' };
    table('Hitilafu zilizogunduliwa · Inconsistencies', ['Tarehe', 'Aina', 'Mfanyakazi', 'Eneo', 'Maelezo', 'Hali'],
      data.flags.map((f) => [f.ymd, FLAG[f.type] || f.type, f.workerName || '', f.area || '', f.detail || '', f.resolved ? 'Imetatuliwa' : 'Wazi']));
    // Spot checks
    table('Ukaguzi wa ghafla · Spot checks', ['Tarehe', 'Aliyekagua', 'Mfanyakazi', 'Eneo', 'Matokeo', 'Iliyopangwa'],
      data.spotChecks.map((x) => [x.ymd, x.byName || '', x.workerName || '', x.area || '', x.discrepancy ? `Tofauti: ${x.discrepancyItems?.length || 0}` : 'Inalingana', x.planned ? 'Ndiyo' : 'Hapana']),
      { didParseCell: (h) => { if (h.section === 'body' && h.column.index === 4 && String(h.cell.raw).startsWith('Tofauti')) h.cell.styles.textColor = [185, 28, 28]; } });
    // Not submitted (daily)
    if (data.from === data.to) {
      table('Hawakujaza · Checked in but did not submit', ['Mfanyakazi', 'Jukumu', 'Check-in', 'Hali ya ripoti'],
        data.missing.map((m) => [m.name || m.workerId, ROLE(m.roleKey || m.role), fmtTime(m.checkInTs), m.status === 'returned' ? 'Imerudishwa, haijarekebishwa' : 'Haijawasilishwa']),
        { bodyStyles: { textColor: [185, 28, 28] } });
    }
    // Repairs
    const REP = { reported: 'Imeripotiwa', assigned: 'Imepangiwa fundi', inProgress: 'Inaendelea', repaired: 'Imetengenezwa', confirmed: 'Imethibitishwa', cannotRepair: 'Haitengenezeki', cancelled: 'Imefutwa' };
    table('Matengenezo · Repairs (wazi na yaliyokwama)', ['Tarehe', 'Kitu', 'Eneo', 'Mhusika', 'Hali', 'Siku', 'Fundi', 'Makadirio', 'Gharama'],
      data.repairs.filter((r) => INV.OPEN_REPAIR.includes(r.status) || (r.reportYmd >= data.from && r.reportYmd <= data.to)).filter((r) => r.status !== 'cancelled').map((r) => [
        r.reportYmd, `${r.itemName} ×${n0(r.qty)}`, r.area, r.workerName, `${REP[r.status] || r.status}${INV.isStalled(r, data.settings, data.to) ? ' — IMEKWAMA' : ''}`, INV.repairAgeDays(r, data.to), r.assignedTo || '', r.estimatedCost ? n0(r.estimatedCost).toLocaleString('en-US') : '', r.actualCost ? n0(r.actualCost).toLocaleString('en-US') : '',
      ]),
      { didParseCell: (h) => { if (h.section === 'body' && h.column.index === 4 && String(h.cell.raw).includes('IMEKWAMA')) h.cell.styles.textColor = [185, 28, 28]; } });
    // Write-offs & transfers
    table('Mienendo · Movements (write-offs, transfers, stock in)', ['Tarehe', 'Aina', 'Kitu', 'Idadi', 'Kutoka', 'Kwenda', 'Sababu', 'Hali'],
      data.moves.map((m) => [m.ymd, { transfer: 'Uhamisho', stockIn: 'Mali mpya', writeOff: 'Write-off' }[m.type] || m.type, m.itemName || m.itemId, n0(m.qty), m.fromWorkerName || m.source || '', m.toWorkerName || '', m.reason || '', `${m.status}${m.approvedBy ? ` (${m.approvedBy})` : ''}`]));
    // Approvals
    table('Idhini · Approvals (nani, lini)', ['Tarehe', 'Mfanyakazi', 'Aliyeidhinisha', 'Saa', 'Njia'],
      data.reports.filter((r) => r.approvedAt).map((r) => [r.ymd, r.workerName, r.approvedByName || '', fmtDateTime(r.approvedAt), r.approvalMode === 'bulk' ? 'Zote safi (bulk)' : 'Moja moja']));

    // Signatures
    if (y > H - 40) { doc.addPage(); y = 20; }
    y += 6;
    doc.setDrawColor(100, 116, 139); doc.setTextColor(15, 23, 42); doc.setFontSize(9);
    const sw = (W - 2 * M - 20) / 2;
    [['Mwalimu Mkuu · Head Teacher', M], ['Mkurugenzi · Director', M + sw + 20]].forEach(([label, x]) => {
      doc.line(x, y + 12, x + sw, y + 12);
      doc.text(label, x, y + 17);
      doc.setFontSize(7.5); doc.setTextColor(100, 116, 139); doc.text('Sahihi na tarehe · Signature & date', x, y + 21); doc.setFontSize(9); doc.setTextColor(15, 23, 42);
    });
    const pages = doc.internal.getNumberOfPages();
    for (let i = 1; i <= pages; i += 1) {
      doc.setPage(i);
      doc.setFontSize(7.5); doc.setTextColor(100, 116, 139);
      doc.text(`SoMAp · ${meta.name || ctx.schoolName || ''} · Hesabu ya Mali`, M, H - 7);
      doc.text(`Ukurasa ${i} / ${pages}`, W - M, H - 7, { align: 'right' });
    }
    const safe = (v) => String(v || '').replace(/[^\w-]+/g, '_').replace(/_+/g, '_').replace(/^_|_$/g, '');
    const filename = `SoMAp_Inventory_${safe(meta.name || ctx.schoolName || ctx.schoolId)}_${data.from}_${data.to}${opts.suffix ? `_${safe(opts.suffix)}` : ''}.pdf`;
    return { doc, filename };
  }

  // Builds and downloads; returns a blob URL so the page can offer "open".
  async function download(ctx, from, to, opts = {}) {
    const data = opts.data || await collect(ctx, from, to, opts);
    const { doc, filename } = await buildPdf(ctx, data, opts);
    doc.save(filename);
    let url = '';
    try { url = doc.output('bloburl'); } catch (_) { /* ignore */ }
    return { filename, url, data };
  }

  // Printable list of consumables that need restocking (latest state of every docket).
  async function restockList(ctx) {
    const dockets = await INV.loadDockets(ctx, ctx.year);
    const rows = [];
    Object.values(dockets).forEach((d) => {
      if (!d || d.endedAt) return;
      const src = d.latest || d.lastApproved;
      Object.entries(src?.items || {}).forEach(([id, v]) => {
        if (v?.type === 'cons' && v.restock) {
          const def = INV.catalogDef(id) || (d.customItems || {})[id] || { sw: id };
          rows.push({ item: def.sw, unit: def.unit || '', qty: n0(v.qty), area: d.area || '', worker: d.workerName || '', role: d.role || '', ymd: src.ymd || '' });
        }
      });
    });
    return rows.sort((a, b) => a.item.localeCompare(b.item));
  }
  async function restockPdf(ctx) {
    const rows = await restockList(ctx);
    const JsPDF = await ensureJsPDF();
    const doc = new JsPDF({ unit: 'mm', format: 'a4' });
    const W = doc.internal.pageSize.getWidth();
    const logo = await imageData(INV.URLS.logo);
    doc.setFillColor(15, 118, 110); doc.rect(0, 0, W, 24, 'F');
    if (logo) { try { doc.addImage(logo, 'JPEG', 12, 4, 16, 16); } catch (_) { /* ignore */ } }
    doc.setTextColor(255, 255, 255); doc.setFont('helvetica', 'bold'); doc.setFontSize(13); doc.text('Orodha ya kuongeza mahitaji · Restock list', 32, 11);
    doc.setFont('helvetica', 'normal'); doc.setFontSize(9); doc.text(`${ctx.schoolName} · ${fmtDaySw(todayYMD())}`, 32, 17);
    doc.autoTable({ startY: 30, head: [['Kitu', 'Kilichobaki', 'Kipimo', 'Eneo', 'Mhusika', 'Ripoti ya']], body: rows.map((r) => [r.item, r.qty, r.unit, r.area, r.worker, r.ymd]), headStyles: { fillColor: [15, 118, 110] }, styles: { fontSize: 8.5 }, margin: { left: 12, right: 12 } });
    doc.save(`SoMAp_Restock_${String(ctx.schoolName || ctx.schoolId).replace(/[^\w-]+/g, '_')}_${todayYMD()}.pdf`);
    return rows;
  }

  global.SomapInventoryPDF = { ensureJsPDF, collect, summarize, buildPdf, download, restockList, restockPdf, rangeFor };

  // day | week | month | year → [from, to] ending on `ymd`
  function rangeFor(kind, ymd) {
    const d = ymd || todayYMD();
    if (kind === 'week') return [INV.util.weekMonday(d), addDays(INV.util.weekMonday(d), 6)];
    if (kind === 'month') { const from = `${d.slice(0, 7)}-01`; const next = new Date(`${from}T12:00:00Z`); next.setUTCMonth(next.getUTCMonth() + 1); return [from, addDays(next.toISOString().slice(0, 10), -1)]; }
    if (kind === 'year') return [`${d.slice(0, 4)}-01-01`, `${d.slice(0, 4)}-12-31`];
    return [d, d];
  }
})(window);
