// SoMAp Daily Inventory — cards mounted into existing pages.
// A host page only adds <div data-somap-inventory-card="VARIANT"></div> and the scripts:
//   hub          the worker's own "Hesabu ya Mali" card (every role hub)
//   headteacher  "Ukaguzi wa Mali" start card (Teacher Dashboard, Head Teacher only)
//   watch        Mlinzi school-wide watch summary with "Nimeona taarifa"
//   digest       director daily digest (admin / director on the main dashboard)
//   badge        "Hesabu ya leo ✔/✖" badge on the worker's hub card (workers dashboard)
// Nothing renders when the module is not switched on for the viewer (pilot mode).
(function (global) {
  'use strict';
  const INV = global.SomapInventory;
  const UI = global.SomapInventoryUI;
  if (!INV || !UI) { console.warn('SomapInventory hub card: core/ui scripts missing'); return; }
  const { esc, n0, todayYMD, fmtTime, weekMonday } = INV.util;
  const T = INV.T;

  function card(el, html) {
    el.classList.add('inv-scope');
    el.style.maxWidth = el.dataset.maxWidth || '';
    el.innerHTML = html;
    el.hidden = false;
    el.classList.remove('hidden');
  }
  const pill = (ok, text) => `<span class="inv-tag inv-tag--${ok ? 'good' : 'bad'}">${ok ? '✔' : '✖'} ${esc(text)}</span>`;
  const statBox = (label, value, kind, go) => `<div class="inv-stat ${kind ? `inv-stat--${kind}` : ''}" ${go ? `data-go="${esc(go)}"` : ''}><p class="inv-stat__label">${esc(label)}</p><div class="inv-stat__value">${esc(value)}</div></div>`;
  const wrapStyle = 'margin:12px auto;max-width:1080px;padding:0 12px;';

  async function mountHub(el, ctx, settings) {
    if (!INV.isEnabledFor(settings, ctx.workerId)) { el.hidden = true; return; }
    const ymd = todayYMD();
    const [st, docket] = await Promise.all([INV.todayStatus(ctx, ctx.workerId, ymd), INV.val(INV.iref(ctx, ctx.year, `dockets/${ctx.workerId}`))]);
    const incoming = Object.values(docket?.incoming || {}).filter((m) => m && m.status === 'pending').length;
    const handovers = Object.values((await INV.val(INV.iref(ctx, ctx.year, 'handovers'))) || {}).filter((h) => h && h.type === 'change' && h.status === 'awaitingConfirm' &&
      ((h.fromWorkerId === ctx.workerId && !h.fromConfirmedAt) || (h.toWorkerId === ctx.workerId && !h.toConfirmedAt))).length;
    const area = docket?.area || ctx.profile?.docketArea || T.DEFAULT_AREAS[ctx.roleKey] || '';
    const statusText = st.status === 'approved' ? `Imeidhinishwa · ${fmtTime(st.report?.approvedAt)}` : st.done ? `Imewasilishwa · ${fmtTime(st.submittedAt)}` : st.status === 'returned' ? 'Imerudishwa · Returned' : 'Bado · Not yet';
    card(el, `<div style="${wrapStyle}"><div class="inv-card" style="margin:0">
      <div class="inv-li__head"><div><h3>🧾 Hesabu ya Mali · Inventory</h3><p class="inv-card__sub" style="margin:0">${area ? `📍 ${esc(area)} · ` : ''}Jaza kila siku kabla ya kuondoka · Fill daily before check-out</p></div>${pill(st.done, statusText)}</div>
      ${st.status === 'returned' ? `<div class="inv-banner inv-banner--bad"><span class="inv-banner__icon">↩️</span><div class="inv-banner__body"><strong>Ripoti imerudishwa · Report returned</strong>"${esc(st.returnComment)}"</div></div>` : ''}
      ${incoming ? `<div class="inv-banner inv-banner--info"><span class="inv-banner__icon">📦</span><div class="inv-banner__body"><strong>Vitu ${incoming} vinasubiri upokee · ${incoming} incoming</strong>Kubali ukiwa umevipokea · Accept once received.</div></div>` : ''}
      ${handovers ? `<div class="inv-banner inv-banner--warn"><span class="inv-banner__icon">🤝</span><div class="inv-banner__body"><strong>Makabidhiano yanasubiri uthibitisho wako · Handover awaiting you</strong></div></div>` : ''}
      <div style="margin-top:10px"><a class="inv-btn ${st.done ? '' : 'inv-btn--primary'}" href="${esc(INV.URLS.inventory)}">${st.done ? 'Fungua · Open' : 'Jaza sasa · Fill now'}</a></div>
    </div></div>`);
  }

  async function headteacherNumbers(ctx, ymd) {
    const settings = await INV.loadSettings(ctx, ctx.year);
    const [queue, roster, repairs, spot, plan] = await Promise.all([
      INV.getQueue(ctx, ymd, { sample: false }), INV.loadRoster(ctx, ctx.year), INV.listRepairs(ctx, ctx.year), INV.weekSpotStats(ctx, ymd).catch(() => null),
      INV.ensureWeekPlan(ctx, ymd).catch(() => null),
    ]);
    const enabledIds = roster.map((w) => w.workerId).filter((id) => INV.isEnabledFor(settings, id) && id !== ctx.workerId);
    const day = {}; queue.all.forEach((r) => { day[r.workerId] = r; });
    const missing = await INV.notSubmitted(ctx, ymd, enabledIds, day);
    let damaged = 0; let lost = 0; let notOk = 0;
    queue.all.forEach((r) => (r.problems || []).forEach((p) => {
      if (!p.isNew) return;
      if (p.kind === 'damaged') damaged += n0(p.qty); else if (p.kind === 'lost') lost += n0(p.qty); else if (p.kind === 'notOk') notOk += 1;
    }));
    const stalled = repairs.filter((r) => INV.isStalled(r, settings, ymd)).length;
    const todaysChecks = Object.values(plan?.picks || {}).filter((p) => !p.done && p.ymd <= ymd).length;
    return { settings, queue, missing, damaged, lost, notOk, stalled, spot, todaysChecks };
  }

  async function mountHeadteacher(el, ctx) {
    if (!(ctx.isHeadteacher || ctx.isAdmin)) { el.hidden = true; return; }
    const ymd = todayYMD();
    const n = await headteacherNumbers(ctx, ymd);
    if (ctx.workerId && !INV.isEnabledFor(n.settings, ctx.workerId) && !ctx.isAdmin) { el.hidden = true; return; }
    const reports = INV.URLS.reports;
    card(el, `<div class="inv-card" style="margin:0">
      <div class="inv-li__head"><div><h3>🏫 Ukaguzi wa Mali · Inventory Approvals & Reports</h3><p class="inv-card__sub" style="margin:0">Leo · Today — ${esc(INV.util.fmtDaySw(ymd))}</p></div>
        ${n.queue.pendingCount ? `<span class="inv-badge">${n.queue.pendingCount}</span>` : pill(true, 'Zote zimepitiwa · All reviewed')}</div>
      <div class="inv-stats">
        ${statBox(`Zinasubiri idhini · Pending (safi ${n.queue.clean.length})`, n.queue.pendingCount, n.queue.pendingCount ? 'warn' : 'good', 'approvals')}
        ${statBox('Vibovu leo · Damaged today', n.damaged, n.damaged ? 'bad' : '', 'overview')}
        ${statBox('Vilivyopotea leo · Lost today', n.lost, n.lost ? 'bad' : '', 'overview')}
        ${statBox('Si sawa · Not OK', n.notOk, n.notOk ? 'warn' : '', 'overview')}
        ${statBox('Hawakujaza · Not submitted', n.missing.length, n.missing.length ? 'bad' : '', 'approvals')}
        ${statBox('Matengenezo yaliyokwama · Stalled repairs', n.stalled, n.stalled ? 'bad' : '', 'repairs')}
        ${statBox(`Ukaguzi wa ghafla · Spot checks (${n.spot ? `${n.spot.done}/${n.spot.planned}` : '0/0'})`, n.todaysChecks, n.todaysChecks ? 'accent' : '', 'spot')}
      </div>
      <div class="inv-inline" style="margin-top:12px">
        <a class="inv-btn inv-btn--primary" href="${esc(reports)}?tab=approvals">✅ Idhinisha · Approve</a>
        <a class="inv-btn" href="${esc(reports)}?tab=overview">📊 Ripoti & PDF · Reports</a>
        ${ctx.workerId && INV.isEnabledFor(n.settings, ctx.workerId) ? `<a class="inv-btn" href="${esc(INV.URLS.inventory)}">🧾 Hesabu yangu · My inventory</a>` : ''}
      </div></div>`);
    el.addEventListener('click', (e) => {
      const go = e.target.closest('[data-go]');
      if (go) global.location.href = `${reports}?tab=${go.dataset.go}`;
    });
  }

  async function mountWatch(el, ctx, settings) {
    if (!INV.isEnabledFor(settings, ctx.workerId)) { el.hidden = true; return; }
    const ymd = todayYMD();
    const [dockets, day, seen] = await Promise.all([INV.loadDockets(ctx, ctx.year), INV.loadDay(ctx, ymd), INV.val(INV.iref(ctx, ctx.year, `seen/${ymd}`))]);
    const totals = INV.schoolTotals(dockets);
    const highlights = Object.values(totals.items).sort((a, b) => b.total - a.total).slice(0, 12);
    const feed = [];
    Object.entries(day).forEach(([wid, r]) => {
      if (!r || !['submitted', 'approved'].includes(r.status)) return;
      (r.problems || []).filter((p) => ['damaged', 'lost', 'notOk'].includes(p.kind)).forEach((p) => feed.push(Object.assign({ workerId: wid, workerName: r.workerName, area: r.area, status: r.status }, p)));
    });
    const seenMap = seen || {};
    const render = () => card(el, `<div style="${wrapStyle}"><div class="inv-card" style="margin:0">
      <details ${feed.length ? 'open' : ''}><summary style="cursor:pointer;list-style:none"><div class="inv-li__head"><div><h3>🛡️ Ulinzi wa mali ya shule · School-wide watch</h3>
        <p class="inv-card__sub" style="margin:0">Kulingana na ripoti za wafanyakazi wote · From every worker's reports. Mwalimu Mkuu ndiye anayethibitisha.</p></div>
        ${feed.length ? `<span class="inv-badge">${feed.length}</span>` : pill(true, 'Hakuna tatizo jipya leo')}</div></summary>
      <div class="inv-cat">Jumla ya mali · Totals</div>
      <div class="inv-list">${highlights.length ? highlights.map((it) => `<div class="inv-li"><div class="inv-li__head"><div class="inv-li__title">${esc(INV.totalsPhrase(it))}</div>
        <span class="inv-tag inv-tag--${it.pending ? 'warn' : 'good'}">${it.pending ? `${it.confirmed} imethibitishwa · ${it.pending} inasubiri` : 'Imethibitishwa · Confirmed'}</span></div>
        ${it.damaged || it.lost ? `<div class="inv-li__meta">vibovu ${it.damaged} · vimepotea ${it.lost}</div>` : ''}</div>`).join('') : '<p class="inv-empty">Bado hakuna ripoti · No reports yet.</p>'}</div>
      <div class="inv-cat">Vilivyoharibika / kupotea leo · Damaged or lost today</div>
      <div class="inv-list">${feed.length ? feed.map((p) => {
        const key = INV.util.keySafe(`${p.workerId}_${p.itemId}`);
        const s = seenMap[key];
        return `<div class="inv-li"><div class="inv-li__head"><div><div class="inv-li__title">${esc(p.itemName || p.itemId)} — ${esc(INV.PROBLEM_LABELS[p.kind] || p.kind)}${p.qty > 1 ? ` × ${p.qty}` : ''}</div>
          <div class="inv-li__meta">${esc(p.workerName || '')} · ${esc(p.area || '')}${p.desc ? ` · ${esc(p.desc)}` : ''} · ${p.status === 'approved' ? 'Imethibitishwa' : 'Inasubiri Mwalimu Mkuu'}</div></div>
          ${s ? `<span class="inv-tag inv-tag--good">👁 ${esc(s.guardName || '')} ${fmtTime(s.at)}</span>` : `<button class="inv-btn inv-btn--sm inv-btn--accent" data-seen="${esc(key)}" data-w="${esc(p.workerId)}" data-i="${esc(p.itemId)}">Nimeona taarifa · Seen</button>`}</div></div>`;
      }).join('') : '<p class="inv-empty">Hakuna · None</p>'}</div>
      </details></div></div>`);
    render();
    el.addEventListener('click', async (e) => {
      const btn = e.target.closest('[data-seen]');
      if (!btn) return;
      btn.disabled = true;
      await INV.markSeen(ctx, ymd, btn.dataset.w, btn.dataset.i);
      seenMap[btn.dataset.seen] = { guardName: ctx.workerName, at: Date.now() };
      render();
    });
  }

  async function mountDigest(el, ctx) {
    if (!ctx.isAdmin) { el.hidden = true; return; }
    const settings = await INV.loadSettings(ctx, ctx.year);
    if (settings.directorDailyDigest === false || !settings.configured) { el.hidden = true; return; }
    const ymd = todayYMD();
    const n = await headteacherNumbers(ctx, ymd);
    const month = ymd.slice(0, 7);
    const repairs = await INV.listRepairs(ctx, ctx.year);
    const cost = repairs.filter((r) => String(r.reportYmd || '').startsWith(month)).reduce((s, r) => s + n0(r.actualCost), 0);
    card(el, `<div class="inv-card" style="margin:12px 0">
      <div class="inv-li__head"><div><h3>🧾 Muhtasari wa Mali · Inventory digest</h3><p class="inv-card__sub" style="margin:0">${esc(INV.util.fmtDaySw(ymd))}</p></div></div>
      <div class="inv-stats">
        ${statBox('Uharibifu mpya · New damages', n.damaged + n.notOk, n.damaged + n.notOk ? 'bad' : '')}
        ${statBox('Upotevu · Losses', n.lost, n.lost ? 'bad' : '')}
        ${statBox('Matengenezo yaliyokwama · Stalled', n.stalled, n.stalled ? 'bad' : '')}
        ${statBox('Ukaguzi wiki hii · Spot checks', n.spot ? `${n.spot.done}/${n.spot.planned}` : '0/0', n.spot && n.spot.done < n.spot.planned ? 'warn' : 'good')}
        ${statBox('Hawakujaza · Not submitted', n.missing.length, n.missing.length ? 'bad' : '')}
        ${statBox('Gharama za matengenezo mwezi huu (TZS)', cost.toLocaleString('en-US'), '')}
      </div>
      <div style="margin-top:10px"><a class="inv-btn inv-btn--primary" href="${esc(INV.URLS.reports)}?tab=digest">Fungua muhtasari & PDF · Open digest</a></div></div>`);
  }

  async function mountBadge(el, ctx, settings) {
    el.hidden = true;
    if (!INV.isEnabledFor(settings, ctx.workerId)) return;
    const page = T.HUB_PAGES[ctx.roleKey];
    if (!page) return;
    const st = await INV.todayStatus(ctx, ctx.workerId, todayYMD());
    const place = () => {
      const link = [...global.document.querySelectorAll(`a[href*="${page}"]`)].find((a) => !a.closest('[data-somap-inventory-card]'));
      if (!link || link.parentElement.querySelector('.inv-dash-badge')) return !!link;
      UI.ensureCss();
      const b = global.document.createElement('span');
      b.className = `inv-tag inv-tag--${st.done ? 'good' : 'bad'} inv-dash-badge`;
      b.style.margin = '8px 0 0';
      b.style.display = 'inline-flex';
      b.textContent = `Hesabu ya leo: ${st.done ? '✔' : '✖'}`;
      link.insertAdjacentElement('afterend', b);
      return true;
    };
    if (place()) return;
    const obs = new MutationObserver(() => { if (place()) obs.disconnect(); });
    obs.observe(global.document.body, { childList: true, subtree: true });
    setTimeout(() => obs.disconnect(), 20000);
  }

  async function mountAll() {
    const els = [...global.document.querySelectorAll('[data-somap-inventory-card]')];
    if (!els.length) return;
    UI.ensureCss();
    els.forEach((el) => { el.hidden = true; });
    let ctx;
    try {
      const needsAdmin = els.some((el) => ['digest', 'headteacher'].includes(el.dataset.somapInventoryCard));
      ctx = await INV.resolveContext({ detectAdmin: needsAdmin });
    } catch (err) { console.warn('Inventory card: no context', err); return; }
    let settings = null;
    try { settings = await INV.loadSettings(ctx, ctx.year); } catch (err) { console.warn('Inventory settings unavailable', err); return; }
    for (const el of els) {
      const variant = el.dataset.somapInventoryCard;
      try {
        if (variant === 'hub' && ctx.workerId) await mountHub(el, ctx, settings);
        else if (variant === 'headteacher') await mountHeadteacher(el, ctx);
        else if (variant === 'watch' && ctx.workerId) await mountWatch(el, ctx, settings);
        else if (variant === 'digest') await mountDigest(el, ctx);
        else if (variant === 'badge' && ctx.workerId) await mountBadge(el, ctx, settings);
      } catch (err) {
        console.warn(`Inventory card "${variant}" skipped`, err);
        el.hidden = true;
      }
    }
  }

  global.SomapInventoryCards = { mountAll };
  if (global.document.readyState === 'loading') global.document.addEventListener('DOMContentLoaded', () => mountAll()); else mountAll();
})(window);
