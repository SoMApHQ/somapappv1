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
    @media (max-width: 640px) {
      #${containerId} { padding:14px; }
      #${containerId} .worker-actions { justify-content:flex-start; }
    }
  `;

  const showToast = window.toast ? window.toast : (msg, type = 'info') => console.log(`[${type}] ${msg}`);
  const todayYMD = (date = new Date()) => new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(date);
  const localTs = () => new Date(new Date().toLocaleString('en-US', { timeZone: TZ })).getTime();
  const formatTime = (ts) => ts ? new Date(ts).toLocaleTimeString('sw-TZ', { timeZone: TZ, hour: '2-digit', minute: '2-digit' }) : '-';

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
          </div>
          <button class="btn save-btn" id="rules-save">Hifadhi Kanuni</button>
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
        save: document.getElementById('rules-save')
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

  async function setupRules(els, rulesRef) {
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
          updatedTs: localTs()
        };
        await rulesRef.set(payload);
        showToast('Kanuni za mahudhurio zimehifadhiwa', 'success');
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
      const teacherCfgSnap = await db.ref(`teachers_config/${workerId}`).get();
      const teacherCfg = teacherCfgSnap.val() || {};
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

      const rulesRef = db.ref(SOMAP.P('settings/workers/attendanceRules'));
      await setupRules(els.rules, rulesRef);

      const render = async () => {
        const now = new Date();
        const todayKey = todayYMD(now).replace(/-/g, '');
        const monthKey = `${currentYear}${String(now.getMonth() + 1).padStart(2, '0')}`;
        latestKeys = { monthKey, todayKey };

        if (els.todayLabel) {
          els.todayLabel.textContent = now.toLocaleDateString('sw-TZ', { timeZone: TZ, weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
        }

        const [attendance, workers] = await Promise.all([
          scopedOrLegacy(db, `years/${currentYear}/attendance`, 'attendance', legacyFriendly),
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
          SOMAP.P(`years/${currentYear}/attendance`),
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
            : SOMAP.P(`years/${currentYear}/attendance/${targetWorker}/${monthKey}/${todayKey}`);
          const ref = db.ref(refPath);
          await ref.update({ approved: approveValue, approvedTs: localTs() });
          showToast(`Entry ${approveValue ? 'approved' : 'rejected'}`, approveValue ? 'success' : 'warning');
          render();
        });
      }

      await render();
      attachRealtime();

      if (yearCtx && yearCtx.onYearChanged) {
        yearCtx.onYearChanged((yr) => {
          currentYear = String(yr);
          render();
          attachRealtime();
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
