(function () {
  'use strict';

  document.addEventListener('DOMContentLoaded', () => {
    const db = window.db || (window.firebase && window.firebase.database ? window.firebase.database() : null);
    if (!db || !window.JoiningService) {
      console.warn('Push-to-admission widget skipped: missing db or JoiningService');
      return;
    }

    let currentYear = window.somapYearContext?.getSelectedYear?.() || 2025;
    let unsubscribe = null;
    let queue = [];

    const card = buildCard();
    const badgeEl = card.querySelector('[data-queue-count]');
    const summaryEl = card.querySelector('[data-queue-summary]');
    const viewBtn = card.querySelector('[data-view-queue]');
    const modal = buildModal();
    const listEl = modal.querySelector('[data-queue-list]');

    attachCard(card);
    document.body.appendChild(modal);

    viewBtn.addEventListener('click', () => {
      renderQueueList();
      modal.classList.remove('hidden');
    });
    modal.querySelector('[data-close-modal]').addEventListener('click', () => modal.classList.add('hidden'));

    function attachCard(node) {
      const quickHeader = Array.from(document.querySelectorAll('h3')).find((el) => (el.textContent || '').trim() === 'Quick Admission');
      const quickSection = quickHeader ? quickHeader.parentElement : null;
      const modalBtn = document.getElementById('openRegistrationModal');
      const btnSection = modalBtn ? modalBtn.parentElement : null;
      if (btnSection && btnSection.parentElement) {
        btnSection.parentElement.insertBefore(node, btnSection.nextSibling);
        return;
      }
      if (quickSection && quickSection.parentElement) {
        quickSection.parentElement.insertBefore(node, quickSection.nextSibling);
        return;
      }
      const container = document.querySelector('.space-y-4');
      if (container) container.insertBefore(node, container.firstChild);
      else document.body.insertBefore(node, document.body.firstChild);
    }

    function buildCard() {
      const wrapper = document.createElement('div');
      wrapper.className = 'mt-4 bg-indigo-50 border border-indigo-100 rounded-lg p-4 shadow-sm flex items-center justify-between gap-4';
      wrapper.innerHTML = `
        <div>
          <p class="text-sm font-semibold text-indigo-700">Ready from joining forms</p>
          <p class="text-xs text-slate-600">Students who have paid and are queued for admission.</p>
          <p class="text-xs text-slate-500 mt-1" data-queue-summary>Loading...</p>
        </div>
        <div class="flex items-center gap-3">
          <span class="inline-flex items-center justify-center rounded-full bg-indigo-600 text-white text-sm font-semibold w-10 h-10" data-queue-count>0</span>
          <button type="button" data-view-queue class="px-3 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 text-sm">View queue</button>
        </div>
      `;
      return wrapper;
    }

    function buildModal() {
      const overlay = document.createElement('div');
      overlay.className = 'hidden fixed inset-0 bg-black/60 z-50 flex items-start justify-center py-10 px-4';
      overlay.innerHTML = `
        <div class="bg-white rounded-lg shadow-xl w-full max-w-3xl p-5 relative">
          <button type="button" data-close-modal class="absolute top-3 right-3 text-slate-500 hover:text-slate-700">
            <i class="fas fa-times"></i>
          </button>
          <h3 class="text-lg font-semibold text-slate-800 mb-1">Admission queue</h3>
          <p class="text-sm text-slate-500 mb-4">Pushed from joining forms and ready to pre-fill admission.</p>
          <div class="space-y-3 max-h-[60vh] overflow-y-auto" data-queue-list></div>
        </div>
      `;
      return overlay;
    }

    function startListener(year) {
      if (typeof unsubscribe === 'function') unsubscribe();
      unsubscribe = window.JoiningService.listenAdmissionQueue(year, (list) => {
        queue = Array.isArray(list) ? list : [];
        updateBadge();
        renderQueueSummary();
        renderQueueList();
      });
    }

    function updateBadge() {
      if (badgeEl) badgeEl.textContent = queue.length;
    }

    function renderQueueSummary() {
      if (!summaryEl) return;
      summaryEl.textContent = queue.length ? `${queue.length} student(s) ready to admit for ${currentYear}` : 'No students in queue.';
    }

    function renderQueueList() {
      if (!listEl) return;
      if (!queue.length) {
        listEl.innerHTML = '<div class="text-sm text-slate-500">No students in queue.</div>';
        return;
      }
      listEl.innerHTML = '';
      queue.forEach((item) => {
        const div = document.createElement('div');
        div.className = 'border border-slate-200 rounded-lg p-3 flex items-center justify-between gap-3';
        const childName = [item.childFirstName, item.childMiddleName, item.childLastName].filter(Boolean).join(' ').trim();
        div.innerHTML = `
          <div>
            <p class="font-semibold text-slate-800">${childName || 'Unnamed applicant'}</p>
            <p class="text-xs text-slate-600">Class: ${item.classLevel || 'N/A'} | DOB: ${item.dateOfBirth || 'N/A'}</p>
            <p class="text-xs text-slate-500">Parent: ${item.parentFullName || 'N/A'} | ${item.parentPhone || ''}</p>
          </div>
          <div class="flex items-center gap-2 flex-shrink-0">
            <button type="button" class="px-3 py-1.5 bg-indigo-600 text-white rounded-md text-sm hover:bg-indigo-700" data-send="${item.id}">Send to admission</button>
            <button type="button" class="px-3 py-1.5 bg-slate-100 text-slate-700 rounded-md text-sm hover:bg-slate-200" data-remove="${item.id}">Remove</button>
          </div>
        `;
        listEl.appendChild(div);
      });
      listEl.querySelectorAll('[data-send]').forEach((btn) => btn.addEventListener('click', () => {
        const id = btn.getAttribute('data-send');
        const item = queue.find((q) => q.id === id);
        if (item) sendToAdmission(item);
      }));
      listEl.querySelectorAll('[data-remove]').forEach((btn) => btn.addEventListener('click', () => {
        const id = btn.getAttribute('data-remove');
        const item = queue.find((q) => q.id === id);
        if (item) removeFromQueue(item);
      }));
    }

    function removeFromQueue(item) {
      const path = window.JoiningService.withSchoolPath(`joiningAdmissionsQueue/${currentYear}/${item.id}`);
      db.ref(path).remove().catch((err) => console.error('Remove queue entry failed', err));
    }

    function sendToAdmission(item) {
      window.currentJoiningAppToAdmit = {
        applicationId: item.id,
        year: Number(currentYear),
        schoolId: window.JoiningService.resolveSchoolId(),
      };
      const openBtn = document.getElementById('openRegistrationModal');
      if (openBtn) openBtn.click();
      modal.classList.add('hidden');
      fillFormWhenReady(item);
    }

    function fillFormWhenReady(item, attempt = 0) {
      const form = document.getElementById('registrationForm');
      if (!form) {
        if (attempt < 50) setTimeout(() => fillFormWhenReady(item, attempt + 1), 100);
        return;
      }
      const setVal = (id, val) => {
        const el = document.getElementById(id);
        if (el) el.value = val || '';
      };
      setVal('firstName', item.childFirstName || '');
      setVal('middleName', item.childMiddleName || '');
      setVal('lastName', item.childLastName || '');
      setVal('gender', item.gender || '');
      setVal('dob', item.dateOfBirth || '');
      setVal('classLevel', item.classLevel || '');
      setVal('academicYear', String(currentYear));
      setVal('primaryParentName', item.parentFullName || '');
      setVal('primaryParentContact', item.parentPhone || '');
    }

    startListener(currentYear);
    window.addEventListener('somapYearChanged', (e) => {
      const nextYear = e.detail || window.somapYearContext?.getSelectedYear?.();
      if (!nextYear) return;
      currentYear = String(nextYear);
      startListener(currentYear);
    });
  });
})(); 
