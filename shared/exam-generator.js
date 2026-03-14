(function (global) {
  'use strict';

  const Shared = global.SoMApExamShared || global.SoMApExamTemplateEngine;
  const Resolver = global.SoMApExamSourceResolver;
  const DiagramEngine = global.SoMApExamDiagramEngine;
  const NamePool = global.SoMApExamNamePool;
  const Scheduler = global.SoMApExamScheduler;

  function compactText(value) {
    return Shared ? Shared.compactText(value) : String(value == null ? '' : value).replace(/\s+/g, ' ').trim();
  }

  function normalizeLookupToken(value) {
    return Shared ? Shared.normalizeLookupToken(value) : compactText(value).toLowerCase();
  }

  function sanitizeKey(value) {
    return Shared ? Shared.sanitizeKey(value) : compactText(value).replace(/\s+/g, '_');
  }

  function escHtml(value) {
    return Shared ? Shared.escHtml(value) : String(value == null ? '' : value);
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

  function createId(prefix) {
    return Shared ? Shared.createId(prefix) : `${prefix}_${Date.now()}`;
  }

  function compactMonthKey(monthKey) {
    return compactText(monthKey).replace('-', '');
  }

  function formatMonthLabel(value, includeYear) {
    if (Shared?.formatMonthLabel) {
      return Shared.formatMonthLabel(value, { includeYear: includeYear !== false });
    }
    return compactText(value);
  }

  function resolveDefaultLogoUrl() {
    if (!global.location?.href) return 'images/socrates_logo.png';
    try {
      return new URL('../../images/socrates_logo.png', global.location.href).href;
    } catch (_) {
      return 'images/socrates_logo.png';
    }
  }

  async function loadSchoolProfile(options) {
    const db = getDb();
    const schoolId = compactText(options?.schoolId || currentSchoolId());
    const defaultProfile = {
      id: schoolId,
      name: Shared?.prettifySchoolName ? Shared.prettifySchoolName(schoolId) : schoolId,
      logoUrl: resolveDefaultLogoUrl()
    };
    if (!db) return defaultProfile;
    const paths = [
      scopedPath('profile', schoolId),
      `schools/${schoolId}/profile`,
      'profile'
    ];
    for (const path of paths) {
      if (!path) continue;
      const snap = await db.ref(path).once('value').catch(() => ({ val: () => null }));
      const profile = (snap && typeof snap.val === 'function' && snap.val()) || null;
      if (profile && typeof profile === 'object' && Object.keys(profile).length) {
        return {
          id: schoolId,
          name: compactText(profile.name || defaultProfile.name),
          logoUrl: compactText(profile.logoUrl || profile.logo || defaultProfile.logoUrl),
          ...profile
        };
      }
    }
    return defaultProfile;
  }

  function buildPaperHeaderMeta(paper) {
    const monthLabel = compactText(paper.monthLabel || formatMonthLabel(paper.monthKey, false));
    return {
      schoolName: compactText(paper.schoolName || Shared?.prettifySchoolName?.(paper.schoolId) || paper.schoolId),
      logoUrl: compactText(paper.schoolLogoUrl || resolveDefaultLogoUrl()),
      examTitle: compactText(paper.title || 'Exam'),
      className: compactText(paper.className || ''),
      subject: compactText(paper.subject || ''),
      term: compactText(paper.term || ''),
      monthLabel,
      academicYear: String(paper.year || ''),
      examDate: compactText(paper.examDate || ''),
      generatedDate: Number(paper.generatedAt || 0) ? new Date(Number(paper.generatedAt || 0)).toLocaleDateString() : '',
      instructions: compactText(paper.instructions || ''),
      totalMarks: Number(paper.totalMarks || 0) || 0
    };
  }

  function commonTerm(subjectText) {
    if (/(math|arithmetic|fraction|addition|subtraction|multiplication|division|money|time|measurement)/.test(normalizeLookupToken(subjectText))) {
      return 'math';
    }
    if (/(english|kiswahili|language|reading|writing)/.test(normalizeLookupToken(subjectText))) {
      return 'language';
    }
    return 'general';
  }

  function splitSentences(text) {
    return compactText(text)
      .split(/(?<=[.!?])\s+/)
      .map((item) => compactText(item))
      .filter((item) => item.length >= 12);
  }

  function extractConceptPairs(sourceText) {
    const pairs = [];
    splitSentences(sourceText).forEach((sentence) => {
      const colon = sentence.match(/^([^:]{3,60})\s*:\s*(.{4,180})$/);
      if (colon) {
        pairs.push({ term: compactText(colon[1]), description: compactText(colon[2]) });
        return;
      }
      const isMatch = sentence.match(/^(.{3,60})\s+(is|are|means)\s+(.{4,180})$/i);
      if (isMatch) {
        pairs.push({ term: compactText(isMatch[1]), description: compactText(isMatch[3]) });
      }
    });
    return pairs;
  }

  function parseHomeworkLines(text) {
    return String(text || '')
      .split(/\r?\n/)
      .map((line) => compactText(line.replace(/^\d+[\).\s-]*/, '')))
      .filter(Boolean);
  }

  function selectTopic(topics, index, selector) {
    if (!Array.isArray(topics) || !topics.length) return null;
    if (selector === 'homework_first') {
      const rich = topics.filter((topic) => compactText(topic.sourceHomework));
      if (rich.length) return rich[index % rich.length];
    }
    if (selector === 'diagram_ready') {
      const rich = topics.filter((topic) => Array.isArray(topic.diagrams) && topic.diagrams.length);
      if (rich.length) return rich[index % rich.length];
    }
    return topics[index % topics.length];
  }

  function buildDistractors(topic, concepts, correct) {
    const distractors = [];
    concepts.forEach((pair) => {
      const candidate = compactText(pair.description || pair.term || '');
      if (!candidate || candidate === correct || distractors.includes(candidate)) return;
      distractors.push(candidate);
    });
    if (distractors.length < 3) {
      [
        `It means something not related to ${topic.topic.toLowerCase()}.`,
        'It is always false.',
        'It is only used once and then forgotten.',
        'It is not part of the lesson.'
      ].forEach((candidate) => {
        if (candidate !== correct && !distractors.includes(candidate)) distractors.push(candidate);
      });
    }
    return distractors.slice(0, 3);
  }

  function buildMcq(slot, topic, analysis) {
    const pair = analysis.concepts[0] || null;
    const correct = compactText(pair?.description || analysis.sentences[0] || `It explains ${topic.topic.toLowerCase()}.`);
    const options = [correct, ...buildDistractors(topic, analysis.concepts.slice(1), correct)].sort((a, b) => a.localeCompare(b));
    return {
      prompt: pair ? `Which option best explains ${pair.term}?` : `Which statement about ${topic.topic} is correct?`,
      answer: correct,
      options
    };
  }

  function buildTrueFalse(slot, topic, analysis, index) {
    const sentence = analysis.sentences[0] || `${topic.topic} is part of the lesson.`;
    const makeFalse = index % 2 === 1 && analysis.concepts[1];
    if (!makeFalse) {
      return { prompt: `${sentence} (True or False)`, answer: 'True' };
    }
    return {
      prompt: `${analysis.concepts[0]?.term || topic.topic} means ${analysis.concepts[1]?.description || 'something different from the lesson'} (True or False)`,
      answer: 'False'
    };
  }

  function buildShortAnswer(topic, analysis) {
    const pair = analysis.concepts[0] || null;
    return {
      prompt: pair ? `Explain ${pair.term}.` : `Write one key idea you learned about ${topic.topic}.`,
      answer: compactText(pair?.description || analysis.sentences[0] || topic.sourceText)
    };
  }

  function buildPassage(topic, analysis) {
    const passage = analysis.sentences.slice(0, 3).join(' ');
    return {
      prompt: `Read the passage and answer the question.\n\n${passage}\n\nQuestion: What is one important idea from the passage?`,
      answer: compactText(analysis.sentences[0] || `One important idea is ${topic.topic}.`)
    };
  }

  function inferMathOperation(topicText, homeworkText) {
    const merged = `${normalizeLookupToken(topicText)} ${normalizeLookupToken(homeworkText)}`;
    if (merged.includes('subtract') || merged.includes('minus') || merged.includes('take away')) return 'subtraction';
    if (merged.includes('multiply') || merged.includes('times') || merged.includes('group')) return 'multiplication';
    if (merged.includes('divide') || merged.includes('share')) return 'division';
    if (merged.includes('fraction') || merged.includes('half') || merged.includes('quarter')) return 'fraction';
    return 'addition';
  }

  function buildWordProblem(topic, analysis, familiarContext, index) {
    const operation = inferMathOperation(topic.topic, topic.sourceHomework || '');
    const a = 6 + (index % 5);
    const b = 2 + (index % 4);
    if (operation === 'subtraction') {
      return {
        prompt: `${familiarContext.studentName} had ${a + b} exercise books at ${familiarContext.placeName}. ${familiarContext.helperName} used ${b} of them. How many exercise books remained?`,
        answer: String(a)
      };
    }
    if (operation === 'multiplication') {
      return {
        prompt: `${familiarContext.studentName} arranged ${a} desks in each of ${b} rows during a ${topic.topic.toLowerCase()} activity. How many desks were arranged altogether?`,
        answer: String(a * b)
      };
    }
    if (operation === 'division') {
      return {
        prompt: `${familiarContext.studentName} shared ${a * b} pencils equally among ${b} groups after the ${topic.topic.toLowerCase()} lesson. How many pencils did each group get?`,
        answer: String(a)
      };
    }
    if (operation === 'fraction') {
      return {
        prompt: `${familiarContext.studentName} used half of ${a * 2} fruits for a class example during ${topic.topic.toLowerCase()}. How many fruits were used?`,
        answer: String(a)
      };
    }
    return {
      prompt: `${familiarContext.studentName} and ${familiarContext.helperName} counted ${a} books and then found ${b} more during the ${topic.topic.toLowerCase()} lesson. How many books did they count in total?`,
      answer: String(a + b)
    };
  }

  function buildFillBlank(topic, analysis) {
    const pair = analysis.concepts[0];
    if (pair) {
      return {
        prompt: `${pair.term} means __________.`,
        answer: pair.description
      };
    }
    const sentence = analysis.sentences[0] || `${topic.topic} is important in the lesson.`;
    const words = sentence.split(' ');
    const hiddenWord = words.find((word) => word.length > 5) || words[0] || topic.topic;
    return {
      prompt: sentence.replace(hiddenWord, '__________'),
      answer: hiddenWord
    };
  }

  function buildComposition(topic, analysis) {
    return {
      prompt: `Write a short composition about ${topic.topic}. Use ideas from the lesson.`,
      answer: compactText(analysis.sentences.slice(0, 3).join(' ') || topic.sourceText)
    };
  }

  function buildMatching(topic, analysis) {
    const pairs = analysis.concepts.slice(0, 3);
    const promptLines = pairs.map((pair, index) => `${String.fromCharCode(65 + index)}. ${pair.term}`).join('\n');
    const answerLines = pairs.map((pair, index) => `${String.fromCharCode(65 + index)} - ${pair.description}`).join('; ');
    return {
      prompt: `Match each item with its meaning.\n${promptLines}`,
      answer: answerLines
    };
  }

  function buildPractical(topic) {
    return {
      prompt: `Describe one classroom activity you can do to show understanding of ${topic.topic}.`,
      answer: compactText(topic.plan?.activities || topic.sourceText || `A learner can explain or demonstrate ${topic.topic}.`)
    };
  }

  function analyseTopic(topic) {
    const sourceText = compactText(topic.sourceText || topic.plan?.objectives || topic.plan?.activities || topic.topic);
    const sentences = splitSentences(sourceText);
    const concepts = extractConceptPairs(sourceText);
    const homeworkLines = parseHomeworkLines(topic.sourceHomework || '');
    return { sourceText, sentences, concepts, homeworkLines };
  }

  function buildQuestionForSlot(slot, topic, analysis, context, index) {
    switch (slot.questionType) {
      case 'multiple_choice':
        return buildMcq(slot, topic, analysis);
      case 'true_false':
        return buildTrueFalse(slot, topic, analysis, index);
      case 'matching':
        return buildMatching(topic, analysis);
      case 'passage':
        return buildPassage(topic, analysis);
      case 'word_problem':
        return buildWordProblem(topic, analysis, context, index);
      case 'diagram':
        return DiagramEngine.createDiagramQuestion({ topic: topic.topic, subject: topic.subject });
      case 'fill_blank':
        return buildFillBlank(topic, analysis);
      case 'composition':
        return buildComposition(topic, analysis);
      case 'practical_or_activity':
        return buildPractical(topic);
      default:
        return buildShortAnswer(topic, analysis);
    }
  }

  function makeQuestionRecord(slot, topic, built, index) {
    return {
      id: createId(`question_${slot.questionType}`),
      sectionKey: slot.sectionKey,
      type: slot.questionType,
      prompt: compactText(built.prompt || ''),
      marks: Number(slot.marks || 1) || 1,
      difficulty: slot.difficulty,
      sourceTopic: topic.topic,
      sourceRefs: {
        lessonPlanId: topic.sourceRefs.lessonPlanId || '',
        lessonNoteId: topic.sourceRefs.lessonNoteIds?.[0] || '',
        logbookId: topic.sourceRefs.logbookIds?.[0] || '',
        classJournalId: topic.sourceRefs.classJournalIds?.[0] || ''
      },
      answer: compactText(built.answer || ''),
      options: Array.isArray(built.options) ? built.options : [],
      diagram: built.diagram || null,
      familiarNamesUsed: compactText(built.prompt || '').includes(' ') ? [] : [],
      confidenceScore: Number(topic.confidenceScore || 0) || 0,
      generatedAt: Date.now(),
      generatedBy: 'exam-engine-v1',
      sequence: index + 1
    };
  }

  function buildPrintableHtml(paper) {
    const header = buildPaperHeaderMeta(paper);
    const sections = paper.sections.map((section) => {
      const questions = paper.questions.filter((question) => question.sectionKey === section.sectionKey).map((question) => `
        <li class="exam-question">
          <div class="question-head">
            <span>${question.sequence}. ${escHtml(question.prompt)}</span>
            <span>${question.marks} mark${question.marks === 1 ? '' : 's'}</span>
          </div>
          ${question.options?.length ? `<ol type="A">${question.options.map((option) => `<li>${escHtml(option)}</li>`).join('')}</ol>` : ''}
          ${question.diagram?.svg ? `<div class="diagram-wrap">${question.diagram.svg}</div>` : ''}
        </li>
      `).join('');
      return `
        <section class="paper-section">
          <h3>${escHtml(section.sectionTitle)}</h3>
          <p class="section-meta">${escHtml(section.questionTypeLabel)} | ${section.totalMarks} marks</p>
          <ol>${questions}</ol>
        </section>
      `;
    }).join('');

    return `
      <div class="exam-paper">
        <style>
          .exam-paper { font-family: Arial, sans-serif; color: #0f172a; line-height: 1.45; }
          .paper-header { display: grid; grid-template-columns: 72px 1fr; gap: 16px; align-items: center; border-bottom: 2px solid #cbd5e1; padding-bottom: 14px; margin-bottom: 18px; }
          .paper-logo { width: 72px; height: 72px; object-fit: contain; border-radius: 12px; border: 1px solid #cbd5e1; padding: 6px; background: #fff; }
          .paper-header h1 { margin: 0 0 4px; font-size: 24px; }
          .paper-header h2 { margin: 0 0 8px; font-size: 14px; font-weight: normal; color: #475569; }
          .paper-school { font-size: 20px; font-weight: 700; margin-bottom: 4px; }
          .paper-meta-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 8px 12px; margin-top: 10px; font-size: 12px; }
          .paper-meta-grid strong { display: block; font-size: 11px; color: #475569; text-transform: uppercase; letter-spacing: 0.04em; }
          .instructions-box { margin-top: 12px; padding: 10px 12px; border: 1px solid #cbd5e1; border-radius: 10px; background: #f8fafc; }
          .paper-section { margin-top: 24px; }
          .paper-section h3 { margin: 0 0 6px; font-size: 18px; }
          .section-meta { margin: 0 0 12px; color: #64748b; font-size: 13px; }
          .exam-question { margin-bottom: 18px; }
          .question-head { display: flex; justify-content: space-between; gap: 12px; font-weight: 600; }
          .diagram-wrap { margin-top: 10px; }
          ol { padding-left: 20px; }
          @media print {
            .exam-paper { padding: 0; }
          }
        </style>
        <header class="paper-header">
          <img class="paper-logo" src="${escHtml(header.logoUrl)}" alt="${escHtml(header.schoolName)} logo">
          <div>
            <div class="paper-school">${escHtml(header.schoolName)}</div>
            <h1>${escHtml(header.examTitle)}</h1>
            <h2>${escHtml([header.className, header.subject, header.monthLabel || paper.monthKey].filter(Boolean).join(' | '))}</h2>
            <div class="paper-meta-grid">
              <div><strong>Class</strong>${escHtml(header.className || '--')}</div>
              <div><strong>Subject</strong>${escHtml(header.subject || '--')}</div>
              <div><strong>Term</strong>${escHtml(header.term || 'All Terms')}</div>
              <div><strong>Month</strong>${escHtml(header.monthLabel || '--')}</div>
              <div><strong>Academic Year</strong>${escHtml(header.academicYear || '--')}</div>
              <div><strong>Total Marks</strong>${escHtml(header.totalMarks || '--')}</div>
              <div><strong>Exam Date</strong>${escHtml(header.examDate || '--')}</div>
              <div><strong>Generated</strong>${escHtml(header.generatedDate || '--')}</div>
              <div><strong>School ID</strong>${escHtml(paper.schoolId || '--')}</div>
            </div>
            <div class="instructions-box"><strong>Instructions:</strong> ${escHtml(header.instructions || 'Answer all questions.')}</div>
          </div>
        </header>
        ${sections}
      </div>
    `;
  }

  async function readExistingPapers(options) {
    const db = getDb();
    if (!db) return [];
    const schoolId = compactText(options.schoolId || currentSchoolId());
    const year = String(options.year || currentYear());
    const classKey = sanitizeKey(options.className || '');
    const subjectKey = sanitizeKey(options.subject || '');
    const monthKey = compactMonthKey(options.monthKey || '');
    const snap = await db.ref(scopedPath(`years/${year}/generatedExams/${classKey}/${subjectKey}/${monthKey}`, schoolId)).once('value').catch(() => ({ val: () => null }));
    const data = (snap && typeof snap.val === 'function' && snap.val()) || {};
    return Object.values(data || {});
  }

  async function saveGeneratedArtifacts(payload) {
    const db = getDb();
    if (!db) throw new Error('Database is not available.');
    const classKey = sanitizeKey(payload.paper.className);
    const subjectKey = sanitizeKey(payload.paper.subject);
    const monthKey = compactMonthKey(payload.paper.monthKey);
    const schoolId = compactText(payload.paper.schoolId);
    const year = String(payload.paper.year);
    await db.ref(scopedPath(`years/${year}/generatedExams/${classKey}/${subjectKey}/${monthKey}/${payload.paper.id}`, schoolId)).set(payload.paper);
    await db.ref(scopedPath(`years/${year}/generatedExamAnswerKeys/${payload.paper.id}`, schoolId)).set(payload.answerKey);
    const stateKey = {
      schoolId,
      year,
      monthKey: payload.paper.monthKey,
      className: payload.paper.className,
      subject: payload.paper.subject,
      formatId: payload.paper.formatId
    };
    const existingState = await Scheduler.readGenerationState(stateKey);
    await Scheduler.writeGenerationState(stateKey, {
      lastGeneratedPaperId: payload.paper.id,
      lastGeneratedAt: payload.paper.generatedAt,
      generationMode: payload.paper.generationMode,
      history: {
        ...(existingState?.history || {}),
        [payload.paper.id]: {
          status: payload.paper.status,
          generatedAt: payload.paper.generatedAt
        }
      }
    });
    const taskRef = db.ref(scopedPath(`years/${year}/generatedExamTasks/${monthKey}`, schoolId)).push();
    await taskRef.set({
      id: taskRef.key,
      paperId: payload.paper.id,
      className: payload.paper.className,
      subject: payload.paper.subject,
      monthKey: payload.paper.monthKey,
      status: 'ready_for_review',
      title: `${payload.paper.subject} exam draft ready`,
      createdAt: payload.paper.generatedAt
    });
  }

  async function generateDraftExam(options) {
    const settings = options && typeof options === 'object' ? options : {};
    const template = Shared.normalizeTemplate(settings.template || {});
    const schoolId = compactText(settings.schoolId || template.schoolId || currentSchoolId());
    const year = String(settings.year || template.year || currentYear());
    const monthKey = compactText(settings.monthKey || template.monthKey || Scheduler.buildMonthKey(new Date()));
    const generalSettings = settings.generalSettings || {};
    const generationMode = compactText(settings.generationMode || 'manual') || 'manual';
    const existing = await readExistingPapers({
      schoolId,
      year,
      className: template.className,
      subject: template.subject,
      monthKey
    });
    const sameTemplate = existing.filter((paper) => compactText(paper.formatId || '') === compactText(template.formatId || template.id));
    if (sameTemplate.length && !settings.forceRegenerate) {
      return { created: false, paper: sameTemplate[0], answerKey: null, existing: true };
    }

    const sourceResult = await Resolver.resolveVerifiedTopics({
      schoolId,
      year,
      className: template.className,
      subject: template.subject,
      term: template.term,
      monthKey,
      minimumConfidenceScore: template.settings.minimumConfidenceScore || generalSettings.minimumConfidenceScore || 60
    });
    let topics = template.settings.includeOnlyTopicsAboveThreshold ? sourceResult.topics : sourceResult.allTopics;
    if (template.settings.requireHomeworkGivenForComplexSections) {
      topics = topics.filter((topic) => compactText(topic.sourceHomework));
    }
    if (!topics.length) {
      throw new Error('No verified taught topics met the confidence threshold for this class, subject, and month.');
    }

    const slots = Shared.expandQuestionSlots(template);
    const namePool = template.settings.useFamiliarNames ? await NamePool.loadPool({ schoolId, year, className: template.className }) : null;
    const questionsWithAnswers = [];
    const analysisCache = new Map();
    slots.forEach((slot, index) => {
      const topic = selectTopic(topics, index, slot.sourcePreference);
      const analysis = analysisCache.get(topic.key) || analyseTopic(topic);
      analysisCache.set(topic.key, analysis);
      const context = namePool ? NamePool.pickContext(namePool, index) : {
        studentName: 'A pupil',
        helperName: 'another pupil',
        placeName: 'the classroom'
      };
      const built = buildQuestionForSlot(slot, topic, analysis, context, index);
      const question = makeQuestionRecord(slot, topic, built, index);
      if (template.settings.useFamiliarNames) {
        question.familiarNamesUsed = [context.studentName, context.helperName].filter((name) => compactText(built.prompt || '').includes(name));
      }
      questionsWithAnswers.push(question);
    });

    const sections = Shared.summarizeTemplate(template).sections.map((section) => ({
      sectionKey: section.sectionKey,
      sectionTitle: section.sectionTitle,
      questionTypeLabel: Shared.questionTypeLabel(section.questionType),
      itemCount: section.itemCount,
      totalMarks: section.totalMarks
    }));
    const totalMarks = questionsWithAnswers.reduce((sum, question) => sum + Number(question.marks || 0), 0);
    const revision = sameTemplate.length + 1;
    const generatedAt = Date.now();
    const paperId = createId('exam_paper');
    const schoolProfile = await loadSchoolProfile({ schoolId });
    const paper = {
      id: paperId,
      schoolId,
      schoolName: compactText(schoolProfile?.name || Shared?.prettifySchoolName?.(schoolId) || schoolId),
      schoolLogoUrl: compactText(schoolProfile?.logoUrl || schoolProfile?.logo || resolveDefaultLogoUrl()),
      year,
      monthKey,
      monthLabel: formatMonthLabel(monthKey, false),
      className: template.className,
      subject: template.subject,
      term: template.term,
      status: 'draft',
      title: revision > 1 ? `${template.title} (Draft ${revision})` : template.title,
      instructions: template.instructions,
      examDate: compactText(template.settings.schedule?.exactDate || ''),
      formatId: template.formatId || template.id,
      generatedAt,
      generatedBy: 'exam-engine-v1',
      generationMode,
      sourceTopics: topics.map((topic) => ({
        topic: topic.topic,
        confidenceScore: topic.confidenceScore,
        dates: topic.dates || [],
        sourceRefs: topic.sourceRefs
      })),
      sections,
      questions: questionsWithAnswers.map((question) => ({
        ...question,
        answer: '',
        options: question.options || []
      })),
      totalMarks,
      printableHtml: '',
      pdfMeta: {
        exportHint: 'Use print view for diagram-safe PDF output.'
      },
      reviewMeta: {
        revision,
        regeneratedFromPaperId: sameTemplate[0]?.id || '',
        diagnostics: sourceResult.diagnostics
      }
    };
    paper.printableHtml = buildPrintableHtml(paper);

    const answerKey = {
      paperId,
      schoolId,
      year,
      generatedAt,
      formatId: template.formatId || template.id,
      questions: questionsWithAnswers.map((question) => ({
        id: question.id,
        prompt: question.prompt,
        answer: question.answer,
        options: question.options || [],
        diagram: question.diagram || null,
        sourceTopic: question.sourceTopic
      })),
      gateVersion: 'sha256-v1'
    };

    await saveGeneratedArtifacts({ paper, answerKey });
    return { created: true, paper, answerKey, existing: false };
  }

  const api = {
    generateDraftExam,
    buildPrintableHtml
  };

  global.SoMApExamGenerator = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
