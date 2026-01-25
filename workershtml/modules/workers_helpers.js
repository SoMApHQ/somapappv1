const TZ = 'Africa/Nairobi';
const DAY_START = '07:20';

const fmtYMD = new Intl.DateTimeFormat('en-CA', { timeZone: TZ });
const fmtMonth = new Intl.DateTimeFormat('en-CA', {
  timeZone: TZ,
  year: 'numeric',
  month: '2-digit'
});

/**
 * Return today's date string (YYYY-MM-DD) in TZ.
 */
export function todayYMD(date = new Date()) {
  const parts = fmtYMD.formatToParts(date);
  const year = parts.find(p => p.type === 'year').value;
  const month = parts.find(p => p.type === 'month').value;
  const day = parts.find(p => p.type === 'day').value;
  return `${year}-${month}-${day}`;
}

/**
 * Return YYYYMM string for a Date (defaults to now) in TZ.
 */
export function yyyymm(date = new Date()) {
  const parts = fmtMonth.formatToParts(date);
  const year = parts.find(p => p.type === 'year').value;
  const month = parts.find(p => p.type === 'month').value;
  return `${year}${month}`;
}

export function getYear() {
  return window.somapYearContext?.getSelectedYear?.() || new Date().getFullYear();
}

/**
 * Parse HH:MM string and return { hours, minutes, totalMinutes }.
 */
export function parseHHMM(value) {
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec((value || '').trim());
  if (!match) {
    throw new Error('Invalid time format, expected HH:MM');
  }
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  return { hours, minutes, totalMinutes: hours * 60 + minutes };
}

/**
 * Local timestamp in milliseconds for TZ.
 */
export function localTs(date = new Date()) {
  const localized = new Date(
    date.toLocaleString('en-US', { timeZone: TZ })
  );
  return localized.getTime();
}

/**
 * SHA-256 hash as hex string using Web Crypto.
 */
export async function sha256Hex(value) {
  const encoder = new TextEncoder();
  const buffer = encoder.encode(value);
  const hashBuffer = await crypto.subtle.digest('SHA-256', buffer);
  const bytes = Array.from(new Uint8Array(hashBuffer));
  return bytes.map(b => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Ensure current device is authenticated anonymously.
 */
export async function ensureAnonymousAuth() {
  const auth = firebase.auth();
  const current = auth.currentUser;
  if (current) {
    return current;
  }
  try {
    await auth.signInAnonymously();
    return auth.currentUser;
  } catch (err) {
    // If anonymous auth is disabled, allow the app to continue in read-only mode.
    if (err?.code === 'auth/admin-restricted-operation' || err?.code === 'auth/operation-not-allowed') {
      console.warn('Anonymous auth disabled; continuing without Firebase auth.', err);
      return auth.currentUser || null;
    }
    throw err;
  }
}

/**
 * Link this device auth uid to workerId in /devices.
 */
export async function linkDeviceToWorker(workerId) {
  const user = await ensureAnonymousAuth();
  const ref = firebase.database().ref(`devices/${user.uid}`);
  await ref.update({
    workerId,
    linkedTs: localTs()
  });
  return workerId;
}

/**
 * Resolve workerId linked to current device.
 */
export async function getLinkedWorkerId() {
  const user = firebase.auth().currentUser;
  if (user) {
    const snap = await firebase.database().ref(`devices/${user.uid}/workerId`).once('value');
    if (snap.exists()) return snap.val();
  }
  const cached = localStorage.getItem('workerId') || sessionStorage.getItem('workerId');
  return cached || null;
}

/**
 * Determine if uid is admin.
 */
export async function isAdmin(uid) {
  if (!uid) return false;
  const snap = await firebase.database().ref(`admins/${uid}`).once('value');
  return snap.exists() && snap.val() === true;
}

/**
 * Check if geo point is within radius (meters).
 */
export function inGeofence(lat, lng, center, radiusM) {
  if (!center || typeof center.lat !== 'number' || typeof center.lng !== 'number') {
    return false;
  }
  const R = 6371000;
  const dLat = toRad(lat - center.lat);
  const dLng = toRad(lng - center.lng);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(center.lat)) * Math.cos(toRad(lat)) *
    Math.sin(dLng / 2) * Math.sin(dLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  const distance = R * c;
  return distance <= radiusM;
}

function toRad(value) {
  return (value * Math.PI) / 180;
}

/**
 * Lightweight toast notifications.
 */
export function toast(message, type = 'info', timeoutMs = 4500) {
  const existingHost = document.querySelector('.workers-toast-host');
  const host = existingHost || document.body.appendChild(document.createElement('div'));
  host.className = 'workers-toast-host';

  const el = document.createElement('div');
  el.className = `workers-toast workers-toast-${type}`;
  el.textContent = message;
  host.appendChild(el);
  requestAnimationFrame(() => {
    el.classList.add('visible');
  });
  setTimeout(() => {
    el.classList.remove('visible');
    setTimeout(() => el.remove(), 300);
  }, timeoutMs);
}

export function confirmDialog(message) {
  return window.confirm(message);
}

/**
 * Common RTDB references used across the worker module.
 */
export function schoolRef(db, subPath) {
  return db.ref(SOMAP.P(subPath));
}

export function yearScopedRef(db, subPath) {
  return schoolRef(db, `years/${getYear()}/${subPath}`);
}

export async function scopedOrSocratesLegacy(db, scopedSubPath, legacyPath) {
  const s = SOMAP.getSchool();
  const scopedSnap = await db.ref(SOMAP.P(scopedSubPath)).get();
  if (scopedSnap.exists()) return scopedSnap;
  const isSocrates = ['socrates-school', 'default', 'socrates'].includes(s?.id);
  if (isSocrates) return await db.ref(legacyPath).get();
  return scopedSnap;
}

export function dbRefs(db = firebase.database()) {
  const scoped = (subPath) => schoolRef(db, subPath);
  const yearScoped = (subPath) => scoped(`years/${getYear()}/${subPath}`);
  return {
    workers: yearScoped('workers'),
    workersByLoginKey: yearScoped('workers_index_by_loginKey'),
    workersByStaffNo: yearScoped('workers_by_staffNo'),
    workerAttendance: yearScoped('workerAttendance'),
    penaltiesLedger: yearScoped('workers_penalties_ledger'),
    payroll: yearScoped('workers_payroll'),
    payslips: yearScoped('workers_payslips'),
    inventory: yearScoped('workers_inventory'),
    inventoryLedger: yearScoped('workers_inventory_ledger'),
    roles: yearScoped('workerRoles'),
    approvalsQueue: yearScoped('workers_approvals_queue'),
    settings: yearScoped('workers_settings'),
    worker: workerId => yearScoped(`workers/${workerId}`),
    workerProfile: workerId => yearScoped(`workers/${workerId}/profile`),
    workerDocs: workerId => yearScoped(`workers/${workerId}/docs`),
    workerContract: workerId => yearScoped(`workers/${workerId}/contract`),
    workersRoot: () => yearScoped('workers'),
    workersIndex: loginKey => yearScoped(`workers_index_by_loginKey/${loginKey}`),
    attendanceMonth: (workerId, monthKey) => yearScoped(`workerAttendance/${workerId}/${monthKey}`),
    attendanceDay: (workerId, monthKey, dayKey) => yearScoped(`workerAttendance/${workerId}/${monthKey}/${dayKey}`),
    tasksDay: (workerId, ymd) => yearScoped(`workerTasks/${workerId}/${ymd}`),
    leaveRequests: workerId => yearScoped(`workerLeaveRequests/${workerId}`),
    leaveRequest: (workerId, requestId) => yearScoped(`workerLeaveRequests/${workerId}/${requestId}`),
    penaltiesLedgerMonth: (workerId, monthKey) => yearScoped(`workers_penalties_ledger/${workerId}/${monthKey}`),
    payrollRun: monthKey => yearScoped(`workers_payroll/${monthKey}`),
    payslip: (workerId, monthKey) => yearScoped(`workers_payslips/${workerId}/${monthKey}`),
    nssfMonth: (workerId, monthKey) => yearScoped(`workers_nssf/${workerId}/${monthKey}`),
    inventoryItems: () => yearScoped('workers_inventory/items'),
    inventoryItem: itemId => yearScoped(`workers_inventory/items/${itemId}`),
    rolesCookDaily: dateKey => yearScoped(`workerRoles/cook/daily/${dateKey}`),
    rolesGuardHandover: dateKey => yearScoped(`workerRoles/guard/handover/${dateKey}`),
    rolesCleanerAreas: dateKey => yearScoped(`workerRoles/cleaner/areas/${dateKey}`)
  };
}

/**
 * Fetch workers settings once.
 */
export async function fetchWorkersSettings() {
  const snap = await dbRefs(firebase.database()).settings().once('value');
  return snap.exists() ? snap.val() : null;
}

/**
 * Compute late minutes relative to configured day start.
 */
export function lateMinutes(checkInTs) {
  const { totalMinutes: startMinutes } = parseHHMM(DAY_START);
  const inDate = new Date(checkInTs);
  const ymd = todayYMD(inDate);
  const startDate = new Date(`${ymd}T${DAY_START}:00`);
  const startMs = new Date(
    startDate.toLocaleString('en-US', { timeZone: TZ })
  ).getTime();
  const diffMs = checkInTs - startMs;
  return diffMs > 0 ? Math.round(diffMs / 60000) : 0;
}

/**
 * Utility for safe firebase.database().ref updates with error capture.
 */
export async function safeUpdate(ref, data) {
  try {
    await ref.update(data);
    return true;
  } catch (err) {
    console.error(err);
    toast(err.message || 'Failed to save', 'error');
    return false;
  }
}

export { TZ, DAY_START };


