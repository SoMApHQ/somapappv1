(function (global) {
  'use strict';

  const Shared = global.SoMApExamShared || global.SoMApExamTemplateEngine;
  const ClassUtils = global.ClassUtils || null;
  const FALLBACK_STUDENT_NAMES = ['Amani', 'Neema', 'Baraka', 'Asha', 'Juma', 'Zawadi', 'Salma', 'Faraja'];
  const FALLBACK_PARENT_NAMES = ['Mama Amina', 'Baba Juma', 'Bi Rehema', 'Bwana Musa'];
  const FALLBACK_PLACE_NAMES = ['the school garden', 'the classroom', 'the library', 'the playground'];

  function compactText(value) {
    return Shared ? Shared.compactText(value) : String(value == null ? '' : value).replace(/\s+/g, ' ').trim();
  }

  function normalizeLookupToken(value) {
    return Shared ? Shared.normalizeLookupToken(value) : compactText(value).toLowerCase();
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

  async function readSchoolNode(path, schoolId) {
    const db = getDb();
    if (!db) return {};
    const snap = await db.ref(scopedPath(path, schoolId)).once('value').catch(() => ({ val: () => null }));
    return (snap && typeof snap.val === 'function' && snap.val()) || {};
  }

  function extractFullName(record) {
    if (!record || typeof record !== 'object') return '';
    return [
      record.fullName,
      record.fullNameUpper,
      [record.firstName, record.middleName, record.lastName].filter(Boolean).join(' '),
      record.name,
      record.studentName
    ].map(compactText).find(Boolean) || '';
  }

  function extractParentNames(record) {
    if (!record || typeof record !== 'object') return [];
    return [
      record.parentName,
      record.parentFullName,
      record.primaryParentName,
      record.guardianName,
      record.motherName,
      record.fatherName,
      record.parent,
      record.guardian
    ].map(compactText).filter(Boolean);
  }

  function filterByClass(records, className) {
    const normalizedClass = normalizeLookupToken(className || '');
    if (!normalizedClass) return records;
    return records.filter((record) => {
      const studentClass = ClassUtils?.normalizeClassName
        ? ClassUtils.normalizeClassName(record.className || record.classLevel || record.class || '', { allowGraduated: true })
        : compactText(record.className || record.classLevel || record.class || '');
      const yearClass = ClassUtils?.normalizeClassName
        ? ClassUtils.normalizeClassName(record.enrollmentClass || record.currentClass || '', { allowGraduated: true })
        : compactText(record.enrollmentClass || record.currentClass || '');
      return normalizeLookupToken(studentClass) === normalizedClass || normalizeLookupToken(yearClass) === normalizedClass;
    });
  }

  async function loadPool(options) {
    const settings = options && typeof options === 'object' ? options : {};
    const schoolId = compactText(settings.schoolId || currentSchoolId());
    const year = String(settings.year || (Shared ? Shared.currentYear() : new Date().getFullYear()));
    const anchorYear = '2026';
    const [studentsMap, anchorEnrollments, yearEnrollments, schoolProfile] = await Promise.all([
      readSchoolNode('students', schoolId),
      readSchoolNode(`enrollments/${anchorYear}`, schoolId),
      readSchoolNode(`enrollments/${year}`, schoolId),
      readSchoolNode('profile', schoolId)
    ]);

    const records = Object.entries(studentsMap || {}).map(([id, record]) => {
      const enrollment = yearEnrollments?.[id]
        || anchorEnrollments?.[id]
        || yearEnrollments?.[record?.admissionNumber]
        || anchorEnrollments?.[record?.admissionNumber]
        || {};
      return {
        id,
        ...record,
        enrollmentClass: enrollment.className || enrollment.classLevel || enrollment.class || '',
        enrollmentParentNames: extractParentNames(enrollment)
      };
    });
    const filtered = filterByClass(records, settings.className);
    const studentNames = Array.from(new Set(filtered.map(extractFullName).filter(Boolean)));
    const parentNames = Array.from(new Set(filtered.flatMap((record) => [
      ...extractParentNames(record),
      ...(record.enrollmentParentNames || [])
    ]).filter(Boolean)));
    const placeNames = Array.from(new Set([
      compactText(global.localStorage?.getItem('schoolName') || global.localStorage?.getItem('somap.currentSchoolName') || ''),
      compactText(schoolProfile?.name || ''),
      compactText(schoolProfile?.village || schoolProfile?.location || ''),
      compactText(schoolProfile?.ward || ''),
      compactText(schoolProfile?.area || schoolProfile?.region || ''),
      compactText(settings.className || '')
    ].filter(Boolean)));

    return {
      schoolId,
      year,
      studentNames: studentNames.length ? studentNames : FALLBACK_STUDENT_NAMES.slice(),
      parentNames: parentNames.length ? parentNames : FALLBACK_PARENT_NAMES.slice(),
      placeNames: placeNames.length ? placeNames : FALLBACK_PLACE_NAMES.slice()
    };
  }

  function rotatePick(pool, index) {
    const items = Array.isArray(pool) && pool.length ? pool : ['Name'];
    return items[Math.abs(Number(index || 0)) % items.length];
  }

  function pickContext(pool, index) {
    const source = pool && typeof pool === 'object' ? pool : {};
    return {
      studentName: rotatePick(source.studentNames || FALLBACK_STUDENT_NAMES, index),
      helperName: rotatePick(source.studentNames || FALLBACK_STUDENT_NAMES, index + 2),
      parentName: rotatePick(source.parentNames || FALLBACK_PARENT_NAMES, index + 1),
      placeName: rotatePick(source.placeNames || FALLBACK_PLACE_NAMES, index + 3)
    };
  }

  const api = {
    loadPool,
    pickContext
  };

  global.SoMApExamNamePool = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
