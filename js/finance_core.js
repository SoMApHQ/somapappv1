(function (global) {
  'use strict';

  const root = global.SOMAP_FINANCE || {};
  const SOMAP = global.SOMAP;
  const pref = (subPath) =>
    typeof SOMAP?.P === 'function' ? SOMAP.P(subPath) : subPath;

  /**
   * Load the approved finance summary for a student/year.
   * Falls back to on-page computed finance if no summary node exists.
   *
   * @param {string} studentKey Firebase key for the student
   * @param {string|number} year Academic/working year
   * @returns {Promise<Object|null>}
   */
  async function loadStudentYearSummary(studentKey, year) {
    if (!studentKey || !year) return null;
    const y = String(year);

    // Resolve a database handle lazily so callers can load firebase first.
    const db =
      (global.db && typeof global.db.ref === 'function' && global.db) ||
      (global.firebase?.database ? global.firebase.database() : null);
    if (!db) return null;

    const tryPaths = [
      `financeAnnual/${y}/students/${studentKey}`,
      `financials/${y}/students/${studentKey}`,
      `finance/${y}/students/${studentKey}`,
    ];

    for (const path of tryPaths) {
      try {
        const snap = await db.ref(pref(path)).once('value');
        const val = snap.val();
        if (val) return val;
      } catch (err) {
        console.warn('[finance_core] summary read failed', path, err?.message || err);
      }
    }

    // Fallback: derive from shared finance math so UI stays consistent.
    if (global.SomapFinance?.loadStudentFinance) {
      try {
        const derived = await global.SomapFinance.loadStudentFinance(y, studentKey);
        if (derived) {
          const finance = derived.finance || {};
          return {
            feeTotal:
              finance.feePerYear ??
              derived.due ??
              finance.total ??
              finance.fee ??
              0,
            paidTotal:
              finance.paidAmount ??
              derived.paid ??
              finance.paid ??
              0,
            balanceTotal:
              finance.balance ??
              derived.outstanding ??
              finance.outstanding ??
              0,
            finance,
            student: derived.student || null,
          };
        }
      } catch (fallbackErr) {
        console.warn('[finance_core] fallback finance math failed', fallbackErr?.message || fallbackErr);
      }
    }

    return null;
  }

  root.loadStudentYearSummary = loadStudentYearSummary;
  global.SOMAP_FINANCE = root;
})(typeof window !== 'undefined' ? window : globalThis);
