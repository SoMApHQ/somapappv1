(function (global) {
  'use strict';

  const INLINE_FILE_LIMIT = 2.5 * 1024 * 1024;
  const DEFAULT_SECTION_TITLE = 'Section';
  const QUESTION_TYPES = [
    'multiple_choice',
    'true_false',
    'matching',
    'short_answer',
    'passage',
    'word_problem',
    'diagram',
    'fill_blank',
    'composition',
    'practical_or_activity'
  ];

  function compactText(value) {
    return String(value == null ? '' : value).replace(/\s+/g, ' ').trim();
  }

  function normalizeLookupToken(value) {
    return compactText(value).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  }

  function sanitizeKey(value) {
    return compactText(value).replace(/[.#$/\[\]]/g, '_').replace(/\s+/g, '_');
  }

  function lower(value) {
    return compactText(value).toLowerCase();
  }

  function nowTs() {
    return Date.now();
  }

  function escHtml(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function currentSchoolId() {
    const school = typeof global.SOMAP !== 'undefined' && typeof global.SOMAP.getSchool === 'function'
      ? global.SOMAP.getSchool()
      : null;
    return compactText(
      school?.id ||
      global.currentSchoolId ||
      global.localStorage?.getItem('somap.currentSchoolId') ||
      global.localStorage?.getItem('currentSchoolId') ||
      global.localStorage?.getItem('schoolId') ||
      'socrates-school'
    );
  }

  function currentYear() {
    if (typeof global.somapYearContext?.getSelectedYear === 'function') {
      return String(global.somapYearContext.getSelectedYear());
    }
    return String(new Date().getFullYear());
  }

  function scopedPath(relativePath, schoolId) {
    const activeSchoolId = compactText(schoolId || currentSchoolId()) || 'socrates-school';
    if (typeof global.SOMAP !== 'undefined' && typeof global.SOMAP.P === 'function') {
      return global.SOMAP.P(relativePath);
    }
    const normalizedSchool = lower(activeSchoolId);
    if (normalizedSchool && !['socrates-school', 'default', 'socrates'].includes(normalizedSchool)) {
      return `schools/${activeSchoolId}/${relativePath}`;
    }
    return relativePath;
  }

  function getDb() {
    return global.db || global.firebase?.database?.() || null;
  }

  function createId(prefix) {
    return `${prefix}_${Math.random().toString(36).slice(2, 10)}_${Date.now().toString(36)}`;
  }

  function uniqueBy(items, resolver) {
    const seen = new Set();
    const output = [];
    (items || []).forEach((item) => {
      const key = resolver(item);
      if (!key || seen.has(key)) return;
      seen.add(key);
      output.push(item);
    });
    return output;
  }

  function questionTypeLabel(type) {
    const clean = compactText(type || '').replace(/_/g, ' ');
    if (!clean) return 'Short answer';
    return clean.charAt(0).toUpperCase() + clean.slice(1);
  }

  function normalizeQuestionType(type) {
    const clean = compactText(type || '').toLowerCase().replace(/[\s-]+/g, '_');
    if (!QUESTION_TYPES.includes(clean)) return 'short_answer';
    return clean;
  }

  function coerceBoolean(value, fallback) {
    if (typeof value === 'boolean') return value;
    const clean = lower(value);
    if (['true', 'yes', '1', 'on'].includes(clean)) return true;
    if (['false', 'no', '0', 'off'].includes(clean)) return false;
    return Boolean(fallback);
  }

  function safeNumber(value, fallback) {
    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric : Number(fallback || 0);
  }

  function normalizeSchedule(rawSchedule, fallbackMode) {
    const schedule = rawSchedule && typeof rawSchedule === 'object' ? rawSchedule : {};
    const mode = lower(schedule.mode || fallbackMode || 'day_of_month');
    const normalized = {
      mode: mode === 'exact_date' ? 'exact_date' : 'day_of_month',
      dayOfMonth: Math.min(31, Math.max(1, safeNumber(schedule.dayOfMonth, 27) || 27)),
      exactDate: compactText(schedule.exactDate || ''),
      generateOnOpenAfterDate: coerceBoolean(schedule.generateOnOpenAfterDate, true)
    };
    if (normalized.mode === 'exact_date' && !normalized.exactDate) normalized.mode = 'day_of_month';
    return normalized;
  }

  function normalizeRow(rawRow, index) {
    const row = rawRow && typeof rawRow === 'object' ? rawRow : {};
    const rangeStart = safeNumber(row.rangeStart, 0);
    const rangeEnd = safeNumber(row.rangeEnd, 0);
    const countFromRange = rangeStart > 0 && rangeEnd >= rangeStart ? (rangeEnd - rangeStart + 1) : 0;
    const itemCount = Math.max(1, safeNumber(row.itemCount, countFromRange || 1));
    const marksPerQuestion = safeNumber(row.marksPerQuestion, 0);
    const totalMarks = safeNumber(row.totalMarks, 0) || (marksPerQuestion > 0 ? marksPerQuestion * itemCount : itemCount);
    const sectionTitle = compactText(row.sectionTitle || row.title || `${DEFAULT_SECTION_TITLE} ${index + 1}`);
    return {
      sectionKey: compactText(row.sectionKey || sanitizeKey(sectionTitle || `section_${index + 1}`)),
      sectionTitle,
      rangeStart: rangeStart > 0 ? rangeStart : '',
      rangeEnd: rangeEnd > 0 ? rangeEnd : '',
      itemCount,
      questionType: normalizeQuestionType(row.questionType),
      marksPerQuestion: marksPerQuestion > 0 ? marksPerQuestion : '',
      totalMarks,
      difficulty: compactText(row.difficulty || 'mixed') || 'mixed',
      includeDiagrams: coerceBoolean(row.includeDiagrams, false),
      sourcePreference: compactText(row.sourcePreference || 'balanced') || 'balanced',
      notes: compactText(row.notes || row.instructions || ''),
      instructions: compactText(row.instructions || row.notes || '')
    };
  }

  function normalizeTemplate(rawTemplate) {
    const raw = rawTemplate && typeof rawTemplate === 'object' ? rawTemplate : {};
    const schoolId = compactText(raw.schoolId || currentSchoolId());
    const year = String(raw.year || raw.academicYear || currentYear());
    const className = compactText(raw.className || raw.class || '');
    const subject = compactText(raw.subject || raw.subjectName || '');
    const rows = (Array.isArray(raw.rows) ? raw.rows : Object.values(raw.rows || {})).map(normalizeRow).filter(Boolean);
    const settings = raw.settings && typeof raw.settings === 'object' ? raw.settings : {};
    return {
      id: compactText(raw.id || raw.formatId || createId('exam_format')),
      formatId: compactText(raw.formatId || raw.id || createId('exam_format')),
      schoolId,
      year,
      className,
      classKey: compactText(raw.classKey || sanitizeKey(className)),
      subject,
      subjectKey: compactText(raw.subjectKey || sanitizeKey(subject)),
      term: compactText(raw.term || 'Term 1'),
      title: compactText(raw.title || `${subject || 'Subject'} Monthly Exam`),
      instructions: compactText(raw.instructions || 'Answer all questions.'),
      builderMode: compactText(raw.builderMode || raw.mode || 'builder') || 'builder',
      rows,
      uploadedReference: raw.uploadedReference || null,
      uploadedReferenceId: compactText(raw.uploadedReferenceId || raw.uploadId || ''),
      settings: {
        schedule: normalizeSchedule(settings.schedule || raw.schedule, 'day_of_month'),
        useFamiliarNames: coerceBoolean(settings.useFamiliarNames, true),
        allowDiagramQuestions: coerceBoolean(settings.allowDiagramQuestions, true),
        requireHomeworkGivenForComplexSections: coerceBoolean(settings.requireHomeworkGivenForComplexSections, false),
        includeOnlyTopicsAboveThreshold: coerceBoolean(settings.includeOnlyTopicsAboveThreshold, true),
        minimumConfidenceScore: Math.max(0, safeNumber(settings.minimumConfidenceScore, 60) || 60)
      },
      createdAt: safeNumber(raw.createdAt, nowTs()),
      updatedAt: safeNumber(raw.updatedAt, nowTs()),
      createdBy: raw.createdBy || null,
      updatedBy: raw.updatedBy || null,
      version: safeNumber(raw.version, 1) || 1,
      status: compactText(raw.status || 'active') || 'active'
    };
  }

  function resolveRowItemCount(row) {
    return normalizeRow(row || {}, 0).itemCount;
  }

  function resolveRowMarks(row) {
    return normalizeRow(row || {}, 0).totalMarks;
  }

  function summarizeTemplate(templateLike) {
    const template = normalizeTemplate(templateLike);
    const sections = template.rows;
    return {
      totalQuestions: sections.reduce((sum, row) => sum + resolveRowItemCount(row), 0),
      totalMarks: sections.reduce((sum, row) => sum + resolveRowMarks(row), 0),
      sectionCount: sections.length,
      sections: sections.map((row) => ({
        sectionKey: row.sectionKey,
        sectionTitle: row.sectionTitle,
        questionType: row.questionType,
        itemCount: resolveRowItemCount(row),
        totalMarks: resolveRowMarks(row),
        difficulty: row.difficulty
      }))
    };
  }

  function expandQuestionSlots(templateLike) {
    const template = normalizeTemplate(templateLike);
    let globalIndex = 1;
    return template.rows.flatMap((row) => {
      const itemCount = resolveRowItemCount(row);
      const perQuestionMarks = safeNumber(row.marksPerQuestion, 0) || Math.max(1, Math.round(resolveRowMarks(row) / itemCount));
      return Array.from({ length: itemCount }, (_, index) => ({
        slotId: `${row.sectionKey}_${index + 1}`,
        questionNumber: globalIndex++,
        sectionKey: row.sectionKey,
        sectionTitle: row.sectionTitle,
        questionType: row.questionType,
        marks: perQuestionMarks,
        difficulty: row.difficulty,
        includeDiagrams: row.includeDiagrams,
        sourcePreference: row.sourcePreference,
        notes: row.notes,
        instructions: row.instructions
      }));
    });
  }

  function inferQuestionTypeFromLine(line) {
    const clean = lower(line);
    if (clean.includes('multiple choice') || clean.includes('mcq')) return 'multiple_choice';
    if (clean.includes('true') && clean.includes('false')) return 'true_false';
    if (clean.includes('matching') || clean.includes('match')) return 'matching';
    if (clean.includes('passage')) return 'passage';
    if (clean.includes('word problem') || clean.includes('solve')) return 'word_problem';
    if (clean.includes('diagram') || clean.includes('label')) return 'diagram';
    if (clean.includes('fill in the blank') || clean.includes('fill blank')) return 'fill_blank';
    if (clean.includes('composition') || clean.includes('essay')) return 'composition';
    if (clean.includes('practical') || clean.includes('activity')) return 'practical_or_activity';
    return 'short_answer';
  }

  function inferSectionsFromText(text) {
    const lines = String(text || '')
      .split(/\r?\n/)
      .map((line) => compactText(line))
      .filter(Boolean)
      .slice(0, 220);
    const sections = [];
    let current = null;

    function pushCurrent() {
      if (!current) return;
      current.itemCount = Math.max(1, current.itemCount || 0);
      current.totalMarks = Math.max(current.totalMarks || 0, current.marksPerQuestion ? current.itemCount * current.marksPerQuestion : current.itemCount);
      sections.push(normalizeRow(current, sections.length));
      current = null;
    }

    lines.forEach((line) => {
      const heading = /^((section|part)\s+[a-z0-9]+|[a-z]\.|[ivx]+\.)/i.test(line);
      const rangeMatch = line.match(/\b(\d{1,3})\s*(?:-|to)\s*(\d{1,3})\b/i);
      const countMatch = line.match(/\b(\d{1,3})\s+questions?\b/i);
      const marksEachMatch = line.match(/\b(\d{1,3})\s+marks?\s+each\b/i);
      const totalMarksMatch = line.match(/\btotal\s+(\d{1,3})\s+marks?\b/i) || line.match(/\b(\d{1,3})\s+marks?\b/i);
      const explicitType = inferQuestionTypeFromLine(line);
      if (!current || heading) {
        pushCurrent();
        current = {
          sectionTitle: heading ? line.replace(/[:\-]+$/, '') : `${DEFAULT_SECTION_TITLE} ${sections.length + 1}`,
          questionType: explicitType,
          itemCount: 0,
          marksPerQuestion: '',
          totalMarks: 0,
          difficulty: 'mixed',
          includeDiagrams: explicitType === 'diagram',
          sourcePreference: explicitType === 'passage' || explicitType === 'word_problem' ? 'homework_first' : 'balanced',
          notes: line
        };
      }
      if (rangeMatch) {
        const start = safeNumber(rangeMatch[1], 0);
        const end = safeNumber(rangeMatch[2], 0);
        if (start > 0 && end >= start) {
          current.rangeStart = start;
          current.rangeEnd = end;
          current.itemCount = Math.max(current.itemCount || 0, end - start + 1);
        }
      }
      if (countMatch) current.itemCount = Math.max(current.itemCount || 0, safeNumber(countMatch[1], 0));
      if (marksEachMatch) current.marksPerQuestion = safeNumber(marksEachMatch[1], 0);
      if (totalMarksMatch) current.totalMarks = Math.max(current.totalMarks || 0, safeNumber(totalMarksMatch[1], 0));
      if (explicitType !== 'short_answer' || !current.questionType) current.questionType = explicitType;
    });

    pushCurrent();
    if (sections.length) return sections;
    const inferredType = inferQuestionTypeFromLine(lines.join(' '));
    return [normalizeRow({
      sectionTitle: 'Imported reference section',
      itemCount: 1,
      questionType: inferredType,
      totalMarks: 1,
      notes: lines.slice(0, 10).join(' | ')
    }, 0)];
  }

  function readFileAsDataUrl(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(reader.error || new Error('File read failed'));
      reader.readAsDataURL(file);
    });
  }

  async function extractTextFromPdf(file) {
    if (!global.pdfjsLib) throw new Error('PDF parsing library is not available.');
    const buffer = await file.arrayBuffer();
    const pdf = await global.pdfjsLib.getDocument({ data: buffer }).promise;
    const parts = [];
    const pages = Math.min(pdf.numPages || 0, 12);
    for (let pageNumber = 1; pageNumber <= pages; pageNumber += 1) {
      const page = await pdf.getPage(pageNumber);
      const content = await page.getTextContent();
      const text = (content.items || []).map((item) => compactText(item?.str || '')).filter(Boolean).join(' ');
      if (text) parts.push(text);
    }
    return parts.join('\n');
  }

  async function extractTextFromImage(file) {
    if (!global.Tesseract) throw new Error('Image OCR is not available.');
    const result = await global.Tesseract.recognize(file, 'eng');
    return compactText(result?.data?.text || '');
  }

  async function readReferenceFileText(file) {
    const type = lower(file?.type || '');
    const name = lower(file?.name || '');
    if (!file) return '';
    if (type.startsWith('text/') || name.endsWith('.txt') || name.endsWith('.md') || name.endsWith('.csv') || name.endsWith('.json')) {
      return compactText(await file.text());
    }
    if (type.includes('pdf') || name.endsWith('.pdf')) return compactText(await extractTextFromPdf(file));
    if (type.startsWith('image/') || name.endsWith('.png') || name.endsWith('.jpg') || name.endsWith('.jpeg') || name.endsWith('.webp')) {
      return compactText(await extractTextFromImage(file));
    }
    throw new Error('Automatic parsing is not available for this file type yet.');
  }

  async function prepareReferenceUpload(file, options) {
    const selectedFile = file || null;
    const settings = options && typeof options === 'object' ? options : {};
    if (!selectedFile) {
      return {
        uploadId: createId('exam_format_upload'),
        fileName: '',
        mimeType: '',
        fileSize: 0,
        parseStatus: 'empty',
        parseError: '',
        extractedText: '',
        parsedSections: [],
        storedInline: false,
        inlineDataUrl: null,
        createdAt: nowTs()
      };
    }
    let extractedText = '';
    let parsedSections = [];
    let parseStatus = 'stored_without_parse';
    let parseError = '';
    try {
      extractedText = await readReferenceFileText(selectedFile);
      parsedSections = inferSectionsFromText(extractedText);
      parseStatus = parsedSections.length ? 'parsed' : 'parsed_without_sections';
    } catch (error) {
      parseError = compactText(error?.message || error || 'Parsing failed.');
      parseStatus = 'manual_mapping_required';
    }
    let inlineDataUrl = null;
    if (selectedFile.size <= (settings.inlineFileLimit || INLINE_FILE_LIMIT)) {
      try {
        inlineDataUrl = await readFileAsDataUrl(selectedFile);
      } catch (_) {}
    }
    return {
      uploadId: compactText(settings.uploadId || createId('exam_format_upload')),
      fileName: compactText(selectedFile.name || ''),
      mimeType: compactText(selectedFile.type || ''),
      fileSize: safeNumber(selectedFile.size, 0),
      lastModified: safeNumber(selectedFile.lastModified, 0),
      parseStatus,
      parseError,
      extractedText: extractedText.slice(0, 180000),
      parsedSections,
      storedInline: Boolean(inlineDataUrl),
      inlineDataUrl,
      createdAt: nowTs()
    };
  }

  const api = {
    QUESTION_TYPES,
    compactText,
    normalizeLookupToken,
    sanitizeKey,
    escHtml,
    currentSchoolId,
    currentYear,
    scopedPath,
    getDb,
    createId,
    normalizeTemplate,
    normalizeRow,
    resolveRowItemCount,
    resolveRowMarks,
    summarizeTemplate,
    expandQuestionSlots,
    questionTypeLabel,
    inferSectionsFromText,
    prepareReferenceUpload,
    normalizeSchedule,
    uniqueBy
  };

  global.SoMApExamTemplateEngine = api;
  global.SoMApExamShared = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
