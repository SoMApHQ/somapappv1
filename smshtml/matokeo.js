/*
 * SoMAp Mawasiliano — Matokeo (exam results to parents with a secure report link).
 *
 * The report card a parent opens is the EXACT A4 PDF that
 * Toacademichtml/generatereportform.html draws with its own drawReportCard()
 * (the same file as its "Download PDF"), made in a hidden frame through
 * smshtml/report-bridge.js. Nothing is redesigned, removed or added.
 *
 * Phones: the same roster + contact rule as the Student List (SomapYearRoster).
 * Links:  one random key per child + exam; the PDF is stored by the SMS Worker in
 *         D1 (never Firebase) for 60 days: somapv2i.com/r/?k=KEY
 */
(function () {
  'use strict';
  const core = window.SomapSmsCore;
  const snap = window.SomapReportSnapshot;
  const svc = window.SomapSms.create();
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s === null || s === undefined ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fmt = (n) => core.formatNumber(n);
  const SAMPLE_KEY = 'XXXXXXXXXXXXXX';

  const state = {
    schoolId: '', me: null, engine: null, rosterYear: '', roster: null,
    results: [], noResults: [], classErrors: [], exam: null, families: [], unreachable: [],
    checked: new Map(), sending: false, lastReport: null,
  };

  function fatal(msg) { $('fatal').textContent = msg; $('fatal').hidden = false; }

  // ------------------------------------------------------------------ boot + gate
  async function boot() {
    if (window.SOMAP && SOMAP.adoptSchoolFromUrl) SOMAP.adoptSchoolFromUrl('school');
    state.schoolId = window.SOMAP && SOMAP.getSchoolId ? SOMAP.getSchoolId() : '';
    if (!state.schoolId) { fatal('Chagua shule kwanza: fungua SoMAp na uchague shule yako.'); return; }
    let me;
    try { me = await svc.me(state.schoolId); } catch (err) { fatal('Imeshindwa kuunganisha na mfumo wa SMS: ' + (err.message || err)); return; }
    state.me = me;
    $('schoolName').textContent = me.schoolName || state.schoolId;
    // Same gate as Mawasiliano: nothing (no results, no phones) loads for anyone else.
    const roleOk = Boolean(me.belongs && Array.isArray(me.allowedRoles) && me.allowedRoles.includes(me.role));
    if (!roleOk) { fatal(`Huna ruhusa ya kutuma matokeo kwa ${me.schoolName || 'shule hii'}.`); return; }
    showMode();
    $('app').hidden = false;
    fillYears();
    wire();
    try {
      state.engine = await loadEngine();
      fillExamControls();
      $('engineStatus').className = 'alert ok';
      $('engineStatus').textContent = 'Tayari: ripoti ni ileile ya Report Form (PDF ileile ya "Download PDF").';
      $('prepare').disabled = false;
    } catch (err) {
      $('engineStatus').className = 'alert bad';
      $('engineStatus').textContent = 'Imeshindwa kuandaa Report Form: ' + (err.message || err);
    }
  }

  function showMode() {
    const m = state.me;
    $('banner').className = 'banner ' + m.mode;
    $('banner').textContent = m.mode === 'live' ? 'LIVE: SMS HALISI zitatumwa kwa wazazi.' : `${String(m.mode).toUpperCase()}: hakuna SMS halisi.`;
    $('banner').hidden = false;
    $('walletPill').textContent = `Salio: ${fmt(m.wallet ? m.wallet.balance : 0)} SMS`;
  }

  function fillYears() {
    const now = new Date().getFullYear();
    const selected = String((window.somapYearContext && somapYearContext.getSelectedYear && somapYearContext.getSelectedYear()) || now);
    const years = [];
    for (let y = 2025; y <= now + 1; y++) years.push(String(y));
    if (!years.includes(selected)) years.push(selected);
    $('year').innerHTML = years.map((y) => `<option${y === selected ? ' selected' : ''}>${y}</option>`).join('');
  }

  // ------------------------------------------------------------------ report page (hidden frame)
  function loadEngine() {
    return new Promise((resolve, reject) => {
      const frame = document.createElement('iframe');
      frame.title = 'report-engine';
      frame.setAttribute('aria-hidden', 'true');
      frame.tabIndex = -1;
      Object.assign(frame.style, { position: 'fixed', left: '-10000px', top: '0', width: '1280px', height: '900px', opacity: '0', pointerEvents: 'none', border: '0' });
      let done = false;
      const finish = (fn, v) => { if (!done) { done = true; clearTimeout(timer); fn(v); } };
      const timer = setTimeout(() => finish(reject, new Error('Report Form haikupakia ndani ya dakika 1.')), 60000);
      frame.onload = () => {
        if (done) return;
        try {
          const win = frame.contentWindow;
          const doc = frame.contentDocument;
          if (!doc || !/generatereportform\.html$/.test(win.location.pathname)) throw new Error('Report Form ilielekeza ukurasa mwingine (huenda login).');
          const sc = doc.createElement('script');
          sc.src = new URL('report-bridge.js', window.location.href).href;
          sc.onload = () => win.SomapReportBridge.ready().then(() => finish(resolve, win.SomapReportBridge), (e) => finish(reject, e));
          sc.onerror = () => finish(reject, new Error('report-bridge.js haikupakia.'));
          doc.body.appendChild(sc);
        } catch (err) { finish(reject, err); }
      };
      frame.src = '../Toacademichtml/generatereportform.html';
      document.body.appendChild(frame);
    });
  }

  function fillExamControls() {
    const exams = state.engine.exams();
    $('exam').innerHTML = exams.map((e) => `<option value="${esc(e.key)}" data-label="${esc(e.label)}">${esc(e.label)}</option>`).join('');
    $('exam').disabled = false;
    const months = state.engine.months().length ? state.engine.months() : snap.MONTHS;
    const nowMonth = snap.MONTHS[new Date().getMonth()];
    $('month').innerHTML = months.map((m) => `<option value="${esc(m)}"${m === nowMonth ? ' selected' : ''}>${esc(snap.MONTHS_SW[snap.MONTHS.indexOf(m)] || m)}</option>`).join('');
    $('classSel').innerHTML = state.engine.classes().map((c) => `<option>${esc(c)}</option>`).join('');
    toggleMonth();
  }

  function toggleMonth() { $('monthBox').hidden = $('exam').value === 'annual'; }

  async function ensureRoster(year) {
    if (state.roster && state.rosterYear === year) return state.roster;
    const rows = await window.SomapYearRoster.getYearRoster(year);
    const map = new Map();
    rows.forEach((r) => { [r.id, r.studentId, r.admissionNumber].filter(Boolean).forEach((k) => map.set(String(k), r)); });
    state.roster = map;
    state.rosterRows = rows;
    state.rosterYear = year;
    return map;
  }

  // ------------------------------------------------------------------ prepare
  async function prepare(opts) {
    const o = opts && opts.classes ? opts : {};
    const year = $('year').value;
    const opt = $('exam').selectedOptions[0];
    const examLabel = opt ? opt.dataset.label : 'Monthly';
    const month = $('exam').value === 'annual' ? '' : $('month').value;
    const scope = $('scope').value;
    const classes = o.classes || (scope === 'all' ? state.engine.classes() : [$('classSel').value]);
    const only = o.onlyAdms ? new Set(o.onlyAdms.map(String)) : null;
    state.results = []; state.noResults = []; state.classErrors = []; state.checked = new Map(); state.exam = null;
    $('noResultsMsg').hidden = true;
    $('listSearch').value = '';
    $('prepare').disabled = true;
    $('progressBox').hidden = false;
    $('resultCard').hidden = true; $('sendCard').hidden = true; $('sendResult').innerHTML = '';
    try {
      const roster = await ensureRoster(year);
      for (let i = 0; i < classes.length; i++) {
        $('progressBar').style.width = `${Math.round((i / classes.length) * 100)}%`;
        $('progressText').textContent = `Inasoma ${classes[i]} (${i + 1}/${classes.length})…`;
        const req = { year, className: classes[i], examLabel, month };
        let out;
        try { out = await state.engine.compute(req); } catch (err) { state.classErrors.push(`${classes[i]}: ${err.message || err}`); continue; }
        if (!state.exam) state.exam = { key: out.examKey, label: out.examLabel, month: out.examKey === 'annual' ? '' : out.month, year: out.year };
        out.students.forEach((s) => {
          if (only && !only.has(String(s.adm)) && !only.has(String(s.admissionNo))) return;
          const r = roster.get(String(s.adm)) || roster.get(String(s.admissionNo));
          const primary = core.normalizeTzPhone(r ? r.parentContact : s.parentContact);
          const all = Array.from(new Set([primary.msisdn, ...(r && r.rawStudent ? snap.allParentPhones(r.rawStudent) : [])].filter(Boolean)));
          const entry = { s, req, className: out.className, primary: primary.msisdn, all };
          (s.hasResults ? state.results : state.noResults).push(entry);
        });
      }
      $('progressBar').style.width = '100%';
      $('progressText').textContent = `Imekamilika: wanafunzi ${state.results.length} wana matokeo.`;
      if (!state.results.length) await explainNoResults(classes, { year, examLabel, month, examKey: $('exam').value });
      render();
    } catch (err) {
      $('progressText').textContent = 'Hitilafu: ' + (err.message || err);
    } finally {
      $('prepare').disabled = false;
    }
  }

  const monthSw = (m) => snap.MONTHS_SW[snap.MONTHS.indexOf(m)] || m;

  /** "Hakuna matokeo ya Monthly Novemba kwa Class 4. Chagua mwezi mwingine." + months/exams that DO have results. */
  async function explainNoResults(classes, x) {
    const what = x.examKey === 'monthly' ? `${x.examLabel} ${monthSw(x.month)}` : `${x.examLabel} ${x.year}`;
    const box = $('noResultsMsg');
    box.hidden = false;
    if (classes.length !== 1) {
      box.innerHTML = `<b>Hakuna matokeo ya ${esc(what)}</b> kwa madarasa uliyochagua. Chagua mwezi au mtihani mwingine.`;
      return;
    }
    const cls = classes[0];
    box.innerHTML = `<b>Hakuna matokeo ya ${esc(what)} kwa ${esc(cls)}.</b> ${x.examKey === 'monthly' ? 'Chagua mwezi mwingine.' : 'Chagua mtihani mwingine.'}<div class="small" id="availText">Inatafuta miezi na mitihani yenye matokeo…</div>`;
    let av = { months: [], exams: [] };
    try { av = await state.engine.availability({ year: x.year, className: cls }); } catch (_) { /* keep empty */ }
    const chips = [
      ...av.months.map((m) => `<button type="button" class="chip" data-exam="monthly" data-month="${esc(m)}">Monthly ${esc(monthSw(m))}</button>`),
      ...av.exams.map((l) => `<button type="button" class="chip" data-label="${esc(l)}">${esc(l)}</button>`),
      ...((av.months.length || av.exams.length) ? ['<button type="button" class="chip" data-exam="annual">Annual</button>'] : []),
    ];
    $('availText').innerHTML = chips.length
      ? `Yenye matokeo kwa ${esc(cls)} (${esc(x.year)}): ${chips.join('')}`
      : `Bado hakuna matokeo yoyote ya ${esc(x.year)} kwa ${esc(cls)}.`;
    $('availText').querySelectorAll('.chip').forEach((b) => {
      b.onclick = () => {
        const sel = $('exam');
        if (b.dataset.label) { const o = Array.from(sel.options).find((op) => op.dataset.label === b.dataset.label); if (o) sel.value = o.value; }
        else sel.value = b.dataset.exam;
        if (b.dataset.month) $('month').value = b.dataset.month;
        toggleMonth();
        prepare(state.lastPrepareOpts || undefined);
      };
    });
  }

  // "Mzazi mmoja": search ALL classes of the year; picking loads that child + siblings only.
  let searchTimer = null;
  async function searchOne() {
    const q = $('oneSearch').value.trim().toLowerCase();
    const digits = q.replace(/\D/g, '');
    if (q.length < 2) { $('oneResults').innerHTML = '<div class="small muted">Andika angalau herufi 2…</div>'; return; }
    await ensureRoster($('year').value);
    const rows = (state.rosterRows || []).filter((r) => {
      const phone = core.normalizeTzPhone(r.parentContact).local || '';
      return String(r.fullName || '').toLowerCase().includes(q) || String(r.admissionNumber || '').toLowerCase().includes(q)
        || (digits.length >= 4 && phone.replace(/\D/g, '').includes(digits.replace(/^255/, '0')));
    }).sort((a, b) => String(a.fullName).localeCompare(String(b.fullName))).slice(0, 40);
    $('oneResults').innerHTML = rows.length ? rows.map((r, i) => `<button type="button" class="pick" data-i="${i}"><b>${esc(r.fullName)}</b> <span>(${esc(r.classLevel || r.className || '')} • ${esc(r.admissionNumber || '')} • ${esc(core.normalizeTzPhone(r.parentContact).local || 'hakuna namba')})</span></button>`).join('')
      : '<div class="small muted">Hakuna mtoto anayelingana.</div>';
    $('oneResults').querySelectorAll('.pick').forEach((b) => { b.onclick = () => pickChild(rows[Number(b.dataset.i)]); });
  }

  async function pickChild(row) {
    const p = core.normalizeTzPhone(row.parentContact).msisdn;
    const family = p ? (state.rosterRows || []).filter((r) => core.normalizeTzPhone(r.parentContact).msisdn === p) : [row];
    const order = state.engine.classes();
    const classes = Array.from(new Set(family.map((r) => r.classLevel || r.className).filter(Boolean)))
      .sort((a, b) => (order.indexOf(a) + 1 || 99) - (order.indexOf(b) + 1 || 99));
    const onlyAdms = family.flatMap((r) => [r.id, r.studentId, r.admissionNumber]).filter(Boolean);
    $('oneResults').innerHTML = `<div class="alert ok">Umechagua: <b>${esc(row.fullName)}</b> (${esc(row.classLevel || '')})${family.length > 1 ? ` + ndugu ${family.length - 1}: ${family.filter((r) => r !== row).map((r) => esc(r.fullName) + ' (' + esc(r.classLevel || '') + ')').join(', ')}` : ''}</div>`;
    state.lastPrepareOpts = { classes, onlyAdms };
    await prepare(state.lastPrepareOpts);
  }

  // ------------------------------------------------------------------ families + messages
  function schoolForSms() {
    const s = state.me && state.me.sender;
    return (s && Array.isArray(s.schoolPrefixes) && s.schoolPrefixes[0]) || state.me.schoolName || '';
  }
  const childForSms = (c, key, card) => ({ name: c.s.name, avgText: (card || c.s.card).avgText, posLabel: (card || c.s.card).posLabel, key });

  function buildFamilies() {
    const list = state.results;
    const byPhone = new Map();
    state.unreachable = [];
    list.forEach((e) => {
      if (!e.primary) { state.unreachable.push(e); return; }
      if (!byPhone.has(e.primary)) byPhone.set(e.primary, { key: e.primary, children: [], phones: new Set() });
      const f = byPhone.get(e.primary);
      f.children.push(e);
      (e.all.length ? e.all : [e.primary]).forEach((p) => f.phones.add(p));
    });
    const title = snap.examTitle(state.exam || {});
    const school = schoolForSms();
    const short = $('shortNames').checked;
    const useAll = $('allNumbers').checked;
    state.families = Array.from(byPhone.values()).map((f) => {
      const phones = useAll ? Array.from(f.phones) : [f.key];
      const text = core.cleanText(snap.resultsSms({ school, examTitle: title, shortNames: short, children: f.children.map((c) => childForSms(c, SAMPLE_KEY)) }));
      if (!state.checked.has(f.key)) state.checked.set(f.key, true);
      return { ...f, phonesToSend: phones, extraPhones: f.phones.size - 1, sampleText: text, parts: core.countSmsParts(text).parts };
    });
  }

  const local = (m) => { const p = core.normalizeTzPhone(m); return p.local || m; };

  function render() {
    buildFamilies();
    $('resultCard').hidden = false;
    $('sendCard').hidden = false;
    const q = $('listSearch').value.trim().toLowerCase();
    const qd = q.replace(/\D/g, '');
    const visible = state.families.filter((f) => !q || f.children.some((c) => String(c.s.name || '').toLowerCase().includes(q)
      || String(c.s.adm || '').toLowerCase().includes(q) || String(c.s.admissionNo || '').toLowerCase().includes(q) || String(c.className || '').toLowerCase().includes(q))
      || (qd.length >= 4 && f.phonesToSend.some((p) => (core.normalizeTzPhone(p).local || '').includes(qd))));
    $('listCount').textContent = q ? `Inaonyesha ${visible.length} kati ya familia ${state.families.length}` : `Familia ${state.families.length}`;
    $('families').innerHTML = visible.length ? visible.map((f) => {
      const on = state.checked.get(f.key);
      const kids = f.children.map((c) => `${esc(c.s.name)} <span class="muted small">(${esc(c.className)}) ${esc(c.s.card.avgText)} • ${esc(c.s.card.posLabel)}</span>`).join('<br>');
      const phones = f.phonesToSend.map((p) => `<span class="mono">${esc(local(p))}</span>`).join('<br>')
        + (!$('allNumbers').checked && f.extraPhones > 0 ? `<div class="small muted">+${f.extraPhones} namba nyingine</div>` : '');
      return `<tr class="${on ? '' : 'off'}"><td><input type="checkbox" data-key="${esc(f.key)}" ${on ? 'checked' : ''} style="width:auto"></td>
        <td>${kids}</td><td>${phones}</td><td><span class="badge ${f.parts > 2 ? 'bad' : f.parts > 1 ? 'warn' : 'ok'}">SMS ${f.parts}${f.phonesToSend.length > 1 ? ' × ' + f.phonesToSend.length : ''}</span></td></tr>`;
    }).join('') : `<tr><td colspan="4" class="muted">${q && state.families.length ? 'Hakuna anayelingana na utafutaji.' : 'Hakuna mzazi wa kutumiwa.'}</td></tr>`;
    $('families').querySelectorAll('input[type=checkbox]').forEach((cb) => { cb.onchange = () => { state.checked.set(cb.dataset.key, cb.checked); render(); }; });

    const extraPhonesTotal = state.families.reduce((s, f) => s + Math.max(0, f.extraPhones), 0);
    const extraCost = state.families.filter((f) => state.checked.get(f.key)).reduce((s, f) => s + Math.max(0, f.extraPhones) * f.parts, 0);
    $('extraInfo').textContent = extraPhonesTotal
      ? `Familia zenye namba zaidi ya moja: ${state.families.filter((f) => f.extraPhones > 0).length} (namba za ziada ${extraPhonesTotal}). ${$('allNumbers').checked ? 'Zimewekwa: +' : 'Ukiweka tiki, gharama ya ziada: +'}${fmt(extraCost)} SMS.`
      : 'Hakuna mzazi mwenye namba zaidi ya moja kwenye orodha hii.';

    const skipped = [...state.noResults.map((e) => `${e.s.name} (${e.className}): hana alama`), ...state.unreachable.map((e) => `${e.s.name} (${e.className}): hakuna namba sahihi`), ...state.classErrors];
    $('noResultsBox').hidden = !skipped.length;
    $('noResultsSummary').textContent = `Hawatatumiwa: ${skipped.length}`;
    $('noResultsList').innerHTML = skipped.map(esc).join('<br>');

    const chosen = state.families.filter((f) => state.checked.get(f.key));
    $('previews').innerHTML = chosen.slice(0, 3).map((f) => `<div class="preview"><div class="meta">${f.phonesToSend.map(local).join(', ')} • SMS ${f.parts}</div>${esc(f.sampleText)}</div>`).join('') || '<span class="muted">—</span>';

    const units = chosen.reduce((s, f) => s + f.parts * f.phonesToSend.length, 0);
    const messages = chosen.reduce((s, f) => s + f.phonesToSend.length, 0);
    const balance = state.me.wallet ? Number(state.me.wallet.balance) : 0;
    const stat = (l, v, cls) => `<div class="stat ${cls || ''}"><div class="v">${esc(v)}</div><div class="l">${esc(l)}</div></div>`;
    $('summary').innerHTML = [
      stat('Familia', fmt(chosen.length), 'ok'),
      stat('Ripoti (watoto)', fmt(chosen.reduce((s, f) => s + f.children.length, 0))),
      stat('Ujumbe (namba)', fmt(messages)),
      stat('SMS zinazohitajika', fmt(units), units > balance ? 'bad' : ''),
      stat('Salio', fmt(balance), units > balance ? 'bad' : ''),
    ].join('');
    const over2 = chosen.filter((f) => f.parts > 2).length;
    $('warnBox').innerHTML = [
      over2 ? `<div class="alert warn">Familia ${over2} zina ujumbe wa zaidi ya SMS 2 (watoto wengi). Fikiria "Majina ya kwanza tu" au tuma darasa moja moja.</div>` : '',
      units > balance ? '<div class="alert bad">Salio halitoshi. Wasiliana na SoMAp kununua SMS.</div>' : '',
    ].join('');
    $('sendBtn').disabled = state.sending || !chosen.length || units > balance || !state.me.canSend;
    $('sendHint').textContent = !state.me.canSend ? 'Shule haina jina la mtumaji linalotumika.' : 'Kila mtoto: ripoti ileile ya Report Form (PDF), siku 60.';
  }

  /** The report page's own Download PDF for this child -> stored by the Worker -> its link key. */
  async function storeCard(c) {
    const pdf = await state.engine.cardPdf(c.req, c.s.adm);
    const r = await svc.createReport(state.schoolId, state.exam, c.s.adm, pdf.filename, pdf.bytes);
    return { key: r.key, bytes: pdf.bytes.length, card: pdf.card, warnings: pdf.warnings || [] };
  }

  /**
   * Check before sending: for ONE child per class, the link PDF must equal a fresh press of the
   * report page's own Download PDF (same pages, text, images, file name). Throws if any class differs.
   */
  async function checkIdentical(kids, onStep) {
    const firstPerClass = [];
    const seen = new Set();
    kids.forEach((c) => { if (!seen.has(c.req.className)) { seen.add(c.req.className); firstPerClass.push(c); } });
    const lines = [];
    for (let i = 0; i < firstPerClass.length; i++) {
      const c = firstPerClass[i];
      if (onStep) onStep(i, firstPerClass.length, c);
      const v = await state.engine.verify(c.req, c.s.adm);
      if (!v.same) throw new Error(`Ukaguzi umeshindwa (${c.req.className}, ${c.s.name}): ${v.reason}. Hakuna kilichotumwa.`);
      lines.push(`${c.req.className}: sawa kabisa (kurasa ${v.pages}, picha ${v.images}, ${v.filename})${v.warnings.length ? ' • ' + v.warnings.join(', ') : ''}`);
    }
    return lines;
  }

  async function storeAll(kids, barShare) {
    const keys = {};
    const cards = {};
    const warnings = [];
    let bytes = 0;
    for (let i = 0; i < kids.length; i++) {
      $('sendText').textContent = `Inaandaa ripoti ${i + 1}/${kids.length} (${(bytes / 1048576).toFixed(1)} MB)…`;
      $('sendBar').style.width = `${Math.round((i / kids.length) * barShare)}%`;
      const st = await storeCard(kids[i]);
      keys[kids[i].s.adm] = st.key;
      cards[kids[i].s.adm] = st.card;
      st.warnings.forEach((w) => warnings.push(`${kids[i].s.name}: ${w}`));
      bytes += st.bytes;
    }
    if (warnings.length) $('sendResult').innerHTML += `<div class="alert warn">Picha ambazo hazikupakia hata baada ya kujaribu mara 3 (ripoti ni sawa na Download PDF ya Report Form):<br>${warnings.map(esc).join('<br>')}</div>`;
    return { keys, cards, bytes };
  }

  /** Re-store the exact PDFs behind links already sent (same child + exam = same link). No SMS. */
  async function updateOnly() {
    const chosen = state.families.filter((f) => state.checked.get(f.key));
    const kids = chosen.flatMap((f) => f.children).sort((a, b) => String(a.req.className).localeCompare(String(b.req.className)));
    if (!kids.length) return;
    if (!confirm(`Sasisha ripoti ${kids.length} nyuma ya viungo vilivyokwisha kutumwa?\nHakuna SMS itakayotumwa.`)) return;
    state.sending = true;
    $('sendBtn').disabled = true; $('updateOnly').disabled = true;
    $('sendProgress').hidden = false;
    $('sendResult').innerHTML = '';
    try {
      const checked = await checkIdentical(kids, (i, n, c) => { $('sendText').textContent = `Ukaguzi: ${c.req.className} (${i + 1}/${n})…`; });
      $('sendResult').innerHTML = `<div class="alert ok">Ukaguzi umepita:<br>${checked.map(esc).join('<br>')}</div>`;
      const stored = await storeAll(kids, 100);
      $('sendBar').style.width = '100%';
      $('sendResult').innerHTML += `<div class="alert ok">Ripoti ${kids.length} zimesasishwa (${(stored.bytes / 1048576).toFixed(1)} MB). Viungo vilevile sasa vinaonyesha ripoti mpya. Hakuna SMS iliyotumwa.</div>`;
    } catch (err) {
      $('sendResult').innerHTML += `<div class="alert bad">${esc(err.message || err)}</div>`;
    } finally {
      state.sending = false;
      $('updateOnly').disabled = false;
      render();
    }
  }

  // ------------------------------------------------------------------ send
  async function send(retryMessages) {
    const chosen = state.families.filter((f) => state.checked.get(f.key));
    const title = snap.examTitle(state.exam || {});
    let messages = retryMessages;
    if (!messages) {
      const units = chosen.reduce((s, f) => s + f.parts * f.phonesToSend.length, 0);
      if (!confirm(`Tuma matokeo (${title})?\n\nFamilia: ${chosen.length}\nUjumbe: ${chosen.reduce((s, f) => s + f.phonesToSend.length, 0)}\nSMS: ${units}\nHali: ${state.me.mode}\n\nKila mtoto atapata kiungo cha ripoti yake (siku 60).`)) return;
    }
    state.sending = true;
    $('sendBtn').disabled = true;
    $('sendProgress').hidden = false;
    $('sendResult').innerHTML = '';
    try {
      if (!messages) {
        // 1) Each child's exact report card PDF, stored once; same child + exam keeps its link.
        const kids = chosen.flatMap((f) => f.children).sort((a, b) => String(a.req.className).localeCompare(String(b.req.className)));
        const checked = await checkIdentical(kids, (i, n, c) => { $('sendText').textContent = `Ukaguzi: PDF ya kiungo = Download PDF ya Report Form? ${c.req.className} (${i + 1}/${n})…`; });
        $('sendResult').innerHTML = `<div class="alert ok">Ukaguzi umepita:<br>${checked.map(esc).join('<br>')}</div>`;
        const stored = await storeAll(kids, 60);
        const keys = stored.keys;
        const cards = stored.cards;
        // 2) One SMS per parent (siblings together), to every chosen number, same links.
        messages = [];
        const school = schoolForSms();
        chosen.forEach((f) => {
          const text = core.cleanText(snap.resultsSms({ school, examTitle: title, shortNames: $('shortNames').checked, children: f.children.map((c) => childForSms(c, keys[c.s.adm], cards[c.s.adm])) }));
          f.phonesToSend.forEach((p) => messages.push({ phone: '+' + p, text, ref: f.children.map((c) => c.s.adm).join(',').slice(0, 120) }));
        });
      }
      const report = await svc.sendAll({
        schoolId: state.schoolId, purpose: 'results', name: `Matokeo • ${title}${retryMessages ? ' (jaribio jingine)' : ''}`, messages,
        onProgress: (p) => {
          $('sendBar').style.width = `${60 + Math.round((p.done / Math.max(1, p.total)) * 40)}%`;
          $('sendText').textContent = `SMS ${p.done}/${p.total} • zimetumwa ${p.sent} • zimeshindwa ${p.failed}`;
        },
      });
      state.lastReport = report;
      $('sendResult').innerHTML += `<div class="alert ${report.stoppedBy ? 'bad' : 'ok'}">${report.stoppedBy ? 'Ilisimama: ' + esc(report.stoppedBy.message || report.stoppedBy.code) + '<br>' : ''}Zimetumwa ${report.sent}, zimeshindwa ${report.failed}, zimekataliwa ${report.rejected}, hazikutumwa ${report.notSent}. SMS ${report.unitsUsed}.</div>`;
      $('retryBtn').hidden = !svc.retryable(report).length;
      $('csvBtn').hidden = false;
    } catch (err) {
      $('sendResult').innerHTML = `<div class="alert bad">${esc(err.message || err)}</div>`;
    } finally {
      state.sending = false;
      try { state.me = await svc.me(state.schoolId); showMode(); } catch (_) { /* keep */ }
      render();
    }
  }

  // ------------------------------------------------------------------ wiring
  function wire() {
    $('exam').onchange = toggleMonth;
    const scopeUi = () => {
      const sc = $('scope').value;
      $('classBox').hidden = sc !== 'class';
      $('oneBox').hidden = sc !== 'one';
      $('prepare').hidden = sc === 'one';
      if (sc === 'one') { $('oneSearch').value = ''; $('oneResults').innerHTML = '<div class="small muted">Andika jina, namba ya usajili au simu…</div>'; $('oneSearch').focus(); }
    };
    $('scope').onchange = scopeUi;
    $('prepare').onclick = () => { state.lastPrepareOpts = null; prepare(); };
    $('oneSearch').oninput = () => { clearTimeout(searchTimer); searchTimer = setTimeout(searchOne, 200); };
    $('listSearch').oninput = () => render();
    $('year').addEventListener('change', () => { state.roster = null; if ($('scope').value === 'one') searchOne(); });
    $('shortNames').onchange = render;
    $('allNumbers').onchange = render;
    $('sendBtn').onclick = () => send();
    $('updateOnly').onclick = updateOnly;
    // Test without SMS: store the FIRST chosen child's exact report card and open its public link.
    $('samplePreview').onclick = async () => {
      const f = state.families.find((x) => state.checked.get(x.key));
      if (!f) return;
      const win = window.open('about:blank', '_blank');
      try {
        const v = await state.engine.verify(f.children[0].req, f.children[0].s.adm);
        if (!v.same) throw new Error(`Ukaguzi umeshindwa: ${v.reason}`);
        const stored = await storeCard(f.children[0]);
        if (win) win.location.href = '../r/?k=' + encodeURIComponent(stored.key);
      } catch (err) { if (win) win.close(); alert(err.message || err); }
    };
    $('retryBtn').onclick = () => { if (state.lastReport) send(svc.retryable(state.lastReport)); };
    $('csvBtn').onclick = () => { if (state.lastReport) SomapSms.downloadText(`matokeo-${state.schoolId}-${Date.now()}.csv`, SomapSms.reportCsv(state.lastReport)); };
    window.addEventListener('beforeunload', (e) => { if (state.sending) { e.preventDefault(); e.returnValue = ''; } });
  }

  $('login').onclick = () => firebase.auth().signInWithPopup(new firebase.auth.GoogleAuthProvider()).catch((e) => fatal('Login imeshindwa: ' + e.message));
  let booted = false;
  firebase.auth().onAuthStateChanged((user) => {
    $('loginBox').hidden = Boolean(user);
    if (user && !booted) { booted = true; boot(); }
  });
})();
