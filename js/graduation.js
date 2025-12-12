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
    certificates: {},
    galleries: {},
    audits: {},
    masterStudents: null,
    totalPresentToday: null,
    filters: { search: '', classLevel: 'all' },
    watchers: [],
    galleryUploading: false,
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

  function showAuthGate(allowed) {
    const gate = $('#authGate');
    const shell = $('#appShell');
    if (gate) gate.style.display = allowed ? 'none' : 'flex';
    if (shell) shell.style.display = allowed ? 'block' : 'none';
  }

  function getSelectedYear() {
    return String(window.somapYearContext?.getSelectedYear?.() || state.currentYear || new Date().getFullYear());
  }

  function getSchoolPrefix() {
    return window.currentSchoolId ? `schools/${window.currentSchoolId}/` : '';
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
          showToast('Certificates generated for all graduands.');
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
  function handleAuthChange(user) {
    console.log('handleAuthChange:', user ? user.email : 'No user');
    state.user = user;
    const allowed = isAuthorized(user?.email || '');
    const allowGalleries = state.page === 'galleries';
    const allowRead = allowed || allowGalleries;
    state.readOnly = !allowed;
    showAuthGate(allowRead);
    if (!user) return;
    if (!allowRead) {
      showToast('Sign in with an authorised staff email to load graduation data.', 'error');
      return;
    }

    showToast('Loading graduation data...', 'info');

    ensureYearReady(state.currentYear)
      .then(() => {
        attachYearListeners(state.currentYear);
        try {
          renderAll();
        } catch (e) {
           console.error('Render failed', e);
        }
        refreshTodayAttendance();
        showToast('Graduation data loaded.', 'success');
      })
      .catch((err) => {
        console.error(err);
        showToast(err?.message || 'Failed to load graduation data', 'error');
      });
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

  async function ensureYearReady(year) {
    const normalized = normalizeYear(year);
    state.currentYear = normalized;
    await ensureMeta(normalized);
    await ensureStudents(normalized);
  }

  function ensureMeta(year) {
    const ref = db().ref(`graduation/${year}/meta`);
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
    const ref = db().ref(`graduation/${year}/students`);
    const snapshot = await ref.once('value');
    const existing = snapshot.val() || {};
    const master = await fetchMasterStudents();

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

      if (upsert.expectedFee === undefined || upsert.expectedFee === null) {
        upsert.expectedFee = computeExpectedFee(upsert.class);
        changed = true;
      }

      const graduandFlag = isGraduand(upsert.class);
      if (upsert.isGraduand !== graduandFlag) {
        upsert.isGraduand = graduandFlag;
        changed = true;
      }

      if (changed) {
        updates[adm] = upsert;
      }
      if (!existing[adm]) addedCount += 1;
    });

    if (Object.keys(updates).length) {
      await ref.update(updates);
    }

    state.students = { ...existing, ...updates };

    if (addedCount) {
      await db().ref(`graduation/${year}/audits`).push({
        actor: state.user?.email || 'system',
        action: 'sync:students',
        refType: 'students',
        at: firebase.database.ServerValue.TIMESTAMP,
        after: { added: addedCount, total: Object.keys(state.students).length },
      });
    }

    return state.students;
  }

  async function fetchMasterStudents(force = false) {
    if (state.masterStudents && !force) return state.masterStudents;
    
    // Attempt fetch with timeout/fallback
    let obj = {};
    try {
      const ref = db().ref('students');
      // 10s timeout promise race
      const snap = await Promise.race([
        ref.once('value'),
        new Promise((_, reject) => setTimeout(() => reject(new Error('Students fetch timeout')), 10000))
      ]);
      obj = snap.val() || {};
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
      entry.classLevel = entry.classLevel || entry.class || entry.grade || entry.level || '';
      entry.fullName = [entry.firstName, entry.middleName, entry.lastName].filter(Boolean).join(' ') || entry.name || 'Student';
      entry.parentPhone = extractPrimaryPhone(entry);
      entry.parentName = extractPrimaryName(entry);
      entry.parentEmail = extractPrimaryEmail(entry);
      entry.photoUrl = entry.photoUrl || entry.passportPhotoUrl || entry.photo || '';
      entry.isGraduand = isGraduand(entry.classLevel);
      return entry;
    }).filter((entry) => {
      const hasName = toStr(entry.fullName).trim() && toStr(entry.fullName).trim().toLowerCase() !== 'student';
      const hasClass = toStr(entry.classLevel).trim();
      return entry.admissionNumber && hasName && hasClass;
    });
    
    if (list.length) {
      list.sort((a, b) => a.fullName.localeCompare(b.fullName, 'en'));
      state.masterStudents = list;
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

    if (typeof window.fetchStudentsCanonical === 'function') {
      window.fetchStudentsCanonical(year).then((res) => {
        state.canonicalKeys = res.keys;
        renderDashboardSummary();
        renderStudentTable();
      }).catch(console.warn);
    }

    listen(`graduation/${year}/meta`, (meta) => {
      state.meta = meta;
      renderDashboardSummary();
    });
    listen(`graduation/${year}/students`, (students) => {
      state.students = students;
      populateStudentSelect();
      renderStudentTable();
      renderDashboardSummary();
      renderExpenseTotals();
      syncBalances();
    });
    const hasExports = document.querySelector('[data-export]');
    const needsPayments = document.querySelector('#paymentsBody') || document.querySelector('#paymentStudent') || document.querySelector('#paymentForm') || hasExports;
    if (needsPayments) {
    listen(`graduation/${year}/payments`, (payments) => {
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
      listen(`graduation/${year}/expenses`, (expenses) => {
        state.expenses = expenses;
        renderExpensesTable();
      });
    }
    const needsAudits = document.querySelector('#auditBody');
    if (needsAudits) {
      listen(`graduation/${year}/audits`, (audits) => {
        state.audits = audits;
        renderAuditLog();
      });
    }
    const needsCertificates = document.querySelector('#certificatesBody');
    if (needsCertificates) {
      listen(`graduation/${year}/certificates`, (certificates) => {
        state.certificates = certificates;
        renderCertificatesTable();
      });
    }
    const needsGallery = document.querySelector('#galleryGrid') || document.querySelector('#galleryForm');
    if (needsGallery) {
      listen(`graduation/${year}/galleries`, (galleries) => {
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
    Object.entries(state.students || {}).forEach(([key, student]) => {
      const paid = getPaidTotal(student);
      const expected = getExpectedFee(student);
      const balance = Math.max(0, expected - paid);
      const status = computeStatus(student);

      if (toNumberSafe(student.paid) !== paid) {
        updates[`graduation/${year}/students/${key}/paid`] = paid;
      }
      if (toNumberSafe(student.balance) !== balance) {
        updates[`graduation/${year}/students/${key}/balance`] = balance;
      }
      if (toStr(student.status) !== status) {
        updates[`graduation/${year}/students/${key}/status`] = status;
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
    statuses.unpaid += statuses.partial;

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
    const raw = Object.values(state.students || {});
    if (state.canonicalKeys && typeof window.makeKey === 'function') {
      return raw.filter((s) => {
        const key = window.makeKey(
          s.fullName || s.name || s.studentName || s.student,
          s.class || s.className || s.level,
          s.parentPhone || s.phone || s.contact || s.parentContact
        );
        return state.canonicalKeys.has(key);
      });
    }
    return raw;
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

  function buildPaymentTotals(payments) {
    const totals = {};
    Object.values(payments || {}).forEach((payment) => {
      const admRaw = payment?.admissionNo || payment?.admission || payment?.admNo || payment?.studentAdm;
      const adm = sanitizeKey(admRaw);
      if (!adm) return;
      totals[adm] = toNumberSafe(totals[adm]) + toNumberSafe(payment?.amount || 0);
    });
    return totals;
  }

  function getPaidTotal(student) {
    const adm = sanitizeKey(student?.admissionNo || student?.__key);
    const stored = toNumberSafe(student?.paid || 0);
    const fromPayments = adm ? toNumberSafe(state.paymentTotals?.[adm] || 0) : 0;
    return Math.max(0, stored, fromPayments);
  }

  function renderStudentTable() {
    if (state.page !== 'dashboard') return;
    const tbody = $('#studentsBody');
    if (!tbody) return;

    const search = toStr(state.filters.search).toLowerCase();
    const classFilter = state.filters.classLevel;
    const rows = getValidStudents(); // Use filtered canonical list
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
            No students for ${state.currentYear}. Seed students first.
          </td>
        </tr>`;
      return;
    }

    tbody.innerHTML = filtered.map((student) => {
      const status = computeStatus(student);
      const expected = getExpectedFee(student);
      const paid = getPaidTotal(student);
      const id = sanitizeKey(student.admissionNo);
       const isGhost = isGhostStudent(student);
      const debtTag = status === 'debt' ? '<span class="debt-pill">DEBT</span>' : '';
      const badge = status === 'paid'
        ? 'status-badge paid'
        : status === 'partial'
          ? 'status-badge partial'
          : status === 'debt'
            ? 'status-badge debt'
            : 'status-badge unpaid';
      const balance = getBalance(student);
      return `
        <tr class="${status === 'debt' ? 'row-debt' : ''} ${isGhost ? 'bg-amber-50' : ''}">
          <td>
            <div class="flex items-center gap-3">
              ${student.photoUrl
                ? `<img src="${student.photoUrl}" class="w-10 h-10 rounded-full object-cover border border-white/10" alt="${toStr(student.name)}">`
                : '<div class="w-10 h-10 rounded-full bg-sky-200 flex items-center justify-center text-sky-700 font-semibold">GR</div>'}
              <div>
                <div class="font-semibold text-slate-900">${toStr(student.name)}${isGhost ? ' <span class="text-xs text-amber-600 font-semibold">(ghost)</span>' : ''}</div>
                <div class="text-xs text-slate-500">${toStr(student.admissionNo)}</div>
              </div>
            </div>
          </td>
          <td>${toStr(student.class) || '--'}</td>
          <td class="text-right">
            <span data-col="expected" data-id="${id}" data-val="${expected}">${formatCurrency(expected)}</span>
            <button class="btn-xs ml-2" data-edit="expected" data-id="${id}">Edit</button>
          </td>
          <td class="text-right ${paid >= expected ? 'text-emerald-600 font-semibold' : ''}">
            <span data-col="paid" data-id="${id}" data-val="${paid}">${formatCurrency(paid)}</span>
            <button class="btn-xs ml-2" data-edit="paid" data-id="${id}">Edit</button>
          </td>
          <td class="text-right">
            <span data-col="balance" data-id="${id}" data-val="${balance}">${formatCurrency(balance)}</span>
          </td>
          <td><span class="${badge}" data-col="status" data-id="${id}">${status.toUpperCase()}</span> ${debtTag}</td>
          <td>
            <div class="text-sm text-slate-700">${toStr(student.parentPhone) || '--'}</div>
            <div class="text-xs text-slate-400">${toStr(student.parentName) || ''}</div>
          </td>
          <td class="text-right">
            <button class="action-btn" data-action="pay" data-adm="${id}">Record Payment</button>
            <button class="action-btn secondary" data-action="note" data-adm="${id}">Note</button>
            <button class="action-btn danger" data-action="delete" data-adm="${id}">Delete</button>
          </td>
        </tr>`;
    }).join('');
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
    const rows = Object.entries(state.payments || {}).map(([key, value]) => ({ key, ...(value || {}) }));
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
      return `
        <tr>
          <td>${student?.name || payment.admissionNo || '--'}</td>
          <td>${formatCurrency(payment.amount)}</td>
          <td>${timestamp.toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}</td>
          <td>${toStr(payment.method) || 'Cash'}${payment.note ? `<div class="text-xs text-slate-500">${toStr(payment.note)}</div>` : ''}</td>
          <td class="text-right text-xs text-slate-400 uppercase">${toStr(payment.recordedBy || '').split('@')[0]}</td>
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
          <td>${toStr(expense.seller) || '--'}<div class="text-xs text-slate-400">${toStr(expense.sellerPhone) || ''}</div></td>
          <td>${Number(expense.quantity || 0).toLocaleString('en-US')}</td>
          <td>${formatCurrency(expense.priceEach)}</td>
          <td>${formatCurrency(total)}</td>
          <td>${timestamp.toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}<div class="text-xs text-slate-400 uppercase">${toStr(expense.recordedBy || '').split('@')[0]}</div></td>
          <td>${proofLabel}</td>
        </tr>`;
    }).join('');
    renderExpenseTotals();
  }

  function renderExpenseTotals() {
    const expenses = Object.values(state.expenses || {});
    const total = expenses.reduce((sum, expense) => sum + Number(expense.total || (Number(expense.priceEach || 0) * Number(expense.quantity || 0))), 0);
    const count = expenses.length;
    const collectedFromStudents = Object.values(state.students || {}).reduce((sum, student) => sum + getPaidTotal(student), 0);
    const collectedFromPayments = Object.values(state.payments || {}).reduce((sum, payment) => sum + toNumberSafe(payment.amount || 0), 0);
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
        <td>${toStr(entry.actor || '').split('@')[0]}</td>
        <td><code class="text-xs break-all">${JSON.stringify(entry.after || {}).slice(0, 120)}${JSON.stringify(entry.after || {}).length > 120 ? '...' : ''}</code></td>
      </tr>`).join('');
  }

  function renderCertificatesTable() {
    const tbody = $('#certificatesBody');
    if (!tbody) return;
    const rows = Object.values(state.students || {}).filter((student) => student.isGraduand);
    if (!rows.length) {
      tbody.innerHTML = `
        <tr>
          <td colspan="6" class="py-8 text-center text-slate-500">No graduands for ${state.currentYear}.</td>
        </tr>`;
      return;
    }
    rows.sort((a, b) => toStr(a.name).localeCompare(toStr(b.name)));
    tbody.innerHTML = rows.map((student) => {
      const certificate = state.certificates?.[sanitizeKey(student.admissionNo)];
      const generatedAt = certificate?.generatedAt ? new Date(Number(certificate.generatedAt)) : null;
      return `
        <tr>
          <td>
            <div class="font-semibold">${toStr(student.name)}</div>
            <div class="text-xs text-slate-400">${toStr(student.class)}  -  ${toStr(student.admissionNo)}</div>
          </td>
          <td>${certificate?.urlPdf ? 'Ready' : 'Pending'}</td>
          <td>${generatedAt ? generatedAt.toLocaleDateString('en-GB') : '--'}</td>
          <td>${certificate?.generatedBy ? toStr(certificate.generatedBy).split('@')[0] : '--'}</td>
          <td class="text-right">
            <button class="action-btn" data-action="generate-cert" data-adm="${sanitizeKey(student.admissionNo)}">Generate</button>
          </td>
          <td class="text-right">
            ${certificate?.urlPdf ? `<a class="action-btn tertiary" target="_blank" href="${certificate.urlPdf}">PDF</a>` : '<span class="text-xs text-slate-400">No PDF</span>'}
            ${certificate?.urlPreview ? `<a class="action-btn tertiary" target="_blank" href="${certificate.urlPreview}">Preview</a>` : ''}
          </td>
        </tr>`;
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
      updates[`students/${adm}`] = null;
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
    const expenseRef = db().ref(`graduation/${year}/expenses`).push();
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
    const storagePath = `graduation/${year}/expenses/${expenseId}/${encodeURIComponent(safeName)}`;

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
      recordedBy: state.user?.email || 'unknown',
      createdAt: firebase.database.ServerValue.TIMESTAMP,
    };

    return expenseRef.set(basePayload).then(() => {
      uploadExpenseProof(uploadFile, `${expenseId}-${safeName}`, (progress) => {
        expenseRef.update({ proofProgress: progress }).catch(() => {});
      })
        .then((url) => {
          expenseRef.update({ proofUrl: url, proofStatus: 'ready', proofProgress: 100 }).catch(() => {});
          db().ref(`graduation/${year}/audits`).push({
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
    const entryRef = db().ref(`graduation/${year}/galleries`).push();
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
        .then((url) => db().ref(`graduation/${year}/audits`).push({
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
      .then((url) => db().ref(`graduation/${year}/audits`).push({
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
    let raw = snap.val() || {};
    if (!Object.keys(raw).length && SCHOOL) {
      const fallbackSnap = await db().ref(`graduation/${year}/expenses`).once('value');
      raw = fallbackSnap.val() || {};
    }
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
      return Object.entries(useStateStudents).map(([id, s]) => ({
        id,
        admission: s.admissionNo || id,
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
    let studentsRaw = studentsSnap.val() || {};
    let paymentsRaw = paymentsSnap.val() || {};

    if (!Object.keys(studentsRaw).length && SCHOOL) {
      const [fallbackStudents, fallbackPayments] = await Promise.all([
        db().ref(`graduation/${year}/students`).once('value'),
        db().ref(`graduation/${year}/payments`).once('value'),
      ]);
      studentsRaw = fallbackStudents.val() || {};
      paymentsRaw = fallbackPayments.val() || {};
    }

    const paymentTotals = buildPaymentTotals(paymentsRaw || {});
    const seen = new Set();

    return Object.entries(studentsRaw).map(([id, s]) => {
      const adm = sanitizeKey(s.admissionNo || id);
      if (adm && seen.has(adm)) return null;
      if (adm) seen.add(adm);
      const expected = toNumberSafe(s.expectedOverride ?? s.expectedFee ?? s.expected ?? computeExpectedFee(s.class));
      const paid = Math.max(toNumberSafe(s.paid || 0), toNumberSafe(paymentTotals[id] || paymentTotals[adm] || 0));
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

  async function exportExpensesPDF(event) {
    if (event) {
      event.preventDefault();
      event.stopImmediatePropagation();
    }
    const y = getSelectedYear();
    const list = await loadGradExpenses(y);
    if (!list.length) { alert('No expenses found.'); return; }
    const { jsPDF } = window.jspdf || {};
    if (!jsPDF) { alert('PDF library missing'); return; }

    const doc = new jsPDF({ orientation: 'p', unit: 'pt', format: 'a4' });
    if (!doc.autoTable) { alert('PDF table plugin missing'); return; }
    doc.setFontSize(16);
    doc.text(`Socrates School — Graduation Expenses (${y})`, 40, 50);
    const total = list.reduce((a, b) => a + (Number(b.amount || 0)), 0);
    doc.setFontSize(11);
    doc.text(`Total spent: TSh ${total.toLocaleString()}`, 40, 70);

    const rows = list.map((e) => [
      e.item,
      e.seller,
      e.contact,
      e.quantity,
      `TSh ${Number(e.priceEach || 0).toLocaleString()}`,
      `TSh ${Number(e.total || 0).toLocaleString()}`,
      e.recordedAt,
      e.recordedBy,
      e.proof,
    ]);
    doc.autoTable({
      startY: 90,
      head: [['Item', 'Seller', 'Contact', 'Qty', 'Price Each', 'Total', 'Recorded', 'By', 'Proof']],
      body: rows,
      styles: { fontSize: 9, cellPadding: 4 },
      headStyles: { fillColor: [33, 37, 41], textColor: 255 },
    });

    doc.save(`graduation_expenses_${y}.pdf`);
  }

  async function exportAuditCSV(event) {
    if (event) {
      event.preventDefault();
      event.stopImmediatePropagation();
    }
    const y = getSelectedYear();
    const [students, expenses] = await Promise.all([loadGradLedger(y), loadGradExpenses(y)]);
    const { paid, partial, unpaid } = partitionStudents(students);

    const totalExpected = students.reduce((a, b) => a + b.expected, 0);
    const totalPaid = students.reduce((a, b) => a + b.paid, 0);
    const totalUncol = totalExpected - totalPaid;
    const totalExp = expenses.reduce((a, b) => a + (Number(b.amount) || 0), 0);
    const netBalance = totalPaid - totalExp;

    const lines = [];
    const push = (arr) => lines.push(...arr);

    push([`"Socrates School - Graduation Audit ${y}"`, '']);
    push([`"Students total",${students.length}`]);
    push([`"Paid count",${paid.length}`]);
    push([`"Partial count",${partial.length}`]);
    push([`"Unpaid count",${unpaid.length}`]);
    push([`"Total expected",${totalExpected}`]);
    push([`"Total collected",${totalPaid}`]);
    push([`"Uncollected",${totalUncol}`]);
    push([`"Expenses total",${totalExp}`]);
    push([`"Net (collected - expenses)",${netBalance}`]);
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
    await generateAuditPDF();
  }

  // Fancy Audit PDF with logo, Swahili intro, and signatories
  function imgToDataURL(url) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = function () {
        const c = document.createElement('canvas');
        c.width = img.width; c.height = img.height;
        const ctx = c.getContext('2d');
        ctx.drawImage(img, 0, 0);
        resolve(c.toDataURL('image/png'));
      };
      img.onerror = reject;
      img.src = url;
    });
  }

  async function generateAuditPDF(options = {}) {
    const { jsPDF } = window.jspdf || {};
    if (!jsPDF) { alert('PDF library missing'); return; }
    const doc = new jsPDF('p', 'pt', 'a4');
    if (!doc.autoTable) { alert('PDF table plugin missing'); return; }

    const year = getSelectedYear();
    
    // Load Data
    const [students, expenses] = await Promise.all([loadGradLedger(year), loadGradExpenses(year)]);
    const { paid, partial, unpaid } = partitionStudents(students);
    
    // Calculate Metrics
    const totalExpected = students.reduce((a, b) => a + toNumberSafe(b.expected), 0);
    const totalPaid = students.reduce((a, b) => a + toNumberSafe(b.paid), 0);
    const totalUncol = Math.max(0, totalExpected - totalPaid);
    const totalExp = expenses.reduce((a, b) => a + (Number(b.total) || Number(b.amount) || 0), 0);
    const netBalance = totalPaid - totalExp;

    const left = 40;
    let top = 40;
    
    // --- LOGO (Attempt to load) ---
    try {
      const logoUrl = options.schoolLogoUrl || '../images/somap-logo.png.jpg';
      const logoData = await imgToDataURL(logoUrl);
      doc.addImage(logoData, 'PNG', left, top, 50, 50);
    } catch (err) {
      console.warn('Logo load skipped', err);
    }

    // --- TITLE & ADDRESS ---
    doc.setFont('times', 'bold');
    doc.setFontSize(16);
    doc.text(`Socrates School — Ripoti ya Ukaguzi wa Graduation (${year})`, left + 60, top + 20);
    
    doc.setFont('times', 'normal');
    doc.setFontSize(10);
    doc.text('P.O. Box 14256 Arusha, Arusha • +255 686828732 • info@socrates.ac.tz', left + 60, top + 36);
    
    top += 60;

    // --- INTRO (SWAHILI) ---
    doc.setFontSize(10);
    const intro = [
      'Kwenye ripoti hii, tunawasilisha tathmini ya makusanyo yote ya ada za graduation kwa mwaka huu.',
      'Ripoti imeainisha kiasi kilichotarajiwa, kiasi kilicholipwa, na salio linalodaiwa na kila mwanafunzi.',
      'Takwimu zimechambuliwa kulingana na madarasa na hadhi ya malipo ili kuwezesha ufuatiliaji sahihi.',
      'Tunalenga kusaidia kamati ya shule kupanga maamuzi thabiti kuhusu ukamilishaji wa malipo.',
      'Ripoti pia inaangazia tofauti za makadirio na malipo halisi kwa uwazi mkubwa.',
      'Vyanzo vya data ni sajili za wanafunzi, leja ya graduation, na stakabadhi zinazohusiana.',
      'Uongozi wa shule umetumia tahadhari kuhakikisha usahihi na uadilifu wa taarifa zote zilizowasilishwa.',
      'Mwisho, ripoti ina mapendekezo ya hatua za uboreshaji wa ukusanyaji wa ada zijazo.'
    ].join(' ');
    const splitIntro = doc.splitTextToSize(intro, 515);
    doc.text(splitIntro, left, top);
    top += splitIntro.length * 12 + 10;

    // --- SUMMARY TABLE ---
    doc.setFont('times', 'bold');
    doc.setFontSize(12);
    doc.text('Summary', left, top);
    top += 12;

    const summaryData = [
      ['Students total', students.length],
      ['Paid count', paid.length],
      ['Partial count', partial.length],
      ['Unpaid count', unpaid.length],
      ['Total expected', `TSh ${totalExpected.toLocaleString()}`],
      ['Total collected', `TSh ${totalPaid.toLocaleString()}`],
      ['Uncollected', `TSh ${totalUncol.toLocaleString()}`],
      ['Expenses total', `TSh ${totalExp.toLocaleString()}`],
      ['Net (collected - expenses)', `TSh ${netBalance.toLocaleString()}`],
    ];

    doc.autoTable({
      startY: top,
      head: [['Metric', 'Value']],
      body: summaryData,
      theme: 'grid',
      styles: { fontSize: 10, cellPadding: 5 },
      headStyles: { fillColor: [40, 40, 40], textColor: 255, fontStyle: 'bold' },
      columnStyles: { 0: { fontStyle: 'bold', cellWidth: 200 }, 1: { halign: 'right' } },
    });
    
    top = doc.lastAutoTable.finalY + 24;

    // Helper for section totals
    const calcSectionTotals = (list) => {
      const exp = list.reduce((a, b) => a + toNumberSafe(b.expected), 0);
      const pd = list.reduce((a, b) => a + toNumberSafe(b.paid), 0);
      return { count: list.length, exp, pd };
    };

    // --- PAID STUDENTS ---
    if (paid.length > 0) {
      if (top > 750) { doc.addPage(); top = 40; }
      doc.setFontSize(12);
      doc.setFont('times', 'bold');
      doc.text('Paid Students', left, top);
      top += 10;
      
      const pT = calcSectionTotals(paid);
      doc.autoTable({
        startY: top,
        head: [['Adm', 'Name', 'Class', 'Expected', 'Paid', 'Parent']],
        body: paid.map(s => [
            s.admission, 
            s.name, 
            s.className, 
            `TSh ${toNumberSafe(s.expected).toLocaleString()}`, 
            `TSh ${toNumberSafe(s.paid).toLocaleString()}`, 
            s.parent
        ]),
        foot: [[
          'TOTAL', 
          `${pT.count} Students`, 
          '-', 
          `TSh ${pT.exp.toLocaleString()}`, 
          `TSh ${pT.pd.toLocaleString()}`, 
          '-'
        ]],
        styles: { fontSize: 9, cellPadding: 3 },
        headStyles: { fillColor: [22, 163, 74], textColor: 255 }, // Green
        footStyles: { fillColor: [220, 252, 231], textColor: [20, 83, 45], fontStyle: 'bold' },
      });
      top = doc.lastAutoTable.finalY + 24;
    }

    // --- PARTIAL PAYMENTS ---
    if (partial.length > 0) {
      if (top > 750) { doc.addPage(); top = 40; }
      doc.setFontSize(12);
      doc.setFont('times', 'bold');
      doc.text('Partial Payments', left, top);
      top += 10;
      
      const pT = calcSectionTotals(partial);
      doc.autoTable({
        startY: top,
        head: [['Adm', 'Name', 'Class', 'Expected', 'Paid', 'Parent']],
        body: partial.map(s => [
            s.admission, 
            s.name, 
            s.className, 
            `TSh ${toNumberSafe(s.expected).toLocaleString()}`, 
            `TSh ${toNumberSafe(s.paid).toLocaleString()}`, 
            s.parent
        ]),
        foot: [[
          'TOTAL', 
          `${pT.count} Students`, 
          '-', 
          `TSh ${pT.exp.toLocaleString()}`, 
          `TSh ${pT.pd.toLocaleString()}`, 
          '-'
        ]],
        styles: { fontSize: 9, cellPadding: 3 },
        headStyles: { fillColor: [245, 158, 11], textColor: 0 }, // Orange
        footStyles: { fillColor: [254, 243, 199], textColor: [146, 64, 14], fontStyle: 'bold' },
      });
      top = doc.lastAutoTable.finalY + 24;
    }

    // --- UNPAID ---
    if (unpaid.length > 0) {
      if (top > 750) { doc.addPage(); top = 40; }
      doc.setFontSize(12);
      doc.setFont('times', 'bold');
      doc.text('Unpaid', left, top);
      top += 10;
      
      const pT = calcSectionTotals(unpaid);
      doc.autoTable({
        startY: top,
        head: [['Adm', 'Name', 'Class', 'Expected', 'Paid', 'Parent']],
        body: unpaid.map(s => [
            s.admission, 
            s.name, 
            s.className, 
            `TSh ${toNumberSafe(s.expected).toLocaleString()}`, 
            `TSh ${toNumberSafe(s.paid).toLocaleString()}`, 
            s.parent
        ]),
        foot: [[
          'TOTAL', 
          `${pT.count} Students`, 
          '-', 
          `TSh ${pT.exp.toLocaleString()}`, 
          `TSh ${pT.pd.toLocaleString()}`, 
          '-'
        ]],
        styles: { fontSize: 9, cellPadding: 3 },
        headStyles: { fillColor: [239, 68, 68], textColor: 255 }, // Red
        footStyles: { fillColor: [254, 226, 226], textColor: [153, 27, 27], fontStyle: 'bold' },
      });
      top = doc.lastAutoTable.finalY + 24;
    }

    // --- EXPENSES ---
    if (expenses.length > 0) {
       if (top > 750) { doc.addPage(); top = 40; }
       
       doc.setFontSize(12);
       doc.setFont('times', 'bold');
       doc.text('Expenses', left, top);
       top += 10;
       
       doc.autoTable({
        startY: top,
        head: [['Item', 'Seller', 'Contact', 'Qty', 'Price Each', 'Total', 'Recorded', 'Proof']],
        body: expenses.map(e => [
            e.item, 
            e.seller, 
            e.contact, 
            e.quantity, 
            `TSh ${Number(e.priceEach || 0).toLocaleString()}`, 
            `TSh ${Number(e.total || 0).toLocaleString()}`, 
            e.recordedAt, 
            e.proof
        ]),
        foot: [[
          'TOTAL EXPENSES', '', '', '', '', 
          `TSh ${totalExp.toLocaleString()}`, 
          '', ''
        ]],
        styles: { fontSize: 8, cellPadding: 3 },
        headStyles: { fillColor: [30, 64, 175], textColor: 255 }, // Blue
        footStyles: { fillColor: [219, 234, 254], textColor: [30, 58, 138], fontStyle: 'bold' },
      });
      top = doc.lastAutoTable.finalY + 24;
    }

    // --- FINAL SUMMARY & SIGNATURES ---
    if (top > 650) { doc.addPage(); top = 40; }
    
    doc.setFont('times', 'bold'); 
    doc.setFontSize(14);
    doc.text('Muhtasari wa Takwimu', left, top);
    top += 20;
    
    doc.setFontSize(11);
    doc.setFont('times', 'normal');
    doc.text([
      `Wote (halali): ${students.length}`,
      `WalioLipa Kikamilifu: ${paid.length} (TSh ${totalPaid.toLocaleString()})`,
      `Wenye Madeni/Salio: ${unpaid.length + partial.length} (TSh ${totalUncol.toLocaleString()})`,
      `Jumla Matumizi: TSh ${totalExp.toLocaleString()}`,
      `Mlinganyo wa mwisho (makusanyo - matumizi): TSh ${netBalance.toLocaleString()}`,
    ], left, top);
    
    top += 100;
    
    doc.setFont('times', 'bold'); 
    doc.setFontSize(14);
    doc.text('Saini za Uidhinishaji', left, top);
    top += 20;
    
    doc.setFontSize(11);
    doc.setFont('times', 'normal');
    const signLines = [
      'Mkuu wa Shule: ____________________________  Tarehe: __________',
      'Mwalimu wa Taaluma: _______________________  Tarehe: __________',
      'Kiongozi wa Bajeti ya Graduation: __________  Tarehe: __________',
      'Mwenyekiti wa Kamati: ______________________  Tarehe: __________',
      'Mjumbe wa Kamati 1: _______________________  Tarehe: __________',
      'Mjumbe wa Kamati 2: _______________________  Tarehe: __________',
      'Mjumbe wa Kamati 3: _______________________  Tarehe: __________',
    ];
    // Increase spacing for signatures
    signLines.forEach(line => {
      doc.text(line, left, top);
      top += 30; 
    });

    // --- FOOTER / PAGE NUMBERS ---
    const pageCount = doc.internal.getNumberOfPages();
    for (let i = 1; i <= pageCount; i += 1) {
      doc.setPage(i);
      doc.setFontSize(9);
      doc.text(`Generated by SoMAp Graduation Suite • ${year}`, left, 820);
      doc.text(`Page ${i} / ${pageCount}`, 500, 820);
    }

    doc.save(`Socrates_Graduation_Audit_${year}.pdf`);
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
      rows = Object.values(state.payments || {}).map((payment) => [
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

  function downloadPdf(type) {
    if (!window.jspdf || !window.jspdf.jsPDF) {
      showToast('jsPDF library required for PDF export.', 'error');
      return;
    }
    if (type === 'audit') {
      generateAuditPDF().catch((err) => {
        console.error(err);
        showToast(err?.message || 'PDF export failed', 'error');
      });
      return;
    }
    const doc = new window.jspdf.jsPDF('landscape');
    doc.setFontSize(16);
    doc.text(`Graduation ${state.currentYear}  -  ${type.toUpperCase()}`, 14, 16);
    doc.setFontSize(10);
    doc.text(`Generated ${new Date().toLocaleString()}`, 14, 26);

    let headers = [];
    let body = [];
    if (type === 'students') {
      headers = ['Admission', 'Name', 'Class', 'Expected', 'Paid', 'Balance', 'Status'];
      body = getValidStudents().map((student) => {
        const expected = getExpectedFee(student);
        const paid = getPaidTotal(student);
        const balance = getBalance(student);
        return [
          toStr(student.admissionNo),
          toStr(student.name),
          toStr(student.class),
          formatCurrency(expected),
          formatCurrency(paid),
          formatCurrency(balance),
          computeStatus(student).toUpperCase(),
        ];
      });
    } else if (type === 'paid') {
      headers = ['Admission', 'Name', 'Amount', 'Method', 'Recorded By', 'When'];
      body = Object.values(state.payments || {}).map((payment) => [
        toStr(payment.admissionNo),
        state.students?.[sanitizeKey(payment.admissionNo)]?.name || '--',
        formatCurrency(payment.amount),
        toStr(payment.method),
        toStr(payment.recordedBy),
        new Date(Number(payment.createdAt || payment.timestamp || Date.now())).toLocaleString('en-GB'),
      ]);
    } else if (type === 'unpaid') {
      headers = ['Admission', 'Name', 'Class', 'Expected', 'Paid', 'Balance', 'Status'];
      const allStudents = getValidStudents();
      // Fix: If a student appears twice (once paid, once unpaid/debt), exclude the debt record.
      const paidNames = new Set(allStudents.filter(s => !hasOutstanding(s)).map(s => toStr(s.name).trim().toLowerCase()));

      body = allStudents.filter((student) => {
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
          formatCurrency(expected),
          formatCurrency(paid),
          formatCurrency(balance),
          computeStatus(student).toUpperCase(),
        ];
      });
    } else if (type === 'expenses') {
      headers = ['Item', 'Seller', 'Qty', 'Price Each', 'Total', 'Recorded', 'Proof'];
      body = Object.values(state.expenses || {}).map((expense) => [
        toStr(expense.item),
        `${toStr(expense.seller)}  -  ${toStr(expense.sellerPhone)}`,
        Number(expense.quantity || 0),
        formatCurrency(expense.priceEach),
        formatCurrency(expense.total || (Number(expense.priceEach || 0) * Number(expense.quantity || 0))),
        `${toStr(expense.recordedBy)}  -  ${new Date(Number(expense.createdAt || Date.now())).toLocaleString('en-GB')}`,
        expense.proofUrl ? 'Attached' : 'Missing',
      ]);
    } else if (type === 'audit') {
      headers = ['When', 'Actor', 'Action', 'Ref', 'Details'];
      body = Object.values(state.audits || {}).map((entry) => [
        new Date(Number(entry.at || Date.now())).toLocaleString('en-GB'),
        toStr(entry.actor),
        toStr(entry.action),
        `${toStr(entry.refType)}  -  ${toStr(entry.refId)}`,
        JSON.stringify(entry.after || {}),
      ]);
    } else {
      showToast(`Unknown export type: ${type}`, 'error');
      return;
    }

    if (doc.autoTable) {
      doc.autoTable({
        head: [headers],
        body,
        startY: 32,
        styles: { fontSize: 8 },
        headStyles: { fillColor: [15, 23, 42] },
      });
    } else {
      doc.text('jsPDF AutoTable plugin missing.', 14, 42);
    }
    doc.save(`graduation_${state.currentYear}_${type}.pdf`);
  }

  // ---------- CERTIFICATE GENERATION ----------
  async function generateCertificate(admissionNoRaw, options = {}) {
    const { triggerDownload = false } = options;
    const admissionNo = sanitizeKey(admissionNoRaw);
    const student = state.students?.[admissionNo];
    if (!student) throw new Error('Student not found');
    if (!student.isGraduand) throw new Error('Certificates available only for graduands');

    // Use <template>.content and an offscreen sandbox so html2canvas can render it.
    const template = document.getElementById('certificateTemplate');
    if (!template || !template.content) throw new Error('Certificate template missing in DOM');

    let sandbox = document.getElementById('renderSandbox');
    if (!sandbox) {
      sandbox = document.createElement('div');
      sandbox.id = 'renderSandbox';
      sandbox.style.position = 'fixed';
      sandbox.style.left = '-10000px';
      sandbox.style.top = '-10000px';
      sandbox.style.pointerEvents = 'none';
      document.body.appendChild(sandbox);
    }
    sandbox.innerHTML = '';
    const fragment = template.content.cloneNode(true);
    sandbox.appendChild(fragment);
    const certNode = sandbox.firstElementChild;

    // hydrate
    certNode.querySelector('[data-cert="studentName"]').textContent = toStr(student.name);
    certNode.querySelector('[data-cert="classLevel"]').textContent = `${toStr(student.class)}  -  ${state.currentYear}`;
    certNode.querySelector('[data-cert="issuedDate"]').textContent = new Date().toLocaleDateString('en-GB');
    certNode.querySelector('[data-cert="admission"]').textContent = toStr(student.admissionNo);

    // photo with crossOrigin - fetch from master students if not in graduation record
    const photoNode = certNode.querySelector('[data-cert="photo"]');
    if (photoNode) {
      photoNode.crossOrigin = 'anonymous';
      let photoUrl = student.photoUrl || '';
      // If no photo in graduation record, fetch from master students RTDB
      if (!photoUrl) {
        try {
          const masterSnapshot = await db().ref('students').orderByChild('admissionNumber').equalTo(student.admissionNo).once('value');
          const masterData = masterSnapshot.val() || {};
          const masterStudent = Object.values(masterData)[0];
          if (masterStudent) {
            photoUrl = masterStudent.passportPhotoUrl || masterStudent.passportPhotoURL || masterStudent.photoUrl || masterStudent.photo || '';
          }
        } catch (err) {
          console.warn('Failed to fetch photo from RTDB:', err?.message || err);
        }
      }
      photoNode.src = photoUrl || '../images/somap-logo.png.jpg';
      await new Promise((resolve) => {
        if (photoNode.complete) return resolve();
        photoNode.onload = () => resolve();
        photoNode.onerror = () => resolve(); // don't block if image fails
      });
    }

    if (!window.html2canvas || !window.jspdf || !window.jspdf.jsPDF) {
      throw new Error('html2canvas + jsPDF are required for certificate generation');
    }

    const canvas = await window.html2canvas(certNode, {
      scale: 2,
      useCORS: true,
      backgroundColor: null,
    });

    const dataUrl = canvas.toDataURL('image/png');
    const pdf = new window.jspdf.jsPDF('landscape', 'pt', 'a4');
    const width = pdf.internal.pageSize.getWidth();
    const height = pdf.internal.pageSize.getHeight();
    pdf.addImage(dataUrl, 'PNG', 0, 0, width, height);
    const pdfBlob = pdf.output('blob');

    if (triggerDownload) {
      const safeName = `${toStr(student.name).replace(/[^\w\s-]+/g, ' ').trim().replace(/\s+/g, '_') || admissionNo}_${state.currentYear}.pdf`;
      const downloadUrl = URL.createObjectURL(pdfBlob);
      const link = document.createElement('a');
      link.href = downloadUrl;
      link.download = safeName;
      link.style.display = 'none';
      document.body.appendChild(link);
      link.click();
      setTimeout(() => {
        URL.revokeObjectURL(downloadUrl);
        link.remove();
      }, 1200);
    }

    const year = state.currentYear;
    const base = `graduation/${year}/certificates/${admissionNo}`;
    const pdfRef = storage().ref(`${base}.pdf`);
    const pngRef = storage().ref(`${base}.png`);

    await pdfRef.put(pdfBlob, { contentType: 'application/pdf' });
    let urlPreview = null;
    try {
      const previewBlob = await new Promise((resolve, reject) => {
        canvas.toBlob((blob) => {
          if (blob) resolve(blob);
          else reject(new Error('Canvas could not produce a preview blob'));
        }, 'image/png');
      });
      await pngRef.put(previewBlob, { contentType: 'image/png' });
      urlPreview = await pngRef.getDownloadURL();
    } catch (err) {
      console.warn('Certificate preview upload skipped', err?.message || err);
    }

    const urlPdf = await pdfRef.getDownloadURL();

    await db().ref(`graduation/${year}/certificates/${admissionNo}`).set({
      urlPdf,
      urlPreview,
      generatedAt: firebase.database.ServerValue.TIMESTAMP,
      generatedBy: state.user?.email || 'unknown',
    });

    await db().ref(`graduation/${year}/audits`).push({
      actor: state.user?.email || 'unknown',
      action: 'certificate:generate',
      refType: 'certificate',
      refId: admissionNo,
      after: { urlPdf },
      at: firebase.database.ServerValue.TIMESTAMP,
    });
  }

  async function generateAllCertificates() {
    const graduands = Object.values(state.students || {}).filter((s) => s.isGraduand);
    if (!graduands.length) {
      showToast('No graduands available.', 'warn');
      return;
    }
    for (const s of graduands) {
      const adm = sanitizeKey(s.admissionNo);
      const existing = state.certificates?.[adm];
      if (existing?.urlPdf) continue;
      try {
        await generateCertificate(adm);
        await new Promise((r) => setTimeout(r, 400));
      } catch (err) {
        console.warn('Certificate generation failed for', adm, err?.message || err);
      }
    }
  }

  // ---------- ATTENDANCE SUMMARY ----------
  async function refreshTodayAttendance() {
    try {
      const master = await fetchMasterStudents();
      const classes = Array.from(new Set(master.map((student) => toStr(student.classLevel).trim()).filter(Boolean)));
      if (!classes.length) return;
      const today = new Date();
      const yymm = `${today.getFullYear()}${String(today.getMonth() + 1).padStart(2, '0')}`;
      const day = String(today.getDate()).padStart(2, '0');
      let present = 0;
      await Promise.all(classes.map(async (cls) => {
        try {
          const snap = await db().ref(`attendance/${cls}/${yymm}/${day}`).once('value');
          const record = snap.val();
          if (record && typeof record.present === 'number') present += record.present;
        } catch (err) {
          console.warn('Attendance read failed', cls, err?.message || err);
        }
      }));
      state.totalPresentToday = present || null;
      renderDashboardSummary();
    } catch (err) {
      console.warn('Attendance summary unavailable', err?.message || err);
    }
  }

  // ---------- YEAR SWITCH ----------
  function loadYear(year) {
    const normalized = normalizeYear(year);
    state.currentYear = normalized;
    ensureYearReady(normalized)
      .then(() => {
        attachYearListeners(normalized);
        renderAll();
      })
      .catch((err) => {
        console.error(err);
        showToast(err?.message || 'Failed to switch academic year', 'error');
      });
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
    const button = event.target.closest('[data-action][data-adm]');
    if (!button) return;
    const action = button.dataset.action;
    const admission = button.dataset.adm;

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
      const ref = db().ref(`graduation/${state.currentYear}/students/${admission}`);
      const student = state.students?.[admission];
      const before = toStr(student?.notes || '');
      const updated = window.prompt(`Notes for ${student?.name || admission}`, before);
      if (updated === null) return;
      ref.update({
        notes: updated,
        notesUpdatedBy: state.user?.email || 'unknown',
        notesUpdatedAt: firebase.database.ServerValue.TIMESTAMP,
      }).then(() => db().ref(`graduation/${state.currentYear}/audits`).push({
        actor: state.user?.email || 'unknown',
        action: 'student:note',
        refType: 'student',
        refId: admission,
        before,
        after: updated,
        at: firebase.database.ServerValue.TIMESTAMP,
      }));
    } else if (action === 'generate-cert') {
      button.disabled = true;
      button.textContent = 'Generating...';
      generateCertificate(admission, { triggerDownload: true })
        .then(() => showToast('Certificate ready.'))
        .catch((err) => {
          console.error(err);
          showToast(err?.message || 'Generation failed', 'error');
        })
        .finally(() => {
          button.disabled = false;
          button.textContent = 'Generate';
        });
    }
  });

  // ---------- DEBT AUTO-MARKER ----------
  setInterval(() => {
    const cutoff = new Date(state.meta?.debtCutoffISO || `${state.currentYear}-11-07`);
    const now = new Date();
    if (now <= cutoff) return;
    const updates = {};
    Object.entries(state.students || {}).forEach(([key, student]) => {
      if (hasOutstanding(student) && student.status !== 'debt') {
        updates[`graduation/${state.currentYear}/students/${key}/status`] = 'debt';
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
