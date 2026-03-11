(function (global) {
  const MONTHS = [
    'JANUARY',
    'FEBRUARY',
    'MARCH',
    'APRIL',
    'MAY',
    'JUNE',
    'JULY',
    'AUGUST',
    'SEPTEMBER',
    'OCTOBER',
    'NOVEMBER',
    'DECEMBER'
  ];

  const COMPETENCE_STARTERS = [
    'Demonstrate',
    'Develop',
    'Apply',
    'Acquire',
    'Explain',
    'Identify',
    'Recognize',
    'Use',
    'Read',
    'Write',
    'Compare',
    'Construct',
    'Solve',
    'Perform',
    'Master',
    'Understand'
  ];

  const METHOD_HINTS = [
    'questions and discussion',
    'group discussion',
    'practical exercise',
    'examples from',
    'brainstorming',
    'demonstration',
    'question and answer',
    'role play',
    'lecture',
    'observation',
    'discussion'
  ];

  const TOOL_HINTS = [
    'card',
    'cards',
    'abacus',
    'number tray',
    'chart',
    'charts',
    'textbook',
    'textbooks',
    'manila',
    'online program',
    'online programs',
    'ruler',
    'tape measure',
    'scale',
    'flask',
    'beaker',
    'measuring cylinder',
    'string',
    'jug',
    'cup',
    'bucket',
    'object',
    'objects',
    'tray',
    'video',
    'videos'
  ];

  const ASSESSMENT_HINTS = [
    'exercise',
    'exercises',
    'quiz',
    'quizzes',
    'test',
    'tests',
    'group works',
    'group work',
    'checklist',
    'observation',
    'oral',
    'assignment'
  ];

  function ensurePdfWorker() {
    if (global.pdfjsLib && global.pdfjsLib.GlobalWorkerOptions) {
      global.pdfjsLib.GlobalWorkerOptions.workerSrc =
        'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
    }
  }

  function cleanWhitespace(value) {
    return String(value || '')
      .replace(/\u00a0/g, ' ')
      .replace(/[ \t]+/g, ' ')
      .replace(/\s*\n\s*/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }

  function compactText(value) {
    return cleanWhitespace(value)
      .replace(/\n+/g, ' ')
      .replace(/\s{2,}/g, ' ')
      .trim();
  }

  function titleCaseMonth(month) {
    if (!month) return '';
    const upper = String(month).toUpperCase();
    return upper.charAt(0) + upper.slice(1).toLowerCase();
  }

  function normalizeSpacedMonths(text) {
    let out = String(text || '');
    MONTHS.forEach((month) => {
      const pattern = month.split('').join('\\s*');
      out = out.replace(new RegExp(pattern, 'gi'), month);
    });
    return out;
  }

  function stripHeaderNoise(text) {
    return compactText(text)
      .replace(/official scheme table\s*\(.*?\)/gi, ' ')
      .replace(/s\s*\/?\s*n\s+main competence[\s\S]*?remarks/gi, ' ')
      .replace(/main competence\s+specific competence\s+learning activities[\s\S]*?remarks/gi, ' ')
      .replace(/president'?s office[\s\S]*?scheme of work/gi, ' ')
      .replace(/prepared by\s*[:\-]\s*[a-z .]+/gi, ' ')
      .replace(/teacher\s*[:\-]\s*[a-z .]+/gi, ' ')
      .replace(/school\s*[:\-]\s*[a-z0-9 ._-]+/gi, ' ')
      .replace(/\bterm\s+[123]\b/gi, ' ')
      .replace(/\byear\s*[:\-]?\s*20\d{2}\b/gi, ' ')
      .replace(/\s{2,}/g, ' ')
      .trim();
  }

  function removeCalendarEvents(text) {
    return String(text || '')
      .replace(/\b(?:FIRST|SECOND|TERMINAL)\s+(?:MID-TERM\s+)?(?:EXAMINATION|HOLIDAY)\b[\s\S]*?(?=(?:Demonstrate|Develop|Apply|Acquire|Explain|To facilitate pupil to|JANUARY|FEBRUARY|MARCH|APRIL|MAY|JUNE|JULY|AUGUST|SEPTEMBER|OCTOBER|NOVEMBER|DECEMBER|$))/gi, ' ')
      .replace(/\s{2,}/g, ' ')
      .trim();
  }

  function findSection(text, startPatterns, stopPatterns) {
    const source = String(text || '');
    let start = -1;
    let markerLength = 0;

    for (const pattern of startPatterns) {
      const match = source.match(pattern);
      if (match && match.index !== undefined) {
        if (start === -1 || match.index < start) {
          start = match.index;
          markerLength = match[0].length;
        }
      }
    }

    if (start === -1) return '';

    const remainder = source.slice(start + markerLength);
    let end = remainder.length;
    for (const pattern of stopPatterns) {
      const match = remainder.match(pattern);
      if (match && match.index !== undefined) {
        end = Math.min(end, match.index);
      }
    }

    return cleanWhitespace(remainder.slice(0, end));
  }

  function extractObjectives(text) {
    const objectives = findSection(
      text,
      [
        /general objectives?\s*\/?\s*learning outcomes?/i,
        /objectives of primary education[\s\S]{0,80}?are to:?/i,
        /the objectives of primary education[\s\S]{0,80}?are to:?/i
      ],
      [
        /assessment methods?/i,
        /teaching resources?/i,
        /official scheme table/i,
        /main competence/i
      ]
    );
    return compactText(objectives);
  }

  function extractNamedSection(text, startPattern) {
    const value = findSection(
      text,
      [startPattern],
      [/general objectives?/i, /teaching resources?/i, /assessment methods?/i, /main competence/i]
    );
    return compactText(value);
  }

  function firstNumeric(value) {
    const match = String(value || '').match(/\d+/);
    return match ? Number(match[0]) : '';
  }

  function uniqueNonEmpty(values) {
    return Array.from(
      new Set(
        (values || [])
          .map((value) => compactText(value))
          .filter(Boolean)
      )
    );
  }

  function containsAny(text, hints) {
    const lower = String(text || '').toLowerCase();
    return hints.some((hint) => lower.includes(hint));
  }

  function findAllMatches(text, regex) {
    const matches = [];
    let match;
    const safe = new RegExp(regex.source, regex.flags.includes('g') ? regex.flags : `${regex.flags}g`);
    while ((match = safe.exec(text)) !== null) {
      matches.push(match);
      if (match[0].length === 0) safe.lastIndex += 1;
    }
    return matches;
  }

  function splitCompetenceHead(head, previousRow) {
    const cleaned = compactText(head);
    if (!cleaned) {
      return {
        mainCompetence: previousRow?.mainCompetence || '',
        specificCompetence: previousRow?.specificCompetence || ''
      };
    }

    const starterPattern = new RegExp(`\\b(?:${COMPETENCE_STARTERS.join('|')})\\b`, 'g');
    const matches = findAllMatches(cleaned, starterPattern).filter((match) => match.index !== undefined);
    if (matches.length >= 2) {
      const splitAt = matches[1].index;
      return {
        mainCompetence: compactText(cleaned.slice(0, splitAt)),
        specificCompetence: compactText(cleaned.slice(splitAt))
      };
    }

    return {
      mainCompetence: previousRow?.mainCompetence || cleaned,
      specificCompetence: cleaned === previousRow?.mainCompetence ? previousRow?.specificCompetence || '' : previousRow?.specificCompetence || ''
    };
  }

  function splitLearningAndSpecific(body) {
    const cleaned = compactText(body);
    if (!cleaned) {
      return { learningActivities: '', specificActivities: '' };
    }

    const learningMarker = /to facilitate pupil to/gi;
    const matches = findAllMatches(cleaned, learningMarker).filter((match) => match.index !== undefined);
    if (matches.length >= 2) {
      return {
        learningActivities: compactText(cleaned.slice(0, matches[1].index)),
        specificActivities: compactText(cleaned.slice(matches[1].index).replace(/^to facilitate pupil to\s*/i, ''))
      };
    }

    if (/^to facilitate pupil to/i.test(cleaned)) {
      const withoutPrefix = compactText(cleaned.replace(/^to facilitate pupil to\s*/i, ''));
      const tailSplit = withoutPrefix.match(/\b(?:Recognize|Identify|Explain|Use|Read|Write|Compare|Solve|Construct|Demonstrate)\b/i);
      if (tailSplit && tailSplit.index !== undefined && tailSplit.index > 20) {
        return {
          learningActivities: compactText(`To facilitate pupil to ${withoutPrefix.slice(0, tailSplit.index)}`),
          specificActivities: compactText(withoutPrefix.slice(tailSplit.index))
        };
      }
      return {
        learningActivities: cleaned,
        specificActivities: withoutPrefix
      };
    }

    return {
      learningActivities: cleaned,
      specificActivities: cleaned
    };
  }

  function extractReference(text) {
    const cleaned = compactText(text);
    if (!cleaned) return { reference: '', remaining: '' };
    const referenceMatch = cleaned.match(/\b(?:TIE|NECTA|MoEC|Teacher'?s Guide|Syllabus)\b[\s\S]*$/i);
    if (!referenceMatch || referenceMatch.index === undefined) {
      return { reference: '', remaining: cleaned };
    }
    return {
      reference: compactText(referenceMatch[0]),
      remaining: compactText(cleaned.slice(0, referenceMatch.index))
    };
  }

  function splitMethodsToolsAssessment(text) {
    const cleaned = compactText(text);
    if (!cleaned) return { methods: '', tools: '', assessment: '', remarks: '' };

    const lower = cleaned.toLowerCase();
    let assessmentIndex = -1;
    for (const hint of ASSESSMENT_HINTS) {
      const idx = lower.indexOf(hint);
      if (idx !== -1 && (assessmentIndex === -1 || idx < assessmentIndex)) assessmentIndex = idx;
    }

    const beforeAssessment = assessmentIndex === -1 ? cleaned : compactText(cleaned.slice(0, assessmentIndex));
    const assessment = assessmentIndex === -1 ? '' : compactText(cleaned.slice(assessmentIndex));

    const beforeLower = beforeAssessment.toLowerCase();
    let toolIndex = -1;
    for (const hint of TOOL_HINTS) {
      const idx = beforeLower.indexOf(hint);
      if (idx !== -1 && (toolIndex === -1 || idx < toolIndex)) toolIndex = idx;
    }

    let methods = '';
    let tools = '';
    if (toolIndex !== -1) {
      methods = compactText(beforeAssessment.slice(0, toolIndex));
      tools = compactText(beforeAssessment.slice(toolIndex));
    } else if (containsAny(beforeAssessment, METHOD_HINTS)) {
      methods = beforeAssessment;
    } else if (containsAny(beforeAssessment, TOOL_HINTS)) {
      tools = beforeAssessment;
    } else {
      methods = beforeAssessment;
    }

    return { methods, tools, assessment, remarks: '' };
  }

  function findNextRowStartIndex(segment) {
    const cleaned = compactText(segment);
    if (!cleaned) return -1;

    const candidates = [
      /\bTo facilitate pupil to\b/gi,
      /\bDemonstrate\b/gi,
      /\bDevelop\b/gi,
      /\bApply\b/gi,
      /\bAcquire\b/gi,
      /\bExplain\b/gi
    ];

    const afterRowHints = TOOL_HINTS.concat(ASSESSMENT_HINTS).concat(['tie', 'reference']);
    const possible = [];

    candidates.forEach((regex) => {
      findAllMatches(cleaned, regex).forEach((match) => {
        if (match.index !== undefined && match.index > 20) possible.push(match.index);
      });
    });

    possible.sort((a, b) => a - b);
    for (const index of possible) {
      const prefix = cleaned.slice(0, index).toLowerCase();
      if (afterRowHints.some((hint) => prefix.includes(hint))) {
        return index;
      }
    }

    return -1;
  }

  function isolateTableText(text) {
    const normalized = removeCalendarEvents(normalizeSpacedMonths(cleanWhitespace(text)));
    const headerMatch = normalized.match(/main competence[\s\S]{0,240}?remarks/i);
    const tableBody = headerMatch && headerMatch.index !== undefined
      ? normalized.slice(headerMatch.index + headerMatch[0].length)
      : normalized;
    return compactText(stripHeaderNoise(tableBody));
  }

  function buildRow(beforeText, afterText, anchor, previousRow) {
    const before = compactText(beforeText);
    const after = compactText(afterText);

    const learningIndex = before.search(/to facilitate pupil to/i);
    const competenceHead = learningIndex === -1 ? before : before.slice(0, learningIndex);
    const activityBody = learningIndex === -1 ? '' : before.slice(learningIndex);

    const competence = splitCompetenceHead(competenceHead, previousRow);
    const activities = splitLearningAndSpecific(activityBody);
    const refParts = extractReference(after);
    const methodsTools = splitMethodsToolsAssessment(refParts.remaining);

    const row = {
      sn: previousRow ? previousRow.sn + 1 : 1,
      mainCompetence: competence.mainCompetence || previousRow?.mainCompetence || '',
      specificCompetence: competence.specificCompetence || previousRow?.specificCompetence || '',
      learningActivities: activities.learningActivities || '',
      specificActivities: activities.specificActivities || '',
      month: titleCaseMonth(anchor.month || previousRow?.month || ''),
      week: String(anchor.week || ''),
      periods: firstNumeric(anchor.periods),
      methods: methodsTools.methods || '',
      tools: methodsTools.tools || '',
      assessment: methodsTools.assessment || '',
      reference: refParts.reference || previousRow?.reference || '',
      remarks: methodsTools.remarks || ''
    };

    if (!row.learningActivities && row.specificActivities) {
      row.learningActivities = `To facilitate pupil to ${row.specificActivities}`;
    }

    return row;
  }

  function parseRows(text) {
    const tableText = isolateTableText(text)
      .replace(/main competence/gi, ' ')
      .replace(/specific competence/gi, ' ')
      .replace(/learning activities/gi, ' ')
      .replace(/specific activities\s*\/?\s*content/gi, ' ')
      .replace(/teaching and learning methods/gi, ' ')
      .replace(/teaching and learning resources/gi, ' ')
      .replace(/assessment tools(?:\s*\/\s*criteria)?/gi, ' ')
      .replace(/references?/gi, ' ')
      .replace(/remarks/gi, ' ')
      .replace(/\s{2,}/g, ' ')
      .trim();

    const anchorRegex = /\b(?:(JANUARY|FEBRUARY|MARCH|APRIL|MAY|JUNE|JULY|AUGUST|SEPTEMBER|OCTOBER|NOVEMBER|DECEMBER)\s+)?([1-5])\s+([1-9]|1[0-2])\b/g;
    const anchors = findAllMatches(tableText, anchorRegex)
      .filter((match) => match.index !== undefined)
      .filter((match) => {
        const start = Math.max(0, (match.index || 0) - 180);
        const end = Math.min(tableText.length, (match.index || 0) + 260);
        const context = tableText.slice(start, end).toLowerCase();
        return context.includes('facilitate') || containsAny(context, TOOL_HINTS) || containsAny(context, ASSESSMENT_HINTS);
      })
      .map((match) => ({
        index: match.index,
        end: (match.index || 0) + match[0].length,
        month: match[1] || '',
        week: match[2],
        periods: match[3]
      }));

    const rows = [];
    if (!anchors.length) return rows;

    let carryPrefix = '';
    let cursor = 0;
    let previousRow = null;

    anchors.forEach((anchor, idx) => {
      const beforeRegion = compactText(tableText.slice(cursor, anchor.index));
      const beforeText = compactText(`${carryPrefix} ${beforeRegion}`);
      const nextAnchor = anchors[idx + 1];
      const between = compactText(tableText.slice(anchor.end, nextAnchor ? nextAnchor.index : tableText.length));
      const splitIndex = nextAnchor ? findNextRowStartIndex(between) : -1;
      const afterText = splitIndex === -1 ? between : compactText(between.slice(0, splitIndex));
      carryPrefix = splitIndex === -1 ? '' : compactText(between.slice(splitIndex));

      const row = buildRow(beforeText, afterText, anchor, previousRow);
      rows.push(row);
      previousRow = row;
      cursor = nextAnchor ? nextAnchor.index : tableText.length;
    });

    return rows.filter((row) =>
      row.learningActivities ||
      row.specificActivities ||
      row.methods ||
      row.tools ||
      row.assessment
    );
  }

  function rowsToMap(rows) {
    return (rows || []).reduce((acc, row, index) => {
      acc[`row${index + 1}`] = { ...row, sn: index + 1 };
      return acc;
    }, {});
  }

  function parseStructuredText(text) {
    const cleanedText = normalizeSpacedMonths(cleanWhitespace(text));
    const rows = parseRows(cleanedText);
    const generalObjectives = extractObjectives(cleanedText);
    const explicitAssessment = extractNamedSection(cleanedText, /assessment methods?/i);
    const explicitResources = extractNamedSection(cleanedText, /teaching resources?(?:\s*\/\s*materials?)?/i);

    const assessmentMethods = explicitAssessment || uniqueNonEmpty(rows.map((row) => row.assessment)).join('\n');
    const teachingResources = explicitResources || uniqueNonEmpty(rows.map((row) => row.tools)).join('\n');
    const hoursPerWeek = rows.find((row) => row.periods)?.periods || null;
    const totalWeeks = rows.length || null;

    return {
      generalObjectives,
      assessmentMethods,
      teachingResources,
      hoursPerWeek,
      totalWeeks,
      rows,
      rowsMap: rowsToMap(rows),
      sourceText: compactText(cleanedText)
    };
  }

  async function extractPdfText(buffer) {
    if (!global.pdfjsLib) {
      throw new Error('PDF library not available');
    }
    ensurePdfWorker();
    const pdf = await global.pdfjsLib.getDocument({ data: buffer }).promise;
    const pages = [];
    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
      const page = await pdf.getPage(pageNumber);
      const textContent = await page.getTextContent();
      const items = (textContent.items || [])
        .map((item) => ({
          str: String(item.str || '').trim(),
          x: Number(item.transform?.[4] || 0),
          y: Number(item.transform?.[5] || 0)
        }))
        .filter((item) => item.str);

      items.sort((a, b) => {
        const yDiff = Math.abs(b.y - a.y);
        if (yDiff > 2) return b.y - a.y;
        return a.x - b.x;
      });

      const lines = [];
      items.forEach((item) => {
        const current = lines[lines.length - 1];
        if (!current || Math.abs(current.y - item.y) > 3) {
          lines.push({ y: item.y, parts: [item] });
          return;
        }
        current.parts.push(item);
      });

      const text = lines
        .map((line) =>
          line.parts
            .sort((a, b) => a.x - b.x)
            .map((part) => part.str)
            .join(' ')
            .replace(/\s{2,}/g, ' ')
            .trim()
        )
        .filter(Boolean)
        .join('\n');

      pages.push({ pageNumber, text });
    }

    return {
      type: 'pdf',
      text: pages.map((page) => page.text).join('\n\n'),
      pageCount: pages.length
    };
  }

  async function extractDocxText(buffer) {
    if (!global.JSZip) {
      throw new Error('DOCX library not available');
    }
    const zip = await global.JSZip.loadAsync(buffer);
    const files = Object.keys(zip.files).filter((name) =>
      /^word\/(?:document|header\d+|footer\d+)\.xml$/i.test(name)
    );

    const parser = new DOMParser();
    const texts = [];
    for (const name of files) {
      const xml = await zip.files[name].async('string');
      const doc = parser.parseFromString(xml, 'application/xml');
      const paragraphs = Array.from(doc.getElementsByTagName('w:p'));
      paragraphs.forEach((paragraph) => {
        const values = Array.from(paragraph.getElementsByTagName('w:t'))
          .map((node) => node.textContent || '')
          .join(' ')
          .replace(/\s{2,}/g, ' ')
          .trim();
        if (values) texts.push(values);
      });
    }

    return {
      type: 'docx',
      text: texts.join('\n'),
      pageCount: null
    };
  }

  async function readFileAsArrayBuffer(file) {
    return file.arrayBuffer();
  }

  function inferExtension(meta) {
    const hint = String(meta?.name || meta?.type || meta?.url || '').toLowerCase();
    if (hint.includes('.docx') || hint.includes('wordprocessingml')) return 'docx';
    if (hint.includes('.doc')) return 'doc';
    return 'pdf';
  }

  async function parseArrayBuffer(buffer, meta) {
    const extension = inferExtension(meta);
    const extracted = extension === 'docx' ? await extractDocxText(buffer) : await extractPdfText(buffer);
    const parsed = parseStructuredText(extracted.text);
    return {
      ...parsed,
      extractionMeta: {
        sourceType: extracted.type,
        pageCount: extracted.pageCount,
        fileName: meta?.name || ''
      }
    };
  }

  async function parseFile(file) {
    const buffer = await readFileAsArrayBuffer(file);
    return parseArrayBuffer(buffer, {
      name: file?.name || '',
      type: file?.type || ''
    });
  }

  async function parseUrl(url, meta) {
    const response = await fetch(url, { credentials: 'omit' });
    if (!response.ok) {
      throw new Error('Unable to fetch the source scheme file');
    }
    const buffer = await response.arrayBuffer();
    return parseArrayBuffer(buffer, {
      url,
      name: meta?.name || url
    });
  }

  function mergeTemplateData(template, parsedData) {
    const rows =
      (template && template.rows && Object.keys(template.rows).length ? template.rows : null) ||
      parsedData?.rowsMap ||
      null;

    return {
      ...template,
      generalObjectives: compactText(template?.generalObjectives || parsedData?.generalObjectives || ''),
      assessmentMethods: compactText(template?.assessmentMethods || parsedData?.assessmentMethods || ''),
      teachingResources: compactText(template?.teachingResources || parsedData?.teachingResources || ''),
      hoursPerWeek: template?.hoursPerWeek || parsedData?.hoursPerWeek || null,
      totalWeeks: template?.totalWeeks || parsedData?.totalWeeks || null,
      rows,
      parsedTemplate: {
        generalObjectives: parsedData?.generalObjectives || '',
        assessmentMethods: parsedData?.assessmentMethods || '',
        teachingResources: parsedData?.teachingResources || '',
        hoursPerWeek: parsedData?.hoursPerWeek || null,
        totalWeeks: parsedData?.totalWeeks || null,
        rows: parsedData?.rowsMap || null,
        extractionMeta: parsedData?.extractionMeta || null
      }
    };
  }

  global.SomapSchemeTemplateParser = {
    parseFile,
    parseUrl,
    parseArrayBuffer,
    parseStructuredText,
    mergeTemplateData
  };
})(window);
