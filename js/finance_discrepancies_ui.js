/**
 * js/finance_discrepancies_ui.js
 * Discrepancies card + review list + PDF for finance.html. Detection rules live in
 * shared/finance_discrepancies.js. Reviews ("Keep as is") are stored per school at
 * financeDiscrepancyReviews/{year}/{studentId}/{ruleCode}; nothing else is written.
 */
(function (global) {
  'use strict';

  const D = () => global.SomapFinanceDiscrepancies;
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const money = (n) => (Math.round(Number(n) || 0)).toLocaleString('en-US');
  const SEVERITY_DOT = { high: 'bg-red-500', medium: 'bg-amber-500' };

  let hooks = null;
  let rows = [];               // [{ id, student, fin, issues, open, kept }]
  let reviews = {};            // studentId -> code -> review
  let reviewsYear = null;
  let view = { tab: 'open', rule: '', q: '' };
  let modal = null;

  function reviewPath(year) { return `financeDiscrepancyReviews/${year}`; }

  async function loadReviews(year, force) {
    if (!force && reviewsYear === String(year)) return;
    try {
      const snap = await hooks.schoolRef(reviewPath(year)).once('value');
      reviews = snap.val() || {};
    } catch (err) {
      console.warn('Discrepancies: reviews read failed', err?.message || err);
      reviews = {};
    }
    reviewsYear = String(year);
  }

  function isKept(id, code, sig) {
    const r = reviews?.[id]?.[code];
    return Boolean(r && r.status === 'kept' && r.signature === sig);
  }

  function compute() {
    const students = hooks.getStudents() || {};
    const out = [];
    Object.entries(students).forEach(([id, student]) => {
      if (!student || student.isGraduated) return;
      let fin;
      try { fin = hooks.compute(student); } catch (_) { return; }
      const issues = D().detect(student, fin);
      if (!issues.length) return;
      const sig = D().signature(student, fin);
      const open = issues.filter((i) => !isKept(id, i.code, sig));
      const kept = issues.filter((i) => isKept(id, i.code, sig));
      out.push({ id, student, fin, sig, issues, open, kept });
    });
    out.sort((a, b) => b.open.length - a.open.length || nameOf(a.student).localeCompare(nameOf(b.student)));
    return out;
  }

  const nameOf = (s) => `${s.firstName || ''} ${s.middleName || ''} ${s.lastName || ''}`.replace(/\s+/g, ' ').trim();

  function renderCard() {
    const card = document.getElementById('discrepancyCard');
    if (!card) return;
    if (hooks.isParent()) { card.style.display = 'none'; return; }
    const openCount = rows.filter((r) => r.open.length).length;
    const keptCount = rows.filter((r) => !r.open.length && r.kept.length).length;
    card.style.display = '';
    card.classList.toggle('discrepancy-alert', openCount > 0);
    document.getElementById('discrepancyCount').textContent = String(openCount);
    document.getElementById('discrepancySub').textContent = openCount
      ? `students to review · ${keptCount} kept as is`
      : (keptCount ? `none open · ${keptCount} kept as is` : 'no illogical figures found');
  }

  function filtered() {
    const q = view.q.trim().toLowerCase();
    return rows.filter((r) => {
      const list = view.tab === 'open' ? r.open : r.kept;
      if (!list.length) return false;
      if (view.tab === 'kept' && r.open.length) return false;
      if (view.rule && !list.some((i) => i.code === view.rule)) return false;
      if (q && !nameOf(r.student).toLowerCase().includes(q) && !String(r.student.admissionNumber || '').toLowerCase().includes(q)) return false;
      return true;
    });
  }

  function ensureModal() {
    if (modal) return modal;
    modal = document.createElement('div');
    modal.id = 'discrepancyModal';
    modal.className = 'fixed inset-0 z-50 hidden';
    modal.innerHTML = `
      <div class="absolute inset-0 bg-slate-900/50" data-dc="close"></div>
      <div class="relative mx-auto my-6 w-[min(1100px,calc(100%-32px))] max-h-[calc(100vh-48px)] flex flex-col bg-white rounded-xl shadow-2xl overflow-hidden">
        <div class="px-5 py-4 border-b flex items-start justify-between gap-4">
          <div>
            <h2 class="text-lg font-semibold text-slate-900">Finance Discrepancies <span id="dcYear" class="text-slate-500 font-normal"></span></h2>
            <p class="text-xs text-slate-500 mt-1">Figures that cannot both be right. Fix them in <b>Per-Student Override</b>; every change there goes to <b>Approvals</b> before it takes effect. If a figure is correct for a known reason, choose <b>Keep as is</b> and write why.</p>
          </div>
          <button class="text-slate-500 hover:text-slate-900 text-xl leading-none" data-dc="close" aria-label="Close">&times;</button>
        </div>
        <div class="px-5 py-3 border-b flex flex-wrap items-center gap-2">
          <button class="px-3 py-1 rounded-full text-sm border" data-dc-tab="open"></button>
          <button class="px-3 py-1 rounded-full text-sm border" data-dc-tab="kept"></button>
          <select id="dcRule" class="p-1.5 border rounded text-sm"></select>
          <input id="dcSearch" type="search" placeholder="Search name or admission no." class="p-1.5 border rounded text-sm flex-1 min-w-[180px]" />
          <a href="Tofinancehtml/paymentedits.html" target="_blank" rel="noopener" class="px-3 py-1.5 border rounded text-sm text-indigo-700">Open Per-Student Override</a>
          <button id="dcPdf" class="px-3 py-1.5 bg-red-600 text-white rounded text-sm"><i class="fa fa-file-pdf mr-1"></i> Download PDF</button>
        </div>
        <div id="dcList" class="overflow-y-auto px-5 py-4 space-y-3 bg-slate-50"></div>
      </div>`;
    document.body.appendChild(modal);
    modal.addEventListener('click', onModalClick);
    modal.querySelector('#dcRule').addEventListener('change', (e) => { view.rule = e.target.value; renderList(); });
    modal.querySelector('#dcSearch').addEventListener('input', (e) => { view.q = e.target.value; renderList(); });
    modal.querySelector('#dcPdf').addEventListener('click', downloadPdf);
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !modal.classList.contains('hidden')) closeModal(); });
    return modal;
  }

  function renderList() {
    if (!modal || modal.classList.contains('hidden')) return;
    const year = hooks.getYear();
    modal.querySelector('#dcYear').textContent = `· ${year}`;
    const openN = rows.filter((r) => r.open.length).length;
    const keptN = rows.filter((r) => !r.open.length && r.kept.length).length;
    modal.querySelectorAll('[data-dc-tab]').forEach((btn) => {
      const tab = btn.getAttribute('data-dc-tab');
      btn.textContent = tab === 'open' ? `To review (${openN})` : `Kept as is (${keptN})`;
      btn.className = `px-3 py-1 rounded-full text-sm border ${view.tab === tab ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-white text-slate-700'}`;
    });
    const ruleSel = modal.querySelector('#dcRule');
    ruleSel.innerHTML = '<option value="">All types</option>' + Object.entries(D().RULES)
      .map(([code, r]) => `<option value="${code}" ${view.rule === code ? 'selected' : ''}>${esc(r.title)}</option>`).join('');

    const list = filtered();
    const box = modal.querySelector('#dcList');
    if (!list.length) {
      box.innerHTML = `<div class="text-center text-slate-500 py-10">${view.tab === 'open' ? 'Nothing to review. Every figure is logical or has been reviewed.' : 'Nothing has been kept as is.'}</div>`;
      return;
    }
    box.innerHTML = list.map((r) => {
      const s = r.student;
      const issues = view.tab === 'open' ? r.open : r.kept;
      const adm = s.admissionNumber || r.id;
      const fixUrl = `Tofinancehtml/paymentedits.html?student=${encodeURIComponent(adm)}&year=${encodeURIComponent(year)}`;
      const keptNote = view.tab === 'kept'
        ? issues.map((i) => { const rv = reviews?.[r.id]?.[i.code] || {}; return `<div class="text-xs text-slate-600 mt-1"><i class="fa fa-check text-emerald-600 mr-1"></i>${esc(i.title)}: kept by ${esc(rv.by || '?')} on ${rv.at ? new Date(rv.at).toLocaleDateString() : '?'} — “${esc(rv.reason || '')}”</div>`; }).join('')
        : '';
      return `
        <div class="bg-white border rounded-lg p-4">
          <div class="flex flex-wrap items-start justify-between gap-3">
            <div>
              <div class="font-semibold text-slate-900">${esc(nameOf(s))} <span class="text-slate-500 font-normal">· ${esc(adm)} · ${esc(s.classLevel || '')}</span></div>
              <div class="text-xs text-slate-600 mt-1">Fee/year <b>${money(r.fin.feePerYear)}</b> · Class fee <b>${money(s._classDefaults?.feePerYear)}</b> · Plan <b>${esc(s.paymentPlan || '-')}</b> · Paid <b>${money(r.fin.paidAmount)}</b> · Balance <b>${money(r.fin.balance)}</b></div>
            </div>
            <div class="flex flex-wrap gap-2">
              <a href="${fixUrl}" target="_blank" rel="noopener" class="px-3 py-1.5 bg-indigo-600 text-white rounded text-sm">Fix in Per-Student Override <i class="fa fa-arrow-right ml-1"></i></a>
              ${view.tab === 'open'
                ? `<button class="px-3 py-1.5 border rounded text-sm text-slate-700" data-dc-keep="${esc(r.id)}">Keep as is</button>`
                : `<button class="px-3 py-1.5 border rounded text-sm text-slate-700" data-dc-reopen="${esc(r.id)}">Reopen</button>`}
            </div>
          </div>
          <ul class="mt-3 space-y-1.5">
            ${issues.map((i) => `<li class="flex gap-2 text-sm"><span class="mt-1.5 h-2 w-2 shrink-0 rounded-full ${SEVERITY_DOT[i.severity] || 'bg-slate-400'}"></span><span><b>${esc(i.title)}.</b> ${esc(i.detail)}</span></li>`).join('')}
          </ul>
          ${keptNote}
        </div>`;
    }).join('');
  }

  async function onModalClick(e) {
    const t = e.target.closest('[data-dc],[data-dc-tab],[data-dc-keep],[data-dc-reopen]');
    if (!t) return;
    if (t.getAttribute('data-dc') === 'close') return closeModal();
    if (t.hasAttribute('data-dc-tab')) { view.tab = t.getAttribute('data-dc-tab'); return renderList(); }
    const year = hooks.getYear();
    const keepId = t.getAttribute('data-dc-keep');
    const reopenId = t.getAttribute('data-dc-reopen');
    const row = rows.find((r) => r.id === (keepId || reopenId));
    if (!row) return;
    try {
      if (keepId) {
        const reason = String(global.prompt(`Keep as is for ${nameOf(row.student)}?\n\nWrite why these figures are correct (required):`) || '').trim();
        if (!reason) return;
        const updates = {};
        const by = hooks.userEmail();
        row.open.forEach((i) => {
          updates[i.code] = { status: 'kept', reason, by, at: Date.now(), signature: row.sig, title: i.title, detail: i.detail };
        });
        await hooks.schoolRef(`${reviewPath(year)}/${row.id}`).update(updates);
      } else {
        const updates = {};
        row.kept.forEach((i) => { updates[i.code] = null; });
        await hooks.schoolRef(`${reviewPath(year)}/${row.id}`).update(updates);
      }
      await refresh(true);
    } catch (err) {
      console.error('Discrepancies: review save failed', err);
      alert('Could not save the review: ' + (err?.message || err));
    }
  }

  function openModal() {
    ensureModal();
    modal.classList.remove('hidden');
    document.body.style.overflow = 'hidden';
    renderList();
  }
  function closeModal() {
    if (!modal) return;
    modal.classList.add('hidden');
    document.body.style.overflow = '';
  }

  async function logoDataUrl() {
    for (const path of ['images/somap-logo.png', 'images/somap-logo.png.jpg']) {
      try {
        const blob = await fetch(path).then((r) => { if (!r.ok) throw new Error(r.status); return r.blob(); });
        return await new Promise((res, rej) => { const fr = new FileReader(); fr.onload = () => res(fr.result); fr.onerror = rej; fr.readAsDataURL(blob); });
      } catch (_) { /* try next */ }
    }
    return null;
  }

  async function downloadPdf() {
    const { jsPDF } = global.jspdf || {};
    if (!jsPDF) return alert('PDF library not loaded.');
    const year = hooks.getYear();
    // A4 portrait, readable sizes, compact rows: name bold with admission no / plan in grey
    // under it; short issue labels with a coloured dot; long meanings printed once as a legend.
    const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
    const pageW = doc.internal.pageSize.getWidth();
    const pageH = doc.internal.pageSize.getHeight();
    const margin = 12;
    const contentW = pageW - margin * 2;
    const INK = [15, 23, 42], MUTED = [100, 116, 139], FAINT = [148, 163, 184], INDIGO = [67, 56, 202];
    const RULE_COLOR = {
      PAID_OVER_FEE: [220, 38, 38], FEE_BELOW_CLASS: [234, 88, 12], PLAN_TOTAL_MISMATCH: [190, 24, 93],
      FEE_ZERO: [71, 85, 105], FEE_ABOVE_CLASS: [202, 138, 4],
    };
    const tint = (rgb) => rgb.map((c) => Math.round(c + (255 - c) * 0.9));
    const kept = view.tab === 'kept';
    const issuesOf = (r) => (kept ? r.kept : r.open);
    const classRank = (c) => { const i = ['Baby Class', 'Middle Class', 'Pre Unit Class', 'Class 1', 'Class 2', 'Class 3', 'Class 4', 'Class 5', 'Class 6', 'Class 7'].indexOf(c); return i < 0 ? 99 : i; };
    const list = filtered().slice().sort((a, b) => classRank(a.student.classLevel) - classRank(b.student.classLevel) || nameOf(a.student).localeCompare(nameOf(b.student)));

    // Header
    const logo = await logoDataUrl();
    if (logo) { try { doc.addImage(logo, 'PNG', margin, 10, 17, 17); } catch (_) {} }
    const textX = logo ? margin + 21 : margin;
    doc.setFont('helvetica', 'bold'); doc.setFontSize(16); doc.setTextColor(...INK);
    doc.text('Finance Discrepancies', textX, 16.5);
    doc.setFont('helvetica', 'normal'); doc.setFontSize(10); doc.setTextColor(...MUTED);
    doc.text(`${hooks.schoolName()}  ·  Academic year ${year}  ·  ${kept ? 'Kept as is' : 'To review'}${view.rule ? `  ·  ${D().RULES[view.rule].title}` : ''}`, textX, 22);
    doc.setFontSize(8); doc.setTextColor(...FAINT);
    doc.text(`Generated ${new Date().toLocaleString()} by ${hooks.userEmail()}`, textX, 26.5);
    doc.setFont('helvetica', 'bold'); doc.setFontSize(22); doc.setTextColor(...INDIGO);
    doc.text(String(list.length), pageW - margin, 18, { align: 'right' });
    doc.setFont('helvetica', 'normal'); doc.setFontSize(8); doc.setTextColor(...MUTED);
    doc.text('students listed', pageW - margin, 23, { align: 'right' });
    doc.setDrawColor(...INDIGO); doc.setLineWidth(0.5); doc.line(margin, 31, pageW - margin, 31);

    // Count tiles, one per rule
    const codes = Object.keys(D().RULES);
    const counts = Object.fromEntries(codes.map((c) => [c, 0]));
    list.forEach((r) => issuesOf(r).forEach((i) => { counts[i.code] += 1; }));
    const gap = 3, tileW = (contentW - gap * (codes.length - 1)) / codes.length, tileH = 17, tileY = 35;
    codes.forEach((code, i) => {
      const x = margin + i * (tileW + gap);
      const color = RULE_COLOR[code];
      doc.setFillColor(...tint(color)); doc.setDrawColor(...color); doc.setLineWidth(0.3);
      doc.roundedRect(x, tileY, tileW, tileH, 2, 2, 'FD');
      doc.setFont('helvetica', 'bold'); doc.setFontSize(14); doc.setTextColor(...color);
      doc.text(String(counts[code]), x + 3, tileY + 7);
      doc.setFont('helvetica', 'normal'); doc.setFontSize(7); doc.setTextColor(...INK);
      doc.text(doc.splitTextToSize(D().RULES[code].title, tileW - 6), x + 3, tileY + 11.2);
    });

    // Legend: what each flag means (printed once, so table rows stay short)
    let y = tileY + tileH + 6;
    doc.setFont('helvetica', 'bold'); doc.setFontSize(9); doc.setTextColor(...INK);
    doc.text('What each flag means', margin, y);
    y += 4.5;
    codes.forEach((code) => {
      const color = RULE_COLOR[code];
      doc.setFillColor(...color); doc.circle(margin + 1.2, y - 1, 1.1, 'F');
      doc.setFont('helvetica', 'bold'); doc.setFontSize(8); doc.setTextColor(...INK);
      const title = `${D().RULES[code].title}: `;
      doc.text(title, margin + 4, y);
      const titleW = doc.getTextWidth(title);
      doc.setFont('helvetica', 'normal'); doc.setTextColor(...MUTED);
      const lines = doc.splitTextToSize(D().LEGEND[code] || '', contentW - 4 - titleW);
      doc.text(lines, margin + 4 + titleW, y);
      y += 4 * lines.length + 0.6;
    });
    doc.setFontSize(8); doc.setTextColor(...MUTED);
    doc.text('Fix each one in Finance > Per-Student Override; every change there goes to Approvals before it takes effect.', margin, y + 1.5);
    y += 6;

    // Table
    const W = { idx: 7, student: 58, cls: 18, fee: 19, clsFee: 19, paid: 19 };
    W.issues = contentW - (W.idx + W.student + W.cls + W.fee + W.clsFee + W.paid);
    const PAD = 1.6;
    const nameFont = 8.5, subFont = 7, issueFont = 7.8;
    const body = list.map((r, idx) => {
      const s = r.student;
      doc.setFont('helvetica', 'bold'); doc.setFontSize(nameFont);
      const nameLines = doc.splitTextToSize(nameOf(s), W.student - PAD * 2);
      doc.setFont('helvetica', 'normal'); doc.setFontSize(subFont);
      const subLines = doc.splitTextToSize(`${s.admissionNumber || r.id}  ·  ${s.paymentPlan || '-'}`, W.student - PAD * 2);
      doc.setFontSize(issueFont);
      const issueItems = issuesOf(r).map((i) => {
        const rv = reviews?.[r.id]?.[i.code];
        return {
          color: RULE_COLOR[i.code] || MUTED,
          lines: doc.splitTextToSize(i.short || i.title, W.issues - PAD * 2 - 3),
          note: kept && rv ? doc.splitTextToSize(`Kept: ${rv.reason} (${rv.by}, ${new Date(rv.at).toLocaleDateString()})`, W.issues - PAD * 2 - 3) : [],
        };
      });
      const studentLineCount = nameLines.length + subLines.length * 0.85;
      const issueLineCount = issueItems.reduce((n, it) => n + it.lines.length + it.note.length * 0.9, 0);
      const lineH = 3.5;
      const minH = Math.max(studentLineCount, issueLineCount, 1) * lineH + PAD * 2;
      return [
        { content: String(idx + 1), styles: { minCellHeight: minH } },
        { content: '', _draw: { nameLines, subLines } },
        String(s.classLevel || '').replace(/^(Baby|Middle|Pre Unit) Class$/, '$1'),
        money(r.fin.feePerYear),
        money(s._classDefaults?.feePerYear),
        money(r.fin.paidAmount),
        { content: '', _issues: issueItems },
      ];
    });

    doc.autoTable({
      startY: y,
      head: [['#', 'Student', 'Class', 'Fee / year', 'Class fee', 'Paid', 'What is illogical']],
      body,
      theme: 'plain',
      margin: { left: margin, right: margin, top: 18, bottom: 14 },
      styles: { font: 'helvetica', fontSize: 8, cellPadding: PAD, valign: 'top', textColor: INK, lineColor: [226, 232, 240], lineWidth: { bottom: 0.2 } },
      headStyles: { fillColor: INDIGO, textColor: 255, fontStyle: 'bold', fontSize: 8, valign: 'middle', lineWidth: 0 },
      alternateRowStyles: { fillColor: [248, 250, 252] },
      columnStyles: {
        0: { cellWidth: W.idx, textColor: FAINT },
        1: { cellWidth: W.student },
        2: { cellWidth: W.cls },
        3: { cellWidth: W.fee, halign: 'right' },
        4: { cellWidth: W.clsFee, halign: 'right', textColor: MUTED },
        5: { cellWidth: W.paid, halign: 'right', fontStyle: 'bold' },
        6: { cellWidth: W.issues },
      },
      didDrawCell: (data) => {
        if (data.section !== 'body') return;
        const raw = data.cell.raw || {};
        const x = data.cell.x + PAD;
        let ty = data.cell.y + PAD + 2.6;
        if (raw._draw) {
          doc.setFont('helvetica', 'bold'); doc.setFontSize(nameFont); doc.setTextColor(...INK);
          raw._draw.nameLines.forEach((line) => { doc.text(line, x, ty); ty += 3.5; });
          doc.setFont('helvetica', 'normal'); doc.setFontSize(subFont); doc.setTextColor(...MUTED);
          raw._draw.subLines.forEach((line) => { doc.text(line, x, ty - 0.3); ty += 3; });
        }
        if (raw._issues) {
          doc.setFont('helvetica', 'normal'); doc.setFontSize(issueFont);
          raw._issues.forEach((it) => {
            doc.setFillColor(...it.color); doc.circle(x + 0.9, ty - 1, 0.9, 'F');
            doc.setTextColor(...INK);
            it.lines.forEach((line) => { doc.text(line, x + 3, ty); ty += 3.5; });
            if (it.note.length) {
              doc.setFontSize(7); doc.setTextColor(...MUTED);
              it.note.forEach((line) => { doc.text(line, x + 3, ty - 0.3); ty += 3.1; });
              doc.setFontSize(issueFont);
            }
          });
        }
      },
      didDrawPage: (data) => {
        if (data.pageNumber > 1) {
          doc.setFont('helvetica', 'bold'); doc.setFontSize(9); doc.setTextColor(...INK);
          doc.text('Finance Discrepancies', margin, 11);
          doc.setFont('helvetica', 'normal'); doc.setFontSize(8); doc.setTextColor(...MUTED);
          doc.text(`${hooks.schoolName()}  ·  ${year}  ·  ${kept ? 'Kept as is' : 'To review'}`, pageW - margin, 11, { align: 'right' });
          doc.setDrawColor(226, 232, 240); doc.setLineWidth(0.3); doc.line(margin, 13, pageW - margin, 13);
        }
      },
    });
    const totalPages = doc.internal.getNumberOfPages();
    for (let p = 1; p <= totalPages; p++) {
      doc.setPage(p);
      doc.setFont('helvetica', 'normal'); doc.setFontSize(7.5); doc.setTextColor(...FAINT);
      doc.text('SoMAp  ·  School Management Platform', margin, pageH - 7);
      doc.text(`Page ${p} of ${totalPages}`, pageW - margin, pageH - 7, { align: 'right' });
    }
    doc.save(`finance-discrepancies-${year}-${view.tab}.pdf`);
  }

  async function refresh(forceReviews) {
    if (!hooks || !D()) return;
    if (hooks.isParent()) { renderCard(); return; }
    await loadReviews(hooks.getYear(), forceReviews);
    rows = compute();
    renderCard();
    renderList();
  }

  function mount(h) {
    hooks = h;
    const card = document.getElementById('discrepancyCard');
    if (card) card.addEventListener('click', openModal);
  }

  global.SomapFinanceDiscrepanciesUI = { mount, refresh, open: openModal };
})(typeof window !== 'undefined' ? window : globalThis);
