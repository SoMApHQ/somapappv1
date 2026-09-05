(function (global) {
  "use strict";

  function db() {
    return global.firebase?.database?.();
  }

  function authUser() {
    return global.firebase?.auth?.().currentUser || null;
  }

  function schoolId() {
    return global.SOMAP?.getSchoolId?.() || "";
  }

  function school() {
    return global.SOMAP?.getSchool?.() || { id: schoolId() };
  }

  function year() {
    return global.somapYearContext?.getSelectedYear?.() || String(new Date().getFullYear());
  }

  function path(subPath) {
    if (global.SOMAP?.P) return global.SOMAP.P(subPath);
    return subPath;
  }

  function auditPath(y) {
    return path(`years/${y || year()}/bankAudits`);
  }

  async function getSettings(y) {
    const snap = await db().ref(path(`years/${y || year()}/bankAuditSettings`)).once("value");
    return snap.val() || {};
  }

  async function saveSettings(settings, y) {
    await db().ref(path(`years/${y || year()}/bankAuditSettings`)).update(settings || {});
  }

  async function listAudits(y) {
    const snap = await db().ref(auditPath(y)).once("value");
    const val = snap.val() || {};
    return Object.entries(val)
      .map(([id, audit]) => ({ id, ...(audit || {}) }))
      .sort((a, b) => Number(b.uploadedAt || 0) - Number(a.uploadedAt || 0));
  }

  async function getAudit(id, y) {
    const snap = await db().ref(`${auditPath(y)}/${id}`).once("value");
    const val = snap.val();
    return val ? { id, ...val } : null;
  }

  async function saveAudit(audit, y) {
    const ref = audit.id ? db().ref(`${auditPath(y)}/${audit.id}`) : db().ref(auditPath(y)).push();
    const user = authUser();
    const now = Date.now();
    const payload = {
      ...audit,
      id: ref.key,
      auditId: ref.key,
      schoolId: schoolId(),
      schoolName: school()?.name || school()?.schoolName || schoolId(),
      year: String(y || year()),
      uploadedAt: audit.uploadedAt || now,
      updatedAt: now,
      uploadedBy: {
        uid: user?.uid || "",
        email: user?.email || ""
      }
    };
    await ref.set(payload);
    return payload;
  }

  async function deleteAudit(id, y) {
    await db().ref(`${auditPath(y)}/${id}`).remove();
  }

  global.SomapBankAuditStorage = {
    year,
    school,
    schoolId,
    path,
    getSettings,
    saveSettings,
    listAudits,
    getAudit,
    saveAudit,
    deleteAudit
  };
})(window);
