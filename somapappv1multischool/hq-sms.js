/*
 * SoMAp SMS HQ page. Shows NOTHING until the SMS Worker's /me says isHq.
 * Every action goes through the Worker, which checks HQ_EMAILS on each call.
 */
(function () {
  'use strict';
  const core = window.SomapSmsCore;
  const svc = window.SomapSms.create();
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s === null || s === undefined ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fmt = (n) => core.formatNumber(n);
  const state = { overview: null, gatewayBalance: null, senders: null, editing: null };

  function flash(text, kind) {
    $('msg').innerHTML = `<div class="alert ${kind || 'ok'}">${esc(text)}</div>`;
    setTimeout(() => { if ($('msg').textContent === text) $('msg').innerHTML = ''; }, 8000);
  }

  async function load() {
    $('schools').innerHTML = '<tr><td colspan="6" class="muted">Inapakia…</td></tr>';
    const [ov, bal, snd] = await Promise.allSettled([svc.hq.overview(), svc.hq.gateway('live', 'balance'), svc.hq.gateway('live', 'sender-ids')]);
    if (ov.status !== 'fulfilled') { flash('Imeshindwa kupakia muhtasari: ' + (ov.reason && ov.reason.message), 'bad'); return; }
    state.overview = ov.value;
    state.gatewayBalance = bal.status === 'fulfilled' && bal.value.data ? Number(bal.value.data.balance) : null;
    state.senders = snd.status === 'fulfilled' ? (snd.value.data || []) : null;
    render();
  }

  function senderCell(s, cfg) {
    const own = s.sender;
    const ownUsable = own && own.status === 'approved' && Number(own.is_usable) === 1;
    const inUse = ownUsable ? own.sender_id : (cfg.fallback_sender_id || '—');
    let html = `<b>${esc(inUse)}</b> ${ownUsable ? '<span class="badge ok">la shule</span>' : '<span class="badge warn">akiba</span>'}`;
    if (own && !ownUsable) html += `<div class="small muted">Limeombwa: ${esc(own.sender_id)} (${esc(own.status || 'requested')})</div>`;
    if (s.senderWarning) html += `<div class="small" style="color:var(--bad)">${esc(s.senderWarning)}</div>`;
    return html;
  }

  function render() {
    const ov = state.overview;
    const cfg = ov.config || {};
    const mode = cfg.mode;
    $('banner').className = 'banner ' + mode;
    $('banner').textContent = mode === 'live' ? 'LIVE: shule zinatuma SMS HALISI kwa wazazi.' : `${String(mode).toUpperCase()}: hakuna SMS halisi zinazotumwa na shule.`;
    $('modeText').innerHTML = `Hali sasa: <b>${esc(mode)}</b>${ov.liveEnabled ? '' : ' <span class="badge bad">LIVE imefungwa kwenye Worker</span>'}`;
    $('goLive').disabled = mode === 'live' || !ov.liveEnabled;
    $('goSandbox').disabled = mode !== 'live';
    $('fallbackText').textContent = cfg.fallback_sender_id || '— (haijawekwa)';

    const owed = Number(ov.totalLiveWallets || 0);
    const swala = state.gatewayBalance;
    const stat = (l, v, cls) => `<div class="stat ${cls || ''}"><div class="v">${esc(v)}</div><div class="l">${esc(l)}</div></div>`;
    const monthLive = ov.schools.reduce((s, x) => s + (x.thisMonth ? x.thisMonth.liveUnits : 0), 0);
    $('money').innerHTML = [
      stat('Salio halisi SwalaSMS', swala === null ? 'haijapatikana' : fmt(swala), swala === null ? 'warn' : ''),
      stat('Jumla ya salio la shule zote', fmt(owed), swala !== null && owed > swala ? 'bad' : ''),
      stat('Ziada (SwalaSMS - shule)', swala === null ? '—' : fmt(swala - owed), swala !== null && swala - owed < 0 ? 'bad' : 'ok'),
      stat('SMS halisi mwezi huu (shule zote)', fmt(monthLive)),
    ].join('');
    $('moneyWarn').innerHTML = swala !== null && owed > swala
      ? `<div class="alert bad"><b>Tahadhari:</b> umewapa shule SMS ${fmt(owed)} lakini SwalaSMS ina ${fmt(swala)} tu. Nunua SMS ${fmt(owed - swala)} au zaidi SwalaSMS kabla shule hazijaishiwa.</div>`
      : (swala === null ? '<div class="alert warn">Salio la SwalaSMS halikupatikana (angalia ufunguo wa live).</div>' : '');

    const rows = ov.schools.slice().sort((a, b) => (b.wallet.live - a.wallet.live) || a.name.localeCompare(b.name));
    $('schools').innerHTML = rows.map((s) => `<tr>
        <td><b>${esc(s.name)}</b><div class="small muted">${esc(s.schoolId)}</div></td>
        <td class="num"><b>${fmt(s.wallet.live)}</b>${s.wallet.live <= 0 ? ' <span class="badge bad">0</span>' : ''}<div class="small muted">majaribio: ${fmt(s.wallet.test)}</div></td>
        <td>${senderCell(s, cfg)}</td>
        <td class="num">${fmt(s.thisMonth ? s.thisMonth.liveUnits : 0)}</td>
        <td class="num">${fmt(s.last30Days.liveUnits)}</td>
        <td><button class="btn ghost" type="button" data-edit="${esc(s.schoolId)}">Badilisha</button></td>
      </tr>`).join('');
    $('schools').querySelectorAll('[data-edit]').forEach((b) => { b.onclick = () => openEdit(b.dataset.edit); });

    $('senders').innerHTML = state.senders === null ? '<tr><td colspan="4" class="muted">Haikupatikana.</td></tr>'
      : (state.senders.length ? state.senders.map((x) => `<tr><td><b>${esc(x.sender_id)}</b></td><td>${esc(x.status)}</td>
          <td>${x.is_usable ? '<span class="badge ok">ndiyo</span>' : '<span class="badge warn">hapana</span>'}</td><td class="small muted">${esc(x.updated_at || '')}</td></tr>`).join('')
        : '<tr><td colspan="4" class="muted">Hakuna.</td></tr>');
    if (state.editing) openEdit(state.editing, true);
  }

  function openEdit(schoolId, keepInputs) {
    const s = state.overview.schools.find((x) => x.schoolId === schoolId);
    if (!s) return;
    state.editing = schoolId;
    $('editCard').hidden = false;
    $('editTitle').textContent = `${s.name} • salio ${fmt(s.wallet.live)} SMS`;
    if (!keepInputs) {
      $('units').value = '';
      $('note').value = '';
      $('senderName').value = s.sender ? s.sender.sender_id : '';
      $('editCard').scrollIntoView({ behavior: 'smooth' });
    }
  }

  async function saveCredits() {
    const s = state.overview.schools.find((x) => x.schoolId === state.editing);
    const units = Math.trunc(Number($('units').value));
    const note = $('note').value.trim();
    if (!units) return flash('Weka idadi ya SMS (si sifuri).', 'warn');
    if (note.length < 3) return flash('Maelezo ni lazima (mf. kumbukumbu ya M-Pesa).', 'warn');
    const verb = units > 0 ? `Ongeza SMS ${fmt(units)}` : `Punguza SMS ${fmt(-units)}`;
    if (!confirm(`${verb} HALISI kwa ${s.name}?\nMaelezo: ${note}`)) return;
    $('saveCredits').disabled = true;
    try {
      const r = await svc.hq.adjust({ schoolId: s.schoolId, bucket: 'live', units, note });
      flash(`${s.name}: salio jipya ni SMS ${fmt(r.balance)}.`);
      $('units').value = ''; $('note').value = '';
      await load();
    } catch (err) { flash(err.message || String(err), 'bad'); }
    finally { $('saveCredits').disabled = false; }
  }

  async function saveSender() {
    const s = state.overview.schools.find((x) => x.schoolId === state.editing);
    const name = $('senderName').value.trim();
    if (!confirm(name ? `Unganisha jina "${name.toUpperCase()}" na ${s.name}?` : `Ondoa jina la mtumaji la ${s.name}?`)) return;
    try {
      await svc.hq.schoolSender({ schoolId: s.schoolId, senderId: name });
      flash(name ? `${s.name}: jina ${name.toUpperCase()} limeunganishwa. Litatumika lenyewe likiidhinishwa.` : `${s.name}: jina limeondolewa.`);
      await load();
    } catch (err) { flash(err.message || String(err), 'bad'); }
  }

  async function setMode(mode) {
    const text = mode === 'live' ? 'Weka LIVE? Shule zote zitaweza kutuma SMS HALISI kwa wazazi.' : 'Simamisha SMS halisi kwa shule zote (sandbox)?';
    if (!confirm(text)) return;
    try {
      const body = { mode };
      await svc.hq.config(body);
      flash(mode === 'live' ? 'Mfumo uko LIVE.' : 'SMS halisi zimesimamishwa (sandbox).', mode === 'live' ? 'ok' : 'warn');
      await load();
    } catch (err) { flash(err.message || String(err), 'bad'); }
  }

  async function boot() {
    let me;
    try { me = await svc.me(''); } catch (err) { $('gate').textContent = 'Imeshindwa kuthibitisha: ' + (err.message || err); return; }
    if (!me.isHq) { $('gate').innerHTML = '<b>Huna ruhusa.</b> Ukurasa huu ni wa SoMAp HQ tu.'; return; }
    $('gate').hidden = true;
    $('app').hidden = false;
    $('refresh').hidden = false;
    $('refresh').onclick = load;
    $('saveCredits').onclick = saveCredits;
    $('saveSender').onclick = saveSender;
    $('closeEdit').onclick = () => { state.editing = null; $('editCard').hidden = true; };
    $('goLive').onclick = () => setMode('live');
    $('goSandbox').onclick = () => setMode('sandbox');
    await load();
  }

  $('login').onclick = () => firebase.auth().signInWithPopup(new firebase.auth.GoogleAuthProvider()).catch((e) => { $('gate').textContent = 'Login imeshindwa: ' + e.message; });
  let booted = false;
  firebase.auth().onAuthStateChanged((user) => {
    $('loginBox').hidden = Boolean(user);
    if (!user) { $('gate').textContent = 'Ingia kwanza.'; return; }
    if (!booted) { booted = true; boot(); }
  });
})();
