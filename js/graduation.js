(function (window) {
  'use strict';

  // ---------- BASIC GUARDS ----------
  if (!window.firebase) {
    console.error('GraduationSuite: firebase SDK missing');
    return;
  }

  // ---------- SETTINGS / CONSTANTS ----------
  const AUTHORIZED_EMAILS = new Set([
    'ssclass42023@gmail.com',
    'socratesschool2020@gmail.com',
  ]);

  const YEAR_START = 2024;
  const YEAR_END = Math.max(2032, new Date().getFullYear() + 5);
  const YEARS = [];
  for (let year = YEAR_START; year <= YEAR_END; year += 1) YEARS.push(year);
  const ROSTER_BASE_YEAR = 2025;
  const CLASS_ORDER = ['Baby Class', 'Middle Class', 'Pre Unit Class', 'Class 1', 'Class 2', 'Class 3', 'Class 4', 'Class 5', 'Class 6', 'Class 7'];

  const GRAD_EDIT_PASSWORD = 'REHEMam!';

  // ==== DELETE/AUDIT AUTH GUARD ====
  const DELETE_PASSWORD = 'REHEMam!';
  const DELETE_MODE_MINUTES = 15;
  const MAX_FAILS = 5;
  const LOCKOUT_MS = 2 * 60 * 1000;

  const AUTH_UNTIL_KEY = 'gradDeleteAuthUntil';
  const FAILS_KEY = 'gradDeleteFailCount';
  const LOCK_UNTIL_KEY = 'gradDeleteLockUntil';

  const safeSession = {
    get(key) { try { return sessionStorage.getItem(key); } catch (_) { return null; } },
    set(key, value) { try { sessionStorage.setItem(key, value); } catch (_) {} },
    remove(key) { try { sessionStorage.removeItem(key); } catch (_) {} },
  };

  function nowMs() { return Date.now(); }

  function isDeleteModeActive() {
    const until = Number(safeSession.get(AUTH_UNTIL_KEY) || 0);
    return nowMs() < until;
  }

  function clearDeleteMode() {
    safeSession.remove(AUTH_UNTIL_KEY);
    safeSession.remove(FAILS_KEY);
    safeSession.remove(LOCK_UNTIL_KEY);
    alert('Delete mode cleared.');
  }

  function remainingLockMs() {
    const lockUntil = Number(safeSession.get(LOCK_UNTIL_KEY) || 0);
    return Math.max(lockUntil - nowMs(), 0);
  }

  async function requireDeleteAuth() {
    if (isDeleteModeActive()) return true;

    const rem = remainingLockMs();
    if (rem > 0) {
      const secs = Math.ceil(rem / 1000);
      alert(`Too many wrong attempts. Try again in ${secs} seconds.`);
      return false;
    }

    const input = prompt('Enter delete password to proceed:', '');
    if (input == null) return false;

    if (input === DELETE_PASSWORD) {
      const until = nowMs() + DELETE_MODE_MINUTES * 60 * 1000;
      safeSession.set(AUTH_UNTIL_KEY, String(until));
      safeSession.remove(FAILS_KEY);
      safeSession.remove(LOCK_UNTIL_KEY);
      return true;
    }

    const fails = 1 + Number(safeSession.get(FAILS_KEY) || 0);
    safeSession.set(FAILS_KEY, String(fails));
    if (fails >= MAX_FAILS) {
      safeSession.set(LOCK_UNTIL_KEY, String(nowMs() + LOCKOUT_MS));
      alert('Wrong password too many times. You are locked out for 2 minutes.');
    } else {
      alert(`Wrong password. Attempts: ${fails}/${MAX_FAILS}.`);
    }
    return false;
  }

  // ---------- STATE ----------
  const state = {
    page: 'dashboard',
    user: null,
    currentYear: new Date().getFullYear(),
    meta: {},
    students: {},
    payments: {},
    paymentTotals: {},
    expenses: {},
    vendors: {},
    certificates: {},
    galleries: {},
    audits: {},
    masterStudents: null,
    rosterYear: null,
    activeRosterKeys: new Set(),
    activeRosterLoaded: false,
    totalPresentToday: null,
    filters: { search: '', classLevel: 'all' },
    access: { mode: 'none', teacherClass: '', teacherEmail: '' },
    watchers: [],
    galleryUploading: false,
    graduandExtras: {},
    schoolBrand: null,
    certFilter: { group: 'all', search: '' },
  };

  // ---------- DOM HELPERS ----------
  const domCache = {};
  function $(selector) {
    if (!selector) return null;
    domCache[selector] = domCache[selector] || document.querySelector(selector);
    return domCache[selector];
  }

  function db() { return firebase.database(); }
  function auth() { return firebase.auth(); }
  function storage() {
    if (!firebase.storage) throw new Error('Firebase storage SDK missing');
    return firebase.storage();
  }

  // Cloudinary defaults (align with other modules)
  const CLD_CLOUD_NAME = localStorage.getItem('cloud_name') || 'dg7vnrkgd';
  const CLD_UPLOAD_PRESET = localStorage.getItem('upload_preset') || 'books_unsigned';
  const CLD_EXPENSE_FOLDER = 'somapappv1/graduation/expenses';
  const CLD_GALLERY_FOLDER = 'somapappv1/graduation/gallery';

  function toStr(value) { return value == null ? '' : String(value); }
  function sanitizeKey(raw) { return toStr(raw).replace(/[.#$/[\]]/g, '_'); }

  function checkGradPassword(candidate) {
    return String(candidate) === GRAD_EDIT_PASSWORD;
  }

  function toNumberSafe(value) {
    if (value == null || value === '') return 0;
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    const parsed = Number(String(value).replace(/,/g, '').trim());
    return Number.isFinite(parsed) ? parsed : 0;
  }

  function formatCurrency(amount) {
    return `TSh ${toNumberSafe(amount).toLocaleString('en-US', { maximumFractionDigits: 0 })}`;
  }

  function showToast(message, type = 'success', duration = 4000) {
    let host = $('#grad-toast');
    if (!host) {
      host = document.createElement('div');
      host.id = 'grad-toast';
      host.style.position = 'fixed';
      host.style.bottom = '24px';
      host.style.right = '24px';
      host.style.zIndex = '999';
      host.style.padding = '12px 18px';
      host.style.borderRadius = '14px';
      host.style.fontFamily = 'Inter, system-ui, sans-serif';
      host.style.color = '#fff';
      host.style.boxShadow = '0 20px 40px rgba(15,23,42,0.28)';
      host.style.backdropFilter = 'blur(14px)';
      document.body.appendChild(host);
    }
    const palette = type === 'error'
      ? 'linear-gradient(135deg,#f87171,#ef4444)'
      : type === 'warn'
        ? 'linear-gradient(135deg,#f97316,#facc15)'
        : 'linear-gradient(135deg,#34d399,#10b981)';
    host.style.background = palette;
    host.textContent = message;
    host.style.opacity = '1';
    clearTimeout(host.__timer);
    host.__timer = setTimeout(() => {
      host.style.transition = 'opacity .35s ease';
      host.style.opacity = '0';
    }, duration);
  }

  function setBusy(selector, busy) {
    const node = $(selector);
    if (!node) return;
    node.disabled = !!busy;
    if (busy) {
      node.dataset.originalText = node.dataset.originalText || node.textContent;
      node.textContent = 'Processing...';
    } else if (node.dataset.originalText) {
      node.textContent = node.dataset.originalText;
    }
  }

  function setText(selector, value) {
    const node = $(selector);
    if (node) node.textContent = value;
  }

  function detachWatchers() {
    state.watchers.forEach((off) => {
      try { off(); } catch (err) { console.warn('GraduationSuite watcher cleanup', err); }
    });
    state.watchers = [];
  }

  function listen(path, handler) {
    const ref = db().ref(path);
    const wrapped = (snapshot) => handler(snapshot.val() || {});
    ref.on('value', wrapped);
    state.watchers.push(() => ref.off('value', wrapped));
  }

  // ---------- BUSINESS HELPERS ----------
  function computeExpectedFee(className, metaObj) {
    const meta = metaObj || state.meta || {};
    const high = toNumberSafe(meta.feePreunitAnd7 || 45000);
    const low = toNumberSafe(meta.feeOthers || 10000);
    const cls = toStr(className).toLowerCase();
    if (!cls) return low;
    const graduandTokens = ['preunit', 'pre-unit', 'pre unit', 'preparatory', 'class 7', 'std 7', 'grade 7'];
    if (graduandTokens.some((token) => cls.includes(token))) return high;
    return low;
  }

  function normalizeClassName(className) {
    const cls = toStr(className).trim().toLowerCase().replace(/[-_]+/g, ' ').replace(/\s+/g, ' ');
    if (!cls) return '';
    if (cls.includes('baby')) return 'Baby Class';
    if (cls.includes('middle')) return 'Middle Class';
    if (cls.includes('pre unit') || cls.includes('preunit') || cls.includes('preparatory')) return 'Pre Unit Class';
    const match = cls.match(/\b(class|grade|std|standard)\s*([1-7])\b/) || cls.match(/\b([1-7])\b/);
    if (match) return `Class ${match[2] || match[1]}`;
    if (cls === 'graduated') return 'GRADUATED';
    if (cls === 'pre admission' || cls === 'pre-admission') return 'PRE-ADMISSION';
    return toStr(className).trim();
  }

  function shiftClassForYear(baseClass, deltaYears) {
    const normalized = normalizeClassName(baseClass);
    const index = CLASS_ORDER.findIndex((item) => item.toLowerCase() === normalized.toLowerCase());
    if (index < 0) return normalized || '';
    const nextIndex = index + Number(deltaYears || 0);
    if (nextIndex < 0) return 'PRE-ADMISSION';
    if (nextIndex >= CLASS_ORDER.length) return 'GRADUATED';
    return CLASS_ORDER[nextIndex];
  }

  function looksDeleted(student) {
    const status = toStr(student?.status).trim().toLowerCase();
    return Boolean(
      student?.deleted === true ||
      student?.isDeleted === true ||
      student?.archived === true ||
      student?.isArchived === true ||
      student?.removed === true ||
      student?.isRemoved === true ||
      student?.active === false ||
      ['deleted', 'archived', 'removed', 'shifted', 'graduated'].includes(status)
    );
  }

  function toTimestampMs(value) {
    if (value == null || value === '') return null;
    if (typeof value === 'number' && Number.isFinite(value)) {
      if (value > 1e12) return value;
      if (value > 1e9) return value * 1000;
      return value;
    }
    const text = toStr(value).trim();
    if (/^\d{10,13}$/.test(text)) {
      const numeric = Number(text);
      return numeric > 1e12 ? numeric : numeric * 1000;
    }
    const parsed = Date.parse(text);
    return Number.isFinite(parsed) ? parsed : null;
  }

  function getRegistrationYear(student) {
    const explicit = Number(student?.academicYear || student?.admissionYear || student?.admYear || student?.year);
    if (Number.isFinite(explicit) && explicit > 1900) return explicit;
    const ms = toTimestampMs(
      student?.timestamp ||
      student?.createdAt ||
      student?.registeredAt ||
      student?.regTimestamp ||
      student?.dateRegistered ||
      student?.dateOfRegistration
    );
    if (!ms) return null;
    const year = new Date(ms).getFullYear();
    return Number.isFinite(year) ? year : null;
  }

  function belongsToYear(student, year, hasYearOverride) {
    const selectedYear = Number(year);
    if (!Number.isFinite(selectedYear)) return false;
    // An explicit per-year enrollment record is authoritative for that year.
    if (hasYearOverride) return true;
    const regYear = getRegistrationYear(student);
    if (regYear) {
      return regYear >= Math.min(YEAR_START, ROSTER_BASE_YEAR) && regYear <= selectedYear;
    }
    // No registration year on file and no enrollment override for this year:
    // only trust this record for the live current year (matching studentlist.html).
    // Never assume it belongs to a past or future year without evidence.
    return selectedYear === new Date().getFullYear();
  }

  function isCompleteMasterStudent(student) {
    if (!student || typeof student !== 'object') return false;
    if (looksDeleted(student)) return false;
    const admission = toStr(student.admissionNumber || student.pupilId || student.admNo || student.admissionNo).trim();
    const first = toStr(student.firstName).trim();
    const last = toStr(student.lastName).trim();
    const name = toStr([student.firstName, student.middleName, student.lastName].filter(Boolean).join(' ') || student.fullName || student.name).trim();
    if (!admission || ['n/a', 'na'].includes(admission.toLowerCase())) return false;
    if ((!first || !last) && (!name || ['student', 'n/a', 'na'].includes(name.toLowerCase()))) return false;
    return true;
  }

  async function readObjectAt(path) {
    try {
      const snap = await db().ref(path).once('value');
      return snap.val() || {};
    } catch (err) {
      console.warn(`GraduationSuite read failed: ${path}`, err?.message || err);
      return {};
    }
  }

  async function readMergedObject(paths) {
    const unique = Array.from(new Set(paths.filter(Boolean)));
    const parts = await Promise.all(unique.map(readObjectAt));
    return Object.assign({}, ...parts);
  }

  function getCurrentSchoolId() {
    const school = window.SOMAP?.getSchool?.();
    const raw = school?.id || window.currentSchoolId || localStorage.getItem('schoolId') || 'socrates-school';
    const id = toStr(raw).trim();
    if (!id || id === 'socrates') return 'socrates-school';
    return id;
  }

  function schoolPath(subPath) {
    return `schools/${getCurrentSchoolId()}/${subPath}`;
  }

  function gradPath(year, subPath = '') {
    const suffix = subPath ? `/${subPath}` : '';
    return schoolPath(`graduation/${year}${suffix}`);
  }

  function gradGlobalPath(subPath = '') {
    return schoolPath(`graduation${subPath ? `/${subPath}` : ''}`);
  }

  async function fetchYearEnrollments(year) {
    const paths = [
      schoolPath(`enrollments/${year}`),
      schoolPath(`years/${year}/enrollments`),
    ];
    if (getCurrentSchoolId() === 'socrates-school') {
      paths.unshift(`enrollments/${year}`, `years/${year}/enrollments`);
    }
    return readMergedObject(paths);
  }

  function findEnrollmentOverride(studentKey, student, enrollments) {
    return enrollments?.[studentKey] || enrollments?.[sanitizeKey(student?.admissionNumber || student?.admissionNo || studentKey)] || null;
  }

  function resolveClassForStudentYear(studentKey, student, year, enrollments) {
    const override = findEnrollmentOverride(studentKey, student, enrollments);
    const overrideClass = override?.className || override?.classLevel || override?.class || '';
    if (overrideClass) return normalizeClassName(overrideClass);
    const baseClass = student?.classLevel || student?.className || student?.class || student?.grade || student?.level || '';
    const regYear = getRegistrationYear(student);
    if (!regYear) return normalizeClassName(baseClass);
    return shiftClassForYear(baseClass, Number(year) - regYear);
  }

  function isGraduand(className) {
    return computeExpectedFee(className) > Number(state.meta?.feeOthers || 10000);
  }

  function normalizeYear(yearCandidate) {
    const numeric = Number(yearCandidate || state.currentYear || new Date().getFullYear());
    if (!Number.isInteger(numeric)) return new Date().getFullYear();
    if (numeric < YEAR_START) return YEAR_START;
    if (numeric > YEAR_END) return YEAR_END;
    return numeric;
  }

  function isAuthorized(email) {
    if (!email) return false;
    return AUTHORIZED_EMAILS.has(email.toLowerCase());
  }

  function safeEmailKey(email) {
    return toStr(email).trim().toLowerCase().replace(/\./g, '_');
  }

  function classMatchesAccess(className) {
    const teacherClass = toStr(state.access?.teacherClass).trim();
    if (!teacherClass || state.access?.mode !== 'teacher') return true;
    // Class restriction is for the money ledger only; certificates & galleries show every graduand.
    if (state.page !== 'dashboard') return true;
    return normalizeClassName(className).toLowerCase() === normalizeClassName(teacherClass).toLowerCase();
  }

  function canRecordPayment() {
    return state.access?.mode === 'admin' || state.access?.mode === 'teacher' || state.access?.mode === 'secretary';
  }

  // Secretary Desk access (js/secretary_access.js): a verified secretary of this
  // school whose desk includes graduation may view the roster and submit payments,
  // which still go to approvals before counting as paid.
  async function resolveSecretaryAccess() {
    const S = window.SomapSecretary;
    if (!S || !S.getSession()) return null;
    const session = await S.verifySession(db()).catch(() => null);
    if (!session || !S.deskFor(session.homeSchoolId).graduation) return null;
    if (S.canonicalSchoolId(getCurrentSchoolId()) !== S.canonicalSchoolId(session.homeSchoolId)) return null;
    return {
      user: { email: `Secretary - ${session.name}`, displayName: session.name, uid: session.workerId, isSecretary: true },
      access: { mode: 'secretary', teacherClass: '', teacherEmail: '', secretaryName: session.name, workerId: session.workerId },
    };
  }

  function renderSecretaryBanner() {
    if (state.access?.mode !== 'secretary' || document.getElementById('secretaryGradBanner')) return;
    const hero = document.querySelector('.hero');
    if (!hero) return;
    const banner = document.createElement('div');
    banner.id = 'secretaryGradBanner';
    banner.style.cssText = 'margin-top:16px;display:flex;flex-wrap:wrap;gap:10px;align-items:center;justify-content:space-between;padding:12px 16px;border-radius:16px;background:linear-gradient(135deg,rgba(244,114,182,0.22),rgba(167,139,250,0.18));border:1px solid rgba(244,114,182,0.4);';
    banner.innerHTML = `
      <div style="font-size:0.9rem;"><b>Secretary Desk</b> · ${toStr(state.access.secretaryName)} — malipo yote yanasubiri idhini (approval) kabla ya kuhesabiwa.</div>
      <div style="display:flex;gap:8px;flex-wrap:wrap;">
        <a href="../workershtml/secretary/graduation_followup.html" style="padding:8px 14px;border-radius:12px;background:#db2777;color:#fff;font-weight:600;text-decoration:none;">📞 Simu za Wazazi</a>
        <a href="../workershtml/secretary/secretaryhub.html" style="padding:8px 14px;border-radius:12px;background:rgba(15,23,42,0.7);color:#fff;font-weight:600;text-decoration:none;border:1px solid rgba(255,255,255,0.2);">← Secretary Hub</a>
      </div>`;
    hero.appendChild(banner);
  }

  async function resolveTeacherAccess(user) {
    const email = toStr(user?.email).trim().toLowerCase();
    if (!email) return null;
    const key = safeEmailKey(email);
    let profile = null;
    try {
      const snap = await db().ref(`users/${key}`).once('value');
      profile = snap.val();
    } catch (err) {
      console.warn('Graduation teacher profile read failed', err?.message || err);
    }
    const sessionClass = toStr(sessionStorage.getItem('graduationTeacherClass') || sessionStorage.getItem('lockedClassAttendance')).trim();
    const sessionEmail = toStr(sessionStorage.getItem('graduationTeacherEmail') || sessionStorage.getItem('lockedClassTeacher')).trim().toLowerCase();
    const role = toStr(profile?.role || '').trim().toLowerCase();
    const profileClass = toStr(profile?.class || profile?.classLevel || profile?.streamClass).trim();
    const profileSchoolId = toStr(profile?.schoolId || profile?.school).trim();
    const selectedSchoolId = getCurrentSchoolId();
    const legacySocratesTeacher = selectedSchoolId === 'socrates-school' && !profileSchoolId;
    const className = profileClass || (sessionEmail === email ? sessionClass : '');

    if (profile) {
      if (profile.active === false) return null;
      if (role && role !== 'teacher') return null;
      if (!legacySocratesTeacher && profileSchoolId && profileSchoolId !== selectedSchoolId) return null;
    } else if (sessionEmail !== email) {
      return null;
    }
    if (!className) return null;
    return { mode: 'teacher', teacherClass: className, teacherEmail: email };
  }

  function showAuthGate(allowed) {
    const gate = $('#authGate');
    const shell = $('#appShell');
    if (gate) gate.style.display = allowed ? 'none' : 'flex';
    if (shell) shell.style.display = allowed ? 'block' : 'none';
  }

  function applyAccessUi() {
    const secretaryMode = state.access?.mode === 'secretary';
    // Staff (teachers & secretaries) see every card and every download, like the owner, EXCEPT
    // the Expenses page (where entries are written). Anything staff upload waits for the Head
    // Teacher (workershtml/headteacherapprovals.html → Graduation uploads). No audit/delete tools.
    const teacherMode = state.access?.mode === 'teacher' || secretaryMode;
    document.body.classList.toggle('teacher-grad-view', teacherMode);
    document.querySelectorAll('[data-link="expenses"]').forEach((node) => {
      node.style.display = teacherMode ? 'none' : '';
    });
    const paymentForm = $('#paymentForm');
    const paymentPanel = paymentForm?.closest('.glass, .panel, section, div');
    if (paymentPanel) paymentPanel.style.display = '';
    const auditPanel = $('#auditBody')?.closest('section, .glass, .panel');
    if (auditPanel) auditPanel.style.display = teacherMode ? 'none' : '';
    document.querySelectorAll('button[onclick="cleanGhosts()"], button[onclick="clearDeleteMode()"]').forEach((node) => {
      node.style.display = teacherMode ? 'none' : '';
    });
    const teacherClass = toStr(state.access?.teacherClass).trim();
    const title = document.querySelector('.hero h1');
    if (title) {
      title.textContent = secretaryMode
        ? 'Graduation Control Center - Secretary Desk'
        : teacherMode && teacherClass ? `Graduation Control Center - ${teacherClass}` : 'Graduation Control Center';
    }
    renderSecretaryBanner();
  }

  function getSelectedYear() {
    return String(window.somapYearContext?.getSelectedYear?.() || state.currentYear || new Date().getFullYear());
  }

  function getSchoolPrefix() {
    return `schools/${getCurrentSchoolId()}/`;
  }

  // ---------- PUBLIC API ----------
  window.GraduationSuite = {
    init,
    loadYear,
    computeExpectedFee,
    generateCertificate,
    generateAllCertificates,
  };
  window.cleanGhosts = cleanGhosts;
  window.clearDeleteMode = clearDeleteMode;

  // ---------- INIT ----------
  function init(options = {}) {
    console.log('GraduationSuite.init called', options);
    state.page = options.page || document.body.dataset.page || 'dashboard';
    state.currentYear = normalizeYear(options.year || new Date().getFullYear());
    buildYearSelector();
    attachBaseListeners();
    wireCertificatePage();
    auth().onAuthStateChanged(handleAuthChange);
  }

  // ---------- YEAR TABS ----------
  function buildYearSelector() {
    const host = $('#yearTabs');
    if (!host) return;
    host.innerHTML = YEARS.map((year) => `<button data-year="${year}" class="year-chip">${year}</button>`).join('');
    host.addEventListener('click', (event) => {
      const button = event.target.closest('button[data-year]');
      if (!button) return;
      const year = normalizeYear(button.dataset.year);
      if (year === state.currentYear) return;
      highlightYear(year);
      loadYear(year);
    });
    highlightYear(state.currentYear);
  }

  function highlightYear(year) {
    const host = $('#yearTabs');
    if (!host) return;
    host.querySelectorAll('button[data-year]').forEach((btn) => {
      btn.classList.toggle('active', Number(btn.dataset.year) === Number(year));
    });
  }

  // ---------- BASE LISTENERS ----------
  function attachBaseListeners() {
    wireAuthForm();

    const searchBox = $('#studentSearch');
    if (searchBox) {
      searchBox.addEventListener('input', (event) => {
        state.filters.search = event.target.value;
        renderStudentTable();
      });
    }

    const classFilter = $('#classFilter');
    if (classFilter) {
      classFilter.addEventListener('change', (event) => {
        state.filters.classLevel = event.target.value || 'all';
        renderStudentTable();
      });
    }

    const paymentForm = $('#paymentForm');
    if (paymentForm) paymentForm.addEventListener('submit', handlePaymentSubmit);

    const expenseForm = $('#expenseForm');
    if (expenseForm) expenseForm.addEventListener('submit', handleExpenseSubmit);
    const sellerInput = document.querySelector('input[name="seller"]');
    if (sellerInput) {
      sellerInput.addEventListener('change', () => showVendorDetails(sellerInput.value));
    }

    const galleryForm = $('#galleryForm');
    if (galleryForm) galleryForm.addEventListener('submit', handleGallerySubmit);
    wireGalleryDropzone();

    document.querySelectorAll('[data-export]').forEach((button) => {
      button.addEventListener('click', (event) => {
        const type = event.currentTarget.dataset.export;
        const format = event.currentTarget.dataset.format || 'csv';
        handleExport(type, format);
      });
    });

    document.querySelectorAll('[data-link]').forEach((button) => {
      const target = button.dataset.link;
      if (state.readOnly && target === 'expenses') return;
      if (target === 'expenses') button.addEventListener('click', () => { window.location.href = 'gradexpenses.html'; });
      if (target === 'certificates') button.addEventListener('click', () => { window.location.href = 'gradcertificates.html'; });
      if (target === 'galleries') button.addEventListener('click', () => { window.location.href = 'gradgalleries.html'; });
    });

    // ✅ Wire up "Generate All Pending Certificates"
    const genAllBtn = $('#generateAllCertificates');
    if (genAllBtn) {
      genAllBtn.addEventListener('click', async () => {
        try {
          setBusy('#generateAllCertificates', true);
          await generateAllCertificates();
        } catch (err) {
          console.error(err);
          showToast(err?.message || 'Bulk generation failed', 'error');
        } finally {
          setBusy('#generateAllCertificates', false);
        }
      });
    }
  }

  // ---------- AUTH & YEAR BOOTSTRAP ----------
  async function handleAuthChange(user) {
    console.log('handleAuthChange:', user ? user.email : 'No user');
    const secretaryAccess = await resolveSecretaryAccess();
    if (secretaryAccess) {
      state.user = secretaryAccess.user;
      state.access = secretaryAccess.access;
      state.readOnly = true;
      showAuthGate(true);
      applyAccessUi();
      startYearLoad('Loading graduation data for Secretary Desk...');
      return;
    }
    state.user = user;
    state.access = { mode: 'none', teacherClass: '', teacherEmail: '' };
    const allowed = isAuthorized(user?.email || '');
    const teacherAccess = allowed ? null : await resolveTeacherAccess(user);
    if (allowed) {
      state.access = { mode: 'admin', teacherClass: '', teacherEmail: toStr(user?.email || '').toLowerCase() };
    } else if (teacherAccess) {
      state.access = teacherAccess;
      state.filters.classLevel = teacherAccess.teacherClass;
    }
    const allowGalleries = state.page === 'galleries';
    const allowRead = allowed || Boolean(teacherAccess) || allowGalleries;
    state.readOnly = !allowed;
    showAuthGate(allowRead);
    applyAccessUi();
    if (!user) return;
    if (!allowRead) {
      showToast('Sign in with a registered teacher or authorised staff email to load graduation data.', 'error');
      return;
    }

    startYearLoad(teacherAccess ? `Loading ${teacherAccess.teacherClass} graduation data...` : 'Loading graduation data...');
  }

  function startYearLoad(message) {
    showToast(message, 'info');
    loadSchoolBrand().then((brand) => {
      const eyebrow = document.querySelector('.hero .hero-eyebrow');
      if (eyebrow && brand?.name) eyebrow.textContent = brand.name;
    }).catch(() => {});

    runYearLoad(state.currentYear, { announce: true });
  }

  // ---------- FAST YEAR LOAD ----------
  // The finance roster (who is active, in which class) is expensive to build. The page used to
  // wait for it before drawing anything. Now: draw at once from the last good roster saved on
  // this device + the stored graduation records, then sync the roster in the background.
  function rosterCacheKey(year) { return `gradRosterKeys:${getCurrentSchoolId()}:${year}`; }
  function saveRosterCache(year, keys) {
    try { localStorage.setItem(rosterCacheKey(year), JSON.stringify({ at: Date.now(), keys: Array.from(keys) })); } catch (_) { /* storage full or blocked */ }
  }
  function primeRosterFromCache(year) {
    try {
      const raw = JSON.parse(localStorage.getItem(rosterCacheKey(year)) || 'null');
      if (!raw || !Array.isArray(raw.keys) || !raw.keys.length) return false;
      state.activeRosterKeys = new Set(raw.keys);
      state.activeRosterLoaded = true;
      return true;
    } catch (_) { return false; }
  }
  // No saved list on this device yet: the last sync (from any device) already marked every
  // learner who left as inactive on graduation/{year}/students, so those records are the list.
  async function primeRosterFromStoredRecords(year) {
    try {
      const snap = await db().ref(gradPath(year, 'students')).once('value');
      const keys = Object.entries(snap.val() || {})
        .filter(([, s]) => s && s.inactive !== true && Number(s.rosterSyncedYear) === Number(year))
        .map(([key, s]) => sanitizeKey(s.admissionNo || key));
      if (!keys.length || state.activeRosterLoaded) return false;
      state.activeRosterKeys = new Set(keys);
      state.activeRosterLoaded = true;
      return true;
    } catch (_) { return false; }
  }
  let yearLoadSeq = 0;
  function runYearLoad(year, { announce = false } = {}) {
    const seq = ++yearLoadSeq;
    let quick = primeRosterFromCache(year);
    if (quick) {
      attachYearListeners(year);
      try { renderAll(); } catch (e) { console.error('Render failed', e); }
    } else {
      primeRosterFromStoredRecords(year).then((ok) => {
        if (!ok || seq !== yearLoadSeq) return;
        quick = true;
        attachYearListeners(year);
        try { renderAll(); } catch (e) { console.error('Render failed', e); }
      });
    }
    const slowTimer = setTimeout(() => {
      if (seq === yearLoadSeq) showToast(quick ? 'Showing the saved list while the class list syncs (slow network)…' : 'Still loading the class list — the network is slow. Please wait…', 'warn', 7000);
    }, 15000);
    ensureYearReady(year)
      .then(() => {
        if (seq !== yearLoadSeq) return; // a newer year was chosen meanwhile
        if (!quick) attachYearListeners(year);
        try { renderAll(); } catch (e) { console.error('Render failed', e); }
        refreshTodayAttendance();
        if (announce) showToast('Graduation data loaded.', 'success');
      })
      .catch((err) => {
        console.error(err);
        showToast(err?.message || 'Failed to load graduation data', 'error');
      })
      .finally(() => clearTimeout(slowTimer));
  }

  function wireAuthForm() {
    const form = $('#gradLoginForm');
    if (!form) return;
    const emailInput = $('#gradLoginEmail');
    const passInput = $('#gradLoginPass');
    const errorBox = $('#gradLoginError');
    const savedEmail = localStorage.getItem('gradAuthEmail');
    if (savedEmail && emailInput && !emailInput.value) emailInput.value = savedEmail;

    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      if (errorBox) errorBox.textContent = '';
      const email = toStr(emailInput?.value || '').trim();
      const pass = toStr(passInput?.value || '');
      if (!email || !pass) {
        if (errorBox) errorBox.textContent = 'Email and password are required.';
        showToast('Enter email and password to sign in.', 'warn');
        return;
      }
      setBusy('#gradLoginSubmit', true);
      try {
        await auth().signInWithEmailAndPassword(email, pass);
        localStorage.setItem('gradAuthEmail', email);
        showToast('Signed in. Loading graduation data...');
      } catch (err) {
        const message = err?.message || 'Sign-in failed';
        console.error('GraduationSuite sign-in error', err);
        if (errorBox) errorBox.textContent = message;
        showToast(message, 'error');
      } finally {
        setBusy('#gradLoginSubmit', false);
      }
    });
  }

  function vendorKeyFromSeller(seller) {
    return sanitizeKey(toStr(seller).trim().toLowerCase());
  }

  async function upsertVendorFromExpense(expenseId, payload) {
    const seller = toStr(payload.seller).trim();
    if (!seller) return;
    const key = vendorKeyFromSeller(seller);
    const vendorPayload = {
      seller,
      sellerPhone: toStr(payload.sellerPhone).trim(),
      lastItem: toStr(payload.item).trim(),
      lastExpenseId: expenseId,
      lastYear: state.currentYear,
      lastTotal: Number(payload.total || 0),
      lastUsedBy: state.user?.email || 'unknown',
      lastUsedAt: firebase.database.ServerValue.TIMESTAMP,
      updatedAt: firebase.database.ServerValue.TIMESTAMP,
    };
    const updates = {};
    updates[`${gradGlobalPath('vendors')}/${key}`] = vendorPayload;
    updates[`${gradPath(state.currentYear, 'vendors')}/${key}`] = vendorPayload;
    await db().ref().update(updates);
  }

  async function ensureYearReady(year) {
    const normalized = normalizeYear(year);
    state.currentYear = normalized;
    await ensureMeta(normalized);
    await ensureStudents(normalized);
  }

  function ensureMeta(year) {
    const ref = db().ref(gradPath(year, 'meta'));
    return ref.once('value').then((snapshot) => {
      const meta = snapshot.val();
      state.meta = meta || {};
      if (meta) return meta;
      const fresh = {
        feePreunitAnd7: 45000,
        feeOthers: 10000,
        debtCutoffISO: `${year}-11-07`,
        createdBy: state.user?.email || 'system',
        createdAt: firebase.database.ServerValue.TIMESTAMP,
      };
      state.meta = fresh;
      return ref.set(fresh).then(() => fresh);
    });
  }

  async function ensureStudents(year) {
    const ref = db().ref(gradPath(year, 'students'));
    const snapshot = await ref.once('value');
    const existing = snapshot.val() || {};
    // Keep showing the last good roster while the (slow) finance roster syncs.
    const master = await fetchMasterStudents(true, year);
    const rosterKeys = new Set(master.map((student) => sanitizeKey(student.admissionNumber || student.__key)).filter(Boolean));
    if (rosterKeys.size || !(state.activeRosterKeys instanceof Set) || !state.activeRosterKeys.size) {
      state.activeRosterKeys = rosterKeys;
      if (rosterKeys.size) saveRosterCache(year, rosterKeys);
    }
    state.activeRosterLoaded = true;

    const updates = {};
    let addedCount = 0;

    master.forEach((student) => {
      const adm = sanitizeKey(student.admissionNumber || student.__key);
      if (!adm) return;

      // Preserve any payments/notes already captured, but backfill missing profile data.
      const current = existing[adm] || {
        admissionNo: student.admissionNumber,
        expectedFee: computeExpectedFee(student.classLevel),
        paid: 0,
        status: 'unpaid',
        lastPaymentAt: null,
        notes: '',
      };

      let changed = !existing[adm];
      const upsert = { ...current };
      const ensure = (key, value, allowOverride = false) => {
        if (value == null || value === '') return;
        if (!upsert[key] || (allowOverride && upsert[key] !== value)) {
          upsert[key] = value;
          changed = true;
        }
      };

      ensure('name', student.fullName, true);
      ensure('class', student.classLevel, true);
      ensure('parentPhone', student.parentPhone, true);
      ensure('parentName', student.parentName, true);
      ensure('parentEmail', student.parentEmail, true);
      ensure('photoUrl', student.photoUrl || '', true);
      ensure('registrationYear', student.registrationYear || '', true);
      ensure('rosterSyncedYear', Number(year), true);

      const expectedForClass = computeExpectedFee(upsert.class);
      if (upsert.expectedFee === undefined || upsert.expectedFee === null || !existing[adm] || existing[adm]?.autoExpectedFee === true) {
        upsert.expectedFee = expectedForClass;
        upsert.autoExpectedFee = true;
        changed = true;
      } else if (upsert.expectedFee !== expectedForClass && upsert.autoExpectedFee !== false) {
        upsert.expectedFee = computeExpectedFee(upsert.class);
        upsert.autoExpectedFee = true;
        changed = true;
      }

      const graduandFlag = isGraduand(upsert.class);
      if (upsert.isGraduand !== graduandFlag) {
        upsert.isGraduand = graduandFlag;
        changed = true;
      }
      if (upsert.inactive) {
        upsert.inactive = false;
        upsert.inactiveReason = null;
        changed = true;
      }

      if (changed) {
        updates[adm] = upsert;
      }
      if (!existing[adm]) addedCount += 1;
    });

    if (master.length) {
      Object.entries(existing).forEach(([adm, student]) => {
        if (rosterKeys.has(adm)) return;
        if (student?.inactive === true) return;
        updates[adm] = {
          ...student,
          inactive: true,
          inactiveReason: 'Not in active student list for this year',
          excludedFromReportsAt: firebase.database.ServerValue.TIMESTAMP,
        };
      });
    }

    if (Object.keys(updates).length) {
      await ref.update(updates);
    }

    state.students = { ...existing, ...updates };

    if (addedCount) {
      await db().ref(gradPath(year, 'audits')).push({
        actor: state.user?.email || 'system',
        action: 'sync:students',
        refType: 'students',
        at: firebase.database.ServerValue.TIMESTAMP,
        after: { added: addedCount, total: getValidStudents().length, activeRoster: rosterKeys.size },
      });
    }

    return state.students;
  }

  async function fetchMasterStudents(force = false, year = state.currentYear) {
    if (state.masterStudents && state.rosterYear === Number(year) && !force) return state.masterStudents;

    if (window.SomapFinance?.getFinanceRoster) {
      try {
        const financeRows = await window.SomapFinance.getFinanceRoster(year);
        const list = (financeRows || []).map((row) => {
          const raw = row.rawStudent || {};
          const admissionNumber = toStr(row.admissionNumber || raw.admissionNumber || raw.admissionNo || raw.admNo || row.id).trim();
          const classLevel = normalizeClassName(row.classLevel || row.className || raw.classLevel || raw.className || raw.class || '');
          const fullName = toStr(row.fullName || raw.fullName || raw.name || [raw.firstName, raw.middleName, raw.lastName].filter(Boolean).join(' ')).replace(/\s+/g, ' ').trim();
          return {
            ...raw,
            __key: row.id || sanitizeKey(admissionNumber),
            admissionNumber,
            classLevel,
            fullName,
            parentPhone: row.parentContact || extractPrimaryPhone(raw),
            parentName: extractPrimaryName(raw),
            parentEmail: extractPrimaryEmail(raw),
            photoUrl: raw.photoUrl || raw.passportPhotoUrl || raw.photo || '',
            registrationYear: getRegistrationYear(raw),
            isGraduand: isGraduand(classLevel),
          };
        }).filter((entry) => {
          const className = normalizeClassName(entry.classLevel).toUpperCase();
          return entry.admissionNumber
            && entry.fullName
            && entry.fullName.toLowerCase() !== 'student'
            && entry.classLevel
            && className !== 'GRADUATED'
            && className !== 'PRE-ADMISSION'
            && isCompleteMasterStudent(entry);
        });
        list.sort((a, b) => a.fullName.localeCompare(b.fullName, 'en'));
        state.masterStudents = list;
        state.rosterYear = Number(year);
        return list;
      } catch (err) {
        console.warn('Graduation finance roster fetch failed; falling back to direct student read:', err?.message || err);
      }
    }
    
    // Attempt fetch with timeout/fallback
    let obj = {};
    let enrollments = {};
    try {
      // 10s timeout promise race
      const studentPaths = [schoolPath('students')];
      if (getCurrentSchoolId() === 'socrates-school') studentPaths.unshift('students');
      const [studentsObj, yearEnrollments] = await Promise.race([
        Promise.all([
          readMergedObject(studentPaths),
          fetchYearEnrollments(year),
        ]),
        new Promise((_, reject) => setTimeout(() => reject(new Error('Students fetch timeout')), 10000))
      ]);
      obj = studentsObj || {};
      enrollments = yearEnrollments || {};
    } catch (err) {
      console.warn('Master student fetch failed/timed out:', err);
      showToast('Could not sync latest student roster (network/timeout). Using local cache if available.', 'warn');
      // If we fail, return empty list so we don't crash the whole app.
      // Ideally we would rely on what we already have in graduation/year/students
      if (state.masterStudents) return state.masterStudents;
      return []; 
    }

    const list = Object.entries(obj).map(([key, val]) => {
      const entry = val || {};
      entry.__key = key;
      entry.admissionNumber = entry.admissionNumber || entry.pupilId || entry.admNo || sanitizeKey(key);
      entry.classLevel = resolveClassForStudentYear(key, entry, year, enrollments);
      entry.fullName = [entry.firstName, entry.middleName, entry.lastName].filter(Boolean).join(' ') || entry.name || 'Student';
      entry.parentPhone = extractPrimaryPhone(entry);
      entry.parentName = extractPrimaryName(entry);
      entry.parentEmail = extractPrimaryEmail(entry);
      entry.photoUrl = entry.photoUrl || entry.passportPhotoUrl || entry.photo || '';
      entry.registrationYear = getRegistrationYear(entry);
      entry.isGraduand = isGraduand(entry.classLevel);
      entry.__hasYearOverride = Boolean(findEnrollmentOverride(key, entry, enrollments));
      return entry;
    }).filter((entry) => {
      const hasName = toStr(entry.fullName).trim() && toStr(entry.fullName).trim().toLowerCase() !== 'student';
      const hasClass = toStr(entry.classLevel).trim();
      const className = normalizeClassName(entry.classLevel).toUpperCase();
      return entry.admissionNumber && hasName && hasClass && isCompleteMasterStudent(entry) && belongsToYear(entry, year, entry.__hasYearOverride) && className !== 'GRADUATED' && className !== 'PRE-ADMISSION';
    });
    
    if (list.length) {
      list.sort((a, b) => a.fullName.localeCompare(b.fullName, 'en'));
      state.masterStudents = list;
      state.rosterYear = Number(year);
    }
    return list;
  }

  function extractPrimaryPhone(student) {
    const candidates = [
      student.primaryParentContact,
      student.parentPhone,
      student.parentContact,
      student.guardianPhone,
      student.guardianContact,
      student.fatherPhone,
      student.motherPhone,
      student.phone1,
      student.phone2,
      student.phone,
      student.whatsapp,
      student.contact,
    ];
    for (const entry of candidates) {
      if (!entry) continue;
      if (typeof entry === 'string' || typeof entry === 'number') {
        const normalized = String(entry).trim();
        if (normalized) return normalized;
      } else if (Array.isArray(entry)) {
        const match = entry.map((item) => String(item || '').trim()).find(Boolean);
        if (match) return match;
      } else if (typeof entry === 'object') {
        const match = Object.values(entry).map((item) => String(item || '').trim()).find(Boolean);
        if (match) return match;
      }
    }
    return '';
  }

  function extractPrimaryEmail(student) {
    const candidates = [
      student.parentEmail,
      student.parentEmails,
      student.guardianEmail,
      student.guardianEmails,
      student.fatherEmail,
      student.motherEmail,
      student.parent1Email,
      student.parent2Email,
      student.email,
      student.contactEmail,
    ];
    for (const entry of candidates) {
      if (!entry) continue;
      if (typeof entry === 'string') {
        const normalized = entry.trim().toLowerCase();
        if (normalized && normalized.includes('@')) return normalized;
      } else if (Array.isArray(entry)) {
        const match = entry.map((item) => String(item || '').trim().toLowerCase()).find((val) => val && val.includes('@'));
        if (match) return match;
      } else if (typeof entry === 'object') {
        const match = Object.values(entry).map((item) => String(item || '').trim().toLowerCase()).find((val) => val && val.includes('@'));
        if (match) return match;
      }
    }
    return '';
  }

  function extractPrimaryName(student) {
    const candidates = [
      student.parentName,
      student.parent,
      student.guardianName,
      student.fatherName,
      student.motherName,
      student.primaryGuardian,
    ];
    for (const entry of candidates) {
      if (!entry) continue;
      if (typeof entry === 'string' || typeof entry === 'number') {
        const normalized = String(entry).trim();
        if (normalized) return normalized;
      } else if (typeof entry === 'object') {
        const match = Object.values(entry).map((item) => String(item || '').trim()).find(Boolean);
        if (match) return match;
      }
    }
    return '';
  }

  // ---------- REALTIME LISTENERS PER YEAR ----------
  function attachYearListeners(year) {
    detachWatchers();
    state.paymentTotals = {};
    listen(gradPath(year, 'meta'), (meta) => {
      state.meta = meta;
      renderDashboardSummary();
    });
    listen(gradPath(year, 'students'), (students) => {
      state.students = students;
      populateClassFilter();
      populateStudentSelect();
      renderStudentTable();
      renderDashboardSummary();
      renderExpenseTotals();
    });
    const hasExports = document.querySelector('[data-export]');
    const needsPayments = document.querySelector('#paymentsBody') || document.querySelector('#paymentStudent') || document.querySelector('#paymentForm') || hasExports;
    if (needsPayments) {
    listen(gradPath(year, 'payments'), (payments) => {
      state.payments = payments;
      state.paymentTotals = buildPaymentTotals(payments);
      syncBalances();
      renderPaymentsTable();
      renderDashboardSummary();
      renderExpenseTotals();
    });
    }
    const needsExpenses = document.querySelector('#expensesBody') || document.querySelector('#expenseForm');
    if (needsExpenses) {
      listen(gradPath(year, 'expenses'), (expenses) => {
        state.expenses = expenses;
        renderExpensesTable();
      });
      listen(gradGlobalPath('vendors'), (vendors) => {
        state.vendors = vendors;
        renderVendorDirectory();
      });
    }
    const needsAudits = document.querySelector('#auditBody');
    if (needsAudits) {
      listen(gradPath(year, 'audits'), (audits) => {
        state.audits = audits;
        renderAuditLog();
      });
    }
    const needsCertificates = document.querySelector('#certificatesBody');
    if (needsCertificates) {
      listen(gradPath(year, 'certificates'), (certificates) => {
        state.certificates = certificates;
        renderCertificatesTable();
      });
      listen(gradPath(year, 'graduandExtras'), (extras) => {
        state.graduandExtras = extras || {};
        renderCertificatesTable();
        renderPullUpResults();
      });
    }
    const needsGallery = document.querySelector('#galleryGrid') || document.querySelector('#galleryForm');
    if (needsGallery) {
      listen(gradPath(year, 'galleries'), (galleries) => {
        state.galleries = galleries;
        renderGallery();
      });
    }
  }

  // ---------- RENDERERS ----------
  function renderAll() {
    renderDashboardSummary();
    renderStudentTable();
    renderPaymentsTable();
    renderExpensesTable();
    renderAuditLog();
    renderCertificatesTable();
    renderGallery();
  }

  function syncBalances() {
    if (!isAuthorized(state.user?.email)) return;
    const updates = {};
    const year = state.currentYear;
    const activeKeys = state.activeRosterKeys instanceof Set ? state.activeRosterKeys : new Set();
    if (!state.activeRosterLoaded || activeKeys.size === 0) return;
    Object.entries(state.students || {}).forEach(([key, student]) => {
      const adm = sanitizeKey(student?.admissionNo || student?.admissionNumber || key);
      if (!adm || !activeKeys.has(adm)) return;
      if (student?.inactive === true || isGhostStudent(student)) return;
      const paid = getPaidTotal(student);
      const expected = getExpectedFee(student);
      const balance = Math.max(0, expected - paid);
      const status = computeStatus(student);

      if (toNumberSafe(student.paid) !== paid) {
        updates[`${gradPath(year, 'students')}/${key}/paid`] = paid;
      }
      if (toNumberSafe(student.balance) !== balance) {
        updates[`${gradPath(year, 'students')}/${key}/balance`] = balance;
      }
      if (toStr(student.status) !== status) {
        updates[`${gradPath(year, 'students')}/${key}/status`] = status;
      }
    });

    if (Object.keys(updates).length) {
      db().ref().update(updates).catch((err) => console.warn('Balance sync failed', err));
    }
  }

  function renderDashboardSummary() {
    if (state.page !== 'dashboard') return;
    const students = getValidStudents();
    const totalStudents = students.length;
    const graduands = students.filter((student) => student.isGraduand);
    const expected = students.reduce((sum, student) => sum + getExpectedFee(student), 0);
    const collected = students.reduce((sum, student) => sum + getPaidTotal(student), 0);
    const balance = Math.max(0, expected - collected);

    const statuses = { paid: 0, unpaid: 0, partial: 0, debt: 0 };
    students.forEach((student) => {
      const status = computeStatus(student);
      statuses[status] = (statuses[status] || 0) + 1;
    });
    // Everyone still owing: not paid, partly paid, or past the debt cutoff (status 'debt').
    statuses.unpaid += statuses.partial + statuses.debt;

    setText('#cardTotalStudents', totalStudents ? totalStudents.toLocaleString('en-US') : '--');
    setText('#cardTotalPresent', state.totalPresentToday != null ? state.totalPresentToday.toLocaleString('en-US') : '--');
    setText('#cardGraduands', graduands.length ? graduands.length.toLocaleString('en-US') : '0');
    setText('#cardExpected', formatCurrency(expected));
    setText('#cardCollected', formatCurrency(collected));
    setText('#cardBalance', formatCurrency(balance));
    setText('#cardPaidCount', statuses.paid ? statuses.paid.toLocaleString('en-US') : '0');
    setText('#cardUnpaidCount', statuses.unpaid ? statuses.unpaid.toLocaleString('en-US') : '0');
  }

  function computeStatus(student) {
    const expected = getExpectedFee(student);
    const paid = getPaidTotal(student);
    const explicitStatus = toStr(student.status).toLowerCase();
    const cutoff = new Date(state.meta?.debtCutoffISO || `${state.currentYear}-11-07`);
    const now = new Date();
    if (expected <= 0) return 'paid';
    if (paid >= expected && expected > 0) return 'paid';
    if (explicitStatus === 'paid') return 'paid'; // trust manual override when amounts are hidden to some viewers
    if (now > cutoff && paid < expected) return 'debt';
    if (paid > 0 && paid < expected) return 'partial';
    return 'unpaid';
  }

  function getBalance(student) {
    const expected = getExpectedFee(student);
    const paid = getPaidTotal(student);
    return Math.max(0, expected - paid);
  }

  function hasOutstanding(student) {
    // guard against floating or nulls
    return getBalance(student) > 0;
  }

  function isGhostStudent(student) {
    if (!student) return true;
    const name = toStr(student.name || student.fullName).trim();
    const cls = toStr(student.class || student.className).trim();
    const hasAdmission = toStr(student.admissionNo || student.admissionNumber || student.id).trim();
    if (!hasAdmission) return true;
    if (!name || name.toLowerCase() === 'student') return true;
    if (!cls || cls === '--' || cls === '-') return true;
    return false;
  }

  function getValidStudents() {
    const activeKeys = state.activeRosterKeys instanceof Set ? state.activeRosterKeys : new Set();
    if (!state.activeRosterLoaded || activeKeys.size === 0) return [];
    return Object.entries(state.students || {}).filter(([key, student]) => {
      if (!student || student.inactive === true) return false;
      const adm = sanitizeKey(student.admissionNo || student.admissionNumber || key);
      if (activeKeys.size && adm && !activeKeys.has(adm)) return false;
      if (isGhostStudent(student)) return false;
      const className = normalizeClassName(student.class || student.classLevel || student.className).toUpperCase();
      if (!classMatchesAccess(className)) return false;
      return className !== 'GRADUATED' && className !== 'PRE-ADMISSION';
    }).map(([, student]) => student);
  }

  function getExpectedFee(student) {
    const fallback = computeExpectedFee(student?.class, state.meta);
    if (student && student.expectedOverride !== undefined && student.expectedOverride !== null) {
      return toNumberSafe(student.expectedOverride);
    }
    if (student && student.expectedFee !== undefined && student.expectedFee !== null) {
      return toNumberSafe(student.expectedFee);
    }
    return toNumberSafe(fallback);
  }

  function buildPaymentTotals(payments, year = state.currentYear) {
    const totals = {};
    const targetYear = Number(year);
    Object.values(payments || {}).forEach((payment) => {
      const explicitYear = Number(payment?.year || payment?.academicYear || payment?.graduationYear || payment?.modulePayload?.year);
      if (Number.isFinite(explicitYear) && explicitYear > 1900 && explicitYear !== targetYear) return;
      const admRaw = payment?.admissionNo || payment?.admission || payment?.admNo || payment?.studentAdm;
      const adm = sanitizeKey(admRaw);
      if (!adm) return;
      const activeKeys = state.activeRosterKeys instanceof Set ? state.activeRosterKeys : new Set();
      if (activeKeys.size && !activeKeys.has(adm)) return;
      totals[adm] = toNumberSafe(totals[adm]) + toNumberSafe(payment?.amount || 0);
    });
    return totals;
  }

  function getVisiblePayments() {
    const activeKeys = state.activeRosterKeys instanceof Set ? state.activeRosterKeys : new Set();
    if (!state.activeRosterLoaded || activeKeys.size === 0) return [];
    return Object.entries(state.payments || {}).map(([key, value]) => ({ key, ...(value || {}) })).filter((payment) => {
      const explicitYear = Number(payment?.year || payment?.academicYear || payment?.graduationYear || payment?.modulePayload?.year);
      if (Number.isFinite(explicitYear) && explicitYear > 1900 && explicitYear !== Number(state.currentYear)) return false;
      const adm = sanitizeKey(payment?.admissionNo || payment?.admission || payment?.admNo || payment?.studentAdm);
      if (!adm || !activeKeys.has(adm)) return false;
      const student = state.students?.[adm];
      return !student || classMatchesAccess(student.class || student.classLevel || student.className);
    });
  }

  function getPaidTotal(student) {
    const adm = sanitizeKey(student?.admissionNo || student?.__key);
    return adm ? Math.max(0, toNumberSafe(state.paymentTotals?.[adm] || 0)) : 0;
  }

  function renderStudentTable() {
    if (state.page !== 'dashboard') return;
    const tbody = $('#studentsBody');
    if (!tbody) return;

    const search = toStr(state.filters.search).toLowerCase();
    const classFilter = state.filters.classLevel;
    const rows = getValidStudents();
    const filtered = rows.filter((student) => {
      const haystack = `${toStr(student.name)} ${toStr(student.admissionNo)} ${toStr(student.parentPhone)}`.toLowerCase();
      const matchesSearch = !search || haystack.includes(search);
      const matchesClass = classFilter === 'all'
        || toStr(student.class).toLowerCase() === toStr(classFilter).toLowerCase();
      return matchesSearch && matchesClass;
    });

    if (!filtered.length) {
      tbody.innerHTML = `
        <tr>
          <td colspan="8" class="py-8 text-center text-slate-500">
            No active students for ${state.currentYear}. Graduation uses the current student list/attendance roster only.
          </td>
        </tr>`;
      return;
    }

    const money = (n) => toNumberSafe(n).toLocaleString('en-US', { maximumFractionDigits: 0 });
    const initialsOf = (name) => toStr(name).trim().split(/\s+/).slice(0, 2).map((p) => p[0] || '').join('').toUpperCase() || '•';
    tbody.innerHTML = filtered.map((student) => {
      const status = computeStatus(student);
      const expected = getExpectedFee(student);
      const paid = getPaidTotal(student);
      const id = sanitizeKey(student.admissionNo);
      const isGhost = isGhostStudent(student);
      const canEdit = !state.readOnly;
      const canPay = canRecordPayment();
      const balance = getBalance(student);
      const pct = expected > 0 ? Math.min(100, Math.round((paid / expected) * 100)) : 100;
      const adm = toStr(student.admissionNo);
      const phone = toStr(student.parentPhone);
      return `
        <tr class="${status === 'debt' ? 'row-debt' : ''} ${isGhost ? 'bg-amber-50' : ''}">
          <td>
            <div class="name-cell">
              <div class="avatar-i">${student.photoUrl ? `<img src="${student.photoUrl}" alt="" loading="lazy" onerror="this.remove()">` : ''}<span>${initialsOf(student.name)}</span></div>
              <div class="min-w-0">
                <div class="name-main" title="${toStr(student.name)}">${toStr(student.name)}${isGhost ? ' <span class="text-xs text-amber-600 font-semibold">(ghost)</span>' : ''}</div>
                <span class="adm-chip" title="Admission ${adm}">${adm}</span>
              </div>
            </div>
          </td>
          <td><span class="class-chip" title="${toStr(student.class)}">${toStr(student.class).replace(/^Pre[\s-]*Unit Class$/i, 'Pre-Unit') || '--'}</span></td>
          <td class="text-right money-cell">
            <span data-col="expected" data-id="${id}" data-val="${expected}">${money(expected)}</span>
            ${canEdit ? `<button class="ico-btn" data-edit="expected" data-id="${id}" title="Edit expected"><i class="fas fa-pen"></i></button>` : ''}
          </td>
          <td class="text-right money-cell">
            <span class="${paid >= expected ? 'text-emerald-600 font-semibold' : ''}" data-col="paid" data-id="${id}" data-val="${paid}">${money(paid)}</span>
            ${canEdit ? `<button class="ico-btn" data-edit="paid" data-id="${id}" title="Edit paid (creates adjustment)"><i class="fas fa-pen"></i></button>` : ''}
            <div class="pay-bar" title="${pct}% paid"><i style="width:${pct}%"></i></div>
          </td>
          <td class="text-right money-cell"><span class="${balance > 0 ? 'balance-due' : 'balance-zero'}" data-col="balance" data-id="${id}" data-val="${balance}">${money(balance)}</span></td>
          <td><span class="status-badge ${status}" data-col="status" data-id="${id}">${status.toUpperCase()}</span>${status === 'debt' ? '<span class="debt-pill">DEBT</span>' : ''}</td>
          <td>
            ${phone ? `<a class="phone-link" href="tel:${phone}"><i class="fas fa-phone"></i>${phone}</a>` : '<span class="text-xs text-slate-400">--</span>'}
            <div class="text-xs text-slate-400 truncate" style="max-width:150px;">${toStr(student.parentName) || ''}</div>
          </td>
          <td class="text-right whitespace-nowrap">
            ${canEdit ? `
              <button class="ico-btn pay" data-action="pay" data-adm="${id}" title="Record payment"><i class="fas fa-money-bill-wave"></i></button>
              <button class="ico-btn" data-action="note" data-adm="${id}" title="Note"><i class="fas fa-note-sticky"></i></button>
              <button class="ico-btn danger" data-action="delete" data-adm="${id}" title="Delete"><i class="fas fa-trash"></i></button>
            ` : canPay ? `<button class="ico-btn pay" data-action="pay" data-adm="${id}" title="Record payment"><i class="fas fa-money-bill-wave"></i></button>` : '<span class="text-xs text-slate-400">Class view</span>'}
          </td>
        </tr>`;
    }).join('');
  }

  function populateClassFilter() {
    const select = $('#classFilter');
    if (!select) return;
    const previous = select.value || 'all';
    const classes = Array.from(new Set(getValidStudents().map((student) => toStr(student.class).trim()).filter(Boolean)))
      .sort((a, b) => {
        const ai = CLASS_ORDER.findIndex((item) => item.toLowerCase() === normalizeClassName(a).toLowerCase());
        const bi = CLASS_ORDER.findIndex((item) => item.toLowerCase() === normalizeClassName(b).toLowerCase());
        return (ai < 0 ? 99 : ai) - (bi < 0 ? 99 : bi) || a.localeCompare(b, 'en');
      });
    select.innerHTML = `<option value="all">All Classes</option>${classes.map((className) => `<option value="${className}">${className}</option>`).join('')}`;
    if (state.access?.mode === 'teacher') {
      select.innerHTML = `<option value="${state.access.teacherClass}">${state.access.teacherClass}</option>`;
      select.value = state.access.teacherClass;
      select.disabled = true;
      state.filters.classLevel = state.access.teacherClass;
      return;
    }
    select.disabled = false;
    select.value = classes.includes(previous) ? previous : 'all';
    state.filters.classLevel = select.value;
  }

  function populateStudentSelect() {
    const select = $('#paymentStudent');
    if (!select) return;
    const rows = getValidStudents();
    select.innerHTML = `<option value="">Select student</option>${
      rows.map((student) =>
        `<option value="${sanitizeKey(student.admissionNo)}">${toStr(student.name)}  -  ${toStr(student.class)}  -  ${toStr(student.admissionNo)}</option>`
      ).join('')
    }`;
  }

  function renderPaymentsTable() {
    const tbody = $('#paymentsBody');
    if (!tbody) return;
    const rows = getVisiblePayments();
    if (!rows.length) {
      tbody.innerHTML = `
        <tr>
          <td colspan="5" class="py-6 text-center text-slate-500">No graduation payments yet.</td>
        </tr>`;
      return;
    }
    rows.sort((a, b) => Number(b.createdAt || b.timestamp || 0) - Number(a.createdAt || a.timestamp || 0));
    tbody.innerHTML = rows.map((payment) => {
      const student = state.students?.[sanitizeKey(payment.admissionNo)];
      const timestamp = new Date(Number(payment.createdAt || payment.timestamp || Date.now()));
      const isAdjustment = toStr(payment.method).toUpperCase() === 'ADJUSTMENT' || toStr(payment.type).toUpperCase() === 'ADJUSTMENT';
      const adjustTag = isAdjustment ? '<span class="adjust-pill" title="Manually edited by staff, not a parent payment"><i class="fas fa-pen"></i> Manual</span>' : '';
      return `
        <tr>
          <td><div class="name-main" style="max-width:150px" title="${toStr(student?.name)}">${student?.name || '--'}</div>${student?.class ? `<span class="adm-chip">${toStr(student.class)}</span>` : ''}</td>
          <td class="money-cell font-semibold text-right" style="color:var(--emerald-ink)">${toNumberSafe(payment.amount).toLocaleString('en-US')}</td>
          <td class="whitespace-nowrap text-xs"><div class="font-semibold" style="color:var(--ink)">${timestamp.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })}</div><div style="color:var(--ink-faint)">${timestamp.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}</div></td>
          <td class="text-xs">${toStr(payment.method) || 'Cash'}${adjustTag}${payment.note ? `<div class="text-slate-500 truncate" style="max-width:120px" title="${toStr(payment.note)}">${toStr(payment.note)}</div>` : ''}</td>
          <td class="text-right text-xs" style="color:var(--ink-faint)">${toStr(payment.recordedBy || '').split('@')[0]}</td>
        </tr>`;
    }).join('');
  }

  function renderExpensesTable() {
    const tbody = $('#expensesBody');
    if (!tbody) return;
    const rows = Object.entries(state.expenses || {}).map(([key, value]) => ({ key, ...(value || {}) }));
    if (!rows.length) {
      tbody.innerHTML = `
        <tr>
          <td colspan="7" class="py-8 text-center text-slate-500">No expenses recorded yet. Attach proof for every outflow.</td>
        </tr>`;
      renderExpenseTotals();
      renderVendorDirectory();
      return;
    }
    rows.sort((a, b) => Number(b.createdAt || 0) - Number(a.createdAt || 0));
    tbody.innerHTML = rows.map((expense) => {
      const total = Number(expense.total || (Number(expense.priceEach || 0) * Number(expense.quantity || 0)));
      const timestamp = new Date(Number(expense.createdAt || Date.now()));
      const proofLabel = expense.proofStatus === 'failed'
        ? '<span class="text-xs text-red-500">Upload failed</span>'
        : expense.proofStatus === 'uploading'
          ? `<span class="text-xs text-amber-600">Uploading ${expense.proofProgress || 0}%</span>`
          : (expense.proofUrl ? `<a href="${expense.proofUrl}" target="_blank" class="proof-link">Proof</a>` : '<span class="text-xs text-red-500">Missing</span>');
      return `
        <tr>
          <td>${toStr(expense.item)}</td>
          <td>
            <button type="button" class="vendor-link text-left" data-vendor="${sanitizeKey(toStr(expense.seller).toLowerCase())}">
              <span class="font-semibold">${toStr(expense.seller) || '--'}</span>
              <span class="block text-xs text-slate-400">${toStr(expense.sellerPhone) || ''}</span>
            </button>
          </td>
          <td>${Number(expense.quantity || 0).toLocaleString('en-US')}</td>
          <td>${formatCurrency(expense.priceEach)}</td>
          <td>${formatCurrency(total)}</td>
          <td>${timestamp.toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}<div class="text-xs text-slate-400 uppercase">${toStr(expense.recordedBy || '').split('@')[0]}</div></td>
          <td>${proofLabel}</td>
        </tr>`;
    }).join('');
    renderExpenseTotals();
    renderVendorDirectory();
  }

  function renderExpenseTotals() {
    const expenses = Object.values(state.expenses || {});
    const total = expenses.reduce((sum, expense) => sum + Number(expense.total || (Number(expense.priceEach || 0) * Number(expense.quantity || 0))), 0);
    const count = expenses.length;
    const collectedFromStudents = getValidStudents().reduce((sum, student) => sum + getPaidTotal(student), 0);
    const collectedFromPayments = getVisiblePayments().reduce((sum, payment) => sum + toNumberSafe(payment.amount || 0), 0);
    const collected = Math.max(collectedFromStudents, collectedFromPayments, 0);
    const balance = collected - total;

    setText('#expensesTotal', formatCurrency(total));
    setText('#expensesCount', count ? `${count} entr${count === 1 ? 'y' : 'ies'}` : '0 entries');
    setText('#expensesCollectedTotal', formatCurrency(collected));
    setText('#expensesNetBalance', formatCurrency(balance));

    const balanceNode = $('#expensesNetBalance');
    if (balanceNode) {
      balanceNode.classList.toggle('negative', balance < 0);
      balanceNode.classList.toggle('positive', balance >= 0);
    }
  }

  function buildVendorStats() {
    const vendors = { ...(state.vendors || {}) };
    Object.values(state.expenses || {}).forEach((expense) => {
      const seller = toStr(expense.seller).trim();
      if (!seller) return;
      const key = sanitizeKey(seller.toLowerCase());
      const total = Number(expense.total || (Number(expense.priceEach || 0) * Number(expense.quantity || 0)));
      const current = vendors[key] || { seller };
      vendors[key] = {
        ...current,
        seller: current.seller || seller,
        sellerPhone: current.sellerPhone || expense.sellerPhone || '',
        lastItem: expense.item || current.lastItem || '',
        lastYear: expense.year || state.currentYear,
        lastTotal: total || current.lastTotal || 0,
        usageCount: Number(current.usageCount || 0),
      };
    });
    return Object.entries(vendors)
      .map(([key, value]) => ({ key, ...(value || {}) }))
      .filter((vendor) => toStr(vendor.seller).trim())
      .sort((a, b) => Number(b.lastUsedAt || b.updatedAt || 0) - Number(a.lastUsedAt || a.updatedAt || 0));
  }

  function renderVendorDirectory() {
    const rows = buildVendorStats();
    const datalist = $('#vendorOptions');
    if (datalist) {
      datalist.innerHTML = rows.map((vendor) => `<option value="${toStr(vendor.seller)}">${toStr(vendor.sellerPhone || vendor.contact || '')}</option>`).join('');
    }

    const body = $('#vendorDirectoryBody');
    if (!body) return;
    if (!rows.length) {
      body.innerHTML = `<tr><td colspan="5" class="py-6 text-center text-emerald-800/60">No saved suppliers yet.</td></tr>`;
      return;
    }
    body.innerHTML = rows.slice(0, 80).map((vendor) => {
      const phone = toStr(vendor.sellerPhone || vendor.contact || '');
      const lastUsed = vendor.lastUsedAt || vendor.updatedAt
        ? new Date(Number(vendor.lastUsedAt || vendor.updatedAt)).toLocaleDateString('en-GB')
        : '--';
      return `
        <tr>
          <td><button type="button" class="vendor-link font-semibold text-left" data-vendor="${vendor.key}">${toStr(vendor.seller)}</button></td>
          <td>${phone ? `<a class="proof-link" href="tel:${phone.replace(/\s+/g, '')}">${phone}</a>` : '--'}</td>
          <td>${toStr(vendor.lastItem || '--')}</td>
          <td>${toStr(vendor.lastYear || '--')}</td>
          <td>${lastUsed}</td>
        </tr>`;
    }).join('');
  }

  function showVendorDetails(vendorKey) {
    const key = sanitizeKey(toStr(vendorKey).toLowerCase());
    const vendor = state.vendors?.[key] || buildVendorStats().find((item) => item.key === key);
    if (!vendor) return;
    const sellerInput = document.querySelector('input[name="seller"]');
    const phoneInput = document.querySelector('input[name="sellerPhone"]');
    if (sellerInput) sellerInput.value = vendor.seller || '';
    if (phoneInput) phoneInput.value = vendor.sellerPhone || vendor.contact || '';
    const details = $('#vendorDetails');
    if (details) {
      const phone = toStr(vendor.sellerPhone || vendor.contact || '');
      details.innerHTML = `
        <div class="text-xs uppercase tracking-[0.24em] text-emerald-800/60">Selected supplier</div>
        <div class="mt-1 font-semibold text-emerald-950">${toStr(vendor.seller)}</div>
        <div class="text-sm text-emerald-800">${phone ? `<a href="tel:${phone.replace(/\s+/g, '')}" class="proof-link">${phone}</a>` : 'No phone saved'}</div>
        <div class="mt-2 text-xs text-emerald-800/70">Last item: ${toStr(vendor.lastItem || '--')} - Last used: ${toStr(vendor.lastYear || '--')}</div>`;
    }
  }

  function renderAuditLog() {
    const tbody = $('#auditBody');
    if (!tbody) return;
    const rows = Object.entries(state.audits || {}).map(([key, value]) => ({ key, ...(value || {}) }));
    if (!rows.length) {
      tbody.innerHTML = `
        <tr>
          <td colspan="5" class="py-6 text-center text-slate-500">No audit trail yet.</td>
        </tr>`;
      return;
    }
    rows.sort((a, b) => Number(b.at || 0) - Number(a.at || 0));
    tbody.innerHTML = rows.slice(0, 120).map((entry) => `
      <tr>
        <td>${new Date(Number(entry.at || Date.now())).toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}</td>
        <td>${toStr(entry.action)}</td>
        <td>${toStr(entry.refType)}</td>
        <td><i class="fas fa-user-shield text-xs mr-1" style="color:var(--ink-faint);" title="Staff member who performed this action"></i>${toStr(entry.actor || '').split('@')[0]}</td>
        <td>${describeAuditEntry(entry)}</td>
      </tr>`).join('');
  }

  function describeAuditEntry(entry) {
    const after = entry.after || {};
    const admissionNo = toStr(after.admissionNo || entry.refId || '');
    const studentName = admissionNo ? toStr(state.students?.[sanitizeKey(admissionNo)]?.name || '') : '';
    const who = studentName ? `${studentName} (${admissionNo})` : (admissionNo || '--');
    if (entry.kind === 'paid_adjust') {
      return `Staff manually set <strong>paid</strong> for ${who}: ${formatCurrency(entry.before)} &rarr; ${formatCurrency(entry.after)}`;
    }
    if (entry.kind === 'expected_edit') {
      return `Staff manually set <strong>expected fee</strong> for ${who}: ${formatCurrency(entry.before)} &rarr; ${formatCurrency(entry.after)}`;
    }
    if (entry.action === 'payment:approve') {
      return `Approved payment of ${formatCurrency(after.amount)} for ${who} (${toStr(after.method || 'Cash')})`;
    }
    if (entry.action === 'sync:students') {
      return `Roster sync: ${toStr(after.added || 0)} student(s) added, ${toStr(after.total || 0)} total on roster`;
    }
    const json = JSON.stringify(after);
    return `<code class="text-xs break-all">${json.slice(0, 120)}${json.length > 120 ? '...' : ''}</code>`;
  }

  // ---------- CERTIFICATE ROSTER (graduands + pulled-up children) ----------
  // A child "pulled up" to graduate on merit is stored at graduation/{year}/graduandExtras/{adm}.
  // This is certificate-only: their graduation fee (expectedFee / isGraduand) is never touched.
  function isPulledUp(student) {
    const adm = sanitizeKey(student?.admissionNo || student?.admissionNumber);
    return Boolean(adm && state.graduandExtras?.[adm]);
  }

  function isCertificateGraduand(student) {
    return Boolean(student && (student.isGraduand || isPulledUp(student)));
  }

  function certificateKind(student) {
    const designs = window.GradCertDesigns;
    const cls = toStr(student?.class || student?.classLevel);
    return designs ? designs.kindFor(cls) : (/baby|middle|pre/i.test(cls) ? 'preunit' : 'class7');
  }

  function getCertificateRoster() {
    return getValidStudents().filter(isCertificateGraduand)
      .sort((a, b) => toStr(a.name).localeCompare(toStr(b.name)));
  }

  function escHtml(value) {
    return toStr(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function renderCertificatesTable() {
    const host = $('#certificatesBody');
    if (!host) return;
    document.body.classList.toggle('cert-readonly', Boolean(state.readOnly));
    const roster = getCertificateRoster();
    const filter = state.certFilter || { group: 'all', search: '' };
    const q = toStr(filter.search).trim().toLowerCase();
    const rows = roster.filter((student) => {
      const kind = certificateKind(student);
      if (filter.group === 'preunit' && kind !== 'preunit') return false;
      if (filter.group === 'class7' && kind !== 'class7') return false;
      if (filter.group === 'pulled' && !isPulledUp(student)) return false;
      if (q && !`${student.name} ${student.admissionNo} ${student.class}`.toLowerCase().includes(q)) return false;
      return true;
    });

    const ready = roster.filter((s) => state.certificates?.[sanitizeKey(s.admissionNo)]?.urlPdf).length;
    const counts = {
      all: roster.length,
      preunit: roster.filter((s) => certificateKind(s) === 'preunit').length,
      class7: roster.filter((s) => certificateKind(s) === 'class7').length,
      pulled: roster.filter(isPulledUp).length,
    };
    setText('#certStatTotal', counts.all);
    setText('#certStatReady', ready);
    setText('#certStatPending', Math.max(0, counts.all - ready));
    document.querySelectorAll('[data-cert-group]').forEach((chip) => {
      const g = chip.dataset.certGroup;
      chip.classList.toggle('active', g === (filter.group || 'all'));
      const badge = chip.querySelector('[data-count]');
      if (badge) badge.textContent = counts[g] ?? 0;
    });

    if (!rows.length) {
      host.innerHTML = `<div class="cert-empty">${roster.length ? 'No graduand matches this filter.' : `No graduands for ${escHtml(state.currentYear)} yet.`}</div>`;
      return;
    }
    const canWrite = !state.readOnly;
    host.innerHTML = rows.map((student) => {
      const adm = sanitizeKey(student.admissionNo);
      const certificate = state.certificates?.[adm];
      const generatedAt = certificate?.generatedAt ? new Date(Number(certificate.generatedAt)) : null;
      const kind = certificateKind(student);
      const pulled = isPulledUp(student);
      const initials = toStr(student.name).trim().split(/\s+/).slice(0, 2).map((p) => p[0] || '').join('').toUpperCase();
      return `
        <article class="cert-card ${kind}">
          <div class="cert-avatar">
            ${student.photoUrl ? `<img src="${escHtml(student.photoUrl)}" alt="" loading="lazy" decoding="async" onerror="this.remove()">` : ''}
            <span>${escHtml(initials)}</span>
          </div>
          <div class="cert-info">
            <div class="cert-name">${escHtml(student.name)}</div>
            <div class="cert-meta">${escHtml(student.class)} · ${escHtml(student.admissionNo)}</div>
            <div class="cert-tags">
              <span class="tag tag-${kind}">${kind === 'preunit' ? 'Little Graduate' : 'Primary Completion'}</span>
              ${pulled ? '<span class="tag tag-pulled">Pulled up on merit</span>' : ''}
              ${certificate?.urlPdf
                ? `<span class="tag tag-ready">Saved ${generatedAt ? generatedAt.toLocaleDateString('en-GB') : ''}</span>`
                : '<span class="tag tag-pending">Not saved yet</span>'}
            </div>
          </div>
          <div class="cert-actions">
            <button class="cbtn ghost" data-action="preview-cert" data-adm="${adm}" title="Preview"><i class="fa-regular fa-eye"></i><span>Preview</span></button>
            <button class="cbtn primary" data-action="generate-cert" data-adm="${adm}" title="${canWrite ? 'Create, save & download' : 'Download'}"><i class="fa-solid fa-download"></i><span>Download</span></button>
            ${certificate?.urlPdf ? `<a class="cbtn ghost" target="_blank" rel="noopener" href="${escHtml(certificate.urlPdf)}" title="Saved PDF"><i class="fa-regular fa-file-pdf"></i><span>Saved</span></a>` : ''}
            ${pulled && canWrite ? `<button class="cbtn danger" data-action="remove-pullup" data-adm="${adm}" title="Remove from graduands"><i class="fa-solid fa-xmark"></i></button>` : ''}
          </div>
        </article>`;
    }).join('');
  }

  function renderGallery() {
    const grid = $('#galleryGrid');
    if (!grid) return;
    const rows = Object.entries(state.galleries || {}).map(([key, value]) => ({ key, ...(value || {}) }));
    if (!rows.length) {
      grid.innerHTML = `
        <div class="empty-gallery">Upload curated graduation photos so parents can relive the day.</div>`;
      return;
    }
    rows.sort((a, b) => Number(b.uploadedAt || 0) - Number(a.uploadedAt || 0));
    grid.innerHTML = rows.map((photo) => `
      <article class="gallery-card">
        <img src="${photo.url}" alt="${toStr(photo.caption) || 'Graduation photo'}" loading="lazy" class="gallery-image">
        <div class="gallery-meta">
          <p class="caption">${toStr(photo.caption) || 'Graduation moment'}</p>
          <p class="meta">${new Date(Number(photo.uploadedAt || Date.now())).toLocaleDateString('en-GB')}  -  ${toStr(photo.uploadedBy || '').split('@')[0]}</p>
        </div>
      </article>`).join('');
  }

  // ---------- SECURE EDIT MODAL ----------
  const gradEditModal = typeof document !== 'undefined' ? document.getElementById('gradEditModal') : null;
  if (gradEditModal) {
    const hideModal = () => gradEditModal.classList.add('hidden');
    const refreshStatusDom = (id) => {
      const badge = document.querySelector(`[data-col="status"][data-id="${id}"]`);
      const student = state.students?.[id];
      if (!badge || !student) return;
      const status = computeStatus(student);
      const className = status === 'paid'
        ? 'status-badge paid'
        : status === 'partial'
          ? 'status-badge partial'
          : status === 'debt'
            ? 'status-badge debt'
            : 'status-badge unpaid';
      badge.className = className;
      badge.textContent = status.toUpperCase();
      const debtChip = badge.parentElement?.querySelector('.debt-pill');
      if (debtChip) debtChip.style.display = status === 'debt' ? '' : 'none';
    };

    document.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-edit]');
      if (!btn) return;
      if (state.readOnly) {
        showToast('Teacher view is read-only.', 'warn');
        return;
      }
      const field = btn.getAttribute('data-edit');
      const id = btn.getAttribute('data-id');
      const span = document.querySelector(`[data-col="${field}"][data-id="${id}"]`);
      const current = Number(span?.getAttribute('data-val') || 0);

      $('#gradEditTitle').textContent = field === 'expected' ? 'Edit Expected' : 'Edit Paid (creates adjustment)';
      $('#gradEditAmount').value = String(current || '');
      $('#gradEditNote').value = '';
      $('#gradEditPass').value = '';
      $('#gradEditTargetId').value = id;
      $('#gradEditField').value = field;

      gradEditModal.classList.remove('hidden');
    });

    const cancelBtn = document.getElementById('gradEditCancel');
    if (cancelBtn) {
      cancelBtn.addEventListener('click', () => hideModal());
    }

    const saveBtn = document.getElementById('gradEditSave');
    if (saveBtn) {
      saveBtn.addEventListener('click', async () => {
        const amount = Number(document.getElementById('gradEditAmount').value || 0);
        const note = String(document.getElementById('gradEditNote').value || '').trim();
        const pass = document.getElementById('gradEditPass').value;
        const id = document.getElementById('gradEditTargetId').value;
        const field = document.getElementById('gradEditField').value;

        if (!checkGradPassword(pass)) { alert('Wrong password'); return; }
        if (!(amount >= 0)) { alert('Amount must be >= 0'); return; }
        if (!id || !field) { alert('Missing target'); return; }

        const YEAR = getSelectedYear();
        const SCHOOL = getSchoolPrefix();
        const dbref = (path) => db().ref(path);
        const now = Date.now();
        const byEmail = auth()?.currentUser?.email || 'unknown';

        try {
          if (field === 'expected') {
            const studentPath = `${SCHOOL}graduation/${YEAR}/students/${id}`;
            const beforeSnap = await dbref(`${studentPath}/expectedFee`).once('value');
            const before = toNumberSafe(beforeSnap.val() ?? state.students?.[id]?.expectedFee);
            const paidVal = toNumberSafe(document.querySelector(`[data-col="paid"][data-id="${id}"]`)?.getAttribute('data-val') || state.paymentTotals?.[id] || state.students?.[id]?.paid || 0);
            const bal = Math.max(0, amount - paidVal);
            const status = bal === 0 && amount >= 0 ? 'paid' : (paidVal > 0 ? 'partial' : 'debt');

            await dbref(studentPath).update({
              expectedFee: amount,
              expectedOverride: amount,
              balance: bal,
              status,
            });
            if (state.students?.[id]) {
              state.students[id].expectedFee = amount;
              state.students[id].expectedOverride = amount;
              state.students[id].balance = Math.max(0, amount - getPaidTotal(state.students[id]));
            }

            const span = document.querySelector(`[data-col="expected"][data-id="${id}"]`);
            if (span) {
              span.textContent = formatCurrency(amount);
              span.setAttribute('data-val', String(amount));
            }
            // Reuse variables, don't redeclare
            const currentPaid = toNumberSafe(document.querySelector(`[data-col="paid"][data-id="${id}"]`)?.getAttribute('data-val') || state.paymentTotals?.[id] || state.students?.[id]?.paid || 0);
            const currentBal = Math.max(0, amount - currentPaid);
            const balCell = document.querySelector(`[data-col="balance"][data-id="${id}"]`);
            if (balCell) {
              balCell.textContent = formatCurrency(currentBal);
              balCell.setAttribute('data-val', String(currentBal));
            }

            await dbref(`${SCHOOL}graduation/${YEAR}/audits`).push({
              actor: byEmail,
              action: 'expected:edit',
              refType: 'student',
              refId: id,
              kind: 'expected_edit',
              before,
              after: amount,
              note,
              by: byEmail,
              at: now,
            });
          } else if (field === 'paid') {
            const paidPath = `${SCHOOL}graduation/${YEAR}/students/${id}/paid`;
            const beforeSnap = await dbref(paidPath).once('value');
            const beforePaid = toNumberSafe(beforeSnap.val() ?? state.students?.[id]?.paid ?? 0);
            const delta = amount - beforePaid;

            if (delta !== 0) {
              await dbref(`${SCHOOL}graduation/${YEAR}/payments`).push({
                admissionNo: id,
                amount: delta,
                method: 'ADJUSTMENT',
                type: 'ADJUSTMENT',
                note: note || 'Manual correction',
                recordedBy: byEmail,
                createdAt: now,
                timestamp: now,
              });
            }
            await dbref(paidPath).set(amount);
            if (!state.paymentTotals) state.paymentTotals = {};
            state.paymentTotals[id] = amount;
            if (state.students?.[id]) {
              state.students[id].paid = amount;
              state.students[id].balance = Math.max(0, getExpectedFee(state.students[id]) - amount);
            }

            const span = document.querySelector(`[data-col="paid"][data-id="${id}"]`);
            if (span) {
              span.textContent = formatCurrency(amount);
              span.setAttribute('data-val', String(amount));
            }
            const expectedVal = toNumberSafe(document.querySelector(`[data-col="expected"][data-id="${id}"]`)?.getAttribute('data-val') || state.students?.[id]?.expectedFee || 0);
            const bal = Math.max(0, expectedVal - amount);
            const balCell = document.querySelector(`[data-col="balance"][data-id="${id}"]`);
            if (balCell) {
              balCell.textContent = formatCurrency(bal);
              balCell.setAttribute('data-val', String(bal));
            }

            await dbref(`${SCHOOL}graduation/${YEAR}/audits`).push({
              actor: byEmail,
              action: 'paid:adjust',
              refType: 'student',
              refId: id,
              kind: 'paid_adjust',
              before: beforePaid,
              after: amount,
              delta,
              note,
              by: byEmail,
              at: now,
            });
          }

          refreshStatusDom(id);
          hideModal();
          renderDashboardSummary();
        } catch (err) {
          console.error(err);
          alert('Failed to save. Check network and try again.');
        }
      });
    }
  }

  // ---------- DELETE & GHOST CLEANER ----------
  async function confirmDeleteFlow(adm, name) {
    const ok = await requireDeleteAuth();
    if (!ok) return;
    const scope = confirm(`Futa ${name} (${adm}) KILA MAHALI?\n\nOK = Kila mahali\nCancel = Graduation tu`);

    const YEAR = getSelectedYear();
    const SCHOOL = getSchoolPrefix();
    const updates = {};

    updates[`${SCHOOL}graduation/${YEAR}/students/${adm}`] = null;
    updates[`${SCHOOL}graduation/${YEAR}/certificates/${adm}`] = null;

    Object.entries(state.payments || {}).forEach(([key, payment]) => {
      const pid = sanitizeKey(payment?.admissionNo || payment?.admission || payment?.admNo || payment?.studentAdm);
      if (pid === adm) {
        updates[`${SCHOOL}graduation/${YEAR}/payments/${key}`] = null;
      }
    });

    if (scope) {
      updates[`${schoolPath('students')}/${adm}`] = null;
      if (getCurrentSchoolId() === 'socrates-school') {
        updates[`students/${adm}`] = null;
      }
    }

    await db().ref().update(updates);
    showToast('Record deleted.', 'warn');
  }

  async function cleanGhosts() {
    const ok = await requireDeleteAuth();
    if (!ok) return;

    const YEAR = getSelectedYear();
    const SCHOOL = getSchoolPrefix();
    const updates = {};
    let count = 0;

    Object.entries(state.students || {}).forEach(([adm, student]) => {
      if (!isGhostStudent(student)) return;
      updates[`${SCHOOL}graduation/${YEAR}/students/${adm}`] = null;
      updates[`${SCHOOL}graduation/${YEAR}/certificates/${adm}`] = null;

      Object.entries(state.payments || {}).forEach(([key, payment]) => {
        const pid = sanitizeKey(payment?.admissionNo || payment?.admission || payment?.admNo || payment?.studentAdm);
        if (pid === adm) {
          updates[`${SCHOOL}graduation/${YEAR}/payments/${key}`] = null;
        }
      });
      count += 1;
    });

    if (!count) { alert('Hakuna ghost rows.'); return; }
    if (!confirm(`Utafuta ghost ${count} rows?`)) return;
    await db().ref().update(updates);
    showToast(`Ghost ${count} ${count === 1 ? 'row' : 'rows'} removed.`, 'warn');
  }

  // ---------- FORMS: PAYMENTS / EXPENSES / GALLERY ----------
  function handlePaymentSubmit(event) {
    event.preventDefault();
    if (!canRecordPayment()) {
      showToast('You do not have access to record graduation payments.', 'warn');
      return;
    }
    const form = event.currentTarget;
    const data = new FormData(form);
    const admissionNo = sanitizeKey(data.get('admissionNo'));
    const amount = Number(data.get('amount') || 0);
    const method = toStr(data.get('method') || 'Cash');
    const reference = toStr(data.get('reference') || '');
    const note = toStr(data.get('note') || '');

    if (!admissionNo) {
      showToast('Select a student before recording payment.', 'error');
      return;
    }
    if (!amount || amount <= 0) {
      showToast('Amount must be greater than 0.', 'error');
      return;
    }

    setBusy('#paymentSubmit', true);
    recordPayment({ admissionNo, amount, method, note, reference })
      .then(() => {
        form.reset();
        showToast('Payment sent to admin for approval.');
      })
      .catch((err) => {
        console.error(err);
        showToast(err?.message || 'Payment failed', 'error');
      })
      .finally(() => setBusy('#paymentSubmit', false));
  }

  function recordPayment({ admissionNo, amount, method, note, reference }) {
    const year = state.currentYear;
    const student = state.students?.[sanitizeKey(admissionNo)] || state.students?.[admissionNo];
    if (!student) {
      return Promise.reject(new Error('Student not found in graduation roster.'));
    }
    if (!classMatchesAccess(student.class || student.classLevel || student.className)) {
      return Promise.reject(new Error('This student is outside your assigned class.'));
    }
    const expected = getExpectedFee(student);
    const paidBefore = getPaidTotal(student);
    const amountNow = toNumberSafe(amount);
    const newBalance = Math.max(0, expected - Math.min(expected, paidBefore + amountNow));
    const recordedBy = state.user?.email || 'unknown';
    const timestamp = Date.now();
    const parentContact = student.parentPhone || student.guardianPhone || student.contact || student.parentContact || '--';
    const pendingRef = db().ref('approvalsPending').push();

    return pendingRef.set({
      approvalId: pendingRef.key,
      sourceModule: 'graduation',
      studentAdm: admissionNo,
      studentName: toStr(student.name) || admissionNo,
      className: toStr(student.class) || toStr(student.classLevel) || '',
      parentContact,
      amountPaidNow: amountNow,
      paymentMethod: method,
      paymentReferenceCode: reference || 'N/A',
      datePaid: timestamp,
      recordedBy,
      status: 'pending',
      notes: note,
      totalRequired: expected,
      totalPaidBefore: paidBefore,
      newBalanceAfterThis: newBalance,
      createdAt: firebase.database.ServerValue.TIMESTAMP,
      modulePayload: {
        year,
        admission: admissionNo,
        payment: {
          admissionNo,
          amount: amountNow,
          method,
          note,
          reference,
          recordedBy,
          timestamp,
        },
        breakdown: [
          { label: 'Class', value: toStr(student.class) || '--' },
          { label: 'Expected Fee', value: formatCurrency(expected) },
          { label: 'Paid Before', value: formatCurrency(paidBefore) },
          { label: 'Balance After Approval', value: formatCurrency(newBalance) },
        ],
      },
    });
  }

  async function handleExpenseSubmit(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const payload = {
      item: toStr(data.get('item')),
      seller: toStr(data.get('seller')),
      sellerPhone: toStr(data.get('sellerPhone')),
      quantity: Number(data.get('quantity') || 0),
      priceEach: Number(data.get('priceEach') || 0),
      note: toStr(data.get('note')),
      proofFile: data.get('proofFile'),
    };

    if (!payload.item) {
      showToast('Expense item required.', 'error');
      return;
    }
    if (!payload.proofFile || !payload.proofFile.size) {
      showToast('Attach proof (receipt/photo).', 'error');
      return;
    }
    if (!payload.quantity || !payload.priceEach) {
      showToast('Quantity and price must be provided.', 'error');
      return;
    }

    setBusy('#expenseSubmit', true);
    try {
      await recordExpense(payload);
      form.reset();
      showToast('Expense saved. Proof uploading in background.');
    } catch (err) {
      console.error(err);
      showToast(err?.message || 'Expense failed', 'error');
    } finally {
      setBusy('#expenseSubmit', false);
    }
  }

  async function recordExpense({ item, seller, sellerPhone, quantity, priceEach, note, proofFile }) {
    const year = state.currentYear;
    const expenseRef = db().ref(gradPath(year, 'expenses')).push();
    const expenseId = expenseRef.key;
    const total = Number(quantity || 0) * Number(priceEach || 0);
    let uploadFile = proofFile;

    if (proofFile.type && proofFile.type.startsWith('video/')) {
      return Promise.reject(new Error('Videos are not allowed. Please upload an image or PDF.'));
    }
    if (proofFile.size > 25 * 1024 * 1024) {
      return Promise.reject(new Error('Proof file too large. Max 25MB.'));
    }
    if (proofFile.type && proofFile.type.startsWith('image/') && proofFile.size > 2 * 1024 * 1024) {
      try {
        uploadFile = await compressImage(proofFile, 1600, 1600, 0.82);
      } catch (err) {
        console.warn('Compression skipped', err?.message || err);
      }
    }
    const safeName = uploadFile.name || proofFile.name || 'proof.jpg';
    const storagePath = `${gradPath(year, 'expenses')}/${expenseId}/${encodeURIComponent(safeName)}`;

    // First write the expense so it appears immediately, then upload proof in background.
    const basePayload = {
      item,
      seller,
      sellerPhone,
      quantity: Number(quantity),
      priceEach: Number(priceEach),
      total,
      proofUrl: '',
      proofPath: storagePath,
      proofStatus: 'uploading',
      proofProgress: 0,
      proofOriginalName: proofFile.name || 'file',
      proofOriginalSize: proofFile.size || 0,
      proofUploadedSize: uploadFile.size || proofFile.size || 0,
      note,
      year,
      recordedBy: state.user?.email || 'unknown',
      createdAt: firebase.database.ServerValue.TIMESTAMP,
    };

    return expenseRef.set(basePayload).then(() => {
      upsertVendorFromExpense(expenseId, { ...basePayload, total }).catch((err) => {
        console.warn('Vendor directory update failed', err?.message || err);
      });
      uploadExpenseProof(uploadFile, `${expenseId}-${safeName}`, (progress) => {
        expenseRef.update({ proofProgress: progress }).catch(() => {});
      })
        .then((url) => {
          expenseRef.update({ proofUrl: url, proofStatus: 'ready', proofProgress: 100 }).catch(() => {});
          db().ref(gradPath(year, 'audits')).push({
            actor: state.user?.email || 'unknown',
            action: 'expense:add',
            refType: 'expense',
            refId: expenseId,
            after: { item, seller, sellerPhone, quantity, priceEach, total, proofUrl: url },
            at: firebase.database.ServerValue.TIMESTAMP,
          }).catch(() => {});
        })
        .catch((err) => {
          expenseRef.update({ proofStatus: 'failed', proofError: err?.message || 'Upload failed' }).catch(() => {});
          showToast(err?.message || 'Proof upload failed. Entry saved without proof.', 'error');
        });

      return expenseId;
    });
  }

  function uploadExpenseProof(file, pathHint, onProgress, timeoutMs = 120000) {
    return uploadToCloudinary(file, CLD_EXPENSE_FOLDER, pathHint, onProgress, timeoutMs);
  }

  function uploadToCloudinary(file, folder, pathHint, onProgress, timeoutMs = 120000) {
    const resource = (file?.type || '').startsWith('image/') ? 'image' : 'raw';
    const url = `https://api.cloudinary.com/v1_1/${CLD_CLOUD_NAME}/${resource}/upload`;
    const fd = new FormData();
    fd.append('file', file);
    fd.append('upload_preset', CLD_UPLOAD_PRESET);
    fd.append('folder', folder);
    fd.append('public_id', cldPublicIdFrom(pathHint));

    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      const timer = setTimeout(() => {
        try { xhr.abort(); } catch (_) { /* ignore */ }
        reject(new Error('Upload taking too long. Please retry on a stable connection or compress the image (max 25MB).'));
      }, timeoutMs);

      xhr.upload.onprogress = (evt) => {
        if (!evt.lengthComputable) return;
        const pct = Math.round((evt.loaded / evt.total) * 100);
        if (onProgress) onProgress(pct);
      };
      xhr.onreadystatechange = () => {
        if (xhr.readyState !== 4) return;
        clearTimeout(timer);
        if (xhr.status >= 200 && xhr.status < 300) {
          try {
            const res = JSON.parse(xhr.responseText || '{}');
            if (res.secure_url) return resolve(res.secure_url);
            return reject(new Error('Cloudinary did not return a URL'));
          } catch (err) {
            return reject(err);
          }
        } else {
          let message = 'Cloudinary upload failed';
          try {
            const res = JSON.parse(xhr.responseText || '{}');
            message = res?.error?.message || message;
          } catch (_) { /* ignore */ }
          reject(new Error(message));
        }
      };
      xhr.onerror = () => {
        clearTimeout(timer);
        reject(new Error('Network error during upload'));
      };
      xhr.open('POST', url, true);
      xhr.send(fd);
    });
  }

  function cldPublicIdFrom(pathHint) {
    return String(pathHint || 'file').replace(/[^a-z0-9_\-]/gi, '_');
  }

  async function handleGallerySubmit(event) {
    event.preventDefault();
    if (!isAuthorized(state.user?.email || '')) {
      showToast('Only staff can upload gallery photos.', 'error');
      return;
    }
    const form = event.currentTarget;
    const captionInput = toStr(form.querySelector('[name="caption"]')?.value);
    const files = Array.from(form.querySelector('input[name="photo"]')?.files || []);

    if (!files.length) {
      showToast('Select a photo to upload.', 'error');
      return;
    }

    setBusy('#gallerySubmit', true);
    try {
      await processGalleryFiles(files, captionInput);
      form.reset();
      setGalleryStatus('All photos uploaded. Parents can view instantly.', 'success');
      showToast('Gallery photo uploaded.');
    } catch (err) {
      console.error(err);
      setGalleryStatus(err?.message || 'Upload failed', 'error');
      showToast(err?.message || 'Upload failed', 'error');
    } finally {
      setBusy('#gallerySubmit', false);
    }
  }

  async function processGalleryFiles(files, captionInput) {
    const list = (files || []).filter((file) => file && file.size).slice(0, 10);
    if (!list.length) throw new Error('Drop image files only.');
    if (!isAuthorized(state.user?.email || '')) throw new Error('Only staff can upload gallery photos.');
    if (state.galleryUploading) throw new Error('Another gallery upload is still running. Please wait.');

    state.galleryUploading = true;
    setGalleryStatus(`Uploading ${list.length} photo${list.length > 1 ? 's' : ''}...`, 'info');
    try {
      for (const file of list) {
        const caption = captionInput || deriveCaptionFromFile(file);
        setGalleryStatus(`Uploading ${file.name || 'photo'}...`, 'info');
        await uploadGalleryPhoto({ caption, file });
        setGalleryStatus(`Saved ${file.name || 'photo'}`, 'success');
      }
      setGalleryStatus('Uploads complete. Gallery refreshed.', 'success');
    } catch (err) {
      setGalleryStatus(err?.message || 'Upload failed', 'error');
      throw err;
    } finally {
      state.galleryUploading = false;
    }
  }

  function deriveCaptionFromFile(file) {
    if (!file?.name) return 'Graduation moment';
    const base = file.name.replace(/\.[^.]+$/, '');
    return base.replace(/[_-]+/g, ' ').trim() || 'Graduation moment';
  }

  function setGalleryStatus(message, tone = 'info') {
    const node = $('#galleryUploadStatus');
    if (!node) return;
    node.textContent = toStr(message);
    const palette = tone === 'error' ? '#dc2626' : tone === 'success' ? '#059669' : '#475569';
    node.style.color = palette;
  }

  function uploadGalleryPhoto({ caption, file }) {
    const year = state.currentYear;
    const entryRef = db().ref(gradPath(year, 'galleries')).push();
    const galleryId = entryRef.key;
    const pathHint = `${year}-${galleryId}-${file.name || 'photo'}`;
    let uploadFile = file;

    if (uploadFile.type && uploadFile.type.startsWith('video/')) {
      return Promise.reject(new Error('Videos are not allowed. Upload image files.'));
    }
    if (uploadFile.type && uploadFile.type.startsWith('image/') && uploadFile.size > 2 * 1024 * 1024) {
      uploadFile = uploadFile.slice ? uploadFile : file; // safe fallback
      return compressImage(uploadFile, 1920, 1920, 0.85)
        .then((compressed) => uploadToCloudinary(compressed, CLD_GALLERY_FOLDER, pathHint))
        .then((url) => entryRef.set({
          caption,
          url,
          uploadedBy: state.user?.email || 'unknown',
          uploadedAt: firebase.database.ServerValue.TIMESTAMP,
          storagePath: `${CLD_GALLERY_FOLDER}/${pathHint}`,
        }).then(() => url))
        .then((url) => db().ref(gradPath(year, 'audits')).push({
          actor: state.user?.email || 'unknown',
          action: 'gallery:add',
          refType: 'gallery',
          refId: galleryId,
          after: { caption, url },
          at: firebase.database.ServerValue.TIMESTAMP,
        }));
    }

    return uploadToCloudinary(uploadFile, CLD_GALLERY_FOLDER, pathHint)
      .then((url) => entryRef.set({
        caption,
        url,
        uploadedBy: state.user?.email || 'unknown',
        uploadedAt: firebase.database.ServerValue.TIMESTAMP,
        storagePath: `${CLD_GALLERY_FOLDER}/${pathHint}`,
      }).then(() => url))
      .then((url) => db().ref(gradPath(year, 'audits')).push({
        actor: state.user?.email || 'unknown',
        action: 'gallery:add',
        refType: 'gallery',
        refId: galleryId,
        after: { caption, url },
        at: firebase.database.ServerValue.TIMESTAMP,
      }));
  }

  // ---------- EXPORTS ----------
  async function loadGradExpenses(year) {
    const SCHOOL = getSchoolPrefix();
    const snap = await db().ref(`${SCHOOL}graduation/${year}/expenses`).once('value');
    const raw = snap.val() || {};
    return Object.entries(raw).map(([id, e]) => {
      const qty = Number(e.quantity || 0);
      const priceEach = toNumberSafe(e.priceEach || 0);
      const total = toNumberSafe(e.total || (priceEach * qty));
      const createdAt = e.createdAt ? new Date(Number(e.createdAt)) : null;
      return {
        id,
        item: e.item || '-',
        seller: e.seller || e.paidTo || '-',
        contact: e.sellerPhone || e.contact || '-',
        quantity: qty,
        priceEach,
        total,
        recordedAt: createdAt ? createdAt.toLocaleString('en-GB') : (e.date || ''),
        recordedBy: e.recordedBy || e.by || '-',
        proof: e.proofUrl ? 'Yes' : 'No',
        proofUrl: e.proofUrl || '',
        note: e.note || '',
      };
    });
  }

  async function loadGradDonations(year) {
    const SCHOOL = getSchoolPrefix();
    const yr = String(year);
    const paths = [
      `${SCHOOL}graduations/${yr}/donations`,
      `${SCHOOL}graduation/${yr}/donations`,
    ];
    let raw = null;
    for (const path of paths) {
      const snap = await db().ref(path).once('value');
      if (snap.exists()) { raw = snap.val(); break; }
    }
    const list = Object.entries(raw || {}).map(([id, d]) => {
      const amount = toNumberSafe(d.amount);
      const donorName = d.donorName || '-';
      const donorContact = d.donorContact || '-';
      const proofNote = d.proofNote || '';
      const ts = d.donationDateTs || Date.parse(d.donationDate || '') || Number(d.createdAt) || null;
      const recordedAt = ts ? new Date(ts).toLocaleString('en-GB') : '';
      const recordedBy = (d.recordedBy && (d.recordedBy.email || d.recordedBy.uid)) || '-';
      return { id, amount, donorName, donorContact, proofNote, recordedAt, recordedBy, ts };
    });
    const total = list.reduce((sum, d) => sum + (toNumberSafe(d.amount) || 0), 0);
    const latestTs = list.reduce((acc, d) => {
      const t = Number(d.ts);
      if (!t || Number.isNaN(t)) return acc;
      return acc == null ? t : Math.max(acc, t);
    }, null);
    return { list, total, latestTs };
  }

  function downloadCSV(name, rows) {
    if (!rows || !rows.length) return;
    const header = Object.keys(rows[0] || {});
    const lines = [header.join(',')].concat(
      rows.map((row) => header.map((key) => JSON.stringify(row[key] ?? '')).join(','))
    );
    const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8;' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${name}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  async function loadGradLedger(year) {
    const SCHOOL = getSchoolPrefix();
    const yearStr = String(year);
    const useStateStudents = state.currentYear === Number(yearStr) ? state.students : null;
    if (useStateStudents && Object.keys(useStateStudents || {}).length) {
      return getValidStudents().map((s) => ({
        id: sanitizeKey(s.admissionNo || s.admissionNumber),
        admission: s.admissionNo || s.admissionNumber || '-',
        name: s.name || s.fullName || '-',
        className: s.class || s.className || '-',
        expected: getExpectedFee(s),
        paid: getPaidTotal(s),
        parent: s.parentPhone || s.primaryParentContact || s.guardianPhone || s.contact || s.parentContact || '-',
      }));
    }

    const [studentsSnap, paymentsSnap] = await Promise.all([
      db().ref(`${SCHOOL}graduation/${year}/students`).once('value'),
      db().ref(`${SCHOOL}graduation/${year}/payments`).once('value'),
    ]);
    const studentsRaw = studentsSnap.val() || {};
    const paymentsRaw = paymentsSnap.val() || {};

    const paymentTotals = buildPaymentTotals(paymentsRaw || {}, year);
    const seen = new Set();
    const activeRoster = await fetchMasterStudents(true, year);
    const activeKeys = new Set(activeRoster.map((student) => sanitizeKey(student.admissionNumber || student.__key)).filter(Boolean));
    if (!activeKeys.size) return [];

    return Object.entries(studentsRaw).map(([id, s]) => {
      const adm = sanitizeKey(s.admissionNo || id);
      if (!adm || !activeKeys.has(adm)) return null;
      if (adm && seen.has(adm)) return null;
      if (adm) seen.add(adm);
      const expected = toNumberSafe(s.expectedOverride ?? s.expectedFee ?? s.expected ?? computeExpectedFee(s.class));
      const paid = toNumberSafe(paymentTotals[id] || paymentTotals[adm] || 0);
      const parent = s.parentPhone || s.primaryParentContact || s.guardianPhone || s.contact || s.parentContact || '-';
      const name = s.name || s.fullName || '-';
      const cls = s.class || s.className || '-';
      if (!adm || !name || name.toLowerCase() === 'student' || !cls || cls === '-' || !parent || parent === '-') return null;
      return {
        id: adm || id,
        admission: s.admissionNo || adm || id,
        name,
        className: cls,
        expected,
        paid,
        parent,
      };
    }).filter(Boolean);
  }

  function partitionStudents(list) {
    const paid = [];
    const partial = [];
    const unpaid = [];
    list.forEach((s) => {
      if (s.expected <= 0 || s.paid >= s.expected) paid.push(s);
      else if (s.paid > 0 && s.paid < s.expected) partial.push(s);
      else unpaid.push(s);
    });
    return { paid, partial, unpaid };
  }

  async function exportExpensesCSV(event) {
    if (event) {
      event.preventDefault();
      event.stopImmediatePropagation();
    }
    const y = getSelectedYear();
    const list = await loadGradExpenses(y);
    if (!list.length) { alert('No expenses found.'); return; }
    const rows = list.map((e) => ({
      item: e.item,
      seller: e.seller,
      contact: e.contact,
      quantity: e.quantity,
      priceEach: e.priceEach,
      total: e.total,
      recordedAt: e.recordedAt,
      recordedBy: e.recordedBy,
      proof: e.proof,
    }));
    downloadCSV(`graduation_expenses_${y}`, rows);
  }


  async function exportAuditCSV(event) {
    if (event) {
      event.preventDefault();
      event.stopImmediatePropagation();
    }
    const y = getSelectedYear();
    const [students, expenses, donations] = await Promise.all([loadGradLedger(y), loadGradExpenses(y), loadGradDonations(y)]);
    const { paid, partial, unpaid } = partitionStudents(students);

    const totalExpected = students.reduce((a, b) => a + b.expected, 0);
    const totalPaid = students.reduce((a, b) => a + b.paid, 0);
    const donationTotal = donations.total || 0;
    const totalCollected = totalPaid + donationTotal;
    const totalUncol = Math.max(0, totalExpected - totalCollected);
    const totalExp = expenses.reduce((a, b) => a + (Number(b.amount) || 0), 0);
    const netBalance = totalCollected - totalExp;

    const lines = [];
    const push = (arr) => lines.push(...arr);

    push([`"Socrates School - Graduation Audit ${y}"`, '']);
    push([`"Students total",${students.length}`]);
    push([`"Paid count",${paid.length}`]);
    push([`"Partial count",${partial.length}`]);
    push([`"Unpaid count",${unpaid.length}`]);
    push([`"Total expected",${totalExpected}`]);
    push([`"Total collected (payments)",${totalPaid}`]);
    push([`"Donations total",${donationTotal}`]);
    push([`"Total collected (incl donations)",${totalCollected}`]);
    push([`"Uncollected after donations",${totalUncol}`]);
    push([`"Expenses total",${totalExp}`]);
    push([`"Net (collected incl donations - expenses)",${netBalance}`]);
    push(['', '']);

    push(['"PAID"']); push(['Admission', 'Name', 'Class', 'Expected', 'Paid', 'Parent']);
    paid.forEach((s) => push([s.admission, s.name, s.className, s.expected, s.paid, s.parent]));
    push(['', '']);

    push(['"PARTIAL"']); push(['Admission', 'Name', 'Class', 'Expected', 'Paid', 'Parent']);
    partial.forEach((s) => push([s.admission, s.name, s.className, s.expected, s.paid, s.parent]));
    push(['', '']);

    push(['"UNPAID"']); push(['Admission', 'Name', 'Class', 'Expected', 'Paid', 'Parent']);
    unpaid.forEach((s) => push([s.admission, s.name, s.className, s.expected, s.paid, s.parent]));
    push(['', '']);

    push(['"DONATIONS"']); push(['Donor', 'Contact', 'Amount', 'Date', 'Proof note', 'Recorded by']);
    donations.list.forEach((d) => push([d.donorName, d.donorContact, d.amount, d.recordedAt, d.proofNote, d.recordedBy]));
    push(['', '']);

    push(['"EXPENSES"']); push(['Item', 'Seller', 'Contact', 'Qty', 'Price Each', 'Total', 'Recorded', 'By', 'Proof']);
    expenses.forEach((e) => push([e.item, e.seller, e.contact, e.quantity, e.priceEach, e.total, e.recordedAt, e.recordedBy, e.proof]));

    const blob = new Blob([lines.map((r) => Array.isArray(r) ? r.join(',') : r).join('\n')], { type: 'text/csv;charset=utf-8;' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `graduation_audit_${y}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  async function exportAuditPDF(event) {
    if (event) {
      event.preventDefault();
      event.stopImmediatePropagation();
    }
    await runPdfJob('Full report', generateAuditPDF);
  }

  // Fancy Audit PDF with logo, Swahili intro, and signatories
  // Never hangs: canvas errors reject, and a slow/unreachable logo gives up after 5 s.
  function imgToDataURL(url) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      const timer = setTimeout(() => reject(new Error('Logo timed out')), 5000);
      img.crossOrigin = 'anonymous';
      img.onload = function () {
        clearTimeout(timer);
        try {
          const c = document.createElement('canvas');
          c.width = img.naturalWidth || img.width; c.height = img.naturalHeight || img.height;
          c.getContext('2d').drawImage(img, 0, 0);
          resolve(c.toDataURL('image/png'));
        } catch (err) { reject(err); }
      };
      img.onerror = () => { clearTimeout(timer); reject(new Error('Logo failed to load')); };
      img.src = url;
    });
  }

  // PDF engines load with `defer`; wait for them (max 15 s) instead of silently doing nothing.
  async function pdfEnginesReady() {
    const t0 = Date.now();
    while (!(window.jspdf?.jsPDF && window.jspdf.jsPDF.API?.autoTable && window.GradReportPdf)) {
      if (Date.now() - t0 > 15000) throw new Error('PDF tools did not load. Check the internet connection and refresh the page.');
      await new Promise((r) => setTimeout(r, 150));
    }
  }
  async function runPdfJob(label, job) {
    showToast(`Preparing ${label} PDF…`, 'info', 3000);
    try {
      await pdfEnginesReady();
      await job();
      showToast(`${label} PDF downloaded.`, 'success');
    } catch (err) {
      console.error(err);
      showToast(`${label} PDF failed: ${err?.message || err}`, 'error', 8000);
    }
  }
  function downloadPdf(type) {
    const labels = { students: 'Student ledger', unpaid: 'Debts', paid: 'Payments', expenses: 'Expenses', audit: 'Full report' };
    if (type === 'expenses') return exportExpensesPDF();
    return runPdfJob(labels[type] || 'Graduation', () => (type === 'audit' ? generateAuditPDF() : downloadLedgerPdf(type)));
  }

  // ---------- BEAUTIFUL REPORT PDFS (js/grad_report_pdf.js) ----------
  async function reportContext(title, orientation = 'p') {
    const K = window.GradReportPdf;
    if (!K) throw new Error('Report designer failed to load. Refresh the page.');
    const brand = await loadSchoolBrand();
    let logoData = '';
    for (const src of [brand.logoUrl, '../images/somap-logo.png', '../images/somap-logo.png.jpg'].filter(Boolean)) {
      try { logoData = await imgToDataURL(src); break; } catch (_) { /* try next */ }
    }
    return K.start({ orientation, school: brand, title, year: getSelectedYear(), logoData });
  }
  const pdfFileBase = () => (state.schoolBrand?.name || 'School').replace(/[^\w\s-]+/g, ' ').trim().replace(/\s+/g, '_');
  const byClassThenName = (a, b) => {
    const ia = CLASS_ORDER.indexOf(normalizeClassName(a.className || a.class));
    const ib = CLASS_ORDER.indexOf(normalizeClassName(b.className || b.class));
    return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib) || toStr(a.name).localeCompare(toStr(b.name));
  };
  function ledgerRows(list) {
    return list.map((s) => {
      const expected = getExpectedFee(s); const paid = getPaidTotal(s); const balance = getBalance(s);
      return { name: toStr(s.name), className: toStr(s.class), expected, paid, balance, status: computeStatus(s).toUpperCase(), adm: toStr(s.admissionNo), parent: toStr(s.parentPhone) };
    }).sort(byClassThenName);
  }
  function sumOf(rows, key) { return rows.reduce((a, r) => a + (Number(r[key]) || 0), 0); }


  async function downloadLedgerPdf(type) {
    const K = window.GradReportPdf;
    const year = getSelectedYear();
    if (type === 'students') {
      const rows = ledgerRows(getValidStudents());
      const ctx = await reportContext('Graduation Student Ledger');
      K.header(ctx, { title: 'Graduation Student Ledger', subtitle: `Every learner's graduation contribution for ${year}, sorted by class.`, compact: false });
      const expected = sumOf(rows, 'expected'); const paid = sumOf(rows, 'paid'); const balance = sumOf(rows, 'balance');
      K.cards(ctx, [
        { label: 'Learners', value: rows.length, sub: `${rows.filter((r) => r.status === 'PAID').length} fully paid`, tone: 'navy' },
        { label: 'Expected', value: K.tsh(expected), tone: 'amber' },
        { label: 'Collected', value: K.tsh(paid), sub: 'Graduation payments only', tone: 'emerald' },
        { label: 'Balance', value: K.tsh(balance), tone: 'rose' },
        { label: 'Partial', value: rows.filter((r) => r.status === 'PARTIAL').length, sub: 'Paid something, still owe', tone: 'amber' },
        { label: 'Not paid / debt', value: rows.filter((r) => r.status === 'UNPAID' || r.status === 'DEBT').length, tone: 'rose' },
      ]);
      K.progress(ctx, { label: 'Collection progress', value: paid, max: expected, note: `${K.tsh(paid)} of ${K.tsh(expected)} collected` });
      K.section(ctx, 'Learners', { tone: 'navy', sub: 'Name first · admission number at the end' });
      K.table(ctx, {
        tone: 'navy', rows,
        columns: [{ header: 'Learner', key: 'name', kind: 'name' }, { header: 'Class', key: 'className', width: 62 }, { header: 'Expected', key: 'expected', kind: 'money', width: 62 }, { header: 'Paid', key: 'paid', kind: 'money', width: 62 }, { header: 'Balance', key: 'balance', kind: 'money', width: 62 }, { header: 'Status', key: 'status', kind: 'status', width: 54 }, { header: 'Adm', key: 'adm', kind: 'muted', width: 56 }],
        totals: { name: 'TOTAL', expected, paid, balance },
      });
      K.finish(ctx, `${pdfFileBase()}_Graduation_Ledger_${year}.pdf`);
      return;
    }
    if (type === 'unpaid') {
      const all = getValidStudents();
      const paidNames = new Set(all.filter((s) => !hasOutstanding(s)).map((s) => toStr(s.name).trim().toLowerCase()));
      const rows = ledgerRows(all.filter((s) => hasOutstanding(s) && !paidNames.has(toStr(s.name).trim().toLowerCase()))).sort((a, b) => b.balance - a.balance);
      const ctx = await reportContext('Graduation Debts Follow-up');
      K.header(ctx, { title: 'Graduation Debts Follow-up', subtitle: 'Learners with a balance, largest balance first, with the parent contact for each call.' });
      const owed = sumOf(rows, 'balance');
      const classes = new Set(rows.map((r) => r.className));
      K.cards(ctx, [
        { label: 'Learners owing', value: rows.length, tone: 'rose' },
        { label: 'Total owed', value: K.tsh(owed), tone: 'rose' },
        { label: 'Classes affected', value: classes.size, tone: 'amber' },
        { label: 'Largest balance', value: rows[0] ? K.tsh(rows[0].balance) : '—', sub: rows[0]?.name || '', tone: 'amber' },
        { label: 'Average balance', value: rows.length ? K.tsh(owed / rows.length) : '—', tone: 'slate' },
        { label: 'Already paid by them', value: K.tsh(sumOf(rows, 'paid')), tone: 'emerald' },
      ]);
      K.section(ctx, 'Learners with a balance', { tone: 'rose' });
      K.table(ctx, {
        tone: 'rose', rows,
        columns: [{ header: 'Learner', key: 'name', kind: 'name' }, { header: 'Class', key: 'className', width: 58 }, { header: 'Parent', key: 'parent', width: 78 }, { header: 'Paid', key: 'paid', kind: 'money', width: 58 }, { header: 'Balance', key: 'balance', kind: 'money', width: 62 }, { header: 'Status', key: 'status', kind: 'status', width: 52 }, { header: 'Adm', key: 'adm', kind: 'muted', width: 52 }],
        totals: { name: 'TOTAL OWED', paid: sumOf(rows, 'paid'), balance: owed },
      });
      K.finish(ctx, `${pdfFileBase()}_Graduation_Debts_${year}.pdf`);
      return;
    }
    if (type === 'paid') {
      const rows = getVisiblePayments().map((p) => {
        const s = state.students?.[sanitizeKey(p.admissionNo)] || {};
        const when = Number(p.createdAt || p.timestamp || 0);
        return { name: toStr(s.name) || '--', className: toStr(s.class), amount: toNumberSafe(p.amount), method: toStr(p.method) || '—', by: toStr(p.recordedBy).split('@')[0] || '—', when: when ? new Date(when).toLocaleDateString('en-GB') : '—', ts: when, adm: toStr(p.admissionNo) };
      }).sort((a, b) => b.ts - a.ts);
      const ctx = await reportContext('Graduation Payments Received');
      K.header(ctx, { title: 'Graduation Payments Received', subtitle: 'Every recorded graduation payment, newest first.' });
      const total = sumOf(rows, 'amount');
      const methods = rows.reduce((m, r) => { m[r.method] = (m[r.method] || 0) + 1; return m; }, {});
      const topMethod = Object.entries(methods).sort((a, b) => b[1] - a[1])[0];
      K.cards(ctx, [
        { label: 'Payments', value: rows.length, tone: 'navy' },
        { label: 'Total received', value: K.tsh(total), tone: 'emerald' },
        { label: 'Average payment', value: rows.length ? K.tsh(total / rows.length) : '—', tone: 'blue' },
        { label: 'Most used method', value: topMethod ? topMethod[0] : '—', sub: topMethod ? `${topMethod[1]} payments` : '', tone: 'violet', big: false },
        { label: 'Latest payment', value: rows[0]?.when || '—', sub: rows[0]?.name || '', tone: 'slate', big: false },
        { label: 'Families who paid', value: new Set(rows.map((r) => r.adm)).size, tone: 'emerald' },
      ]);
      K.section(ctx, 'Payments', { tone: 'emerald' });
      K.table(ctx, {
        tone: 'emerald', rows,
        columns: [{ header: 'Learner', key: 'name', kind: 'name' }, { header: 'Class', key: 'className', width: 58 }, { header: 'Amount', key: 'amount', kind: 'money', width: 64 }, { header: 'Method', key: 'method', width: 60 }, { header: 'Recorded by', key: 'by', width: 74 }, { header: 'Date', key: 'when', width: 58 }, { header: 'Adm', key: 'adm', kind: 'muted', width: 50 }],
        totals: { name: 'TOTAL', amount: total },
      });
      K.finish(ctx, `${pdfFileBase()}_Graduation_Payments_${year}.pdf`);
      return;
    }
    showToast(`Unknown export type: ${type}`, 'error');
  }

  async function exportExpensesPDF(event) {
    if (event) { event.preventDefault(); event.stopImmediatePropagation(); }
    return runPdfJob('Expenses', buildExpensesPdf);
  }
  async function buildExpensesPdf() {
    {
      const K = window.GradReportPdf;
      const y = getSelectedYear();
      const list = (await loadGradExpenses(y)).map((e) => ({ ...e, proofLabel: e.proofUrl ? 'Yes' : 'No' })).sort((a, b) => b.total - a.total);
      if (!list.length) throw new Error('No expenses recorded for this year yet.');
      const total = list.reduce((a, b) => a + (Number(b.total) || 0), 0); // fixed: was summing a field that does not exist
      const vendors = new Set(list.map((e) => toStr(e.seller).trim().toLowerCase()).filter((v) => v && v !== '-'));
      const withProof = list.filter((e) => e.proofUrl).length;
      const ctx = await reportContext('Graduation Expenses');
      K.header(ctx, { title: 'Graduation Expenses', subtitle: 'Every graduation purchase, biggest first, with seller and proof status.' });
      K.cards(ctx, [
        { label: 'Total spent', value: K.tsh(total), tone: 'rose' },
        { label: 'Items bought', value: list.length, tone: 'navy' },
        { label: 'Sellers', value: vendors.size, tone: 'violet' },
        { label: 'Biggest expense', value: K.tsh(list[0].total), sub: list[0].item, tone: 'amber' },
        { label: 'Average item', value: K.tsh(total / list.length), tone: 'slate' },
        { label: 'Proof attached', value: `${withProof} of ${list.length}`, sub: withProof < list.length ? 'Attach missing receipts' : 'All receipts attached', tone: withProof < list.length ? 'amber' : 'emerald' },
      ]);
      K.progress(ctx, { label: 'Receipts attached', value: withProof, max: list.length, tone: withProof < list.length ? 'amber' : 'emerald' });
      K.section(ctx, 'Expenses', { tone: 'blue' });
      K.table(ctx, {
        tone: 'blue', rows: list,
        columns: [{ header: 'Item', key: 'item', kind: 'name' }, { header: 'Seller', key: 'seller', width: 82 }, { header: 'Contact', key: 'contact', kind: 'muted', width: 62 }, { header: 'Qty', key: 'quantity', kind: 'num', width: 30 }, { header: 'Each', key: 'priceEach', kind: 'money', width: 56 }, { header: 'Total', key: 'total', kind: 'money', width: 62 }, { header: 'Proof', key: 'proofLabel', kind: 'status', width: 38 }],
        totals: { item: 'TOTAL', total },
      });
      K.finish(ctx, `${pdfFileBase()}_Graduation_Expenses_${y}.pdf`);
    }
  }

  // Full graduation report: cover with summary, then donations, paid, partial, unpaid, expenses, signatures.
  async function generateAuditPDF() {
    const K = window.GradReportPdf;
    const year = getSelectedYear();
    const [students, expenses, donations] = await Promise.all([loadGradLedger(year), loadGradExpenses(year), loadGradDonations(year)]);
    const { paid, partial, unpaid } = partitionStudents(students);
    const totalExpected = students.reduce((a, b) => a + toNumberSafe(b.expected), 0);
    const totalPaid = students.reduce((a, b) => a + toNumberSafe(b.paid), 0);
    const donationTotal = donations.total || 0;
    const totalCollected = totalPaid + donationTotal;
    const totalUncol = Math.max(0, totalExpected - totalCollected);
    const totalExp = expenses.reduce((a, b) => a + (Number(b.total) || Number(b.amount) || 0), 0);
    const netBalance = totalCollected - totalExp;

    const ctx = await reportContext('Graduation Full Report');
    K.header(ctx, { title: 'Graduation Full Report', subtitle: 'Ripoti ya Ukaguzi wa Graduation: makusanyo, michango, matumizi na madeni.' });
    K.cards(ctx, [
      { label: 'Expected', value: K.tsh(totalExpected), sub: `${students.length} learners`, tone: 'amber' },
      { label: 'Payments collected', value: K.tsh(totalPaid), tone: 'emerald' },
      { label: 'Donations', value: K.tsh(donationTotal), sub: `${donations.list.length} donations`, tone: 'violet' },
      { label: 'Collected incl. donations', value: K.tsh(totalCollected), tone: 'emerald' },
      { label: 'Still uncollected', value: K.tsh(totalUncol), tone: 'rose' },
      { label: 'Expenses', value: K.tsh(totalExp), sub: `${expenses.length} items`, tone: 'blue' },
      { label: 'Net balance', value: K.tsh(netBalance), sub: 'Collected minus expenses', tone: netBalance >= 0 ? 'emerald' : 'rose' },
      { label: 'Paid · partial', value: `${paid.length} · ${partial.length}`, sub: 'Learners', tone: 'navy', big: false },
      { label: 'Not yet paid', value: unpaid.length, sub: 'Learners', tone: 'rose' },
    ]);
    K.progress(ctx, { label: 'Collection progress (incl. donations)', value: totalCollected, max: totalExpected, tone: 'emerald', note: `${K.tsh(totalCollected)} of ${K.tsh(totalExpected)}` });
    K.progress(ctx, { label: 'Money spent so far', value: totalExp, max: totalCollected, tone: totalExp > totalCollected ? 'rose' : 'blue', note: `${K.tsh(totalExp)} of ${K.tsh(totalCollected)} collected` });
    K.paragraph(ctx, [
      'Kwenye ripoti hii, tunawasilisha tathmini ya makusanyo yote ya ada za graduation kwa mwaka huu.',
      'Ripoti imeainisha kiasi kilichotarajiwa, kiasi kilicholipwa, na salio linalodaiwa na kila mwanafunzi.',
      'Takwimu zimechambuliwa kulingana na madarasa na hadhi ya malipo ili kuwezesha ufuatiliaji sahihi.',
      'Tunalenga kusaidia kamati ya shule kupanga maamuzi thabiti kuhusu ukamilishaji wa malipo.',
      'Vyanzo vya data ni sajili za wanafunzi, leja ya graduation, na stakabadhi zinazohusiana.',
      'Uongozi wa shule umetumia tahadhari kuhakikisha usahihi na uadilifu wa taarifa zote zilizowasilishwa.',
    ].join(' '), { size: 9, font: 'times', style: 'italic' });

    const studentCols = [{ header: 'Learner', key: 'name', kind: 'name' }, { header: 'Class', key: 'className', width: 60 }, { header: 'Parent', key: 'parent', width: 80 }, { header: 'Expected', key: 'expected', kind: 'money', width: 60 }, { header: 'Paid', key: 'paid', kind: 'money', width: 60 }, { header: 'Adm', key: 'admission', kind: 'muted', width: 52 }];
    const sortRows = (rows) => rows.slice().sort(byClassThenName);

    K.section(ctx, 'Donations · Michango', { tone: 'violet', newPage: true, sub: `${donations.list.length} donations · ${K.tsh(donationTotal)}` });
    if (donations.list.length) {
      K.table(ctx, { tone: 'violet', rows: donations.list.map((d) => ({ ...d, amount: toNumberSafe(d.amount) })), columns: [{ header: 'Donor', key: 'donorName', kind: 'name' }, { header: 'Contact', key: 'donorContact', width: 86 }, { header: 'Amount', key: 'amount', kind: 'money', width: 70 }, { header: 'Date', key: 'recordedAt', width: 96 }, { header: 'Proof note', key: 'proofNote', kind: 'muted' }], totals: { donorName: 'TOTAL', amount: donationTotal } });
    } else K.paragraph(ctx, 'No donations recorded for this year.');

    K.section(ctx, 'Paid in full · Waliolipa kikamilifu', { tone: 'emerald', sub: `${paid.length} learners · ${K.tsh(paid.reduce((a, s) => a + s.paid, 0))}` });
    if (paid.length) K.table(ctx, { tone: 'emerald', rows: sortRows(paid), columns: studentCols, totals: { name: 'TOTAL', expected: paid.reduce((a, s) => a + s.expected, 0), paid: paid.reduce((a, s) => a + s.paid, 0) } });
    else K.paragraph(ctx, 'No learner has paid in full yet.');

    K.section(ctx, 'Partial payments · Waliolipa sehemu', { tone: 'amber', sub: `${partial.length} learners · balance ${K.tsh(partial.reduce((a, s) => a + Math.max(0, s.expected - s.paid), 0))}` });
    if (partial.length) K.table(ctx, { tone: 'amber', rows: sortRows(partial), columns: studentCols, totals: { name: 'TOTAL', expected: partial.reduce((a, s) => a + s.expected, 0), paid: partial.reduce((a, s) => a + s.paid, 0) } });
    else K.paragraph(ctx, 'No partial payments.');

    K.section(ctx, 'Not yet paid · Hawajalipa', { tone: 'rose', sub: `${unpaid.length} learners · ${K.tsh(unpaid.reduce((a, s) => a + s.expected, 0))} expected` });
    if (unpaid.length) K.table(ctx, { tone: 'rose', rows: sortRows(unpaid), columns: studentCols, totals: { name: 'TOTAL', expected: unpaid.reduce((a, s) => a + s.expected, 0), paid: 0 } });
    else K.paragraph(ctx, 'Every learner has paid something. Well done.');

    K.section(ctx, 'Expenses · Matumizi', { tone: 'blue', sub: `${expenses.length} items · ${K.tsh(totalExp)}` });
    if (expenses.length) K.table(ctx, { tone: 'blue', rows: expenses.slice().sort((a, b) => b.total - a.total).map((e) => ({ ...e, proofLabel: e.proofUrl ? 'Yes' : 'No' })), columns: [{ header: 'Item', key: 'item', kind: 'name' }, { header: 'Seller', key: 'seller', width: 82 }, { header: 'Qty', key: 'quantity', kind: 'num', width: 30 }, { header: 'Each', key: 'priceEach', kind: 'money', width: 58 }, { header: 'Total', key: 'total', kind: 'money', width: 64 }, { header: 'Proof', key: 'proofLabel', kind: 'status', width: 40 }, { header: 'By', key: 'recordedBy', kind: 'muted', width: 70 }], totals: { item: 'TOTAL', total: totalExp } });
    else K.paragraph(ctx, 'No expenses recorded.');

    K.section(ctx, 'Muhtasari wa Takwimu', { tone: 'navy', newPage: true });
    K.cards(ctx, [
      { label: 'Wote (halali)', value: students.length, tone: 'navy' },
      { label: 'Walilipa kikamilifu', value: `${paid.length}`, sub: K.tsh(paid.reduce((a, s) => a + s.paid, 0)), tone: 'emerald' },
      { label: 'Wenye madeni / salio', value: `${unpaid.length + partial.length}`, sub: K.tsh(totalUncol), tone: 'rose' },
      { label: 'Jumla matumizi', value: K.tsh(totalExp), tone: 'blue' },
      { label: 'Michango', value: K.tsh(donationTotal), tone: 'violet' },
      { label: 'Mlinganyo wa mwisho', value: K.tsh(netBalance), sub: 'Makusanyo ukitoa matumizi', tone: netBalance >= 0 ? 'emerald' : 'rose' },
    ]);
    K.section(ctx, 'Saini za Uidhinishaji', { tone: 'slate' });
    K.signatures(ctx, ['Mkuu wa Shule', 'Mwalimu wa Taaluma', 'Kiongozi wa Bajeti ya Graduation', 'Mwenyekiti wa Kamati', 'Mjumbe wa Kamati 1', 'Mjumbe wa Kamati 2', 'Mjumbe wa Kamati 3']);
    K.finish(ctx, `${pdfFileBase()}_Graduation_Report_${year}.pdf`);
  }

  // Override exports for expenses & audit with secure handlers
  const expenseCsvButtons = document.querySelectorAll('#btnExpCSV, button[data-export="expenses"][data-format="csv"]');
  expenseCsvButtons.forEach((btn) => btn.addEventListener('click', exportExpensesCSV));

  const expensePdfButtons = document.querySelectorAll('#btnExpPDF, button[data-export="expenses"][data-format="pdf"]');
  expensePdfButtons.forEach((btn) => btn.addEventListener('click', exportExpensesPDF));

  const auditCsvButtons = document.querySelectorAll('#btnAuditCSV, button[data-export="audit"][data-format="csv"]');
  auditCsvButtons.forEach((btn) => btn.addEventListener('click', exportAuditCSV));

  const auditPdfButtons = document.querySelectorAll('#btnAuditPDF, button[data-export="audit"][data-format="pdf"]');
  auditPdfButtons.forEach((btn) => btn.addEventListener('click', exportAuditPDF));

  function handleExport(type, format) {
    if (format === 'csv') {
      downloadCsv(type);
    } else if (format === 'pdf') {
      downloadPdf(type);
    } else {
      showToast(`Unsupported export format: ${format}`, 'error');
    }
  }

  function downloadCsv(type) {
    let headers = [];
    let rows = [];
    if (type === 'students') {
      headers = ['Admission', 'Name', 'Class', 'Expected', 'Paid', 'Balance', 'Status', 'Parent Phone'];
      rows = getValidStudents().map((student) => {
        const expected = getExpectedFee(student);
        const paid = getPaidTotal(student);
        const balance = getBalance(student);
        return [
          toStr(student.admissionNo),
          toStr(student.name),
          toStr(student.class),
          expected,
          paid,
          balance,
          computeStatus(student),
          toStr(student.parentPhone),
        ];
      });
    } else if (type === 'paid') {
      headers = ['Admission', 'Name', 'Amount', 'Method', 'Recorded By', 'Timestamp'];
      rows = getVisiblePayments().map((payment) => [
        toStr(payment.admissionNo),
        state.students?.[sanitizeKey(payment.admissionNo)]?.name || '--',
        Number(payment.amount || 0),
        toStr(payment.method),
        toStr(payment.recordedBy),
        new Date(Number(payment.createdAt || payment.timestamp || Date.now())).toISOString(),
      ]);
    } else if (type === 'unpaid') {
      headers = ['Admission', 'Name', 'Class', 'Expected', 'Paid', 'Balance', 'Status', 'Parent Phone'];
      const allStudents = getValidStudents();
      // Fix: If a student appears twice (once paid, once unpaid/debt), exclude the debt record.
      const paidNames = new Set(allStudents.filter(s => !hasOutstanding(s)).map(s => toStr(s.name).trim().toLowerCase()));
      
      rows = allStudents.filter((student) => {
        if (!hasOutstanding(student)) return false;
        // If this student has debt, but the same name exists as fully paid/cleared, treat this as a duplicate ghost record
        const name = toStr(student.name).trim().toLowerCase();
        if (paidNames.has(name)) return false;
        return true;
      }).map((student) => {
        const expected = getExpectedFee(student);
        const paid = getPaidTotal(student);
        const balance = getBalance(student);
        return [
          toStr(student.admissionNo),
          toStr(student.name),
          toStr(student.class),
          expected,
          paid,
          balance,
          computeStatus(student),
          toStr(student.parentPhone),
        ];
      });
    } else if (type === 'expenses') {
      headers = ['Item', 'Seller', 'Phone', 'Qty', 'Price Each', 'Total', 'Recorded By', 'Timestamp', 'Proof'];
      rows = Object.values(state.expenses || {}).map((expense) => [
        toStr(expense.item),
        toStr(expense.seller),
        toStr(expense.sellerPhone),
        Number(expense.quantity || 0),
        Number(expense.priceEach || 0),
        Number(expense.total || (Number(expense.priceEach || 0) * Number(expense.quantity || 0))),
        toStr(expense.recordedBy),
        new Date(Number(expense.createdAt || Date.now())).toISOString(),
        toStr(expense.proofUrl),
      ]);
    } else if (type === 'audit') {
      headers = ['Timestamp', 'Actor', 'Action', 'Ref', 'Details'];
      rows = Object.values(state.audits || {}).map((entry) => [
        new Date(Number(entry.at || Date.now())).toISOString(),
        toStr(entry.actor),
        toStr(entry.action),
        `${toStr(entry.refType)}  -  ${toStr(entry.refId)}`,
        JSON.stringify(entry.after || {}),
      ]);
    } else {
      showToast(`Unknown export type: ${type}`, 'error');
      return;
    }

    const lines = [headers.join(',')].concat(rows.map((row) => row.map((cell) => {
      const text = toStr(cell);
      if (/[,"\n]/.test(text)) return '"' + text.replace(/"/g, '""') + '"';
      return text;
    }).join(',')));

    const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `graduation_${state.currentYear}_${type}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }


  // ---------- CERTIFICATE GENERATION ----------
  // School branding for certificates: each school's own profile; Socrates keeps its long-standing wording.
  async function loadSchoolBrand() {
    const schoolId = getCurrentSchoolId();
    if (state.schoolBrand && state.schoolBrand.id === schoolId) return state.schoolBrand;
    let profile = {};
    try {
      const snap = await db().ref(schoolPath('profile')).once('value');
      profile = snap.val() || {};
    } catch (err) {
      console.warn('School profile read failed', err?.message || err);
    }
    const isSocrates = schoolId === 'socrates-school';
    const contextName = toStr(window.SOMAP?.getSchool?.()?.name);
    const name = toStr(profile.name || profile.schoolName || contextName || (isSocrates ? 'Socrates School' : schoolId)).trim();
    const tagline = toStr(profile.motto || profile.tagline || profile.schoolType || (isSocrates ? 'English Medium Pre & Primary School' : '')).trim();
    const phones = [profile.phone || profile.phoneNumber, profile.phone2 || profile.altPhone].filter(Boolean).join(' / ');
    const address = toStr(profile.poBox || profile.address || profile.location).trim();
    const contact = isSocrates && !address && !phones
      ? 'P.O. Box 14256 · 0686 828 732 / 0689 649 822'
      : [address, phones].filter(Boolean).join(' · ');
    state.schoolBrand = { id: schoolId, name, tagline, contact, logoUrl: toStr(profile.logoUrl).trim() };
    return state.schoolBrand;
  }

  async function lookupStudentPhoto(admissionNo) {
    const adm = toStr(admissionNo).trim();
    if (!adm) return '';
    const pick = (s) => toStr(s?.passportPhotoUrl || s?.passportPhotoURL || s?.photoUrl || s?.photo || s?.passportUrl).trim();
    // Only this school's students (Socrates also has the legacy root list).
    const bases = [schoolPath('students')];
    if (getCurrentSchoolId() === 'socrates-school') bases.push('students');
    for (const base of bases) {
      try {
        const direct = await db().ref(`${base}/${sanitizeKey(adm)}`).once('value');
        if (pick(direct.val())) return pick(direct.val());
        const snap = await db().ref(base).orderByChild('admissionNumber').equalTo(adm).limitToFirst(1).once('value');
        const found = Object.values(snap.val() || {})[0];
        if (pick(found)) return pick(found);
      } catch (err) {
        console.warn('Photo lookup failed', base, err?.message || err);
      }
    }
    return '';
  }

  async function buildCertificateData(student) {
    const adm = sanitizeKey(student.admissionNo);
    const photoUrl = student.photoUrl || await lookupStudentPhoto(student.admissionNo);
    const school = await loadSchoolBrand();
    const year = Number(state.currentYear);
    return {
      kind: certificateKind(student),
      name: toStr(student.name),
      className: normalizeClassName(student.class) || toStr(student.class),
      admissionNo: toStr(student.admissionNo),
      year,
      issuedDate: new Date(),
      photoUrl,
      school,
      pulledUp: isPulledUp(student) && !student.isGraduand,
      serial: `G${String(year).slice(-2)}-${adm}`.toUpperCase(),
    };
  }

  function ensureRenderSandbox() {
    let sandbox = document.getElementById('renderSandbox');
    if (!sandbox) {
      sandbox = document.createElement('div');
      sandbox.id = 'renderSandbox';
      sandbox.style.cssText = 'position:fixed;left:-10000px;top:-10000px;pointer-events:none;';
      document.body.appendChild(sandbox);
    }
    return sandbox;
  }

  let fontWarningShown = false;
  // Render a student's certificate into `host` (DOM node, not rasterised).
  async function renderCertificateNode(student, host) {
    const designs = window.GradCertDesigns;
    if (!designs) throw new Error('Certificate designs failed to load. Refresh the page.');
    const data = await buildCertificateData(student);
    const result = await designs.render(host, data);
    if (result.missingFonts.length && !fontWarningShown) {
      fontWarningShown = true;
      showToast(`Some certificate fonts did not load (${result.missingFonts.join(', ')}). Check internet and retry for best quality.`, 'warn', 7000);
    }
    return { ...result, data };
  }

  function certificateFileName(student) {
    const base = toStr(student.name).replace(/[^\w\s-]+/g, ' ').trim().replace(/\s+/g, '_') || sanitizeKey(student.admissionNo);
    return `${base}_Graduation_${state.currentYear}.pdf`;
  }

  function newCertificatePdf() {
    if (!window.jspdf?.jsPDF) throw new Error('jsPDF is required for certificate generation');
    return new window.jspdf.jsPDF({ orientation: 'landscape', unit: 'pt', format: 'a4', compress: true });
  }

  function addCanvasPage(pdf, canvas, isFirst) {
    if (!isFirst) pdf.addPage('a4', 'landscape');
    const w = pdf.internal.pageSize.getWidth();
    const h = pdf.internal.pageSize.getHeight();
    pdf.addImage(canvas.toDataURL('image/jpeg', 0.93), 'JPEG', 0, 0, w, h, undefined, 'FAST');
  }

  function downloadBlob(blob, fileName) {
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = fileName;
    link.style.display = 'none';
    document.body.appendChild(link);
    link.click();
    setTimeout(() => { URL.revokeObjectURL(url); link.remove(); }, 1500);
  }

  function previewBlobFromCanvas(canvas) {
    const small = document.createElement('canvas');
    small.width = 1123;
    small.height = Math.round((1123 * canvas.height) / canvas.width);
    small.getContext('2d').drawImage(canvas, 0, 0, small.width, small.height);
    return new Promise((resolve) => small.toBlob((blob) => resolve(blob), 'image/png'));
  }

  async function generateCertificate(admissionNoRaw, options = {}) {
    const { triggerDownload = false, upload = true } = options;
    const admissionNo = sanitizeKey(admissionNoRaw);
    const student = state.students?.[admissionNo];
    if (!student) throw new Error('Student not found');
    if (!isCertificateGraduand(student)) throw new Error('Certificates available only for graduands');

    const sandbox = ensureRenderSandbox();
    const { node } = await renderCertificateNode(student, sandbox);
    const canvas = await window.GradCertDesigns.toCanvas(node);
    sandbox.innerHTML = '';

    const pdf = newCertificatePdf();
    addCanvasPage(pdf, canvas, true);
    const pdfBlob = pdf.output('blob');
    if (triggerDownload) downloadBlob(pdfBlob, certificateFileName(student));
    if (!upload || state.readOnly) return { pdfBlob };

    const year = state.currentYear;
    const base = gradPath(year, `certificates/${admissionNo}`);
    const pdfRef = storage().ref(`${base}.pdf`);
    const pngRef = storage().ref(`${base}.png`);

    await pdfRef.put(pdfBlob, { contentType: 'application/pdf' });
    let urlPreview = null;
    try {
      const previewBlob = await previewBlobFromCanvas(canvas);
      if (previewBlob) {
        await pngRef.put(previewBlob, { contentType: 'image/png' });
        urlPreview = await pngRef.getDownloadURL();
      }
    } catch (err) {
      console.warn('Certificate preview upload skipped', err?.message || err);
    }

    const urlPdf = await pdfRef.getDownloadURL();

    await db().ref(gradPath(year, `certificates/${admissionNo}`)).set({
      urlPdf,
      urlPreview,
      design: certificateKind(student),
      generatedAt: firebase.database.ServerValue.TIMESTAMP,
      generatedBy: state.user?.email || 'unknown',
    });

    await db().ref(gradPath(year, 'audits')).push({
      actor: state.user?.email || 'unknown',
      action: 'certificate:generate',
      refType: 'certificate',
      refId: admissionNo,
      after: { urlPdf },
      at: firebase.database.ServerValue.TIMESTAMP,
    });
    return { pdfBlob, urlPdf };
  }

  // ---------- progress overlay (certificates page) ----------
  const certJob = { cancelled: false, running: false };
  function setCertProgress(done, total, label) {
    const box = document.getElementById('certProgress');
    if (!box) return;
    if (total == null) { box.classList.remove('show'); return; }
    box.classList.add('show');
    const pct = total ? Math.round((done / total) * 100) : 0;
    const bar = box.querySelector('[data-progress-bar]');
    const text = box.querySelector('[data-progress-text]');
    const sub = box.querySelector('[data-progress-sub]');
    if (bar) bar.style.width = `${pct}%`;
    if (text) text.textContent = `${done} / ${total}`;
    if (sub) sub.textContent = label || '';
  }

  const yieldToBrowser = () => new Promise((resolve) => setTimeout(resolve, 30));

  // One multi-page PDF for a group (all / preunit / class7 / pulled). Download only, nothing is overwritten.
  async function downloadCertificateBundle(group = 'all') {
    if (certJob.running) { showToast('A certificate job is already running.', 'warn'); return; }
    const roster = getCertificateRoster().filter((s) => {
      if (group === 'preunit') return certificateKind(s) === 'preunit';
      if (group === 'class7') return certificateKind(s) === 'class7';
      if (group === 'pulled') return isPulledUp(s);
      return true;
    });
    if (!roster.length) { showToast('No graduands in this group.', 'warn'); return; }
    certJob.running = true;
    certJob.cancelled = false;
    const sandbox = ensureRenderSandbox();
    const pdf = newCertificatePdf();
    let pages = 0;
    const failed = [];
    try {
      for (let i = 0; i < roster.length; i += 1) {
        if (certJob.cancelled) break;
        const student = roster[i];
        setCertProgress(i, roster.length, `Designing ${student.name}…`);
        try {
          const { node } = await renderCertificateNode(student, sandbox);
          const canvas = await window.GradCertDesigns.toCanvas(node);
          addCanvasPage(pdf, canvas, pages === 0);
          pages += 1;
          canvas.width = 0; canvas.height = 0; // release memory early
        } catch (err) {
          console.warn('Bundle certificate failed', student.admissionNo, err);
          failed.push(student.name);
        }
        sandbox.innerHTML = '';
        await yieldToBrowser();
      }
      if (pages && !certJob.cancelled) {
        setCertProgress(roster.length, roster.length, 'Packing the PDF…');
        await yieldToBrowser();
        const label = { all: 'All', preunit: 'PreUnit', class7: 'Class7', pulled: 'PulledUp' }[group] || 'All';
        downloadBlob(pdf.output('blob'), `Graduation_Certificates_${label}_${state.currentYear}.pdf`);
        showToast(`${pages} certificate${pages > 1 ? 's' : ''} ready.${failed.length ? ` Failed: ${failed.join(', ')}` : ''}`, failed.length ? 'warn' : 'success', 6000);
      } else if (certJob.cancelled) {
        showToast('Bundle cancelled.', 'warn');
      }
    } finally {
      certJob.running = false;
      setCertProgress(null, null);
    }
  }

  async function generateAllCertificates() {
    if (!window.GradCertDesigns || state.readOnly) return; // only on the certificates page, staff only
    const graduands = getCertificateRoster().filter((s) => !state.certificates?.[sanitizeKey(s.admissionNo)]?.urlPdf);
    if (!graduands.length) {
      showToast('All graduand certificates are already saved.', 'success');
      return;
    }
    if (certJob.running) { showToast('A certificate job is already running.', 'warn'); return; }
    certJob.running = true;
    certJob.cancelled = false;
    let saved = 0;
    try {
      for (let i = 0; i < graduands.length; i += 1) {
        if (certJob.cancelled) break;
        const s = graduands[i];
        setCertProgress(i, graduands.length, `Saving ${s.name}…`);
        try {
          await generateCertificate(sanitizeKey(s.admissionNo));
          saved += 1;
        } catch (err) {
          console.warn('Certificate generation failed for', s.admissionNo, err?.message || err);
        }
        await yieldToBrowser();
      }
      if (document.getElementById('certProgress')) showToast(`${saved} certificate${saved === 1 ? '' : 's'} saved.`, 'success');
    } finally {
      certJob.running = false;
      setCertProgress(null, null);
    }
  }

  // ---------- preview modal ----------
  async function previewCertificate(admissionNo) {
    const modal = document.getElementById('certPreviewModal');
    const stage = document.getElementById('certPreviewStage');
    const student = state.students?.[sanitizeKey(admissionNo)];
    if (!modal || !stage || !student) return;
    modal.classList.add('show');
    modal.dataset.adm = sanitizeKey(admissionNo);
    const title = document.getElementById('certPreviewTitle');
    if (title) title.textContent = `${student.name} · ${student.class}`;
    stage.innerHTML = '<div class="preview-loading"><span class="spinner"></span>Designing certificate…</div>';
    const holder = document.createElement('div');
    holder.style.cssText = 'position:fixed;left:-10000px;top:0;';
    document.body.appendChild(holder);
    try {
      await renderCertificateNode(student, holder);
      const node = holder.firstElementChild;
      if (modal.dataset.adm !== sanitizeKey(admissionNo)) return; // another preview was opened meanwhile
      const host = document.createElement('div');
      host.className = 'preview-host';
      host.appendChild(node);
      stage.innerHTML = '';
      stage.appendChild(host);
      const fit = () => {
        const scale = Math.min(stage.clientWidth / 1123, (window.innerHeight * 0.74) / 794, 1);
        node.style.transformOrigin = 'top left';
        node.style.transform = `scale(${scale})`;
        host.style.width = `${1123 * scale}px`;
        host.style.height = `${794 * scale}px`;
      };
      fit();
      modal._fit = fit;
    } catch (err) {
      console.error(err);
      stage.innerHTML = `<div class="preview-loading">${escHtml(err?.message || 'Preview failed')}</div>`;
    } finally {
      holder.remove();
    }
  }

  // ---------- pull up a child to graduate (certificate only, never fees) ----------
  async function addPulledUpGraduand(admissionNo, reason) {
    if (state.readOnly) throw new Error('Only authorised staff can add graduands.');
    const adm = sanitizeKey(admissionNo);
    const student = state.students?.[adm];
    if (!student) throw new Error('Student not found for this year.');
    if (student.isGraduand) throw new Error(`${student.name} is already a graduand.`);
    const entry = {
      admissionNo: toStr(student.admissionNo || adm),
      name: toStr(student.name),
      fromClass: toStr(student.class),
      reason: toStr(reason).trim() || 'Promoted on merit',
      feeImpact: 'none',
      addedBy: state.user?.email || 'unknown',
      addedAt: firebase.database.ServerValue.TIMESTAMP,
    };
    await db().ref(gradPath(state.currentYear, `graduandExtras/${adm}`)).set(entry);
    await db().ref(gradPath(state.currentYear, 'audits')).push({
      actor: state.user?.email || 'unknown',
      action: 'graduand:pullup',
      refType: 'student',
      refId: adm,
      after: { name: entry.name, fromClass: entry.fromClass, reason: entry.reason },
      at: firebase.database.ServerValue.TIMESTAMP,
    });
  }

  async function removePulledUpGraduand(admissionNo) {
    if (state.readOnly) throw new Error('Only authorised staff can change graduands.');
    const adm = sanitizeKey(admissionNo);
    const before = state.graduandExtras?.[adm] || null;
    await db().ref(gradPath(state.currentYear, `graduandExtras/${adm}`)).remove();
    await db().ref(gradPath(state.currentYear, 'audits')).push({
      actor: state.user?.email || 'unknown',
      action: 'graduand:pullup-remove',
      refType: 'student',
      refId: adm,
      before,
      at: firebase.database.ServerValue.TIMESTAMP,
    });
  }

  function renderPullUpResults() {
    const box = document.getElementById('pullUpResults');
    const input = document.getElementById('pullUpSearch');
    if (!box || !input) return;
    const q = toStr(input.value).trim().toLowerCase();
    if (q.length < 2) { box.innerHTML = ''; return; }
    const matches = getValidStudents()
      .filter((s) => !isCertificateGraduand(s))
      .filter((s) => `${s.name} ${s.admissionNo} ${s.class}`.toLowerCase().includes(q))
      .slice(0, 8);
    box.innerHTML = matches.length
      ? matches.map((s) => `
        <button type="button" class="pull-row" data-pull-adm="${sanitizeKey(s.admissionNo)}">
          <span><b>${escHtml(s.name)}</b><small>${escHtml(s.class)} · ${escHtml(s.admissionNo)}</small></span>
          <i class="fa-solid fa-graduation-cap"></i>
        </button>`).join('')
      : '<div class="pull-empty">No matching non-graduand.</div>';
  }

  function wireCertificatePage() {
    if (!document.getElementById('certificatesBody') || wireCertificatePage.done) return;
    wireCertificatePage.done = true;
    state.certFilter = { group: 'all', search: '' };
    document.addEventListener('click', (event) => {
      const chip = event.target.closest('[data-cert-group]');
      if (chip) {
        state.certFilter.group = chip.dataset.certGroup;
        renderCertificatesTable();
        return;
      }
      const bundle = event.target.closest('[data-cert-bundle]');
      if (bundle) {
        downloadCertificateBundle(bundle.dataset.certBundle).catch((err) => showToast(err?.message || 'Bundle failed', 'error'));
        return;
      }
      if (event.target.closest('[data-cert-cancel]')) {
        certJob.cancelled = true;
        return;
      }
      const pull = event.target.closest('[data-pull-adm]');
      if (pull) {
        const student = state.students?.[pull.dataset.pullAdm];
        const reasonInput = document.getElementById('pullUpReason');
        if (!student) return;
        if (!window.confirm(`Graduate ${student.name} (${student.class}) with the ${state.currentYear} graduands?\n\nCertificate only — no graduation fee is added.`)) return;
        addPulledUpGraduand(pull.dataset.pullAdm, reasonInput?.value)
          .then(() => {
            showToast(`${student.name} added to graduands.`);
            const input = document.getElementById('pullUpSearch');
            if (input) input.value = '';
            if (reasonInput) reasonInput.value = '';
            renderPullUpResults();
          })
          .catch((err) => showToast(err?.message || 'Could not add graduand', 'error'));
        return;
      }
      const modal = document.getElementById('certPreviewModal');
      if (modal && (event.target.closest('[data-preview-close]') || event.target === modal)) {
        modal.classList.remove('show');
        modal.dataset.adm = '';
        return;
      }
      const dl = event.target.closest('[data-preview-download]');
      if (dl && modal?.dataset.adm) {
        dl.disabled = true;
        generateCertificate(modal.dataset.adm, { triggerDownload: true, upload: !state.readOnly })
          .then(() => showToast(state.readOnly ? 'Certificate downloaded.' : 'Certificate downloaded and saved.'))
          .catch((err) => showToast(err?.message || 'Download failed', 'error'))
          .finally(() => { dl.disabled = false; });
      }
    });
    document.getElementById('certSearch')?.addEventListener('input', (e) => {
      state.certFilter.search = e.target.value;
      renderCertificatesTable();
    });
    document.getElementById('pullUpSearch')?.addEventListener('input', renderPullUpResults);
    window.addEventListener('resize', () => document.getElementById('certPreviewModal')?._fit?.());
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') document.getElementById('certPreviewModal')?.classList.remove('show');
    });
    // Warm fonts while the roster loads so the first certificate is quick.
    window.GradCertDesigns?.ensureFonts?.();
  }

  // ---------- ATTENDANCE SUMMARY ----------
  // Today's class registers: attendance/{class}/{YYYY-MM}/{YYYY-MM-DD}/{studentId} = { status|daily, am, pm }
  // (Socrates at the root, other schools under schools/{id}/). Present = status/daily P, as attendance.html counts.
  async function refreshTodayAttendance() {
    try {
      const master = await fetchMasterStudents();
      const classes = Array.from(new Set(master.map((student) => toStr(student.classLevel).trim()).filter(Boolean)));
      if (!classes.length) return;
      const now = new Date(Date.now() + 3 * 3600 * 1000); // Africa/Nairobi
      const ymd = now.toISOString().slice(0, 10);
      const ym = ymd.slice(0, 7);
      const base = getCurrentSchoolId() === 'socrates-school' ? '' : `schools/${getCurrentSchoolId()}/`;
      const variants = (cls) => {
        const out = new Set([cls]);
        if (/pre\s*-?\s*unit/i.test(cls)) ['Pre Unit Class', 'Pre-Unit', 'Pre Unit', 'PreUnit'].forEach((k) => out.add(k));
        return Array.from(out);
      };
      let present = 0;
      let marked = 0;
      await Promise.all(classes.map(async (cls) => {
        const seen = new Set();
        await Promise.all(variants(cls).map(async (key) => {
          try {
            const snap = await db().ref(`${base}attendance/${key}/${ym}/${ymd}`).once('value');
            Object.entries(snap.val() || {}).forEach(([stuId, rec]) => {
              if (!rec || typeof rec !== 'object' || seen.has(stuId)) return;
              const code = toStr(rec.status || rec.daily || '').toUpperCase();
              if (!code && !rec.am && !rec.pm) return;
              seen.add(stuId);
              marked += 1;
              if (code === 'P' || code === 'PRESENT' || code === 'PR') present += 1;
            });
          } catch (err) {
            console.warn('Attendance read failed', key, err?.message || err);
          }
        }));
      }));
      state.totalPresentToday = marked ? present : null;
      state.totalMarkedToday = marked;
      renderDashboardSummary();
      const sub = document.querySelector('#cardTotalPresent')?.parentElement?.querySelector('.stat-sub');
      if (sub) sub.textContent = marked ? `of ${marked.toLocaleString('en-US')} marked in today's registers` : 'No class register taken yet today';
    } catch (err) {
      console.warn('Attendance summary unavailable', err?.message || err);
    }
  }

  // ---------- YEAR SWITCH ----------
  function loadYear(year) {
    const normalized = normalizeYear(year);
    state.currentYear = normalized;
    state.activeRosterKeys = new Set();
    state.activeRosterLoaded = false;
    runYearLoad(normalized);
  }

  function wireGalleryDropzone() {
    const dropArea = $('#galleryDropArea');
    const fileInput = $('#galleryPhotoInput') || document.querySelector('input[name="photo"]');
    const captionInput = $('#galleryCaptionInput');
    if (!dropArea || !fileInput) return;

    const activate = (event) => {
      event.preventDefault();
      event.stopPropagation();
      dropArea.classList.add('dragging');
    };
    const deactivate = (event) => {
      event.preventDefault();
      event.stopPropagation();
      dropArea.classList.remove('dragging');
    };

    ['dragenter', 'dragover'].forEach((evt) => dropArea.addEventListener(evt, activate));
    ['dragleave', 'dragend', 'drop'].forEach((evt) => dropArea.addEventListener(evt, deactivate));

    dropArea.addEventListener('drop', async (event) => {
      event.preventDefault();
      const files = Array.from(event.dataTransfer?.files || []).filter((file) => file && (!file.type || file.type.startsWith('image/')));
      if (!files.length) {
        showToast('Only image files can be dropped here.', 'error');
        return;
      }
      if (!isAuthorized(state.user?.email || '')) {
        showToast('Only staff can upload gallery photos.', 'error');
        return;
      }
      try {
        await processGalleryFiles(files, captionInput?.value || '');
        if (typeof DataTransfer !== 'undefined') {
          const dt = new DataTransfer();
          files.forEach((file) => dt.items.add(file));
          fileInput.files = dt.files;
        }
      } catch (err) {
        console.error(err);
      }
    });

    dropArea.addEventListener('click', () => fileInput.click());
    dropArea.addEventListener('keypress', (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        fileInput.click();
      }
    });

    fileInput.addEventListener('change', () => {
      const files = Array.from(fileInput.files || []);
      if (!files.length) {
        setGalleryStatus('', 'info');
        return;
      }
      const msg = files.length === 1
        ? `${files[0].name} ready to upload`
        : `${files.length} photos selected. Click Upload to start.`;
      setGalleryStatus(msg, 'info');
    });
  }

  function compressImage(file, maxWidth = 1600, maxHeight = 1600, quality = 0.82) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (e) => {
        const img = new Image();
        img.onload = () => {
          let { width, height } = img;
          if (width <= maxWidth && height <= maxHeight) {
            return resolve(file);
          }
          const scale = Math.min(maxWidth / width, maxHeight / height);
          width = Math.round(width * scale);
          height = Math.round(height * scale);
          const canvas = document.createElement('canvas');
          canvas.width = width;
          canvas.height = height;
          const ctx = canvas.getContext('2d');
          ctx.drawImage(img, 0, 0, width, height);
          canvas.toBlob((blob) => {
            if (!blob) return reject(new Error('Unable to compress image.'));
            const compressed = new File([blob], file.name.replace(/\.[^.]+$/, '') + '-compressed.jpg', { type: 'image/jpeg' });
            resolve(compressed);
          }, 'image/jpeg', quality);
        };
        img.onerror = () => reject(new Error('Could not read image for compression.'));
        img.src = e.target.result;
      };
      reader.onerror = () => reject(new Error('Could not load image for compression.'));
      reader.readAsDataURL(file);
    });
  }

  // ---------- ACTION BUTTON DELEGATION ----------
  document.addEventListener('click', (event) => {
    const vendorButton = event.target.closest('[data-vendor]');
    if (vendorButton) {
      showVendorDetails(vendorButton.dataset.vendor);
      return;
    }

    const button = event.target.closest('[data-action][data-adm]');
    if (!button) return;
    const action = button.dataset.action;
    const admission = button.dataset.adm;
    if (state.readOnly && ['delete', 'note'].includes(action)) {
      showToast('Teacher view is read-only.', 'warn');
      return;
    }
    if (state.readOnly && action === 'pay' && !canRecordPayment()) {
      showToast('You do not have access to record graduation payments.', 'warn');
      return;
    }

    if (action === 'pay') {
      const select = $('#paymentStudent');
      if (select) {
        select.value = admission;
        select.dispatchEvent(new Event('change'));
      }
      window.scrollTo({ top: 0, behavior: 'smooth' });
      showToast('Student selected in payment form.', 'warn', 2200);
    } else if (action === 'delete') {
      const student = state.students?.[admission];
      confirmDeleteFlow(admission, student?.name || admission);
    } else if (action === 'note') {
      const ref = db().ref(gradPath(state.currentYear, `students/${admission}`));
      const student = state.students?.[admission];
      const before = toStr(student?.notes || '');
      const updated = window.prompt(`Notes for ${student?.name || admission}`, before);
      if (updated === null) return;
      ref.update({
        notes: updated,
        notesUpdatedBy: state.user?.email || 'unknown',
        notesUpdatedAt: firebase.database.ServerValue.TIMESTAMP,
      }).then(() => db().ref(gradPath(state.currentYear, 'audits')).push({
        actor: state.user?.email || 'unknown',
        action: 'student:note',
        refType: 'student',
        refId: admission,
        before,
        after: updated,
        at: firebase.database.ServerValue.TIMESTAMP,
      }));
    } else if (action === 'generate-cert') {
      const original = button.innerHTML;
      button.disabled = true;
      button.innerHTML = '<span class="spinner"></span><span>Designing…</span>';
      generateCertificate(admission, { triggerDownload: true, upload: !state.readOnly })
        .then(() => showToast(state.readOnly ? 'Certificate downloaded.' : 'Certificate downloaded and saved.'))
        .catch((err) => {
          console.error(err);
          showToast(err?.message || 'Generation failed', 'error');
        })
        .finally(() => {
          button.disabled = false;
          button.innerHTML = original;
        });
    } else if (action === 'preview-cert') {
      previewCertificate(admission);
    } else if (action === 'remove-pullup') {
      if (state.readOnly) { showToast('Read-only view.', 'warn'); return; }
      const student = state.students?.[admission];
      if (!window.confirm(`Remove ${student?.name || admission} from this year's graduands?`)) return;
      removePulledUpGraduand(admission)
        .then(() => showToast('Removed from graduands.'))
        .catch((err) => showToast(err?.message || 'Could not remove', 'error'));
    }
  });

  // ---------- DEBT AUTO-MARKER ----------
  setInterval(() => {
    const cutoff = new Date(state.meta?.debtCutoffISO || `${state.currentYear}-11-07`);
    const now = new Date();
    if (now <= cutoff) return;
    const updates = {};
    getValidStudents().forEach((student) => {
      const key = sanitizeKey(student.admissionNo || student.admissionNumber);
      if (!key || student?.inactive === true || isGhostStudent(student)) return;
      if (hasOutstanding(student) && student.status !== 'debt') {
        updates[`${gradPath(state.currentYear, 'students')}/${key}/status`] = 'debt';
      }
    });
    if (!Object.keys(updates).length) return;
    db().ref().update(updates).catch((err) => console.warn('Debt updater error', err?.message || err));
  }, 15 * 60 * 1000);

  // ---------- AUTO CERT GENERATION (Oct 18) ----------
  const autoCertTimer = setInterval(() => {
    const today = new Date();
    if (today.getMonth() === 9 && today.getDate() === 18) { // 0-indexed months
      generateAllCertificates().catch((err) => console.warn('Auto certificate generation failed', err?.message || err));
      clearInterval(autoCertTimer);
    }
  }, 6 * 60 * 60 * 1000);

}(window));
