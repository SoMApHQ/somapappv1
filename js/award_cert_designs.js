/*
 * SoMAp Top Students award certificates (2026+). Landscape A4, 1123 x 794 css px.
 * Requires js/grad_cert_designs.js (drawing kit, fonts, html2canvas helpers).
 *
 * Every subject has its own colour theme and motif; positions 1/2/3 get gold /
 * silver / bronze medals; attendance has a sunrise + calendar motif; overall
 * academic excellence is the most prestigious; whole-school awards get a
 * guilloché frame and a "Whole School" sash so they look grander than class awards.
 * Palettes are deliberately 2–3 colours each (no rainbow sequences).
 */
(function (window) {
  'use strict';
  const G = window.GradCertDesigns;
  if (!G || !G._kit) { console.error('award_cert_designs: load js/grad_cert_designs.js first'); return; }
  const K = G._kit;
  const { esc, svgUri, f, starPolygon } = K;
  const W = G.W;
  const H = G.H;

  // ---------- motif icons (drawn in a 100x100 box, stroke = currentColor-like param) ----------
  const ICONS = {
    geometry: (c) => `<path d="M50 8 L92 84 L8 84 Z" fill="none" stroke="${c}" stroke-width="3"/><circle cx="50" cy="58" r="20" fill="none" stroke="${c}" stroke-width="3"/><path d="M42 58 h16 M50 50 v16" stroke="${c}" stroke-width="3"/>`,
    compassDraw: (c) => `<path d="M50 10 L30 90 M50 10 L70 90 M38 58 h24" stroke="${c}" stroke-width="3.5" fill="none" stroke-linecap="round"/><circle cx="50" cy="10" r="5" fill="${c}"/><path d="M22 70 A40 40 0 0 0 78 70" fill="none" stroke="${c}" stroke-width="2" stroke-dasharray="4 4"/>`,
    signs: (c) => `<path d="M20 25 h22 M31 14 v22 M60 18 l18 18 M78 18 l-18 18 M18 70 h26 M31 62 v0 M31 78 v0 M60 66 h22 M60 76 h22" stroke="${c}" stroke-width="4" stroke-linecap="round"/><circle cx="31" cy="62" r="3" fill="${c}"/><circle cx="31" cy="78" r="3" fill="${c}"/>`,
    atom: (c) => `<ellipse cx="50" cy="50" rx="42" ry="15" fill="none" stroke="${c}" stroke-width="3"/><ellipse cx="50" cy="50" rx="42" ry="15" transform="rotate(60 50 50)" fill="none" stroke="${c}" stroke-width="3"/><ellipse cx="50" cy="50" rx="42" ry="15" transform="rotate(-60 50 50)" fill="none" stroke="${c}" stroke-width="3"/><circle cx="50" cy="50" r="7" fill="${c}"/>`,
    leaf: (c) => `<path d="M15 85 C 15 35, 50 12, 88 12 C 88 55, 62 88, 15 85 Z" fill="none" stroke="${c}" stroke-width="3.5"/><path d="M15 85 C 40 60, 60 40, 80 20" stroke="${c}" stroke-width="2.5" fill="none"/>`,
    flask: (c) => `<path d="M38 10 h24 M42 10 v26 L18 82 Q15 90 24 90 h52 Q85 90 82 82 L58 36 V10" fill="none" stroke="${c}" stroke-width="3.5" stroke-linejoin="round"/><path d="M28 66 h44" stroke="${c}" stroke-width="2.5"/><circle cx="44" cy="76" r="4" fill="${c}"/><circle cx="58" cy="72" r="3" fill="${c}"/>`,
    quill: (c) => `<path d="M85 10 C 50 18, 28 45, 20 88 C 40 62, 55 50, 85 10 Z" fill="none" stroke="${c}" stroke-width="3.5"/><path d="M20 88 L 58 36" stroke="${c}" stroke-width="2"/><path d="M12 92 h30" stroke="${c}" stroke-width="3" stroke-linecap="round"/>`,
    book: (c) => `<path d="M50 24 C 36 14, 18 14, 8 18 V82 C 18 78, 36 78, 50 88 C 64 78, 82 78, 92 82 V18 C 82 14, 64 14, 50 24 Z M50 24 V88" fill="none" stroke="${c}" stroke-width="3.5" stroke-linejoin="round"/><path d="M18 34 h22 M18 46 h22 M60 34 h22 M60 46 h22" stroke="${c}" stroke-width="2.2"/>`,
    letters: (c) => `<path d="M14 80 L30 22 L46 80 M20 60 h20 M58 22 v58 h12 q16 0 16 -15 q0 -14 -16 -14 h-12 M58 22 h10 q14 0 14 14 q0 13 -14 13" fill="none" stroke="${c}" stroke-width="4" stroke-linejoin="round"/>`,
    compassRose: (c) => `<circle cx="50" cy="50" r="38" fill="none" stroke="${c}" stroke-width="2.5"/><path d="${starPolygon(50, 50, 44, 9, 4)}" fill="none" stroke="${c}" stroke-width="3"/><path d="${starPolygon(50, 50, 26, 6, 4, Math.PI / 4 - Math.PI / 2)}" fill="${c}" opacity=".5"/><circle cx="50" cy="50" r="4" fill="${c}"/>`,
    contour: (c) => `<path d="M10 30 C 30 10, 60 40, 90 20 M8 52 C 30 32, 62 64, 92 42 M10 74 C 32 56, 60 86, 90 64" fill="none" stroke="${c}" stroke-width="3"/>`,
    globe: (c) => `<circle cx="50" cy="50" r="38" fill="none" stroke="${c}" stroke-width="3"/><ellipse cx="50" cy="50" rx="16" ry="38" fill="none" stroke="${c}" stroke-width="2.5"/><path d="M12 50 h76 M18 30 h64 M18 70 h64" stroke="${c}" stroke-width="2.2"/>`,
    dove: (c) => `<path d="M12 60 C 30 40, 52 42, 62 52 C 70 34, 84 26, 92 30 C 84 36, 80 46, 78 56 C 74 74, 50 84, 28 76 L 10 82 L 22 70 C 16 68, 12 64, 12 60 Z" fill="none" stroke="${c}" stroke-width="3.2" stroke-linejoin="round"/><circle cx="80" cy="36" r="2.5" fill="${c}"/>`,
    olive: (c) => `<path d="M10 88 C 40 62, 60 40, 90 12" stroke="${c}" stroke-width="3" fill="none"/>${[[30, 70, -40], [44, 56, 30], [56, 46, -40], [68, 34, 30], [80, 22, -40]].map(([x, y, r]) => `<ellipse cx="${x}" cy="${y}" rx="10" ry="4.5" transform="rotate(${r} ${x} ${y})" fill="none" stroke="${c}" stroke-width="2.5"/>`).join('')}`,
    rays: (c) => `${Array.from({ length: 9 }, (_, i) => { const a = Math.PI + (i * Math.PI) / 8; return `<path d="M${f(50 + 18 * Math.cos(a))} ${f(86 + 18 * Math.sin(a))} L${f(50 + 44 * Math.cos(a))} ${f(86 + 44 * Math.sin(a))}" stroke="${c}" stroke-width="3" stroke-linecap="round"/>`; }).join('')}<path d="M26 86 A24 24 0 0 1 74 86 Z" fill="none" stroke="${c}" stroke-width="3"/>`,
    palette: (c) => `<path d="M50 10 C 20 10, 8 34, 10 54 C 12 76, 34 90, 52 88 C 62 87, 62 76, 56 70 C 50 63, 58 56, 66 58 C 80 61, 92 54, 90 38 C 88 22, 72 10, 50 10 Z" fill="none" stroke="${c}" stroke-width="3.2"/><circle cx="32" cy="38" r="6" fill="${c}"/><circle cx="50" cy="26" r="6" fill="${c}"/><circle cx="70" cy="34" r="6" fill="${c}"/><circle cx="28" cy="62" r="6" fill="${c}"/>`,
    note: (c) => `<path d="M38 74 V20 L82 12 V64" fill="none" stroke="${c}" stroke-width="3.5"/><ellipse cx="28" cy="76" rx="12" ry="9" fill="${c}"/><ellipse cx="72" cy="66" rx="12" ry="9" fill="${c}"/>`,
    ball: (c) => `<circle cx="50" cy="50" r="38" fill="none" stroke="${c}" stroke-width="3"/><path d="${starPolygon(50, 50, 14, 14, 5)}" fill="${c}"/><path d="M50 36 V14 M63 46 L84 38 M58 62 L72 80 M42 62 L28 80 M37 46 L16 38" stroke="${c}" stroke-width="2.5"/>`,
    circuit: (c) => `<path d="M10 30 h30 v20 h30 v-30 h20 M10 70 h20 v-12 h40 v28 h20" fill="none" stroke="${c}" stroke-width="3"/>${[[40, 30], [70, 50], [70, 20], [30, 58], [70, 86]].map(([x, y]) => `<circle cx="${x}" cy="${y}" r="5" fill="${c}"/>`).join('')}`,
    calendar: (c) => `<rect x="12" y="18" width="76" height="70" rx="8" fill="none" stroke="${c}" stroke-width="3.2"/><path d="M12 36 h76 M32 10 v16 M68 10 v16" stroke="${c}" stroke-width="3.2" stroke-linecap="round"/><path d="M28 60 l10 10 l22 -22" fill="none" stroke="${c}" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/>`,
    sun: (c) => `<circle cx="50" cy="50" r="18" fill="none" stroke="${c}" stroke-width="3.5"/>${Array.from({ length: 12 }, (_, i) => { const a = (i * Math.PI) / 6; return `<path d="M${f(50 + 26 * Math.cos(a))} ${f(50 + 26 * Math.sin(a))} L${f(50 + 40 * Math.cos(a))} ${f(50 + 40 * Math.sin(a))}" stroke="${c}" stroke-width="3" stroke-linecap="round"/>`; }).join('')}`,
    star: (c) => `<path d="${starPolygon(50, 50, 40, 17, 5)}" fill="none" stroke="${c}" stroke-width="3.2" stroke-linejoin="round"/>`,
    shield: (c) => `<path d="M50 8 L86 22 V48 C 86 70, 70 84, 50 92 C 30 84, 14 70, 14 48 V22 Z" fill="none" stroke="${c}" stroke-width="3.5" stroke-linejoin="round"/><path d="${starPolygon(50, 48, 16, 7, 5)}" fill="${c}"/>`,
    heart: (c) => `<path d="M50 86 C 18 64, 8 44, 14 28 C 20 12, 42 10, 50 28 C 58 10, 80 12, 86 28 C 92 44, 82 64, 50 86 Z" fill="none" stroke="${c}" stroke-width="3.5"/><path d="M28 50 h12 l6 -10 l8 20 l6 -10 h12" fill="none" stroke="${c}" stroke-width="3"/>`,
    sparkle: (c) => `<path d="M50 8 Q54 46 92 50 Q54 54 50 92 Q46 54 8 50 Q46 46 50 8 Z" fill="none" stroke="${c}" stroke-width="3"/><path d="M80 14 Q81 22 88 23 Q81 24 80 32 Q79 24 72 23 Q79 22 80 14 Z" fill="${c}"/>`,
    drop: (c) => `<path d="M50 10 C 66 34, 80 50, 80 64 C 80 82, 66 92, 50 92 C 34 92, 20 82, 20 64 C 20 50, 34 34, 50 10 Z" fill="none" stroke="${c}" stroke-width="3.5"/><path d="M34 66 Q36 78 48 80" stroke="${c}" stroke-width="3" fill="none" stroke-linecap="round"/>`,
    trophy: (c) => `<path d="M30 12 h40 v22 c0 16 -10 26 -20 26 c-10 0 -20 -10 -20 -26 Z M30 18 h-14 c0 14 6 20 14 20 M70 18 h14 c0 14 -6 20 -14 20 M50 60 v16 M34 88 h32 v-12 h-32 Z" fill="none" stroke="${c}" stroke-width="3.5" stroke-linejoin="round"/>`,
    pencil: (c) => `<path d="M18 82 L24 62 L70 16 L84 30 L38 76 Z M62 24 l14 14 M24 62 l14 14" fill="none" stroke="${c}" stroke-width="3.5" stroke-linejoin="round"/>`,
    beads: (c) => `<path d="M10 30 h80 M10 55 h80 M10 80 h80" stroke="${c}" stroke-width="2"/>${[18, 30, 42, 62, 74].map((x) => `<circle cx="${x}" cy="30" r="6" fill="${c}"/>`).join('')}${[24, 36, 70, 82].map((x) => `<circle cx="${x}" cy="55" r="6" fill="${c}"/>`).join('')}${[18, 30, 42, 54, 66, 78].map((x) => `<circle cx="${x}" cy="80" r="6" fill="${c}"/>`).join('')}`,
    crown: (c) => `<path d="M12 74 L18 30 L36 52 L50 20 L64 52 L82 30 L88 74 Z M12 84 h76" fill="none" stroke="${c}" stroke-width="3.5" stroke-linejoin="round"/><circle cx="50" cy="20" r="4" fill="${c}"/>`,
  };

  // ---------- themes ----------
  const THEMES = {
    mathematics: { label: 'Mathematics', main: '#1e3a8a', ink: '#14275f', paper: '#f3f6ff', accent: '#d99a1e', icons: ['geometry', 'compassDraw', 'signs'], headline: 'Certificate of Merit' },
    science: { label: 'Science', main: '#166534', ink: '#0f4424', paper: '#f2fbf4', accent: '#a3b818', icons: ['atom', 'leaf', 'flask'], headline: 'Certificate of Merit' },
    english: { label: 'English', main: '#7f1d1d', ink: '#5c1313', paper: '#fff7f4', accent: '#c99a3a', icons: ['quill', 'book', 'letters'], headline: 'Certificate of Merit' },
    kiswahili: { label: 'Kiswahili', main: '#9a3412', ink: '#6f2409', paper: '#fff8ef', accent: '#0f5e4a', icons: ['book', 'quill', 'star'], kanga: true, headline: 'Cheti cha Ubora' },
    social: { label: 'Social Studies', main: '#7c4a1e', ink: '#56320f', paper: '#fcf6ee', accent: '#0f766e', icons: ['compassRose', 'contour', 'globe'], headline: 'Certificate of Merit' },
    religion: { label: 'Religious Education', main: '#3b3486', ink: '#27215f', paper: '#f6f5ff', accent: '#c99a3a', icons: ['dove', 'olive', 'rays'], headline: 'Certificate of Merit' },
    arts: { label: 'Arts', main: '#be4a12', ink: '#86330b', paper: '#fff6f0', accent: '#1d4e89', icons: ['palette', 'note', 'pencil'], headline: 'Certificate of Merit' },
    sports: { label: 'Sports', main: '#b45309', ink: '#7c3a06', paper: '#fff9f0', accent: '#1e3a8a', icons: ['ball', 'trophy', 'star'], headline: 'Certificate of Merit' },
    french: { label: 'French', main: '#1e3a8a', ink: '#14275f', paper: '#f5f7ff', accent: '#b91c1c', icons: ['book', 'letters', 'star'], headline: 'Certificat de Mérite' },
    ict: { label: 'ICT', main: '#0f766e', ink: '#0a4f4a', paper: '#effcfa', accent: '#1e3a8a', icons: ['circuit', 'signs', 'star'], headline: 'Certificate of Merit' },
    health: { label: 'Health', main: '#15803d', ink: '#0f5a2b', paper: '#f1fbf4', accent: '#dc2626', icons: ['heart', 'leaf', 'drop'], headline: 'Certificate of Merit' },
    writing: { label: 'Writing', main: '#1f4e79', ink: '#143552', paper: '#f3f8fc', accent: '#c2410c', icons: ['pencil', 'letters', 'quill'], headline: 'Certificate of Merit' },
    arithmetic: { label: 'Arithmetic', main: '#1d4ed8', ink: '#14359a', paper: '#f2f6ff', accent: '#f59e0b', icons: ['beads', 'signs', 'geometry'], headline: 'Certificate of Merit' },
    attendance: { label: 'Attendance', main: '#b45309', ink: '#7a3606', paper: '#fffaf0', accent: '#1e3a8a', icons: ['sun', 'calendar', 'rays'], headline: 'Certificate of Attendance' },
    excellence: { label: 'Academic Excellence', main: '#0f1f45', ink: '#0f1f45', paper: '#fffdf6', accent: '#7a1f2b', icons: ['crown', 'star', 'book'], headline: 'Certificate of Academic Excellence', prestige: true },
    overallClass: { label: 'Academic Achievement', main: '#1e2f5c', ink: '#14234a', paper: '#fdfbf4', accent: '#a8322d', icons: ['star', 'book', 'crown'], headline: 'Award of Academic Achievement' },
    cleanliness: { label: 'Cleanliness', main: '#0e7490', ink: '#0a5266', paper: '#f0fbfd', accent: '#c99a3a', icons: ['sparkle', 'drop', 'star'], headline: 'Award of Honour' },
    leadership: { label: 'Leadership', main: '#9f1239', ink: '#6f0c27', paper: '#fff5f7', accent: '#c99a3a', icons: ['crown', 'shield', 'star'], headline: 'Award of Honour' },
    discipline: { label: 'Discipline', main: '#1e3a5f', ink: '#132741', paper: '#f4f7fb', accent: '#c99a3a', icons: ['shield', 'star', 'book'], headline: 'Award of Honour' },
    character: { label: 'Character', main: '#115e59', ink: '#0b3f3c', paper: '#f2fbfa', accent: '#c99a3a', icons: ['star', 'olive', 'heart'], headline: 'Award of Honour' },
  };
  const FALLBACK_PAIRS = [['#1f4e79', '#c99a3a'], ['#5b2c6f', '#c99a3a'], ['#0f5e4a', '#b45309'], ['#7a1f2b', '#1f4e79'], ['#374151', '#c99a3a'], ['#9a3412', '#1e3a5f']];

  function themeForSubject(subject) {
    const s = String(subject || '').toLowerCase();
    if (/kiswahili|swahili|kusoma|kuandika/.test(s)) return THEMES.kiswahili;
    if (/arith|counting|number/.test(s)) return THEMES.arithmetic;
    if (/math|hesabu/.test(s)) return THEMES.mathematics;
    if (/science|sayansi|nature/.test(s)) return THEMES.science;
    if (/health|afya|arec/.test(s)) return THEMES.health;
    if (/french|fran/.test(s)) return THEMES.french;
    if (/english|reading|listening|communication|language|grammar|literature/.test(s)) return THEMES.english;
    if (/writing|handwriting/.test(s)) return THEMES.writing;
    if (/social|geograph|history|civic|uraia|relation|maarifa|vocational/.test(s)) return THEMES.social;
    if (/crn|cre|ire|relig|bible|dini|islam|christ|moral|ethic/.test(s)) return THEMES.religion;
    if (/sport|physical|p\.?e\b|games|michezo/.test(s)) return THEMES.sports;
    if (/art|music|craft|draw|sanaa|developing/.test(s)) return THEMES.arts;
    if (/ict|computer|tehama|technology/.test(s)) return THEMES.ict;
    let hash = 0;
    for (const ch of s) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
    const [main, accent] = FALLBACK_PAIRS[hash % FALLBACK_PAIRS.length];
    return { label: subject, main, ink: main, paper: '#fbfaf6', accent, icons: ['star', 'book', 'olive'], headline: 'Certificate of Merit' };
  }
  function themeForCategory(name) {
    const s = String(name || '').toLowerCase();
    if (/clean|hygien|usafi|neat/.test(s)) return THEMES.cleanliness;
    if (/lead|prefect|monitor|captain/.test(s)) return THEMES.leadership;
    if (/disciplin|behav|conduct|nidhamu/.test(s)) return THEMES.discipline;
    if (/health|afya|fit/.test(s)) return THEMES.health;
    if (/sport|athlet|football|netball|run|michezo/.test(s)) return THEMES.sports;
    if (/art|music|drama|danc|creativ/.test(s)) return THEMES.arts;
    if (/attend|punctual/.test(s)) return THEMES.attendance;
    if (/math|science|english|kiswahili|social|french|ict|read|writ/.test(s)) return themeForSubject(s);
    return THEMES.character;
  }

  const MEDALS = {
    1: { name: 'GOLD', a: '#7d5a1a', b: '#e6c065', c: '#fff4c7', ink: '#4a3408' },
    2: { name: 'SILVER', a: '#5b6470', b: '#c7ced8', c: '#ffffff', ink: '#2f3640' },
    3: { name: 'BRONZE', a: '#6e3412', b: '#cf8a55', c: '#ffe0c4', ink: '#4a220a' },
  };

  const ART = K.ART;
  function medalArt(position, theme) {
    const key = `medal-${position}-${theme.main}-${theme.accent}`;
    if (ART[key]) return ART[key];
    const m = MEDALS[position] || MEDALS[3];
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="170" height="220" viewBox="0 0 170 220">
      <defs>
        <radialGradient id="md" cx=".38" cy=".32" r=".78"><stop offset="0" stop-color="${m.c}"/><stop offset=".45" stop-color="${m.b}"/><stop offset="1" stop-color="${m.a}"/></radialGradient>
        <linearGradient id="rb1" x1="0" x2="1"><stop offset="0" stop-color="${theme.main}"/><stop offset="1" stop-color="${theme.ink}"/></linearGradient>
      </defs>
      <path d="M50 4 L74 4 L96 96 L72 96 Z" fill="url(#rb1)"/>
      <path d="M120 4 L96 4 L74 96 L98 96 Z" fill="${theme.accent}"/>
      <path d="M50 4 L74 4 L96 96 L72 96 Z" fill="#ffffff" opacity=".12"/>
      <path d="${starPolygon(85, 142, 70, 62, 28)}" fill="url(#md)" stroke="${m.a}" stroke-width="1"/>
      <circle cx="85" cy="142" r="54" fill="none" stroke="${m.c}" stroke-width="1.6" opacity=".9"/>
      <circle cx="85" cy="142" r="50" fill="url(#md)" stroke="${m.a}" stroke-width="1.2"/>
      ${K.rosette({ cx: 85, cy: 142, R: 34, amp: 6, petals: 16, strands: 5, stroke: m.a, width: 0.5, opacity: 0.45 })}
    </svg>`;
    ART[key] = svgUri(svg);
    return ART[key];
  }

  function motifLayer(theme, prestige) {
    const key = `motif-${theme.label}-${theme.main}-${prestige ? 1 : 0}`;
    if (ART[key]) return ART[key];
    // Icons sit in the margins (left & right columns, top & bottom bands), never under the text.
    const spots = [
      [70, 110, 46, -12], [92, 250, 36, 10], [64, 520, 40, 8], [118, 640, 34, -8],
      [1010, 112, 44, 12], [1040, 262, 34, -10], [1000, 560, 38, -6], [1050, 650, 32, 10],
      [300, 690, 30, 6], [820, 690, 30, -6], [260, 96, 28, 10], [860, 96, 28, -10],
    ];
    const icons = theme.icons || ['star'];
    const body = spots.map(([x, y, s, r], i) => {
      const draw = ICONS[icons[i % icons.length]] || ICONS.star;
      const color = i % 3 === 2 ? theme.accent : theme.main;
      return `<g transform="translate(${x - s / 2} ${y - s / 2}) rotate(${r} ${s / 2} ${s / 2}) scale(${f(s / 100)})" opacity="${i % 3 === 2 ? 0.22 : 0.16}">${draw(color)}</g>`;
    }).join('');
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">${body}</svg>`;
    ART[key] = svgUri(svg);
    return ART[key];
  }

  function frameArt(theme, scope) {
    const key = `aframe-${theme.label}-${theme.main}-${scope}`;
    if (ART[key]) return ART[key];
    const school = scope === 'school';
    const kanga = theme.kanga;
    let frame = '';
    if (school) {
      frame = `
        <rect x="12" y="12" width="${W - 24}" height="${H - 24}" rx="12" fill="${theme.ink}"/>
        ${K.guillocheBand({ x: 26, y: 26, w: W - 52, h: H - 52, r: 8, amp: 7, strands: 6, cycles: 210, stroke: '#e6c065', width: 0.55, opacity: 0.9 })}
        ${K.guillocheBand({ x: 26, y: 26, w: W - 52, h: H - 52, r: 8, amp: 4.5, strands: 3, cycles: 141, stroke: '#ffffff', width: 0.35, opacity: 0.35, harmonic: 0.35 })}
        <rect x="42" y="42" width="${W - 84}" height="${H - 84}" rx="5" fill="url(#paper)"/>
        <rect x="42" y="42" width="${W - 84}" height="${H - 84}" rx="5" fill="none" stroke="url(#gold)" stroke-width="3"/>
        <rect x="51" y="51" width="${W - 102}" height="${H - 102}" rx="3" fill="none" stroke="${theme.main}" stroke-width="0.9"/>`;
    } else if (kanga) {
      // Kanga-inspired border: a solid band with a repeating diamond + dot pindo.
      const band = (y, h) => {
        let d = '';
        for (let x = 30; x < W - 30; x += 28) d += `<path d="M${x} ${y + h / 2} l14 ${-h / 2 + 4} l14 ${h / 2 - 4} l-14 ${h / 2 - 4} z" fill="${theme.accent}" opacity=".9"/><circle cx="${x + 14}" cy="${y + h / 2}" r="2.6" fill="#fff3d6"/>`;
        return `<rect x="22" y="${y}" width="${W - 44}" height="${h}" fill="${theme.main}"/>${d}`;
      };
      frame = `
        <rect x="14" y="14" width="${W - 28}" height="${H - 28}" rx="10" fill="${theme.main}"/>
        <rect x="30" y="30" width="${W - 60}" height="${H - 60}" rx="6" fill="url(#paper)"/>
        ${band(30, 30)}${band(H - 60, 30)}
        <rect x="30" y="30" width="${W - 60}" height="${H - 60}" rx="6" fill="none" stroke="${theme.accent}" stroke-width="2"/>
        <rect x="40" y="66" width="${W - 80}" height="${H - 132}" rx="4" fill="none" stroke="${theme.main}" stroke-width="1"/>`;
    } else {
      frame = `
        <rect x="16" y="16" width="${W - 32}" height="${H - 32}" rx="14" fill="url(#paper)"/>
        <rect x="18" y="18" width="${W - 36}" height="${H - 36}" rx="12" fill="none" stroke="${theme.main}" stroke-width="8"/>
        <rect x="32" y="32" width="${W - 64}" height="${H - 64}" rx="6" fill="none" stroke="${theme.accent}" stroke-width="1.6"/>
        <rect x="38" y="38" width="${W - 76}" height="${H - 76}" rx="4" fill="none" stroke="${theme.main}" stroke-width=".8" opacity=".6"/>
        ${[[38, 38, 0], [W - 38, 38, 90], [W - 38, H - 38, 180], [38, H - 38, 270]].map(([x, y, r]) => `<g transform="translate(${x} ${y}) rotate(${r})"><path d="M0 0 L46 0 M0 0 L0 46" stroke="${theme.main}" stroke-width="3"/><path d="M14 2 L26 14 L14 26 L2 14 Z" fill="${theme.accent}" transform="translate(-2 -2)"/></g>`).join('')}`;
    }
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
      <defs>${K.GOLD_DEFS}
        <radialGradient id="paper" cx=".5" cy=".45" r=".8"><stop offset="0" stop-color="#ffffff"/><stop offset=".6" stop-color="${theme.paper}"/><stop offset="1" stop-color="${theme.paper}"/></radialGradient>
      </defs>
      <rect width="${W}" height="${H}" fill="#ffffff"/>
      ${frame}
      ${theme.prestige || school ? K.rosette({ cx: W / 2, cy: H / 2 + 30, R: 190, amp: 26, petals: 18, strands: 8, stroke: theme.main, width: 0.45, opacity: 0.07 }) : ''}
    </svg>`;
    ART[key] = svgUri(svg);
    return ART[key];
  }

  function sashHtml(theme, text) {
    return `<div style="position:absolute;left:-54px;top:58px;width:250px;transform:rotate(-38deg);text-align:center;padding:7px 0;
      background:linear-gradient(90deg,#8a6420,#f3d27a,#fff0b8,#c99a3a,#8a6420);color:${theme.ink};
      font-family:'Cinzel',Georgia,serif;font-weight:700;font-size:12.5px;letter-spacing:.26em;box-shadow:0 4px 10px rgba(0,0,0,.25);">${esc(text)}</div>`;
  }

  function ordinalWord(p) { return { 1: 'First', 2: 'Second', 3: 'Third' }[p] || `${p}th`; }

  function buildAward(d) {
    const theme = d.theme;
    const school = d.scope === 'school';
    const s = d.school || {};
    const date = G.formalDate(d.issuedDate);
    const medal = MEDALS[d.position] ? d.position : 0;
    const serif = "'Cinzel',Georgia,serif";
    const body = "'Cormorant Garamond',Georgia,serif";
    const node = document.createElement('div');
    node.className = 'somap-award';
    node.style.cssText = `width:${W}px;height:${H}px;position:relative;overflow:hidden;background:#fff;color:${theme.ink};`;
    const inset = school ? 60 : (theme.kanga ? 72 : 52);
    node.innerHTML = `
      <img src="${frameArt(theme, d.scope)}" alt="" style="position:absolute;left:0;top:0;width:${W}px;height:${H}px;"/>
      <img src="${motifLayer(theme, theme.prestige)}" alt="" style="position:absolute;left:0;top:0;width:${W}px;height:${H}px;"/>
      ${school ? sashHtml(theme, 'WHOLE SCHOOL') : ''}

      <div style="position:absolute;left:0;right:0;top:${inset + 8}px;text-align:center;">
        ${K.crestHtml(d.crestData, school ? 64 : 56, `linear-gradient(135deg,${theme.main},${theme.accent})`)}
      </div>
      <div style="position:absolute;left:150px;right:150px;top:${inset + (school ? 84 : 74)}px;text-align:center;">
        <div data-fit="school" style="font-family:${serif};font-weight:700;font-size:${school ? 25 : 22}px;letter-spacing:.18em;color:${theme.ink};white-space:nowrap;">${esc(String(s.name || '').toUpperCase())}</div>
        ${s.tagline ? `<div style="font-family:${body};font-style:italic;font-size:14px;color:${theme.main};">${esc(s.tagline)}</div>` : ''}
      </div>

      <div style="position:absolute;left:0;right:0;top:${inset + (school ? 150 : 140)}px;text-align:center;">
        <div style="font-family:${serif};font-weight:700;font-size:${theme.prestige ? 40 : 36}px;letter-spacing:.04em;line-height:1.05;color:${theme.main};text-shadow:0 1px 0 #ffffff,0 3px 6px rgba(0,0,0,.12);">${esc(d.headline)}</div>
        <div style="margin-top:8px;display:inline-flex;align-items:center;gap:14px;">
          <span style="width:80px;height:2px;background:linear-gradient(90deg,rgba(0,0,0,0),${theme.accent});"></span>
          <span style="font-family:${serif};font-weight:700;font-size:14px;letter-spacing:.3em;color:${theme.ink};">${esc(d.subtitle)}</span>
          <span style="width:80px;height:2px;background:linear-gradient(90deg,${theme.accent},rgba(0,0,0,0));"></span>
        </div>
      </div>

      <div style="position:absolute;left:${school ? 94 : 84}px;top:298px;width:160px;height:196px;">
        <div style="position:absolute;left:0;top:0;width:160px;height:196px;border-radius:50%;background:linear-gradient(135deg,${theme.main},${theme.accent});"></div>
        <div style="position:absolute;left:5px;top:5px;width:150px;height:186px;border-radius:50%;background:#ffffff;"></div>
        ${d.photoData
          ? `<img src="${esc(d.photoData)}" alt="" style="position:absolute;left:9px;top:9px;width:142px;height:178px;"/>`
          : `<div style="position:absolute;left:9px;top:9px;width:142px;height:178px;border-radius:50%;background:${theme.paper};display:flex;align-items:center;justify-content:center;font-family:${serif};font-size:42px;color:${theme.main};">${esc(K.initials(d.name))}</div>`}
      </div>

      ${medal ? `
      <div style="position:absolute;right:${school ? 92 : 80}px;top:270px;width:170px;height:220px;">
        <img src="${medalArt(medal, theme)}" alt="" style="position:absolute;left:0;top:0;width:170px;height:220px;"/>
        <div style="position:absolute;left:0;right:0;top:104px;text-align:center;font-family:${serif};color:${MEDALS[medal].ink};">
          <div style="font-size:10px;letter-spacing:.3em;font-weight:700;">POSITION</div>
          <div style="font-size:50px;font-weight:700;line-height:1;">${medal}</div>
          <div style="font-size:9.5px;letter-spacing:.26em;font-weight:700;">${MEDALS[medal].name}</div>
        </div>
      </div>` : ''}

      <div style="position:absolute;left:280px;right:280px;top:318px;text-align:center;">
        <div style="font-family:${body};font-style:italic;font-size:20px;color:${theme.main};">This is proudly presented to</div>
        <div data-fit="name" style="margin-top:2px;font-family:'Pinyon Script',cursive;font-size:56px;line-height:1.25;color:${theme.ink};white-space:nowrap;">${esc(G.toTitleCase(d.name))}</div>
        <div style="margin:0 auto;width:420px;height:2px;background:linear-gradient(90deg,rgba(0,0,0,0),${theme.accent} 25%,${theme.main} 50%,${theme.accent} 75%,rgba(0,0,0,0));"></div>
        <div style="margin-top:12px;font-family:${body};font-weight:500;font-size:18.5px;line-height:1.5;color:#2b2f3a;">${d.statement}</div>
      </div>

      <div style="position:absolute;left:120px;right:120px;top:572px;display:flex;justify-content:space-between;align-items:flex-end;">
        ${K.signatureCell('HEAD TEACHER', '', theme.ink, serif, `background:linear-gradient(90deg,rgba(0,0,0,0),${theme.main} 15%,${theme.main} 85%,rgba(0,0,0,0));`)}
        <div style="text-align:center;font-family:${body};font-size:15px;color:${theme.main};font-style:italic;padding-bottom:6px;">${esc(date.day)} ${esc(date.month)} ${esc(date.year)}</div>
        ${K.signatureCell('ACADEMIC TEACHER', '', theme.ink, serif, `background:linear-gradient(90deg,rgba(0,0,0,0),${theme.main} 15%,${theme.main} 85%,rgba(0,0,0,0));`)}
      </div>

      <div style="position:absolute;left:0;right:0;top:${H - inset - 4}px;display:flex;align-items:center;justify-content:center;gap:8px;font-family:${serif};font-size:9px;letter-spacing:.16em;color:${theme.main};opacity:.85;">
        <img src="${esc(d.somapLogoUrl)}" alt="" style="width:15px;height:15px;"/>
        <span>${esc(d.footer || '')}</span>
      </div>`;
    return node;
  }

  /**
   * award: { type:'overall'|'subject'|'attendance'|'manual', scope:'class'|'school', position, subject,
   *   className, groupLabel, year, name, photoUrl, admissionNo, present, recorded, since, until,
   *   categoryName, code, approvedAt }
   */
  function describe(award) {
    const year = award.year;
    const pos = award.position;
    const where = award.scope === 'school'
      ? `in the whole school${award.groupLabel ? ` — ${esc(award.groupLabel)}` : ''}`
      : `in ${esc(award.className)}`;
    if (award.type === 'overall') {
      const theme = award.scope === 'school' ? THEMES.excellence : THEMES.overallClass;
      return {
        theme,
        headline: theme.headline,
        subtitle: award.scope === 'school' ? `TOP OF THE SCHOOL · ${year}` : `${String(award.className).toUpperCase()} · ${year}`,
        statement: `is awarded <b>Position ${pos}</b> overall ${where} for outstanding academic performance in the ${esc(year)} annual results.`,
      };
    }
    if (award.type === 'subject') {
      const theme = themeForSubject(award.subject);
      return {
        theme,
        headline: theme.headline,
        subtitle: `${String(award.subject).toUpperCase()} · ${year}`,
        statement: `is awarded <b>Position ${pos}</b> in <b>${esc(award.subject)}</b> ${where} for excellence in the ${esc(year)} annual results.`,
      };
    }
    if (award.type === 'attendance') {
      const theme = THEMES.attendance;
      const pct = award.recorded ? ((award.present * 100) / award.recorded) : 0;
      const perfect = award.present === award.recorded;
      return {
        theme,
        headline: perfect ? 'Perfect Attendance' : theme.headline,
        subtitle: `PRESENT EVERY DAY · ${year}`,
        statement: `is awarded <b>Position ${pos}</b> for attendance ${where}, present for <b>${award.present} of ${award.recorded}</b> school sessions (${pct.toFixed(1)}%) from ${esc(award.since)} to ${esc(award.until)}.`,
      };
    }
    const theme = themeForCategory(award.categoryName);
    return {
      theme,
      headline: theme.headline,
      subtitle: `${String(award.categoryName || 'Award').toUpperCase()} · ${year}`,
      statement: `is recognised as <b>${esc(award.categoryName)}</b>${pos ? ` — <b>Position ${pos}</b>` : ''} ${award.scope === 'school' ? 'in the whole school' : `in ${esc(award.className || 'class')}`} for the year ${esc(year)}.`,
    };
  }

  async function render(host, award) {
    await G.ensureFonts();
    const desc = describe(award);
    const crestSrc = award.school?.logoUrl || K.SOMAP_LOGO;
    const crestSize = award.scope === 'school' ? 64 : 56;
    const crestKey = `crest-${crestSize}-${crestSrc}`;
    const [photoData, crestData, somapLogoUrl] = await Promise.all([
      award.photoUrl ? K.preparePortrait(award.photoUrl, 142, 178) : Promise.resolve(''),
      ART[crestKey] ? Promise.resolve(ART[crestKey]) : K.makeCrest(crestSrc, crestSize).then((u) => u || K.makeCrest(K.SOMAP_LOGO_FALLBACK, crestSize)).then((u) => { if (u) ART[crestKey] = u; return u; }),
      ART.somapLogo ? Promise.resolve(ART.somapLogo) : K.imageToDataUrl(K.SOMAP_LOGO).then((u) => { ART.somapLogo = u || K.SOMAP_LOGO_FALLBACK; return ART.somapLogo; }),
    ]);
    const node = buildAward({ ...award, ...desc, photoData, crestData, somapLogoUrl, issuedDate: award.issuedDate || new Date() });
    host.innerHTML = '';
    host.appendChild(node);
    K.fitText(node);
    await Promise.all(Array.from(node.querySelectorAll('img')).map((img) => (img.complete ? null : new Promise((r) => { img.onload = r; img.onerror = r; }))));
    return { node, theme: desc.theme };
  }

  window.AwardCertDesigns = { render, toCanvas: G.toCanvas, themeForSubject, themeForCategory, describe, THEMES };
}(window));
