(function (global) {
  'use strict';

  const Shared = global.SoMApExamShared || global.SoMApExamTemplateEngine;
  const ClassUtils = global.ClassUtils || null;
  const COVERAGE_HIGH = new Set(['continuing', 'completed', 'taught', 'covered', 'done']);

  function compactText(value) {
    return Shared ? Shared.compactText(value) : String(value == null ? '' : value).replace(/\s+/g, ' ').trim();
  }

  function multilineText(value) {
    return String(value == null ? '' : value)
      .replace(/\r\n?/g, '\n')
      .replace(/[\t ]+/g, ' ')
      .replace(/ *\n */g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }

  function dateFromTimestamp(value) {
    const stamp = Number(value || 0);
    if (!stamp) return '';
    const date = new Date(stamp);
    if (Number.isNaN(date.getTime())) return '';
    return [date.getFullYear(), String(date.getMonth() + 1).padStart(2, '0'), String(date.getDate()).padStart(2, '0')].join('-');
  }

  function normalizeLookupToken(value) {
    return Shared ? Shared.normalizeLookupToken(value) : compactText(value).toLowerCase();
  }

  function sanitizeKey(value) {
    return Shared ? Shared.sanitizeKey(value) : compactText(value).replace(/\s+/g, '_');
  }

  function currentSchoolId() {
    return Shared ? Shared.currentSchoolId() : (global.localStorage?.getItem('somap.currentSchoolId') || 'socrates-school');
  }

  function currentYear() {
    return Shared ? Shared.currentYear() : String(new Date().getFullYear());
  }

  function scopedPath(path, schoolId) {
    return Shared ? Shared.scopedPath(path, schoolId) : path;
  }

  function getDb() {
    return Shared ? Shared.getDb() : (global.db || global.firebase?.database?.() || null);
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

  async function readMergedObject(paths) {
    const db = getDb();
    if (!db) return {};
    let merged = {};
    let found = false;
    for (const path of paths || []) {
      const snap = await db.ref(path).once('value').catch(() => ({ val: () => null }));
      const value = (snap && typeof snap.val === 'function' && snap.val()) || null;
      if (!value || typeof value !== 'object' || Array.isArray(value) || !Object.keys(value).length) continue;
      merged = deepMerge(merged, value);
      found = true;
    }
    return found ? merged : {};
  }

  function deepMerge(baseValue, incomingValue) {
    if (!baseValue || typeof baseValue !== 'object' || Array.isArray(baseValue)) return incomingValue;
    if (!incomingValue || typeof incomingValue !== 'object' || Array.isArray(incomingValue)) return baseValue;
    const merged = { ...baseValue };
    Object.entries(incomingValue).forEach(([key, value]) => {
      if (merged[key] && typeof merged[key] === 'object' && !Array.isArray(merged[key]) && value && typeof value === 'object' && !Array.isArray(value)) {
        merged[key] = deepMerge(merged[key], value);
      } else {
        merged[key] = value;
      }
    });
    return merged;
  }

  function monthKeyFromDate(value) {
    const clean = compactText(value);
    return /^\d{4}-\d{2}/.test(clean) ? clean.slice(0, 7) : '';
  }

  function normalizeMonthKey(value, fallbackYear) {
    return Shared?.normalizeMonthKey ? Shared.normalizeMonthKey(value, fallbackYear) : monthKeyFromDate(value);
  }

  function normalizeDateKey(value) {
    const clean = compactText(value);
    if (!clean) return '';
    if (/^\d{4}-\d{2}-\d{2}$/.test(clean)) return clean;
    if (/^\d{4}-\d{2}/.test(clean)) return clean.slice(0, 7) + '-01';
    const parsed = Date.parse(clean);
    if (Number.isNaN(parsed)) return '';
    const date = new Date(parsed);
    return [
      date.getFullYear(),
      String(date.getMonth() + 1).padStart(2, '0'),
      String(date.getDate()).padStart(2, '0')
    ].join('-');
  }

  function normalizeClassName(value) {
    return ClassUtils?.normalizeClassName ? ClassUtils.normalizeClassName(value, { allowGraduated: true }) : compactText(value);
  }

  function normalizePlanRecord(id, plan, fallback) {
    const raw = plan && typeof plan === 'object' ? plan : {};
    const base = fallback && typeof fallback === 'object' ? fallback : {};
    const className = normalizeClassName(raw.className || raw.class || base.className || '');
    const date = compactText(raw.date || base.date || '');
    const year = String(raw.year || raw.academicYear || base.year || currentYear());
    return {
      id: compactText(raw.id || id || ''),
      schoolId: compactText(raw.schoolId || base.schoolId || currentSchoolId()),
      year,
      className,
      subject: compactText(raw.subject || base.subject || ''),
      term: compactText(raw.term || ''),
      date,
      monthKey: normalizeMonthKey(raw.monthKey || raw.lessonMonth || raw.month || date, year),
      topic: compactText(raw.topic || ''),
      objectives: compactText(raw.objectives || ''),
      activities: compactText(raw.activities || ''),
      resources: compactText(raw.resources || ''),
      homework: compactText(raw.homework || ''),
      homeworkGivenMeta: raw.homeworkGivenMeta || null,
      homeworkSourceMeta: raw.homeworkSourceMeta || null,
      coverageStatus: compactText(raw.coverageStatus || 'started') || 'started',
      teacherId: compactText(raw.teacherId || raw.teacher?.uid || ''),
      teacherName: compactText(raw.teacherName || raw.teacher?.name || raw.recordedBy || '')
    };
  }

  function normalizeNoteRecord(id, note) {
    const raw = note && typeof note === 'object' ? note : {};
    const className = normalizeClassName(raw.class || raw.className || '');
    const date = compactText(raw.lessonDateContext || raw.date || dateFromTimestamp(raw.createdAt || raw.updatedAt));
    const year = String(raw.year || raw.academicYear || currentYear());
    return {
      id: compactText(raw.id || id || ''),
      schoolId: compactText(raw.schoolId || currentSchoolId()),
      year,
      className,
      subject: compactText(raw.subject || ''),
      term: compactText(raw.term || ''),
      date,
      monthKey: normalizeMonthKey(raw.monthKey || raw.lessonMonth || raw.month || date, year),
      topic: compactText(raw.topic || ''),
      subTopic: compactText(raw.subTopic || ''),
      keyConcepts: compactText(raw.keyConcepts || ''),
      detailedContent: multilineText(raw.detailedContent || ''),
      examples: compactText(raw.examples || ''),
      keyTakeaways: compactText(raw.keyTakeaways || ''),
      diagrams: multilineText(raw.diagrams || ''),
      practiceQuestions: multilineText(raw.practiceQuestions || ''),
      references: compactText(raw.references || ''),
      bookTitle: compactText(raw.bookTitle || ''),
      homeworkMeta: raw.homeworkMeta || null,
      bookId: compactText(raw.bookId || ''),
      bookUrl: compactText(raw.bookUrl || ''),
      bookTopic: compactText(raw.bookTopic || ''),
      contentImageRefs: Array.isArray(raw.contentImageRefs) ? raw.contentImageRefs : []
    };
  }

  function normalizeLogbookRecord(id, log, year, className, date) {
    const raw = log && typeof log === 'object' ? log : {};
    return {
      id: compactText(raw.id || id || ''),
      schoolId: compactText(raw.schoolId || currentSchoolId()),
      year: String(raw.year || year || currentYear()),
      className: normalizeClassName(raw.className || className || ''),
      subject: compactText(raw.subject || ''),
      date: compactText(raw.date || date || ''),
      monthKey: normalizeMonthKey(raw.monthKey || raw.month || raw.date || date || '', raw.year || year || currentYear()),
      topic: compactText(raw.topicTaught || raw.topic || ''),
      lessonSummary: compactText(raw.lessonSummary || ''),
      homeworkGiven: compactText(raw.homeworkGiven || ''),
      remarks: compactText(raw.remarks || '')
    };
  }

  function normalizeJournalRecord(id, journal) {
    const raw = journal && typeof journal === 'object' ? journal : {};
    const className = normalizeClassName(raw.className || raw.class || '');
    const date = compactText(raw.date || '');
    const year = String(raw.year || currentYear());
    return {
      id: compactText(id || raw.id || ''),
      schoolId: compactText(raw.schoolId || currentSchoolId()),
      year,
      className,
      date,
      monthKey: normalizeMonthKey(raw.monthKey || raw.month || date, year),
      linkedLessonPlanIds: Array.isArray(raw.linkedLessonPlanIds) ? raw.linkedLessonPlanIds.map(compactText).filter(Boolean) : [],
      linkedSubjects: Array.isArray(raw.linkedSubjects) ? raw.linkedSubjects.map(compactText).filter(Boolean) : [],
      topicsCovered: compactText(raw.topicsCovered || ''),
      homeworkGiven: compactText(raw.homeworkGiven || ''),
      materialsUsed: compactText(raw.materialsUsed || ''),
      subject: compactText(raw.subject || raw.primarySubject || '')
    };
  }

  function normalizeSchemeRow(row, meta) {
    const raw = row && typeof row === 'object' ? row : {};
    return {
      schoolId: compactText(meta.schoolId || currentSchoolId()),
      year: String(meta.year || currentYear()),
      className: normalizeClassName(meta.className || ''),
      subject: compactText(meta.subject || ''),
      term: compactText(meta.term || ''),
      topic: compactText(raw.specificActivities || raw.specificCompetence || raw.mainCompetence || ''),
      reference: compactText(raw.reference || ''),
      month: compactText(raw.month || ''),
      monthKey: normalizeMonthKey(raw.month || '', meta.year || currentYear()),
      week: compactText(raw.week || '')
    };
  }

  function recordMatchesScope(record, filters) {
    if (!record) return false;
    if (filters.schoolId && compactText(record.schoolId || '') !== compactText(filters.schoolId)) return false;
    if (filters.year && String(record.year || '') !== String(filters.year)) return false;
    if (filters.className && normalizeLookupToken(record.className || '') !== normalizeLookupToken(filters.className)) return false;
    if (filters.subject && normalizeLookupToken(record.subject || '') !== normalizeLookupToken(filters.subject)) return false;
    if (
      filters.term
      && compactText(record.term || '')
      && !(Shared?.academicTermsMatch
        ? Shared.academicTermsMatch(record.term || '', filters.term)
        : normalizeLookupToken(record.term || '') === normalizeLookupToken(filters.term))
    ) return false;
    if (filters.monthKey) {
      if (!compactText(record.monthKey || '')) return false;
      if (compactText(record.monthKey || '') !== compactText(filters.monthKey)) return false;
    }
    if (filters.dateFrom || filters.dateTo) {
      const recordDate = normalizeDateKey(record.date || '');
      if (!recordDate) return false;
      if (filters.dateFrom && recordDate < filters.dateFrom) return false;
      if (filters.dateTo && recordDate > filters.dateTo) return false;
    }
    return true;
  }

  async function readLessonPlans(filters) {
    const db = getDb();
    if (!db) return [];
    const schoolId = compactText(filters.schoolId || currentSchoolId());
    const year = String(filters.year || currentYear());
    const classCandidates = Array.from(new Set([
      compactText(filters.className || ''),
      compactText(filters.className || '').replace(/\s+/g, '_')
    ].filter(Boolean)));
    const plans = [];
    for (const classCandidate of classCandidates) {
      const data = await readMergedObject(buildCandidatePaths(`lessonPlans/${year}/${classCandidate}`, schoolId, [
        `lessonPlans/${year}/${classCandidate.replace(/\s+/g, '_')}`
      ]));
      Object.entries(data || {}).forEach(([date, byId]) => {
        Object.entries(byId || {}).forEach(([id, plan]) => {
          const normalized = normalizePlanRecord(id, plan, { schoolId, year, className: filters.className, date });
          if (recordMatchesScope(normalized, filters)) plans.push(normalized);
        });
      });
    }
    return plans;
  }

  async function readLessonNotes(filters) {
    const db = getDb();
    if (!db) return [];
    const schoolId = compactText(filters.schoolId || currentSchoolId());
    const year = String(filters.year || currentYear());
    const data = await readMergedObject(buildCandidatePaths(`lessonNotes/${year}`, schoolId, [
      'lesson_notes'
    ]));
    const notes = [];
    Object.values(data || {}).forEach((byWorker) => {
      Object.entries(byWorker || {}).forEach(([id, note]) => {
        const normalized = normalizeNoteRecord(id, note);
        if (recordMatchesScope(normalized, filters)) notes.push(normalized);
      });
    });
    return notes;
  }

  async function readLogbooks(filters) {
    const db = getDb();
    if (!db) return [];
    const schoolId = compactText(filters.schoolId || currentSchoolId());
    const year = String(filters.year || currentYear());
    const data = await readMergedObject(buildCandidatePaths(`logbooks/${year}`, schoolId));
    const logs = [];
    Object.entries(data || {}).forEach(([className, byDate]) => {
      Object.entries(byDate || {}).forEach(([date, byId]) => {
        Object.entries(byId || {}).forEach(([id, log]) => {
          const normalized = normalizeLogbookRecord(id, log, year, className, date);
          if (recordMatchesScope(normalized, filters)) logs.push(normalized);
        });
      });
    });
    return logs;
  }

  async function readClassJournals(filters) {
    const db = getDb();
    if (!db) return [];
    const data = await readMergedObject(buildCandidatePaths('class_journals', filters.schoolId || currentSchoolId()));
    const journals = [];
    Object.values(data || {}).forEach((byWorker) => {
      Object.entries(byWorker || {}).forEach(([id, journal]) => {
        const normalized = normalizeJournalRecord(id, journal);
        if (recordMatchesScope(normalized, filters)) journals.push(normalized);
      });
    });
    return journals;
  }

  async function readSchemes(filters) {
    const db = getDb();
    if (!db) return [];
    const schoolId = compactText(filters.schoolId || currentSchoolId());
    const year = String(filters.year || currentYear());
    const data = await readMergedObject([
      `schemes/${schoolId}/templates/${year}`,
      `schools/${schoolId}/schemes/templates/${year}`
    ]);
    const rows = [];
    Object.entries(data || {}).forEach(([storedClass, bySubject]) => {
      Object.entries(bySubject || {}).forEach(([storedSubject, byTerm]) => {
        Object.entries(byTerm || {}).forEach(([termKey, byId]) => {
          const templates = Shared?.looksLikeTemplateObject?.(byId) ? [byId] : Object.values(byId || {});
          templates.forEach((template) => {
            if (!template || typeof template !== 'object') return;
            const meta = {
              schoolId,
              year,
              className: template.className || storedClass.replace(/_/g, ' '),
              subject: template.subjectName || storedSubject.replace(/_/g, ' '),
              term: termKey
            };
            Object.values(template.rows || template.parsedTemplate?.rows || {}).forEach((row) => {
              const normalized = normalizeSchemeRow(row, meta);
              if (recordMatchesScope(normalized, filters)) rows.push(normalized);
            });
          });
        });
      });
    });
    return rows;
  }

  function uniqueStrings(values) {
    return Array.from(new Set((values || []).map((value) => compactText(value)).filter(Boolean)));
  }

  function numberWord(value) {
    return ({ one: '1', two: '2', three: '3', four: '4', five: '5', six: '6', seven: '7' })[normalizeLookupToken(value)] || '';
  }

  function classAliasValues(className) {
    const clean = compactText(className);
    const normalized = normalizeLookupToken(clean);
    const digit = normalized.match(/\b([1-7])\b/)?.[1]
      || numberWord(normalized.match(/\b(one|two|three|four|five|six|seven)\b/)?.[1] || '');
    if (!digit) return uniqueStrings([clean]);
    const words = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven'];
    return uniqueStrings([clean, `Class ${digit}`, `Standard ${words[Number(digit)]}`, `Standard ${digit}`, `Std ${digit}`]);
  }

  function subjectAliasValues(subject) {
    const clean = compactText(subject);
    const token = normalizeLookupToken(clean).replace(/\band\b/g, ' ').replace(/\s+/g, ' ').trim();
    if (token === 'science' || token === 'science technology') {
      return ['Science', 'Science and Technology', 'Science Technology'];
    }
    return uniqueStrings([clean]);
  }

  function canonicalClass(value) {
    const token = normalizeLookupToken(value);
    const digit = token.match(/\b([1-7])\b/)?.[1]
      || numberWord(token.match(/\b(one|two|three|four|five|six|seven)\b/)?.[1] || '');
    return digit ? `class ${digit}` : token;
  }

  function canonicalSubject(value) {
    return normalizeLookupToken(value).replace(/\band\b/g, ' ').replace(/\s+/g, ' ').trim();
  }

  function classMatches(left, right) {
    return Boolean(canonicalClass(left) && canonicalClass(left) === canonicalClass(right));
  }

  function subjectMatches(left, right) {
    const a = canonicalSubject(left);
    const b = canonicalSubject(right);
    if (!a || !b) return false;
    if (a === b) return true;
    return (a === 'science' && b === 'science technology') || (b === 'science' && a === 'science technology');
  }

  function isActiveBook(book) {
    const status = normalizeLookupToken(book?.status || 'active');
    return status !== 'archived' && status !== 'deleted' && status !== 'hidden';
  }

  function textFromValue(value) {
    if (typeof value === 'string') return multilineText(value);
    if (Array.isArray(value)) return multilineText(value.map(textFromValue).filter(Boolean).join('\n'));
    if (!value || typeof value !== 'object') return '';
    return multilineText(Object.values(value).map(textFromValue).filter(Boolean).join('\n'));
  }

  function extractBookText(record) {
    const fields = ['text', 'parsedText', 'content', 'fullText', 'assessment', 'assessments', 'questions', 'extractedText'];
    const seen = new Set();
    const sections = [];
    fields.forEach((field) => {
      const text = textFromValue(record?.[field]);
      if (!text || seen.has(text)) return;
      seen.add(text);
      sections.push(text);
    });
    return multilineText(sections.join('\n\n'));
  }

  function countMultipleChoiceItems(text) {
    const source = String(text || '').replace(/\r\n?/g, '\n');
    if (!source) return 0;
    const blocks = source.split(/(?=^\s*Q?\d+[.)]\s+|^\s*(?:Multiple Choice|Matching|True or False|Passage Question|Word Problem|Reflection)\s*:)/gmi).map((block) => block.trim()).filter(Boolean);
    return blocks.filter((block) => {
      const optionMatches = [...block.matchAll(/(?:^|\n|\s)([A-E])[.)]\s*([\s\S]*?)(?=(?:\n|\s)[A-E][.)]\s|$)/gi)];
      return optionMatches.length >= 3 && /\?/.test(block.slice(0, 500));
    }).length;
  }

  async function readPath(path, checkedPaths) {
    if (checkedPaths) checkedPaths.push(path);
    const db = getDb();
    if (!db) return null;
    const snap = await db.ref(path).once('value').catch(() => ({ val: () => null }));
    return (snap && typeof snap.val === 'function') ? snap.val() : null;
  }

  async function readActiveBook(filters) {
    const db = getDb();
    const diagnostics = {
      activeBookId: '', activeBookTitle: '', activeBookPathFound: '', activeBookTextLength: 0,
      activeBookSubjectStored: '', activeBookClassStored: '', activeBookCandidatePathsChecked: [],
      bookAssessmentItemCount: 0, rejectedReason: ''
    };
    if (!db) {
      diagnostics.rejectedReason = 'Firebase database is unavailable.';
      return { book: null, diagnostics };
    }

    const schoolId = compactText(filters.schoolId || currentSchoolId());
    const year = String(filters.year || currentYear());
    const classAliases = classAliasValues(filters.className || '');
    const subjectAliases = subjectAliasValues(filters.subject || '');
    const indexPaths = [];
    const classBookPaths = [];
    classAliases.forEach((classAlias) => {
      const classKeys = uniqueStrings([
        sanitizeKey(classAlias).toLowerCase(),
        String(classAlias).replace(/[.#$/\[\]]/g, '_').toLowerCase(),
        String(classAlias).replace(/\s+/g, '_').toLowerCase()
      ]);
      subjectAliases.forEach((subjectAlias) => {
        const subjectKeys = uniqueStrings([
          sanitizeKey(subjectAlias).toLowerCase(),
          String(subjectAlias).replace(/[.#$/\[\]]/g, '_').toLowerCase(),
          String(subjectAlias).replace(/\s+/g, '_').toLowerCase()
        ]);
        classKeys.forEach((classKey) => subjectKeys.forEach((subjectKey) => {
          indexPaths.push(...buildCandidatePaths(`classbooksIndex/${year}/${classKey}/${subjectKey}`, schoolId));
        }));
      });
      uniqueStrings([encodeURIComponent(classAlias), classAlias, String(classAlias).replace(/\s+/g, '_')]).forEach((classKey) => {
        classBookPaths.push(...buildCandidatePaths(`class_books/${year}/${classKey}`, schoolId));
        classBookPaths.push(...buildCandidatePaths(`class_books/${classKey}`, schoolId));
      });
    });

    const candidateMap = new Map();
    const uniqueIndexPaths = uniqueStrings(indexPaths);
    const indexResults = await Promise.all(uniqueIndexPaths.map(async (path) => ({ path, value: await readPath(path, diagnostics.activeBookCandidatePathsChecked) })));
    indexResults.forEach(({ path, value }) => {
      if (!value || typeof value !== 'object') return;
      const directId = compactText(value.bookId || value.id || value.key || '');
      if (directId) candidateMap.set(directId, { id: directId, index: value, indexPath: path });
      else Object.entries(value).forEach(([id, entry]) => {
        if (!entry || typeof entry !== 'object') return;
        candidateMap.set(id, { id, index: entry, indexPath: `${path}/${id}` });
      });
    });

    if (!candidateMap.size) {
      const uniqueClassBookPaths = uniqueStrings(classBookPaths);
      const classBookResults = await Promise.all(uniqueClassBookPaths.map(async (path) => ({ path, value: await readPath(path, diagnostics.activeBookCandidatePathsChecked) })));
      classBookResults.forEach(({ path, value }) => Object.entries(value || {}).forEach(([id, entry]) => {
        if (entry && typeof entry === 'object') candidateMap.set(id, { id, index: entry, indexPath: `${path}/${id}` });
      }));
    }

    if (!candidateMap.size) {
      const bookRoots = uniqueStrings(buildCandidatePaths('books', schoolId));
      const roots = await Promise.all(bookRoots.map(async (path) => ({ path, value: await readPath(path, diagnostics.activeBookCandidatePathsChecked) })));
      roots.forEach(({ path, value }) => Object.entries(value || {}).forEach(([id, entry]) => {
        if (entry && typeof entry === 'object') candidateMap.set(id, { id, index: entry, indexPath: `${path}/${id}` });
      }));
    }

    const eligibleCandidates = () => Array.from(candidateMap.values()).filter((candidate) => {
      const record = candidate.index || {};
      const storedClass = record.class || record.className || '';
      const storedSubject = record.subject || record.subjectName || '';
      const storedYear = String(record.year || record.academicYear || '');
      return isActiveBook(record)
        && (!storedClass || classAliases.some((alias) => classMatches(storedClass, alias)))
        && (!storedSubject || subjectAliases.some((alias) => subjectMatches(storedSubject, alias)))
        && (!storedYear || storedYear === year);
    }).sort((left, right) => {
      const wordDelta = Number(Boolean(right.index?.word_text_available)) - Number(Boolean(left.index?.word_text_available));
      if (wordDelta) return wordDelta;
      return Number(right.index?.updatedAt || right.index?.uploadedAt || 0) - Number(left.index?.updatedAt || left.index?.uploadedAt || 0);
    });
    let candidates = eligibleCandidates();

    // A stale classbooksIndex may still point at an archived book after a
    // replacement. In that case search the authoritative books metadata for
    // the active class/subject/year record instead of stopping at the stale hit.
    if (!candidates.length) {
      const bookRoots = uniqueStrings(buildCandidatePaths('books', schoolId));
      const roots = await Promise.all(bookRoots.map(async (path) => ({ path, value: await readPath(path, diagnostics.activeBookCandidatePathsChecked) })));
      roots.forEach(({ path, value }) => Object.entries(value || {}).forEach(([id, entry]) => {
        if (entry && typeof entry === 'object') candidateMap.set(id, { id, index: entry, indexPath: `${path}/${id}` });
      }));
      candidates = eligibleCandidates();
    }

    for (const candidate of candidates) {
      const metadataPaths = uniqueStrings(buildCandidatePaths(`books/${candidate.id}`, schoolId));
      const metadataResults = await Promise.all(metadataPaths.map(async (path) => ({ path, value: await readPath(path, diagnostics.activeBookCandidatePathsChecked) })));
      const metadataHit = metadataResults.find((entry) => entry.value && typeof entry.value === 'object');
      const metadata = { ...(candidate.index || {}), ...((metadataHit && metadataHit.value) || {}) };
      if (!isActiveBook(metadata)) continue;
      const storedClass = metadata.class || metadata.className || candidate.index?.class || '';
      const storedSubject = metadata.subject || metadata.subjectName || candidate.index?.subject || '';
      const storedYear = String(metadata.year || metadata.academicYear || candidate.index?.year || '');
      if (storedClass && !classAliases.some((alias) => classMatches(storedClass, alias))) continue;
      if (storedSubject && !subjectAliases.some((alias) => subjectMatches(storedSubject, alias))) continue;
      if (storedYear && storedYear !== year) continue;

      const textPaths = uniqueStrings(buildCandidatePaths(`book_texts/${candidate.id}`, schoolId));
      const textResults = await Promise.all(textPaths.map(async (path) => ({ path, value: await readPath(path, diagnostics.activeBookCandidatePathsChecked) })));
      const textCandidates = [
        ...textResults.map((entry) => ({ path: entry.path, text: extractBookText(entry.value) })),
        { path: `${metadataHit?.path || candidate.indexPath}#metadata`, text: extractBookText(metadata) },
        { path: `${candidate.indexPath}#index`, text: extractBookText(candidate.index) }
      ].filter((entry) => entry.text).sort((a, b) => b.text.length - a.text.length);
      if (!textCandidates.length) continue;

      const selectedText = textCandidates[0];
      const book = {
        id: candidate.id,
        title: compactText(metadata.title || candidate.index?.title || 'Classbook'),
        text: selectedText.text,
        subject: compactText(storedSubject),
        className: compactText(storedClass),
        pathFound: `${candidate.indexPath} -> ${metadataHit?.path || 'index metadata'} -> ${selectedText.path}`
      };
      Object.assign(diagnostics, {
        activeBookId: book.id,
        activeBookTitle: book.title,
        activeBookPathFound: book.pathFound,
        activeBookTextLength: book.text.length,
        activeBookSubjectStored: book.subject,
        activeBookClassStored: book.className,
        activeBookCandidatePathsChecked: uniqueStrings(diagnostics.activeBookCandidatePathsChecked),
        bookAssessmentItemCount: countMultipleChoiceItems(book.text),
        rejectedReason: ''
      });
      return { book, diagnostics };
    }

    diagnostics.activeBookCandidatePathsChecked = uniqueStrings(diagnostics.activeBookCandidatePathsChecked);
    diagnostics.rejectedReason = candidateMap.size
      ? `Found ${candidateMap.size} book candidate(s), but none had active matching metadata with non-empty stored text.`
      : 'No matching active-book index or book metadata was found.';
    return { book: null, diagnostics };
  }

  function bookEvidenceForTopic(book, topic) {
    if (!book?.text || !topic) return null;
    const position = book.text.toLowerCase().indexOf(compactText(topic).toLowerCase());
    if (position < 0) return null;
    const excerpt = compactText(book.text.slice(position, position + 10000));
    const assessmentStart = excerpt.search(/\b(homework|exercise|activity|cat|continuous assessment|past paper|revision questions?)\b/i);
    return {
      bookId: book.id,
      bookTitle: book.title,
      position,
      excerpt,
      assessment: assessmentStart >= 0 ? excerpt.slice(assessmentStart, assessmentStart + 5000) : ''
    };
  }

  function schemeRowIsDue(row, monthKey, cutoffDate) {
    if (!monthKey || !row.monthKey) return true;
    if (row.monthKey < monthKey) return true;
    if (row.monthKey > monthKey) return false;
    const currentWeek = Math.max(1, Math.ceil(Number(String(cutoffDate || '').slice(8, 10) || 1) / 7));
    const rowWeek = Number(String(row.week || '').match(/\d+/)?.[0] || 0);
    return !rowWeek || rowWeek <= currentWeek;
  }

  function positionFromSchemeReference(book, reference) {
    if (!book?.text || !reference) return -1;
    const cleaned = compactText(reference)
      .replace(/\b(?:chapter|topic|unit)\s+(?:[ivxlcdm]+|\d+|one|two|three|four|five|six|seven|eight|nine|ten)\b\s*[:.-]?/ig, '')
      .replace(/\b(?:pp?|pages?|§)\.?\s*[\d–—-]+.*$/i, '')
      .trim();
    if (cleaned.length < 4) return -1;
    return book.text.toLowerCase().indexOf(cleaned.toLowerCase());
  }

  function hasHomeworkGiven(plan) {
    return Boolean(plan?.homeworkGivenMeta?.given);
  }

  function hasHomeworkSource(plan) {
    return Boolean(plan?.homeworkSourceMeta?.noteId || plan?.homeworkSourceMeta?.topic);
  }

  function isHighCoverage(status) {
    const normalized = normalizeLookupToken(status || '');
    if (!normalized) return false;
    return Array.from(COVERAGE_HIGH).some((entry) => normalized.includes(entry));
  }

  function buildTopicKey(subject, topic) {
    return `${normalizeLookupToken(subject)}__${normalizeLookupToken(topic)}`;
  }

  function conceptSourceText(topicBucket) {
    return [
      topicBucket.plan?.objectives,
      topicBucket.plan?.activities,
      ...topicBucket.notes.map((note) => [note.keyConcepts, note.detailedContent, note.examples, note.keyTakeaways].filter(Boolean).join('. ')),
      ...topicBucket.logs.map((log) => [log.lessonSummary, log.homeworkGiven, log.remarks].filter(Boolean).join('. '))
    ].filter(Boolean).join('. ');
  }

  function addUniqueText(target, value) {
    const clean = compactText(value);
    if (!clean) return;
    if (!target.includes(clean)) target.push(clean);
  }

  function computeTopicConfidence(bucket) {
    let score = 0;
    if (bucket.plan) score += 30;
    if (bucket.plan && isHighCoverage(bucket.plan.coverageStatus)) score += 20;
    // A saved lesson note is direct taught-content evidence and is the preferred
    // source for wording exam questions.
    if (bucket.notes.length) score += 60;
    if (bucket.preferredNoteId) score += 10;
    if (bucket.plan && hasHomeworkSource(bucket.plan)) score += 10;
    if (bucket.plan && hasHomeworkGiven(bucket.plan)) score += 10;
    if (bucket.logs.length) score += 5;
    if (bucket.journals.length) score += 5;
    if (bucket.schemeRows.length) score += 5;
    return score;
  }

  function journalMatchesPlan(journal, plan) {
    if (!journal || !plan) return false;
    if (journal.linkedLessonPlanIds.includes(plan.id)) return true;
    if (journal.linkedSubjects.some((subject) => normalizeLookupToken(subject) === normalizeLookupToken(plan.subject))) return true;
    return normalizeLookupToken(journal.topicsCovered).includes(normalizeLookupToken(plan.topic));
  }

  function noteMatchesPlan(note, plan) {
    if (!note || !plan) return false;
    if (compactText(plan.homeworkSourceMeta?.noteId || '') && compactText(plan.homeworkSourceMeta?.noteId || '') === compactText(note.id || '')) {
      return true;
    }
    const noteTopic = normalizeLookupToken(note.topic || '');
    const planTopic = normalizeLookupToken(plan.topic || '');
    const homeworkTopic = normalizeLookupToken(plan.homeworkGivenMeta?.sourceTopic || plan.homeworkSourceMeta?.topic || '');
    const noteHomeworkTopic = normalizeLookupToken(note.homeworkMeta?.topicName || '');
    if (homeworkTopic && noteTopic && (homeworkTopic === noteTopic || homeworkTopic.includes(noteTopic) || noteTopic.includes(homeworkTopic))) {
      return true;
    }
    if (homeworkTopic && noteHomeworkTopic && (homeworkTopic === noteHomeworkTopic || homeworkTopic.includes(noteHomeworkTopic) || noteHomeworkTopic.includes(homeworkTopic))) {
      return true;
    }
    if (noteTopic && planTopic && noteTopic === planTopic) return true;
    if (noteTopic && planTopic && (noteTopic.includes(planTopic) || planTopic.includes(noteTopic))) return true;
    if (note.date && plan.date && note.date === plan.date) return true;
    return false;
  }

  function noteStrengthForPlan(note, plan) {
    if (!note || !plan) return 0;
    const noteId = compactText(note.id || '');
    const noteTopic = normalizeLookupToken(note.topic || '');
    const planTopic = normalizeLookupToken(plan.topic || '');
    const homeworkTopic = normalizeLookupToken(plan.homeworkGivenMeta?.sourceTopic || plan.homeworkSourceMeta?.topic || '');
    let score = 0;
    if (noteId && noteId === compactText(plan.homeworkSourceMeta?.noteId || '')) score += 10;
    if (noteTopic && planTopic && noteTopic === planTopic) score += 6;
    if (noteTopic && planTopic && (noteTopic.includes(planTopic) || planTopic.includes(noteTopic))) score += 3;
    if (homeworkTopic && noteTopic && (homeworkTopic === noteTopic || homeworkTopic.includes(noteTopic) || noteTopic.includes(homeworkTopic))) score += 5;
    if (note.practiceQuestions) score += 2;
    if (note.date && plan.date && note.date === plan.date) score += 2;
    return score;
  }

  function logMatchesPlan(log, plan) {
    if (!log || !plan) return false;
    if (normalizeLookupToken(log.subject) !== normalizeLookupToken(plan.subject)) return false;
    if (log.date && plan.date && log.date !== plan.date) return false;
    return normalizeLookupToken(log.topic).includes(normalizeLookupToken(plan.topic))
      || normalizeLookupToken(plan.topic).includes(normalizeLookupToken(log.topic));
  }

  function schemeMatchesPlan(row, plan) {
    if (!row || !plan) return false;
    return normalizeLookupToken(row.topic).includes(normalizeLookupToken(plan.topic))
      || normalizeLookupToken(plan.topic).includes(normalizeLookupToken(row.topic));
  }

  async function resolveVerifiedTopics(options) {
    const requestedMonth = compactText(options?.monthKey || '');
    // An exam assesses everything taught up to its date, not only lessons saved
    // inside the exam month.  Using an exact month here made (for example) June
    // notes disappear from a July paper.
    const today = new Date();
    const todayKey = [today.getFullYear(), String(today.getMonth() + 1).padStart(2, '0'), String(today.getDate()).padStart(2, '0')].join('-');
    const currentMonth = todayKey.slice(0, 7);
    const requestedCutoff = requestedMonth === currentMonth ? todayKey : (requestedMonth ? `${requestedMonth}-31` : '');
    const configuredCutoff = normalizeDateKey(options?.dateTo || requestedCutoff);
    const cutoffDate = configuredCutoff && configuredCutoff > todayKey ? todayKey : configuredCutoff;
    const filters = {
      schoolId: compactText(options?.schoolId || currentSchoolId()),
      year: String(options?.year || currentYear()),
      className: compactText(options?.className || ''),
      subject: compactText(options?.subject || ''),
      // Monthly and terminal papers may deliberately cover an earlier term.
      term: '',
      monthKey: '',
      dateFrom: normalizeDateKey(options?.dateFrom || `${String(options?.year || currentYear())}-01-01`),
      dateTo: cutoffDate
    };
    const minimumConfidenceScore = Number(options?.minimumConfidenceScore || 60) || 60;
    const [plans, notes, logs, journals, schemeRows, activeBookResult] = await Promise.all([
      readLessonPlans(filters),
      readLessonNotes(filters),
      readLogbooks(filters),
      readClassJournals(filters),
      // Scheme rows often have month/week fields rather than a parseable date.
      // Read the whole year's scheme, then use it as supporting evidence.
      readSchemes({ ...filters, dateFrom: '', dateTo: '' }),
      readActiveBook(filters)
    ]);
    const activeBook = activeBookResult?.book || null;
    const activeBookDiagnostics = activeBookResult?.diagnostics || {};

    const buckets = new Map();
    const orphanNotes = [];

    plans.forEach((plan) => {
      const key = buildTopicKey(plan.subject, plan.topic);
      if (!key) return;
      buckets.set(key, {
        key,
        topic: plan.topic,
        subject: plan.subject,
        className: plan.className,
        term: plan.term,
        year: plan.year,
        schoolId: plan.schoolId,
        plan,
        notes: [],
        logs: [],
        journals: [],
        schemeRows: [],
        sourceTexts: [],
        diagrams: [],
        homeworkTexts: [],
        subTopics: [],
        preferredNoteId: ''
      });
    });

    notes.forEach((note) => {
      const key = buildTopicKey(note.subject, note.topic);
      let bucket = buckets.get(key);
      if (!bucket) {
        orphanNotes.push(note);
        // Lesson notes are first-class teaching evidence.  Previously they were
        // discarded unless a same-month lesson plan with the same title existed.
        bucket = {
          key,
          topic: note.topic,
          subject: note.subject,
          className: note.className,
          term: note.term,
          year: note.year,
          schoolId: note.schoolId,
          plan: null,
          notes: [], logs: [], journals: [], schemeRows: [],
          sourceTexts: [], diagrams: [], homeworkTexts: [], subTopics: [],
          preferredNoteId: ''
        };
        buckets.set(key, bucket);
      }
      if (bucket.plan && !noteMatchesPlan(note, bucket.plan)) return;
      bucket.notes.push(note);
      if (!bucket.preferredNoteId && (!bucket.plan || noteStrengthForPlan(note, bucket.plan) >= 10)) {
        bucket.preferredNoteId = compactText(note.id || '');
      }
      addUniqueText(bucket.sourceTexts, [note.keyConcepts, note.detailedContent, note.examples, note.keyTakeaways].filter(Boolean).join('. '));
      addUniqueText(bucket.homeworkTexts, note.practiceQuestions);
      addUniqueText(bucket.diagrams, note.diagrams);
      addUniqueText(bucket.subTopics, note.subTopic);
    });

    logs.forEach((log) => {
      buckets.forEach((bucket) => {
        if (!logMatchesPlan(log, bucket.plan)) return;
        bucket.logs.push(log);
        addUniqueText(bucket.sourceTexts, [log.lessonSummary, log.homeworkGiven].filter(Boolean).join('. '));
        addUniqueText(bucket.homeworkTexts, log.homeworkGiven);
      });
    });

    journals.forEach((journal) => {
      buckets.forEach((bucket) => {
        if (!journalMatchesPlan(journal, bucket.plan)) return;
        bucket.journals.push(journal);
      });
    });

    schemeRows.forEach((row) => {
      buckets.forEach((bucket) => {
        if (!schemeMatchesPlan(row, bucket.plan)) return;
        bucket.schemeRows.push(row);
      });
    });

    const dueSchemeRows = schemeRows.filter((row) => schemeRowIsDue(row, requestedMonth, cutoffDate));
    const schemeCutoffPositions = dueSchemeRows.map((row) => positionFromSchemeReference(activeBook, row.reference)).filter((position) => position >= 0);
    const bookCutoffPosition = schemeCutoffPositions.length ? Math.max(...schemeCutoffPositions) : -1;
    let coveredBookText = activeBook?.text || '';
    if (coveredBookText && bookCutoffPosition >= 0) {
      const tail = coveredBookText.slice(bookCutoffPosition + 20);
      const nextChapter = tail.search(/\n\s*(?:chapter|topic|unit)\s+(?:[ivxlcdm]+|\d+|one|two|three|four|five|six|seven|eight|nine|ten)\b/i);
      const coverageEnd = nextChapter >= 0 ? bookCutoffPosition + 20 + nextChapter : coveredBookText.length;
      coveredBookText = coveredBookText.slice(0, coverageEnd);
    }
    const topics = Array.from(buckets.values()).map((bucket) => {
      bucket.notes.sort((left, right) => noteStrengthForPlan(right, bucket.plan) - noteStrengthForPlan(left, bucket.plan));
      if (!bucket.preferredNoteId && bucket.notes[0]?.id) bucket.preferredNoteId = compactText(bucket.notes[0].id);
      addUniqueText(bucket.sourceTexts, conceptSourceText(bucket));
      addUniqueText(bucket.homeworkTexts, bucket.plan?.homework);
      const confidenceScore = computeTopicConfidence(bucket);
      const bookEvidence = bookEvidenceForTopic(activeBook, bucket.topic);
      return {
        key: bucket.key,
        topic: bucket.topic,
        className: bucket.className,
        subject: bucket.subject,
        term: bucket.term,
        year: bucket.year,
        schoolId: bucket.schoolId,
        confidenceScore,
        dates: Array.from(new Set([
          compactText(bucket.plan?.date || ''),
          ...bucket.notes.map((note) => compactText(note.date || '')),
          ...bucket.logs.map((log) => compactText(log.date || '')),
          ...bucket.journals.map((journal) => compactText(journal.date || ''))
        ].filter(Boolean))),
        sourceRefs: {
          lessonPlanId: bucket.plan?.id || '',
          lessonNoteIds: bucket.notes.map((note) => note.id),
          logbookIds: bucket.logs.map((log) => log.id),
          classJournalIds: bucket.journals.map((journal) => journal.id)
        },
        preferredNoteId: bucket.preferredNoteId,
        sourceTopic: bucket.topic,
        sourceText: bucket.sourceTexts.filter(Boolean).join('. '),
        sourceHomework: bucket.homeworkTexts.filter(Boolean).join('\n'),
        diagrams: bucket.diagrams.filter(Boolean),
        subTopics: bucket.subTopics.filter(Boolean),
        homeworkGiven: hasHomeworkGiven(bucket.plan),
        homeworkSourceMeta: bucket.plan?.homeworkSourceMeta || null,
        homeworkGivenMeta: bucket.plan?.homeworkGivenMeta || null,
        plan: bucket.plan,
        notes: bucket.notes,
        logs: bucket.logs,
        journals: bucket.journals,
        schemeRows: bucket.schemeRows,
        bookEvidence
      };
    }).filter((bucket) => bucket.plan || bucket.notes.length)
      .filter((bucket) => bookCutoffPosition < 0 || bucket.bookEvidence?.position == null || bucket.bookEvidence.position <= bookCutoffPosition)
      .sort((a, b) => b.confidenceScore - a.confidenceScore || a.topic.localeCompare(b.topic));

    return {
      topics: topics.filter((topic) => topic.confidenceScore >= minimumConfidenceScore),
      allTopics: topics,
      bookAssessmentSource: activeBook ? {
        id: activeBook.id,
        title: activeBook.title,
        text: coveredBookText
      } : null,
      diagnostics: {
        ...activeBookDiagnostics,
        lessonPlanCount: plans.length,
        lessonNoteCount: notes.length,
        logbookCount: logs.length,
        classJournalCount: journals.length,
        schemeRowCount: schemeRows.length,
        activeBookId: activeBookDiagnostics.activeBookId || activeBook?.id || '',
        activeBookTitle: activeBookDiagnostics.activeBookTitle || activeBook?.title || '',
        bookCutoffPosition,
        coverageFrom: filters.dateFrom,
        coverageTo: filters.dateTo,
        orphanNotes: orphanNotes.map((note) => ({ id: note.id, topic: note.topic, date: note.date }))
      }
    };
  }

  const api = {
    resolveVerifiedTopics,
    readActiveBook,
    countMultipleChoiceItems
  };

  global.SoMApExamSourceResolver = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
