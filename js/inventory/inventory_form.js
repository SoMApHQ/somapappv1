// SoMAp Daily Inventory — the worker's daily docket form (workersinventory.html).
// Pre-filled from the last report so a worker only changes what changed; "Hakuna
// mabadiliko" confirms everything in one tap. Drafts autosave locally and to the
// database; a submit that cannot reach the server is queued and retried.
(function (global) {
  'use strict';
  const INV = global.SomapInventory;
  const UI = global.SomapInventoryUI;
  const { esc, n0, todayYMD, addDays, fmtTime, fmtDateTime, fmtDaySw, clone, storageGet, storageSet, storageDel, weekMonday, daysBetween } = INV.util;
  const T = INV.T;
  const $ = (id) => global.document.getElementById(id);
  const params = new URLSearchParams(global.location.search || '');
  const RETURN_CHECKOUT = (params.get('return') || '').toLowerCase() === 'checkout';

  const S = {
    ctx: null, settings: null, docket: null, items: [], basis: null, tickets: {}, values: {}, prefill: {},
    report: null, ymd: todayYMD(), showErrors: false, dirty: false, dbDirty: false, submitting: false,
    meta: { openedAt: 0, customAdded: 0, docketChanged: false, handoverDiff: false, noChanges: false },
    shiftHandover: null, changeHandovers: [], roster: null, lastDbDraft: 0,
  };

  const LS = (suffix) => `somapInv:${S.ctx.schoolId}:${S.ctx.workerId}:${S.ymd}:${suffix}`;

  // ---------- boot ----------
  async function boot() {
    try {
      const back = $('invBackLink');
      if (RETURN_CHECKOUT) { back.href = 'workersattendance.html'; back.textContent = '← Mahudhurio · Attendance'; }
      else if (global.document.referrer && global.document.referrer.startsWith(global.location.origin) && !global.document.referrer.includes('workersinventory')) back.href = global.document.referrer;
      S.ctx = await INV.resolveContext({ detectAdmin: false });
      if (!S.ctx.workerId) return fatal('Hakuna kipindi cha mfanyakazi. Ingia tena · No worker session. Please sign in again.', '../index.html');
      S.settings = await INV.loadSettings(S.ctx, S.ctx.year);
      renderHeader();
      if (!INV.isEnabledFor(S.settings, S.ctx.workerId)) {
        $('panel-today').innerHTML = `<div class="inv-card"><h2>Hesabu ya Mali bado haijawashwa kwako</h2><p class="inv-card__sub">Inventory is not yet switched on for you. ${S.settings.pilotMode ? 'Iko kwenye majaribio kwa wafanyakazi wachache · It is in a pilot for selected workers.' : ''}</p></div>`;
        $('invTabs').classList.add('inv-hide');
        return;
      }
      await loadAll();
      bindEvents();
      setInterval(tick, 15000);
      global.addEventListener('online', retryPending);
      global.addEventListener('beforeunload', () => { if (S.dirty) saveLocalDraft(); });
      retryPending();
    } catch (err) {
      console.error('Inventory boot failed', err);
      fatal(`Imeshindikana kupakia · Could not load: ${err.message || err}`);
    }
  }
  function fatal(message, href) {
    $('panel-today').innerHTML = `<div class="inv-banner inv-banner--bad"><span class="inv-banner__icon">⚠️</span><div class="inv-banner__body"><strong>${esc(message)}</strong>${href ? `<a href="${esc(href)}">Ingia · Sign in</a>` : ''}</div></div>`;
  }

  async function loadAll() {
    const { ctx } = S;
    S.docket = await INV.loadDocket(ctx, ctx.year, { roleKey: ctx.roleKey, profile: ctx.profile, teacherConfig: ctx.teacherConfig, workerName: ctx.workerName });
    S.items = await INV.docketItems(ctx, ctx.year, S.docket);
    S.report = await INV.loadReport(ctx, S.ymd, ctx.workerId);
    S.tickets = await INV.loadOpenTickets(ctx, S.docket);
    S.basis = INV.computeBasis(S.docket, S.items, S.ymd);
    S.prefill = clone(S.basis.values) || {};
    const opened = Number(storageGet(LS('opened')) || 0);
    S.meta.openedAt = opened || Date.now();
    if (!opened) storageSet(LS('opened'), String(S.meta.openedAt));

    // Starting values: today's report (to edit/resubmit) → a newer draft → yesterday's state.
    let values = clone(S.basis.values) || {};
    const local = parseJson(storageGet(LS('draft')));
    const remote = await INV.val(INV.iref(ctx, ctx.year, `drafts/${S.ymd}/${ctx.workerId}`));
    const draft = [local, remote].filter(Boolean).sort((a, b) => (b.at || 0) - (a.at || 0))[0] || null;
    if (S.report && S.report.items) values = clone(S.report.items);
    if (draft && draft.values && (!S.report || (draft.at || 0) > (S.report.submittedAt || 0)) && S.report?.status !== 'approved') {
      values = clone(draft.values);
      if (draft.meta) Object.assign(S.meta, { customAdded: n0(draft.meta.customAdded), docketChanged: !!draft.meta.docketChanged });
    }
    S.values = values;
    S.changeHandovers = (await INV.listHandovers(ctx, ctx.year)).filter((h) => h.type === 'change' && h.status === 'awaitingConfirm' &&
      ((h.fromWorkerId === ctx.workerId && !h.fromConfirmedAt) || (h.toWorkerId === ctx.workerId && !h.toConfirmedAt)));
    S.shiftHandover = S.report ? null : await INV.pendingShiftHandover(ctx, S.docket).catch(() => null);
    renderHeader();
    renderBanners();
    renderStats();
    renderToday();
    if (!$('panel-moves').hidden) renderMoves();
  }
  function parseJson(s) { try { return s ? JSON.parse(s) : null; } catch (_) { return null; } }

  // ---------- header, banners, stats ----------
  function renderHeader() {
    const { ctx } = S;
    $('invSchoolLine').textContent = `${ctx.schoolName} · Mwaka ${ctx.year} · ${fmtDaySw(S.ymd)}`;
    const area = S.docket?.area || '';
    const canEditArea = S.docket && !S.docket.baselineApprovedAt;
    $('invMeta').innerHTML = [
      `<span class="inv-chip">👤 ${esc(ctx.workerName || '')}</span>`,
      `<span class="inv-chip">${esc(INV.roleLabel(ctx.roleKey))}</span>`,
      S.docket ? `<span class="inv-chip">📍 ${area ? esc(area) : 'Eneo halijawekwa'}${canEditArea ? ' <button type="button" data-act="area">badilisha</button>' : ''}</span>` : '',
      `<span class="inv-chip" id="invClock">🕒 ${fmtTime(Date.now())}</span>`,
    ].join('');
  }
  function renderBanners() {
    const out = [];
    const r = S.report;
    if (RETURN_CHECKOUT && !(r && ['submitted', 'approved'].includes(r.status))) {
      out.push(banner('warn', '🧾', 'Jaza hesabu ya mali kabla ya kuondoka', 'Fill your inventory, save, and you will be taken back to check-out.'));
    }
    if (r?.status === 'returned') out.push(banner('bad', '↩️', `Imerudishwa na ${r.returnedByName || 'Mwalimu Mkuu'} · Returned`, `"${r.returnComment || ''}" — Rekebisha na uwasilishe tena leo · Fix and resubmit today.`));
    if (r?.status === 'submitted') out.push(banner('good', '✔', `Umewasilisha saa ${fmtTime(r.submittedAt)} · Submitted`, 'Inasubiri idhini ya Mwalimu Mkuu. Unaweza kurekebisha hadi itakapoidhinishwa · Awaiting approval; you can still correct it.'));
    if (r?.status === 'approved') out.push(banner('good', '✅', `Imeidhinishwa na ${r.approvedByName || ''} saa ${fmtTime(r.approvedAt)} · Approved`, 'Ripoti ya leo imethibitishwa · Today\'s report is confirmed.'));
    if (parseJson(storageGet(LS('pending')))) out.push(banner('warn', '📶', 'Ripoti inasubiri mtandao · Waiting for connection', 'Itatumwa yenyewe mtandao ukirudi · It will be sent automatically when you are back online.'));
    const weekKey = `somapInv:honest:${S.ctx.workerId}:${weekMonday(S.ymd)}`;
    if (!S.docket?.latest || !storageGet(weekKey)) {
      out.push(banner('info', '🤝', INV.HONEST_MESSAGE.sw, INV.HONEST_MESSAGE.en, 'honest'));
    }
    if (S.basis?.baseline) out.push(banner('info', '🆕', 'Hesabu ya kwanza (baseline)', 'Hesabu kila kitu ulichokabidhiwa mara moja. Kesho utabadilisha tu kilichobadilika · Count everything once; tomorrow you only change what changed.'));
    if (S.docket?.carriedFrom) out.push(banner('info', '📅', `Dhamana imehamishwa kutoka ${S.docket.carriedFrom}`, 'Your docket was carried over from the last approved state of last year.'));
    $('invBanners').innerHTML = out.join('');
  }
  function banner(kind, icon, title, body, closeKey) {
    return `<div class="inv-banner inv-banner--${kind}"><span class="inv-banner__icon">${icon}</span><div class="inv-banner__body"><strong>${esc(title)}</strong>${esc(body)}</div>${closeKey ? `<button class="inv-banner__close" data-close="${closeKey}" aria-label="Close">✕</button>` : ''}</div>`;
  }
  function currentAnalysis() { return INV.analyze(S.items, S.values, S.basis, S.tickets, S.ymd); }
  function renderStats() {
    const a = currentAnalysis();
    const r = S.report;
    const st = r?.status || 'none';
    const label = { none: 'Bado · Not yet', draft: 'Rasimu · Draft', submitted: 'Imewasilishwa', approved: 'Imeidhinishwa', returned: 'Imerudishwa' }[st] || st;
    $('invStats').innerHTML = [
      stat('Vitu kwenye dhamana · Items', S.items.length, ''),
      stat('Vizima · Good', a.counts.good, 'good'),
      stat('Vilivyoharibika · Damaged', a.counts.damaged, a.counts.damaged ? 'bad' : ''),
      stat('Vilivyopotea · Lost', a.counts.lost, a.counts.lost ? 'bad' : ''),
      stat('Si sawa · Not OK', a.counts.notOk, a.counts.notOk ? 'warn' : ''),
      stat('Ripoti ya leo · Today', `${st === 'approved' || st === 'submitted' ? '✔' : '✖'}`, st === 'approved' || st === 'submitted' ? 'good' : 'bad', `${label}${r?.submittedAt ? ` · ${fmtTime(r.submittedAt)}` : ''}`),
    ].join('');
  }
  function stat(label, value, kind, hint) {
    return `<div class="inv-stat ${kind ? `inv-stat--${kind}` : ''}"><p class="inv-stat__label">${esc(label)}</p><div class="inv-stat__value">${esc(value)}</div>${hint ? `<div class="inv-stat__hint">${esc(hint)}</div>` : ''}</div>`;
  }

  // ---------- today ----------
  function readOnly() { return S.report?.status === 'approved'; }
  function renderToday() {
    const panel = $('panel-today');
    const parts = [];
    parts.push(renderIncoming());
    parts.push(renderChangeHandovers());
    parts.push(renderShiftHandover());
    if (!readOnly() && !S.basis.baseline) {
      const pendingConfirm = Object.values(S.tickets).some((t) => t.status === 'repaired');
      parts.push(`<div class="inv-card inv-nochange">
        <button class="inv-btn inv-btn--good inv-btn--big inv-btn--block" data-act="nochange" ${pendingConfirm ? 'disabled' : ''}>✔ Hakuna mabadiliko · No changes</button>
        <small>${pendingConfirm ? 'Kwanza jibu swali la matengenezo hapa chini · First answer the repair question below' : `Inathibitisha kila kitu kama ${S.basis.refYmd ? fmtDaySw(S.basis.refYmd) : 'jana'} · Confirms everything as last time`}</small>
      </div>`);
    }
    let lastCat = '';
    const rows = [];
    S.items.forEach((d) => {
      if (d.cat !== lastCat) { lastCat = d.cat; const c = T.CATEGORIES[d.cat] || T.CATEGORIES.other; rows.push(`<div class="inv-cat">${esc(c.sw)} · ${esc(c.en)}</div>`); }
      rows.push(itemHtml(d));
    });
    parts.push(`<div id="invItems">${rows.join('') || '<p class="inv-empty">Hakuna vitu bado. Ongeza kitu hapa chini · No items yet — add one below.</p>'}</div>`);
    if (!readOnly()) parts.push(addItemHtml());
    panel.innerHTML = parts.join('');
    $('invSubmitBar').classList.toggle('inv-hide', readOnly());
    $('invSubmitBtn').textContent = S.report && ['submitted', 'returned'].includes(S.report.status) ? 'Wasilisha tena · Resubmit' : 'Wasilisha · Submit';
  }

  function itemHtml(d) {
    const v = S.values[d.id] || {};
    const b = S.basis.values[d.id] || null;
    const ticket = S.tickets[d.id];
    const analysis = S.showErrors ? currentAnalysis() : null;
    const err = analysis?.errors[d.id] || '';
    const ro = readOnly();
    const dis = ro ? 'disabled' : '';
    const changed = S.prefill[d.id] && JSON.stringify(stripNote(v)) !== JSON.stringify(stripNote(S.prefill[d.id]));
    let body = '';
    let problem = false;
    const tags = [];
    if (d.custom) tags.push('<span class="inv-tag inv-tag--muted">Kitu changu · Custom</span>');
    if (ticket) {
      const days = Math.max(0, daysBetween(ticket.reportYmd || S.ymd, S.ymd));
      tags.push(ticket.status === 'repaired'
        ? '<span class="inv-tag inv-tag--info">🔧 Imetengenezwa? · Repaired?</span>'
        : `<span class="inv-tag inv-tag--warn">⏳ Inasubiri matengenezo (siku ${days}) · Awaiting repair</span>`);
      tags.push(ticket.source === 'spotCheck' ? '<span class="inv-tag inv-tag--bad">Imegunduliwa ukaguzini · Found by spot check</span>' : '<span class="inv-tag inv-tag--good">Imeripotiwa na mhusika · Self-reported</span>');
    }
    if (d.type === 'count') {
      const good = v.good ?? ''; const damaged = v.damaged ?? ''; const lost = v.lost ?? '';
      const total = n0(v.good) + n0(v.damaged) + n0(v.lost);
      const exp = S.basis.expected[d.id];
      problem = n0(v.damaged) > 0 || n0(v.lost) > 0 || (exp !== undefined && total !== exp);
      const adj = S.basis.adjusted[d.id];
      body = `<div class="inv-counts">
          ${stepper(d.id, 'good', 'Vizima · Good', good, dis)}
          ${stepper(d.id, 'damaged', 'Vibovu · Damaged', damaged, dis, 'damaged')}
          ${stepper(d.id, 'lost', 'Vimepotea · Lost', lost, dis, 'lost')}
        </div>
        <div class="inv-item__meta"><span data-total="${esc(d.id)}">Jumla · Total: <b>${total}</b></span>
          ${exp !== undefined ? `<span>Iliyotarajiwa · Expected: <b>${exp}</b>${total !== exp ? ' <span class="inv-tag inv-tag--bad">tofauti · differs</span>' : ''}</span>` : ''}
          ${d.required || v.required ? `<span>Zinazohitajika · Required: ${n0(v.required ?? d.required)}</span>` : ''}
          ${adj ? `<span class="inv-tag inv-tag--info">Uhamisho umehesabiwa · ${adj.length} movement(s) applied</span>` : ''}
        </div>`;
    } else if (d.type === 'cond') {
      problem = v.ok === false;
      body = `<div class="inv-seg" role="group">
          <button type="button" class="${v.ok === true ? 'is-ok' : ''}" data-act="cond" data-item="${esc(d.id)}" data-v="1" ${dis}>✔ Sawa · OK</button>
          <button type="button" class="${v.ok === false ? 'is-bad' : ''}" data-act="cond" data-item="${esc(d.id)}" data-v="0" ${dis}>✖ Si sawa · Not OK</button>
        </div>`;
    } else if (d.type === 'cons') {
      body = `<div class="inv-row">
          <label class="inv-field">Kilichobaki · Quantity left (${esc(d.unit || '')})<input type="number" inputmode="numeric" min="0" data-item="${esc(d.id)}" data-f="qty" value="${esc(v.qty ?? '')}" ${dis}></label>
          <label class="inv-toggle"><input type="checkbox" data-item="${esc(d.id)}" data-f="restock" ${v.restock ? 'checked' : ''} ${dis}> Kinahitaji kuongezwa · Needs restock</label>
        </div>`;
    } else if (d.type === 'num') {
      body = `<label class="inv-field">${esc(d.unit || 'Kiasi')}<input type="number" inputmode="numeric" min="0" data-item="${esc(d.id)}" data-f="value" value="${esc(v.value ?? '')}" ${dis}></label>`;
    } else if (d.type === 'level') {
      const opts = [['', '—'], ['full', 'Imejaa · Full'], ['3/4', '3/4'], ['1/2', '1/2'], ['1/4', '1/4'], ['reserve', 'Akiba · Reserve']];
      body = `<label class="inv-field">Kiwango · Level<select data-item="${esc(d.id)}" data-f="value" ${dis}>${opts.map(([k, l]) => `<option value="${k}" ${v.value === k ? 'selected' : ''}>${l}</option>`).join('')}</select></label>`;
    } else if (d.type === 'date') {
      const st = INV.expiryState(v.value, S.ymd);
      if (st) tags.push(st === 'expired' ? '<span class="inv-tag inv-tag--bad">Imeisha · Expired</span>' : '<span class="inv-tag inv-tag--warn">Inaisha ndani ya siku 30 · Expires within 30 days</span>');
      problem = st === 'expired';
      body = `<label class="inv-field">Tarehe · Date<input type="date" data-item="${esc(d.id)}" data-f="value" value="${esc(v.value ?? '')}" ${dis}></label>`;
    }
    let repairQ = '';
    if (ticket && ticket.status === 'repaired') {
      repairQ = `<div class="inv-banner inv-banner--info" style="margin:0"><span class="inv-banner__icon">🔧</span><div class="inv-banner__body"><strong>Kimetengenezwa? · Was it repaired?</strong>${esc(ticket.repairedBy || 'Fundi')} amesema kimetengenezwa ${ticket.repairedAt ? fmtDateTime(ticket.repairedAt) : ''}.
        <div class="inv-inline" style="margin-top:6px"><div class="inv-seg"><button type="button" class="${v.repairConfirm === 'yes' ? 'is-ok' : ''}" data-act="repairq" data-item="${esc(d.id)}" data-v="yes" ${dis}>Ndiyo · Yes</button><button type="button" class="${v.repairConfirm === 'no' ? 'is-bad' : ''}" data-act="repairq" data-item="${esc(d.id)}" data-v="no" ${dis}>Hapana · No</button></div></div></div></div>`;
    }
    const needNote = problem || !!err || !!v.desc || (b && d.type === 'count' && (n0(v.damaged) < n0(b.damaged) || n0(v.lost) < n0(b.lost)));
    const notes = needNote || v._showNote ? `<div class="inv-row">
        <label class="inv-field">Maelezo / taja vitu · Description ${problem ? '<span class="inv-tag inv-tag--bad">lazima · required</span>' : ''}<textarea data-item="${esc(d.id)}" data-f="desc" placeholder="Mf. dawati 2 miguu imevunjika, kiti 1 cha plastiki kimepasuka" ${dis}>${esc(v.desc || '')}</textarea></label>
        ${problem ? `<label class="inv-field">Nani / jinsi gani · Who / how (hiari)<input data-item="${esc(d.id)}" data-f="who" value="${esc(v.who || '')}" placeholder="Mf. wanafunzi walikuwa wakiruka juu yake" ${dis}></label>` : ''}
      </div>` : (ro ? '' : `<button type="button" class="inv-item__menu" data-act="note" data-item="${esc(d.id)}">+ Maelezo · Note</button>`);
    return `<div class="inv-item ${err ? 'has-error' : ''} ${problem ? 'has-problem' : ''} ${changed && !problem ? 'is-changed' : ''}" data-card="${esc(d.id)}">
      <div class="inv-item__head">
        <div><div class="inv-item__name">${esc(d.sw)} ${d.en && d.en !== d.sw ? `<span class="inv-item__en">· ${esc(d.en)}</span>` : ''}</div>
          ${tags.length ? `<div class="inv-item__meta">${tags.join('')}</div>` : ''}</div>
        ${ro ? '' : `<button type="button" class="inv-item__menu" data-act="hide" data-item="${esc(d.id)}" title="Sina kitu hiki">${d.custom ? 'Ondoa · Remove' : 'Sina hiki · N/A'}</button>`}
      </div>
      ${repairQ}${body}${notes}
      ${err ? `<div class="inv-item__error">⚠ ${esc(err)}</div>` : ''}
    </div>`;
  }
  function stripNote(v) { const o = Object.assign({}, v || {}); delete o.desc; delete o.who; delete o._showNote; return o; }
  function stepper(id, f, label, value, dis, kind) {
    return `<div class="inv-count ${kind ? `inv-count--${kind}` : ''}"><label>${esc(label)}</label><div class="inv-step">
      <button type="button" data-act="dec" data-item="${esc(id)}" data-f="${f}" ${dis} aria-label="minus">−</button>
      <input type="number" inputmode="numeric" min="0" data-item="${esc(id)}" data-f="${f}" value="${esc(value)}" ${dis}>
      <button type="button" data-act="inc" data-item="${esc(id)}" data-f="${f}" ${dis} aria-label="plus">+</button></div></div>`;
  }
  function addItemHtml() {
    const cats = Object.entries(T.CATEGORIES).map(([k, c]) => `<option value="${k}">${esc(c.sw)} · ${esc(c.en)}</option>`).join('');
    return `<details class="inv-card"><summary style="cursor:pointer;font-weight:700">➕ Ongeza kitu · Add item</summary>
      <p class="inv-card__sub">Kitu kilicho kwenye dhamana yako lakini hakipo kwenye orodha. Kitabaki kwenye dhamana yako · It stays in your docket from now on.</p>
      <div class="inv-row">
        <label class="inv-field">Jina (Kiswahili)<input id="addSw" placeholder="Mf. Feni"></label>
        <label class="inv-field">Name (English, hiari)<input id="addEn" placeholder="e.g. Fan"></label>
        <label class="inv-field">Aina · Type<select id="addType"><option value="count">Idadi · Countable</option><option value="cond">Hali Sawa/Si sawa · Condition</option><option value="cons">Matumizi · Consumable</option></select></label>
        <label class="inv-field">Kundi · Category<select id="addCat">${cats}</select></label>
      </div>
      <div style="margin-top:10px"><button class="inv-btn inv-btn--accent" data-act="additem">Ongeza · Add</button></div>
    </details>`;
  }

  function renderIncoming() {
    const inc = Object.entries(S.docket.incoming || {}).map(([id, m]) => Object.assign({ id }, m)).filter((m) => m.status === 'pending');
    if (!inc.length) return '';
    return `<div class="inv-card"><h3>📦 Vitu vinavyokuja kwako · Incoming</h3><p class="inv-card__sub">Kubali tu ukiwa umevipokea mkononi · Accept only once you physically have them.</p><div class="inv-list">${inc.map((m) => `
      <div class="inv-li"><div class="inv-li__head"><div><div class="inv-li__title">${esc(m.itemName || m.itemId)} × ${n0(m.qty)}</div>
        <div class="inv-li__meta">${m.type === 'stockIn' ? `Mali mpya · Stock in (${esc(m.source || '')})` : `Kutoka · From ${esc(m.fromWorkerName || '')} (${esc(m.fromArea || '')})`} · ${fmtDateTime(m.at)}${m.reason ? ` · ${esc(m.reason)}` : ''}</div></div>
        <div class="inv-li__actions"><button class="inv-btn inv-btn--good inv-btn--sm" data-act="accept" data-id="${esc(m.id)}">Nimepokea · Accept</button><button class="inv-btn inv-btn--bad inv-btn--sm" data-act="reject" data-id="${esc(m.id)}">Kataa · Reject</button></div></div></div>`).join('')}</div></div>`;
  }
  function renderChangeHandovers() {
    if (!S.changeHandovers.length) return '';
    return S.changeHandovers.map((h) => {
      const rows = Object.entries(h.items || {}).map(([id, v]) => {
        const def = h.itemDefs?.[id] || INV.catalogDef(id) || { sw: id };
        const txt = v.type === 'count' ? `${n0(v.good)} vizima, ${n0(v.damaged)} vibovu, ${n0(v.lost)} vimepotea` : v.type === 'cond' ? (v.ok === false ? 'Si sawa' : 'Sawa') : (v.qty ?? v.value ?? '');
        return `<tr><td>${esc(def.sw)}</td><td>${esc(txt)}</td></tr>`;
      }).join('');
      const iAmFrom = h.fromWorkerId === S.ctx.workerId;
      return `<div class="inv-card"><h3>🤝 Makabidhiano · Handover — ${esc(h.area || '')}</h3>
        <p class="inv-card__sub">${iAmFrom ? `Unakabidhi kwa ${esc(h.toName)}. Ukithibitisha, dhamana yako ya eneo hili inaisha.` : `Unapokea kutoka ${esc(h.fromName)}. Ukithibitisha, hii ndiyo hesabu yako ya kuanzia.`} (${esc(h.startedBy || '')}, ${fmtDateTime(h.startedAt)})</p>
        <div class="inv-table-wrap"><table class="inv-table"><thead><tr><th>Kitu · Item</th><th>Hesabu ya pamoja · Joint count</th></tr></thead><tbody>${rows}</tbody></table></div>
        <div style="margin-top:10px"><button class="inv-btn inv-btn--primary" data-act="confirmho" data-id="${esc(h.id)}">Nathibitisha hesabu hii · I confirm this count</button></div></div>`;
    }).join('');
  }
  function renderShiftHandover() {
    const p = S.shiftHandover;
    if (!p) return '';
    const shiftLine = p.shiftRecord ? Object.values(p.shiftRecord).map((s) => s && (s.handoverFrom || s.handoverTo) ? `${s.handoverFrom || '?'} → ${s.handoverTo || '?'}` : '').filter(Boolean).join(', ') : '';
    const rows = S.items.filter((d) => p.from.items?.[d.id]).map((d) => {
      const v = p.from.items[d.id];
      const txt = v.type === 'count' ? `${n0(v.good)} / ${n0(v.damaged)} / ${n0(v.lost)}` : v.type === 'cond' ? (v.ok === false ? 'Si sawa' : 'Sawa') : (v.qty ?? v.value ?? '');
      return `<tr><td>${esc(d.sw)}</td><td>${esc(txt)}</td><td><input class="inv-input" data-hodiff="${esc(d.id)}" placeholder="Tofauti? (acha wazi kama sawa)"></td></tr>`;
    }).join('');
    return `<div class="inv-card"><h3>🔁 Makabidhiano ya zamu · Shift handover</h3>
      <p class="inv-card__sub">${esc(p.from.workerName || '')} aliwasilisha hesabu ya ${esc(p.from.area || '')} saa ${fmtTime(p.from.submittedAt)}. Hii ndiyo hesabu yako ya kuanzia.${shiftLine ? ` Rekodi ya zamu: ${esc(shiftLine)}.` : ''}</p>
      <div class="inv-table-wrap"><table class="inv-table"><thead><tr><th>Kitu</th><th>Vizima / vibovu / vimepotea</th><th>Tofauti · Difference</th></tr></thead><tbody>${rows}</tbody></table></div>
      <div class="inv-inline" style="margin-top:10px"><button class="inv-btn inv-btn--good" data-act="shiftok">Nimepokea · Received</button><button class="inv-btn inv-btn--bad" data-act="shiftdiff">Hifadhi tofauti · Record differences</button></div></div>`;
  }

  // ---------- interactions ----------
  function bindEvents() {
    global.document.addEventListener('click', onClick);
    const panel = $('panel-today');
    panel.addEventListener('input', onInput);
    panel.addEventListener('change', onChange);
    $('invSubmitBtn').addEventListener('click', () => submit(false));
    $('invTabs').addEventListener('click', (e) => {
      const tab = e.target.closest('[data-tab]');
      if (!tab) return;
      global.document.querySelectorAll('.inv-tab').forEach((t) => t.classList.toggle('is-active', t === tab));
      ['today', 'moves', 'history', 'record'].forEach((k) => { $(`panel-${k}`).hidden = k !== tab.dataset.tab; });
      $('invSubmitBar').classList.toggle('inv-hide', tab.dataset.tab !== 'today' || readOnly());
      if (tab.dataset.tab === 'moves') renderMoves();
      if (tab.dataset.tab === 'history') renderHistory();
      if (tab.dataset.tab === 'record') renderRecord();
    });
  }
  function setVal(id, patch) {
    S.values[id] = Object.assign({}, S.values[id] || {}, patch);
    S.dirty = true; S.dbDirty = true; S.meta.noChanges = false;
    scheduleLocalSave();
  }
  function rerenderItem(id) {
    const el = global.document.querySelector(`[data-card="${CSS.escape(id)}"]`);
    const def = S.items.find((d) => d.id === id);
    if (el && def) el.outerHTML = itemHtml(def);
    renderStats();
  }
  function onInput(e) {
    const el = e.target;
    const id = el.dataset.item; const f = el.dataset.f;
    if (!id || !f || readOnly()) return;
    if (el.type === 'checkbox') return;
    if (el.type === 'number') {
      setVal(id, { [f]: el.value === '' ? undefined : n0(el.value) });
      const v = S.values[id];
      const tot = global.document.querySelector(`[data-total="${CSS.escape(id)}"] b`);
      if (tot) tot.textContent = String(n0(v.good) + n0(v.damaged) + n0(v.lost));
      renderStats();
    } else setVal(id, { [f]: el.value });
  }
  function onChange(e) {
    const el = e.target;
    const id = el.dataset.item; const f = el.dataset.f;
    if (!id || !f || readOnly()) return;
    if (el.type === 'checkbox') setVal(id, { [f]: el.checked });
    else if (el.tagName === 'SELECT' || el.type === 'date') setVal(id, { [f]: el.value });
    if (el.type === 'number' || el.tagName === 'SELECT' || el.type === 'date' || el.type === 'checkbox') rerenderItem(id);
  }
  async function onClick(e) {
    const el = e.target.closest('[data-act],[data-close]');
    if (!el) return;
    if (el.dataset.close === 'honest') {
      storageSet(`somapInv:honest:${S.ctx.workerId}:${weekMonday(S.ymd)}`, '1');
      el.closest('.inv-banner').remove();
      return;
    }
    const act = el.dataset.act; const id = el.dataset.item;
    if (act === 'inc' || act === 'dec') {
      const cur = n0(S.values[id]?.[el.dataset.f]);
      setVal(id, { [el.dataset.f]: Math.max(0, cur + (act === 'inc' ? 1 : -1)) });
      rerenderItem(id);
    } else if (act === 'cond') {
      setVal(id, { ok: el.dataset.v === '1' });
      rerenderItem(id);
    } else if (act === 'repairq') {
      const ticket = S.tickets[id];
      const v = Object.assign({}, S.values[id] || {});
      const prev = v.repairConfirm;
      v.repairConfirm = el.dataset.v;
      // "Yes": the repaired quantity moves back from damaged to good.
      const def = S.items.find((d) => d.id === id);
      if (def?.type === 'count' && ticket) {
        const q = Math.min(n0(ticket.qty) || n0(v.damaged), n0(v.damaged) + (prev === 'yes' ? n0(ticket.qty) : 0));
        if (v.repairConfirm === 'yes' && prev !== 'yes') { v.damaged = Math.max(0, n0(v.damaged) - q); v.good = n0(v.good) + q; }
        if (v.repairConfirm === 'no' && prev === 'yes') { v.damaged = n0(v.damaged) + q; v.good = Math.max(0, n0(v.good) - q); }
      } else if (def?.type === 'cond') v.ok = v.repairConfirm === 'yes';
      S.values[id] = v; S.dirty = true; S.dbDirty = true; scheduleLocalSave();
      rerenderItem(id);
      if (!Object.values(S.tickets).some((t) => t.status === 'repaired' && !S.values[t.itemId]?.repairConfirm)) renderToday();
    } else if (act === 'note') {
      setVal(id, { _showNote: true });
      rerenderItem(id);
    } else if (act === 'hide') {
      await hideItem(id);
    } else if (act === 'additem') {
      await addItem();
    } else if (act === 'nochange') {
      await submit(true);
    } else if (act === 'accept' || act === 'reject') {
      await respond(el.dataset.id, act === 'accept');
    } else if (act === 'confirmho') {
      const h = S.changeHandovers.find((x) => x.id === el.dataset.id);
      if (!h) return;
      el.disabled = true;
      const res = await INV.confirmChangeHandover(S.ctx, h);
      UI.toast(res.ok ? (res.completed ? 'Makabidhiano yamekamilika · Handover completed' : 'Umethibitisha. Inasubiri upande mwingine · Waiting for the other side') : res.message, res.ok ? 'success' : 'error');
      await loadAll();
    } else if (act === 'shiftok' || act === 'shiftdiff') {
      await saveShift(act === 'shiftdiff');
    } else if (act === 'area') {
      const area = await UI.promptText('Eneo la dhamana · Docket area', 'Mf. Baby Class, Geti kuu, Jikoni, Basi T123ABC', { minLength: 2, placeholder: S.docket.area || '' });
      if (!area) return;
      await INV.saveDocketMeta(S.ctx, S.ctx.year, S.ctx.workerId, { area, role: S.docket.role, workerName: S.ctx.workerName });
      S.docket.area = area; renderHeader();
    } else if (act === 'transfer') { await doTransfer(); } else if (act === 'writeoff') { await doWriteOff(); } else if (act === 'viewreport') { await viewReport(el.dataset.ymd); }
  }

  async function hideItem(id) {
    const def = S.items.find((d) => d.id === id);
    if (!def) return;
    const v = S.values[id] || {};
    if (def.type === 'count' && (n0(v.good) + n0(v.damaged) + n0(v.lost)) > 0) {
      UI.toast('Kitu chenye idadi hakiwezi kuondolewa. Tumia uhamisho au write-off · Use a transfer or write-off for items you hold.', 'warning', 6500);
      return;
    }
    const ok = await UI.modal({ title: def.custom ? 'Ondoa kitu? · Remove item?' : 'Sina kitu hiki? · Not in my area?', html: `<p>${esc(INV.itemName(def))}</p><p class="inv-card__sub">Mwalimu Mkuu ataona mabadiliko haya · The Head Teacher will see this change.</p>`, actions: [{ label: 'Hapana · No', value: false }, { label: 'Ndiyo · Yes', value: true, kind: 'bad' }] });
    if (!ok) return;
    await INV.iref(S.ctx, S.ctx.year, `dockets/${S.ctx.workerId}/hiddenItems/${id}`).set(true);
    await INV.audit(S.ctx, S.ctx.year, 'item_hidden', S.ctx.workerId, { itemId: id });
    S.docket.hiddenItems = Object.assign({}, S.docket.hiddenItems || {}, { [id]: true });
    S.items = S.items.filter((d) => d.id !== id);
    delete S.values[id];
    S.meta.docketChanged = true;
    renderToday(); renderStats();
  }
  async function addItem() {
    const sw = $('addSw').value.trim();
    if (sw.length < 2) { UI.toast('Andika jina la kitu · Enter the item name', 'warning'); return; }
    const def = await INV.addCustomItem(S.ctx, S.ctx.year, S.ctx.workerId, { sw, en: $('addEn').value.trim(), type: $('addType').value, cat: $('addCat').value });
    S.docket.customItems = Object.assign({}, S.docket.customItems || {}, { [def.id]: def });
    S.items = await INV.docketItems(S.ctx, S.ctx.year, S.docket);
    S.meta.customAdded += 1; S.meta.docketChanged = true;
    UI.toast('Kitu kimeongezwa kwenye dhamana yako · Item added', 'success');
    renderToday(); renderStats();
    const card = global.document.querySelector(`[data-card="${CSS.escape(def.id)}"]`);
    if (card) card.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }
  async function respond(id, accept) {
    let note = '';
    if (!accept) { note = await UI.promptText('Kataa · Reject', 'Kwa nini unakataa? · Why?', { minLength: 3, kind: 'bad' }); if (!note) return; }
    const res = await INV.respondMovement(S.ctx, id, accept, note);
    UI.toast(res.ok ? (accept ? 'Umepokea. Idadi itaongezeka kwenye hesabu yako · Accepted' : 'Imekataliwa · Rejected') : res.message, res.ok ? 'success' : 'error');
    await loadAll();
  }
  async function saveShift(withDiff) {
    const diffs = {};
    global.document.querySelectorAll('[data-hodiff]').forEach((inp) => { if (inp.value.trim()) diffs[inp.dataset.hodiff] = { note: inp.value.trim() }; });
    if (withDiff && !Object.keys(diffs).length) { UI.toast('Andika tofauti angalau moja · Write at least one difference', 'warning'); return; }
    const res = await INV.saveShiftHandover(S.ctx, S.shiftHandover, withDiff ? diffs : {}, S.items);
    // The outgoing guard's count becomes the incoming guard's starting point.
    Object.entries(S.shiftHandover.from.items || {}).forEach(([id, v]) => { if (S.items.some((d) => d.id === id) && !S.report) S.values[id] = clone(v); });
    if (withDiff) S.meta.handoverDiff = true;
    S.shiftHandover = null;
    UI.toast(res.differences ? 'Tofauti zimehifadhiwa · Differences recorded' : 'Makabidhiano yamepokelewa · Handover received', 'success');
    renderToday(); renderStats();
  }

  // ---------- autosave & submit ----------
  let localTimer = null;
  function scheduleLocalSave() {
    clearTimeout(localTimer);
    localTimer = setTimeout(saveLocalDraft, 800);
    $('invSaveStatus').textContent = 'Inahifadhi rasimu… · Saving draft…';
  }
  function saveLocalDraft() {
    if (!S.ctx || readOnly()) return;
    storageSet(LS('draft'), JSON.stringify({ values: S.values, at: Date.now(), meta: { customAdded: S.meta.customAdded, docketChanged: S.meta.docketChanged } }));
    $('invSaveStatus').textContent = `Rasimu imehifadhiwa saa ${fmtTime(Date.now())} · Draft saved`;
  }
  async function tick() {
    const clock = $('invClock'); if (clock) clock.textContent = `🕒 ${fmtTime(Date.now())}`;
    if (S.dbDirty && !S.submitting && !readOnly() && global.navigator.onLine !== false) {
      S.dbDirty = false;
      try { await INV.saveDraft(S.ctx, S.ymd, S.ctx.workerId, S.values); S.lastDbDraft = Date.now(); } catch (err) { S.dbDirty = true; console.warn('Draft save failed', err); }
    }
  }
  function withTimeout(promise, ms) {
    return Promise.race([promise, new Promise((_, reject) => setTimeout(() => reject(Object.assign(new Error('timeout'), { code: 'timeout' })), ms))]);
  }
  function computeEditMeta() {
    const edited = {}; const untouched = {};
    S.items.forEach((d) => {
      const a = JSON.stringify(stripNote(S.values[d.id])); const b = JSON.stringify(stripNote(S.prefill[d.id]));
      if (a !== b) edited[d.id] = true; else untouched[d.id] = true;
    });
    return { edited, untouched };
  }
  async function submit(noChanges) {
    if (S.submitting || readOnly()) return;
    if (noChanges) {
      const keep = {};
      Object.entries(S.values).forEach(([id, v]) => { if (v?.repairConfirm) keep[id] = v; });
      S.values = Object.assign(clone(S.basis.values) || {}, keep);
    }
    const analysis = currentAnalysis();
    if (!analysis.valid) {
      S.showErrors = true;
      renderToday(); renderStats();
      const first = global.document.querySelector('.inv-item.has-error');
      if (first) first.scrollIntoView({ behavior: 'smooth', block: 'center' });
      UI.toast(`Rekebisha vitu ${Object.keys(analysis.errors).length} vilivyowekwa alama nyekundu · Fix the items marked in red`, 'warning', 6000);
      return;
    }
    S.submitting = true;
    const btn = $('invSubmitBtn'); btn.disabled = true; btn.textContent = 'Inatuma… · Sending…';
    const { edited, untouched } = computeEditMeta();
    const meta = { noChanges: !!noChanges, openedAt: S.meta.openedAt, editedItems: edited, untouchedItems: noChanges ? {} : untouched, customAdded: S.meta.customAdded, docketChanged: S.meta.docketChanged, handoverDiff: S.meta.handoverDiff };
    storageSet(LS('pending'), JSON.stringify({ values: S.values, meta, at: Date.now() }));
    try {
      const res = await withTimeout(INV.submitReport(S.ctx, { ymd: S.ymd, workerId: S.ctx.workerId, docket: S.docket, items: S.items, values: S.values, basis: S.basis, tickets: S.tickets, meta, settings: S.settings }), 20000);
      storageDel(LS('pending'));
      if (!res.ok) { UI.toast(res.message || 'Haikuweza kuwasilishwa · Could not submit', 'error'); return; }
      storageDel(LS('draft'));
      S.dirty = false; S.dbDirty = false; S.showErrors = false;
      afterSaved(res.report);
    } catch (err) {
      console.warn('Inventory submit failed', err);
      if (err.code === 'timeout' || global.navigator.onLine === false) {
        UI.toast('Mtandao ni dhaifu. Ripoti imehifadhiwa na itatumwa yenyewe · Weak connection: saved and will be sent automatically.', 'warning', 7000);
        renderBanners();
      } else {
        storageDel(LS('pending'));
        UI.toast(`Imeshindikana kutuma · Failed: ${err.message || err}`, 'error', 7000);
      }
    } finally {
      S.submitting = false; btn.disabled = false; btn.textContent = 'Wasilisha · Submit';
    }
  }
  async function retryPending() {
    if (!S.ctx || S.submitting) return;
    const pending = parseJson(storageGet(LS('pending')));
    if (!pending || global.navigator.onLine === false) return;
    S.submitting = true;
    try {
      const res = await withTimeout(INV.submitReport(S.ctx, { ymd: S.ymd, workerId: S.ctx.workerId, docket: S.docket, items: S.items, values: pending.values, basis: S.basis, tickets: S.tickets, meta: pending.meta, settings: S.settings }), 20000);
      storageDel(LS('pending'));
      if (res.ok) { storageDel(LS('draft')); UI.toast('Ripoti iliyosubiri mtandao imetumwa · Queued report sent', 'success'); afterSaved(res.report); }
    } catch (err) { console.warn('Retry failed, will try again', err); } finally { S.submitting = false; }
  }
  function afterSaved(report) {
    S.report = report;
    if (RETURN_CHECKOUT) {
      $('panel-today').innerHTML = `<div class="inv-banner inv-banner--good"><span class="inv-banner__icon">✅</span><div class="inv-banner__body"><strong>Hesabu imehifadhiwa. Sasa unaweza kuondoka</strong>Inventory saved. You can now check out. Inakurudisha… · Taking you back…</div></div>`;
      setTimeout(() => { global.location.href = 'workersattendance.html?inventory=saved'; }, 1400);
      return;
    }
    UI.toast(report.review?.group === 'clean' ? 'Hesabu imehifadhiwa ✔ · Inventory saved' : 'Hesabu imehifadhiwa. Mwalimu Mkuu ataipitia · Saved — the Head Teacher will review it', 'success', 5500);
    loadAll();
  }

  // ---------- movements tab ----------
  async function renderMoves() {
    const panel = $('panel-moves');
    if (!S.docket) return;
    if (!S.roster) S.roster = await INV.loadRoster(S.ctx, S.ctx.year).catch(() => []);
    const countItems = S.items.filter((d) => d.type === 'count');
    const cur = (id) => S.values[id] || S.basis.values[id] || {};
    const goodOpts = countItems.filter((d) => n0(cur(d.id).good) > 0).map((d) => `<option value="${esc(d.id)}">${esc(d.sw)} (vizima ${n0(cur(d.id).good)})</option>`).join('');
    const woOpts = countItems.filter((d) => n0(cur(d.id).lost) > 0 || n0(cur(d.id).damaged) > 0).map((d) => `<option value="${esc(d.id)}">${esc(d.sw)} (vibovu ${n0(cur(d.id).damaged)}, vimepotea ${n0(cur(d.id).lost)})</option>`).join('');
    const people = S.roster.filter((w) => w.workerId !== S.ctx.workerId).map((w) => `<option value="${esc(w.workerId)}">${esc(w.name)} · ${esc(w.role)}</option>`).join('');
    const outgoing = Object.entries(S.docket.outgoing || {}).map(([id, m]) => Object.assign({ id }, m));
    const recent = (await INV.listMovements(S.ctx, addDays(S.ymd, -45), S.ymd)).filter((m) => m.fromWorkerId === S.ctx.workerId || m.toWorkerId === S.ctx.workerId);
    panel.innerHTML = `
      ${renderIncoming()}
      <div class="inv-card"><h3>➡️ Hamisha kwa mfanyakazi mwingine · Transfer</h3>
        <p class="inv-card__sub">Mf. madawati 5 kutoka Baby Class kwenda Class One. Idadi inabadilika tu mpokeaji akikubali · Counts change only after the receiver accepts.</p>
        ${goodOpts ? `<div class="inv-row">
          <label class="inv-field">Kitu · Item<select id="trItem">${goodOpts}</select></label>
          <label class="inv-field">Idadi · Qty<input id="trQty" type="number" min="1" inputmode="numeric"></label>
          <label class="inv-field">Kwenda kwa · To<select id="trTo"><option value="">— chagua —</option>${people}</select></label>
          <label class="inv-field">Sababu · Reason<input id="trReason" placeholder="Mf. darasa jipya limefunguliwa"></label>
        </div><div style="margin-top:10px"><button class="inv-btn inv-btn--primary" data-act="transfer">Tuma · Send</button></div>` : '<p class="inv-empty">Hakuna vitu vizima vya kuhamisha · Nothing to transfer.</p>'}
      </div>
      <div class="inv-card"><h3>🗑️ Omba kufuta (write-off) · Request write-off</h3>
        <p class="inv-card__sub">Vilivyopotea au visivyotengenezeka huondoka kwenye dhamana tu Mwalimu Mkuu akiidhinisha · Lost or unrepairable items leave your docket only after approval.</p>
        ${woOpts ? `<div class="inv-row">
          <label class="inv-field">Kitu · Item<select id="woItem">${woOpts}</select></label>
          <label class="inv-field">Aina · From<select id="woBucket"><option value="lost">Vimepotea · Lost</option><option value="damaged">Vibovu visivyotengenezeka · Unrepairable</option></select></label>
          <label class="inv-field">Idadi · Qty<input id="woQty" type="number" min="1" inputmode="numeric"></label>
          <label class="inv-field">Sababu · Reason<input id="woReason" placeholder="Eleza kilichotokea"></label>
        </div><div style="margin-top:10px"><button class="inv-btn inv-btn--bad" data-act="writeoff">Omba · Request</button></div>` : '<p class="inv-empty">Hakuna vilivyopotea au vibovu · Nothing lost or damaged.</p>'}
      </div>
      <div class="inv-card"><h3>⏳ Vinavyosubiri · Pending from you</h3>${outgoing.length ? `<div class="inv-list">${outgoing.map(moveLi).join('')}</div>` : '<p class="inv-empty">Hakuna · None</p>'}</div>
      <div class="inv-card"><h3>🧾 Mienendo ya siku 45 · Last 45 days</h3>${recent.length ? `<div class="inv-list">${recent.map(moveLi).join('')}</div>` : '<p class="inv-empty">Hakuna · None</p>'}</div>`;
  }
  function moveLi(m) {
    const type = { transfer: 'Uhamisho · Transfer', stockIn: 'Mali mpya · Stock in', writeOff: 'Write-off' }[m.type] || m.type;
    const st = { pending: ['warn', 'Inasubiri · Pending'], accepted: ['good', 'Imekubaliwa · Accepted'], approved: ['good', 'Imeidhinishwa · Approved'], rejected: ['bad', 'Imekataliwa · Rejected'] }[m.status] || ['muted', m.status];
    return `<div class="inv-li"><div class="inv-li__head"><div><div class="inv-li__title">${esc(type)}: ${esc(m.itemName || m.itemId)} × ${n0(m.qty)}</div>
      <div class="inv-li__meta">${m.fromWorkerName ? `${esc(m.fromWorkerName)} → ` : ''}${esc(m.toWorkerName || (m.type === 'writeOff' ? 'Kufutwa' : ''))} · ${fmtDateTime(m.at)}${m.reason ? ` · ${esc(m.reason)}` : ''}</div></div>
      <span class="inv-tag inv-tag--${st[0]}">${esc(st[1])}</span></div></div>`;
  }
  async function doTransfer() {
    const itemId = $('trItem').value; const qty = n0($('trQty').value); const to = $('trTo').value;
    const def = S.items.find((d) => d.id === itemId);
    const have = n0((S.values[itemId] || S.basis.values[itemId] || {}).good);
    if (!def || !qty || !to) { UI.toast('Chagua kitu, idadi na mpokeaji · Choose item, qty and receiver', 'warning'); return; }
    if (qty > have) { UI.toast(`Una vizima ${have} tu · You only hold ${have}`, 'warning'); return; }
    const person = S.roster.find((w) => w.workerId === to);
    const toDocket = await INV.val(INV.iref(S.ctx, S.ctx.year, `dockets/${to}/area`));
    const res = await INV.createMovement(S.ctx, {
      type: 'transfer', itemId, itemName: INV.itemName(def), itemDef: { sw: def.sw, en: def.en || '', type: def.type, cat: def.cat, unit: def.unit || 'pcs' }, qty, bucket: 'good',
      fromWorkerId: S.ctx.workerId, fromWorkerName: S.ctx.workerName, fromArea: S.docket.area || '', toWorkerId: to, toWorkerName: person?.name || to, toArea: toDocket || person?.docketArea || '', reason: $('trReason').value.trim(),
    });
    UI.toast(res.ok ? `Imetumwa kwa ${person?.name || ''}. Inasubiri akubali · Sent; waiting for acceptance` : res.message, res.ok ? 'success' : 'error');
    if (res.ok) { S.docket.outgoing = Object.assign({}, S.docket.outgoing || {}, { [res.id]: res.move }); renderMoves(); }
  }
  async function doWriteOff() {
    const itemId = $('woItem').value; const bucket = $('woBucket').value; const qty = n0($('woQty').value); const reason = $('woReason').value.trim();
    const def = S.items.find((d) => d.id === itemId);
    const have = n0((S.values[itemId] || S.basis.values[itemId] || {})[bucket]);
    if (!def || !qty) { UI.toast('Chagua kitu na idadi · Choose item and qty', 'warning'); return; }
    if (qty > have) { UI.toast(`Kuna ${have} tu kwenye kundi hilo · Only ${have} in that group`, 'warning'); return; }
    if (reason.length < 10) { UI.toast('Eleza sababu kwa kirefu (herufi 10+) · Explain the reason', 'warning'); return; }
    const res = await INV.createMovement(S.ctx, { type: 'writeOff', itemId, itemName: INV.itemName(def), qty, bucket, fromWorkerId: S.ctx.workerId, fromWorkerName: S.ctx.workerName, fromArea: S.docket.area || '', reason });
    UI.toast(res.ok ? 'Ombi limetumwa kwa Mwalimu Mkuu · Request sent' : res.message, res.ok ? 'success' : 'error');
    if (res.ok) { S.docket.outgoing = Object.assign({}, S.docket.outgoing || {}, { [res.id]: res.move }); renderMoves(); }
  }

  // ---------- history & record ----------
  async function renderHistory() {
    const panel = $('panel-history');
    panel.innerHTML = '<div class="inv-loading">Inapakia… · Loading…</div>';
    const raw = await INV.loadRange(S.ctx, 'reports', addDays(S.ymd, -60), S.ymd);
    const mine = Object.entries(raw).map(([ymd, day]) => day && day[S.ctx.workerId] ? Object.assign({ ymd }, day[S.ctx.workerId]) : null).filter(Boolean).sort((a, b) => b.ymd.localeCompare(a.ymd));
    panel.innerHTML = `<div class="inv-card"><h3>Ripoti zako za siku 60 · Your last 60 days</h3>${mine.length ? `<div class="inv-list">${mine.map((r) => {
      const st = { approved: ['good', 'Imeidhinishwa'], submitted: ['info', 'Imewasilishwa'], returned: ['bad', 'Imerudishwa'], draft: ['muted', 'Rasimu'] }[r.status] || ['muted', r.status];
      const c = r.counts || {};
      return `<div class="inv-li"><div class="inv-li__head"><div><div class="inv-li__title">${esc(fmtDaySw(r.ymd))}</div>
        <div class="inv-li__meta">Saa ${fmtTime(r.submittedAt)} · vibovu ${n0(c.damaged)} · vimepotea ${n0(c.lost)} · si sawa ${n0(c.notOk)}${r.noChanges ? ' · Hakuna mabadiliko' : ''}</div>
        ${r.returnComment || r.lastReturnComment ? `<div class="inv-li__meta">↩️ "${esc(r.returnComment || r.lastReturnComment)}"</div>` : ''}</div>
        <div class="inv-li__actions"><span class="inv-tag inv-tag--${st[0]}">${esc(st[1])}</span><button class="inv-btn inv-btn--sm" data-act="viewreport" data-ymd="${esc(r.ymd)}">Angalia · View</button></div></div></div>`;
    }).join('')}</div>` : '<p class="inv-empty">Bado hakuna ripoti · No reports yet.</p>'}</div>`;
  }
  async function viewReport(ymd) {
    const r = await INV.loadReport(S.ctx, ymd, S.ctx.workerId);
    if (!r) return;
    await UI.modal({ title: `${fmtDaySw(ymd)} · ${r.status}`, html: reportTable(r) });
  }
  function reportTable(r) {
    const rows = Object.entries(r.items || {}).map(([id, v]) => {
      const def = r.itemDefs?.[id] || INV.catalogDef(id) || { sw: id };
      const txt = v.type === 'count' ? `${n0(v.good)} / ${n0(v.damaged)} / ${n0(v.lost)}` : v.type === 'cond' ? (v.ok === false ? '✖ Si sawa' : '✔ Sawa') : v.type === 'cons' ? `${n0(v.qty)}${v.restock ? ' (ongeza)' : ''}` : (v.value || '');
      return `<tr class="${(v.type === 'count' && (n0(v.damaged) || n0(v.lost))) || v.ok === false ? 'is-bad' : ''}"><td>${esc(def.sw)}</td><td>${esc(txt)}</td><td>${esc(v.desc || '')}</td></tr>`;
    }).join('');
    return `<div class="inv-table-wrap"><table class="inv-table"><thead><tr><th>Kitu</th><th>Vizima / vibovu / vimepotea · Hali</th><th>Maelezo</th></tr></thead><tbody>${rows}</tbody></table></div>`;
  }
  async function renderRecord() {
    const panel = $('panel-record');
    panel.innerHTML = '<div class="inv-loading">Inapakia… · Loading…</div>';
    const rec = await INV.workerRecord(S.ctx, S.ctx.workerId, S.ctx.year);
    panel.innerHTML = `
      <div class="inv-banner inv-banner--info"><span class="inv-banner__icon">🤝</span><div class="inv-banner__body"><strong>${esc(INV.HONEST_MESSAGE.sw)}</strong>${esc(INV.HONEST_MESSAGE.en)}</div></div>
      <div class="inv-stats">
        ${stat('Matatizo uliyoripoti mwenyewe · Self-reported', rec.selfReported, 'good', 'Hayaadhibiwi na mfumo · Never penalised by the system')}
        ${stat('Tofauti za ukaguzi wa ghafla · Spot-check discrepancies', rec.spotCheckDiscrepancies, rec.spotCheckDiscrepancies ? 'bad' : '', 'Rekodi ya uwajibikaji · Accountability record')}
        ${stat('Matengenezo yanayosubiri · Open repairs', rec.openRepairs.length, rec.openRepairs.length ? 'warn' : '')}
      </div>
      <div class="inv-card"><h3>🔧 Matengenezo yako · Your repairs</h3>${rec.openRepairs.length ? `<div class="inv-list">${rec.openRepairs.map((r) => `<div class="inv-li"><div class="inv-li__head"><div><div class="inv-li__title">${esc(r.itemName)} × ${n0(r.qty)}</div><div class="inv-li__meta">${esc(r.description || '')} · siku ${INV.repairAgeDays(r, S.ymd)}${r.assignedTo ? ` · fundi: ${esc(r.assignedTo)}` : ''}</div></div><span class="inv-tag inv-tag--${r.source === 'spotCheck' ? 'bad' : 'good'}">${r.source === 'spotCheck' ? 'Imegunduliwa ukaguzini' : 'Imeripotiwa na mhusika'}</span></div></div>`).join('')}</div>` : '<p class="inv-empty">Hakuna · None</p>'}</div>
      <div class="inv-card"><h3>🔍 Tofauti za ukaguzi · Spot-check discrepancies</h3>${rec.discrepancies.length ? `<div class="inv-list">${rec.discrepancies.map((d) => `<div class="inv-li"><div class="inv-li__title">${esc(fmtDaySw(d.ymd))} — ${esc(d.byName || '')}</div><div class="inv-li__meta">${esc(d.detail || '')}</div></div>`).join('')}</div>` : '<p class="inv-empty">Hakuna · None</p>'}</div>`;
  }

  if (global.document.readyState === 'loading') global.document.addEventListener('DOMContentLoaded', boot); else boot();
})(window);
