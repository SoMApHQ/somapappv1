(function (global) {
  'use strict';

  const CLASS_ORDER = [
    'Baby Class',
    'Middle Class',
    'Pre Unit Class',
    'Class 1',
    'Class 2',
    'Class 3',
    'Class 4',
    'Class 5',
    'Class 6',
    'Class 7'
  ];

  function esc(v) {
    return String(v || '').replace(/[&<>"']/g, (c) => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;'
    }[c]));
  }
  function canonClass(raw) {
    const v = String(raw || '').trim().toLowerCase().replace(/\s+/g, ' ');
    const aliases = new Map([
      ['pre-unit', 'Pre Unit Class'],
      ['pre unit', 'Pre Unit Class'],
      ['pre unit class', 'Pre Unit Class']
    ]);
    if (aliases.has(v)) return aliases.get(v);
    const hit = CLASS_ORDER.find((c) => c.toLowerCase() === v);
    return hit || String(raw || '').trim();
  }
  function shiftClass(currentClass, delta) {
    const cur = canonClass(currentClass);
    const idx = CLASS_ORDER.findIndex((c) => c.toLowerCase() === cur.toLowerCase());
    if (idx < 0) return cur;
    const next = idx + Number(delta || 0);
    if (next < 0 || next >= CLASS_ORDER.length) return cur;
    return CLASS_ORDER[next];
  }

  function getStudentId(stu) {
    return String(stu?.id || stu?.meta?._id || stu?.meta?.studentId || stu?.meta?.id || stu?.adm || '').trim();
  }
  function getAdmissionNo(stu) {
    return String(stu?.admissionNo || stu?.meta?.admissionNumber || stu?.meta?.admissionNo || stu?.adm || '').trim();
  }
  function normalizePath(path) {
    return String(path || '').replace(/^\/+/, '');
  }

  function ensureStyles() {
    if (document.getElementById('somapTransferStyles')) return;
    const style = document.createElement('style');
    style.id = 'somapTransferStyles';
    style.textContent = `
      .somap-transfer-modal{position:fixed;inset:0;background:rgba(2,6,23,.5);display:none;z-index:1200;padding:1rem}
      .somap-transfer-panel{background:#fff;max-width:1100px;margin:0 auto;border-radius:16px;box-shadow:0 24px 64px rgba(2,6,23,.25);overflow:hidden;max-height:94vh;display:flex;flex-direction:column}
      .somap-transfer-head{padding:14px 16px;border-bottom:1px solid #e2e8f0;display:flex;align-items:center;justify-content:space-between}
      .somap-transfer-body{padding:14px 16px;overflow:auto}
      .somap-transfer-table{width:100%;border-collapse:collapse;font-size:12px}
      .somap-transfer-table th,.somap-transfer-table td{border:1px solid #e2e8f0;padding:6px}
      .somap-transfer-btn{border:1px solid #cbd5e1;background:#fff;padding:6px 10px;border-radius:8px;font-size:12px}
      .somap-transfer-btn.primary{background:#2563eb;border-color:#2563eb;color:#fff}
      .somap-transfer-btn.good{background:#16a34a;border-color:#16a34a;color:#fff}
      .somap-transfer-btn.warn{background:#ea580c;border-color:#ea580c;color:#fff}
      .somap-transfer-form{display:grid;grid-template-columns:1fr 1fr;gap:10px}
      .somap-transfer-form label{font-size:12px;color:#334155}
      .somap-transfer-form input,.somap-transfer-form select,.somap-transfer-form textarea{width:100%;border:1px solid #cbd5e1;border-radius:8px;padding:8px}
      .somap-transfer-full{grid-column:1 / -1}
      @media (max-width:900px){.somap-transfer-form{grid-template-columns:1fr}}
    `;
    document.head.appendChild(style);
  }

  function mount(opts) {
    const host = document.getElementById(opts.hostId);
    if (!host) return null;
    ensureStyles();

    const money = (n) => new Intl.NumberFormat('en-TZ', { style: 'currency', currency: 'TZS', maximumFractionDigits: 0 }).format(Number(n || 0));
    const schoolId = String(opts.schoolId || '').trim();
    const isSocrates = schoolId === 'socrates-school';
    const rootPath = (path) => {
      const clean = normalizePath(path);
      return global.SOMAP?.P ? global.SOMAP.P(clean) : clean;
    };

    host.innerHTML = `
      <div class="bg-white rounded-2xl p-4 shadow border border-slate-200">
        <div class="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
          <div>
            <p class="text-xs uppercase tracking-wide text-slate-500">Class Management</p>
            <h3 class="text-lg font-semibold text-slate-800">Promotion / Demotion Hub</h3>
            <p class="text-sm text-slate-500">Students in class: <b id="somapTransferCount">0</b></p>
          </div>
          <button id="somapTransferOpen" class="px-4 py-2 rounded-lg bg-emerald-600 text-white text-sm">Open Class Transfer</button>
        </div>
      </div>
      <div id="somapTransferModal" class="somap-transfer-modal"></div>
    `;

    const modal = host.querySelector('#somapTransferModal');
    const btnOpen = host.querySelector('#somapTransferOpen');
    const countEl = host.querySelector('#somapTransferCount');
    let cachedStudents = [];
    let selectedStudent = null;
    let actionMode = 'move';

    function setCount(students) {
      if (!countEl) return;
      countEl.textContent = String((students || []).length);
    }

    function ctx() {
      const base = opts.getContext ? opts.getContext() : {};
      const className = canonClass(base.className || '');
      const students = Array.isArray(base.students) ? base.students : [];
      const filtered = students.filter((s) => canonClass(s.class || s.className || s.classLevel || '') === className);
      return {
        className,
        year: String(base.year || new Date().getFullYear()),
        students: filtered
      };
    }

    function renderList() {
      const data = ctx();
      cachedStudents = data.students.slice();
      setCount(cachedStudents);

      const rows = cachedStudents.map((s) => {
        const sid = getStudentId(s) || getAdmissionNo(s);
        return `
          <tr>
            <td>${esc(s.adm || '')}</td>
            <td>${esc(s.name || '')}</td>
            <td>${esc(s.class || '')}</td>
            <td>${esc(s.parentContact || '')}</td>
            <td>${money(s.feeDue || 0)}</td>
            <td>${money(s.feePaid || 0)}</td>
            <td>${money(s.balance || 0)}</td>
            <td style="white-space:nowrap">
              <button type="button" class="somap-transfer-btn good" data-action="promote" data-id="${esc(sid)}">Promote</button>
              <button type="button" class="somap-transfer-btn warn" data-action="demote" data-id="${esc(sid)}">Demote</button>
              <button type="button" class="somap-transfer-btn" data-action="move" data-id="${esc(sid)}">Move</button>
            </td>
          </tr>
        `;
      }).join('');

      modal.innerHTML = `
        <div class="somap-transfer-panel">
          <div class="somap-transfer-head">
            <div>
              <div style="font-size:12px;color:#64748b">${esc(opts.schoolName || 'School')} - ${esc(data.className || '')} (${esc(data.year)})</div>
              <div style="font-weight:700">Class Transfer Manager</div>
            </div>
            <button id="somapTransferClose" class="somap-transfer-btn">Close</button>
          </div>
          <div class="somap-transfer-body">
            <table class="somap-transfer-table">
              <thead>
                <tr>
                  <th>Adm</th><th>Student</th><th>Class</th><th>Parent Contact</th><th>Fee Due</th><th>Paid</th><th>Balance</th><th>Actions</th>
                </tr>
              </thead>
              <tbody>${rows || '<tr><td colspan="8" style="text-align:center;color:#64748b;padding:16px">No students in this class.</td></tr>'}</tbody>
            </table>
            <div id="somapTransferFormWrap" style="margin-top:12px;display:none"></div>
          </div>
        </div>
      `;
      modal.style.display = 'block';

      const closeBtn = modal.querySelector('#somapTransferClose');
      if (closeBtn) closeBtn.onclick = () => { modal.style.display = 'none'; };
      modal.onclick = (ev) => { if (ev.target === modal) modal.style.display = 'none'; };

      const body = modal.querySelector('.somap-transfer-body');
      if (body) {
        body.onclick = (ev) => {
          const btn = ev.target && ev.target.closest ? ev.target.closest('[data-action]') : null;
          if (!btn) return;
          ev.preventDefault();
          ev.stopPropagation();
          const sid = String(btn.getAttribute('data-id') || '').trim();
          actionMode = String(btn.getAttribute('data-action') || 'move');
          selectedStudent = cachedStudents.find((s) => {
            const a = getStudentId(s);
            const b = getAdmissionNo(s);
            return a === sid || b === sid || String(s.adm || '') === sid;
          }) || null;
          if (!selectedStudent) {
            alert('Could not find selected student. Please close and reopen the transfer window.');
            return;
          }
          renderForm();
        };
      }
    }

    function renderForm() {
      const wrap = modal.querySelector('#somapTransferFormWrap');
      if (!wrap || !selectedStudent) return;
      const currentClass = canonClass(selectedStudent.class || selectedStudent.className || selectedStudent.classLevel || '');
      const suggested = actionMode === 'promote' ? shiftClass(currentClass, 1) : actionMode === 'demote' ? shiftClass(currentClass, -1) : currentClass;
      const optsClass = CLASS_ORDER.map((c) => `<option value="${esc(c)}" ${c === suggested ? 'selected' : ''}>${esc(c)}</option>`).join('');
      const today = new Date().toISOString().slice(0, 10);
      wrap.style.display = 'block';
      wrap.innerHTML = `
        <div style="border:1px solid #e2e8f0;border-radius:12px;padding:12px">
          <div style="font-weight:700;margin-bottom:8px">${esc(selectedStudent.name || '')} (${esc(selectedStudent.adm || '')})</div>
          <form id="somapTransferForm" class="somap-transfer-form">
            <label>Target Class<select name="targetClass" required>${optsClass}</select></label>
            <label>Effective Date<input type="date" name="effectiveDate" value="${today}" required /></label>
            <label>Authority<input type="text" name="authority" placeholder="Head Teacher / Academic Office" required /></label>
            <label>Action<select name="actionType"><option value="promote" ${actionMode === 'promote' ? 'selected' : ''}>Promote</option><option value="demote" ${actionMode === 'demote' ? 'selected' : ''}>Demote</option><option value="move" ${actionMode === 'move' ? 'selected' : ''}>Reclassify</option></select></label>
            <label class="somap-transfer-full">Reason<textarea name="reason" rows="2" placeholder="Why this class change is needed" required></textarea></label>
            <div class="somap-transfer-full" style="display:flex;gap:8px;justify-content:flex-end">
              <button type="button" id="somapTransferCancel" class="somap-transfer-btn">Cancel</button>
              <button type="submit" class="somap-transfer-btn primary">Save Transfer</button>
            </div>
          </form>
        </div>
      `;
      const cancelBtn = wrap.querySelector('#somapTransferCancel');
      if (cancelBtn) cancelBtn.onclick = () => { wrap.style.display = 'none'; };
      const form = wrap.querySelector('#somapTransferForm');
      if (form) {
        form.onsubmit = async (ev) => {
          ev.preventDefault();
          const fd = new FormData(form);
          await saveTransfer(selectedStudent, {
            targetClass: canonClass(fd.get('targetClass')),
            effectiveDate: String(fd.get('effectiveDate') || ''),
            authority: String(fd.get('authority') || '').trim(),
            reason: String(fd.get('reason') || '').trim(),
            actionType: String(fd.get('actionType') || 'move')
          });
        };
      }
    }

    async function saveTransfer(student, payload) {
      const db = opts.getDB ? opts.getDB() : null;
      if (!db || typeof db.ref !== 'function') {
        alert('Database is not ready.');
        return;
      }
      const sid = getStudentId(student);
      if (!sid) {
        alert('Student ID missing.');
        return;
      }
      if (!payload.targetClass || !payload.reason || !payload.authority || !payload.effectiveDate) {
        alert('Fill all required fields.');
        return;
      }

      const data = ctx();
      const adm = getAdmissionNo(student);
      const nowIso = new Date().toISOString();
      const stamp = String(Date.now());
      const year = String(data.year || new Date().getFullYear());
      const transfer = {
        studentId: sid,
        admissionNo: adm || sid,
        studentName: String(student.name || '').trim(),
        fromClass: canonClass(student.class || ''),
        toClass: payload.targetClass,
        reason: payload.reason,
        authority: payload.authority,
        effectiveDate: payload.effectiveDate,
        actionType: payload.actionType,
        updatedAt: nowIso
      };

      const updates = {};
      const setScoped = (path, value) => {
        const clean = normalizePath(path);
        updates[rootPath(clean)] = value;
        if (isSocrates) updates[clean] = value;
      };

      setScoped(`students/${sid}/className`, payload.targetClass);
      setScoped(`students/${sid}/classLevel`, payload.targetClass);
      setScoped(`students/${sid}/class`, payload.targetClass);
      setScoped(`students/${sid}/currentClass`, payload.targetClass);
      setScoped(`students/${sid}/grade`, payload.targetClass);
      setScoped(`students/${sid}/lastClassTransfer`, transfer);

      const enrollmentPayload = {
        studentId: sid,
        admissionNumber: adm || sid,
        admissionNo: adm || sid,
        className: payload.targetClass,
        classLevel: payload.targetClass,
        class: payload.targetClass,
        updatedAt: nowIso
      };
      setScoped(`enrollments/${year}/${sid}`, enrollmentPayload);
      setScoped(`years/${year}/enrollments/${sid}`, enrollmentPayload);
      if (adm && adm !== sid) {
        setScoped(`enrollments/${year}/${adm}`, enrollmentPayload);
        setScoped(`years/${year}/enrollments/${adm}`, enrollmentPayload);
      }

      setScoped(`classTransfers/${year}/${sid}/${stamp}`, transfer);
      setScoped(`years/${year}/classTransfers/${sid}/${stamp}`, transfer);

      await db.ref().update(updates);
      alert(`Class transfer saved. ${student.name || 'Student'} is now in ${payload.targetClass}.`);
      modal.style.display = 'none';
      if (typeof opts.onSaved === 'function') opts.onSaved(transfer);
    }

    btnOpen.addEventListener('click', renderList);
    setCount(ctx().students);

    return {
      refresh() {
        setCount(ctx().students);
      }
    };
  }

  global.SomapClassTransfer = Object.assign(global.SomapClassTransfer || {}, { mount });
})(typeof window !== 'undefined' ? window : globalThis);
