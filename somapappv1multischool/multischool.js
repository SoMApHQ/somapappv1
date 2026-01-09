(function () {
  const db = window.db || firebase.database();
  // Use global SOMAP context defined in context.js
  const SOMAP = window.SOMAP;
  const SOCRATES_SCHOOL_ID = 'socrates-school';
  const CLOUDINARY_CLOUD = 'dg7vnrkgd';
  const SCHOOL_LOGO_PRESET = 'somap_schools';

  const hubCards = document.getElementById('hubCards');
  const registerSection = document.getElementById('registerSection');
  const chooseSection = document.getElementById('chooseSection');
  const registerBtn = document.getElementById('registerSchoolBtn');
  const chooseBtn = document.getElementById('chooseSchoolBtn');
  const backFromRegister = document.getElementById('backToHubFromRegister');
  const backFromChoose = document.getElementById('backToHubFromChoose');
  const registerForm = document.getElementById('registerForm');
  const registerStatus = document.getElementById('registerStatus');
  const searchSchool = document.getElementById('searchSchool');
  const schoolList = document.getElementById('schoolList');
  const chooseStatus = document.getElementById('chooseStatus');

  function showHub() {
    hubCards.classList.remove('hidden');
    registerSection.classList.add('hidden');
    chooseSection.classList.add('hidden');
  }

  function showRegister() {
    hubCards.classList.add('hidden');
    chooseSection.classList.add('hidden');
    registerSection.classList.remove('hidden');
  }

  function showChoose() {
    hubCards.classList.add('hidden');
    registerSection.classList.add('hidden');
    chooseSection.classList.remove('hidden');
    loadSchools();
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

  async function ensureSocratesSchoolExists() {
    const metaRef = db.ref(`schools/${SOCRATES_SCHOOL_ID}/meta`);
    const metaSnap = await metaRef.once('value');
    if (metaSnap.exists()) return;

    const updates = {};
    updates[`schools/${SOCRATES_SCHOOL_ID}/meta`] = {
      name: 'Socrates School',
      registrationNo: 'Socrates-Default',
      email: 'socratesschool2020@gmail.com',
      phone: '+255...',
      country: 'Tanzania',
      ownership: 'Private',
      levels: ['Primary'],
      location: 'Uswahilini, Arusha',
      status: 'active',
      createdAt: Date.now()
    };
    updates[`schools/${SOCRATES_SCHOOL_ID}/status`] = 'active';
    await db.ref().update(updates);
  }

  async function loadSchools() {
    chooseStatus.textContent = 'Loading schools...';
    schoolList.innerHTML = '';
    try {
      await ensureSocratesSchoolExists();
      const snap = await db.ref('schools').once('value');
      const data = snap.val() || {};
      const active = Object.entries(data)
        .map(([id, obj]) => ({
          id,
          meta: obj?.meta || {},
          rootStatus: obj?.status
        }))
        .filter(s => {
          const status = (s.meta.status || s.rootStatus || '').toLowerCase();
          const hasName = Boolean(s.meta.name);
          if (status) return status === 'active';
          return hasName;
        });

      renderSchools(active);
      chooseStatus.textContent = active.length ? '' : 'No active schools yet.';
    } catch (err) {
      console.error(err);
      chooseStatus.textContent = 'Failed to load schools.';
    }
  }

  function renderSchools(list) {
    const term = (searchSchool.value || '').toLowerCase();
    const filtered = list.filter(s => {
      const hay = `${s.meta.name || ''} ${s.meta.region || ''}`.toLowerCase();
      return hay.includes(term);
    });
    if (!filtered.length) {
      schoolList.innerHTML = '<p class="text-sm text-slate-300 col-span-full">No schools match your search.</p>';
      return;
    }
    schoolList.innerHTML = filtered.map(s => {
      const logo = s.meta.logoUrl || '';
      return `
        <button class="glass rounded-xl p-4 text-left hover:border-sky-400/50 transition border border-white/10 w-full" data-school="${s.id}">
          <div class="flex items-center gap-3">
            <div class="w-12 h-12 rounded-xl bg-slate-900/50 border border-white/10 overflow-hidden grid place-items-center text-slate-300">
              ${logo ? `<img src="${logo}" alt="${s.meta.name || 'School'} logo" class="w-full h-full object-cover">` : (s.meta.name || 'S').charAt(0)}
            </div>
            <div class="flex-1">
              <p class="text-sm text-slate-300">School</p>
              <h3 class="text-lg font-semibold">${s.meta.name || 'Unnamed School'}</h3>
              <p class="text-xs text-slate-400">${s.meta.region || s.meta.location || ''}</p>
            </div>
            <div class="text-sky-300 text-sm font-semibold">Select</div>
          </div>
        </button>
      `;
    }).join('');
  }

  async function submitRegistration(e) {
    e.preventDefault();
    registerStatus.classList.add('hidden');

    const formData = new FormData(registerForm);
    const logoInput = document.getElementById('school-logo');

    if (!logoInput || !logoInput.files.length) {
      alert('Please upload your school logo before submission.');
      return;
    }

    const payload = {
      country: formData.get('country') || '',
      name: formData.get('name') || '',
      registrationNo: formData.get('registrationNo') || '',
      levels: (formData.get('levels') || '').split(',').map(s => s.trim()).filter(Boolean),
      ownershipType: formData.get('ownershipType') || '',
      location: formData.get('location') || '',
      avgStudents: Number(formData.get('avgStudents') || 0),
      schoolEmail: formData.get('schoolEmail') || '',
      phone: formData.get('phone') || '',
      poBox: formData.get('poBox') || '',
      banks: (formData.get('banks') || '').split(',').map(s => s.trim()).filter(Boolean),
      dayBoardingType: formData.get('dayBoardingType') || '',
      languages: (formData.get('languages') || '').split(',').map(s => s.trim()).filter(Boolean),
      plan: formData.get('plan') || '',
      logoUrl: null,
      reason: formData.get('reason') || '',
      createdAt: Date.now(),
      status: 'pending'
    };
    const schoolId = makeSchoolId(payload.name || 'school');

    try {
      toggleSubmitState(true);

      const uploadForm = new FormData();
      uploadForm.append('file', logoInput.files[0]);
      uploadForm.append('upload_preset', SCHOOL_LOGO_PRESET);

      const uploadRes = await fetch(`https://api.cloudinary.com/v1_1/${CLOUDINARY_CLOUD}/image/upload`, {
        method: 'POST',
        body: uploadForm
      });
      const uploadData = await uploadRes.json();
      if (!uploadRes.ok || !uploadData?.secure_url) {
        throw new Error(uploadData?.error?.message || 'Logo upload failed.');
      }
      const logoUrl = uploadData.secure_url;

      const requestRef = db.ref('schoolRequests').push();
      const schoolProfile = {
        name: payload.name || '',
        phone: payload.phone || '',
        email: payload.schoolEmail || '',
        registrationNumber: payload.registrationNo || '',
        location: payload.location || '',
        logoUrl,
        updatedAt: Date.now()
      };

      const requestPayload = { ...payload, logoUrl, schoolId };
      const updates = {};
      updates[`schoolRequests/${requestRef.key}`] = requestPayload;
      updates[`schools/${schoolId}/profile`] = schoolProfile;
      updates[`schools/${schoolId}/meta/logoUrl`] = logoUrl;
      updates[`schools/${schoolId}/status`] = 'pending';

      await db.ref().update(updates);

      registerStatus.textContent = 'Asante! Your school has been submitted to SoMAp HQ for approval.';
      registerStatus.classList.remove('hidden');
      registerStatus.classList.add('text-emerald-300');
      registerForm.reset();
    } catch (err) {
      console.error(err);
      registerStatus.textContent = err.message || 'Failed to submit. Try again.';
      registerStatus.classList.remove('hidden');
      registerStatus.classList.remove('text-emerald-300');
    } finally {
      toggleSubmitState(false);
    }
  }

  function toggleSubmitState(isSubmitting) {
    const btn = registerForm.querySelector('button[type="submit"]');
    btn.disabled = isSubmitting;
    btn.textContent = isSubmitting ? 'Submitting...' : 'Submit to SoMAp HQ';
  }

  function handleSchoolClick(e) {
    const btn = e.target.closest('button[data-school]');
    if (!btn) return;
    const schoolId = btn.getAttribute('data-school');
    
    // Safety check for SOMAP
    if (!SOMAP) {
      console.error('SOMAP context is undefined. Check context.js loading.');
      chooseStatus.textContent = 'Error: System context not loaded. Refresh page.';
      return;
    }

    SOMAP.setSchoolId(schoolId);
    chooseStatus.textContent = `School selected: ${schoolId}. Redirecting to login...`;
    
    setTimeout(() => {
      window.location.href = '/login.html?login=1';
    }, 900);
  }

  function init() {
    registerBtn?.addEventListener('click', showRegister);
    chooseBtn?.addEventListener('click', showChoose);
    backFromRegister?.addEventListener('click', showHub);
    backFromChoose?.addEventListener('click', showHub);
    registerForm?.addEventListener('submit', submitRegistration);
    searchSchool?.addEventListener('input', () => loadSchools());
    schoolList?.addEventListener('click', handleSchoolClick);

    // If a school is already chosen, default to CHAGUA view
    // Check if SOMAP is available
    if (typeof SOMAP !== 'undefined') {
      const existing = SOMAP.getSchoolId();
      if (existing) {
        showChoose();
        chooseStatus.textContent = `Current school: ${existing}`;
      }
    }
  }

  document.addEventListener('DOMContentLoaded', init);
})();
