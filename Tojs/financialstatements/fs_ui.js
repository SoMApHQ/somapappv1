(function (global) {
  'use strict';

  const ui = {};
  const CLASS_KEYS = [
    { key: 'baby', label: 'Baby Class' },
    { key: 'pp1', label: 'PP1 / Middle' },
    { key: 'pp2', label: 'PP2 / Pre-Unit' },
    { key: 'std1', label: 'Standard 1' },
    { key: 'std2', label: 'Standard 2' },
    { key: 'std3', label: 'Standard 3' },
    { key: 'std4', label: 'Standard 4' },
    { key: 'std5', label: 'Standard 5' },
    { key: 'std6', label: 'Standard 6' },
    { key: 'std7', label: 'Standard 7' },
  ];

  function resolveSchoolId() {
    if (global.currentSchoolId) return global.currentSchoolId;
    const params = new URLSearchParams(global.location?.search || '');
    const q = params.get('school') || params.get('schoolId');
    const stored = (typeof localStorage !== 'undefined' && localStorage.getItem) ? localStorage.getItem('somap_school') : '';
    const candidate = (q || stored || 'socrates').trim();
    global.currentSchoolId = candidate;
    return candidate;
  }

  function resolveYear() {
    const params = new URLSearchParams(global.location?.search || '');
    const q = params.get('year');
    if (q) return String(q);
    const stored = (typeof sessionStorage !== 'undefined' && sessionStorage.getItem) ? sessionStorage.getItem('somap_fs_year') : '';
    return String(stored || new Date().getFullYear());
  }

  function persistYear(y) {
    try { sessionStorage.setItem('somap_fs_year', y); } catch (_) {}
  }

  function fmt(val) {
    const n = Number(val);
    if (!Number.isFinite(n)) return '0';
    return n.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
  }

  function setByPath(target, path, value) {
    if (!path) return;
    const parts = path.split('.');
    let cursor = target;
    parts.forEach((part, idx) => {
      if (idx === parts.length - 1) {
        cursor[part] = value;
      } else {
        cursor[part] = cursor[part] || {};
        cursor = cursor[part];
      }
    });
  }

  function getByPath(source, path) {
    if (!path) return undefined;
    return path.split('.').reduce((acc, part) => (acc ? acc[part] : undefined), source);
  }

  function normalizePath(path, year) {
    const y = Number(year) || new Date().getFullYear();
    const prev = y - 1;
    return String(path || '')
      .replace(/__CURRENT__/g, y)
      .replace(/__PREV__/g, prev);
  }

  function hydrateForm(container, data, year) {
    container.querySelectorAll('[data-model]').forEach((el) => {
      const path = normalizePath(el.dataset.model, year);
      const value = getByPath(data, path);
      if (value === undefined || value === null) return;
      if (el.type === 'checkbox') {
        el.checked = Boolean(value);
      } else {
        el.value = value;
      }
    });
  }

  function serializeForm(container, year) {
    const out = {};
    container.querySelectorAll('[data-model]').forEach((el) => {
      const path = normalizePath(el.dataset.model, year);
      const dtype = el.dataset.type || el.type;
      let value = el.value;
      if (dtype === 'number') value = Number(value) || 0;
      if (dtype === 'checkbox') value = el.checked;
      setByPath(out, path, value);
    });
    return out;
  }

  async function loadFinanceAggregates(schoolId, year) {
    if (!global.db) return {};
    const snap = await global.db.ref(`schools/${schoolId}/financials/${year}/financeAggregates`).get();
    return snap.val() || {};
  }

  async function loadRawInputs(schoolId, year) {
    if (!global.db) return {};
    const snap = await global.db.ref(`schools/${schoolId}/financials/${year}/rawInputs`).get();
    return snap.val() || {};
  }

  async function loadComputed(schoolId, year) {
    if (!global.db) return null;
    const snap = await global.db.ref(`schools/${schoolId}/financials/${year}/computed`).get();
    return snap.val() || null;
  }

  async function saveRawInputs(schoolId, year, payload) {
    if (!global.db) return;
    await global.db.ref(`schools/${schoolId}/financials/${year}/rawInputs`).set(payload);
    await global.db.ref(`schools/${schoolId}/financials/${year}/yearMeta`).update({
      yearEndDate: `${year}-12-31`,
      status: 'draft',
      updatedAt: Date.now(),
    });
  }

  async function recomputeAndStore(schoolId, year, rawInputs, financeAggregates) {
    const prevYear = Number(year) - 1;
    let prevComputed = null;
    try {
      const prevSnap = await global.db.ref(`schools/${schoolId}/financials/${prevYear}/computed`).get();
      prevComputed = prevSnap.val() || null;
    } catch (_) {}
    const computed = global.computeFinancialStatements
      ? global.computeFinancialStatements(rawInputs, financeAggregates || {}, prevComputed)
      : {};
    await global.db.ref(`schools/${schoolId}/financials/${year}/computed`).set(computed);
    return computed;
  }

  function wireTabs() {
    const tabButtons = document.querySelectorAll('[data-tab]');
    const tabPanels = document.querySelectorAll('[data-tab-panel]');
    tabButtons.forEach((btn) => {
      btn.addEventListener('click', () => {
        const target = btn.dataset.tab;
        tabButtons.forEach((b) => b.classList.remove('active'));
        btn.classList.add('active');
        tabPanels.forEach((panel) => {
          panel.classList.toggle('hidden', panel.dataset.tabPanel !== target);
        });
      });
    });
  }

  function renderAggregatesBanner(aggregates = {}) {
    const el = document.getElementById('fsAggregates');
    if (!el) return;
    if (!Object.keys(aggregates || {}).length) {
      el.textContent = 'Hakuna data ya muhtasari wa fedha (finance.html). Fill inputs manually.';
      return;
    }
    el.innerHTML = `
      <div class="text-xs text-slate-600 uppercase mb-1">From Finance Dashboard</div>
      <div class="grid grid-cols-1 md:grid-cols-3 gap-2 text-sm">
        <div class="p-2 rounded bg-indigo-50">Total Students: <span class="font-semibold">${fmt(aggregates.totalStudents)}</span></div>
        <div class="p-2 rounded bg-indigo-50">Fees Expected: <span class="font-semibold">${fmt(aggregates.totalFeesExpected)}</span></div>
        <div class="p-2 rounded bg-indigo-50">Fees Collected: <span class="font-semibold">${fmt(aggregates.totalFeesCollected)}</span></div>
        <div class="p-2 rounded bg-indigo-50">Fees Balance: <span class="font-semibold">${fmt(aggregates.totalFeesBalance)}</span></div>
        <div class="p-2 rounded bg-indigo-50">Expenses: <span class="font-semibold">${fmt(aggregates.totalExpenses)}</span></div>
      </div>
    `;
  }

  async function wireDashboardPage() {
    const schoolId = resolveSchoolId();
    const yearInput = document.getElementById('fsYearSelect');
    const statusEl = document.getElementById('fsYearStatus');
    const gotoInputs = document.getElementById('gotoInputs');
    const gotoPreview = document.getElementById('gotoPreview');
    const year = resolveYear();
    persistYear(year);
    if (yearInput) {
      const yNow = new Date().getFullYear();
      const opts = [yNow - 1, yNow, yNow + 1];
      yearInput.innerHTML = opts.map((y) => `<option value="${y}" ${String(y) === String(year) ? 'selected' : ''}>${y}</option>`).join('');
      yearInput.addEventListener('change', (e) => {
        const val = e.target.value;
        persistYear(val);
        const params = new URLSearchParams(location.search);
        params.set('year', val);
        location.search = params.toString();
      });
    }
    if (gotoInputs) {
      gotoInputs.addEventListener('click', () => {
        const params = new URLSearchParams({ schoolId: schoolId, year });
        location.href = `fs_inputs.html?${params.toString()}`;
      });
    }
    if (gotoPreview) {
      gotoPreview.addEventListener('click', () => {
        const params = new URLSearchParams({ schoolId: schoolId, year });
        location.href = `fs_preview.html?${params.toString()}`;
      });
    }
    try {
      const metaSnap = await global.db.ref(`schools/${schoolId}/financials/${year}/yearMeta`).get();
      const meta = metaSnap.val() || {};
      if (statusEl) statusEl.textContent = meta.status || 'draft';
    } catch (err) {
      console.warn('Failed to load year meta', err);
    }
  }

  async function wireInputsPage() {
    const form = document.getElementById('fsForm');
    if (!form) return;
    wireTabs();
    const schoolId = resolveSchoolId();
    const year = resolveYear();
    persistYear(year);
    const label = document.getElementById('fsInputsYear');
    if (label) label.textContent = year;

    const aggregates = await loadFinanceAggregates(schoolId, year);
    renderAggregatesBanner(aggregates);

    const rawInputs = await loadRawInputs(schoolId, year);
    rawInputs.year = rawInputs.year || year;
    hydrateForm(form, rawInputs, year);

    const saveBtn = document.getElementById('fsSaveBtn');
    const statusText = document.getElementById('fsStatus');

    saveBtn?.addEventListener('click', async (e) => {
      e.preventDefault();
      const payload = serializeForm(form, year);
      payload.year = year;
      try {
        saveBtn.disabled = true;
        saveBtn.textContent = 'Saving...';
        await saveRawInputs(schoolId, year, payload);
        const computed = await recomputeAndStore(schoolId, year, payload, aggregates);
        if (statusText) statusText.textContent = 'Saved & recomputed at ' + new Date().toLocaleString();
        console.log('FS computed', computed);
        alert('Imehifadhiwa na mahesabu yamerekebishwa.');
      } catch (err) {
        alert('Save failed: ' + err.message);
      } finally {
        saveBtn.disabled = false;
        saveBtn.textContent = 'Save & Recompute';
      }
    });
  }

  function renderTableSection(title, rows) {
    return `
      <div class="mb-6">
        <h3 class="text-lg font-semibold text-slate-800 mb-2">${title}</h3>
        <table class="min-w-full text-sm border">
          <thead class="bg-slate-100">
            <tr>
              <th class="p-2 border text-left">Line</th>
              <th class="p-2 border text-right">Current Year</th>
              <th class="p-2 border text-right">Previous Year</th>
            </tr>
          </thead>
          <tbody>
            ${rows.map(r => `
              <tr>
                <td class="p-2 border">${r.label}</td>
                <td class="p-2 border text-right">${fmt(r.current)}</td>
                <td class="p-2 border text-right">${fmt(r.previous)}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    `;
  }

  function renderNotes(notesCurrent, notesPrev) {
    const container = document.getElementById('fsNotes');
    if (!container) return;
    const list = [1,2,3,4,5,6,7,8,9,10,11,12].map((n) => {
      const key = `note${n}`;
      const cur = notesCurrent[key] || {};
      const prev = notesPrev?.[key] || {};
      const rows = Object.keys(cur.items || { total: cur.total }).length
        ? Object.entries(cur.items || {}).map(([k, v]) => ({
            label: k,
            current: v,
            previous: prev.items ? prev.items[k] || 0 : 0,
          }))
        : [];
      rows.push({ label: 'Total', current: cur.total || 0, previous: prev.total || 0 });
      return renderTableSection(`Note ${n}: ${cur.title || ''}`, rows);
    }).join('');
    container.innerHTML = list;
  }

  async function wirePreviewPage() {
    const year = resolveYear();
    const schoolId = resolveSchoolId();
    persistYear(year);
    const yearLabel = document.getElementById('fsPreviewYear');
    if (yearLabel) yearLabel.textContent = year;
    const container = document.getElementById('fsPreviewContainer');
    if (!container) return;

    const computed = await loadComputed(schoolId, year);
    const rawInputs = await loadRawInputs(schoolId, year);
    if (!computed) {
      container.innerHTML = '<div class="p-4 bg-amber-50 border border-amber-200 rounded">Hakuna hesabu bado. Tafadhali jaza inputs na uhifadhi.</div>';
      return;
    }

    const pl = computed.pl || {};
    const bs = computed.bs || {};
    const cash = computed.cashFlow || {};
    const equity = computed.equity || {};
    const tax = computed.taxComputation || {};
    const notesCurrent = computed.notes?.[computed.meta?.year] || computed.notes?.[year] || {};
    const notesPrev = computed.notes?.[computed.meta?.prevYear] || computed.notes?.[Number(year) - 1] || {};

    const plHtml = renderTableSection('Statement of Profit or Loss', [
      { label: 'Revenue (Note 1)', current: pl.current?.revenue, previous: pl.previous?.revenue },
      { label: 'Direct expenses (Note 2)', current: pl.current?.directExpenses, previous: pl.previous?.directExpenses },
      { label: 'Gross profit', current: pl.current?.grossProfit, previous: pl.previous?.grossProfit },
      { label: 'Admin expenses (Note 3)', current: pl.current?.adminExpenses, previous: pl.previous?.adminExpenses },
      { label: 'Personnel expenses (Note 4)', current: pl.current?.personnelExpenses, previous: pl.previous?.personnelExpenses },
      { label: 'Professional expenses (Note 5)', current: pl.current?.professionalExpenses, previous: pl.previous?.professionalExpenses },
      { label: 'Finance costs (Note 6)', current: pl.current?.financeCosts, previous: pl.previous?.financeCosts },
      { label: 'Profit before tax', current: pl.current?.profitBeforeTax, previous: pl.previous?.profitBeforeTax },
      { label: 'Tax expense (Note 12)', current: pl.current?.taxExpense, previous: pl.previous?.taxExpense },
      { label: 'Profit after tax', current: pl.current?.profitAfterTax, previous: pl.previous?.profitAfterTax },
    ]);

    const bsHtml = renderTableSection('Statement of Financial Position', [
      { label: 'Property, plant & equipment', current: bs.current?.assets?.propertyPlantEquipment, previous: bs.previous?.assets?.propertyPlantEquipment },
      { label: 'Accounts receivable (Note 7)', current: bs.current?.assets?.receivables, previous: bs.previous?.assets?.receivables },
      { label: 'Cash & equivalents (Note 8)', current: bs.current?.assets?.cashAndBank, previous: bs.previous?.assets?.cashAndBank },
      { label: 'Total assets', current: bs.current?.assets?.totalAssets, previous: bs.previous?.assets?.totalAssets },
      { label: 'Share capital (Note 9)', current: equity.current?.shareCapital, previous: equity.previous?.shareCapital },
      { label: 'Retained earnings (Note 10)', current: equity.current?.retainedEarnings, previous: equity.previous?.retainedEarnings },
      { label: 'Accounts payables (Note 11)', current: bs.current?.equityAndLiabilities?.payables, previous: bs.previous?.equityAndLiabilities?.payables },
      { label: 'Tax liabilities (Note 12)', current: bs.current?.equityAndLiabilities?.taxLiabilities, previous: bs.previous?.equityAndLiabilities?.taxLiabilities },
      { label: 'Total equity & liabilities', current: bs.current?.equityAndLiabilities?.totalEquityLiabilities, previous: bs.previous?.equityAndLiabilities?.totalEquityLiabilities },
    ]);

    const cashHtml = renderTableSection('Cash Flow Statement', [
      { label: 'Opening cash', current: cash.current?.openingCash, previous: cash.previous?.openingCash },
      { label: 'Cash from operations', current: cash.current?.cashFromOperations, previous: cash.previous?.cashFromOperations },
      { label: 'Cash from investing', current: cash.current?.cashFromInvesting, previous: cash.previous?.cashFromInvesting },
      { label: 'Cash from financing', current: cash.current?.cashFromFinancing, previous: cash.previous?.cashFromFinancing },
      { label: 'Net change in cash', current: cash.current?.netChange, previous: cash.previous?.netChange },
      { label: 'Closing cash', current: cash.current?.closingCash, previous: cash.previous?.closingCash },
    ]);

    const equitySchedule = renderTableSection('Statement of Changes in Equity', [
      { label: 'Share capital', current: equity.current?.shareCapital, previous: equity.previous?.shareCapital },
      { label: 'Opening retained earnings', current: equity.current?.retainedSchedule?.openingRetained, previous: equity.previous?.retainedSchedule?.openingRetained },
      { label: 'Current year profit', current: equity.current?.retainedSchedule?.currentProfit, previous: equity.previous?.retainedSchedule?.currentProfit },
      { label: 'Drawings', current: equity.current?.retainedSchedule?.drawings, previous: equity.previous?.retainedSchedule?.drawings },
      { label: 'Closing retained earnings', current: equity.current?.retainedSchedule?.closingRetained, previous: equity.previous?.retainedSchedule?.closingRetained },
      { label: 'Total equity', current: equity.current?.totalEquity, previous: equity.previous?.totalEquity },
    ]);

    const taxHtml = renderTableSection('Income Tax Computation', [
      { label: 'Profit before tax', current: pl.current?.profitBeforeTax, previous: pl.previous?.profitBeforeTax },
      { label: 'Add back depreciation', current: tax.current?.addBackDepreciation, previous: tax.previous?.addBackDepreciation },
      { label: 'Less: Wear & Tear', current: tax.current?.wearAndTear, previous: tax.previous?.wearAndTear },
      { label: 'Taxable profit', current: tax.current?.taxableProfit, previous: tax.previous?.taxableProfit },
      { label: `Tax @${tax.current?.taxRate || 0}%`, current: tax.current?.taxCharge, previous: tax.previous?.taxCharge },
      { label: 'Tax paid in advance', current: tax.current?.taxPaidAdvance, previous: tax.previous?.taxPaidAdvance },
      { label: 'Tax payable/(refund)', current: tax.current?.taxPayable, previous: tax.previous?.taxPayable },
    ]);

    container.innerHTML = `
      <div class="bg-white p-4 rounded shadow">
        <div class="flex justify-between items-center mb-4">
          <div>
            <h2 class="text-2xl font-semibold text-indigo-700">Financial Statements ${year}</h2>
            <p class="text-sm text-slate-600">Socrates Investment Limited - Official format</p>
          </div>
          <div class="flex gap-2">
            <button id="fsDownloadPdf" class="px-3 py-1 bg-red-600 text-white rounded">Download PDF</button>
            <a href="fs_inputs.html?schoolId=${encodeURIComponent(schoolId)}&year=${encodeURIComponent(year)}" class="px-3 py-1 bg-slate-200 rounded">Back to inputs</a>
            <button id="fsLockYear" class="px-3 py-1 bg-emerald-600 text-white rounded">Lock year</button>
          </div>
        </div>
        ${plHtml}
        ${bsHtml}
        ${cashHtml}
        ${equitySchedule}
        ${taxHtml}
        <div id="fsNotes"></div>
      </div>
    `;
    renderNotes(notesCurrent, notesPrev);

    const lockBtn = document.getElementById('fsLockYear');
    lockBtn?.addEventListener('click', async () => {
      try {
        await global.db.ref(`schools/${schoolId}/financials/${year}/yearMeta`).update({
          status: 'final',
          lockedAt: Date.now(),
        });
        alert('Year locked');
      } catch (err) {
        alert('Failed to lock: ' + err.message);
      }
    });

    const downloadBtn = document.getElementById('fsDownloadPdf');
    downloadBtn?.addEventListener('click', () => {
      if (global.FsPdf?.downloadFsPdf) {
        global.FsPdf.downloadFsPdf(document.getElementById('fsPreviewContainer'), rawInputs.schoolSetup?.schoolName || 'School', year);
      }
    });
  }

  ui.resolveSchoolId = resolveSchoolId;
  ui.resolveYear = resolveYear;
  ui.loadFinanceAggregates = loadFinanceAggregates;
  ui.wireDashboardPage = wireDashboardPage;
  ui.wireInputsPage = wireInputsPage;
  ui.wirePreviewPage = wirePreviewPage;
  ui.classKeys = CLASS_KEYS;

  global.FinancialStatementsUI = ui;
})(window);
