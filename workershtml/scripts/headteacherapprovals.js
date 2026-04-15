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
    #${containerId} .decision-note { color:#cbd5e1; font-size:0.9rem; }
    #${containerId} .reason { color:#94a3b8; font-size:0.88rem; margin-top:2px; }
    .ht-modal-overlay { position:fixed; inset:0; background:rgba(2,6,23,0.72); display:flex; align-items:center; justify-content:center; padding:16px; z-index:10000; }
    .ht-modal-card { width:min(440px,100%); background:#0f172a; border:1px solid rgba(255,255,255,0.2); border-radius:14px; padding:14px; display:grid; gap:10px; }
    .ht-modal-card h4 { margin:0; color:#fff; }
    .ht-modal-card p { margin:0; color:#94a3b8; font-size:0.9rem; }
    .ht-modal-card textarea, .ht-modal-card input { width:100%; padding:8px 10px; border-radius:10px; border:1px solid rgba(255,255,255,0.18); background:rgba(255,255,255,0.06); color:#e2e8f0; }
    .ht-modal-actions { display:flex; justify-content:flex-end; gap:8px; }
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
    #${containerId} .report-studio { margin-top:16px; background:linear-gradient(135deg, rgba(15,23,42,0.8), rgba(15,118,110,0.14)); }
    #${containerId} .report-toolbar { display:grid; grid-template-columns:repeat(auto-fit,minmax(180px,1fr)); gap:10px; margin-top:12px; }
    #${containerId} select,
    #${containerId} input[type="date"] { padding:8px 10px; border:1px solid rgba(255,255,255,0.18); border-radius:10px; background:rgba(255,255,255,0.08); color:#e2e8f0; }
    #${containerId} select option { color:#0f172a; }
    #${containerId} .preset-row { display:flex; gap:8px; flex-wrap:wrap; margin-top:12px; }
    #${containerId} .preset-btn { background:rgba(34,211,238,0.12); border:1px solid rgba(34,211,238,0.28); color:#a5f3fc; }
    #${containerId} .report-preview { margin-top:14px; display:grid; gap:12px; }
    #${containerId} .report-panel { background:rgba(255,255,255,0.05); border:1px solid rgba(255,255,255,0.12); border-radius:14px; padding:12px; }
    #${containerId} .report-panel h4 { margin:0 0 8px; color:#fff; font-size:1rem; }
    #${containerId} .report-meta { color:#94a3b8; font-size:0.88rem; margin-bottom:10px; }
    #${containerId} .report-table-wrap { overflow:auto; border-radius:12px; border:1px solid rgba(255,255,255,0.08); }
    #${containerId} .report-table { width:100%; border-collapse:collapse; min-width:760px; }
    #${containerId} .report-table th,
    #${containerId} .report-table td { padding:8px 9px; border-bottom:1px solid rgba(255,255,255,0.08); text-align:left; vertical-align:top; font-size:0.9rem; }
    #${containerId} .report-table th { background:rgba(15,23,42,0.82); color:#cbd5e1; text-transform:uppercase; letter-spacing:0.05em; font-size:0.76rem; position:sticky; top:0; }
    #${containerId} .report-table tbody tr:nth-child(odd) { background:rgba(255,255,255,0.03); }
    #${containerId} .report-table .num { text-align:right; white-space:nowrap; }
    #${containerId} .letter-stack { display:grid; gap:8px; }
    #${containerId} .letter-card { border-radius:12px; border:1px solid rgba(251,191,36,0.25); background:rgba(251,191,36,0.08); padding:10px; }
    #${containerId} .letter-card strong { color:#fde68a; }
    #${containerId} .letter-card p { margin:6px 0 0; color:#f8fafc; font-size:0.92rem; line-height:1.5; }
    #${containerId} .letter-dates { margin-top:6px; color:#cbd5e1; font-size:0.84rem; }
    #${containerId} .report-empty { color:#94a3b8; font-size:0.95rem; padding:10px 0; }
    #${containerId} .worker-actions .btn.report { background:rgba(34,211,238,0.16); border-color:rgba(34,211,238,0.36); color:#a5f3fc; }
    @media (max-width: 640px) {
      #${containerId} { padding:14px; }
      #${containerId} .worker-actions { justify-content:flex-start; }
      #${containerId} .report-table { min-width:620px; }
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
        <div class="rules report-studio" id="${containerId}-reportStudio">
          <div class="ht-section__header">
            <div>
              <h3 style="margin:0;">Master Attendance Reports</h3>
              <p class="subtitle" style="margin:4px 0 0;">Chagua siku, wiki, mwezi, mwaka au date range maalum, kisha soma preview au toa PDF ya mfanyakazi mmoja au wote.</p>
            </div>
            <div class="pill">Compact PDF | Colored | Letters analysed</div>
          </div>
          <div class="report-toolbar">
            <label>Grouping
              <select id="${containerId}-reportGrouping">
                <option value="daily">Per Day</option>
                <option value="weekly">Per Week</option>
                <option value="monthly" selected>Per Month</option>
                <option value="yearly">Per Year</option>
              </select>
            </label>
            <label>From Date
              <input type="date" id="${containerId}-reportFrom">
            </label>
            <label>To Date
              <input type="date" id="${containerId}-reportTo">
            </label>
            <label>Single Worker PDF
              <select id="${containerId}-reportWorker">
                <option value="">Choose worker</option>
              </select>
            </label>
          </div>
          <div class="preset-row">
            <button class="btn preset-btn" data-range-preset="today">Today</button>
            <button class="btn preset-btn" data-range-preset="week">This Week</button>
            <button class="btn preset-btn" data-range-preset="month">This Month</button>
            <button class="btn preset-btn" data-range-preset="quarter">Last 90 Days</button>
            <button class="btn preset-btn" data-range-preset="ytd">January to Now</button>
            <button class="btn preset-btn" data-range-preset="year">Full Year</button>
          </div>
          <div class="worker-actions" style="margin-top:12px; justify-content:flex-start;">
            <button class="btn" id="${containerId}-reportRefresh">Refresh Preview</button>
            <button class="btn approve" id="${containerId}-reportMasterPdf">Download Master PDF</button>
            <button class="btn report" id="${containerId}-reportWorkerPdf">Download Worker PDF</button>
          </div>
          <div class="report-preview" id="${containerId}-reportPreview">
            <div class="report-empty">Preview will appear here after loading attendance data.</div>
          </div>
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
      report: {
        grouping: document.getElementById(`${containerId}-reportGrouping`),
        from: document.getElementById(`${containerId}-reportFrom`),
        to: document.getElementById(`${containerId}-reportTo`),
        worker: document.getElementById(`${containerId}-reportWorker`),
        refresh: document.getElementById(`${containerId}-reportRefresh`),
        masterPdf: document.getElementById(`${containerId}-reportMasterPdf`),
        workerPdf: document.getElementById(`${containerId}-reportWorkerPdf`),
        preview: document.getElementById(`${containerId}-reportPreview`),
        studio: document.getElementById(`${containerId}-reportStudio`)
      },
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

  function statusFromLegacy(record, kind) {
    if (!record) return 'missing';
    const direct = kind === 'in' ? record.checkInStatus : record.checkOutStatus;
    if (direct) return direct;
    if (kind === 'in') {
      if (record.approved === true) return 'approved';
      if (record.approved === false && record.approvedTs) return 'rejected';
      return record.checkInTs ? 'pending' : 'missing';
    }
    if (!record.checkOutTs) return 'missing';
    return 'pending';
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

  const SCRIPT_CACHE = new Map();
  const JSPDF_URL = 'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js';
  const AUTOTABLE_URL = 'https://cdnjs.cloudflare.com/ajax/libs/jspdf-autotable/3.8.0/jspdf.plugin.autotable.min.js';

  function loadScriptOnce(src) {
    if (SCRIPT_CACHE.has(src)) return SCRIPT_CACHE.get(src);
    const promise = new Promise((resolve, reject) => {
      if ([...document.scripts].some((script) => script.src === src)) {
        resolve();
        return;
      }
      const script = document.createElement('script');
      script.src = src;
      script.async = true;
      script.onload = () => resolve();
      script.onerror = () => reject(new Error(`Failed to load ${src}`));
      document.head.appendChild(script);
    });
    SCRIPT_CACHE.set(src, promise);
    return promise;
  }

  async function ensurePdfLibs() {
    if (!window.jspdf?.jsPDF) await loadScriptOnce(JSPDF_URL);
    if (!window.jspdf?.jsPDF?.API?.autoTable && !window.jspdf?.autoTable) {
      await loadScriptOnce(AUTOTABLE_URL);
    }
    return window.jspdf?.jsPDF;
  }

  function escapeHtml(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function slugify(value) {
    return String(value || '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'report';
  }

  function cleanText(value) {
    return String(value || '').replace(/\s+/g, ' ').trim();
  }

  function truncateText(value, limit = 180) {
    const text = cleanText(value);
    return text.length > limit ? `${text.slice(0, limit - 3)}...` : text;
  }

  function normalizeLetterKey(value) {
    return cleanText(value)
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function parseDayKey(dayKey) {
    const raw = String(dayKey || '').trim();
    if (!/^\d{8}$/.test(raw)) return null;
    return new Date(`${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}T12:00:00`);
  }

  function dayKeyToInput(dayKey) {
    const raw = String(dayKey || '').trim();
    if (!/^\d{8}$/.test(raw)) return '';
    return `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}`;
  }

  function inputToDayKey(value) {
    return /^\d{4}-\d{2}-\d{2}$/.test(String(value || '').trim())
      ? String(value).replace(/-/g, '')
      : '';
  }

  function formatDayLabel(dayKey, locale = 'en-GB') {
    const date = parseDayKey(dayKey);
    if (!date) return dayKey || '-';
    return date.toLocaleDateString(locale, { weekday: 'short', day: '2-digit', month: 'short', year: 'numeric' });
  }

  function formatClockTime(ts) {
    return ts ? new Date(ts).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }) : '-';
  }

  function formatDateTime(ts) {
    return ts ? new Date(ts).toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '-';
  }

  function timeMinutesFromTs(ts) {
    if (!ts) return NaN;
    const date = new Date(ts);
    return (date.getHours() * 60) + date.getMinutes();
  }

  function averageMinutes(values) {
    const nums = values.filter((value) => Number.isFinite(value));
    if (!nums.length) return '-';
    const avg = Math.round(nums.reduce((sum, value) => sum + value, 0) / nums.length);
    return `${String(Math.floor(avg / 60)).padStart(2, '0')}:${String(avg % 60).padStart(2, '0')}`;
  }

  function startOfWeek(date) {
    const clone = new Date(date);
    const diff = (clone.getDay() + 6) % 7;
    clone.setDate(clone.getDate() - diff);
    clone.setHours(12, 0, 0, 0);
    return clone;
  }

  function endOfWeek(date) {
    const clone = startOfWeek(date);
    clone.setDate(clone.getDate() + 6);
    return clone;
  }

  function isoWeekKey(date) {
    const target = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
    const dayNr = (target.getUTCDay() + 6) % 7;
    target.setUTCDate(target.getUTCDate() - dayNr + 3);
    const firstThursday = new Date(Date.UTC(target.getUTCFullYear(), 0, 4));
    const firstDayNr = (firstThursday.getUTCDay() + 6) % 7;
    firstThursday.setUTCDate(firstThursday.getUTCDate() - firstDayNr + 3);
    const weekNumber = 1 + Math.round((target - firstThursday) / 604800000);
    return `${target.getUTCFullYear()}-W${String(weekNumber).padStart(2, '0')}`;
  }

  function getPeriodBucket(dayKey, grouping) {
    const date = parseDayKey(dayKey);
    if (!date) return { key: String(dayKey || ''), label: String(dayKey || '') };
    if (grouping === 'yearly') {
      const year = String(date.getFullYear());
      return { key: year, label: year };
    }
    if (grouping === 'monthly') {
      return {
        key: `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`,
        label: date.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })
      };
    }
    if (grouping === 'weekly') {
      const start = startOfWeek(date);
      const end = endOfWeek(date);
      return {
        key: isoWeekKey(date),
        label: `${start.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })} - ${end.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })}`
      };
    }
    return { key: dayKey, label: formatDayLabel(dayKey) };
  }

  function getRangePreset(year, preset) {
    const now = new Date();
    const numericYear = Number(year) || now.getFullYear();
    const activeNow = now.getFullYear() === numericYear
      ? now
      : new Date(`${numericYear}-12-31T12:00:00`);
    const todayInput = todayYMD(activeNow);
    const anchor = new Date(`${todayInput}T12:00:00`);
    if (preset === 'today') return { from: todayInput, to: todayInput };
    if (preset === 'week') {
      return { from: startOfWeek(anchor).toISOString().slice(0, 10), to: todayInput };
    }
    if (preset === 'month') {
      return { from: `${numericYear}-${String(anchor.getMonth() + 1).padStart(2, '0')}-01`, to: todayInput };
    }
    if (preset === 'quarter') {
      const from = new Date(anchor);
      from.setDate(from.getDate() - 89);
      return { from: from.toISOString().slice(0, 10), to: todayInput };
    }
    if (preset === 'ytd') return { from: `${numericYear}-01-01`, to: todayInput };
    return { from: `${numericYear}-01-01`, to: `${numericYear}-12-31` };
  }

  function sortLetterThemes(themes) {
    return [...themes].sort((a, b) => {
      if (b.count !== a.count) return b.count - a.count;
      return a.text.localeCompare(b.text);
    });
  }

  function buildSummaryCards(items) {
    return `<div class="ht-grid">${items.map((item) => `
      <div class="stat-card">
        <p class="stat-label">${escapeHtml(item.label)}</p>
        <div class="stat-value">${escapeHtml(item.value)}</div>
      </div>
    `).join('')}</div>`;
  }

  function buildLettersHtml(letters, emptyText) {
    if (!letters.length) {
      return `<div class="report-empty">${escapeHtml(emptyText)}</div>`;
    }
    return `
      <div class="letter-stack">
        ${letters.map((letter) => `
          <div class="letter-card">
            <strong>${escapeHtml(letter.workerName || '')}${letter.workerName ? ' | ' : ''}${escapeHtml(`Repeated ${letter.count} time${letter.count === 1 ? '' : 's'}`)}</strong>
            <p>${escapeHtml(truncateText(letter.text, 280))}</p>
            <div class="letter-dates">${escapeHtml(letter.dateLabel || '')}</div>
          </div>
        `).join('')}
      </div>
    `;
  }

  function analyseAttendanceReport({ attendanceData, workersData, fromKey, toKey, grouping, selectedWorkerId }) {
    const workerProfiles = new Map();
    Object.entries(workersData || {}).forEach(([workerId, entry]) => {
      workerProfiles.set(workerId, {
        workerId,
        name: cleanText(entry?.profile?.fullNameUpper || entry?.profile?.fullName || workerId),
        role: cleanText(entry?.profile?.role || '')
      });
    });

    Object.keys(attendanceData || {}).forEach((workerId) => {
      if (!workerProfiles.has(workerId)) {
        workerProfiles.set(workerId, { workerId, name: workerId, role: '' });
      }
    });

    const normalizedRows = [];
    Object.entries(attendanceData || {}).forEach(([workerId, months]) => {
      Object.entries(months || {}).forEach(([, days]) => {
        Object.entries(days || {}).forEach(([dayKey, record]) => {
          if (fromKey && dayKey < fromKey) return;
          if (toKey && dayKey > toKey) return;
          const profile = workerProfiles.get(workerId) || { workerId, name: workerId, role: '' };
          normalizedRows.push({
            workerId,
            name: profile.name,
            role: profile.role,
            dayKey,
            dayLabel: formatDayLabel(dayKey),
            checkInTs: Number(record?.checkInTs || 0) || 0,
            checkOutTs: Number(record?.checkOutTs || 0) || 0,
            lateMinutes: Math.max(0, Number(record?.lateMinutes || 0) || 0),
            earlyMinutes: Math.max(0, Number(record?.earlyMinutes || 0) || 0),
            overtimeMinutes: Math.max(0, Number(record?.overtimeMinutes || 0) || 0),
            checkInReason: cleanText(record?.checkInReason || ''),
            checkOutReason: cleanText(record?.checkOutReason || ''),
            checkInStatus: statusFromLegacy(record, 'in'),
            checkOutStatus: statusFromLegacy(record, 'out')
          });
        });
      });
    });

    normalizedRows.sort((a, b) => {
      if (a.workerId !== b.workerId) return a.name.localeCompare(b.name);
      return a.dayKey.localeCompare(b.dayKey);
    });

    const ids = selectedWorkerId
      ? [selectedWorkerId]
      : [...workerProfiles.keys()].sort((a, b) => {
        const left = workerProfiles.get(a)?.name || a;
        const right = workerProfiles.get(b)?.name || b;
        return left.localeCompare(right);
      });

    const workers = ids.map((workerId) => {
      const profile = workerProfiles.get(workerId) || { workerId, name: workerId, role: '' };
      const records = normalizedRows.filter((row) => row.workerId === workerId);
      const lateRecords = records.filter((row) => row.lateMinutes > 0);
      const earlyRecords = records.filter((row) => row.earlyMinutes > 0);
      const letters = lateRecords.filter((row) => row.checkInReason);
      const letterMap = new Map();

      letters.forEach((row) => {
        const key = normalizeLetterKey(row.checkInReason) || row.dayKey;
        const existing = letterMap.get(key) || {
          key,
          text: row.checkInReason,
          count: 0,
          dates: [],
          lateMinutes: 0
        };
        existing.count += 1;
        existing.dates.push(row.dayKey);
        existing.lateMinutes += row.lateMinutes;
        if (row.checkInReason.length > existing.text.length) existing.text = row.checkInReason;
        letterMap.set(key, existing);
      });

      const periodMap = new Map();
      records.forEach((row) => {
        const bucket = getPeriodBucket(row.dayKey, grouping);
        const current = periodMap.get(bucket.key) || {
          periodKey: bucket.key,
          periodLabel: bucket.label,
          attendanceDays: 0,
          lateDays: 0,
          earlyDays: 0,
          lettersCount: 0,
          totalLateMinutes: 0
        };
        if (row.checkInTs) current.attendanceDays += 1;
        if (row.lateMinutes > 0) {
          current.lateDays += 1;
          current.totalLateMinutes += row.lateMinutes;
        }
        if (row.earlyMinutes > 0) current.earlyDays += 1;
        if (row.checkInReason) current.lettersCount += 1;
        periodMap.set(bucket.key, current);
      });

      return {
        workerId,
        name: profile.name,
        role: profile.role,
        records,
        metrics: {
          attendanceDays: records.filter((row) => row.checkInTs).length,
          onTimeDays: records.filter((row) => row.checkInTs && row.lateMinutes === 0).length,
          lateDays: lateRecords.length,
          earlyDays: earlyRecords.length,
          overtimeDays: records.filter((row) => row.overtimeMinutes > 0).length,
          latenessLetters: letters.length,
          missingLetters: lateRecords.filter((row) => !row.checkInReason).length,
          totalLateMinutes: lateRecords.reduce((sum, row) => sum + row.lateMinutes, 0),
          totalEarlyMinutes: earlyRecords.reduce((sum, row) => sum + row.earlyMinutes, 0),
          approvedIn: records.filter((row) => row.checkInStatus === 'approved').length,
          rejectedIn: records.filter((row) => row.checkInStatus === 'rejected').length,
          approvedOut: records.filter((row) => row.checkOutStatus === 'approved').length,
          rejectedOut: records.filter((row) => row.checkOutStatus === 'rejected').length,
          averageCheckIn: averageMinutes(records.filter((row) => row.checkInTs).map((row) => timeMinutesFromTs(row.checkInTs))),
          averageCheckOut: averageMinutes(records.filter((row) => row.checkOutTs).map((row) => timeMinutesFromTs(row.checkOutTs)))
        },
        periods: [...periodMap.values()].sort((a, b) => a.periodKey.localeCompare(b.periodKey)),
        letterThemes: sortLetterThemes([...letterMap.values()].map((item) => ({
          ...item,
          dates: item.dates.sort(),
          dateLabel: item.dates.sort().map((day) => formatDayLabel(day)).join(', ')
        })))
      };
    }).sort((a, b) => {
      if (b.metrics.lateDays !== a.metrics.lateDays) return b.metrics.lateDays - a.metrics.lateDays;
      if (b.metrics.attendanceDays !== a.metrics.attendanceDays) return b.metrics.attendanceDays - a.metrics.attendanceDays;
      return a.name.localeCompare(b.name);
    });

    const allPeriods = new Map();
    const allLetters = [];
    workers.forEach((worker) => {
      worker.periods.forEach((period) => {
        const current = allPeriods.get(period.periodKey) || {
          periodKey: period.periodKey,
          periodLabel: period.periodLabel,
          attendanceDays: 0,
          lateDays: 0,
          earlyDays: 0,
          lettersCount: 0,
          totalLateMinutes: 0
        };
        current.attendanceDays += period.attendanceDays;
        current.lateDays += period.lateDays;
        current.earlyDays += period.earlyDays;
        current.lettersCount += period.lettersCount;
        current.totalLateMinutes += period.totalLateMinutes;
        allPeriods.set(period.periodKey, current);
      });
      worker.letterThemes.forEach((theme) => {
        allLetters.push({
          workerId: worker.workerId,
          workerName: worker.name,
          role: worker.role,
          ...theme
        });
      });
    });

    return {
      filters: { fromKey, toKey, grouping, selectedWorkerId: selectedWorkerId || '' },
      workers,
      overall: {
        workersCovered: workers.length,
        activeWorkers: workers.filter((worker) => worker.metrics.attendanceDays > 0).length,
        attendanceDays: workers.reduce((sum, worker) => sum + worker.metrics.attendanceDays, 0),
        lateDays: workers.reduce((sum, worker) => sum + worker.metrics.lateDays, 0),
        earlyDays: workers.reduce((sum, worker) => sum + worker.metrics.earlyDays, 0),
        latenessLetters: workers.reduce((sum, worker) => sum + worker.metrics.latenessLetters, 0),
        totalLateMinutes: workers.reduce((sum, worker) => sum + worker.metrics.totalLateMinutes, 0)
      },
      periods: [...allPeriods.values()].sort((a, b) => a.periodKey.localeCompare(b.periodKey)),
      letters: allLetters.sort((a, b) => {
        if (b.count !== a.count) return b.count - a.count;
        return a.workerName.localeCompare(b.workerName);
      }),
      detailedRows: normalizedRows.filter((row) => !selectedWorkerId || row.workerId === selectedWorkerId)
    };
  }

  function buildReportPreviewHtml(report) {
    const fromLabel = formatDayLabel(report.filters.fromKey, 'en-GB');
    const toLabel = formatDayLabel(report.filters.toKey, 'en-GB');
    if (report.filters.selectedWorkerId) {
      const worker = report.workers[0];
      if (!worker) return '<div class="report-empty">No worker found for the selected report.</div>';
      return `
        ${buildSummaryCards([
          { label: 'Attendance Days', value: worker.metrics.attendanceDays },
          { label: 'On Time', value: worker.metrics.onTimeDays },
          { label: 'Late Days', value: worker.metrics.lateDays },
          { label: 'Early Leave Days', value: worker.metrics.earlyDays },
          { label: 'Lateness Letters', value: worker.metrics.latenessLetters },
          { label: 'Average IN / OUT', value: `${worker.metrics.averageCheckIn} / ${worker.metrics.averageCheckOut}` }
        ])}
        <div class="report-panel">
          <h4>${escapeHtml(worker.name)}</h4>
          <div class="report-meta">${escapeHtml(worker.role || 'Worker')} | ${escapeHtml(fromLabel)} to ${escapeHtml(toLabel)}</div>
          <div class="report-table-wrap">
            <table class="report-table">
              <thead>
                <tr><th>Period</th><th class="num">Attendance</th><th class="num">Late</th><th class="num">Early</th><th class="num">Letters</th><th class="num">Late Minutes</th></tr>
              </thead>
              <tbody>
                ${worker.periods.map((row) => `
                  <tr>
                    <td>${escapeHtml(row.periodLabel)}</td>
                    <td class="num">${row.attendanceDays}</td>
                    <td class="num">${row.lateDays}</td>
                    <td class="num">${row.earlyDays}</td>
                    <td class="num">${row.lettersCount}</td>
                    <td class="num">${row.totalLateMinutes}</td>
                  </tr>
                `).join('') || '<tr><td colspan="6">No attendance records in this period.</td></tr>'}
              </tbody>
            </table>
          </div>
        </div>
        <div class="report-panel">
          <h4>Lateness Letters</h4>
          ${buildLettersHtml(worker.letterThemes.map((theme) => ({ ...theme, workerName: worker.name })), 'No lateness letters recorded in this period.')}
        </div>
        <div class="report-panel">
          <h4>Detailed Attendance</h4>
          <div class="report-table-wrap">
            <table class="report-table">
              <thead>
                <tr><th>Date</th><th>Check-In</th><th class="num">Late</th><th>Late Letter</th><th>Check-Out</th><th class="num">Early</th><th>Out Note</th><th>IN</th><th>OUT</th></tr>
              </thead>
              <tbody>
                ${worker.records.map((row) => `
                  <tr>
                    <td>${escapeHtml(row.dayLabel)}</td>
                    <td>${escapeHtml(formatClockTime(row.checkInTs))}</td>
                    <td class="num">${row.lateMinutes}</td>
                    <td>${escapeHtml(truncateText(row.checkInReason || '-', 120))}</td>
                    <td>${escapeHtml(formatClockTime(row.checkOutTs))}</td>
                    <td class="num">${row.earlyMinutes}</td>
                    <td>${escapeHtml(truncateText(row.checkOutReason || '-', 120))}</td>
                    <td>${escapeHtml(row.checkInStatus)}</td>
                    <td>${escapeHtml(row.checkOutStatus)}</td>
                  </tr>
                `).join('') || '<tr><td colspan="9">No attendance records in this period.</td></tr>'}
              </tbody>
            </table>
          </div>
        </div>
      `;
    }

    return `
      ${buildSummaryCards([
        { label: 'Workers Covered', value: report.overall.workersCovered },
        { label: 'Active Workers', value: report.overall.activeWorkers },
        { label: 'Attendance Days', value: report.overall.attendanceDays },
        { label: 'Late Days', value: report.overall.lateDays },
        { label: 'Early Leave Days', value: report.overall.earlyDays },
        { label: 'Lateness Letters', value: report.overall.latenessLetters }
      ])}
      <div class="report-panel">
        <h4>Teacher Performance Summary</h4>
        <div class="report-meta">${escapeHtml(fromLabel)} to ${escapeHtml(toLabel)} | ${escapeHtml(report.filters.grouping)}</div>
        <div class="report-table-wrap">
          <table class="report-table">
            <thead>
              <tr><th>Worker</th><th>Role</th><th class="num">Days</th><th class="num">On Time</th><th class="num">Late</th><th class="num">Early</th><th class="num">Letters</th><th>Top Letter Theme</th></tr>
            </thead>
            <tbody>
              ${report.workers.map((worker) => `
                <tr>
                  <td>${escapeHtml(worker.name)}</td>
                  <td>${escapeHtml(worker.role || '-')}</td>
                  <td class="num">${worker.metrics.attendanceDays}</td>
                  <td class="num">${worker.metrics.onTimeDays}</td>
                  <td class="num">${worker.metrics.lateDays}</td>
                  <td class="num">${worker.metrics.earlyDays}</td>
                  <td class="num">${worker.metrics.latenessLetters}</td>
                  <td>${escapeHtml(truncateText(worker.letterThemes[0]?.text || '-', 90))}</td>
                </tr>
              `).join('') || '<tr><td colspan="8">No attendance records found for the selected range.</td></tr>'}
            </tbody>
          </table>
        </div>
      </div>
      <div class="report-panel">
        <h4>Grouped Period Breakdown</h4>
        <div class="report-table-wrap">
          <table class="report-table">
            <thead>
              <tr><th>Period</th><th class="num">Attendance</th><th class="num">Late</th><th class="num">Early</th><th class="num">Letters</th><th class="num">Late Minutes</th></tr>
            </thead>
            <tbody>
              ${report.periods.map((row) => `
                <tr>
                  <td>${escapeHtml(row.periodLabel)}</td>
                  <td class="num">${row.attendanceDays}</td>
                  <td class="num">${row.lateDays}</td>
                  <td class="num">${row.earlyDays}</td>
                  <td class="num">${row.lettersCount}</td>
                  <td class="num">${row.totalLateMinutes}</td>
                </tr>
              `).join('') || '<tr><td colspan="6">No grouped totals available.</td></tr>'}
            </tbody>
          </table>
        </div>
      </div>
      <div class="report-panel">
        <h4>Lateness Letter Analysis</h4>
        ${buildLettersHtml(report.letters.slice(0, 12), 'No lateness letters recorded in this period.')}
      </div>
    `;
  }

  function drawPdfHeader(doc, title, subtitle, accent) {
    const pageWidth = doc.internal.pageSize.getWidth();
    doc.setFillColor(15, 23, 42);
    doc.rect(0, 0, pageWidth, 26, 'F');
    doc.setFillColor(...accent);
    doc.rect(0, 26, pageWidth, 7, 'F');
    doc.setTextColor(248, 250, 252);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(18);
    doc.text(title, 14, 16);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(10.5);
    doc.text(subtitle, 14, 24);
    doc.setTextColor(15, 23, 42);
  }

  function drawPdfSummaryStrip(doc, items) {
    const startY = 38;
    const boxW = (doc.internal.pageSize.getWidth() - 28 - (items.length - 1) * 4) / items.length;
    items.forEach((item, index) => {
      const x = 14 + index * (boxW + 4);
      doc.setFillColor(241, 245, 249);
      doc.roundedRect(x, startY, boxW, 16, 3, 3, 'F');
      doc.setTextColor(71, 85, 105);
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(8.5);
      doc.text(String(item.label), x + 3, startY + 5.2);
      doc.setTextColor(15, 23, 42);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(11);
      doc.text(String(item.value), x + 3, startY + 11.8);
    });
    return startY + 20;
  }

  function addPdfFooter(doc) {
    const totalPages = doc.internal.getNumberOfPages();
    for (let page = 1; page <= totalPages; page += 1) {
      doc.setPage(page);
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(8);
      doc.setTextColor(100, 116, 139);
      doc.text(`Page ${page} of ${totalPages}`, doc.internal.pageSize.getWidth() - 26, doc.internal.pageSize.getHeight() - 6);
    }
  }

  function saveMasterPdf({ report, schoolName, year }) {
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4', compress: true });
    const subtitle = `${schoolName} | ${formatDayLabel(report.filters.fromKey)} to ${formatDayLabel(report.filters.toKey)} | Generated ${formatDateTime(Date.now())}`;
    drawPdfHeader(doc, 'Headteacher Master Attendance Report', subtitle, [20, 184, 166]);
    const y = drawPdfSummaryStrip(doc, [
      { label: 'Workers Covered', value: report.overall.workersCovered },
      { label: 'Active Workers', value: report.overall.activeWorkers },
      { label: 'Attendance Days', value: report.overall.attendanceDays },
      { label: 'Late Days', value: report.overall.lateDays },
      { label: 'Early Leave', value: report.overall.earlyDays },
      { label: 'Letters', value: report.overall.latenessLetters }
    ]);

    doc.autoTable({
      startY: y,
      head: [['Worker', 'Role', 'Days', 'On Time', 'Late', 'Early', 'Letters', 'Avg IN', 'Avg OUT', 'Top Letter Theme']],
      body: report.workers.map((worker) => [
        worker.name,
        worker.role || '-',
        worker.metrics.attendanceDays,
        worker.metrics.onTimeDays,
        worker.metrics.lateDays,
        worker.metrics.earlyDays,
        worker.metrics.latenessLetters,
        worker.metrics.averageCheckIn,
        worker.metrics.averageCheckOut,
        truncateText(worker.letterThemes[0]?.text || '-', 90)
      ]),
      margin: { left: 10, right: 10 },
      styles: { fontSize: 8.2, cellPadding: 2.2, lineColor: [226, 232, 240], lineWidth: 0.1, valign: 'top' },
      headStyles: { fillColor: [15, 23, 42], textColor: [248, 250, 252], fontStyle: 'bold' },
      alternateRowStyles: { fillColor: [248, 250, 252] }
    });

    doc.autoTable({
      startY: doc.lastAutoTable.finalY + 6,
      head: [[`${report.filters.grouping.toUpperCase()} Breakdown`, 'Attendance', 'Late', 'Early', 'Letters', 'Late Minutes']],
      body: report.periods.map((row) => [row.periodLabel, row.attendanceDays, row.lateDays, row.earlyDays, row.lettersCount, row.totalLateMinutes]),
      margin: { left: 10, right: 10 },
      styles: { fontSize: 8.2, cellPadding: 2.2, lineColor: [226, 232, 240], lineWidth: 0.1 },
      headStyles: { fillColor: [14, 116, 144], textColor: [248, 250, 252], fontStyle: 'bold' },
      alternateRowStyles: { fillColor: [239, 246, 255] }
    });

    doc.autoTable({
      startY: doc.lastAutoTable.finalY + 6,
      head: [['Worker', 'Repeated', 'Letter Content', 'Dates']],
      body: (report.letters.length ? report.letters : [{
        workerName: '-',
        count: 0,
        text: 'No lateness letters recorded in this period.',
        dateLabel: '-'
      }]).map((row) => [row.workerName, row.count, truncateText(row.text, 180), row.dateLabel]),
      margin: { left: 10, right: 10 },
      styles: { fontSize: 8, cellPadding: 2.2, lineColor: [253, 230, 138], lineWidth: 0.1, valign: 'top' },
      headStyles: { fillColor: [180, 83, 9], textColor: [255, 251, 235], fontStyle: 'bold' },
      alternateRowStyles: { fillColor: [255, 251, 235] }
    });

    doc.autoTable({
      startY: doc.lastAutoTable.finalY + 6,
      head: [['Worker', 'Date', 'Check-In', 'Late', 'Lateness Letter', 'Check-Out', 'Early', 'Out Note', 'IN', 'OUT']],
      body: report.detailedRows.map((row) => [
        row.name,
        row.dayLabel,
        formatClockTime(row.checkInTs),
        row.lateMinutes,
        truncateText(row.checkInReason || '-', 140),
        formatClockTime(row.checkOutTs),
        row.earlyMinutes,
        truncateText(row.checkOutReason || '-', 120),
        row.checkInStatus,
        row.checkOutStatus
      ]),
      margin: { left: 10, right: 10 },
      styles: { fontSize: 7.6, cellPadding: 1.8, lineColor: [226, 232, 240], lineWidth: 0.1, valign: 'top' },
      headStyles: { fillColor: [30, 41, 59], textColor: [248, 250, 252], fontStyle: 'bold' },
      alternateRowStyles: { fillColor: [248, 250, 252] }
    });

    addPdfFooter(doc);
    doc.save(`${slugify(schoolName)}_headteacher_master_attendance_${year}_${report.filters.fromKey}_${report.filters.toKey}.pdf`);
  }

  function saveWorkerPdf({ report, schoolName, year }) {
    const worker = report.workers[0];
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4', compress: true });
    const subtitle = `${schoolName} | ${worker.name} | ${formatDayLabel(report.filters.fromKey)} to ${formatDayLabel(report.filters.toKey)} | Generated ${formatDateTime(Date.now())}`;
    drawPdfHeader(doc, 'Individual Worker Attendance Report', subtitle, [59, 130, 246]);
    const y = drawPdfSummaryStrip(doc, [
      { label: 'Attendance', value: worker.metrics.attendanceDays },
      { label: 'On Time', value: worker.metrics.onTimeDays },
      { label: 'Late', value: worker.metrics.lateDays },
      { label: 'Early', value: worker.metrics.earlyDays },
      { label: 'Letters', value: worker.metrics.latenessLetters },
      { label: 'Avg IN / OUT', value: `${worker.metrics.averageCheckIn} / ${worker.metrics.averageCheckOut}` }
    ]);

    doc.autoTable({
      startY: y,
      head: [[`${report.filters.grouping.toUpperCase()} Breakdown`, 'Attendance', 'Late', 'Early', 'Letters', 'Late Minutes']],
      body: worker.periods.map((row) => [row.periodLabel, row.attendanceDays, row.lateDays, row.earlyDays, row.lettersCount, row.totalLateMinutes]),
      margin: { left: 10, right: 10 },
      styles: { fontSize: 8.6, cellPadding: 2.4, lineColor: [226, 232, 240], lineWidth: 0.1 },
      headStyles: { fillColor: [30, 64, 175], textColor: [248, 250, 252], fontStyle: 'bold' },
      alternateRowStyles: { fillColor: [239, 246, 255] }
    });

    doc.autoTable({
      startY: doc.lastAutoTable.finalY + 6,
      head: [['Repeated', 'Letter Content', 'Dates']],
      body: (worker.letterThemes.length ? worker.letterThemes : [{
        count: 0,
        text: 'No lateness letters recorded in this period.',
        dateLabel: '-'
      }]).map((row) => [row.count, truncateText(row.text, 220), row.dateLabel]),
      margin: { left: 10, right: 10 },
      styles: { fontSize: 8.4, cellPadding: 2.4, lineColor: [253, 230, 138], lineWidth: 0.1, valign: 'top' },
      headStyles: { fillColor: [180, 83, 9], textColor: [255, 251, 235], fontStyle: 'bold' },
      alternateRowStyles: { fillColor: [255, 251, 235] }
    });

    doc.autoTable({
      startY: doc.lastAutoTable.finalY + 6,
      head: [['Date', 'Check-In', 'Late', 'Lateness Letter', 'Check-Out', 'Early', 'Out Note', 'IN', 'OUT']],
      body: worker.records.map((row) => [
        row.dayLabel,
        formatClockTime(row.checkInTs),
        row.lateMinutes,
        truncateText(row.checkInReason || '-', 180),
        formatClockTime(row.checkOutTs),
        row.earlyMinutes,
        truncateText(row.checkOutReason || '-', 150),
        row.checkInStatus,
        row.checkOutStatus
      ]),
      margin: { left: 10, right: 10 },
      styles: { fontSize: 8.2, cellPadding: 2.2, lineColor: [226, 232, 240], lineWidth: 0.1, valign: 'top' },
      headStyles: { fillColor: [15, 23, 42], textColor: [248, 250, 252], fontStyle: 'bold' },
      alternateRowStyles: { fillColor: [248, 250, 252] }
    });

    addPdfFooter(doc);
    doc.save(`${slugify(schoolName)}_${slugify(worker.name)}_attendance_report_${year}_${report.filters.fromKey}_${report.filters.toKey}.pdf`);
  }

  function openRejectModal(kindLabel) {
    return new Promise((resolve) => {
      const overlay = document.createElement('div');
      overlay.className = 'ht-modal-overlay';
      overlay.innerHTML = `
        <div class="ht-modal-card" role="dialog" aria-modal="true">
          <h4>Reject ${kindLabel}</h4>
          <p>Andika sababu ya kukataa na kiasi cha makato (TZS).</p>
          <label>Rejection reason (required)<textarea id="ht-reason" rows="4" placeholder="Reason..."></textarea></label>
          <label>Deduction amount TZS (required)<input id="ht-amount" type="number" min="0" step="1" value="0"></label>
          <div class="ht-modal-actions">
            <button class="btn" data-act="cancel">Cancel</button>
            <button class="btn reject" data-act="save">Save</button>
          </div>
        </div>
      `;
      document.body.appendChild(overlay);
      const reasonInput = overlay.querySelector('#ht-reason');
      const amountInput = overlay.querySelector('#ht-amount');
      reasonInput?.focus();
      overlay.addEventListener('click', (event) => {
        const btn = event.target.closest('button[data-act]');
        if (!btn) return;
        if (btn.dataset.act === 'cancel') {
          overlay.remove();
          resolve(null);
          return;
        }
        const reason = (reasonInput?.value || '').trim();
        const amountRaw = amountInput?.value ?? '';
        const amount = Number(amountRaw);
        if (!reason) {
          showToast('Rejection reason is required.', 'warning');
          reasonInput?.focus();
          return;
        }
        if (amountRaw === '' || Number.isNaN(amount) || amount < 0) {
          showToast('Deduction amount is required (0 or more).', 'warning');
          amountInput?.focus();
          return;
        }
        overlay.remove();
        resolve({ reason, amount });
      });
    });
  }

  let _initCtx = null; // cache initialized context so button re-clicks skip re-setup

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

      // If already initialized, just re-render and scroll
      if (_initCtx) {
        await _initCtx.render();
        if (isEvent) {
          const anchor = document.getElementById(containerId);
          if (anchor) anchor.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
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

      // Show skeleton immediately so the UI responds at once
      if (isEvent) {
        injectStyles();
        document.body.classList.add('headteacher-approvals-page');
        const { els: skeletonEls } = ensureContainer();
        if (skeletonEls.list) {
          skeletonEls.list.innerHTML = '<p class="empty" style="opacity:0.6;">Inapakia mahudhurio...</p>';
        }
      }

      // Batch 1: profile + teacherCfg in parallel (was sequential — saves ~1 round-trip)
      const cachedRole = (localStorage.getItem('somap_role') || '').toLowerCase();
      const [profileSnap, teacherCfgSnap] = await Promise.all([
        scopedOrLegacy(db, `years/${currentYear}/workers/${workerId}/profile`, `workers/${workerId}/profile`, legacyFriendly),
        scopedOrLegacy(db, `years/${currentYear}/teachers_config/${workerId}`, `teachers_config/${workerId}`, legacyFriendly)
      ]);
      const profile = profileSnap.snap.val() || {};
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
      let lastAttendanceData = {};
      let lastWorkersData = {};
      const schoolName = school.name || school.id || 'School';
      const reportState = { current: null, hydrated: false };

      const populateReportWorkerOptions = () => {
        if (!els.report?.worker) return;
        const previous = els.report.worker.value;
        const workerIds = new Set([
          ...Object.keys(lastWorkersData || {}),
          ...Object.keys(lastAttendanceData || {})
        ]);
        const options = [...workerIds]
          .map((id) => ({
            id,
            name: cleanText(lastWorkersData?.[id]?.profile?.fullNameUpper || lastWorkersData?.[id]?.profile?.fullName || id),
            role: cleanText(lastWorkersData?.[id]?.profile?.role || '')
          }))
          .sort((a, b) => a.name.localeCompare(b.name));
        els.report.worker.innerHTML = '<option value="">Choose worker</option>' + options.map((option) => (
          `<option value="${escapeHtml(option.id)}">${escapeHtml(option.name)}${option.role ? ` - ${escapeHtml(option.role)}` : ''}</option>`
        )).join('');
        if (previous && options.some((option) => option.id === previous)) {
          els.report.worker.value = previous;
        }
      };

      const ensureReportDefaultRange = () => {
        if (!els.report?.from || !els.report?.to) return;
        if (els.report.from.value && els.report.to.value) return;
        const preset = getRangePreset(currentYear, Number(currentYear) === new Date().getFullYear() ? 'month' : 'year');
        els.report.from.value = preset.from;
        els.report.to.value = preset.to;
      };

      const getReportFilters = (workerIdOverride) => {
        ensureReportDefaultRange();
        const fromKey = inputToDayKey(els.report?.from?.value);
        const toKey = inputToDayKey(els.report?.to?.value);
        const grouping = els.report?.grouping?.value || 'monthly';
        const selectedWorkerId = workerIdOverride === null
          ? ''
          : (workerIdOverride || els.report?.worker?.value || '');
        if (!fromKey || !toKey) throw new Error('Select both from and to dates first.');
        return fromKey <= toKey
          ? { fromKey, toKey, grouping, selectedWorkerId }
          : { fromKey: toKey, toKey: fromKey, grouping, selectedWorkerId };
      };

      const renderReportPreview = (report) => {
        if (!els.report?.preview) return;
        els.report.preview.innerHTML = buildReportPreviewHtml(report);
        reportState.current = report;
      };

      const refreshReportCenter = ({ workerIdOverride, silent = false } = {}) => {
        if (!els.report?.preview) return null;
        if (!Object.keys(lastWorkersData || {}).length && !Object.keys(lastAttendanceData || {}).length) {
          els.report.preview.innerHTML = '<div class="report-empty">Attendance data is still loading.</div>';
          return null;
        }
        try {
          const filters = getReportFilters(workerIdOverride);
          const report = analyseAttendanceReport({
            attendanceData: lastAttendanceData,
            workersData: lastWorkersData,
            ...filters
          });
          renderReportPreview(report);
          reportState.hydrated = true;
          return report;
        } catch (err) {
          if (!silent) showToast(err.message || 'Failed to prepare report preview.', 'warning');
          return null;
        }
      };

      const generateReportPdf = async ({ mode, workerIdOverride = '' }) => {
        const report = refreshReportCenter({ workerIdOverride: mode === 'master' ? null : workerIdOverride });
        if (!report) return;
        if (mode === 'worker' && !report.workers.length) {
          showToast('No worker data found for the selected period.', 'warning');
          return;
        }
        try {
          await ensurePdfLibs();
          if (mode === 'master') saveMasterPdf({ report, schoolName, year: currentYear });
          else saveWorkerPdf({ report, schoolName, year: currentYear });
          showToast(`${mode === 'master' ? 'Master' : 'Worker'} PDF generated.`, 'success');
        } catch (err) {
          console.error('Failed to generate attendance PDF', err);
          showToast('PDF generation failed. Try again.', 'error');
        }
      };

      const bindReportStudio = () => {
        if (!els.report?.studio || els.report.studio.hasAttribute('data-listening')) return;
        els.report.studio.setAttribute('data-listening', 'true');
        els.report.refresh?.addEventListener('click', () => refreshReportCenter());
        els.report.masterPdf?.addEventListener('click', () => generateReportPdf({ mode: 'master' }));
        els.report.workerPdf?.addEventListener('click', () => {
          const selectedWorkerId = els.report?.worker?.value || '';
          if (!selectedWorkerId) {
            showToast('Select a worker first for the individual PDF.', 'warning');
            return;
          }
          generateReportPdf({ mode: 'worker', workerIdOverride: selectedWorkerId });
        });
        ['change', 'input'].forEach((eventName) => {
          els.report.grouping?.addEventListener(eventName, () => refreshReportCenter({ silent: true }));
          els.report.from?.addEventListener(eventName, () => refreshReportCenter({ silent: true }));
          els.report.to?.addEventListener(eventName, () => refreshReportCenter({ silent: true }));
          els.report.worker?.addEventListener(eventName, () => refreshReportCenter({ silent: true }));
        });
        els.report.studio.addEventListener('click', (event) => {
          const presetBtn = event.target.closest('button[data-range-preset]');
          if (!presetBtn) return;
          const preset = getRangePreset(currentYear, presetBtn.dataset.rangePreset);
          if (els.report.from) els.report.from.value = preset.from;
          if (els.report.to) els.report.to.value = preset.to;
          refreshReportCenter();
        });
      };

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
        lastAttendanceData = attendanceData;
        lastWorkersData = workersData;
        populateReportWorkerOptions();
        ensureReportDefaultRange();
        if (!reportState.hydrated || reportState.current) {
          refreshReportCenter({ silent: true });
        }
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
          const inStatus = statusFromLegacy(record, 'in');
          const outStatus = statusFromLegacy(record, 'out');
          if (inStatus === 'approved') approvedCount += 1;
          else if (inStatus === 'rejected') rejectedCount += 1;
          else if (inStatus === 'missing') missingCount += 1;
          else pendingCount += 1;

          rows.push({ id, profile: data?.profile || {}, record, inStatus, outStatus });
        });

        Object.entries(attendanceData || {}).forEach(([id, months]) => {
          if (seen.has(id)) return;
          const record = months?.[monthKey]?.[todayKey] || null;
          if (!record) return;
          const inStatus = statusFromLegacy(record, 'in');
          const outStatus = statusFromLegacy(record, 'out');
          rows.push({ id, profile: {}, record, inStatus, outStatus });
          totalWorkers += 1;
          if (inStatus === 'approved') approvedCount += 1;
          else if (inStatus === 'rejected') rejectedCount += 1;
          else if (inStatus === 'missing') missingCount += 1;
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
          return order[a.inStatus] - order[b.inStatus];
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
              <div class="decision-note">IN ${statusBadge(row.inStatus)} | OUT ${statusBadge(row.outStatus)}</div>
            </div>
            <div class="worker-times">
              <div class="time-pill">Check-In: ${hasRecord ? formatTime(row.record.checkInTs) : '-'}</div>
              <div class="reason">${row.record?.checkInReason || ''}</div>
              <div class="time-pill">IN Late: ${hasRecord ? (row.record.lateMinutes || 0) : 0}m</div>
              <div class="time-pill">Check-Out: ${hasRecord ? formatTime(row.record.checkOutTs) : '-'}</div>
              <div class="reason">${row.record?.checkOutReason || ''}</div>
              <div class="time-pill">OUT Early: ${hasRecord ? (row.record.earlyMinutes || 0) : 0}m</div>
              <div class="time-pill">OUT Overtime: ${hasRecord ? (row.record.overtimeMinutes || 0) : 0}m</div>
            </div>
            <div class="worker-actions">
              <button class="btn approve" data-action="approve_in" data-worker="${row.id}" ${!row.record?.checkInTs ? 'disabled' : ''}>Approve IN</button>
              <button class="btn reject" data-action="reject_in" data-worker="${row.id}" ${!row.record?.checkInTs ? 'disabled' : ''}>Reject IN</button>
              <button class="btn approve" data-action="approve_out" data-worker="${row.id}" ${!row.record?.checkOutTs ? 'disabled' : ''}>Approve OUT</button>
              <button class="btn reject" data-action="reject_out" data-worker="${row.id}" ${!row.record?.checkOutTs ? 'disabled' : ''}>Reject OUT</button>
              <button class="btn report" data-action="worker_pdf" data-worker="${row.id}">Worker PDF</button>
              ${hasRecord ? `<button class="btn" data-action="delete_record" data-worker="${row.id}" style="background:rgba(251,113,133,0.15);border:1px solid rgba(251,113,133,0.5);color:#fb7185;" title="Futa rekodi ya leo kabisa">🗑️ Delete Record</button>` : ''}
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

      const createPenaltyOnce = async ({ targetWorker, monthKey, dayKey, kind, note, amount, createdBy }) => {
        const ledgerKey = `${dayKey}_${kind}`;
        const ref = db.ref(SOMAP.P(`years/${currentYear}/workers_penalties_ledger/${targetWorker}/${monthKey}/${ledgerKey}`));
        const snap = await ref.once('value');
        if (snap.exists()) return false;
        await ref.set({
          amountTZS: Number(amount || 0),
          note: note || '',
          kind,
          createdTs: Date.now(),
          createdBy
        });
        return true;
      };

      const applyDecision = async ({ targetWorker, action }) => {
        const { monthKey, todayKey } = latestKeys;
        if (!monthKey || !todayKey) return;
        const dayRef = db.ref(SOMAP.P(`years/${currentYear}/workerAttendance/${targetWorker}/${monthKey}/${todayKey}`));
        const snap = await dayRef.once('value');
        const existing = snap.val() || {};
        const decisionBy = String(workerId || '');
        const decisionTs = Date.now();
        const isIn = action.endsWith('_in');
        const isApprove = action.startsWith('approve_');
        const kindLabel = isIn ? 'Check-In' : 'Check-Out';
        const updatePayload = {};

        if (isApprove) {
          if (isIn) {
            updatePayload.checkInStatus = 'approved';
            updatePayload.checkInDecisionBy = decisionBy;
            updatePayload.checkInDecisionTs = decisionTs;
            updatePayload.approved = true;
          } else {
            updatePayload.checkOutStatus = 'approved';
            updatePayload.checkOutDecisionBy = decisionBy;
            updatePayload.checkOutDecisionTs = decisionTs;
          }
        } else {
          const decision = await openRejectModal(kindLabel);
          if (!decision) return;
          if (isIn) {
            updatePayload.checkInStatus = 'rejected';
            updatePayload.checkInDecisionBy = decisionBy;
            updatePayload.checkInDecisionTs = decisionTs;
            updatePayload.checkInDecisionNote = decision.reason;
            updatePayload.checkInDeductionTZS = Number(decision.amount);
            updatePayload.approved = false;
            updatePayload.approvedTs = decisionTs;
          } else {
            updatePayload.checkOutStatus = 'rejected';
            updatePayload.checkOutDecisionBy = decisionBy;
            updatePayload.checkOutDecisionTs = decisionTs;
            updatePayload.checkOutDecisionNote = decision.reason;
            updatePayload.checkOutDeductionTZS = Number(decision.amount);
          }
        }

        await dayRef.update(updatePayload);

        if (isIn) {
          const presentRef = db.ref(SOMAP.P(`years/${currentYear}/dashboard/presentWorkers/${todayKey}/${targetWorker}`));
          if (isApprove) await presentRef.set(true);
          else await presentRef.remove();
        }

        if (!isApprove) {
          const decisionNote = isIn ? updatePayload.checkInDecisionNote : updatePayload.checkOutDecisionNote;
          const deduction = isIn ? updatePayload.checkInDeductionTZS : updatePayload.checkOutDeductionTZS;
          await createPenaltyOnce({
            targetWorker,
            monthKey,
            dayKey: todayKey,
            kind: isIn ? 'reject_checkin' : 'reject_checkout',
            note: decisionNote,
            amount: deduction,
            createdBy: decisionBy
          });
        }

        const verb = isApprove ? 'approved' : 'rejected';
        showToast(`${kindLabel} ${verb}`, isApprove ? 'success' : 'warning');
      };

      const deleteRecord = async ({ targetWorker }) => {
        const { monthKey, todayKey } = latestKeys;
        if (!monthKey || !todayKey) return;
        const name = els.list.querySelector(`[data-worker="${targetWorker}"] h4`)?.textContent || targetWorker;
        if (!confirm(`Futa kabisa rekodi ya mahudhurio ya leo ya ${name}?\n\nHii itafuta check-in na check-out yote. Hawezi kuonekana kwenye orodha ya idhini. Haiwezi kutenduliwa.`)) return;
        const scopedRef = db.ref(SOMAP.P(`years/${currentYear}/workerAttendance/${targetWorker}/${monthKey}/${todayKey}`));
        const legacyRef = db.ref(`attendance/${targetWorker}/${monthKey}/${todayKey}`);
        const presentRef = db.ref(SOMAP.P(`years/${currentYear}/dashboard/presentWorkers/${todayKey}/${targetWorker}`));
        await Promise.all([
          scopedRef.remove(),
          legacyRef.remove().catch(() => null),
          presentRef.remove().catch(() => null)
        ]);
        showToast(`Rekodi ya ${name} imefutwa. Anaweza kufanya check-in upya.`, 'success');
      };

      bindReportStudio();

      if (els.list && !els.list.hasAttribute('data-listening')) {
        els.list.setAttribute('data-listening', 'true');
        els.list.addEventListener('click', async (event) => {
          const btn = event.target.closest('button[data-action]');
          if (!btn) return;
          const targetWorker = btn.dataset.worker;
          const action = btn.dataset.action;
          if (!targetWorker || !action) return;
          try {
            if (action === 'worker_pdf') {
              await generateReportPdf({ mode: 'worker', workerIdOverride: targetWorker });
            } else if (action === 'delete_record') {
              await deleteRecord({ targetWorker });
            } else {
              await applyDecision({ targetWorker, action });
            }
            if (action !== 'worker_pdf') await render();
          } catch (err) {
            console.error('Failed to update approval', err);
            showToast('Imeshindwa kuhifadhi maamuzi. Jaribu tena.', 'error');
          }
        });
      }

      // Run rules setup AND first render in parallel — saves one full round-trip
      const [initialRules] = await Promise.all([
        setupRules(els.rules, rulesRef, async (payload) => {
          await lockManager.applyRules(payload);
        }),
        render()
      ]);
      await lockManager.applyRules(initialRules);
      attachRealtime();

      // Cache context so button re-clicks skip re-setup entirely
      _initCtx = { render };

      if (yearCtx && yearCtx.onYearChanged) {
        yearCtx.onYearChanged(async (yr) => {
          try {
            currentYear = String(yr);
            rulesRef = db.ref(SOMAP.P(`years/${currentYear}/workers_settings/attendanceRules`));
            reportState.current = null;
            reportState.hydrated = false;
            const preset = getRangePreset(currentYear, Number(currentYear) === new Date().getFullYear() ? 'month' : 'year');
            if (els.report?.from) els.report.from.value = preset.from;
            if (els.report?.to) els.report.to.value = preset.to;
            if (els.report?.worker) els.report.worker.value = '';
            const [newRules] = await Promise.all([
              setupRules(els.rules, rulesRef, async (payload) => {
                await lockManager.applyRules(payload);
              }),
              render()
            ]);
            await lockManager.applyRules(newRules);
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
    loadAndRender(false); // removed 600ms artificial delay
  });

  window.addEventListener('headteacher-approvals-open', () => {
    loadAndRender(true).then(() => {
      const anchor = document.getElementById(containerId);
      if (anchor) anchor.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  });
})();
