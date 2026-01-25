window.addEventListener('DOMContentLoaded', async () => {
  const appEl = document.getElementById('app');
  if (appEl) appEl.style.display = '';
  initStudio();
});

function getYear() {
  return window.somapYearContext?.getSelectedYear?.() || new Date().getFullYear();
}

async function scopedOrSocratesLegacy(db, scopedSubPath, legacyPath) {
  const s = SOMAP.getSchool();
  const scopedSnap = await db.ref(SOMAP.P(scopedSubPath)).get();
  if (scopedSnap.exists()) return scopedSnap;
  const isSocrates = ['socrates-school', 'default', 'socrates'].includes(s?.id);
  if (isSocrates) return await db.ref(legacyPath).get();
  return scopedSnap;
}

function pick(obj, pathList){
  for (const p of pathList){
    const v = (p.split('/').reduce((acc,k)=>acc && acc[k], obj));
    if (v) return v;
  }
  return null;
}

async function fetchWorkers(){
  const db = firebase.database();
  const school = SOMAP.getSchool();
  if (!school || !school.id) {
    window.location.href = '../somapappv1multischool/multischool.html';
    return { path: 'workers', map: {} };
  }
  const year = getYear();
  const tryPaths = ['workers', 'staff', 'employees'];
  for (const p of tryPaths){
    const snap = await scopedOrSocratesLegacy(db, `years/${year}/${p}`, p);
    if (snap.exists()) return { path: `years/${year}/${p}`, map: snap.val() || {} };
  }
  return { path:`years/${year}/workers`, map:{} }; // default empty
}

function normalize(wk, key){
  const profile = wk.profile || {};
  const docs = wk.docs || {};
  const first = pick(profile, ['firstName']) || wk.firstName || '';
  const mid   = pick(profile, ['middleName']) || wk.middleName || '';
  const last  = pick(profile, ['lastName','surname']) || wk.lastName || wk.surname || '';
  const full  = (profile.fullNameUpper || [first, mid, last].join(' ')).replace(/\s+/g,' ').trim() || (wk.name || '—');
  return {
    key,
    name: full,
    staffId: pick(profile, ['staffId','employeeId']) || wk.staffId || wk.employeeId || key,
    role: profile.role || wk.role || wk.title || 'Staff',
    department: profile.department || wk.department || wk.dept || '—',
    phone: profile.phone || wk.phone || wk.contact || wk.mobile || '',
    photo: docs.passportPhotoUrl || docs.idPhotoUrl || profile.photoUrl || wk.photoUrl || wk.passportPhotoUrl || wk.avatarUrl || '',
    blood: profile.bloodGroup || wk.bloodGroup || '—',
    emergency: profile.nextOfKinPhone || wk.emergencyContact || '',
    issued: profile.admissionDate ? new Date(profile.admissionDate).toLocaleDateString() : (wk.issuedAt ? new Date(wk.issuedAt).toLocaleDateString() : new Date().toLocaleDateString()),
    valid: wk.validTo ? new Date(wk.validTo).getFullYear() : (new Date().getFullYear() + 1)
  };
}

async function initStudio(){
  const { path, map } = await fetchWorkers();
  const list = Object.entries(map).map(([k,v]) => normalize(v,k));

  // Attempt to resolve currently signed-in worker for quicker access
  const workerIdLS = (localStorage.getItem('workerId') || '').toLowerCase();
  const fullNameLS = (localStorage.getItem('fullNameUpper') || '').toLowerCase();
  const roleLS = localStorage.getItem('role') || '';

  const results = document.getElementById('results');
  const countHint = document.getElementById('countHint');
  const searchBox = document.getElementById('searchBox');
  const downloadBtn = document.getElementById('downloadPdf');

  function resolveActiveWorker(){
    if (!list.length) return null;
    // Match by key or staffId first
    let match = list.find(w => w.key.toLowerCase() === workerIdLS || String(w.staffId).toLowerCase() === workerIdLS);
    if (match) return match;
    // Fallback: match by name fragment
    if (fullNameLS){
      match = list.find(w => w.name.toLowerCase().includes(fullNameLS));
      if (match) return match;
    }
    return null;
  }

  function renderList(filter=''){
    const f = filter.trim().toLowerCase();
    const view = list.filter(w => !f ||
      w.name.toLowerCase().includes(f) || String(w.staffId).toLowerCase().includes(f));
    countHint.textContent = `${view.length} of ${list.length}`;
    results.innerHTML = view.map(w => `
      <button data-k="${w.key}"
        class="w-full text-left p-3 hover:bg-slate-50 rounded transition">
        <div class="font-semibold">${w.name}</div>
        <div class="text-xs text-slate-500">ID: ${w.staffId} • ${w.role} — ${w.department}</div>
      </button>
    `).join('');
  }

  function setText(id, txt){ const el = document.getElementById(id); if (el) el.textContent = txt || '—'; }
  function setImg(id, src){ const el = document.getElementById(id); if (el) el.src = src || '../images/somap-logo.png.jpg'; }

  function loadWorker(w){
    setText('wName', w.name);
    setText('wRole', `${w.role} · ${w.department}`);
    setText('wId',   `Staff ID: ${w.staffId}`);
    setText('wPhone', w.phone);
    setText('wValid', `${new Date().getFullYear()}–${w.valid}`);
    setImg('wPhoto', w.photo);

    setText('bName', w.name);
    setText('bRole', w.role);
    setText('bDept', w.department);
    setText('bStaffId', w.staffId);
    setText('bPhone', w.phone);
    setText('bBlood', w.blood);
    setText('bEmerg', w.emergency || '—');
    setText('bIssued', w.issued);

    // QR (clear then re-create)
    const qrFront = document.getElementById('qrFront');
    const qrBack  = document.getElementById('qrBack');
    qrFront.innerHTML = ''; qrBack.innerHTML = '';
    const url = `https://somapv2i.com/verify?id=${encodeURIComponent(w.staffId || w.key)}`;
    new QRCode(qrFront, { text:url, width:120, height:120 });
    new QRCode(qrBack,  { text:url, width:120, height:120 });

    downloadBtn.onclick = () => exportPdf(w);
  }

  async function exportPdf(w){
    const { jsPDF } = window.jspdf;
    const pdf = new jsPDF({ unit:'mm', format:'a4', compress:true });

    const frontEl = document.getElementById('front');
    const backEl  = document.getElementById('back');

    const scale = 2; // sharp canvas for printing
    const frontCanvas = await html2canvas(frontEl, { scale, useCORS:true, logging:false });
    const backCanvas  = await html2canvas(backEl,  { scale, useCORS:true, logging:false });

    // CR80 physical size ~85.6 x 54 mm. Render both sides at real size, centered on A4 for easy cutting.
    const pageW = 210, pageH = 297;
    const cardW = 86; // slight bleed
    const ratio = frontCanvas.width / frontCanvas.height;
    const cardH = cardW / ratio; // keep aspect so text is not clipped
    const marginX = (pageW - cardW) / 2;
    const topY = 20;
    const gapY = 12;

    pdf.addImage(frontCanvas.toDataURL('image/png'), 'PNG', marginX, topY, cardW, cardH);

    const backY = topY + cardH + gapY;
    if (backY + cardH + topY <= pageH){
      pdf.addImage(backCanvas.toDataURL('image/png'),  'PNG', marginX, backY, cardW, cardH);
    } else {
      pdf.addPage();
      pdf.addImage(backCanvas.toDataURL('image/png'),  'PNG', marginX, topY, cardW, cardH);
    }

    pdf.save(`${(w.name||'ID').replace(/\\s+/g,'_')}_Socrates_ID.pdf`);
  }

  // Wire UI
  results.addEventListener('click', (e)=>{
    const btn = e.target.closest('button[data-k]');
    if (!btn) return;
    const k = btn.getAttribute('data-k');
    const w = list.find(x => x.key === k);
    if (w) loadWorker(w);
  });

  searchBox.addEventListener('input', (e)=> renderList(e.target.value));
  const active = resolveActiveWorker();
  const defaultFilter = active ? (active.staffId || active.name) : '';
  renderList(defaultFilter);
  // Auto-load active worker if found; else first record
  if (active) {
    searchBox.value = defaultFilter;
    loadWorker(active);
  } else if (list.length) {
    loadWorker(list[0]);
  }
}
