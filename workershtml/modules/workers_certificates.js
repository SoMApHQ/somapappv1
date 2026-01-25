(function () {
  const db = firebase.database();
  const auth = firebase.auth();
  const $ = (s) => document.querySelector(s);
  const SOMAP_ALLOWED_YEARS = Array.from({ length: 20 }, (_, i) => 2023 + i);
  const DEFAULT_YEAR = 2025;
  const params = new URLSearchParams(location.search);
  const forceFlag = params.get('force') === '1';
  const defaultLogo = window.somapLogoUrl || window.somapLogoOverride || '../images/somap-logo.png.jpg';
  const school = window.SOMAP?.getSchool?.();
  if (!school || !school.id) {
    window.location.href = '../somapappv1multischool/multischool.html';
    return;
  }
  const schoolRef = (subPath) => db.ref(SOMAP.P(subPath));

  function getYear() {
    if (window.somapYearContext?.getSelectedYear) {
      return window.somapYearContext.getSelectedYear() || DEFAULT_YEAR;
    }
    return sessionStorage.getItem('somap_selected_year') || DEFAULT_YEAR;
  }

  function setYear(y) {
    if (window.somapYearContext?.setSelectedYear) {
      window.somapYearContext.setSelectedYear(String(y));
    }
    sessionStorage.setItem('somap_selected_year', String(y));
  }

  function initYearUI() {
    const sel = $('#yearSelect');
    const hint = $('#yearHint');
    if (!sel || !hint) return;
    sel.innerHTML = SOMAP_ALLOWED_YEARS.map((y) => `<option value="${y}">${y}</option>`).join('');
    const current = getYear();
    sel.value = current;
    hint.textContent = current;
    sel.addEventListener('change', (e) => {
      const y = e.target.value;
      setYear(y);
      hint.textContent = y;
      refresh();
    });
  }

  function availabilityOpen(role) {
    const m = new Date().getMonth() + 1; // 1..12
    const inWindow = m === 11 || m === 12;
    const override = forceFlag && (role === 'admin' || role === 'hr');
    const ok = inWindow || override;
    const banner = $('#windowBanner');
    if (banner) banner.classList.toggle('hidden', ok);
    return ok;
  }

  async function readOnce(path) {
    try {
      const snap = await db.ref(path).once('value');
      return snap.exists() ? snap.val() : null;
    } catch (err) {
      console.warn('readOnce failed', path, err);
      return null;
    }
  }

  async function scopedOrSocratesLegacy(scopedSubPath, legacyPath) {
    const scopedSnap = await schoolRef(scopedSubPath).get();
    if (scopedSnap.exists()) return scopedSnap;
    const isSocrates = ['socrates-school', 'default', 'socrates'].includes(school?.id);
    if (isSocrates) return await db.ref(legacyPath).get();
    return scopedSnap;
  }

  async function readScopedOnce(scopedSubPath, legacyPath) {
    try {
      const snap = await scopedOrSocratesLegacy(scopedSubPath, legacyPath);
      return snap.exists() ? snap.val() : null;
    } catch (err) {
      console.warn('readScopedOnce failed', scopedSubPath, err);
      return null;
    }
  }

  async function getRole(uid) {
    return (
      (await readScopedOnce(`years/${getYear()}/workers/${uid}/profile/role`, `workers/${uid}/profile/role`)) ||
      (await readScopedOnce(`years/${getYear()}/workers/${uid}/role`, `workers/${uid}/role`)) ||
      (await readScopedOnce(`years/${getYear()}/staff/${uid}/role`, `staff/${uid}/role`)) ||
      'worker'
    );
  }

  function getLocalSession() {
    const workerId = localStorage.getItem('workerId') || sessionStorage.getItem('workerId');
    const role = localStorage.getItem('role') || sessionStorage.getItem('role') || 'worker';
    const fullNameUpper = localStorage.getItem('fullNameUpper') || sessionStorage.getItem('fullNameUpper');
    if (workerId) {
      return { workerId, role, fullNameUpper };
    }
    return null;
  }

  function pick(obj, keys) {
    for (const k of keys) {
      if (obj && obj[k] !== undefined && obj[k] !== null && obj[k] !== '') return obj[k];
    }
    return null;
  }

  function normalizeWorker(w, uid) {
    const profile = w?.profile || {};
    const docs = w?.docs || {};
    const first = pick(w, ['firstName']) || pick(profile, ['firstName']) || '';
    const mid = pick(w, ['middleName']) || pick(profile, ['middleName']) || '';
    const last = pick(w, ['lastName', 'surname']) || pick(profile, ['lastName', 'surname']) || '';
    const full =
      [first, mid, last].map((s) => String(s || '').trim()).filter(Boolean).join(' ') ||
      (profile.fullNameUpper || profile.fullName || w.fullName || w.name || '').trim() ||
      'Unnamed Worker';
    const role =
      pick(w, ['jobTitle', 'position', 'department', 'role']) ||
      pick(profile, ['jobTitle', 'position', 'department', 'role']) ||
      'Staff';
    const phone = pick(w, ['phone', 'primaryPhone', 'mobile']) || pick(profile, ['phone', 'primaryPhone', 'mobile']) || '';
    const photo =
      pick(w, ['passportUrl', 'photoUrl']) ||
      pick(docs, ['passportPhotoUrl', 'idPhotoUrl']) ||
      pick(profile, ['photoUrl']) ||
      '';
    return { uid, raw: w, fullName: full, role, phone, photo };
  }

  async function getWorkerByUid(uid) {
    for (const p of ['workers', 'staff']) {
      const data = await readScopedOnce(`years/${getYear()}/${p}/${uid}`, `${p}/${uid}`);
      if (data) return normalizeWorker(data, uid);
    }

    const user = auth.currentUser;
    if (user?.email) {
      const safeEmail = user.email.replace(/\./g, '(dot)');
      const mapped = await readScopedOnce(`years/${getYear()}/workersIndexByEmail/${safeEmail}`, `workersIndexByEmail/${safeEmail}`);
      if (mapped) {
        const data = await readScopedOnce(`years/${getYear()}/workers/${mapped}`, `workers/${mapped}`);
        if (data) return normalizeWorker(data, mapped);
      }
    }

    if (user?.phoneNumber) {
      const safePhone = user.phoneNumber.replace(/[^\d+]/g, '');
      const mapped = await readScopedOnce(`years/${getYear()}/workersIndexByPhone/${safePhone}`, `workersIndexByPhone/${safePhone}`);
      if (mapped) {
        const data = await readScopedOnce(`years/${getYear()}/workers/${mapped}`, `workers/${mapped}`);
        if (data) return normalizeWorker(data, mapped);
      }
    }
    return null;
  }

  async function getWorkerById(id) {
    for (const p of ['workers', 'staff']) {
      const data = await readScopedOnce(`years/${getYear()}/${p}/${id}`, `${p}/${id}`);
      if (data) return normalizeWorker(data, id);
    }
    return null;
  }

  async function findWorkerByNameUpper(nameUpper) {
    if (!nameUpper) return null;
    for (const path of ['workers', 'staff']) {
      const data = await readScopedOnce(`years/${getYear()}/${path}`, path);
      if (data && typeof data === 'object') {
        for (const [uid, val] of Object.entries(data)) {
          const profile = val.profile || {};
          if ((profile.fullNameUpper || '').toLowerCase() === nameUpper.toLowerCase()) {
            return normalizeWorker(val, uid);
          }
        }
      }
    }
    return null;
  }

  async function loadAllWorkers() {
    for (const path of ['workers', 'staff']) {
      const data = await readScopedOnce(`years/${getYear()}/${path}`, path);
      if (data && typeof data === 'object') {
        return Object.entries(data).map(([uid, val]) => normalizeWorker(val, uid));
      }
    }
    return [];
  }

  function setTemplateData(node, data) {
    node.querySelector('#fullName').textContent = data.fullName || '—';
    node.querySelector('#roleText').textContent = data.role || '—';
    node.querySelector('#phoneText').textContent = data.phone || '—';
    node.querySelector('#yearText').textContent = data.year || '—';
    node.querySelector('#issuedDate').textContent = data.issuedDate || '—';
    const pass = node.querySelector('#passport');
    if (data.photoUrl) pass.src = data.photoUrl;
    const logo = node.querySelector('#logoImg');
    if (data.logoUrl) logo.src = data.logoUrl;
  }

  function renderCert(data) {
    const tpl = document.getElementById('workerCertTemplate');
    const node = tpl.content.firstElementChild.cloneNode(true);
    setTemplateData(node, data);
    document.getElementById('offscreen').appendChild(node);
    return node;
  }

  function clearOffscreen() {
    const off = document.getElementById('offscreen');
    if (off) off.innerHTML = '';
  }

  async function toCanvas(node) {
    return await html2canvas(node, { scale: 2, useCORS: true });
  }

  async function downloadPNG(node, filename) {
    const canvas = await toCanvas(node);
    const link = document.createElement('a');
    link.href = canvas.toDataURL('image/png');
    link.download = `${filename}.png`;
    link.click();
  }

  async function downloadPDF(node, filename) {
    const canvas = await toCanvas(node);
    const { jsPDF } = window.jspdf;
    const pdf = new jsPDF({ orientation: 'landscape', unit: 'pt', format: 'a4' });
    const pageW = pdf.internal.pageSize.getWidth();
    const pageH = pdf.internal.pageSize.getHeight();
    const img = canvas.toDataURL('image/jpeg', 0.92);
    const ratio = canvas.width / canvas.height;
    const w = pageW - 40;
    const h = w / ratio;
    const x = 20;
    const y = (pageH - h) / 2;
    pdf.addImage(img, 'JPEG', x, y, w, h);
    pdf.save(`${filename}.pdf`);
  }

  function showPreview(node) {
    const existing = document.getElementById('certPreviewOverlay');
    if (existing) existing.remove();
    const overlay = document.createElement('div');
    overlay.id = 'certPreviewOverlay';
    overlay.style.cssText =
      'position:fixed;inset:0;background:rgba(15,23,42,0.75);display:flex;align-items:center;justify-content:center;z-index:9999;padding:20px;';
    const card = document.createElement('div');
    card.style.cssText =
      'background:#fff;border-radius:12px;padding:12px;max-width:90vw;max-height:90vh;overflow:auto;box-shadow:0 20px 60px rgba(0,0,0,0.35);';
    const close = document.createElement('button');
    close.textContent = 'Close';
    close.style.cssText = 'margin-bottom:12px;padding:6px 10px;border:1px solid #cbd5e1;border-radius:8px;background:#fff;';
    close.onclick = () => overlay.remove();
    const clone = node.cloneNode(true);
    clone.style.transform = 'scale(0.55)';
    clone.style.transformOrigin = 'top left';
    clone.style.width = '620px';
    clone.style.height = '440px';
    card.appendChild(close);
    card.appendChild(clone);
    overlay.appendChild(card);
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) overlay.remove();
    });
    document.body.appendChild(overlay);
  }

  function buildCertData(worker) {
    const year = getYear();
    const nameSafe = (worker.fullName || 'certificate').replace(/\s+/g, '_');
    return {
      fullName: worker.fullName,
      role: worker.role,
      phone: worker.phone,
      year,
      issuedDate: new Date().toLocaleDateString(),
      photoUrl: worker.photo,
      logoUrl: defaultLogo,
      fileBase: `${nameSafe}_${year}_certificate`,
    };
  }

  function setSelfInfo(worker) {
    $('#selfName').textContent = worker.fullName;
    $('#selfRole').textContent = worker.role;
    $('#selfPhone').textContent = worker.phone || '—';
  }

  function disableSelfButtons(disabled) {
    ['btnPreviewSelf', 'btnPngSelf', 'btnPdfSelf'].forEach((id) => {
      const el = document.getElementById(id);
      if (el) el.disabled = disabled;
    });
  }

  async function handleSelf(worker, canGenerate) {
    setSelfInfo(worker);
    const data = buildCertData(worker);
    const previewBox = document.getElementById('selfPreview');
    previewBox.innerHTML = '';

    function renderForPreview() {
      clearOffscreen();
      const node = renderCert(data);
      const mini = node.cloneNode(true);
      mini.style.transform = 'scale(0.55)';
      mini.style.transformOrigin = 'top left';
      mini.style.width = '620px';
      mini.style.height = '440px';
      previewBox.innerHTML = '';
      previewBox.appendChild(mini);
      return node;
    }

    document.getElementById('btnPreviewSelf').onclick = () => {
      if (!canGenerate) return;
      const node = renderForPreview();
      showPreview(node);
      clearOffscreen();
    };
    document.getElementById('btnPngSelf').onclick = async () => {
      if (!canGenerate) return;
      clearOffscreen();
      const node = renderCert(data);
      await downloadPNG(node, data.fileBase);
      clearOffscreen();
    };
    document.getElementById('btnPdfSelf').onclick = async () => {
      if (!canGenerate) return;
      clearOffscreen();
      const node = renderCert(data);
      await downloadPDF(node, data.fileBase);
      clearOffscreen();
    };
  }

  function renderRow(worker, canGenerate) {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td class="p-2">${worker.fullName}</td>
      <td class="p-2 text-center">${worker.role}</td>
      <td class="p-2 text-center">${worker.phone || ''}</td>
      <td class="p-2 text-right">
        <button class="px-2 py-1 border rounded mr-1" data-action="preview">Preview</button>
        <button class="px-2 py-1 border rounded mr-1" data-action="png">PNG</button>
        <button class="px-2 py-1 bg-slate-900 text-white rounded" data-action="pdf">PDF</button>
      </td>
    `;
    tr.querySelectorAll('button').forEach((btn) => {
      btn.disabled = !canGenerate;
      btn.addEventListener('click', async (e) => {
        if (!canGenerate) return;
        const action = e.currentTarget.dataset.action;
        clearOffscreen();
        const data = buildCertData(worker);
        const node = renderCert(data);
        if (action === 'preview') {
          showPreview(node);
        } else if (action === 'png') {
          await downloadPNG(node, data.fileBase);
        } else {
          await downloadPDF(node, data.fileBase);
        }
        clearOffscreen();
      });
    });
    return tr;
  }

  function filterWorkers(list, term) {
    const q = String(term || '').toLowerCase();
    if (!q) return list;
    return list.filter((w) => {
      return (
        w.fullName.toLowerCase().includes(q) ||
        String(w.phone || '').toLowerCase().includes(q) ||
        String(w.raw?.admissionNo || w.raw?.staffId || w.raw?.employeeId || w.uid || '').toLowerCase().includes(q)
      );
    });
  }

  let cachedWorkers = [];

  async function refresh() {
    const user = auth.currentUser;
    const localSession = getLocalSession();

    if (!user && !localSession) {
      const main = document.querySelector('main');
      if (main) {
        main.innerHTML = '<div class="shell"><div class="glass p-6 text-slate-800 rounded-xl">Please sign in from the workers dashboard to generate certificates.</div></div>';
      }
      return;
    }

    const role = user ? await getRole(user.uid) : (localSession?.role || 'worker');
    const canGenerate = availabilityOpen(role);

    $('#selfBox').classList.add('hidden');
    $('#adminBox').classList.add('hidden');

    if (role === 'admin' || role === 'hr') {
      $('#adminBox').classList.remove('hidden');
      cachedWorkers = await loadAllWorkers();
      const tbody = document.getElementById('workersTbody');
      const renderList = (term = '') => {
        tbody.innerHTML = '';
        filterWorkers(cachedWorkers, term).forEach((w) => tbody.appendChild(renderRow(w, canGenerate)));
      };
      renderList('');
      document.getElementById('searchBox').oninput = (e) => renderList(e.target.value);
      const generateAllBtn = document.getElementById('btnGenerateAll');
      generateAllBtn.disabled = !canGenerate;
      generateAllBtn.onclick = async () => {
        if (!canGenerate) return;
        const list = filterWorkers(cachedWorkers, document.getElementById('searchBox').value);
        for (const w of list) {
          clearOffscreen();
          const data = buildCertData(w);
          const node = renderCert(data);
          await downloadPDF(node, data.fileBase);
          clearOffscreen();
        }
      };
    } else {
      let worker = null;
      if (user) {
        worker = await getWorkerByUid(user.uid);
      } else if (localSession?.workerId) {
        worker = await getWorkerById(localSession.workerId);
      }
      if (!worker && localSession?.fullNameUpper) {
        worker = await findWorkerByNameUpper(localSession.fullNameUpper);
      }
      if (!worker) {
        $('#selfPreview').innerHTML = '<div class="text-sm text-red-600">Worker record not found.</div>';
        return;
      }
      $('#selfBox').classList.remove('hidden');
      disableSelfButtons(!canGenerate);
      await handleSelf(worker, canGenerate);
    }
  }

  document.addEventListener('DOMContentLoaded', () => {
    initYearUI();
    auth.onAuthStateChanged(() => refresh());
  });
})();
