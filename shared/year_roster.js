/*
 * SoMAp light year roster — names and classes WITHOUT building the finance dataset.
 *
 * SomapFinance.getFinanceRoster() loads every finance ledger, the approvals history, fee
 * plans and computes every child's fees, just to list learners. Read-only pages (Top
 * Students, Staff Awards) only need "who is in which class this year", so this reads only
 * students + enrollments, merged exactly as shared/finance_math.js ensureYearDataset does,
 * filters with the same active-student rules as getFinanceRoster, and resolves each class
 * with the same SomapYearClass.resolveYearClass (2026+ Class Year Rule).
 *
 * Years before the class rule (2025 and earlier) fall back to getFinanceRoster.
 * Requires shared/finance_math.js (for SomapYearClass) to be loaded first.
 */
(function (global) {
  'use strict';
  const cache = {};
  const L = (s) => String(s || '').trim().toLowerCase();
  const DEFAULT_YEAR = Number(global.SOMAP_DEFAULT_YEAR) || 2025;

  function schoolId() {
    return String(global.currentSchoolId || global.SOMAP?.getSchoolId?.() || global.SOMAP?.getSchool?.()?.id || 'socrates-school').trim() || 'socrates-school';
  }
  function pref(path) {
    const id = schoolId();
    return !id || id === 'socrates-school' ? path : `schools/${id}/${path}`;
  }
  function db() {
    if (global.db && typeof global.db.ref === 'function') return global.db;
    return global.firebase?.database?.();
  }
  async function val(path) {
    const snap = await db().ref(path).once('value');
    return snap.val() || {};
  }
  function toMs(value) {
    if (value === null || value === undefined) return null;
    if (typeof value === 'number' && Number.isFinite(value)) return value > 1e9 && value < 1e12 ? value * 1000 : value;
    const text = String(value || '').trim();
    if (!text) return null;
    const parsed = /^\d{10,13}$/.test(text) ? Number(text) : Date.parse(text);
    if (!Number.isFinite(parsed)) return null;
    return parsed > 1e9 && parsed < 1e12 ? parsed * 1000 : parsed;
  }
  // Same as finance_math getFinanceRoster studentYear / isActiveDirectStudent.
  function studentYear(student) {
    const explicit = Number(student?.academicYear || student?.admissionYear || student?.admYear || student?.year);
    if (Number.isFinite(explicit)) return explicit;
    const ms = toMs(student?.timestamp) ?? toMs(student?.createdAt) ?? toMs(student?.registeredAt) ?? toMs(student?.dateRegistered) ?? toMs(student?.dateOfRegistration);
    if (!ms) return null;
    const y = new Date(ms).getFullYear();
    return Number.isFinite(y) ? y : null;
  }
  function isActiveDirectStudent(student, targetYear) {
    if (!student || typeof student !== 'object') return false;
    const status = L(student.status);
    if (student.deleted === true || student.isDeleted === true || student.archived === true || student.isArchived === true || student.removed === true || student.isRemoved === true || student.active === false) return false;
    if (['deleted', 'archived', 'removed', 'shifted', 'graduated'].includes(status)) return false;
    const admission = String(student.admissionNumber || student.admissionNo || '').trim();
    const first = String(student.firstName || '').trim();
    const last = String(student.lastName || '').trim();
    if (!admission || L(admission) === 'n/a' || L(admission) === 'na') return false;
    if (!first || L(first) === 'n/a' || L(first) === 'na') return false;
    if (!last || L(last) === 'n/a' || L(last) === 'na') return false;
    const regYear = studentYear(student);
    return !Number.isFinite(targetYear) || !regYear || regYear <= targetYear;
  }

  async function load(year) {
    const y = Number(year);
    const YC = global.SomapYearClass;
    if (!YC || !Number.isFinite(y) || y < Number(YC.fromYear || 2026)) {
      if (global.SomapFinance?.getFinanceRoster) return global.SomapFinance.getFinanceRoster(year);
      throw new Error('Roster helpers are not loaded.');
    }
    const isSocrates = schoolId() === 'socrates-school';
    let [base, anchor, yearEnroll] = await Promise.all([val(pref('students')), val(pref(`enrollments/${DEFAULT_YEAR}`)), val(pref(`enrollments/${y}`))]);
    if (isSocrates && pref('students') !== 'students') {
      const [lb, la, ly] = await Promise.all([val('students'), val(`enrollments/${DEFAULT_YEAR}`), val(`enrollments/${y}`)]);
      base = { ...lb, ...base }; anchor = { ...la, ...anchor }; yearEnroll = { ...ly, ...yearEnroll };
    }
    const anchorLookup = YC.makeEnrollmentLookup(anchor);
    const yearLookup = YC.makeEnrollmentLookup(yearEnroll);
    const rows = [];
    Object.entries(base || {}).forEach(([id, student]) => {
      if (!isActiveDirectStudent(student, y)) return;
      const adm = String(student.admissionNumber || student.admissionNo || '').trim();
      const classLevel = YC.resolveYearClass(student, anchorLookup(id, adm), yearLookup(id, adm), y);
      if (!classLevel || ['GRADUATED', 'PRE-ADMISSION'].includes(String(classLevel).toUpperCase())) return;
      const fullName = `${student.firstName || ''} ${student.middleName || ''} ${student.lastName || ''}`.replace(/\s+/g, ' ').trim() || adm || id;
      rows.push({
        id, studentId: id, admissionNumber: adm || id, fullName, classLevel, className: classLevel,
        // Like finance (isGraduated: classLevel === 'GRADUATED'): an old isGraduated flag (e.g. Pre-Unit
        // graduation inside the school) does not remove a child who still has a class this year.
        status: L(student.status) || 'active', isGraduated: false,
        parentContact: String(student.primaryParentContact || student.parentPhone || student.guardianPhone || student.contact || '').trim(),
        rawStudent: student,
      });
    });
    return rows;
  }

  /** Cached per school + year for the page's lifetime. */
  function getYearRoster(year) {
    const key = `${schoolId()}::${year}`;
    if (!cache[key]) {
      cache[key] = load(year);
      cache[key].catch(() => { delete cache[key]; });
    }
    return cache[key];
  }

  global.SomapYearRoster = { getYearRoster };
}(typeof window !== 'undefined' ? window : globalThis));
