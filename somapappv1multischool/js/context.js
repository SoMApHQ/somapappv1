// Multi-school context helper for SoMAp v2.1
// Stores the current school ID and provides a path helper scoped to the selected school.
(function attachContext() {
  const listeners = new Set();
  const STORAGE_KEY = 'somap.currentSchoolId';
  const STORAGE_META_KEY = 'somap.currentSchool';
  const DEFAULT_SCHOOL_ID = 'socrates-school';

  function getSchoolId() {
    return localStorage.getItem(STORAGE_KEY) || DEFAULT_SCHOOL_ID;
  }

  function setSchoolId(id) {
    if (!id) return;
    localStorage.setItem(STORAGE_KEY, id);
    // Also keep meta in sync if present
    try {
      const meta = getSchool() || {};
      if (!meta.id) {
        localStorage.setItem(STORAGE_META_KEY, JSON.stringify({ id }));
      }
    } catch (_) { /* ignore */ }
    listeners.forEach(fn => {
      try { fn(id); } catch (err) { console.error('onSchoolChange handler failed', err); }
    });
  }

  function setSchool(school) {
    if (!school || !school.id) return;
    try {
      localStorage.setItem(STORAGE_META_KEY, JSON.stringify(school));
    } catch (err) {
      console.warn('Failed to persist school meta', err);
    }
    setSchoolId(school.id);
  }

  function getSchool() {
    try {
      const stored = localStorage.getItem(STORAGE_META_KEY);
      if (stored) {
        const parsed = JSON.parse(stored);
        if (parsed && parsed.id) return parsed;
      }
    } catch (err) {
      console.warn('Failed to read school meta', err);
    }
    const id = getSchoolId();
    return id ? { id, name: id === DEFAULT_SCHOOL_ID ? 'Socrates School' : undefined } : null;
  }

  function onSchoolChange(fn) {
    listeners.add(fn);
    return () => listeners.delete(fn);
  }

  function P(subpath) {
    const sid = getSchoolId();
    if (!sid) throw new Error('No current schoolId set');
    const trimmed = String(subpath || '').replace(/^\/+/, '');
    if (sid === DEFAULT_SCHOOL_ID) return trimmed; // Legacy data lives at root for Socrates
    return `schools/${sid}/${trimmed}`;
  }

  function getActiveSchool() {
    return getSchool();
  }

  const SOMAP = { getSchoolId, setSchoolId, setSchool, getSchool, getActiveSchool, onSchoolChange, P };
  window.SOMAP = SOMAP;
})();
