(function headteacherApprovals() {
  const TZ = 'Africa/Nairobi';
  const containerId = 'headteacher-approvals-card';
  const styles = `
    #${containerId} { margin-top:24px; background:#ffffff; border:1px solid #e2e8f0; border-radius:16px; padding:16px; box-shadow:0 10px 30px rgba(15,23,42,0.05); }
    #${containerId} h2 { margin:0 0 6px; font-size:1.1rem; }
    #${containerId} .subtitle { color:#64748b; margin:0 0 10px; font-size:0.95rem; }
    #${containerId} table { width:100%; border-collapse:collapse; }
    #${containerId} th, #${containerId} td { padding:8px 6px; border-bottom:1px solid #e2e8f0; text-align:left; font-size:0.94rem; }
    #${containerId} th { color:#64748b; font-weight:700; }
    #${containerId} .actions { display:flex; gap:6px; flex-wrap:wrap; }
    #${containerId} .btn { padding:8px 12px; border-radius:10px; border:1px solid #e2e8f0; cursor:pointer; background:#fff; }
    #${containerId} .btn.approve { background:#ecfdf3; border-color:#bbf7d0; color:#166534; }
    #${containerId} .btn.reject { background:#fef2f2; border-color:#fecdd3; color:#9f1239; }
    #${containerId} .badge { display:inline-block; padding:4px 8px; border-radius:8px; font-size:0.85rem; border:1px solid #e2e8f0; background:#f8fafc; }
    #${containerId} .rules { margin-top:12px; padding:12px; border:1px dashed #e2e8f0; border-radius:12px; background:#f8fafc; }
    #${containerId} .rules h3 { margin:0 0 6px; font-size:1rem; }
    #${containerId} .rules .grid { display:grid; grid-template-columns:repeat(auto-fit,minmax(180px,1fr)); gap:10px; }
    #${containerId} label { font-weight:600; color:#1f2937; display:grid; gap:6px; font-size:0.92rem; }
    #${containerId} input[type="text"], #${containerId} input[type="number"] { padding:8px 10px; border:1px solid #d1d5db; border-radius:10px; }
    #${containerId} .save-btn { margin-top:10px; }
  `;

  const showToast = (window.toast) ? window.toast : (msg, type) => console.log(`[${type || 'info'}] ${msg}`);
  const todayYMD = (date = new Date()) => new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(date);
  const localTs = () => new Date(new Date().toLocaleString('en-US', { timeZone: TZ })).getTime();

  function injectStyles() {
    if (document.getElementById(`${containerId}-styles`)) return;
    const style = document.createElement('style');
    style.id = `${containerId}-styles`;
    style.textContent = styles;
    document.head.appendChild(style);
  }

  function createContainer() {
    let container = document.getElementById(containerId);
    if (!container) {
      container = document.createElement('section');
      container.id = containerId;
      const host = document.querySelector('.dashboard-container') || document.body;
      host.appendChild(container);
    }
    // Only reset innerHTML if it doesn't contain the structure we expect (e.g. it's just loading text)
    if (!container.querySelector(`#${containerId}-stats`)) {
      container.innerHTML = `
        <h2>Headteacher Approvals</h2>
        <p class="subtitle">Thibitisha au kata check-ins za leo (scoped kwa shule na mwaka uliopo).</p>
        <div id="${containerId}-stats" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:10px;margin-bottom:10px;"></div>
        <div id="${containerId}-body">Loading...</div>
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
    return container;
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

      // Check role
      const profileSnap = await scopedOrLegacy(db, `years/${currentYear}/workers/${workerId}/profile`, `workers/${workerId}/profile`, legacyFriendly);
      const profile = profileSnap.snap.val() || {};
      
      if (!profile.role || !profile.role.toLowerCase().includes('head')) {
        if (isEvent) showToast('Huna ruhusa ya Head Teacher.', 'warning');
        return;
      }

      injectStyles();
      const container = createContainer();
      const body = document.getElementById(`${containerId}-body`);
      const statsEl = document.getElementById(`${containerId}-stats`);
      
      const els = {
        requireWifi: document.getElementById('rules-requireWifi'),
        ssids: document.getElementById('rules-ssids'),
        lateThreshold: document.getElementById('rules-lateThreshold'),
        earlyThreshold: document.getElementById('rules-earlyThreshold'),
        deductionAmount: document.getElementById('rules-deductionAmount'),
        deductionLabel: document.getElementById('rules-deductionLabel'),
        save: document.getElementById('rules-save')
      };

      const rulesRef = db.ref(SOMAP.P('settings/workers/attendanceRules'));

      // Rules Logic
      if (els.save && !els.save.hasAttribute('data-listening')) {
        els.save.setAttribute('data-listening', 'true');
        els.save.addEventListener('click', async (e) => {
          e.preventDefault();
          const payload = {
            requireWifi: !!els.requireWifi.checked,
            allowedSsids: els.ssids.value.split(',').map(s => s.trim()).filter(Boolean),
            lateThreshold: Math.max(1, Number(els.lateThreshold.value) || 3),
            earlyThreshold: Math.max(1, Number(els.earlyThreshold.value) || 3),
            deductionAmount: Math.max(0, Number(els.deductionAmount.value) || 0),
            deductionLabel: els.deductionLabel.value.trim() || 'Posho ya Uwajibikaji',
            updatedTs: localTs()
          };
          await rulesRef.set(payload);
          showToast('Kanuni za mahudhurio zimehifadhiwa', 'success');
        });
        
        // Load Rules
        const snap = await rulesRef.get();
        const rules = snap.val() || {};
        els.requireWifi.checked = rules.requireWifi !== false;
        els.ssids.value = Array.isArray(rules.allowedSsids) ? rules.allowedSsids.join(',') : '';
        els.lateThreshold.value = rules.lateThreshold || 3;
        els.earlyThreshold.value = rules.earlyThreshold || 3;
        els.deductionAmount.value = rules.deductionAmount || 1000;
        els.deductionLabel.value = rules.deductionLabel || 'Posho ya Uwajibikaji';
      }

      async function render() {
        const now = new Date();
        const todayKey = todayYMD(now).replace(/-/g, '');
        const monthKey = `${currentYear}${String(now.getMonth() + 1).padStart(2, '0')}`;
        
        if (body) body.textContent = 'Inapakia...';

        const [attendance, workers] = await Promise.all([
          scopedOrLegacy(db, `years/${currentYear}/attendance`, 'attendance', legacyFriendly),
          scopedOrLegacy(db, `years/${currentYear}/workers`, 'workers', legacyFriendly)
        ]);

        const attendanceData = attendance.snap.val() || {};
        const workersData = workers.snap.val() || {};
        const rows = [];
        let totalWorkers = 0;
        let approvedCount = 0;
        let rejectedCount = 0;
        let missingCount = 0;

        // Process existing attendance
        Object.entries(attendanceData).forEach(([id, months]) => {
          const rec = months?.[monthKey]?.[todayKey];
          if (rec) {
            rows.push({
              id,
              profile: workersData[id]?.profile || {},
              record: rec
            });
            if (rec.approved === true) approvedCount += 1;
            else if (rec.approved === false) rejectedCount += 1;
          }
        });

        // Calculate totals and missing
        Object.entries(workersData || {}).forEach(([id, w]) => {
          totalWorkers += 1;
          if (!attendanceData[id]?.[monthKey]?.[todayKey]) {
            missingCount += 1;
          }
        });

        if (statsEl) {
          statsEl.innerHTML = `
            <div class="badge">Wafanyakazi: ${totalWorkers}</div>
            <div class="badge" style="background:#f0fdf4;color:#166534;border-color:#bbf7d0;">Approved: ${approvedCount}</div>
            <div class="badge" style="background:#fff7ed;color:#9a3412;border-color:#fed7aa;">Pending/Rejected: ${rejectedCount}</div>
            <div class="badge" style="background:#fef2f2;color:#991b1b;border-color:#fecaca;">Hawakuingia: ${missingCount}</div>
          `;
        }

        if (!rows.length) {
          if (body) body.textContent = 'Hakuna check-ins leo (bado).';
          return;
        }

        const table = document.createElement('table');
        table.innerHTML = `
          <thead>
            <tr>
              <th>Jina</th>
              <th>Role</th>
              <th>Check-In</th>
              <th>Late</th>
              <th>Early</th>
              <th>Approval</th>
              <th>Tendo</th>
            </tr>
          </thead>
          <tbody></tbody>
        `;
        const tbody = table.querySelector('tbody');

        rows.forEach((row) => {
          const tr = document.createElement('tr');
          const approvedText = row.record.approved === true ? 'Approved' : row.record.approved === false ? 'Pending' : 'Awaiting';
          const badgeClass = row.record.approved === true ? 'background:#dcfce7;color:#166534;' : 'background:#fee2e2;color:#991b1b;';
          
          tr.innerHTML = `
            <td>${row.profile.fullNameUpper || row.id}</td>
            <td>${row.profile.role || ''}</td>
            <td>${row.record.checkInTs ? new Date(row.record.checkInTs).toLocaleTimeString('sw-TZ', { timeZone: TZ, hour: '2-digit', minute: '2-digit' }) : '—'}</td>
            <td>${row.record.lateMinutes || 0}m</td>
            <td>${row.record.earlyMinutes || 0}m</td>
            <td><span class="badge" style="${badgeClass}">${approvedText}</span></td>
            <td class="actions">
              <button class="btn approve" data-action="approve" data-worker="${row.id}">Approve</button>
              <button class="btn reject" data-action="reject" data-worker="${row.id}">Reject</button>
            </td>
          `;
          tbody.appendChild(tr);
        });

        tbody.onclick = async (event) => {
          const btn = event.target.closest('button[data-action]');
          if (!btn) return;
          const targetWorker = btn.dataset.worker;
          const approveValue = btn.dataset.action === 'approve';
          
          const ref = db.ref(SOMAP.P(`years/${currentYear}/attendance/${targetWorker}/${monthKey}/${todayKey}`));
          await ref.update({ approved: approveValue, approvedTs: localTs() });
          
          showToast(`Entry ${approveValue ? 'approved' : 'rejected'}`, approveValue ? 'success' : 'warning');
          render(); // Re-render to update stats and UI
        };

        if (body) {
          body.innerHTML = '';
          body.appendChild(table);
        }
      }

      // Initial render
      await render();

      // Listen for year changes if context exists
      if (yearCtx && yearCtx.onYearChanged) {
        yearCtx.onYearChanged((yr) => {
          currentYear = String(yr);
          render();
        });
      }

    } catch (err) {
      console.error('headteacherapprovals error', err);
      if (isEvent) showToast('Hitilafu imetokea wakati wa kupakia.', 'error');
    }
  }

  // Initialize on load if possible
  document.addEventListener('DOMContentLoaded', () => {
    // Small delay to ensure other scripts loaded
    setTimeout(() => loadAndRender(false), 1000);
  });

  // Listen for open event from dashboard card
  window.addEventListener('headteacher-approvals-open', () => {
    loadAndRender(true).then(() => {
        const anchor = document.getElementById(containerId);
        if (anchor) anchor.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  });

})();
