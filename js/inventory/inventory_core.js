// SoMAp Daily Inventory ("Docket" / Dhamana) — shared core.
//
// Every worker reports, once per working day, the things they are responsible
// for in their docket area. The Head Teacher confirms the reports (approval by
// exception: clean reports in one tap, the rest one by one). Nothing here ever
// creates fines or deductions — inventory only records; management decides.
//
// All data lives under the worker's home school and the year of the report
// date (same convention as workerAttendance):
//   {school prefix}years/{Y}/inventoryDocket/
//     settings                         pilot mode, spot checks, thresholds
//     templates/{roleKey}              admin overrides {items:{id:def}, removed:{id:true}}
//     dockets/{workerId}               area, custom items, latest/prior/lastApproved report,
//                                      ledger (accepted movements), openRepairs, incoming/outgoing
//     reports/{ymd}/{workerId}         daily report (draft→submitted→approved | returned)
//     drafts/{ymd}/{workerId}          autosaved, not yet submitted form
//     movements/{ymd}/{id}             transfer | stockIn | writeOff
//     movementIndex/{id}               ymd of a movement
//     pendingApprovals/{id}            write-offs waiting for the Head Teacher
//     repairs/{id}                     repair tickets
//     flags/{ymd}/{id}                 automatic inconsistency flags
//     spotChecks/{ymd}/{id}            management spot checks
//     spotPlan/{weekMonday}            random weekly spot-check picks (management only)
//     discrepancies/{workerId}/{id}    spot-check contradictions (accountability record)
//     seen/{ymd}/{workerId_itemId}     guard "Nimeona taarifa"
//     handovers/{id}                   guard shift handovers and worker-change handovers
//     summaries/{ymd}                  school totals written on approval
//     metrics/{ymd}/{workerId}         pilot metrics (time to fill, no-changes, edits)
//     audit/{pushId}                   every approval / return / change
//     docketArchive/{workerId}/{ts}    docket state when a worker handed over
(function (global) {
  'use strict';

  const T = global.SomapInventoryTemplates;
  if (!T) { console.warn('SomapInventory: inventory_templates.js must load first'); return; }

  const TZ = 'Africa/Nairobi';
  const ROOT = 'inventoryDocket';
  const SOCRATES_ID = 'socrates-school';
  const DAY_MS = 86400000;
  const HEAD_ROLES = ['headteacher', 'head_teacher', 'headmaster', 'head_master', 'head_mistress', 'headmistress'];
  const ADMIN_ROLES = ['admin', 'administrator', 'director', 'owner', 'superadmin', 'super_admin'];
  const DEFAULT_SETTINGS = {
    pilotMode: true,          // safe default: until an admin configures the module nobody is affected
    pilotWorkerIds: {},
    spotChecksPerWeek: 2,
    directorDailyDigest: true,
    photosAllowed: false,
    stalledRepairDays: 7,
    repeatDamageThreshold: 3,
    sampleEveryDays: 7,
    lastSampleYmd: '',
  };
  const OPEN_REPAIR = ['reported', 'assigned', 'inProgress', 'repaired'];

  const APP_ROOT = (() => {
    try { return new URL('../../', global.document.currentScript.src).href; } catch (_) { return '../'; }
  })();
  const URLS = {
    root: APP_ROOT,
    inventory: `${APP_ROOT}workershtml/workersinventory.html`,
    reports: `${APP_ROOT}workershtml/inventoryreports.html`,
    attendance: `${APP_ROOT}workershtml/workersattendance.html`,
    logo: `${APP_ROOT}images/somap-logo.png.jpg`,
    firebase: `${APP_ROOT}firebase.js`,
  };

  // ---------- small helpers ----------
  const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
  const pad = (n) => String(n).padStart(2, '0');
  const n0 = (v) => { const x = Math.floor(Number(v)); return Number.isFinite(x) && x > 0 ? x : 0; };
  const fmtYmd = new Intl.DateTimeFormat('en-CA', { timeZone: TZ });
  const todayYMD = (d = new Date()) => fmtYmd.format(d);
  const ymdOf = (ts) => todayYMD(new Date(ts));
  const yearOf = (ymd) => String(ymd || todayYMD()).slice(0, 4);
  function addDays(ymd, days) {
    const d = new Date(`${ymd}T12:00:00Z`);
    d.setUTCDate(d.getUTCDate() + days);
    return d.toISOString().slice(0, 10);
  }
  function daysBetween(a, b) {
    return Math.round((Date.parse(`${b}T12:00:00Z`) - Date.parse(`${a}T12:00:00Z`)) / DAY_MS);
  }
  function weekMonday(ymd) {
    const d = new Date(`${ymd}T12:00:00Z`);
    const dow = d.getUTCDay();
    return addDays(ymd, dow === 0 ? -6 : 1 - dow);
  }
  function fmtTime(ts) {
    if (!ts) return '';
    return new Date(ts).toLocaleTimeString('en-GB', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hour12: false });
  }
  function fmtDateTime(ts) {
    if (!ts) return '';
    return new Date(ts).toLocaleString('en-GB', { timeZone: TZ, day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false });
  }
  const SW_DAYS = ['Jumapili', 'Jumatatu', 'Jumanne', 'Jumatano', 'Alhamisi', 'Ijumaa', 'Jumamosi'];
  const SW_MONTHS = ['Januari', 'Februari', 'Machi', 'Aprili', 'Mei', 'Juni', 'Julai', 'Agosti', 'Septemba', 'Oktoba', 'Novemba', 'Desemba'];
  function fmtDaySw(ymd) {
    const d = new Date(`${ymd}T12:00:00Z`);
    return `${SW_DAYS[d.getUTCDay()]}, ${d.getUTCDate()} ${SW_MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
  }
  const normRole = (v) => String(v || '').trim().toLowerCase().replace(/[\s-]+/g, '_');
  const keySafe = (v) => String(v || '').replace(/[.#$\[\]\/]/g, '_');
  function uid(prefix) {
    return `${prefix || ''}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
  }
  function clone(v) { return v == null ? v : JSON.parse(JSON.stringify(v)); }
  function slug(v) {
    return String(v || '').toLowerCase().normalize('NFKD').replace(/[^\w]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 30) || 'item';
  }
  function storageGet(key) { try { return global.localStorage.getItem(key); } catch (_) { return null; } }
  function storageSet(key, value) { try { global.localStorage.setItem(key, value); } catch (_) { /* ignore */ } }
  function storageDel(key) { try { global.localStorage.removeItem(key); } catch (_) { /* ignore */ } }

  // ---------- firebase & paths ----------
  let firebaseLoading = null;
  function ensureFirebase() {
    if (!global.firebase) return Promise.reject(new Error('Firebase SDK missing'));
    if (global.firebase.apps && global.firebase.apps.length) return Promise.resolve();
    if (!firebaseLoading) {
      firebaseLoading = new Promise((resolve, reject) => {
        const s = global.document.createElement('script');
        s.src = URLS.firebase;
        s.onload = () => resolve();
        s.onerror = () => reject(new Error('Could not load firebase.js'));
        global.document.head.appendChild(s);
      });
    }
    return firebaseLoading;
  }
  const db = () => global.firebase.database();

  // Mirrors SOMAP.P: Socrates (legacy) lives at the root, every other school under schools/{id}/.
  function schoolPrefix(schoolId) {
    if (!schoolId) throw new Error('SomapInventory: no school selected');
    return schoolId === SOCRATES_ID ? '' : `schools/${schoolId}/`;
  }
  function basePath(schoolId, year) { return `${schoolPrefix(schoolId)}years/${year}/${ROOT}`; }
  function iref(ctx, year, sub) { return db().ref(sub ? `${basePath(ctx.schoolId, year)}/${sub}` : basePath(ctx.schoolId, year)); }
  function sref(ctx, sub) { return db().ref(`${schoolPrefix(ctx.schoolId)}${sub}`); }
  async function val(ref) {
    try { const snap = await ref.once('value'); return snap.val(); } catch (err) { console.warn('SomapInventory read failed', ref.toString(), err); return null; }
  }

  // ---------- roles ----------
  function templateRoleKey(role, teacherConfig) {
    const r = normRole(role);
    const teacherType = normRole(teacherConfig?.teacherType);
    if (HEAD_ROLES.includes(r) || teacherType === 'head_teacher' || teacherType === 'headteacher') return 'headteacher';
    if (!r) return 'other';
    if (r.includes('teacher') || r === 'academic' || r === 'mwalimu') return 'teacher';
    if (['guard', 'security', 'mlinzi', 'walinzi', 'watchman'].includes(r)) return 'guard';
    if (['cook', 'cooks', 'mpishi'].includes(r)) return 'cook';
    if (['cleaner', 'cleaners', 'msafi'].includes(r)) return 'cleaner';
    if (['driver', 'drivers', 'dereva'].includes(r)) return 'driver';
    if (['librarian', 'mkutubi', 'library'].includes(r)) return 'librarian';
    if (['secretary', 'katibu'].includes(r)) return 'secretary';
    if (['storekeeper', 'store', 'ghala'].includes(r)) return 'storekeeper';
    return r;
  }
  function isHeadteacher(profileOrRole, teacherConfig) {
    const role = typeof profileOrRole === 'string' ? profileOrRole : (profileOrRole?.role || profileOrRole?.designation || '');
    return templateRoleKey(role, teacherConfig) === 'headteacher';
  }
  function roleLabel(roleKey) {
    const l = T.ROLE_LABELS[roleKey];
    return l ? `${l.sw} · ${l.en}` : String(roleKey || '').replace(/_/g, ' ');
  }

  // ---------- context ----------
  function storedWorkerId() {
    const direct = storageGet('workerId') || (global.sessionStorage && global.sessionStorage.getItem('workerId'));
    if (direct && direct.trim()) return direct.trim();
    try {
      const parsed = JSON.parse(global.sessionStorage.getItem('workerProfile') || 'null');
      if (parsed && (parsed.id || parsed.workerId)) return String(parsed.id || parsed.workerId).trim();
    } catch (_) { /* ignore */ }
    return '';
  }
  function storedSchoolId() {
    try { if (global.SOMAP?.getSchoolId) { const id = global.SOMAP.getSchoolId(); if (id) return id; } } catch (_) { /* ignore */ }
    return storageGet('somap.currentSchoolId') || storageGet('schoolId') || global.currentSchoolId || '';
  }
  function storedSchoolName(schoolId) {
    try {
      const meta = JSON.parse(storageGet('somap.currentSchool') || 'null');
      if (meta && meta.id === schoolId && meta.name) return meta.name;
    } catch (_) { /* ignore */ }
    return schoolId === SOCRATES_ID ? 'Socrates School' : schoolId;
  }

  async function loadProfile(ctx, workerId, year) {
    const sys = String(new Date().getFullYear());
    const tryYears = [...new Set([year, sys, String(Number(year) - 1)])];
    for (const y of tryYears) {
      const raw = await val(sref(ctx, `years/${y}/workers/${workerId}`));
      if (raw) return raw.profile && Object.keys(raw.profile).length ? raw.profile : raw;
    }
    if (ctx.schoolId === SOCRATES_ID) {
      const raw = await val(db().ref(`workers/${workerId}`));
      if (raw) return raw.profile && Object.keys(raw.profile).length ? raw.profile : raw;
    }
    return null;
  }
  async function loadTeacherConfig(ctx, workerId, year) {
    for (const y of [year, String(Number(year) - 1)]) {
      const cfg = await val(sref(ctx, `years/${y}/teachers_config/${workerId}`));
      if (cfg) return cfg;
    }
    if (ctx.schoolId === SOCRATES_ID) return val(db().ref(`teachers_config/${workerId}`));
    return null;
  }
  function teacherDefaultArea(cfg) {
    const maps = Array.isArray(cfg?.classSubjectMappings) ? cfg.classSubjectMappings : Object.values(cfg?.classSubjectMappings || {});
    const cls = cfg?.classTeacherOf || cfg?.classTeacherClass || maps.find((m) => m && m.class)?.class || '';
    return cls ? String(cls) : '';
  }
  async function detectAdmin() {
    const fb = global.firebase;
    if (!fb || typeof fb.auth !== 'function') return { isAdmin: false };
    let user = null;
    try {
      user = fb.auth().currentUser || await new Promise((resolve) => {
        let done = false;
        const off = fb.auth().onAuthStateChanged((u) => { if (!done) { done = true; off(); resolve(u); } });
        setTimeout(() => { if (!done) { done = true; try { off(); } catch (_) { /* ignore */ } resolve(null); } }, 2500);
      });
    } catch (_) { user = null; }
    if (!user) return { isAdmin: false };
    const [admin, profile] = await Promise.all([val(db().ref(`admins/${user.uid}`)), val(db().ref(`users/${user.uid}`))]);
    const role = normRole(profile?.role || profile?.userType || '');
    // dashboard.html marks its signed-in administrators/directors with localStorage role "admin".
    const storedRole = normRole(storageGet('role') || '');
    return {
      isAdmin: admin === true || ADMIN_ROLES.some((r) => role.includes(r)) || ADMIN_ROLES.includes(storedRole),
      uid: user.uid,
      name: user.displayName || user.email || 'Director',
    };
  }

  // Builds the context for a worker page. opts may already carry what the host page knows.
  async function resolveContext(opts = {}) {
    await ensureFirebase();
    const schoolId = opts.schoolId || storedSchoolId();
    if (!schoolId) throw new Error('Hakuna shule iliyochaguliwa · No school selected');
    const ymd = opts.ymd || todayYMD();
    const year = opts.year || yearOf(ymd);
    const ctx = { schoolId, schoolName: opts.schoolName || storedSchoolName(schoolId), ymd, year };
    ctx.workerId = opts.workerId || storedWorkerId();
    if (ctx.workerId) {
      ctx.profile = opts.profile || await loadProfile(ctx, ctx.workerId, year) || {};
      ctx.roleRaw = ctx.profile.role || ctx.profile.designation || storageGet('workerRole') || storageGet('role') || '';
      const maybeTeacher = normRole(ctx.roleRaw).includes('teacher') || HEAD_ROLES.includes(normRole(ctx.roleRaw)) || normRole(ctx.roleRaw) === 'academic';
      ctx.teacherConfig = opts.teacherConfig || (maybeTeacher ? await loadTeacherConfig(ctx, ctx.workerId, year) : null);
      ctx.roleKey = templateRoleKey(ctx.roleRaw, ctx.teacherConfig);
      ctx.workerName = String(ctx.profile.fullNameUpper || ctx.profile.fullName || storageGet('workerName') || storageGet('fullName') || ctx.workerId).toUpperCase();
      ctx.isHeadteacher = ctx.roleKey === 'headteacher';
      const r = normRole(ctx.roleRaw);
      ctx.isWorkerAdmin = ADMIN_ROLES.includes(r) || r === 'manager';
    }
    if (opts.detectAdmin !== false) {
      const admin = await detectAdmin();
      ctx.isAdmin = admin.isAdmin || !!ctx.isWorkerAdmin;
      ctx.adminUid = admin.uid || '';
      ctx.adminName = admin.name || '';
    } else {
      ctx.isAdmin = !!ctx.isWorkerAdmin;
    }
    ctx.isManagement = !!(ctx.isHeadteacher || ctx.isAdmin);
    ctx.actorId = ctx.workerId || (ctx.adminUid ? `admin:${ctx.adminUid}` : 'unknown');
    ctx.actorName = ctx.workerName || ctx.adminName || 'Admin';
    return ctx;
  }

  // ---------- settings & pilot mode ----------
  async function loadSettings(ctx, year) {
    const y = year || ctx.year;
    let raw = await val(iref(ctx, y, 'settings'));
    let inherited = false;
    if (!raw) {
      raw = await val(iref(ctx, String(Number(y) - 1), 'settings'));
      inherited = !!raw;
    }
    const s = Object.assign({}, DEFAULT_SETTINGS, raw || {});
    s.pilotWorkerIds = Object.assign({}, raw?.pilotWorkerIds || {});
    s.configured = !!raw;
    s.inherited = inherited;
    return s;
  }
  async function saveSettings(ctx, year, patch) {
    const clean = Object.assign({}, patch);
    delete clean.configured; delete clean.inherited;
    clean.updatedAt = Date.now();
    clean.updatedBy = ctx.actorName;
    await iref(ctx, year, 'settings').update(clean);
    await audit(ctx, year, 'settings_changed', 'settings', clean);
  }
  function isEnabledFor(settings, workerId) {
    if (!settings || !workerId) return false;
    if (!settings.pilotMode) return true;
    return !!(settings.pilotWorkerIds && settings.pilotWorkerIds[workerId]);
  }

  // ---------- templates ----------
  const tplCache = {};
  async function loadTemplateOverrides(ctx, year) {
    const key = `${ctx.schoolId}|${year}`;
    if (!tplCache[key]) tplCache[key] = val(iref(ctx, year, 'templates')).then((v) => v || {});
    return tplCache[key];
  }
  function catalogDef(id) {
    const d = T.CATALOG[id];
    return d ? Object.assign({ id }, d) : null;
  }
  async function templateItems(ctx, year, roleKey) {
    const overrides = (await loadTemplateOverrides(ctx, year))[roleKey] || {};
    const removed = overrides.removed || {};
    const out = [];
    (T.TEMPLATES[roleKey] || []).forEach((id) => { if (!removed[id]) { const d = catalogDef(id); if (d) out.push(d); } });
    Object.entries(overrides.items || {}).forEach(([id, def]) => {
      const i = out.findIndex((x) => x.id === id);
      const merged = Object.assign({ id }, catalogDef(id) || {}, def);
      if (i >= 0) out[i] = merged; else if (!removed[id]) out.push(merged);
    });
    return out;
  }
  async function saveTemplateOverride(ctx, year, roleKey, patch) {
    await iref(ctx, year, `templates/${roleKey}`).update(patch);
    delete tplCache[`${ctx.schoolId}|${year}`];
    await audit(ctx, year, 'template_changed', roleKey, patch);
  }
  // The full ordered item list of a docket: template (minus hidden) + custom items.
  async function docketItems(ctx, year, docket) {
    const base = await templateItems(ctx, year, docket.role);
    const hidden = docket.hiddenItems || {};
    const list = base.filter((d) => !hidden[d.id]);
    Object.entries(docket.customItems || {}).forEach(([id, def]) => {
      if (!hidden[id] && !list.some((d) => d.id === id)) list.push(Object.assign({ id, custom: true }, def));
    });
    const catOrder = Object.keys(T.CATEGORIES);
    return list.map((d, i) => Object.assign({ order: i }, d))
      .sort((a, b) => (catOrder.indexOf(a.cat) - catOrder.indexOf(b.cat)) || (a.order - b.order));
  }
  function itemName(def) { return def ? `${def.sw}${def.en && def.en !== def.sw ? ` · ${def.en}` : ''}` : ''; }

  // ---------- dockets ----------
  async function loadDocket(ctx, workerId, year, info = {}) {
    const y = year || ctx.year;
    let docket = await val(iref(ctx, y, `dockets/${workerId}`));
    if (!docket) {
      // Year rollover: carry the docket over from the last approved state of the previous year.
      const prev = await val(iref(ctx, String(Number(y) - 1), `dockets/${workerId}`));
      if (prev && !prev.endedAt) {
        docket = {
          role: prev.role, area: prev.area || '', customItems: prev.customItems || {}, hiddenItems: prev.hiddenItems || {},
          latest: prev.lastApproved || prev.latest || null, prior: null, lastApproved: prev.lastApproved || null,
          openRepairs: prev.openRepairs || {}, baselineApprovedAt: prev.baselineApprovedAt || null,
          carriedFrom: String(Number(y) - 1), carriedAt: Date.now(), ledger: prev.ledger || {},
        };
        if (docket.latest) docket.latest = Object.assign({}, docket.latest, { carried: true });
      }
    }
    docket = docket || {};
    docket.workerId = workerId;
    if (info.roleKey) docket.role = docket.role || info.roleKey;
    if (info.roleKey && docket.role !== info.roleKey && !docket.latest) docket.role = info.roleKey;
    if (!docket.area) {
      docket.area = info.area || (info.profile && info.profile.docketArea) || (docket.role === 'teacher' ? teacherDefaultArea(info.teacherConfig) : '') || T.DEFAULT_AREAS[docket.role] || '';
    }
    if (info.workerName) docket.workerName = info.workerName;
    return docket;
  }
  async function saveDocketMeta(ctx, year, workerId, patch) {
    await iref(ctx, year, `dockets/${workerId}`).update(Object.assign({ updatedAt: Date.now() }, patch));
  }
  async function addCustomItem(ctx, year, workerId, def) {
    const id = `c_${slug(def.sw)}_${Date.now().toString(36).slice(-4)}`;
    const clean = { sw: String(def.sw || '').trim(), en: String(def.en || '').trim(), type: def.type || 'count', cat: def.cat || 'other', unit: def.unit || 'pcs', addedBy: ctx.actorName, addedAt: Date.now() };
    await iref(ctx, year, `dockets/${workerId}/customItems/${id}`).set(clean);
    await audit(ctx, year, 'custom_item_added', workerId, Object.assign({ id }, clean));
    return Object.assign({ id, custom: true }, clean);
  }

  // ---------- values & analysis ----------
  const totalOf = (v) => n0(v?.good) + n0(v?.damaged) + n0(v?.lost);

  // The starting point of today's form: the latest earlier report plus every accepted
  // movement (transfer, stock in, approved write-off) since it was submitted.
  function computeBasis(docket, items, ymd) {
    const latest = docket.latest || null;
    const ref = latest && latest.ymd && latest.ymd < ymd ? latest : (docket.prior || (latest && latest.carried ? latest : null));
    const refAt = ref?.submittedAt || 0;
    const values = clone(ref?.items || {}) || {};
    const expected = {};
    const adjusted = {};
    items.forEach((d) => {
      if (d.type !== 'count') return;
      const adj = Object.values((docket.ledger || {})[d.id]?.adj || {}).filter((a) => (a.at || 0) > refAt);
      // An item that was not on the last report (newly added) gets its own first count.
      const v = values[d.id] || null;
      if (adj.length) {
        const cur = v || { good: 0, damaged: 0, lost: 0 };
        adj.forEach((a) => {
          const bucket = ['good', 'damaged', 'lost'].includes(a.bucket) ? a.bucket : 'good';
          cur[bucket] = Math.max(0, n0(cur[bucket]) + Number(a.delta || 0));
        });
        values[d.id] = cur;
        adjusted[d.id] = adj;
      } else if (v) {
        values[d.id] = v;
      }
      if (values[d.id]) expected[d.id] = totalOf(values[d.id]);
    });
    // Per-report fields are recomputed on submit; notes only carry over while the problem remains.
    Object.values(values).forEach((v) => {
      if (!v || typeof v !== 'object') return;
      ['repairConfirm', 'source', 'reportedSameDay', 'repairId', 'awaitingRepairDays', 'needsRepair'].forEach((k) => delete v[k]);
      const problem = v.type === 'count' ? (n0(v.damaged) > 0 || n0(v.lost) > 0) : v.type === 'cond' ? v.ok === false : false;
      if (!problem) { delete v.desc; delete v.who; }
    });
    return { ref, refYmd: ref?.ymd || '', values, expected, adjusted, baseline: !ref };
  }

  function expiryState(dateStr, ymd) {
    if (!dateStr) return '';
    const left = daysBetween(ymd, dateStr);
    if (left < 0) return 'expired';
    if (left <= 30) return 'soon';
    return '';
  }

  // Validates and analyses a filled form. Returns per-item errors and the problems found.
  function analyze(items, values, basis, tickets, ymd) {
    const errors = {};
    const problems = [];
    const reasons = new Set();
    const counts = { items: items.length, good: 0, damaged: 0, lost: 0, notOk: 0, restock: 0, awaitingRepair: 0 };
    if (basis.baseline) reasons.add('baseline');
    items.forEach((d) => {
      const v = values[d.id] || {};
      const b = basis.values[d.id] || null;
      const ticket = tickets[d.id] || null;
      const note = String(v.desc || '').trim();
      if (ticket && ticket.status === 'repaired' && !v.repairConfirm) errors[d.id] = 'Jibu: kimetengenezwa? · Confirm the repair';
      if (v.repairConfirm === 'no') reasons.add('repairNotFixed');
      if (d.type === 'count') {
        if (v.good === undefined && v.damaged === undefined && v.lost === undefined && !b) { errors[d.id] = 'Jaza idadi · Enter the count'; return; }
        const good = n0(v.good); const damaged = n0(v.damaged); const lost = n0(v.lost);
        const total = good + damaged + lost;
        counts.good += good; counts.damaged += damaged; counts.lost += lost;
        const exp = basis.expected[d.id];
        const bDam = n0(b?.damaged); const bLost = n0(b?.lost);
        if ((damaged > 0 || lost > 0) && !note) errors[d.id] = 'Taja vilivyoharibika / kupotea · Describe damaged or lost items';
        if (exp !== undefined && total !== exp) {
          reasons.add('mismatch');
          if (!note) errors[d.id] = `Idadi ilikuwa ${exp}, sasa ${total}. Eleza kwa nini · Count changed — explain`;
          problems.push({ itemId: d.id, kind: 'mismatch', qty: total - exp, expected: exp, total });
        }
        if (damaged > bDam) {
          problems.push({ itemId: d.id, kind: 'damaged', qty: damaged - bDam, isNew: true });
          reasons.add('newDamage');
        } else if (damaged > 0) {
          problems.push({ itemId: d.id, kind: 'damaged', qty: damaged, isNew: !b && !ticket });
          if (!b && !ticket) reasons.add('newDamage');
          if (ticket) counts.awaitingRepair += 1;
        }
        if (lost > bLost) {
          problems.push({ itemId: d.id, kind: 'lost', qty: lost - bLost, isNew: true });
          reasons.add('newLoss');
        } else if (lost > 0) {
          problems.push({ itemId: d.id, kind: 'lost', qty: lost, isNew: !b });
          if (!b) reasons.add('newLoss');
        }
        if (b && damaged < bDam && v.repairConfirm !== 'yes') {
          reasons.add('reappeared');
          if (!note) errors[d.id] = 'Vilivyoharibika vimepungua bila matengenezo kuthibitishwa. Eleza · Explain';
          problems.push({ itemId: d.id, kind: 'reappeared', qty: bDam - damaged });
        }
        if (b && lost < bLost) {
          reasons.add('reappeared');
          if (!note) errors[d.id] = 'Vilivyopotea vimepungua. Eleza vimepatikanaje · Explain how they were found';
          problems.push({ itemId: d.id, kind: 'found', qty: bLost - lost });
        }
      } else if (d.type === 'cond') {
        if (v.ok === undefined || v.ok === null || v.ok === '') { errors[d.id] = 'Chagua Sawa au Si sawa · Choose OK or Not OK'; return; }
        if (v.ok === false) {
          counts.notOk += 1;
          if (!note) errors[d.id] = 'Eleza tatizo · Describe the problem';
          const isNew = !ticket && !(b && b.ok === false);
          problems.push({ itemId: d.id, kind: 'notOk', qty: 1, isNew });
          if (isNew) reasons.add('notOk');
          if (ticket) counts.awaitingRepair += 1;
        }
      } else if (d.type === 'cons') {
        if (v.restock) counts.restock += 1;
      } else if (d.type === 'date') {
        const st = expiryState(v.value, ymd);
        if (st === 'expired') { reasons.add('expired'); problems.push({ itemId: d.id, kind: 'expired', qty: 1, isNew: true }); }
        if (st === 'soon') problems.push({ itemId: d.id, kind: 'expiresSoon', qty: 1 });
      }
    });
    return { errors, problems, reasons: [...reasons], counts, valid: Object.keys(errors).length === 0 };
  }

  const REASON_LABELS = {
    baseline: 'Hesabu ya kwanza (baseline) · First count',
    newDamage: 'Uharibifu mpya · New damage',
    newLoss: 'Upotevu mpya · New loss',
    notOk: 'Hali si sawa · Not OK condition',
    mismatch: 'Idadi imebadilika · Count changed',
    reappeared: 'Vimerudi bila matengenezo · Reappeared without repair',
    repairNotFixed: 'Matengenezo hayakufanikiwa · Repair not fixed',
    expired: 'Hati ya gari imeisha · Vehicle document expired',
    flag: 'Hitilafu imegunduliwa · Inconsistency flag',
    sampled: 'Imechaguliwa kwa ukaguzi wa nasibu · Random sample',
    handoverDiff: 'Tofauti ya makabidhiano · Handover difference',
    docketChanged: 'Orodha ya dhamana imebadilishwa · Docket changed',
  };
  const PROBLEM_LABELS = {
    damaged: 'Imeharibika · Damaged', lost: 'Imepotea · Lost', notOk: 'Si sawa · Not OK', mismatch: 'Idadi imebadilika · Count changed',
    reappeared: 'Imerudi bila matengenezo · Reappeared', found: 'Imepatikana · Found', expired: 'Imeisha muda · Expired', expiresSoon: 'Inakaribia kuisha · Expires soon',
  };

  // ---------- reports ----------
  async function loadReport(ctx, ymd, workerId) { return val(iref(ctx, yearOf(ymd), `reports/${ymd}/${workerId}`)); }
  async function loadDay(ctx, ymd) { return (await val(iref(ctx, yearOf(ymd), `reports/${ymd}`))) || {}; }
  async function loadRange(ctx, sub, from, to) {
    const out = {};
    for (let y = Number(yearOf(from)); y <= Number(yearOf(to)); y += 1) {
      try {
        const snap = await iref(ctx, String(y), sub).orderByKey().startAt(from).endAt(to).once('value');
        Object.assign(out, snap.val() || {});
      } catch (err) { console.warn('SomapInventory range read failed', sub, err); }
    }
    return out;
  }
  async function todayStatus(ctx, workerId, ymd) {
    const day = ymd || todayYMD();
    const report = await loadReport(ctx, day, workerId || ctx.workerId);
    return {
      status: report?.status || 'none',
      submittedAt: report?.submittedAt || 0,
      returnComment: report?.status === 'returned' ? (report.returnComment || '') : '',
      done: ['submitted', 'approved'].includes(report?.status),
      report,
    };
  }
  async function saveDraft(ctx, ymd, workerId, values) {
    await iref(ctx, yearOf(ymd), `drafts/${ymd}/${workerId}`).set({ values, at: Date.now() });
  }
  async function loadOpenTickets(ctx, docket) {
    const out = {};
    await Promise.all(Object.entries(docket.openRepairs || {}).map(async ([itemId, refInfo]) => {
      const info = typeof refInfo === 'string' ? { id: refInfo, year: ctx.year } : refInfo;
      if (!info?.id) return;
      const t = await val(iref(ctx, info.year || ctx.year, `repairs/${info.id}`));
      if (t && OPEN_REPAIR.includes(t.status)) out[itemId] = Object.assign({ id: info.id, year: info.year || ctx.year }, t);
    }));
    return out;
  }

  function repairEntry(ctx, status, note) {
    return { status, at: Date.now(), byId: ctx.actorId, byName: ctx.actorName, note: note || '' };
  }

  // Submits today's report: creates/updates repair tickets, flags, metrics and the docket's latest state.
  async function submitReport(ctx, input) {
    const { ymd, workerId, docket, items, values, basis, tickets, meta = {} } = input;
    const year = yearOf(ymd);
    const analysis = analyze(items, values, basis, tickets, ymd);
    if (!analysis.valid) return { ok: false, analysis };
    const settings = input.settings || await loadSettings(ctx, year);
    const now = Date.now();
    const existing = await loadReport(ctx, ymd, workerId);
    if (existing?.status === 'approved') return { ok: false, message: 'Ripoti ya leo imeshaidhinishwa · Already approved' };
    const reportKey = `${ymd}/${workerId}`;
    const updates = {};
    const outItems = {};
    const openRepairs = Object.assign({}, docket.openRepairs || {});
    const flags = [];
    const defsById = Object.fromEntries(items.map((d) => [d.id, d]));
    const damageLog = clone(docket.damageLog || {}) || {};
    const cutoff = now - 30 * DAY_MS;

    items.forEach((d) => {
      const v = Object.assign({}, values[d.id] || {});
      const b = basis.values[d.id] || null;
      const ticket = tickets[d.id] || null;
      const item = { type: d.type };
      if (d.type === 'count') {
        Object.assign(item, { good: n0(v.good), damaged: n0(v.damaged), lost: n0(v.lost), needsRepair: Math.min(n0(v.needsRepair ?? v.damaged), n0(v.damaged)) });
        if (v.required !== undefined) item.required = n0(v.required);
      } else if (d.type === 'cond') item.ok = v.ok !== false;
      else if (d.type === 'cons') { item.qty = n0(v.qty); item.restock = !!v.restock; }
      else if (['num', 'level', 'date'].includes(d.type)) item.value = v.value ?? '';
      if (v.desc) item.desc = String(v.desc).trim();
      if (v.who) item.who = String(v.who).trim();
      if (v.repairConfirm) item.repairConfirm = v.repairConfirm;

      const hasProblem = (d.type === 'count' && item.damaged > 0) || (d.type === 'cond' && item.ok === false);
      let t = ticket;
      // Repair confirmation by the responsible worker.
      if (t && t.status === 'repaired' && v.repairConfirm === 'yes') {
        updates[`repairs/${t.id}/status`] = 'confirmed';
        updates[`repairs/${t.id}/confirmedAt`] = now;
        updates[`repairs/${t.id}/confirmedBy`] = ctx.actorName;
        updates[`repairs/${t.id}/history/${uid('h')}`] = repairEntry(ctx, 'confirmed', 'Mhusika amethibitisha · Confirmed by worker');
        delete openRepairs[d.id];
        t = null;
      } else if (t && t.status === 'repaired' && v.repairConfirm === 'no') {
        updates[`repairs/${t.id}/status`] = 'reported';
        updates[`repairs/${t.id}/history/${uid('h')}`] = repairEntry(ctx, 'reported', 'Mhusika amesema bado haijatengenezwa · Reopened by worker');
      }
      if (hasProblem) {
        const qty = d.type === 'count' ? item.damaged : 1;
        if (!t) {
          const id = uid('r');
          updates[`repairs/${id}`] = {
            itemId: d.id, itemName: itemName(d), category: d.cat || 'other', area: docket.area || '', workerId, workerName: ctx.workerName || docket.workerName || '',
            role: docket.role || '', qty, description: item.desc || '', who: item.who || '', reportedAt: now, reportYmd: ymd, source: 'self',
            status: 'reported', currency: 'TZS', createdFromReport: reportKey,
            history: { [uid('h')]: repairEntry(ctx, 'reported', item.desc || '') },
          };
          openRepairs[d.id] = { id, year };
          item.repairId = id;
          item.source = 'self';
          item.reportedSameDay = true;
          damageLog[d.id] = Object.assign({}, damageLog[d.id] || {}, { [String(now)]: true });
        } else {
          item.repairId = t.id;
          item.source = t.source || 'self';
          item.awaitingRepairDays = Math.max(0, daysBetween(t.reportYmd || ymdOf(t.reportedAt), ymd));
          if (d.type === 'count' && b && item.damaged > n0(b.damaged)) {
            updates[`repairs/${t.id}/qty`] = item.damaged;
            updates[`repairs/${t.id}/history/${uid('h')}`] = repairEntry(ctx, t.status, `Uharibifu zaidi: ${item.damaged} · More damage reported`);
            damageLog[d.id] = Object.assign({}, damageLog[d.id] || {}, { [String(now)]: true });
          }
        }
      } else if (t && t.createdFromReport === reportKey && t.status === 'reported') {
        // A ticket opened by an earlier submission of this same report that the worker corrected.
        updates[`repairs/${t.id}/status`] = 'cancelled';
        updates[`repairs/${t.id}/history/${uid('h')}`] = repairEntry(ctx, 'cancelled', 'Ripoti ilirekebishwa · Corrected before review');
        delete openRepairs[d.id];
      }
      if (d.type === 'count' && item.lost > n0(b?.lost)) {
        item.source = item.source || 'self';
        item.reportedSameDay = true;
        updates[`dockets/${workerId}/lossLog/${ymd}/${d.id}`] = item.lost - n0(b?.lost);
      } else if (d.type === 'count') {
        updates[`dockets/${workerId}/lossLog/${ymd}/${d.id}`] = null;
      }
      outItems[d.id] = item;
    });

    // Repeated damage in the same docket area (>= threshold in 30 days).
    Object.entries(damageLog).forEach(([itemId, log]) => {
      const recent = Object.keys(log || {}).filter((ts) => Number(ts) >= cutoff);
      damageLog[itemId] = Object.fromEntries(recent.map((ts) => [ts, true]));
      if (!recent.length) delete damageLog[itemId];
      const threshold = Number(settings.repeatDamageThreshold || 3);
      if (recent.length >= threshold && recent.some((ts) => Number(ts) >= now - 60000)) {
        flags.push({ type: 'repeat_damage', itemId, detail: `${itemName(defsById[itemId])}: imeharibika mara ${recent.length} ndani ya siku 30 · damaged ${recent.length}x in 30 days` });
      }
    });
    analysis.problems.forEach((p) => {
      if (p.kind === 'mismatch') flags.push({ type: 'count_mismatch', itemId: p.itemId, detail: `${itemName(defsById[p.itemId])}: ilitarajiwa ${p.expected}, imeripotiwa ${p.total}. ${outItems[p.itemId]?.desc || ''}` });
      if (p.kind === 'reappeared' || p.kind === 'found') flags.push({ type: 'reappeared', itemId: p.itemId, detail: `${itemName(defsById[p.itemId])}: ${p.qty} ${p.kind === 'found' ? 'vimepatikana' : 'vimerudi kuwa vizima'} bila matengenezo kuthibitishwa. ${outItems[p.itemId]?.desc || ''}` });
    });
    if (meta.handoverDiff) analysis.reasons.push('handoverDiff');
    if (meta.docketChanged) analysis.reasons.push('docketChanged');
    if (flags.length && !analysis.reasons.includes('flag')) analysis.reasons.push('flag');

    // Close flags written by an earlier submission of the same report.
    if (existing?.flagIds) Object.keys(existing.flagIds).forEach((fid) => { updates[`flags/${ymd}/${fid}/resolved`] = true; updates[`flags/${ymd}/${fid}/supersededAt`] = now; });
    const flagIds = {};
    flags.forEach((f) => {
      const id = uid('f');
      flagIds[id] = true;
      updates[`flags/${ymd}/${id}`] = Object.assign({ workerId, workerName: ctx.workerName || '', area: docket.area || '', role: docket.role || '', at: now, resolved: false, reportYmd: ymd }, f);
    });

    const report = {
      workerId, workerName: ctx.workerName || docket.workerName || '', role: docket.role || '', area: docket.area || '', ymd,
      status: 'submitted', startedAt: existing?.startedAt || meta.openedAt || now, submittedAt: now,
      firstSubmittedAt: existing?.firstSubmittedAt || existing?.submittedAt || now,
      resubmittedCount: existing ? n0(existing.resubmittedCount) + (existing.status === 'returned' || existing.status === 'submitted' ? 1 : 0) : 0,
      noChanges: !!meta.noChanges, items: outItems, counts: analysis.counts,
      problems: analysis.problems.map((p) => Object.assign({ itemName: itemName(defsById[p.itemId]), desc: outItems[p.itemId]?.desc || '', who: outItems[p.itemId]?.who || '', source: outItems[p.itemId]?.source || 'self' }, p)),
      review: { group: analysis.reasons.length ? 'review' : 'clean', reasons: analysis.reasons },
      baseline: !!basis.baseline, basisYmd: basis.refYmd || '', flagIds,
      itemDefs: Object.fromEntries(items.map((d) => [d.id, { sw: d.sw, en: d.en || '', type: d.type, cat: d.cat || 'other', unit: d.unit || '', personal: !!d.personal }])),
    };
    if (existing?.returnComment) report.lastReturnComment = existing.returnComment;
    updates[`reports/${ymd}/${workerId}`] = report;
    const latest = { ymd, status: 'submitted', submittedAt: now, items: outItems };
    if (docket.latest && docket.latest.ymd && docket.latest.ymd < ymd && !docket.latest.carried) updates[`dockets/${workerId}/prior`] = docket.latest;
    updates[`dockets/${workerId}/latest`] = latest;
    updates[`dockets/${workerId}/openRepairs`] = openRepairs;
    updates[`dockets/${workerId}/damageLog`] = damageLog;
    updates[`dockets/${workerId}/workerName`] = report.workerName;
    updates[`dockets/${workerId}/role`] = docket.role || '';
    updates[`dockets/${workerId}/area`] = docket.area || '';
    updates[`dockets/${workerId}/updatedAt`] = now;
    if (docket.carriedFrom) updates[`dockets/${workerId}/carriedFrom`] = docket.carriedFrom;
    if (docket.customItems) updates[`dockets/${workerId}/customItems`] = docket.customItems;
    if (docket.hiddenItems) updates[`dockets/${workerId}/hiddenItems`] = docket.hiddenItems;
    if (docket.carriedFrom && docket.ledger && !docket.ledgerSaved) updates[`dockets/${workerId}/ledger`] = docket.ledger;
    if (docket.lastApproved && docket.carriedFrom) updates[`dockets/${workerId}/lastApproved`] = docket.lastApproved;
    updates[`drafts/${ymd}/${workerId}`] = null;
    const opened = meta.openedAt || now;
    updates[`metrics/${ymd}/${workerId}`] = {
      role: docket.role || '', openedAt: opened, submittedAt: now, secondsToFill: Math.max(0, Math.round((now - opened) / 1000)),
      noChanges: !!meta.noChanges, editedItems: meta.editedItems || {}, untouchedItems: meta.untouchedItems || {}, customAdded: n0(meta.customAdded), itemCount: items.length,
    };
    updates[`audit/${uid('a')}`] = { at: now, byId: ctx.actorId, byName: ctx.actorName, action: existing ? 'report_resubmitted' : 'report_submitted', target: reportKey, detail: { noChanges: !!meta.noChanges, group: report.review.group } };
    await iref(ctx, year).update(updates);
    return { ok: true, report, analysis };
  }

  // ---------- approvals (approval by exception) ----------
  async function getQueue(ctx, ymd, opts = {}) {
    const year = yearOf(ymd);
    const day = await loadDay(ctx, ymd);
    const all = Object.entries(day).map(([wid, r]) => Object.assign({ workerId: wid }, r)).filter((r) => r.status && r.status !== 'draft');
    const own = all.filter((r) => r.workerId === ctx.workerId);
    const others = all.filter((r) => r.workerId !== ctx.workerId);
    let clean = others.filter((r) => r.status === 'submitted' && r.review?.group === 'clean');
    // Safety valve: every N days one random clean report must be opened, so bulk approval is never blind.
    if (opts.sample !== false && clean.length) {
      const settings = await loadSettings(ctx, year);
      const every = Math.max(1, Number(settings.sampleEveryDays || 7));
      const alreadyToday = others.some((r) => r.review?.sampled);
      if (!alreadyToday && (!settings.lastSampleYmd || daysBetween(settings.lastSampleYmd, ymd) >= every)) {
        const pick = clean[Math.floor(Math.random() * clean.length)];
        const reasons = [...(pick.review?.reasons || []), 'sampled'];
        await iref(ctx, year).update({
          [`reports/${ymd}/${pick.workerId}/review`]: { group: 'review', reasons, sampled: true },
          'settings/lastSampleYmd': ymd,
        });
        pick.review = { group: 'review', reasons, sampled: true };
        clean = clean.filter((r) => r !== pick);
      }
    }
    const review = others.filter((r) => r.status === 'submitted' && r.review?.group !== 'clean');
    return {
      ymd, all, own: own[0] || null, clean, review,
      approved: others.filter((r) => r.status === 'approved'),
      returned: others.filter((r) => r.status === 'returned'),
      pendingCount: clean.length + review.length,
    };
  }

  async function approveReport(ctx, ymd, workerId, mode) {
    if (workerId === ctx.workerId && !ctx.isAdmin) return { ok: false, message: 'Huwezi kuidhinisha ripoti yako mwenyewe · You cannot approve your own report' };
    const year = yearOf(ymd);
    const report = await loadReport(ctx, ymd, workerId);
    if (!report || report.status !== 'submitted') return { ok: false, message: 'Ripoti haipo au imeshashughulikiwa · Not pending' };
    const docket = (await val(iref(ctx, year, `dockets/${workerId}`))) || {};
    const now = Date.now();
    const updates = {
      [`reports/${ymd}/${workerId}/status`]: 'approved',
      [`reports/${ymd}/${workerId}/approvedBy`]: ctx.actorId,
      [`reports/${ymd}/${workerId}/approvedByName`]: ctx.actorName,
      [`reports/${ymd}/${workerId}/approvedAt`]: now,
      [`reports/${ymd}/${workerId}/approvalMode`]: mode || 'single',
      [`audit/${uid('a')}`]: { at: now, byId: ctx.actorId, byName: ctx.actorName, action: mode === 'bulk' ? 'report_approved_bulk' : 'report_approved', target: `${ymd}/${workerId}` },
    };
    if (!docket.lastApproved || (docket.lastApproved.ymd || '') <= ymd) {
      updates[`dockets/${workerId}/lastApproved`] = { ymd, submittedAt: report.submittedAt, approvedAt: now, approvedByName: ctx.actorName, items: report.items || {} };
    }
    if (docket.latest?.ymd === ymd) updates[`dockets/${workerId}/latest/status`] = 'approved';
    if (docket.prior?.ymd === ymd) updates[`dockets/${workerId}/prior/status`] = 'approved';
    if (!docket.baselineApprovedAt) updates[`dockets/${workerId}/baselineApprovedAt`] = now;
    Object.entries(docket.ledger || {}).forEach(([itemId, l]) => {
      Object.entries(l?.adj || {}).forEach(([k, a]) => { if ((a.at || 0) <= (report.submittedAt || 0)) updates[`dockets/${workerId}/ledger/${itemId}/adj/${k}`] = null; });
    });
    await iref(ctx, year).update(updates);
    return { ok: true };
  }
  async function approveMany(ctx, ymd, workerIds, mode) {
    const results = [];
    for (const wid of workerIds) results.push(Object.assign({ workerId: wid }, await approveReport(ctx, ymd, wid, mode)));
    await writeSummary(ctx, ymd).catch((e) => console.warn('Summary write skipped', e));
    return results;
  }
  async function returnReport(ctx, ymd, workerId, comment) {
    const text = String(comment || '').trim();
    if (text.length < 5) return { ok: false, message: 'Andika maoni ya kurudisha · Write a return comment' };
    if (workerId === ctx.workerId && !ctx.isAdmin) return { ok: false, message: 'Huwezi kurudisha ripoti yako mwenyewe' };
    const year = yearOf(ymd);
    const report = await loadReport(ctx, ymd, workerId);
    if (!report || report.status !== 'submitted') return { ok: false, message: 'Ripoti haipo au imeshashughulikiwa · Not pending' };
    const now = Date.now();
    await iref(ctx, year).update({
      [`reports/${ymd}/${workerId}/status`]: 'returned',
      [`reports/${ymd}/${workerId}/returnComment`]: text,
      [`reports/${ymd}/${workerId}/returnedAt`]: now,
      [`reports/${ymd}/${workerId}/returnedBy`]: ctx.actorId,
      [`reports/${ymd}/${workerId}/returnedByName`]: ctx.actorName,
      [`dockets/${workerId}/latest/status`]: 'returned',
      [`audit/${uid('a')}`]: { at: now, byId: ctx.actorId, byName: ctx.actorName, action: 'report_returned', target: `${ymd}/${workerId}`, detail: { comment: text } },
    });
    return { ok: true };
  }

  // ---------- roster, attendance, school totals ----------
  async function loadRoster(ctx, year) {
    const y = year || ctx.year;
    let raw = await val(sref(ctx, `years/${y}/workers`));
    if (!raw && ctx.schoolId === SOCRATES_ID) raw = await val(db().ref('workers'));
    const out = [];
    Object.entries(raw || {}).forEach(([wid, w]) => {
      const p = w?.profile && Object.keys(w.profile).length ? w.profile : (w || {});
      const status = String(p.employmentStatus || '').toLowerCase();
      if (p.active === false || ['left', 'terminated', 'exited'].includes(status)) return;
      const role = p.role || p.designation || '';
      out.push({ workerId: wid, name: String(p.fullNameUpper || p.fullName || p.name || wid).toUpperCase(), role, roleKey: templateRoleKey(role, null), docketArea: p.docketArea || '' });
    });
    return out.sort((a, b) => a.name.localeCompare(b.name));
  }
  async function attendanceDay(ctx, workerId, ymd) {
    const mk = ymd.slice(0, 7).replace('-', '');
    const dk = ymd.replace(/-/g, '');
    const scoped = await val(sref(ctx, `years/${yearOf(ymd)}/workerAttendance/${workerId}/${mk}/${dk}`));
    if (scoped) return scoped;
    if (ctx.schoolId === SOCRATES_ID) return val(db().ref(`attendance/${workerId}/${mk}/${dk}`));
    return null;
  }
  async function notSubmitted(ctx, ymd, workerIds, day) {
    const reports = day || await loadDay(ctx, ymd);
    const out = [];
    await Promise.all(workerIds.map(async (wid) => {
      const r = reports[wid];
      if (r && ['submitted', 'approved'].includes(r.status)) return;
      const att = await attendanceDay(ctx, wid, ymd);
      if (att && (att.checkInTs || att.checkinTs || att.checkIn)) out.push({ workerId: wid, status: r?.status || 'none', checkInTs: att.checkInTs || 0, checkOutTs: att.checkOutTs || 0 });
    }));
    return out;
  }
  async function loadDockets(ctx, year) { return (await val(iref(ctx, year || ctx.year, 'dockets'))) || {}; }

  // School-wide totals: area items are counted once per role+area (latest report wins),
  // personal kit is summed per worker. "confirmed" uses approved reports only.
  function schoolTotals(dockets, opts = {}) {
    const items = {};
    const pick = {};
    Object.entries(dockets || {}).forEach(([wid, d]) => {
      if (!d || d.endedAt) return;
      const src = opts.confirmedOnly ? d.lastApproved : (d.latest || d.lastApproved);
      if (!src?.items) return;
      const confirmed = !!(d.lastApproved && src === d.lastApproved) || src.status === 'approved';
      Object.entries(src.items).forEach(([itemId, v]) => {
        if (!v || v.type !== 'count') return;
        const def = catalogDef(itemId) || (d.customItems || {})[itemId] || { sw: itemId, cat: 'other' };
        const areaKey = def.personal ? `w:${wid}` : `a:${d.role}|${String(d.area || wid).toLowerCase().trim()}`;
        const key = `${itemId}|${areaKey}`;
        if (pick[key] && (pick[key].at || 0) >= (src.submittedAt || 0)) return;
        pick[key] = { at: src.submittedAt || 0, itemId, def, v, role: d.role, confirmed };
      });
    });
    Object.values(pick).forEach((p) => {
      const it = items[p.itemId] || (items[p.itemId] = { itemId: p.itemId, sw: p.def.sw, en: p.def.en || '', cat: p.def.cat || 'other', total: 0, good: 0, damaged: 0, lost: 0, confirmed: 0, pending: 0, byRole: {} });
      const total = totalOf(p.v);
      it.total += total; it.good += n0(p.v.good); it.damaged += n0(p.v.damaged); it.lost += n0(p.v.lost);
      if (p.confirmed) it.confirmed += total; else it.pending += total;
      it.byRole[p.role] = (it.byRole[p.role] || 0) + total;
    });
    const byCategory = {};
    Object.values(items).forEach((it) => { (byCategory[it.cat] || (byCategory[it.cat] = [])).push(it); });
    Object.values(byCategory).forEach((list) => list.sort((a, b) => b.total - a.total));
    return { items, byCategory };
  }
  function totalsPhrase(it) {
    const roles = Object.keys(it.byRole || {}).map((r) => T.ROLE_LABELS[r]?.plural || r).join(', ');
    return `${it.sw} ${it.total}${roles ? ` kulingana na ${roles}` : ''}`;
  }
  async function writeSummary(ctx, ymd) {
    const year = yearOf(ymd);
    const dockets = await loadDockets(ctx, year);
    const confirmed = schoolTotals(dockets, { confirmedOnly: true });
    const day = await loadDay(ctx, ymd);
    const list = Object.values(day).filter((r) => r && r.status && r.status !== 'draft');
    const byCategory = {};
    Object.entries(confirmed.byCategory).forEach(([cat, arr]) => {
      byCategory[cat] = Object.fromEntries(arr.map((it) => [keySafe(it.itemId), { sw: it.sw, total: it.total, good: it.good, damaged: it.damaged, lost: it.lost }]));
    });
    await iref(ctx, year, `summaries/${ymd}`).set({
      at: Date.now(), byCategory, reports: list.length, approved: list.filter((r) => r.status === 'approved').length,
      confirmed: list.length > 0 && list.every((r) => r.status === 'approved'),
    });
  }

  // ---------- movements: transfer, stock in, write-off ----------
  async function createMovement(ctx, m) {
    const ymd = todayYMD();
    const year = yearOf(ymd);
    const id = uid('m');
    const now = Date.now();
    const move = Object.assign({ id, ymd, at: now, byId: ctx.actorId, byName: ctx.actorName, status: 'pending', qty: n0(m.qty) }, m);
    move.qty = n0(m.qty);
    if (!move.qty) return { ok: false, message: 'Weka idadi · Enter a quantity' };
    const updates = { [`movements/${ymd}/${id}`]: move, [`movementIndex/${id}`]: ymd };
    if (move.toWorkerId) updates[`dockets/${move.toWorkerId}/incoming/${id}`] = move;
    if (move.fromWorkerId) updates[`dockets/${move.fromWorkerId}/outgoing/${id}`] = move;
    if (move.type === 'writeOff') updates[`pendingApprovals/${id}`] = { kind: 'writeOff', ymd, at: now };
    updates[`audit/${uid('a')}`] = { at: now, byId: ctx.actorId, byName: ctx.actorName, action: `movement_${move.type}`, target: id, detail: { itemId: move.itemId, qty: move.qty } };
    await iref(ctx, year).update(updates);
    return { ok: true, id, move };
  }
  async function loadMovement(ctx, id, year) {
    const y = year || ctx.year;
    const ymd = await val(iref(ctx, y, `movementIndex/${id}`));
    if (!ymd) return null;
    const m = await val(iref(ctx, y, `movements/${ymd}/${id}`));
    return m ? Object.assign({ id, ymd }, m) : null;
  }
  function adjEntry(m, delta, bucket) { return { delta, bucket, at: Date.now(), moveId: m.id, type: m.type }; }
  // Receiving worker accepts / rejects a transfer or a stock-in.
  async function respondMovement(ctx, id, accept, note) {
    const m = await loadMovement(ctx, id, ctx.year);
    if (!m || m.status !== 'pending') return { ok: false, message: 'Haipo au imeshashughulikiwa · Not pending' };
    if (m.type === 'writeOff') return { ok: false, message: 'Write-off inaidhinishwa na Mwalimu Mkuu' };
    const now = Date.now();
    const status = accept ? 'accepted' : 'rejected';
    const updates = {
      [`movements/${m.ymd}/${id}/status`]: status,
      [`movements/${m.ymd}/${id}/${accept ? 'acceptedAt' : 'rejectedAt'}`]: now,
      [`movements/${m.ymd}/${id}/responseNote`]: note || '',
      [`movements/${m.ymd}/${id}/respondedBy`]: ctx.actorName,
    };
    if (m.toWorkerId) updates[`dockets/${m.toWorkerId}/incoming/${id}`] = null;
    if (m.fromWorkerId) updates[`dockets/${m.fromWorkerId}/outgoing/${id}`] = null;
    if (accept) {
      const k = uid('j');
      if (m.toWorkerId) {
        updates[`dockets/${m.toWorkerId}/ledger/${m.itemId}/adj/${k}`] = adjEntry(m, m.qty, 'good');
        if (m.itemDef && !T.CATALOG[m.itemId]) updates[`dockets/${m.toWorkerId}/customItems/${m.itemId}`] = m.itemDef;
        const toDocket = await val(iref(ctx, ctx.year, `dockets/${m.toWorkerId}/hiddenItems/${m.itemId}`));
        if (toDocket) updates[`dockets/${m.toWorkerId}/hiddenItems/${m.itemId}`] = null;
      }
      if (m.fromWorkerId) updates[`dockets/${m.fromWorkerId}/ledger/${m.itemId}/adj/${k}`] = adjEntry(m, -m.qty, m.bucket || 'good');
    }
    updates[`audit/${uid('a')}`] = { at: now, byId: ctx.actorId, byName: ctx.actorName, action: `movement_${status}`, target: id };
    await iref(ctx, ctx.year).update(updates);
    return { ok: true };
  }
  // Head Teacher approves / rejects a write-off.
  async function decideWriteOff(ctx, id, approve, note) {
    const m = await loadMovement(ctx, id, ctx.year);
    if (!m || m.type !== 'writeOff' || m.status !== 'pending') return { ok: false, message: 'Haipo au imeshashughulikiwa' };
    if (m.fromWorkerId === ctx.workerId && !ctx.isAdmin) return { ok: false, message: 'Huwezi kuidhinisha ombi lako mwenyewe' };
    const now = Date.now();
    const status = approve ? 'approved' : 'rejected';
    const updates = {
      [`movements/${m.ymd}/${id}/status`]: status,
      [`movements/${m.ymd}/${id}/${approve ? 'approvedAt' : 'rejectedAt'}`]: now,
      [`movements/${m.ymd}/${id}/approvedBy`]: ctx.actorName,
      [`movements/${m.ymd}/${id}/decisionNote`]: note || '',
      [`pendingApprovals/${id}`]: null,
      [`dockets/${m.fromWorkerId}/outgoing/${id}`]: null,
      [`audit/${uid('a')}`]: { at: now, byId: ctx.actorId, byName: ctx.actorName, action: `writeoff_${status}`, target: id },
    };
    if (approve) updates[`dockets/${m.fromWorkerId}/ledger/${m.itemId}/adj/${uid('j')}`] = adjEntry(m, -m.qty, m.bucket || 'lost');
    if (m.repairId) {
      const ry = m.repairYear || ctx.year;
      if (ry === ctx.year) {
        updates[`repairs/${m.repairId}/history/${uid('h')}`] = repairEntry(ctx, 'cannotRepair', approve ? 'Write-off imeidhinishwa' : 'Write-off imekataliwa');
      }
    }
    await iref(ctx, ctx.year).update(updates);
    return { ok: true };
  }
  async function listMovements(ctx, from, to) {
    const raw = await loadRange(ctx, 'movements', from, to);
    const out = [];
    Object.entries(raw).forEach(([ymd, day]) => Object.entries(day || {}).forEach(([id, m]) => out.push(Object.assign({ id, ymd }, m))));
    return out.sort((a, b) => (b.at || 0) - (a.at || 0));
  }

  // ---------- repairs ----------
  async function listRepairs(ctx, year) {
    const raw = (await val(iref(ctx, year || ctx.year, 'repairs'))) || {};
    return Object.entries(raw).map(([id, r]) => Object.assign({ id, year: year || ctx.year }, r)).sort((a, b) => (b.reportedAt || 0) - (a.reportedAt || 0));
  }
  function repairAgeDays(r, ymd) { return Math.max(0, daysBetween(r.reportYmd || ymdOf(r.reportedAt || Date.now()), ymd || todayYMD())); }
  function isStalled(r, settings, ymd) { return OPEN_REPAIR.includes(r.status) && repairAgeDays(r, ymd) > Number(settings?.stalledRepairDays || 7); }
  async function updateRepair(ctx, repair, action, data = {}) {
    const year = repair.year || ctx.year;
    const now = Date.now();
    const p = `repairs/${repair.id}`;
    const updates = {};
    const note = data.note || '';
    if (action === 'assign') {
      Object.assign(updates, {
        [`${p}/status`]: 'assigned', [`${p}/assignedTo`]: String(data.assignedTo || '').trim(), [`${p}/assigneeType`]: data.assigneeType || 'staff',
        [`${p}/dueDate`]: data.dueDate || '', [`${p}/estimatedCost`]: n0(data.estimatedCost), [`${p}/assignedAt`]: now,
      });
    } else if (action === 'inProgress') {
      updates[`${p}/status`] = 'inProgress';
    } else if (action === 'repaired') {
      Object.assign(updates, { [`${p}/status`]: 'repaired', [`${p}/repairedAt`]: now, [`${p}/actualCost`]: n0(data.actualCost), [`${p}/repairedBy`]: ctx.actorName });
    } else if (action === 'confirm') {
      Object.assign(updates, { [`${p}/status`]: 'confirmed', [`${p}/confirmedAt`]: now, [`${p}/confirmedBy`]: ctx.actorName });
      updates[`dockets/${repair.workerId}/openRepairs/${repair.itemId}`] = null;
    } else if (action === 'cannotRepair') {
      updates[`${p}/status`] = 'cannotRepair';
      updates[`${p}/closedAt`] = now;
      updates[`dockets/${repair.workerId}/openRepairs/${repair.itemId}`] = null;
    } else if (action === 'reopen') {
      updates[`${p}/status`] = 'reported';
    } else return { ok: false };
    updates[`${p}/history/${uid('h')}`] = repairEntry(ctx, updates[`${p}/status`] || repair.status, note || (action === 'assign' ? `→ ${data.assignedTo || ''}` : ''));
    updates[`audit/${uid('a')}`] = { at: now, byId: ctx.actorId, byName: ctx.actorName, action: `repair_${action}`, target: repair.id };
    await iref(ctx, year).update(updates);
    if (action === 'cannotRepair') {
      // Unrepairable items leave the docket only through an approved write-off.
      await createMovement(ctx, {
        type: 'writeOff', itemId: repair.itemId, itemName: repair.itemName, qty: Math.max(1, n0(repair.qty)), bucket: 'damaged',
        fromWorkerId: repair.workerId, fromWorkerName: repair.workerName, fromArea: repair.area, reason: note || 'Haiwezi kutengenezwa · Cannot be repaired',
        repairId: repair.id, repairYear: year,
      });
    }
    return { ok: true };
  }

  // ---------- spot checks ----------
  async function ensureWeekPlan(ctx, ymd) {
    const year = yearOf(ymd);
    const monday = weekMonday(ymd);
    const existing = await val(iref(ctx, year, `spotPlan/${monday}`));
    if (existing) return existing;
    const settings = await loadSettings(ctx, year);
    const dockets = await loadDockets(ctx, year);
    const recentCut = Date.now() - 14 * DAY_MS;
    const candidates = Object.entries(dockets).filter(([wid, d]) => d && !d.endedAt && (d.latest?.submittedAt || 0) >= recentCut && isEnabledFor(settings, wid))
      .map(([wid, d]) => ({ workerId: wid, workerName: d.workerName || wid, area: d.area || '', role: d.role || '', last: d.lastSpotCheckAt || 0 }));
    const n = Math.min(candidates.length, Math.max(0, Number(settings.spotChecksPerWeek || 2)));
    // Fair rotation: dockets not checked for the longest come first (never checked = first), random among equals.
    candidates.sort((a, b) => ((a.last || 0) - (b.last || 0)) || (Math.random() - 0.5));
    const days = [];
    for (let i = 0; i < 5; i += 1) { const d = addDays(monday, i); if (d >= ymd) days.push(d); }
    if (!days.length) days.push(ymd);
    const picks = {};
    candidates.slice(0, n).forEach((c) => {
      const id = uid('p');
      picks[id] = Object.assign({}, c, { ymd: days[Math.floor(Math.random() * days.length)], done: false });
    });
    const plan = { monday, planned: n, generatedAt: Date.now(), picks };
    await iref(ctx, year, `spotPlan/${monday}`).set(plan);
    return plan;
  }
  async function saveSpotCheck(ctx, input) {
    const { workerId, report, docketArea, findings, planPickId, items } = input;
    const ymd = todayYMD();
    const year = yearOf(ymd);
    const now = Date.now();
    const id = uid('s');
    const defsById = Object.fromEntries((items || []).map((d) => [d.id, d]));
    const mismatches = Object.entries(findings).filter(([, f]) => f && f.match === false);
    const updates = {};
    const discrepancyItems = [];
    mismatches.forEach(([itemId, f]) => {
      const reported = report?.items?.[itemId] || {};
      const reportedOk = reported.type === 'cond' ? reported.ok !== false : !(n0(reported.damaged) > 0 || n0(reported.lost) > 0);
      const foundProblem = f.foundProblem !== false;
      const def = defsById[itemId] || {};
      if (reportedOk && foundProblem) {
        discrepancyItems.push(itemId);
        // The problem was first found by inspection: open a repair ticket marked spotCheck.
        if (f.needsRepair !== false && (def.type === 'cond' || def.type === 'count')) {
          const rid = uid('r');
          updates[`repairs/${rid}`] = {
            itemId, itemName: itemName(def), category: def.cat || 'other', area: docketArea || '', workerId, workerName: report?.workerName || '',
            role: report?.role || '', qty: Math.max(1, n0(f.qty)), description: f.note || '', reportedAt: now, reportYmd: ymd, source: 'spotCheck',
            status: 'reported', currency: 'TZS', spotCheckId: id, history: { [uid('h')]: repairEntry(ctx, 'reported', `Ukaguzi wa ghafla: ${f.note || ''}`) },
          };
          updates[`dockets/${workerId}/openRepairs/${itemId}`] = { id: rid, year };
        }
      }
    });
    const discrepancy = discrepancyItems.length > 0;
    updates[`spotChecks/${ymd}/${id}`] = {
      byId: ctx.actorId, byName: ctx.actorName, workerId, workerName: report?.workerName || '', area: docketArea || '', role: report?.role || '',
      reportYmd: report?.ymd || '', reportStatus: report?.status || 'none', findings, discrepancy, discrepancyItems, at: now, planned: !!planPickId,
    };
    if (discrepancy) {
      const fid = uid('f');
      const detail = discrepancyItems.map((i) => `${itemName(defsById[i])}: ${findings[i]?.note || ''}`).join('; ');
      updates[`flags/${ymd}/${fid}`] = { type: 'spot_discrepancy', workerId, workerName: report?.workerName || '', area: docketArea || '', at: now, resolved: false, detail, spotCheckId: id, reportYmd: report?.ymd || '' };
      updates[`discrepancies/${workerId}/${id}`] = { ymd, at: now, byName: ctx.actorName, items: discrepancyItems, detail, reportYmd: report?.ymd || '', reportNoChanges: !!report?.noChanges };
    }
    updates[`dockets/${workerId}/lastSpotCheckAt`] = now;
    if (planPickId) {
      const monday = weekMonday(ymd);
      updates[`spotPlan/${monday}/picks/${planPickId}/done`] = true;
      updates[`spotPlan/${monday}/picks/${planPickId}/spotCheckId`] = id;
      updates[`spotPlan/${monday}/picks/${planPickId}/doneAt`] = now;
    }
    updates[`audit/${uid('a')}`] = { at: now, byId: ctx.actorId, byName: ctx.actorName, action: 'spot_check', target: workerId, detail: { discrepancy } };
    await iref(ctx, year).update(updates);
    return { ok: true, id, discrepancy };
  }
  // Planned vs done for a week, counting ad-hoc checks too.
  async function weekSpotStats(ctx, ymd) {
    const monday = weekMonday(ymd);
    const plan = await val(iref(ctx, yearOf(monday), `spotPlan/${monday}`));
    const checks = await loadRange(ctx, 'spotChecks', monday, addDays(monday, 6));
    const done = Object.values(checks).reduce((n, day) => n + Object.keys(day || {}).length, 0);
    const picks = Object.entries(plan?.picks || {}).map(([id, p]) => Object.assign({ id }, p));
    return { monday, planned: Number(plan?.planned || 0), done, plannedDone: picks.filter((p) => p.done).length, picks, behind: picks.filter((p) => !p.done && p.ymd < ymd).length };
  }

  // ---------- guard shift handover ----------
  async function pendingShiftHandover(ctx, docket) {
    if (docket.role !== 'guard') return null;
    const ymd = todayYMD();
    const days = [ymd, addDays(ymd, -1)];
    const mineAt = (docket.latest?.submittedAt) || 0;
    let best = null;
    for (const day of days) {
      const reports = await loadDay(ctx, day);
      Object.entries(reports).forEach(([wid, r]) => {
        if (wid === ctx.workerId || !r || r.role !== 'guard' || !['submitted', 'approved'].includes(r.status)) return;
        if (String(r.area || '').toLowerCase().trim() !== String(docket.area || '').toLowerCase().trim()) return;
        if ((r.submittedAt || 0) <= mineAt || (r.submittedAt || 0) < Date.now() - DAY_MS) return;
        if (!best || r.submittedAt > best.submittedAt) best = Object.assign({ workerId: wid, ymd: day }, r);
      });
    }
    if (!best) return null;
    const hid = keySafe(`shift_${best.ymd}_${best.workerId}_${ctx.workerId}`);
    const done = await val(iref(ctx, yearOf(best.ymd), `handovers/${hid}`));
    if (done) return null;
    const shift = await val(sref(ctx, `security/${yearOf(ymd)}/shifts/${ymd}`)) || await val(db().ref(`schools/${ctx.schoolId}/security/${yearOf(ymd)}/shifts/${ymd}`));
    return { id: hid, from: best, shiftRecord: shift || null };
  }
  async function saveShiftHandover(ctx, pending, differences, items) {
    const now = Date.now();
    const year = yearOf(pending.from.ymd);
    const diffs = Object.entries(differences || {}).filter(([, d]) => d && String(d.note || '').trim());
    const defsById = Object.fromEntries((items || []).map((d) => [d.id, d]));
    const updates = {
      [`handovers/${pending.id}`]: {
        type: 'shift', fromWorkerId: pending.from.workerId, fromName: pending.from.workerName || '', toWorkerId: ctx.workerId, toName: ctx.workerName,
        area: pending.from.area || '', fromReportYmd: pending.from.ymd, at: now, status: diffs.length ? 'differences' : 'received',
        differences: Object.fromEntries(diffs),
      },
    };
    if (diffs.length) {
      const fid = uid('f');
      updates[`flags/${todayYMD()}/${fid}`] = {
        type: 'handover_difference', workerId: pending.from.workerId, workerName: pending.from.workerName || '', area: pending.from.area || '', at: now, resolved: false,
        detail: `${ctx.workerName}: ${diffs.map(([id, d]) => `${itemName(defsById[id]) || id} — ${d.note}`).join('; ')}`,
      };
    }
    await iref(ctx, year).update(updates);
    return { ok: true, differences: diffs.length };
  }

  // ---------- worker-change handover ----------
  async function startChangeHandover(ctx, data) {
    const id = uid('h');
    const now = Date.now();
    await iref(ctx, ctx.year, `handovers/${id}`).set({
      type: 'change', fromWorkerId: data.fromWorkerId, fromName: data.fromName || '', toWorkerId: data.toWorkerId, toName: data.toName || '',
      area: data.area || '', role: data.role || '', items: data.items || {}, itemDefs: data.itemDefs || {}, startedBy: ctx.actorName, startedAt: now, status: 'awaitingConfirm', note: data.note || '',
    });
    await audit(ctx, ctx.year, 'handover_started', id, { from: data.fromWorkerId, to: data.toWorkerId });
    return { ok: true, id };
  }
  async function listHandovers(ctx, year) {
    const raw = (await val(iref(ctx, year || ctx.year, 'handovers'))) || {};
    return Object.entries(raw).map(([id, h]) => Object.assign({ id }, h)).sort((a, b) => (b.startedAt || b.at || 0) - (a.startedAt || a.at || 0));
  }
  async function confirmChangeHandover(ctx, handover) {
    const year = ctx.year;
    const now = Date.now();
    const side = handover.fromWorkerId === ctx.workerId ? 'from' : handover.toWorkerId === ctx.workerId ? 'to' : '';
    if (!side) return { ok: false, message: 'Makabidhiano haya si yako' };
    const updates = { [`handovers/${handover.id}/${side}ConfirmedAt`]: now };
    const other = side === 'from' ? handover.toConfirmedAt : handover.fromConfirmedAt;
    if (other) {
      // Both confirmed: the counted state becomes the new worker's approved starting point.
      const fromDocket = (await val(iref(ctx, year, `dockets/${handover.fromWorkerId}`))) || {};
      const toDocket = (await val(iref(ctx, year, `dockets/${handover.toWorkerId}`))) || {};
      const custom = Object.assign({}, toDocket.customItems || {});
      Object.entries(handover.itemDefs || {}).forEach(([id, def]) => { if (!T.CATALOG[id]) custom[id] = def; });
      const state = { ymd: todayYMD(), status: 'approved', submittedAt: now, items: handover.items || {}, handover: handover.id };
      Object.assign(updates, {
        [`handovers/${handover.id}/status`]: 'completed',
        [`handovers/${handover.id}/completedAt`]: now,
        [`docketArchive/${handover.fromWorkerId}/${now}`]: Object.assign({}, fromDocket, { archivedAt: now, handoverId: handover.id }),
        [`dockets/${handover.fromWorkerId}/endedAt`]: now,
        [`dockets/${handover.fromWorkerId}/latest`]: null,
        [`dockets/${handover.fromWorkerId}/prior`]: null,
        [`dockets/${handover.fromWorkerId}/lastApproved`]: null,
        [`dockets/${handover.fromWorkerId}/ledger`]: null,
        [`dockets/${handover.fromWorkerId}/openRepairs`]: null,
        [`dockets/${handover.fromWorkerId}/area`]: '',
        [`dockets/${handover.toWorkerId}/area`]: handover.area || toDocket.area || '',
        [`dockets/${handover.toWorkerId}/role`]: toDocket.role || handover.role || fromDocket.role || '',
        [`dockets/${handover.toWorkerId}/customItems`]: custom,
        [`dockets/${handover.toWorkerId}/latest`]: state,
        [`dockets/${handover.toWorkerId}/prior`]: null,
        [`dockets/${handover.toWorkerId}/lastApproved`]: Object.assign({ approvedAt: now, approvedByName: 'Makabidhiano' }, state),
        [`dockets/${handover.toWorkerId}/ledger`]: null,
        [`dockets/${handover.toWorkerId}/baselineApprovedAt`]: now,
        [`dockets/${handover.toWorkerId}/endedAt`]: null,
        [`dockets/${handover.toWorkerId}/openRepairs`]: Object.assign({}, toDocket.openRepairs || {}, fromDocket.openRepairs || {}),
      });
      Object.values(fromDocket.openRepairs || {}).forEach((r) => {
        if (r?.id && (r.year || year) === year) {
          updates[`repairs/${r.id}/workerId`] = handover.toWorkerId;
          updates[`repairs/${r.id}/workerName`] = handover.toName || '';
        }
      });
    }
    updates[`audit/${uid('a')}`] = { at: now, byId: ctx.actorId, byName: ctx.actorName, action: 'handover_confirmed', target: handover.id, detail: { side } };
    await iref(ctx, year).update(updates);
    return { ok: true, completed: !!other };
  }

  // ---------- misc ----------
  async function markSeen(ctx, ymd, reportWorkerId, itemId) {
    await iref(ctx, yearOf(ymd), `seen/${ymd}/${keySafe(`${reportWorkerId}_${itemId}`)}`).set({ guardId: ctx.workerId, guardName: ctx.workerName, at: Date.now() });
  }
  async function audit(ctx, year, action, target, detail) {
    try {
      await iref(ctx, year || ctx.year, 'audit').push({ at: Date.now(), byId: ctx.actorId || '', byName: ctx.actorName || '', action, target: target || '', detail: detail || null });
    } catch (err) { console.warn('SomapInventory audit failed', err); }
  }
  async function loadSchoolMeta(ctx) {
    const profile = await val(db().ref(`schools/${ctx.schoolId}/profile`));
    const root = profile ? null : await val(db().ref(`schools/${ctx.schoolId}`).child('name'));
    return {
      name: profile?.name || profile?.schoolName || root || ctx.schoolName || ctx.schoolId,
      registrationNumber: profile?.registrationNumber || profile?.registrationNo || profile?.regNo || '',
      logoUrl: profile?.logoUrl || '',
    };
  }
  // Honest-reporting counts for one worker: self-reported problems vs spot-check discrepancies.
  async function workerRecord(ctx, workerId, year) {
    const y = year || ctx.year;
    const [repairs, discrepancies, lossLog] = await Promise.all([listRepairs(ctx, y), val(iref(ctx, y, `discrepancies/${workerId}`)), val(iref(ctx, y, `dockets/${workerId}/lossLog`))]);
    const mine = repairs.filter((r) => r.workerId === workerId);
    const losses = Object.values(lossLog || {}).reduce((sum, day) => sum + Object.keys(day || {}).length, 0);
    return {
      selfReported: mine.filter((r) => r.source !== 'spotCheck' && r.status !== 'cancelled').length + losses,
      spotCheckDiscrepancies: Object.keys(discrepancies || {}).length,
      discrepancies: Object.entries(discrepancies || {}).map(([id, d]) => Object.assign({ id }, d)).sort((a, b) => (b.at || 0) - (a.at || 0)),
      openRepairs: mine.filter((r) => OPEN_REPAIR.includes(r.status)),
    };
  }

  const HONEST_MESSAGE = {
    sw: 'Ukiripoti uharibifu siku hiyo hiyo, ni suala la matengenezo. Ukisema sawa na ukaguzi ukakuta si sawa, ni suala la nidhamu.',
    en: 'Damage reported the same day is a maintenance issue. Damage found by inspection after you said OK is a discipline issue.',
  };

  global.SomapInventory = {
    version: '2026-10-25',
    URLS, TZ, DEFAULT_SETTINGS, OPEN_REPAIR, REASON_LABELS, PROBLEM_LABELS, HONEST_MESSAGE, T,
    util: { esc, pad, n0, todayYMD, ymdOf, yearOf, addDays, daysBetween, weekMonday, fmtTime, fmtDateTime, fmtDaySw, normRole, uid, clone, slug, storageGet, storageSet, storageDel, keySafe },
    ensureFirebase, schoolPrefix, basePath, iref, sref, val,
    templateRoleKey, isHeadteacher, roleLabel, resolveContext, detectAdmin, loadProfile, loadTeacherConfig,
    loadSettings, saveSettings, isEnabledFor,
    templateItems, saveTemplateOverride, docketItems, catalogDef, itemName,
    loadDocket, saveDocketMeta, addCustomItem, loadDockets,
    totalOf, computeBasis, analyze, expiryState,
    loadReport, loadDay, loadRange, todayStatus, saveDraft, loadOpenTickets, submitReport,
    getQueue, approveReport, approveMany, returnReport,
    loadRoster, attendanceDay, notSubmitted, schoolTotals, totalsPhrase, writeSummary,
    createMovement, loadMovement, respondMovement, decideWriteOff, listMovements,
    listRepairs, repairAgeDays, isStalled, updateRepair,
    ensureWeekPlan, saveSpotCheck, weekSpotStats,
    pendingShiftHandover, saveShiftHandover, startChangeHandover, listHandovers, confirmChangeHandover,
    markSeen, audit, loadSchoolMeta, workerRecord,
  };
})(window);
