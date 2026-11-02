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
    const list = filtered();
    const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
    const pageW = doc.internal.pageSize.getWidth();
    const margin = 12;
    const logo = await logoDataUrl();
    if (logo) { try { doc.addImage(logo, 'PNG', margin, 8, 18, 18); } catch (_) {} }
    const textX = logo ? margin + 22 : margin;
    doc.setFont('helvetica', 'bold'); doc.setFontSize(15); doc.setTextColor(30, 27, 75);
    doc.text('SoMAp Finance — Discrepancies Report', textX, 15);
    doc.setFont('helvetica', 'normal'); doc.setFontSize(9.5); doc.setTextColor(71, 85, 105);
    doc.text(`${hooks.schoolName()} · Academic year ${year} · ${view.tab === 'open' ? 'To review' : 'Kept as is'}${view.rule ? ` · ${D().RULES[view.rule].title}` : ''}`, textX, 21);
    doc.text(`Generated ${new Date().toLocaleString()} by ${hooks.userEmail()} · ${list.length} student(s)`, textX, 26);
    doc.setDrawColor(79, 70, 229); doc.setLineWidth(0.6); doc.line(margin, 30, pageW - margin, 30);

    const counts = {};
    list.forEach((r) => (view.tab === 'open' ? r.open : r.kept).forEach((i) => { counts[i.title] = (counts[i.title] || 0) + 1; }));
    doc.setFontSize(9); doc.setTextColor(51, 65, 85);
    doc.text(Object.entries(counts).map(([t, n]) => `${t}: ${n}`).join('   ·   ') || 'No discrepancies.', margin, 36);

    const body = list.map((r, idx) => {
      const issues = view.tab === 'open' ? r.open : r.kept;
      const text = issues.map((i) => {
        const rv = reviews?.[r.id]?.[i.code];
        return `• ${i.title}: ${i.detail}${view.tab === 'kept' && rv ? `\n   Kept by ${rv.by} (${new Date(rv.at).toLocaleDateString()}): ${rv.reason}` : ''}`;
      }).join('\n');
      return [idx + 1, r.student.admissionNumber || r.id, nameOf(r.student), r.student.classLevel || '', money(r.fin.feePerYear),
        money(r.student._classDefaults?.feePerYear), r.student.paymentPlan || '', money(r.fin.paidAmount), text];
    });
    doc.autoTable({
      startY: 40,
      head: [['#', 'Admission No', 'Name', 'Class', 'Fee/yr', 'Class fee', 'Plan', 'Paid', 'What is illogical']],
      body,
      margin: { left: margin, right: margin },
      styles: { fontSize: 7.5, cellPadding: 1.8, valign: 'top', overflow: 'linebreak' },
      headStyles: { fillColor: [79, 70, 229], textColor: 255 },
      alternateRowStyles: { fillColor: [248, 250, 252] },
      columnStyles: { 0: { cellWidth: 7 }, 1: { cellWidth: 36 }, 2: { cellWidth: 36 }, 3: { cellWidth: 20 }, 4: { cellWidth: 18, halign: 'right' }, 5: { cellWidth: 18, halign: 'right' }, 6: { cellWidth: 28 }, 7: { cellWidth: 18, halign: 'right' }, 8: { cellWidth: 'auto' } },
      didDrawPage: () => {
        const h = doc.internal.pageSize.getHeight();
        doc.setFontSize(8); doc.setTextColor(148, 163, 184);
        doc.text('Fix in Per-Student Override (paymentedits.html); every change goes to Approvals before it takes effect.', margin, h - 6);
        doc.text(`Page ${doc.internal.getNumberOfPages()}`, pageW - margin, h - 6, { align: 'right' });
      },
    });
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
