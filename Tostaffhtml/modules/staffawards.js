/*
 * SoMAp Staff Awards: Best Teachers, Best Workers (top 3, approved) + Appreciation for all.
 * Reads only. Sources:
 *   workers            P(years/{y}/workers)               profile, docs.passportPhotoUrl
 *   teacher subjects   P(years/{y}/teachers_config/{id})  classSubjectMappings (workertasks.html)
 *   annual results     shared/academic_annual.js           (report-form formula)
 *   sign-ins           P(years/{y}/workerAttendance/{id}) + Socrates legacy attendance/{id}
 *   late lesson plans  P(years/{y}/lessonPlanFinalizationLetters/{id})
 * Writes only the approved snapshot: P(staffAwards/{y}/approved) (+ history).
 */
(function () {
  'use strict';
  const db = firebase.database();
  const auth = firebase.auth();
  const AA = window.SomapAcademicAnnual;
  const S = window.SomapStaffAwards;
  const $ = (s) => document.querySelector(s);
  const L = (s) => String(s || '').trim().toLowerCase();
  const esc = (v) => String(v == null ? '' : v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

  const YEARS = Array.from({ length: 12 }, (_, i) => 2024 + i);
  const VIEW_ROLES = new Set(['admin', 'head', 'headteacher', 'head teacher', 'director', 'owner', 'principal', 'academic', 'secretary']);
  const APPROVER_ROLES = new Set(['admin', 'head', 'headteacher', 'head teacher', 'director', 'owner', 'principal']);
  const APPROVER_EMAILS = new Set(['socratesschool2020@gmail.com', 'ssclass42023@gmail.com']);
  const EXCLUDED_STATUS = new Set(['shifted', 'graduated', 'archived', 'deleted', 'removed', 'inactive']);
  const INACTIVE_WORKER = new Set(['inactive', 'exited', 'terminated', 'resigned', 'deleted', 'archived', 'left']);

  const state = { user: null, role: '', canApprove: false, year: String(new Date().getFullYear()), school: null, workers: [], live: null, approved: null, view: 'none', job: { running: false, cancelled: false } };

  // ---------- helpers ----------
  function toast(msg, tone = 'ok', ms = 4500) {
    const n = $('#toast'); n.textContent = msg;
    n.style.background = tone === 'error' ? 'linear-gradient(135deg,#ef4444,#b91c1c)' : tone === 'warn' ? 'linear-gradient(135deg,#f59e0b,#d97706)' : 'linear-gradient(135deg,#10b981,#047857)';
    n.classList.add('show'); clearTimeout(n._t); n._t = setTimeout(() => n.classList.remove('show'), ms);
  }
  function progress(title, done, total, sub) {
    const b = $('#progress');
    if (title == null) { b.classList.remove('show'); return; }
    b.classList.add('show');
    b.querySelector('[data-progress-title]').textContent = title;
    b.querySelector('[data-progress-text]').textContent = total ? `${done} / ${total}` : '';
    b.querySelector('[data-progress-bar]').style.width = `${total ? Math.round((done / total) * 100) : 0}%`;
    b.querySelector('[data-progress-sub]').textContent = sub || '';
  }
  const pause = (ms = 0) => new Promise((r) => setTimeout(r, ms));
  async function waitFor(test, ms = 8000) { const t0 = Date.now(); while (!test()) { if (Date.now() - t0 > ms) return false; await pause(50); } return true; }
  function schoolId() { const id = window.SOMAP?.getSchool?.()?.id || localStorage.getItem('schoolId') || 'socrates-school'; return id === 'socrates' ? 'socrates-school' : id; }
  const isSocrates = () => schoolId() === 'socrates-school';
  function P(path) {
    const clean = String(path || '').replace(/^\/+/, '');
    try { if (window.SOMAP?.P) return window.SOMAP.P(clean); } catch (_) {}
    return isSocrates() ? clean : `schools/${schoolId()}/${clean}`;
  }
  async function read(path) { try { const s = await db.ref(path).once('value'); return s.exists() ? s.val() : null; } catch (e) { console.warn('read failed', path, e?.message || e); return null; } }
  async function loadSchool() {
    if (state.school?.id === schoolId()) return state.school;
    const profile = (await read(`schools/${schoolId()}/profile`)) || {};
    const name = String(profile.name || profile.schoolName || window.SOMAP?.getSchool?.()?.name || (isSocrates() ? 'Socrates School' : schoolId())).trim();
    state.school = { id: schoolId(), name, logoUrl: String(profile.logoUrl || '') };
    $('#schoolChip').textContent = name;
    return state.school;
  }
  const Sub = () => window.SomapSubjects || {};
  const canonSubject = (s) => (Sub().canonSubject ? Sub().canonSubject(s) : s);
  function canonClass(name) {
    const noStream = String(name || '').trim().replace(/\s*\(([^)]+)\)\s*$/, '').trim();
    return String((Sub().canonClass ? Sub().canonClass(noStream) : noStream) || noStream || '').trim();
  }
  function subjectListForClass(cls, year) {
    const api = Sub();
    const list = api.getSubjectsForClass ? api.getSubjectsForClass(api.canonClass ? api.canonClass(cls) : cls, year) : [];
    return (Array.isArray(list) ? list : []).map(canonSubject);
  }
  const ymdToday = () => { const d = new Date(Date.now() + 3 * 3600 * 1000); return d.toISOString().slice(0, 10).replace(/-/g, ''); };
  const untilYmd = (y) => (Number(y) < new Date().getFullYear() ? `${y}1231` : ymdToday());
  const ymdLabel = (ymd) => new Date(`${ymd.slice(0, 4)}-${ymd.slice(4, 6)}-${ymd.slice(6, 8)}T00:00:00`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });

  // ---------- workers ----------
  function workerName(w) {
    const p = w.profile || {};
    return String(p.fullNameUpper || p.fullName || [p.firstName, p.middleName, p.lastName].filter(Boolean).join(' ') || w.name || '').replace(/\s+/g, ' ').trim();
  }
  function workerActive(w, year) {
    const p = w.profile || {}; const e = w.employment || {};
    if (e.active === false || p.active === false) return false;
    if (INACTIVE_WORKER.has(L(p.status || e.status))) return false;
    const exit = String(p.exitDate || e.exitDate || '');
    if (/^\d{4}-\d{2}/.test(exit) && exit.slice(0, 4) < String(year)) return false;
    return true;
  }
  async function loadWorkers(year) {
    let raw = (await read(P(`years/${year}/workers`))) || {};
    if (!Object.keys(raw).length) raw = (await read(P('workers'))) || {};
    const list = Object.entries(raw).map(([id, w]) => {
      w = w || {};
      const docs = w.docs || {};
      return { key: id, name: workerName(w), role: String(w.profile?.role || w.role || '').trim(), photoUrl: docs.passportPhotoUrl || docs.idPhotoUrl || w.profile?.photoUrl || '', active: workerActive(w, year) };
    }).filter((w) => w.name && w.active).sort((a, b) => a.name.localeCompare(b.name));
    state.workers = list;
    return list;
  }

  // ---------- analysis ----------
  async function analyse() {
    if (state.job.running) return;
    state.job = { running: true, cancelled: false };
    $('#btnAnalyse').disabled = true;
    const year = state.year;
    render();
    try {
      progress('Analysing', 0, 0, 'Loading workers…');
      await loadSchool();
      await waitFor(() => (window.SomapYearRoster || window.SomapFinance?.getFinanceRoster) && window.SomapSubjects);
      const workers = await loadWorkers(year);
      if (!workers.length) throw new Error(`No active workers found for ${year}.`);
      const byKey = new Map(workers.map((w) => [w.key, w]));

      // ----- teachers -----
      progress('Analysing', 0, 0, 'Reading teachers’ classes & subjects…');
      const configs = (await read(P(`years/${year}/teachers_config`))) || {};
      const teachers = [];
      Object.entries(configs).forEach(([wid, cfg]) => {
        const w = byKey.get(wid);
        if (!w) return;
        const mappings = Array.isArray(cfg?.classSubjectMappings) ? cfg.classSubjectMappings : Object.values(cfg?.classSubjectMappings || {});
        const claims = [];
        mappings.forEach((m) => {
          const cls = canonClass(m?.class || m?.className || '');
          if (!cls) return;
          (m.subjects || []).forEach((s) => claims.push({ className: cls, stream: '', subject: canonSubject(s) }));
          (m.streams || []).filter((st) => st && st.name).forEach((st) => (st.subjects || []).forEach((s) => claims.push({ className: cls, stream: String(st.name).trim(), subject: canonSubject(s), studentKeys: (st.studentIds || []).map(String) })));
        });
        teachers.push({ key: wid, name: w.name, photoUrl: w.photoUrl, role: w.role, claims });
      });
      const classes = Array.from(new Set(teachers.flatMap((t) => t.claims.map((c) => c.className))));

      progress('Analysing', 0, classes.length, 'Loading class lists…');
      const rows = await (window.SomapYearRoster ? window.SomapYearRoster.getYearRoster(year) : window.SomapFinance.getFinanceRoster(year)).catch(() => []);
      const rosterByClass = new Map();
      (rows || []).forEach((r) => {
        if (r.isGraduated || EXCLUDED_STATUS.has(L(r.status))) return;
        const cls = canonClass(r.classLevel || r.className);
        if (!rosterByClass.has(cls)) rosterByClass.set(cls, []);
        rosterByClass.get(cls).push({ key: String(r.id), lookupKeys: [r.id, r.admissionNumber, r.rawStudent?.admissionNumber].filter(Boolean) });
      });
      await AA.loadCustomSubjectsForYear(year, { api: Sub(), readScopedOrLegacy: (p) => read(P(p)), readLegacy: (p) => read(p) });
      const classResults = {};
      let doneClasses = 0;
      progress('Analysing', 0, classes.length, 'Annual results for every class…');
      await Promise.all(classes.map(async (cls) => {
        const roster = rosterByClass.get(cls) || [];
        const annual = await AA.computeClassAnnual({ className: cls, classSubjects: subjectListForClass(cls, year), readRoot: (cand) => read(P(`scores/${year}/${cand}`)), roster, canonicalSubjectName: canonSubject, registry: [] });
        classResults[cls] = annual.students;
        doneClasses += 1;
        progress('Analysing', doneClasses, classes.length, `${cls}: annual results ready`);
      }));
      if (state.job.cancelled) throw new Error('Analysis cancelled.');
      const teacherResult = S.computeTeacherAwards(teachers, classResults);

      // ----- workers -----
      const from = `${year}0101`; const until = untilYmd(year);
      let doneWorkers = 0;
      progress('Analysing', 0, workers.length, 'Sign-in records for every worker…');
      const workerInputs = await Promise.all(workers.map(async (w) => {
        const [scoped, legacy, lpLetters] = await Promise.all([
          read(P(`years/${year}/workerAttendance/${w.key}`)),
          isSocrates() ? read(`attendance/${w.key}`) : Promise.resolve(null),
          read(P(`years/${year}/lessonPlanFinalizationLetters/${w.key}`)),
        ]);
        const days = {};
        [legacy, scoped].forEach((src) => Object.entries(src || {}).forEach(([month, byDay]) => {
          if (!/^\d{6}$/.test(month) || month.slice(0, 4) !== String(year)) return;
          Object.entries(byDay || {}).forEach(([day, rec]) => { if (/^\d{8}$/.test(day)) days[day] = { ...(days[day] || {}), ...(rec || {}) }; });
        }));
        const extraLetters = Object.values(lpLetters || {}).reduce((n, perDay) => n + (perDay && typeof perDay === 'object' ? Object.keys(perDay).length : 0), 0);
        doneWorkers += 1;
        if (doneWorkers % 3 === 0 || doneWorkers === workers.length) progress('Analysing', doneWorkers, workers.length, `Sign-in records: ${w.name}`);
        return { key: w.key, name: w.name, role: w.role, photoUrl: w.photoUrl, days, extraLetters };
      }));
      if (state.job.cancelled) throw new Error('Analysis cancelled.');
      const workerResult = S.computeWorkerAwards(workerInputs, { from, until });

      const warnings = [];
      if (!teachers.length) warnings.push('No teacher has saved classes & subjects in Worker Tasks for this year, so there are no teacher awards yet.');
      if (!workerResult.workDays) warnings.push('No worker sign-ins found for this year.');
      state.live = buildResult({ year, until, teacherResult, workerResult, warnings, teachersCount: teachers.length });
      state.view = 'live';
      render();
      toast(`Analysis complete: ${state.live.awards.length} ranking awards.`);
    } catch (err) {
      console.error(err);
      toast(err?.message || 'Analysis failed', 'error', 7000);
    } finally {
      state.job.running = false; $('#btnAnalyse').disabled = false; progress(null);
    }
  }

  function buildResult({ year, until, teacherResult, workerResult, warnings, teachersCount }) {
    const awards = [];
    ['primary', 'prePrimary'].forEach((g) => (teacherResult.awards[g] || []).forEach((t) => awards.push({
      id: `teacher|${g}|${t.key}`, kind: 'teacher', group: g, groupLabel: g === 'primary' ? 'Primary teachers (Class 1 – 7)' : 'Pre-Primary teachers (Baby, Middle & Pre-Unit)', groupShort: g === 'primary' ? 'Primary' : 'Pre-Primary',
      key: t.key, name: t.name, photoUrl: t.photoUrl, role: t.role, position: t.position, score: S.round(t.score), subjects: t.subjects, detail: t.detail, year: Number(year),
    })));
    (workerResult.awards || []).forEach((w) => awards.push({
      id: `worker|${w.key}`, kind: 'worker', key: w.key, name: w.name, photoUrl: w.photoUrl, role: w.role, position: w.position, score: S.round(w.score),
      signIns: w.signIns, workDays: w.workDays, punctuality: S.round(w.punctuality), signOuts: w.signOuts, letters: w.letters, avgArrivalLabel: S.clock(w.avgArrival), untilLabel: ymdLabel(until), detail: w.detail, year: Number(year),
    }));
    const teacherRanking = ['primary', 'prePrimary'].flatMap((g) => (teacherResult.ranked[g] || []).map((t) => ({ name: t.name, group: g, score: S.round(t.score), subjects: t.subjects })));
    const workerRanking = (workerResult.ranked || []).map((w) => ({ key: w.key, name: w.name, role: w.role, score: S.round(w.score), signIns: w.signIns, workDays: w.workDays, punctuality: S.round(w.punctuality), signOuts: w.signOuts, letters: w.letters, avgArrival: S.clock(w.avgArrival) }));
    const gaps = teacherResult.gaps.concat(workerResult.gaps);
    const fp = awards.map((a) => `${a.id}:${a.position}:${a.score}`).sort().join(';');
    let h = 0x811c9dc5; for (let i = 0; i < fp.length; i += 1) { h ^= fp.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
    return { year: Number(year), until, computedAt: Date.now(), awards, teacherRanking, workerRanking, gaps, warnings, teachersCount, workersCount: workerRanking.length + workerResult.gaps.length, workDays: workerResult.workDays, fingerprint: h.toString(36).toUpperCase() };
  }

  // ---------- approval ----------
  async function loadApproved() {
    state.approved = await read(P(`staffAwards/${state.year}/approved`));
    if (state.approved) ['awards', 'teacherRanking', 'workerRanking', 'gaps', 'warnings'].forEach((k) => { if (state.approved[k] && !Array.isArray(state.approved[k])) state.approved[k] = Object.values(state.approved[k]); });
    if (state.approved && !state.live) state.view = 'approved';
    render();
  }
  async function approve() {
    if (!state.canApprove || !state.live) return;
    const live = state.live;
    if (!window.confirm(`Approve ${live.awards.length} staff ranking awards for ${live.year}?`)) return;
    const snapshot = { ...live, code: `SA${String(live.year).slice(-2)}-${live.fingerprint.slice(0, 5)}`, approvedAt: firebase.database.ServerValue.TIMESTAMP, approvedBy: state.user?.email || state.user?.uid || 'unknown', approvedByRole: state.role, rules: { teacher: 'mean of class-subject annual averages; Pre-Primary and Primary separate', worker: S.WORKER_WEIGHTS, letterPenalty: S.LETTER_PENALTY, minDays: S.MIN_WORKER_DAYS, rankDecimals: S.RANK_DECIMALS } };
    try {
      await db.ref(P(`staffAwards/${live.year}/approved`)).set(snapshot);
      await db.ref(P(`staffAwards/${live.year}/history`)).push({ ...snapshot, gaps: null });
      toast('Approved. Award certificates are ready.');
      await loadApproved(); state.view = 'approved'; render();
    } catch (err) { toast(err?.message || 'Approval failed', 'error'); }
  }

  // ---------- render ----------
  const current = () => (state.view === 'approved' ? state.approved : state.live);
  const approvedIds = () => new Set((state.approved?.awards || []).map((a) => `${a.id}:${a.position}`));
  const initials = (n) => String(n || '').split(/\s+/).slice(0, 2).map((p) => p[0] || '').join('').toUpperCase();
  const avatar = (url, name) => `<div class="ava">${url ? `<img src="${esc(url)}" alt="" loading="lazy" onerror="this.remove()">` : ''}<span>${esc(initials(name))}</span></div>`;

  function winner(a, extra) {
    const ok = approvedIds().has(`${a.id}:${a.position}`);
    return `<div class="winner"><div class="pos p${a.position}">${a.position}</div>${avatar(a.photoUrl, a.name)}
      <div><div class="w-name">${esc(a.name)}</div><div class="w-detail">${esc(a.detail)}</div>${extra || ''}</div>
      <button class="icon-btn" data-cert="${esc(a.id)}" data-pos="${a.position}" ${ok ? '' : 'disabled title="Approve first"'}><i class="fa-solid fa-award"></i></button></div>`;
  }
  function render() {
    $('#yearTitle').textContent = state.year;
    renderStatus();
    $('#btnApprove').classList.toggle('hidden', !(state.view === 'live' && state.live && state.canApprove));
    $('#btnDownloadAll').disabled = !state.approved?.awards?.length;
    renderAppreciation();
    const d = current();
    if (!d) { $('#teacherGrid').innerHTML = state.job.running ? '<div class="empty"><span class="spinner"></span> Reading results, sign-ins and letters for the whole year…</div>' : '<div class="empty">Press <b>Analyse staff records</b> to see the rankings.</div>'; $('#workerGrid').innerHTML = $('#teacherGrid').innerHTML; return; }
    $('#statTeachers').textContent = d.teachersCount ?? '–';
    $('#statWorkers').textContent = d.workersCount ?? '–';
    $('#statDays').textContent = d.workDays ?? '–';
    $('#statGaps').textContent = (d.gaps || []).length;
    $('#warnings').innerHTML = d.warnings?.length ? `<div class="notice warn"><b>Check before approving</b><ul>${d.warnings.map((w) => `<li>${esc(w)}</li>`).join('')}</ul></div>` : '';
    const A = d.awards || [];
    const tCard = (g, label) => {
      const list = A.filter((a) => a.kind === 'teacher' && a.group === g).sort((x, y) => x.position - y.position);
      return `<div class="card" style="--accent:#0b4d3b"><div class="card-title"><b><i class="fa-solid fa-crown" style="color:#b8892f"></i> ${label}</b><small>annual teaching average</small></div>
        ${list.length ? list.map((a) => winner(a, `<div class="chips">${(a.subjects || []).map((s) => `<span class="mini">${esc(s.label)} ${esc(Number(s.average).toFixed(1))}%</span>`).join('')}</div>`)).join('') : '<div class="empty">No teacher results yet.</div>'}</div>`;
    };
    $('#teacherGrid').innerHTML = tCard('primary', 'Primary (Class 1 – 7)') + tCard('prePrimary', 'Pre-Primary');
    $('#teacherTable').innerHTML = (d.teacherRanking || []).sort((x, y) => y.score - x.score).map((t) => `<tr><td><b>${esc(t.name)}</b></td><td>${t.group === 'primary' ? 'Primary' : 'Pre-Primary'}</td><td class="muted">${(t.subjects || []).map((s) => `${esc(s.label)} (${esc(Number(s.average).toFixed(1))}%)`).join(' · ')}</td><td class="num"><b>${esc(Number(t.score).toFixed(2))}%</b></td></tr>`).join('') || '<tr><td colspan="4" class="muted">No teachers ranked.</td></tr>';
    const wl = A.filter((a) => a.kind === 'worker').sort((x, y) => x.position - y.position);
    $('#workerGrid').innerHTML = `<div class="card" style="--accent:#b8733a"><div class="card-title"><b><i class="fa-solid fa-medal" style="color:#b8733a"></i> Top workers · whole school</b><small>1 Jan → ${esc(ymdLabel(d.until))}</small></div>${wl.length ? wl.map((a) => winner(a)).join('') : '<div class="empty">No workers ranked yet.</div>'}</div>`;
    $('#workerTable').innerHTML = (d.workerRanking || []).map((w) => `<tr><td><b>${esc(w.name)}</b><div class="muted">${esc(w.role)}</div></td><td class="num"><b>${esc(Number(w.score).toFixed(2))}</b><div class="bar"><i style="width:${Math.max(0, Math.min(100, w.score))}%"></i></div></td><td class="num">${w.signIns}/${w.workDays}</td><td class="num">${Math.round(w.punctuality * 100)}%</td><td class="num">${w.signOuts}</td><td class="num">${w.letters}</td><td class="num">${esc(w.avgArrival)}</td></tr>`).join('') || '<tr><td colspan="7" class="muted">No workers ranked.</td></tr>';
    $('#gapCount').textContent = (d.gaps || []).length;
    $('#gapsBody').innerHTML = (d.gaps || []).slice(0, 600).map((g) => `<tr><td><b>${esc(g.name)}</b></td><td>${esc(g.reason)}</td></tr>`).join('') || '<tr><td colspan="2" class="muted">No gaps.</td></tr>';
  }
  function renderStatus() {
    const el = $('#approvalStatus'); const ap = state.approved;
    const when = ap?.approvedAt ? new Date(Number(ap.approvedAt)).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' }) : '';
    if (state.view === 'live' && state.live) {
      if (ap && ap.fingerprint === state.live.fingerprint) { el.className = 'status ok'; el.innerHTML = `<i class="fa-solid fa-circle-check"></i> Matches the approved record (${esc(when)})`; }
      else if (ap) { el.className = 'status warn'; el.innerHTML = '<i class="fa-solid fa-rotate"></i> Records changed since approval: review, then re-approve'; }
      else { el.className = 'status warn'; el.innerHTML = `<i class="fa-solid fa-hourglass-half"></i> Awaiting Head Teacher approval${state.canApprove ? '' : ' (review only)'}`; }
    } else if (ap) { el.className = 'status ok'; el.innerHTML = `<i class="fa-solid fa-stamp"></i> Approved by ${esc(String(ap.approvedBy).split('@')[0])} · ${esc(when)} · code ${esc(ap.code)}`; }
    else { el.className = 'status none'; el.innerHTML = '<i class="fa-regular fa-circle"></i> Not analysed yet'; }
  }
  function renderAppreciation() {
    const q = L($('#apprSearch').value);
    const list = state.workers.filter((w) => !q || `${w.name} ${w.role}`.toLowerCase().includes(q));
    $('#apprGrid').innerHTML = list.length ? list.map((w) => `<div class="appr">${avatar(w.photoUrl, w.name)}<div><div class="w-name">${esc(w.name)}</div><div class="w-detail">${esc(w.role || 'Staff')}</div></div><button class="icon-btn" data-appr="${esc(w.key)}" title="Certificate"><i class="fa-solid fa-heart"></i></button></div>`).join('') : '<div class="empty">No active workers found.</div>';
  }

  // ---------- certificates ----------
  function certFromAward(a) {
    const ap = state.approved || {};
    const on = ap.approvedAt ? new Date(Number(ap.approvedAt)).toLocaleDateString('en-GB') : '';
    return { ...a, school: state.school, issuedDate: new Date(), footer: `VERIFIED BY SOMAP · CODE ${ap.code || ''} · APPROVED ${on}` };
  }
  function certAppreciation(w) { return { kind: 'appreciation', key: w.key, name: w.name, role: w.role, photoUrl: w.photoUrl, year: Number(state.year), school: state.school, issuedDate: new Date(), footer: '' }; }
  async function canvasFor(data) {
    const host = $('#sandbox');
    const { node } = await window.StaffCertDesigns.render(host, data);
    const c = await window.StaffCertDesigns.toCanvas(node);
    host.innerHTML = '';
    return c;
  }
  function newPdf() { if (!window.jspdf?.jsPDF) throw new Error('PDF engine still loading, try again.'); return new window.jspdf.jsPDF({ orientation: 'landscape', unit: 'pt', format: 'a4', compress: true }); }
  function addPage(pdf, c, first) { if (!first) pdf.addPage('a4', 'landscape'); pdf.addImage(c.toDataURL('image/jpeg', 0.93), 'JPEG', 0, 0, pdf.internal.pageSize.getWidth(), pdf.internal.pageSize.getHeight(), undefined, 'FAST'); }
  const safe = (s) => String(s || '').replace(/[^\w\s-]+/g, ' ').trim().replace(/\s+/g, '_');
  const fileName = (d) => `${safe(d.name)}_${d.kind === 'teacher' ? 'Best_Teacher' : d.kind === 'worker' ? 'Best_Worker' : 'Appreciation'}${d.position ? `_P${d.position}` : ''}_${d.year}.pdf`;
  async function downloadOne(d) { await loadSchool(); const c = await canvasFor(d); const pdf = newPdf(); addPage(pdf, c, true); pdf.save(fileName(d)); }
  async function bundle(list, label) {
    if (state.job.running || !list.length) { if (!list.length) toast('Nothing to download.', 'warn'); return; }
    await loadSchool();
    state.job = { running: true, cancelled: false };
    const pdf = newPdf(); let pages = 0;
    try {
      for (let i = 0; i < list.length; i += 1) {
        if (state.job.cancelled) break;
        progress('Creating certificates', i, list.length, `${list[i].name}…`);
        try { const c = await canvasFor(list[i]); addPage(pdf, c, pages === 0); pages += 1; c.width = 0; c.height = 0; } catch (e) { console.warn(e); }
        await pause(20);
      }
      if (pages && !state.job.cancelled) { progress('Creating certificates', list.length, list.length, 'Packing the PDF…'); await pause(20); pdf.save(`Staff_${label}_${state.year}.pdf`); toast(`${pages} certificates ready.`); }
    } finally { state.job.running = false; progress(null); }
  }
  async function preview(d) {
    const modal = $('#previewModal'); const stage = $('#previewStage');
    modal.classList.add('show'); modal._data = d;
    $('#previewTitle').textContent = `${d.name} · ${d.kind === 'teacher' ? 'Best Teacher' : d.kind === 'worker' ? 'Best Worker' : 'Appreciation'}${d.position ? ` · Position ${d.position}` : ''}`;
    stage.innerHTML = '<div style="color:#fff;padding:50px 0;display:flex;gap:10px;align-items:center"><span class="spinner"></span> Designing certificate…</div>';
    await loadSchool();
    const holder = document.createElement('div'); holder.style.cssText = 'position:fixed;left:-10000px;top:0;'; document.body.appendChild(holder);
    try {
      const { node } = await window.StaffCertDesigns.render(holder, d);
      if (modal._data !== d) return;
      const host = document.createElement('div'); host.className = 'preview-host'; host.appendChild(node);
      stage.innerHTML = ''; stage.appendChild(host);
      const fit = () => { const sc = Math.min(stage.clientWidth / 1123, (window.innerHeight * 0.78) / 794, 1); node.style.transformOrigin = 'top left'; node.style.transform = `scale(${sc})`; host.style.width = `${1123 * sc}px`; host.style.height = `${794 * sc}px`; };
      fit(); modal._fit = fit;
    } catch (e) { stage.innerHTML = `<div style="color:#fff">${esc(e?.message || 'Preview failed')}</div>`; } finally { holder.remove(); }
  }

  // ---------- wiring ----------
  function bind() {
    const sel = $('#yearSelect');
    sel.innerHTML = YEARS.map((y) => `<option value="${y}">${y}</option>`).join('');
    sel.value = state.year;
    sel.addEventListener('change', (e) => {
      state.year = e.target.value; window.somapYearContext?.setSelectedYear?.(state.year);
      state.live = null; state.approved = null; state.view = 'none';
      render(); loadWorkers(state.year).then(render); loadApproved().then(() => { if (!state.approved) analyse(); });
    });
    document.querySelectorAll('.tab').forEach((t) => t.addEventListener('click', () => {
      document.querySelectorAll('.tab').forEach((x) => x.classList.toggle('active', x === t));
      ['teachers', 'workers', 'appreciation'].forEach((k) => $(`#tab-${k}`).classList.toggle('hidden', t.dataset.tab !== k));
    }));
    $('#btnAnalyse').addEventListener('click', analyse);
    $('#btnApprove').addEventListener('click', approve);
    $('#btnDownloadAll').addEventListener('click', () => bundle((state.approved?.awards || []).map(certFromAward), 'Awards'));
    $('#btnApprAll').addEventListener('click', () => bundle(state.workers.map(certAppreciation), 'Appreciation'));
    $('#apprSearch').addEventListener('input', renderAppreciation);
    document.addEventListener('click', (e) => {
      const c = e.target.closest('[data-cert]');
      if (c && !c.disabled) { const a = (state.approved?.awards || []).find((x) => x.id === c.dataset.cert && String(x.position) === c.dataset.pos); if (a) preview(certFromAward(a)); return; }
      const ap = e.target.closest('[data-appr]');
      if (ap) { const w = state.workers.find((x) => x.key === ap.dataset.appr); if (w) preview(certAppreciation(w)); return; }
      const modal = $('#previewModal');
      if (e.target.closest('[data-preview-close]') || e.target === modal) { modal.classList.remove('show'); modal._data = null; return; }
      if (e.target.closest('[data-preview-download]') && modal._data) { downloadOne(modal._data).catch((err) => toast(err?.message || 'Download failed', 'error')); return; }
      if (e.target.closest('[data-cancel]')) state.job.cancelled = true;
    });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') $('#previewModal').classList.remove('show'); });
    window.addEventListener('resize', () => $('#previewModal')._fit?.());
  }

  document.addEventListener('DOMContentLoaded', () => {
    state.year = String(window.somapYearContext?.getSelectedYear?.() || sessionStorage.getItem('somap_selected_year') || new Date().getFullYear());
    bind(); render();
    auth.onAuthStateChanged(async (user) => {
      if (!user) { location.href = '../index.html'; return; }
      state.user = user;
      const ek = L(user.email).replace(/\./g, '_');
      state.role = L((await read(`users/${user.uid}/role`)) || (await read(`users/${ek}/role`)) || (await read(`staff/${user.uid}/role`)) || '');
      const isApproverEmail = APPROVER_EMAILS.has(L(user.email));
      if (!VIEW_ROLES.has(state.role) && !isApproverEmail) { alert('Staff awards are for school leadership only.'); location.href = 'graduation.html'; return; }
      state.canApprove = APPROVER_ROLES.has(state.role) || isApproverEmail;
      await loadSchool();
      loadWorkers(state.year).then(render);
      await loadApproved();
      if (!state.approved) analyse(); // nothing approved yet: analyse straight away, no extra click
      window.GradCertDesigns?.ensureFonts?.();
    });
  });
}());
