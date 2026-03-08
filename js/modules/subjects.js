// Canonical names (keys must be EXACT). We fix typos like "Health Arec".
const SUBJECT_ALIASES = {
  'health arec': 'Health Care',
  'healtharec': 'Health Care',
  'healthcare': 'Health Care',
  'health': 'Health Care',
  'health  care': 'Health Care',
  'heath care': 'Health Care',
  'health.care': 'Health Care'
};

// Base subject lists by class (UI labels). Adjust to stay in sync with Scoresheet.
export const SUBJECTS_BY_CLASS = {
  // Early years (exact labels match your UI)
  'Baby Class': ['Arithmetic', 'Communication', 'Relation', 'CRN', 'Health Care', 'Arts'],
  'Middle Class': ['Arithmetic', 'Communication', 'Relation', 'CRN', 'Health Care', 'Arts'],
  'Pre-Unit': ['Arithmetic', 'Communication', 'Relation', 'CRN', 'Health Care', 'Arts'],
  // Lower primary
  'Class 1': ['Writing Skills', 'Arithmetic', 'Developing Sports & Arts', 'Health Care', 'Kusoma', 'Listening'],
  'Class 2': ['Writing Skills', 'Arithmetic', 'Developing Sports & Arts', 'Health Care', 'Kusoma', 'Listening'],
  // Upper primary (keep in sync with live Scoresheet subjects)
  'Class 3': ['Math', 'English', 'Kiswahili', 'Science', 'Geography', 'Arts', 'History', 'French'],
  'Class 4': ['Math', 'English', 'Kiswahili', 'Science', 'Geography', 'Arts', 'History', 'French'],
  'Class 5': ['Math', 'English', 'Kiswahili', 'Science', 'Geography', 'Historia', 'DSA'],
  'Class 6': ['Math', 'English', 'Kiswahili', 'Science', 'Social Studies', 'Civics & Morals'],
  'Class 7': ['Math', 'English', 'Kiswahili', 'Science', 'Social Studies', 'Civics & Morals']
};

const L = (s) => String(s || '').trim().toLowerCase();
const CUSTOM_STORAGE_KEY = 'somap_custom_subjects_v1';
let CUSTOM_SUBJECTS_BY_YEAR = {};

function safeReadCustomStore() {
  try {
    const raw = window?.localStorage?.getItem(CUSTOM_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch (_) {
    return {};
  }
}

function safeWriteCustomStore(payload) {
  try {
    window?.localStorage?.setItem(CUSTOM_STORAGE_KEY, JSON.stringify(payload || {}));
  } catch (_) {
    // Ignore storage failures in private mode or restricted contexts.
  }
}

function normalizeYearKey(year) {
  const y = Number(year);
  return Number.isFinite(y) ? String(y) : String(new Date().getFullYear());
}

function toUniqueLabels(list) {
  const out = [];
  const seen = new Set();
  (Array.isArray(list) ? list : []).forEach((entry) => {
    const label = canonSubject(typeof entry === 'string' ? entry : (entry?.label || entry?.name || ''));
    const cleaned = String(label || '').trim();
    if (!cleaned) return;
    const key = L(cleaned);
    if (seen.has(key)) return;
    seen.add(key);
    out.push(cleaned);
  });
  return out;
}

function normalizeCustomMap(inputMap) {
  const normalized = {};
  Object.entries(inputMap || {}).forEach(([className, list]) => {
    const classKey = canonClass(className);
    if (!classKey) return;
    normalized[classKey] = toUniqueLabels(list);
  });
  return normalized;
}

/** Return canonical subject label (fixes "Health Arec" -> "Health Care"). */
export function canonSubject(label) {
  const raw = String(label || '').replace(/[._]/g, ' ');
  const k = L(raw);
  return SUBJECT_ALIASES[k] || label || '';
}

/** Normalize class display names used around the app. */
export function canonClass(name) {
  const s = L(name);
  if (!s) return '';
  if (s.includes('pre-unit') || s.includes('pre unit') || s.includes('preunit')) return 'Pre-Unit';
  if (s.includes('pre') && s.includes('unit')) return 'Pre-Unit';
  if (s.includes('middle')) return 'Middle Class';
  if (s.includes('baby')) return 'Baby Class';
  if (s.includes('kg')) return 'Baby Class';
  if (/class\s*one|grade\s*one|standard\s*one|std\s*one/.test(s)) return 'Class 1';
  if (/class\s*two|grade\s*two|standard\s*two|std\s*two/.test(s)) return 'Class 2';
  if (/class\s*three|grade\s*three|standard\s*three|std\s*three/.test(s)) return 'Class 3';
  if (/class\s*four|grade\s*four|standard\s*four|std\s*four/.test(s)) return 'Class 4';
  if (/class\s*five|grade\s*five|standard\s*five|std\s*five/.test(s)) return 'Class 5';
  if (/class\s*six|grade\s*six|standard\s*six|std\s*six/.test(s)) return 'Class 6';
  if (/class\s*seven|grade\s*seven|standard\s*seven|std\s*seven/.test(s)) return 'Class 7';
  // Class 1..7 (handles "Class 1 AB", "1AB", "Grade 1", etc.)
  const m = s.match(/(class|grade|std|standard)?\s*([1-7])/);
  if (m && m[2]) return `Class ${m[2]}`;
  return name || '';
}

export function getCustomSubjectsForClass(className, year) {
  const y = normalizeYearKey(year);
  const key = canonClass(className);
  if (!key) return [];
  const yearMap = CUSTOM_SUBJECTS_BY_YEAR[y] || {};
  return toUniqueLabels(yearMap[key] || []);
}

export function setCustomSubjectsMap(map, options = {}) {
  const y = normalizeYearKey(options?.year);
  const normalized = normalizeCustomMap(map || {});
  const replace = Boolean(options?.replace);
  const existing = replace ? {} : (CUSTOM_SUBJECTS_BY_YEAR[y] || {});
  const merged = { ...existing };
  Object.entries(normalized).forEach(([classKey, list]) => {
    const combined = [...(merged[classKey] || []), ...list];
    merged[classKey] = toUniqueLabels(combined);
  });
  CUSTOM_SUBJECTS_BY_YEAR[y] = merged;
  safeWriteCustomStore(CUSTOM_SUBJECTS_BY_YEAR);
}

export function addCustomSubject(className, subjectLabel, year) {
  const classKey = canonClass(className);
  const subject = canonSubject(subjectLabel);
  if (!classKey || !subject) return [];
  const y = normalizeYearKey(year);
  const yearMap = CUSTOM_SUBJECTS_BY_YEAR[y] || {};
  const list = toUniqueLabels([...(yearMap[classKey] || []), subject]);
  CUSTOM_SUBJECTS_BY_YEAR[y] = { ...yearMap, [classKey]: list };
  safeWriteCustomStore(CUSTOM_SUBJECTS_BY_YEAR);
  return list;
}

/** Subjects for a class in the selected year. (Branch by year if syllabus changes.) */
export function getSubjectsForClass(className, year) {
  const key = canonClass(className);
  const y = Number(year) || new Date().getFullYear();

  // Special handling for Class 5 legacy syllabus through 2025
  if (key === 'Class 5' && y <= 2025) {
    const legacy = ['Math', 'English', 'Kiswahili', 'Science', 'SST', 'CME', 'VSkills'];
    return legacy.map(canonSubject);
  }

  const list = SUBJECTS_BY_CLASS[key] || [];
  const custom = getCustomSubjectsForClass(key, y);
  return toUniqueLabels([...list.map(canonSubject), ...custom.map(canonSubject)]);
}

CUSTOM_SUBJECTS_BY_YEAR = safeReadCustomStore();
