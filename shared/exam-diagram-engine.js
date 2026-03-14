(function (global) {
  'use strict';

  const Shared = global.SoMApExamShared || global.SoMApExamTemplateEngine;

  function compactText(value) {
    return Shared ? Shared.compactText(value) : String(value == null ? '' : value).replace(/\s+/g, ' ').trim();
  }

  function normalizeLookupToken(value) {
    return Shared ? Shared.normalizeLookupToken(value) : compactText(value).toLowerCase();
  }

  function escHtml(value) {
    return Shared ? Shared.escHtml(value) : String(value == null ? '' : value);
  }

  function wrapSvg(body, width, height) {
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="Exam diagram">${body}</svg>`;
  }

  function buildShapeDiagram() {
    return {
      kind: 'shape_identification',
      svg: wrapSvg(
        [
          '<rect x="10" y="10" width="380" height="220" rx="18" fill="#f8fafc" stroke="#0f172a" stroke-width="2"/>',
          '<text x="28" y="40" font-size="18" font-family="Arial" fill="#0f172a">Which shape is shown?</text>',
          '<polygon points="200,70 290,190 110,190" fill="#dbeafe" stroke="#1d4ed8" stroke-width="4"/>'
        ].join(''),
        400,
        240
      ),
      answer: 'Triangle',
      labels: ['Triangle'],
      instructions: 'Study the shape and write its name.'
    };
  }

  function buildPlantDiagram(topic) {
    const cleanTopic = compactText(topic || 'plant');
    return {
      kind: 'label_diagram',
      svg: wrapSvg(
        [
          '<rect x="10" y="10" width="430" height="250" rx="18" fill="#f8fafc" stroke="#14532d" stroke-width="2"/>',
          `<text x="24" y="38" font-size="18" font-family="Arial" fill="#14532d">Label the main parts of the ${escHtml(cleanTopic.toLowerCase())}.</text>`,
          '<line x1="220" y1="68" x2="220" y2="180" stroke="#166534" stroke-width="8"/>',
          '<ellipse cx="220" cy="62" rx="58" ry="26" fill="#86efac" stroke="#166534" stroke-width="4"/>',
          '<ellipse cx="168" cy="100" rx="40" ry="20" fill="#bbf7d0" stroke="#166534" stroke-width="3"/>',
          '<ellipse cx="272" cy="100" rx="40" ry="20" fill="#bbf7d0" stroke="#166534" stroke-width="3"/>',
          '<line x1="220" y1="180" x2="190" y2="228" stroke="#92400e" stroke-width="6"/>',
          '<line x1="220" y1="180" x2="220" y2="236" stroke="#92400e" stroke-width="6"/>',
          '<line x1="220" y1="180" x2="250" y2="228" stroke="#92400e" stroke-width="6"/>',
          '<text x="24" y="88" font-size="14" font-family="Arial" fill="#0f172a">A</text><line x1="40" y1="84" x2="158" y2="84" stroke="#0f172a" stroke-width="2"/>',
          '<text x="366" y="68" font-size="14" font-family="Arial" fill="#0f172a">B</text><line x1="320" y1="64" x2="278" y2="64" stroke="#0f172a" stroke-width="2"/>',
          '<text x="366" y="136" font-size="14" font-family="Arial" fill="#0f172a">C</text><line x1="320" y1="132" x2="228" y2="132" stroke="#0f172a" stroke-width="2"/>',
          '<text x="36" y="228" font-size="14" font-family="Arial" fill="#0f172a">D</text><line x1="52" y1="224" x2="184" y2="224" stroke="#0f172a" stroke-width="2"/>'
        ].join(''),
        450,
        270
      ),
      answer: 'A Leaf, B Flower, C Stem, D Root',
      labels: ['Leaf', 'Flower', 'Stem', 'Root'],
      instructions: 'Write the correct label for each letter.'
    };
  }

  function buildBodyPartDiagram() {
    return {
      kind: 'identify_part',
      svg: wrapSvg(
        [
          '<rect x="10" y="10" width="420" height="270" rx="18" fill="#f8fafc" stroke="#7c2d12" stroke-width="2"/>',
          '<text x="24" y="38" font-size="18" font-family="Arial" fill="#7c2d12">Identify the labeled body parts.</text>',
          '<circle cx="215" cy="70" r="32" fill="#fde68a" stroke="#92400e" stroke-width="3"/>',
          '<line x1="215" y1="102" x2="215" y2="190" stroke="#92400e" stroke-width="7"/>',
          '<line x1="215" y1="128" x2="148" y2="160" stroke="#92400e" stroke-width="6"/>',
          '<line x1="215" y1="128" x2="282" y2="160" stroke="#92400e" stroke-width="6"/>',
          '<line x1="215" y1="190" x2="172" y2="245" stroke="#92400e" stroke-width="6"/>',
          '<line x1="215" y1="190" x2="258" y2="245" stroke="#92400e" stroke-width="6"/>',
          '<text x="52" y="72" font-size="14" font-family="Arial" fill="#111827">A</text><line x1="66" y1="68" x2="180" y2="68" stroke="#111827" stroke-width="2"/>',
          '<text x="344" y="156" font-size="14" font-family="Arial" fill="#111827">B</text><line x1="316" y1="152" x2="286" y2="152" stroke="#111827" stroke-width="2"/>',
          '<text x="344" y="246" font-size="14" font-family="Arial" fill="#111827">C</text><line x1="316" y1="242" x2="264" y2="242" stroke="#111827" stroke-width="2"/>'
        ].join(''),
        440,
        290
      ),
      answer: 'A Head, B Hand, C Leg',
      labels: ['Head', 'Hand', 'Leg'],
      instructions: 'Name the part shown by each letter.'
    };
  }

  function buildLifecycleDiagram(topic) {
    const clean = compactText(topic || 'life cycle');
    return {
      kind: 'lifecycle_order',
      svg: wrapSvg(
        [
          '<rect x="10" y="10" width="470" height="220" rx="18" fill="#f8fafc" stroke="#0f172a" stroke-width="2"/>',
          `<text x="24" y="38" font-size="18" font-family="Arial" fill="#0f172a">Arrange the stages of the ${escHtml(clean.toLowerCase())} in order.</text>`,
          '<rect x="34" y="88" width="90" height="56" rx="12" fill="#dbeafe" stroke="#1d4ed8" stroke-width="3"/>',
          '<rect x="146" y="88" width="90" height="56" rx="12" fill="#fef3c7" stroke="#ca8a04" stroke-width="3"/>',
          '<rect x="258" y="88" width="90" height="56" rx="12" fill="#dcfce7" stroke="#15803d" stroke-width="3"/>',
          '<rect x="370" y="88" width="90" height="56" rx="12" fill="#fee2e2" stroke="#b91c1c" stroke-width="3"/>',
          '<text x="77" y="122" font-size="15" text-anchor="middle" font-family="Arial" fill="#0f172a">1</text>',
          '<text x="191" y="122" font-size="15" text-anchor="middle" font-family="Arial" fill="#0f172a">2</text>',
          '<text x="303" y="122" font-size="15" text-anchor="middle" font-family="Arial" fill="#0f172a">3</text>',
          '<text x="415" y="122" font-size="15" text-anchor="middle" font-family="Arial" fill="#0f172a">4</text>',
          '<line x1="124" y1="116" x2="146" y2="116" stroke="#0f172a" stroke-width="2"/><polygon points="146,116 138,112 138,120" fill="#0f172a"/>',
          '<line x1="236" y1="116" x2="258" y2="116" stroke="#0f172a" stroke-width="2"/><polygon points="258,116 250,112 250,120" fill="#0f172a"/>',
          '<line x1="348" y1="116" x2="370" y2="116" stroke="#0f172a" stroke-width="2"/><polygon points="370,116 362,112 362,120" fill="#0f172a"/>'
        ].join(''),
        490,
        240
      ),
      answer: 'Egg -> Young stage -> Growing stage -> Adult stage',
      labels: ['Egg', 'Young', 'Growing', 'Adult'],
      instructions: 'Write the stage that belongs in each box.'
    };
  }

  function buildMapDiagram() {
    return {
      kind: 'direction_map',
      svg: wrapSvg(
        [
          '<rect x="10" y="10" width="470" height="280" rx="18" fill="#f8fafc" stroke="#1e293b" stroke-width="2"/>',
          '<text x="24" y="38" font-size="18" font-family="Arial" fill="#1e293b">Use the map sketch to answer the question.</text>',
          '<polygon points="426,58 442,58 434,34" fill="#0f172a"/><line x1="434" y1="58" x2="434" y2="84" stroke="#0f172a" stroke-width="3"/><text x="429" y="98" font-size="15" font-family="Arial">N</text>',
          '<rect x="70" y="82" width="112" height="64" rx="10" fill="#dbeafe" stroke="#1d4ed8" stroke-width="3"/><text x="126" y="118" font-size="16" text-anchor="middle" font-family="Arial">Classroom</text>',
          '<rect x="298" y="82" width="112" height="64" rx="10" fill="#dcfce7" stroke="#15803d" stroke-width="3"/><text x="354" y="118" font-size="16" text-anchor="middle" font-family="Arial">Garden</text>',
          '<rect x="184" y="188" width="112" height="64" rx="10" fill="#fef3c7" stroke="#ca8a04" stroke-width="3"/><text x="240" y="224" font-size="16" text-anchor="middle" font-family="Arial">Office</text>',
          '<line x1="182" y1="114" x2="298" y2="114" stroke="#334155" stroke-width="4"/><line x1="240" y1="146" x2="240" y2="188" stroke="#334155" stroke-width="4"/>'
        ].join(''),
        490,
        300
      ),
      answer: 'The office is south of the classroom.',
      labels: ['Classroom', 'Garden', 'Office'],
      instructions: 'State the direction of one place from another.'
    };
  }

  function selectDiagram(topic, subject) {
    const merged = `${normalizeLookupToken(subject)} ${normalizeLookupToken(topic)}`;
    if (/(math|arithmetic|geometry|shape|triangle|rectangle|circle)/.test(merged)) return buildShapeDiagram();
    if (/(body|human|parts of body|hand|leg|head)/.test(merged)) return buildBodyPartDiagram();
    if (/(life cycle|lifecycle|stages|growth)/.test(merged)) return buildLifecycleDiagram(topic);
    if (/(map|direction|location|social|geography|compass)/.test(merged)) return buildMapDiagram();
    return buildPlantDiagram(topic);
  }

  function createDiagramQuestion(config) {
    const options = config && typeof config === 'object' ? config : {};
    const diagram = selectDiagram(options.topic, options.subject);
    let prompt = diagram.instructions;
    if (diagram.kind === 'direction_map') prompt = 'Look at the map sketch and describe the position of the office from the classroom.';
    if (diagram.kind === 'shape_identification') prompt = 'Study the diagram and write the name of the shape.';
    return {
      prompt,
      answer: diagram.answer,
      diagram
    };
  }

  const api = { createDiagramQuestion };
  global.SoMApExamDiagramEngine = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
