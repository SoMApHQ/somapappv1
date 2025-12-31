// multipalapplrovals.js
// Detect and clean multiple/duplicate payments across approvals (pending + history) and financeLedgers.

(function () {
  // -----------------------------
  // UI hooks (matches approvals.html)
  // -----------------------------
  const UI = {
    trigger: document.getElementById('btnMultiDuplicates'),
    badge: document.getElementById('multiBadge'),
    approveAll: document.getElementById('btnApproveAll'),
  };

  if (!UI.trigger || !UI.badge) {
    console.warn('[multipalapplrovals] toolbar elements not found; skipping init.');
    return;
  }

  // -----------------------------
  // Firebase + context helpers
  // -----------------------------
  const db = window.db || (window.firebase?.database ? window.firebase.database() : null);
  if (!db) {
    console.warn('[multipalapplrovals] Firebase db not available.');
    return;
  }

  const P = (subPath) => (window.SOMAP && typeof window.SOMAP.P === 'function' ? window.SOMAP.P(subPath) : subPath);

  const getWorkingYear = () => {
    const ctx = window.somapYearContext;
    if (ctx && typeof ctx.getSelectedYear === 'function') return ctx.getSelectedYear();
    if (window.currentWorkingYear) return window.currentWorkingYear;
    if (window.currentFinanceYear) return window.currentFinanceYear;
    return new Date().getFullYear();
  };

  // -----------------------------
  // Normalizers
  // -----------------------------
  const safeUpper = (v) => (v == null ? '' : String(v).trim().toUpperCase());
  const safeStr = (v) => (v == null ? '' : String(v).trim());
  const num = (v) => {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
  };

  const resolveYear = (record, fallback) => {
    const explicit =
      record?.forYear ||
      record?.academicYear ||
      record?.financeYear ||
      record?.year ||
      record?.targetYear;
    if (explicit) return Number(explicit);
    const ts = Number(
      record?.paymentDate ||
      record?.datePaid ||
      record?.createdAt ||
      record?.timestamp ||
      record?.txDate
    );
    if (Number.isFinite(ts) && ts > 0) {
      const d = new Date(ts);
      if (Number.isFinite(d.getFullYear())) return d.getFullYear();
    }
    return Number(fallback || new Date().getFullYear());
  };

  const resolveAmount = (r) => num(
    r?.amountPaidNow ||
    r?.amount ||
    r?.claimedAmount ||
    r?.paidAmount ||
    r?.allocation ||
    r?.value ||
    r?.modulePayload?.payment?.amount
  );

  const resolveDate = (r) => (
    r?.paymentDate ||
    r?.datePaid ||
    r?.createdAt ||
    r?.timestamp ||
    r?.modulePayload?.payment?.timestamp ||
    ''
  );

  const resolveRef = (r) => (
    r?.paymentReferenceCode ||
    r?.referenceCode ||
    r?.refCode ||
    r?.receipt ||
    r?.bankRef ||
    r?.mpesaRef ||
    r?.modulePayload?.payment?.referenceCode ||
    r?.modulePayload?.payment?.reference ||
    'N/A'
  );

  const resolveMethod = (r) => (
    r?.paymentMethod ||
    r?.method ||
    r?.modulePayload?.payment?.method ||
    ''
  );

  // -----------------------------
  // Identity builders
  // -----------------------------
  const buildStrictKey = (p) => [
    safeUpper(p.studentAdm),
    safeUpper(p.studentName),
    safeUpper(p.className),
    resolveAmount(p),
    safeStr(resolveDate(p)),
    safeUpper(resolveMethod(p)),
    safeUpper(resolveRef(p)),
    safeUpper(p.paidBy),
    safeUpper(p.payerContact),
  ].join('|');

  const buildLooseKey = (p) => [
    safeUpper(p.studentAdm),
    resolveAmount(p),
    safeStr(resolveDate(p)),
    safeUpper(resolveRef(p)),
  ].join('|');

  // -----------------------------
  // Data collectors
  // -----------------------------
  async function fetchApprovalsPending(year) {
    const snap = await db.ref(P('approvalsPending')).once('value');
    if (!snap.exists()) return [];

    const list = [];
    snap.forEach((child) => {
      const raw = child.val() || {};
      const recYear = resolveYear(raw, year);
      list.push({
        id: child.key,
        source: 'pending',
        year: recYear,
        studentKey: raw.modulePayload?.studentKey || raw.studentId || raw.studentAdm || '',
        path: P(`approvalsPending/${child.key}`),
        studentAdm: raw.studentAdm || raw.admissionNumber || raw.adm || '',
        studentName: raw.studentName || raw.name || '',
        className: raw.className || raw.class || '',
        amount: resolveAmount(raw),
        paymentDate: resolveDate(raw),
        method: resolveMethod(raw),
        reference: resolveRef(raw),
        paidBy: raw.paidBy || raw.recordedBy || raw.modulePayload?.payment?.paidBy || '',
        payerContact: raw.payerContact || raw.modulePayload?.payment?.payerContact || '',
        status: raw.status || 'pending',
        raw,
      });
    });
    return list;
  }

  async function fetchApprovalsHistory(year) {
    const snap = await db.ref(P('approvalsHistory')).once('value');
    if (!snap.exists()) return [];
    const list = [];
    const yearNode = snap.child(String(year));
    if (!yearNode.exists()) return list;
    yearNode.forEach((monthNode) => {
      const month = monthNode.key;
      monthNode.forEach((entry) => {
        const raw = entry.val() || {};
        list.push({
          id: entry.key,
          source: 'history',
          year,
          month,
          path: P(`approvalsHistory/${year}/${month}/${entry.key}`),
          studentAdm: raw.studentAdm || raw.admissionNumber || raw.adm || '',
          studentName: raw.studentName || raw.name || '',
          className: raw.className || raw.class || '',
          amount: resolveAmount(raw),
          paymentDate: resolveDate(raw),
          method: resolveMethod(raw),
          reference: resolveRef(raw),
          paidBy: raw.paidBy || raw.recordedBy || '',
          payerContact: raw.payerContact || '',
          status: raw.status || raw.finalStatus || 'approved',
          raw,
        });
      });
    });
    return list;
  }

  async function fetchLedger(year) {
    const snap = await db.ref(P(`financeLedgers/${year}`)).once('value');
    if (!snap.exists()) return [];

    const list = [];
    snap.forEach((studentNode) => {
      const studentKey = studentNode.key;
      const paymentsNode = studentNode.child('payments');
      const payments = paymentsNode.exists() ? paymentsNode.val() : studentNode.val();
      const basePath = paymentsNode.exists() ? `${studentKey}/payments` : `${studentKey}`;

      Object.entries(payments || {}).forEach(([payKey, payment]) => {
        if (!payment || typeof payment !== 'object') return;
        list.push({
          id: payKey,
          source: 'ledger',
          year: resolveYear(payment, year),
          studentKey,
          path: P(`financeLedgers/${year}/${basePath}/${payKey}`),
          studentAdm: payment.studentAdm || studentKey,
          studentName: payment.studentName || payment.name || '',
          className: payment.className || '',
          amount: resolveAmount(payment),
          paymentDate: resolveDate(payment),
          method: resolveMethod(payment),
          reference: resolveRef(payment),
          paidBy: payment.paidBy || '',
          payerContact: payment.payerContact || '',
          status: payment.status || 'approved',
          raw: payment,
        });
      });
    });
    return list;
  }

  // -----------------------------
  // Grouping
  // -----------------------------
  function groupDuplicates(entries) {
    const strictMap = new Map();
    const looseMap = new Map();
    const inStrict = new Set();

    entries.forEach((p) => {
      const key = buildStrictKey(p);
      if (!key) return;
      const bucket = strictMap.get(key) || [];
      bucket.push(p);
      strictMap.set(key, bucket);
    });

    const groups = [];
    strictMap.forEach((bucket, key) => {
      if (bucket.length > 1) {
        groups.push({ id: `STRICT|${key}`, type: 'STRICT', payments: bucket });
        bucket.forEach((p) => inStrict.add(`${p.source}:${p.path}`));
      }
    });

    entries.forEach((p) => {
      const uid = `${p.source}:${p.path}`;
      if (inStrict.has(uid)) return;
      const key = buildLooseKey(p);
      if (!key) return;
      const bucket = looseMap.get(key) || [];
      bucket.push(p);
      looseMap.set(key, bucket);
    });

    looseMap.forEach((bucket, key) => {
      if (bucket.length > 1) {
        groups.push({ id: `LOOSE|${key}`, type: 'LOOSE', payments: bucket });
      }
    });

    return groups;
  }

  function countExtras(groups) {
    return groups.reduce((sum, g) => (g.payments.length > 1 ? sum + (g.payments.length - 1) : sum), 0);
  }

  // -----------------------------
  // Overlay UI
  // -----------------------------
  let overlay = null;
  let overlayBody = null;
  let currentGroups = [];
  let flatRows = [];

  function fmtCurrency(value) {
    const n = resolveAmount({ amount: value });
    return `TSh ${n.toLocaleString('en-TZ')}`;
  }

  function ensureOverlay() {
    if (overlay) return;

    overlay = document.createElement('div');
    overlay.id = 'multi-approvals-overlay';
    overlay.style.position = 'fixed';
    overlay.style.inset = '0';
    overlay.style.background = 'rgba(0,0,0,0.55)';
    overlay.style.display = 'flex';
    overlay.style.alignItems = 'center';
    overlay.style.justifyContent = 'center';
    overlay.style.zIndex = '9999';
    overlay.style.padding = '1rem';

    const panel = document.createElement('div');
    panel.style.background = 'white';
    panel.style.color = '#0f172a';
    panel.style.width = 'min(1100px, 98vw)';
    panel.style.maxHeight = '90vh';
    panel.style.borderRadius = '16px';
    panel.style.display = 'flex';
    panel.style.flexDirection = 'column';
    panel.style.boxShadow = '0 20px 60px rgba(0,0,0,0.25)';
    overlay.appendChild(panel);

    const header = document.createElement('div');
    header.style.display = 'flex';
    header.style.justifyContent = 'space-between';
    header.style.alignItems = 'center';
    header.style.padding = '12px 16px';
    header.style.borderBottom = '1px solid #e2e8f0';
    panel.appendChild(header);

    const title = document.createElement('div');
    title.innerHTML = `
      <div style="font-weight:700;">Multiple / Duplicate Payments</div>
      <div style="font-size:0.9rem;color:#475569;">STRICT: all fields match. LOOSE: same student + amount + date + reference.</div>
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
    deleteBtn.addEventListener('click', handleDeleteSelected);

    const summary = document.createElement('div');
    summary.id = 'multiSummary';
    summary.style.padding = '10px 16px';
    summary.style.background = '#f8fafc';
    summary.style.borderBottom = '1px solid #e2e8f0';
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
      <tr style="background:#f1f5f9;text-align:left;font-size:0.85rem;">
        <th style="padding:10px;border-bottom:1px solid #e2e8f0;">Delete?</th>
        <th style="padding:10px;border-bottom:1px solid #e2e8f0;">Student</th>
        <th style="padding:10px;border-bottom:1px solid #e2e8f0;">ADM</th>
        <th style="padding:10px;border-bottom:1px solid #e2e8f0;">Amount</th>
        <th style="padding:10px;border-bottom:1px solid #e2e8f0;">Date</th>
        <th style="padding:10px;border-bottom:1px solid #e2e8f0;">Method</th>
        <th style="padding:10px;border-bottom:1px solid #e2e8f0;">Ref</th>
        <th style="padding:10px;border-bottom:1px solid #e2e8f0;">Paid By</th>
        <th style="padding:10px;border-bottom:1px solid #e2e8f0;">Contact</th>
        <th style="padding:10px;border-bottom:1px solid #e2e8f0;">Source</th>
        <th style="padding:10px;border-bottom:1px solid #e2e8f0;">Key</th>
      </tr>
    `;
    table.appendChild(thead);

    overlayBody = document.createElement('tbody');
    table.appendChild(overlayBody);

    document.body.appendChild(overlay);
  }

  function closeOverlay() {
    if (overlay) {
      overlay.remove();
      overlay = null;
      overlayBody = null;
      currentGroups = [];
      flatRows = [];
    }
  }

  function renderSummary(rows) {
    const summary = document.getElementById('multiSummary');
    if (!summary) return;
    if (!rows.length) {
      summary.textContent = 'No duplicate payments detected for this year.';
      return;
    }
    const extras = rows.filter((r) => r.defaultDelete).length;
    const students = new Set(rows.map((r) => safeUpper(r.studentAdm || r.studentName || '')));
    summary.textContent = `${extras} duplicates pre-selected • ${students.size} students affected`;
  }

  function renderRows(groups) {
    ensureOverlay();
    if (!overlayBody) return;
    overlayBody.innerHTML = '';

    flatRows = [];
    groups.forEach((g) => {
      g.payments.forEach((p, idx) => {
        flatRows.push({
          ...p,
          groupId: g.id,
          keyType: g.type,
          defaultDelete: idx > 0,
        });
      });
    });

    if (!flatRows.length) {
      const tr = document.createElement('tr');
      const td = document.createElement('td');
      td.colSpan = 11;
      td.style.padding = '16px';
      td.style.textAlign = 'center';
      td.textContent = 'No multiple payment entries found.';
      tr.appendChild(td);
      overlayBody.appendChild(tr);
      renderSummary(flatRows);
      return;
    }

    flatRows.forEach((row, idx) => {
      const tr = document.createElement('tr');
      tr.style.borderBottom = '1px solid #e2e8f0';

      const cbTd = document.createElement('td');
      cbTd.style.padding = '10px';
      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.className = 'multi-delete-checkbox';
      cb.dataset.index = String(idx);
      cb.checked = !!row.defaultDelete;
      cbTd.appendChild(cb);
      tr.appendChild(cbTd);

      const addCell = (text) => {
        const td = document.createElement('td');
        td.style.padding = '10px';
        td.style.fontSize = '0.9rem';
        td.textContent = text;
        tr.appendChild(td);
      };

      addCell(row.studentName || '--');
      addCell(row.studentAdm || '--');
      addCell(fmtCurrency(row.amount));
      addCell(row.paymentDate || '--');
      addCell(resolveMethod(row) || '--');
      addCell(resolveRef(row) || '--');
      addCell(row.paidBy || '--');
      addCell(row.payerContact || '--');
      const sourceLabel = row.source === 'pending'
        ? 'Approvals (pending)'
        : row.source === 'history'
          ? 'Approvals (approved)'
          : 'Ledger';
      addCell(sourceLabel);
      addCell(row.keyType || '');

      overlayBody.appendChild(tr);
    });

    renderSummary(flatRows);
  }

  // -----------------------------
  // Delete
  // -----------------------------
  async function handleDeleteSelected() {
    if (!flatRows.length) {
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
        const idx = Number(cb.dataset.index);
        if (Number.isInteger(idx) && idx >= 0 && idx < flatRows.length) {
          selected.push(flatRows[idx]);
        }
      }
    });

    if (!selected.length) {
      alert('Select at least one entry to delete.');
      return;
    }

    if (!confirm(`Delete ${selected.length} payment record(s)? This removes them from approvals or finance ledgers for the current year.`)) {
      return;
    }

    const updates = {};
    selected.forEach((row) => {
      updates[row.path] = null;
    });

    try {
      await db.ref().update(updates);
      alert('Selected duplicates removed. Rescanning...');
      await scanData();
      renderRows(currentGroups);
    } catch (err) {
      console.error('[multipalapplrovals] delete failed', err);
      alert('Failed to delete some entries. Check console for details.');
    }
  }

  // -----------------------------
  // Scan + badge
  // -----------------------------
  async function scanData() {
    const year = getWorkingYear();
    const pending = await fetchApprovalsPending(year);
    const history = await fetchApprovalsHistory(year);
    const ledger = await fetchLedger(year);
    const all = [...pending, ...history, ...ledger];
    currentGroups = groupDuplicates(all);
    updateBadge(countExtras(currentGroups));
    return currentGroups;
  }

  function updateBadge(count) {
    UI.badge.textContent = Number(count || 0);
  }

  // -----------------------------
  // Approve-all hook (reuses SomapApprovals API)
  // -----------------------------
  async function handleApproveAllClick() {
    const api = window.SomapApprovals || {};
    if (!api.approveMany || !api.getPendingList) {
      alert('Approve-all not ready. Ensure approvals.js loaded.');
      return;
    }
    const pending = (api.getPendingList() || []).filter((r) => (r.status || 'pending').toLowerCase() === 'pending');
    if (!pending.length) {
      alert('No pending approvals to approve.');
      return;
    }
    if (!confirm(`Approve all ${pending.length} pending payments? Make sure duplicates are cleaned first.`)) {
      return;
    }
    UI.approveAll.disabled = true;
    const original = UI.approveAll.textContent;
    UI.approveAll.textContent = 'Approving...';
    try {
      const result = await api.approveMany(pending);
      alert(`Approved ${result.processedCount} payments. ${result.failureCount || 0} failed (see console).`);
    } catch (err) {
      console.error('[multipalapplrovals] approve-all failed', err);
      alert('Approve-all failed. Check console.');
    } finally {
      UI.approveAll.disabled = false;
      UI.approveAll.textContent = original;
    }
  }

  // -----------------------------
  // Wire up
  // -----------------------------
  UI.trigger.addEventListener('click', async () => {
    await scanData();
    renderRows(currentGroups);
  });
  if (UI.approveAll) {
    UI.approveAll.addEventListener('click', handleApproveAllClick);
  }

  // Initial badge load (silent)
  scanData().catch((err) => console.warn('[multipalapplrovals] initial scan failed', err));
})();
