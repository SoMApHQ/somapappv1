(function (global) {
  'use strict';

  const Shared = global.SoMApExamShared || global.SoMApExamTemplateEngine;
  const ClassUtils = global.SomapAcademicClassUtils || global.ClassUtils || null;
  const SCHOOL_WIDE_ROLES = new Set([
    'academic teacher',
    'head teacher',
    'assistant headteacher',
    'management teacher',
    'admin'
  ]);

  function compactText(value) {
    return Shared ? Shared.compactText(value) : String(value == null ? '' : value).replace(/\s+/g, ' ').trim();
  }

  function lower(value) {
    return compactText(value).toLowerCase();
  }

  function safeStorageGet(key) {
    try {
      return global.localStorage ? global.localStorage.getItem(key) : null;
    } catch (_) {
      return null;
    }
  }

  function safeStorageSet(key, value) {
    try {
      if (global.localStorage) global.localStorage.setItem(key, value);
    } catch (_) {
      /* ignore storage failures */
    }
  }

  function safeSessionGet(key) {
    try {
      return global.sessionStorage ? global.sessionStorage.getItem(key) : null;
    } catch (_) {
      return null;
    }
  }

  function safeSessionSet(key, value) {
    try {
      if (global.sessionStorage) global.sessionStorage.setItem(key, value);
    } catch (_) {
      /* ignore storage failures */
    }
  }

  function getDb() {
    return Shared ? Shared.getDb() : (global.db || global.firebase?.database?.() || null);
  }

  function normalizeClassName(value) {
    return ClassUtils?.normalizeClassName
      ? ClassUtils.normalizeClassName(value, { allowGraduated: false })
      : compactText(value);
  }

  function normalizeSubjectName(value) {
    return ClassUtils?.normalizeSubjectName
      ? ClassUtils.normalizeSubjectName(value)
      : compactText(value);
  }

  function buildCandidatePaths(relativePath, schoolId, extraPaths) {
    const paths = [];
    const seen = new Set();

    function push(pathValue) {
      const path = compactText(pathValue);
      if (!path || seen.has(path)) return;
      seen.add(path);
      paths.push(path);
    }

    if (Shared?.scopedPath) push(Shared.scopedPath(relativePath, schoolId));
    push(relativePath);
    if (schoolId && !relativePath.startsWith('schools/')) push(`schools/${schoolId}/${relativePath}`);
    (extraPaths || []).forEach(push);
    return paths;
  }

  async function readPath(path) {
    const db = getDb();
    if (!db) return null;
    const snap = await db.ref(path).once('value').catch(() => ({ val: () => null }));
    return (snap && typeof snap.val === 'function' && snap.val()) || null;
  }

  function hasObjectKeys(value) {
    return Boolean(value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length);
  }

  function deepMerge(baseValue, incomingValue) {
    if (!hasObjectKeys(baseValue)) return hasObjectKeys(incomingValue) ? { ...incomingValue } : incomingValue;
    if (!hasObjectKeys(incomingValue)) return baseValue;
    const merged = { ...baseValue };
    Object.entries(incomingValue).forEach(([key, value]) => {
      if (hasObjectKeys(value) && hasObjectKeys(merged[key])) merged[key] = deepMerge(merged[key], value);
      else merged[key] = value;
    });
    return merged;
  }

  async function readFirstValue(paths, options) {
    const settings = options && typeof options === 'object' ? options : {};
    const allowEmptyObject = Boolean(settings.allowEmptyObject);
    for (const path of paths || []) {
      const value = await readPath(path);
      if (value == null) continue;
      if (typeof value !== 'object' || Array.isArray(value)) return value;
      if (allowEmptyObject || Object.keys(value).length) return value;
    }
    return null;
  }

  async function readMergedObject(paths) {
    let merged = {};
    let found = false;
    for (const path of paths || []) {
      const value = await readPath(path);
      if (!hasObjectKeys(value)) continue;
      merged = deepMerge(merged, value);
      found = true;
    }
    return found ? merged : null;
  }

  function resolveWorkerId(params) {
    const searchParams = params instanceof URLSearchParams ? params : new URLSearchParams(global.location?.search || '');
    const workerId = [
      searchParams.get('workerId'),
      searchParams.get('id'),
      safeStorageGet('workerId'),
      safeSessionGet('workerId')
    ].map(compactText).find(Boolean) || '';
    if (workerId) {
      safeStorageSet('workerId', workerId);
      safeSessionSet('workerId', workerId);
    }
    return workerId;
  }

  function resolveRole(params) {
    const searchParams = params instanceof URLSearchParams ? params : new URLSearchParams(global.location?.search || '');
    const role = [
      searchParams.get('role'),
      safeStorageGet('somap_role'),
      safeSessionGet('dashboardAccessedBy'),
      safeSessionGet('somap_role')
    ].map(compactText).find(Boolean) || 'Teacher';
    safeStorageSet('somap_role', role);
    safeSessionSet('somap_role', role);
    return role;
  }

  function resolveSchoolMeta(params) {
    const searchParams = params instanceof URLSearchParams ? params : new URLSearchParams(global.location?.search || '');
    const requestedSchoolId = compactText(searchParams.get('school') || searchParams.get('schoolId') || '');
    const storedMeta = (() => {
      try {
        const raw = safeStorageGet('somap.currentSchool');
        return raw ? JSON.parse(raw) : null;
      } catch (_) {
        return null;
      }
    })();
    const schoolFromContext = global.SOMAP?.getSchool?.() || global.SOMAP?.getActiveSchool?.() || null;
    const schoolId = requestedSchoolId
      || compactText(storedMeta?.id || '')
      || compactText(schoolFromContext?.id || schoolFromContext?.schoolId || '')
      || compactText(safeStorageGet('somap.currentSchoolId') || safeStorageGet('currentSchoolId') || safeStorageGet('schoolId'))
      || 'socrates-school';
    const schoolName = compactText(
      searchParams.get('schoolName')
      || storedMeta?.name
      || schoolFromContext?.name
      || safeStorageGet('somap.currentSchoolName')
      || (Shared?.prettifySchoolName ? Shared.prettifySchoolName(schoolId) : schoolId)
    );
    return { id: schoolId, name: schoolName };
  }

  function resolveYear(params) {
    const searchParams = params instanceof URLSearchParams ? params : new URLSearchParams(global.location?.search || '');
    const year = compactText(
      searchParams.get('year')
      || safeStorageGet('somapSelectedYear')
      || safeSessionGet('somapSelectedYear')
      || safeStorageGet('currentAcademicYear')
      || global.somapYearContext?.getSelectedYear?.()
      || new Date().getFullYear()
    );
    if (year) {
      safeStorageSet('somapSelectedYear', year);
      safeSessionSet('somapSelectedYear', year);
    }
    return year;
  }

  function persistExamContext(contextLike) {
    const context = contextLike && typeof contextLike === 'object' ? contextLike : {};
    const schoolId = compactText(context.schoolId || context.id || 'socrates-school') || 'socrates-school';
    const schoolName = compactText(
      context.schoolName
      || context.name
      || (Shared?.prettifySchoolName ? Shared.prettifySchoolName(schoolId) : schoolId)
    );
    const year = compactText(context.year || new Date().getFullYear()) || String(new Date().getFullYear());
    const workerId = compactText(context.workerId || '');
    const role = compactText(context.role || 'Teacher') || 'Teacher';

    safeStorageSet('somap.currentSchoolId', schoolId);
    safeStorageSet('somap.currentSchoolName', schoolName);
    safeStorageSet('somapSelectedYear', year);
    safeStorageSet('somap_role', role);
    safeSessionSet('somap.currentSchoolId', schoolId);
    safeSessionSet('somap.currentSchoolName', schoolName);
    safeSessionSet('somapSelectedYear', year);
    safeSessionSet('dashboardAccessedBy', role);
    if (workerId) {
      safeStorageSet('workerId', workerId);
      safeSessionSet('workerId', workerId);
    }
    try {
      safeStorageSet('somap.currentSchool', JSON.stringify({ id: schoolId, name: schoolName }));
    } catch (_) {
      /* ignore serialization failures */
    }
    try {
      global.SOMAP?.setSchool?.({ id: schoolId, name: schoolName });
    } catch (_) {
      /* ignore context sync failures */
    }
    try {
      global.somapYearContext?.setSelectedYear?.(year);
    } catch (_) {
      /* ignore year sync failures */
    }

    return {
      schoolId,
      schoolName,
      year,
      workerId,
      role
    };
  }

  function resolveExamContext(options) {
    const settings = options && typeof options === 'object' ? options : {};
    const params = settings.params instanceof URLSearchParams ? settings.params : new URLSearchParams(global.location?.search || '');
    const schoolMeta = resolveSchoolMeta(params);
    return persistExamContext({
      schoolId: schoolMeta.id,
      schoolName: schoolMeta.name,
      year: resolveYear(params),
      workerId: resolveWorkerId(params),
      role: resolveRole(params)
    });
  }

  function isSchoolWideRole(roleValue) {
    return SCHOOL_WIDE_ROLES.has(lower(roleValue || ''));
  }

  async function loadSchoolProfile(contextLike) {
    const context = contextLike && typeof contextLike === 'object' ? contextLike : resolveExamContext();
    const paths = buildCandidatePaths('profile', context.schoolId, [
      `schools/${context.schoolId}/profile`
    ]);
    return (await readFirstValue(paths, { allowEmptyObject: true })) || {};
  }

  async function readTeacherConfig(contextLike) {
    const context = contextLike && typeof contextLike === 'object' ? contextLike : resolveExamContext();
    if (!context.workerId) return null;
    const currentYear = String(context.year);
    const previousYear = String(Number(currentYear) - 1);
    const currentConfig = await readFirstValue(buildCandidatePaths(`years/${currentYear}/teachers_config/${context.workerId}`, context.schoolId, [
      `teachers_config/${context.workerId}`
    ]));
    const previousConfig = await readFirstValue(buildCandidatePaths(`years/${previousYear}/teachers_config/${context.workerId}`, context.schoolId));
    const merged = {
      ...(previousConfig && typeof previousConfig === 'object' ? previousConfig : {}),
      ...(currentConfig && typeof currentConfig === 'object' ? currentConfig : {})
    };
    return ClassUtils?.normalizeTeacherConfig
      ? ClassUtils.normalizeTeacherConfig(merged, { includeGraduated: false })
      : merged;
  }

  async function readTeacherConfigIndex(contextLike) {
    const context = contextLike && typeof contextLike === 'object' ? contextLike : resolveExamContext();
    const currentYear = String(context.year);
    const yearTree = (await readMergedObject(buildCandidatePaths(`years/${currentYear}/teachers_config`, context.schoolId))) || {};
    const rootTree = (await readMergedObject(buildCandidatePaths('teachers_config', context.schoolId))) || {};
    const workerIds = Array.from(new Set([
      ...Object.keys(yearTree || {}),
      ...Object.keys(rootTree || {})
    ]));
    const configsByWorker = {};
    workerIds.forEach((workerId) => {
      const merged = {
        ...(rootTree?.[workerId] && typeof rootTree[workerId] === 'object' ? rootTree[workerId] : {}),
        ...(yearTree?.[workerId] && typeof yearTree[workerId] === 'object' ? yearTree[workerId] : {})
      };
      if (!Object.keys(merged).length) return;
      configsByWorker[workerId] = ClassUtils?.normalizeTeacherConfig
        ? ClassUtils.normalizeTeacherConfig(merged, { includeGraduated: false })
        : merged;
    });
    return configsByWorker;
  }

  function normalizeTemplateCollection(templates, context) {
    const items = Array.isArray(templates) ? templates : [];
    return items.map((template) => Shared.normalizeTemplate({
      schoolId: context.schoolId,
      year: context.year,
      ...template
    }));
  }

  async function loadExamTemplates(contextLike) {
    const context = contextLike && typeof contextLike === 'object' ? contextLike : resolveExamContext();
    const tree = (await readMergedObject(buildCandidatePaths(`years/${context.year}/examFormats`, context.schoolId))) || {};
    return normalizeTemplateCollection(Shared?.flattenExamFormatsTree ? Shared.flattenExamFormatsTree(tree, context) : [], context);
  }

  async function loadExamSettings(contextLike) {
    const context = contextLike && typeof contextLike === 'object' ? contextLike : resolveExamContext();
    return (await readFirstValue(buildCandidatePaths(`years/${context.year}/examSettings/general`, context.schoolId), { allowEmptyObject: true })) || {};
  }

  function flattenGeneratedExamsTree(tree, contextLike) {
    const context = contextLike && typeof contextLike === 'object' ? contextLike : resolveExamContext();
    const papers = [];
    Object.entries(tree || {}).forEach(([storedClass, bySubject]) => {
      Object.entries(bySubject || {}).forEach(([storedSubject, byMonth]) => {
        Object.entries(byMonth || {}).forEach(([storedMonth, byPaper]) => {
          Object.entries(byPaper || {}).forEach(([paperId, paper]) => {
            if (!paper || typeof paper !== 'object') return;
            papers.push({
              ...paper,
              schoolId: compactText(paper.schoolId || context.schoolId),
              year: String(paper.year || context.year),
              id: compactText(paper.id || paperId),
              className: compactText(paper.className || paper.class || storedClass.replace(/_/g, ' ')),
              subject: compactText(paper.subject || paper.subjectName || storedSubject.replace(/_/g, ' ')),
              monthKey: Shared?.normalizeMonthKey
                ? Shared.normalizeMonthKey(paper.monthKey || storedMonth, paper.year || context.year)
                : compactText(paper.monthKey || storedMonth),
              monthLabel: compactText(
                paper.monthLabel
                || Shared?.formatMonthLabel?.(paper.monthKey || storedMonth, { includeYear: false })
                || ''
              )
            });
          });
        });
      });
    });
    return papers.sort((left, right) => Number(right.generatedAt || 0) - Number(left.generatedAt || 0));
  }

  async function loadGeneratedExams(contextLike) {
    const context = contextLike && typeof contextLike === 'object' ? contextLike : resolveExamContext();
    const tree = (await readMergedObject(buildCandidatePaths(`years/${context.year}/generatedExams`, context.schoolId))) || {};
    return flattenGeneratedExamsTree(tree, context);
  }

  function addTerm(termSet, value) {
    const label = compactText(Shared?.formatAcademicTermLabel ? Shared.formatAcademicTermLabel(value) : value);
    if (label) termSet.add(label);
  }

  function createRegistry() {
    return {
      classes: [],
      subjectsByClass: {},
      allSubjects: [],
      terms: [],
      sourcesUsed: [],
      classAliases: {},
      subjectAliasesByClass: {}
    };
  }

  function pushUnique(target, value) {
    if (!value || target.includes(value)) return;
    target.push(value);
  }

  function addAlias(registry, canonicalClass, rawClass, rawSubject) {
    const cleanClass = compactText(rawClass);
    if (canonicalClass && cleanClass && cleanClass !== canonicalClass) {
      registry.classAliases[canonicalClass] = registry.classAliases[canonicalClass] || [];
      pushUnique(registry.classAliases[canonicalClass], cleanClass);
    }
    if (canonicalClass && rawSubject) {
      const cleanSubject = compactText(rawSubject);
      const canonicalSubject = normalizeSubjectName(cleanSubject);
      if (cleanSubject && canonicalSubject && cleanSubject !== canonicalSubject) {
        registry.subjectAliasesByClass[canonicalClass] = registry.subjectAliasesByClass[canonicalClass] || {};
        registry.subjectAliasesByClass[canonicalClass][canonicalSubject] = registry.subjectAliasesByClass[canonicalClass][canonicalSubject] || [];
        pushUnique(registry.subjectAliasesByClass[canonicalClass][canonicalSubject], cleanSubject);
      }
    }
  }

  function addClassSubject(registry, rawClass, rawSubject, sourceLabel) {
    const className = normalizeClassName(rawClass) || compactText(rawClass);
    const subject = normalizeSubjectName(rawSubject) || compactText(rawSubject);
    if (!className) return;
    pushUnique(registry.classes, className);
    registry.subjectsByClass[className] = registry.subjectsByClass[className] || [];
    if (subject) {
      pushUnique(registry.subjectsByClass[className], subject);
      pushUnique(registry.allSubjects, subject);
    }
    addAlias(registry, className, rawClass, rawSubject);
    if (sourceLabel) pushUnique(registry.sourcesUsed, sourceLabel);
  }

  function finalizeRegistry(registry, teacherConfig) {
    const fallbackClasses = teacherConfig?.classes?.length
      ? teacherConfig.classes
      : (ClassUtils?.CLASS_OPTIONS || []).filter((item) => item !== 'Graduated');
    const orderedClasses = ClassUtils?.canonicalizeClassList
      ? ClassUtils.canonicalizeClassList(registry.classes.length ? registry.classes : fallbackClasses, { includeGraduated: false })
      : Array.from(new Set((registry.classes.length ? registry.classes : fallbackClasses).filter(Boolean)));
    registry.classes = orderedClasses;
    registry.classes.forEach((className) => {
      if (!registry.subjectsByClass[className]?.length && teacherConfig?.classSubjectMappings?.length) {
        const mapping = teacherConfig.classSubjectMappings.find((entry) => entry.class === className);
        registry.subjectsByClass[className] = Array.from(new Set((mapping?.subjects || []).map(normalizeSubjectName).filter(Boolean)));
      }
      if (!registry.subjectsByClass[className]?.length && ClassUtils?.buildSubjectListForClasses) {
        registry.subjectsByClass[className] = ClassUtils.buildSubjectListForClasses([className], teacherConfig?.subjects || []);
      }
      registry.subjectsByClass[className] = Array.from(new Set((registry.subjectsByClass[className] || []).map(normalizeSubjectName).filter(Boolean)));
      registry.subjectsByClass[className].forEach((subject) => pushUnique(registry.allSubjects, subject));
    });
    registry.allSubjects = Array.from(new Set(registry.allSubjects.map(normalizeSubjectName).filter(Boolean))).sort((left, right) => left.localeCompare(right));
    registry.terms = Array.from(new Set((registry.terms || []).map((term) => compactText(term)).filter(Boolean)));
    return registry;
  }

  async function buildSchoolRegistry(options) {
    const settings = options && typeof options === 'object' ? options : {};
    const context = settings.context && typeof settings.context === 'object' ? settings.context : resolveExamContext();
    const teacherConfig = settings.teacherConfig || await readTeacherConfig(context);
    const templates = Array.isArray(settings.templates) ? settings.templates : await loadExamTemplates(context);
    const registry = createRegistry();
    const termSet = new Set();
    const schoolWide = isSchoolWideRole(settings.role || context.role);

    if (schoolWide) {
      const schemeTree = (await readMergedObject([
        `schemes/${context.schoolId}/templates/${context.year}`,
        `schools/${context.schoolId}/schemes/templates/${context.year}`
      ])) || {};
      Object.entries(schemeTree || {}).forEach(([storedClass, bySubject]) => {
        Object.entries(bySubject || {}).forEach(([storedSubject, byTerm]) => {
          addClassSubject(registry, storedClass.replace(/_/g, ' '), storedSubject.replace(/_/g, ' '), 'schemes');
          Object.keys(byTerm || {}).forEach((termKey) => addTerm(termSet, termKey));
        });
      });

      const lessonPlanTree = (await readMergedObject(buildCandidatePaths(`lessonPlans/${context.year}`, context.schoolId))) || {};
      Object.entries(lessonPlanTree || {}).forEach(([storedClass, byDate]) => {
        Object.values(byDate || {}).forEach((byPlan) => {
          Object.values(byPlan || {}).forEach((plan) => {
            const className = compactText(plan?.className || plan?.class || storedClass.replace(/_/g, ' '));
            const subject = compactText(plan?.subject || plan?.subjectName || '');
            addClassSubject(registry, className, subject, 'lessonPlans');
            addTerm(termSet, plan?.term);
          });
        });
      });

      const lessonNotesTree = (await readMergedObject(buildCandidatePaths(`lessonNotes/${context.year}`, context.schoolId, [
        `lesson_notes`
      ]))) || {};
      Object.values(lessonNotesTree || {}).forEach((byWorker) => {
        Object.values(byWorker || {}).forEach((note) => {
          const noteYear = compactText(note?.year || note?.academicYear || '');
          if (noteYear && noteYear !== String(context.year)) return;
          addClassSubject(registry, note?.class || note?.className, note?.subject, 'lessonNotes');
          addTerm(termSet, note?.term);
        });
      });

      const teacherConfigs = await readTeacherConfigIndex(context);
      Object.values(teacherConfigs || {}).forEach((config) => {
        (config?.classSubjectMappings || []).forEach((mapping) => {
          addClassSubject(registry, mapping.class, null, 'teachers_config');
          (mapping.subjects || []).forEach((subject) => addClassSubject(registry, mapping.class, subject, 'teachers_config'));
        });
        (config?.classes || []).forEach((className) => addClassSubject(registry, className, null, 'teachers_config'));
      });
    } else if (teacherConfig) {
      (teacherConfig.classSubjectMappings || []).forEach((mapping) => {
        addClassSubject(registry, mapping.class, null, 'teacherConfig');
        (mapping.subjects || []).forEach((subject) => addClassSubject(registry, mapping.class, subject, 'teacherConfig'));
      });
      (teacherConfig.classes || []).forEach((className) => addClassSubject(registry, className, null, 'teacherConfig'));
    }

    templates.forEach((template) => {
      addClassSubject(registry, template.className, template.subject, 'examFormats');
      addTerm(termSet, template.term);
    });

    registry.terms = Array.from(termSet);
    return finalizeRegistry(registry, teacherConfig || {});
  }

  const api = {
    SCHOOL_WIDE_ROLES,
    isSchoolWideRole,
    resolveExamContext,
    persistExamContext,
    loadSchoolProfile,
    readTeacherConfig,
    readTeacherConfigIndex,
    loadExamTemplates,
    loadExamSettings,
    loadGeneratedExams,
    flattenGeneratedExamsTree,
    buildSchoolRegistry,
    buildCandidatePaths,
    readFirstValue,
    readMergedObject
  };

  global.SoMApExamSchoolRegistry = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
