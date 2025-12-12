/* js/graddonations.js
   Graduation Donations: RTDB + UI card + modal, zero-build, vanilla JS.
   Requires: Firebase compat already loaded, Tailwind available.
   Exposes: window.initGradDonations({ schoolId, year, mountId, collectedAmountId, collectedNoteId })
*/
(function () {
  const hasFirebase = typeof window !== 'undefined' && window.firebase && firebase.database;
  if (!hasFirebase) {
    console.warn('[graddonations] Firebase not found. Load compat SDK before this file.');
  }

  // ---------- Utilities ----------
  const fmt = new Intl.NumberFormat('en-US');
  function formatTsh(n) {
    const num = Number(n || 0);
    return `TSh ${fmt.format(Math.round(num))}`;
  }
  function parseTsh(str) {
    if (!str) return 0;
    const digits = String(str).replace(/[^\d]/g, '');
    return Number(digits || 0);
  }
  function el(tag, className, children) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (Array.isArray(children)) {
      children.forEach((c) => {
        if (c == null) return;
        if (typeof c === 'string') node.appendChild(document.createTextNode(c));
        else node.appendChild(c);
      });
    } else if (typeof children === 'string') {
      node.textContent = children;
    }
    return node;
  }
  function nowPretty(d = new Date()) {
    const dt = new Date(d);
    return dt.toLocaleString('en-KE', { dateStyle: 'medium', timeStyle: 'short' });
  }

  // Inject a tiny glass style helper (border gradient)
  function ensureGlassStyle() {
    const id = 'grad-donations-glass-style';
    if (document.getElementById(id)) return;
    const style = document.createElement('style');
    style.id = id;
    style.textContent = `
      .glass-card {
        background: linear-gradient(135deg, rgba(255,255,255,0.14), rgba(255,255,255,0.06));
        backdrop-filter: blur(10px);
        -webkit-backdrop-filter: blur(10px);
        border-radius: 1rem;
        box-shadow: 0 10px 30px rgba(0,0,0,0.12);
        border: 1px solid rgba(255,255,255,0.18);
      }
      .glass-border {
        border: 1px solid rgba(255,255,255,0.25);
      }
      .skeleton {
        position: relative; overflow: hidden;
      }
      .skeleton::after {
        content: ""; position: absolute; inset: 0;
        transform: translateX(-100%);
        background: linear-gradient(90deg, transparent, rgba(255,255,255,0.15), transparent);
        animation: shimmer 1.6s infinite;
      }
      @keyframes shimmer {
        100% { transform: translateX(100%); }
      }
      .modal-backdrop {
        position: fixed; inset: 0; background: rgba(0,0,0,0.4);
        display: flex; align-items: center; justify-content: center;
        z-index: 60;
      }
    `;
    document.head.appendChild(style);
  }

  // ---------- DOM: Card + Modal ----------
  function buildCard(opts) {
    const { onOpenModal } = opts;
    const container = el('div', 'glass-card p-4 md:p-5 mt-3');
    const header = el('div', 'flex items-center justify-between mb-2', [
      el('div', 'text-sm uppercase tracking-wide opacity-80', 'Donations'),
      el('button', 'px-3 py-1.5 text-sm rounded-xl glass-border hover:opacity-90 transition', 'Record Donation'),
    ]);
    const amountEl = el('div', 'text-2xl md:text-3xl font-semibold skeleton', formatTsh(0));
    const updatedEl = el('div', 'text-xs opacity-70 mt-1 skeleton', 'Updated: —');

    header.lastChild.addEventListener('click', () => onOpenModal());

    container.appendChild(header);
    container.appendChild(amountEl);
    container.appendChild(updatedEl);
    return { container, amountEl, updatedEl };
  }

  function buildModal({ onSave, onClose }) {
    const backdrop = el('div', 'modal-backdrop', []);
    const panel = el('div', 'glass-card w-[94%] max-w-md p-4 md:p-5', []);
    const title = el('div', 'text-lg font-semibold mb-3', 'Record Graduation Donation');

    const form = el('form', 'space-y-3', []);
    const row = (labelText, inputEl, help = '') => {
      const wrap = el('div', '', []);
      const label = el('label', 'block text-sm font-medium mb-1', labelText);
      if (help) label.appendChild(el('span', 'ml-1 text-xs opacity-60', `(${help})`));
      wrap.appendChild(label);
      wrap.appendChild(inputEl);
      return wrap;
    };

    const amount = el('input', 'w-full glass-border rounded-xl px-3 py-2', []);
    amount.type = 'number'; amount.min = '1'; amount.placeholder = 'Amount in TSh'; amount.required = true;

    const donorName = el('input', 'w-full glass-border rounded-xl px-3 py-2', []);
    donorName.type = 'text'; donorName.placeholder = 'Donor full name'; donorName.required = true;

    const donorContact = el('input', 'w-full glass-border rounded-xl px-3 py-2', []);
    donorContact.type = 'text'; donorContact.placeholder = 'Phone or email'; donorContact.required = true;

    const proofNote = el('textarea', 'w-full glass-border rounded-xl px-3 py-2', []);
    proofNote.rows = 2; proofNote.placeholder = 'Proof note (optional)';

    const proofUrl = el('input', 'w-full glass-border rounded-xl px-3 py-2', []);
    proofUrl.type = 'url'; proofUrl.placeholder = 'Proof URL (optional, e.g., receipt image)';

    const err = el('div', 'text-xs text-red-600 min-h-4', '');

    const actions = el('div', 'flex gap-2 pt-2', []);
    const cancelBtn = el('button', 'px-3 py-2 rounded-xl glass-border', 'Cancel');
    const saveBtn = el('button', 'px-3 py-2 rounded-xl bg-white/80 hover:bg-white text-black', 'Save');
    saveBtn.type = 'submit';

    actions.appendChild(cancelBtn);
    actions.appendChild(saveBtn);

    form.appendChild(row('Amount', amount));
    form.appendChild(row('Donor name', donorName));
    form.appendChild(row('Donor contact', donorContact));
    form.appendChild(row('Proof note', proofNote, 'optional'));
    form.appendChild(row('Proof URL', proofUrl, 'optional'));
    form.appendChild(err);
    form.appendChild(actions);

    panel.appendChild(title);
    panel.appendChild(form);
    backdrop.appendChild(panel);

    cancelBtn.addEventListener('click', (e) => {
      e.preventDefault(); onClose();
    });

    let saving = false;
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (saving) return;
      err.textContent = '';
      const amt = Number(amount.value);
      if (!amt || amt < 1) { err.textContent = 'Enter a valid amount (>= 1).'; return; }
      if (!donorName.value || donorName.value.trim().length < 3) { err.textContent = 'Donor name is too short.'; return; }
      if (!donorContact.value || donorContact.value.trim().length < 3) { err.textContent = 'Provide donor contact.'; return; }

      const payload = {
        amount: Math.round(amt),
        donorName: donorName.value.trim(),
        donorContact: donorContact.value.trim(),
        proofNote: (proofNote.value || '').trim() || null,
        proofUrl: (proofUrl.value || '').trim() || null,
        createdAt: hasFirebase ? firebase.database.ServerValue.TIMESTAMP : Date.now(),
        recordedBy: {
          uid: (window.authUser && window.authUser.uid) || null,
          email: (window.authUser && window.authUser.email) || null
        }
      };

      try {
        saving = true; saveBtn.disabled = true; saveBtn.textContent = 'Saving...';
        await onSave(payload);
        onClose();
      } catch (e2) {
        err.textContent = 'Failed to save. Check connection and try again.';
        console.error('[graddonations] save error', e2);
      } finally {
        saving = false; saveBtn.disabled = false; saveBtn.textContent = 'Save';
      }
    });

    return { backdrop };
  }

  // ---------- RTDB paths ----------
  function donationsRef(db, schoolId, year) {
    return db.ref(`schools/${schoolId}/graduations/${year}/donations`);
  }

  // ---------- Main initializer ----------
  function initGradDonations(options = {}) {
    ensureGlassStyle();

    const db = hasFirebase ? firebase.database() : null;

    const schoolId = (options.schoolId || localStorage.getItem('schoolId') || 'socrates');
    const year = (String(options.year || localStorage.getItem('academicYear') || new Date().getFullYear()));
    const mountId = options.mountId || 'grad-donations-card';
    const collectedAmountId = options.collectedAmountId || 'collected-amount';
    const collectedNoteId = options.collectedNoteId || 'collected-donation-note';

    const mount = document.getElementById(mountId);
    if (!mount) {
      console.warn('[graddonations] mount element not found:', mountId);
      return;
    }

    // Build the stat card
    const ui = buildCard({
      onOpenModal: () => {
        const modal = buildModal({
          onSave: async (payload) => {
            if (!db) throw new Error('Firebase not loaded');
            await donationsRef(db, schoolId, year).push(payload);
          },
          onClose: () => {
            if (modal && modal.backdrop && modal.backdrop.parentNode) {
              modal.backdrop.parentNode.removeChild(modal.backdrop);
            }
          }
        });
        document.body.appendChild(modal.backdrop);
      }
    });
    mount.innerHTML = '';
    mount.appendChild(ui.container);

    // Hook to Collected UI
    const collectedEl = document.getElementById(collectedAmountId);
    const noteEl = document.getElementById(collectedNoteId);
    let baseCollected = null;
    let donationsTotal = 0;

    // Legacy compatibility: GraduationSuite writes to #cardCollected.
    let legacyCollected = document.getElementById('cardCollected');
    if (!legacyCollected && collectedEl && collectedAmountId !== 'cardCollected') {
      legacyCollected = collectedEl.cloneNode(true);
      legacyCollected.id = 'cardCollected';
      legacyCollected.classList.add('hidden');
      legacyCollected.setAttribute('aria-hidden', 'true');
      collectedEl.insertAdjacentElement('afterend', legacyCollected);
    }

    function refreshCollectedDisplay() {
      if (collectedEl && baseCollected == null) {
        baseCollected = parseTsh(collectedEl.textContent);
        collectedEl.dataset.baseCollected = String(baseCollected || 0);
      }
      const base = baseCollected || 0;
      const merged = base + donationsTotal;
      if (collectedEl) {
        collectedEl.textContent = formatTsh(merged);
      }
      if (noteEl) {
        noteEl.textContent = `includes donation = ${formatTsh(donationsTotal)}`;
      }
    }

    if (legacyCollected && collectedEl && legacyCollected !== collectedEl) {
      const syncFromLegacy = () => {
        const parsed = parseTsh(legacyCollected.textContent);
        baseCollected = parsed;
        collectedEl.dataset.baseCollected = String(parsed || 0);
        refreshCollectedDisplay();
      };
      const obs = new MutationObserver(syncFromLegacy);
      obs.observe(legacyCollected, { childList: true, characterData: true, subtree: true });
      syncFromLegacy();
    }

    // Listen to donations and update totals
    if (db) {
      donationsRef(db, schoolId, year).on('value', (snap) => {
        let total = 0;
        let latestTs = null;
        snap.forEach((child) => {
          const v = child.val();
          const amt = Number((v && v.amount) || 0);
          total += amt > 0 ? amt : 0;
          if (v && v.createdAt) {
            const ts = typeof v.createdAt === 'number' ? v.createdAt : Date.now();
            if (!latestTs || ts > latestTs) latestTs = ts;
          }
        });

        donationsTotal = total;
        ui.amountEl.classList.remove('skeleton');
        ui.updatedEl.classList.remove('skeleton');
        ui.amountEl.textContent = formatTsh(total);
        ui.updatedEl.textContent = 'Updated: ' + (latestTs ? nowPretty(new Date(latestTs)) : nowPretty());

        refreshCollectedDisplay();
      }, (err) => {
        console.error('[graddonations] listener error', err);
      });
    } else {
      ui.amountEl.textContent = 'TSh 0';
    }
  }

  // Expose
  window.initGradDonations = initGradDonations;
})();
