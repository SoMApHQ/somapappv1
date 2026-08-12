(function () {
  const db = window.db || firebase.database();
  const SOMAP = window.SOMAP || {};
  const rowsEl = document.getElementById('requestRows');
  const statusEl = document.getElementById('hqStatus');
  const guardEl = document.getElementById('hqGuardMessage');
  const tableWrapper = document.getElementById('tableWrapper');
  const reportStatusEl = document.getElementById('reportStatus');
  const downloadReportBtn = document.getElementById('downloadReportBtn');
  const HQ_ID = 'socrates-school';

  let requestsRef = null;
  let pendingMap = new Map();
  let allEntries = [];

  function getCurrentSchoolId() {
    return SOMAP && typeof SOMAP.getSchoolId === 'function' ? SOMAP.getSchoolId() : null;
  }

  function guardAccess() {
    const sid = getCurrentSchoolId();
    if (sid === HQ_ID) {
      if (guardEl) guardEl.textContent = '';
      if (tableWrapper) tableWrapper.style.display = '';
      return true;
    }
    if (guardEl) {
      guardEl.textContent = 'Only SoMAp HQ (Socrates) can approve schools.';
    }
    if (tableWrapper) tableWrapper.style.display = 'none';
    return false;
  }

  function formatDate(ts) {
    if (!ts) return '—';
    try {
      const d = new Date(ts);
      if (isNaN(d.getTime())) return '—';
      return d.toISOString().slice(0, 10);
    } catch (_err) {
      return '—';
    }
  }

  function makeSchoolId(name) {
    return (
      String(name || '')
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '') || 'school-' + Date.now()
    );
  }

  function normalizeRequest(id, raw) {
    raw = raw || {};
    // Support the legacy nested {school, contact} shape as well as the flat
    // shape actually written by multischool.js's registration form.
    const school = raw.school || {};
    const contact = raw.contact || {};
    const derivedName = school.name || raw.name || raw.schoolName || '';
    const levels = Array.isArray(raw.levels) ? raw.levels : (raw.levels ? [raw.levels] : []);
    const banks = Array.isArray(raw.banks) ? raw.banks : (raw.banks ? [raw.banks] : []);
    const languages = Array.isArray(raw.languages) ? raw.languages : (raw.languages ? [raw.languages] : []);

    const schoolData = {
      name: derivedName,
      shortName: school.shortName || raw.shortName || derivedName,
      type: school.type || raw.ownershipType || raw.schoolType || raw.type || '',
      level: school.level || levels.join(', ') || raw.schoolLevel || raw.level || '',
      country: school.country || raw.country || '',
      region: school.region || raw.region || '',
      district: school.district || raw.district || '',
      ward: school.ward || raw.ward || '',
      village: school.village || raw.village || '',
      location: school.location || raw.location || '',
      phone: school.phone || raw.phone || '',
      email: school.email || raw.schoolEmail || raw.email || '',
      registrationNumber: school.registrationNumber || raw.registrationNumber || raw.registrationNo || '',
      avgStudents: raw.avgStudents || school.avgStudents || '',
      poBox: raw.poBox || school.poBox || '',
      banks,
      dayBoardingType: raw.dayBoardingType || school.dayBoardingType || '',
      languages,
      plan: raw.plan || school.plan || '',
      reason: raw.reason || school.reason || ''
    };

    const contactData = {
      ownerName: contact.ownerName || raw.ownerName || '',
      ownerPhone: contact.ownerPhone || raw.ownerPhone || raw.phone || '',
      ownerEmail: contact.ownerEmail || raw.ownerEmail || raw.email || raw.schoolEmail || ''
    };

    const status = (raw.status || 'pending').toLowerCase();
    const submittedAt = raw.submittedAt || raw.createdAt || raw.created_at || null;
    const logoUrl = raw.logoUrl || school.logoUrl || raw.logo || '';
    const schoolId = raw.schoolId || raw.schoolKey || null;

    return { id, status, submittedAt, school: schoolData, contact: contactData, logoUrl, schoolId };
  }

  function renderRows(data) {
    const entries = Object.entries(data || {}).map(([id, raw]) => normalizeRequest(id, raw));
    allEntries = entries;
    const pending = entries.filter(r => !r.status || r.status === 'pending');
    pendingMap = new Map(pending.map(r => [r.id, r]));

    if (!pending.length) {
      rowsEl.innerHTML = '<tr><td colspan="8" class="px-4 py-6 text-center text-slate-300">No pending school registrations.</td></tr>';
      statusEl.textContent = '';
      return;
    }

    rowsEl.innerHTML = pending.map(r => {
      const location = [r.school.location, r.school.district, r.school.ward, r.school.village, r.school.region, r.school.country].filter(Boolean).join(', ');
      const owner = r.contact.ownerName || '—';
      const contact = r.contact.ownerPhone || r.school.phone || '—';
      const typeLevel = [r.school.type, r.school.level].filter(Boolean).join(' / ');

      return `
        <tr class="hover:bg-white/5 transition">
          <td class="px-4 py-3 font-semibold text-slate-100">${r.school.name || 'Unnamed School'}</td>
          <td class="px-4 py-3">${typeLevel || '—'}</td>
          <td class="px-4 py-3 text-slate-300">${location || '—'}</td>
          <td class="px-4 py-3 text-slate-300">${owner}</td>
          <td class="px-4 py-3 text-slate-300">${contact}</td>
          <td class="px-4 py-3">${formatDate(r.submittedAt)}</td>
          <td class="px-4 py-3">
            <span class="px-2 py-1 rounded-full bg-amber-500/15 border border-amber-400/30 text-amber-100 text-xs font-semibold">Pending</span>
          </td>
          <td class="px-4 py-3 space-x-2">
            <button class="px-3 py-2 rounded-lg bg-emerald-500 text-slate-900 font-semibold hover:bg-emerald-400" data-action="approve" data-id="${r.id}">Approve</button>
            <button class="px-3 py-2 rounded-lg bg-rose-500/80 text-white font-semibold hover:bg-rose-500" data-action="reject" data-id="${r.id}">Reject</button>
          </td>
        </tr>
      `;
    }).join('');

    statusEl.textContent = '';
  }

  function setButtonsDisabled(id, isDisabled) {
    if (!rowsEl) return;
    rowsEl.querySelectorAll(`button[data-id="${id}"]`).forEach(btn => {
      btn.disabled = isDisabled;
      btn.classList.toggle('opacity-50', isDisabled);
      btn.classList.toggle('pointer-events-none', isDisabled);
    });
  }

  async function approveRequest(requestId) {
    const request = pendingMap.get(requestId);
    if (!request) return;

    const approverId = getCurrentSchoolId();
    if (approverId !== HQ_ID) {
      alert('Only SoMAp HQ (Socrates) can approve schools.');
      return;
    }

    setButtonsDisabled(requestId, true);
    const now = Date.now();
    const schoolId = request.schoolId || makeSchoolId(request.school.name || request.school.shortName || 'school');
    const logoUrl = request.logoUrl || request.school.logoUrl || '';

    const meta = {
      schoolName: request.school.name || 'School',
      shortName: request.school.shortName || request.school.name || 'School',
      name: request.school.name || 'School',
      type: request.school.type || '',
      level: request.school.level || '',
      country: request.school.country || '',
      region: request.school.region || request.school.country || '',
      district: request.school.district || '',
      ward: request.school.ward || '',
      village: request.school.village || '',
      location: request.school.location || '',
      phone: request.school.phone || request.contact.ownerPhone || '',
      email: request.school.email || request.contact.ownerEmail || '',
      ownerName: request.contact.ownerName || '',
      ownerPhone: request.contact.ownerPhone || '',
      ownerEmail: request.contact.ownerEmail || '',
      registrationNumber: request.school.registrationNumber || '',
      avgStudents: request.school.avgStudents || '',
      poBox: request.school.poBox || '',
      banks: request.school.banks || [],
      dayBoardingType: request.school.dayBoardingType || '',
      languages: request.school.languages || [],
      plan: request.school.plan || '',
      logoUrl
    };

    const updates = {};
    updates[`schools/${schoolId}/meta`] = meta;
    updates[`schools/${schoolId}/status`] = 'active';
    updates[`schools/${schoolId}/approvedAt`] = now;
    updates[`schools/${schoolId}/approvedBy`] = approverId;
    updates[`schools/${schoolId}/requestId`] = requestId;
    if (logoUrl) {
      updates[`schools/${schoolId}/profile/logoUrl`] = logoUrl;
    }
    updates[`schoolRequests/${requestId}/status`] = 'approved';
    updates[`schoolRequests/${requestId}/approvedAt`] = now;
    updates[`schoolRequests/${requestId}/approvedBy`] = approverId;
    updates[`schoolRequests/${requestId}/approvedSchoolId`] = schoolId;

    try {
      await db.ref().update(updates);
      alert('School approved and activated.');
    } catch (err) {
      console.error(err);
      alert(err?.message || 'Failed to approve school.');
      setButtonsDisabled(requestId, false);
    }
  }

  async function rejectRequest(requestId) {
    const request = pendingMap.get(requestId);
    if (!request) return;

    const approverId = getCurrentSchoolId();
    if (approverId !== HQ_ID) {
      alert('Only SoMAp HQ (Socrates) can reject schools.');
      return;
    }

    const reason = prompt('Reason for rejection? (optional)') || '';
    setButtonsDisabled(requestId, true);

    try {
      await db.ref(`schoolRequests/${requestId}`).update({
        status: 'rejected',
        rejectedAt: Date.now(),
        rejectionReason: reason
      });
    } catch (err) {
      console.error(err);
      alert(err?.message || 'Failed to reject school.');
      setButtonsDisabled(requestId, false);
    }
  }

  function attachListener() {
    if (requestsRef) requestsRef.off();
    requestsRef = db.ref('schoolRequests');
    requestsRef.on(
      'value',
      snap => renderRows(snap.val() || {}),
      err => {
        console.error(err);
        statusEl.textContent = 'Failed to load school requests.';
      }
    );
  }

  function handleActions(e) {
    const btn = e.target.closest('button[data-action]');
    if (!btn) return;
    const requestId = btn.getAttribute('data-id');
    const action = btn.getAttribute('data-action');
    if (action === 'approve') approveRequest(requestId);
    if (action === 'reject') rejectRequest(requestId);
  }

  async function handleDownloadReport() {
    if (!allEntries.length) {
      if (reportStatusEl) reportStatusEl.textContent = 'No school registrations to report yet.';
      return;
    }
    if (!window.SomapSchoolsReportPdf) {
      if (reportStatusEl) reportStatusEl.textContent = 'PDF generator failed to load. Refresh and try again.';
      return;
    }
    downloadReportBtn.disabled = true;
    downloadReportBtn.textContent = 'Building PDF...';
    if (reportStatusEl) reportStatusEl.textContent = 'Fetching logos and building the report...';
    try {
      await window.SomapSchoolsReportPdf.downloadReport(allEntries);
      if (reportStatusEl) reportStatusEl.textContent = '';
    } catch (err) {
      console.error(err);
      if (reportStatusEl) reportStatusEl.textContent = err?.message || 'Failed to build report.';
    } finally {
      downloadReportBtn.disabled = false;
      downloadReportBtn.textContent = 'Download Full Report (PDF)';
    }
  }

  document.addEventListener('DOMContentLoaded', () => {
    guardAccess();
    if (guardAccess()) {
      attachListener();
    }
    rowsEl?.addEventListener('click', handleActions);
    downloadReportBtn?.addEventListener('click', handleDownloadReport);
  });
})();
