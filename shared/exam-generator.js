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
    if (!global.location?.href) return 'images/somap-logo.png.jpg';
    try {
      return new URL('../../images/somap-logo.png.jpg', global.location.href).href;
    } catch (_) {
      return 'images/somap-logo.png.jpg';
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

  function formatHtmlBlock(value) {
    return escHtml(value).replace(/\r?\n/g, '<br>');
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
      .filter((item) => item.length >= 12 && !item.includes('?'));
  }

  function isWeakTerm(value) {
    const clean = normalizeLookupToken(value);
    return !clean || clean.split(' ').length > 8 || /^(what|which|who|where|when|why|how|which of the following|devices?|things?|it|they)$/.test(clean);
  }

  function extractConceptPairs(sourceText) {
    const pairs = [];
    splitSentences(sourceText).forEach((sentence) => {
      const colon = sentence.match(/^([^:]{3,60})\s*:\s*(.{4,180})$/);
      if (colon && !isWeakTerm(colon[1]) && !colon[2].includes('?')) {
        pairs.push({ term: compactText(colon[1]), description: compactText(colon[2]) });
        return;
      }
      const isMatch = sentence.match(/^(.{3,60})\s+(is|are|means)\s+(.{4,180})$/i);
      if (isMatch && !isWeakTerm(isMatch[1]) && !isMatch[3].includes('?')) {
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

  function cleanAssessmentPrompt(value) {
    return compactText(String(value || '')
      .replace(/^Q\d+[.)]\s*/i, '')
      .replace(/^(multiple choice|true or false|passage question|word problem|reflection|short answer)\s*:\s*/i, ''));
  }

  function validPrompt(value) {
    const clean = cleanAssessmentPrompt(value);
    if (clean.length < 10 || clean.length > 420) return false;
    if (/^(what|which|who|where|when|why|how|which of the following)\??$/i.test(clean)) return false;
    if (/\b(from|in) (the )?lesson\b/i.test(clean)) return false;
    return !/\b(undefined|null|example \d+ from)\b/i.test(clean);
  }

  function answerFromContent(prompt, sourceText) {
    const stop = new Set(['what','which','where','when','does','from','with','that','this','into','about','following','explain']);
    const words = normalizeLookupToken(prompt).split(' ').filter((word) => word.length > 3 && !stop.has(word));
    const candidates = splitSentences(sourceText).filter((sentence) => !sentence.includes('?'));
    return candidates.map((sentence) => ({
      sentence,
      score: words.reduce((sum, word) => sum + (normalizeLookupToken(sentence).includes(word) ? 1 : 0), 0)
    })).sort((a, b) => b.score - a.score || a.sentence.length - b.sentence.length)[0]?.sentence || '';
  }

  function extractOptionMatches(text) {
    return [...String(text || '').matchAll(/(?:^|\n|\s|\()([A-E])[.)]\s*([\s\S]*?)(?=(?:\n|\s|\()[A-E][.)]\s|$)/gi)];
  }

  function parseAssessmentItems(text, sourceText, topic) {
    const raw = String(text || '').replace(/\r\n?/g, '\n').trim();
    if (!raw) return [];
    const blocks = raw.split(/(?=^\s*Q?\d+[.)]\s+|^\s*(?:Multiple Choice|Matching|True or False|Passage Question|Word Problem|Reflection)\s*:)/gmi)
      .map((block) => block.trim()).filter(Boolean);
    const items = [];
    blocks.forEach((block) => {
      const cleanBlock = block.replace(/^Q?\d+[.)]\s*/i, '').trim();
      const typeLabel = (cleanBlock.match(/^(Multiple Choice|Matching|True or False|Passage Question|Word Problem|Reflection)\s*:/i) || [])[1] || '';
      const lowerType = typeLabel.toLowerCase();
      if (lowerType === 'matching') {
        const aPart = cleanBlock.match(/Column A\s*:\s*([\s\S]*?)(?=Column B\s*:)/i)?.[1] || '';
        const bPart = cleanBlock.match(/Column B\s*:\s*([\s\S]*)/i)?.[1] || '';
        const left = aPart.split(/\n/).map((line) => compactText(line.replace(/^[A-Z][.)]\s*/i, ''))).filter(Boolean);
        const right = bPart.split(/\n/).map((line) => compactText(line.replace(/^\d+[.)]\s*/, ''))).filter(Boolean);
        const concepts = extractConceptPairs(sourceText);
        const resolved = left.map((term) => concepts.find((pair) => normalizeLookupToken(pair.term) === normalizeLookupToken(term))).filter(Boolean);
        if (left.length >= 2 && right.length >= 2 && resolved.length === left.length) {
          items.push({ type: 'matching', prompt: 'Match Column A with Column B.', matching: { left, right }, answer: resolved.map((pair) => `${pair.term} - ${pair.description}`).join('; ') });
        }
        return;
      }
      if (lowerType === 'passage question') {
        const passage = compactText(cleanBlock.match(/Passage\s*:\s*([\s\S]*?)(?=Question\s*:)/i)?.[1] || '');
        const prompt = cleanAssessmentPrompt(cleanBlock.match(/Question\s*:\s*([\s\S]*)/i)?.[1] || '');
        if (passage.length >= 40 && validPrompt(prompt) && !passage.includes('?')) {
          items.push({ type: 'passage', prompt, passage, answer: answerFromContent(prompt, passage) });
        }
        return;
      }
      const optionMatches = extractOptionMatches(cleanBlock);
      if (lowerType === 'multiple choice' || optionMatches.length >= 3) {
        const firstOption = cleanBlock.search(/(?:^|\n|\s|\()A[.)]\s*/im);
        const prompt = cleanAssessmentPrompt((firstOption >= 0 ? cleanBlock.slice(0, firstOption) : cleanBlock).replace(/^Multiple Choice\s*:\s*/i, ''));
        const options = optionMatches.map((match) => compactText(match[2])).filter((option) => option.length >= 2);
        const sourceToken = normalizeLookupToken(sourceText);
        const supported = options.filter((option) => option.length >= 3 && sourceToken.includes(normalizeLookupToken(option)));
        if (validPrompt(prompt) && options.length >= 3 && new Set(options.map(normalizeLookupToken)).size === options.length) {
          items.push({
            type: 'multiple_choice', prompt, options,
            answer: supported.length === 1 ? supported[0] : 'Verify the correct option against the source assessment.',
            answerNeedsReview: supported.length !== 1
          });
        }
        return;
      }
      const prompt = cleanAssessmentPrompt(cleanBlock);
      if (!validPrompt(prompt)) return;
      const type = lowerType === 'true or false' ? 'true_false' : (lowerType === 'word problem' ? 'word_problem' : 'short_answer');
      const answer = answerFromContent(prompt, sourceText);
      if (answer) items.push({ type, prompt, options: type === 'true_false' ? ['True', 'False'] : [], answer });
    });
    return items.map((item) => ({ ...item, sourceTopic: topic.topic }));
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
    return distractors.slice(0, 3);
  }

  function buildMcq(slot, topic, analysis) {
    const pair = analysis.concepts[0] || null;
    if (!pair || isWeakTerm(pair.term)) return null;
    const correct = compactText(pair?.description || analysis.sentences[0] || `It explains ${topic.topic.toLowerCase()}.`);
    const distractors = buildDistractors(topic, analysis.concepts.slice(1), correct);
    if (distractors.length < 3) return null;
    const options = [correct, ...distractors].sort((a, b) => a.localeCompare(b));
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
    if (!pair || isWeakTerm(pair.term)) return null;
    return {
      prompt: pair ? `Explain ${pair.term}.` : `Write one key idea you learned about ${topic.topic}.`,
      answer: compactText(pair?.description || analysis.sentences[0] || topic.sourceText)
    };
  }

  function buildPassage(topic, analysis) {
    if (analysis.sentences.length < 3 || !analysis.concepts[0] || isWeakTerm(analysis.concepts[0].term)) return null;
    const passage = analysis.sentences.slice(0, 3).join(' ');
    return {
      prompt: `According to the passage, what is ${analysis.concepts[0].term}?`,
      passage,
      answer: compactText(analysis.concepts[0].description)
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
    if (!pair || isWeakTerm(pair.term)) return null;
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
    if (pairs.length < 3 || pairs.some((pair) => isWeakTerm(pair.term))) return null;
    return {
      prompt: 'Match Column A with Column B.',
      matching: { left: pairs.map((pair) => pair.term), right: pairs.map((pair) => pair.description).reverse() },
      answer: pairs.map((pair) => `${pair.term} - ${pair.description}`).join('; ')
    };
  }

  function buildMatchingGroup(topics, count) {
    const pairs = [];
    const seen = new Set();
    topics.forEach((topic) => {
      analyseTopic(topic).concepts.forEach((pair) => {
        const key = normalizeLookupToken(pair.term);
        if (!key || seen.has(key) || isWeakTerm(pair.term)) return;
        seen.add(key); pairs.push(pair);
      });
    });
    if (pairs.length < count) return null;
    const selected = pairs.slice(0, count);
    return {
      prompt: 'Match Column A with Column B.',
      matching: { left: selected.map((pair) => pair.term), right: selected.map((pair) => pair.description).reverse() },
      answer: selected.map((pair) => `${pair.term} - ${pair.description}`).join('; ')
    };
  }

  function buildPassageGroup(topics, count) {
    const candidates = topics.map((topic) => ({ topic, analysis: analyseTopic(topic) }))
      .filter((entry) => entry.analysis.sentences.length >= 3 && entry.analysis.concepts.length >= count)
      .sort((a, b) => b.analysis.sentences.length - a.analysis.sentences.length);
    const selected = candidates[0];
    if (!selected) return null;
    const passage = selected.analysis.sentences.slice(0, 6).join(' ');
    const subQuestions = selected.analysis.concepts.slice(0, count).map((pair) => ({
      prompt: `What does ${pair.term} mean?`, answer: pair.description
    }));
    return {
      prompt: 'Answer the questions that follow.', passage, subQuestions,
      answer: subQuestions.map((item, index) => `${String.fromCharCode(97 + index)}) ${item.answer}`).join('; ')
    };
  }

  function collapseStructuredSlots(rawSlots) {
    const result = [];
    const grouped = new Set();
    rawSlots.forEach((slot) => {
      if (!['matching', 'passage'].includes(slot.questionType)) { result.push(slot); return; }
      const key = `${slot.sectionKey}__${slot.questionType}`;
      if (grouped.has(key)) return;
      grouped.add(key);
      const group = rawSlots.filter((item) => item.sectionKey === slot.sectionKey && item.questionType === slot.questionType);
      result.push({
        ...slot,
        marks: group.reduce((sum, item) => sum + Number(item.marks || 0), 0),
        structuredItemCount: group.length
      });
    });
    return result;
  }

  function buildPractical(topic) {
    return {
      prompt: `Describe one classroom activity you can do to show understanding of ${topic.topic}.`,
      answer: compactText(topic.plan?.activities || topic.sourceText || `A learner can explain or demonstrate ${topic.topic}.`)
    };
  }

  function analyseTopic(topic) {
    const sourceText = compactText(topic.generationSourceText || topic.sourceText || topic.bookEvidence?.excerpt || topic.plan?.objectives || topic.plan?.activities || topic.topic);
    const sentences = splitSentences(sourceText);
    const concepts = extractConceptPairs(sourceText);
    const homeworkLines = parseHomeworkLines(topic.sourceHomework || '');
    return { sourceText, sentences, concepts, homeworkLines };
  }

  function rotate(values, offset) {
    if (!Array.isArray(values) || values.length < 2) return values || [];
    const start = Math.abs(Number(offset || 0)) % values.length;
    return values.slice(start).concat(values.slice(0, start));
  }

  function varyAnalysis(analysis, offset) {
    return {
      ...analysis,
      sentences: rotate(analysis.sentences, offset),
      concepts: rotate(analysis.concepts, offset),
      homeworkLines: rotate(analysis.homeworkLines, offset)
    };
  }

  function questionFingerprint(value) {
    return normalizeLookupToken(value).replace(/[^a-z0-9]+/g, ' ').trim();
  }

  function builtQuestionFingerprint(built) {
    if (!built) return '';
    const structured = [
      built.prompt,
      built.passage,
      ...(built.options || []),
      ...(built.matching?.left || []),
      ...(built.matching?.right || []),
      ...(built.subQuestions || []).map((item) => item.prompt || '')
    ].filter(Boolean).join(' ');
    return questionFingerprint(structured);
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
        return DiagramEngine.createDiagramQuestion({ topic: topic.topic, subject: topic.subject, sourceHint: [topic.diagrams, topic.sourceText].flat().filter(Boolean).join(' ') });
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
      passage: compactText(built.passage || ''),
      matching: built.matching || null,
      subQuestions: Array.isArray(built.subQuestions) ? built.subQuestions : [],
      familiarNamesUsed: compactText(built.prompt || '').includes(' ') ? [] : [],
      confidenceScore: Number(topic.confidenceScore || 0) || 0,
      generatedAt: Date.now(),
      generatedBy: 'exam-engine-v1',
      sequence: index + 1
    };
  }

  function buildPrintableHtml(paper) {
    const header = buildPaperHeaderMeta(paper);
    const paperSubtitle = [header.className, header.subject, [header.monthLabel, header.academicYear].filter(Boolean).join(' '), header.term].filter(Boolean).join(' | ');
    const sections = paper.sections.map((section) => {
      const questions = paper.questions.filter((question) => question.sectionKey === section.sectionKey).map((question) => `
        <li class="exam-question">
          <div class="question-head">
            <span>${question.sequence}. ${question.passage ? 'Read the passage below and answer the question.' : formatHtmlBlock(question.prompt)}</span>
            <span>${question.marks} mark${question.marks === 1 ? '' : 's'}</span>
          </div>
          ${question.passage ? `<div class="passage-block"><strong>Read the passage below.</strong><p>${escHtml(question.passage)}</p></div>` : ''}
          ${question.passage && question.subQuestions?.length ? `<ol class="passage-questions" type="a">${question.subQuestions.map((item) => `<li>${escHtml(item.prompt)}</li>`).join('')}</ol>` : ''}
          ${question.passage && !question.subQuestions?.length ? `<div class="passage-question"><strong>Question:</strong> ${escHtml(question.prompt)}</div>` : ''}
          ${question.matching ? `<table class="matching-table"><thead><tr><th>Column A</th><th>Column B</th><th>Answer</th></tr></thead><tbody>${question.matching.left.map((left, pairIndex) => `<tr><td>${String.fromCharCode(65 + pairIndex)}. ${escHtml(left)}</td><td>${pairIndex + 1}. ${escHtml(question.matching.right[pairIndex] || '')}</td><td></td></tr>`).join('')}</tbody></table>` : ''}
          ${question.options?.length ? `<div class="exam-options">${question.options.map((option, optionIndex) => `<span><strong>${String.fromCharCode(65 + optionIndex)}.</strong> ${escHtml(option)}</span>`).join('')}</div>` : ''}
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
          .exam-paper { font-family: Arial, sans-serif; color: #0f172a; line-height: 1.5; background: #fff; border: 1px solid #dbe4f0; border-radius: 18px; padding: 24px; }
          .paper-header { position: relative; border: 1px solid #cbd5e1; border-radius: 18px; overflow: hidden; margin-bottom: 20px; background: linear-gradient(135deg, #eff6ff 0%, #fff7ed 100%); }
          .paper-header::before { content: ''; display: block; height: 9px; background: linear-gradient(90deg, #1d4ed8, #f59e0b, #0f766e); }
          .paper-header-body { display: grid; grid-template-columns: 92px 1fr; gap: 18px; align-items: center; padding: 18px 20px 16px; }
          .paper-logo-wrap { display: flex; align-items: center; justify-content: center; width: 92px; height: 92px; border-radius: 18px; border: 1px solid #cbd5e1; background: #fff; box-shadow: inset 0 0 0 1px rgba(255,255,255,0.8); }
          .paper-logo { width: 74px; height: 74px; object-fit: contain; }
          .paper-school { font-size: 28px; font-weight: 800; line-height: 1.05; letter-spacing: 0.04em; color: #0f172a; text-transform: uppercase; }
          .paper-title { margin: 8px 0 0; font-size: 26px; font-weight: 800; color: #1d4ed8; text-transform: uppercase; }
          .paper-subtitle { margin: 7px 0 0; font-size: 14px; color: #475569; font-weight: 700; }
          .paper-meta-bar { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 10px; padding: 0 20px 18px; }
          .paper-meta-pill { background: rgba(255,255,255,0.82); border: 1px solid #cbd5e1; border-radius: 14px; padding: 10px 12px; }
          .paper-meta-pill strong { display: block; font-size: 10px; color: #475569; text-transform: uppercase; letter-spacing: 0.08em; margin-bottom: 4px; }
          .instructions-box { margin-top: 14px; padding: 12px 14px; border: 1px solid #bfdbfe; border-radius: 14px; background: linear-gradient(135deg, #eff6ff, #f8fafc); }
          .instructions-box strong { color: #1d4ed8; }
          .paper-section { margin-top: 24px; }
          .paper-section h3 { margin: 0 0 6px; font-size: 18px; color: #0f172a; }
          .section-meta { margin: 0 0 12px; color: #64748b; font-size: 13px; font-weight: 700; }
          .exam-question { margin-bottom: 18px; padding-bottom: 12px; border-bottom: 1px dashed #dbe4f0; }
          .exam-question:last-child { border-bottom: none; }
          .question-head { display: flex; justify-content: space-between; gap: 12px; font-weight: 600; }
          .question-head span:first-child { flex: 1; }
          .exam-options { display: flex; flex-wrap: wrap; gap: 5px 22px; margin: 6px 0 0 20px; }
          .exam-options span { white-space: normal; }
          .passage-block { margin: 9px 0; padding: 10px 12px; border-left: 4px solid #1d4ed8; background: #f8fafc; }
          .passage-block p { margin: 6px 0 0; text-align: justify; }
          .passage-question { margin: 7px 0 0 12px; }
          .passage-questions { margin-top: 7px; }
          .matching-table { width: 100%; border-collapse: collapse; margin-top: 9px; }
          .matching-table th, .matching-table td { border: 1px solid #64748b; padding: 7px; text-align: left; }
          .matching-table th { background: #e2e8f0; }
          .diagram-wrap { margin-top: 10px; }
          ol { padding-left: 20px; }
          .paper-footer-note { margin-top: 18px; font-size: 11px; color: #64748b; text-align: right; }
          @media print {
            .exam-paper { padding: 0; }
            .paper-header { break-inside: avoid; }
          }
        </style>
        <header class="paper-header">
          <div class="paper-header-body">
            <div class="paper-logo-wrap">
              <img class="paper-logo" src="${escHtml(header.logoUrl)}" alt="${escHtml(header.schoolName)} logo">
            </div>
            <div>
              <div class="paper-school">${escHtml(header.schoolName)}</div>
              <div class="paper-title">${escHtml(header.examTitle)}</div>
              <div class="paper-subtitle">${escHtml(paperSubtitle || [header.className, header.subject].filter(Boolean).join(' | '))}</div>
              <div class="instructions-box"><strong>Instructions:</strong> ${formatHtmlBlock(header.instructions || 'Answer all questions.')}</div>
            </div>
          </div>
          <div class="paper-meta-bar">
            <div class="paper-meta-pill"><strong>Class</strong>${escHtml(header.className || '--')}</div>
            <div class="paper-meta-pill"><strong>Subject</strong>${escHtml(header.subject || '--')}</div>
            <div class="paper-meta-pill"><strong>Term</strong>${escHtml(header.term || 'All Terms')}</div>
            <div class="paper-meta-pill"><strong>Total Marks</strong>${escHtml(header.totalMarks || '--')}</div>
            <div class="paper-meta-pill"><strong>Month</strong>${escHtml(header.monthLabel || '--')}</div>
            <div class="paper-meta-pill"><strong>Academic Year</strong>${escHtml(header.academicYear || '--')}</div>
            <div class="paper-meta-pill"><strong>Exam Date</strong>${escHtml(header.examDate || '--')}</div>
            <div class="paper-meta-pill"><strong>Generated</strong>${escHtml(header.generatedDate || '--')}</div>
          </div>
        </header>
        ${sections}
        <div class="paper-footer-note">Generated from verified lesson notes, homework, and taught-plan evidence.</div>
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
      dateTo: compactText(template.settings.schedule?.exactDate || ''),
      minimumConfidenceScore: template.settings.minimumConfidenceScore || generalSettings.minimumConfidenceScore || 60
    });
    let topics = template.settings.includeOnlyTopicsAboveThreshold ? sourceResult.topics : sourceResult.allTopics;
    const sourceMode = compactText(template.settings.sourceMode || 'lesson_notes_first');
    if (sourceMode === 'book_notes') topics = topics.filter((topic) => topic.bookEvidence?.excerpt);
    if (sourceMode === 'book_assessments') topics = topics.filter((topic) => topic.bookEvidence?.assessment);
    if (sourceMode === 'book_notes') {
      topics = topics.map((topic) => ({ ...topic, generationSourceText: topic.bookEvidence.excerpt }));
    }
    if (sourceMode === 'book_assessments') {
      topics = topics.map((topic) => ({
        ...topic,
        generationSourceText: topic.bookEvidence.assessment,
        sourceHomework: [topic.sourceHomework, topic.bookEvidence.assessment].filter(Boolean).join('\n')
      }));
    }
    if (sourceMode === 'balanced') {
      topics = topics.map((topic) => ({
        ...topic,
        sourceHomework: [topic.sourceHomework, topic.bookEvidence?.assessment].filter(Boolean).join('\n\n')
      }));
    }
    if (template.settings.requireHomeworkGivenForComplexSections) {
      topics = topics.filter((topic) => compactText(topic.sourceHomework));
    }
    if (!topics.length) {
      throw new Error('No verified taught topics met the confidence threshold for this class, subject, and month.');
    }

    const slots = collapseStructuredSlots(Shared.expandQuestionSlots(template));
    const namePool = template.settings.useFamiliarNames ? await NamePool.loadPool({ schoolId, year, className: template.className }) : null;
    const questionsWithAnswers = [];
    const analysisCache = new Map();
    const assessmentItems = topics.flatMap((topic) => parseAssessmentItems(topic.sourceHomework, topic.generationSourceText || topic.sourceText || topic.bookEvidence?.excerpt || '', topic)
      .map((item) => ({ ...item, topic })));
    const bookSource = sourceResult.bookAssessmentSource;
    if (bookSource?.text) {
      const bookTopic = {
        ...topics[0],
        key: `active_book__${bookSource.id}`,
        topic: bookSource.title || `${template.subject} active book`,
        sourceText: bookSource.text,
        sourceHomework: bookSource.text,
        bookEvidence: { bookId: bookSource.id, bookTitle: bookSource.title, assessment: bookSource.text }
      };
      const parsedBookItems = parseAssessmentItems(bookSource.text, bookSource.text, bookTopic);
      parsedBookItems.forEach((item) => assessmentItems.push({ ...item, topic: bookTopic }));
      sourceResult.diagnostics.bookAssessmentItemCount = parsedBookItems.length;
      sourceResult.diagnostics.bookMultipleChoiceItemCount = parsedBookItems.filter((item) => item.type === 'multiple_choice').length;
    }
    const consumedAssessmentItems = new Set();
    const topicUseCount = new Map();
    const usedQuestions = new Set();
    slots.forEach((slot, index) => {
      const topic = selectTopic(topics, index, slot.sourcePreference);
      let selectedTopic = topic;
      const baseAnalysis = analysisCache.get(topic.key) || analyseTopic(topic);
      analysisCache.set(topic.key, baseAnalysis);
      const useCount = topicUseCount.get(topic.key) || 0;
      topicUseCount.set(topic.key, useCount + 1);
      const analysis = varyAnalysis(baseAnalysis, useCount);
      const context = namePool ? NamePool.pickContext(namePool, index) : {
        studentName: 'A pupil',
        helperName: 'another pupil',
        placeName: 'the classroom'
      };
      const compatibleTypes = slot.questionType === 'short_answer'
        ? ['short_answer', 'reflection']
        : [slot.questionType];
      const directIndex = assessmentItems.findIndex((item, itemIndex) =>
        !consumedAssessmentItems.has(itemIndex)
        && compatibleTypes.includes(item.type)
        && !usedQuestions.has(builtQuestionFingerprint(item)));
      let built = null;
      if (slot.questionType === 'matching' && slot.structuredItemCount > 1) {
        built = buildMatchingGroup(topics, slot.structuredItemCount);
      } else if (slot.questionType === 'passage' && slot.structuredItemCount > 1) {
        built = buildPassageGroup(topics, slot.structuredItemCount);
      } else if (directIndex >= 0) {
        consumedAssessmentItems.add(directIndex);
        const direct = assessmentItems[directIndex];
        selectedTopic = direct.topic;
        built = direct;
      } else {
        built = buildQuestionForSlot(slot, topic, analysis, context, index);
      }
      if (!built || !validPrompt(built.prompt)) {
        throw new Error(`Not enough valid ${Shared.questionTypeLabel(slot.questionType).toLowerCase()} questions were found in the saved lesson-note homework or active book assessments. Generation stopped instead of inserting an unclear question.`);
      }
      let fingerprint = builtQuestionFingerprint(built);
      // Never knowingly place the same question twice. Try other taught topics
      // before using a clear, age-appropriate alternative wording.
      for (let attempt = 1; usedQuestions.has(fingerprint) && attempt < topics.length; attempt += 1) {
        const alternate = topics[(index + attempt) % topics.length];
        const alternateAnalysis = varyAnalysis(analysisCache.get(alternate.key) || analyseTopic(alternate), useCount + attempt);
        const alternateBuilt = buildQuestionForSlot(slot, alternate, alternateAnalysis, context, index + attempt);
        if (!alternateBuilt || !validPrompt(alternateBuilt.prompt)) continue;
        built = alternateBuilt;
        selectedTopic = alternate;
        fingerprint = builtQuestionFingerprint(built);
      }
      if (usedQuestions.has(fingerprint)) throw new Error(`The available source material does not contain enough distinct ${Shared.questionTypeLabel(slot.questionType).toLowerCase()} questions for ${slot.sectionTitle || slot.sectionKey || 'this section'}. Generation stopped to prevent repetition.`);
      usedQuestions.add(fingerprint);
      const question = makeQuestionRecord(slot, selectedTopic, built, index);
      if (template.settings.useFamiliarNames) {
        question.familiarNamesUsed = [context.studentName, context.helperName].filter((name) => compactText(built.prompt || '').includes(name));
      }
      questionsWithAnswers.push(question);
    });

    // Diagrams are required by default. Preserve the section and marks by
    // converting one suitable response item when the template has no diagram row.
    if (template.settings.allowDiagramQuestions && !questionsWithAnswers.some((question) => question.diagram?.svg)) {
      const candidate = questionsWithAnswers.find((question) => ['short_answer', 'practical_or_activity', 'fill_blank'].includes(question.type)) || questionsWithAnswers[questionsWithAnswers.length - 1];
      if (candidate) {
        const source = topics.find((topic) => topic.topic === candidate.sourceTopic) || topics[0];
        const diagramQuestion = DiagramEngine.createDiagramQuestion({ topic: source.topic, subject: source.subject, sourceHint: [source.diagrams, source.sourceText].flat().filter(Boolean).join(' ') });
        if (!diagramQuestion) throw new Error('No relevant diagram could be verified from the selected notes or active book. Generation stopped instead of inserting an unrelated diagram.');
        candidate.prompt = diagramQuestion.prompt;
        candidate.answer = diagramQuestion.answer;
        candidate.options = [];
        candidate.diagram = diagramQuestion.diagram;
        candidate.type = 'diagram';
      }
    }

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
        sourceRefs: topic.sourceRefs,
        noteCount: Array.isArray(topic.notes) ? topic.notes.length : 0,
        homeworkGiven: Boolean(topic.homeworkGiven),
        homeworkSourceTopic: compactText(topic.homeworkGivenMeta?.sourceTopic || topic.homeworkSourceMeta?.topic || ''),
        preferredNoteId: compactText(topic.preferredNoteId || '')
        ,bookId: compactText(topic.bookEvidence?.bookId || '')
        ,bookTitle: compactText(topic.bookEvidence?.bookTitle || '')
        ,bookAssessmentAvailable: Boolean(topic.bookEvidence?.assessment)
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
        passage: question.passage || '',
        matching: question.matching || null,
        subQuestions: question.subQuestions || [],
        sourceTopic: question.sourceTopic
      })),
      gateVersion: 'sha256-v1'
    };

    await saveGeneratedArtifacts({ paper, answerKey });
    return { created: true, paper, answerKey, existing: false };
  }

  const api = {
    generateDraftExam,
    buildPrintableHtml,
    validateAssessmentText(text, sourceText, topic) {
      return parseAssessmentItems(text, sourceText, topic || { topic: 'Topic' });
    }
  };

  global.SoMApExamGenerator = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
