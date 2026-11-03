(function (global) {
  "use strict";
  // Withdrawal Trace Report PDF, drawn from SomapBankAuditTrace.build(). Cover page = the answer
  // (who received what, through which number or account, and how much the transport book explains);
  // following pages = the evidence (month / week comparison, patterns, every transfer, every expense).
  // Only ASCII text is drawn: jsPDF's built-in Helvetica cannot render symbols like "•" or "—".
  const C = {
    night: [30, 27, 75], indigo: [67, 56, 202], violet: [124, 58, 237], rose: [225, 29, 72], roseSoft: [255, 241, 242],
    emerald: [5, 150, 105], emeraldSoft: [236, 253, 245], amber: [217, 119, 6], amberSoft: [255, 251, 235], sky: [2, 132, 199],
    navy: [15, 23, 42], ink: [30, 41, 59], slate: [100, 116, 139], line: [226, 232, 240], soft: [248, 250, 252], white: [255, 255, 255],
    indigoSoft: [238, 242, 255], teal: [13, 148, 136]
  };
  const CHANNEL_COLOR = { mobile: C.rose, bank: C.indigo, cash: C.amber, other: C.slate };
  const num = (v) => Number(v || 0).toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 2 });
  const tsh = (v) => `TSh ${num(v)}`;
  const ascii = (v) => String(v ?? "").replace(/[–—]/g, "-").replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/…/g, "...").replace(/[^\x20-\x7e\n]/g, "");
  const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const MONTH = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  function day(s, withYear) {
    const m = String(s || "").match(/^(\d{4})-(\d{2})-(\d{2})/);
    return m ? `${m[3]} ${MON[+m[2] - 1]}${withYear === false ? "" : " " + m[1]}` : String(s || "-");
  }
  const monthName = (k) => { const [y, m] = String(k).split("-"); return `${MONTH[+m - 1]} ${y}`; };
  const pct = (a, b) => (b ? (a / b) * 100 : 0).toFixed(1) + "%";

  async function loadLogo() {
    for (const url of ["../images/somap-logo.png", "../images/somap-logo.png.jpg"]) {
      try {
        const res = await fetch(url);
        if (!res.ok) continue;
        const blob = await res.blob();
        const data = await new Promise((resolve, reject) => { const r = new FileReader(); r.onload = () => resolve(r.result); r.onerror = reject; r.readAsDataURL(blob); });
        return { data, type: /png/i.test(blob.type || url) ? "PNG" : "JPEG" };
      } catch (_) { /* try next */ }
    }
    return null;
  }

  async function createDocument(audit, r) {
    if (!global.jspdf?.jsPDF) throw new Error("PDF library missing.");
    const doc = new global.jspdf.jsPDF({ orientation: "portrait", unit: "pt", format: "a4", compress: true });
    const W = doc.internal.pageSize.getWidth(), H = doc.internal.pageSize.getHeight(), M = 36, CW = W - 2 * M;
    const logo = await loadLogo();
    const school = audit.schoolName || audit.statement?.accountName || "School";
    const acct = String(audit.statement?.accountNumber || "");
    const account = `${audit.bankName || "CRDB"} ${acct ? "****" + acct.slice(-4) : ""}`.trim();
    const period = `${day(r.from)} to ${day(r.to)}`;
    const T = r.transport, S = r.subject;
    const returnedTotal = S.returned.reduce((n, w) => n + (Number(w.amountWithdrawn) || 0), 0);
    let y = 0;

    const font = (size, style, color) => { doc.setFont("helvetica", style || "normal"); doc.setFontSize(size); doc.setTextColor(...(color || C.ink)); };
    const fill = (c) => doc.setFillColor(...c);
    const opacity = (o) => { try { doc.setGState(new doc.GState({ opacity: o })); } catch (_) { /* older jsPDF */ } };
    const text = (s, x, yy, o) => doc.text(ascii(s), x, yy, o);
    function gradient(x, yy, w, h, a, b, steps) {
      const n = steps || 48;
      for (let i = 0; i < n; i += 1) {
        const t = i / (n - 1);
        doc.setFillColor(...a.map((v, j) => Math.round(v + (b[j] - v) * t)));
        doc.rect(x + (w * i) / n, yy, w / n + 0.6, h, "F");
      }
    }
    function pageHeader() {
      gradient(0, 0, W, 28, C.night, C.violet, 24);
      font(8, "bold", C.white); text(`SoMAp  |  Withdrawal Trace  |  ${r.label}`, M, 18);
      font(8, "normal", [221, 214, 254]); text(period, W - M, 18, { align: "right" });
    }
    function newPage() { doc.addPage(); pageHeader(); y = 52; }
    function ensure(space) { if (y + space > H - 48) newPage(); }
    function chapter(no, title, sub) {
      newPage();
      font(8.5, "normal", C.slate);
      const lines = sub ? doc.splitTextToSize(ascii(sub), CW - 60) : [];
      const h = 36 + lines.length * 10.5;
      fill(C.indigoSoft); doc.roundedRect(M, y - 6, CW, h, 6, 6, "F");
      fill(C.indigo); doc.roundedRect(M, y - 6, 34, h, 6, 6, "F");
      font(15, "bold", C.white); text(String(no), M + 17, y - 6 + h / 2 + 5, { align: "center" });
      font(15, "bold", C.night); text(title, M + 46, y + 14);
      if (lines.length) { font(8.5, "normal", C.slate); doc.text(lines, M + 46, y + 28); }
      y += h + 12;
    }
    function section(title, color, note) {
      ensure(60);
      fill(color || C.indigo); doc.roundedRect(M, y - 10, 4, 15, 2, 2, "F");
      font(11.5, "bold", C.navy); text(title, M + 11, y + 2);
      if (note) { font(7.5, "normal", C.slate); text(note, W - M, y + 2, { align: "right" }); }
      y += 15;
    }
    function paragraph(s, size, color) {
      font(size || 9, "normal", color || C.slate);
      const lines = doc.splitTextToSize(ascii(s), CW);
      ensure(lines.length * 12 + 4); doc.text(lines, M, y); y += lines.length * 12 + 6;
    }
    function card(x, yy, w, h, o) {
      opacity(0.08); fill(C.navy); doc.roundedRect(x + 1.5, yy + 2.5, w, h, 8, 8, "F"); opacity(1);
      fill(o.bg || C.white); doc.setDrawColor(...(o.border || C.line)); doc.setLineWidth(0.6); doc.roundedRect(x, yy, w, h, 8, 8, "FD");
      fill(o.color); doc.roundedRect(x, yy, 5, h, 3, 3, "F"); doc.rect(x + 2.5, yy, 2.5, h, "F");
      font(6.8, "bold", C.slate); text(String(o.label).toUpperCase(), x + 13, yy + 15);
      const big = o.size || (o.value.length > 16 ? 13 : 16);
      font(big, "bold", o.color); text(o.value, x + 13, yy + 17 + big);
      if (o.note) { font(7, "normal", C.slate); doc.text(doc.splitTextToSize(ascii(o.note), w - 22).slice(0, 2), x + 13, yy + 26 + big); }
    }
    function cardRow(items, h) {
      const gap = 10, w = (CW - gap * (items.length - 1)) / items.length;
      ensure(h + 10);
      items.forEach((it, i) => card(M + i * (w + gap), y, w, h, it));
      y += h + 12;
    }
    function bar(x, yy, w, h, parts) {
      fill(C.line); doc.roundedRect(x, yy, w, h, h / 2, h / 2, "F");
      const total = parts.reduce((n, p) => n + Math.max(0, p.value), 0) || 1;
      let cx = x;
      parts.forEach((p) => { const pw = (w * Math.max(0, p.value)) / total; if (pw > 0.5) { fill(p.color); doc.rect(cx, yy, pw, h, "F"); } cx += pw; });
      doc.setDrawColor(...C.white); doc.setLineWidth(1.5); doc.roundedRect(x, yy, w, h, h / 2, h / 2, "S");
    }
    function table(head, body, o = {}) {
      ensure(44);
      const amountCols = o.amountCols || [];
      const columnStyles = {};
      amountCols.forEach((i) => { columnStyles[i] = { halign: "right", fontStyle: "bold" }; });
      Object.entries(o.columnStyles || {}).forEach(([i, s]) => { columnStyles[i] = { ...(columnStyles[i] || {}), ...s }; });
      doc.autoTable({
        startY: y, head: [head.map(ascii)],
        body: body.length ? body.map((row) => row.map((c) => (c && typeof c === "object" ? { ...c, content: ascii(c.content) } : ascii(c)))) : [[{ content: o.empty || "No records.", colSpan: head.length, styles: { halign: "center", textColor: C.slate } }]],
        foot: o.foot ? [o.foot.map(ascii)] : undefined, showFoot: "lastPage", showHead: "everyPage",
        margin: { left: M, right: M, top: 44, bottom: 48 }, theme: "grid",
        styles: { font: "helvetica", fontSize: o.fontSize || 8, cellPadding: 3.6, textColor: C.ink, lineColor: C.line, lineWidth: 0.5, overflow: "linebreak", valign: "middle" },
        headStyles: { fillColor: o.color || C.night, textColor: 255, fontStyle: "bold", fontSize: 7.5 },
        footStyles: { fillColor: o.footColor || C.indigoSoft, textColor: C.night, fontStyle: "bold" },
        alternateRowStyles: { fillColor: C.soft }, columnStyles, rowPageBreak: "avoid",
        didParseCell: (d) => {
          if (d.section === "foot" && amountCols.includes(d.column.index)) d.cell.styles.halign = "right";
          if (d.section === "body" && o.rowStyle) Object.assign(d.cell.styles, o.rowStyle(d.row.index, d.column.index) || {});
        },
        // Proportional bar in the cell whose raw value carries {bar: 0..1}.
        didDrawCell: (d) => {
          const share = d.section === "body" ? d.row.raw?.[d.column.index]?.bar : undefined;
          if (share == null) return;
          const x = d.cell.x + 6, w = d.cell.width - 12, cy = d.cell.y + d.cell.height / 2 - 3;
          fill(C.line); doc.roundedRect(x, cy, w, 6, 3, 3, "F");
          if (w * share > 0.5) { fill(o.color || C.indigo); doc.roundedRect(x, cy, w * share, 6, 3, 3, "F"); }
        },
        didDrawPage: () => { if (doc.internal.getCurrentPageInfo().pageNumber > 1) pageHeader(); }
      });
      y = doc.lastAutoTable.finalY + 16;
    }
    const gapCell = (v) => ({ content: (v > 0 ? "+" : "") + num(v), styles: { textColor: v > 0 ? C.rose : C.emerald, fontStyle: "bold" } });

    // ================= COVER =================
    gradient(0, 0, W, 250, C.night, C.violet, 60);
    opacity(0.1); fill(C.white); doc.circle(W - 40, 30, 120, "F"); doc.circle(W - 150, 250, 80, "F"); opacity(0.06); doc.circle(60, 260, 110, "F"); opacity(1);
    if (logo) { fill(C.white); doc.roundedRect(M, 34, 74, 74, 12, 12, "F"); try { doc.addImage(logo.data, logo.type, M + 7, 41, 60, 60); } catch (_) { /* logo optional */ } }
    const tx = logo ? M + 92 : M;
    font(8.5, "bold", [196, 181, 253]); text("SoMAp  |  BANK AUDIT & ANALYZER", tx, 52);
    font(27, "bold", C.white); text("Withdrawal Trace Report", tx, 82);
    font(10.5, "normal", [224, 231, 255]); text("Who received the money, through which number, and what the records explain", tx, 100);
    font(9, "bold", C.white); text(school, M, 140);
    font(8.5, "normal", [224, 231, 255]);
    text(`Account ${account}   |   Statement period ${period}   |   ${audit.uploadedFileName || "bank statement"}`, M, 155);
    text(`Prepared ${day(new Date().toISOString().slice(0, 10))}   |   Confidential - for the directors and auditors only`, M, 169);

    // Subject hero card
    y = 190;
    const heroH = 104;
    opacity(0.18); fill(C.navy); doc.roundedRect(M + 2, y + 4, CW, heroH, 12, 12, "F"); opacity(1);
    fill(C.white); doc.roundedRect(M, y, CW, heroH, 12, 12, "F");
    fill(C.rose); doc.roundedRect(M, y, 8, heroH, 4, 4, "F"); doc.rect(M + 4, y, 4, heroH, "F");
    font(7.5, "bold", C.slate); text("MONEY RECEIVED BY", M + 22, y + 22);
    font(16, "bold", C.night); text(r.label, M + 22, y + 41);
    font(30, "bold", C.rose); text(tsh(S.principal), M + 22, y + 76);
    font(8, "normal", C.slate);
    text(`Bank transfer charges on top: ${tsh(S.charges)}   |   Total cost to the account: ${tsh(S.principal + S.charges)}`, M + 22, y + 93);
    const statX = M + CW - 150;
    doc.setDrawColor(...C.line); doc.line(statX - 14, y + 16, statX - 14, y + heroH - 16);
    [["Transfers", String(S.count)], ["Days with transfers", String(S.activeDays)], ["Average transfer", tsh(S.average)], ["Largest", S.largest ? tsh(S.largest.amountWithdrawn) : "-"]].forEach(([k, v], i) => {
      font(7, "bold", C.slate); text(k.toUpperCase(), statX, y + 24 + i * 21);
      font(10, "bold", C.night); text(v, statX, y + 34 + i * 21);
    });
    y += heroH + 16;

    // Where it went: one card per number / account
    font(10, "bold", C.night); text("Where the money landed: each phone number and account", M, y); y += 8;
    const ch = S.channels.slice(0, 4);
    if (ch.length) cardRow(ch.map((c) => ({ label: `${c.label}${c.account ? "  " + c.account : ""}`, value: tsh(c.principal), color: CHANNEL_COLOR[c.kind] || C.slate,
      note: `${c.count} transfer(s) | ${pct(c.principal, S.principal)} of the total${c.names.length > 1 || (c.names[0] && c.names[0] !== c.account) ? " | as " + c.names.join(", ") : ""}` })), 66);
    else { paragraph("No transfers to this recipient in the statement."); }
    if (S.channels.length > 4) paragraph(`+ ${S.channels.length - 4} more channel(s), listed in section 2.`, 8);
    const mix = [["Phone / mobile money", S.mobile, C.rose], ["Bank accounts", S.bank, C.indigo], ["Cash", S.cash, C.amber], ["Other", S.other, C.slate]].filter((m) => m[1] > 0);
    if (mix.length > 1) {
      bar(M, y, CW, 9, mix.map((m) => ({ value: m[1], color: m[2] })));
      font(7.5, "normal", C.slate); text(mix.map((m) => `${m[0]}: ${tsh(m[1])} (${pct(m[1], S.principal)})`).join("     "), M, y + 21); y += 32;
    }

    // Money that came back to the account
    // (With a transport comparison, paid-back money appears in the formula row further down instead.)
    if (!T && (S.paidBackTotal || returnedTotal)) {
      font(10, "bold", C.night); text("Money that came back to the account", M, y); y += 8;
      cardRow([
        { label: "Paid back into the account", value: tsh(S.paidBackTotal), color: C.teal, note: `${S.paidBack.length} deposit(s) into the account` },
        { label: "Returned by the bank", value: tsh(returnedTotal), color: C.sky, note: `${S.returned.length} failed transfer(s), already left out` },
        { label: "Net still held", value: tsh(S.principal - S.paidBackTotal), color: C.rose, note: "Received minus paid back" }
      ], 62);
    }

    // Others the user added
    if (r.others.length) {
      font(10, "bold", C.night); text("Other recipients added to this trace", M, y); y += 6;
      const shown = r.others.slice(0, 5);
      table(["Recipient", "Number / channel", "Transfers", "Amount (TSh)"],
        shown.map((o) => [o.name, [o.phones.join(", "), o.channels.join(", ")].filter(Boolean).join("  |  "), String(o.count), num(o.principal)]),
        { amountCols: [2, 3], color: C.indigo, fontSize: 7.8, columnStyles: { 0: { cellWidth: 150, fontStyle: "bold" }, 2: { cellWidth: 55 }, 3: { cellWidth: 85 } },
          foot: [r.others.length > 5 ? `+ ${r.others.length - 5} more (section 3)` : "Others total", "", String(r.others.reduce((n, o) => n + o.count, 0)), num(r.others.reduce((n, o) => n + o.principal, 0))] });
      y -= 4;
    }

    // The answer
    if (T) {
      ensure(150);
      font(10, "bold", C.night); text("Withdrawn - transport expenses - money paid back = unexplained", M, y); y += 8;
      cardRow([
        { label: r.others.length ? "Withdrawn (incl. others)" : "Withdrawn", value: tsh(r.includedPrincipal), color: C.indigo, size: 12.5, note: `${r.included.length} transfers` },
        { label: "- Transport expenses", value: tsh(T.total), color: C.emerald, size: 12.5, note: T.rows.length ? `${T.rows.length} entries, ${day(T.firstDate, false)} - ${day(T.lastDate, false)}` : "None written for this period" },
        { label: "- Paid back to bank", value: tsh(S.paidBackTotal), color: C.teal, size: 12.5, note: `${S.paidBack.length} deposit(s) by ${r.label.split(" ")[0]}` },
        r.unexplained > 0
          ? { label: "= Unexplained", value: tsh(r.unexplained), color: C.rose, size: 12.5, bg: C.roseSoft, border: [254, 205, 211], note: `${pct(r.unexplained, r.includedPrincipal)} - ask where it is` }
          : { label: "= Fully explained", value: tsh(-r.unexplained), color: C.emerald, size: 12.5, bg: C.emeraldSoft, note: "Expenses + paid back exceed withdrawals" }
      ], 66);
      const explained = Math.min(T.total, r.includedPrincipal), back = Math.min(S.paidBackTotal, Math.max(0, r.includedPrincipal - explained));
      bar(M, y, CW, 12, [{ value: explained, color: C.emerald }, { value: back, color: C.teal }, { value: Math.max(0, r.unexplained), color: C.rose }]);
      font(7.5, "bold", C.emerald); text(`Expenses ${pct(explained, r.includedPrincipal)}`, M, y + 24);
      if (back) { font(7.5, "bold", C.teal); text(`Paid back ${pct(back, r.includedPrincipal)}`, M + CW / 2, y + 24, { align: "center" }); }
      font(7.5, "bold", C.rose); text(`Unexplained ${pct(Math.max(0, r.unexplained), r.includedPrincipal)}`, W - M, y + 24, { align: "right" });
      y += 36;
      const notes = [];
      if (!T.rows.length) notes.push(`No transport expenses are written for ${period}. The whole amount is unexplained until they are.`);
      else if (T.tail) notes.push(`Expenses are written up to ${day(T.lastDate)}. Nothing is written from ${day(T.tail.from)} to ${day(T.tail.to)} (${T.tail.days} day(s)).`);
      else notes.push(`Expenses are written for the whole period, up to ${day(T.lastDate)}.`);
      if (T.gaps.length) notes.push(`${T.gaps.length} stretch(es) of 3+ weekdays inside the period have no expense written (section 1).`);
      if (T.pendingTotal) notes.push(`${tsh(T.pendingTotal)} of expenses are still awaiting approval and are NOT counted above.`);
      if (returnedTotal) notes.push(`${tsh(returnedTotal)} the bank returned (${S.returned.length} failed transfer(s)) was never counted as withdrawn, so it is not subtracted again.`);
      callout("What this means", notes, C.amber, C.amberSoft);
    } else {
      callout("Transport comparison", ["Not requested for this report. Re-run the trace and answer Yes to compare with the transport expense book."], C.slate, C.soft);
    }
    const facts = [];
    if (S.phones.length) facts.push(`Phone number(s) used: ${S.phones.join(", ")}.`);
    if (S.viaNumber.length) facts.push(`${S.viaNumber.length} transfer(s) (${tsh(S.viaNumber.reduce((n, w) => n + w.amountWithdrawn, 0))}) went to the same number(s) under another name: ${[...new Set(S.viaNumber.map((w) => w.recipient))].join(", ")}.`);
    if (S.weekend.length) facts.push(`${S.weekend.length} transfer(s) on a weekend, ${tsh(S.weekend.reduce((n, w) => n + w.amountWithdrawn, 0))}.`);
    if (S.afterHours.length) facts.push(`${S.afterHours.length} transfer(s) before 07:00 or after 19:00.`);
    if (S.returned.length) facts.push(`${S.returned.length} transfer(s) returned by the bank are excluded.`);
    // Footnote only if it fits on the cover; every fact in it is repeated in section 2.
    font(7.5, "normal", C.slate);
    const factLines = doc.splitTextToSize(ascii(facts.join("   ")), CW);
    if (facts.length && y + factLines.length * 10 <= H - 48) doc.text(factLines, M, y);

    function callout(title, items, color, soft) {
      font(8.2, "normal", C.ink);
      const lines = items.map((s) => doc.splitTextToSize(ascii("-  " + s), CW - 28));
      const h = 26 + lines.reduce((n, l) => n + l.length * 11, 0) + 4;
      ensure(h + 8);
      fill(soft); doc.setDrawColor(...color); doc.setLineWidth(0.8); doc.roundedRect(M, y, CW, h, 7, 7, "FD");
      font(9, "bold", color); text(title, M + 14, y + 16);
      let ly = y + 30;
      font(8.2, "normal", C.ink); lines.forEach((l) => { doc.text(l, M + 14, ly); ly += l.length * 11; });
      y += h + 12;
    }

    // ================= 1. TRANSPORT COMPARISON =================
    let chapterNo = 1;
    if (T) {
      chapter(chapterNo++, "Withdrawals against transport expenses",
        `Only expenses for days inside the statement period (${period}) are counted. The day used is the one the clerk wrote at the start of the description (e.g. "16/04-fuel"), otherwise the day it was entered. Entries made in this period for earlier days are left out so nothing is counted twice.`);
      cardRow([
        { label: "Withdrawn", value: tsh(r.includedPrincipal), color: C.indigo, size: 12.5 },
        { label: "- Expenses written", value: tsh(T.total), color: C.emerald, size: 12.5, note: T.lastDate ? `${T.daysWritten} day(s), last ${day(T.lastDate, false)}` : "None written" },
        { label: "- Paid back to bank", value: tsh(S.paidBackTotal), color: C.teal, size: 12.5, note: `${S.paidBack.length} deposit(s)` },
        { label: r.unexplained > 0 ? "= Unexplained" : "= Over-explained", value: tsh(Math.abs(r.unexplained)), color: r.unexplained > 0 ? C.rose : C.emerald, size: 12.5 }
      ], 62);
      const sign = (v) => (v > 0 ? "+" : "") + num(v);
      section("Month by month", C.indigo, "Unexplained = withdrawn - expenses - paid back");
      table(["Month", "Transfers", r.others.length ? `To ${r.label.split(" ")[0]}` : "Withdrawn", ...(r.others.length ? ["To others"] : []), "Expenses", "Paid back", "Unexplained"],
        r.months.map((m) => [monthName(m.key) + (m.from.slice(8) !== "01" || m.to !== lastDay(m.key) ? `\n${day(m.from, false)} - ${day(m.to, false)}` : ""), String(m.count), num(m.subject), ...(r.others.length ? [num(m.others)] : []), num(m.expenses), num(m.paidBack), gapCell(m.gap)]),
        { amountCols: r.others.length ? [1, 2, 3, 4, 5, 6] : [1, 2, 3, 4, 5], color: C.indigo, columnStyles: { 0: { fontStyle: "bold", cellWidth: 100 } },
          foot: ["Whole period", String(r.included.length), num(S.principal), ...(r.others.length ? [num(r.includedPrincipal - S.principal)] : []), num(T.total), num(S.paidBackTotal), sign(r.unexplained)] });
      section("Week by week", C.violet, "Weeks run Monday to Sunday");
      table(["Week", "Transfers", "Withdrawn", "Expenses", "Paid back", "Unexplained"],
        r.weeks.map((w) => [`${day(w.from, false)} - ${day(w.to, false)}`, String(w.count), num(w.withdrawn), num(w.expenses), num(w.paidBack), gapCell(w.gap)]),
        { amountCols: [1, 2, 3, 4, 5], color: C.violet, fontSize: 7.8, columnStyles: { 0: { fontStyle: "bold" } },
          foot: ["Whole period", String(r.included.length), num(r.includedPrincipal), num(T.total), num(S.paidBackTotal), sign(r.unexplained)] });
      const cats = Object.entries(T.byCategory).sort((a, b) => b[1] - a[1]);
      section("What the written expenses were for", C.emerald);
      table(["Category", "Amount (TSh)", "Share"], cats.map(([k, v]) => [k, num(v), pct(v, T.total)]), { amountCols: [1, 2], color: C.emerald, columnStyles: { 0: { fontStyle: "bold" } }, foot: ["Total", num(T.total), "100%"] });
      section("Days with no expenses written", C.amber);
      const cover = [];
      if (T.tail) cover.push([`${day(T.tail.from)} - ${day(T.tail.to)}`, String(T.tail.days), T.rows.length ? "Not yet written: the expense book stops here" : "Nothing written for the whole period"]);
      T.gaps.forEach((g) => cover.push([`${day(g.from)} - ${day(g.to)}`, String(g.days), `${g.weekdays} weekday(s) with no expense written`]));
      table(["Dates", "Days", "Note"], cover, { color: C.amber, empty: "Every weekday in the period has at least one expense written.", columnStyles: { 0: { cellWidth: 170, fontStyle: "bold" }, 1: { cellWidth: 40, halign: "right" } } });
      if (T.backdatedTotal || T.pendingTotal) {
        section("Left out of the comparison", C.slate);
        table(["What", "Entries", "Amount (TSh)", "Why"], [
          ...(T.backdated.length ? [["Back-dated entries", String(T.backdated.length), num(T.backdatedTotal), `Entered in the period for days before ${day(r.from)}`]] : []),
          ...(T.pending.length ? [["Awaiting approval", String(T.pending.length), num(T.pendingTotal), "Not yet approved, so not in the expense book"]] : [])
        ], { amountCols: [1, 2], color: C.slate, columnStyles: { 0: { fontStyle: "bold", cellWidth: 120 } } });
      }
      callout("How to read this", [
        `Unexplained = money withdrawn - transport expenses written - money ${r.label} deposited back. Transfers the bank returned are never counted as withdrawn, so they are not subtracted again.`,
        "The comparison assumes every transport expense written was paid from these withdrawals. If some were paid in cash or from another account, the unexplained amount is even larger.",
        "A withdrawal is explained only when an expense is written for it. Ask for receipts or written expenses covering each unexplained week.",
        ...(T.fromDescription ? [`${T.fromDescription} of ${T.rows.length} expenses were dated from the date written in their description.`] : [])
      ], C.indigo, C.indigoSoft);
    }

    // ================= 2. PATTERNS =================
    chapter(chapterNo++, `How the money left: ${r.label}`, "When, how often and through which channel the transfers were made. Patterns help decide which transfers to question first.");
    if (r.months.length) {
      section("Withdrawn vs expenses written, per month", C.indigo);
      const chartH = 130, max = Math.max(1, ...r.months.map((m) => Math.max(m.withdrawn, m.expenses)));
      ensure(chartH + 40);
      const baseY = y + chartH, slot = CW / r.months.length, bw = Math.min(34, slot / 3);
      doc.setDrawColor(...C.line); doc.setLineWidth(0.5);
      [0, 0.25, 0.5, 0.75, 1].forEach((f) => { const ly = baseY - chartH * f; doc.line(M, ly, W - M, ly); font(6.5, "normal", C.slate); text(num(Math.round(max * f)), M, ly - 2); });
      r.months.forEach((m, i) => {
        const cx = M + slot * i + slot / 2;
        const h1 = (chartH * m.withdrawn) / max, h2 = (chartH * m.expenses) / max;
        fill(C.indigo); doc.roundedRect(cx - bw - 2, baseY - h1, bw, h1, 2, 2, "F");
        if (T) { fill(C.emerald); doc.roundedRect(cx + 2, baseY - h2, bw, Math.max(h2, 0.1), 2, 2, "F"); }
        font(7.5, "bold", C.ink); text(MONTH[+m.key.slice(5) - 1].slice(0, 3), cx, baseY + 12, { align: "center" });
        if (T && m.gap > 0) { font(6.5, "bold", C.rose); text(`+${num(m.gap)}`, cx, baseY + 22, { align: "center" }); }
      });
      y = baseY + 32;
      fill(C.indigo); doc.rect(M, y - 6, 8, 8, "F"); font(7.5, "normal", C.ink); text("Withdrawn", M + 12, y + 1);
      if (T) { fill(C.emerald); doc.rect(M + 80, y - 6, 8, 8, "F"); text("Expenses written", M + 92, y + 1); font(7.5, "bold", C.rose); text("+ red = unexplained that month", M + 190, y + 1); }
      y += 18;
    }
    section("By channel and number", C.rose);
    table(["Channel", "Number / account", "Name on transfer", "Transfers", "Amount (TSh)", "Charges", "Share"],
      S.channels.map((c) => [c.label, c.account || "-", c.names.join(", "), String(c.count), num(c.principal), num(c.charges), pct(c.principal, S.principal)]),
      { amountCols: [3, 4, 5, 6], color: C.rose, fontSize: 7.8, foot: ["Total", "", "", String(S.count), num(S.principal), num(S.charges), "100%"] });
    const maxDay = Math.max(1, ...r.weekdays.map((d) => d.principal));
    section("By day of the week", C.violet, "Weekend rows highlighted");
    table(["Day", "Transfers", "Amount (TSh)", "Pattern"], r.weekdays.map((d) => [d.day, String(d.count), num(d.principal), { content: "", bar: d.principal / maxDay }]),
      { amountCols: [1, 2], color: C.violet, columnStyles: { 0: { fontStyle: "bold", cellWidth: 90 }, 1: { cellWidth: 60 }, 2: { cellWidth: 95 } },
        rowStyle: (i) => (i >= 5 ? { fillColor: C.amberSoft } : null) });
    section("By time of day", C.sky);
    const maxH = Math.max(1, ...r.hours.map((h) => h.principal));
    table(["Time", "Transfers", "Amount (TSh)", "Pattern"], r.hours.map((h) => [h.band, String(h.count), num(h.principal), { content: "", bar: h.principal / maxH }]),
      { amountCols: [1, 2], color: C.sky, columnStyles: { 0: { fontStyle: "bold", cellWidth: 120 }, 1: { cellWidth: 60 }, 2: { cellWidth: 95 } },
        rowStyle: (i) => (/Night|Late/.test(r.hours[i]?.band) ? { fillColor: C.amberSoft } : null) });
    if (S.busyDays.length) {
      section("Days with three or more transfers", C.amber);
      table(["Date", "Day", "Transfers", "Amount (TSh)"], S.busyDays.map((d) => [day(d.date), global.SomapBankAuditTrace.weekdayOf(d.date), String(d.count), num(d.principal)]),
        { amountCols: [2, 3], color: C.amber, columnStyles: { 0: { fontStyle: "bold" } } });
    }
    if (S.paidBack.length || S.returned.length) {
      section("Money that came back", C.emerald);
      table(["Date", "What", "Reference", "Amount (TSh)"], [
        ...S.paidBack.map((t) => [day(t.date), `Deposited by ${t.sender}`, t.bankReference || "", num(t.moneyIn)]),
        ...S.returned.map((w) => [day(w.date), "Transfer returned by the bank (excluded above)", w.bankReference || "", num(w.amountWithdrawn)])
      ], { amountCols: [3], color: C.emerald, columnStyles: { 0: { cellWidth: 70 } }, footColor: C.emeraldSoft,
        foot: ["Total", `Paid back ${tsh(S.paidBackTotal)} + returned by the bank ${tsh(returnedTotal)}`, "", num(S.paidBackTotal + returnedTotal)] });
      paragraph(T
        ? `Withdrawn ${tsh(r.includedPrincipal)} - transport expenses ${tsh(T.total)} - paid back ${tsh(S.paidBackTotal)} = ${tsh(r.unexplained)} unexplained. Bank returns are already left out of the amount withdrawn.`
        : `Received ${tsh(S.principal)} - paid back ${tsh(S.paidBackTotal)} = ${tsh(S.principal - S.paidBackTotal)} still held by ${r.label}. Bank returns are already left out of the amount received.`, 8.5, C.ink);
    }

    // ================= 3. EVERY TRANSFER =================
    chapter(chapterNo++, `Every transfer to ${r.label}`, `${S.count} transfers in date order with a running total. Amber rows were made on a weekend; violet rows before 07:00 or after 19:00. Charges are the bank fee and tax on each transfer.`);
    const regRows = [], regStyle = [];
    let currentMonth = "", idx = 0;
    S.events.forEach((w) => {
      const m = w.date.slice(0, 7);
      if (m !== currentMonth) {
        currentMonth = m;
        const mRows = S.events.filter((x) => x.date.slice(0, 7) === m);
        regRows.push([{ content: `${monthName(m)}  -  ${mRows.length} transfer(s), ${tsh(mRows.reduce((n, x) => n + x.amountWithdrawn, 0))}`, colSpan: 9, styles: { fillColor: C.indigoSoft, textColor: C.indigo, fontStyle: "bold", halign: "left" } }]);
        regStyle.push("month");
      }
      idx += 1;
      regRows.push([String(idx), day(w.date), w.weekday.slice(0, 3), w.time || "-", `${w.recipient || "-"}${w.reason ? "\nReason: " + w.reason : ""}`,
        `${w.channel.label}${w.phone ? " " + w.phone : ""}`, num(w.amountWithdrawn), num(w.charges), num(w.running)]);
      const h = Number(String(w.time).slice(0, 2));
      regStyle.push(["Saturday", "Sunday"].includes(w.weekday) ? "weekend" : w.time && (h < 7 || h >= 19) ? "late" : "");
    });
    table(["#", "Date", "Day", "Time", "Sent to", "Channel", "Amount", "Charges", "Running total"], regRows,
      { amountCols: [6, 7, 8], color: C.night, fontSize: 7.4, columnStyles: { 0: { cellWidth: 20, halign: "right" }, 1: { cellWidth: 56 }, 2: { cellWidth: 28 }, 3: { cellWidth: 30 }, 5: { cellWidth: 100 }, 6: { cellWidth: 52 }, 7: { cellWidth: 44 }, 8: { cellWidth: 58 } },
        rowStyle: (i) => (regStyle[i] === "weekend" ? { fillColor: C.amberSoft } : regStyle[i] === "late" ? { fillColor: [245, 243, 255] } : null),
        foot: ["", "", "", "", "Total", "", num(S.principal), num(S.charges), ""] });

    // ================= 4. OTHERS =================
    if (r.others.length) {
      chapter(chapterNo++, "Other recipients added to this trace", "Recipients the reviewer chose to include with the main person, for example drivers or suppliers paid on the same budget.");
      r.others.forEach((o) => {
        section(o.name, C.indigo, `${o.count} transfer(s)  |  ${tsh(o.principal)}  |  ${[...o.phones, ...o.channels].join(", ")}`);
        table(["Date", "Day", "Time", "Channel", "Reason", "Amount", "Charges"], o.events.map((w) => [day(w.date), w.weekday.slice(0, 3), w.time || "-", `${w.channel.label}${w.phone ? " " + w.phone : ""}`, w.reason || "Not stated", num(w.amountWithdrawn), num(w.charges)]),
          { amountCols: [5, 6], color: C.indigo, fontSize: 7.6, foot: ["Total", "", "", "", "", num(o.principal), num(o.charges)] });
      });
    }

    // ================= 5. EXPENSES COUNTED =================
    if (T) {
      chapter(chapterNo++, "Transport expenses counted", `Every approved transport expense dated inside ${period}, from the transport payments expense book.`);
      table(["Spent on", "Entered", "Category", "Description", "Entered by", "Amount"],
        T.rows.map((e) => [day(e.date), e.recordedDate ? day(e.recordedDate, false) : "-", e.category || "OTHER", e.description || "", `${e.addedBy || "-"}${e.source === "finance" ? "\n(Finance book)" : e.source === "approval" ? "\n(from approvals)" : ""}`, num(e.amount)]),
        { amountCols: [5], color: C.emerald, fontSize: 7.3, empty: "No transport expenses are written for this period.",
          columnStyles: { 0: { cellWidth: 56 }, 1: { cellWidth: 40 }, 2: { cellWidth: 66 }, 4: { cellWidth: 92, fontSize: 6.5 }, 5: { cellWidth: 60 } },
          foot: ["Total", "", "", `${T.rows.length} entries`, "", num(T.total)], footColor: C.emeraldSoft });
      if (T.backdated.length) {
        section("Back-dated entries left out", C.slate, `Spent before ${day(r.from)}`);
        table(["Spent on", "Entered", "Description", "Amount"], T.backdated.map((e) => [day(e.date), day(e.recordedDate), e.description || "", num(e.amount)]), { amountCols: [3], color: C.slate, fontSize: 7.3 });
      }
      if (T.pending.length) {
        section("Awaiting approval (not counted)", C.amber);
        table(["Date", "Description", "Requested by", "Amount"], T.pending.map((e) => [day(e.date), e.description || "", e.requestedBy || e.addedBy || "-", num(e.amount)]), { amountCols: [3], color: C.amber, fontSize: 7.3 });
      }
    }

    // ================= METHOD & SIGN-OFF =================
    ensure(230);
    if (y > 120) y += 6;
    section("Method", C.night);
    paragraph(`Source: ${audit.bankName || "CRDB"} statement "${audit.uploadedFileName || ""}" (${period}), read and balance-checked by SoMAp. Each transfer is the principal sent; the bank fee and tax on it are shown separately as charges. Transfers the bank returned are excluded. Names linked to ${r.label}: ${S.names.join(", ") || "-"}${S.phones.length ? `; numbers: ${S.phones.join(", ")}` : ""}. The reviewer confirmed each linked name before this report was produced.`, 8.2);
    ensure(90);
    y += 18;
    const sw = (CW - 30) / 3;
    ["Prepared by", "Reviewed by (Director)", `Acknowledged by (${r.label})`].forEach((label, i) => {
      const x = M + i * (sw + 15);
      doc.setDrawColor(...C.slate); doc.setLineWidth(0.6); doc.line(x, y + 30, x + sw, y + 30);
      font(7.5, "bold", C.slate); text(label, x, y + 42);
      font(7, "normal", C.slate); text("Name, signature and date", x, y + 53);
    });

    const pages = doc.getNumberOfPages();
    for (let n = 1; n <= pages; n += 1) {
      doc.setPage(n);
      doc.setDrawColor(...C.line); doc.setLineWidth(0.5); doc.line(M, H - 32, W - M, H - 32);
      font(7.5, "normal", C.slate);
      text(`SoMAp Bank Audit & Analyzer  |  Withdrawal Trace  |  Confidential  |  ${account}`, M, H - 20);
      text(`Page ${n} of ${pages}`, W - M, H - 20, { align: "right" });
    }
    return doc;
  }

  function lastDay(monthKey) { const [y, m] = monthKey.split("-").map(Number); return `${monthKey}-${String(new Date(y, m, 0).getDate()).padStart(2, "0")}`; }
  function fileName(audit, r) {
    return `SoMAp_Withdrawal_Trace_${r.label}_${r.from}_to_${r.to}.pdf`.replace(/[^\w.-]+/g, "_");
  }
  async function download(audit, r) { (await createDocument(audit, r)).save(fileName(audit, r)); }
  global.SomapBankAuditTracePdf = { createDocument, download, fileName };
})(window);
