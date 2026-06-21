(function (global) {
  'use strict';

  const CHAPTER_WORDS = {
    one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8,
    nine: 9, ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15,
    sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19, twenty: 20,
    'twenty-one': 21, 'twenty-two': 22, 'twenty-three': 23, 'twenty-four': 24,
    'twenty-five': 25, 'twenty-six': 26, 'twenty-seven': 27, 'twenty-eight': 28,
    'twenty-nine': 29, thirty: 30
  };

  const ROMAN_NUMBERS = {
    i: 1, ii: 2, iii: 3, iv: 4, v: 5, vi: 6, vii: 7, viii: 8, ix: 9, x: 10,
    xi: 11, xii: 12, xiii: 13, xiv: 14, xv: 15, xvi: 16, xvii: 17, xviii: 18,
    xix: 19, xx: 20
  };

  const SECTION_LABEL = '(chapter|topic|unit)';
  const SECTION_NUMBER = '([a-z]+(?:-[a-z]+)?|[ivxlcdm]+|\\d+)';

  function cleanLine(value) {
    return String(value || '')
      .replace(/\u00a0/g, ' ')
      .replace(/^[\u2022\u2023\u25cf\u25e6\u25aa\-]+\s*/, '')
      .replace(/[ \t]+/g, ' ')
      .trim();
  }

  function normalize(value) {
    return cleanLine(value).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  }

  function chapterNumber(token) {
    const value = String(token || '').toLowerCase();
    return Number(value) || CHAPTER_WORDS[value] || ROMAN_NUMBERS[value] || 0;
  }

  function usefulTopic(value) {
    const text = cleanLine(value).replace(/^\[\[HEADING\]\]\s*/, '').replace(/\s+\d{1,4}$/, '').trim();
    if (!text || /^(main topic|topic|page)$/i.test(text)) return '';
    return text;
  }

  function parseToc(lines) {
    const tocStart = lines.findIndex((line) => /^(?:table of contents|contents)\s*[:.-]?$/i.test(line.replace(/^\[\[HEADING\]\]\s*/, '')));
    if (tocStart === -1) return { entries: [], start: -1, end: -1 };
    const entries = [];
    let tocEnd = Math.min(lines.length, tocStart + 120);

    for (let index = tocStart + 1; index < Math.min(lines.length, tocStart + 120); index += 1) {
      const line = lines[index];
      if (/teacher'?s note(?: on the table of contents)?/i.test(line)) {
        tocEnd = index + 1;
        break;
      }
      if (/^(?:chapter|topic|unit)\s+(?:main topic|title|topic)\s+page$/i.test(line) || /^(?:chapter|unit|main topic|topic|title|page)$/i.test(line)) continue;

      const chapterMatch = line.match(new RegExp(`^(?:\\[\\[HEADING\\]\\]\\s*)?${SECTION_LABEL}\\s+${SECTION_NUMBER}\\s*(?:[:.\\-]\\s*)?(.*)$`, 'i'));
      if (!chapterMatch) continue;
      const sectionType = chapterMatch[1];
      const sectionToken = chapterMatch[2];
      const number = chapterNumber(sectionToken);
      if (!number) continue;

      let remainder = cleanLine(chapterMatch[3]);
      let page = '';
      const pageMatch = remainder.match(/\s+(\d{1,4})$/);
      if (pageMatch) {
        page = pageMatch[1];
        remainder = remainder.slice(0, pageMatch.index).trim();
      }

      if (!remainder) {
        let cursor = index + 1;
        while (cursor < Math.min(lines.length, index + 5) && (!remainder || !page)) {
          if (/^(?:chapter|topic|unit)\s+/i.test(lines[cursor]) || /teacher'?s note/i.test(lines[cursor])) break;
          if (/^\d{1,4}$/.test(lines[cursor])) page = lines[cursor];
          else if (!remainder) remainder = usefulTopic(lines[cursor]);
          cursor += 1;
        }
      }

      const fullTopic = usefulTopic(remainder);
      if (!fullTopic) continue;
      const topicParts = fullTopic.split(/\s*:\s*/);
      const topic = topicParts.shift() || fullTopic;
      const tocSubtopics = topicParts.join(':').split(/\s*[,;]\s*/).map(cleanLine).filter(Boolean);
      entries.push({
        number,
        chapter: `${sectionType[0].toUpperCase()}${sectionType.slice(1).toLowerCase()} ${sectionToken}`,
        topic,
        tocSubtopics,
        tocPage: page,
        tocLine: index
      });
    }
    return { entries, start: tocStart, end: tocEnd };
  }

  function parseHeadingFallback(lines) {
    const entries = [];
    lines.forEach((line, index) => {
      const match = line.match(new RegExp(`^(?:\\[\\[HEADING\\]\\]\\s*)?${SECTION_LABEL}\\s+${SECTION_NUMBER}\\s*(?:[:.\\-]\\s*)?(.+)$`, 'i'));
      if (!match) return;
      const number = chapterNumber(match[2]);
      const topic = usefulTopic(match[3]);
      if (!number || !topic || entries.some((entry) => entry.number === number)) return;
      entries.push({
        number,
        chapter: `${match[1][0].toUpperCase()}${match[1].slice(1).toLowerCase()} ${match[2]}`,
        topic,
        tocSubtopics: [],
        tocPage: '',
        tocLine: index,
        bodyStart: index
      });
    });
    return { entries, start: -1, end: 0 };
  }

  function headingScore(line, entry) {
    const normalized = normalize(line);
    if (!normalized) return 0;
    const chapterPrefix = `chapter ${entry.number}`;
    const wordPrefix = normalize(entry.chapter);
    let score = 0;
    if (normalized.startsWith(chapterPrefix) || normalized.startsWith(wordPrefix)) score += 8;
    const topicTokens = normalize(entry.topic).split(' ').filter((token) => token.length > 3);
    topicTokens.forEach((token) => { if (normalized.includes(token)) score += 1; });
    if (normalized === normalize(entry.topic)) score += 6;
    return score;
  }

  function isSubtopicHeading(line) {
    const text = cleanLine(line);
    if (!text || text.length < 3 || text.length > 110) return false;
    if (/^(?:learning objectives?|by the end|activity|exercise|questions?|summary|vocabulary|chapter)\b/i.test(text)) return false;
    if (/^\[\[HEADING\]\]\s*/.test(text)) return true;
    if (/^\d+(?:\.\d+)*[.)]\s+[A-Z]/.test(text)) return true;
    const letters = text.replace(/[^A-Za-z]/g, '');
    const words = text.split(/\s+/).filter(Boolean);
    return letters.length >= 4 && words.length <= 10 && text === text.toUpperCase();
  }

  function subtopicTitle(line) {
    return cleanLine(line)
      .replace(/^\[\[HEADING\]\]\s*/, '')
      .replace(/^\d+(?:\.\d+)*[.)]\s*/, '')
      .replace(/[:.\-]+$/, '')
      .trim();
  }

  function buildChapterRanges(lines, toc, linePages = []) {
    const chapters = toc.entries.map((entry) => ({
      ...entry,
      bodyStart: Number.isInteger(entry.bodyStart) ? entry.bodyStart : -1
    }));
    chapters.forEach((entry) => {
      if (entry.bodyStart >= 0) return;
      let best = { index: -1, score: 0 };
      for (let index = Math.max(toc.end, entry.tocLine + 1); index < lines.length; index += 1) {
        const score = headingScore(lines[index], entry);
        if (score > best.score) best = { index, score };
        if (score >= 10) break;
      }
      entry.bodyStart = best.score >= 6 ? best.index : -1;
    });

    const ranged = chapters.map((entry, position) => {
      const nextStart = chapters.slice(position + 1).find((candidate) => candidate.bodyStart > entry.bodyStart)?.bodyStart;
      const bodyStart = entry.bodyStart >= 0 ? entry.bodyStart : entry.tocLine;
      const bodyEnd = nextStart !== undefined ? nextStart - 1 : lines.length - 1;
      const headings = [];
      for (let index = bodyStart + 1; index <= bodyEnd; index += 1) {
        if (isSubtopicHeading(lines[index])) headings.push({ title: subtopicTitle(lines[index]), line: index });
      }
      let subtopics = headings.map((heading, index) => ({
        title: heading.title,
        sectionStart: heading.line + 1,
        sectionEnd: (headings[index + 1]?.line || bodyEnd + 1)
      }));
      if (!subtopics.length && entry.tocSubtopics?.length) {
        subtopics = entry.tocSubtopics.map((title) => ({
          title,
          sectionStart: bodyStart + 1,
          sectionEnd: bodyEnd + 1
        }));
      }
      return {
        ...entry,
        sectionStart: bodyStart + 1,
        sectionEnd: bodyEnd + 1,
        subtopics
      };
    });
    const pageAnchor = ranged.find((entry) => Number(entry.tocPage) && entry.bodyStart >= 0 && linePages[entry.bodyStart]);
    const printedPageOffset = pageAnchor
      ? Number(pageAnchor.tocPage) - Number(linePages[pageAnchor.bodyStart])
      : 0;
    const resolvedPageStart = (entry) => {
      const tocPage = Number(entry?.tocPage) || 0;
      const renderedPage = Number(linePages[entry?.bodyStart]) || 0;
      return tocPage || (renderedPage ? renderedPage + printedPageOffset : 0);
    };

    return ranged.map((entry, index) => {
      const pageStart = resolvedPageStart(entry) || entry.sectionStart;
      const nextPageStart = resolvedPageStart(ranged[index + 1]);
      const lastRenderedPage = Number(linePages[lines.length - 1]) || 0;
      const pageEnd = nextPageStart > pageStart
        ? nextPageStart - 1
        : Math.max(pageStart, lastRenderedPage ? lastRenderedPage + printedPageOffset : entry.sectionEnd);
      return { ...entry, pageStart, pageEnd };
    });
  }

  function parse(text) {
    const sourceLines = String(text || '').replace(/\r/g, '').split('\n').map(cleanLine).filter(Boolean);
    const lines = [];
    const linePages = [];
    let renderedPage = 1;
    sourceLines.forEach((line) => {
      if (line === '[[PAGE_BREAK]]') {
        renderedPage += 1;
        return;
      }
      lines.push(line);
      linePages.push(renderedPage);
    });
    let toc = parseToc(lines);
    if (!toc.entries.length) toc = parseHeadingFallback(lines);
    return {
      lines,
      linePages,
      chapters: buildChapterRanges(lines, toc, linePages),
      hasTableOfContents: toc.start >= 0,
      usedHeadingFallback: toc.start < 0 && toc.entries.length > 0
    };
  }

  function resolveZipTarget(basePath, target) {
    const parts = `${basePath}/${target}`.replace(/\\/g, '/').split('/');
    const resolved = [];
    parts.forEach((part) => {
      if (!part || part === '.') return;
      if (part === '..') resolved.pop();
      else resolved.push(part);
    });
    return resolved.join('/');
  }

  async function extractDocxContent(arrayBuffer) {
    if (!global.JSZip) throw new Error('DOCX library is not available');
    const zip = await global.JSZip.loadAsync(arrayBuffer);
    const xmlFile = zip.file('word/document.xml');
    if (!xmlFile) throw new Error('The Word document has no readable document body');
    const xml = await xmlFile.async('string');
    const documentXml = new DOMParser().parseFromString(xml, 'application/xml');
    const relationships = new Map();
    const relationshipFile = zip.file('word/_rels/document.xml.rels');
    if (relationshipFile) {
      const relationshipXml = new DOMParser().parseFromString(await relationshipFile.async('string'), 'application/xml');
      Array.from(relationshipXml.getElementsByTagName('Relationship')).forEach((relationship) => {
        relationships.set(relationship.getAttribute('Id') || '', relationship.getAttribute('Target') || '');
      });
    }
    const mimeTypes = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', svg: 'image/svg+xml', webp: 'image/webp' };
    const textLines = [];
    const blocks = [];
    let lineIndex = 0;
    const paragraphs = Array.from(documentXml.getElementsByTagName('w:p'));
    for (const paragraph of paragraphs) {
        const text = Array.from(paragraph.getElementsByTagName('w:t'))
          .map((node) => node.textContent || '')
          .join(' ')
          .replace(/\s{2,}/g, ' ')
          .trim();
        const renderedBreaks = paragraph.getElementsByTagName('w:lastRenderedPageBreak').length;
        const manualBreaks = Array.from(paragraph.getElementsByTagName('w:br')).filter((node) =>
          (node.getAttribute('w:type') || node.getAttribute('type') || '').toLowerCase() === 'page'
        ).length;
        for (let index = 0; index < renderedBreaks + manualBreaks; index += 1) {
          textLines.push('[[PAGE_BREAK]]');
          blocks.push({ type: 'pageBreak', lineIndex });
        }
        const styleNode = paragraph.getElementsByTagName('w:pStyle')[0];
        const styleName = styleNode?.getAttribute('w:val') || styleNode?.getAttribute('val') || '';
        const emphasized = /heading|title/i.test(styleName)
          || paragraph.getElementsByTagName('w:b').length > 0
          || paragraph.getElementsByTagName('w:u').length > 0;
        if (text) {
          const markedText = emphasized && !/^(?:chapter|topic|unit)\b/i.test(text)
            ? `[[HEADING]] ${text}`
            : text;
          textLines.push(markedText);
          blocks.push({ type: 'text', text: markedText, lineIndex, heading: emphasized });
        }

        const relationshipIds = new Set();
        Array.from(paragraph.getElementsByTagName('a:blip')).forEach((node) => {
          const id = node.getAttribute('r:embed') || node.getAttribute('embed') || '';
          if (id) relationshipIds.add(id);
        });
        Array.from(paragraph.getElementsByTagName('v:imagedata')).forEach((node) => {
          const id = node.getAttribute('r:id') || node.getAttribute('id') || '';
          if (id) relationshipIds.add(id);
        });
        for (const relationshipId of relationshipIds) {
          const target = relationships.get(relationshipId);
          const mediaPath = target ? resolveZipTarget('word', target) : '';
          const mediaFile = mediaPath ? zip.file(mediaPath) : null;
          if (!mediaFile) continue;
          const extension = mediaPath.split('.').pop().toLowerCase();
          const mimeType = mimeTypes[extension];
          if (!mimeType) continue;
          const dataUrl = `data:${mimeType};base64,${await mediaFile.async('base64')}`;
          blocks.push({ type: 'image', dataUrl, lineIndex, alt: `Book illustration near section ${lineIndex + 1}` });
        }
        if (text) lineIndex += 1;
    }
    return { text: textLines.join('\n'), blocks };
  }

  async function extractDocxText(arrayBuffer) {
    return (await extractDocxContent(arrayBuffer)).text;
  }

  global.SomapBookContentIndex = { parse, parseToc, parseHeadingFallback, extractDocxContent, extractDocxText, cleanLine, normalize };
})(window);
