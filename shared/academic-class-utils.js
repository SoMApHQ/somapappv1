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
    return (mappings || []).map((mapping) => ({
      ...mapping,
      class: normalizeClassName(mapping?.class),
      subjects: Array.from(new Set((mapping?.subjects || []).map(normalizeSubjectName).filter(Boolean)))
    })).filter((mapping) => mapping.class);
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
    const classes = canonicalizeClassList([
      ...(config.classes || []),
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

  function buildAttendancePathCandidates(year, className, dateKey) {
    const canonical = normalizeClassName(className);
    const variants = Array.from(new Set([
      String(className || '').trim(),
      canonical,
      canonical.replace(/\s+/g, '_'),
      canonical.replace(/\s+/g, ''),
      canonical.toLowerCase(),
      canonical.toLowerCase().replace(/\s+/g, '_')
    ].filter(Boolean)));

    const candidates = [];
    variants.forEach((variant) => {
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
      const status = String(rec.daily || rec.status || rec.s || '').trim().toUpperCase();
      const amStatus = String(rec.am || '').trim().toUpperCase();
      const pmStatus = String(rec.pm || '').trim().toUpperCase();
      const isPresent = ['P', 'PRESENT', '1', 'TRUE'].includes(status) || amStatus === 'P' || pmStatus === 'P';
      const student = studentsMap[studentId] || {};
      const gender = String(rec.gender || rec.sex || student.gender || student.sex || '').trim().toUpperCase();
      const isBoy = ['M', 'B', 'BOY', 'MALE'].includes(gender);

      if (isPresent) {
        summary.present += 1;
        if (isBoy) summary.boysP += 1;
        else summary.girlsP += 1;
      } else {
        summary.absent += 1;
        if (isBoy) summary.boysA += 1;
        else summary.girlsA += 1;
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
    buildAttendancePathCandidates,
    summarizeAttendanceNode
  };
})(typeof window !== 'undefined' ? window : globalThis);
