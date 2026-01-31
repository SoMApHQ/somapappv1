 (function () {
   'use strict';

   if (!window.firebase || !window.db || !window.SomapApprovals || !window.XLSX) {
     console.warn('AutoReconcileNMB: missing dependencies (firebase / approvals / XLSX)');
     return;
   }

   const db = window.db;
   const auth = firebase.auth();
   const somapApprovals = window.SomapApprovals;
   const financeDedupe = window.SOMAP_FINANCE || {};
   const yearContext = window.somapYearContext;

   const els = {
     fileInput: document.getElementById('nmbStatementFile'),
     scanButton: document.getElementById('btnScanStatement'),
     autoApproveButton: document.getElementById('btnAutoApproveSafeMatches'),
     statusMessage: document.getElementById('nmbStatusMessage'),
     resultsBody: document.getElementById('nmbResultsBody'),
     manualBody: document.getElementById('nmbManualReviewBody'),
     counters: {
       totalRows: document.getElementById('nmbTotalRows'),
       pendingLoaded: document.getElementById('nmbPendingLoaded'),
       safeMatches: document.getElementById('nmbSafeMatches'),
       manualReview: document.getElementById('nmbManualReviewCount'),
       skippedDuplicates: document.getElementById('nmbSkippedDuplicates'),
     },
   };

   if (!els.resultsBody || !els.manualBody) {
     console.warn('AutoReconcileNMB: critical UI elements are missing');
     return;
   }

   const state = {
     statementRows: {},
     statementIndex: {},
     manualReviewYear: '',
     manualReviewListener: null,
     manualReviewEntries: [],
     manualReviewCache: {},
     pendingStatuses: [],
     safeMatches: [],
     lastSignature: '',
     isReconciling: false,
     reconcileQueued: false,
     reconcileForced: false,
   };

   function normalizePath(subPath) {
     return String(subPath || '').replace(/^\/+/, '');
   }

   function resolveSchoolId() {
     const school = window.SOMAP?.getSchool?.();
     return school?.id || '';
   }

   function P(subPath) {
     const trimmed = normalizePath(subPath);
     if (window.SOMAP && typeof window.SOMAP.P === 'function') {
       return window.SOMAP.P(trimmed);
     }
     const id = resolveSchoolId();
     if (!id) return trimmed;
     if (id === 'socrates-school' || id === 'default') return trimmed;
     return `schools/${id}/${trimmed}`;
   }

   function sref(subPath) {
     return firebase.database().ref(P(subPath));
   }

   function getSelectedYear() {
     const yearFromApprovals = somapApprovals.getSelectedYear?.();
     if (yearFromApprovals) return String(yearFromApprovals);
     if (yearContext?.getSelectedYear) return String(yearContext.getSelectedYear());
     return String(new Date().getFullYear());
   }

   function getPaths(year) {
     const base = `years/${year}/reconciliation/nmb`;
     return {
       base,
       statementRows: `${base}/statementRows`,
       usedStatementRows: `${base}/usedStatementRows`,
       usedPendingApprovals: `${base}/usedPendingApprovals`,
       manualReview: `${base}/manualReview`,
       failures: `${base}/failures`,
       importBatches: `${base}/importBatches`,
     };
   }

   function getRecordYear(record) {
     if (!record || typeof record !== 'object') return '';
     const candidates = [
       record.forYear,
       record.academicYear,
       record.financeYear,
       record.year,
       record.targetYear,
       record._year,
       record.modulePayload?.payment?.academicYear,
       record.modulePayload?.payment?.year,
     ];
     for (let i = 0; i < candidates.length; i += 1) {
       const value = candidates[i];
       if (value == null || value === '') continue;
       const str = String(value).trim();
       if (str) return str;
     }
     return '';
   }

   function getPendingListForYear(year) {
     const list = somapApprovals.getPendingList?.() || [];
     return list.filter((record) => record.sourceModule === 'finance' && String(year) === getRecordYear(record));
   }

   function formatCurrency(amount) {
     const numeric = Number(amount) || 0;
     return new Intl.NumberFormat('en-TZ', {
       style: 'currency',
       currency: 'TZS',
       maximumFractionDigits: 0,
     }).format(numeric);
   }

   function parseAmountValue(value) {
     if (value == null || value === '') return 0;
     if (typeof value === 'number') return value;
     const sanitized = String(value).replace(/,/g, '').replace(/[^\d.-]/g, '');
     const numeric = Number(sanitized);
     return Number.isFinite(numeric) ? numeric : 0;
   }

   function normalizeReference(raw) {
     return String(raw || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
   }

   function normalizeReferenceO0(raw) {
     return normalizeReference(raw).replace(/O/g, '0');
   }

   function parseStatementDate(value) {
     if (value == null || value === '') return null;
     if (typeof value === 'number') {
       const epoch = Date.UTC(1899, 11, 30);
       const ms = (value - 25569) * 86400 * 1000;
       const date = new Date(epoch + ms);
       if (!Number.isNaN(date.getTime())) {
         return date.toISOString().slice(0, 10);
       }
       return null;
     }
     const cleaned = String(value).replace(/-/g, '/');
     const parsed = new Date(cleaned);
     if (!Number.isNaN(parsed.getTime())) {
       return parsed.toISOString().slice(0, 10);
     }
     return null;
   }

   function buildStatementRowId({ dateISO, refNormO0, amount }) {
     const datePart = String(dateISO || '').replace(/-/g, '');
     const refPart = refNormO0 || '';
     const amountPart = amount != null ? String(amount) : '0';
     return `${datePart}_${refPart}_${amountPart}`;
   }

  function parseStatementFile(file) {
    return new Promise((resolve, reject) => {
       const reader = new FileReader();
       reader.onerror = () => reject(new Error('Failed to read the bank statement file.'));
       reader.onload = () => {
         try {
           const data = reader.result;
           const workbook = window.XLSX.read(data, { type: 'array' });
           const sheetName = workbook.SheetNames[0];
           if (!sheetName) {
             resolve({ rows: [], headerDetected: false });
             return;
           }
           const sheet = workbook.Sheets[sheetName];
           const matrix = window.XLSX.utils.sheet_to_json(sheet, { header: 1, raw: false });
           let headerRow = -1;
           let columnIndexes = {};
           for (let i = 0; i < Math.min(60, matrix.length); i += 1) {
             const row = matrix[i];
             if (!Array.isArray(row)) continue;
             const normalized = row.map((value) => String(value || '').trim().toLowerCase());
             const dateIdx = normalized.findIndex((value) => value.includes('date'));
             const referenceIdx = normalized.findIndex((value) => value.includes('reference'));
             const creditIdx = normalized.findIndex((value) => value.includes('credit'));
             const descriptionIdx = normalized.findIndex((value) => value.includes('description'));
             if (dateIdx >= 0 && referenceIdx >= 0 && creditIdx >= 0) {
               headerRow = i;
               columnIndexes = {
                 date: dateIdx,
                 reference: referenceIdx,
                 credit: creditIdx,
                 description: descriptionIdx >= 0 ? descriptionIdx : -1,
               };
               break;
             }
           }
           if (headerRow < 0) {
             resolve({ rows: [], headerDetected: false });
             return;
           }

           const parsedRows = [];
           for (let i = headerRow + 1; i < matrix.length; i += 1) {
             const row = matrix[i];
             if (!Array.isArray(row) || row.length === 0) continue;
             const dateCell = row[columnIndexes.date];
             const refCell = row[columnIndexes.reference];
             const creditCell = row[columnIndexes.credit];
             const descriptionCell = columnIndexes.description >= 0 ? row[columnIndexes.description] : '';
             const amount = parseAmountValue(creditCell);
             if (!amount || amount <= 0) continue;
             const dateISO = parseStatementDate(dateCell);
             if (!dateISO) continue;
             const refRaw = refCell != null ? String(refCell).trim() : '';
             const description = descriptionCell != null ? String(descriptionCell).trim() : '';
             const refNorm = normalizeReference(refRaw);
             const refNormO0 = normalizeReferenceO0(refRaw);
             const statement = {
               dateISO,
               refRaw,
               refNorm,
               refNormO0,
               amount,
               description,
             };
             statement.statementRowId = buildStatementRowId(statement);
             parsedRows.push(statement);
           }
           resolve({ rows: parsedRows, headerDetected: true });
         } catch (err) {
           reject(err);
         }
      };
      reader.readAsArrayBuffer(file);
    });
  }

  function buildStatementIndex(rows) {
    const index = {};
    Object.entries(rows || {}).forEach(([id, row]) => {
      const amount = parseAmountValue(row.amount);
      if (!amount) return;
      const refNorm = normalizeReference(row.refRaw);
      if (!refNorm) return;
      const entry = { ...row, amount, statementRowId: id };
      const keys = new Set();
      keys.add(`${refNorm}_${amount}`);
      const refNormO0 = normalizeReferenceO0(row.refRaw);
      if (refNormO0) keys.add(`${refNormO0}_${amount}`);
      keys.forEach((key) => {
        if (!index[key]) index[key] = [];
        index[key].push(entry);
      });
    });
    return index;
  }

  function findStatementMatches(index, refNorm, refNormO0, amount) {
    const matches = [];
    const keyPrimary = `${refNorm}_${amount}`;
    const keyO0 = `${refNormO0}_${amount}`;
    if (index[keyPrimary]) matches.push(...index[keyPrimary]);
    if (keyO0 !== keyPrimary && index[keyO0]) matches.push(...index[keyO0]);
    return matches;
  }

  function getPendingReference(record) {
    const payload = record.modulePayload?.payment || {};
    return (
      record.paymentReferenceCode ||
      payload.referenceCode ||
      payload.reference ||
      payload.refCode ||
      payload.ref ||
      ''
    );
  }

  function extractPendingAmount(record) {
    return (
      Number(record.amountPaidNow) ||
      Number(record.amount) ||
      Number(record.amountClaimed) ||
      Number(record.modulePayload?.payment?.amount) ||
      0
    );
  }

  async function isLedgerDuplicate(record, year) {
    if (!financeDedupe.isDuplicateInLedger) return false;
    const studentKey = (
      record.modulePayload?.studentKey ||
      record.studentId ||
      record.studentKey ||
      record.studentAdm ||
      record.admissionNumber ||
      ''
    );
    if (!studentKey) return false;
    const targetYear = Number(year) || Number(getSelectedYear());
    const candidate = buildFinanceIdentityCandidate(record, targetYear);
    const ledgerPath = P(`financeLedgers/${targetYear}/${studentKey}/payments`);
    try {
      return await financeDedupe.isDuplicateInLedger(db, ledgerPath, candidate, targetYear, studentKey);
    } catch (err) {
      console.warn('AutoReconcileNMB: ledger duplicate check failed', err);
      return false;
    }
  }

  function buildFinanceIdentityCandidate(record, targetYear) {
    const paymentData = record.modulePayload?.payment || {};
    const refCode =
      record.paymentReferenceCode ||
      paymentData.referenceCode ||
      paymentData.reference ||
      paymentData.refCode ||
      paymentData.ref ||
      '';
    const studentAdm = (
      record.studentAdm ||
      record.admissionNumber ||
      record.modulePayload?.studentKey ||
      record.studentId ||
      ''
    );
    const year = Number(targetYear) || Number(getSelectedYear());
    return {
      ...paymentData,
      amount: Number(paymentData.amount || record.amountPaidNow || record.amount || 0),
      studentAdm,
      year,
      paymentDate: paymentData.timestamp || record.datePaid || record.createdAt,
      sourceModule: 'School Fees',
      refCode,
      referenceCode: refCode,
    };
  }

  async function evaluatePendingRecord(record, context) {
    const pendingId = record.approvalId;
    const amount = extractPendingAmount(record);
    const reference = getPendingReference(record);
    const normalized = normalizeReference(reference);
    const normalizedO0 = normalizeReferenceO0(reference);
    const base = {
      pending: record,
      pendingId,
      amount,
      reference,
    };
    if (!normalized) {
      return {
        ...base,
        status: 'MANUAL_REVIEW',
        reason: 'Missing or invalid reference code',
        candidates: [],
      };
    }
    const matches = findStatementMatches(context.statementIndex, normalized, normalizedO0, amount);
    if (!matches.length) {
      return {
        ...base,
        status: 'AWAITING_STATEMENT',
        reason: 'No stored statement row for this reference + amount',
        candidates: [],
      };
    }
    const unused = matches.filter((entry) => !context.usedStatementRows[entry.statementRowId]);
    if (!unused.length) {
      return {
        ...base,
        status: 'SKIPPED',
        reason: 'Statement row already used',
        candidates: matches.slice(0, 5),
      };
    }
    if (unused.length > 1) {
      return {
        ...base,
        status: 'MANUAL_REVIEW',
        reason: 'Multiple statement rows match this reference and amount',
        candidates: unused.slice(0, 5),
      };
    }
    const candidate = unused[0];
    if (context.usedPendingApprovals[pendingId]) {
      return {
        ...base,
        status: 'SKIPPED',
        reason: 'Pending approval already recorded',
        statementRowId: candidate.statementRowId,
        statementRow: candidate,
      };
    }
    const ledgerDuplicate = await isLedgerDuplicate(record, context.year);
    if (ledgerDuplicate) {
      return {
        ...base,
        status: 'MANUAL_REVIEW',
        reason: 'Payment already exists in the ledger',
        statementRowId: candidate.statementRowId,
        statementRow: candidate,
        candidates: [candidate],
      };
    }
    return {
      ...base,
      status: 'SAFE_MATCH',
      reason: 'Statement reference and amount match',
      statementRowId: candidate.statementRowId,
      statementRow: candidate,
      candidates: [candidate],
    };
  }

  async function enqueueManualReview(year, pending, reason, candidates) {
    const pendingId = pending.approvalId;
    if (!pendingId) return;
    const path = `${getPaths(year).manualReview}/${pendingId}`;
    const ref = sref(path);
    const now = Date.now();
    const existingSnap = await ref.once('value');
    const existing = existingSnap.val() || {};
    const keepStatus = existing.status && existing.status !== 'open' ? existing.status : 'open';
    const payload = {
      createdAt: existing.createdAt || now,
      updatedAt: now,
      reason,
      status: keepStatus,
      pending: {
        studentId:
          pending.studentId ||
          pending.modulePayload?.studentId ||
          pending.modulePayload?.studentKey ||
          pending.studentKey ||
          pending.studentAdm ||
          pending.admissionNumber ||
          '',
        studentName: pending.studentName || pending.modulePayload?.studentName || '',
        amount: extractPendingAmount(pending),
        ref: referenceSafe(pending),
        module: pending.sourceModule || '',
        recordedAt: pending.datePaid || pending.createdAt || null,
      },
      candidates: (candidates || []).slice(0, 5).map((candidate) => ({
        statementRowId: candidate.statementRowId,
        dateISO: candidate.dateISO,
        amount: candidate.amount,
        refRaw: candidate.refRaw,
        description: candidate.description,
      })),
    };
    await ref.update(payload);
  }

  function referenceSafe(record) {
    return getPendingReference(record) || '--';
  }

  function renderResults(list) {
    const body = els.resultsBody;
    if (!list || !list.length) {
      body.innerHTML = `
        <tr>
          <td colspan="5" class="py-8 text-center text-xs text-slate-400">
            No pending school fee approvals for the selected academic year.
          </td>
        </tr>`;
      return;
    }
    body.innerHTML = list
      .map((row) => {
        const studentName = row.pending?.studentName || row.pending?.studentAdm || '--';
        const reference = row.reference || '--';
        const amount = formatCurrency(row.amount);
        const statusLabel = row.status.replace(/_/g, ' ');
        const statusClass =
          row.status === 'SAFE_MATCH'
            ? 'text-emerald-200'
            : row.status === 'MANUAL_REVIEW'
            ? 'text-amber-300'
            : 'text-slate-300';
        const details = row.reason || '';
        return `
          <tr>
            <td>
              <div class="font-semibold text-slate-100">${studentName}</div>
              <div class="text-[0.65rem] text-slate-400">${row.pending?.studentAdm || row.pending?.studentId || ''}</div>
            </td>
            <td class="text-slate-200">${reference}</td>
            <td class="text-right text-slate-200">${amount}</td>
            <td><span class="font-semibold ${statusClass}">${statusLabel}</span></td>
            <td class="text-xs text-slate-400">${details}</td>
          </tr>`;
      })
      .join('');
  }

  function renderManualReview(entries) {
    const body = els.manualBody;
    if (!entries || !entries.length) {
      body.innerHTML = `
        <tr>
          <td colspan="6" class="py-8 text-center text-xs text-slate-400">
            Manual review queue is empty. Auto-flagged items appear here with suggested candidates.
          </td>
        </tr>`;
      return;
    }
    body.innerHTML = entries
      .map((entry) => {
        const pending = entry.pending || {};
        const amount = formatCurrency(pending.amount);
        const reason = entry.reason || '--';
        const status = entry.status || 'open';
        const candidatesHtml = (entry.candidates || [])
          .map(
            (candidate) => `
        <div class="mt-1 rounded-lg border border-slate-700/60 bg-slate-900/60 px-2 py-1 text-[0.65rem] text-slate-300">
          <strong>${candidate.refRaw || '--'}</strong> • ${candidate.dateISO || '--'} • ${formatCurrency(candidate.amount)}
        </div>
      `
          )
          .join('');
        return `
        <tr>
          <td>
            <div class="font-semibold text-slate-100">${pending.studentName || '--'}</div>
            <div class="text-[0.65rem] text-slate-400">${pending.studentId || '--'}</div>
          </td>
          <td class="text-slate-200">${amount}</td>
          <td class="text-slate-200">${pending.ref || '--'}</td>
          <td class="text-xs text-amber-200">${reason}</td>
          <td>${candidatesHtml || '<span class="text-[0.6rem] text-slate-400">No candidates</span>'}</td>
          <td class="text-xs text-slate-400 uppercase tracking-[0.3em]">${status.replace(/_/g, ' ')}</td>
        </tr>`;
      })
      .join('');
  }

  function updateCounters({ totalRows = 0, pendingLoaded = 0, safeMatches = 0, manualReview = 0, skippedDuplicates = 0 }) {
    if (els.counters.totalRows) els.counters.totalRows.textContent = String(totalRows);
    if (els.counters.pendingLoaded) els.counters.pendingLoaded.textContent = String(pendingLoaded);
    if (els.counters.safeMatches) els.counters.safeMatches.textContent = String(safeMatches);
    if (els.counters.manualReview) els.counters.manualReview.textContent = String(manualReview);
    if (els.counters.skippedDuplicates) els.counters.skippedDuplicates.textContent = String(skippedDuplicates);
  }

  function updateAutoApproveButtonState() {
    if (!els.autoApproveButton) return;
    const hasSafe = state.safeMatches.length > 0;
    els.autoApproveButton.disabled = !hasSafe;
    els.autoApproveButton.classList.toggle('opacity-40', !hasSafe);
    els.autoApproveButton.classList.toggle('pointer-events-none', !hasSafe);
  }

  function updateStatusMessage(text) {
    if (!els.statusMessage) return;
    els.statusMessage.textContent = text;
  }

  function attachManualReviewListener(year) {
    detachManualReviewListener();
    const path = getPaths(year).manualReview;
    const ref = sref(path);
    const handler = (snapshot) => {
      const data = snapshot.val() || {};
      const entries = Object.keys(data).map((key) => ({ pendingId: key, ...data[key] }));
      entries.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
      state.manualReviewEntries = entries;
      renderManualReview(entries);
    };
    ref.on('value', handler);
    state.manualReviewListener = { ref, handler, year };
    state.manualReviewYear = year;
  }

  function detachManualReviewListener() {
    if (state.manualReviewListener) {
      state.manualReviewListener.ref.off('value', state.manualReviewListener.handler);
      state.manualReviewListener = null;
      state.manualReviewYear = '';
    }
  }

  async function storeStatementRows(rows, meta) {
    const year = getSelectedYear();
    const paths = getPaths(year);
    const fileName = meta.fileName || 'statement';
    const importedAt = meta.importedAt || Date.now();
    const importedBy = auth?.currentUser?.email || 'AUTO_NMB';
    let importedCount = 0;
    let duplicateCount = 0;
    for (let i = 0; i < rows.length; i += 1) {
      const row = rows[i];
      if (!row || !row.statementRowId) continue;
      const entry = {
        dateISO: row.dateISO,
        refRaw: row.refRaw,
        refNorm: row.refNorm,
        refNormO0: row.refNormO0,
        amount: Number(row.amount) || 0,
        description: row.description || '',
        source: {
          fileName,
          importedAt,
          importedBy,
        },
      };
      try {
        const path = `${paths.statementRows}/${row.statementRowId}`;
        const result = await sref(path).transaction((current) => {
          if (current) return current;
          return entry;
        }, { applyLocally: false });
        if (result.committed) importedCount += 1;
        else duplicateCount += 1;
      } catch (err) {
        console.error('AutoReconcileNMB: failed to write statement row', err);
      }
    }
    const batchRef = sref(paths.importBatches).push();
    await batchRef.set({
      fileName,
      importedAt,
      rowsImported: importedCount,
      rowsSkippedAsDuplicate: duplicateCount,
      headerDetected: meta.headerDetected || false,
    });
    return { imported: importedCount, duplicates: duplicateCount };
  }

  async function runReconcile(force = false) {
    if (state.isReconciling) {
      state.reconcileQueued = true;
      state.reconcileForced = state.reconcileForced || force;
      return;
    }
    state.isReconciling = true;
    const year = getSelectedYear();
    if (state.manualReviewYear !== year) {
      attachManualReviewListener(year);
      state.manualReviewCache = {};
    }
    const effectiveForce = state.reconcileForced || force;
    state.reconcileForced = false;
    state.reconcileQueued = false;
    try {
      const pendingList = getPendingListForYear(year);
      const signature = `${pendingList.length}-${pendingList.reduce(
        (sum, record) => sum + Number(record.updatedAt || record.createdAt || 0),
        0
      )}`;
      if (!effectiveForce && signature === state.lastSignature) {
        return;
      }
      state.lastSignature = signature;
      const paths = getPaths(year);
      const [statementSnap, usedStatementSnap, usedPendingSnap] = await Promise.all([
        sref(paths.statementRows).once('value'),
        sref(paths.usedStatementRows).once('value'),
        sref(paths.usedPendingApprovals).once('value'),
      ]);
      const storedRows = statementSnap.exists() ? statementSnap.val() : {};
      const usedStatementRows = usedStatementSnap.exists() ? usedStatementSnap.val() : {};
      const usedPendingApprovals = usedPendingSnap.exists() ? usedPendingSnap.val() : {};
      const statementIndex = buildStatementIndex(storedRows);
      const statuses = [];
      const safeMatches = [];
      for (let i = 0; i < pendingList.length; i += 1) {
        const pending = pendingList[i];
        const result = await evaluatePendingRecord(pending, {
          year,
          statementIndex,
          usedStatementRows,
          usedPendingApprovals,
        });
        statuses.push(result);
        if (result.status === 'SAFE_MATCH') safeMatches.push(result);
        if (result.status === 'MANUAL_REVIEW') {
          const cacheKey = `${year}_${pending.approvalId}`;
          if (state.manualReviewCache[cacheKey] !== result.reason) {
            try {
              await enqueueManualReview(year, pending, result.reason, result.candidates);
            } catch (err) {
              console.error('AutoReconcileNMB: manual review enqueue failed', err);
            }
            state.manualReviewCache[cacheKey] = result.reason;
          }
        } else {
          delete state.manualReviewCache[`${year}_${pending.approvalId}`];
        }
      }
      state.pendingStatuses = statuses;
      state.safeMatches = safeMatches;
      state.statementRows = storedRows;
      state.statementIndex = statementIndex;
      renderResults(statuses);
      updateAutoApproveButtonState();
      updateCounters({
        totalRows: Object.keys(storedRows).length,
        pendingLoaded: pendingList.length,
        safeMatches: safeMatches.length,
        manualReview: statuses.filter((row) => row.status === 'MANUAL_REVIEW').length,
        skippedDuplicates: statuses.filter((row) => row.status === 'SKIPPED').length,
      });
    } catch (err) {
      console.error('AutoReconcileNMB: reconcile failed', err);
      updateStatusMessage('Auto-check failed. See console for details.');
    } finally {
      state.isReconciling = false;
      if (state.reconcileQueued) {
        const nextForce = state.reconcileForced;
        state.reconcileQueued = false;
        state.reconcileForced = false;
        runReconcile(nextForce);
      }
    }
  }

  async function claimLock(path, payload) {
    const result = await sref(path).transaction(
      (current) => {
        if (current) return current;
        return payload;
      },
      { applyLocally: false }
    );
    return result.committed;
  }

  async function claimStatementLock(year, statementRowId, payload) {
    const path = `${getPaths(year).usedStatementRows}/${statementRowId}`;
    return claimLock(path, payload);
  }

  async function claimPendingLock(year, pendingId, payload) {
    const path = `${getPaths(year).usedPendingApprovals}/${pendingId}`;
    return claimLock(path, payload);
  }

  async function releaseStatementLock(year, statementRowId, expectedPendingId) {
    const path = `${getPaths(year).usedStatementRows}/${statementRowId}`;
    const ref = sref(path);
    const snap = await ref.once('value');
    if (!snap.exists()) return;
    const value = snap.val() || {};
    if (expectedPendingId && value.pendingId !== expectedPendingId) return;
    await ref.remove();
  }

  async function releasePendingLock(year, pendingId, expectedStatementId) {
    const path = `${getPaths(year).usedPendingApprovals}/${pendingId}`;
    const ref = sref(path);
    const snap = await ref.once('value');
    if (!snap.exists()) return;
    const value = snap.val() || {};
    if (expectedStatementId && value.statementRowId !== expectedStatementId) return;
    await ref.remove();
  }

  async function recordReconciliationFailure(year, pendingId, statementRowId, errorMessage) {
    if (!pendingId) return;
    const path = `${getPaths(year).failures}/${pendingId}`;
    await sref(path).set({
      statementRowId,
      error: errorMessage,
      createdAt: Date.now(),
    });
  }

  function prepareRecordForAutoApproval(record, statementRow) {
    const clone = JSON.parse(JSON.stringify(record || {}));
    const reconcileMeta = {
      statementRowId: statementRow?.statementRowId || '',
      statementDateISO: statementRow?.dateISO || '',
      statementRefRaw: statementRow?.refRaw || '',
    };
    clone.approvedBy = 'AUTO_NMB';
    clone.autoReconcile = reconcileMeta;
    clone.modulePayload = clone.modulePayload || {};
    clone.modulePayload.payment = clone.modulePayload.payment || {};
    clone.modulePayload.payment.autoReconcile = reconcileMeta;
    if (!clone.paymentReferenceCode && statementRow?.refRaw) {
      clone.paymentReferenceCode = statementRow.refRaw;
    }
    return clone;
  }

  async function approveMatch(match) {
    if (!match || !match.pending || !match.pending.approvalId || !match.statementRowId) return;
    const year = getSelectedYear();
    const pending = match.pending;
    const statementRow = match.statementRow;
    const approvedAt = Date.now();
    const statementPayload = {
      pendingId: pending.approvalId,
      studentId:
        pending.studentId || pending.modulePayload?.studentKey || pending.studentKey || pending.studentAdm || '',
      amount: match.amount,
      ref: match.reference || '',
      statementDateISO: statementRow?.dateISO || '',
      statementRefRaw: statementRow?.refRaw || '',
      approvedAt,
    };
    const statementLocked = await claimStatementLock(year, match.statementRowId, statementPayload);
    if (!statementLocked) {
      updateStatusMessage('Statement row already claimed by another process.');
      return;
    }
    const pendingLocked = await claimPendingLock(year, pending.approvalId, {
      statementRowId: match.statementRowId,
      approvedAt,
    });
    if (!pendingLocked) {
      await releaseStatementLock(year, match.statementRowId, pending.approvalId);
      updateStatusMessage('Pending approval already processed elsewhere.');
      return;
    }
    try {
      const prepared = prepareRecordForAutoApproval(pending, statementRow);
      await somapApprovals.approveRecord(prepared);
    } catch (err) {
      await recordReconciliationFailure(year, pending.approvalId, match.statementRowId, err?.message || 'Unknown error');
      await releaseStatementLock(year, match.statementRowId, pending.approvalId);
      await releasePendingLock(year, pending.approvalId, match.statementRowId);
      throw err;
    }
  }

  async function autoApproveSafeMatches() {
    if (!state.safeMatches.length) {
      updateStatusMessage('No safe matches ready for auto approval.');
      return;
    }
    updateStatusMessage('Auto-approving safe matches...');
    for (let i = 0; i < state.safeMatches.length; i += 1) {
      const match = state.safeMatches[i];
      try {
        await approveMatch(match);
      } catch (err) {
        console.error('AutoReconcileNMB: approval failed', err);
        updateStatusMessage('Auto approval encountered an error. Check console.');
      }
    }
    scheduleReconcile(true);
  }

  function scheduleReconcile(force = false) {
    if (force) state.reconcileForced = true;
    if (state.isReconciling) {
      state.reconcileQueued = true;
      return;
    }
    runReconcile(force || state.reconcileForced);
  }

  if (els.scanButton) {
    els.scanButton.addEventListener('click', async () => {
      const file = els.fileInput?.files?.[0];
      if (!file) {
        updateStatusMessage('Select an NMB statement file before scanning.');
        return;
      }
      els.scanButton.disabled = true;
      updateStatusMessage('Parsing statement file...');
      try {
        const parsed = await parseStatementFile(file);
        if (!parsed.headerDetected) {
          updateStatusMessage('Header row not detected. Please confirm the statement format.');
        }
        const summary = await storeStatementRows(parsed.rows, {
          fileName: file.name,
          importedAt: Date.now(),
          headerDetected: parsed.headerDetected,
        });
        updateStatusMessage(`Imported ${summary.imported} rows (${summary.duplicates} duplicates skipped).`);
        scheduleReconcile(true);
      } catch (err) {
        console.error('AutoReconcileNMB: statement scan failed', err);
        updateStatusMessage('Statement scan failed. See console for details.');
      } finally {
        els.scanButton.disabled = false;
      }
    });
  }

  if (els.autoApproveButton) {
    els.autoApproveButton.addEventListener('click', () => autoApproveSafeMatches());
  }

  if (yearContext?.onYearChanged) {
    yearContext.onYearChanged(() => {
      state.manualReviewCache = {};
      scheduleReconcile(true);
    });
  }

  scheduleReconcile(true);
  setInterval(() => scheduleReconcile(false), 15000);
 })();
