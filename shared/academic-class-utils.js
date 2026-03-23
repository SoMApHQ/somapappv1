(function (global) {
  'use strict';

  const CLASS_OPTIONS = [
    'Baby Class',
    'Middle Class',
    'Pre Unit Class',
    'Class 1',
    'Class 2',
    'Class 3',
    'Class 4',
    'Class 5',
    'Class 6',
    'Class 7',
    'Graduated'
  ];

  const SUBJECTS_BY_CLASS = {
    'Baby Class': ['Arithmetic', 'Communication', 'Relation', 'CRN', 'Health Care', 'Arts'],
    'Middle Class': ['Arithmetic', 'Communication', 'Relation', 'CRN', 'Health Care', 'Arts'],
    'Pre Unit Class': ['Arithmetic', 'Communication', 'Relation', 'CRN', 'Health Care', 'Arts'],
    'Class 1': ['Writing Skills', 'Arithmetic', 'Developing Sports & Arts', 'Health Care', 'Kusoma', 'Listening'],
    'Class 2': ['Writing Skills', 'Reading Skills', 'Arithmetic', 'Developing Sports & Arts', 'Health Care', 'Kusoma', 'Listening'],
    'Class 3': ['Math', 'English', 'Kiswahili', 'Science', 'Geography', 'Arts', 'History', 'French'],
    'Class 4': ['Math', 'English', 'Kiswahili', 'Science', 'Geography', 'Arts', 'History', 'French'],
    'Class 5': ['Math', 'English', 'Kiswahili', 'Science', 'Geography', 'Arts', 'History', 'French'],
    'Class 6': ['Math', 'English', 'Kiswahili', 'Science', 'Social Studies', 'Civics & Morals'],
    'Class 7': ['Math', 'English', 'Kiswahili', 'Science', 'Social Studies', 'Civics & Morals']
  };

  const NUMBER_WORDS = {
    one: 1,
    two: 2,
    three: 3,
    four: 4,
    five: 5,
    six: 6,
    seven: 7
  };

  function compact(value) {
    return String(value || '').trim().toLowerCase();
  }

  function normalizeSubjectName(value) {
    const raw = String(value || '').trim();
    if (!raw) return '';
    const key = raw.toLowerCase().replace(/[\s._-]+/g, '');
    if (key === 'healthcare' || key === 'healtharec') return 'Health Care';
    return raw.replace(/\s+/g, ' ');
  }

  function normalizeClassName(value, options = {}) {
    const allowGraduated = options.allowGraduated !== false;
    const raw = String(value || '').trim();
    if (!raw) return '';

    const lower = raw.toLowerCase();
    const token = lower.replace(/[^a-z0-9]/g, '');

    if (allowGraduated && (token === 'graduated' || token === 'graduate' || token === 'graduatedarchive')) {
      return 'Graduated';
    }
    if (token.includes('baby')) return 'Baby Class';
    if (token.includes('middle')) return 'Middle Class';
    if (token.includes('pre') || token.includes('nursery') || token.includes('unit')) return 'Pre Unit Class';

    const numeralMatch = token.match(/(?:class)?([1-7])(?:ab)?$/);
    if (numeralMatch) return `Class ${numeralMatch[1]}`;

    const wordMatch = lower.match(/\b(one|two|three|four|five|six|seven)\b/);
    if (wordMatch) return `Class ${NUMBER_WORDS[wordMatch[1]]}`;

    return raw.replace(/\s+/g, ' ');
  }

  function normalizeClassMappings(mappings = []) {
    const result = [];
    (mappings || []).forEach((mapping) => {
      const baseClass = normalizeClassName(mapping?.class);
      if (!baseClass) return;
      const streams = (mapping?.streams || []).filter((s) => s && s.name);
      if (!streams.length) {
        // No streams — standard single-class entry
        result.push({
          ...mapping,
          class: baseClass,
          subjects: Array.from(new Set((mapping?.subjects || []).map(normalizeSubjectName).filter(Boolean)))
        });
      } else {
        // Has streams — expand each stream into its own class entry.
        // The stream name (e.g. "3B") IS the class identifier for lesson plans, timetable, etc.
        streams.forEach((stream) => {
          result.push({
            ...mapping,
            class: stream.name,
            baseClass,
            streamName: stream.name,
            streamKey: stream.streamKey || stream.name.toLowerCase().replace(/[^a-z0-9]/g, ''),
            subjects: Array.from(new Set(
              ((stream.subjects && stream.subjects.length) ? stream.subjects : (mapping?.subjects || []))
                .map(normalizeSubjectName).filter(Boolean)
            )),
            streams: []   // flatten: no further nesting
          });
        });
      }
    });
    return result;
  }

  function canonicalizeClassList(values = [], options = {}) {
    const includeGraduated = Boolean(options.includeGraduated);
    const seen = new Set();
    const ordered = [];
    const canonicalOrder = includeGraduated ? CLASS_OPTIONS : CLASS_OPTIONS.filter((item) => item !== 'Graduated');

    (values || []).forEach((value) => {
      const normalized = normalizeClassName(value, { allowGraduated: includeGraduated });
      if (!normalized) return;
      if (!includeGraduated && normalized === 'Graduated') return;
      if (seen.has(normalized)) return;
      seen.add(normalized);
      ordered.push(normalized);
    });

    return canonicalOrder.filter((item) => seen.has(item)).concat(ordered.filter((item) => !canonicalOrder.includes(item)));
  }

  function buildSubjectListForClasses(classes = [], extraSubjects = []) {
    const subjectSet = new Set((extraSubjects || []).map(normalizeSubjectName).filter(Boolean));
    canonicalizeClassList(classes).forEach((className) => {
      (SUBJECTS_BY_CLASS[className] || []).forEach((subject) => subjectSet.add(subject));
    });
    return Array.from(subjectSet);
  }

  function normalizeTeacherConfig(config = {}, options = {}) {
    const mappings = normalizeClassMappings(config.classSubjectMappings || []);
    // Base classes that have been split into streams should NOT appear in the class list —
    // only the stream names (e.g. "3B") should appear, not "Class 3".
    const expandedBases = new Set(
      mappings.filter((m) => m.streamName).map((m) => m.baseClass).filter(Boolean)
    );
    const classes = canonicalizeClassList([
      ...(config.classes || []).filter((cls) => !expandedBases.has(normalizeClassName(cls))),
      ...mappings.map((mapping) => mapping.class)
    ], options);
    const subjects = Array.from(new Set([
      ...(config.subjects || []).map(normalizeSubjectName).filter(Boolean),
      ...buildSubjectListForClasses(classes, []),
      ...mappings.flatMap((mapping) => mapping.subjects || [])
    ]));

    return {
      ...config,
      classes,
      subjects,
      classSubjectMappings: mappings
    };
  }

  function shiftCanonicalClass(baseClass, deltaYears) {
    const normalized = normalizeClassName(baseClass, { allowGraduated: true });
    const ladder = CLASS_OPTIONS.filter((item) => item !== 'Graduated');
    const index = ladder.indexOf(normalized);
    if (index < 0) return normalized || '';
    const target = index + Number(deltaYears || 0);
    if (target < 0) return 'Pre-Admission';
    if (target >= ladder.length) return 'Graduated';
    return ladder[target];
  }

  function normalizeGenderBucket(value) {
    const raw = String(value || '').trim().toLowerCase();
    if (['m', 'male', 'boy', 'boys', 'man'].includes(raw)) return 'boys';
    if (['f', 'female', 'girl', 'girls', 'woman'].includes(raw)) return 'girls';
    return 'unknown';
  }

  function buildEnrollmentIndex(enrollments = {}) {
    const byId = { ...(enrollments || {}) };
    const byAdmission = {};
    Object.entries(enrollments || {}).forEach(([key, value]) => {
      if (!value || typeof value !== 'object') return;
      const admission = value.admissionNumber || value.admissionNo || value.admNo || '';
      if (admission && !byAdmission[admission]) byAdmission[admission] = value;
      if (!byId[key]) byId[key] = value;
    });
    return { byId, byAdmission };
  }

  function lookupEnrollment(index, studentId, admissionNo) {
    if (!index) return {};
    if (studentId && index.byId?.[studentId]) return index.byId[studentId];
    if (admissionNo && index.byId?.[admissionNo]) return index.byId[admissionNo];
    if (admissionNo && index.byAdmission?.[admissionNo]) return index.byAdmission[admissionNo];
    return {};
  }

  function getEnrollmentClassFromRecord(entry = {}) {
    if (!entry || typeof entry !== 'object') return '';
    return entry.className || entry.classLevel || entry.class || entry.grade || '';
  }

  function getStudentClassFromRecord(student = {}) {
    if (!student || typeof student !== 'object') return '';
    return student.className || student.classLevel || student.class || student.grade || student.gradeLevel || '';
  }

  function parseYearFromValue(value) {
    if (value == null) return null;
    if (typeof value === 'number' && Number.isFinite(value)) {
      const dt = new Date(value);
      if (!Number.isNaN(dt.getTime())) return dt.getFullYear();
    }
    if (typeof value === 'string') {
      const trimmed = value.trim();
      if (!trimmed) return null;
      if (/^\d{4}$/.test(trimmed)) return Number(trimmed);
      const numeric = Number(trimmed);
      if (!Number.isNaN(numeric)) {
        const dt = new Date(numeric);
        if (!Number.isNaN(dt.getTime())) return dt.getFullYear();
      }
      const parsed = Date.parse(trimmed);
      if (!Number.isNaN(parsed)) return new Date(parsed).getFullYear();
    }
    if (typeof value === 'object') {
      const yearField = value.year ?? value.y ?? null;
      if (typeof yearField === 'number' && Number.isFinite(yearField)) return yearField;
      if (typeof yearField === 'string' && /^\d{4}$/.test(yearField.trim())) return Number(yearField.trim());
      const seconds = Number(value.seconds ?? value._seconds ?? value.secondsValue ?? NaN);
      if (!Number.isNaN(seconds)) {
        const nanos = Number(value.nanoseconds ?? value._nanoseconds ?? 0);
        const millis = seconds * 1000 + Math.floor((Number.isFinite(nanos) ? nanos : 0) / 1e6);
        const dt = new Date(millis);
        if (!Number.isNaN(dt.getTime())) return dt.getFullYear();
      }
      if (typeof value.toDate === 'function') {
        const dt = value.toDate();
        if (dt instanceof Date && !Number.isNaN(dt.getTime())) return dt.getFullYear();
      }
    }
    return null;
  }

  function inferAdmissionYear(student = {}) {
    const sources = [
      student.createdTs,
      student.admissionTs,
      student.createdAt,
      student.created_at,
      student.admissionDate,
      student.admission_date,
      student.admissionYear,
      student.admYear,
      student.admissionYearValue,
      student.yearOfAdmission
    ];
    for (const candidate of sources) {
      const year = parseYearFromValue(candidate);
      if (Number.isFinite(year)) return Number(year);
    }
    return null;
  }

  function buildShiftRegistry(shiftEntries = {}, targetYear) {
    const shiftedIdSet = new Set();
    const shiftedNameSet = new Set();
    const shiftedByClass = {};
    const matchedShiftedByClass = {};
    const selectedYearNum = Number(targetYear);
    const normalizeRef = (value) => String(value || '').trim().toLowerCase();
    const normalizeName = (value) => String(value || '').toLowerCase().replace(/\s+/g, ' ').trim();

    Object.values(shiftEntries || {}).forEach((entry) => {
      const status = String(entry?.status || '').trim().toLowerCase();
      if (status !== 'shifted') return;
      const shiftYearVal = parseYearFromValue(entry?.shiftYear);
      const dateYearVal = parseYearFromValue(entry?.dateShifted);
      if (shiftYearVal !== null) {
        if (shiftYearVal !== selectedYearNum) return;
      } else if (dateYearVal !== null && dateYearVal !== selectedYearNum) {
        return;
      }

      [
        entry?.key,
        entry?.studentId,
        entry?.id,
        entry?.admissionNo,
        entry?.admissionNumber,
        entry?.admission
      ].forEach((ref) => {
        const normalized = normalizeRef(ref);
        if (normalized) shiftedIdSet.add(normalized);
      });

      [
        entry?.studentName,
        entry?.name,
        entry?.fullName
      ].forEach((nameRef) => {
        const normalized = normalizeName(nameRef);
        if (normalized) shiftedNameSet.add(normalized);
      });

      const cls = normalizeClassName(entry?.className || entry?.classLevel || entry?.class || entry?.grade || '');
      if (cls) shiftedByClass[cls] = (shiftedByClass[cls] || 0) + 1;
    });

    return { shiftedIdSet, shiftedNameSet, shiftedByClass, matchedShiftedByClass };
  }

  function buildAcademicRoster(studentsMap = {}, anchorEnrollments = {}, yearEnrollments = {}, shiftEntries = {}, options = {}) {
    const defaultYear = Number(options.defaultYear || new Date().getFullYear());
    const targetYear = Number(options.targetYear || defaultYear);
    const delta = targetYear - defaultYear;
    const includeShifted = Boolean(options.includeShifted);
    const anchorIndex = buildEnrollmentIndex(anchorEnrollments || {});
    const yearIndex = buildEnrollmentIndex(yearEnrollments || {});
    const shiftRegistry = buildShiftRegistry(shiftEntries || {}, targetYear);
    const roster = [];

    Object.entries(studentsMap || {}).forEach(([id, student]) => {
      const s = student || {};
      const status = String(s.status || '').trim().toLowerCase();
      if (status === 'shifted') return;

      const admissionNo = s.admissionNumber || s.admNo || s.admissionNo || '';
      const fullName = [s.firstName, s.middleName, s.lastName].filter(Boolean).join(' ').trim() || s.name || s.fullName || id || 'Unknown';
      const refKey = String(id || '').trim().toLowerCase();
      const admissionRef = String(admissionNo || '').trim().toLowerCase();
      const normalizedName = String(fullName || '').toLowerCase().replace(/\s+/g, ' ').trim();

      const isShiftedStudent = shiftRegistry.shiftedIdSet.has(refKey)
        || shiftRegistry.shiftedIdSet.has(admissionRef)
        || shiftRegistry.shiftedNameSet.has(normalizedName);

      const anchorEnrollment = lookupEnrollment(anchorIndex, id, admissionNo);
      const yearEnrollment = lookupEnrollment(yearIndex, id, admissionNo);
      const yearClass = getEnrollmentClassFromRecord(yearEnrollment);
      const anchorClass = getEnrollmentClassFromRecord(anchorEnrollment);
      const studentClass = getStudentClassFromRecord(s);
      const baseClass = anchorClass || studentClass || 'Unknown';
      const admissionYear = inferAdmissionYear(s);
      const hasAnchorRecord = anchorEnrollment && typeof anchorEnrollment === 'object' && Object.keys(anchorEnrollment).length > 0;
      const shouldShift = hasAnchorRecord || (Number.isFinite(admissionYear) && admissionYear <= defaultYear);

      const lastTransfer = s.lastClassTransfer || s.meta?.lastClassTransfer;
      const transferEffectiveYear = lastTransfer?.effectiveDate ? new Date(String(lastTransfer.effectiveDate) + 'T12:00:00').getFullYear() : null;
      const transferClass = lastTransfer?.toClass || '';

      let computedClass = yearClass;
      if (!computedClass && transferClass && Number(transferEffectiveYear) === targetYear) {
        computedClass = transferClass;
      }
      if (!computedClass) {
        computedClass = shouldShift ? shiftCanonicalClass(baseClass, delta) : baseClass;
      }

      const finalClass = normalizeClassName(computedClass || 'Unknown', { allowGraduated: true }) || 'Unknown';
      if (finalClass === 'Graduated') return;

      if (isShiftedStudent && !includeShifted) {
        shiftRegistry.matchedShiftedByClass[finalClass] = (shiftRegistry.matchedShiftedByClass[finalClass] || 0) + 1;
        return;
      }
      if (isShiftedStudent && includeShifted) {
        shiftRegistry.matchedShiftedByClass[finalClass] = (shiftRegistry.matchedShiftedByClass[finalClass] || 0) + 1;
      }

      roster.push({
        id,
        admissionNo,
        name: fullName,
        className: finalClass,
        gender: normalizeGenderBucket(s.gender || s.sex || s.Gender || s.Sex || ''),
        rawGender: s.gender || s.sex || s.Gender || s.Sex || '',
        status: status || 'active',
        raw: s
      });
    });

    return { roster, shiftRegistry };
  }

  function buildAttendancePathCandidates(year, className, dateKey) {
    const canonical = normalizeClassName(className);
    const monthKey = /^\d{4}-\d{2}-\d{2}$/.test(String(dateKey || ''))
      ? String(dateKey).slice(0, 7)
      : '';
    const variants = Array.from(new Set([
      String(className || '').trim(),
      canonical,
      canonical.replace(/\s+/g, '_'),
      canonical.replace(/\s+/g, ''),
      canonical.toUpperCase(),
      canonical.toUpperCase().replace(/\s+/g, ''),
      canonical.toLowerCase(),
      canonical.toLowerCase().replace(/\s+/g, '_')
    ].filter(Boolean)));

    const candidates = [];
    variants.forEach((variant) => {
      if (monthKey) {
        candidates.push(`attendance/${variant}/${monthKey}/${dateKey}`);
      }
      candidates.push(`classAttendance/${year}/${variant}/${dateKey}`);
      candidates.push(`attendance/class/${year}/${variant}/${dateKey}`);
      candidates.push(`attendance/${year}/${variant}/${dateKey}`);
      candidates.push(`classAttendance/${variant}/${dateKey}`);
      candidates.push(`attendance/${variant}/${dateKey}`);
    });
    return Array.from(new Set(candidates));
  }

  function summarizeAttendanceNode(node, studentsMap = {}) {
    const summary = { present: 0, absent: 0, boysP: 0, girlsP: 0, boysA: 0, girlsA: 0 };
    Object.keys(node || {}).forEach((studentId) => {
      const rec = node[studentId] || {};
      const amStatus = String(rec.am || '').trim().toUpperCase();
      const pmStatus = String(rec.pm || '').trim().toUpperCase();
      const derivedDaily = rec.daily || rec.status || rec.s || ((amStatus === 'P' && pmStatus === 'P') ? 'P' : `${amStatus}${pmStatus}`);
      const status = String(derivedDaily || '').trim().toUpperCase();
      const isPresent = ['P', 'PRESENT', 'PR'].includes(status);
      const student = studentsMap[studentId] || {};
      const gender = normalizeGenderBucket(rec.gender || rec.sex || student.gender || student.sex || student.rawGender || '');
      const isBoy = gender === 'boys';

      if (isPresent) {
        summary.present += 1;
        if (isBoy) summary.boysP += 1;
        else if (gender === 'girls') summary.girlsP += 1;
      } else {
        summary.absent += 1;
        if (isBoy) summary.boysA += 1;
        else if (gender === 'girls') summary.girlsA += 1;
      }
    });
    return summary;
  }

  global.SomapAcademicClassUtils = {
    CLASS_OPTIONS,
    SUBJECTS_BY_CLASS,
    normalizeClassName,
    normalizeSubjectName,
    normalizeTeacherConfig,
    normalizeClassMappings,
    canonicalizeClassList,
    buildSubjectListForClasses,
    shiftCanonicalClass,
    normalizeGenderBucket,
    buildAcademicRoster,
    buildAttendancePathCandidates,
    summarizeAttendanceNode
  };
})(typeof window !== 'undefined' ? window : globalThis);
