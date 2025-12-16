// Multi-school context helper for SoMAp v2.1
// Stores the current school ID and provides a path helper scoped to the selected school.
(function attachContext() {
  const listeners = new Set();
  const STORAGE_KEY = 'somap.currentSchoolId';

  function getSchoolId() {
    return localStorage.getItem(STORAGE_KEY) || null;
  }

  function setSchoolId(id) {
    localStorage.setItem(STORAGE_KEY, id);
    listeners.forEach(fn => {
      try { fn(id); } catch (err) { console.error('onSchoolChange handler failed', err); }
    });
  }

  function onSchoolChange(fn) {
    listeners.add(fn);
    return () => listeners.delete(fn);
  }

  function P(subpath) {
    const sid = getSchoolId();
    if (!sid) throw new Error('No current schoolId set');
    return `/schools/${sid}/${subpath}`;
  }

  const SOMAP = { getSchoolId, setSchoolId, onSchoolChange, P };
  window.SOMAP = SOMAP;
})();
