/*
 * SoMAp report PDF kit (jsPDF + autotable, vector — small files, crisp print).
 * Cover page with school header, summary cards and progress bars; coloured section
 * bands; tables where the learner's NAME leads and the row number stays slim;
 * footer with page numbers on every page.
 */
(function (window) {
  'use strict';
  const C = {
    navy: [15, 31, 69], navy2: [30, 47, 92], gold: [201, 154, 58], goldSoft: [247, 226, 160], ink: [15, 23, 42], soft: [71, 85, 105], faint: [148, 163, 184],
    line: [226, 232, 240], paper: [248, 250, 252], white: [255, 255, 255],
    blue: [37, 99, 235], emerald: [5, 150, 105], amber: [217, 119, 6], rose: [225, 29, 72], violet: [124, 58, 237], slate: [100, 116, 139],
  };
  const TONES = {
    blue: { fg: C.blue, bg: [239, 246, 255] }, emerald: { fg: C.emerald, bg: [236, 253, 245] }, amber: { fg: C.amber, bg: [255, 251, 235] },
    rose: { fg: C.rose, bg: [255, 241, 242] }, violet: { fg: C.violet, bg: [245, 243, 255] }, navy: { fg: C.navy, bg: [238, 242, 255] }, slate: { fg: C.slate, bg: [241, 245, 249] },
  };
  const tsh = (n) => `TSh ${Math.round(Number(n) || 0).toLocaleString('en-US')}`;

  function start({ orientation = 'p', school = {}, title = 'Report', year = '', logoData = '' } = {}) {
    const { jsPDF } = window.jspdf || {};
    if (!jsPDF) throw new Error('PDF library missing');
    const doc = new jsPDF({ orientation, unit: 'pt', format: 'a4', compress: true });
    if (!doc.autoTable) throw new Error('PDF table plugin missing');
    const W = doc.internal.pageSize.getWidth(); const H = doc.internal.pageSize.getHeight();
    return { doc, W, H, M: 36, y: 36, school, title, year, logoData };
  }
  const fill = (doc, c) => doc.setFillColor(c[0], c[1], c[2]);
  const stroke = (doc, c) => doc.setDrawColor(c[0], c[1], c[2]);
  const text = (doc, c) => doc.setTextColor(c[0], c[1], c[2]);

  function header(ctx, { title, subtitle, compact } = {}) {
    const { doc, W, M } = ctx;
    const h = compact ? 92 : 150;
    fill(doc, C.navy); doc.rect(0, 0, W, h, 'F');
    fill(doc, C.navy2); doc.triangle(W * 0.55, 0, W, 0, W, h, 'F');
    fill(doc, C.gold); doc.rect(0, h, W, 3, 'F');
    const logo = compact ? 46 : 62;
    const lx = M; const ly = compact ? 22 : 30;
    fill(doc, C.white); doc.circle(lx + logo / 2, ly + logo / 2, logo / 2 + 3, 'F');
    if (ctx.logoData) { const side = logo * 0.72; try { doc.addImage(ctx.logoData, 'PNG', lx + (logo - side) / 2, ly + (logo - side) / 2, side, side, undefined, 'FAST'); } catch (_) { /* ignore */ } }
    const tx = lx + logo + 16;
    text(doc, C.goldSoft); doc.setFont('helvetica', 'bold'); doc.setFontSize(compact ? 8 : 9);
    doc.text(String(ctx.school.name || '').toUpperCase(), tx, ly + (compact ? 10 : 12), { charSpace: 1.4 });
    text(doc, C.white); doc.setFont('times', 'bold'); doc.setFontSize(compact ? 18 : 26);
    doc.text(title || ctx.title, tx, ly + (compact ? 32 : 42));
    doc.setFont('helvetica', 'normal'); doc.setFontSize(compact ? 9 : 10.5); text(doc, [203, 213, 225]);
    if (subtitle) doc.text(doc.splitTextToSize(subtitle, W - tx - M - 90), tx, ly + (compact ? 47 : 62));
    // year pill
    const pill = String(ctx.year || '');
    if (pill) {
      doc.setFont('helvetica', 'bold'); doc.setFontSize(compact ? 11 : 14);
      const pw = doc.getTextWidth(pill) + 26;
      fill(doc, C.gold); doc.roundedRect(W - M - pw, ly + 4, pw, compact ? 22 : 28, 11, 11, 'F');
      text(doc, C.navy); doc.text(pill, W - M - pw / 2, ly + (compact ? 19 : 23), { align: 'center' });
    }
    if (!compact && ctx.school.contact) { doc.setFont('helvetica', 'normal'); doc.setFontSize(8.5); text(doc, [148, 163, 184]); doc.text(ctx.school.contact, tx, h - 14); }
    ctx.y = h + 22;
  }

  /** cards: [{ label, value, sub, tone }] laid out in `cols` columns. */
  function cards(ctx, list, { cols = 3, height = 66 } = {}) {
    const { doc, W, M } = ctx;
    const gap = 10; const cw = (W - M * 2 - gap * (cols - 1)) / cols;
    list.forEach((c, i) => {
      const col = i % cols; const row = Math.floor(i / cols);
      const x = M + col * (cw + gap); const y = ctx.y + row * (height + gap);
      const tone = TONES[c.tone] || TONES.navy;
      fill(doc, tone.bg); doc.roundedRect(x, y, cw, height, 10, 10, 'F');
      fill(doc, tone.fg); doc.roundedRect(x, y, 4, height, 2, 2, 'F');
      doc.setFont('helvetica', 'bold'); doc.setFontSize(7.5); text(doc, C.soft);
      doc.text(String(c.label || '').toUpperCase(), x + 14, y + 17, { charSpace: 0.8 });
      doc.setFontSize(c.big === false ? 13 : 17); text(doc, tone.fg);
      doc.text(String(c.value ?? ''), x + 14, y + 39);
      if (c.sub) { doc.setFont('helvetica', 'normal'); doc.setFontSize(7.5); text(doc, C.faint); doc.text(doc.splitTextToSize(String(c.sub), cw - 24)[0], x + 14, y + 55); }
    });
    ctx.y += Math.ceil(list.length / cols) * (height + gap) + 8;
  }

  function progress(ctx, { label, value, max, tone = 'emerald', note }) {
    const { doc, W, M } = ctx;
    const pct = max > 0 ? Math.max(0, Math.min(1, value / max)) : 0;
    const t = TONES[tone] || TONES.emerald;
    doc.setFont('helvetica', 'bold'); doc.setFontSize(9); text(doc, C.ink); doc.text(label, M, ctx.y);
    doc.text(`${Math.round(pct * 100)}%`, W - M, ctx.y, { align: 'right' });
    fill(doc, C.line); doc.roundedRect(M, ctx.y + 6, W - M * 2, 9, 4.5, 4.5, 'F');
    if (pct > 0) { fill(doc, t.fg); doc.roundedRect(M, ctx.y + 6, Math.max(9, (W - M * 2) * pct), 9, 4.5, 4.5, 'F'); }
    if (note) { doc.setFont('helvetica', 'normal'); doc.setFontSize(7.5); text(doc, C.faint); doc.text(note, M, ctx.y + 26); }
    ctx.y += note ? 40 : 30;
  }

  function paragraph(ctx, str, { size = 9.5, color = C.soft, font = 'helvetica', style = 'normal' } = {}) {
    const { doc, W, M } = ctx;
    doc.setFont(font, style); doc.setFontSize(size); text(doc, color);
    const lines = doc.splitTextToSize(str, W - M * 2);
    ensure(ctx, lines.length * size * 1.35 + 8);
    doc.text(lines, M, ctx.y, { lineHeightFactor: 1.35 });
    ctx.y += lines.length * size * 1.35 + 8;
  }

  function ensure(ctx, need) { if (ctx.y + need > ctx.H - 50) { ctx.doc.addPage(); ctx.y = 40; } }

  function section(ctx, title, { tone = 'navy', sub, newPage = false } = {}) {
    const { doc, W, M } = ctx;
    if (newPage) { doc.addPage(); ctx.y = 40; } else ensure(ctx, 70);
    const t = TONES[tone] || TONES.navy;
    fill(doc, t.bg); doc.roundedRect(M, ctx.y, W - M * 2, sub ? 38 : 28, 8, 8, 'F');
    fill(doc, t.fg); doc.roundedRect(M, ctx.y, 5, sub ? 38 : 28, 2, 2, 'F');
    doc.setFont('helvetica', 'bold'); doc.setFontSize(11.5); text(doc, t.fg); doc.text(title, M + 16, ctx.y + 18);
    if (sub) { doc.setFont('helvetica', 'normal'); doc.setFontSize(8); text(doc, C.soft); doc.text(sub, M + 16, ctx.y + 31); }
    ctx.y += (sub ? 38 : 28) + 8;
  }

  /**
   * columns: [{ header, key, width, align, kind: 'num'|'money'|'status'|'muted'|'name' }]
   * rows: objects. A slim "#" column is added automatically.
   */
  function table(ctx, { columns, rows, tone = 'navy', totals }) {
    const { doc, M } = ctx;
    const t = TONES[tone] || TONES.navy;
    const head = [['#', ...columns.map((c) => c.header)]];
    const cell = (c, v) => (c.kind === 'money' ? Math.round(Number(v) || 0).toLocaleString('en-US') : String(v ?? '').replace(/^Pre[\s-]*Unit Class$/i, 'Pre-Unit'));
    const body = rows.map((r, i) => [String(i + 1), ...columns.map((c) => cell(c, r[c.key]))]);
    const foot = totals ? [['', ...columns.map((c) => (totals[c.key] == null ? '' : c.kind === 'money' ? Math.round(Number(totals[c.key]) || 0).toLocaleString('en-US') : String(totals[c.key])))]] : undefined;
    const columnStyles = { 0: { cellWidth: 20, halign: 'right', textColor: C.faint, fontSize: 7 } };
    columns.forEach((c, i) => {
      const s = {};
      if (c.width) s.cellWidth = c.width;
      if (c.kind === 'money' || c.kind === 'num' || c.align === 'right') s.halign = 'right';
      if (c.kind === 'name') { s.fontStyle = 'bold'; s.textColor = C.ink; }
      if (c.kind === 'muted') { s.textColor = C.faint; s.fontSize = 7; s.overflow = 'ellipsize'; }
      columnStyles[i + 1] = s;
    });
    const statusIdx = columns.findIndex((c) => c.kind === 'status') + 1;
    doc.autoTable({
      startY: ctx.y, head, body, foot, margin: { left: M, right: M, bottom: 46 }, theme: 'plain',
      styles: { font: 'helvetica', fontSize: 8.5, cellPadding: { top: 5, bottom: 5, left: 5, right: 5 }, textColor: C.soft, lineColor: C.line, lineWidth: { bottom: 0.4 } },
      headStyles: { fillColor: t.fg, textColor: C.white, fontStyle: 'bold', fontSize: 8, halign: 'left' },
      footStyles: { fillColor: t.bg, textColor: t.fg, fontStyle: 'bold' },
      alternateRowStyles: { fillColor: C.paper },
      columnStyles,
      didParseCell: (data) => {
        if (data.section === 'head' && columnStyles[data.column.index]?.halign === 'right') data.cell.styles.halign = 'right';
        if (data.section === 'body' && statusIdx > 0 && data.column.index === statusIdx) {
          const v = String(data.cell.raw || '').toLowerCase();
          data.cell.styles.fontStyle = 'bold';
          data.cell.styles.textColor = /paid|done|yes|cleared/.test(v) && !/un|partial/.test(v) ? C.emerald : /partial/.test(v) ? C.amber : /debt|unpaid|missing|no\b/.test(v) ? C.rose : C.soft;
        }
      },
    });
    ctx.y = doc.lastAutoTable.finalY + 18;
  }

  function signatures(ctx, roles) {
    const { doc, W, M } = ctx;
    ensure(ctx, 40 + Math.ceil(roles.length / 2) * 54);
    const cw = (W - M * 2 - 20) / 2;
    roles.forEach((r, i) => {
      const x = M + (i % 2) * (cw + 20); const y = ctx.y + Math.floor(i / 2) * 54;
      stroke(doc, C.line); doc.setLineWidth(0.6); doc.roundedRect(x, y, cw, 44, 8, 8, 'S');
      doc.setFont('helvetica', 'bold'); doc.setFontSize(8); text(doc, C.soft); doc.text(r.toUpperCase(), x + 12, y + 14, { charSpace: 0.6 });
      stroke(doc, C.faint); doc.line(x + 12, y + 34, x + cw * 0.62, y + 34); doc.line(x + cw * 0.7, y + 34, x + cw - 12, y + 34);
      doc.setFont('helvetica', 'normal'); doc.setFontSize(6.5); text(doc, C.faint); doc.text('Signature', x + 12, y + 41); doc.text('Date', x + cw * 0.7, y + 41);
    });
    ctx.y += Math.ceil(roles.length / 2) * 54 + 10;
  }

  function finish(ctx, fileName) {
    const { doc, W, H, M } = ctx;
    const n = doc.internal.getNumberOfPages();
    const stamp = new Date().toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' });
    for (let i = 1; i <= n; i += 1) {
      doc.setPage(i);
      stroke(doc, C.line); doc.setLineWidth(0.6); doc.line(M, H - 32, W - M, H - 32);
      doc.setFont('helvetica', 'normal'); doc.setFontSize(7.5); text(doc, C.faint);
      doc.text(`${ctx.school.name || ''} · ${ctx.title} · generated ${stamp} by SoMAp`, M, H - 20);
      doc.text(`Page ${i} of ${n}`, W - M, H - 20, { align: 'right' });
    }
    doc.save(fileName);
  }

  window.GradReportPdf = { C, TONES, tsh, start, header, cards, progress, paragraph, section, table, signatures, ensure, finish };
}(window));
