// SoMAp Daily Inventory — Head Teacher review (approval by exception).
// Clean reports (no new damage, loss, Not OK, flag or count change) are approved
// together with one tap, each logged individually. Everything else is opened and
// approved or returned one by one. Used by the attendance check-out gate and by
// inventoryreports.html.
(function (global) {
  'use strict';
  const INV = global.SomapInventory;
  const UI = global.SomapInventoryUI;
  if (!INV || !UI) { console.warn('SomapInventoryReview: core/ui scripts missing'); return; }
  const { esc, n0, todayYMD, fmtTime, fmtDaySw } = INV.util;

  function reasonTags(r) {
    return (r.review?.reasons || []).map((k) => `<span class="inv-tag inv-tag--${k === 'sampled' ? 'info' : k === 'baseline' ? 'muted' : 'warn'}">${esc(INV.REASON_LABELS[k] || k)}</span>`).join(' ');
  }
  function sourceTag(source) {
    return source === 'spotCheck'
      ? '<span class="inv-tag inv-tag--bad">Imegunduliwa ukaguzini · Found by spot check</span>'
      : '<span class="inv-tag inv-tag--good">Imeripotiwa na mhusika · Self-reported</span>';
  }
  function problemList(r) {
    const list = (r.problems || []).filter((p) => p.kind !== 'expiresSoon');
    if (!list.length) return '';
    return `<div class="inv-list">${list.map((p) => `<div class="inv-li" style="padding:8px 10px">
      <div class="inv-li__head"><div class="inv-li__title">${esc(p.itemName || p.itemId)} — ${esc(INV.PROBLEM_LABELS[p.kind] || p.kind)}${n0(p.qty) > 1 || p.kind === 'mismatch' ? ` (${p.kind === 'mismatch' ? `${p.expected}→${p.total}` : `×${n0(p.qty)}`})` : ''}${p.isNew === false && ['damaged', 'notOk'].includes(p.kind) ? ' <span class="inv-tag inv-tag--muted">inasubiri matengenezo</span>' : ''}</div>
        ${['damaged', 'lost', 'notOk'].includes(p.kind) ? sourceTag(p.source) : ''}</div>
      ${p.desc || p.who ? `<div class="inv-li__meta">${esc(p.desc || '')}${p.who ? ` · Nani/jinsi: ${esc(p.who)}` : ''}</div>` : ''}</div>`).join('')}</div>`;
  }
  function reportDetailHtml(r) {
    const rows = Object.entries(r.items || {}).map(([id, v]) => {
      const def = r.itemDefs?.[id] || INV.catalogDef(id) || { sw: id };
      const txt = v.type === 'count' ? `${n0(v.good)} / ${n0(v.damaged)} / ${n0(v.lost)}` : v.type === 'cond' ? (v.ok === false ? '✖ Si sawa' : '✔ Sawa') : v.type === 'cons' ? `${n0(v.qty)}${v.restock ? ' · ongeza' : ''}` : (v.value || '');
      const bad = (v.type === 'count' && (n0(v.damaged) || n0(v.lost))) || v.ok === false;
      return `<tr class="${bad ? 'is-bad' : ''}"><td>${esc(def.sw)}</td><td>${esc(txt)}</td><td>${esc(v.desc || '')}${v.awaitingRepairDays ? ` <span class="inv-tag inv-tag--warn">siku ${v.awaitingRepairDays}</span>` : ''}</td></tr>`;
    }).join('');
    return `<p class="inv-card__sub">${esc(r.workerName)} · ${esc(INV.roleLabel(r.role))} · ${esc(r.area || '')} · ${esc(fmtDaySw(r.ymd))} saa ${fmtTime(r.submittedAt)}${r.noChanges ? ' · Hakuna mabadiliko' : ''}</p>
      ${reasonTags(r)}
      <div class="inv-table-wrap" style="margin-top:8px"><table class="inv-table"><thead><tr><th>Kitu · Item</th><th>Vizima / vibovu / vimepotea · Hali</th><th>Maelezo</th></tr></thead><tbody>${rows}</tbody></table></div>`;
  }

  // Renders the review queue for one day into `container`. opts.onChange(queue) after each render.
  async function renderQueue(container, ctx, ymd, opts = {}) {
    container.classList.add('inv-scope');
    container.innerHTML = '<div class="inv-loading">Inapakia ripoti… · Loading reports…</div>';
    const settings = await INV.loadSettings(ctx, INV.util.yearOf(ymd));
    const queue = await INV.getQueue(ctx, ymd);
    const roster = await INV.loadRoster(ctx, INV.util.yearOf(ymd)).catch(() => []);
    const enabledIds = roster.map((w) => w.workerId).filter((id) => INV.isEnabledFor(settings, id) && id !== ctx.workerId);
    const day = {}; queue.all.forEach((r) => { day[r.workerId] = r; });
    const missing = ymd === todayYMD() || opts.includeMissing ? await INV.notSubmitted(ctx, ymd, enabledIds, day).catch(() => []) : [];
    const nameOf = (wid) => roster.find((w) => w.workerId === wid)?.name || wid;
    const own = queue.own;
    container.innerHTML = `
      ${opts.showOwn !== false && ctx.workerId ? `<div class="inv-banner inv-banner--${own && ['submitted', 'approved'].includes(own.status) ? 'good' : 'warn'}"><span class="inv-banner__icon">🧾</span><div class="inv-banner__body"><strong>Hesabu yako · Your own inventory: ${own ? esc(own.status) : 'haijajazwa'}</strong>Ripoti yako huidhinishwa na Admin / Mkurugenzi · Your report is approved by Admin / Director.</div></div>` : ''}
      <div class="inv-stats">
        <div class="inv-stat inv-stat--good"><p class="inv-stat__label">Safi · Clean</p><div class="inv-stat__value">${queue.clean.length}</div></div>
        <div class="inv-stat inv-stat--warn"><p class="inv-stat__label">Zinahitaji kupitiwa · Needs review</p><div class="inv-stat__value">${queue.review.length}</div></div>
        <div class="inv-stat"><p class="inv-stat__label">Zimeidhinishwa · Approved</p><div class="inv-stat__value">${queue.approved.length}</div></div>
        <div class="inv-stat"><p class="inv-stat__label">Zimerudishwa · Returned</p><div class="inv-stat__value">${queue.returned.length}</div></div>
        <div class="inv-stat ${missing.length ? 'inv-stat--bad' : ''}"><p class="inv-stat__label">Hawakujaza · Not submitted</p><div class="inv-stat__value">${missing.length}</div></div>
      </div>
      <div class="inv-card">
        <h3>✅ Ripoti safi · Clean reports (${queue.clean.length})</h3>
        <p class="inv-card__sub">Hakuna uharibifu mpya, upotevu, "si sawa", hitilafu wala mabadiliko ya idadi · No new damage, loss, Not OK, flags or count changes.</p>
        ${queue.clean.length ? `<p class="inv-small">${queue.clean.map((r) => `${esc(r.workerName)} (${esc(r.area || '')})`).join(' · ')}</p>
          <button class="inv-btn inv-btn--good inv-btn--block" data-rv="bulk">Idhinisha zote safi (${queue.clean.length}) · Approve all clean (${queue.clean.length})</button>` : '<p class="inv-empty">Hakuna zinazosubiri · None pending</p>'}
      </div>
      <div class="inv-card">
        <h3>🔎 Zinahitaji kupitiwa · Needs review (${queue.review.length})</h3>
        ${queue.review.length ? `<div class="inv-list">${queue.review.map((r) => `<div class="inv-li" data-wid="${esc(r.workerId)}">
          <div class="inv-li__head"><div><div class="inv-li__title">${esc(r.workerName)} · ${esc(INV.roleLabel(r.role))}</div><div class="inv-li__meta">📍 ${esc(r.area || '')} · saa ${fmtTime(r.submittedAt)}${r.resubmittedCount ? ` · imewasilishwa tena mara ${r.resubmittedCount}` : ''}</div></div>
            <div class="inv-li__actions"><button class="inv-btn inv-btn--sm" data-rv="view" data-w="${esc(r.workerId)}">Angalia · View</button></div></div>
          <div>${reasonTags(r)}</div>
          ${problemList(r)}
          <div class="inv-li__actions"><button class="inv-btn inv-btn--good inv-btn--sm" data-rv="approve" data-w="${esc(r.workerId)}">✔ Idhinisha · Approve</button><button class="inv-btn inv-btn--bad inv-btn--sm" data-rv="return" data-w="${esc(r.workerId)}">↩ Rudisha · Return</button></div>
        </div>`).join('')}</div>` : '<p class="inv-empty">Hakuna · None</p>'}
      </div>
      ${missing.length ? `<div class="inv-card"><h3 style="color:var(--inv-bad)">⚠️ Hawakujaza · Not submitted (${missing.length})</h3><p class="inv-card__sub">Walifanya check-in lakini hawajawasilisha hesabu. Hawazuii check-out yako, ila wataonekana kwa rangi nyekundu kwenye PDF.</p>
        <div class="inv-list">${missing.map((m) => `<div class="inv-li"><div class="inv-li__title" style="color:var(--inv-bad)">${esc(nameOf(m.workerId))}</div><div class="inv-li__meta">Check-in ${fmtTime(m.checkInTs)} · ${m.status === 'returned' ? 'Imerudishwa, haijarekebishwa' : 'Haijawasilishwa'}</div></div>`).join('')}</div></div>` : ''}`;

    const rerender = () => renderQueue(container, ctx, ymd, opts);
    container.onclick = async (e) => {
      const btn = e.target.closest('[data-rv]');
      if (!btn) return;
      const kind = btn.dataset.rv; const wid = btn.dataset.w;
      if (kind === 'view') {
        const r = queue.all.find((x) => x.workerId === wid);
        if (r) await UI.modal({ title: 'Ripoti · Report', html: reportDetailHtml(r) });
        return;
      }
      btn.disabled = true;
      if (kind === 'bulk') {
        const res = await INV.approveMany(ctx, ymd, queue.clean.map((r) => r.workerId), 'bulk');
        const failed = res.filter((x) => !x.ok);
        UI.toast(failed.length ? `Zimeshindikana ${failed.length}: ${failed[0].message}` : `Ripoti ${res.length} zimeidhinishwa · Approved`, failed.length ? 'warning' : 'success');
      } else if (kind === 'approve') {
        const res = await INV.approveMany(ctx, ymd, [wid], 'single');
        if (!res[0].ok) UI.toast(res[0].message, 'error'); else UI.toast('Imeidhinishwa · Approved', 'success');
      } else if (kind === 'return') {
        const comment = await UI.promptText('Rudisha ripoti · Return report', 'Mweleze mfanyakazi cha kurekebisha · Tell the worker what to fix', { minLength: 5, kind: 'bad', okLabel: 'Rudisha · Return' });
        if (comment) { const res = await INV.returnReport(ctx, ymd, wid, comment); UI.toast(res.ok ? 'Imerudishwa · Returned' : res.message, res.ok ? 'success' : 'error'); }
      }
      await rerender();
    };
    if (typeof opts.onChange === 'function') opts.onChange(queue, missing);
    return { queue, missing };
  }

  // Check-out gate for the Head Teacher: every report submitted today must be reviewed.
  async function headteacherGate(ctx) {
    const ymd = ctx.ymd || todayYMD();
    const first = await INV.getQueue(ctx, ymd);
    if (!first.pendingCount) return { ok: true };
    let pending = first.pendingCount;
    const result = await UI.modal({
      title: 'Idhinisha hesabu za leo kabla ya kuondoka · Review today\'s inventory',
      html: '<div data-rvq></div>',
      actions: [
        { label: 'Funga · Close', value: false },
        { label: 'Endelea na check-out · Continue', value: true, kind: 'primary', validate: () => { if (pending > 0) { UI.toast(`Bado ripoti ${pending} hazijapitiwa · ${pending} still pending`, 'warning'); return false; } return true; } },
      ],
      onMount: (card) => { renderQueue(card.querySelector('[data-rvq]'), ctx, ymd, { onChange: (q) => { pending = q.pendingCount; } }); },
    });
    if (!result) return { ok: false, message: `Mwalimu Mkuu hawezi kuondoka kabla ya kupitia ripoti ${pending} za hesabu ya mali · Review the pending inventory reports first.` };
    return { ok: true };
  }

  // After the Head Teacher checks out: the day's inventory PDF opens.
  async function headteacherAfterCheckout(ctx) {
    if (!global.SomapInventoryPDF) return;
    const ymd = ctx.ymd || todayYMD();
    UI.toast('Inaandaa ripoti ya mali ya leo (PDF)… · Preparing today\'s inventory PDF…', 'info', 5000);
    const res = await global.SomapInventoryPDF.download(ctx, ymd, ymd);
    await UI.modal({
      title: 'Ripoti ya mali ya leo · Today\'s inventory report',
      html: `<p>PDF imepakuliwa: <b>${esc(res.filename)}</b></p>${res.url ? `<p><a class="inv-btn inv-btn--primary" href="${esc(res.url)}" target="_blank" rel="noopener">📄 Fungua PDF · Open PDF</a></p>` : ''}`,
    });
  }

  global.SomapInventoryReview = { renderQueue, reportDetailHtml, problemList, reasonTags, sourceTag };
  global.SomapInventoryAttendance = Object.assign(global.SomapInventoryAttendance || {}, { headteacherGate, headteacherAfterCheckout });
})(window);
