// SoMAp Daily Inventory — small shared UI helpers (toast, modal, prompt).
// Injects workershtml/css/inventory.css once; every class is prefixed "inv-",
// so host pages (attendance, hubs) keep their own look untouched.
(function (global) {
  'use strict';
  const INV = global.SomapInventory;
  if (!INV) { console.warn('SomapInventoryUI: inventory_core.js must load first'); return; }
  const { esc } = INV.util;

  function ensureCss() {
    if (global.document.querySelector('link[data-somap-inventory-css]')) return;
    const link = global.document.createElement('link');
    link.rel = 'stylesheet';
    link.href = `${INV.URLS.root}workershtml/css/inventory.css?v=20261025`;
    link.setAttribute('data-somap-inventory-css', '1');
    global.document.head.appendChild(link);
  }

  function toast(message, type = 'info', ms = 4500) {
    ensureCss();
    let host = global.document.querySelector('.inv-toast-host');
    if (!host) { host = global.document.createElement('div'); host.className = 'inv-toast-host'; global.document.body.appendChild(host); }
    const el = global.document.createElement('div');
    el.className = `inv-toast inv-toast--${type}`;
    el.textContent = String(message || '');
    host.appendChild(el);
    setTimeout(() => el.remove(), ms);
  }

  // modal({ title, html, actions:[{label, value, kind}] , onMount(card, close) }) → Promise(value)
  function modal(opts) {
    ensureCss();
    return new Promise((resolve) => {
      const overlay = global.document.createElement('div');
      overlay.className = 'inv-modal';
      const actions = (opts.actions || [{ label: 'Funga · Close', value: null }]).map((a, i) =>
        `<button type="button" class="inv-btn ${a.kind ? `inv-btn--${a.kind}` : ''}" data-i="${i}">${esc(a.label)}</button>`).join('');
      overlay.innerHTML = `
        <div class="inv-modal__card" role="dialog" aria-modal="true">
          <div class="inv-modal__head"><h3>${esc(opts.title || '')}</h3>
            ${opts.dismissable === false ? '' : '<button type="button" class="inv-btn inv-btn--sm inv-btn--ghost" data-x>✕</button>'}</div>
          <div class="inv-modal__body">${opts.html || ''}</div>
          ${actions ? `<div class="inv-modal__foot">${actions}</div>` : ''}
        </div>`;
      const close = (v) => { overlay.remove(); resolve(v); };
      overlay.addEventListener('click', (e) => {
        if (e.target.closest('[data-x]')) return close(null);
        const btn = e.target.closest('.inv-modal__foot [data-i]');
        if (!btn) return;
        const a = (opts.actions || [])[Number(btn.dataset.i)];
        if (!a) return close(null);
        if (typeof a.validate === 'function') { const ok = a.validate(overlay); if (!ok) return; }
        close(typeof a.value === 'function' ? a.value(overlay) : (a.value === undefined ? null : a.value));
      });
      global.document.body.appendChild(overlay);
      if (typeof opts.onMount === 'function') opts.onMount(overlay.querySelector('.inv-modal__card'), close);
    });
  }

  async function promptText(title, message, opts = {}) {
    const minLen = opts.minLength || 0;
    const v = await modal({
      title,
      html: `<p class="inv-card__sub">${esc(message || '')}</p><textarea class="inv-input" data-text rows="4" placeholder="${esc(opts.placeholder || '')}"></textarea><p class="inv-item__error" data-err></p>`,
      actions: [
        { label: 'Ghairi · Cancel', value: null },
        {
          label: opts.okLabel || 'Hifadhi · Save', kind: opts.kind || 'primary',
          validate: (root) => {
            const text = root.querySelector('[data-text]').value.trim();
            if (text.length < minLen) { root.querySelector('[data-err]').textContent = `Andika angalau herufi ${minLen} · At least ${minLen} characters`; return false; }
            return true;
          },
          value: (root) => root.querySelector('[data-text]').value.trim(),
        },
      ],
    });
    return v;
  }

  // Loads a script once (used for jsPDF on pages that do not have it).
  const loaded = {};
  function loadScript(src) {
    if (!loaded[src]) {
      loaded[src] = new Promise((resolve, reject) => {
        const s = global.document.createElement('script');
        s.src = src; s.onload = resolve; s.onerror = () => reject(new Error(`Could not load ${src}`));
        global.document.head.appendChild(s);
      });
    }
    return loaded[src];
  }

  global.SomapInventoryUI = { ensureCss, toast, modal, promptText, loadScript };
})(window);
