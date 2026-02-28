(function(){
  const DEFAULT_YEAR = '2025';
  const PAGE_COPY_ROWS = 4;

  const state = {
    school: null,
    schoolBrand: {
      name: 'Socrates School',
      contact: 'P.O. Box 14256, Arusha | 0686828732 / 0689649822',
      address: 'P.O. Box 14256, Arusha, Tanzania',
      logoUrl: '../images/somap-logo.png.jpg'
    },
    year: DEFAULT_YEAR,
    workers: [],
    filtered: [],
    selected: new Set(),
    activeKey: '',
    rendering: false,
    selfMode: false,
    selfWorkerId: ''
  };

  const el = {};

  window.addEventListener('DOMContentLoaded', init);

  async function init(){
    cacheElements();
    wireEvents();

    state.school = window.SOMAP?.getSchool?.();
    if (!state.school || !state.school.id) {
      window.location.href = '../somapappv1multischool/multischool.html';
      return;
    }

    resolveMode();
    initYear();
    applyModeUi();
    await refreshSchoolBrand();
    await loadWorkersForYear(state.year);

    const appEl = document.getElementById('app');
    if (appEl) appEl.style.display = '';
  }

  function cacheElements(){
    [
      'yearSelect','searchBox','downloadPdf','downloadSelectedPdf','downloadAllPdf','selectAllWorkers','results','countHint','staffTotal',
      'selectedCount','loadInfo','listYearHint','headerSchoolName','headerSchoolLogo','frontSchoolName','frontSchoolContact','frontAddress','backNote',
      'frontSchoolLogo','wPhoto','wName','wRole','wId','wValid','wPhone','bName','bRole','bDept','bStaffId','bPhone','bBlood','bEmerg','bIssued','qrFront','qrBack','front','back'
    ].forEach((id)=>{ el[id] = document.getElementById(id); });
  }

  function wireEvents(){
    el.searchBox?.addEventListener('input', () => {
      renderList(el.searchBox.value || '');
    });

    el.yearSelect?.addEventListener('change', async () => {
      const value = String(el.yearSelect.value || DEFAULT_YEAR);
      state.year = value;
      localStorage.setItem('somap.idcards.year', value);
      await loadWorkersForYear(value);
    });

    el.results?.addEventListener('click', (event) => {
      const row = event.target.closest('[data-worker-key]');
      if (!row) return;
      const key = row.getAttribute('data-worker-key');

      if (event.target.matches('input[type="checkbox"]')) {
        toggleSelected(key, event.target.checked);
        return;
      }

      const worker = state.workers.find((w) => w.key === key);
      if (!worker) return;
      state.activeKey = worker.key;
      loadWorkerToPreview(worker);
      renderList(el.searchBox.value || '');
    });

    el.selectAllWorkers?.addEventListener('change', () => {
      const checked = !!el.selectAllWorkers.checked;
      state.filtered.forEach((w) => {
        if (checked) state.selected.add(w.key);
        else state.selected.delete(w.key);
      });
      updateSelectionStats();
      renderList(el.searchBox.value || '');
    });

    el.downloadPdf?.addEventListener('click', async () => {
      const worker = state.workers.find((w) => w.key === state.activeKey) || state.filtered[0];
      if (!worker) {
        alert('No worker selected.');
        return;
      }
      await exportSingleWorker(worker);
    });

    el.downloadSelectedPdf?.addEventListener('click', async () => {
      const workers = state.workers.filter((w) => state.selected.has(w.key));
      if (!workers.length) {
        alert('Select at least one worker.');
        return;
      }
      await exportBulkWorkers(workers, true);
    });

    el.downloadAllPdf?.addEventListener('click', async () => {
      if (!state.workers.length) {
        alert('No workers available for this year.');
        return;
      }
      await exportBulkWorkers(state.workers, false);
    });
  }

  function resolveMode(){
    const query = new URLSearchParams(window.location.search || '');
    const scope = String(query.get('scope') || '').toLowerCase();
    const mode = String(query.get('mode') || '').toLowerCase();
    const workerFromQuery = String(query.get('worker') || '').trim();
    const workerFromStorage = String(localStorage.getItem('workerId') || sessionStorage.getItem('workerId') || '').trim();

    state.selfMode = (scope === 'self' || mode === 'self');
    state.selfWorkerId = workerFromQuery || workerFromStorage;
  }

  function initYear(){
    if (window.somapYearContext && el.yearSelect) {
      window.somapYearContext.attachYearDropdown(el.yearSelect);
    }

    const stored = localStorage.getItem('somap.idcards.year');
    const fromQuery = new URLSearchParams(window.location.search).get('year');
    const preferred = fromQuery || stored || DEFAULT_YEAR;

    state.year = preferred;
    if (el.yearSelect) el.yearSelect.value = preferred;
  }

  function applyModeUi(){
    if (!state.selfMode) return;
    if (el.downloadSelectedPdf) el.downloadSelectedPdf.style.display = 'none';
    if (el.downloadAllPdf) el.downloadAllPdf.style.display = 'none';
    if (el.selectAllWorkers) el.selectAllWorkers.disabled = true;
    if (el.searchBox) el.searchBox.placeholder = 'Your ID card';
  }

  async function refreshSchoolBrand(){
    const schoolName = state.school?.name || state.school?.id || 'School';
    state.schoolBrand.name = schoolName;

    try {
      const db = firebase.database();
      const profileSnap = await db.ref(window.SOMAP.P('profile')).get();
      const profile = profileSnap.exists() ? (profileSnap.val() || {}) : {};

      state.schoolBrand.name = profile.name || schoolName;
      state.schoolBrand.contact = profile.phone || profile.contact || state.schoolBrand.contact;
      state.schoolBrand.address = profile.address || profile.postalAddress || state.schoolBrand.address;
      state.schoolBrand.logoUrl = profile.logoUrl || profile.schoolLogoUrl || state.schoolBrand.logoUrl;
    } catch (error) {
      console.warn('ID cards: school profile fallback used.', error);
    }

    setText(el.headerSchoolName, state.schoolBrand.name);
    setText(el.frontSchoolName, String(state.schoolBrand.name).toUpperCase());
    setText(el.frontSchoolContact, state.schoolBrand.contact);
    setText(el.frontAddress, `Address: ${state.schoolBrand.address}`);
    setText(el.backNote, `This card is property of ${state.schoolBrand.name}. If found, return it to school administration. Misuse is subject to disciplinary action. Verify: somapv2i.com/verify.`);

    setImg(el.headerSchoolLogo, state.schoolBrand.logoUrl);
    setImg(el.frontSchoolLogo, state.schoolBrand.logoUrl);
  }

  async function scopedOrSocratesLegacy(db, scopedSubPath, legacyPath) {
    const school = state.school;
    const scopedSnap = await db.ref(window.SOMAP.P(scopedSubPath)).get();
    if (scopedSnap.exists()) return scopedSnap;

    const isSocrates = ['socrates-school', 'default', 'socrates'].includes(school?.id);
    if (isSocrates) {
      const legacySnap = await db.ref(legacyPath).get();
      if (legacySnap.exists()) return legacySnap;
    }
    return scopedSnap;
  }

  async function fetchWorkers(year){
    const db = firebase.database();
    const paths = ['workers', 'staff', 'employees'];

    for (const p of paths) {
      const snap = await scopedOrSocratesLegacy(db, `years/${year}/${p}`, p);
      if (!snap.exists()) continue;

      const map = snap.val() || {};
      const list = Object.entries(map).map(([key, value]) => normalizeWorker(value, key, year));
      if (list.length) return list;
    }

    return [];
  }

  function normalizeWorker(worker, key, year){
    const profile = worker?.profile || worker || {};
    const docs = worker?.docs || {};

    const first = profile.firstName || worker.firstName || '';
    const middle = profile.middleName || worker.middleName || '';
    const last = profile.lastName || profile.surname || worker.lastName || worker.surname || '';
    const name = String(profile.fullNameUpper || [first, middle, last].join(' ') || worker.name || 'UNKNOWN').replace(/\s+/g, ' ').trim();

    const staffId = profile.staffId || profile.employeeId || worker.staffId || worker.employeeId || key;
    const role = profile.role || worker.role || worker.title || 'Staff';
    const dept = profile.department || worker.department || worker.dept || role;

    const issuedDate = profile.admissionDate || worker.issuedAt || Date.now();
    const issued = formatDate(issuedDate);
    const validEnd = Number(year) + 1;

    return {
      key,
      year: String(year),
      name,
      role,
      department: dept,
      staffId,
      phone: profile.phone || worker.phone || profile.contact || worker.mobile || '-',
      blood: profile.bloodGroup || worker.bloodGroup || '-',
      emergency: profile.nextOfKinPhone || worker.emergencyContact || '-',
      photo: docs.passportPhotoUrl || docs.idPhotoUrl || profile.photoUrl || worker.photoUrl || '../images/somap-logo.png.jpg',
      issued,
      validLabel: `${year}-${validEnd}`
    };
  }

  async function loadWorkersForYear(year){
    setBusy(true, `Loading workers for ${year}...`);
    state.selected = new Set();

    try {
      const workers = await fetchWorkers(year);
      workers.sort((a, b) => a.name.localeCompare(b.name, 'en', { sensitivity: 'base' }));
      state.workers = workers;

      if (state.selfMode) {
        const selfWorker = resolveSelfWorker(workers);
        state.workers = selfWorker ? [selfWorker] : [];
      }

      const query = (el.searchBox?.value || '').trim().toLowerCase();
      state.filtered = state.workers.filter((w) => filterMatch(w, query));

      const stillExists = state.workers.some((w) => w.key === state.activeKey);
      if (!stillExists) {
        state.activeKey = state.filtered[0]?.key || state.workers[0]?.key || '';
      }

      if (state.activeKey) {
        const activeWorker = state.workers.find((w) => w.key === state.activeKey);
        if (activeWorker) loadWorkerToPreview(activeWorker);
      } else {
        loadEmptyPreview();
      }

      updateStats();
      renderList(query);
      setBusy(false, `${workers.length} workers loaded (${year})`);
    } catch (error) {
      console.error('ID cards load error', error);
      state.workers = [];
      state.filtered = [];
      state.activeKey = '';
      renderList('');
      updateStats();
      loadEmptyPreview();
      setBusy(false, 'Failed loading workers');
    }
  }

  function filterMatch(worker, query){
    if (!query) return true;
    return [worker.name, worker.staffId, worker.role, worker.department]
      .some((value) => String(value || '').toLowerCase().includes(query));
  }

  function resolveSelfWorker(workers){
    if (!workers.length) return null;
    const wid = String(state.selfWorkerId || '').toLowerCase();
    const fullName = String(localStorage.getItem('fullNameUpper') || localStorage.getItem('somap_workerName') || '').toLowerCase();
    const phone = String(localStorage.getItem('somap_workerPhone') || '').toLowerCase();

    let worker = null;
    if (wid) {
      worker = workers.find((w) => String(w.key).toLowerCase() === wid || String(w.staffId).toLowerCase() === wid);
      if (worker) return worker;
    }
    if (fullName) {
      worker = workers.find((w) => String(w.name).toLowerCase().includes(fullName));
      if (worker) return worker;
    }
    if (phone) {
      worker = workers.find((w) => String(w.phone).toLowerCase().includes(phone));
      if (worker) return worker;
    }
    return null;
  }

  function renderList(query){
    const q = String(query || '').trim().toLowerCase();
    state.filtered = state.workers.filter((w) => filterMatch(w, q));

    if (!el.results) return;

    el.results.innerHTML = state.filtered.map((worker) => {
      const activeClass = worker.key === state.activeKey ? 'active' : '';
      const checked = state.selected.has(worker.key) ? 'checked' : '';

      return `
        <div class="staff-item ${activeClass}" data-worker-key="${escapeHtml(worker.key)}">
          <input type="checkbox" ${checked} aria-label="Select ${escapeHtml(worker.name)}" />
          <div>
            <div class="staff-name">${escapeHtml(worker.name)}</div>
            <div class="staff-meta">ID: ${escapeHtml(worker.staffId)} | ${escapeHtml(worker.role)} | ${escapeHtml(worker.department)}</div>
          </div>
        </div>
      `;
    }).join('');

    updateStats();
    updateSelectionStats();
  }

  function updateStats(){
    setText(el.staffTotal, String(state.workers.length));
    setText(el.countHint, String(state.filtered.length));
    setText(el.listYearHint, `Year ${state.year}`);
    updateSelectionStats();
  }

  function updateSelectionStats(){
    setText(el.selectedCount, String(state.selected.size));

    if (!el.selectAllWorkers) return;
    if (!state.filtered.length) {
      el.selectAllWorkers.checked = false;
      el.selectAllWorkers.indeterminate = false;
      return;
    }

    const selectedVisible = state.filtered.filter((w) => state.selected.has(w.key)).length;
    el.selectAllWorkers.checked = selectedVisible === state.filtered.length;
    el.selectAllWorkers.indeterminate = selectedVisible > 0 && selectedVisible < state.filtered.length;
  }

  function toggleSelected(key, checked){
    if (!key) return;
    if (checked) state.selected.add(key);
    else state.selected.delete(key);
    updateSelectionStats();
  }

  function loadEmptyPreview(){
    loadWorkerToPreview({
      key: '',
      name: '-',
      role: 'Role',
      department: 'Department',
      staffId: '-',
      phone: '-',
      blood: '-',
      emergency: '-',
      photo: '../images/somap-logo.png.jpg',
      issued: '-',
      validLabel: `${state.year}-${Number(state.year) + 1}`
    });
  }

  function loadWorkerToPreview(worker){
    setText(el.wName, worker.name || '-');
    setText(el.wRole, `${worker.role || '-'} | ${worker.department || '-'}`);
    setText(el.wId, `Staff ID: ${worker.staffId || '-'}`);
    setText(el.wValid, `Valid: ${worker.validLabel || '-'}`);
    setText(el.wPhone, `Phone: ${worker.phone || '-'}`);

    setText(el.bName, worker.name || '-');
    setText(el.bRole, worker.role || '-');
    setText(el.bDept, worker.department || '-');
    setText(el.bStaffId, worker.staffId || '-');
    setText(el.bPhone, worker.phone || '-');
    setText(el.bBlood, worker.blood || '-');
    setText(el.bEmerg, worker.emergency || '-');
    setText(el.bIssued, worker.issued || '-');

    setImg(el.wPhoto, worker.photo);

    renderQr(worker);
  }

  function renderQr(worker){
    const text = `https://somapv2i.com/verify?id=${encodeURIComponent(worker.staffId || worker.key || '')}`;

    if (el.qrFront) {
      el.qrFront.innerHTML = '';
      new QRCode(el.qrFront, { text, width: 56, height: 56 });
    }

    if (el.qrBack) {
      el.qrBack.innerHTML = '';
      new QRCode(el.qrBack, { text, width: 56, height: 56 });
    }
  }

  async function exportSingleWorker(worker){
    if (state.rendering) return;
    state.rendering = true;

    setBusy(true, `Rendering ${worker.name}...`);
    try {
      const pdf = new window.jspdf.jsPDF({ unit: 'mm', format: 'a4', compress: true });
      const { frontData, backData } = await captureWorkerImages(worker);
      drawWorkerSheet(pdf, worker, frontData, backData, state.year);

      const fileName = `${slug(worker.name || 'worker')}_id_${state.year}.pdf`;
      pdf.save(fileName);
      setBusy(false, `Saved ${fileName}`);
    } catch (error) {
      console.error('Single export failed', error);
      alert('Failed to generate PDF for selected worker.');
      setBusy(false, 'Single export failed');
    } finally {
      state.rendering = false;
    }
  }

  async function exportBulkWorkers(workers, selectedMode){
    if (state.rendering) return;
    state.rendering = true;

    const actionLabel = selectedMode ? 'selected workers' : 'all workers';
    setBusy(true, `Preparing ${actionLabel}...`);

    const originalActive = state.activeKey;
    const originalSearch = el.searchBox?.value || '';

    try {
      const pdf = new window.jspdf.jsPDF({ unit: 'mm', format: 'a4', compress: true });
      for (let i = 0; i < workers.length; i += 1) {
        const worker = workers[i];
        setBusy(true, `Rendering ${i + 1}/${workers.length}: ${worker.name}`);

        if (i > 0) pdf.addPage();

        const { frontData, backData } = await captureWorkerImages(worker);
        drawWorkerSheet(pdf, worker, frontData, backData, state.year);
      }

      const schoolPart = slug(state.schoolBrand.name || state.school?.id || 'school');
      const fileName = `${schoolPart}_worker_ids_${state.year}_${workers.length}.pdf`;
      pdf.save(fileName);
      setBusy(false, `Saved ${fileName}`);
    } catch (error) {
      console.error('Bulk export failed', error);
      alert('Failed to generate bulk worker IDs PDF.');
      setBusy(false, 'Bulk export failed');
    } finally {
      if (originalActive) {
        const worker = state.workers.find((w) => w.key === originalActive);
        if (worker) loadWorkerToPreview(worker);
      }
      if (el.searchBox) el.searchBox.value = originalSearch;
      renderList(originalSearch);
      state.rendering = false;
    }
  }

  async function captureWorkerImages(worker){
    state.activeKey = worker.key;
    loadWorkerToPreview(worker);
    renderList(el.searchBox?.value || '');

    await waitForPaint();
    await waitForImage(el.wPhoto);

    const frontCanvas = await html2canvas(el.front, {
      scale: 2,
      useCORS: true,
      backgroundColor: null,
      logging: false
    });

    const backCanvas = await html2canvas(el.back, {
      scale: 2,
      useCORS: true,
      backgroundColor: null,
      logging: false
    });

    return {
      frontData: frontCanvas.toDataURL('image/png'),
      backData: backCanvas.toDataURL('image/png')
    };
  }

  function drawWorkerSheet(pdf, worker, frontData, backData, year){
    const pageW = 210;
    const pageH = 297;

    const cardW = 86;
    const cardH = 54;
    const gapX = 10;
    const gapY = 8;
    const startX = (pageW - ((cardW * 2) + gapX)) / 2;
    const startY = 20;

    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(11);
    pdf.text(`${worker.name}  |  ${worker.staffId}  |  Year ${year}`, 12, 12);

    pdf.setFont('helvetica', 'normal');
    pdf.setFontSize(8);
    pdf.text(`${state.schoolBrand.name} - Front (left), Back (right)`, 12, 17);

    for (let row = 0; row < PAGE_COPY_ROWS; row += 1) {
      const y = startY + (row * (cardH + gapY));
      if (y + cardH > pageH - 10) break;

      pdf.addImage(frontData, 'PNG', startX, y, cardW, cardH);
      pdf.addImage(backData, 'PNG', startX + cardW + gapX, y, cardW, cardH);

      pdf.setDrawColor(180, 192, 210);
      pdf.rect(startX, y, cardW, cardH);
      pdf.rect(startX + cardW + gapX, y, cardW, cardH);
    }
  }

  function setBusy(isBusy, message){
    if (el.downloadPdf) el.downloadPdf.disabled = isBusy;
    if (el.downloadSelectedPdf) el.downloadSelectedPdf.disabled = isBusy;
    if (el.downloadAllPdf) el.downloadAllPdf.disabled = isBusy;
    setText(el.loadInfo, message || (isBusy ? 'Working...' : 'Ready'));
  }

  function setText(target, value){
    if (!target) return;
    target.textContent = String(value ?? '-');
  }

  function setImg(target, src){
    if (!target) return;
    target.src = src || '../images/somap-logo.png.jpg';
  }

  function escapeHtml(value){
    return String(value ?? '')
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#39;');
  }

  function slug(value){
    return String(value || 'file').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
  }

  function formatDate(input){
    const date = new Date(input);
    if (Number.isNaN(date.getTime())) return '-';
    return date.toLocaleDateString('en-GB');
  }

  function waitForPaint(){
    return new Promise((resolve) => requestAnimationFrame(() => setTimeout(resolve, 80)));
  }

  function waitForImage(imageEl){
    return new Promise((resolve) => {
      if (!imageEl) { resolve(); return; }
      if (imageEl.complete) { resolve(); return; }

      const done = () => {
        imageEl.removeEventListener('load', done);
        imageEl.removeEventListener('error', done);
        resolve();
      };

      imageEl.addEventListener('load', done);
      imageEl.addEventListener('error', done);
      setTimeout(done, 1200);
    });
  }
})();
