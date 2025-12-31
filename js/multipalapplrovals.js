// js/multipalapplrovals.js
// Duplicate approvals cleaner + bulk approve helper for approvals.html

(function () {
  const db = window.db || (window.firebase?.database ? window.firebase.database() : null);
  const btnDuplicates = document.getElementById('btnMultiDuplicates');
  const badge = document.getElementById('multiBadge');
  const btnApproveAll = document.getElementById('btnApproveAll');

  if (!db) {
    console.warn('multipalapplrovals: Firebase db not available.');
    return;
  }

  const P = (subPath) => (window.SOMAP && typeof window.SOMAP.P === 'function' ? window.SOMAP.P(subPath) : subPath);
  const getWorkingYear = () => {
    const ctx = window.somapYearContext;
    if (ctx && typeof ctx.getSelectedYear === 'function') return ctx.getSelectedYear();
    return new Date().getFullYear();
  };

  const safeUpper = (value) => (value == null ? '' : String(value).trim().toUpperCase());
  const safeLower = (value) => (value == null ? '' : String(value).trim().toLowerCase());
  const safeStr = (value) => (value == null ? '' : String(value).trim());

  const fmtCurrency = (amount) => {
    const numeric = Number(amount) || 0;
    return `TSh ${numeric.toLocaleString('en-TZ')}`;
  };

  const resolveAmount = (record) => Number(
    record?.amountPaidNow ||
    record?.amount ||
    record?.claimedAmount ||
    record?.paidAmount ||
    record?.allocation ||
    record?.modulePayload?.payment?.amount ||
    0
  );

  const resolveDate = (record) => (
    record?.paymentDate ||
    record?.datePaid ||
    record?.createdAt ||
    record?.modulePayload?.payment?.timestamp ||
    record?.timestamp ||
    ''
  );

  const resolveYear = (record, fallback) => {
    const fallbackYear = fallback || new Date().getFullYear();
    const explicitYear = record?.forYear || record?.academicYear || record?.financeYear || record?.year;
    if (explicitYear) return Number(explicitYear);
    const dateValue = resolveDate(record);
    const stamp = Number(dateValue);
    if (Number.isFinite(stamp) && stamp > 0) {
      const d = new Date(stamp);
      const year = d.getFullYear();
      if (Number.isFinite(year)) return year;
    }
    return Number(fallbackYear);
  };

  const buildIdentity = (record, fallbackYear) => {
    if (!record) return '';
    const year = resolveYear(record, fallbackYear);
    const student = safeUpper(
      record.studentAdm ||
      record.admissionNo ||
      record.admissionNumber ||
      record.studentId ||
      record.modulePayload?.studentKey ||
      ''
    );
    const name = safeUpper(record.studentName || record.fullName || record.name);
    const amount = resolveAmount(record);
    const date = safeStr(resolveDate(record));
    const method = safeUpper(
      record.paymentMethod ||
      record.method ||
      record.modulePayload?.payment?.method ||
      ''
    );
    const ref = safeUpper(
      record.paymentReferenceCode ||
      record.referenceCode ||
      record.refCode ||
      record.receipt ||
      record.bankRef ||
      record.mpesaRef ||
      record.modulePayload?.payment?.referenceCode ||
      record.modulePayload?.payment?.reference ||
      'N/A'
    );
    const paidBy = safeUpper(
      record.paidBy ||
      record.modulePayload?.payment?.paidBy ||
      ''
    );
    const contact = safeStr(
      record.payerContact ||
      record.modulePayload?.payment?.payerContact ||
      ''
    );
    const moduleName = safeUpper(record.sourceModule || record.module || 'FINANCE');
    return [year, student, name, moduleName, amount, date, method, ref, paidBy, contact].join('|');
  };

  const normalizeStatus = (value) => {
    const val = safeLower(value);
    if (!val) return 'pending';
    if (val.includes('reject')) return 'rejected';
    if (val.includes('approve')) return 'approved';
    if (val.includes('pending')) return 'pending';
    return val;
  };

  const inferYearMatch = (record, workingYear) => String(resolveYear(record, workingYear)) === String(workingYear);

  async function fetchCandidates(workingYear) {
    const records = [];

    const pendingSnap = await db.ref(P('approvalsPending')).once('value');
    if (pendingSnap.exists()) {
      pendingSnap.forEach((child) => {
        const value = child.val() || {};
        if (!inferYearMatch(value, workingYear)) return;
        records.push({
          id: child.key,
          source: 'pending',
          data: { ...value, approvalId: child.key },
        });
      });
    }

    const historySnap = await db.ref(P('approvalsHistory')).once('value');
    if (historySnap.exists()) {
      historySnap.forEach((yearNode) => {
        if (String(yearNode.key) !== String(workingYear)) return;
        yearNode.forEach((monthNode) => {
          monthNode.forEach((entry) => {
            const value = entry.val() || {};
            records.push({
              id: entry.key,
              source: 'history',
              historyYear: yearNode.key,
              historyMonth: monthNode.key,
              data: { ...value, approvalId: entry.key },
            });
          });
        });
      });
    }

    return records;
  }

  function groupDuplicates(records, workingYear) {
    const groups = new Map();
    records.forEach((entry) => {
      const key = buildIdentity(entry.data, workingYear);
      if (!key) return;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(entry);
    });

    const flatRows = [];
    let duplicateCount = 0;

    groups.forEach((list, key) => {
      if (list.length <= 1) return;
      const sorted = [...list].sort((a, b) => Number(a.data.datePaid || a.data.createdAt || 0) - Number(b.data.datePaid || b.data.createdAt || 0));
      sorted.forEach((row, index) => {
        if (index > 0) duplicateCount += 1;
        flatRows.push({
          ...row,
          identityKey: key,
          groupSize: list.length,
          defaultDelete: index > 0,
        });
      });
    });

    return { flatRows, duplicateCount, groupCount: groups.size };
  }

  let overlay = null;
  let overlayTableBody = null;
  let currentRows = [];

  function closeOverlay() {
    if (overlay) {
      overlay.remove();
      overlay = null;
      overlayTableBody = null;
      currentRows = [];
    }
  }

  function ensureOverlay() {
    if (overlay) return overlay;
    overlay = document.createElement('div');
    overlay.id = 'multi-approvals-overlay';
    overlay.style.position = 'fixed';
    overlay.style.inset = '0';
    overlay.style.background = 'rgba(0,0,0,0.55)';
    overlay.style.zIndex = '9999';
    overlay.style.display = 'flex';
    overlay.style.alignItems = 'center';
    overlay.style.justifyContent = 'center';
    overlay.style.padding = '1rem';

    const panel = document.createElement('div');
    panel.style.background = 'white';
    panel.style.color = '#0f172a';
    panel.style.width = 'min(1100px, 98vw)';
    panel.style.maxHeight = '90vh';
    panel.style.borderRadius = '16px';
    panel.style.boxShadow = '0 20px 60px rgba(0,0,0,0.25)';
    panel.style.display = 'flex';
    panel.style.flexDirection = 'column';
    panel.style.overflow = 'hidden';
    overlay.appendChild(panel);

    const header = document.createElement('div');
    header.style.display = 'flex';
    header.style.alignItems = 'center';
    header.style.justifyContent = 'space-between';
    header.style.padding = '14px 18px';
    header.style.borderBottom = '1px solid #e2e8f0';
    panel.appendChild(header);

    const title = document.createElement('div');
    title.innerHTML = `
      <div style="font-size:1rem;font-weight:700;">Multiple Payment Entries</div>
      <div style="font-size:0.85rem;color:#475569;">Same student + amount + date + method + reference will appear here. Tick the extra copies to delete from approvals and finance ledgers.</div>
    `;
    header.appendChild(title);

    const headerBtns = document.createElement('div');
    headerBtns.style.display = 'flex';
    headerBtns.style.gap = '0.5rem';
    header.appendChild(headerBtns);

    const deleteBtn = document.createElement('button');
    deleteBtn.id = 'multiDeleteSelected';
    deleteBtn.textContent = 'Delete Selected';
    deleteBtn.style.background = '#b91c1c';
    deleteBtn.style.color = 'white';
    deleteBtn.style.border = 'none';
    deleteBtn.style.padding = '8px 12px';
    deleteBtn.style.borderRadius = '999px';
    deleteBtn.style.cursor = 'pointer';
    headerBtns.appendChild(deleteBtn);

    const closeBtn = document.createElement('button');
    closeBtn.textContent = 'Close';
    closeBtn.style.background = '#e2e8f0';
    closeBtn.style.border = 'none';
    closeBtn.style.padding = '8px 12px';
    closeBtn.style.borderRadius = '999px';
    closeBtn.style.cursor = 'pointer';
    headerBtns.appendChild(closeBtn);

    closeBtn.addEventListener('click', closeOverlay);

    const summary = document.createElement('div');
    summary.id = 'multiSummary';
    summary.style.padding = '10px 18px';
    summary.style.borderBottom = '1px solid #e2e8f0';
    summary.style.background = '#f8fafc';
    summary.style.fontSize = '0.9rem';
    summary.style.display = 'flex';
    summary.style.gap = '1rem';
    panel.appendChild(summary);

    const wrapper = document.createElement('div');
    wrapper.style.flex = '1';
    wrapper.style.overflow = 'auto';
    panel.appendChild(wrapper);

    const table = document.createElement('table');
    table.style.width = '100%';
    table.style.borderCollapse = 'collapse';
    wrapper.appendChild(table);

    const thead = document.createElement('thead');
    thead.innerHTML = `
      <tr style="background:#f1f5f9;font-size:0.85rem;text-align:left;">
        <th style="padding:10px;border-bottom:1px solid #e2e8f0;">Delete?</th>
        <th style="padding:10px;border-bottom:1px solid #e2e8f0;">Student</th>
        <th style="padding:10px;border-bottom:1px solid #e2e8f0;">ADM</th>
        <th style="padding:10px;border-bottom:1px solid #e2e8f0;">Amount</th>
        <th style="padding:10px;border-bottom:1px solid #e2e8f0;">Date</th>
        <th style="padding:10px;border-bottom:1px solid #e2e8f0;">Method</th>
        <th style="padding:10px;border-bottom:1px solid #e2e8f0;">Reference</th>
        <th style="padding:10px;border-bottom:1px solid #e2e8f0;">Paid By</th>
        <th style="padding:10px;border-bottom:1px solid #e2e8f0;">Contact</th>
        <th style="padding:10px;border-bottom:1px solid #e2e8f0;">Module</th>
        <th style="padding:10px;border-bottom:1px solid #e2e8f0;">Status</th>
        <th style="padding:10px;border-bottom:1px solid #e2e8f0;">Group</th>
      </tr>
    `;
    table.appendChild(thead);

    overlayTableBody = document.createElement('tbody');
    table.appendChild(overlayTableBody);

    deleteBtn.addEventListener('click', handleDeleteSelected);

    document.body.appendChild(overlay);
    return overlay;
  }

  function renderSummary(rows) {
    const summary = document.getElementById('multiSummary');
    if (!summary) return;
    if (!rows.length) {
      summary.textContent = 'No duplicate payments detected for this year.';
      return;
    }
    const totalExtras = rows.filter((r) => r.defaultDelete).length;
    const affectedStudents = new Set(rows.map((r) => safeUpper(r.data.studentAdm || r.data.studentId || r.data.studentName || '')));
    summary.textContent = `${totalExtras} duplicate entries selected by default · ${affectedStudents.size} students affected`;
  }

  function renderOverlayRows(rows) {
    ensureOverlay();
    currentRows = rows;
    if (!overlayTableBody) return;
    overlayTableBody.innerHTML = '';

    if (!rows.length) {
      const tr = document.createElement('tr');
      const td = document.createElement('td');
      td.colSpan = 12;
      td.style.padding = '18px';
      td.style.textAlign = 'center';
      td.textContent = 'No multiple payment entries found. Great!';
      tr.appendChild(td);
      overlayTableBody.appendChild(tr);
      renderSummary(rows);
      return;
    }

    rows.forEach((row, index) => {
      const p = row.data || {};
      const tr = document.createElement('tr');
      tr.style.borderBottom = '1px solid #e2e8f0';
      tr.dataset.index = String(index);

      const addCell = (html) => {
        const td = document.createElement('td');
        td.style.padding = '10px';
        td.style.fontSize = '0.9rem';
        td.innerHTML = html;
        tr.appendChild(td);
      };

      const checkboxCell = document.createElement('td');
      checkboxCell.style.padding = '10px';
      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.className = 'multi-delete-checkbox';
      checkbox.checked = !!row.defaultDelete;
      checkbox.dataset.index = String(index);
      checkboxCell.appendChild(checkbox);
      tr.appendChild(checkboxCell);

      addCell(`<div style="font-weight:700;">${p.studentName || '--'}</div><div style="color:#475569;font-size:0.8rem;">${p.studentAdm || ''}</div>`);
      addCell(p.studentAdm || '--');
      addCell(fmtCurrency(resolveAmount(p)));
      addCell(p.paymentDate || p.datePaid || p.createdAt || '--');
      addCell(p.paymentMethod || p.method || p.modulePayload?.payment?.method || '--');
      addCell(p.paymentReferenceCode || p.referenceCode || p.receipt || p.bankRef || p.mpesaRef || '—');
      addCell(p.paidBy || p.modulePayload?.payment?.paidBy || '—');
      addCell(p.payerContact || p.modulePayload?.payment?.payerContact || '—');
      addCell(p.sourceModule || p.module || 'finance');
      addCell(normalizeStatus(p.status));
      addCell(`${row.groupSize}x`);

      overlayTableBody.appendChild(tr);
    });

    renderSummary(rows);
  }

  async function loadAndRender() {
    const year = getWorkingYear();
    const records = await fetchCandidates(year);
    const { flatRows, duplicateCount } = groupDuplicates(records, year);
    updateBadge(duplicateCount);
    renderOverlayRows(flatRows);
    return { duplicateCount };
  }

  function updateBadge(count) {
    if (!badge) return;
    badge.textContent = Number(count || 0);
    badge.style.display = 'inline-flex';
    if (btnDuplicates) {
      btnDuplicates.style.display = count ? 'inline-flex' : 'inline-flex';
    }
  }

  async function handleDeleteSelected() {
    if (!currentRows.length) {
      alert('No duplicates loaded.');
      return;
    }
    const checkboxes = overlay?.querySelectorAll('.multi-delete-checkbox');
    if (!checkboxes || !checkboxes.length) {
      alert('No duplicates loaded.');
      return;
    }
    const selected = [];
    checkboxes.forEach((cb) => {
      if (cb.checked) {
        const idx = Number(cb.dataset.index || -1);
        if (Number.isInteger(idx) && idx >= 0 && idx < currentRows.length) {
          selected.push(currentRows[idx]);
        }
      }
    });

    if (!selected.length) {
      alert('Select at least one entry to delete.');
      return;
    }

    if (!confirm('Delete selected duplicate payments from approvals and finance ledgers? This cannot be undone.')) {
      return;
    }

    const workingYear = getWorkingYear();
    const updates = {};
    const identityKeys = new Set();

    selected.forEach((row) => {
      identityKeys.add(row.identityKey);
      if (row.source === 'pending') {
        updates[P(`approvalsPending/${row.id}`)] = null;
      } else if (row.source === 'history') {
        updates[P(`approvalsHistory/${row.historyYear}/${row.historyMonth}/${row.id}`)] = null;
      }
    });

    try {
      if (Object.keys(updates).length) {
        await db.ref().update(updates);
      }
      await purgeFinanceLedger(identityKeys, workingYear);
      alert('Selected duplicates removed. Refreshing list...');
      const { flatRows, duplicateCount } = groupDuplicates(await fetchCandidates(workingYear), workingYear);
      updateBadge(duplicateCount);
      renderOverlayRows(flatRows);
    } catch (err) {
      console.error('multipalapplrovals: delete failed', err);
      alert('Failed to delete some entries. Check console for details.');
    }
  }

  async function purgeFinanceLedger(identityKeys, workingYear) {
    if (!identityKeys || !identityKeys.size) return;
    const ledgerSnap = await db.ref(P(`financeLedgers/${workingYear}`)).once('value');
    if (!ledgerSnap.exists()) return;

    const updates = {};
    ledgerSnap.forEach((studentNode) => {
      const studentKey = studentNode.key;
      const paymentsNode = studentNode.child('payments');
      const payments = paymentsNode.exists() ? paymentsNode.val() : studentNode.val();
      const basePath = paymentsNode.exists()
        ? `${studentKey}/payments`
        : `${studentKey}`;

      Object.entries(payments || {}).forEach(([payKey, payment]) => {
        const decorated = {
          ...payment,
          studentAdm: payment?.studentAdm || payment?.studentId || payment?.admissionNo || studentKey,
          sourceModule: payment?.module || payment?.sourceModule || 'finance',
          amountPaidNow: payment?.amount,
          paymentMethod: payment?.method,
          paymentReferenceCode: payment?.referenceCode || payment?.refCode || payment?.receipt,
          paidBy: payment?.paidBy,
          payerContact: payment?.payerContact,
          paymentDate: payment?.timestamp || payment?.paymentDate || payment?.date,
          year: payment?.forYear || payment?.academicYear || payment?.financeYear || workingYear,
        };
        const idKey = buildIdentity(decorated, workingYear);
        if (identityKeys.has(idKey)) {
          updates[P(`financeLedgers/${workingYear}/${basePath}/${payKey}`)] = null;
        }
      });
    });

    if (Object.keys(updates).length) {
      await db.ref().update(updates);
    }
  }

  async function initBadge() {
    try {
      const year = getWorkingYear();
      const records = await fetchCandidates(year);
      const { duplicateCount } = groupDuplicates(records, year);
      updateBadge(duplicateCount);
    } catch (err) {
      console.warn('multipalapplrovals: failed to init badge', err);
    }
  }

  async function handleApproveAllClick() {
    if (!btnApproveAll) return;
    const api = window.SomapApprovals || {};
    if (!api.approveMany || !api.getPendingList) {
      alert('Approve-all hook not ready yet. Ensure approvals.js loaded.');
      return;
    }
    const pending = (api.getPendingList() || []).filter((r) => normalizeStatus(r.status) === 'pending');
    if (!pending.length) {
      alert('No pending approvals to approve.');
      return;
    }
    if (!confirm(`Approve all ${pending.length} pending payments? Make sure duplicates are cleaned first.`)) {
      return;
    }
    btnApproveAll.disabled = true;
    const originalText = btnApproveAll.textContent;
    btnApproveAll.textContent = 'Approving...';
    try {
      const result = await api.approveMany(pending);
      alert(`Approved ${result.processedCount} payments. ${result.failureCount || 0} failed (see console if any).`);
    } catch (err) {
      console.error('multipalapplrovals: approve-all failed', err);
      alert('Approve-all failed. Check console.');
    } finally {
      btnApproveAll.disabled = false;
      btnApproveAll.textContent = originalText;
    }
  }

  function wireButtons() {
    if (btnDuplicates) {
      btnDuplicates.addEventListener('click', loadAndRender);
    }
    if (btnApproveAll) {
      btnApproveAll.addEventListener('click', handleApproveAllClick);
    }
  }

  wireButtons();
  if (badge) initBadge();
})();
