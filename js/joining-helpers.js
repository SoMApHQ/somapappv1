// Lightweight helpers for Joining & New Applicants (multi-school, multi-year)
// Uses Firebase RTDB compat already loaded on page. Exposes functions on window.JoiningService.
(function () {
  'use strict';

  const firebaseDb = window.db || (window.firebase && window.firebase.database ? window.firebase.database() : null);

  // Resolve school id from URL ?school=, global window.currentSchoolId, or localStorage hint.
  function resolveSchoolId() {
    if (window.currentSchoolId) return window.currentSchoolId;
    const params = new URLSearchParams(window.location.search || '');
    const fromQuery = params.get('school') || params.get('schoolId');
    const stored = (typeof localStorage !== 'undefined') ? localStorage.getItem('somap_school') : '';
    const candidate = fromQuery || stored || '';
    const normalized = (candidate || '').trim() || 'socrates';
    window.currentSchoolId = normalized;
    return normalized;
  }

  // Prefix a relative path with schools/{schoolId}/...
  function withSchoolPath(path) {
    const trimmed = String(path || '').replace(/^\/+/, '');
    const schoolId = resolveSchoolId();
    return schoolId ? `schools/${schoolId}/${trimmed}` : trimmed;
  }

  function nowTs() {
    return Date.now();
  }

  // ---- Settings helpers ----
  async function getJoiningSettings(year) {
    if (!firebaseDb) throw new Error('Database not available');
    const y = String(year || '').trim();
    if (!y) throw new Error('Year is required for joining settings');
    const snap = await firebaseDb.ref(withSchoolPath(`config/joiningSettings/${y}`)).get();
    return snap.val() || null;
  }

  async function setJoiningSettings(year, payload) {
    if (!firebaseDb) throw new Error('Database not available');
    const y = String(year || '').trim();
    if (!y) throw new Error('Year is required for joining settings');
    const data = {
      ...payload,
      lastUpdatedAt: nowTs(),
    };
    await firebaseDb.ref(withSchoolPath(`config/joiningSettings/${y}`)).update(data);
    return data;
  }

  // ---- Joining applications ----
  function buildApplicationDefaults(year, payload) {
    const schoolId = resolveSchoolId();
    const ts = nowTs();
    return {
      schoolId,
      year: Number(year),
      paymentVerificationStatus: 'pending',
      status: 'payment_pending_approval',
      downloadCount: 0,
      createdAt: ts,
      lastUpdatedAt: ts,
      ...payload,
    };
  }

  // Create an approvalsPending entry for joining payments
  async function queueJoiningApproval(year, applicationId, appData) {
    if (!firebaseDb) throw new Error('Database not available');
    const schoolId = resolveSchoolId();
    const pendingRef = firebaseDb.ref('approvalsPending').push();
    const timestamp = nowTs();
    const fullName = [appData.childFirstName, appData.childMiddleName, appData.childLastName].filter(Boolean).join(' ').trim() || 'Joining applicant';
    const record = {
      approvalId: pendingRef.key,
      sourceModule: 'joining',
      joiningApplicationId: applicationId,
      schoolId: schoolId,
      forYear: Number(year),
      studentName: fullName,
      className: appData.classLevel || '',
      parentContact: appData.parentPhone || '',
      amountPaidNow: Number(appData.joiningFeeAmount || 0),
      paymentMethod: appData.paymentChannel || 'mpesaLipa',
      paymentReferenceCode: appData.paymentReference || '',
      datePaid: appData.paymentRecordedAt || timestamp,
      recordedBy: appData.paymentReceiverName || appData.createdByUserId || 'system',
      status: 'pending',
      notes: `Joining form fee (${year})`,
      createdAt: firebase.database?.ServerValue?.TIMESTAMP || timestamp,
      modulePayload: {
        joiningApplicationId: applicationId,
        schoolId: schoolId,
        year: Number(year),
        fee: Number(appData.joiningFeeAmount || 0),
      },
    };
    await pendingRef.set(record);
    return record;
  }

  async function createJoiningApplication(year, payload) {
    if (!firebaseDb) throw new Error('Database not available');
    const y = String(year || '').trim();
    if (!y) throw new Error('Year is required for joining applications');
    const ref = firebaseDb.ref(withSchoolPath(`joiningApplications/${y}`)).push();
    const data = buildApplicationDefaults(y, payload || {});
    await ref.set(data);
    try {
      await queueJoiningApproval(y, ref.key, data);
    } catch (err) {
      console.warn('Failed to queue joining approval', err);
    }
    return { id: ref.key, data };
  }

  async function updateJoiningApplication(year, applicationId, patch) {
    if (!firebaseDb) throw new Error('Database not available');
    const y = String(year || '').trim();
    if (!y || !applicationId) throw new Error('Year and applicationId are required to update');
    const updates = { ...patch, lastUpdatedAt: nowTs() };
    await firebaseDb.ref(withSchoolPath(`joiningApplications/${y}/${applicationId}`)).update(updates);
    return updates;
  }

  // Listen for joining applications of a given year; returns unsubscribe fn.
  function listenJoiningApplications(year, handler) {
    if (!firebaseDb) throw new Error('Database not available');
    const y = String(year || '').trim();
    if (!y) throw new Error('Year is required to listen');
    const ref = firebaseDb.ref(withSchoolPath(`joiningApplications/${y}`));
    const cb = (snap) => {
      const raw = snap.val() || {};
      const list = Object.entries(raw).map(([id, item]) => ({ id, ...(item || {}) }));
      handler(list);
    };
    ref.on('value', cb);
    return () => ref.off('value', cb);
  }

  // ---- Download log ----
  async function logJoiningDownload(year, applicationId, info) {
    if (!firebaseDb) throw new Error('Database not available');
    const y = String(year || '').trim();
    if (!y || !applicationId) throw new Error('Year and applicationId are required for logging downloads');
    const ref = firebaseDb.ref(withSchoolPath(`joiningFormDownloads/${y}`)).push();
    const data = {
      applicationId,
      downloadedAt: nowTs(),
      ...info,
    };
    await ref.set(data);
    return { id: ref.key, data };
  }

  async function deleteJoiningApplication(year, applicationId) {
    if (!firebaseDb) throw new Error('Database not available');
    const y = String(year || '').trim();
    if (!y || !applicationId) throw new Error('Year and applicationId are required to delete');
    await firebaseDb.ref(withSchoolPath(`joiningApplications/${y}/${applicationId}`)).remove();
    return true;
  }

  window.JoiningService = {
    resolveSchoolId,
    withSchoolPath,
    getJoiningSettings,
    setJoiningSettings,
    createJoiningApplication,
    updateJoiningApplication,
    listenJoiningApplications,
    logJoiningDownload,
    deleteJoiningApplication,
  };
})();
