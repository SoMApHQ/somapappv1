(function (global) {
  'use strict';

  const ClassUtils = global.SomapAcademicClassUtils || {};

  function normalizeAssignmentSubject(value) {
    const normalized = ClassUtils.normalizeSubjectName
      ? ClassUtils.normalizeSubjectName(value)
      : String(value || '').trim().replace(/\s+/g, ' ');
    return normalized;
  }

  function subjectKey(value) {
    return normalizeAssignmentSubject(value).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  }

  function normalizeAssignmentClass(value) {
    const raw = String(value || '').trim().replace(/\s+/g, ' ');
    if (!raw) return '';
    const base = ClassUtils.getBaseClassName ? ClassUtils.getBaseClassName(raw) : raw;
    const compact = raw.toLowerCase().replace(/[^a-z0-9]/g, '');
    const streamMatch = compact.match(/^(?:class)?([1-7])([a-z]{1,4})$/);
    if (streamMatch) return `${streamMatch[1]} ${streamMatch[2].toUpperCase()}`;
    return base || raw;
  }

  function classKey(value) {
    const raw = String(value || '').trim().toLowerCase().replace(/[^a-z0-9]/g, '');
    const streamMatch = raw.match(/^(?:class)?([1-7])([a-z]{1,4})$/);
    if (streamMatch) return `${streamMatch[1]}${streamMatch[2]}`;
    const normalized = normalizeAssignmentClass(value).toLowerCase().replace(/[^a-z0-9]/g, '');
    return normalized;
  }

  function baseClass(value) {
    return ClassUtils.getBaseClassName ? ClassUtils.getBaseClassName(value) : normalizeAssignmentClass(value);
  }

  function ymd(value) {
    const raw = String(value || '').trim();
    return /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : '';
  }

  function activeOn(assignment, dateYmd) {
    if (!assignment || assignment.active === false) {
      const to = ymd(assignment?.effectiveTo);
      return !!to && !!dateYmd && dateYmd < to;
    }
    const from = ymd(assignment.effectiveFrom);
    const to = ymd(assignment.effectiveTo);
    if (from && dateYmd && dateYmd < from) return false;
    if (to && dateYmd && dateYmd >= to) return false;
    return true;
  }

  function makeAssignment({ className, streamName, subject, effectiveFrom, effectiveTo, active }) {
    const cls = normalizeAssignmentClass(className || streamName);
    const subj = normalizeAssignmentSubject(subject);
    if (!cls || !subj) return null;
    const stream = streamName ? normalizeAssignmentClass(streamName) : '';
    return {
      className: stream || cls,
      baseClass: baseClass(cls),
      streamName: stream,
      subject: subj,
      effectiveFrom: ymd(effectiveFrom),
      effectiveTo: ymd(effectiveTo),
      active: active !== false
    };
  }

  function flattenTeacherAssignments(config) {
    const byKey = new Map();
    Object.values(config?.assignmentHistory || {}).forEach((entry) => {
      const assignment = makeAssignment(entry || {});
      if (assignment) byKey.set(buildAssignmentKey(assignment), assignment);
    });

    (config?.classSubjectMappings || []).forEach((mapping) => {
      const mappingClass = mapping?.class || mapping?.className || '';
      const mappingFrom = mapping?.effectiveFrom || config?.assignmentEffectiveFrom || '';
      const streams = (mapping?.streams || []).filter((stream) => stream && stream.name);
      if (streams.length) {
        streams.forEach((stream) => {
          (stream.subjects || mapping?.subjects || []).forEach((subject) => {
            const assignment = makeAssignment({
              className: mappingClass,
              streamName: stream.name,
              subject,
              effectiveFrom: stream.subjectEffectiveFrom?.[subject] || stream.effectiveFrom || mappingFrom,
              active: true
            });
            if (assignment) byKey.set(buildAssignmentKey(assignment), { ...(byKey.get(buildAssignmentKey(assignment)) || {}), ...assignment, active: true, effectiveTo: '' });
          });
        });
        return;
      }
      (mapping?.subjects || []).forEach((subject) => {
        const assignment = makeAssignment({
          className: mappingClass,
          subject,
          effectiveFrom: mapping.subjectEffectiveFrom?.[subject] || mappingFrom,
          active: true
        });
        if (assignment) byKey.set(buildAssignmentKey(assignment), { ...(byKey.get(buildAssignmentKey(assignment)) || {}), ...assignment, active: true, effectiveTo: '' });
      });
    });

    return Array.from(byKey.values());
  }

  function buildAssignmentKey(assignment) {
    return `${classKey(assignment?.className || assignment?.streamName || assignment?.baseClass)}|${subjectKey(assignment?.subject)}`;
  }

  function getAssignmentsActiveOnDate(config, dateYmd) {
    return flattenTeacherAssignments(config).filter((assignment) => activeOn(assignment, dateYmd));
  }

  function isTeacherAssignedOnDate(config, className, subject, dateYmd) {
    const wantedClassKey = classKey(className);
    const wantedSubjectKey = subjectKey(subject);
    return getAssignmentsActiveOnDate(config, dateYmd).some((assignment) => (
      classKey(assignment.className) === wantedClassKey ||
      classKey(assignment.streamName) === wantedClassKey ||
      classKey(assignment.baseClass) === wantedClassKey
    ) && subjectKey(assignment.subject) === wantedSubjectKey);
  }

  function getAssignedClasses(config, dateYmd) {
    return Array.from(new Set(getAssignmentsActiveOnDate(config, dateYmd).map((assignment) => assignment.className).filter(Boolean)));
  }

  function getAssignedSubjectsForClass(config, className, dateYmd) {
    const wantedClassKey = classKey(className);
    return Array.from(new Set(getAssignmentsActiveOnDate(config, dateYmd)
      .filter((assignment) => classKey(assignment.className) === wantedClassKey || classKey(assignment.streamName) === wantedClassKey || classKey(assignment.baseClass) === wantedClassKey)
      .map((assignment) => assignment.subject)
      .filter(Boolean)));
  }

  function buildLessonInstanceKey(lesson) {
    return [
      lesson?.year || lesson?.academicYear || '',
      lesson?.date || '',
      lesson?.groupId || lesson?.timetableGroupId || '',
      classKey(lesson?.className || lesson?.class || ''),
      subjectKey(lesson?.subject || lesson?.subjectName || ''),
      lesson?.slotId || lesson?.timetableSlotId || '',
      lesson?.teacherId || ''
    ].map((part) => String(part || '').trim()).join('|');
  }

  global.SomapTeacherAssignmentUtils = {
    normalizeAssignmentClass,
    normalizeAssignmentSubject,
    flattenTeacherAssignments,
    buildAssignmentKey,
    getAssignmentsActiveOnDate,
    isTeacherAssignedOnDate,
    getAssignedClasses,
    getAssignedSubjectsForClass,
    buildLessonInstanceKey
  };
})(typeof window !== 'undefined' ? window : globalThis);
