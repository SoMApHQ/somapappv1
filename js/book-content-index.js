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
    const raw = cleanLine(line);
    const markedHeading = /^\[\[HEADING\]\]\s*/.test(raw);
    const text = raw.replace(/^\[\[HEADING\]\]\s*/, '').trim();
    if (!text || text.length < 3 || text.length > 110) return false;
    if (/^(?:learning objectives?|by the end|activity|exercise|homework|questions?|summary|vocabulary|key words?|word|simple meaning|introduction|teacher(?:'s)? (?:note|point)|what to do|questions to discuss|story questions|end of chapter|section [a-z]|annex)\b/i.test(text)) return false;
    if (/^(?:what|why|how|where|when|who|which|name|state|mention|list|explain|describe|differentiate|draw|write|give|identify|observe|discuss)\b/i.test(text) || /\?$/.test(text)) return false;
    if (/^[•-]\s*/.test(text)) return false;
    const numbered = /^\d+(?:\.\d+)*[.)]\s+([A-Z].*)/.exec(text);
    if (numbered) {
      // Articles are common at the start of real book headings (for example,
      // "1. The Concept of ..."). Question verbs and question marks are the
      // useful distinction here; rejecting The/A/An drops valid subtopics.
      if (/^(?:what|why|how|where|when|who|which|name|state|mention|list|explain|describe|differentiate|draw|write|give|identify|observe|discuss)\b/i.test(numbered[1]) || /\?$/.test(numbered[1])) return false;
      return markedHeading;
    }
    if (markedHeading) {
      if (/^(?:meaning|use|examples?|type of operator|function(?: in digestion)?|part|no|answer|list [ab]|decision block|scratch loop|shape|number of sides|turning angle)\b/i.test(text)) return false;
      const words = text.split(/\s+/).filter(Boolean);
      return words.length <= 14;
    }
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
    const localName = (node) => String(node?.localName || node?.nodeName || '').split(':').pop();
    const descendants = (node, name) => Array.from(node?.getElementsByTagName?.('*') || [])
      .filter((child) => localName(child) === name);
    const paragraphText = (paragraph) => {
      let value = '';
      const superMap = { '0': '⁰', '1': '¹', '2': '²', '3': '³', '4': '⁴', '5': '⁵', '6': '⁶', '7': '⁷', '8': '⁸', '9': '⁹', '+': '⁺', '-': '⁻', '=': '⁼', '(': '⁽', ')': '⁾', n: 'ⁿ', i: 'ⁱ' };
      const subMap = { '0': '₀', '1': '₁', '2': '₂', '3': '₃', '4': '₄', '5': '₅', '6': '₆', '7': '₇', '8': '₈', '9': '₉', '+': '₊', '-': '₋', '=': '₌', '(': '₍', ')': '₎', a: 'ₐ', e: 'ₑ', h: 'ₕ', i: 'ᵢ', j: 'ⱼ', k: 'ₖ', l: 'ₗ', m: 'ₘ', n: 'ₙ', o: 'ₒ', p: 'ₚ', r: 'ᵣ', s: 'ₛ', t: 'ₜ', u: 'ᵤ', v: 'ᵥ', x: 'ₓ' };
      const transformScript = (text, map) => Array.from(text).map((character) => map[character] || character).join('');
      const runText = (run) => {
        let result = '';
        const collect = (node) => Array.from(node?.childNodes || []).forEach((child) => {
          const name = localName(child);
          if (name === 't') result += child.textContent || '';
          else if (name === 'tab') result += '\t';
          else if (name === 'br' && String(child.getAttribute?.('w:type') || child.getAttribute?.('type') || '').toLowerCase() !== 'page') result += '\n';
          else collect(child);
        });
        collect(run);
        const vertical = descendants(run, 'vertAlign')[0];
        const verticalValue = String(vertical?.getAttribute('w:val') || vertical?.getAttribute('val') || '').toLowerCase();
        if (verticalValue === 'superscript') return transformScript(result, superMap);
        if (verticalValue === 'subscript') return transformScript(result, subMap);
        return result;
      };
      const mathText = (node) => {
        const name = localName(node);
        const children = Array.from(node?.childNodes || []).filter((child) => child.nodeType === 1);
        const childByName = (wanted) => children.find((child) => localName(child) === wanted);
        if (name === 'r') return runText(node);
        if (name === 't') return node.textContent || '';
        if (/Pr$/.test(name)) return '';
        if (name === 'f') {
          const numerator = mathText(childByName('num'));
          const denominator = mathText(childByName('den'));
          return `(${numerator})/(${denominator})`;
        }
        if (name === 'rad') return `√(${mathText(childByName('e'))})`;
        if (name === 'sSup') return `${mathText(childByName('e'))}${transformScript(mathText(childByName('sup')), superMap)}`;
        if (name === 'sSub') return `${mathText(childByName('e'))}${transformScript(mathText(childByName('sub')), subMap)}`;
        if (name === 'sSubSup') {
          return `${mathText(childByName('e'))}${transformScript(mathText(childByName('sub')), subMap)}${transformScript(mathText(childByName('sup')), superMap)}`;
        }
        if (name === 'nary') {
          const character = descendants(node, 'chr')[0]?.getAttribute('m:val') || descendants(node, 'chr')[0]?.getAttribute('val') || '∑';
          return `${character}${transformScript(mathText(childByName('sub')), subMap)}${transformScript(mathText(childByName('sup')), superMap)}${mathText(childByName('e'))}`;
        }
        return children.map(mathText).join('');
      };
      const walk = (node) => {
        Array.from(node?.childNodes || []).forEach((child) => {
          const name = localName(child);
          if (name === 'oMath' || name === 'oMathPara') value += mathText(child);
          else if (name === 'r') value += runText(child);
          else if (name === 't') value += child.textContent || '';
          else if (name === 'tab') value += '\t';
          else if (name === 'br' && String(child.getAttribute?.('w:type') || child.getAttribute?.('type') || '').toLowerCase() !== 'page') value += '\n';
          else walk(child);
        });
      };
      walk(paragraph);
      return value.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
    };
    const appendImages = async (container, targetLineIndex) => {
      const relationshipIds = new Set();
      descendants(container, 'blip').forEach((node) => {
        const id = node.getAttribute('r:embed') || node.getAttribute('embed') || '';
        if (id) relationshipIds.add(id);
      });
      descendants(container, 'imagedata').forEach((node) => {
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
        blocks.push({ type: 'image', dataUrl, lineIndex: targetLineIndex, alt: `Book illustration near section ${targetLineIndex + 1}` });
      }
    };
    const appendPageBreaks = (container) => {
      const renderedBreaks = descendants(container, 'lastRenderedPageBreak').length;
      const manualBreaks = descendants(container, 'br').filter((node) =>
        String(node.getAttribute('w:type') || node.getAttribute('type') || '').toLowerCase() === 'page'
      ).length;
      for (let index = 0; index < renderedBreaks + manualBreaks; index += 1) {
        textLines.push('[[PAGE_BREAK]]');
        blocks.push({ type: 'pageBreak', lineIndex });
      }
    };
    const body = descendants(documentXml, 'body')[0];
    const bodyChildren = Array.from(body?.childNodes || []).filter((node) => node.nodeType === 1);
    for (const child of bodyChildren) {
      const childName = localName(child);
      if (childName === 'p') {
        appendPageBreaks(child);
        const text = paragraphText(child);
        const styleNode = descendants(child, 'pStyle')[0];
        const styleName = styleNode?.getAttribute('w:val') || styleNode?.getAttribute('val') || '';
        const bold = descendants(child, 'b').some((node) => {
          const value = String(node.getAttribute('w:val') || node.getAttribute('val') || 'true').toLowerCase();
          return !['0', 'false', 'off', 'none'].includes(value);
        });
        const underlined = descendants(child, 'u').length > 0;
        const nonBlackColor = descendants(child, 'color').some((node) => {
          const value = String(node.getAttribute('w:val') || node.getAttribute('val') || '').replace(/^#/, '').toLowerCase();
          const theme = String(node.getAttribute('w:themeColor') || node.getAttribute('themeColor') || '').toLowerCase();
          if (theme && !['text1', 'dark1'].includes(theme)) return true;
          return Boolean(value) && !['auto', '000', '000000', '00000000'].includes(value);
        });
        // The classbooks consistently use bold, coloured text for numbered
        // subtopic headings. Preserve that visual signal in the plain-text
        // index alongside normal Word heading styles and bold+underline.
        const numberedTitle = /^\s*\d+(?:\.\d+)*[.)]\s+\S/.test(text);
        const shortTitle = text.length <= 110
          && text.split(/\s+/).filter(Boolean).length <= 14
          && !/[?!]$/.test(text);
        const emphasized = /heading|title/i.test(styleName)
          || (bold && underlined)
          || (bold && nonBlackColor && (numberedTitle || shortTitle));
        if (text) {
          const listText = descendants(child, 'numPr').length && !/^(?:[-•]|\d+[.)])\s*/.test(text)
            ? `• ${text}`
            : text;
          const markedText = emphasized && !/^(?:chapter|topic|unit)\b/i.test(listText)
            ? `[[HEADING]] ${listText}`
            : listText;
          textLines.push(markedText);
          blocks.push({ type: 'text', text: markedText, lineIndex, heading: emphasized });
        }
        await appendImages(child, lineIndex);
        if (text) lineIndex += 1;
      } else if (childName === 'tbl') {
        appendPageBreaks(child);
        const rows = descendants(child, 'tr').map((row) => descendants(row, 'tc').map((cell) => {
          const paragraphs = descendants(cell, 'p').map(paragraphText).filter(Boolean);
          return paragraphs.join('\n').trim();
        })).filter((row) => row.some(Boolean));
        if (rows.length) {
          const tableId = `table_${blocks.filter((block) => block.type === 'table').length + 1}`;
          textLines.push(`[[TABLE:${tableId}]]`);
          blocks.push({ type: 'table', id: tableId, rows, lineIndex });
          await appendImages(child, lineIndex);
          lineIndex += 1;
        }
      }
    }
    return { text: textLines.join('\n'), blocks };
  }

  async function extractDocxText(arrayBuffer) {
    return (await extractDocxContent(arrayBuffer)).text;
  }

  global.SomapBookContentIndex = { parse, parseToc, parseHeadingFallback, extractDocxContent, extractDocxText, cleanLine, normalize };
})(window);
