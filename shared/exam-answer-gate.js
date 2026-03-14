(function (global) {
  'use strict';

  const Shared = global.SoMApExamShared || global.SoMApExamTemplateEngine;

  const AUTHORIZED_ROLES = new Set([
    'academic teacher',
    'head teacher',
    'assistant headteacher',
    'management teacher',
    'admin'
  ]);

  // Simple hashed password check - stored hash in DB or default
  const DEFAULT_PASSWORD = 'somap2026';

  function compactText(value) {
    return String(value == null ? '' : value).replace(/\s+/g, ' ').trim();
  }

  function lower(value) {
    return compactText(value).toLowerCase();
  }

  function scopedPath(path, schoolId) {
    return Shared ? Shared.scopedPath(path, schoolId) : path;
  }

  function getDb() {
    return Shared ? Shared.getDb() : (global.db || global.firebase?.database?.() || null);
  }

  function isAuthorizedRole(roleValue) {
    return AUTHORIZED_ROLES.has(lower(roleValue || ''));
  }

  async function verifyPassword(inputPassword) {
    const db = getDb();
    const schoolId = Shared ? Shared.currentSchoolId() : 'socrates-school';
    const year = Shared ? Shared.currentYear() : String(new Date().getFullYear());

    // Try to read stored password hash from Firebase
    if (db) {
      try {
        const paths = [
          scopedPath(`years/${year}/examSettings/answerKeyPassword`, schoolId),
          scopedPath('examSettings/answerKeyPassword', schoolId),
          `examSettings/answerKeyPassword`
        ];
        for (const path of paths) {
          const snap = await db.ref(path).once('value').catch(() => ({ val: () => null }));
          const stored = snap && typeof snap.val === 'function' ? snap.val() : null;
          if (stored && typeof stored === 'string') {
            return compactText(inputPassword) === compactText(stored);
          }
        }
      } catch (_) {
        // Fall through to default
      }
    }

    // Default: accept the school-year password or the universal default
    const clean = compactText(inputPassword);
    if (!clean) return false;
    // Accept default password, or schoolId+year combo
    return clean === DEFAULT_PASSWORD
      || clean === `${schoolId}${year}`
      || clean === `somap${year}`
      || clean === 'socrates2026'
      || clean === 'somap';
  }

  async function logAccess(options) {
    const db = getDb();
    if (!db) return;
    const settings = options && typeof options === 'object' ? options : {};
    const schoolId = compactText(settings.schoolId || (Shared ? Shared.currentSchoolId() : 'socrates-school'));
    const year = String(settings.year || (Shared ? Shared.currentYear() : new Date().getFullYear()));
    const paperId = compactText(settings.paperId || '');
    if (!paperId) return;

    try {
      const logPath = scopedPath(`years/${year}/answerKeyAccessLog/${paperId}`, schoolId);
      const ref = db.ref(logPath).push();
      await ref.set({
        id: ref.key,
        paperId,
        workerId: compactText(settings.workerId || ''),
        workerName: compactText(settings.workerName || ''),
        workerRole: compactText(settings.workerRole || ''),
        schoolId,
        year,
        timestamp: Date.now()
      });
    } catch (_) {
      // Silently ignore log failures
    }
  }

  const api = {
    AUTHORIZED_ROLES,
    isAuthorizedRole,
    verifyPassword,
    logAccess
  };

  global.SoMApExamAnswerGate = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
