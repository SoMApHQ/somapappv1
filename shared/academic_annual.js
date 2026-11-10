/*
 * SoMAp Academic Annual Engine — the ONE shared implementation of how report
 * forms turn raw /scores into per-subject results and an overall average.
 *
 * These functions were moved verbatim out of Toacademichtml/generatereportform.html
 * (2026-11-10). That page now delegates to this file, and Top Students awards use
 * it too, so a report card and an award can never disagree.
 * tests/academic-annual-parity.test.cjs proves the behaviour is unchanged.
 *
 * Page-specific dependencies are passed in through `opts` (subject canonicaliser,
 * exam label lookup, date formatter, which exam window is selected).
 */
(function (global) {
  'use strict';

  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const MONTH_LABELS = { Jan: 'January', Feb: 'February', Mar: 'March', Apr: 'April', May: 'May', Jun: 'June', Jul: 'July', Aug: 'August', Sep: 'September', Oct: 'October', Nov: 'November', Dec: 'December' };
  const MONTH_ALIAS_TO_KEY = (() => {
    const map = {};
    MONTHS.forEach((m, idx) => {
      const full = MONTH_LABELS[m];
      const num = String(idx + 1);
      const padded = num.padStart(2, '0');
      map[m.toUpperCase()] = m;
      map[(full || '').toUpperCase()] = m;
      map[num] = m;
      map[padded] = m;
      if (m === 'Sep') map.SEPT = m;
    });
    return map;
  })();

  const SYNTHETIC_WINDOW_EXAM_KEYS = new Set(['midterm1', 'endterm', 'midterm2', 'annual']);
  const EXAM_MONTH_PLAN = {
    monthly: (selectedMonth) => [resolveMonthKey(selectedMonth) || selectedMonth],
    midterm1: () => ['Jan', 'Feb', 'Mar'],
    endterm: () => ['Jan', 'Feb', 'Mar', 'Apr', 'May'],
    midterm2: () => ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Aug', 'Sep'],
    annual: () => ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov'],
  };
  const EXAM_KEYS = { Monthly: 'monthly', 'Midterm 1': 'midterm1', 'Midterm 2': 'midterm2', 'End Term': 'endterm', Annual: 'annual' };

  function resolveMonthKey(input) {
    if (input === null || input === undefined) return null;
    const raw = String(input).trim();
    if (!raw) return null;
    const upper = raw.toUpperCase();
    if (MONTH_ALIAS_TO_KEY[upper]) return MONTH_ALIAS_TO_KEY[upper];
    if (MONTH_ALIAS_TO_KEY[raw]) return MONTH_ALIAS_TO_KEY[raw];
    const parts = raw.split(/[-_/]/);
    if (parts.length >= 2) {
      const maybe = parts[parts.length - 1];
      const fromParts = MONTH_ALIAS_TO_KEY[maybe.toUpperCase()] || MONTH_ALIAS_TO_KEY[maybe];
      if (fromParts) return fromParts;
    }
    return null;
  }

  function examMonthsForWindow(examKey, selectedMonth) {
    const key = String(examKey || 'monthly').toLowerCase();
    const plan = EXAM_MONTH_PLAN[key] || (() => [selectedMonth]);
    return Array.from(new Set((plan(selectedMonth) || []).map((m) => resolveMonthKey(m) || String(m || '').trim()).filter(Boolean)));
  }
  function isSyntheticWindowExam(examKey) {
    return SYNTHETIC_WINDOW_EXAM_KEYS.has(String(examKey || '').toLowerCase());
  }

  function normalizeExamLabel(label) {
    return String(label || '').replace(/\s*\(custom\)\s*$/i, '').trim().replace(/\s+/g, ' ');
  }
  function slugifyExamKey(label) {
    return normalizeExamLabel(label).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').replace(/-+/g, '-') || 'custom-exam';
  }
  function examLabelFromKey(rawKey, registry) {
    const key = String(rawKey || '').trim();
    if (!key) return '';
    const builtIn = Object.entries(EXAM_KEYS).find(([, v]) => String(v).toLowerCase() === key.toLowerCase());
    if (builtIn) return builtIn[0];
    const custom = (registry || []).find((item) => String(item?.key || '').toLowerCase() === key.toLowerCase());
    if (custom?.label) return custom.label;
    return key
      .replace(/[_-]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .replace(/\b\w/g, (m) => m.toUpperCase());
  }

  // ---------- attempt / percent / grade ----------
  function isNumber(n) { return Number.isFinite(n) && !Number.isNaN(n); }
  function hasRecordedScorePayload(item) {
    if (!item || typeof item !== 'object') return false;
    return (
      Object.prototype.hasOwnProperty.call(item, 'score') ||
      Object.prototype.hasOwnProperty.call(item, 'max') ||
      Object.prototype.hasOwnProperty.call(item, 'Score') ||
      Object.prototype.hasOwnProperty.call(item, 'Max')
    );
  }
  function attemptedItem(item) {
    if (item && typeof item.attempted === 'boolean') return item.attempted;
    const score = Number(item?.score);
    const max = Number(item?.max);
    if (!isNumber(score) || !isNumber(max) || max <= 0 || score <= 0) return false;
    return hasRecordedScorePayload(item);
  }
  function studentPercentFrom(subjects) {
    let s = 0; let m = 0; let count = 0;
    for (const it of (subjects || [])) {
      const score = Number(it?.score);
      const max = Number(it?.max);
      if (attemptedItem(it)) {
        s += score; m += max; count++;
      }
    }
    if (m <= 0 || count === 0) return { pct: 0, total: 0, max: 0, attemptedCount: 0 };
    return { pct: (s * 100) / m, total: s, max: m, attemptedCount: count };
  }
  function toNormalizedRows(subjects) {
    return (subjects || []).map((entry) => {
      const rawScore = Number(entry?.score) || 0;
      const rawMaxVal = Number(entry?.max);
      const safeMax = Number.isFinite(rawMaxVal) && rawMaxVal > 0 ? rawMaxVal : 100;
      const pct = safeMax > 0 ? (rawScore / safeMax) * 100 : 0;
      const syntheticDisplayScore = Number(entry?.displayScore);
      const syntheticDisplayMax = Number(entry?.displayMax);
      const dispScore = Number.isFinite(syntheticDisplayScore) ? syntheticDisplayScore : rawScore;
      const dispMax = Number.isFinite(syntheticDisplayMax) && syntheticDisplayMax > 0 ? syntheticDisplayMax : safeMax;
      return { ...entry, rawScore, rawMax: safeMax, pct, dispScore, dispMax };
    });
  }
  function displayPercentFrom(subjects) {
    const normed = toNormalizedRows(subjects);
    const attempted = normed.filter((e) => e.attempted);
    const totalScore = attempted.reduce((sum, e) => sum + e.dispScore, 0);
    const totalMax = attempted.reduce((sum, e) => sum + e.dispMax, 0);
    const pct = totalMax > 0 ? (totalScore * 100) / totalMax : 0;
    return { pct, total: totalScore, max: totalMax, attemptedCount: attempted.length };
  }
  function gradeFromPercent(p) {
    const x = Math.max(0, Math.min(100, Number(p) || 0));
    if (x >= 80.5) return 'A';
    if (x >= 60.5) return 'B';
    if (x >= 40.5) return 'C';
    if (x >= 20.5) return 'D';
    return 'F';
  }

  // ---------- raw score normalisation ----------
  function normalizeMonthlyScoreMap(raw) {
    const out = {};
    if (!raw || typeof raw !== 'object') return out;
    for (const [studentId, subjects] of Object.entries(raw)) {
      if (!subjects || typeof subjects !== 'object') continue;
      const normalizedSubjects = {};
      for (const [subjectKey, scoreObj] of Object.entries(subjects)) {
        const o = scoreObj;
        const isPrimitiveScore = typeof o === 'number' && Number.isFinite(o);
        if (!isPrimitiveScore && (!o || typeof o !== 'object')) continue;
        const hasScore = isPrimitiveScore || ((o && typeof o === 'object') && (
          Object.prototype.hasOwnProperty.call(o, 'score') ||
          Object.prototype.hasOwnProperty.call(o, 'Score')
        ));
        const hasMax = !isPrimitiveScore && (o && typeof o === 'object') && (
          Object.prototype.hasOwnProperty.call(o, 'max') ||
          Object.prototype.hasOwnProperty.call(o, 'Max')
        );
        if (!hasScore && !hasMax) continue;
        let safeScore = 0;
        if (hasScore) {
          safeScore = isPrimitiveScore ? Number(o) : Number(o.score ?? o.Score ?? 0);
          if (!Number.isFinite(safeScore)) safeScore = 0;
          if (safeScore < 0) safeScore = 0;
          if (safeScore > 10000) safeScore = 10000;
        }
        let label =
          (!isPrimitiveScore && typeof o.label === 'string' && o.label.trim()) ||
          (!isPrimitiveScore && typeof o.name === 'string' && o.name.trim()) ||
          subjectKey;
        if (!label) label = subjectKey;
        if (label.length > 60) label = label.slice(0, 57) + '...';
        let maxVal = 100;
        if (hasMax && !isPrimitiveScore) {
          maxVal = Number(o.max ?? o.Max ?? 0);
          if (!Number.isFinite(maxVal) || maxVal <= 0) maxVal = 100;
        }
        if (!Number.isFinite(maxVal) || maxVal <= 0) {
          maxVal = 100;
        }
        if (safeScore > maxVal * 1.2) {
          safeScore = maxVal;
        }
        normalizedSubjects[subjectKey] = {
          subject: label,
          score: safeScore,
          max: maxVal,
          date: (!isPrimitiveScore && (o.date || o.dateDone || o.examDate || o.doneOn || o.timestamp)) || '',
        };
      }
      if (Object.keys(normalizedSubjects).length) {
        out[studentId] = normalizedSubjects;
      }
    }
    return out;
  }

  function examRecordMeta(examKey, monthKey, fallbackLabel, opts = {}) {
    const labelFor = opts.examLabelFromKey || ((k) => examLabelFromKey(k, opts.registry));
    const normalizedExamKey = String(examKey || '').trim() || 'monthly';
    const examLabel = fallbackLabel || labelFor(normalizedExamKey) || 'Exam';
    const canonicalMonth = resolveMonthKey(monthKey) || String(monthKey || '').trim();
    return {
      examKey: normalizedExamKey,
      examLabel,
      monthKey: canonicalMonth,
      monthLabel: MONTH_LABELS[canonicalMonth] || canonicalMonth || '-',
    };
  }

  function preferredDisplayMaxFromLogs(logs, fallbackMax = 100) {
    const values = (logs || [])
      .map((log) => Number(log?.max || 0))
      .filter((value) => isNumber(value) && value > 0);
    if (!values.length) return Math.max(1, Number(fallbackMax || 100));
    const counts = new Map();
    values.forEach((value) => counts.set(value, (counts.get(value) || 0) + 1));
    let bestValue = values[0];
    let bestCount = counts.get(bestValue) || 0;
    counts.forEach((count, value) => {
      if (count > bestCount || (count === bestCount && value < bestValue)) {
        bestValue = value;
        bestCount = count;
      }
    });
    return bestValue;
  }

  /** Walk /scores/{year}/{class} and collect every exam record inside `months`. */
  function appendSyntheticExamWindowRecords(root, months, records, seen, opts = {}) {
    const labelFor = opts.examLabelFromKey || ((k) => examLabelFromKey(k, opts.registry));
    Object.entries(root || {}).forEach(([topKey, topVal]) => {
      if (!topVal || typeof topVal !== 'object' || Array.isArray(topVal)) return;
      const topMonth = resolveMonthKey(topKey);
      if (topMonth) {
        if (!months.includes(topMonth)) return;
        const directMonthly = normalizeMonthlyScoreMap(topVal);
        if (Object.keys(directMonthly).length) {
          const dedupe = `monthly::${topMonth}`;
          if (!seen.has(dedupe)) {
            seen.add(dedupe);
            records.push({ ...examRecordMeta('monthly', topMonth, 'Monthly', opts), data: directMonthly });
          }
          return;
        }
        Object.entries(topVal).forEach(([nestedExamKey, nestedBucket]) => {
          if (!nestedBucket || typeof nestedBucket !== 'object' || Array.isArray(nestedBucket)) return;
          const normalizedExamKey = slugifyExamKey(nestedExamKey);
          if (SYNTHETIC_WINDOW_EXAM_KEYS.has(normalizedExamKey)) return;
          const examScores = normalizeMonthlyScoreMap(nestedBucket);
          if (!Object.keys(examScores).length) return;
          const dedupe = `${normalizedExamKey}::${topMonth}`;
          if (seen.has(dedupe)) return;
          seen.add(dedupe);
          records.push({ ...examRecordMeta(normalizedExamKey, topMonth, labelFor(nestedExamKey), opts), data: examScores });
        });
        return;
      }
      const topExamKey = slugifyExamKey(topKey);
      if (SYNTHETIC_WINDOW_EXAM_KEYS.has(topExamKey)) return;
      Object.entries(topVal).forEach(([monthKey, monthBucket]) => {
        const resolvedMonth = resolveMonthKey(monthKey);
        if (!resolvedMonth || !months.includes(resolvedMonth)) return;
        const examScores = normalizeMonthlyScoreMap(monthBucket);
        if (!Object.keys(examScores).length) return;
        const dedupe = `${topExamKey}::${resolvedMonth}`;
        if (seen.has(dedupe)) return;
        seen.add(dedupe);
        records.push({ ...examRecordMeta(topExamKey, resolvedMonth, labelFor(topKey), opts), data: examScores });
      });
    });
  }

  function sortRecords(records) {
    return records.sort((a, b) => {
      const ai = MONTHS.indexOf(a.monthKey);
      const bi = MONTHS.indexOf(b.monthKey);
      if (ai !== bi) return ai - bi;
      return String(a.examLabel || '').localeCompare(String(b.examLabel || ''));
    });
  }

  /**
   * Merge exam records into per-student per-subject sums.
   * opts.synthetic: true when the selected exam is a window (Annual etc.).
   * opts.canonicalSubjectName, opts.formatDate: page helpers.
   */
  function mergeWindowRecords(records, opts = {}) {
    const canon = opts.canonicalSubjectName || ((s) => s);
    const formatDate = opts.formatDate || ((d) => String(d));
    const mergedScores = {};
    const detailsByAdm = {};
    (records || []).forEach((record) => {
      Object.entries(record?.data || {}).forEach(([adm, subjects]) => {
        mergedScores[adm] = mergedScores[adm] || {};
        detailsByAdm[adm] = detailsByAdm[adm] || { subjects: {}, exams: [] };
        Object.entries(subjects || {}).forEach(([subjectKey, raw]) => {
          const subject = canon(raw?.subject || subjectKey || '');
          const score = Number(raw?.score || 0);
          const max = Number(raw?.max || 0);
          if (!attemptedItem({ score, max })) return;
          const current = mergedScores[adm][subject] || { score: 0, max: 0, attempts: 0 };
          mergedScores[adm][subject] = { score: current.score + score, max: current.max + max };
          detailsByAdm[adm].subjects[subject] = detailsByAdm[adm].subjects[subject] || [];
          detailsByAdm[adm].subjects[subject].push({
            examKey: record.examKey,
            examLabel: record.examLabel,
            monthKey: record.monthKey,
            monthLabel: record.monthLabel,
            dateLabel: raw?.date ? formatDate(raw.date) : `${record.examLabel} - ${record.monthLabel}`,
            score,
            max,
            pct: max > 0 ? (score * 100) / max : 0,
          });
        });
      });
    });
    Object.entries(detailsByAdm).forEach(([adm, entry]) => {
      Object.entries(entry.subjects || {}).forEach(([subject, list]) => {
        list.sort((a, b) => {
          const ai = MONTHS.indexOf(a.monthKey);
          const bi = MONTHS.indexOf(b.monthKey);
          if (ai !== bi) return ai - bi;
          return String(a.examLabel || '').localeCompare(String(b.examLabel || ''));
        });
        const merged = mergedScores?.[adm]?.[subject];
        if (!merged) return;
        merged.attempts = list.length;
        if (opts.synthetic) {
          const displayMax = preferredDisplayMaxFromLogs(list, merged.max);
          const pct = merged.max > 0 ? (merged.score * 100) / merged.max : 0;
          merged.displayMax = displayMax;
          merged.displayScore = (pct * displayMax) / 100;
        }
      });
    });
    return { mergedScores, detailsByAdm };
  }

  /** Report-form subject rows for one learner (same as generatereportform buildSubjectStats). */
  function buildSubjectStats(subjects, scoreEntry) {
    const stats = { totalScore: 0, totalMax: 0, subjects: [], subjectMap: {} };
    subjects.forEach((subject) => {
      const subEntry = scoreEntry?.[subject] || {};
      const score = Number(subEntry.score || 0);
      const rawMax = Number(subEntry.max);
      const max = Number.isFinite(rawMax) ? rawMax : 100;
      const percent = max ? (score / max) * 100 : 0;
      const attempted = attemptedItem({ ...subEntry, score, max });
      const rawDisplayScore = Number(subEntry.displayScore);
      const rawDisplayMax = Number(subEntry.displayMax);
      const displayScore = Number.isFinite(rawDisplayScore) ? rawDisplayScore : score;
      const displayMax = Number.isFinite(rawDisplayMax) && rawDisplayMax > 0 ? rawDisplayMax : max;
      const record = { subject, score, max, percent, attempted, displayScore, displayMax, attempts: Number(subEntry.attempts || 0) };
      stats.subjects.push(record);
      stats.subjectMap[subject] = record;
      if (attempted) {
        stats.totalScore += score;
        stats.totalMax += max;
      }
    });
    return stats;
  }

  // ---------- roster key matching (score keys may be admission no. or record id) ----------
  function normalizeAdm(v) { return String(v || '').trim(); }
  function keyFingerprints(value) {
    const raw = String(value || '').trim();
    if (!raw) return [];
    const upper = raw.toUpperCase();
    const compact = upper.replace(/[\s_-]+/g, '');
    return Array.from(new Set([raw, upper, compact]));
  }
  function buildNormalizedValueLookup(mapObj) {
    const lookup = new Map();
    Object.entries(mapObj || {}).forEach(([key, value]) => {
      keyFingerprints(key).forEach((finger) => {
        if (!lookup.has(finger)) lookup.set(finger, value);
      });
    });
    return lookup;
  }
  function pickMapValueByCandidates(rawMap, lookup, candidates) {
    const direct = rawMap || {};
    for (const candidate of (candidates || [])) {
      if (!candidate) continue;
      if (Object.prototype.hasOwnProperty.call(direct, candidate)) return direct[candidate];
    }
    for (const candidate of (candidates || [])) {
      const hits = keyFingerprints(candidate);
      for (const key of hits) {
        if (lookup.has(key)) return lookup.get(key);
      }
    }
    return null;
  }

  function getClassCandidates(className) {
    const raw = String(className || '').trim();
    const list = [];
    if (raw) list.push(raw);
    const digits = raw.match(/(\d+)/)?.[1];
    if (digits) {
      if (!list.includes(digits)) list.push(digits);
      const pref = `Class ${digits}`;
      if (!list.includes(pref)) list.push(pref);
      const noSpace = `Class${digits}`;
      if (!list.includes(noSpace)) list.push(noSpace);
    }
    return list.length ? list : [className];
  }

  /**
   * Annual results for a whole class, exactly as the report form computes the
   * "Annual" exam: Jan–Nov exam records merged, subjects normalised to their
   * usual max, overall = display-normalised average over the class subject list.
   *
   * readRoot(classCandidate) must resolve to the raw object at /scores/{year}/{class}
   * (scoped, Socrates legacy fallback) or null.
   * Returns { records, subjects, students: { [key]: { avg, attemptedCount, subjects: {name:{pct, attempts, attempted}}, exams:Set } } }
   */
  async function computeClassAnnual({ className, classSubjects, readRoot, roster, canonicalSubjectName, registry }) {
    const months = examMonthsForWindow('annual');
    const records = [];
    const seen = new Set();
    for (const cls of getClassCandidates(className)) {
      const root = await readRoot(cls);
      if (!root) continue;
      appendSyntheticExamWindowRecords(root, months, records, seen, { registry });
    }
    sortRecords(records);
    const merged = mergeWindowRecords(records, { synthetic: true, canonicalSubjectName });
    const subjects = (classSubjects && classSubjects.length) ? classSubjects.slice() : inferSubjects(merged.mergedScores, canonicalSubjectName);
    const scoreLookup = buildNormalizedValueLookup(merged.mergedScores);
    const detailLookup = buildNormalizedValueLookup(merged.detailsByAdm);
    const students = {};
    (roster || []).forEach((learner) => {
      const candidates = (learner.lookupKeys || []).map(normalizeAdm).filter(Boolean);
      const scoreEntry = pickMapValueByCandidates(merged.mergedScores, scoreLookup, candidates) || {};
      const detail = pickMapValueByCandidates(merged.detailsByAdm, detailLookup, candidates) || { subjects: {} };
      const stats = buildSubjectStats(subjects, scoreEntry);
      const display = displayPercentFrom(stats.subjects);
      const perSubject = {};
      const examsSat = new Set();
      stats.subjects.forEach((row) => {
        const logs = detail.subjects?.[row.subject] || [];
        const subjectExams = new Set(logs.map((l) => `${l.examKey}::${l.monthKey}`));
        subjectExams.forEach((k) => examsSat.add(k));
        perSubject[row.subject] = {
          attempted: row.attempted,
          pct: row.attempted && row.max > 0 ? (row.score * 100) / row.max : 0,
          exams: subjectExams.size,
          examKeys: Array.from(subjectExams),
        };
      });
      students[learner.key] = {
        avg: display.pct,
        grade: gradeFromPercent(display.pct),
        attemptedCount: display.attemptedCount,
        subjects: perSubject,
        examsSat: examsSat.size,
      };
    });
    return { records, subjects, students };
  }

  function inferSubjects(scoresObj, canon) {
    const set = new Set();
    Object.values(scoresObj || {}).forEach((subs) => {
      Object.keys(subs || {}).forEach((s) => set.add(canon ? canon(s) : s));
    });
    return set.size ? Array.from(set) : ['English', 'Mathematics', 'Science'];
  }

  /** Same custom-subject loading as the report form (subjectCatalog + teachers_config). */
  async function loadCustomSubjectsForYear(year, { api, readScopedOrLegacy, readLegacy }) {
    if (!api || !api.setCustomSubjectsMap) return;
    try {
      let raw = (await readScopedOrLegacy(`subjectCatalog/${year}`)) || {};
      if (!Object.keys(raw || {}).length) raw = (await readLegacy(`subjectCatalog/${year}`)) || {};
      const map = {};
      const addLabels = (className, labels) => {
        const cls = String(className || '').trim();
        if (!cls) return;
        const list = Array.isArray(labels) ? labels : [];
        if (!list.length) return;
        if (!map[cls]) map[cls] = [];
        map[cls].push(...list.filter(Boolean).map((v) => String(v).trim()).filter(Boolean));
      };
      Object.entries(raw || {}).forEach(([className, bucket]) => {
        const labels = [];
        if (Array.isArray(bucket)) {
          bucket.forEach((entry) => {
            const label = typeof entry === 'string' ? entry : (entry?.label || entry?.name || '');
            if (label) labels.push(label);
          });
        } else if (bucket && typeof bucket === 'object') {
          Object.values(bucket).forEach((entry) => {
            const label = typeof entry === 'string' ? entry : (entry?.label || entry?.name || '');
            if (label) labels.push(label);
          });
        }
        addLabels(className, labels);
      });
      let cfgRaw = (await readScopedOrLegacy(`years/${year}/teachers_config`)) || {};
      if (!Object.keys(cfgRaw || {}).length) cfgRaw = (await readLegacy(`years/${year}/teachers_config`)) || {};
      Object.values(cfgRaw || {}).forEach((cfg) => {
        const mappings = Array.isArray(cfg?.classSubjectMappings) ? cfg.classSubjectMappings : [];
        mappings.forEach((mapping) => {
          const className = mapping?.class || mapping?.className || mapping?.classLevel || mapping?.grade || '';
          const labels = Array.isArray(mapping?.subjects) ? mapping.subjects : [];
          addLabels(className, labels);
        });
      });
      api.setCustomSubjectsMap(map, { year, replace: true });
    } catch (err) {
      console.warn('[academic_annual] loadCustomSubjectsForYear failed', err?.message || err);
    }
  }

  const api = {
    MONTHS, MONTH_LABELS, MONTH_ALIAS_TO_KEY, SYNTHETIC_WINDOW_EXAM_KEYS, EXAM_MONTH_PLAN,
    resolveMonthKey, examMonthsForWindow, isSyntheticWindowExam,
    normalizeExamLabel, slugifyExamKey, examLabelFromKey,
    isNumber, hasRecordedScorePayload, attemptedItem, studentPercentFrom, toNormalizedRows, displayPercentFrom, gradeFromPercent,
    normalizeMonthlyScoreMap, examRecordMeta, preferredDisplayMaxFromLogs, appendSyntheticExamWindowRecords, sortRecords,
    mergeWindowRecords, buildSubjectStats,
    keyFingerprints, buildNormalizedValueLookup, pickMapValueByCandidates, getClassCandidates,
    computeClassAnnual, loadCustomSubjectsForYear,
  };
  global.SomapAcademicAnnual = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
}(typeof window !== 'undefined' ? window : globalThis));
