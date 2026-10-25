// SoMAp Daily Inventory — Head Teacher / Admin / Director page (inventoryreports.html).
// Overview & PDFs for any range, approvals, repairs, spot checks, movements,
// inconsistencies, restock list, worker-change handover, director digest, settings.
(function (global) {
  'use strict';
  const INV = global.SomapInventory;
  const UI = global.SomapInventoryUI;
  const PDF = global.SomapInventoryPDF;
  const RV = global.SomapInventoryReview;
  const { esc, n0, todayYMD, addDays, fmtTime, fmtDateTime, fmtDaySw, weekMonday, yearOf, daysBetween, ymdOf } = INV.util;
  const T = INV.T;
  const $ = (id) => global.document.getElementById(id);
  const params = new URLSearchParams(global.location.search || '');
  const S = { ctx: null, year: String(new Date().getFullYear()), tab: params.get('tab') || 'overview', roster: [], settings: null, filters: { period: 'day', anchor: todayYMD(), from: todayYMD(), to: todayYMD(), role: '', area: '', workerId: '' } };
  const COLORS = { damaged: '#2a78d6', lost: '#eb6834', notOk: '#1baf7a' }; // validated categorical slots 1-3
  const REP = { reported: ['warn', 'Imeripotiwa · Reported'], assigned: ['info', 'Imepangiwa fundi · Assigned'], inProgress: ['info', 'Inaendelea · In progress'], repaired: ['good', 'Imetengenezwa · Repaired'], confirmed: ['good', 'Imethibitishwa · Confirmed'], cannotRepair: ['bad', 'Haitengenezeki · Cannot repair'], cancelled: ['muted', 'Imefutwa · Cancelled'] };
  const FLAG = { count_mismatch: 'Idadi imebadilika · Count changed', reappeared: 'Vimerudi bila matengenezo · Reappeared', repeat_damage: 'Uharibifu unajirudia · Repeated damage', spot_discrepancy: 'Ukaguzi umepinga ripoti · Spot-check contradiction', handover_difference: 'Tofauti ya makabidhiano · Handover difference' };

  async function boot() {
    try {
      const yc = global.somapYearContext;
      S.year = String(yc?.getSelectedYear?.() || new Date().getFullYear());
      S.ctx = await INV.resolveContext({ year: S.year });
      S.ctx.year = S.year;
      const switchYear = (y) => { if (!y || String(y) === S.year) return; S.year = String(y); S.ctx.year = S.year; S.settings = null; render(); };
      if (yc?.attachYearDropdown) { yc.attachYearDropdown($('rpYear')); yc.onYearChanged?.(switchYear); }
      else { $('rpYear').innerHTML = [S.year, String(Number(S.year) - 1)].map((y) => `<option>${y}</option>`).join(''); $('rpYear').onchange = (e) => switchYear(e.target.value); }
      if (!S.ctx.isManagement) {
        $('rpMain').innerHTML = '<div class="inv-banner inv-banner--bad"><span class="inv-banner__icon">🔒</span><div class="inv-banner__body"><strong>Ukurasa huu ni wa Mwalimu Mkuu, Admin na Mkurugenzi</strong>This page is for the Head Teacher, Admin and Director.</div></div>';
        $('rpTabs').classList.add('inv-hide');
        return;
      }
      if (!S.ctx.workerId) $('rpBack').href = '../dashboard.html';
      $('rpSchoolLine').textContent = `${S.ctx.schoolName} · ${fmtDaySw(todayYMD())}`;
      $('rpMeta').innerHTML = `<span class="inv-chip">👤 ${esc(S.ctx.actorName)}</span><span class="inv-chip">${S.ctx.isAdmin ? 'Admin / Mkurugenzi' : 'Mwalimu Mkuu · Head Teacher'}</span>`;
      if (!S.ctx.isAdmin) global.document.querySelector('[data-tab="settings"]').textContent = '⚙️ Maeneo · Areas';
      $('rpTabs').addEventListener('click', (e) => { const t = e.target.closest('[data-tab]'); if (t) { S.tab = t.dataset.tab; render(); } });
      global.document.addEventListener('click', onClick);
      render();
    } catch (err) {
      console.error('Inventory reports boot failed', err);
      $('rpMain').innerHTML = `<div class="inv-banner inv-banner--bad"><span class="inv-banner__icon">⚠️</span><div class="inv-banner__body"><strong>Imeshindikana kupakia · Could not load</strong>${esc(err.message || err)}</div></div>`;
    }
  }
  async function base() {
    if (!S.settings) S.settings = await INV.loadSettings(S.ctx, S.year);
    if (!S.roster.length || S.rosterYear !== S.year) { S.roster = await INV.loadRoster(S.ctx, S.year); S.rosterYear = S.year; }
  }
  async function render() {
    global.document.querySelectorAll('.inv-tab').forEach((t) => t.classList.toggle('is-active', t.dataset.tab === S.tab));
    const main = $('rpMain');
    main.innerHTML = '<div class="inv-loading">Inapakia… · Loading…</div>';
    try {
      await base();
      const fn = { overview: renderOverview, approvals: renderApprovals, repairs: renderRepairs, spot: renderSpot, moves: renderMoves, flags: renderFlags, restock: renderRestock, handover: renderHandover, digest: renderDigest, settings: renderSettings }[S.tab] || renderOverview;
      await fn(main);
      if (S.settings && !S.settings.configured && S.tab !== 'settings') main.insertAdjacentHTML('afterbegin', `<div class="inv-banner inv-banner--warn"><span class="inv-banner__icon">🧪</span><div class="inv-banner__body"><strong>Moduli bado haijawashwa kwa mtu yeyote · Not switched on yet</strong>${S.ctx.isAdmin ? 'Fungua Mipangilio uchague wafanyakazi wa majaribio (pilot) · Open Settings and choose pilot workers.' : 'Admin anapaswa kuchagua wafanyakazi wa majaribio · Admin must choose the pilot workers.'}</div></div>`);
    } catch (err) {
      console.error('Inventory tab failed', err);
      main.innerHTML = `<div class="inv-banner inv-banner--bad"><span class="inv-banner__icon">⚠️</span><div class="inv-banner__body"><strong>Hitilafu · Error</strong>${esc(err.message || err)}</div></div>`;
    }
  }
  const stat = (label, value, kind, hint) => `<div class="inv-stat ${kind ? `inv-stat--${kind}` : ''}"><p class="inv-stat__label">${esc(label)}</p><div class="inv-stat__value">${esc(value)}</div>${hint ? `<div class="inv-stat__hint">${esc(hint)}</div>` : ''}</div>`;
  const workerOptions = (sel, filterFn) => S.roster.filter(filterFn || (() => true)).map((w) => `<option value="${esc(w.workerId)}" ${w.workerId === sel ? 'selected' : ''}>${esc(w.name)} · ${esc(w.role)}</option>`).join('');
  const nameOf = (wid) => S.roster.find((w) => w.workerId === wid)?.name || wid;
  const money = (v) => `TZS ${n0(v).toLocaleString('en-US')}`;

  // ---------- overview ----------
  function periodRange() {
    const f = S.filters;
    if (f.period === 'custom') return [f.from <= f.to ? f.from : f.to, f.from <= f.to ? f.to : f.from];
    return PDF.rangeFor(f.period, f.anchor);
  }
  async function renderOverview(main) {
    const [from, to] = periodRange();
    const f = S.filters;
    const data = await PDF.collect(S.ctx, from, to, { filter: { role: f.role, area: f.area, workerId: f.workerId }, includeMissing: from === to });
    S.lastData = data;
    const s = PDF.summarize(data);
    const areas = [...new Set(Object.values(data.dockets).map((d) => d && d.area).filter(Boolean))].sort();
    const roles = [...new Set(Object.values(data.dockets).map((d) => d && d.role).filter(Boolean))].sort();
    const cats = Object.keys(T.CATEGORIES).filter((c) => (data.totals.byCategory[c] || []).length);
    main.innerHTML = `
      <div class="inv-card"><div class="inv-filters">
        <label class="inv-field">Kipindi · Period<select id="fPeriod">${[['day', 'Siku · Day'], ['week', 'Wiki · Week'], ['month', 'Mwezi · Month'], ['year', 'Mwaka · Year'], ['custom', 'Chagua · Custom']].map(([k, l]) => `<option value="${k}" ${f.period === k ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
        ${f.period === 'custom' ? `<label class="inv-field">Kuanzia · From<input type="date" id="fFrom" value="${esc(f.from)}"></label><label class="inv-field">Hadi · To<input type="date" id="fTo" value="${esc(f.to)}"></label>` : `<label class="inv-field">Tarehe · Date<input type="date" id="fAnchor" value="${esc(f.anchor)}"></label>`}
        <label class="inv-field">Jukumu · Role<select id="fRole"><option value="">Wote · All</option>${roles.map((r) => `<option value="${esc(r)}" ${f.role === r ? 'selected' : ''}>${esc(INV.roleLabel(r))}</option>`).join('')}</select></label>
        <label class="inv-field">Eneo · Area<select id="fArea"><option value="">Yote · All</option>${areas.map((a) => `<option ${f.area === a ? 'selected' : ''}>${esc(a)}</option>`).join('')}</select></label>
        <label class="inv-field">Mfanyakazi · Worker<select id="fWorker"><option value="">Wote · All</option>${workerOptions(f.workerId)}</select></label>
        <div class="inv-inline"><button class="inv-btn inv-btn--primary" data-a="apply">Onyesha · Show</button><button class="inv-btn inv-btn--accent" data-a="pdf">📄 PDF</button></div>
      </div><p class="inv-small inv-muted" style="margin:8px 0 0">${esc(from === to ? fmtDaySw(from) : `${fmtDaySw(from)} — ${fmtDaySw(to)}`)}</p></div>
      <div class="inv-stats">
        ${stat('Ripoti · Reports', s.reports, '', `${s.approved} zimeidhinishwa · ${s.pending} zinasubiri`)}
        ${stat('Vibovu (vipya) · New damage', s.damaged, s.damaged ? 'bad' : '')}
        ${stat('Vimepotea · Lost', s.lost, s.lost ? 'bad' : '')}
        ${stat('Si sawa · Not OK', s.notOk, s.notOk ? 'warn' : '')}
        ${stat('Hitilafu wazi · Open flags', s.flags, s.flags ? 'warn' : '')}
        ${stat('Matengenezo wazi · Open repairs', s.openRepairs, s.stalled ? 'bad' : '', `${s.stalled} yamekwama · stalled`)}
        ${stat('Gharama za matengenezo · Repair cost', money(s.repairCost), '')}
        ${from === to ? stat('Hawakujaza · Not submitted', data.missing.length, data.missing.length ? 'bad' : '') : stat('Hakuna mabadiliko · No changes', s.reports ? `${Math.round((s.noChanges / s.reports) * 100)}%` : '—', '')}
      </div>
      <div class="inv-card"><h3>🏫 Jumla ya mali ya shule · School totals</h3><p class="inv-card__sub">Kulingana na hesabu za karibuni za kila eneo · From the latest count of every area. Kijani = imethibitishwa na Mwalimu Mkuu.</p>
        ${cats.length ? cats.map((c) => `<div class="inv-cat">${esc(T.CATEGORIES[c].sw)} · ${esc(T.CATEGORIES[c].en)}</div><div class="inv-list">${data.totals.byCategory[c].slice(0, 12).map((it) => `<div class="inv-li"><div class="inv-li__head"><div class="inv-li__title">${esc(INV.totalsPhrase(it))}</div><span class="inv-tag inv-tag--${it.pending ? 'warn' : 'good'}">${it.pending ? `${it.confirmed} ✔ · ${it.pending} inasubiri` : '✔ Imethibitishwa'}</span></div>${it.damaged || it.lost ? `<div class="inv-li__meta">vizima ${it.good} · vibovu ${it.damaged} · vimepotea ${it.lost}</div>` : ''}</div>`).join('')}</div>`).join('') : '<p class="inv-empty">Bado hakuna hesabu · No counts yet.</p>'}
      </div>
      <div class="inv-card"><h3>📈 Uharibifu na upotevu kwa muda · Damage & losses over time</h3>${trendChart(data, from, to)}</div>
      <div class="inv-card"><h3>📍 Maeneo yenye matatizo zaidi · Areas with most problems</h3>${topAreas(data)}</div>
      <div class="inv-card"><h3>👥 Kwa kila mfanyakazi · By worker</h3>${workerTable(data)}</div>
      <div class="inv-card"><h3>⚠️ Hitilafu · Inconsistencies</h3>${flagList(data.flags, data, false)}</div>`;
    bindChart(main);
  }
  function problemBuckets(data, from, to) {
    const days = daysBetween(from, to) + 1;
    const byMonth = days > 62;
    const keys = [];
    if (byMonth) { let d = `${from.slice(0, 7)}-01`; while (d <= to) { keys.push(d.slice(0, 7)); const n = new Date(`${d}T12:00:00Z`); n.setUTCMonth(n.getUTCMonth() + 1); d = n.toISOString().slice(0, 10); } }
    else for (let i = 0; i < days; i += 1) keys.push(addDays(from, i));
    const b = Object.fromEntries(keys.map((k) => [k, { damaged: 0, lost: 0, notOk: 0 }]));
    data.problems.forEach((p) => { const k = byMonth ? p.ymd.slice(0, 7) : p.ymd; if (b[k] && b[k][p.kind] !== undefined) b[k][p.kind] += p.kind === 'notOk' ? 1 : n0(p.qty); });
    return { keys, b, byMonth };
  }
  function trendChart(data, from, to) {
    const { keys, b, byMonth } = problemBuckets(data, from, to);
    if (keys.length < 2) return `<p class="inv-card__sub">Chagua wiki, mwezi au mwaka kuona mwenendo · Choose a week, month or year to see the trend.</p>${trendTable(keys, b)}`;
    const series = [['damaged', 'Vibovu · Damaged'], ['lost', 'Vimepotea · Lost'], ['notOk', 'Si sawa · Not OK']];
    const max = Math.max(1, ...keys.map((k) => b[k].damaged + b[k].lost + b[k].notOk));
    const W = 640; const H = 200; const padL = 28; const padB = 22; const plotH = H - padB - 8; const plotW = W - padL - 6;
    const step = plotW / keys.length; const bw = Math.max(3, Math.min(28, step - 4));
    const ticks = [0, Math.ceil(max / 2), max];
    let bars = '';
    keys.forEach((k, i) => {
      let yTop = plotH + 8;
      const x = padL + i * step + (step - bw) / 2;
      const segs = series.filter(([s]) => b[k][s] > 0);
      segs.forEach(([s], j) => {
        const h = (b[k][s] / max) * plotH;
        const gap = j > 0 ? 2 : 0;
        yTop -= h;
        const last = j === segs.length - 1;
        const hh = Math.max(1, h - gap);
        bars += last
          ? `<path d="M${x},${yTop + hh} V${yTop + 4} Q${x},${yTop} ${x + 4},${yTop} H${x + bw - 4} Q${x + bw},${yTop} ${x + bw},${yTop + 4} V${yTop + hh} Z" fill="${COLORS[s]}"/>`
          : `<rect x="${x}" y="${yTop}" width="${bw}" height="${hh}" fill="${COLORS[s]}"/>`;
      });
      bars += `<rect x="${padL + i * step}" y="8" width="${step}" height="${plotH}" fill="transparent" data-k="${esc(k)}" class="inv-hit"/>`;
    });
    const every = Math.ceil(keys.length / 8);
    const labels = keys.map((k, i) => (i % every === 0 ? `<text x="${padL + i * step + step / 2}" y="${H - 6}" font-size="10" text-anchor="middle" fill="#64748b">${esc(byMonth ? k.slice(5) : k.slice(8))}</text>` : '')).join('');
    const grid = ticks.map((t) => { const y = 8 + plotH - (t / max) * plotH; return `<line x1="${padL}" x2="${W - 6}" y1="${y}" y2="${y}" stroke="#e2e8f0" stroke-width="1"/><text x="${padL - 4}" y="${y + 3}" font-size="10" text-anchor="end" fill="#64748b">${t}</text>`; }).join('');
    S.chartData = { keys, b, byMonth };
    return `<div class="inv-legend">${series.map(([s, l]) => `<span style="--c:${COLORS[s]}">${esc(l)}</span>`).join('')}</div>
      <div style="position:relative" data-chart><svg viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="Uharibifu kwa ${byMonth ? 'mwezi' : 'siku'}">${grid}${bars}${labels}</svg>
      <div data-tip class="inv-hide" style="position:absolute;pointer-events:none;background:#0f172a;color:#fff;border-radius:8px;padding:6px 8px;font-size:12px;white-space:nowrap"></div></div>
      <details style="margin-top:8px"><summary class="inv-small" style="cursor:pointer">Jedwali · Table view</summary>${trendTable(keys, b)}</details>`;
  }
  function trendTable(keys, b) {
    return `<div class="inv-table-wrap" style="margin-top:6px"><table class="inv-table"><thead><tr><th>Kipindi</th><th class="num">Vibovu</th><th class="num">Vimepotea</th><th class="num">Si sawa</th></tr></thead><tbody>${keys.map((k) => `<tr><td>${esc(k)}</td><td class="num">${b[k].damaged}</td><td class="num">${b[k].lost}</td><td class="num">${b[k].notOk}</td></tr>`).join('')}</tbody></table></div>`;
  }
  function bindChart(root) {
    const box = root.querySelector('[data-chart]');
    if (!box || !S.chartData) return;
    const tip = box.querySelector('[data-tip]');
    box.addEventListener('mousemove', (e) => {
      const hit = e.target.closest('.inv-hit');
      if (!hit) { tip.classList.add('inv-hide'); return; }
      const k = hit.dataset.k; const v = S.chartData.b[k];
      tip.innerHTML = `<b>${esc(S.chartData.byMonth ? k : fmtDaySw(k))}</b><br>Vibovu ${v.damaged} · Vimepotea ${v.lost} · Si sawa ${v.notOk}`;
      const r = box.getBoundingClientRect();
      tip.style.left = `${Math.min(r.width - 180, Math.max(0, e.clientX - r.left + 10))}px`;
      tip.style.top = `${Math.max(0, e.clientY - r.top - 50)}px`;
      tip.classList.remove('inv-hide');
    });
    box.addEventListener('mouseleave', () => tip.classList.add('inv-hide'));
  }
  function topAreas(data) {
    const by = {};
    data.problems.forEach((p) => { const k = p.area || '—'; const a = by[k] || (by[k] = { area: k, n: 0, damaged: 0, lost: 0, notOk: 0, spot: 0 }); a.n += 1; a[p.kind] = (a[p.kind] || 0) + (p.kind === 'notOk' ? 1 : n0(p.qty)); if (p.source === 'spotCheck') a.spot += 1; });
    const rows = Object.values(by).sort((a, b) => b.n - a.n).slice(0, 10);
    if (!rows.length) return '<p class="inv-empty">Hakuna matatizo katika kipindi hiki · No problems in this period.</p>';
    return `<div class="inv-table-wrap"><table class="inv-table"><thead><tr><th>Eneo · Area</th><th class="num">Matukio</th><th class="num">Vibovu</th><th class="num">Vimepotea</th><th class="num">Si sawa</th><th class="num">Ukaguzini</th></tr></thead><tbody>${rows.map((a) => `<tr><td>${esc(a.area)}</td><td class="num">${a.n}</td><td class="num">${a.damaged || 0}</td><td class="num">${a.lost || 0}</td><td class="num">${a.notOk || 0}</td><td class="num">${a.spot}</td></tr>`).join('')}</tbody></table></div>`;
  }
  function workerTable(data) {
    const per = {};
    data.reports.forEach((r) => { const p = per[r.workerId] || (per[r.workerId] = { name: r.workerName, role: r.role, area: r.area, n: 0, approved: 0, noChanges: 0, self: 0, spot: 0 }); p.n += 1; if (r.status === 'approved') p.approved += 1; if (r.noChanges) p.noChanges += 1; });
    data.problems.forEach((x) => { const p = per[x.workerId]; if (!p) return; if (x.source === 'spotCheck') p.spot += 1; else p.self += 1; });
    data.spotChecks.filter((x) => x.discrepancy).forEach((x) => { const p = per[x.workerId]; if (p) p.disc = (p.disc || 0) + 1; });
    const rows = Object.values(per).sort((a, b) => (b.disc || 0) - (a.disc || 0) || b.self - a.self);
    if (!rows.length) return '<p class="inv-empty">Hakuna ripoti · No reports.</p>';
    return `<div class="inv-table-wrap"><table class="inv-table"><thead><tr><th>Mfanyakazi</th><th>Eneo</th><th class="num">Ripoti</th><th class="num">Zimeidhinishwa</th><th class="num">Hakuna mabadiliko</th><th class="num">Ameripoti mwenyewe</th><th class="num">Tofauti za ukaguzi</th></tr></thead><tbody>${rows.map((p) => `<tr class="${p.disc ? 'is-bad' : ''}"><td>${esc(p.name)}<div class="inv-small inv-muted">${esc(INV.roleLabel(p.role))}</div></td><td>${esc(p.area)}</td><td class="num">${p.n}</td><td class="num">${p.approved}</td><td class="num">${p.noChanges}</td><td class="num"><span class="inv-tag inv-tag--good">${p.self}</span></td><td class="num">${p.disc ? `<span class="inv-tag inv-tag--bad">${p.disc}</span>` : 0}</td></tr>`).join('')}</tbody></table></div>
      <p class="inv-small inv-muted">Matatizo aliyoripoti mfanyakazi mwenyewe hayaadhibiwi na mfumo; tofauti za ukaguzi ni rekodi ya uwajibikaji. Mfumo haukati mshahara wala faini — uongozi ndio unaoamua.</p>`;
  }
  // A worker whose "No changes" streak (5+) ended in a spot-check discrepancy is highlighted.
  function streakHighlights(data) {
    const out = new Set();
    data.spotChecks.filter((x) => x.discrepancy).forEach((x) => {
      const mine = data.reports.filter((r) => r.workerId === x.workerId && r.ymd <= x.ymd).sort((a, b) => b.ymd.localeCompare(a.ymd));
      let streak = 0; for (const r of mine) { if (r.noChanges) streak += 1; else break; }
      if (streak >= 5) out.add(x.workerId);
    });
    return out;
  }
  function flagList(flags, data, withActions) {
    if (!flags.length) return '<p class="inv-empty">Hakuna hitilafu · No inconsistencies.</p>';
    const hl = data ? streakHighlights(data) : new Set();
    return `<div class="inv-list">${flags.sort((a, b) => (b.at || 0) - (a.at || 0)).map((f) => `<div class="inv-li" ${hl.has(f.workerId) ? 'style="border-color:#f87171;background:#fff5f5"' : ''}>
      <div class="inv-li__head"><div><div class="inv-li__title">${esc(FLAG[f.type] || f.type)} — ${esc(f.workerName || '')}</div><div class="inv-li__meta">${esc(f.ymd)} · ${esc(f.area || '')}${hl.has(f.workerId) ? ' · <b style="color:var(--inv-bad)">"Hakuna mabadiliko" siku 5+ kisha ukaguzi ukapata tofauti</b>' : ''}</div></div>
        <span class="inv-tag inv-tag--${f.resolved ? 'good' : 'warn'}">${f.resolved ? 'Imetatuliwa' : 'Wazi · Open'}</span></div>
      <div class="inv-li__meta">${esc(f.detail || '')}</div>
      ${withActions && !f.resolved ? `<div class="inv-li__actions"><button class="inv-btn inv-btn--sm" data-a="resolveflag" data-id="${esc(f.id)}" data-ymd="${esc(f.ymd)}">Imetatuliwa · Mark resolved</button></div>` : ''}</div>`).join('')}</div>`;
  }

  // ---------- approvals ----------
  async function renderApprovals(main) {
    const ymd = S.approvalsYmd || todayYMD();
    main.innerHTML = `<div class="inv-card"><div class="inv-inline"><label class="inv-field">Tarehe · Date<input type="date" id="apDate" value="${esc(ymd)}"></label>
      <button class="inv-btn inv-btn--accent" data-a="daypdf">📄 PDF ya siku · Daily PDF</button></div></div><div id="apQueue"></div>`;
    await RV.renderQueue($('apQueue'), S.ctx, ymd, { includeMissing: true, showOwn: !!S.ctx.workerId });
  }

  // ---------- repairs ----------
  async function renderRepairs(main) {
    const repairs = await INV.listRepairs(S.ctx, S.year);
    const ymd = todayYMD();
    const filter = S.repairFilter || 'open';
    const open = repairs.filter((r) => INV.OPEN_REPAIR.includes(r.status));
    const done = repairs.filter((r) => r.status === 'confirmed' || (r.status === 'repaired' && r.repairedAt));
    const avg = done.length ? (done.reduce((t, r) => t + Math.max(0, ((r.repairedAt || r.confirmedAt || r.reportedAt) - r.reportedAt) / 86400000), 0) / done.length) : 0;
    const month = ymd.slice(0, 7);
    const cost = (fn) => repairs.filter(fn).reduce((t, r) => t + n0(r.actualCost), 0);
    const group = (key) => { const g = {}; repairs.filter((r) => r.status !== 'cancelled').forEach((r) => { const k = key(r) || '—'; const x = g[k] || (g[k] = { n: 0, cost: 0 }); x.n += 1; x.cost += n0(r.actualCost); }); return Object.entries(g).sort((a, b) => b[1].n - a[1].n); };
    const list = repairs.filter((r) => filter === 'all' ? true : filter === 'open' ? INV.OPEN_REPAIR.includes(r.status) : filter === 'stalled' ? INV.isStalled(r, S.settings, ymd) : r.status === filter);
    main.innerHTML = `
      <div class="inv-stats">
        ${stat('Wazi · Open', open.length, open.length ? 'warn' : '')}
        ${stat(`Yamekwama (> siku ${S.settings.stalledRepairDays}) · Stalled`, open.filter((r) => INV.isStalled(r, S.settings, ymd)).length, open.some((r) => INV.isStalled(r, S.settings, ymd)) ? 'bad' : '')}
        ${stat('Wastani wa siku kutengeneza · Avg days', avg ? avg.toFixed(1) : '—', '')}
        ${stat('Gharama leo · Today', money(cost((r) => r.repairedAt && ymdOf(r.repairedAt) === ymd)), '')}
        ${stat('Gharama mwezi huu · This month', money(cost((r) => r.repairedAt && ymdOf(r.repairedAt).startsWith(month))), '')}
        ${stat(`Gharama ${S.year} · Year`, money(cost(() => true)), '')}
      </div>
      <div class="inv-card"><div class="inv-inline">
        <label class="inv-field">Onyesha · Show<select id="repFilter">${[['open', 'Wazi · Open'], ['stalled', 'Yamekwama · Stalled'], ['repaired', 'Yanasubiri uthibitisho · Awaiting confirmation'], ['confirmed', 'Yamethibitishwa · Confirmed'], ['cannotRepair', 'Hayatengenezeki'], ['all', 'Yote · All']].map(([k, l]) => `<option value="${k}" ${filter === k ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
        <button class="inv-btn" data-a="repcsv">⬇️ CSV (gharama · costs)</button><button class="inv-btn inv-btn--accent" data-a="reppdf">📄 PDF</button></div></div>
      <div class="inv-card"><h3>Tiketi za matengenezo · Repair tickets (${list.length})</h3>${list.length ? `<div class="inv-list">${list.map((r) => repairLi(r, ymd)).join('')}</div>` : '<p class="inv-empty">Hakuna · None</p>'}</div>
      <div class="inv-row">
        <div class="inv-card"><h3>Kwa eneo · By area</h3>${groupTable(group((r) => r.area))}</div>
        <div class="inv-card"><h3>Kwa kundi · By category</h3>${groupTable(group((r) => T.CATEGORIES[r.category]?.sw || r.category))}</div>
        <div class="inv-card"><h3>Kwa mwezi · By month</h3>${groupTable(group((r) => (r.reportYmd || '').slice(0, 7)))}</div>
      </div>`;
    S.repairs = repairs;
  }
  function groupTable(rows) {
    if (!rows.length) return '<p class="inv-empty">—</p>';
    return `<div class="inv-table-wrap"><table class="inv-table"><thead><tr><th></th><th class="num">Matengenezo</th><th class="num">Gharama</th></tr></thead><tbody>${rows.map(([k, v]) => `<tr><td>${esc(k)}</td><td class="num">${v.n}</td><td class="num">${n0(v.cost).toLocaleString('en-US')}</td></tr>`).join('')}</tbody></table></div>`;
  }
  function repairLi(r, ymd) {
    const st = REP[r.status] || ['muted', r.status];
    const stalled = INV.isStalled(r, S.settings, ymd);
    const act = (a, l, k) => `<button class="inv-btn inv-btn--sm ${k ? `inv-btn--${k}` : ''}" data-a="rep" data-op="${a}" data-id="${esc(r.id)}">${l}</button>`;
    const open = INV.OPEN_REPAIR.includes(r.status);
    return `<div class="inv-li" ${stalled ? 'style="border-color:#f87171;background:#fff5f5"' : ''}>
      <div class="inv-li__head"><div><div class="inv-li__title">${esc(r.itemName)} × ${n0(r.qty)} — ${esc(r.area || '')}</div>
        <div class="inv-li__meta">${esc(r.workerName || '')} · ${esc(r.reportYmd || '')} · siku ${INV.repairAgeDays(r, ymd)}${stalled ? ' · <b style="color:var(--inv-bad)">IMEKWAMA · STALLED</b>' : ''}</div>
        <div class="inv-li__meta">${esc(r.description || '')}${r.who ? ` · Nani/jinsi: ${esc(r.who)}` : ''}</div>
        ${r.assignedTo ? `<div class="inv-li__meta">🔧 ${esc(r.assignedTo)} (${r.assigneeType === 'outside' ? 'fundi wa nje' : 'mfanyakazi'})${r.dueDate ? ` · hadi ${esc(r.dueDate)}` : ''}${r.estimatedCost ? ` · makadirio ${money(r.estimatedCost)}` : ''}${r.actualCost ? ` · gharama ${money(r.actualCost)}` : ''}</div>` : ''}</div>
        <div class="inv-inline"><span class="inv-tag inv-tag--${st[0]}">${esc(st[1])}</span>${RV.sourceTag(r.source)}</div></div>
      ${open ? `<div class="inv-li__actions">${act('assign', '👷 Panga fundi · Assign')}${r.status !== 'inProgress' && r.status !== 'repaired' ? act('inProgress', '⏳ Inaendelea') : ''}${r.status !== 'repaired' ? act('repaired', '✔ Imetengenezwa · Repaired', 'good') : act('confirm', '✅ Thibitisha mwenyewe · Confirm', 'good')}${act('cannotRepair', '✖ Haitengenezeki', 'bad')}</div>` : (r.status === 'confirmed' ? '' : r.status === 'cancelled' ? '' : `<div class="inv-li__actions">${act('reopen', '↺ Fungua tena · Reopen')}</div>`)}
    </div>`;
  }
  async function repairAction(id, op) {
    const r = (S.repairs || []).find((x) => x.id === id);
    if (!r) return;
    let data = {};
    if (op === 'assign') {
      data = await UI.modal({
        title: 'Panga fundi · Assign repair', html: `<div class="inv-row">
          <label class="inv-field">Fundi · Who fixes<input id="raWho" value="${esc(r.assignedTo || '')}" placeholder="Jina la mfanyakazi au fundi wa nje"></label>
          <label class="inv-field">Aina · Type<select id="raType"><option value="staff">Mfanyakazi · Staff</option><option value="outside" ${r.assigneeType === 'outside' ? 'selected' : ''}>Fundi wa nje · Outside technician</option></select></label>
          <label class="inv-field">Hadi tarehe · Due date<input type="date" id="raDue" value="${esc(r.dueDate || addDays(todayYMD(), 3))}"></label>
          <label class="inv-field">Makadirio (TZS) · Estimated cost<input type="number" min="0" id="raCost" value="${esc(r.estimatedCost || '')}"></label></div>`,
        actions: [{ label: 'Ghairi', value: null }, { label: 'Hifadhi · Save', kind: 'primary', validate: (root) => root.querySelector('#raWho').value.trim().length > 1, value: (root) => ({ assignedTo: root.querySelector('#raWho').value, assigneeType: root.querySelector('#raType').value, dueDate: root.querySelector('#raDue').value, estimatedCost: root.querySelector('#raCost').value }) }],
      });
      if (!data) return;
    } else if (op === 'repaired') {
      data = await UI.modal({ title: 'Imetengenezwa · Mark repaired', html: `<label class="inv-field">Gharama halisi (TZS) · Actual cost<input type="number" min="0" id="rcCost" value="${esc(r.estimatedCost || '')}"></label><p class="inv-card__sub">Mhusika atathibitisha kwenye ripoti yake ijayo · The responsible worker confirms in their next report.</p>`, actions: [{ label: 'Ghairi', value: null }, { label: 'Hifadhi · Save', kind: 'good', value: (root) => ({ actualCost: root.querySelector('#rcCost').value }) }] });
      if (!data) return;
    } else if (op === 'cannotRepair') {
      const note = await UI.promptText('Haitengenezeki · Cannot repair', 'Eleza kwa nini. Ombi la write-off litaundwa · A write-off request will be created.', { minLength: 5, kind: 'bad' });
      if (!note) return;
      data = { note };
    } else if (op === 'confirm') {
      const ok = await UI.modal({ title: 'Thibitisha matengenezo · Confirm repair', html: '<p>Kawaida mhusika ndiye anayethibitisha. Thibitisha mwenyewe tu kama umekiona kimetengenezwa · Normally the worker confirms; confirm only if you have seen it.</p>', actions: [{ label: 'Ghairi', value: false }, { label: 'Thibitisha', value: true, kind: 'good' }] });
      if (!ok) return;
    }
    const res = await INV.updateRepair(S.ctx, r, op, data);
    UI.toast(res.ok ? 'Imehifadhiwa · Saved' : 'Imeshindikana', res.ok ? 'success' : 'error');
    render();
  }
  function repairsCsv() {
    const rows = [['id', 'reportDate', 'item', 'category', 'area', 'worker', 'qty', 'status', 'source', 'assignedTo', 'assigneeType', 'dueDate', 'estimatedCostTZS', 'actualCostTZS', 'repairedAt', 'confirmedAt', 'daysOpen']];
    (S.repairs || []).filter((r) => r.status !== 'cancelled').forEach((r) => rows.push([r.id, r.reportYmd, r.itemName, r.category, r.area, r.workerName, n0(r.qty), r.status, r.source, r.assignedTo || '', r.assigneeType || '', r.dueDate || '', n0(r.estimatedCost), n0(r.actualCost), r.repairedAt ? fmtDateTime(r.repairedAt) : '', r.confirmedAt ? fmtDateTime(r.confirmedAt) : '', INV.repairAgeDays(r, todayYMD())]));
    const csv = rows.map((row) => row.map((c) => `"${String(c ?? '').replace(/"/g, '""')}"`).join(',')).join('\r\n');
    const a = global.document.createElement('a');
    a.href = URL.createObjectURL(new Blob([`﻿${csv}`], { type: 'text/csv;charset=utf-8' }));
    a.download = `SoMAp_Repairs_${String(S.ctx.schoolName).replace(/[^\w-]+/g, '_')}_${S.year}.csv`;
    a.click();
  }
  async function repairsPdf() {
    const JsPDF = await PDF.ensureJsPDF();
    const doc = new JsPDF({ unit: 'mm', format: 'a4', orientation: 'landscape' });
    doc.setFillColor(15, 118, 110); doc.rect(0, 0, doc.internal.pageSize.getWidth(), 20, 'F');
    doc.setTextColor(255, 255, 255); doc.setFontSize(13); doc.text(`Matengenezo · Repairs — ${S.ctx.schoolName} ${S.year}`, 12, 12);
    doc.autoTable({ startY: 26, headStyles: { fillColor: [15, 118, 110] }, styles: { fontSize: 7.5 },
      head: [['Tarehe', 'Kitu', 'Eneo', 'Mhusika', 'Hali', 'Chanzo', 'Fundi', 'Hadi', 'Makadirio', 'Gharama', 'Siku']],
      body: (S.repairs || []).filter((r) => r.status !== 'cancelled').map((r) => [r.reportYmd, `${r.itemName} x${n0(r.qty)}`, r.area, r.workerName, `${(REP[r.status] || [0, r.status])[1]}${INV.isStalled(r, S.settings, todayYMD()) ? ' (IMEKWAMA)' : ''}`, r.source === 'spotCheck' ? 'Ukaguzini' : 'Mhusika', r.assignedTo || '', r.dueDate || '', n0(r.estimatedCost).toLocaleString('en-US'), n0(r.actualCost).toLocaleString('en-US'), INV.repairAgeDays(r, todayYMD())]) });
    doc.save(`SoMAp_Repairs_${String(S.ctx.schoolName).replace(/[^\w-]+/g, '_')}_${S.year}.pdf`);
  }

  // ---------- spot checks ----------
  async function renderSpot(main) {
    const ymd = todayYMD();
    const plan = await INV.ensureWeekPlan(S.ctx, ymd);
    const weeks = [];
    for (let i = 0; i < 6; i += 1) weeks.push(await INV.weekSpotStats(S.ctx, addDays(weekMonday(ymd), -7 * i)));
    const picks = Object.entries(plan.picks || {}).map(([id, p]) => Object.assign({ id }, p)).sort((a, b) => a.ymd.localeCompare(b.ymd));
    const recent = await INV.loadRange(S.ctx, 'spotChecks', addDays(ymd, -30), ymd);
    const history = []; Object.entries(recent).forEach(([d, day]) => Object.entries(day || {}).forEach(([id, s]) => history.push(Object.assign({ id, ymd: d }, s))));
    const dockets = await INV.loadDockets(S.ctx, S.year);
    main.innerHTML = `
      <div class="inv-card"><h3>🎯 Ukaguzi wa leo · Today's spot checks</h3><p class="inv-card__sub">Imechaguliwa kwa nasibu na mfumo; wafanyakazi hawaoni orodha hii · Picked at random, not shown to workers. Kila eneo hukaguliwa angalau mara moja kwa mwezi kwa zamu.</p>
        ${picks.length ? `<div class="inv-list">${picks.map((p) => `<div class="inv-li"><div class="inv-li__head"><div><div class="inv-li__title">${esc(p.workerName)} — ${esc(p.area || '')}</div><div class="inv-li__meta">${esc(fmtDaySw(p.ymd))}${p.ymd < ymd && !p.done ? ' · <b style="color:var(--inv-bad)">imepita · overdue</b>' : ''}</div></div>
          ${p.done ? `<span class="inv-tag inv-tag--good">✔ Imefanyika ${fmtTime(p.doneAt)}</span>` : p.ymd <= ymd ? `<button class="inv-btn inv-btn--primary inv-btn--sm" data-a="spot" data-w="${esc(p.workerId)}" data-pick="${esc(p.id)}">Kagua sasa · Inspect now</button>` : '<span class="inv-tag inv-tag--muted">Baadaye wiki hii</span>'}</div></div>`).join('')}</div>` : '<p class="inv-empty">Hakuna dhamana zinazotumika bado · No active dockets yet.</p>'}
      </div>
      <div class="inv-card"><h3>➕ Ukaguzi wa ghafla wakati wowote · Ad-hoc spot check</h3><div class="inv-inline">
        <label class="inv-field">Dhamana · Docket<select id="spotWorker"><option value="">— chagua —</option>${Object.entries(dockets).filter(([, d]) => d && !d.endedAt && d.latest).map(([wid, d]) => `<option value="${esc(wid)}">${esc(d.workerName || nameOf(wid))} — ${esc(d.area || '')}</option>`).join('')}</select></label>
        <button class="inv-btn inv-btn--accent" data-a="spotadhoc">Anza · Start</button></div></div>
      <div class="inv-card"><h3>📅 Iliyopangwa dhidi ya iliyofanyika · Planned vs done</h3><p class="inv-card__sub">Uongozi pia unawajibika · Management is accountable too.</p>
        <div class="inv-table-wrap"><table class="inv-table"><thead><tr><th>Wiki inayoanza</th><th class="num">Iliyopangwa</th><th class="num">Iliyofanyika (zilizopangwa)</th><th class="num">Zote zilizofanyika</th></tr></thead><tbody>${weeks.map((w) => `<tr class="${w.plannedDone < w.planned && w.monday < weekMonday(ymd) ? 'is-bad' : ''}"><td>${esc(w.monday)}</td><td class="num">${w.planned}</td><td class="num">${w.plannedDone}</td><td class="num">${w.done}</td></tr>`).join('')}</tbody></table></div></div>
      <div class="inv-card"><h3>🕘 Ukaguzi wa siku 30 · Last 30 days</h3>${history.length ? `<div class="inv-list">${history.sort((a, b) => (b.at || 0) - (a.at || 0)).map((s) => `<div class="inv-li"><div class="inv-li__head"><div><div class="inv-li__title">${esc(s.workerName)} — ${esc(s.area || '')}</div><div class="inv-li__meta">${esc(s.ymd)} · ${esc(s.byName || '')}${s.planned ? ' · iliyopangwa' : ' · ya ghafla'}</div></div><span class="inv-tag inv-tag--${s.discrepancy ? 'bad' : 'good'}">${s.discrepancy ? `Tofauti ${s.discrepancyItems?.length || 0}` : 'Inalingana · Matches'}</span></div></div>`).join('')}</div>` : '<p class="inv-empty">Hakuna · None</p>'}</div>`;
  }
  async function spotCheck(workerId, pickId) {
    const docket = await INV.loadDocket(S.ctx, workerId, S.year, {});
    const today = await INV.loadReport(S.ctx, todayYMD(), workerId);
    const report = today && today.status !== 'draft' ? Object.assign({ ymd: todayYMD() }, today) : (docket.latest ? Object.assign({ workerId, workerName: docket.workerName, area: docket.area, role: docket.role }, docket.latest) : null);
    if (!report) { UI.toast('Mfanyakazi huyu hana ripoti bado · No report yet', 'warning'); return; }
    const items = await INV.docketItems(S.ctx, S.year, docket);
    const rows = items.filter((d) => report.items?.[d.id]).map((d) => {
      const v = report.items[d.id];
      const txt = v.type === 'count' ? `${n0(v.good)} vizima / ${n0(v.damaged)} vibovu / ${n0(v.lost)} vimepotea` : v.type === 'cond' ? (v.ok === false ? '✖ Si sawa' : '✔ Sawa') : v.type === 'cons' ? `${n0(v.qty)}` : (v.value || '');
      return `<div class="inv-li" data-sc="${esc(d.id)}"><div class="inv-li__head"><div><div class="inv-li__title">${esc(d.sw)}</div><div class="inv-li__meta">Ripoti: ${esc(txt)}</div></div>
        <div class="inv-seg"><button type="button" data-m="1" class="is-ok">Inalingana</button><button type="button" data-m="0">Hailingani</button></div></div>
        <div data-note class="inv-hide inv-row"><label class="inv-field">Ulichokuta · What you found<input data-f="note" placeholder="Mf. kuta zina matope"></label>${v.type === 'count' ? '<label class="inv-field">Idadi yenye tatizo · Qty<input type="number" min="1" data-f="qty" value="1"></label>' : ''}</div></div>`;
    }).join('');
    const findings = await UI.modal({
      title: `Ukaguzi wa ghafla · Spot check — ${report.workerName || ''}`,
      html: `<p class="inv-card__sub">${esc(report.area || '')} · ripoti ya ${esc(report.ymd || '')} (${esc(report.status || '')}). Linganisha kila kitu na ulichokiona · Compare each item with what you see.</p><div class="inv-list">${rows}</div>`,
      onMount: (card) => card.addEventListener('click', (e) => {
        const b = e.target.closest('[data-m]'); if (!b) return;
        const li = b.closest('[data-sc]');
        li.querySelectorAll('[data-m]').forEach((x) => { x.className = ''; });
        b.className = b.dataset.m === '1' ? 'is-ok' : 'is-bad';
        li.querySelector('[data-note]').classList.toggle('inv-hide', b.dataset.m === '1');
      }),
      actions: [{ label: 'Ghairi', value: null }, {
        label: 'Hifadhi ukaguzi · Save', kind: 'primary',
        validate: (root) => { const bad = [...root.querySelectorAll('[data-sc]')].filter((li) => li.querySelector('[data-m="0"]').className === 'is-bad' && !li.querySelector('[data-f="note"]').value.trim()); if (bad.length) { UI.toast('Eleza ulichokuta kwa kila kisicholingana · Describe each mismatch', 'warning'); return false; } return true; },
        value: (root) => Object.fromEntries([...root.querySelectorAll('[data-sc]')].map((li) => {
          const mismatch = li.querySelector('[data-m="0"]').className === 'is-bad';
          return [li.dataset.sc, mismatch ? { match: false, note: li.querySelector('[data-f="note"]').value.trim(), qty: n0(li.querySelector('[data-f="qty"]')?.value || 1) } : { match: true }];
        })),
      }],
    });
    if (!findings) return;
    const res = await INV.saveSpotCheck(S.ctx, { workerId, report, docketArea: docket.area || report.area, findings, planPickId: pickId || '', items });
    UI.toast(res.discrepancy ? 'Tofauti imerekodiwa na tiketi ya matengenezo imefunguliwa · Discrepancy recorded' : 'Ukaguzi umehifadhiwa: inalingana · Matches', res.discrepancy ? 'warning' : 'success', 6000);
    render();
  }

  // ---------- movements ----------
  async function renderMoves(main) {
    const ymd = todayYMD();
    const moves = await INV.listMovements(S.ctx, addDays(ymd, -60), ymd);
    const pending = moves.filter((m) => m.type === 'writeOff' && m.status === 'pending');
    const dockets = await INV.loadDockets(S.ctx, S.year);
    main.innerHTML = `
      <div class="inv-card"><h3>🗑️ Write-off zinazosubiri idhini · Pending write-offs (${pending.length})</h3>${pending.length ? `<div class="inv-list">${pending.map((m) => `<div class="inv-li"><div class="inv-li__head"><div><div class="inv-li__title">${esc(m.itemName)} × ${n0(m.qty)} (${m.bucket === 'damaged' ? 'vibovu' : 'vimepotea'})</div><div class="inv-li__meta">${esc(m.fromWorkerName || '')} · ${esc(m.fromArea || '')} · ${fmtDateTime(m.at)} · ${esc(m.reason || '')}</div></div>
        <div class="inv-li__actions"><button class="inv-btn inv-btn--good inv-btn--sm" data-a="wo" data-ok="1" data-id="${esc(m.id)}">Idhinisha · Approve</button><button class="inv-btn inv-btn--bad inv-btn--sm" data-a="wo" data-ok="0" data-id="${esc(m.id)}">Kataa · Reject</button></div></div></div>`).join('')}</div>` : '<p class="inv-empty">Hakuna · None</p>'}</div>
      <div class="inv-card"><h3>📥 Mali mpya · Stock in</h3><p class="inv-card__sub">Ununuzi au msaada unaoingia kwenye dhamana ya mfanyakazi. Mpokeaji atathibitisha kupokea · The receiving worker confirms receipt.</p>
        <div class="inv-row">
          <label class="inv-field">Kwenda kwa · To<select id="siTo"><option value="">— chagua —</option>${Object.entries(dockets).filter(([, d]) => d && !d.endedAt).map(([wid, d]) => `<option value="${esc(wid)}">${esc(d.workerName || nameOf(wid))} — ${esc(d.area || '')}</option>`).join('')}${S.roster.filter((w) => !dockets[w.workerId]).map((w) => `<option value="${esc(w.workerId)}">${esc(w.name)} (bado hana dhamana)</option>`).join('')}</select></label>
          <label class="inv-field">Kitu · Item<select id="siItem">${Object.entries(T.CATALOG).filter(([, d]) => d.type === 'count').map(([id, d]) => `<option value="${esc(id)}">${esc(d.sw)}</option>`).join('')}<option value="__new">➕ Kitu kipya…</option></select></label>
          <label class="inv-field">Jina la kitu kipya · New item name<input id="siNew" placeholder="ukichagua kitu kipya"></label>
          <label class="inv-field">Idadi · Qty<input type="number" min="1" id="siQty"></label>
          <label class="inv-field">Chanzo · Source<select id="siSource"><option value="purchase">Ununuzi · Purchase</option><option value="donation">Msaada · Donation</option><option value="other">Nyingine · Other</option></select></label>
          <label class="inv-field">Gharama (TZS, hiari) · Cost<input type="number" min="0" id="siCost"></label>
        </div><div style="margin-top:10px"><button class="inv-btn inv-btn--primary" data-a="stockin">Tuma · Send</button></div></div>
      <div class="inv-card"><h3>🧾 Mienendo ya siku 60 · Last 60 days</h3>${moves.length ? `<div class="inv-table-wrap"><table class="inv-table"><thead><tr><th>Tarehe</th><th>Aina</th><th>Kitu</th><th class="num">Idadi</th><th>Kutoka</th><th>Kwenda</th><th>Sababu</th><th>Hali</th></tr></thead><tbody>${moves.map((m) => `<tr><td>${esc(m.ymd)}</td><td>${esc({ transfer: 'Uhamisho', stockIn: 'Mali mpya', writeOff: 'Write-off' }[m.type] || m.type)}</td><td>${esc(m.itemName || m.itemId)}</td><td class="num">${n0(m.qty)}</td><td>${esc(m.fromWorkerName || m.source || '')}</td><td>${esc(m.toWorkerName || '')}</td><td>${esc(m.reason || '')}</td><td>${esc(m.status)}</td></tr>`).join('')}</tbody></table></div>` : '<p class="inv-empty">Hakuna · None</p>'}</div>`;
  }
  async function stockIn() {
    const to = $('siTo').value; const qty = n0($('siQty').value); let itemId = $('siItem').value;
    if (!to || !qty) { UI.toast('Chagua mpokeaji na idadi · Choose receiver and qty', 'warning'); return; }
    let def = INV.catalogDef(itemId);
    if (itemId === '__new') {
      const sw = $('siNew').value.trim();
      if (sw.length < 2) { UI.toast('Andika jina la kitu kipya', 'warning'); return; }
      itemId = `c_${INV.util.slug(sw)}_${Date.now().toString(36).slice(-4)}`;
      def = { sw, en: '', type: 'count', cat: 'other', unit: 'pcs' };
    }
    const docket = await INV.val(INV.iref(S.ctx, S.year, `dockets/${to}`));
    const res = await INV.createMovement(S.ctx, {
      type: 'stockIn', itemId, itemName: def.sw, itemDef: { sw: def.sw, en: def.en || '', type: 'count', cat: def.cat || 'other', unit: def.unit || 'pcs' }, qty,
      toWorkerId: to, toWorkerName: docket?.workerName || nameOf(to), toArea: docket?.area || '', source: $('siSource').value, cost: n0($('siCost').value), reason: `Mali mpya (${$('siSource').value})`,
    });
    UI.toast(res.ok ? 'Imetumwa. Mpokeaji atathibitisha · Sent; the receiver will confirm' : res.message, res.ok ? 'success' : 'error');
    if (res.ok) render();
  }

  // ---------- flags, restock, handover, digest ----------
  async function renderFlags(main) {
    const ymd = todayYMD();
    const from = S.flagFrom || addDays(ymd, -30);
    const data = await PDF.collect(S.ctx, from, ymd, { includeMissing: false });
    main.innerHTML = `<div class="inv-card"><div class="inv-inline"><label class="inv-field">Kuanzia · From<input type="date" id="flagFrom" value="${esc(from)}"></label></div>
      <p class="inv-card__sub">Hitilafu hujitokeza zenyewe: idadi kupungua, vitu kurudi bila matengenezo, uharibifu unaojirudia (mara ${S.settings.repeatDamageThreshold}+ ndani ya siku 30), ukaguzi wa ghafla kupinga ripoti, tofauti za makabidhiano.</p></div>
      <div class="inv-card">${flagList(data.flags, data, true)}</div>`;
  }
  async function renderRestock(main) {
    const rows = await PDF.restockList(S.ctx);
    main.innerHTML = `<div class="inv-card"><div class="inv-li__head"><div><h3>🧴 Mahitaji ya kuongeza · Restock list</h3><p class="inv-card__sub">Vitu vyote vilivyowekwa "kinahitaji kuongezwa" shuleni kote · Every item marked "needs restock".</p></div><button class="inv-btn inv-btn--accent" data-a="restockpdf">📄 PDF / Print</button></div>
      ${rows.length ? `<div class="inv-table-wrap"><table class="inv-table"><thead><tr><th>Kitu</th><th class="num">Kilichobaki</th><th>Kipimo</th><th>Eneo</th><th>Mhusika</th><th>Ripoti ya</th></tr></thead><tbody>${rows.map((r) => `<tr><td>${esc(r.item)}</td><td class="num">${r.qty}</td><td>${esc(r.unit)}</td><td>${esc(r.area)}</td><td>${esc(r.worker)}</td><td>${esc(r.ymd)}</td></tr>`).join('')}</tbody></table></div>` : '<p class="inv-empty">Hakuna kinachohitaji kuongezwa · Nothing needs restocking.</p>'}</div>`;
  }
  async function renderHandover(main) {
    const list = await INV.listHandovers(S.ctx, S.year);
    const dockets = await INV.loadDockets(S.ctx, S.year);
    main.innerHTML = `<div class="inv-card"><h3>🤝 Anza makabidhiano · Start a worker-change handover</h3><p class="inv-card__sub">Mwalimu akihamishwa darasa au mfanyakazi akiondoka: hesabuni pamoja, wote wawili wathibitishe kwenye ukurasa wao wa hesabu. Dhamana ya wa zamani inaisha wakati huo.</p>
      <div class="inv-row">
        <label class="inv-field">Anayekabidhi · From<select id="hoFrom"><option value="">— chagua —</option>${Object.entries(dockets).filter(([, d]) => d && !d.endedAt && (d.latest || d.lastApproved)).map(([wid, d]) => `<option value="${esc(wid)}">${esc(d.workerName || nameOf(wid))} — ${esc(d.area || '')}</option>`).join('')}</select></label>
        <label class="inv-field">Anayepokea · To<select id="hoTo"><option value="">— chagua —</option>${workerOptions('')}</select></label>
        <label class="inv-field">Eneo · Area<input id="hoArea" placeholder="litajazwa kutoka dhamana"></label>
      </div><div style="margin-top:10px"><button class="inv-btn inv-btn--primary" data-a="hocount">Hesabu pamoja · Joint count</button></div></div>
      <div class="inv-card"><h3>Makabidhiano · Handovers</h3>${list.length ? `<div class="inv-list">${list.map((h) => `<div class="inv-li"><div class="inv-li__head"><div><div class="inv-li__title">${h.type === 'shift' ? 'Zamu' : 'Mabadiliko'}: ${esc(h.fromName || '')} → ${esc(h.toName || '')}</div><div class="inv-li__meta">${esc(h.area || '')} · ${fmtDateTime(h.startedAt || h.at)}${h.type === 'change' ? ` · anayekabidhi ${h.fromConfirmedAt ? '✔' : '✖'} · anayepokea ${h.toConfirmedAt ? '✔' : '✖'}` : ''}</div>${h.differences && Object.keys(h.differences).length ? `<div class="inv-li__meta">Tofauti: ${esc(Object.values(h.differences).map((d) => d.note).join('; '))}</div>` : ''}</div><span class="inv-tag inv-tag--${h.status === 'completed' || h.status === 'received' ? 'good' : h.status === 'differences' ? 'bad' : 'warn'}">${esc(h.status)}</span></div></div>`).join('')}</div>` : '<p class="inv-empty">Hakuna · None</p>'}</div>`;
    S.hoDockets = dockets;
  }
  async function handoverCount() {
    const from = $('hoFrom').value; const to = $('hoTo').value;
    if (!from || !to || from === to) { UI.toast('Chagua wafanyakazi wawili tofauti · Choose two different workers', 'warning'); return; }
    const d = S.hoDockets[from];
    const items = await INV.docketItems(S.ctx, S.year, Object.assign({ workerId: from }, d));
    const src = (d.latest || d.lastApproved || {}).items || {};
    const rows = items.map((def) => {
      const v = src[def.id] || {};
      if (def.type === 'count') return `<tr data-ho="${esc(def.id)}" data-t="count"><td>${esc(def.sw)}</td><td><input class="inv-input" type="number" min="0" data-f="good" value="${n0(v.good)}" style="width:70px"></td><td><input class="inv-input" type="number" min="0" data-f="damaged" value="${n0(v.damaged)}" style="width:70px"></td><td><input class="inv-input" type="number" min="0" data-f="lost" value="${n0(v.lost)}" style="width:70px"></td></tr>`;
      if (def.type === 'cond') return `<tr data-ho="${esc(def.id)}" data-t="cond"><td>${esc(def.sw)}</td><td colspan="3"><select class="inv-input" data-f="ok"><option value="1" ${v.ok !== false ? 'selected' : ''}>Sawa</option><option value="0" ${v.ok === false ? 'selected' : ''}>Si sawa</option></select></td></tr>`;
      return `<tr data-ho="${esc(def.id)}" data-t="${esc(def.type)}"><td>${esc(def.sw)}</td><td colspan="3"><input class="inv-input" data-f="${def.type === 'cons' ? 'qty' : 'value'}" value="${esc(v.qty ?? v.value ?? '')}"></td></tr>`;
    }).join('');
    const counted = await UI.modal({
      title: `Hesabu ya pamoja · Joint count — ${d.area || ''}`,
      html: `<p class="inv-card__sub">${esc(d.workerName || '')} → ${esc(nameOf(to))}. Imejazwa kutoka ripoti ya mwisho; rekebisheni kulingana na mlichohesabu.</p><div class="inv-table-wrap"><table class="inv-table"><thead><tr><th>Kitu</th><th>Vizima</th><th>Vibovu</th><th>Vimepotea</th></tr></thead><tbody>${rows}</tbody></table></div>`,
      actions: [{ label: 'Ghairi', value: null }, {
        label: 'Tuma kwa uthibitisho · Send for confirmation', kind: 'primary',
        value: (root) => Object.fromEntries([...root.querySelectorAll('[data-ho]')].map((tr) => {
          const t = tr.dataset.t; const g = (f) => tr.querySelector(`[data-f="${f}"]`)?.value;
          if (t === 'count') return [tr.dataset.ho, { type: 'count', good: n0(g('good')), damaged: n0(g('damaged')), lost: n0(g('lost')) }];
          if (t === 'cond') return [tr.dataset.ho, { type: 'cond', ok: g('ok') === '1' }];
          if (t === 'cons') return [tr.dataset.ho, { type: 'cons', qty: n0(g('qty')) }];
          return [tr.dataset.ho, { type: t, value: g('value') || '' }];
        })),
      }],
    });
    if (!counted) return;
    const itemDefs = Object.fromEntries(items.map((x) => [x.id, { sw: x.sw, en: x.en || '', type: x.type, cat: x.cat || 'other', unit: x.unit || '' }]));
    const res = await INV.startChangeHandover(S.ctx, { fromWorkerId: from, fromName: d.workerName || nameOf(from), toWorkerId: to, toName: nameOf(to), area: $('hoArea').value.trim() || d.area || '', role: d.role, items: counted, itemDefs });
    UI.toast(res.ok ? 'Makabidhiano yametumwa. Wote wawili wathibitishe kwenye ukurasa wa hesabu · Both must confirm' : 'Imeshindikana', res.ok ? 'success' : 'error', 6500);
    render();
  }
  async function renderDigest(main) {
    const ymd = todayYMD();
    const data = await PDF.collect(S.ctx, ymd, ymd);
    const s = PDF.summarize(data);
    const month = await INV.listRepairs(S.ctx, S.year);
    const monthCost = month.filter((r) => r.repairedAt && ymdOf(r.repairedAt).startsWith(ymd.slice(0, 7))).reduce((t, r) => t + n0(r.actualCost), 0);
    main.innerHTML = `<div class="inv-card"><div class="inv-li__head"><div><h3>🗞️ Muhtasari wa Mkurugenzi · Director daily digest</h3><p class="inv-card__sub">${esc(fmtDaySw(ymd))}${S.settings.directorDailyDigest === false ? ' · (imezimwa kwenye mipangilio)' : ''}</p></div><button class="inv-btn inv-btn--accent" data-a="daypdf" data-ymd="${esc(ymd)}">📄 PDF</button></div>
      <div class="inv-stats">
        ${stat('Uharibifu mpya · New damages', s.damaged + s.notOk, s.damaged + s.notOk ? 'bad' : '')}
        ${stat('Upotevu · Losses', s.lost, s.lost ? 'bad' : '')}
        ${stat('Matengenezo yaliyokwama · Stalled repairs', s.stalled, s.stalled ? 'bad' : '')}
        ${stat('Ukaguzi wiki hii · Spot checks done / planned', data.spotWeek ? `${data.spotWeek.done}/${data.spotWeek.planned}` : '0/0', data.spotWeek && data.spotWeek.done < data.spotWeek.planned ? 'warn' : 'good')}
        ${stat('Hawakujaza leo · Not submitted', data.missing.length, data.missing.length ? 'bad' : '')}
        ${stat('Gharama za matengenezo mwezi huu', money(monthCost), '')}
      </div></div>
      <div class="inv-card"><h3>Matatizo mapya leo · New problems today</h3>${data.problems.length ? `<div class="inv-list">${data.problems.map((p) => `<div class="inv-li"><div class="inv-li__head"><div class="inv-li__title">${esc(p.itemName || p.itemId)} — ${esc(INV.PROBLEM_LABELS[p.kind] || p.kind)} ×${n0(p.qty)}</div>${RV.sourceTag(p.source)}</div><div class="inv-li__meta">${esc(p.workerName || '')} · ${esc(p.area || '')} · ${esc(p.desc || '')}</div></div>`).join('')}</div>` : '<p class="inv-empty">Hakuna · None</p>'}</div>
      <div class="inv-card"><h3>Hawakujaza · Not submitted</h3>${data.missing.length ? `<div class="inv-list">${data.missing.map((m) => `<div class="inv-li"><div class="inv-li__title" style="color:var(--inv-bad)">${esc(m.name || m.workerId)}</div></div>`).join('')}</div>` : '<p class="inv-empty">Wote wamejaza · Everyone submitted</p>'}</div>`;
  }

  // ---------- settings ----------
  async function renderSettings(main) {
    const s = S.settings;
    const dockets = await INV.loadDockets(S.ctx, S.year);
    const areasCard = `<div class="inv-card"><h3>📍 Maeneo ya dhamana · Docket areas</h3><p class="inv-card__sub">Weka eneo la kila mfanyakazi (mf. Baby Class, Geti kuu, Jikoni, Basi T123ABC). Mabadiliko ya eneo baada ya hesabu ya kwanza hufanywa hapa au kwa makabidhiano.</p>
      <div class="inv-table-wrap"><table class="inv-table"><thead><tr><th>Mfanyakazi</th><th>Jukumu</th><th>Eneo · Area</th><th></th></tr></thead><tbody>${S.roster.map((w) => `<tr><td>${esc(w.name)}</td><td>${esc(INV.roleLabel(w.roleKey))}</td><td><input class="inv-input" data-area="${esc(w.workerId)}" value="${esc(dockets[w.workerId]?.area || w.docketArea || T.DEFAULT_AREAS[w.roleKey] || '')}"></td><td><button class="inv-btn inv-btn--sm" data-a="savearea" data-id="${esc(w.workerId)}" data-role="${esc(w.roleKey)}" data-name="${esc(w.name)}">Hifadhi</button></td></tr>`).join('')}</tbody></table></div></div>`;
    if (!S.ctx.isAdmin) { main.innerHTML = `<div class="inv-banner inv-banner--info"><span class="inv-banner__icon">ℹ️</span><div class="inv-banner__body"><strong>Mipangilio ya majaribio na orodha hubadilishwa na Admin</strong>Pilot mode, templates and metrics are managed by Admin / Director.</div></div>${areasCard}`; return; }
    const metrics = await INV.loadRange(S.ctx, 'metrics', addDays(todayYMD(), -14), todayYMD());
    main.innerHTML = `
      <div class="inv-card"><h3>🧪 Majaribio · Pilot mode</h3>
        <label class="inv-toggle"><input type="checkbox" id="stPilot" ${s.pilotMode ? 'checked' : ''}> Majaribio yamewashwa: ni wafanyakazi waliochaguliwa tu · Only selected workers see the module (cards, reminders, check-out gate)</label>
        <p class="inv-card__sub">Ukizima majaribio, kila mfanyakazi wa shule hii ataanza kujaza hesabu na check-out itahitaji hesabu · Turning pilot off launches it school-wide.</p>
        <div class="inv-table-wrap" style="max-height:320px;overflow:auto"><table class="inv-table"><thead><tr><th></th><th>Mfanyakazi</th><th>Jukumu</th></tr></thead><tbody>${S.roster.map((w) => `<tr><td><input type="checkbox" data-pilot="${esc(w.workerId)}" ${s.pilotWorkerIds[w.workerId] ? 'checked' : ''}></td><td>${esc(w.name)}</td><td>${esc(INV.roleLabel(w.roleKey))}</td></tr>`).join('')}</tbody></table></div>
        <div class="inv-row" style="margin-top:10px">
          <label class="inv-field">Ukaguzi wa ghafla kwa wiki · Spot checks per week<input type="number" min="0" id="stSpot" value="${n0(s.spotChecksPerWeek)}"></label>
          <label class="inv-field">Sampuli ya ripoti safi kila siku · Sample a clean report every N days<input type="number" min="1" id="stSample" value="${n0(s.sampleEveryDays) || 7}"></label>
          <label class="inv-field">Matengenezo yamekwama baada ya siku · Stalled after days<input type="number" min="1" id="stStalled" value="${n0(s.stalledRepairDays) || 7}"></label>
          <label class="inv-field">Uharibifu unaojirudia (mara ndani ya siku 30) · Repeat threshold<input type="number" min="2" id="stRepeat" value="${n0(s.repeatDamageThreshold) || 3}"></label>
        </div>
        <label class="inv-toggle" style="margin-top:8px"><input type="checkbox" id="stDigest" ${s.directorDailyDigest !== false ? 'checked' : ''}> Muhtasari wa kila siku kwa Mkurugenzi · Director daily digest</label><br>
        <label class="inv-toggle" style="margin-top:8px"><input type="checkbox" id="stPhotos" ${s.photosAllowed ? 'checked' : ''} disabled> Picha za vitu vibovu (baadaye) · Photos of damaged items (later — off to save storage)</label>
        <div style="margin-top:12px"><button class="inv-btn inv-btn--primary" data-a="savesettings">Hifadhi mipangilio · Save settings</button></div>
      </div>
      ${areasCard}
      <div class="inv-card"><h3>📋 Orodha za majukumu · Role templates</h3><p class="inv-card__sub">Ondoa au ongeza vitu vya kawaida kwa kila jukumu katika shule hii.</p>
        <label class="inv-field">Jukumu · Role<select id="tplRole">${Object.keys(T.TEMPLATES).map((r) => `<option value="${r}" ${S.tplRole === r ? 'selected' : ''}>${esc(INV.roleLabel(r))}</option>`).join('')}</select></label>
        <div id="tplBox" style="margin-top:10px"></div></div>
      <div class="inv-card"><h3>📏 Vipimo vya majaribio · Pilot metrics (siku 14)</h3>${metricsHtml(metrics)}</div>`;
    renderTemplate();
  }
  async function renderTemplate() {
    const role = S.tplRole || $('tplRole')?.value || 'teacher';
    S.tplRole = role;
    const overrides = (await INV.val(INV.iref(S.ctx, S.year, `templates/${role}`))) || {};
    const removed = overrides.removed || {};
    const ids = [...new Set([...(T.TEMPLATES[role] || []), ...Object.keys(overrides.items || {})])];
    $('tplBox').innerHTML = `<div class="inv-list">${ids.map((id) => {
      const d = Object.assign({}, INV.catalogDef(id) || {}, (overrides.items || {})[id] || {});
      return `<div class="inv-li"><div class="inv-li__head"><div class="inv-li__title" ${removed[id] ? 'style="text-decoration:line-through;opacity:.6"' : ''}>${esc(d.sw || id)} <span class="inv-item__en">· ${esc(d.en || '')} · ${esc(d.type || '')}</span></div>
        <button class="inv-btn inv-btn--sm ${removed[id] ? '' : 'inv-btn--bad'}" data-a="tpltoggle" data-id="${esc(id)}" data-on="${removed[id] ? '1' : '0'}">${removed[id] ? 'Rudisha · Restore' : 'Ondoa · Remove'}</button></div></div>`;
    }).join('')}</div>
      <div class="inv-row" style="margin-top:10px"><label class="inv-field">Kitu kipya (Kiswahili)<input id="tplSw"></label><label class="inv-field">English<input id="tplEn"></label>
        <label class="inv-field">Aina · Type<select id="tplType"><option value="count">Idadi</option><option value="cond">Sawa/Si sawa</option><option value="cons">Matumizi</option></select></label>
        <label class="inv-field">Kundi · Category<select id="tplCat">${Object.entries(T.CATEGORIES).map(([k, c]) => `<option value="${k}">${esc(c.sw)}</option>`).join('')}</select></label></div>
      <div style="margin-top:8px"><button class="inv-btn inv-btn--accent" data-a="tpladd">Ongeza kwenye orodha · Add to template</button></div>`;
  }
  function metricsHtml(raw) {
    const byRole = {}; const edited = {}; const untouched = {}; let custom = 0; let n = 0;
    Object.values(raw).forEach((day) => Object.values(day || {}).forEach((m) => {
      n += 1; custom += n0(m.customAdded);
      const r = byRole[m.role || '—'] || (byRole[m.role || '—'] = { n: 0, secs: 0, noChanges: 0 });
      r.n += 1; r.secs += n0(m.secondsToFill); if (m.noChanges) r.noChanges += 1;
      Object.keys(m.editedItems || {}).forEach((id) => { edited[id] = (edited[id] || 0) + 1; });
      Object.keys(m.untouchedItems || {}).forEach((id) => { untouched[id] = (untouched[id] || 0) + 1; });
    }));
    if (!n) return '<p class="inv-empty">Bado hakuna takwimu · No metrics yet.</p>';
    const top = (o) => Object.entries(o).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([id, c]) => `${esc(INV.catalogDef(id)?.sw || id)} (${c})`).join(', ') || '—';
    return `<div class="inv-table-wrap"><table class="inv-table"><thead><tr><th>Jukumu</th><th class="num">Ripoti</th><th class="num">Wastani wa sekunde</th><th class="num">% Hakuna mabadiliko</th></tr></thead><tbody>${Object.entries(byRole).map(([r, v]) => `<tr><td>${esc(INV.roleLabel(r))}</td><td class="num">${v.n}</td><td class="num">${Math.round(v.secs / v.n)}</td><td class="num">${Math.round((v.noChanges / v.n) * 100)}%</td></tr>`).join('')}</tbody></table></div>
      <p class="inv-small"><b>Vinavyobadilishwa zaidi · Most edited:</b> ${top(edited)}</p><p class="inv-small"><b>Visivyoguswa zaidi · Most often left unchanged:</b> ${top(untouched)}</p><p class="inv-small"><b>Vitu vipya vilivyoongezwa · Custom items added:</b> ${custom}</p>`;
  }

  // ---------- events ----------
  async function onClick(e) {
    const el = e.target.closest('[data-a]');
    if (!el) return;
    const a = el.dataset.a;
    try {
      if (a === 'apply') readFilters() && render();
      else if (a === 'pdf') { readFilters(); const [from, to] = periodRange(); el.disabled = true; const res = await PDF.download(S.ctx, from, to, { filter: { role: S.filters.role, area: S.filters.area, workerId: S.filters.workerId } }); el.disabled = false; offerOpen(res); }
      else if (a === 'daypdf') { const ymd = el.dataset.ymd || $('apDate')?.value || todayYMD(); el.disabled = true; const res = await PDF.download(S.ctx, ymd, ymd); el.disabled = false; offerOpen(res); }
      else if (a === 'rep') await repairAction(el.dataset.id, el.dataset.op);
      else if (a === 'repcsv') repairsCsv();
      else if (a === 'reppdf') await repairsPdf();
      else if (a === 'spot') await spotCheck(el.dataset.w, el.dataset.pick);
      else if (a === 'spotadhoc') { const w = $('spotWorker').value; if (w) await spotCheck(w, ''); }
      else if (a === 'wo') { let note = ''; if (el.dataset.ok !== '1') { note = await UI.promptText('Kataa write-off', 'Sababu · Reason', { minLength: 3 }); if (!note) return; } const res = await INV.decideWriteOff(S.ctx, el.dataset.id, el.dataset.ok === '1', note); UI.toast(res.ok ? 'Imehifadhiwa' : res.message, res.ok ? 'success' : 'error'); render(); }
      else if (a === 'stockin') await stockIn();
      else if (a === 'resolveflag') { await INV.iref(S.ctx, yearOf(el.dataset.ymd), `flags/${el.dataset.ymd}/${el.dataset.id}`).update({ resolved: true, resolvedAt: Date.now(), resolvedBy: S.ctx.actorName }); await INV.audit(S.ctx, yearOf(el.dataset.ymd), 'flag_resolved', el.dataset.id); render(); }
      else if (a === 'restockpdf') await PDF.restockPdf(S.ctx);
      else if (a === 'hocount') await handoverCount();
      else if (a === 'savearea') {
        const area = global.document.querySelector(`[data-area="${CSS.escape(el.dataset.id)}"]`).value.trim();
        await INV.saveDocketMeta(S.ctx, S.year, el.dataset.id, { area, workerName: el.dataset.name });
        await INV.audit(S.ctx, S.year, 'docket_area_set', el.dataset.id, { area });
        UI.toast('Eneo limehifadhiwa · Area saved', 'success');
      } else if (a === 'savesettings') {
        const pilotWorkerIds = {};
        global.document.querySelectorAll('[data-pilot]').forEach((c) => { if (c.checked) pilotWorkerIds[c.dataset.pilot] = true; });
        const pilotMode = $('stPilot').checked;
        if (!pilotMode) {
          const ok = await UI.modal({ title: 'Washa kwa shule nzima? · Launch school-wide?', html: '<p>Kila mfanyakazi atahitajika kujaza hesabu kabla ya check-out · Every worker will need to fill inventory before check-out.</p>', actions: [{ label: 'Hapana', value: false }, { label: 'Ndiyo, washa · Yes, launch', value: true, kind: 'primary' }] });
          if (!ok) return;
        }
        await INV.iref(S.ctx, S.year, 'settings/pilotWorkerIds').set(pilotWorkerIds);
        await INV.saveSettings(S.ctx, S.year, { pilotMode, spotChecksPerWeek: n0($('stSpot').value), sampleEveryDays: Math.max(1, n0($('stSample').value)), stalledRepairDays: Math.max(1, n0($('stStalled').value)), repeatDamageThreshold: Math.max(2, n0($('stRepeat').value)), directorDailyDigest: $('stDigest').checked, photosAllowed: false });
        S.settings = null;
        UI.toast('Mipangilio imehifadhiwa · Settings saved', 'success');
        render();
      } else if (a === 'tpltoggle') {
        await INV.saveTemplateOverride(S.ctx, S.year, S.tplRole, { [`removed/${el.dataset.id}`]: el.dataset.on === '1' ? null : true });
        renderTemplate();
      } else if (a === 'tpladd') {
        const sw = $('tplSw').value.trim();
        if (sw.length < 2) { UI.toast('Andika jina', 'warning'); return; }
        const id = `t_${INV.util.slug(sw)}`;
        await INV.saveTemplateOverride(S.ctx, S.year, S.tplRole, { [`items/${id}`]: { sw, en: $('tplEn').value.trim(), type: $('tplType').value, cat: $('tplCat').value, unit: 'pcs' }, [`removed/${id}`]: null });
        renderTemplate();
      }
    } catch (err) {
      console.error('Inventory action failed', err);
      UI.toast(`Imeshindikana · Failed: ${err.message || err}`, 'error', 6500);
      el.disabled = false;
    }
  }
  global.document.addEventListener('change', (e) => {
    if (e.target.id === 'fPeriod') { readFilters(); render(); }
    if (e.target.id === 'apDate') { S.approvalsYmd = e.target.value; render(); }
    if (e.target.id === 'repFilter') { S.repairFilter = e.target.value; render(); }
    if (e.target.id === 'flagFrom') { S.flagFrom = e.target.value; render(); }
    if (e.target.id === 'tplRole') { S.tplRole = e.target.value; renderTemplate(); }
  });
  function readFilters() {
    const f = S.filters;
    const v = (id) => $(id)?.value;
    f.period = v('fPeriod') || f.period;
    if (v('fAnchor')) f.anchor = v('fAnchor');
    if (v('fFrom')) f.from = v('fFrom');
    if (v('fTo')) f.to = v('fTo');
    f.role = v('fRole') ?? f.role; f.area = v('fArea') ?? f.area; f.workerId = v('fWorker') ?? f.workerId;
    return true;
  }
  function offerOpen(res) {
    UI.toast(`PDF imepakuliwa · Downloaded: ${res.filename}`, 'success', 5000);
    if (res.url) UI.modal({ title: 'PDF', html: `<p>${esc(res.filename)}</p><a class="inv-btn inv-btn--primary" href="${esc(res.url)}" target="_blank" rel="noopener">📄 Fungua · Open</a>` });
  }

  if (global.document.readyState === 'loading') global.document.addEventListener('DOMContentLoaded', boot); else boot();
})(window);
