/**
 * shared/shift_reasons.js
 * Reads the free-text reason a teacher typed for a shifted learner and sorts it into a
 * category. Works with English and Kiswahili and tolerates spelling mistakes
 * ("trsnport", "usafri", "schol fees"), using keyword stems plus an edit-distance check.
 */
(function (global) {
  'use strict';

  const CATEGORIES = [
    { id: 'records', label: 'Records / class mix-up', short: 'Records', icon: '🗂️', hex: '#d946ef', rgb: [217, 70, 239],
      words: ['duplicate', 'duplicated', 'double', 'twice', 'mistake', 'error', 'appeared', 'kosa', 'makosa'],
      phrases: ['two classes', 'wrong class', 'madarasa mawili', 'registered twice', 'pre unit class', 'pre unity', 'back to class', 'class one'] },
    { id: 'transport', label: 'Transport', short: 'Transport', icon: '🚌', hex: '#0ea5e9', rgb: [14, 165, 233],
      words: ['transport', 'transportation', 'usafiri', 'gari', 'magari', 'bus', 'schoolbus', 'basi', 'daladala', 'bodaboda', 'pikipiki',
        'route', 'njia', 'distance', 'mbali', 'umbali', 'far', 'pickup', 'driver', 'dereva'],
      phrases: ['school bus', 'no transport', 'hakuna usafiri', 'transport fee', 'transport fees', 'lateness'] },
    { id: 'fees', label: 'School fees / money', short: 'Fees', icon: '💰', hex: '#f59e0b', rgb: [245, 158, 11],
      words: ['fee', 'fees', 'schoolfees', 'ada', 'karo', 'pesa', 'money', 'financial', 'finance', 'finances', 'cost', 'costs', 'expensive', 'gharama',
        'afford', 'deni', 'debt', 'debts', 'payment', 'malipo', 'kulipa', 'hela', 'cheaper', 'bei', 'kipato', 'income', 'economic', 'uchumi'],
      phrases: ['school fees', 'ada kubwa', 'hana pesa', 'shida ya pesa', 'hali ngumu', 'financial problem'] },
    { id: 'academic', label: 'Academic', short: 'Academic', icon: '📚', hex: '#10b981', rgb: [16, 185, 129],
      words: ['academic', 'academics', 'academically', 'performance', 'perform', 'results', 'matokeo', 'masomo', 'exam', 'exams', 'mtihani',
        'grade', 'grades', 'repeat', 'kurudia', 'fail', 'failed', 'failing', 'syllabus', 'curriculum', 'necta', 'learning', 'kusoma', 'reading', 'marks', 'alama'],
      phrases: ['poor performance', 'hafanyi vizuri', 'english medium'] },
    { id: 'staff', label: 'Teacher / discipline', short: 'Teacher', icon: '🧑‍🏫', hex: '#ef4444', rgb: [239, 68, 68],
      words: ['teacher', 'teachers', 'mwalimu', 'walimu', 'discipline', 'adhabu', 'punish', 'punishment', 'punished', 'bully', 'bullying', 'bullied',
        'fight', 'fighting', 'kupigwa', 'beaten', 'staff', 'tabia', 'behaviour', 'behavior', 'viboko', 'harassment'],
      phrases: ['class teacher', 'not happy with', 'mistreated'] },
    { id: 'health', label: 'Health', short: 'Health', icon: '🩺', hex: '#ec4899', rgb: [236, 72, 153],
      words: ['sick', 'ill', 'illness', 'ugonjwa', 'mgonjwa', 'anaumwa', 'health', 'hospital', 'hospitali', 'afya', 'medical', 'disease', 'surgery', 'upasuaji'],
      phrases: [] },
    { id: 'family', label: 'Family / parent', short: 'Family', icon: '👪', hex: '#8b5cf6', rgb: [139, 92, 246],
      words: ['family', 'familia', 'mzazi', 'wazazi', 'divorce', 'talaka', 'death', 'died', 'kifo', 'amefariki', 'alifariki',
        'guardian', 'mlezi', 'misunderstanding', 'conflict', 'separated', 'orphan', 'yatima'],
      phrases: ['family issues', 'family problem', 'family conflict', 'matatizo ya familia', 'live with'],
      // parent/mother/father alone are weak: 'a parent has shifted region' is a move, not a family problem
      weak: ['parent', 'parents', 'mother', 'father', 'mama', 'baba'] },
    { id: 'relocation', label: 'Moved / travelled', short: 'Moved', icon: '🧳', hex: '#6366f1', rgb: [99, 102, 241],
      words: ['moved', 'moving', 'relocate', 'relocated', 'relocation', 'relocating', 'hamia', 'kuhamia', 'amehamia', 'wamehamia', 'kahamia', 'transfer',
        'transferred', 'travel', 'travelled', 'traveled', 'travelling', 'safari', 'abroad', 'country', 'nchi', 'region', 'mkoa', 'village', 'kijiji',
        'upcountry', 'dar', 'dodoma', 'mwanza', 'nairobi', 'kenya', 'shifted', 'shift', 'uswahili', 'uswahilini', 'workplace'],
      phrases: ['outside the country', 'outside country', 'nje ya nchi', 'nje ya mkoa', 'went home', 'moved house', 'work place', 'parent has shifted', 'parent shifted'] },
    { id: 'closer', label: 'Nearer / other school', short: 'Other school', icon: '🏫', hex: '#14b8a6', rgb: [20, 184, 166],
      words: ['near', 'nearer', 'nearby', 'karibu', 'closer', 'government', 'serikali', 'boarding', 'bweni'],
      phrases: ['public school', 'another school', 'other school', 'shule ya serikali', 'day school', 'near home'] },
    { id: 'unknown', label: 'Unknown / not given', short: 'Unknown', icon: '❔', hex: '#94a3b8', rgb: [148, 163, 184],
      words: ['unknown', 'haijulikani', 'sijui', 'hajulikani', 'none', 'nil', 'absent', 'absence', 'utoro'],
      phrases: ['no reason', 'not known', 'not given', 'n/a'] },
    { id: 'other', label: 'Other reason', short: 'Other', icon: '📝', hex: '#64748b', rgb: [100, 116, 139], words: [], phrases: [] }
  ];
  const BY_ID = Object.fromEntries(CATEGORIES.map((c) => [c.id, c]));

  function editDistance(a, b) {
    const s = String(a || ''); const t = String(b || '');
    if (Math.abs(s.length - t.length) > 2) return 99;
    const d = Array.from({ length: s.length + 1 }, (_, i) => [i, ...Array(t.length).fill(0)]);
    for (let j = 1; j <= t.length; j += 1) d[0][j] = j;
    for (let i = 1; i <= s.length; i += 1) {
      for (let j = 1; j <= t.length; j += 1) {
        const cost = s[i - 1] === t[j - 1] ? 0 : 1;
        d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
        if (i > 1 && j > 1 && s[i - 1] === t[j - 2] && s[i - 2] === t[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
      }
    }
    return d[s.length][t.length];
  }

  function tokenMatches(token, word) {
    if (!token || !word) return false;
    if (token === word) return true;
    if (word.length <= 3) {
      // short words (ada, bus, fee, far, ill): exact, plural, or glued ("schoolbus")
      if (token === word + 's') return true;
      return word === 'bus' && token.includes('bus');
    }
    if (word.length >= 5 && token.startsWith(word)) return true;            // fees -> feesx, transport -> transporter
    if (token.length >= 5 && word.startsWith(token) && word.length - token.length <= 2) return true;
    if (word.length >= 6 && token.includes(word)) return true;
    if (word.length < 5 || token.length < 4) return false;
    const limit = word.length >= 8 ? 2 : 1;
    return editDistance(token, word) <= limit;
  }

  function normalize(text) {
    return String(text || '').toLowerCase().replace(/[^a-z0-9/ ]+/g, ' ').replace(/\s+/g, ' ').trim();
  }

  /** @returns {{primary:string, matches:string[], scores:object}} */
  function classify(text) {
    const norm = normalize(text);
    if (!norm || /^(-+|n\/?a|na|nil|none|unknown|0)$/.test(norm)) return { primary: 'unknown', matches: ['unknown'], scores: { unknown: 1 } };
    const tokens = norm.split(' ').filter(Boolean);
    const glued = norm.replace(/\s+/g, '');
    const scores = {};
    CATEGORIES.forEach((cat) => {
      let score = 0;
      cat.phrases.forEach((p) => { if (norm.includes(p) || glued.includes(p.replace(/\s+/g, ''))) score += 2; });
      cat.words.forEach((w) => { if (tokens.some((t) => tokenMatches(t, w))) score += 1; });
      (cat.weak || []).forEach((w) => { if (tokens.some((t) => tokenMatches(t, w))) score += 0.5; });
      if (score > 0) scores[cat.id] = score;
    });
    const ranked = CATEGORIES.filter((c) => scores[c.id] && c.id !== 'unknown')
      .sort((a, b) => (scores[b.id] - scores[a.id]) || (CATEGORIES.indexOf(a) - CATEGORIES.indexOf(b)));
    if (!ranked.length) return { primary: scores.unknown ? 'unknown' : 'other', matches: scores.unknown ? ['unknown'] : [], scores };
    return { primary: ranked[0].id, matches: ranked.map((c) => c.id), scores };
  }

  /** Count category ids; returns every category with its count, largest first. */
  function summarize(ids) {
    const counts = {};
    (ids || []).forEach((id) => { counts[id] = (counts[id] || 0) + 1; });
    return CATEGORIES.map((c) => ({ id: c.id, count: counts[c.id] || 0 }))
      .sort((a, b) => (b.count - a.count) || (CATEGORIES.findIndex((c) => c.id === a.id) - CATEGORIES.findIndex((c) => c.id === b.id)));
  }

  global.SomapShiftReasons = { CATEGORIES, classify, summarize, byId: (id) => BY_ID[id] || BY_ID.other };
})(typeof window !== 'undefined' ? window : globalThis);
