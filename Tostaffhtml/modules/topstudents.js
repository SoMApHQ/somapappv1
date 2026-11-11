/*
 * SoMAp Top Students (whole school, Baby Class → Class 7).
 *
 * Tab 1 — SoMAp data awards: annual academic results (shared/academic_annual.js — the
 * exact report-form formula) + class registers, ranked by shared/top_awards_engine.js.
 * The Head Teacher reviews every number, approves, and certificates print ONLY from the
 * approved snapshot (topAwards/{year}/approved) so reprints always match.
 *
 * Tab 2 — Teacher awards: unchanged data shape (awardsCategories/{year}, studentAwards/{year},
 * studentAwardsByStudent/{year}/{sid}/{awardId}). Paths go through SOMAP.P, so Socrates keeps
 * its legacy root data and every other school gets its own space.
 */
(function () {
  'use strict';
  const db = firebase.database();
  const auth = firebase.auth();
  const AA = window.SomapAcademicAnnual;
  const T = window.SomapTopAwards;

  const $ = (s) => document.querySelector(s);
  const L = (s) => String(s || '').trim().toLowerCase();
  const esc = (v) => String(v == null ? '' : v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

  const YEARS = Array.from({ length: 14 }, (_, i) => 2023 + i);
  const CLASS_ORDER = ['Baby Class', 'Middle Class', 'Pre-Unit', 'Class 1', 'Class 2', 'Class 3', 'Class 4', 'Class 5', 'Class 6', 'Class 7'];
  const ALLOWED_ROLES = new Set(['admin', 'head', 'headteacher', 'head teacher', 'academic', 'teacher', 'director', 'owner', 'principal']);
  const APPROVER_ROLES = new Set(['admin', 'head', 'headteacher', 'head teacher', 'director', 'owner', 'principal']);
  const APPROVER_EMAILS = new Set(['socratesschool2020@gmail.com', 'ssclass42023@gmail.com']);
  const EXCLUDED_STATUS = new Set(['shifted', 'graduated', 'archived', 'deleted', 'removed', 'inactive']);

  const state = {
    user: null, role: 'teacher', canApprove: false,
    year: String(new Date().getFullYear()),
    learners: [], learnerByKey: new Map(),
    live: null, approved: null, view: 'none', classFilter: '', gapFilter: '',
    categories: {}, awards: {}, picked: null, categoriesRef: null, awardsRef: null,
    school: null, job: { cancelled: false, running: false },
  };

  // ---------- small UI helpers ----------
  function toast(message, tone = 'ok', ms = 4200) {
    const node = $('#toast');
    node.textContent = message;
    node.style.background = tone === 'error' ? 'linear-gradient(135deg,#ef4444,#b91c1c)' : tone === 'warn' ? 'linear-gradient(135deg,#f59e0b,#d97706)' : 'linear-gradient(135deg,#10b981,#047857)';
    node.classList.add('show');
    clearTimeout(node._t);
    node._t = setTimeout(() => node.classList.remove('show'), ms);
  }
  function progress(title, done, total, sub) {
    const box = $('#progress');
    if (title == null) { box.classList.remove('show'); return; }
    box.classList.add('show');
    box.querySelector('[data-progress-title]').textContent = title;
    box.querySelector('[data-progress-text]').textContent = total ? `${done} / ${total}` : '';
    box.querySelector('[data-progress-bar]').style.width = `${total ? Math.round((done / total) * 100) : 0}%`;
    box.querySelector('[data-progress-sub]').textContent = sub || '';
  }
  const pause = (ms = 0) => new Promise((r) => setTimeout(r, ms));
  async function waitFor(test, ms = 8000) {
    const t0 = Date.now();
    while (!test()) { if (Date.now() - t0 > ms) return false; await pause(50); }
    return true;
  }

  // ---------- school / paths ----------
  function schoolId() {
    const id = window.SOMAP?.getSchool?.()?.id || localStorage.getItem('schoolId') || 'socrates-school';
    return id === 'socrates' ? 'socrates-school' : id;
  }
  function P(path) {
    const clean = String(path || '').replace(/^\/+/, '');
    try { if (window.SOMAP?.P) return window.SOMAP.P(clean); } catch (_) { /* no school yet */ }
    return schoolId() === 'socrates-school' ? clean : `schools/${schoolId()}/${clean}`;
  }
  async function read(path) {
    try { const snap = await db.ref(path).once('value'); return snap.exists() ? snap.val() : null; } catch (err) { console.warn('read failed', path, err?.message || err); return null; }
  }
  async function loadSchoolBrand() {
    if (state.school && state.school.id === schoolId()) return state.school;
    const id = schoolId();
    const profile = (await read(`schools/${id}/profile`)) || {};
    const isSocrates = id === 'socrates-school';
    const name = String(profile.name || profile.schoolName || window.SOMAP?.getSchool?.()?.name || (isSocrates ? 'Socrates School' : id)).trim();
    state.school = { id, name, tagline: String(profile.motto || profile.tagline || (isSocrates ? 'English Medium Pre & Primary School' : '')).trim(), logoUrl: String(profile.logoUrl || '').trim() };
    $('#schoolChip').textContent = name;
    return state.school;
  }

  // ---------- access ----------
  const emailKey = (email) => String(email || '').trim().toLowerCase().replace(/\./g, '_');
  async function resolveRole(user) {
    const tries = [`users/${user.uid}/role`, `users/${emailKey(user.email)}/role`, `staff/${user.uid}/role`, `teachers/${user.uid}/role`];
    for (const p of tries) {
      const v = await read(p);
      if (v) return L(v);
    }
    return 'teacher';
  }

  // ---------- year ----------
  function getYear() {
    const y = window.somapYearContext?.getSelectedYear?.() || sessionStorage.getItem('somap_selected_year') || new Date().getFullYear();
    return String(y);
  }
  function setYear(y) {
    window.somapYearContext?.setSelectedYear?.(String(y));
    try { sessionStorage.setItem('somap_selected_year', String(y)); } catch (_) {}
    state.year = String(y);
  }

  // ---------- subjects / classes (same helpers as the report form) ----------
  const Sub = () => window.SomapSubjects || {};
  const canonSubject = (s) => (Sub().canonSubject ? Sub().canonSubject(s) : s);
  function canonClass(name) {
    const noStream = String(name || '').trim().replace(/\s*\(([^)]+)\)\s*$/, '').trim();
    return String((Sub().canonClass ? Sub().canonClass(noStream) : noStream) || noStream || name || '').trim();
  }
  function subjectListForClass(className, year) {
    const api = Sub();
    const cls = api.canonClass ? api.canonClass(className) : className;
    const list = api.getSubjectsForClass ? api.getSubjectsForClass(cls, year) : [];
    return (Array.isArray(list) ? list : []).map((label) => canonSubject(label));
  }
  const classRank = (c) => { const i = CLASS_ORDER.indexOf(c); return i < 0 ? 99 : i; };

  // ---------- roster ----------
  async function loadRoster(year) {
    await waitFor(() => (window.SomapYearRoster || window.SomapFinance?.getFinanceRoster) && window.SomapSubjects);
    let rows = [];
    // Light roster: same class-year rule, without building the whole finance dataset.
    try { rows = await (window.SomapYearRoster ? window.SomapYearRoster.getYearRoster(year) : window.SomapFinance.getFinanceRoster(year)); } catch (err) { console.warn('roster failed', err); }
    const learners = [];
    (rows || []).forEach((row) => {
      const raw = row.rawStudent || {};
      if (row.isGraduated || EXCLUDED_STATUS.has(L(row.status))) return;
      const className = canonClass(row.classLevel || row.className);
      if (!className || ['graduated', 'pre-admission', 'n/a'].includes(L(className))) return;
      const name = String(row.fullName || '').replace(/\s+/g, ' ').trim();
      if (!name) return;
      learners.push({
        key: row.id, id: row.id, admissionNo: String(row.admissionNumber || row.id || ''), name, className, rawClass: String(row.classLevel || row.className || ''),
        photoUrl: raw.passportPhotoUrl || raw.passportPhotoURL || raw.photoUrl || raw.passportUrl || raw.photo || '',
        phone: row.parentContact || raw.motherPhone || raw.parentPhone || raw.primaryParentContact || '',
        lookupKeys: [row.id, row.admissionNumber, raw.admissionNumber, raw.admissionNo].filter(Boolean),
      });
    });
    learners.sort((a, b) => classRank(a.className) - classRank(b.className) || a.name.localeCompare(b.name));
    state.learners = learners;
    state.learnerByKey = new Map(learners.map((l) => [l.key, l]));
    $('#statLearners').textContent = learners.length;
    return learners;
  }

  // ---------- analysis ----------
  function monthsForAttendance(year) {
    const now = new Date();
    const y = Number(year);
    const last = y < now.getFullYear() ? 12 : y > now.getFullYear() ? 0 : now.getMonth() + 1;
    return Array.from({ length: last }, (_, i) => `${y}-${String(i + 1).padStart(2, '0')}`);
  }
  function untilIso(year) {
    const now = new Date();
    return Number(year) < now.getFullYear() ? `${year}-12-31` : now.toISOString().slice(0, 10);
  }

  async function analyse() {
    if (state.job.running) return;
    state.job = { cancelled: false, running: true };
    const year = state.year;
    const btn = $('#btnAnalyse');
    btn.disabled = true;
    try {
      progress('Analysing', 0, 0, 'Loading the class lists…');
      await loadSchoolBrand();
      const learners = await loadRoster(year);
      if (!learners.length) throw new Error(`No active learners found for ${year}.`);
      progress('Analysing', 0, 0, 'Loading the subject lists used by report forms…');
      await AA.loadCustomSubjectsForYear(year, { api: Sub(), readScopedOrLegacy: (p) => read(P(p)), readLegacy: (p) => read(p) });

      const byClass = new Map();
      learners.forEach((l) => { if (!byClass.has(l.className)) byClass.set(l.className, []); byClass.get(l.className).push(l); });
      const classes = Array.from(byClass.keys()).sort((a, b) => classRank(a) - classRank(b) || a.localeCompare(b));
      const months = monthsForAttendance(year);
      const academicInput = [];
      const attendanceInput = [];
      const warnings = [];

      // Classes run 4 at a time (results kept in class order).
      let done = 0;
      const perClass = new Array(classes.length);
      let next = 0;
      const worker = async () => {
        while (next < classes.length) {
          if (state.job.cancelled) return;
          const i = next++;
          const cls = classes[i];
          const roster = byClass.get(cls);
          const [annual, days] = await Promise.all([
            AA.computeClassAnnual({ className: cls, classSubjects: subjectListForClass(cls, year), readRoot: (cand) => read(P(`scores/${year}/${cand}`)), roster, canonicalSubjectName: canonSubject, registry: [] }),
            loadClassAttendance(cls, roster, months),
          ]);
          perClass[i] = { cls, roster, annual, days };
          done += 1;
          progress('Analysing', done, classes.length, `${cls}: annual results and registers ready`);
        }
      };
      progress('Analysing', 0, classes.length, 'Annual results and registers for every class…');
      await Promise.all([worker(), worker(), worker(), worker()]);
      if (state.job.cancelled) throw new Error('Analysis cancelled.');
      perClass.forEach(({ cls, roster, annual, days }) => {
        if (!annual.records.length) warnings.push(`<b>${esc(cls)}</b>: no exam results found for ${esc(year)} (January – November).`);
        academicInput.push({ className: cls, students: roster.map((l) => ({ key: l.key, name: l.name, admissionNo: l.admissionNo, photoUrl: l.photoUrl, annual: annual.students[l.key] })) });
        attendanceInput.push({ className: cls, students: roster.map((l) => ({ key: l.key, name: l.name, admissionNo: l.admissionNo, photoUrl: l.photoUrl })), days });
      });

      progress('Analysing', classes.length, classes.length, 'Ranking…');
      const until = untilIso(year);
      const academic = T.computeAcademicAwards(academicInput);
      const attendance = T.computeAttendanceAwards(attendanceInput, { until });
      const maxDays = Math.max(0, ...Object.values(attendance.classInfo).map((c) => c.registerDays || 0));
      Object.entries(attendance.classInfo).forEach(([cls, info]) => {
        if (!info.registerDays) warnings.push(`<b>${esc(cls)}</b>: no class register found for ${esc(year)}, so no attendance awards for this class.`);
        else if (maxDays && info.registerDays < maxDays * 0.8) warnings.push(`<b>${esc(cls)}</b>: only ${info.registerDays} register days, while other classes have up to ${maxDays}. Check for missing registers before approving.`);
      });
      state.live = buildResult({ year, until, academic, attendance, warnings, learners: learners.length, classes });
      state.view = 'live';
      render();
      toast(`Analysis complete: ${state.live.awards.length} awards, ${state.live.gaps.length} data gaps.`);
    } catch (err) {
      console.error(err);
      toast(err?.message || 'Analysis failed', 'error', 7000);
    } finally {
      state.job.running = false;
      btn.disabled = false;
      progress(null);
    }
  }

  async function loadClassAttendance(cls, roster, months) {
    const keys = new Set([cls, ...roster.map((l) => l.rawClass).filter(Boolean), ...AA.getClassCandidates(cls)]);
    if (cls === 'Pre-Unit') ['Pre Unit Class', 'Pre Unit', 'PreUnit', 'Pre-Unit Class'].forEach((k) => keys.add(k));
    const lookup = new Map();
    roster.forEach((l) => l.lookupKeys.forEach((k) => AA.keyFingerprints(k).forEach((fp) => { if (!lookup.has(fp)) lookup.set(fp, l.key); })));
    const toLearner = (stuId) => {
      for (const fp of AA.keyFingerprints(stuId)) if (lookup.has(fp)) return lookup.get(fp);
      return null;
    };
    const days = {};
    const reads = [];
    keys.forEach((k) => months.forEach((m) => reads.push(read(P(`attendance/${k}/${m}`)))));
    const results = await Promise.all(reads);
    results.forEach((monthNode) => {
      Object.entries(monthNode || {}).forEach(([date, recs]) => {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !recs || typeof recs !== 'object') return;
        days[date] = days[date] || {};
        Object.entries(recs).forEach(([stuId, rec]) => {
          const key = toLearner(stuId);
          if (key && !days[date][key]) days[date][key] = rec;
        });
        if (!Object.keys(days[date]).length) {
          // register exists but no learner matched — still a register day for the class
          days[date].__register__ = Object.values(recs).find((r) => T.sessionsFromRecord(r)) || null;
        }
      });
    });
    return days;
  }

  function buildResult({ year, until, academic, attendance, warnings, learners, classes }) {
    const awards = [];
    const sinceLabel = (iso) => (iso ? new Date(`${iso}T00:00:00`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '');
    const push = (type, scope, list, extra) => (list || []).forEach((w) => awards.push({
      id: [type, scope, extra.group || extra.className || '', extra.subject || '', w.key].join('|'),
      type, scope, position: w.position, key: w.key, name: w.name, admissionNo: w.admissionNo || '', photoUrl: w.photoUrl || '',
      className: w.className || extra.className || '', subject: extra.subject || w.subject || '', group: extra.group || '', groupLabel: extra.group ? T.GROUP_LABELS[extra.group] : '',
      score: T.roundScore(w.score), detail: w.detail || '', present: w.present ?? null, recorded: w.recorded ?? null,
      since: w.since ? sinceLabel(w.since) : '', until: sinceLabel(until), year: Number(year),
    }));
    ['primary', 'prePrimary'].forEach((g) => {
      push('overall', 'school', academic.schoolOverall[g], { group: g });
      Object.entries(academic.schoolSubject[g] || {}).forEach(([sub, list]) => push('subject', 'school', list, { group: g, subject: sub }));
    });
    push('attendance', 'school', attendance.school, {});
    classes.forEach((cls) => {
      push('overall', 'class', academic.classOverall[cls], { className: cls });
      push('attendance', 'class', attendance.classAwards[cls], { className: cls });
      Object.entries(academic.classSubject[cls] || {}).forEach(([sub, list]) => push('subject', 'class', list, { className: cls, subject: sub }));
    });
    const gaps = academic.gaps.concat(attendance.gaps);
    return { year: Number(year), until, computedAt: Date.now(), awards, gaps, warnings, learners, classes, classInfo: { academic: academic.classInfo, attendance: attendance.classInfo }, fingerprint: fingerprint(awards) };
  }

  function fingerprint(awards) {
    const text = awards.map((a) => `${a.id}:${a.position}:${a.score}`).sort().join(';');
    let h = 0x811c9dc5;
    for (let i = 0; i < text.length; i += 1) { h ^= text.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
    return h.toString(36).toUpperCase();
  }

  // ---------- approval ----------
  async function loadApproved() {
    state.approved = await read(P(`topAwards/${state.year}/approved`));
    if (state.approved && !Array.isArray(state.approved.awards)) state.approved.awards = Object.values(state.approved.awards || {});
    if (state.approved && !state.live) state.view = 'approved';
    render();
  }

  async function approve() {
    if (!state.canApprove) { toast('Only the Head Teacher (or an administrator) can approve awards.', 'warn'); return; }
    const live = state.live;
    if (!live) return;
    if (!window.confirm(`Approve ${live.awards.length} awards for ${live.year}?\n\nCertificates will print from this approved record. If results change later, analyse again and re-approve.`)) return;
    const code = `TA${String(live.year).slice(-2)}-${live.fingerprint.slice(0, 5)}`;
    const snapshot = {
      year: live.year, until: live.until, computedAt: live.computedAt, approvedAt: firebase.database.ServerValue.TIMESTAMP,
      approvedBy: state.user?.email || state.user?.uid || 'unknown', approvedByRole: state.role, code, fingerprint: live.fingerprint,
      learners: live.learners, gapsCount: live.gaps.length, warnings: live.warnings,
      rules: { ranking: 'shared positions, next score next number', rankDecimals: T.RANK_DECIMALS, minExamShare: T.MIN_EXAM_SHARE, subjectSatShare: T.SUBJECT_SAT_SHARE, attendance: 'AM+PM sessions present / sessions recorded', groups: T.GROUP_LABELS, academicSource: 'Report form Annual (Jan–Nov), shared/academic_annual.js' },
      awards: live.awards,
      classes: live.classes,
      classInfo: live.classInfo,
      gaps: live.gaps.slice(0, 1500),
    };
    try {
      await db.ref(P(`topAwards/${live.year}/approved`)).set(snapshot);
      await db.ref(P(`topAwards/${live.year}/history`)).push({ ...snapshot, gaps: null });
      toast('Approved. Certificates are ready to download.');
      await loadApproved();
      state.view = 'approved';
      render();
    } catch (err) {
      console.error(err);
      toast(err?.message || 'Approval failed', 'error');
    }
  }

  // ---------- rendering (review screen) ----------
  function current() { return state.view === 'approved' ? state.approved : state.live; }
  const isApprovedAward = (a) => Boolean(state.approved?.awards?.some((x) => x.id === a.id && x.position === a.position));

  function winnerRow(a) {
    const initials = a.name.split(/\s+/).slice(0, 2).map((p) => p[0] || '').join('').toUpperCase();
    const approved = isApprovedAward(a);
    return `<div class="winner">
      <div class="pos p${a.position}">${a.position}</div>
      <div class="ava">${a.photoUrl ? `<img src="${esc(a.photoUrl)}" alt="" loading="lazy" onerror="this.remove()">` : ''}<span>${esc(initials)}</span></div>
      <div><div class="w-name">${esc(a.name)}</div><div class="w-detail">${a.scope === 'school' ? `${esc(a.className)} · ` : ''}${esc(a.detail)}</div></div>
      <button class="icon-btn" data-cert="${esc(a.id)}" ${approved ? '' : 'disabled title="Approve first"'} title="Certificate"><i class="fa-solid fa-award"></i></button>
    </div>`;
  }
  function card(title, small, list, accent) {
    return `<div class="card" style="--accent:${accent}"><div class="card-title"><b>${title}</b><small>${small || ''}</small></div>
      ${list.length ? list.map(winnerRow).join('') : '<div class="empty">No eligible learners yet.</div>'}</div>`;
  }
  const SUBJECT_ACCENT = (s) => window.AwardCertDesigns?.themeForSubject?.(s)?.main || '#1e3a8a';

  function render() {
    $('#yearTitle').textContent = state.year;
    $('#yearTitle2').textContent = state.year;
    const data = current();
    renderStatus();
    $('#btnApprove').classList.toggle('hidden', !(state.view === 'live' && state.live && state.canApprove));
    $('#btnDownloadAll').disabled = !state.approved?.awards?.length;
    const wrap = $('#resultsWrap');
    if (!data) { wrap.classList.add('hidden'); $('#warnings').innerHTML = ''; $('#statAwards').textContent = '–'; $('#statGaps').textContent = '–'; return; }
    wrap.classList.remove('hidden');
    $('#statAwards').textContent = data.awards.length;
    $('#statGaps').textContent = data.gapsCount ?? data.gaps?.length ?? 0;
    if (data.learners) $('#statLearners').textContent = data.learners;
    $('#warnings').innerHTML = data.warnings?.length ? `<div class="notice warn"><b><i class="fa-solid fa-circle-exclamation"></i> Check before approving</b><ul>${data.warnings.map((w) => `<li>${w}</li>`).join('')}</ul></div>` : '';

    const A = data.awards;
    const pick = (fn) => A.filter(fn).sort((a, b) => a.position - b.position || a.name.localeCompare(b.name));
    const school = [];
    [['primary', 'Primary (Class 1 – 7)'], ['prePrimary', 'Pre-Primary']].forEach(([g, label]) => {
      const list = pick((a) => a.type === 'overall' && a.scope === 'school' && a.group === g);
      if (list.length) school.push(card(`<i class="fa-solid fa-crown" style="color:#c99a3a"></i> Overall · ${label}`, 'annual average', list, '#0f1f45'));
    });
    const att = pick((a) => a.type === 'attendance' && a.scope === 'school');
    school.push(card('<i class="fa-solid fa-sun" style="color:#d97706"></i> Attendance · whole school', `1 Jan → ${esc(data.until)}`, att, '#b45309'));
    ['primary', 'prePrimary'].forEach((g) => {
      const subs = Array.from(new Set(A.filter((a) => a.type === 'subject' && a.scope === 'school' && a.group === g).map((a) => a.subject))).sort();
      subs.forEach((s) => school.push(card(`${esc(s)} · ${g === 'primary' ? 'Primary' : 'Pre-Primary'}`, 'whole school', pick((a) => a.type === 'subject' && a.scope === 'school' && a.group === g && a.subject === s), SUBJECT_ACCENT(s))));
    });
    $('#schoolGrid').innerHTML = school.join('');

    const classes = data.classes || Array.from(new Set(A.map((a) => a.className))).sort((a, b) => classRank(a) - classRank(b));
    if (!state.classFilter || !classes.includes(state.classFilter)) state.classFilter = classes[0] || '';
    $('#classChips').innerHTML = classes.map((c) => `<button class="chip ${c === state.classFilter ? 'active' : ''}" data-class="${esc(c)}">${esc(c)}</button>`).join('');
    const c = state.classFilter;
    const info = data.classInfo?.academic?.[c];
    const cards = [
      card(`<i class="fa-solid fa-star" style="color:#c99a3a"></i> Overall · ${esc(c)}`, info ? `${info.classExams} exams · needs ${info.needExams}` : '', pick((a) => a.type === 'overall' && a.scope === 'class' && a.className === c), '#1e2f5c'),
      card(`<i class="fa-solid fa-calendar-check" style="color:#d97706"></i> Attendance · ${esc(c)}`, `${data.classInfo?.attendance?.[c]?.registerDays ?? '–'} register days`, pick((a) => a.type === 'attendance' && a.scope === 'class' && a.className === c), '#b45309'),
    ];
    const subs = Array.from(new Set(A.filter((a) => a.type === 'subject' && a.scope === 'class' && a.className === c).map((a) => a.subject))).sort();
    subs.forEach((s) => cards.push(card(esc(s), esc(c), pick((a) => a.type === 'subject' && a.scope === 'class' && a.className === c && a.subject === s), SUBJECT_ACCENT(s))));
    $('#classGrid').innerHTML = cards.join('');
    renderGaps(data);
  }

  function renderStatus() {
    const el = $('#approvalStatus');
    const ap = state.approved;
    const when = ap?.approvedAt ? new Date(Number(ap.approvedAt)).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' }) : '';
    if (state.view === 'live' && state.live) {
      if (ap && ap.fingerprint === state.live.fingerprint) { el.className = 'status ok'; el.innerHTML = `<i class="fa-solid fa-circle-check"></i> Matches the approved record (${esc(when)})`; }
      else if (ap) { el.className = 'status warn'; el.innerHTML = '<i class="fa-solid fa-rotate"></i> Results changed since the last approval. Review, then re-approve.'; }
      else { el.className = 'status warn'; el.innerHTML = `<i class="fa-solid fa-hourglass-half"></i> Awaiting Head Teacher approval${state.canApprove ? '' : ' (you can review only)'}`; }
    } else if (ap) {
      el.className = 'status ok'; el.innerHTML = `<i class="fa-solid fa-stamp"></i> Approved by ${esc(String(ap.approvedBy).split('@')[0])} · ${esc(when)} · code ${esc(ap.code)}`;
    } else { el.className = 'status none'; el.innerHTML = '<i class="fa-regular fa-circle"></i> Not analysed yet'; }
  }

  function renderGaps(data) {
    const gaps = data.gaps || [];
    $('#gapCount').textContent = data.gapsCount ?? gaps.length;
    const classes = Array.from(new Set(gaps.map((g) => g.className))).sort((a, b) => classRank(a) - classRank(b));
    $('#gapChips').innerHTML = ['', ...classes].map((c) => `<button class="chip ${c === state.gapFilter ? 'active' : ''}" data-gap-class="${esc(c)}">${c ? esc(c) : 'All classes'}</button>`).join('');
    const rows = gaps.filter((g) => !state.gapFilter || g.className === state.gapFilter).slice(0, 800);
    $('#gapsBody').innerHTML = rows.length ? rows.map((g) => `<tr><td>${esc(g.name)}</td><td>${esc(g.className)}</td><td>${esc(g.reason)}</td></tr>`).join('') : '<tr><td colspan="3" class="muted">No gaps. Every learner has complete records.</td></tr>';
  }

  // ---------- certificates ----------
  function certData(award) {
    const ap = state.approved || {};
    const approvedOn = ap.approvedAt ? new Date(Number(ap.approvedAt)).toLocaleDateString('en-GB') : '';
    return { ...award, school: state.school, issuedDate: new Date(), footer: `VERIFIED BY SOMAP · CODE ${ap.code || ''} · APPROVED ${approvedOn}` };
  }
  function manualCertData(aw) {
    return {
      type: 'manual', scope: aw.scope, position: Number(aw.rank) || 0, categoryName: aw.categoryName, className: aw.className || '',
      name: aw.studentName, photoUrl: aw.photoUrl || '', admissionNo: aw.admissionNumber || '', year: Number(state.year),
      school: state.school, issuedDate: new Date(), footer: `SOMAP · TEACHER AWARD · ADM ${aw.admissionNumber || ''}`,
    };
  }
  async function renderToCanvas(data) {
    const host = $('#sandbox');
    const { node } = await window.AwardCertDesigns.render(host, data);
    const canvas = await window.AwardCertDesigns.toCanvas(node);
    host.innerHTML = '';
    return canvas;
  }
  function newPdf() {
    if (!window.jspdf?.jsPDF) throw new Error('PDF engine is still loading. Try again in a moment.');
    return new window.jspdf.jsPDF({ orientation: 'landscape', unit: 'pt', format: 'a4', compress: true });
  }
  function addPage(pdf, canvas, first) {
    if (!first) pdf.addPage('a4', 'landscape');
    pdf.addImage(canvas.toDataURL('image/jpeg', 0.93), 'JPEG', 0, 0, pdf.internal.pageSize.getWidth(), pdf.internal.pageSize.getHeight(), undefined, 'FAST');
  }
  const fileSafe = (s) => String(s || '').replace(/[^\w\s-]+/g, ' ').trim().replace(/\s+/g, '_');
  function certFileName(d) {
    const what = d.type === 'manual' ? d.categoryName : d.type === 'subject' ? d.subject : d.type === 'attendance' ? 'Attendance' : 'Overall';
    return `${fileSafe(d.name)}_${fileSafe(what)}_P${d.position || ''}_${d.year}.pdf`;
  }
  async function downloadOne(data) {
    await loadSchoolBrand();
    const canvas = await renderToCanvas(data);
    const pdf = newPdf();
    addPage(pdf, canvas, true);
    pdf.save(certFileName(data));
  }
  async function downloadBundle(list, label) {
    if (state.job.running) return;
    if (!list.length) { toast('Nothing to download.', 'warn'); return; }
    await loadSchoolBrand();
    state.job = { cancelled: false, running: true };
    const pdf = newPdf();
    let pages = 0;
    try {
      for (let i = 0; i < list.length; i += 1) {
        if (state.job.cancelled) break;
        progress('Creating certificates', i, list.length, `${list[i].name}…`);
        try {
          const canvas = await renderToCanvas(list[i]);
          addPage(pdf, canvas, pages === 0);
          pages += 1;
          canvas.width = 0; canvas.height = 0;
        } catch (err) { console.warn('certificate failed', list[i], err); }
        await pause(20);
      }
      if (pages && !state.job.cancelled) {
        progress('Creating certificates', list.length, list.length, 'Packing the PDF…');
        await pause(20);
        pdf.save(`Top_Students_${label}_${state.year}.pdf`);
        toast(`${pages} certificates ready.`);
      }
    } finally {
      state.job.running = false;
      progress(null);
    }
  }
  async function preview(data) {
    const modal = $('#previewModal');
    const stage = $('#previewStage');
    modal.classList.add('show');
    modal._data = data;
    $('#previewTitle').textContent = `${data.name} · ${data.type === 'manual' ? data.categoryName : data.type === 'subject' ? data.subject : data.type === 'attendance' ? 'Attendance' : 'Overall'} · Position ${data.position}`;
    stage.innerHTML = '<div style="color:#fff;padding:50px 0;display:flex;gap:10px;align-items:center"><span class="spinner"></span> Designing certificate…</div>';
    await loadSchoolBrand();
    const holder = document.createElement('div');
    holder.style.cssText = 'position:fixed;left:-10000px;top:0;';
    document.body.appendChild(holder);
    try {
      const { node } = await window.AwardCertDesigns.render(holder, data);
      if (modal._data !== data) return;
      const host = document.createElement('div');
      host.className = 'preview-host';
      host.appendChild(node);
      stage.innerHTML = '';
      stage.appendChild(host);
      const fit = () => {
        const scale = Math.min(stage.clientWidth / 1123, (window.innerHeight * 0.78) / 794, 1);
        node.style.transformOrigin = 'top left';
        node.style.transform = `scale(${scale})`;
        host.style.width = `${1123 * scale}px`;
        host.style.height = `${794 * scale}px`;
      };
      fit();
      modal._fit = fit;
    } catch (err) {
      stage.innerHTML = `<div style="color:#fff">${esc(err?.message || 'Preview failed')}</div>`;
    } finally { holder.remove(); }
  }

  // ---------- teacher awards (data shape unchanged) ----------
  function attachManualListeners(y) {
    if (state.categoriesRef) state.categoriesRef.off();
    if (state.awardsRef) state.awardsRef.off();
    state.categoriesRef = db.ref(P(`awardsCategories/${y}`));
    state.categoriesRef.on('value', (snap) => { state.categories = snap.val() || {}; renderCategories(); });
    state.awardsRef = db.ref(P(`studentAwards/${y}`));
    state.awardsRef.on('value', (snap) => { state.awards = snap.val() || {}; renderAwardsTable(); });
  }
  function renderCategories() {
    const entries = Object.entries(state.categories || {});
    $('#categoriesWrap').innerHTML = entries.length ? entries.map(([, c]) => `<span class="cat-chip">${esc(c.name)}</span>`).join('') : '<span class="muted">No categories yet. Add one to get started.</span>';
    $('#awardCategory').innerHTML = entries.length ? entries.map(([id, c]) => `<option value="${esc(id)}">${esc(c.name)}</option>`).join('') : '<option value="">Add a category first</option>';
  }
  function renderAwardsTable() {
    const filter = L($('#filterText').value);
    const entries = Object.entries(state.awards || {}).sort(([, a], [, b]) => (b.createdAt || 0) - (a.createdAt || 0))
      .filter(([, aw]) => !filter || `${aw.studentName || ''} ${aw.categoryName || ''} ${aw.className || ''}`.toLowerCase().includes(filter));
    $('#statManual').textContent = Object.keys(state.awards || {}).length;
    $('#awardsTbody').innerHTML = entries.length ? entries.map(([id, aw]) => `<tr>
      <td><b>${esc(aw.studentName || '—')}</b><div class="muted">${esc(aw.admissionNumber || '')}</div></td>
      <td>${esc(aw.categoryName || '—')}</td><td>${aw.scope === 'school' ? 'Whole school' : 'Class'}</td><td>${esc(aw.className || '—')}</td>
      <td><span class="pos p${Math.min(3, Number(aw.rank) || 3)}" style="width:28px;height:28px;font-size:.8rem">${esc(aw.rank || '—')}</span></td>
      <td class="muted">${esc(String(aw.createdByEmail || aw.createdByUid || '—').split('@')[0])}</td>
      <td style="white-space:nowrap"><button class="icon-btn" data-manual="prev" data-id="${esc(id)}" title="Preview"><i class="fa-regular fa-eye"></i></button>
        <button class="icon-btn" data-manual="pdf" data-id="${esc(id)}" title="PDF"><i class="fa-solid fa-download"></i></button>
        <button class="icon-btn" data-manual="del" data-id="${esc(id)}" title="Delete" style="color:#be123c"><i class="fa-solid fa-trash"></i></button></td></tr>`).join('')
      : '<tr><td colspan="7" class="muted">No teacher awards yet.</td></tr>';
  }
  function handleStudentSearch() {
    const q = L($('#studentSearch').value);
    const box = $('#studentPick');
    state.picked = null;
    if (q.length < 2) { box.innerHTML = ''; return; }
    const items = state.learners.filter((l) => `${l.name} ${l.admissionNo} ${l.phone}`.toLowerCase().includes(q)).slice(0, 8);
    box.innerHTML = items.length ? items.map((l) => `<button type="button" data-pick="${esc(l.key)}">${esc(l.name)} · ${esc(l.className)} · ${esc(l.admissionNo)}</button>`).join('') : '<span class="muted">No match.</span>';
  }
  async function createAward() {
    const cid = $('#awardCategory').value;
    const scope = $('#awardScope').value;
    const cls = scope === 'class' ? $('#awardClass').value : null;
    const rank = Number($('#awardRank').value || 1);
    const categoryName = state.categories[cid]?.name;
    if (!cid || !categoryName) { toast('Please choose a category.', 'warn'); return; }
    if (!state.picked) { toast('Please search and pick a learner.', 'warn'); return; }
    const l = state.picked;
    const d = {
      categoryId: cid, categoryName, scope, className: cls, rank,
      studentId: l.id, studentName: l.name, admissionNumber: l.admissionNo, phone: l.phone, photoUrl: l.photoUrl,
      createdByUid: state.user?.uid || '', createdByEmail: state.user?.email || '', createdAt: Date.now(),
    };
    const y = state.year;
    const ref = db.ref(P(`studentAwards/${y}`)).push();
    await ref.set(d);
    await db.ref(P(`studentAwardsByStudent/${y}/${l.id}/${ref.key}`)).set(true);
    toast('Award saved. Downloading certificate…');
    $('#studentSearch').value = ''; $('#studentPick').innerHTML = ''; state.picked = null;
    await downloadOne(manualCertData(d)).catch((err) => toast(err?.message || 'Certificate failed', 'error'));
  }

  // ---------- wiring ----------
  function bind() {
    const sel = $('#yearSelect');
    sel.innerHTML = YEARS.map((y) => `<option value="${y}">${y}</option>`).join('');
    sel.value = state.year;
    sel.addEventListener('change', async (e) => {
      setYear(e.target.value);
      state.live = null; state.approved = null; state.view = 'none';
      render();
      attachManualListeners(state.year);
      loadRoster(state.year);
      loadApproved();
    });
    document.querySelectorAll('.tab').forEach((t) => t.addEventListener('click', () => {
      document.querySelectorAll('.tab').forEach((x) => x.classList.toggle('active', x === t));
      $('#tab-data').classList.toggle('hidden', t.dataset.tab !== 'data');
      $('#tab-manual').classList.toggle('hidden', t.dataset.tab !== 'manual');
    }));
    $('#btnAnalyse').addEventListener('click', analyse);
    $('#btnApprove').addEventListener('click', approve);
    $('#btnDownloadAll').addEventListener('click', () => downloadBundle((state.approved?.awards || []).map(certData), 'Approved'));
    $('#awardScope').addEventListener('change', (e) => { $('#awardClass').disabled = e.target.value !== 'class'; });
    $('#awardClass').disabled = true;
    $('#btnAddCategory').addEventListener('click', async () => {
      const name = $('#newCategoryName').value.trim();
      if (!name) return;
      await db.ref(P(`awardsCategories/${state.year}`)).push().set({ name, createdBy: state.user?.email || state.user?.uid || 'staff', createdAt: Date.now() });
      $('#newCategoryName').value = '';
    });
    $('#studentSearch').addEventListener('input', handleStudentSearch);
    $('#btnCreateAward').addEventListener('click', () => createAward().catch((err) => toast(err?.message || 'Could not save award', 'error')));
    $('#filterText').addEventListener('input', renderAwardsTable);
    $('#btnBulkPdf').addEventListener('click', () => downloadBundle(Object.values(state.awards || {}).map(manualCertData), 'Teacher_Awards'));

    document.addEventListener('click', (e) => {
      const chip = e.target.closest('[data-class]');
      if (chip) { state.classFilter = chip.dataset.class; render(); return; }
      const gchip = e.target.closest('[data-gap-class]');
      if (gchip) { state.gapFilter = gchip.dataset.gapClass; renderGaps(current() || { gaps: [] }); return; }
      const certBtn = e.target.closest('[data-cert]');
      if (certBtn && !certBtn.disabled) {
        const a = state.approved?.awards?.find((x) => x.id === certBtn.dataset.cert);
        if (a) preview(certData(a));
        return;
      }
      const pick = e.target.closest('[data-pick]');
      if (pick) {
        state.picked = state.learnerByKey.get(pick.dataset.pick) || null;
        if (state.picked) {
          $('#studentPick').innerHTML = `<span class="muted">Picked: <b>${esc(state.picked.name)}</b> (${esc(state.picked.admissionNo)})</span>`;
          const opt = Array.from($('#awardClass').options).find((o) => canonClass(o.value) === state.picked.className);
          if (opt) $('#awardClass').value = opt.value;
        }
        return;
      }
      const man = e.target.closest('[data-manual]');
      if (man) {
        const aw = state.awards[man.dataset.id];
        if (!aw) return;
        if (man.dataset.manual === 'del') {
          if (!window.confirm(`Delete the award for ${aw.studentName}?`)) return;
          db.ref(P(`studentAwards/${state.year}/${man.dataset.id}`)).remove();
          if (aw.studentId) db.ref(P(`studentAwardsByStudent/${state.year}/${aw.studentId}/${man.dataset.id}`)).remove();
          return;
        }
        if (man.dataset.manual === 'prev') preview(manualCertData(aw));
        else downloadOne(manualCertData(aw)).catch((err) => toast(err?.message || 'Certificate failed', 'error'));
        return;
      }
      const modal = $('#previewModal');
      if (e.target.closest('[data-preview-close]') || e.target === modal) { modal.classList.remove('show'); modal._data = null; return; }
      if (e.target.closest('[data-preview-download]') && modal._data) {
        downloadOne(modal._data).catch((err) => toast(err?.message || 'Download failed', 'error'));
        return;
      }
      if (e.target.closest('[data-cancel]')) state.job.cancelled = true;
    });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') $('#previewModal').classList.remove('show'); });
    window.addEventListener('resize', () => $('#previewModal')._fit?.());
  }

  document.addEventListener('DOMContentLoaded', () => {
    state.year = getYear();
    bind();
    render();
    auth.onAuthStateChanged(async (user) => {
      if (!user) { location.href = '../index.html'; return; }
      state.user = user;
      state.role = await resolveRole(user);
      if (!ALLOWED_ROLES.has(state.role) && !APPROVER_EMAILS.has(L(user.email))) {
        alert('Access denied.');
        location.href = '../index.html';
        return;
      }
      state.canApprove = APPROVER_ROLES.has(state.role) || APPROVER_EMAILS.has(L(user.email));
      await loadSchoolBrand();
      attachManualListeners(state.year);
      loadApproved().then(() => { if (!state.approved) analyse(); }); // no extra click needed
      loadRoster(state.year);
      window.GradCertDesigns?.ensureFonts?.();
    });
  });
}());
