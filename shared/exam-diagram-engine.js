(function (global) {
  'use strict';

  const Shared = global.SoMApExamShared || global.SoMApExamTemplateEngine;

  function compactText(value) {
    return String(value == null ? '' : value).replace(/\s+/g, ' ').trim();
  }

  function escHtml(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function normalizeLookupToken(value) {
    return compactText(value).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  }

  // ---------------------------------------------------------------
  // Simple SVG diagram generators for primary school subjects
  // ---------------------------------------------------------------

  function buildBlankDiagram(label) {
    return `<svg viewBox="0 0 300 180" xmlns="http://www.w3.org/2000/svg" style="border:1px solid #ccc;background:#fff;max-width:100%;">
  <rect x="10" y="10" width="280" height="160" fill="#f8f9fa" stroke="#dee2e6" stroke-width="1"/>
  <text x="150" y="95" text-anchor="middle" font-family="Arial" font-size="13" fill="#6c757d">${escHtml(label || 'Diagram')}</text>
</svg>`;
  }

  function buildFoodChainDiagram() {
    const items = ['Sun', 'Grass', 'Grasshopper', 'Frog', 'Snake', 'Eagle'];
    const colors = ['#ffd700', '#28a745', '#6c757d', '#20c997', '#dc3545', '#6610f2'];
    let svg = `<svg viewBox="0 0 500 100" xmlns="http://www.w3.org/2000/svg" style="background:#fff;max-width:100%;">`;
    items.forEach((item, i) => {
      const x = 20 + i * 80;
      svg += `<rect x="${x}" y="30" width="60" height="40" rx="8" fill="${colors[i]}" opacity="0.8"/>`;
      svg += `<text x="${x + 30}" y="55" text-anchor="middle" font-family="Arial" font-size="10" fill="#fff">${item}</text>`;
      if (i < items.length - 1) {
        svg += `<text x="${x + 65}" y="55" text-anchor="middle" font-family="Arial" font-size="16" fill="#333">→</text>`;
      }
    });
    svg += `</svg>`;
    return svg;
  }

  function buildPlantPartsDiagram() {
    return `<svg viewBox="0 0 200 250" xmlns="http://www.w3.org/2000/svg" style="background:#fff;max-width:100%;">
  <!-- Roots -->
  <line x1="100" y1="200" x2="70" y2="240" stroke="#8B4513" stroke-width="2"/>
  <line x1="100" y1="200" x2="100" y2="245" stroke="#8B4513" stroke-width="2"/>
  <line x1="100" y1="200" x2="130" y2="240" stroke="#8B4513" stroke-width="2"/>
  <text x="145" y="235" font-family="Arial" font-size="10" fill="#333">Roots</text>
  <!-- Stem -->
  <line x1="100" y1="80" x2="100" y2="200" stroke="#6B8E23" stroke-width="4"/>
  <text x="108" y="160" font-family="Arial" font-size="10" fill="#333">Stem</text>
  <!-- Leaves -->
  <ellipse cx="65" cy="120" rx="30" ry="15" fill="#28a745" transform="rotate(-30 65 120)"/>
  <line x1="65" y1="120" x2="100" y2="140" stroke="#6B8E23" stroke-width="1.5"/>
  <text x="20" y="115" font-family="Arial" font-size="10" fill="#333">Leaf</text>
  <ellipse cx="135" cy="130" rx="30" ry="15" fill="#28a745" transform="rotate(30 135 130)"/>
  <line x1="135" y1="130" x2="100" y2="150" stroke="#6B8E23" stroke-width="1.5"/>
  <!-- Flower -->
  <circle cx="100" cy="55" r="20" fill="#ffd700" opacity="0.9"/>
  <circle cx="100" cy="55" r="8" fill="#ff8c00"/>
  <text x="125" y="50" font-family="Arial" font-size="10" fill="#333">Flower</text>
  <!-- Labels -->
  <text x="5" y="20" font-family="Arial" font-size="11" fill="#333" font-weight="bold">Parts of a Plant</text>
</svg>`;
  }

  function buildWaterCycleDiagram() {
    return `<svg viewBox="0 0 350 200" xmlns="http://www.w3.org/2000/svg" style="background:#e8f4fd;max-width:100%;">
  <!-- Sun -->
  <circle cx="300" cy="40" r="25" fill="#ffd700"/>
  <text x="300" y="80" text-anchor="middle" font-family="Arial" font-size="10" fill="#333">Sun</text>
  <!-- Cloud -->
  <ellipse cx="120" cy="35" rx="45" ry="22" fill="white" stroke="#aaa" stroke-width="1"/>
  <text x="120" y="75" text-anchor="middle" font-family="Arial" font-size="10" fill="#333">Cloud</text>
  <!-- Rain arrows -->
  <line x1="100" y1="58" x2="90" y2="110" stroke="#007bff" stroke-width="1.5" stroke-dasharray="4,2"/>
  <line x1="120" y1="58" x2="110" y2="110" stroke="#007bff" stroke-width="1.5" stroke-dasharray="4,2"/>
  <line x1="140" y1="58" x2="130" y2="110" stroke="#007bff" stroke-width="1.5" stroke-dasharray="4,2"/>
  <text x="60" y="105" font-family="Arial" font-size="10" fill="#007bff">Rain</text>
  <!-- Ground water -->
  <rect x="10" y="155" width="330" height="30" fill="#4a7c59" rx="5"/>
  <text x="80" y="175" font-family="Arial" font-size="10" fill="#fff">River / Ocean</text>
  <!-- Evaporation arrows -->
  <line x1="220" y1="155" x2="240" y2="90" stroke="#ff6b35" stroke-width="1.5" stroke-dasharray="4,2"/>
  <line x1="240" y1="155" x2="255" y2="90" stroke="#ff6b35" stroke-width="1.5" stroke-dasharray="4,2"/>
  <text x="255" y="130" font-family="Arial" font-size="10" fill="#ff6b35">Evaporation</text>
  <text x="5" y="20" font-family="Arial" font-size="11" fill="#333" font-weight="bold">The Water Cycle</text>
</svg>`;
  }

  function buildNumberLineDiagram(start, end) {
    const s = Number(start) || 0;
    const e = Number(end) || 10;
    const range = e - s;
    const w = 320;
    const step = w / range;
    let svg = `<svg viewBox="0 0 360 60" xmlns="http://www.w3.org/2000/svg" style="background:#fff;max-width:100%;">`;
    svg += `<line x1="20" y1="30" x2="340" y2="30" stroke="#333" stroke-width="2"/>`;
    for (let i = s; i <= e; i++) {
      const x = 20 + (i - s) * step;
      svg += `<line x1="${x}" y1="22" x2="${x}" y2="38" stroke="#333" stroke-width="2"/>`;
      svg += `<text x="${x}" y="52" text-anchor="middle" font-family="Arial" font-size="12" fill="#333">${i}</text>`;
    }
    svg += `</svg>`;
    return svg;
  }

  function buildMapCompassDiagram() {
    return `<svg viewBox="0 0 160 160" xmlns="http://www.w3.org/2000/svg" style="background:#fff;max-width:100%;">
  <circle cx="80" cy="80" r="70" fill="#f0f8ff" stroke="#333" stroke-width="2"/>
  <line x1="80" y1="15" x2="80" y2="145" stroke="#333" stroke-width="1.5"/>
  <line x1="15" y1="80" x2="145" y2="80" stroke="#333" stroke-width="1.5"/>
  <text x="80" y="12" text-anchor="middle" font-family="Arial" font-size="14" font-weight="bold" fill="#dc3545">N</text>
  <text x="80" y="155" text-anchor="middle" font-family="Arial" font-size="14" font-weight="bold" fill="#333">S</text>
  <text x="8" y="84" text-anchor="middle" font-family="Arial" font-size="14" font-weight="bold" fill="#333">W</text>
  <text x="152" y="84" text-anchor="middle" font-family="Arial" font-size="14" font-weight="bold" fill="#333">E</text>
  <polygon points="80,30 74,80 80,70 86,80" fill="#dc3545"/>
  <polygon points="80,130 74,80 80,90 86,80" fill="#666"/>
  <text x="80" y="80" text-anchor="middle" font-family="Arial" font-size="10" fill="#333">Compass</text>
</svg>`;
  }

  const DIAGRAM_MAP = {
    'food chain': buildFoodChainDiagram,
    'water cycle': buildWaterCycleDiagram,
    'plant': buildPlantPartsDiagram,
    'compass': buildMapCompassDiagram,
    'number line': () => buildNumberLineDiagram(0, 10),
    'map': buildMapCompassDiagram
  };

  function createDiagramQuestion(options) {
    const settings = options && typeof options === 'object' ? options : {};
    const topic = compactText(settings.topic || '');
    const subject = normalizeLookupToken(settings.subject || '');
    const topicToken = normalizeLookupToken(topic);

    // Find matching diagram generator
    let svgHtml = null;
    for (const [key, generator] of Object.entries(DIAGRAM_MAP)) {
      if (topicToken.includes(key) || subject.includes(key)) {
        try { svgHtml = generator(); } catch (_) {}
        break;
      }
    }

    // Default blank diagram with label if no match
    if (!svgHtml) {
      if (subject.includes('math') || subject.includes('arithmetic')) {
        svgHtml = buildNumberLineDiagram(0, 20);
      } else if (subject.includes('science')) {
        svgHtml = buildPlantPartsDiagram();
      } else if (subject.includes('geography') || subject.includes('social')) {
        svgHtml = buildMapCompassDiagram();
      } else {
        svgHtml = buildBlankDiagram(`Label the diagram: ${topic}`);
      }
    }

    return {
      prompt: `Study the diagram below and answer: Label or describe what is shown in the diagram about ${topic || 'the topic studied'}.`,
      answer: `Students should correctly label or describe the key parts shown in the diagram related to ${topic}.`,
      diagram: { svg: svgHtml, type: 'inline_svg' }
    };
  }

  const api = {
    createDiagramQuestion,
    buildFoodChainDiagram,
    buildPlantPartsDiagram,
    buildWaterCycleDiagram,
    buildNumberLineDiagram,
    buildMapCompassDiagram
  };

  global.SoMApExamDiagramEngine = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
