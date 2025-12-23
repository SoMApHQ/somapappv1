(function (global) {
  function activeSchoolContext() {
    try {
      if (global.SOMAP) {
        if (typeof global.SOMAP.getActiveSchool === 'function') return global.SOMAP.getActiveSchool();
        if (typeof global.SOMAP.getSchool === 'function') return global.SOMAP.getSchool();
        if (typeof global.SOMAP.getSchoolId === 'function') return { id: global.SOMAP.getSchoolId() };
      }
    } catch (_err) {
      /* ignore */
    }

    const fallbackId =
      (typeof sessionStorage !== 'undefined' && sessionStorage.getItem('workerSchoolId')) ||
      (typeof sessionStorage !== 'undefined' && sessionStorage.getItem('somap.currentSchoolId')) ||
      (typeof localStorage !== 'undefined' && localStorage.getItem('somap.currentSchoolId')) ||
      (typeof localStorage !== 'undefined' && localStorage.getItem('somap_school'));

    return fallbackId ? { id: fallbackId } : null;
  }

  async function loadSchoolLogo(options = {}) {
    const {
      elementId = 'school-logo-display',
      defaultLogo = 'images/socrates_logo.png',
      fallbackLogo = 'images/somap-logo.png.jpg',
      cachePrefix = 'school_logo_',
      schoolId: explicitSchoolId = null
    } = options;

    const logoEl = document.getElementById(elementId);
    if (!logoEl) return;

    const setLocal = () => {
      logoEl.src = defaultLogo;
    };

    if (fallbackLogo) {
      logoEl.onerror = function () {
        this.onerror = null;
        this.src = fallbackLogo;
      };
    }

    const searchParams = (() => {
      try {
        return new URLSearchParams(global.location.search);
      } catch (_err) {
        return new URLSearchParams();
      }
    })();

    const ctx = activeSchoolContext();
    const schoolId =
      explicitSchoolId ||
      searchParams.get('school') ||
      searchParams.get('schoolId') ||
      ctx?.id ||
      ctx?.schoolId ||
      (typeof localStorage !== 'undefined' && localStorage.getItem('somap_school')) ||
      null;
    const db =
      options.db ||
      global.db ||
      (global.firebase && typeof global.firebase.database === 'function' ? global.firebase.database() : null);

    if (!schoolId || schoolId === 'socrates-school' || schoolId === 'default' || schoolId === 'socrates') {
      setLocal();
      return;
    }

    const cacheKey = `${cachePrefix}${schoolId}`;
    try {
      const cached = sessionStorage.getItem(cacheKey);
      if (cached) {
        logoEl.src = cached;
      }
    } catch (_err) {
      /* ignore cache errors */
    }

    if (!db) {
      setLocal();
      return;
    }

    try {
      const snap = await db.ref(`/schools/${schoolId}/profile/logoUrl`).once('value');
      const url = snap.val();
      if (url) {
        logoEl.src = url;
        try {
          sessionStorage.setItem(cacheKey, url);
        } catch (_err) {
          /* ignore cache errors */
        }
        return;
      }
      setLocal();
    } catch (err) {
      console.error('Error loading school logo', err);
      setLocal();
    }
  }

  global.SomapLogo = {
    loadSchoolLogo
  };
})(window);
