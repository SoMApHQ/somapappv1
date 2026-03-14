(function (global) {
  'use strict';

  const Shared = global.SoMApExamShared || global.SoMApExamTemplateEngine;
  const PASSWORD_HASH = '3f233e3ad349747ea30315dfdb013471a9b28480a15a9b5da3a407c0a09b992c';
  const HASH_PREFIX = 'somap-answer-gate-v1::';
  const ALLOWED_ROLES = new Set([
    'academic teacher',
    'head teacher',
    'assistant headteacher',
    'management teacher',
    'academic',
    'admin'
  ]);

  function compactText(value) {
    return Shared ? Shared.compactText(value) : String(value == null ? '' : value).replace(/\s+/g, ' ').trim();
  }

  function lower(value) {
    return compactText(value).toLowerCase();
  }

  function currentSchoolId() {
    return Shared ? Shared.currentSchoolId() : (global.localStorage?.getItem('somap.currentSchoolId') || 'socrates-school');
  }

  function scopedPath(path, schoolId) {
    return Shared ? Shared.scopedPath(path, schoolId) : path;
  }

  function getDb() {
    return Shared ? Shared.getDb() : (global.db || global.firebase?.database?.() || null);
  }

  function isAuthorizedRole(roleValue) {
    return ALLOWED_ROLES.has(lower(roleValue || ''));
  }

  async function sha256Hex(value) {
    const encoder = new TextEncoder();
    const bytes = encoder.encode(String(value || ''));
    const hashBuffer = await global.crypto.subtle.digest('SHA-256', bytes);
    return Array.from(new Uint8Array(hashBuffer)).map((item) => item.toString(16).padStart(2, '0')).join('');
  }

  async function verifyPassword(input) {
    if (!global.crypto?.subtle) {
      throw new Error('Secure password verification is not available in this browser.');
    }
    const digest = await sha256Hex(`${HASH_PREFIX}${String(input || '')}`);
    return digest === PASSWORD_HASH;
  }

  async function logAccess(options) {
    const settings = options && typeof options === 'object' ? options : {};
    const db = getDb();
    if (!db || !settings.paperId) return null;
    const schoolId = compactText(settings.schoolId || currentSchoolId());
    const year = String(settings.year || (Shared ? Shared.currentYear() : new Date().getFullYear()));
    const ref = db.ref(scopedPath(`years/${year}/answerKeyAccessLog/${settings.paperId}`, schoolId)).push();
    const payload = {
      id: ref.key,
      paperId: settings.paperId,
      schoolId,
      year,
      workerId: compactText(settings.workerId || global.localStorage?.getItem('workerId') || ''),
      workerName: compactText(settings.workerName || global.localStorage?.getItem('somap_workerName') || ''),
      workerRole: compactText(settings.workerRole || global.localStorage?.getItem('somap_role') || ''),
      timestamp: Date.now()
    };
    await ref.set(payload);
    return payload;
  }

  const api = {
    isAuthorizedRole,
    verifyPassword,
    logAccess
  };

  global.SoMApExamAnswerGate = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
