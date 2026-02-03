(function headteacherApprovals() {
  const TZ = 'Africa/Nairobi';
  const containerId = 'headteacher-approvals-card';
  const detachFns = [];

  const styles = `
    body.headteacher-approvals-page {
      background: radial-gradient(circle at 15% 20%, rgba(34,211,238,0.12), transparent 32%), radial-gradient(circle at 82% 12%, rgba(99,102,241,0.18), transparent 28%), #0b1220;
      color: #e2e8f0;
      font-family: 'Inter', system-ui, -apple-system, sans-serif;
    }
    #${containerId} { margin-top:24px; background:rgba(255,255,255,0.08); border:1px solid rgba(255,255,255,0.15); border-radius:18px; padding:18px; box-shadow:0 18px 48px rgba(0,0,0,0.35); backdrop-filter: blur(16px); }
    #${containerId} h2 { margin:0 0 6px; font-size:1.4rem; color:#fff; }
    #${containerId} .subtitle { color:#94a3b8; margin:0 0 14px; font-size:0.95rem; }
    #${containerId} .eyebrow { text-transform:uppercase; letter-spacing:0.08em; font-size:0.8rem; color:#22d3ee; margin:0 0 4px; }
    #${containerId} .ht-header { display:flex; justify-content:space-between; gap:12px; align-items:flex-start; flex-wrap:wrap; }
    #${containerId} .pill { display:inline-flex; align-items:center; gap:8px; padding:8px 10px; border-radius:12px; background:rgba(255,255,255,0.06); border:1px solid rgba(255,255,255,0.18); color:#cbd5e1; }
    #${containerId} .ht-grid { display:grid; grid-template-columns:repeat(auto-fit,minmax(160px,1fr)); gap:10px; margin:14px 0 10px; }
    #${containerId} .stat-card { background:rgba(255,255,255,0.06); border:1px solid rgba(255,255,255,0.12); border-radius:12px; padding:12px; box-shadow:0 10px 30px rgba(0,0,0,0.25); }
    #${containerId} .stat-label { color:#94a3b8; font-size:0.9rem; margin:0 0 6px; }
    #${containerId} .stat-value { color:#fff; font-size:1.6rem; font-weight:800; }
    #${containerId} .ht-section { margin-top:12px; }
    #${containerId} .ht-section__header { display:flex; justify-content:space-between; align-items:center; gap:8px; flex-wrap:wrap; }
    #${containerId} .ht-list { display:grid; gap:10px; margin-top:10px; }
    #${containerId} .worker-row { background:rgba(255,255,255,0.06); border:1px solid rgba(255,255,255,0.12); border-radius:14px; padding:12px; display:grid; gap:8px; box-shadow:0 10px 30px rgba(0,0,0,0.25); }
    #${containerId} .worker-meta { display:flex; align-items:center; gap:10px; justify-content:space-between; flex-wrap:wrap; }
    #${containerId} .worker-meta h4 { margin:0; color:#fff; font-size:1rem; }
    #${containerId} .worker-meta .muted { color:#94a3b8; font-size:0.9rem; }
    #${containerId} .worker-times { display:grid; grid-template-columns:repeat(auto-fit,minmax(160px,1fr)); gap:8px; }
    #${containerId} .time-pill { background:rgba(255,255,255,0.04); border:1px solid rgba(255,255,255,0.12); padding:8px 10px; border-radius:10px; color:#cbd5e1; font-size:0.92rem; }
    #${containerId} .worker-actions { display:flex; gap:8px; flex-wrap:wrap; justify-content:flex-end; }
    #${containerId} .btn { padding:8px 12px; border-radius:10px; border:1px solid rgba(255,255,255,0.15); cursor:pointer; background:#fff; color:#0b1220; font-weight:700; }
    #${containerId} .btn.approve { background:#ecfdf3; border-color:#bbf7d0; color:#166534; }
    #${containerId} .btn.reject { background:#fef2f2; border-color:#fecdd3; color:#9f1239; }
    #${containerId} .btn[disabled] { opacity:0.5; cursor:not-allowed; }
    #${containerId} .status-badge { display:inline-flex; align-items:center; gap:6px; padding:6px 10px; border-radius:999px; font-size:0.88rem; border:1px solid rgba(255,255,255,0.12); }
    #${containerId} .status-approved { background:#dcfce7; color:#166534; border-color:#bbf7d0; }
    #${containerId} .status-rejected { background:#fee2e2; color:#991b1b; border-color:#fecaca; }
    #${containerId} .status-pending { background:#fef9c3; color:#854d0e; border-color:#fcd34d; }
    #${containerId} .status-missing { background:#e0f2fe; color:#075985; border-color:#bae6fd; }
    #${containerId} .rules { margin-top:14px; padding:12px; border:1px dashed rgba(255,255,255,0.15); border-radius:12px; background:rgba(255,255,255,0.04); }
    #${containerId} .rules h3 { margin:0 0 6px; font-size:1rem; color:#fff; }
    #${containerId} .rules .grid { display:grid; grid-template-columns:repeat(auto-fit,minmax(200px,1fr)); gap:10px; }
    #${containerId} label { font-weight:600; color:#e2e8f0; display:grid; gap:6px; font-size:0.92rem; }
    #${containerId} input[type="text"], #${containerId} input[type="number"] { padding:8px 10px; border:1px solid rgba(255,255,255,0.18); border-radius:10px; background:rgba(255,255,255,0.08); color:#e2e8f0; }
    #${containerId} .save-btn { margin-top:10px; background:linear-gradient(135deg,#22d3ee,#6366f1); color:#0b1220; }
    #${containerId} .empty { color:#94a3b8; font-size:0.95rem; padding:12px; }
    #${containerId} .lock-section { margin-top:18px; }
    #${containerId} .lock-grid { display:grid; grid-template-columns:repeat(auto-fit,minmax(240px,1fr)); gap:12px; }
    #${containerId} .lock-cell { background:rgba(255,255,255,0.04); border:1px solid rgba(255,255,255,0.12); border-radius:14px; padding:12px; min-height:180px; }
    #${containerId} .lock-cell .muted { color:#94a3b8; margin-bottom:6px; font-size:0.9rem; }
    #${containerId} .ip-list { min-height:56px; display:flex; flex-wrap:wrap; gap:6px; margin-bottom:8px; }
    #${containerId} .ip-badge { padding:6px 10px; border-radius:10px; background:rgba(15,118,110,0.15); border:1px solid rgba(15,118,110,0.35); color:#e0f2fe; font-size:0.85rem; }
    #${containerId} .code-box { font-size:1.6rem; letter-spacing:0.28rem; text-align:center; padding:12px; border-radius:12px; border:1px dashed rgba(255,255,255,0.2); background:rgba(255,255,255,0.02); }
    #${containerId} .code-meta { margin:6px 0; color:#94a3b8; font-size:0.85rem; }
    #${containerId} .lock-actions { display:flex; justify-content:flex-end; }
    @media (max-width: 640px) {
      #${containerId} { padding:14px; }
      #${containerId} .worker-actions { justify-content:flex-start; }
    }
  `;

  const fallbackToast = (msg, type = 'info') => {
    const colors = {
      success: 'rgba(16, 185, 129, 0.95)',
      error: 'rgba(239, 68, 68, 0.95)',
      warning: 'rgba(245, 158, 11, 0.95)',
      info: 'rgba(37, 99, 235, 0.95)'
    };
    let container = document.getElementById('toastContainer');
    if (!container) {
      container = document.createElement('div');
      container.id = 'toastContainer';
      container.className = 'toast-container';
      container.style.position = 'fixed';
      container.style.top = '20px';
      container.style.right = '20px';
      container.style.zIndex = '9999';
      container.style.display = 'flex';
      container.style.flexDirection = 'column';
      container.style.gap = '8px';
      container.style.alignItems = 'flex-end';
      document.body.appendChild(container);
    }
    const toastEl = document.createElement('div');
    toastEl.textContent = msg;
    toastEl.style.padding = '12px 16px';
    toastEl.style.borderRadius = '10px';
    toastEl.style.background = colors[type] || colors.info;
    toastEl.style.color = '#fff';
    toastEl.style.fontWeight = '600';
    toastEl.style.boxShadow = '0 6px 18px rgba(0,0,0,0.2)';
    toastEl.style.transform = 'translateX(20px)';
    toastEl.style.opacity = '0';
    toastEl.style.transition = 'transform 0.25s ease, opacity 0.25s ease';
    container.appendChild(toastEl);
    requestAnimationFrame(() => {
      toastEl.style.transform = 'translateX(0)';
      toastEl.style.opacity = '1';
    });
    setTimeout(() => {
      toastEl.style.opacity = '0';
      toastEl.style.transform = 'translateX(20px)';
      setTimeout(() => toastEl.remove(), 250);
    }, 3200);
  };
  const showToast = (msg, type = 'info') => {
    const toastImpl = window.toast || fallbackToast;
    try {
      toastImpl(msg, type);
    } catch (err) {
      console.warn('Toast handler failed', err);
      if (toastImpl !== fallbackToast) {
        fallbackToast(msg, type);
      }
    }
  };
  const todayYMD = (date = new Date()) => new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(date);
  const localTs = () => new Date(new Date().toLocaleString('en-US', { timeZone: TZ })).getTime();
  const formatTime = (ts) => ts ? new Date(ts).toLocaleTimeString('sw-TZ', { timeZone: TZ, hour: '2-digit', minute: '2-digit' }) : '-';

  const PUBLIC_IP_ENDPOINT = 'https://api.ipify.org';

  async function fetchPublicIP() {
    const resp = await fetch(PUBLIC_IP_ENDPOINT, { cache: 'no-store' });
    if (!resp.ok) {
      throw new Error('Failed to resolve IP');
    }
    return (await resp.text()).trim();
  }

  function randomNumericCode(length = 6) {
    let code = '';
    for (let i = 0; i < length; i += 1) {
      code += Math.floor(Math.random() * 10);
    }
    return code;
  }

  function injectStyles() {
    if (document.getElementById(`${containerId}-styles`)) return;
    const style = document.createElement('style');
    style.id = `${containerId}-styles`;
    style.textContent = styles;
    document.head.appendChild(style);
  }

  function ensureContainer() {
    let container = document.getElementById(containerId);
    if (!container) {
      container = document.createElement('section');
      container.id = containerId;
      const host = document.querySelector('.dashboard-container') || document.body;
      host.appendChild(container);
    }
    if (!container.querySelector(`#${containerId}-stats`)) {
      container.innerHTML = `
        <div class="ht-header">
          <div>
            <p class="eyebrow">Head Teacher</p>
            <h2>Headteacher Approvals</h2>
            <p class="subtitle">Thibitisha mahudhurio ya leo, angalia waliofika, na badilisha kanuni.</p>
          </div>
          <div class="pill" id="${containerId}-today-label"></div>
        </div>
        <div class="ht-grid" id="${containerId}-stats">
          <div class="stat-card"><p class="stat-label">Total Workers</p><div class="stat-value" id="${containerId}-stat-total">0</div></div>
          <div class="stat-card"><p class="stat-label">Approved</p><div class="stat-value" id="${containerId}-stat-approved">0</div></div>
          <div class="stat-card"><p class="stat-label">Rejected</p><div class="stat-value" id="${containerId}-stat-rejected">0</div></div>
          <div class="stat-card"><p class="stat-label">Pending</p><div class="stat-value" id="${containerId}-stat-pending">0</div></div>
          <div class="stat-card"><p class="stat-label">Not Checked-In</p><div class="stat-value" id="${containerId}-stat-missing">0</div></div>
        </div>
        <div class="ht-section">
          <div class="ht-section__header">
            <h3 style="margin:0;">Mahudhurio ya Leo</h3>
            <p class="subtitle" style="margin:0;">Moja kwa moja kutoka kwa check-ins.</p>
          </div>
          <div id="${containerId}-list" class="ht-list"></div>
        </div>
        <div class="rules" id="${containerId}-rules">
          <h3>Kanuni za Mahudhurio (Wi-Fi + adhabu)</h3>
          <p class="subtitle">Badilisha utambuzi wa Wi-Fi na kiasi cha kukatwa (posho ya uwajibikaji) baada ya kuchelewa/kuondoka mapema.</p>
          <div class="grid">
            <label>Ruhusu Wi-Fi pekee
              <input type="checkbox" id="rules-requireWifi">
            </label>
            <label>Majina ya Wi-Fi (SSID, koma kutenganisha)
              <input type="text" id="rules-ssids" placeholder="SCHOOL_WIFI,OFFICE_WIFI">
            </label>
            <label>Kikomo cha kuchelewa (mara)
              <input type="number" min="1" id="rules-lateThreshold" value="3">
            </label>
            <label>Kikomo cha kuondoka mapema (mara)
              <input type="number" min="1" id="rules-earlyThreshold" value="3">
            </label>
            <label>Kiasi cha kukatwa (TZS)
              <input type="number" min="0" id="rules-deductionAmount" value="1000">
            </label>
            <label>Kichwa cha malipo kinachokatwa
              <input type="text" id="rules-deductionLabel" placeholder="Posho ya Uwajibikaji">
            </label>
            <label>Lazimisha Wi-Fi ya shule (IP ya umma)
              <input type="checkbox" id="rules-requireSchoolInternet">
            </label>
            <label>Tumika msimbo unaozunguka
              <input type="checkbox" id="rules-rotatingCodeEnabled">
            </label>
            <label>Muda wa msimbo (sekunde)
              <input type="number" min="15" id="rules-codeTTLSeconds" value="90">
            </label>
          </div>
          <button class="btn save-btn" id="rules-save">Hifadhi Kanuni</button>
        </div>
        <div class="rules lock-section" id="${containerId}-lock">
          <h3>School Internet Lock</h3>
          <div class="lock-grid">
            <div class="lock-cell">
              <p class="muted">IP za umma zilizohifadhiwa leo</p>
              <div id="${containerId}-ipList" class="ip-list">Hakuna IP leo.</div>
              <button class="btn" id="${containerId}-set-school-ip">Set Today's School Internet</button>
            </div>
            <div class="lock-cell">
              <p class="muted">Rotating Check-In Code</p>
              <div class="code-box" id="${containerId}-code-display">----</div>
              <p class="code-meta" id="${containerId}-code-meta">No code generated yet.</p>
              <div class="lock-actions">
                <button class="btn" id="${containerId}-generate-code">Generate Code Now</button>
              </div>
            </div>
          </div>
        </div>
      `;
    }

    const els = {
      todayLabel: document.getElementById(`${containerId}-today-label`),
      statTotal: document.getElementById(`${containerId}-stat-total`),
      statApproved: document.getElementById(`${containerId}-stat-approved`),
      statRejected: document.getElementById(`${containerId}-stat-rejected`),
      statPending: document.getElementById(`${containerId}-stat-pending`),
      statMissing: document.getElementById(`${containerId}-stat-missing`),
      list: document.getElementById(`${containerId}-list`),
      rules: {
        requireWifi: document.getElementById('rules-requireWifi'),
        ssids: document.getElementById('rules-ssids'),
        lateThreshold: document.getElementById('rules-lateThreshold'),
        earlyThreshold: document.getElementById('rules-earlyThreshold'),
        deductionAmount: document.getElementById('rules-deductionAmount'),
        deductionLabel: document.getElementById('rules-deductionLabel'),
        requireSchoolInternet: document.getElementById('rules-requireSchoolInternet'),
        rotatingCodeEnabled: document.getElementById('rules-rotatingCodeEnabled'),
        codeTTLSeconds: document.getElementById('rules-codeTTLSeconds'),
        save: document.getElementById('rules-save')
      },
      lock: {
        ipList: document.getElementById(`${containerId}-ipList`),
        setIp: document.getElementById(`${containerId}-set-school-ip`),
        codeDisplay: document.getElementById(`${containerId}-code-display`),
        codeMeta: document.getElementById(`${containerId}-code-meta`),
        generateCode: document.getElementById(`${containerId}-generate-code`)
      }
    };

    return { container, els };
  }

  function scopedOrLegacy(db, path, fallbackPath, legacyFriendly) {
    const scopedRef = db.ref(SOMAP.P(path));
    const scopedPromise = scopedRef.get();
    const legacyPromise = legacyFriendly ? db.ref(fallbackPath).get() : Promise.resolve({ exists: () => false, val: () => null });
    return Promise.all([scopedPromise, legacyPromise]).then(([scopedSnap, legacySnap]) => {
      if (scopedSnap.exists()) return { snap: scopedSnap, source: 'scoped' };
      if (legacyFriendly && legacySnap.exists()) return { snap: legacySnap, source: 'legacy' };
      return { snap: scopedSnap, source: 'scoped' };
    });
  }

  async function setupRules(els, rulesRef, onSaved) {
    if (!els || !rulesRef || !els.save) return;
    if (!els.save.hasAttribute('data-listening')) {
      els.save.setAttribute('data-listening', 'true');
      els.save.addEventListener('click', async (e) => {
        e.preventDefault();
        const payload = {
          requireWifi: !!els.requireWifi.checked,
          allowedSsids: (els.ssids.value || '').split(',').map(s => s.trim()).filter(Boolean),
          lateThreshold: Math.max(1, Number(els.lateThreshold.value) || 3),
          earlyThreshold: Math.max(1, Number(els.earlyThreshold.value) || 3),
          deductionAmount: Math.max(0, Number(els.deductionAmount.value) || 0),
          deductionLabel: els.deductionLabel.value.trim() || 'Posho ya Uwajibikaji',
          requireSchoolInternet: !!els.requireSchoolInternet.checked,
          rotatingCodeEnabled: !!els.rotatingCodeEnabled.checked,
          codeTTLSeconds: Math.max(15, Number(els.codeTTLSeconds.value) || 90),
          updatedTs: localTs()
        };
        try {
          await rulesRef.set(payload);
          showToast('Imehifadhiwa ✅', 'success');
          if (onSaved) await onSaved(payload);
        } catch (err) {
          console.error('Failed to save attendance rules', err);
          showToast('Hifadhi haikuweza kukamilika. Jaribu tena.', 'error');
        }
      });
    }
    const snap = await rulesRef.get();
    const rules = snap.val() || {};
    els.requireWifi.checked = rules.requireWifi !== false;
    els.ssids.value = Array.isArray(rules.allowedSsids) ? rules.allowedSsids.join(',') : '';
    els.lateThreshold.value = rules.lateThreshold || 3;
    els.earlyThreshold.value = rules.earlyThreshold || 3;
    els.deductionAmount.value = rules.deductionAmount || 1000;
    els.deductionLabel.value = rules.deductionLabel || 'Posho ya Uwajibikaji';
    els.requireSchoolInternet.checked = rules.requireSchoolInternet === true;
    els.rotatingCodeEnabled.checked = rules.rotatingCodeEnabled === true;
    els.codeTTLSeconds.value = Number(rules.codeTTLSeconds) || 90;
    return rules;
  }

  function createLockManager({ db, els, showToast, getCurrentYear }) {
    let timerId = null;
    let activeRules = {
      rotatingCodeEnabled: false,
      codeTTLSeconds: 90
    };
    const ipListEl = els?.ipList;
    const setIpBtn = els?.setIp;
    const codeDisplayEl = els?.codeDisplay;
    const codeMetaEl = els?.codeMeta;
    const generateCodeBtn = els?.generateCode;
    const getYear = () => String(getCurrentYear());
    const getTodayKey = () => todayYMD(new Date()).replace(/-/g, '');

    if (setIpBtn) {
      setIpBtn.addEventListener('click', async () => {
        setIpBtn.disabled = true;
        try {
          const ip = await fetchPublicIP();
          await db.ref(SOMAP.P(`years/${getYear()}/workers_settings/attendanceRules/schoolPublicIPs/${getTodayKey()}/${ip}`)).set(true);
          showToast('Saved school internet ✅', 'success');
          await refreshIpList();
        } catch (err) {
          console.error('Failed to save school IP', err);
          showToast('Imeshindwa kuhifadhi Wi-Fi ya shule. Jaribu tena.', 'error');
        } finally {
          setIpBtn.disabled = false;
        }
      });
    }

    if (generateCodeBtn) {
      generateCodeBtn.addEventListener('click', async () => {
        await generateAndDisplay(false);
      });
    }

    function renderIpList(map) {
      if (!ipListEl) return;
      ipListEl.innerHTML = '';
      const ips = Object.keys(map || {}).sort();
      if (!ips.length) {
        ipListEl.textContent = 'Hakuna IP leo.';
        return;
      }
      ips.forEach(ip => {
        const badge = document.createElement('span');
        badge.className = 'ip-badge';
        badge.textContent = ip;
        ipListEl.appendChild(badge);
      });
    }

    async function refreshIpList() {
      if (!ipListEl) return;
      try {
        const snap = await db.ref(SOMAP.P(`years/${getYear()}/workers_settings/attendanceRules/schoolPublicIPs/${getTodayKey()}`)).once('value');
        renderIpList(snap.val() || {});
      } catch (err) {
        console.error('Failed to load school IP list', err);
      }
    }

    async function fetchDailyCode() {
      const snap = await db.ref(SOMAP.P(`years/${getYear()}/workers_settings/dailyCheckin/${getTodayKey()}`)).once('value');
      return snap.val();
    }

    function displayCode(entry) {
      if (codeDisplayEl) {
        codeDisplayEl.textContent = entry?.code || '----';
      }
      if (codeMetaEl) {
        if (entry?.validTo) {
          codeMetaEl.textContent = `Valid until ${formatTime(entry.validTo)}`;
        } else if (!activeRules.rotatingCodeEnabled) {
          codeMetaEl.textContent = 'Rotating code disabled';
        } else {
          codeMetaEl.textContent = 'No code generated yet.';
        }
      }
    }

    function clearTimer() {
      if (timerId) {
        clearTimeout(timerId);
        timerId = null;
      }
    }

    function scheduleRefresh(entry) {
      clearTimer();
      if (!activeRules.rotatingCodeEnabled || !entry?.validTo) return;
      const delay = Math.max(1000, entry.validTo - localTs());
      timerId = setTimeout(() => generateAndDisplay(true), delay);
    }

    async function generateAndDisplay(auto = false) {
      const ttl = Math.max(15, Number(activeRules.codeTTLSeconds) || 90);
      const now = localTs();
      const entry = {
        code: randomNumericCode(6),
        validFrom: now,
        validTo: now + ttl * 1000
      };
      try {
        await db.ref(SOMAP.P(`years/${getYear()}/workers_settings/dailyCheckin/${getTodayKey()}`)).set(entry);
        displayCode(entry);
        showToast(`Rotating code ${auto ? 'refreshed' : 'generated'}`, 'success');
        scheduleRefresh(entry);
      } catch (err) {
        console.error('Failed to save rotating code', err);
        showToast('Imeshindwa kuweka msimbo. Jaribu tena.', 'error');
      }
    }

    async function refreshCodeDisplay() {
      try {
        const entry = await fetchDailyCode();
        if (entry?.code) {
          displayCode(entry);
          if (activeRules.rotatingCodeEnabled) {
            scheduleRefresh(entry);
          }
          return;
        }
        displayCode(null);
        if (activeRules.rotatingCodeEnabled) {
          await generateAndDisplay(false);
        }
      } catch (err) {
        console.error('Failed to load rotating code', err);
      }
    }

    return {
      async applyRules(rules) {
        activeRules = {
          requireSchoolInternet: !!rules?.requireSchoolInternet,
          rotatingCodeEnabled: !!rules?.rotatingCodeEnabled,
          codeTTLSeconds: Number(rules?.codeTTLSeconds) || 90
        };
        if (!activeRules.rotatingCodeEnabled) {
          clearTimer();
        }
        await refreshIpList();
        await refreshCodeDisplay();
      },
      async refreshForYear() {
        await refreshIpList();
        await refreshCodeDisplay();
      },
      async manualGenerate() {
        await generateAndDisplay(false);
      },
      destroy() {
        clearTimer();
      }
    };
  }

  function statusBadge(status) {
    const label = status === 'approved'
      ? 'Approved'
      : status === 'rejected'
        ? 'Rejected'
        : status === 'missing'
          ? 'No check-in'
          : 'Pending';
    return `<span class="status-badge status-${status}">${label}</span>`;
  }

  async function loadAndRender(isEvent = false) {
    try {
      if (!window.firebase || !firebase.database) {
        if (isEvent) showToast('Firebase haijapakiwa.', 'error');
        return;
      }
      if (!window.SOMAP || !SOMAP.getSchool) {
        if (isEvent) showToast('SOMAP haijapakiwa.', 'error');
        return;
      }

      const school = SOMAP.getSchool();
      if (!school || !school.id) return;

      const legacyFriendly = school.id === 'socrates-school' || school.id === 'default';
      const db = firebase.database();
      const workerId = localStorage.getItem('workerId');
      if (!workerId) return;

      const yearCtx = window.somapYearContext || null;
      let currentYear = String(yearCtx?.getSelectedYear?.() || new Date().getFullYear());
      let lastAttendanceSource = 'scoped';
      let latestKeys = { monthKey: '', todayKey: '' };

      const profileSnap = await scopedOrLegacy(db, `years/${currentYear}/workers/${workerId}/profile`, `workers/${workerId}/profile`, legacyFriendly);
      const profile = profileSnap.snap.val() || {};
      const cachedRole = (localStorage.getItem('somap_role') || '').toLowerCase();
      const teacherCfgSnap = await scopedOrLegacy(db, `years/${currentYear}/teachers_config/${workerId}`, `teachers_config/${workerId}`, legacyFriendly);
      const teacherCfg = teacherCfgSnap.snap.val() || {};
      const teacherType = (teacherCfg.teacherType || '').toLowerCase();
      const profileRole = (profile.role || '').toLowerCase();
      const isHead = profileRole.includes('head') || teacherType.includes('head') || cachedRole.includes('head');
      if (!isHead) {
        if (isEvent) showToast('Huna ruhusa ya Head Teacher.', 'warning');
        return;
      }

      injectStyles();
      document.body.classList.add('headteacher-approvals-page');
      const { container, els } = ensureContainer();

      const lockManager = createLockManager({
        db,
        els: els.lock,
        showToast,
        getCurrentYear: () => currentYear
      });

      let rulesRef = db.ref(SOMAP.P(`years/${currentYear}/workers_settings/attendanceRules`));
      const initialRules = await setupRules(els.rules, rulesRef, async (payload) => {
        await lockManager.applyRules(payload);
      });
      await lockManager.applyRules(initialRules);

      const render = async () => {
        const now = new Date();
        const todayKey = todayYMD(now).replace(/-/g, '');
        const monthKey = `${currentYear}${String(now.getMonth() + 1).padStart(2, '0')}`;
        latestKeys = { monthKey, todayKey };

        if (els.todayLabel) {
          els.todayLabel.textContent = now.toLocaleDateString('sw-TZ', { timeZone: TZ, weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
        }

        const [attendance, workers] = await Promise.all([
          scopedOrLegacy(db, `years/${currentYear}/workerAttendance`, 'attendance', legacyFriendly),
          scopedOrLegacy(db, `years/${currentYear}/workers`, 'workers', legacyFriendly)
        ]);

        lastAttendanceSource = attendance.source === 'legacy' ? 'legacy' : 'scoped';
        const attendanceData = attendance.snap.val() || {};
        const workersData = workers.snap.val() || {};
        const rows = [];
        const seen = new Set();
        let totalWorkers = 0;
        let approvedCount = 0;
        let rejectedCount = 0;
        let pendingCount = 0;
        let missingCount = 0;

        Object.entries(workersData || {}).forEach(([id, data]) => {
          seen.add(id);
          totalWorkers += 1;
          const record = attendanceData[id]?.[monthKey]?.[todayKey] || null;
          let status = 'pending';
          if (!record) status = 'missing';
          else if (record.approved === true) status = 'approved';
          else if (record.approved === false) status = 'rejected';

          if (status === 'approved') approvedCount += 1;
          else if (status === 'rejected') rejectedCount += 1;
          else if (status === 'missing') missingCount += 1;
          else pendingCount += 1;

          rows.push({ id, profile: data?.profile || {}, record, status });
        });

        Object.entries(attendanceData || {}).forEach(([id, months]) => {
          if (seen.has(id)) return;
          const record = months?.[monthKey]?.[todayKey] || null;
          if (!record) return;
          rows.push({ id, profile: {}, record, status: record.approved === true ? 'approved' : record.approved === false ? 'rejected' : 'pending' });
          totalWorkers += 1;
          if (record.approved === true) approvedCount += 1;
          else if (record.approved === false) rejectedCount += 1;
          else pendingCount += 1;
        });

        if (els.statTotal) els.statTotal.textContent = totalWorkers;
        if (els.statApproved) els.statApproved.textContent = approvedCount;
        if (els.statRejected) els.statRejected.textContent = rejectedCount;
        if (els.statPending) els.statPending.textContent = pendingCount;
        if (els.statMissing) els.statMissing.textContent = missingCount;

        if (!els.list) return;

        rows.sort((a, b) => {
          const order = { pending: 0, missing: 1, rejected: 2, approved: 3 };
          return order[a.status] - order[b.status];
        });

        if (!rows.length) {
          els.list.innerHTML = `<p class="empty">Hakuna check-ins leo bado.</p>`;
          return;
        }

        els.list.innerHTML = '';
        rows.forEach((row) => {
          const hasRecord = !!row.record;
          const div = document.createElement('article');
          div.className = 'worker-row';
          div.dataset.worker = row.id;
          div.innerHTML = `
            <div class="worker-meta">
              <div>
                <h4>${row.profile.fullNameUpper || row.id}</h4>
                <div class="muted">${row.profile.role || ''}</div>
              </div>
              ${statusBadge(row.status)}
            </div>
            <div class="worker-times">
              <div class="time-pill">Check-In: ${hasRecord ? formatTime(row.record.checkInTs) : '-'}</div>
              <div class="time-pill">Check-Out: ${hasRecord ? formatTime(row.record.checkOutTs) : '-'}</div>
              <div class="time-pill">Late: ${hasRecord ? (row.record.lateMinutes || 0) : 0}m</div>
              <div class="time-pill">Early: ${hasRecord ? (row.record.earlyMinutes || 0) : 0}m</div>
            </div>
            <div class="worker-actions">
              <button class="btn approve" data-action="approve" data-worker="${row.id}" ${!hasRecord ? 'disabled' : ''}>Approve</button>
              <button class="btn reject" data-action="reject" data-worker="${row.id}" ${!hasRecord ? 'disabled' : ''}>Reject</button>
            </div>
          `;
          els.list.appendChild(div);
        });
      };

      const attachRealtime = () => {
        detachFns.forEach(fn => {
          try { fn(); } catch (_) {}
        });
        detachFns.length = 0;
        const paths = [
          SOMAP.P(`years/${currentYear}/workerAttendance`),
          legacyFriendly ? 'attendance' : null
        ].filter(Boolean);
        paths.forEach((path) => {
          const ref = db.ref(path);
          const handler = () => render();
          ref.on('value', handler);
          detachFns.push(() => ref.off('value', handler));
        });
      };

      if (els.list && !els.list.hasAttribute('data-listening')) {
        els.list.setAttribute('data-listening', 'true');
      els.list.addEventListener('click', async (event) => {
        const btn = event.target.closest('button[data-action]');
        if (!btn) return;
        const targetWorker = btn.dataset.worker;
        const approveValue = btn.dataset.action === 'approve';
        const { monthKey, todayKey } = latestKeys;
        if (!monthKey || !todayKey) return;
        const refPath = lastAttendanceSource === 'legacy'
          ? `attendance/${targetWorker}/${monthKey}/${todayKey}`
          : SOMAP.P(`years/${currentYear}/workerAttendance/${targetWorker}/${monthKey}/${todayKey}`);
        try {
          const ref = db.ref(refPath);
          await ref.update({ approved: approveValue, approvedTs: localTs() });
          showToast(`Entry ${approveValue ? 'approved' : 'rejected'}`, approveValue ? 'success' : 'warning');
          render();
        } catch (err) {
          console.error('Failed to update approval', err);
          showToast('Imeshindwa kuhifadhi maamuzi. Jaribu tena.', 'error');
        }
      });
      }

      await render();
      attachRealtime();

      if (yearCtx && yearCtx.onYearChanged) {
        yearCtx.onYearChanged(async (yr) => {
          try {
            currentYear = String(yr);
            rulesRef = db.ref(SOMAP.P(`years/${currentYear}/workers_settings/attendanceRules`));
            const newRules = await setupRules(els.rules, rulesRef, async (payload) => {
              await lockManager.applyRules(payload);
            });
            await lockManager.applyRules(newRules);
            await render();
            attachRealtime();
          } catch (err) {
            console.error('Failed to refresh rules for new year', err);
          }
        });
      }
    } catch (err) {
      console.error('headteacherapprovals error', err);
      if (isEvent) showToast('Hitilafu imetokea wakati wa kupakia.', 'error');
    }
  }

  document.addEventListener('DOMContentLoaded', () => {
    setTimeout(() => loadAndRender(false), 600);
  });

  window.addEventListener('headteacher-approvals-open', () => {
    loadAndRender(true).then(() => {
      const anchor = document.getElementById(containerId);
      if (anchor) anchor.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  });
})();
