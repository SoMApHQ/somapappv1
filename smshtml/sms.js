/*
 * SoMAp Mawasiliano (SMS kwa wazazi) — page logic.
 *
 * Reads (never writes) learners with the same roster + contact rule as the Student
 * List, or receives the fee-debtor list handed over by finance.html (the exact rows
 * of its "SMS Debt Excel"). Builds ONE message per parent phone (fee reminders
 * combine all children), refuses any message with an unfilled {placeholder}, and
 * sends through the SoMAp SMS Worker via SomapSms (smshtml/sms-service.js).
 */
(function () {
  'use strict';
  const core = window.SomapSmsCore;
  const svc = window.SomapSms.create();
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s === null || s === undefined ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const HANDOFF_KEY = 'somap.sms.handoff.v1';
  const HANDOFF_MAX_AGE_MS = 30 * 60 * 1000;

  const PURPOSE_SW = { general: 'Ujumbe wa kawaida', fee_reminder: 'Kikumbusho cha ada', invitation: 'Mwaliko', other: 'Mengineyo' };
  const SOURCE_SW = { all: 'Wazazi wote', class: 'Darasa', debtors: 'Wadaiwa', picked: 'Waliochaguliwa' };
  const BUILT_IN = [
    { id: 'builtin-general', builtIn: true, purpose: 'general', name: 'Taarifa ya kawaida', body: '{school}: Ndugu mzazi wa {studentName}, tunapenda kukujulisha kwamba ' },
    { id: 'builtin-fee', builtIn: true, purpose: 'fee_reminder', name: 'Kikumbusho cha ada', body: '{school}: Mzazi, ada inayodaiwa: {children}. Jumla TSh {total}. Tafadhali lipa kabla ya {date}. Asante.' },
    { id: 'builtin-invite', builtIn: true, purpose: 'invitation', name: 'Mwaliko wa kikao', body: '{school}: Mzazi wa {studentName}, unakaribishwa kwenye kikao cha wazazi tarehe {date} saa {time}, {venue}. Karibu.' },
  ];
  const PLACEHOLDER_HELP = {
    parentName: 'jina la mzazi', studentName: 'jina la mwanafunzi (au "A na B")', class: 'darasa', children: 'watoto + deni la kila mmoja',
    debt: 'deni la sasa (jumla)', total: 'jumla ya deni', balance: 'salio la mwaka', date: 'tarehe', time: 'saa', venue: 'mahali', school: 'jina la shule',
  };

  const state = {
    schoolId: '', me: null, year: '',
    purpose: '', source: '', classFilter: '', search: '',
    roster: null, rosterYear: '', debtors: null, debtorsMeta: null,
    groups: [], unreachable: [], checked: new Map(),
    templates: [], editingTemplateId: '',
    sending: false, lastReport: null, historyDetail: null,
  };

  // ------------------------------------------------------------------ boot
  function fatal(msg) { $('fatal').textContent = msg; $('fatal').hidden = false; }

  function readHandoff() {
    let data = null;
    try { data = JSON.parse(localStorage.getItem(HANDOFF_KEY) || 'null'); } catch (_) { data = null; }
    try { localStorage.removeItem(HANDOFF_KEY); } catch (_) { /* ignore */ }
    if (!data || !Array.isArray(data.rows)) return null;
    if (data.schoolId !== state.schoolId) return null;
    if (!(Date.now() - Number(data.createdAt || 0) < HANDOFF_MAX_AGE_MS)) return null;
    return data;
  }

  async function boot() {
    if (window.SOMAP && SOMAP.adoptSchoolFromUrl) SOMAP.adoptSchoolFromUrl('school');
    state.schoolId = window.SOMAP && SOMAP.getSchoolId ? SOMAP.getSchoolId() : '';
    if (!state.schoolId) { fatal('Chagua shule kwanza: fungua SoMAp na uchague shule yako.'); return; }
    let me;
    try {
      me = await svc.me(state.schoolId);
    } catch (err) {
      fatal('Imeshindwa kuunganisha na mfumo wa SMS: ' + (err.message || err));
      return;
    }
    state.me = me;
    $('schoolName').textContent = me.schoolName || state.schoolId;
    if (!me.belongs) { fatal('Akaunti hii haijasajiliwa kama mfanyakazi wa shule hii, hivyo haiwezi kutumia Mawasiliano.'); return; }
    showMode();
    $('tabs').hidden = false;
    $('panel-send').hidden = false;
    $('fSchool').value = me.schoolName || '';
    if (!me.canSend) {
      const why = !me.allowedRoles.includes(me.role)
        ? `Nafasi yako (${me.role || 'haijulikani'}) inaweza kuangalia tu. Wanaoruhusiwa kutuma: ${me.allowedRoles.join(', ')}.`
        : 'Shule bado haina jina la mtumaji (Sender ID) lililoidhinishwa, hivyo haiwezi kutuma kwa wazazi bado.';
      $('cantSend').textContent = why;
      $('cantSend').hidden = false;
    }

    const handoff = readHandoff();
    if (handoff) {
      state.debtors = handoff.rows.map((r) => ({
        phone: r.parentContact, parentName: r.parentName || '', studentName: r.fullName, className: r.classLevel,
        admissionNumber: r.admissionNumber, debt: Number(r.debt) || 0, balance: Number(r.balance) || 0, debtLabel: r.debtLabel || '',
      }));
      state.debtorsMeta = { year: handoff.year, count: handoff.rows.length, filter: handoff.filter || '' };
    }

    fillYears();
    wire();
    await loadTemplates();
    setPurpose(state.debtors ? 'fee_reminder' : 'general');
  }

  function showMode() {
    const m = state.me;
    const b = $('banner');
    const text = { dryrun: 'DRY-RUN: hakuna SMS inayotumwa kweli (majaribio).', sandbox: 'SANDBOX: majaribio ya mtoa huduma, hakuna SMS halisi.', live: 'LIVE: SMS HALISI zitatumwa kwa wazazi.' }[m.mode] || m.mode;
    b.textContent = text;
    b.className = 'banner ' + m.mode;
    b.hidden = false;
    $('walletPill').innerHTML = `<i class="fas fa-wallet"></i> Salio: ${esc(core.formatNumber(m.wallet ? m.wallet.balance : 0))} SMS${m.mode !== 'live' ? ' (majaribio)' : ''}`;
  }

  function fillYears() {
    const now = new Date().getFullYear();
    const selected = String((window.somapYearContext && somapYearContext.getSelectedYear && somapYearContext.getSelectedYear()) || now);
    const years = [];
    for (let y = 2025; y <= now + 1; y++) years.push(String(y));
    if (!years.includes(selected)) years.push(selected);
    $('year').innerHTML = years.map((y) => `<option${y === selected ? ' selected' : ''}>${y}</option>`).join('');
    state.year = selected;
  }

  // ------------------------------------------------------------------ data
  async function ensureRoster() {
    if (state.roster && state.rosterYear === state.year) return state.roster;
    $('recipients').innerHTML = '<tr><td colspan="6" class="muted">Inapakia wanafunzi…</td></tr>';
    const rows = await window.SomapYearRoster.getYearRoster(state.year);
    state.roster = rows.map((r) => ({
      phone: r.parentContact,
      parentName: String((r.rawStudent && (r.rawStudent.primaryParentName || r.rawStudent.parentName)) || '').trim(),
      studentName: r.fullName,
      className: r.classLevel || r.className || '',
      admissionNumber: r.admissionNumber,
    }));
    state.rosterYear = state.year;
    const classes = Array.from(new Set(state.roster.map((r) => r.className).filter(Boolean))).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
    $('classSel').innerHTML = classes.map((c) => `<option>${esc(c)}</option>`).join('');
    if (!classes.includes(state.classFilter)) state.classFilter = classes[0] || '';
    $('classSel').value = state.classFilter;
    return state.roster;
  }

  function sourceRows() {
    if (state.source === 'debtors') return state.debtors || [];
    const rows = state.roster || [];
    if (state.source === 'class') return rows.filter((r) => r.className === state.classFilter);
    return rows;
  }

  function joinNames(names) {
    const list = names.filter(Boolean);
    if (list.length <= 1) return list[0] || '';
    return list.slice(0, -1).join(', ') + ' na ' + list[list.length - 1];
  }
  const firstWord = (s) => String(s || '').trim().split(/\s+/)[0] || '';

  function buildGroups() {
    const rows = sourceRows();
    const short = $('shortNames').checked;
    const withMoney = state.source === 'debtors' || state.purpose === 'fee_reminder';
    let result;
    if (withMoney) {
      result = core.buildFeeReminderGroups(rows, { shortNames: short });
      result.groups.forEach((g) => {
        const bal = g.rows.reduce((s, r) => s + Math.max(0, Number(r.balance) || 0), 0);
        g.values.balance = bal > 0 ? core.formatNumber(bal) : '';
      });
    } else {
      result = core.groupByPhone(rows);
      result.groups.forEach((g) => {
        const names = g.rows.map((r) => (short ? firstWord(r.studentName) : String(r.studentName || '').trim()));
        const parent = g.rows.find((r) => String(r.parentName || '').trim());
        g.values = {
          parentName: parent ? String(parent.parentName).trim() : '',
          studentName: joinNames(names),
          class: Array.from(new Set(g.rows.map((r) => String(r.className || '').trim()).filter(Boolean))).join(', '),
          children: joinNames(names),
          count: g.rows.length,
        };
      });
    }
    result.groups.forEach((g) => {
      g.key = g.msisdn;
      g.names = g.rows.map((r) => r.studentName).join(', ');
      g.refs = g.rows.map((r) => r.admissionNumber).filter(Boolean).join(',').slice(0, 120);
      g.debtTotal = g.rows.reduce((s, r) => s + Math.max(0, Number(r.debt) || 0), 0);
      if (!state.checked.has(g.key)) state.checked.set(g.key, state.source !== 'picked');
    });
    state.groups = result.groups;
    state.unreachable = result.unreachable;
  }

  function messageFor(g) {
    const values = { ...g.values, school: $('fSchool').value.trim(), date: $('fDate').value.trim(), time: $('fTime').value.trim(), venue: $('fVenue').value.trim() };
    const filled = core.fillTemplate($('message').value, values);
    const text = core.cleanText(filled.text);
    const ok = filled.missing.length === 0 && !core.hasUnfilledPlaceholder(text) && text.length > 0;
    return { text, missing: filled.missing, ok, parts: core.countSmsParts(text).parts };
  }

  // ------------------------------------------------------------------ rendering
  let renderTimer = null;
  function scheduleRender() { clearTimeout(renderTimer); renderTimer = setTimeout(render, 120); }

  function render() {
    if (!state.purpose || !state.source) return;
    buildGroups();
    const q = state.search.toLowerCase();
    const visible = state.groups.filter((g) => !q || g.names.toLowerCase().includes(q) || g.local.includes(q.replace(/\D/g, '') || '§'));
    const showDebt = state.groups.some((g) => g.debtTotal > 0);
    $('debtHead').hidden = !showDebt;
    const rows = visible.map((g) => {
      const m = messageFor(g);
      g.message = m;
      const on = state.checked.get(g.key);
      const badge = g.flags.includes('MULTIPLE_NUMBERS') ? '<span class="badge warn">namba 2 • ya kwanza</span>'
        : (g.flags.length ? '<span class="badge warn">imesahihishwa</span>' : '<span class="badge ok">sahihi</span>');
      const msgCell = !m.ok ? `<span class="badge bad">haijakamilika: ${esc(m.missing.map((x) => '{' + x + '}').join(' ') || 'ujumbe mtupu')}</span>`
        : `<span class="badge ${m.parts > 1 ? 'warn' : 'ok'}">SMS ${m.parts}</span>`;
      return `<tr class="${on ? '' : 'off'}"><td><input type="checkbox" data-key="${esc(g.key)}" ${on ? 'checked' : ''} style="width:auto"></td>
        <td>${esc(g.names)}${g.rows.length > 1 ? ` <span class="muted small">(${g.rows.length})</span>` : ''}</td>
        <td>${esc(g.values.class || '')}</td>
        <td class="mono">${esc(core.normalizeTzPhone(g.e164).local)} ${badge}</td>
        ${showDebt ? `<td>${g.debtTotal ? esc(core.formatNumber(g.debtTotal)) : '—'}</td>` : ''}
        <td>${msgCell}</td></tr>`;
    });
    // messages for hidden (filtered) rows are still needed for totals
    state.groups.forEach((g) => { if (!g.message) g.message = messageFor(g); });
    $('recipients').innerHTML = rows.length ? rows.join('') : `<tr><td colspan="6" class="muted">${state.source === 'debtors' && !state.debtors ? 'Hakuna orodha ya wadaiwa bado.' : 'Hakuna wapokeaji.'}</td></tr>`;
    $('recipients').querySelectorAll('input[type=checkbox]').forEach((cb) => {
      cb.onchange = () => { state.checked.set(cb.dataset.key, cb.checked); scheduleRender(); };
    });

    const families = state.groups.length;
    const learners = state.groups.reduce((s, g) => s + g.rows.length, 0);
    $('recipientCount').textContent = `${families} namba (familia) • ${learners} wanafunzi`;
    if (state.unreachable.length) {
      $('unreachableBox').hidden = false;
      $('unreachableSummary').textContent = `Wanafunzi ${state.unreachable.length} hawatapata SMS (hakuna namba / namba si sahihi)`;
      $('unreachable').innerHTML = state.unreachable.map((u) => `<tr><td>${esc(u.row.studentName)}</td><td>${esc(u.row.className || '')}</td><td class="mono">${esc(u.row.phone || '—')}</td><td><span class="badge bad">${u.reason === 'MISSING' ? 'hakuna namba' : 'namba si sahihi'}</span></td></tr>`).join('');
    } else {
      $('unreachableBox').hidden = true;
    }
    renderMessageHelp();
    renderPreviews();
    renderSummary();
  }

  function renderMessageHelp() {
    const text = $('message').value;
    const used = new Set(Array.from(text.matchAll(/\{\s*([A-Za-z]+)\s*\}/g)).map((m) => m[1].toLowerCase()));
    document.querySelectorAll('#eventFields [data-field]').forEach((el) => { el.hidden = !used.has(el.dataset.field); });
    $('shortNamesBox').hidden = !(used.has('studentname') || used.has('children'));
    const cleaned = core.cleanText(text);
    const nonGsm = core.nonGsmChars(text);
    const longest = state.groups.filter((g) => state.checked.get(g.key) && g.message && g.message.ok)
      .reduce((max, g) => Math.max(max, g.message.parts), 0);
    const c = core.countSmsParts(cleaned);
    const el = $('counter');
    el.textContent = `Kiolezo: herufi ${c.units} • ${c.encoding}` + (longest ? ` • Ujumbe mrefu zaidi baada ya kujaza: SMS ${longest}` : '') + ' • SMS 1 = herufi 160';
    el.className = 'counter' + (longest > 1 || c.encoding !== 'GSM-7' ? ' warn' : '');
    const realNonGsm = nonGsm.filter((ch) => core.nonGsmChars(core.cleanText(ch)).length);
    if (nonGsm.length) {
      $('unicodeWarn').hidden = false;
      $('unicodeWarn').innerHTML = `Herufi maalum: <b>${esc(nonGsm.join(' '))}</b>. ${realNonGsm.length ? 'Hizi zinafanya SMS iwe ghali (herufi 70 kwa SMS).' : 'Zitabadilishwa kuwa herufi za kawaida.'} <button class="btn ghost" type="button" id="cleanBtn">Safisha</button>`;
      $('cleanBtn').onclick = () => { $('message').value = cleaned; scheduleRender(); };
    } else {
      $('unicodeWarn').hidden = true;
    }
  }

  function renderPreviews() {
    const ready = state.groups.filter((g) => state.checked.get(g.key) && g.message && g.message.ok).slice(0, 3);
    $('previews').innerHTML = ready.length ? ready.map((g) => `<div class="preview"><div class="meta">${esc(core.normalizeTzPhone(g.e164).local)} • ${esc(g.names)} • SMS ${g.message.parts}</div>${esc(g.message.text)}</div>`).join('')
      : '<span class="muted">Hakuna ujumbe tayari kuonyesha.</span>';
  }

  function selection() {
    const chosen = state.groups.filter((g) => state.checked.get(g.key));
    const ready = chosen.filter((g) => g.message && g.message.ok);
    const blocked = chosen.filter((g) => !(g.message && g.message.ok));
    const units = ready.reduce((s, g) => s + g.message.parts, 0);
    return { chosen, ready, blocked, units };
  }

  function renderSummary() {
    const s = selection();
    const balance = state.me && state.me.wallet ? Number(state.me.wallet.balance) : 0;
    const enough = s.units <= balance;
    const stat = (l, v, cls) => `<div class="stat ${cls || ''}"><div class="v">${esc(v)}</div><div class="l">${esc(l)}</div></div>`;
    $('summary').innerHTML = [
      stat('Ujumbe tayari', core.formatNumber(s.ready.length), 'ok'),
      stat('Hazijakamilika', core.formatNumber(s.blocked.length), s.blocked.length ? 'bad' : ''),
      stat('SMS zinazohitajika', core.formatNumber(s.units)),
      stat('Salio', core.formatNumber(balance), enough ? '' : 'bad'),
      stat('Zilizotumika leo / kikomo', `${core.formatNumber(state.me && state.me.limits ? state.me.limits.usedToday : 0)} / ${core.formatNumber(state.me && state.me.limits ? state.me.limits.dailyLimit : 0)}`),
    ].join('');
    if (s.blocked.length) {
      const missing = Array.from(new Set(s.blocked.flatMap((g) => g.message ? g.message.missing : []))).map((m) => '{' + m + '}');
      $('blockedInfo').hidden = false;
      $('blockedInfo').textContent = `Ujumbe ${s.blocked.length} haujakamilika ${missing.length ? '(hakuna thamani ya ' + missing.join(', ') + ')' : ''}. Hautatumwa — jaza sehemu hizo au ondoa tiki.`;
    } else $('blockedInfo').hidden = true;
    const can = state.me && state.me.canSend && s.ready.length > 0 && enough && !state.sending;
    $('sendBtn').disabled = !can;
    $('sendHint').textContent = !state.me || !state.me.canSend ? 'Huna ruhusa ya kutuma.' : (!s.ready.length ? 'Hakuna ujumbe tayari.' : (!enough ? 'Salio halitoshi.' : `Utatuma ujumbe ${s.ready.length} (SMS ${s.units}).`));
  }

  // ------------------------------------------------------------------ actions
  function setPurpose(p) {
    state.purpose = p;
    document.querySelectorAll('#purposes .choice').forEach((b) => b.classList.toggle('active', b.dataset.purpose === p));
    renderTemplateSelect();
    const first = state.templates.find((t) => t.purpose === p) || BUILT_IN.find((t) => t.purpose === p);
    if (first) applyTemplate(first.id);
    if (p === 'fee_reminder' && state.debtors && state.source !== 'debtors') setSource('debtors');
    else if (!state.source) setSource(p === 'fee_reminder' ? 'debtors' : 'all');
    else scheduleRender();
  }

  async function setSource(src) {
    state.source = src;
    state.checked = new Map();
    document.querySelectorAll('#sources .choice').forEach((b) => b.classList.toggle('active', b.dataset.source === src));
    $('classBox').hidden = src !== 'class';
    $('year').disabled = src === 'debtors';
    const info = $('debtorsInfo');
    if (src === 'debtors') {
      if (state.debtors) {
        info.className = 'alert ok';
        info.textContent = `Orodha ya wadaiwa ${state.debtorsMeta.count} kutoka Finance (mwaka ${state.debtorsMeta.year}${state.debtorsMeta.filter ? ', ' + state.debtorsMeta.filter : ''}) — sawa na "SMS Debt Excel".`;
      } else {
        info.className = 'alert warn';
        info.innerHTML = 'Kwa wadaiwa: fungua <a href="../finance.html">Finance</a>, chagua mwaka/darasa, kisha bonyeza <b>"Tuma SMS kwa wadaiwa"</b>.';
      }
      info.hidden = false;
    } else {
      info.hidden = true;
      try { await ensureRoster(); } catch (err) { $('recipients').innerHTML = `<tr><td colspan="6" class="alert bad">Imeshindwa kupakia wanafunzi: ${esc(err.message || err)}</td></tr>`; return; }
    }
    render();
  }

  function renderTemplateSelect() {
    const list = [...BUILT_IN, ...state.templates];
    const mine = list.filter((t) => t.purpose === state.purpose);
    const others = list.filter((t) => t.purpose !== state.purpose);
    const opt = (t) => `<option value="${esc(t.id)}">${esc(t.name)}${t.builtIn ? ' (SoMAp)' : ''}</option>`;
    $('templateSel').innerHTML = mine.map(opt).join('') + (others.length ? `<optgroup label="Mengineyo">${others.map(opt).join('')}</optgroup>` : '');
  }

  function applyTemplate(id) {
    const t = [...BUILT_IN, ...state.templates].find((x) => x.id === id);
    if (!t) return;
    $('templateSel').value = id;
    $('message').value = t.body;
    scheduleRender();
  }

  function insertAtCursor(text) {
    const ta = $('message');
    const start = ta.selectionStart || ta.value.length;
    const end = ta.selectionEnd || start;
    ta.value = ta.value.slice(0, start) + text + ta.value.slice(end);
    ta.focus();
    ta.selectionStart = ta.selectionEnd = start + text.length;
    scheduleRender();
  }

  async function doSend(messagesOverride) {
    const s = selection();
    const messages = messagesOverride || s.ready.map((g) => ({ phone: g.e164, text: g.message.text, ref: g.refs || g.key }));
    if (!messages.length) return;
    const units = messages.reduce((sum, m) => sum + core.countSmsParts(m.text).parts, 0);
    const modeText = { dryrun: 'DRY-RUN (hakuna SMS halisi)', sandbox: 'SANDBOX (hakuna SMS halisi)', live: 'SMS HALISI kwa wazazi' }[state.me.mode] || state.me.mode;
    const sample = messages[0].text;
    if (!window.confirm(`Thibitisha utumaji\n\nHali: ${modeText}\nUjumbe: ${messages.length}\nSMS zitakazotumika: ${units}\nSalio: ${state.me.wallet ? state.me.wallet.balance : 0}\n\nMfano:\n${sample}\n\nEndelea?`)) return;

    state.sending = true;
    renderSummary();
    $('progressBox').hidden = false;
    $('resultCard').hidden = true;
    const name = `${PURPOSE_SW[state.purpose] || 'SMS'} • ${SOURCE_SW[state.source] || ''}${state.source === 'class' ? ' ' + state.classFilter : ''}`;
    let report = null;
    try {
      report = await svc.sendAll({
        schoolId: state.schoolId,
        purpose: state.purpose,
        name: messagesOverride ? name + ' (jaribio jingine)' : name,
        messages,
        onProgress: (p) => {
          $('progressBar').style.width = `${Math.round((p.done / Math.max(1, p.total)) * 100)}%`;
          $('progressText').textContent = `${p.done} / ${p.total} • zimetumwa ${p.sent} • zimeshindwa ${p.failed} • zimekataliwa ${p.rejected}`;
        },
      });
    } catch (err) {
      showResultError(err);
    } finally {
      state.sending = false;
    }
    if (report) showResult(report);
    try { state.me = await svc.me(state.schoolId); showMode(); } catch (_) { /* keep old */ }
    renderSummary();
  }

  function showResultError(err) {
    $('resultCard').hidden = false;
    $('resultAlert').innerHTML = `<div class="alert bad">${esc(err.message || err)}${err.code ? ` <span class="small">(${esc(err.code)})</span>` : ''}</div>`;
    $('resultStats').innerHTML = '';
    $('retryBtn').hidden = true;
    $('resultTableWrap').hidden = true;
  }

  function showResult(report) {
    state.lastReport = report;
    $('resultCard').hidden = false;
    const stat = (l, v, cls) => `<div class="stat ${cls || ''}"><div class="v">${esc(v)}</div><div class="l">${esc(l)}</div></div>`;
    $('resultStats').innerHTML = [
      stat('Zimetumwa', report.sent, 'ok'), stat('Zimeshindwa', report.failed, report.failed ? 'bad' : ''),
      stat('Zimekataliwa', report.rejected, report.rejected ? 'warn' : ''), stat('Hazikutumwa', report.notSent, report.notSent ? 'bad' : ''),
      stat('SMS zilizotumika', report.unitsUsed), stat('Salio sasa', report.walletBalance === null ? '—' : core.formatNumber(report.walletBalance)),
    ].join('');
    $('resultAlert').innerHTML = report.stoppedBy
      ? `<div class="alert bad">Utumaji ulisimama: ${esc(report.stoppedBy.message || report.stoppedBy.code)}</div>`
      : `<div class="alert ok">Imekamilika${report.mode !== 'live' ? ' (' + esc(report.mode) + ' — hakuna SMS halisi)' : ''}.</div>`;
    const problems = report.rows.filter((r) => ['failed', 'rejected', 'not_sent', 'unknown'].includes(r.status));
    $('resultTableWrap').hidden = !problems.length;
    $('resultRows').innerHTML = problems.map((r) => `<tr><td class="mono">${esc(SomapSms.displayPhone(r.phone))}</td><td>${esc(SomapSms.statusLabel(r.status))}</td><td>${esc(SomapSms.reasonLabel(r.reason))}</td><td class="small">${esc(r.text)}</td></tr>`).join('');
    $('retryBtn').hidden = !svc.retryable(report).length;
  }

  // ------------------------------------------------------------------ history
  async function loadHistory() {
    $('historyRows').innerHTML = '<tr><td colspan="8" class="muted">Inapakia…</td></tr>';
    try {
      const r = await svc.listCampaigns(state.schoolId);
      $('historyRows').innerHTML = r.campaigns.length ? r.campaigns.map((c) => `<tr data-id="${esc(c.id)}" style="cursor:pointer">
          <td>${esc(new Date(c.created_at).toLocaleString())}</td><td>${esc(c.name)}</td><td>${esc(PURPOSE_SW[c.purpose] || c.purpose)}</td>
          <td><span class="badge ${c.mode === 'live' ? 'ok' : 'warn'}">${esc(c.mode)}</span></td><td>${esc(c.sent_count)}</td><td>${esc(c.failed_count)}</td><td>${esc(c.units_used)}</td><td class="small">${esc(c.created_by)}</td></tr>`).join('')
        : '<tr><td colspan="8" class="muted">Bado hakuna SMS zilizotumwa.</td></tr>';
      $('historyRows').querySelectorAll('tr[data-id]').forEach((tr) => { tr.onclick = () => openCampaign(tr.dataset.id); });
    } catch (err) {
      $('historyRows').innerHTML = `<tr><td colspan="8" class="alert bad">${esc(err.message || err)}</td></tr>`;
    }
  }

  async function openCampaign(id) {
    try {
      const r = await svc.getCampaign(state.schoolId, id);
      state.historyDetail = r;
      $('historyDetail').hidden = false;
      $('historyTitle').textContent = `${r.campaign.name} • ${new Date(r.campaign.created_at).toLocaleString()} • mtumaji ${r.campaign.sender_id}`;
      $('historyMessages').innerHTML = r.messages.map((m) => `<tr><td class="mono">${esc(SomapSms.displayPhone(m.msisdn))}</td><td>${esc(SomapSms.statusLabel(m.status))}</td><td>${esc(SomapSms.reasonLabel(m.failure_reason))}</td><td>${esc(m.units === null ? m.units_est : m.units)}</td><td class="small">${esc(m.text || '')}</td></tr>`).join('');
      $('historyDetail').scrollIntoView({ behavior: 'smooth' });
    } catch (err) {
      alert(err.message || err);
    }
  }

  // ------------------------------------------------------------------ wallet / sender
  function renderWalletAndSender() {
    const m = state.me;
    const stat = (l, v) => `<div class="stat"><div class="v">${esc(v)}</div><div class="l">${esc(l)}</div></div>`;
    $('walletStats').innerHTML = [
      stat(m.mode === 'live' ? 'Salio (SMS)' : 'Salio la majaribio (SMS)', core.formatNumber(m.wallet ? m.wallet.balance : 0)),
      stat('Zilizotumika leo', core.formatNumber(m.limits ? m.limits.usedToday : 0)),
      stat('Kikomo cha siku', core.formatNumber(m.limits ? m.limits.dailyLimit : 0)),
      stat('Hali ya mfumo', m.mode),
    ].join('');
    const s = m.sender || {};
    const src = { school: 'Jina la shule lililoidhinishwa', fallback: 'Jina la akiba la SoMAp', 'sandbox-test': 'Jina la majaribio (sandbox)', dryrun: 'Dry-run (hakuna utumaji)', none: 'Hakuna' }[s.source] || s.source;
    $('senderInfo').innerHTML = `<div class="stats">${stat('Jina linalotumika', s.senderId || '—')}${stat('Chanzo', src || '—')}</div>`;
  }

  // ------------------------------------------------------------------ templates
  async function loadTemplates() {
    try { state.templates = (await svc.listTemplates(state.schoolId)).templates || []; } catch (_) { state.templates = []; }
    renderTemplateSelect();
    renderTemplateTable();
  }

  function renderTemplateTable() {
    const all = [...BUILT_IN, ...state.templates];
    $('templateRows').innerHTML = all.map((t) => `<tr><td>${esc(t.name)}${t.builtIn ? ' <span class="badge ok">SoMAp</span>' : ''}</td><td>${esc(PURPOSE_SW[t.purpose] || t.purpose)}</td><td class="small">${esc(t.body)}</td>
      <td style="white-space:nowrap"><button class="btn ghost" data-use="${esc(t.id)}" type="button">Tumia</button>
      ${t.builtIn ? '' : `<button class="btn ghost" data-edit="${esc(t.id)}" type="button">Hariri</button> <button class="btn ghost" data-del="${esc(t.id)}" type="button">Futa</button>`}</td></tr>`).join('');
    $('templateRows').querySelectorAll('[data-use]').forEach((b) => { b.onclick = () => { const t = all.find((x) => x.id === b.dataset.use); switchTab('send'); setPurpose(t.purpose === 'other' ? 'general' : t.purpose); applyTemplate(t.id); }; });
    $('templateRows').querySelectorAll('[data-edit]').forEach((b) => { b.onclick = () => editTemplate(b.dataset.edit); });
    $('templateRows').querySelectorAll('[data-del]').forEach((b) => {
      b.onclick = async () => {
        if (!confirm('Futa kiolezo hiki?')) return;
        try { await svc.deleteTemplate(state.schoolId, b.dataset.del); await loadTemplates(); } catch (err) { alert(err.message || err); }
      };
    });
  }

  function editTemplate(id) {
    const t = state.templates.find((x) => x.id === id);
    state.editingTemplateId = t ? t.id : '';
    $('tplFormTitle').textContent = t ? 'Hariri kiolezo' : 'Kiolezo kipya';
    $('tplName').value = t ? t.name : '';
    $('tplPurpose').value = t ? t.purpose : 'general';
    $('tplBody').value = t ? t.body : '';
    updateTplCounter();
  }

  function updateTplCounter() {
    const c = core.countSmsParts(core.cleanText($('tplBody').value));
    $('tplCounter').textContent = `Herufi ${c.units} • SMS ${c.parts} (kabla ya kujaza majina) • ${c.encoding}`;
  }

  // ------------------------------------------------------------------ wiring
  function switchTab(tab) {
    document.querySelectorAll('#tabs button').forEach((b) => b.classList.toggle('active', b.dataset.tab === tab));
    document.querySelectorAll('.panel').forEach((p) => p.classList.toggle('active', p.id === 'panel-' + tab));
    if (tab === 'history') loadHistory();
    if (tab === 'wallet' || tab === 'sender') renderWalletAndSender();
  }

  function wire() {
    document.querySelectorAll('#tabs button').forEach((b) => { b.onclick = () => switchTab(b.dataset.tab); });
    document.querySelectorAll('#purposes .choice').forEach((b) => { b.onclick = () => setPurpose(b.dataset.purpose); });
    document.querySelectorAll('#sources .choice').forEach((b) => { b.onclick = () => setSource(b.dataset.source); });
    $('debtorsHint').textContent = state.debtors ? `${state.debtors.length} kutoka Finance` : 'Fungua Finance kwanza';
    $('year').onchange = async () => { state.year = $('year').value; state.checked = new Map(); if (state.source !== 'debtors') await setSource(state.source); };
    $('classSel').onchange = () => { state.classFilter = $('classSel').value; state.checked = new Map(); render(); };
    $('search').oninput = () => { state.search = $('search').value.trim(); scheduleRender(); };
    $('checkAll').onclick = () => { state.groups.forEach((g) => state.checked.set(g.key, true)); render(); };
    $('checkNone').onclick = () => { state.groups.forEach((g) => state.checked.set(g.key, false)); render(); };
    ['message', 'fSchool', 'fDate', 'fTime', 'fVenue'].forEach((id) => { $(id).oninput = scheduleRender; });
    $('shortNames').onchange = scheduleRender;
    $('templateSel').onchange = () => applyTemplate($('templateSel').value);
    $('placeholders').innerHTML = core.PLACEHOLDERS.map((p) => `<button type="button" class="chip" data-ph="${p}" title="${esc(PLACEHOLDER_HELP[p] || '')}">{${p}}</button>`).join('');
    $('placeholders').querySelectorAll('[data-ph]').forEach((b) => { b.onclick = () => insertAtCursor('{' + b.dataset.ph + '}'); });
    $('sendBtn').onclick = () => doSend();
    $('retryBtn').onclick = () => { if (state.lastReport) doSend(svc.retryable(state.lastReport)); };
    $('resultCsv').onclick = () => { if (state.lastReport) SomapSms.downloadText(`sms-matokeo-${state.schoolId}-${Date.now()}.csv`, SomapSms.reportCsv(state.lastReport)); };
    $('historyRefresh').onclick = loadHistory;
    $('historyCsv').onclick = () => {
      const d = state.historyDetail;
      if (!d) return;
      const csv = SomapSms.toCsv(['Namba', 'Hali', 'Sababu', 'SMS', 'Ujumbe', 'Ref'], d.messages.map((m) => [SomapSms.displayPhone(m.msisdn), SomapSms.statusLabel(m.status), SomapSms.reasonLabel(m.failure_reason), m.units === null ? m.units_est : m.units, m.text || '', m.ref || '']));
      SomapSms.downloadText(`sms-historia-${state.schoolId}-${d.campaign.id.slice(0, 8)}.csv`, csv);
    };
    $('tplBody').oninput = updateTplCounter;
    $('tplNew').onclick = () => editTemplate('');
    $('tplSave').onclick = async () => {
      try {
        await svc.saveTemplate(state.schoolId, { id: state.editingTemplateId, name: $('tplName').value, purpose: $('tplPurpose').value, body: $('tplBody').value });
        editTemplate('');
        await loadTemplates();
      } catch (err) { alert(err.message || err); }
    };
    window.addEventListener('beforeunload', (e) => { if (state.sending) { e.preventDefault(); e.returnValue = ''; } });
  }

  $('login').onclick = () => firebase.auth().signInWithPopup(new firebase.auth.GoogleAuthProvider()).catch((e) => fatal('Login imeshindwa: ' + e.message));
  let booted = false;
  firebase.auth().onAuthStateChanged((user) => {
    $('loginBox').hidden = Boolean(user);
    if (user && !booted) { booted = true; boot(); }
  });
})();
