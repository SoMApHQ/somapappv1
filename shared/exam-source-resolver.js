(function (global) {
  'use strict';

  const Shared = global.SoMApExamShared || global.SoMApExamTemplateEngine;
  const ClassUtils = global.ClassUtils || null;
  const COVERAGE_HIGH = new Set(['continuing', 'completed', 'taught', 'covered', 'done']);

  function compactText(value) {
    return Shared ? Shared.compactText(value) : String(value == null ? '' : value).replace(/\s+/g, ' ').trim();
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

  function monthKeyFromDate(value) {
    const clean = compactText(value);
    return /^\d{4}-\d{2}/.test(clean) ? clean.slice(0, 7) : '';
  }

  function normalizeClassName(value) {
    return ClassUtils?.normalizeClassName ? ClassUtils.normalizeClassName(value, { allowGraduated: true }) : compactText(value);
  }

  function normalizePlanRecord(id, plan, fallback) {
    const raw = plan && typeof plan === 'object' ? plan : {};
    const base = fallback && typeof fallback === 'object' ? fallback : {};
    const className = normalizeClassName(raw.className || raw.class || base.className || '');
    const date = compactText(raw.date || base.date || '');
    return {
      id: compactText(raw.id || id || ''),
      schoolId: compactText(raw.schoolId || base.schoolId || currentSchoolId()),
      year: String(raw.year || raw.academicYear || base.year || currentYear()),
      className,
      subject: compactText(raw.subject || base.subject || ''),
      term: compactText(raw.term || ''),
      date,
      monthKey: monthKeyFromDate(date),
      topic: compactText(raw.topic || ''),
      objectives: compactText(raw.objectives || ''),
      activities: compactText(raw.activities || ''),
      resources: compactText(raw.resources || ''),
      homework: compactText(raw.homework || ''),
      homeworkGivenMeta: raw.homeworkGivenMeta || null,
      coverageStatus: compactText(raw.coverageStatus || 'started') || 'started',
      teacherId: compactText(raw.teacherId || raw.teacher?.uid || ''),
      teacherName: compactText(raw.teacherName || raw.teacher?.name || raw.recordedBy || '')
    };
  }

  function normalizeNoteRecord(id, note) {
    const raw = note && typeof note === 'object' ? note : {};
    const className = normalizeClassName(raw.class || raw.className || '');
    const date = compactText(raw.lessonDateContext || raw.date || '');
    return {
      id: compactText(raw.id || id || ''),
      schoolId: compactText(raw.schoolId || currentSchoolId()),
      year: String(raw.year || raw.academicYear || currentYear()),
      className,
      subject: compactText(raw.subject || ''),
      term: compactText(raw.term || ''),
      date,
      monthKey: monthKeyFromDate(date),
      topic: compactText(raw.topic || ''),
      subTopic: compactText(raw.subTopic || ''),
      keyConcepts: compactText(raw.keyConcepts || ''),
      detailedContent: compactText(raw.detailedContent || ''),
      examples: compactText(raw.examples || ''),
      keyTakeaways: compactText(raw.keyTakeaways || ''),
      diagrams: compactText(raw.diagrams || ''),
      practiceQuestions: compactText(raw.practiceQuestions || ''),
      references: compactText(raw.references || ''),
      bookTitle: compactText(raw.bookTitle || ''),
      homeworkMeta: raw.homeworkMeta || null
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
      monthKey: monthKeyFromDate(raw.date || date || ''),
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
    return {
      id: compactText(id || raw.id || ''),
      schoolId: compactText(raw.schoolId || currentSchoolId()),
      year: String(raw.year || currentYear()),
      className,
      date,
      monthKey: monthKeyFromDate(date),
      linkedLessonPlanIds: Array.isArray(raw.linkedLessonPlanIds) ? raw.linkedLessonPlanIds.map(compactText).filter(Boolean) : [],
      linkedSubjects: Array.isArray(raw.linkedSubjects) ? raw.linkedSubjects.map(compactText).filter(Boolean) : [],
      topicsCovered: compactText(raw.topicsCovered || ''),
      homeworkGiven: compactText(raw.homeworkGiven || ''),
      materialsUsed: compactText(raw.materialsUsed || '')
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
    if (filters.monthKey && compactText(record.monthKey || '') && compactText(record.monthKey || '') !== compactText(filters.monthKey)) return false;
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
      const path = scopedPath(`lessonPlans/${year}/${classCandidate}`, schoolId);
      const snap = await db.ref(path).once('value').catch(() => ({ val: () => null }));
      const data = (snap && typeof snap.val === 'function' && snap.val()) || {};
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
    const snap = await db.ref(scopedPath(`lessonNotes/${year}`, schoolId)).once('value').catch(() => ({ val: () => null }));
    const data = (snap && typeof snap.val === 'function' && snap.val()) || {};
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
    const snap = await db.ref(scopedPath(`logbooks/${year}`, schoolId)).once('value').catch(() => ({ val: () => null }));
    const data = (snap && typeof snap.val === 'function' && snap.val()) || {};
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
    const snap = await db.ref('class_journals').once('value').catch(() => ({ val: () => null }));
    const data = (snap && typeof snap.val === 'function' && snap.val()) || {};
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
    const snap = await db.ref(`schemes/${schoolId}/templates/${year}`).once('value').catch(() => ({ val: () => null }));
    const data = (snap && typeof snap.val === 'function' && snap.val()) || {};
    const rows = [];
    Object.entries(data || {}).forEach(([storedClass, bySubject]) => {
      Object.entries(bySubject || {}).forEach(([storedSubject, byTerm]) => {
        Object.entries(byTerm || {}).forEach(([termKey, byId]) => {
          Object.values(byId || {}).forEach((template) => {
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

  function hasHomeworkGiven(plan) {
    return Boolean(plan?.homeworkGivenMeta?.given);
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
    if (bucket.plan) score += 35;
    if (bucket.plan && isHighCoverage(bucket.plan.coverageStatus)) score += 25;
    if (bucket.notes.length) score += 20;
    if (bucket.plan && hasHomeworkGiven(bucket.plan)) score += 10;
    if (bucket.logs.length || bucket.journals.length) score += 10;
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
    if (normalizeLookupToken(note.topic) === normalizeLookupToken(plan.topic)) return true;
    if (note.date && plan.date && note.date === plan.date) return true;
    return false;
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
    const filters = {
      schoolId: compactText(options?.schoolId || currentSchoolId()),
      year: String(options?.year || currentYear()),
      className: compactText(options?.className || ''),
      subject: compactText(options?.subject || ''),
      term: compactText(options?.term || ''),
      monthKey: compactText(options?.monthKey || '')
    };
    const minimumConfidenceScore = Number(options?.minimumConfidenceScore || 60) || 60;
    const [plans, notes, logs, journals, schemeRows] = await Promise.all([
      readLessonPlans(filters),
      readLessonNotes(filters),
      readLogbooks(filters),
      readClassJournals(filters),
      readSchemes(filters)
    ]);

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
        subTopics: []
      });
    });

    notes.forEach((note) => {
      const key = buildTopicKey(note.subject, note.topic);
      const bucket = buckets.get(key);
      if (!bucket) {
        orphanNotes.push(note);
        return;
      }
      if (!noteMatchesPlan(note, bucket.plan)) return;
      bucket.notes.push(note);
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

    const topics = Array.from(buckets.values()).map((bucket) => {
      addUniqueText(bucket.sourceTexts, conceptSourceText(bucket));
      addUniqueText(bucket.homeworkTexts, bucket.plan?.homework);
      const confidenceScore = computeTopicConfidence(bucket);
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
        sourceTopic: bucket.topic,
        sourceText: bucket.sourceTexts.filter(Boolean).join('. '),
        sourceHomework: bucket.homeworkTexts.filter(Boolean).join('\n'),
        diagrams: bucket.diagrams.filter(Boolean),
        subTopics: bucket.subTopics.filter(Boolean),
        plan: bucket.plan,
        notes: bucket.notes,
        logs: bucket.logs,
        journals: bucket.journals,
        schemeRows: bucket.schemeRows
      };
    }).filter((bucket) => bucket.plan).sort((a, b) => b.confidenceScore - a.confidenceScore || a.topic.localeCompare(b.topic));

    return {
      topics: topics.filter((topic) => topic.confidenceScore >= minimumConfidenceScore),
      allTopics: topics,
      diagnostics: {
        lessonPlanCount: plans.length,
        lessonNoteCount: notes.length,
        logbookCount: logs.length,
        classJournalCount: journals.length,
        schemeRowCount: schemeRows.length,
        orphanNotes: orphanNotes.map((note) => ({ id: note.id, topic: note.topic, date: note.date }))
      }
    };
  }

  const api = {
    resolveVerifiedTopics
  };

  global.SoMApExamSourceResolver = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
