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
  `;

  const showToast = (window.toast) ? window.toast : (msg) => console.log('[approvals]', msg);
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
    if (document.getElementById(containerId)) return document.getElementById(containerId);
    const container = document.createElement('section');
    container.id = containerId;
    container.innerHTML = `
      <h2>Headteacher Approvals</h2>
      <p class="subtitle">Thibitisha au kata check-ins za leo (scoped kwa shule na mwaka uliopo).</p>
      <div id="${containerId}-body">Loading...</div>
    `;
    const host = document.querySelector('.dashboard-container') || document.body;
    host.appendChild(container);
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

  document.addEventListener('DOMContentLoaded', async () => {
    try {
      injectStyles();
      if (!window.firebase || !firebase.database) return;
      if (!window.SOMAP || !SOMAP.getSchool) return;
      const school = SOMAP.getSchool();
      if (!school || !school.id) return;
      const legacyFriendly = school.id === 'socrates-school' || school.id === 'default';
      const db = firebase.database();
      const workerId = localStorage.getItem('workerId');
      if (!workerId) return;

      const yearCtx = window.somapYearContext || null;
      let currentYear = String(yearCtx?.getSelectedYear?.() || new Date().getFullYear());

      const profileSnap = await scopedOrLegacy(db, `years/${currentYear}/workers/${workerId}/profile`, `workers/${workerId}/profile`, legacyFriendly);
      const profile = profileSnap.snap.val() || {};
      if (!profile.role || !profile.role.toLowerCase().includes('head')) return;

      const container = createContainer();
      const body = document.getElementById(`${containerId}-body`);

      async function render() {
        const now = new Date();
        const todayKey = todayYMD(now).replace(/-/g, '');
        const monthKey = `${currentYear}${String(now.getMonth() + 1).padStart(2, '0')}`;
        body.textContent = 'Loading...';

        const [attendance, workers] = await Promise.all([
          scopedOrLegacy(db, `years/${currentYear}/attendance`, 'attendance', legacyFriendly),
          scopedOrLegacy(db, `years/${currentYear}/workers`, 'workers', legacyFriendly)
        ]);

        const attendanceData = attendance.snap.val() || {};
        const workersData = workers.snap.val() || {};
        const rows = [];

        Object.entries(attendanceData).forEach(([id, months]) => {
          const rec = months?.[monthKey]?.[todayKey];
          if (!rec) return;
          rows.push({
            id,
            profile: workersData[id]?.profile || {},
            record: rec
          });
        });

        if (!rows.length) {
          body.textContent = 'Hakuna check-ins leo (bado).';
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
          tr.innerHTML = `
            <td>${row.profile.fullNameUpper || row.id}</td>
            <td>${row.profile.role || ''}</td>
            <td>${row.record.checkInTs ? new Date(row.record.checkInTs).toLocaleTimeString('sw-TZ', { timeZone: TZ, hour: '2-digit', minute: '2-digit' }) : '—'}</td>
            <td>${row.record.lateMinutes || 0}</td>
            <td>${row.record.earlyMinutes || 0}</td>
            <td><span class="badge">${approvedText}</span></td>
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
          render();
        };

        body.innerHTML = '';
        body.appendChild(table);
      }

      yearCtx?.onYearChanged?.((yr) => {
        currentYear = String(yr);
        render();
      });

      render();
    } catch (err) {
      console.error('headteacherapprovals error', err);
    }
  });
})();
