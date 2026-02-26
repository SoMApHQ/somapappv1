(function () {
  'use strict';

  const STORAGE_KEY = 'somapSelectedYear';
  const MANUAL_FLAG_KEY = 'somapYearManualLock';
  const EVENT_NAME = 'somapYearChanged';
  const ATTACHED_FLAG = 'somapYearAttached';

  function clampYearRange(start, end) {
    const current = new Date().getFullYear();
    const min = Number.isInteger(start) ? start : current - 1;
    const max = Number.isInteger(end) ? end : current + 7;
    return [Math.min(min, max), Math.max(min, max)];
  }

  function computeYearList(start, end) {
    const [min, max] = clampYearRange(start, end);
    const years = [];
    for (let y = min; y <= max; y += 1) years.push(String(y));
    return years;
  }

  function updateAttachedSelects(yearValue) {
    const targetValue = String(yearValue);
    document.querySelectorAll(`[data-${ATTACHED_FLAG}="1"]`).forEach((el) => {
      if (el instanceof HTMLSelectElement && el.value !== targetValue) {
        el.value = targetValue;
      }
    });
  }

  function getManualFlag() {
    return localStorage.getItem(MANUAL_FLAG_KEY) === '1';
  }

  function setManualFlag(value) {
    localStorage.setItem(MANUAL_FLAG_KEY, value ? '1' : '0');
  }

  function getSelectedYear() {
    const stored = localStorage.getItem(STORAGE_KEY);
    const MIN_YEAR = 2025;
    const currentYear = new Date().getFullYear();
    if (stored) {
      const yearNum = Number(stored);
      if (yearNum < MIN_YEAR) {
        const defaultYear = String(Math.max(MIN_YEAR, currentYear));
        localStorage.setItem(STORAGE_KEY, defaultYear);
        setManualFlag(false);
        return defaultYear;
      }
      return stored;
    }
    // Default to current year when nothing stored (so approvals match Finance in 2026+)
    const defaultYear = String(Math.max(MIN_YEAR, currentYear));
    localStorage.setItem(STORAGE_KEY, defaultYear);
    setManualFlag(false);
    return defaultYear;
  }

  function dispatchYearChanged(year) {
    window.dispatchEvent(new CustomEvent(EVENT_NAME, { detail: year }));
  }

  function setSelectedYear(year, options = {}) {
    if (!year) return getSelectedYear();
    const MIN_YEAR = 2025;
    let normalized = String(year);
    // Ensure year is at least 2025
    if (Number(normalized) < MIN_YEAR) {
      normalized = String(MIN_YEAR);
    }
    const previous = getSelectedYear();
    if (previous === normalized) {
      if (options.forceDispatch) dispatchYearChanged(normalized);
      return normalized;
    }
    localStorage.setItem(STORAGE_KEY, normalized);
    if (options.manual !== false) setManualFlag(true);
    updateAttachedSelects(normalized);
    dispatchYearChanged(normalized);
    return normalized;
  }

  function resetToCurrentYear() {
    const current = String(new Date().getFullYear());
    setManualFlag(false);
    return setSelectedYear(current, { manual: false, forceDispatch: true });
  }

  function maybeAutoAdvance() {
    if (getManualFlag()) return;
    const current = String(new Date().getFullYear());
    if (getSelectedYear() !== current) {
      setSelectedYear(current, { manual: false, forceDispatch: true });
    }
  }

  function populateOptions(selectEl, years) {
    if (!selectEl) return;
    const preserve = selectEl.dataset.somapYearPreserve === 'true';
    if (!preserve) selectEl.innerHTML = '';
    const seen = new Set();
    Array.from(selectEl.options).forEach((opt) => seen.add(opt.value));
    years.forEach((year) => {
      if (seen.has(year)) return;
      const opt = document.createElement('option');
      opt.value = year;
      opt.textContent = year;
      selectEl.appendChild(opt);
    });
  }

  function attachYearDropdown(selectEl, config = {}) {
    if (!selectEl || selectEl.dataset[ATTACHED_FLAG]) return;
    const minYear = Number(selectEl.dataset.somapYearMin || config.minYear);
    const maxYear = Number(selectEl.dataset.somapYearMax || config.maxYear);
    const years = computeYearList(minYear, maxYear);
    populateOptions(selectEl, years);
    selectEl.value = config.initialYear || getSelectedYear();
    selectEl.dataset[ATTACHED_FLAG] = '1';
    selectEl.addEventListener('change', (event) => {
      const selected = event.target.value;
      const sanitized = years.includes(selected) ? selected : getSelectedYear();
      setSelectedYear(sanitized);
      selectEl.value = sanitized;
    });
  }

  function bindStorageSync() {
    window.addEventListener('storage', (event) => {
      if (event.key !== STORAGE_KEY || event.newValue === event.oldValue) return;
      const next = event.newValue || getSelectedYear();
      updateAttachedSelects(next);
      dispatchYearChanged(next);
    });
  }

  function autoAttach(root = document) {
    const year = getSelectedYear();
    root.querySelectorAll('[data-somap-year-select]').forEach((el) => {
      attachYearDropdown(el, { initialYear: year });
    });
  }

  maybeAutoAdvance();
  bindStorageSync();
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => autoAttach());
  } else {
    autoAttach();
  }

  window.somapYearContext = {
    getSelectedYear,
    setSelectedYear,
    resetToCurrentYear,
    attachYearDropdown,
    onYearChanged(handler) {
      if (typeof handler !== 'function') return () => {};
      const wrapped = (event) => handler(event.detail);
      window.addEventListener(EVENT_NAME, wrapped);
      handler(getSelectedYear());
      return () => window.removeEventListener(EVENT_NAME, wrapped);
    },
  };
})();
