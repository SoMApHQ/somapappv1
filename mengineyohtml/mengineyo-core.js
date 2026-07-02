// mengineyo-core.js
// MENGINEYO — Society Project Management Module
// Part of SoMAp. Stored separately under /mengineyoProjects in Firebase.
// Do NOT modify school/Socrates ERP data or paths.

const ME = (() => {

  // ── Currency ──────────────────────────────────────────────
  const CURRENCY_MAP = {
    'Kenya':         { code: 'KES', symbol: 'KSh' },
    'Tanzania':      { code: 'TZS', symbol: 'TSh' },
    'Uganda':        { code: 'UGX', symbol: 'USh' },
    'Rwanda':        { code: 'RWF', symbol: 'RWF' },
    'Ethiopia':      { code: 'ETB', symbol: 'ETB' },
    'Nigeria':       { code: 'NGN', symbol: '₦'   },
    'Ghana':         { code: 'GHS', symbol: 'GHS' },
    'South Africa':  { code: 'ZAR', symbol: 'R'   },
    'Zambia':        { code: 'ZMW', symbol: 'ZMW' },
    'Zimbabwe':      { code: 'ZWL', symbol: 'ZWL' },
    'Malawi':        { code: 'MWK', symbol: 'MWK' },
    'United States': { code: 'USD', symbol: 'USD' },
    'United Kingdom':{ code: 'GBP', symbol: '£'   },
    'Other':         { code: 'USD', symbol: 'USD' },
  };

  function getCurrency(country) {
    return CURRENCY_MAP[country] || { code: 'USD', symbol: 'USD' };
  }

  function formatMoney(amount, currencyObj) {
    const sym = (currencyObj && currencyObj.symbol) ? currencyObj.symbol : 'KSh';
    const num = parseFloat(amount || 0).toLocaleString('en-KE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    return sym + ' ' + num;
  }

  // ── Roles & Permissions ───────────────────────────────────
  const ROLES = ['Chair', 'CEO', 'Director', 'Manager', 'Mchungi', 'Vet', 'Accountant', 'Viewer'];

  const PERMISSIONS = {
    Chair:      { viewAll:true, editAll:true, addOperators:true, assignRoles:true, resetPins:true, viewAudit:true, viewReports:true, approveAll:true, deleteRecords:true, changeSettings:true, recordMilk:true, confirmMilk:true, addAnimals:true, editAnimals:true, recordBirths:true, confirmBirths:true, addHealth:true, recordFinance:true, confirmFinance:true, recordSales:true, viewFinance:true, uploadPhotos:true, approveSales:true },
    CEO:        { viewAll:true, viewReports:true, approveOperations:true, confirmFinance:true, recordSales:true, confirmMilk:true, viewFinance:true, addAnimals:true, addHealth:true, uploadPhotos:true, approveSales:true },
    Director:   { viewAll:true, viewReports:true, approveOperations:true, viewFinance:true, confirmFinance:true },
    Manager:    { confirmMilk:true, recordMilk:true, recordSales:true, recordExpenses:true, confirmBirths:true, confirmFinance:true, viewFinance:true, addAnimals:true, editAnimals:true, recordBirths:true, addHealth:true, uploadPhotos:true, viewReports:true },
    Mchungi:    { recordMilk:true, uploadPhotos:true, recordBirths:true, addHealth:true, viewAnimals:true },
    Vet:        { addHealth:true, viewAnimals:true, recordPregnancy:true },
    Accountant: { recordFinance:true, recordSales:true, recordExpenses:true, viewFinance:true, viewReports:true },
    Viewer:     { viewOnly:true },
  };

  function can(role, perm) {
    const p = PERMISSIONS[role] || PERMISSIONS.Viewer;
    return !!(p.viewAll && perm.startsWith('view')) || !!p[perm] || !!(p.editAll) || !!(p.viewAll && perm === 'viewAll');
  }

  function canDo(perm) {
    const s = getSession();
    if (!s) return false;
    return can(s.role, perm);
  }

  // ── Session ───────────────────────────────────────────────
  const SESSION_KEY = 'mengineyo_session_v1';

  function saveSession(data) {
    try { sessionStorage.setItem(SESSION_KEY, JSON.stringify(data)); } catch(e){}
  }

  function getSession() {
    try {
      const raw = sessionStorage.getItem(SESSION_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch(e) { return null; }
  }

  function clearSession() {
    try { sessionStorage.removeItem(SESSION_KEY); } catch(e){}
  }

  function requireAuth() {
    const s = getSession();
    if (!s || !s.projectId) {
      window.location.href = 'mengineyo-login.html';
      return null;
    }
    return s;
  }

  function requireRole(allowedRoles) {
    const s = requireAuth();
    if (!s) return null;
    if (!allowedRoles.includes(s.role)) {
      showAlert('You do not have permission to view this page.', 'error');
      setTimeout(() => { window.location.href = 'mengineyo-dashboard.html'; }, 1800);
      return null;
    }
    return s;
  }

  // ── PIN Hashing (SHA-256 via SubtleCrypto) ─────────────────
  async function hashPin(pin) {
    const encoder = new TextEncoder();
    const data = encoder.encode('me_salt_2026_' + String(pin).trim());
    const buf = await crypto.subtle.digest('SHA-256', data);
    return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2,'0')).join('');
  }

  async function verifyPin(input, stored) {
    const h = await hashPin(input);
    return h === stored;
  }

  // ── Project Code & ID Helpers ─────────────────────────────
  function generateProjectCode() {
    const yr = new Date().getFullYear();
    const r = Math.random().toString(36).substr(2, 4).toUpperCase();
    return 'ME-' + yr + '-' + r;
  }

  function generateAnimalId(species) {
    const pfx = (species || 'AN').substr(0, 2).toUpperCase();
    const ts = Date.now().toString().slice(-5);
    const r = Math.random().toString(36).substr(2, 2).toUpperCase();
    return pfx + '-' + ts + '-' + r;
  }

  // ── Firebase Helpers ──────────────────────────────────────
  function meRef(projectId, subpath) {
    const base = 'mengineyoProjects/' + projectId;
    const path = subpath ? base + '/' + subpath : base;
    return window.db.ref(path);
  }

  function codeRef(code) {
    return window.db.ref('mengineyoCodes/' + code);
  }

  // ── Timestamps ────────────────────────────────────────────
  function now() { return Date.now(); }
  function isoNow() { return new Date().toISOString(); }
  function todayStr() { return new Date().toISOString().split('T')[0]; }

  function baseRecord(extra) {
    const s = getSession();
    return Object.assign({
      createdAt: now(),
      createdAtISO: isoNow(),
      createdBy: s ? s.operatorId : 'system',
      createdByName: s ? s.operatorName : 'System',
      createdByRole: s ? s.role : 'system',
      updatedAt: now(),
      updatedBy: s ? s.operatorId : 'system',
      updatedByName: s ? s.operatorName : 'System',
      updatedByRole: s ? s.role : 'system',
      status: 'active',
      projectId: s ? s.projectId : null,
      country: s ? s.country : null,
      currency: s ? s.currency : null,
    }, extra || {});
  }

  function updateMeta() {
    const s = getSession();
    return {
      updatedAt: now(),
      updatedBy: s ? s.operatorId : 'system',
      updatedByName: s ? s.operatorName : 'System',
      updatedByRole: s ? s.role : 'system',
    };
  }

  // ── Audit Log ─────────────────────────────────────────────
  async function audit(action, entityType, entityId, extra) {
    const s = getSession();
    if (!s || !s.projectId) return;
    const ref = meRef(s.projectId, 'auditLogs').push();
    await ref.set(Object.assign({
      action,
      entityType: entityType || null,
      entityId: entityId || null,
      projectId: s.projectId,
      performedBy: s.operatorId,
      performedByName: s.operatorName,
      performedByRole: s.role,
      timestamp: now(),
      timestampISO: isoNow(),
    }, extra || {}));
  }

  // ── Photo Upload (Cloudinary) ─────────────────────────────
  async function uploadPhoto(fileInputEl, folder, projectId) {
    if (!fileInputEl || !fileInputEl.files || !fileInputEl.files.length) return null;
    const fd = new FormData();
    fd.append('file', fileInputEl.files[0]);
    fd.append('upload_preset', 'somap_unsigned');
    fd.append('folder', 'mengineyo/' + projectId + '/' + folder);
    const res = await fetch('https://api.cloudinary.com/v1_1/dg7vnrkgd/auto/upload', { method: 'POST', body: fd });
    const json = await res.json();
    return json.secure_url || null;
  }

  // ── Date Formatting ───────────────────────────────────────
  function fmtDate(ts) {
    if (!ts) return '-';
    const d = new Date(typeof ts === 'number' ? ts : ts);
    if (isNaN(d)) return String(ts);
    return d.toLocaleDateString('en-KE', { day:'2-digit', month:'short', year:'numeric' });
  }

  function fmtDateTime(ts) {
    if (!ts) return '-';
    const d = new Date(ts);
    if (isNaN(d)) return String(ts);
    return d.toLocaleString('en-KE');
  }

  function fmtTime(ts) {
    if (!ts) return '-';
    return new Date(ts).toLocaleTimeString('en-KE', { hour:'2-digit', minute:'2-digit' });
  }

  // ── UI Helpers ────────────────────────────────────────────
  function showAlert(msg, type, containerId) {
    const map = {
      success: 'bg-green-50 border-green-500 text-green-800',
      error:   'bg-red-50 border-red-500 text-red-800',
      warning: 'bg-yellow-50 border-yellow-500 text-yellow-800',
      info:    'bg-blue-50 border-blue-500 text-blue-800',
    };
    const cls = map[type] || map.info;
    const el = document.createElement('div');
    el.className = 'border-l-4 p-3 rounded mb-3 text-sm ' + cls;
    el.textContent = msg;
    const box = document.getElementById(containerId || 'meAlert');
    if (box) {
      box.innerHTML = '';
      box.appendChild(el);
      if (type !== 'error') setTimeout(() => { if (el.parentNode) el.remove(); }, 5000);
    }
  }

  function setBtnLoading(btnId, loading, text) {
    const btn = document.getElementById(btnId);
    if (!btn) return;
    btn.disabled = loading;
    if (text) btn.textContent = loading ? 'Please wait…' : text;
  }

  function populateSelect(selectId, items, valueFn, labelFn) {
    const el = document.getElementById(selectId);
    if (!el) return;
    const cur = el.value;
    const opts = items.map(i => {
      const v = valueFn ? valueFn(i) : i;
      const l = labelFn ? labelFn(i) : i;
      return '<option value="' + v + '">' + l + '</option>';
    });
    el.innerHTML = '<option value="">-- Select --</option>' + opts.join('');
    if (cur) el.value = cur;
  }

  function setText(id, val) {
    const el = document.getElementById(id);
    if (el) el.textContent = val || '';
  }

  function setHtml(id, val) {
    const el = document.getElementById(id);
    if (el) el.innerHTML = val || '';
  }

  // ── Auth UI header ────────────────────────────────────────
  function renderHeader() {
    const s = getSession();
    setText('meProjectName', s ? (s.projectName || 'MENGINEYO') : 'MENGINEYO');
    setText('meOperatorInfo', s ? s.operatorName + ' · ' + s.role : '');
  }

  // ── Navigation ────────────────────────────────────────────
  function logout() {
    clearSession();
    window.location.href = 'mengineyo-login.html';
  }

  // ── Constants ─────────────────────────────────────────────
  const COUNTRIES = [
    'Kenya','Tanzania','Uganda','Rwanda','Ethiopia','Nigeria','Ghana',
    'South Africa','Zambia','Zimbabwe','Malawi','Mozambique',
    'United States','United Kingdom','Other'
  ];

  const ACTIVITIES = [
    'Cattle','Goats','Sheep','Chicken','Pigs','Maize','Beans',
    'Vegetables','Fish','Rentals','Shop','Transport','Land','Other'
  ];

  const SPECIES = ['Cattle','Goat','Sheep','Chicken','Pig','Other'];

  const ANIMAL_STATUS = ['active','sold','dead','missing','transferred','deleted'];
  const PREG_STATUS   = ['Not pregnant','Suspected pregnant','Confirmed pregnant','Recently gave birth','Not applicable'];
  const MILK_STATUS   = ['Lactating','Dry','Not applicable'];
  const CONFIRM_STATUS= ['Draft','Submitted','Confirmed','Rejected'];

  const INCOME_CATS   = ['Milk sales','Animal sales','Manure','Breeding service','Other income'];
  const EXPENSE_CATS  = ['Mchungi salary','Vet','Medicine','Transport','Feed','Repairs','Purchase of animal','Water','Phone/data','Other expense'];

  const HEALTH_TYPES  = ['Sickness','Injury','Vaccination','Deworming','Pregnancy check','Routine check','Treatment','Death report'];

  // ── Public API ────────────────────────────────────────────
  return {
    CURRENCY_MAP, getCurrency, formatMoney,
    ROLES, PERMISSIONS, can, canDo,
    saveSession, getSession, clearSession, requireAuth, requireRole,
    hashPin, verifyPin,
    generateProjectCode, generateAnimalId,
    meRef, codeRef,
    now, isoNow, todayStr, baseRecord, updateMeta,
    audit,
    uploadPhoto,
    fmtDate, fmtDateTime, fmtTime,
    showAlert, setBtnLoading, populateSelect, setText, setHtml,
    renderHeader, logout,
    COUNTRIES, ACTIVITIES, SPECIES,
    ANIMAL_STATUS, PREG_STATUS, MILK_STATUS, CONFIRM_STATUS,
    INCOME_CATS, EXPENSE_CATS, HEALTH_TYPES,
  };
})();
