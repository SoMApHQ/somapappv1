// SoMAp Secretary Desk — shared access helper.
//
// A worker registered with role "secretary" opens the Secretary Hub from the
// workers dashboard. That starts a per-tab secretary session (sessionStorage)
// which every secretary page re-verifies against Firebase before showing data.
//
// Each school's desk is configured in SECRETARY_DESKS. Socrates is the first
// configured desk: graduation follow-up, Preform One, and management access to
// the dashboards of MAU and MAP — never Socrates' own dashboard and never any
// approvals page. Schools without a configured desk get an empty, ready hub.
(function (global) {
  'use strict';

  const SESSION_KEY = 'somap.secretarySession';
  // Set while the secretary is working inside a linked school's dashboard, so the
  // browser's school context can always be put back to the secretary's own school.
  const AWAY_KEY = 'somap.secretaryAway';
  const SOCRATES_IDS = ['socrates-school', 'socrates', 'default'];
  const SECRETARY_ROLES = ['secretary', 'katibu'];

  const SECRETARY_DESKS = {
    'socrates-school': {
      graduation: true,
      preformOne: true,
      linkedSchools: [
        { id: 'mnyore-academy-uswahilini-mau', short: 'MAU', name: 'Mnyore Academy Uswahilini' },
        { id: 'mnyore-academy-dampo-map', short: 'MAP', name: 'Mnyore Academy Dampo' },
      ],
    },
  };

  const EMPTY_DESK = { graduation: false, preformOne: false, linkedSchools: [] };

  // Pages the secretary opens inside a linked school (paths from the app root).
  // They are reached through the hub (?go=page&school=id) so the school switch
  // always happens in one place.
  const LINKED_PAGES = {
    dashboard: 'dashboard.html?secretary=1',
    attendance: 'Toattendancehtml/classattendance.html',
    finance: 'finance.html',
    expenses: 'finance.html#cashbookSection',
  };
  const SCHOOL_KEY = 'somap.currentSchoolId';
  // App root URL, worked out from this script's own location (js/secretary_access.js).
  const APP_ROOT = (() => {
    try { return new URL('../', global.document.currentScript.src).href; } catch (_) { return ''; }
  })();

  function canonicalSchoolId(id) {
    const raw = String(id || '').trim();
    return SOCRATES_IDS.includes(raw.toLowerCase()) ? 'socrates-school' : raw;
  }

  function isSocrates(id) {
    return canonicalSchoolId(id) === 'socrates-school';
  }

  function deskFor(homeSchoolId) {
    return SECRETARY_DESKS[canonicalSchoolId(homeSchoolId)] || EMPTY_DESK;
  }

  function currentSchoolId() {
    try { return global.SOMAP?.getSchoolId?.() || ''; } catch (_) { return ''; }
  }

  function selectedYear() {
    try {
      return String(global.somapYearContext?.getSelectedYear?.() || new Date().getFullYear());
    } catch (_) {
      return String(new Date().getFullYear());
    }
  }

  function readJson(storage, key) {
    try { return JSON.parse(storage.getItem(key) || 'null'); } catch (_) { return null; }
  }

  function getSession() {
    const s = readJson(global.sessionStorage, SESSION_KEY);
    return s && s.workerId && s.homeSchoolId ? s : null;
  }

  function saveSession(session) {
    try { global.sessionStorage.setItem(SESSION_KEY, JSON.stringify(session)); } catch (_) { /* ignore */ }
  }

  function endSession() {
    restoreHomeSchool();
    try { global.sessionStorage.removeItem(SESSION_KEY); } catch (_) { /* ignore */ }
  }

  function workerPaths(homeSchoolId, year, workerId) {
    const home = canonicalSchoolId(homeSchoolId);
    if (home === 'socrates-school') return [`years/${year}/workers/${workerId}`, `workers/${workerId}`];
    return [`schools/${home}/years/${year}/workers/${workerId}`];
  }

  function roleOf(worker) {
    const p = worker?.profile || {};
    return String(p.role || worker?.role || p.jobTitle || p.position || '').trim().toLowerCase();
  }

  function nameOf(worker) {
    const p = worker?.profile || {};
    return String(p.fullNameUpper || [p.firstName, p.middleName, p.lastName].filter(Boolean).join(' ') || p.fullName || p.name || '')
      .trim().toUpperCase();
  }

  // Confirms from Firebase that `workerId` is an active secretary of `homeSchoolId`.
  async function verifyWorker(db, homeSchoolId, workerId, year) {
    if (!db || !homeSchoolId || !workerId) return null;
    for (const path of workerPaths(homeSchoolId, year, workerId)) {
      try {
        const snap = await db.ref(path).once('value');
        if (!snap.exists()) continue;
        const worker = snap.val() || {};
        if (worker.profile?.active === false) return null;
        if (!SECRETARY_ROLES.includes(roleOf(worker))) return null;
        return { workerId, name: nameOf(worker) || 'SECRETARY', phone: worker.profile?.phone || '' };
      } catch (err) {
        console.warn('Secretary verification read failed', path, err?.message || err);
      }
    }
    return null;
  }

  // Called by the Secretary Hub: starts (or refreshes) the tab's secretary session
  // for the worker signed in on the workers dashboard.
  async function startFromWorkerLogin(db) {
    restoreHomeSchool();
    const existing = getSession();
    const workerId = (global.localStorage.getItem('workerId') || '').trim();
    if (!workerId) return null;
    const homeSchoolId = canonicalSchoolId(
      existing && existing.workerId === workerId ? existing.homeSchoolId : currentSchoolId()
    );
    if (!homeSchoolId) return null;
    const year = selectedYear();
    const verified = await verifyWorker(db, homeSchoolId, workerId, year);
    if (!verified) {
      try { global.sessionStorage.removeItem(SESSION_KEY); } catch (_) { /* ignore */ }
      return null;
    }
    let homeSchoolName = existing?.homeSchoolName || '';
    // The hub always works from the secretary's own school context.
    if (canonicalSchoolId(currentSchoolId()) !== homeSchoolId && global.SOMAP?.setSchool) {
      global.SOMAP.setSchool({ id: homeSchoolId, name: homeSchoolName || undefined });
    } else {
      try { homeSchoolName = global.SOMAP?.getSchool?.()?.name || homeSchoolName; } catch (_) { /* ignore */ }
    }
    const session = {
      workerId,
      name: verified.name,
      homeSchoolId,
      homeSchoolName: homeSchoolName || (isSocrates(homeSchoolId) ? 'Socrates School' : homeSchoolId),
      year,
      verifiedAt: Date.now(),
    };
    saveSession(session);
    return session;
  }

  // Re-checks an existing tab session against Firebase (used by gated pages).
  async function verifySession(db) {
    const session = getSession();
    if (!session) return null;
    const verified = await verifyWorker(db, session.homeSchoolId, session.workerId, session.year || selectedYear());
    if (!verified) {
      endSession();
      return null;
    }
    return { ...session, name: verified.name || session.name };
  }

  function isLinkedSchool(session, schoolId) {
    if (!session) return false;
    const id = String(schoolId || '').trim();
    return deskFor(session.homeSchoolId).linkedSchools.some((s) => s.id === id);
  }

  // Switches the browser's school context into a linked school (MAU / MAP) and
  // remembers the secretary's own school so it can always be restored.
  function enterLinkedSchool(schoolId, schoolMeta) {
    const session = getSession();
    if (!session || !isLinkedSchool(session, schoolId)) return false;
    try {
      global.localStorage.setItem(AWAY_KEY, JSON.stringify({
        homeSchoolId: session.homeSchoolId,
        homeSchoolName: session.homeSchoolName,
        linkedSchoolId: schoolId,
        at: Date.now(),
      }));
    } catch (_) { /* ignore */ }
    global.SOMAP?.setSchool?.({ id: schoolId, ...(schoolMeta || {}) });
    return true;
  }

  // Puts the school context back to the secretary's own school if a linked-school
  // visit left it switched. Safe to call on any page; a no-op otherwise.
  function restoreHomeSchool() {
    const away = readJson(global.localStorage, AWAY_KEY);
    if (!away || !away.homeSchoolId) return false;
    try { global.localStorage.removeItem(AWAY_KEY); } catch (_) { /* ignore */ }
    if (!global.SOMAP?.setSchool) return false;
    // Only undo the secretary's own switch: if someone has since picked a different
    // school on purpose, leave their choice alone.
    if (away.linkedSchoolId && currentSchoolId() !== away.linkedSchoolId) return false;
    if (canonicalSchoolId(currentSchoolId()) === canonicalSchoolId(away.homeSchoolId)) return false;
    global.SOMAP.setSchool({
      id: canonicalSchoolId(away.homeSchoolId),
      name: away.homeSchoolName || (isSocrates(away.homeSchoolId) ? 'Socrates School' : undefined),
    });
    return true;
  }

  // Gate used by dashboard.html. Returns:
  //   'none'    — no secretary session in this tab; page continues normally
  //   'linked'  — verified secretary inside a linked school; page runs secretary mode
  //   'blocked' — secretary session but this school is not allowed (redirect done)
  async function dashboardGate(db, hubUrl) {
    if (!getSession()) return 'none';
    const session = await verifySession(db);
    if (!session) return 'none';
    const schoolId = currentSchoolId();
    if (isLinkedSchool(session, schoolId)) return 'linked';
    restoreHomeSchool();
    if (global.Swal?.fire) {
      await global.Swal.fire({
        icon: 'error',
        title: 'Hairuhusiwi',
        text: 'Secretary access does not include this school\'s dashboard.',
        confirmButtonColor: '#db2777',
      });
    }
    global.location.href = hubUrl;
    return 'blocked';
  }

  function isApprovalsUrl(href) {
    const h = String(href || '').toLowerCase();
    return h.includes('approvals') || h.includes('view=review');
  }

  // Hub link that opens `page` (a LINKED_PAGES key) inside a linked school.
  function linkedPageHref(hubUrl, schoolId, page) {
    return `${hubUrl}?go=${encodeURIComponent(page)}&school=${encodeURIComponent(schoolId)}`;
  }

  // The school context is shared by all tabs. A page the secretary opened inside
  // a linked school stops (with a clear overlay) the moment another tab switches
  // the school, so nothing is ever saved into the wrong school by accident.
  function guardLinkedTab(options) {
    const session = getSession();
    const schoolId = currentSchoolId();
    if (!session || !isLinkedSchool(session, schoolId)) return false;
    if (options?.backPill && APP_ROOT && !global.document.getElementById('secretaryBackPill')) {
      const pill = global.document.createElement('a');
      pill.id = 'secretaryBackPill';
      pill.href = `${APP_ROOT}workershtml/secretary/secretaryhub.html`;
      pill.textContent = '← Secretary Hub';
      pill.setAttribute('style', 'position:fixed;left:14px;bottom:14px;z-index:2147482000;padding:10px 16px;border-radius:999px;font:700 13px Inter,system-ui,sans-serif;color:#1a0b24;text-decoration:none;background:linear-gradient(135deg,#f472b6,#a78bfa);box-shadow:0 10px 30px -10px rgba(244,114,182,.8)');
      pill.addEventListener('click', () => restoreHomeSchool());
      global.document.body.appendChild(pill);
    }
    const linked = deskFor(session.homeSchoolId).linkedSchools.find((s) => s.id === schoolId) || { short: schoolId };
    let meta = {};
    try { meta = global.SOMAP?.getSchool?.() || {}; } catch (_) { /* ignore */ }
    let overlay = null;
    const check = () => {
      if (currentSchoolId() === schoolId) {
        if (overlay) { overlay.remove(); overlay = null; }
        return;
      }
      if (overlay) return;
      overlay = global.document.createElement('div');
      overlay.setAttribute('style', 'position:fixed;inset:0;z-index:2147483000;display:grid;place-items:center;padding:16px;background:rgba(3,6,18,.85);backdrop-filter:blur(6px);font-family:Inter,system-ui,sans-serif');
      overlay.innerHTML = `<div style="max-width:440px;background:#0f1630;color:#e7ecff;border:1px solid rgba(251,113,133,.4);border-radius:22px;padding:26px;text-align:center">
          <div style="font-size:2.4rem">🔁</div>
          <h2 style="margin:8px 0;font-size:1.2rem">Shule imebadilishwa kwenye tab nyingine</h2>
          <p style="color:#aab3d6;line-height:1.5;font-size:.92rem">Ukurasa huu ni wa <b>${linked.short}</b>. Ili usihifadhi chochote kwenye shule isiyo sahihi, rudi ${linked.short} kwanza.</p>
          <button type="button" style="margin-top:8px;padding:11px 18px;border:0;border-radius:12px;font-weight:700;cursor:pointer;background:linear-gradient(135deg,#f472b6,#a78bfa);color:#1a0b24">Rudi ${linked.short} &amp; Pakia upya</button></div>`;
      overlay.querySelector('button').addEventListener('click', () => {
        if (enterLinkedSchool(schoolId, meta)) global.location.reload();
      });
      global.document.body.appendChild(overlay);
    };
    global.addEventListener('storage', (e) => { if (!e.key || e.key === SCHOOL_KEY) check(); });
    global.addEventListener('focus', check);
    return true;
  }

  global.SomapSecretary = {
    SESSION_KEY,
    deskFor,
    canonicalSchoolId,
    isSocrates,
    getSession,
    endSession,
    startFromWorkerLogin,
    verifySession,
    isLinkedSchool,
    enterLinkedSchool,
    restoreHomeSchool,
    dashboardGate,
    isApprovalsUrl,
    LINKED_PAGES,
    linkedPageHref,
    guardLinkedTab,
    APP_ROOT,
  };
})(window);
