// SoMAp Letters & Minutes Studio — UI (home + stats, type picker, editor + live preview, settings).
(function (global) {
  'use strict';
  const LT = global.SomapLetters;
  const T = global.SomapLettersT;
  const AI = global.SomapLettersAI;
  const PDF = global.SomapLettersPDF;
  const { esc, todayYMD, clone } = LT.util;
  const $ = (sel, root) => (root || document).querySelector(sel);
  const $$ = (sel, root) => [...(root || document).querySelectorAll(sel)];
  const app = () => document.getElementById('lettersApp');

  const S = {
    ctx: null, settings: null, types: [], rows: [], year: String(new Date().getFullYear()),
    view: 'home', filter: { q: '', scope: '', status: '', type: '' }, settingsTab: 'letterheads',
    cur: null, sigImages: {}, mobileTab: 'write', saveTimer: null, previewTimer: null,
  };

  // ---------- small UI helpers ----------
  function toast(msg, kind) {
    const box = document.getElementById('ltToasts');
    const el = document.createElement('div');
    el.className = `lt-toast lt-toast--${kind || 'info'}`;
    el.textContent = msg;
    box.appendChild(el);
    setTimeout(() => { el.classList.add('lt-toast--out'); setTimeout(() => el.remove(), 400); }, kind === 'error' ? 6000 : 3500);
  }
  function modal(html, opts = {}) {
    const root = document.getElementById('ltModalRoot');
    root.innerHTML = `<div class="lt-modal" role="dialog" aria-modal="true"><div class="lt-modal__card ${opts.wide ? 'lt-modal__card--wide' : ''}">
      <button class="lt-modal__x" data-act="modal-close" aria-label="Close">×</button>${html}</div></div>`;
    const first = root.querySelector('input,textarea,select');
    if (first) setTimeout(() => first.focus(), 30);
    return root.firstElementChild;
  }
  function closeModal() { document.getElementById('ltModalRoot').innerHTML = ''; }
  const typeById = (id) => S.types.find((t) => t.id === id) || { id, en: id, sw: id, scope: 'school', icon: '✉️' };
  const statusChip = (st) => { const s = T.STATUSES[st] || T.STATUSES.draft; return `<span class="lt-chip lt-chip--${s.tone}">${esc(s.en)}</span>`; };
  function fmtDT(ms) { if (!ms) return ''; const d = new Date(ms); return `${d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })} ${d.toTimeString().slice(0, 5)}`; }
  function friendly(err) {
    const m = String(err && err.message || err || '');
    if (/PERMISSION_DENIED|permission/i.test(m)) return 'The database refused this action. Check the letters rules (rtdb/letters.rules.json).';
    return m || 'Something went wrong. Please try again.';
  }
  async function guard(fn) { try { return await fn(); } catch (err) { console.error(err); toast(friendly(err), 'error'); return null; } }

  // ---------- boot ----------
  async function boot() {
    try {
      S.ctx = await LT.resolveContext();
    } catch (err) {
      app().innerHTML = emptyScreen('🏫', 'No school selected', 'Open SoMAp, choose your school and sign in, then come back to Letters.', '<a class="lt-btn lt-btn--primary" href="index.html">Go to SoMAp</a>');
      return;
    }
    if (S.ctx.role === 'none') {
      app().innerHTML = emptyScreen('🔐', 'Letters is for the Director and the Head Teacher', 'Sign in to the dashboard as the director, or open Letters from the Head Teacher card on the Teacher Dashboard.', '<a class="lt-btn lt-btn--primary" href="dashboard.html">Dashboard</a> <a class="lt-btn" href="workershtml/workertasks.html">Teacher Dashboard</a>');
      return;
    }
    if (global.somapYearContext) S.year = global.somapYearContext.getSelectedYear() || S.year;
    S.settings = await LT.loadSettings(S.ctx);
    S.types = await LT.loadTypes(S.ctx);
    await logoFallback();
    LT.vault.onChange(() => { renderTopbar(); if (S.view === 'home') refreshList(); });
    setInterval(() => { const el = $('.lt-vault__time'); if (el) el.textContent = vaultTime(); }, 15000);
    document.addEventListener('click', onClick);
    document.addEventListener('input', onInput);
    document.addEventListener('change', onChange);
    global.addEventListener('beforeunload', (e) => { if (S.cur && S.cur.dirty) { flushSave(); e.preventDefault(); e.returnValue = ''; } });
    await refreshList();
    const params = new URLSearchParams(global.location.search);
    if (params.get('new')) openPicker(); else render();
  }
  // Until a letterhead logo is uploaded, use the school profile logo, else the SoMAp logo.
  const SOMAP_LOGO = 'images/somap-logo.png';
  async function logoFallback() {
    let profileLogo = '';
    try {
      const snap = await global.firebase.database().ref(`schools/${S.ctx.schoolId}/profile/logoUrl`).once('value');
      profileLogo = snap.val() || '';
    } catch (_) { /* no profile logo */ }
    Object.values(S.settings.letterheads).forEach((h) => {
      if (h.kind !== 'image' && !h.logo) { h.logo = profileLogo || SOMAP_LOGO; h.logoIsDefault = true; }
    });
  }
  // What a letterhead still needs before letters look finished.
  function headGaps(h) {
    if (!h) return ['letterhead'];
    if (h.kind === 'image') return h.image ? [] : ['header image'];
    return [['name', 'name'], ['address', 'address'], ['phones', 'phone'], ['email', 'email']].filter(([k]) => !String(h[k] || '').trim()).map(([, l]) => l)
      .concat(h.logoIsDefault ? ['own logo (SoMAp logo in use)'] : []);
  }
  function readinessHtml() {
    const heads = S.ctx.isDirector ? ['school', 'company'] : ['school'];
    const gaps = heads.map((id) => [id, headGaps(S.settings.letterheads[id])]).filter(([, g]) => g.length);
    if (!gaps.length) return '';
    const list = gaps.map(([id, g]) => `<strong>${id === 'company' ? 'Company' : 'School'} letterhead</strong> needs: ${esc(g.join(', '))}`).join('<br>');
    return `<div class="lt-banner"><span>🏷</span><div>${S.ctx.isDirector ? '<strong>Letterhead readiness.</strong> ' : '<strong>The director has not finished the letterhead yet</strong> — letters use the school name and the SoMAp logo until then.<br>'}${list}</div>${S.ctx.isDirector ? '<button class="lt-btn lt-btn--sm lt-btn--primary" data-act="settings">Set up</button>' : ''}</div>`;
  }
  function emptyScreen(icon, title, text, actions) {
    return `<div class="lt-empty-screen"><div class="lt-empty-screen__icon">${icon}</div><h1>${esc(title)}</h1><p>${esc(text)}</p><div class="lt-inline">${actions || ''}</div></div>`;
  }
  async function refreshList() {
    S.rows = await guard(() => LT.listLetters(S.ctx)) || [];
    if (S.view === 'home') renderHome();
  }

  // ---------- shell ----------
  function vaultTime() { const ms = LT.vault.remaining(); const m = Math.floor(ms / 60000); return ms ? `${m} min left` : ''; }
  function topbarHtml() {
    const c = S.ctx;
    const back = c.isDirector ? 'dashboard.html' : 'workershtml/workertasks.html';
    const unlocked = LT.vault.isUnlocked();
    return `<header class="lt-top">
      <a class="lt-top__back" href="${back}" title="Back">‹</a>
      <div class="lt-top__brand"><span class="lt-top__mark">✉</span><div><div class="lt-top__title">Letters &amp; Minutes Studio</div><div class="lt-top__sub">${esc(c.schoolName || '')} · <span class="lt-role lt-role--${c.role}">${c.isDirector ? 'Director' : 'Head Teacher'}</span></div></div></div>
      <div class="lt-top__actions">
        <label class="lt-year">Year <select id="ltYear" data-somap-year-select></select></label>
        ${c.isDirector ? `<div class="lt-vault ${unlocked ? 'lt-vault--open' : ''}">
          ${unlocked ? `<span>🔓 Vault open · <span class="lt-vault__time">${vaultTime()}</span></span><button class="lt-btn lt-btn--sm" data-act="lock">Lock now</button>` : `<button class="lt-btn lt-btn--sm lt-btn--ghost" data-act="unlock">🔒 Unlock protected letters</button>`}
        </div>` : ''}
        <button class="lt-btn lt-btn--sm lt-btn--ghost" data-act="settings">⚙ Settings</button>
      </div></header>`;
  }
  function renderTopbar() {
    const old = $('.lt-top');
    if (!old) return;
    old.outerHTML = topbarHtml();
    attachYear();
  }
  function attachYear() {
    const sel = document.getElementById('ltYear');
    if (!sel || !global.somapYearContext) return;
    global.somapYearContext.attachYearDropdown(sel, { initialYear: S.year });
    sel.addEventListener('change', () => { S.year = sel.value; if (S.view === 'home') renderHome(); });
  }
  function render() {
    if (S.view === 'home') renderHome();
    else if (S.view === 'picker') renderPicker();
    else if (S.view === 'editor') renderEditor();
    else if (S.view === 'settings') renderSettings();
  }
  function shell(inner) { app().innerHTML = `${topbarHtml()}<main class="lt-main">${inner}</main>`; attachYear(); }

  // ---------- home ----------
  const STAT_KEYS = [
    ['warning', '⚠️'], ['summons', '📣'], ['show_cause', '❓'], ['course', '🎓'], ['loan_request', '🏦'], ['director_apology', '🕊️'],
    ['minutes_directors', '🗂️'], ['minutes_committee', '📋'], ['parent_notice', '📌'], ['bank_letter', '🏛️'],
  ];
  function renderHome() {
    S.view = 'home';
    const st = LT.stats(S.rows, S.year);
    const f = S.filter;
    const visibleTypes = new Set(STAT_KEYS.map((k) => k[0]));
    Object.keys(st.byType).forEach((k) => visibleTypes.add(k));
    const typeCards = [...visibleTypes].map((id) => typeById(id)).filter((t) => S.ctx.isDirector || t.scope === 'school').map((t) => {
      const n = st.byType[t.id] || 0;
      const lockMark = LT.isProtectedType(t) ? '<span class="lt-stat__lock">🔒</span>' : '';
      return `<button class="lt-stat lt-stat--type ${f.type === t.id ? 'lt-stat--on' : ''} ${n ? '' : 'lt-stat--zero'}" data-act="filter-type" data-type="${esc(t.id)}">
        <span class="lt-stat__icon">${t.icon || '✉️'}</span><span class="lt-stat__value">${n}</span><span class="lt-stat__label">${esc(t.en)}</span>${lockMark}</button>`;
    }).join('');
    const rows = S.rows.filter((r) => (!S.year || r.year === S.year)
      && (!f.scope || r.scope === f.scope) && (!f.status || r.status === f.status) && (!f.type || r.typeId === f.type)
      && (!f.q || `${r.subject || ''} ${r.recipient || ''} ${r.refNo || ''} ${r.typeName || ''} ${r.authorName || ''}`.toLowerCase().includes(f.q.toLowerCase())));
    shell(`
      <section class="lt-hero">
        <div><h1>Letters that look and read beautifully.</h1>
        <p>Type the way you speak — English, Kiswahili or both. The studio arranges it, polishes the language, sets the letterhead, date and RE: line, and signs it.</p></div>
        <div class="lt-inline"><button class="lt-btn lt-btn--primary lt-btn--lg" data-act="new">＋ Write a letter</button>
        <button class="lt-btn lt-btn--lg" data-act="new-minutes">🗂 Write minutes</button></div>
      </section>
      ${readinessHtml()}
      <section class="lt-stats">
        <button class="lt-stat lt-stat--hero ${!f.status && !f.type ? 'lt-stat--on' : ''}" data-act="filter-clear"><span class="lt-stat__value">${st.total}</span><span class="lt-stat__label">Letters in ${esc(S.year)}</span></button>
        <button class="lt-stat lt-stat--muted ${f.status === 'draft' ? 'lt-stat--on' : ''}" data-act="filter-status" data-status="draft"><span class="lt-stat__value">${st.drafts}</span><span class="lt-stat__label">Drafts</span></button>
        <button class="lt-stat lt-stat--warn ${f.status === 'final' ? 'lt-stat--on' : ''}" data-act="filter-status" data-status="final"><span class="lt-stat__value">${st.awaiting}</span><span class="lt-stat__label">Awaiting signature</span></button>
        <button class="lt-stat lt-stat--good ${f.status === 'signed' ? 'lt-stat--on' : ''}" data-act="filter-status" data-status="signed"><span class="lt-stat__value">${st.signed}</span><span class="lt-stat__label">Signed</span></button>
        ${S.ctx.isDirector ? `<div class="lt-stat lt-stat--lock"><span class="lt-stat__value">${st.protectedCount}</span><span class="lt-stat__label">🔒 Protected</span></div>` : ''}
      </section>
      <section class="lt-types-strip">${typeCards}</section>
      <section class="lt-card">
        <div class="lt-filters">
          <input class="lt-input" data-filter="q" placeholder="Search subject, recipient, reference…" value="${esc(f.q)}">
          ${S.ctx.isDirector ? `<select class="lt-input" data-filter="scope"><option value="">All scopes</option><option value="school" ${f.scope === 'school' ? 'selected' : ''}>School</option><option value="company" ${f.scope === 'company' ? 'selected' : ''}>Company</option></select>` : ''}
          <select class="lt-input" data-filter="status"><option value="">Any status</option>${Object.entries(T.STATUSES).map(([k, v]) => `<option value="${k}" ${f.status === k ? 'selected' : ''}>${esc(v.en)}</option>`).join('')}</select>
          <select class="lt-input" data-filter="type"><option value="">All types</option>${S.types.filter((t) => S.ctx.isDirector || t.scope === 'school').map((t) => `<option value="${esc(t.id)}" ${f.type === t.id ? 'selected' : ''}>${esc(t.en)}</option>`).join('')}</select>
        </div>
        <div class="lt-list">${rows.length ? rows.map(rowHtml).join('') : `<div class="lt-empty"><div class="lt-empty__icon">🪶</div><p>${S.rows.length ? 'No letters match these filters.' : 'No letters yet. Write the first one — it takes a minute.'}</p></div>`}</div>
      </section>`);
  }
  function rowHtml(r) {
    const t = typeById(r.typeId);
    const masked = r.protected && !r.revealed;
    const canOpen = LT.canOpen(S.ctx, r);
    return `<button class="lt-row ${canOpen ? '' : 'lt-row--locked'}" data-act="open" data-id="${esc(r.id)}">
      <span class="lt-row__icon">${t.icon || '✉️'}</span>
      <span class="lt-row__main"><span class="lt-row__subject">${masked ? '🔒 Confidential' : esc(r.subject || '(no subject yet)')}</span>
        <span class="lt-row__meta"><span class="lt-chip lt-chip--type">${esc(r.typeName || t.en)}</span>${masked ? '' : r.recipient ? ` · ${esc(r.recipient)}` : ''} · ${esc(T.formatDate(r.date, 'en'))}${r.refNo ? ` · ${esc(r.refNo)}` : ''}${r.authorName ? ` · ${esc(r.authorName)}` : ''}</span></span>
      <span class="lt-row__side">${r.protected ? '<span class="lt-chip lt-chip--lock">🔒</span>' : ''}${statusChip(r.status)}</span></button>`;
  }

  // ---------- type picker ----------
  function openPicker(mode) { S.view = 'picker'; S.pickerMode = mode || ''; S.pickerQ = ''; renderPicker(); }
  function renderPicker() {
    const q = (S.pickerQ || '').toLowerCase();
    const allowed = S.types.filter((t) => (S.ctx.isDirector || t.scope === 'school') && (!S.pickerMode || (t.mode || 'letter') === S.pickerMode)
      && (!q || `${t.en} ${t.sw} ${t.subject}`.toLowerCase().includes(q)));
    const groups = T.GROUPS.map((g) => {
      const items = allowed.filter((t) => t.group === g.id);
      if (!items.length) return '';
      return `<div class="lt-pick-group"><h3>${g.icon} ${esc(g.en)} <small>· ${esc(g.sw)}</small></h3><div class="lt-pick-grid">${items.map((t) => `
        <button class="lt-pick ${t.scope === 'company' ? 'lt-pick--company' : ''}" data-act="pick" data-type="${esc(t.id)}">
          <span class="lt-pick__icon">${t.icon || '✉️'}</span><span class="lt-pick__name">${esc(t.en)}</span><span class="lt-pick__sw">${esc(t.sw || '')}</span>
          <span class="lt-pick__tags">${t.scope === 'company' ? '<span class="lt-chip lt-chip--company">Company</span>' : '<span class="lt-chip">School</span>'}${LT.isProtectedType(t) ? '<span class="lt-chip lt-chip--lock">🔒 Protected</span>' : ''}${t.mode === 'minutes' ? '<span class="lt-chip lt-chip--info">Minutes</span>' : ''}</span>
        </button>`).join('')}</div></div>`;
    }).join('');
    shell(`<section class="lt-card lt-picker">
      <div class="lt-picker__head"><div><h2>What is this ${S.pickerMode === 'minutes' ? 'record' : 'letter'} about?</h2><p class="lt-muted">Choosing the purpose sets the subject, the structure and the tone the assistant uses.</p></div>
      <div class="lt-inline"><input class="lt-input" id="ltPickQ" data-act-input="pick-q" placeholder="Search purposes…" value="${esc(S.pickerQ || '')}"><button class="lt-btn" data-act="add-type">＋ Add type</button><button class="lt-btn lt-btn--ghost" data-act="home">Cancel</button></div></div>
      ${groups || '<div class="lt-empty"><p>No purpose matches. Add your own with “＋ Add type”.</p></div>'}
    </section>`);
    const qi = document.getElementById('ltPickQ'); if (qi && S.pickerQ) { qi.focus(); qi.setSelectionRange(qi.value.length, qi.value.length); }
  }
  function addTypeModal() {
    modal(`<h2>Add a letter purpose</h2><p class="lt-muted">Saved for ${esc(S.ctx.schoolName)} and shown in the picker for everyone allowed to use it.</p>
      <div class="lt-form">
        <label>Name (English)<input class="lt-input" id="ntEn" placeholder="e.g. Late-coming notice"></label>
        <label>Name (Kiswahili)<input class="lt-input" id="ntSw" placeholder="e.g. Taarifa ya kuchelewa"></label>
        <label>Default subject (RE:)<input class="lt-input" id="ntSubject" placeholder="e.g. LATE REPORTING TO WORK"></label>
        <label>Scope<select class="lt-input" id="ntScope"><option value="school">School (Head Teacher can read)</option>${S.ctx.isDirector ? '<option value="company">Company (director only, encrypted)</option>' : ''}</select></label>
        <label>Kind<select class="lt-input" id="ntMode"><option value="letter">Letter</option><option value="minutes">Minutes</option></select></label>
        <label class="lt-check"><input type="checkbox" id="ntConf" ${S.ctx.isDirector ? '' : 'disabled'}> Confidential by default (director only, encrypted)</label>
        <label>Tone for the assistant<textarea class="lt-input" id="ntTone" rows="2" placeholder="e.g. Firm but polite; give the rule and the expected change."></textarea></label>
      </div>
      <div class="lt-modal__actions"><button class="lt-btn lt-btn--ghost" data-act="modal-close">Cancel</button><button class="lt-btn lt-btn--primary" data-act="save-type">Save type</button></div>`);
  }
  async function saveTypeFromModal() {
    const en = $('#ntEn').value.trim();
    if (!en) { toast('Give the type a name', 'error'); return; }
    const t = await guard(() => LT.saveType(S.ctx, { en, sw: $('#ntSw').value.trim(), subject: $('#ntSubject').value.trim() || en, scope: $('#ntScope').value, mode: $('#ntMode').value, confidential: $('#ntConf').checked, tone: $('#ntTone').value.trim() }));
    if (!t) return;
    S.types = await LT.loadTypes(S.ctx);
    closeModal(); toast('Type added', 'good');
    if (S.view === 'picker') renderPicker(); else if (S.view === 'settings') renderSettings();
  }

  // ---------- vault / unlock ----------
  // Resolves true once the vault is open (or creates it on first use).
  function ensureUnlocked(reason) {
    if (LT.vault.isUnlocked()) return Promise.resolve(true);
    if (!S.ctx.isDirector) {
      modal(`<div class="lt-lock"><div class="lt-lock__icon">🔒</div><h2>This letter is protected</h2><p>Company and confidential letters open only in the director's unlocked session. They are stored encrypted — they cannot be read from this account.</p></div>
        <div class="lt-modal__actions"><button class="lt-btn lt-btn--primary" data-act="modal-close">OK</button></div>`);
      return Promise.resolve(false);
    }
    return new Promise((resolve) => { S.unlockResolve = resolve; vaultModal(reason); });
  }
  async function vaultModal(reason) {
    const v = await guard(() => LT.vault.load(S.ctx));
    if (!v) {
      modal(`<div class="lt-lock"><div class="lt-lock__icon">🗝️</div><h2>Create your letters vault</h2>
        <p>Company letters, confidential letters and your signature are encrypted with a password only you know. The Head Teacher — and anyone reading the database — sees only “🔒 Confidential”.</p></div>
        <div class="lt-form"><label>Vault password (at least 10 characters)<input class="lt-input" type="password" id="vpw1" autocomplete="new-password"></label>
        <label>Repeat password<input class="lt-input" type="password" id="vpw2" autocomplete="new-password"></label></div>
        <p class="lt-note">You will get a recovery key next. Keep it offline: without the password or the recovery key, protected letters cannot be opened by anyone — not even SoMAp support.</p>
        <div class="lt-modal__actions"><button class="lt-btn lt-btn--ghost" data-act="unlock-cancel">Cancel</button><button class="lt-btn lt-btn--primary" data-act="vault-create">Create vault</button></div>`);
      return;
    }
    S.vaultMeta = v;
    const otp = !!v.otp?.enabled;
    modal(`<div class="lt-lock"><div class="lt-lock__icon">🔐</div><h2>${esc(reason || 'Unlock protected letters')}</h2>
      <p>${otp ? 'Enter your vault password, then the 6-digit code sent to the director’s email.' : 'Enter your vault password.'} The vault stays open for 30 minutes on this device.</p></div>
      <div class="lt-form"><label>Vault password<input class="lt-input" type="password" id="vpw" autocomplete="current-password"></label>
      ${otp ? `<div class="lt-otp"><label>Email code<input class="lt-input lt-input--code" id="votp" inputmode="numeric" maxlength="6" placeholder="••••••"></label><button class="lt-btn" data-act="otp-send">✉ Send code</button></div><p class="lt-note" id="votpMsg">${S.settings.otpEmailHint ? `The code goes to ${esc(S.settings.otpEmailHint)}.` : 'The code goes to the director’s private email.'}</p>` : ''}</div>
      <div class="lt-modal__actions"><button class="lt-btn lt-btn--link" data-act="vault-recover">Forgot password?</button><span class="lt-spacer"></span><button class="lt-btn lt-btn--ghost" data-act="unlock-cancel">Cancel</button><button class="lt-btn lt-btn--primary" data-act="vault-unlock">Unlock</button></div>`);
  }
  function finishUnlock(ok) { const r = S.unlockResolve; S.unlockResolve = null; if (r) r(ok); }
  async function createVaultFromModal() {
    const a = $('#vpw1').value; const b = $('#vpw2').value;
    if (a.length < 10) { toast('Use at least 10 characters', 'error'); return; }
    if (a !== b) { toast('The passwords do not match', 'error'); return; }
    const key = await guard(() => LT.vault.create(S.ctx, a));
    if (!key) return;
    modal(`<div class="lt-lock"><div class="lt-lock__icon">🧾</div><h2>Your recovery key</h2><p>Save it somewhere safe and offline (print it, or keep it in your password manager). It opens the vault if the password is ever forgotten.</p></div>
      <textarea class="lt-input lt-recovery" readonly rows="2">${esc(key)}</textarea>
      <div class="lt-modal__actions"><button class="lt-btn" data-act="copy-recovery">Copy</button><button class="lt-btn" data-act="download-recovery">Download</button><span class="lt-spacer"></span><button class="lt-btn lt-btn--primary" data-act="recovery-done">I have saved it</button></div>`);
    S.recoveryKey = key;
  }
  async function unlockFromModal() {
    const pw = $('#vpw').value;
    if (!pw) { toast('Enter the vault password', 'error'); return; }
    let share = '';
    if (S.vaultMeta?.otp?.enabled) {
      const code = ($('#votp') || {}).value || '';
      if (!/^\d{6}$/.test(code.trim())) { toast('Enter the 6-digit code from the email', 'error'); return; }
      const btn = $('[data-act="vault-unlock"]'); btn.disabled = true; btn.textContent = 'Checking…';
      try { share = (await AI.verifyOtp(S.settings, S.ctx.schoolId, code)).share; } catch (err) { btn.disabled = false; btn.textContent = 'Unlock'; toast(friendly(err), 'error'); return; }
    }
    try {
      await LT.vault.unlock(S.ctx, pw, share);
      closeModal(); toast('Vault open for 30 minutes', 'good'); finishUnlock(true);
    } catch (err) { toast(friendly(err), 'error'); const b = $('[data-act="vault-unlock"]'); if (b) { b.disabled = false; b.textContent = 'Unlock'; } }
  }
  async function sendOtp() {
    const btn = $('[data-act="otp-send"]'); btn.disabled = true; btn.textContent = 'Sending…';
    try {
      const r = await AI.requestOtp(S.settings, S.ctx.schoolId);
      $('#votpMsg').textContent = `Code sent to ${r.sentTo}. It expires in 10 minutes.`;
      if (r.sentTo && r.sentTo !== S.settings.otpEmailHint && S.ctx.isDirector) { S.settings.otpEmailHint = r.sentTo; LT.saveSettings(S.ctx, { otpEmailHint: r.sentTo }).catch(() => {}); }
      btn.textContent = 'Resend'; setTimeout(() => { btn.disabled = false; }, 30000);
    } catch (err) { btn.disabled = false; btn.textContent = '✉ Send code'; toast(friendly(err), 'error'); }
  }
  function recoverModal() {
    modal(`<div class="lt-lock"><div class="lt-lock__icon">🧾</div><h2>Recover with your recovery key</h2><p>Paste the recovery key you saved when the vault was created, then choose a new password. Email OTP will need to be switched on again in Settings.</p></div>
      <div class="lt-form"><label>Recovery key<textarea class="lt-input" id="vrk" rows="2"></textarea></label>
      <label>New password<input class="lt-input" type="password" id="vnp1" autocomplete="new-password"></label><label>Repeat<input class="lt-input" type="password" id="vnp2" autocomplete="new-password"></label></div>
      <div class="lt-modal__actions"><button class="lt-btn lt-btn--ghost" data-act="unlock-cancel">Cancel</button><button class="lt-btn lt-btn--primary" data-act="vault-recover-go">Recover</button></div>`);
  }
  async function recoverFromModal() {
    const a = $('#vnp1').value; const b = $('#vnp2').value;
    if (a.length < 10 || a !== b) { toast('Use matching passwords of at least 10 characters', 'error'); return; }
    const ok = await guard(async () => { await LT.vault.recover(S.ctx, $('#vrk').value, a); return true; });
    if (ok) { closeModal(); toast('Vault recovered and open', 'good'); finishUnlock(true); }
  }

  // ---------- open / create letters ----------
  async function pickType(typeId) {
    const t = typeById(typeId);
    if (LT.isProtectedType(t) && !(await ensureUnlocked(`Unlock to write a ${t.en}`))) return;
    const res = await guard(() => LT.createLetter(S.ctx, S.settings, t));
    if (!res) return;
    await refreshList();
    openEditor(res.id, res.doc, res.versions);
  }
  async function openRow(id) {
    const row = S.rows.find((r) => r.id === id);
    if (!row) return;
    if (!LT.canOpen(S.ctx, row)) { await ensureUnlocked(); return; }
    if (row.protected && !(await ensureUnlocked('Unlock to open this letter'))) return;
    const res = await guard(() => LT.openLetter(S.ctx, id, row));
    if (res) openEditor(id, res.doc, res.versions);
  }
  async function openEditor(id, doc, versions) {
    S.cur = { id, doc: Object.assign({}, doc, { format: Object.assign({}, T.DEFAULT_FORMAT, doc.format || {}) }), versions: versions || [], dirty: false, savedAt: Date.now() };
    if (S.cur.doc.mode === 'minutes' && !S.cur.doc.minutes) S.cur.doc.minutes = T.blankMinutes(S.cur.doc.lang);
    S.sigImages = await LT.signatureImages(S.ctx, S.cur.doc);
    S.view = 'editor';
    renderEditor();
  }

  // ---------- editor ----------
  const locked = () => S.cur && (S.cur.doc.status === 'signed' || S.cur.doc.status === 'filed');
  function field(label, path, value, opts = {}) {
    const dis = locked() && !opts.always ? 'disabled' : '';
    const input = opts.area
      ? `<textarea class="lt-input ${opts.cls || ''}" data-f="${path}" rows="${opts.rows || 3}" placeholder="${esc(opts.ph || '')}" ${dis}>${esc(value || '')}</textarea>`
      : opts.select
        ? `<select class="lt-input" data-f="${path}" ${dis}>${opts.select.map(([v, l]) => `<option value="${esc(v)}" ${String(v) === String(value) ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select>`
        : `<input class="lt-input ${opts.cls || ''}" data-f="${path}" type="${opts.type || 'text'}" value="${esc(value ?? '')}" placeholder="${esc(opts.ph || '')}" ${dis}>`;
    return `<label class="lt-field ${opts.wide ? 'lt-field--wide' : ''}"><span>${label}</span>${input}</label>`;
  }
  function letterForm(d) {
    const L = T.L[d.lang === 'sw' ? 'sw' : 'en'];
    return `
      <div class="lt-sec"><h4>To</h4>${field('Recipient — name, title, organisation, address (one per line)', 'recipient', d.recipient, { area: true, rows: 4, ph: 'The Branch Manager,\nFanikiwa Microfinance,\nP.O. Box …,\nArusha.' , wide: true })}
        <div class="lt-row2">${field('Salutation', 'salutation', d.salutation, { ph: L.dearSir })}${field('Closing', 'closing', d.closing, { ph: L.faithfully })}</div>
        <div class="lt-chips">${[T.L.en.dearSir, 'Dear Mr. ,', 'Dear Ms. ,', 'Dear Colleague,', T.L.sw.dearSir, 'Mheshimiwa,'].map((s) => `<button class="lt-chip lt-chip--btn" data-act="salute" data-v="${esc(s)}" ${locked() ? 'disabled' : ''}>${esc(s)}</button>`).join('')}</div></div>
      <div class="lt-sec"><h4>Subject</h4><div class="lt-subject-in"><span>${esc(L.re)}:</span>${field('', 'subject', d.subject, { ph: 'APPLICATION FOR A LOAN', cls: 'lt-input--upper' })}</div></div>
      <div class="lt-sec lt-sec--body"><h4>Your letter <small>type freely — capitals, grammar and mixing languages are fixed by ✨ Polish</small></h4>
        ${field('', 'body', d.body, { area: true, rows: 14, cls: 'lt-input--body', ph: 'on behalf of socrates investment limited we apply for loan of 25000000 tsh for nursery renovation. tunaomba mkopo huu utusaidie…', wide: true })}
        <p class="lt-hint">Leave an empty line between paragraphs. Lines starting with “- ” or “1.” become a neat list.</p></div>
      <div class="lt-sec"><h4>Sign-off</h4>
        <label class="lt-check"><input type="checkbox" data-f="onBehalf" ${d.onBehalf ? 'checked' : ''} ${locked() ? 'disabled' : ''}> “${esc(L.onBehalf)} …” line</label>
        ${d.onBehalf ? field('On behalf of', 'onBehalfName', d.onBehalfName, { ph: S.settings.companyName || S.ctx.schoolName }) : ''}
        ${signersForm(d)}</div>
      <div class="lt-sec"><h4>Enclosures &amp; copies</h4><div class="lt-row2">${field('Enclosures (one per line)', 'enclosures', d.enclosures, { area: true, rows: 3 })}${field('C.C. (one per line)', 'cc', d.cc, { area: true, rows: 3 })}</div></div>`;
  }
  function signersForm(d) {
    const me = LT.mySignerKey(S.ctx);
    return `<div class="lt-signers-form">${(d.signers || []).map((s, i) => `
      <div class="lt-signer-row">${field('Name', `signers.${i}.name`, s.name)}${field('Position', `signers.${i}.position`, s.position)}
        <div class="lt-signer-row__state">${s.signed ? `<span class="lt-chip lt-chip--good">✔ Signed ${esc(fmtDT(s.signedAt))}</span>` : s.key === me ? '<span class="lt-chip">You</span>' : ''}
        ${!locked() && (d.signers.length > 1) ? `<button class="lt-btn lt-btn--sm lt-btn--ghost" data-act="signer-del" data-i="${i}" title="Remove">✕</button>` : ''}</div></div>`).join('')}
      ${locked() ? '' : '<button class="lt-btn lt-btn--sm" data-act="signer-add">＋ Add signatory</button>'}</div>`;
  }
  function minutesForm(d) {
    const m = d.minutes;
    const rows = (key, cols) => (m[key] || []).map((item, i) => `<div class="lt-mrow">${cols(item, i)}${locked() ? '' : `<button class="lt-btn lt-btn--sm lt-btn--ghost" data-act="m-del" data-k="${key}" data-i="${i}">✕</button>`}</div>`).join('');
    return `
      <div class="lt-sec"><h4>Meeting</h4>${field('Title', 'minutes.title', m.title, { ph: d.subject, wide: true })}
        <div class="lt-row3">${field('Date', 'minutes.date', m.date || d.date, { type: 'date' })}${field('Started', 'minutes.timeStart', m.timeStart, { ph: '10:00 AM' })}${field('Closed', 'minutes.timeEnd', m.timeEnd, { ph: '12:30 PM' })}</div>
        <div class="lt-row3">${field('Venue', 'minutes.venue', m.venue)}${field('Chairperson', 'minutes.chair', m.chair)}${field('Secretary', 'minutes.secretary', m.secretary)}</div></div>
      <div class="lt-sec"><h4>Present</h4>${rows('present', (p, i) => `${field('Name', `minutes.present.${i}.name`, p.name)}${field('Designation', `minutes.present.${i}.designation`, p.designation)}`)}
        ${locked() ? '' : '<button class="lt-btn lt-btn--sm" data-act="m-add" data-k="present">＋ Member</button>'}
        <div class="lt-row2">${field('Absent with apology (one per line)', 'minutes.absent', m.absent, { area: true, rows: 2 })}${field('In attendance (one per line)', 'minutes.inAttendance', m.inAttendance, { area: true, rows: 2 })}</div></div>
      <div class="lt-sec"><h4>Agenda</h4>${rows('agenda', (a, i) => field(`${i + 1}.`, `minutes.agenda.${i}`, a))}${locked() ? '' : '<button class="lt-btn lt-btn--sm" data-act="m-add" data-k="agenda">＋ Agenda item</button>'}</div>
      <div class="lt-sec"><h4>Discussion</h4>${rows('sections', (s, i) => `<div class="lt-msec">${field(`${i + 1}.0 Title`, `minutes.sections.${i}.title`, s.title)}${field('What was discussed', `minutes.sections.${i}.body`, s.body, { area: true, rows: 4 })}</div>`)}
        ${locked() ? '' : '<button class="lt-btn lt-btn--sm" data-act="m-add" data-k="sections">＋ Section</button>'}</div>
      <div class="lt-sec"><h4>Resolutions</h4>${rows('resolutions', (r, i) => field(`${i + 1}.`, `minutes.resolutions.${i}`, r, { area: true, rows: 2 }))}${locked() ? '' : '<button class="lt-btn lt-btn--sm" data-act="m-add" data-k="resolutions">＋ Resolution</button>'}</div>
      <div class="lt-sec lt-sec--body"><h4>Rough notes <small>paste or type notes, then 📋 Notes → Minutes</small></h4>${field('', 'minutes.notes', m.notes, { area: true, rows: 6, ph: 'kikao kilianza saa 4, present: joseph mnyore director, …' , wide: true })}</div>
      <div class="lt-sec"><h4>Signatures</h4>${signersForm(d)}</div>`;
  }
  function formatForm(d) {
    const f = d.format;
    const heads = Object.values(S.settings.letterheads);
    return `<div class="lt-sec"><h4>Layout &amp; style</h4>
      <div class="lt-row3">${field('Font', 'format.font', f.font, { select: T.FONTS.map((x) => [x.id, x.label]), always: true })}${field('Size', 'format.size', f.size, { select: T.SIZES.map((s) => [s, `${s} pt`]), always: true })}${field('Letterhead', 'format.letterheadId', f.letterheadId, { select: heads.map((h) => [h.id, h.label || h.name || h.id]).concat([['', 'No letterhead']]), always: true })}</div>
      <div class="lt-seg-label">Line spacing</div><div class="lt-seg">${T.SPACINGS.map((s) => `<button class="lt-seg__b ${Number(f.spacing) === s ? 'lt-seg__b--on' : ''}" data-act="spacing" data-v="${s}">${Number.isInteger(s) ? s.toFixed(1) : s}</button>`).join('')}</div>
      <div class="lt-row3">${field('Paragraph gap', 'format.paraGap', f.paraGap, { select: [[0, 'None'], [6, 'Small'], [10, 'Medium'], [14, 'Large']], always: true })}${field('Alignment', 'format.align', f.align, { select: [['justify', 'Justified'], ['left', 'Left']], always: true })}${field('Margins', 'format.margins', f.margins, { select: [['normal', 'Normal'], ['narrow', 'Narrow']], always: true })}</div>
      <div class="lt-checks"><label class="lt-check"><input type="checkbox" data-f="format.centerSubject" ${f.centerSubject ? 'checked' : ''}> Centre the RE: line</label>
      <label class="lt-check"><input type="checkbox" data-f="format.pageNumbers" ${f.pageNumbers ? 'checked' : ''}> Page numbers on multi-page letters</label>
      <label class="lt-check"><input type="checkbox" data-f="format.footerMark" ${f.footerMark ? 'checked' : ''}> “Generated with SoMAp” mark</label></div></div>`;
  }
  function renderEditor() {
    const d = S.cur.doc;
    const t = typeById(d.typeId);
    const prot = d.scope === 'company' || d.confidential;
    const isMin = d.mode === 'minutes';
    shell(`<section class="lt-editor lt-editor--${S.mobileTab}">
      <div class="lt-ebar">
        <button class="lt-btn lt-btn--ghost" data-act="home">‹ Letters</button>
        <div class="lt-ebar__title"><span class="lt-ebar__icon">${t.icon || '✉️'}</span><div><strong>${esc(t.en)}</strong><div class="lt-muted">${esc(d.refNo || '')} ${prot ? '· 🔒 Protected' : ''}</div></div></div>
        <div class="lt-ebar__status">${statusChip(d.status)}<span class="lt-saved" id="ltSaved">${S.cur.dirty ? 'Saving…' : `Saved ${fmtDT(S.cur.savedAt)}`}</span></div>
        <div class="lt-ebar__actions">
          <button class="lt-btn lt-btn--ai" data-act="ai-polish" ${locked() ? 'disabled' : ''} title="${prot ? 'Protected letter: sent to the assistant only from your unlocked session, not stored' : 'Fix capitals, grammar, paragraphs and tone'}">✨ Polish</button>
          <button class="lt-btn" data-act="ai-translate" ${locked() ? 'disabled' : ''}>🌍 ${d.lang === 'sw' ? 'Kiswahili → English' : 'English → Kiswahili'}</button>
          ${isMin ? `<button class="lt-btn" data-act="ai-minutes" ${locked() ? 'disabled' : ''}>📋 Notes → Minutes</button>` : `<button class="lt-btn" data-act="ai-subject" ${locked() ? 'disabled' : ''}>📝 Suggest subject</button>`}
          <button class="lt-btn lt-btn--sign" data-act="sign" ${locked() ? 'disabled' : ''}>✍️ Add my signature</button>
          <button class="lt-btn lt-btn--primary" data-act="pdf">⬇ PDF</button>
          <details class="lt-more"><summary class="lt-btn">⋯</summary><div class="lt-more__menu">
            <button data-act="exact-preview">👁 Exact PDF preview</button><button data-act="print">🖨 Print</button><button data-act="duplicate">⧉ Duplicate as new letter</button><button data-act="history">🕘 Versions (${S.cur.versions.length})</button>
            ${d.status === 'draft' ? '<button data-act="status" data-v="final">Mark ready for signature</button>' : ''}${d.status === 'final' ? '<button data-act="status" data-v="draft">Back to draft</button>' : ''}
            ${d.status === 'signed' ? '<button data-act="status" data-v="filed">Mark as sent / filed</button>' : ''}${locked() ? '<button data-act="new-version">✎ Edit as new version</button>' : '<button data-act="delete" class="lt-danger">🗑 Delete draft</button>'}
          </div></details>
        </div>
      </div>
      ${locked() ? `<div class="lt-banner"><span>🔏</span><div><strong>Signed and locked.</strong> The text can no longer change. Use “Edit as new version” to make changes — signatures are then cleared.</div><button class="lt-btn lt-btn--sm" data-act="new-version">Edit as new version</button></div>` : ''}
      <div class="lt-tabs"><button class="lt-tab ${S.mobileTab === 'write' ? 'lt-tab--on' : ''}" data-act="tab" data-v="write">Write</button><button class="lt-tab ${S.mobileTab === 'preview' ? 'lt-tab--on' : ''}" data-act="tab" data-v="preview">Preview</button></div>
      <div class="lt-split">
        <div class="lt-pane lt-pane--write">
          <div class="lt-sec"><h4>Details</h4><div class="lt-row3">${field('Date', 'date', d.date, { type: 'date' })}${field('Reference', 'refNo', d.refNo)}${field('Language', 'lang', d.lang, { select: [['en', 'English'], ['sw', 'Kiswahili']] })}</div></div>
          ${isMin ? minutesForm(d) : letterForm(d)}
          ${formatForm(d)}
        </div>
        <div class="lt-pane lt-pane--preview"><div class="lt-preview" id="ltPreview"><div class="lt-preview__scale" id="ltPreviewScale"></div></div></div>
      </div></section>`);
    renderPreview();
    if (!S.ro) { S.ro = new ResizeObserver(() => scalePreview()); }
    const pv = document.getElementById('ltPreview'); if (pv) S.ro.observe(pv);
  }
  function assets() {
    const d = S.cur.doc;
    return { head: d.format.letterheadId ? S.settings.letterheads[d.format.letterheadId] : null, signatures: S.sigImages, companyName: S.settings.companyName || S.settings.letterheads.company?.name || '' };
  }
  function renderPreview() {
    const box = document.getElementById('ltPreviewScale');
    if (!box) return;
    box.innerHTML = PDF.previewHtml(S.cur.doc, assets());
    scalePreview();
  }
  function scalePreview() {
    const pv = document.getElementById('ltPreview'); const sc = document.getElementById('ltPreviewScale');
    if (!pv || !sc) return;
    const page = sc.firstElementChild; if (!page || !pv.clientWidth) return; // hidden on the phone "Write" tab
    const scale = Math.min(1, (pv.clientWidth - 24) / page.offsetWidth);
    sc.style.transform = `scale(${scale})`;
    pv.style.height = `${page.offsetHeight * scale + 24}px`;
  }
  function schedulePreview() { clearTimeout(S.previewTimer); S.previewTimer = setTimeout(renderPreview, 120); }

  // ---------- doc editing ----------
  function setPath(obj, path, value) {
    const parts = path.split('.');
    let o = obj;
    for (let i = 0; i < parts.length - 1; i += 1) { if (o[parts[i]] == null) o[parts[i]] = /^\d+$/.test(parts[i + 1]) ? [] : {}; o = o[parts[i]]; }
    o[parts[parts.length - 1]] = value;
  }
  function markDirty() {
    S.cur.dirty = true;
    const el = document.getElementById('ltSaved'); if (el) el.textContent = 'Saving…';
    clearTimeout(S.saveTimer); S.saveTimer = setTimeout(flushSave, 2000);
  }
  async function flushSave() {
    clearTimeout(S.saveTimer);
    if (!S.cur || !S.cur.dirty) return;
    const cur = S.cur;
    cur.dirty = false;
    try {
      if ((cur.doc.scope === 'company' || cur.doc.confidential) && !LT.vault.isUnlocked()) {
        cur.dirty = true;
        const ok = await ensureUnlocked('The vault locked — unlock to keep saving');
        if (!ok) return;
        cur.dirty = false;
      }
      await LT.saveLetter(S.ctx, cur.id, cur.doc, cur.versions);
      cur.savedAt = Date.now();
      const el = document.getElementById('ltSaved'); if (el && S.cur === cur) el.textContent = `Saved ${fmtDT(cur.savedAt)}`;
    } catch (err) { cur.dirty = true; toast(`Not saved: ${friendly(err)}`, 'error'); }
  }
  function onFieldInput(el) {
    const path = el.dataset.f;
    let v = el.type === 'checkbox' ? el.checked : el.value;
    if (['format.size', 'format.paraGap', 'format.spacing'].includes(path)) v = Number(v);
    if (path === 'subject') v = String(v).toUpperCase();
    setPath(S.cur.doc, path, v);
    if (path === 'subject' && el.value !== v) { const p = el.selectionStart; el.value = v; el.setSelectionRange(p, p); }
    if (path === 'lang') {
      const d = S.cur.doc; const L = T.L[v];
      // Swap the fixed phrases that were left at their defaults.
      if ([T.L.en.dearSir, T.L.sw.dearSir].includes(d.salutation)) d.salutation = L.dearSir;
      if ([T.L.en.faithfully, T.L.en.sincerely, T.L.sw.faithfully, T.L.sw.sincerely].includes(d.closing)) d.closing = T.closingFor(d.salutation, v);
      renderEditor();
    }
    if (path === 'onBehalf') renderEditor();
    if (path === 'salutation' && !locked()) { const auto = T.closingFor(el.value, S.cur.doc.lang); if ([T.L.en.faithfully, T.L.en.sincerely].includes(S.cur.doc.closing) && S.cur.doc.lang !== 'sw') { S.cur.doc.closing = auto; const c = $('[data-f="closing"]'); if (c) c.value = auto; } }
    markDirty(); schedulePreview();
  }

  // ---------- AI ----------
  function namesForTidy() {
    const h = S.settings.letterheads;
    // Full names plus their distinctive first word ("Socrates"), never generic words like "school".
    return [h.school?.name, h.company?.name, S.settings.companyName, S.ctx.schoolName].filter(Boolean).flatMap((n) => [n, n.split(/\s+/)[0]].filter((w) => w.length > 3));
  }
  // Free public services see the letter text; protected letters ask first (once per session).
  function externalOk(doc, services) {
    if (!(doc.scope === 'company' || doc.confidential) || S.externalConsent) return Promise.resolve(true);
    return new Promise((resolve) => {
      S.consentResolve = resolve;
      modal(`<div class="lt-lock"><div class="lt-lock__icon">🌐</div><h2>Send this confidential letter to a free online service?</h2>
        <p>The Claude assistant is not deployed yet, so this step uses ${esc(services)}. The letter text leaves SoMAp for a moment and those services may keep it. Names and amounts in it would be included.</p></div>
        <div class="lt-modal__actions"><button class="lt-btn lt-btn--ghost" data-act="consent-no">No, keep it private</button><button class="lt-btn lt-btn--primary" data-act="consent-yes">Yes, for this session</button></div>`);
    });
  }
  function finishConsent(ok) { const r = S.consentResolve; S.consentResolve = null; if (ok) S.externalConsent = true; closeModal(); if (r) r(ok); }
  // Claude returns letter-specific suggestions; normalise them to the shape of the built-in ones.
  function claudeAdditions(res) {
    return (res.suggestedAdditions || []).filter((a) => a && a.text).map((a) => ({ text: a.text, reason: a.reason || '', at: a.afterParagraph < 0 ? 'start' : a.afterParagraph >= (res.paragraphs || []).length - 1 ? 'end' : Number(a.afterParagraph) }));
  }
  async function aiPolish() {
    const d = S.cur.doc;
    if (!String(d.body || '').trim() && !d.subject) { toast('Write something first', 'error'); return; }
    const btn = $('[data-act="ai-polish"]'); busy(btn, 'Polishing…');
    let res; let kind = 'polish';
    try {
      res = await AI.run(S.settings, 'polish', d, typeById(d.typeId));
      res.additions = claudeAdditions(res);
    } catch (err) {
      if (!AI.isServiceDown(err)) { busy(btn); toast(friendly(err), 'error'); return; }
      busy(btn);
      const ok = await externalOk(d, d.lang === 'sw' ? 'Google Translate' : 'LanguageTool (spelling and grammar) and Google Translate');
      busy(btn, 'Checking spelling…');
      if (ok) {
        try { res = await AI.freePolish(d, namesForTidy(), d.typeId); kind = 'polish-free'; } catch (_) { res = null; }
      }
      if (!res) { res = AI.tidy(d, namesForTidy()); res.additions = AI.suggestAdditions(d, d.typeId, String(res.body || '').split(/\n\s*\n/)); kind = 'polish-offline'; }
    }
    busy(btn);
    const paragraphs = Array.isArray(res.paragraphs) ? res.paragraphs : String(res.body || '').split(/\n\s*\n/).filter(Boolean);
    reviewModal('✨ Polished', d, { subject: res.subject || d.subject, salutation: res.salutation || d.salutation, paragraphs, closing: res.closing || d.closing, lang: d.lang }, res, kind);
  }
  async function aiTranslate() {
    const d = S.cur.doc;
    const target = d.lang === 'sw' ? 'en' : 'sw';
    const title = target === 'sw' ? '🌍 Kiswahili' : '🌍 English';
    const btn = $('[data-act="ai-translate"]'); busy(btn, 'Translating…');
    let res;
    try {
      res = await AI.run(S.settings, 'translate', d, typeById(d.typeId), { targetLang: target });
    } catch (err) {
      if (!AI.isServiceDown(err)) { busy(btn); toast(friendly(err), 'error'); return; }
      busy(btn);
      if (!(await externalOk(d, 'Google Translate'))) return;
      busy(btn, 'Translating…');
      try { res = await AI.freeTranslate(d, target, namesForTidy()); } catch (e2) {
        busy(btn);
        modal(`<h2>The translator could not be reached</h2><p>Neither the Claude assistant nor the free translators answered (${esc(e2.message || 'no connection')}). Check the internet connection and try again, or switch only the date, salutation, closing and labels to ${target === 'sw' ? 'Kiswahili' : 'English'} now.</p>
          <div class="lt-modal__actions"><button class="lt-btn lt-btn--ghost" data-act="modal-close">Cancel</button><button class="lt-btn lt-btn--primary" data-act="labels-only" data-v="${target}">Switch labels only</button></div>`);
        return;
      }
    }
    busy(btn);
    reviewModal(title, d, { subject: res.subject, salutation: res.salutation, paragraphs: res.paragraphs || [], closing: res.closing, lang: target }, Object.assign(res, { additions: [] }), 'translate');
  }
  async function aiSubject() {
    const d = S.cur.doc;
    const btn = $('[data-act="ai-subject"]'); busy(btn, 'Thinking…');
    try {
      const res = await AI.run(S.settings, 'subject', d, typeById(d.typeId));
      busy(btn);
      modal(`<h2>📝 Suggested subjects</h2><div class="lt-suggest">${(res.subjects || []).map((s) => `<button class="lt-suggest__b" data-act="use-subject" data-v="${esc(s)}">${esc(String(s).toUpperCase())}</button>`).join('')}</div>`);
    } catch (err) { busy(btn); toast(err.code === 'NO_SERVICE' || err.code === 'UNREACHABLE' || err.code === 'HTTP_404' ? 'Subject suggestions need the AI service (see Settings → AI service).' : friendly(err), 'error'); }
  }
  async function aiMinutes() {
    const d = S.cur.doc;
    const btn = $('[data-act="ai-minutes"]'); busy(btn, 'Organising…');
    try {
      const res = await AI.run(S.settings, 'minutes', d, typeById(d.typeId));
      busy(btn);
      const preview = `<div class="lt-review__col"><h4>The assistant arranged</h4>
        <p><strong>${esc(res.title || '')}</strong></p>
        ${res.present?.length ? `<p><em>Present:</em> ${esc(res.present.map((p) => `${p.name}${p.designation ? ` (${p.designation})` : ''}`).join(', '))}</p>` : ''}
        ${res.agenda?.length ? `<p><em>Agenda:</em></p><ol>${res.agenda.map((a) => `<li>${esc(a)}</li>`).join('')}</ol>` : ''}
        ${(res.sections || []).map((s, i) => `<p><strong>${i + 1}.0 ${esc(s.title)}</strong><br>${esc(s.body)}</p>`).join('')}
        ${res.resolutions?.length ? `<p><em>Resolutions:</em></p><ol>${res.resolutions.map((r) => `<li>${esc(r)}</li>`).join('')}</ol>` : ''}</div>`;
      S.pendingMinutes = res;
      modal(`<h2>📋 Notes → Minutes</h2>${missingHtml(res)}${preview}
        <p class="lt-note">Accepting fills the empty parts of the form. Anything you already typed in a field is kept as a version first.</p>
        <div class="lt-modal__actions"><button class="lt-btn lt-btn--ghost" data-act="modal-close">Reject</button><button class="lt-btn lt-btn--primary" data-act="accept-minutes">Accept</button></div>`, { wide: true });
    } catch (err) { busy(btn); toast(['NO_SERVICE', 'UNREACHABLE', 'HTTP_404'].includes(err.code) ? 'Notes → Minutes needs the AI service (see Settings → AI service).' : friendly(err), 'error'); }
  }
  function acceptMinutes() {
    const res = S.pendingMinutes; if (!res) return;
    const d = S.cur.doc; const m = d.minutes;
    S.cur.versions = LT.pushVersion(S.cur.versions, d, 'before-notes-to-minutes', S.ctx);
    if (res.title) m.title = res.title;
    if (res.present?.length) m.present = res.present;
    if (res.absent?.length) m.absent = res.absent.join('\n');
    if (res.agenda?.length) m.agenda = res.agenda;
    if (res.sections?.length) m.sections = res.sections;
    if (res.resolutions?.length) m.resolutions = res.resolutions;
    S.pendingMinutes = null; closeModal(); markDirty(); renderEditor(); toast('Minutes arranged', 'good');
  }
  function busy(btn, text) {
    if (!btn) return;
    if (text) { btn.dataset.label = btn.innerHTML; btn.innerHTML = `<span class="lt-spin"></span> ${esc(text)}`; btn.disabled = true; } else { btn.innerHTML = btn.dataset.label || btn.innerHTML; btn.disabled = false; }
  }
  function missingHtml(res) {
    const miss = (res.missingDetails || []).filter(Boolean);
    return `${miss.length ? `<div class="lt-missing"><strong>Missing details — add them so the letter is complete:</strong><ul>${miss.map((m) => `<li>${esc(m)}</li>`).join('')}</ul></div>` : ''}${res.notes ? `<p class="lt-note">${esc(res.notes)}</p>` : ''}`;
  }
  // Paragraphs with the ticked additions put in place: "start" ones open the first paragraph,
  // "end" ones form a closing paragraph, numbered ones follow that paragraph.
  function withAdditions(paragraphs, additions, on) {
    const ps = paragraphs.slice();
    additions.map((a, i) => ({ a, i })).filter((x) => on[x.i] && typeof x.a.at === 'number').sort((x, y) => y.a.at - x.a.at)
      .forEach((x) => ps.splice(Math.min(x.a.at + 1, ps.length), 0, x.a.text));
    const starts = additions.filter((a, i) => on[i] && a.at === 'start').map((a) => a.text);
    const ends = additions.filter((a, i) => on[i] && a.at === 'end').map((a) => a.text);
    if (starts.length) ps[0] = `${starts.join(' ')}${ps[0] ? ` ${ps[0]}` : ''}`;
    if (ends.length) ps.push(ends.join(' '));
    return ps;
  }
  const ENGINE_CHIP = { 'polish-offline': '<span class="lt-chip lt-chip--warn">basic tidy — no internet service reached</span>', 'polish-free': '<span class="lt-chip lt-chip--info">free spelling & grammar check</span>' };
  function reviewModal(title, before, after, res, kind) {
    const additions = res.additions || [];
    S.pendingAI = { after, kind, additions, on: additions.map(() => true) };
    const fixes = (res.fixes || []).filter(Boolean);
    const advice = (res.advice || []).filter(Boolean);
    modal(`<h2>${title} ${ENGINE_CHIP[kind] || (res.engine === 'free' ? '<span class="lt-chip lt-chip--info">free translator</span>' : '<span class="lt-chip lt-chip--good">Claude</span>')}</h2>${missingHtml(res)}
      ${fixes.length ? `<details class="lt-fixes" open><summary><strong>${fixes.length} correction${fixes.length > 1 ? 's' : ''} made</strong></summary><ul>${fixes.slice(0, 40).map((f) => `<li>${esc(f)}</li>`).join('')}</ul></details>` : ''}
      ${advice.length ? `<details class="lt-fixes"><summary>${advice.length} style tip${advice.length > 1 ? 's' : ''} (not applied)</summary><ul>${advice.map((f) => `<li>${esc(f)}</li>`).join('')}</ul></details>` : ''}
      ${additions.length ? `<div class="lt-adds"><strong>Suggested additions</strong> <span class="lt-muted">— untick anything you do not want; the “After” text updates.</span>${additions.map((a, i) => `<label class="lt-add"><input type="checkbox" data-add="${i}" checked><span><span class="lt-add__text">${esc(a.text)}</span>${a.reason ? `<span class="lt-muted"> · ${esc(a.reason)}</span>` : ''}</span></label>`).join('')}</div>` : ''}
      <div class="lt-review">${reviewCol('Before', Object.assign({}, before, { paragraphs: String(before.body || '').split(/\n\s*\n/) }))}<div id="ltAfterCol">${reviewCol('After', Object.assign({}, after, { paragraphs: withAdditions(after.paragraphs, additions, S.pendingAI.on) }), additions)}</div></div>
      <div class="lt-modal__actions"><button class="lt-btn lt-btn--ghost" data-act="ai-reject">Reject</button><span class="lt-spacer"></span><button class="lt-btn" data-act="ai-accept" data-keep="1">Accept and keep editing</button><button class="lt-btn lt-btn--primary" data-act="ai-accept">Accept</button></div>`, { wide: true });
  }
  function reviewCol(h, x, additions) {
    const added = new Set((additions || []).map((a) => a.text));
    const para = (p) => { let html = esc(p); added.forEach((t) => { if (p.includes(t)) html = html.replace(esc(t), `<mark class="lt-added">${esc(t)}</mark>`); }); return `<p>${html}</p>`; };
    return `<div class="lt-review__col"><h4>${h}</h4>${x.subject ? `<p class="lt-review__subj">${esc(x.subject)}</p>` : ''}<p><em>${esc(x.salutation || '')}</em></p>${(x.paragraphs || []).filter(Boolean).map(para).join('')}<p><em>${esc(x.closing || '')}</em></p></div>`;
  }
  function toggleAddition(i, on) {
    const p = S.pendingAI; if (!p) return;
    p.on[i] = on;
    const col = document.getElementById('ltAfterCol');
    if (col) col.innerHTML = reviewCol('After', Object.assign({}, p.after, { paragraphs: withAdditions(p.after.paragraphs, p.additions, p.on) }), p.additions);
  }
  function acceptAI(keep) {
    const p = S.pendingAI; if (!p) return;
    const d = S.cur.doc;
    S.cur.versions = LT.pushVersion(S.cur.versions, d, p.kind === 'translate' ? 'before-translation' : 'before-polish', S.ctx);
    const body = withAdditions(p.after.paragraphs || [], p.additions || [], p.on || []).filter(Boolean).join('\n\n');
    Object.assign(d, { subject: String(p.after.subject || '').replace(/^\s*(re|yah)\s*[:.-]\s*/i, '').toUpperCase(), salutation: p.after.salutation, body, closing: p.after.closing, lang: p.after.lang || d.lang });
    S.pendingAI = null; closeModal(); markDirty();
    if (!keep && global.innerWidth < 900) S.mobileTab = 'preview';
    renderEditor(); toast('Applied — your previous text is kept in Versions', 'good');
  }

  // ---------- signatures ----------
  async function signNow() {
    const d = S.cur.doc;
    if (S.ctx.isDirector && !(await ensureUnlocked('Unlock to use your signature'))) return;
    const sig = await guard(() => LT.loadMySignature(S.ctx));
    if (!sig) return;
    if (!sig.exists) { toast('Upload your signature first', 'info'); S.settingsTab = 'signature'; openSettings(); return; }
    const key = LT.mySignerKey(S.ctx);
    let row = (d.signers || []).find((s) => s.key === key);
    if (!row) { row = { name: S.ctx.actorName, position: S.ctx.position, key }; d.signers = (d.signers || []).concat([row]); }
    if (!row.name) row.name = S.ctx.actorName;
    row.signed = true; row.signedAt = Date.now(); row.signedBy = S.ctx.actorId;
    const all = d.signers.filter((s) => s.name).every((s) => s.signed);
    d.status = all ? 'signed' : 'final';
    if (all) S.cur.versions = LT.pushVersion(S.cur.versions, d, 'signed', S.ctx);
    S.sigImages = await LT.signatureImages(S.ctx, d);
    S.cur.dirty = true; await flushSave();
    LT.audit(S.ctx, 'letter.signed', { letterId: S.cur.id });
    renderEditor(); toast(all ? 'Signed. The letter is now locked.' : 'Signature added — waiting for the other signatories', 'good');
    refreshList();
  }
  function newVersion() {
    const d = S.cur.doc;
    S.cur.versions = LT.pushVersion(S.cur.versions, d, `signed-version-${(S.cur.versions.length || 0) + 1}`, S.ctx);
    d.signers = (d.signers || []).map((s) => Object.assign({}, s, { signed: false, signedAt: null, signedBy: null }));
    d.status = 'draft';
    LT.audit(S.ctx, 'letter.reopened', { letterId: S.cur.id });
    S.sigImages = {};
    markDirty(); renderEditor(); toast('Editing a new version — sign again when ready');
  }

  // ---------- pdf ----------
  async function makePdf() {
    await flushSave();
    const d = S.cur.doc;
    return PDF.buildPdf(d, assets());
  }
  async function downloadPdf() {
    const btn = $('[data-act="pdf"]'); busy(btn, 'Building…');
    const pdf = await guard(makePdf); busy(btn);
    if (!pdf) return;
    pdf.save(PDF.fileName(S.cur.doc));
    LT.audit(S.ctx, 'letter.downloaded', { letterId: S.cur.id });
  }
  async function exactPreview(print) {
    const pdf = await guard(makePdf);
    if (!pdf) return;
    if (print) pdf.autoPrint();
    const url = pdf.output('bloburl');
    const w = global.open(url, '_blank');
    if (!w) toast('Allow pop-ups to see the PDF', 'error');
    if (print) LT.audit(S.ctx, 'letter.printed', { letterId: S.cur.id });
  }
  async function duplicate() {
    const d = clone(S.cur.doc);
    const t = typeById(d.typeId);
    if (LT.isProtectedType(t) && !(await ensureUnlocked())) return;
    Object.assign(d, { refNo: '', date: todayYMD(), status: 'draft', authorId: S.ctx.actorId, authorName: S.ctx.actorName, authorRole: S.ctx.role });
    d.signers = (d.signers || []).map((s) => Object.assign({}, s, { signed: false, signedAt: null, signedBy: null }));
    await flushSave();
    const res = await guard(() => LT.createLetter(S.ctx, S.settings, t, d));
    if (!res) return;
    await refreshList(); openEditor(res.id, res.doc, []); toast(`Duplicated as ${res.doc.refNo}`, 'good');
  }
  function historyModal() {
    const v = S.cur.versions.slice().reverse();
    modal(`<h2>🕘 Versions</h2><p class="lt-muted">Every polish, translation and signing keeps the text that was there before. Nothing you wrote is lost.</p>
      <div class="lt-versions">${v.length ? v.map((x, i) => `<div class="lt-version"><div><strong>${esc(x.kind)}</strong> · ${esc(fmtDT(x.at))} · ${esc(x.by || '')}<div class="lt-muted">${esc(String(x.body || x.minutes?.title || '').slice(0, 140))}…</div></div>
        ${locked() ? '' : `<button class="lt-btn lt-btn--sm" data-act="restore" data-i="${S.cur.versions.length - 1 - i}">Restore</button>`}</div>`).join('') : '<p class="lt-empty">No versions yet.</p>'}</div>`, { wide: true });
  }
  function restoreVersion(i) {
    const x = S.cur.versions[i]; if (!x) return;
    const d = S.cur.doc;
    S.cur.versions = LT.pushVersion(S.cur.versions, d, 'before-restore', S.ctx);
    Object.assign(d, { subject: x.subject, salutation: x.salutation, body: x.body, closing: x.closing, lang: x.lang || d.lang });
    if (x.minutes) d.minutes = clone(x.minutes);
    closeModal(); markDirty(); renderEditor(); toast('Version restored', 'good');
  }

  // ---------- settings ----------
  function openSettings() { if (S.cur) flushSave(); S.view = 'settings'; renderSettings(); }
  function renderSettings() {
    const tabs = [['letterheads', '🏷 Letterheads'], ['signature', '✍️ My signature'], ...(S.ctx.isDirector ? [['security', '🔐 Security'], ['service', '🤖 AI service']] : []), ['types', '🗂 Letter types'], ...(S.ctx.isDirector ? [['audit', '📜 Audit log']] : [])];
    if (!tabs.some((t) => t[0] === S.settingsTab)) S.settingsTab = 'letterheads';
    shell(`<section class="lt-card lt-settings"><div class="lt-settings__head"><h2>Settings</h2><button class="lt-btn lt-btn--ghost" data-act="home">‹ Back to letters</button></div>
      <div class="lt-stabs">${tabs.map(([k, l]) => `<button class="lt-stab ${S.settingsTab === k ? 'lt-stab--on' : ''}" data-act="stab" data-v="${k}">${l}</button>`).join('')}</div>
      <div id="ltSettingsBody" class="lt-settings__body"><div class="lt-spinner"></div></div></section>`);
    const body = document.getElementById('ltSettingsBody');
    const fn = { letterheads: settingsLetterheads, signature: settingsSignature, security: settingsSecurity, service: settingsService, types: settingsTypes, audit: settingsAudit }[S.settingsTab];
    Promise.resolve(fn(body)).catch((err) => { body.innerHTML = `<p class="lt-error">${esc(friendly(err))}</p>`; });
  }
  function settingsLetterheads(body) {
    const heads = Object.values(S.settings.letterheads);
    const sel = S.editHead && S.settings.letterheads[S.editHead] ? S.editHead : heads[0].id;
    const h = S.settings.letterheads[sel];
    const ro = !S.ctx.isDirector;
    const inp = (k, label, ph) => `<label class="lt-field"><span>${label}</span><input class="lt-input" data-h="${k}" value="${esc(h[k] || '')}" placeholder="${esc(ph || '')}" ${ro ? 'disabled' : ''}></label>`;
    body.innerHTML = `
      ${ro ? '<p class="lt-note">Letterheads are managed by the director. You can choose any of them per letter.</p>' : ''}
      <div class="lt-inline lt-headpick">${heads.map((x) => `<button class="lt-btn ${x.id === sel ? 'lt-btn--primary' : ''}" data-act="pick-head" data-v="${esc(x.id)}">${esc(x.label || x.name || x.id)}</button>`).join('')}${ro ? '' : '<button class="lt-btn lt-btn--ghost" data-act="add-head">＋ Alternative letterhead</button>'}</div>
      <div class="lt-headedit">
        <div class="lt-form">
          ${inp('label', 'Label (only you see this)', 'School letterhead')}
          <label class="lt-field"><span>Kind</span><select class="lt-input" data-h="kind" ${ro ? 'disabled' : ''}><option value="structured" ${h.kind !== 'image' ? 'selected' : ''}>Designed from fields (crisp)</option><option value="image" ${h.kind === 'image' ? 'selected' : ''}>Uploaded header image</option></select></label>
          ${h.kind === 'image' ? `<label class="lt-field"><span>Header image (full width PNG/JPG)</span><input type="file" accept="image/*" data-upload="head-image" ${ro ? 'disabled' : ''}></label>` : `
          ${inp('name', 'Name', 'SOCRATES PRE AND PRIMARY SCHOOL')}${inp('subtitle', 'Second line', 'A project of … Limited')}${inp('regNo', 'Registration', 'REG NO. …')}${inp('address', 'Address', 'P.O. Box …, Arusha, Tanzania')}
          <div class="lt-row2">${inp('phones', 'Phones', '+255 …')}${inp('email', 'Email', 'info@…')}</div>
          <div class="lt-row2">${inp('website', 'Website', 'somapv2i.com')}${inp('motto', 'Motto', '')}</div>
          <div class="lt-row2"><label class="lt-field"><span>Accent colour</span><input class="lt-input lt-input--color" type="color" data-h="color" value="${esc(h.color || '#0f3d6e')}" ${ro ? 'disabled' : ''}></label>
          <label class="lt-field"><span>${h.logoIsDefault ? 'Logo — SoMAp logo in use; upload yours to replace it' : 'Logo (PNG with transparent background is best)'}</span><input type="file" accept="image/*" data-upload="head-logo" ${ro ? 'disabled' : ''}></label></div>`}
          ${inp('footer', 'Footer line (optional)', 'Bank: … · TIN: …')}
          ${ro ? '' : `<div class="lt-inline"><button class="lt-btn lt-btn--primary" data-act="save-head">Save letterhead</button>${['school', 'company'].includes(h.id) ? '' : '<button class="lt-btn lt-btn--ghost lt-danger" data-act="del-head">Delete</button>'}</div>`}
        </div>
        <div class="lt-headprev"><div class="lt-preview lt-preview--mini" id="ltHeadPrev"><div class="lt-preview__scale" id="ltHeadPrevScale"></div></div></div>
      </div>
      ${S.ctx.isDirector ? `<hr class="lt-hr"><h3>Numbering &amp; company</h3><div class="lt-form lt-form--grid">
        <label class="lt-field"><span>Company name (for “on behalf of”)</span><input class="lt-input" id="stCompany" value="${esc(S.settings.companyName)}" placeholder="SOCRATES INVESTMENT LIMITED"></label>
        <label class="lt-field"><span>School reference prefix</span><input class="lt-input" id="stPreS" value="${esc(S.settings.prefixes.school)}"></label>
        <label class="lt-field"><span>Company reference prefix</span><input class="lt-input" id="stPreC" value="${esc(S.settings.prefixes.company)}"></label>
        <div><button class="lt-btn lt-btn--primary" data-act="save-numbering">Save</button></div></div>
        <p class="lt-muted">References look like ${esc(S.settings.prefixes.company)}/LTR/${esc(S.year)}/014 and ${esc(S.settings.prefixes.school)}/STF/${esc(S.year)}/007, numbered per year.</p>` : ''}`;
    S.editHead = sel; S.headDraft = clone(h);
    headPreview();
  }
  function headPreview() {
    const sc = document.getElementById('ltHeadPrevScale'); if (!sc) return;
    const sample = { lang: 'en', date: todayYMD(), refNo: `${S.settings.prefixes.school}/LTR/${S.year}/001`, recipient: 'The Recipient,\nP.O. Box 0000,\nArusha.', salutation: T.L.en.dearSir, subject: 'SAMPLE LETTER', body: 'This is how your letterhead looks on a letter.', closing: T.L.en.faithfully, signers: [{ name: S.ctx.actorName, position: S.ctx.position }], format: T.DEFAULT_FORMAT };
    sc.innerHTML = PDF.previewHtml(sample, { head: S.headDraft });
    const pv = document.getElementById('ltHeadPrev'); const page = sc.firstElementChild;
    const scale = Math.min(1, (pv.clientWidth - 12) / page.offsetWidth);
    sc.style.transform = `scale(${scale})`; pv.style.height = `${Math.min(page.offsetHeight, 520) * scale + 12}px`;
  }
  async function saveHead() {
    const h = clone(S.headDraft);
    if (h.logoIsDefault) h.logo = ''; // the fallback logo is applied at load time, never stored
    delete h.logoIsDefault;
    await guard(async () => {
      await LT.saveLetterhead(S.ctx, h);
      if (!S.settings.configured) await LT.saveSettings(S.ctx, { configuredAt: Date.now() });
      S.settings = await LT.loadSettings(S.ctx); // reference prefixes follow the letterhead names
      await logoFallback();
      toast('Letterhead saved', 'good'); renderSettings();
    });
  }
  async function settingsSignature(body) {
    const sig = await LT.loadMySignature(S.ctx);
    body.innerHTML = `
      <p class="lt-muted">${S.ctx.isDirector ? 'Your signature is encrypted with your vault: only your unlocked session can see or apply it. The Head Teacher cannot read it, even from the database.' : 'Only you can apply your signature, and only to letters you sign. The director’s signature is never available to this account.'}</p>
      <div class="lt-sigbox">${sig.locked ? '<div class="lt-sigbox__empty">🔒 Unlock the vault to see your signature<br><button class="lt-btn lt-btn--sm" data-act="unlock-sig">Unlock</button></div>' : sig.dataUrl ? `<img src="${esc(sig.dataUrl)}" alt="Your signature">` : '<div class="lt-sigbox__empty">No signature uploaded yet</div>'}</div>
      <div class="lt-sigopts">
        <div class="lt-card lt-card--inner"><h4>Upload a photo or scan</h4><p class="lt-muted">Sign on white paper, take a clear photo. The white background is removed automatically.</p><input type="file" accept="image/*" data-upload="signature"></div>
        <div class="lt-card lt-card--inner"><h4>Or draw it</h4><canvas id="ltPad" class="lt-pad" width="600" height="200"></canvas>
          <div class="lt-inline"><button class="lt-btn lt-btn--sm" data-act="pad-clear">Clear</button><button class="lt-btn lt-btn--sm lt-btn--primary" data-act="pad-save">Use this signature</button></div></div>
      </div>`;
    setupPad();
  }
  function setupPad() {
    const c = document.getElementById('ltPad'); if (!c) return;
    const g = c.getContext('2d'); g.lineWidth = 3.2; g.lineCap = 'round'; g.lineJoin = 'round'; g.strokeStyle = '#0b1f4a';
    let drawing = false; let last = null; S.padUsed = false;
    const pos = (e) => { const r = c.getBoundingClientRect(); return { x: (e.clientX - r.left) * (c.width / r.width), y: (e.clientY - r.top) * (c.height / r.height) }; };
    c.addEventListener('pointerdown', (e) => { drawing = true; last = pos(e); c.setPointerCapture(e.pointerId); });
    c.addEventListener('pointermove', (e) => { if (!drawing) return; const p = pos(e); g.beginPath(); g.moveTo(last.x, last.y); g.lineTo(p.x, p.y); g.stroke(); last = p; S.padUsed = true; });
    ['pointerup', 'pointerleave', 'pointercancel'].forEach((ev) => c.addEventListener(ev, () => { drawing = false; }));
  }
  // Loads an image, optionally strips a near-white background, trims and scales it; returns a data URL.
  function processImage(file, opts) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        const r = Math.min(1, opts.maxW / img.width, opts.maxH / img.height);
        const w = Math.round(img.width * r); const h = Math.round(img.height * r);
        const c = document.createElement('canvas'); c.width = w; c.height = h;
        const g = c.getContext('2d'); g.drawImage(img, 0, 0, w, h);
        if (opts.removeWhite) {
          const data = g.getImageData(0, 0, w, h); const px = data.data;
          let minX = w; let minY = h; let maxX = 0; let maxY = 0;
          for (let i = 0; i < px.length; i += 4) {
            if (px[i + 3] < 10) continue; // already transparent (drawn on the pad)
            const lum = 0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2];
            if (lum > 185) px[i + 3] = 0; else {
              px[i + 3] = Math.min(255, Math.round((185 - lum) * 3.2));
              px[i] = Math.round(px[i] * 0.5); px[i + 1] = Math.round(px[i + 1] * 0.5); px[i + 2] = Math.round(px[i + 2] * 0.7) + 20; // ink toward dark blue
              const p = i / 4; const x = p % w; const y = (p - x) / w;
              if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y;
            }
          }
          g.putImageData(data, 0, 0);
          if (maxX > minX && maxY > minY) {
            const t = document.createElement('canvas'); const pad = 6;
            t.width = maxX - minX + pad * 2; t.height = maxY - minY + pad * 2;
            t.getContext('2d').drawImage(c, minX - pad, minY - pad, t.width, t.height, 0, 0, t.width, t.height);
            resolve(t.toDataURL('image/png')); return;
          }
        }
        resolve(opts.jpeg ? c.toDataURL('image/jpeg', 0.88) : c.toDataURL('image/png'));
      };
      img.onerror = () => reject(new Error('That file is not an image'));
      const fr = new FileReader(); fr.onload = () => { img.src = fr.result; }; fr.onerror = () => reject(new Error('Could not read the file')); fr.readAsDataURL(file);
    });
  }
  async function saveSignature(dataUrl) {
    if (S.ctx.isDirector && !(await ensureUnlocked('Unlock to save your signature'))) return;
    const ok = await guard(async () => { await LT.saveMySignature(S.ctx, dataUrl); return true; });
    if (ok) { toast('Signature saved', 'good'); if (S.view === 'settings') renderSettings(); }
  }
  async function settingsSecurity(body) {
    const v = await LT.vault.load(S.ctx);
    const otp = !!v?.otp?.enabled;
    body.innerHTML = `
      <div class="lt-secgrid">
        <div class="lt-card lt-card--inner"><h4>Letters vault</h4>
          <p>${v ? `Created ${esc(fmtDT(v.createdAt))}. Protected letters and your signature are encrypted with AES-256.` : 'Not created yet — it is created the first time you write or open a protected letter.'}</p>
          ${v ? `<p>Status: ${LT.vault.isUnlocked() ? '<span class="lt-chip lt-chip--good">🔓 Open</span>' : '<span class="lt-chip">🔒 Locked</span>'}</p>
          <div class="lt-form"><label class="lt-field"><span>New password (vault must be open)</span><input class="lt-input" type="password" id="scNew" autocomplete="new-password"></label><label class="lt-field"><span>Repeat</span><input class="lt-input" type="password" id="scNew2" autocomplete="new-password"></label>
          <button class="lt-btn" data-act="change-pw">Change password</button></div>` : '<button class="lt-btn lt-btn--primary" data-act="unlock">Create vault</button>'}
        </div>
        <div class="lt-card lt-card--inner"><h4>Email OTP — second factor</h4>
          <p>When on, opening protected letters needs the vault password <strong>and</strong> a 6-digit code emailed to the director's private address. The address is set on the server (it cannot be changed from the browser).</p>
          <p>Status: ${otp ? '<span class="lt-chip lt-chip--good">On</span>' : '<span class="lt-chip">Off</span>'} ${S.settings.otpEmailHint ? `· codes go to ${esc(S.settings.otpEmailHint)}` : ''}</p>
          ${v ? `<div class="lt-form"><label class="lt-field"><span>Vault password</span><input class="lt-input" type="password" id="scOtpPw" autocomplete="current-password"></label>
            ${otp ? '<label class="lt-field"><span>Vault password again</span><input class="lt-input" type="password" id="scOtpPw2" autocomplete="current-password"></label>' : '<div class="lt-otp"><label class="lt-field"><span>Code from email</span><input class="lt-input lt-input--code" id="scOtpCode" inputmode="numeric" maxlength="6"></label><button class="lt-btn" data-act="otp-send-setup">✉ Send code</button></div><p class="lt-note" id="votpMsg"></p>'}
            <button class="lt-btn ${otp ? '' : 'lt-btn--primary'}" data-act="${otp ? 'otp-off' : 'otp-on'}">${otp ? 'Switch email OTP off' : 'Switch email OTP on'}</button></div>` : ''}
        </div>
      </div>`;
  }
  async function changePassword() {
    const a = $('#scNew').value; const b = $('#scNew2').value;
    if (a.length < 10 || a !== b) { toast('Use matching passwords of at least 10 characters', 'error'); return; }
    if (!(await ensureUnlocked('Unlock to change the password'))) return;
    const v = await LT.vault.load(S.ctx);
    if (v.otp?.enabled) { toast('Switch email OTP off first, change the password, then switch it on again', 'error'); return; }
    const ok = await guard(async () => { await LT.vault.rewrap(S.ctx, a, '', false); return true; });
    if (ok) { toast('Password changed', 'good'); renderSettings(); }
  }
  async function setOtp(on) {
    const pw = $('#scOtpPw').value;
    if (!pw) { toast('Enter the vault password', 'error'); return; }
    if (!(await ensureUnlocked('Unlock first'))) return;
    await guard(async () => {
      if (on) {
        const code = $('#scOtpCode').value.trim();
        if (!/^\d{6}$/.test(code)) throw new Error('Enter the 6-digit code from the email');
        const r = await AI.verifyOtp(S.settings, S.ctx.schoolId, code);
        await LT.vault.lock(); await LT.vault.unlock(S.ctx, pw, ''); // proves the password before re-wrapping
        await LT.vault.rewrap(S.ctx, pw, r.share, true);
      } else {
        // With OTP on, the password cannot be checked without a code, so it is typed twice instead.
        if (pw !== $('#scOtpPw2').value) throw new Error('The two passwords do not match');
        await LT.vault.rewrap(S.ctx, pw, '', false);
      }
      toast(on ? 'Email OTP is on' : 'Email OTP is off', 'good'); renderSettings();
    });
  }
  async function sendSetupOtp() {
    const btn = $('[data-act="otp-send-setup"]'); busy(btn, 'Sending…');
    try { const r = await AI.requestOtp(S.settings, S.ctx.schoolId); $('#votpMsg').textContent = `Code sent to ${r.sentTo}.`; S.settings.otpEmailHint = r.sentTo; LT.saveSettings(S.ctx, { otpEmailHint: r.sentTo }).catch(() => {}); } catch (err) { toast(friendly(err), 'error'); }
    busy(btn);
  }
  function settingsService(body) {
    body.innerHTML = `<p>The writing assistant (Polish, Kiswahili ⇄ English, subject suggestions, Notes → Minutes) and the email OTP run as Firebase Cloud Functions, so the AI key and email password never reach a browser. Deployment steps: <code>cloud-functions/letters/README.md</code>.</p>
      <div class="lt-form"><label class="lt-field"><span>Service base URL</span><input class="lt-input" id="svcUrl" value="${esc(S.settings.serviceUrl)}"></label>
      <div class="lt-inline"><button class="lt-btn" data-act="svc-test">Test connection</button><button class="lt-btn lt-btn--primary" data-act="svc-save">Save</button></div><p class="lt-note" id="svcMsg">Until it is deployed, ✨ Polish uses the built-in offline tidy (capitals, spacing, punctuation, money format and paragraphs).</p></div>`;
  }
  function settingsTypes(body) {
    const custom = S.types.filter((t) => !t.builtin && (S.ctx.isDirector || t.scope === 'school'));
    body.innerHTML = `<p class="lt-muted">Built-in purposes cover staff, parents, company and governance letters. Add your own — they appear in the picker for ${esc(S.ctx.schoolName)}.</p>
      <div class="lt-list">${custom.length ? custom.map((t) => `<div class="lt-row lt-row--static"><span class="lt-row__icon">${t.icon}</span><span class="lt-row__main"><span class="lt-row__subject">${esc(t.en)}</span><span class="lt-row__meta">${esc(t.sw || '')} · ${t.scope === 'company' ? 'Company' : 'School'}${t.confidential ? ' · 🔒' : ''} · RE: ${esc(t.subject || '')}</span></span></div>`).join('') : '<div class="lt-empty"><p>No custom types yet.</p></div>'}</div>
      <button class="lt-btn lt-btn--primary" data-act="add-type">＋ Add type</button>`;
  }
  async function settingsAudit(body) {
    const list = await LT.listAudit(S.ctx, 80);
    body.innerHTML = `<div class="lt-audit">${list.length ? list.map((a) => `<div class="lt-audit__row"><span>${esc(fmtDT(a.at))}</span><span class="lt-audit__act ${/fail|denied|locked/.test(a.action) ? 'lt-audit__act--bad' : ''}">${esc(a.action)}</span><span>${esc(a.actorName || a.actorId || '')}</span><span class="lt-muted">${esc(a.letterId || '')}</span></div>`).join('') : '<p class="lt-empty">Nothing logged yet.</p>'}</div>`;
  }

  // ---------- events ----------
  async function onClick(e) {
    const el = e.target.closest('[data-act]');
    if (!el) { const m = e.target.classList?.contains('lt-modal') ? e.target : null; if (m) { if (S.consentResolve) finishConsent(false); else { closeModal(); finishUnlock(false); } } return; }
    const act = el.dataset.act;
    if (el.closest('.lt-more__menu')) el.closest('details')?.removeAttribute('open');
    switch (act) {
      case 'modal-close': if (S.consentResolve) { finishConsent(false); break; } closeModal(); finishUnlock(false); break;
      case 'home': if (S.cur) await flushSave(); S.cur = null; S.view = 'home'; await refreshList(); break;
      case 'new': openPicker(); break;
      case 'new-minutes': openPicker('minutes'); break;
      case 'settings': openSettings(); break;
      case 'filter-type': S.filter.type = S.filter.type === el.dataset.type ? '' : el.dataset.type; renderHome(); break;
      case 'filter-status': S.filter.status = S.filter.status === el.dataset.status ? '' : el.dataset.status; renderHome(); break;
      case 'filter-clear': S.filter = { q: '', scope: '', status: '', type: '' }; renderHome(); break;
      case 'open': openRow(el.dataset.id); break;
      case 'pick': pickType(el.dataset.type); break;
      case 'add-type': addTypeModal(); break;
      case 'save-type': saveTypeFromModal(); break;
      case 'unlock': ensureUnlocked().then((ok) => { if (ok && S.view === 'settings') renderSettings(); }); break;
      case 'unlock-sig': ensureUnlocked('Unlock to see your signature').then((ok) => { if (ok) renderSettings(); }); break;
      case 'unlock-cancel': closeModal(); finishUnlock(false); break;
      case 'lock': LT.vault.lock(); if (S.cur && (S.cur.doc.scope === 'company' || S.cur.doc.confidential)) { S.cur = null; S.view = 'home'; await refreshList(); } toast('Vault locked'); break;
      case 'vault-create': createVaultFromModal(); break;
      case 'vault-unlock': unlockFromModal(); break;
      case 'vault-recover': recoverModal(); break;
      case 'vault-recover-go': recoverFromModal(); break;
      case 'otp-send': sendOtp(); break;
      case 'copy-recovery': try { await navigator.clipboard.writeText(S.recoveryKey); toast('Copied', 'good'); } catch (_) { toast('Select the key and copy it', 'error'); } break;
      case 'download-recovery': {
        const blob = new Blob([`SoMAp Letters vault recovery key\nSchool: ${S.ctx.schoolName} (${S.ctx.schoolId})\nCreated: ${new Date().toString()}\n\n${S.recoveryKey}\n\nKeep this offline. Anyone with this key and access to the database can open protected letters.\n`], { type: 'text/plain' });
        const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `SoMAp-letters-recovery-${S.ctx.schoolId}.txt`; a.click(); break;
      }
      case 'recovery-done': S.recoveryKey = null; closeModal(); toast('Vault ready and open', 'good'); finishUnlock(true); break;
      // editor
      case 'tab': S.mobileTab = el.dataset.v; $('.lt-editor').className = `lt-editor lt-editor--${S.mobileTab}`; $$('.lt-tab').forEach((b) => b.classList.toggle('lt-tab--on', b.dataset.v === S.mobileTab)); scalePreview(); break;
      case 'salute': S.cur.doc.salutation = el.dataset.v; if (S.cur.doc.lang !== 'sw') S.cur.doc.closing = T.closingFor(el.dataset.v, 'en'); markDirty(); renderEditor(); break;
      case 'spacing': S.cur.doc.format.spacing = Number(el.dataset.v); markDirty(); $$('.lt-seg__b').forEach((b) => b.classList.toggle('lt-seg__b--on', b === el)); renderPreview(); break;
      case 'signer-add': S.cur.doc.signers.push({ name: '', position: '', key: '', signed: false }); markDirty(); renderEditor(); break;
      case 'signer-del': S.cur.doc.signers.splice(Number(el.dataset.i), 1); markDirty(); renderEditor(); break;
      case 'm-add': { const k = el.dataset.k; const blank = { present: { name: '', designation: '' }, agenda: '', sections: { title: '', body: '' }, resolutions: '' }[k]; S.cur.doc.minutes[k] = (S.cur.doc.minutes[k] || []).concat([blank]); markDirty(); renderEditor(); break; }
      case 'm-del': S.cur.doc.minutes[el.dataset.k].splice(Number(el.dataset.i), 1); markDirty(); renderEditor(); break;
      case 'ai-polish': aiPolish(); break;
      case 'ai-translate': aiTranslate(); break;
      case 'ai-subject': aiSubject(); break;
      case 'ai-minutes': aiMinutes(); break;
      case 'accept-minutes': acceptMinutes(); break;
      case 'ai-accept': acceptAI(!!el.dataset.keep); break;
      case 'ai-reject': S.pendingAI = null; closeModal(); break;
      case 'consent-yes': finishConsent(true); break;
      case 'consent-no': finishConsent(false); break;
      case 'use-subject': S.cur.versions = LT.pushVersion(S.cur.versions, S.cur.doc, 'before-subject', S.ctx); S.cur.doc.subject = String(el.dataset.v).toUpperCase(); closeModal(); markDirty(); renderEditor(); break;
      case 'labels-only': { const d = S.cur.doc; const v = el.dataset.v; d.lang = v; d.salutation = T.L[v].dearSir; d.closing = T.closingFor(d.salutation, v); closeModal(); markDirty(); renderEditor(); break; }
      case 'sign': signNow(); break;
      case 'new-version': newVersion(); break;
      case 'status': S.cur.doc.status = el.dataset.v; markDirty(); await flushSave(); renderEditor(); refreshList(); break;
      case 'pdf': downloadPdf(); break;
      case 'exact-preview': exactPreview(false); break;
      case 'print': exactPreview(true); break;
      case 'duplicate': duplicate(); break;
      case 'history': historyModal(); break;
      case 'restore': restoreVersion(Number(el.dataset.i)); break;
      case 'delete':
        if (!global.confirm('Delete this draft? This cannot be undone.')) break;
        if (await guard(async () => { await LT.deleteLetter(S.ctx, S.cur.id, LT.summaryOf(S.cur.doc)); return true; })) { S.cur = null; S.view = 'home'; await refreshList(); toast('Draft deleted'); }
        break;
      // settings
      case 'stab': S.settingsTab = el.dataset.v; renderSettings(); break;
      case 'pick-head': S.editHead = el.dataset.v; renderSettings(); break;
      case 'add-head': { const id = `alt_${Date.now().toString(36)}`; S.settings.letterheads[id] = { id, label: 'Alternative letterhead', kind: 'image', image: '', name: '', color: '#0f3d6e', footer: '' }; S.editHead = id; renderSettings(); break; }
      case 'save-head': saveHead(); break;
      case 'del-head': if (global.confirm('Delete this letterhead?')) { await guard(() => LT.deleteLetterhead(S.ctx, S.editHead)); delete S.settings.letterheads[S.editHead]; S.editHead = 'school'; renderSettings(); } break;
      case 'save-numbering': await guard(async () => { const prefixes = { school: $('#stPreS').value.trim().toUpperCase(), company: $('#stPreC').value.trim().toUpperCase() }; await LT.saveSettings(S.ctx, { companyName: $('#stCompany').value.trim(), prefixes }); S.settings.companyName = $('#stCompany').value.trim(); S.settings.prefixes = prefixes; toast('Saved', 'good'); renderSettings(); }); break;
      case 'pad-clear': { const c = document.getElementById('ltPad'); c.getContext('2d').clearRect(0, 0, c.width, c.height); S.padUsed = false; break; }
      case 'pad-save': {
        if (!S.padUsed) { toast('Draw your signature first', 'error'); break; }
        const c = document.getElementById('ltPad');
        const blob = await new Promise((r) => c.toBlob(r, 'image/png'));
        saveSignature(await processImage(blob, { maxW: 600, maxH: 220, removeWhite: true })); break;
      }
      case 'change-pw': changePassword(); break;
      case 'otp-on': setOtp(true); break;
      case 'otp-off': setOtp(false); break;
      case 'otp-send-setup': sendSetupOtp(); break;
      case 'svc-save': await guard(async () => { const url = $('#svcUrl').value.trim().replace(/\/+$/, ''); await LT.saveSettings(S.ctx, { serviceUrl: url }); S.settings.serviceUrl = url; toast('Saved', 'good'); }); break;
      case 'svc-test': {
        const msg = $('#svcMsg'); msg.textContent = 'Testing…';
        try { const r = await AI.ping(Object.assign({}, S.settings, { serviceUrl: $('#svcUrl').value.trim() })); msg.textContent = `✔ Connected · model ${r.model}`; } catch (err) { msg.textContent = `✖ ${err.message}. Polish will use the offline tidy until the service is deployed.`; }
        break;
      }
      default: break;
    }
  }
  function onInput(e) {
    const el = e.target;
    if (el.dataset.f && S.cur && S.view === 'editor') { onFieldInput(el); return; }
    if (el.dataset.filter) { S.filter[el.dataset.filter] = el.value; if (el.dataset.filter === 'q') { clearTimeout(S.qTimer); S.qTimer = setTimeout(() => { renderHome(); const i = $('[data-filter="q"]'); if (i) { i.focus(); i.setSelectionRange(i.value.length, i.value.length); } }, 250); } return; }
    if (el.dataset.actInput === 'pick-q') { S.pickerQ = el.value; clearTimeout(S.qTimer); S.qTimer = setTimeout(renderPicker, 200); return; }
    if (el.dataset.h && S.headDraft) { S.headDraft[el.dataset.h] = el.value; if (el.dataset.h === 'kind') { S.settings.letterheads[S.headDraft.id] = clone(S.headDraft); renderSettings(); } else headPreview(); }
  }
  async function onChange(e) {
    const el = e.target;
    if (el.dataset.filter && el.tagName === 'SELECT') { S.filter[el.dataset.filter] = el.value; renderHome(); return; }
    if (el.dataset.add !== undefined) { toggleAddition(Number(el.dataset.add), el.checked); return; }
    if (el.dataset.f && el.tagName === 'SELECT' && S.cur) return; // handled by input
    const up = el.dataset.upload;
    if (!up || !el.files || !el.files[0]) return;
    const file = el.files[0];
    if (up === 'signature') { const url = await guard(() => processImage(file, { maxW: 900, maxH: 320, removeWhite: true })); if (url) saveSignature(url); return; }
    if (up === 'head-logo') { const url = await guard(() => processImage(file, { maxW: 360, maxH: 360 })); if (url) { S.headDraft.logo = url; delete S.headDraft.logoIsDefault; headPreview(); toast('Logo ready — press Save letterhead', 'info'); } return; }
    if (up === 'head-image') { const url = await guard(() => processImage(file, { maxW: 1800, maxH: 500, jpeg: !/png/i.test(file.type) })); if (url) { S.headDraft.image = url; headPreview(); toast('Header ready — press Save letterhead', 'info'); } }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})(window);
