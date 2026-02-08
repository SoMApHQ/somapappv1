(function () {
  'use strict';

  const ui = {
    trigger: document.getElementById('btnMultiDuplicates'),
    badge: document.getElementById('multiBadge'),
    panel: document.getElementById('multiDuplicatesPanel'),
    tableBody: document.getElementById('multiDuplicatesBody'),
    summary: document.getElementById('multiSummary'),
    deleteBtn: document.getElementById('btnDeleteSelectedDuplicates'),
  };

  if (!ui.trigger || !ui.badge || !ui.panel || !ui.tableBody || !ui.summary) {
    console.warn('[approvals_multiple_payments] Required UI elements missing; aborting init.');
    return;
  }

  const db = window.db || (window.firebase?.database ? window.firebase.database() : null);
  if (!db) {
    console.warn('[approvals_multiple_payments] Firebase database unavailable.');
    return;
  }

  const financeHelpers = window.SOMAP_FINANCE_DEDUPE || window.SOMAP_FINANCE || {};
  const normalizePath = (subPath) => String(subPath || '').replace(/^\/+/, '');
  const resolveSchoolId = () => {
    if (window.SOMAP && typeof window.SOMAP.getSchool === 'function') {
      const school = window.SOMAP.getSchool();
      if (school && school.id) return school.id;
    }
    try {
      return localStorage.getItem('somap.currentSchoolId') || '';
    } catch (_) {
      return '';
    }
  };
  const isSocratesSchool = () => {
    const id = resolveSchoolId();
    return id === 'socrates-school' || id === 'default';
  };
  const P = (subPath) => {
    const trimmed = normalizePath(subPath);
    const id = resolveSchoolId();
    if (!id) return trimmed;
    return `schools/${id}/${trimmed}`;
  };
  const schoolRef = (subPath) => {
    const trimmed = normalizePath(subPath);
    if (window.SOMAP && typeof window.SOMAP.P === 'function') {
      return db.ref(window.SOMAP.P(trimmed));
    }
    return db.ref(P(trimmed));
  };

  let currentGroups = [];

  const fmt = new Intl.NumberFormat('en-TZ', {
    style: 'currency',
    currency: 'TZS',
    maximumFractionDigits: 0,
  });

  const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  function formatCurrency(value) {
    const numeric = Number(value) || 0;
    return fmt.format(numeric).replace('TZS', 'TSh').trim();
  }

  function formatDate(value) {
    const stamp = Number(value);
    if (!Number.isFinite(stamp) || stamp <= 0) return '--';
    const d = new Date(stamp);
    if (Number.isNaN(d.getTime())) return '--';
    return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
  }

  function joinPath(...segments) {
    return segments
      .map((segment) => String(segment || '').replace(/^\/+|\/+$/g, ''))
      .filter(Boolean)
      .join('/');
  }

  function isLikelyApprovalRecord(value) {
    if (!value || typeof value !== 'object') return false;
    return (
      value.sourceModule != null ||
      value.modulePayload != null ||
      value.amountPaidNow != null ||
      value.amount != null ||
      value.studentAdm != null ||
      value.studentName != null
    );
  }

  function collectSnapshotEntries(snapshot, source, { basePath = '', year = '', month = '', seen } = {}) {
    const results = [];
    if (!snapshot || typeof snapshot.forEach !== 'function') return results;
    snapshot.forEach((child) => {
      if (!child.key) return;
      const childVal = child.val() || {};
      if (isLikelyApprovalRecord(childVal)) {
        const dedupeKey = joinPath(basePath, child.key);
        if (seen && seen.has(dedupeKey)) return;
        const recordPath = joinPath(basePath, child.key);
        const row = toRowModel(childVal, source, {
          id: child.key,
          path: recordPath,
          year,
          month,
        });
        results.push(row);
        if (seen) seen.add(dedupeKey);
        return;
      }

      const inferredYear = Number(child.key);
      if (!Number.isFinite(inferredYear) || inferredYear < 2000) return;
      Object.entries(childVal || {}).forEach(([approvalId, payload]) => {
        if (!isLikelyApprovalRecord(payload)) return;
        const nestedPath = joinPath(basePath, child.key, approvalId);
        if (seen && seen.has(nestedPath)) return;
        const row = toRowModel(payload, source, {
          id: approvalId,
          path: nestedPath,
          year: inferredYear,
          month,
        });
        results.push(row);
        if (seen) seen.add(nestedPath);
      });
    });
    return results;
  }

  function getWorkingYear() {
    const apiYear = window.SomapApprovals?.getSelectedYear?.();
    if (apiYear) return Number(apiYear);
    const ctxYear = window.somapYearContext?.getSelectedYear?.();
    if (ctxYear) return Number(ctxYear);
    return new Date().getFullYear();
  }

  function resolveYear(record, fallback) {
    const candidates = [
      record?.forYear,
      record?.academicYear,
      record?.financeYear,
      record?.year,
      record?.targetYear,
      fallback,
    ];
    for (let i = 0; i < candidates.length; i += 1) {
      const candidate = candidates[i];
      if (candidate == null) continue;
      const num = Number(candidate);
      if (Number.isFinite(num) && num > 0) return num;
    }
    const ts = Number(record?.paymentDate || record?.datePaid || record?.createdAt || record?.timestamp);
    if (Number.isFinite(ts)) {
      const d = new Date(ts);
      if (!Number.isNaN(d.getTime())) return d.getFullYear();
    }
    return Number(fallback) || new Date().getFullYear();
  }

  function resolveAmount(record) {
    return Number(
      record?.amountPaidNow ||
        record?.amount ||
        record?.amountClaimed ||
        record?.paidAmount ||
        record?.allocation ||
        record?.value ||
        record?.modulePayload?.payment?.amount ||
        0
    );
  }

  function resolveDateStamp(record) {
    return (
      Number(
        record?.paymentDate ||
          record?.datePaid ||
          record?.timestamp ||
          record?.paidOn ||
          record?.createdAt ||
          record?.modulePayload?.payment?.timestamp
      ) || 0
    );
  }

  function resolveMethod(record) {
    return (
      record?.paymentMethod ||
      record?.method ||
      record?.modulePayload?.payment?.method ||
      ''
    );
  }

  function resolveReference(record) {
    return (
      record?.paymentReferenceCode ||
      record?.referenceCode ||
      record?.refCode ||
      record?.paymentRef ||
      record?.reference ||
      record?.ref ||
      record?.modulePayload?.payment?.referenceCode ||
      record?.modulePayload?.payment?.reference ||
      ''
    );
  }

  function buildFingerprint(record, fallbackYear) {
    if (typeof financeHelpers.buildFinancePaymentFingerprint !== 'function') return '';
    return financeHelpers.buildFinancePaymentFingerprint(record, fallbackYear);
  }

  function toRowModel(raw, source, meta) {
    const year = resolveYear(raw, meta.year);
    const base = { ...raw, approvalId: meta.id, forYear: year };
    const fingerprint = buildFingerprint(base, year);
    return {
      id: meta.id,
      source,
      path: meta.path,
      month: meta.month || '',
      year,
      fingerprint,
      amount: resolveAmount(base),
      paymentDate: resolveDateStamp(base),
      method: resolveMethod(base),
      reference: resolveReference(base),
      studentName: base.studentName || base.name || '',
      studentAdm: base.studentAdm || base.admissionNumber || base.adm || '',
      className: base.className || base.class || '',
      status: base.status || base.finalStatus || (source === 'history' ? 'approved' : 'pending'),
      module: base.sourceModule || base.module || '',
      paidBy: base.paidBy || base.recordedBy || base.modulePayload?.payment?.paidBy || '',
      payerContact: base.payerContact || base.modulePayload?.payment?.payerContact || '',
      studentKey:
        base.modulePayload?.studentKey ||
        base.studentKey ||
        base.studentId ||
        base.modulePayload?.studentId ||
        '',
      raw: base,
    };
  }

  async function fetchPending(year) {
    const rows = [];
    const seen = new Set();
    const scopedBase = 'approvalsPending';
    const scopedSnap = await schoolRef(scopedBase).once('value');
    if (scopedSnap.exists()) {
      rows.push(
        ...collectSnapshotEntries(scopedSnap, 'pending', {
          basePath: scopedBase,
          year,
          seen,
        }),
      );
    }

    const byYearBase = joinPath('approvalsPending', String(year));
    const byYearSnap = await schoolRef(byYearBase).once('value');
    if (byYearSnap.exists()) {
      rows.push(
        ...collectSnapshotEntries(byYearSnap, 'pending', {
          basePath: byYearBase,
          year,
          seen,
        }),
      );
    }

    return rows;
  }

  async function fetchHistory(year) {
    const rows = [];
    const seen = new Set();
    const scopedRoot = 'approvalsHistory';
    const scopedSnap = await schoolRef(joinPath(scopedRoot, String(year))).once('value');
    if (scopedSnap.exists()) {
      scopedSnap.forEach((monthNode) => {
        const monthKey = monthNode.key;
        const monthBase = joinPath(scopedRoot, year, monthKey);
        rows.push(
          ...collectSnapshotEntries(monthNode, 'history', {
            basePath: monthBase,
            year,
            month: monthKey,
            seen,
          }),
        );
      });
    }

    return rows;
  }

  function groupByFingerprint(records, workingYear) {
    const map = new Map();
    records.forEach((rec) => {
      if (Number(rec.year) !== Number(workingYear)) return;
      if (!rec.fingerprint) return;
      const bucket = map.get(rec.fingerprint) || [];
      bucket.push(rec);
      map.set(rec.fingerprint, bucket);
    });
    return Array.from(map.values())
      .filter((bucket) => bucket.length > 1)
      .map((bucket, idx) => ({
        id: `G${idx + 1}`,
        records: bucket.sort((a, b) => Number(a.paymentDate) - Number(b.paymentDate)),
      }));
  }

  function updateBadge(extras) {
    ui.badge.textContent = Number(extras || 0);
  }

  function computeExtras(groups) {
    return groups.reduce((sum, g) => sum + (g.records.length - 1), 0);
  }

  function updateDeleteButtonState() {
    const anyChecked = !!ui.panel.querySelector('.multi-duplicate-checkbox:checked');
    if (ui.deleteBtn) ui.deleteBtn.disabled = !anyChecked;
  }

  function renderGroups(groups) {
    currentGroups = groups;
    if (!ui.tableBody) return;
    if (!groups.length) {
      ui.tableBody.innerHTML = `
        <tr>
          <td colspan="9" class="px-3 py-4 text-center text-sm text-slate-300">No duplicate payments detected for this year.</td>
        </tr>`;
      ui.summary.textContent = 'All clear.';
      updateBadge(0);
      updateDeleteButtonState();
      return;
    }

    const rows = [];
    groups.forEach((group, groupIdx) => {
      group.records.forEach((rec, recIdx) => {
        const keepRow = recIdx === 0;
        const monthLabel = rec.month ? monthNames[(Number(rec.month) || 1) - 1] || rec.month : '--';
        const queueLabel = rec.source === 'pending'
          ? 'Pending queue'
          : `Approved (${monthLabel})`;
        const statusLabel = (rec.status || '').toString().toUpperCase() || (rec.source === 'history' ? 'APPROVED' : 'PENDING');
        const checkboxCell = keepRow
          ? '<span class="text-xs font-semibold text-emerald-300">Keep</span>'
          : `<input type="checkbox" class="multi-duplicate-checkbox accent-rose-500" data-path="${rec.path}" data-year="${rec.year}" data-module="${rec.module}" data-student="${rec.studentKey}" data-approval="${rec.id}" checked />`;

        rows.push(`
          <tr class="border-b border-slate-700/40">
            <td class="px-3 py-2 text-slate-200 font-semibold">${groupIdx + 1}</td>
            <td class="px-3 py-2">
              <div class="text-slate-100 font-semibold">${rec.studentName || '--'}</div>
              <div class="text-xs text-slate-400">${rec.studentAdm || ''}</div>
            </td>
            <td class="px-3 py-2 text-emerald-200 font-semibold">${formatCurrency(rec.amount)}</td>
            <td class="px-3 py-2 text-slate-200">${formatDate(rec.paymentDate)}</td>
            <td class="px-3 py-2 text-slate-200">${resolveMethod(rec.raw) || '--'}</td>
            <td class="px-3 py-2 text-slate-200">${resolveReference(rec.raw) || 'N/A'}</td>
            <td class="px-3 py-2">
              <span class="inline-flex items-center rounded-full bg-slate-800/60 px-2 py-1 text-xs text-slate-100">${statusLabel}</span>
            </td>
            <td class="px-3 py-2 text-slate-200">${queueLabel}</td>
            <td class="px-3 py-2 text-slate-200">${checkboxCell}</td>
          </tr>
        `);
      });
    });

    ui.tableBody.innerHTML = rows.join('');
    ui.summary.textContent = `${groups.length} duplicate group(s) · ${computeExtras(groups)} extra record(s) marked for deletion`;
    updateBadge(computeExtras(groups));
    updateDeleteButtonState();

    const checkboxes = ui.panel.querySelectorAll('.multi-duplicate-checkbox');
    checkboxes.forEach((cb) => cb.addEventListener('change', updateDeleteButtonState));
  }

  async function scan(showPanel) {
    ui.summary.textContent = 'Scanning for duplicate payments...';
    if (ui.deleteBtn) ui.deleteBtn.disabled = true;
    const year = getWorkingYear();
    try {
      const [pending, history] = await Promise.all([fetchPending(year), fetchHistory(year)]);
      const groups = groupByFingerprint([...pending, ...history], year);
      renderGroups(groups);
      if (showPanel) ui.panel.classList.remove('hidden');
    } catch (err) {
      console.error('[approvals_multiple_payments] scan failed', err);
      ui.summary.textContent = 'Failed to scan duplicates. Check console.';
      updateBadge(0);
    }
  }

  async function deleteSelected() {
    const checked = Array.from(ui.panel.querySelectorAll('.multi-duplicate-checkbox:checked'));
    if (!checked.length) return;

    const message = `Delete ${checked.length} duplicate payment(s)? This removes them from approvals immediately.`;
    const confirmed = window.Swal
      ? await Swal.fire({
          icon: 'warning',
          title: 'Delete duplicates?',
          text: message,
          showCancelButton: true,
          confirmButtonColor: '#ef4444',
        }).then((res) => res.isConfirmed)
      : window.confirm(message);
    if (!confirmed) return;

    try {
      const removals = [];
      checked.forEach((cb) => {
        const path = cb.dataset.path;
        if (path) removals.push(schoolRef(path).remove());
        if (cb.dataset.module === 'finance' && cb.dataset.student && cb.dataset.year && cb.dataset.approval) {
          const ledgerPath = `financeLedgers/${cb.dataset.year}/${cb.dataset.student}/payments/${cb.dataset.approval}`;
          removals.push(schoolRef(ledgerPath).remove());
        }
      });
      await Promise.all(removals);
      await scan(true);
    } catch (err) {
      console.error('[approvals_multiple_payments] delete failed', err);
      ui.summary.textContent = 'Delete failed. Check console for details.';
    }
  }

  ui.trigger.addEventListener('click', () => {
    ui.panel.classList.toggle('hidden');
    if (!ui.panel.classList.contains('hidden')) {
      scan(true);
    }
  });

  if (ui.deleteBtn) {
    ui.deleteBtn.addEventListener('click', deleteSelected);
  }

  // Initial badge load (silent)
  scan(false).catch((err) => console.warn('[approvals_multiple_payments] initial scan failed', err));
})();
