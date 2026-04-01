(function attachSchoolCalendar(global) {
  'use strict';

  const DEFAULT_COUNTRY = 'Tanzania';
  const DEFAULT_TIMEZONE = 'Africa/Nairobi';
  const DEFAULT_WEEKEND_DAYS = [0, 6];
  const DEFAULT_SCHOOL_ID = 'socrates-school';
  const DEFAULT_SCHOOL_NAME = 'Socrates School';
  const DEFAULT_LOGO = 'images/somap-logo.png.jpg';

  const FIXED_TANZANIA_HOLIDAYS = [
    { monthDay: '01-01', title: "New Year's Day" },
    { monthDay: '01-12', title: 'Zanzibar Revolution Day' },
    { monthDay: '04-07', title: 'Karume Day' },
    { monthDay: '04-26', title: 'Union Day' },
    { monthDay: '05-01', title: 'Labour Day' },
    { monthDay: '07-07', title: 'Saba Saba' },
    { monthDay: '08-08', title: "Farmers' Day" },
    { monthDay: '10-14', title: 'Mwalimu Nyerere Day' },
    { monthDay: '12-09', title: 'Republic Day' },
    { monthDay: '12-25', title: 'Christmas Day' },
    { monthDay: '12-26', title: 'Boxing Day' },
  ];

  const TANZANIA_ISLAMIC_PUBLIC_HOLIDAYS = {
    2024: { eidElFitri: ['2024-04-10', '2024-04-11'], eidAlAdha: ['2024-06-17'], maulid: ['2024-09-16'] },
    2025: { eidElFitri: ['2025-03-31', '2025-04-01'], eidAlAdha: ['2025-06-07'], maulid: ['2025-09-05'] },
    2026: { eidElFitri: ['2026-03-20', '2026-03-21'], eidAlAdha: ['2026-05-27'], maulid: ['2026-08-26'] },
    2027: { eidElFitri: ['2027-03-10', '2027-03-11'], eidAlAdha: ['2027-05-17'], maulid: ['2027-08-15'] },
    2028: { eidElFitri: ['2028-02-27', '2028-02-28'], eidAlAdha: ['2028-05-05'], maulid: ['2028-08-03'] },
    2029: { eidElFitri: ['2029-02-15', '2029-02-16'], eidAlAdha: ['2029-04-24'], maulid: ['2029-07-24'] },
    2030: { eidElFitri: ['2030-02-05', '2030-02-06'], eidAlAdha: ['2030-04-14'], maulid: ['2030-07-13'] },
    2031: { eidElFitri: ['2031-01-25', '2031-01-26'], eidAlAdha: ['2031-04-03'], maulid: ['2031-07-02'] },
  };

  const TYPE_META = {
    public_holiday: {
      label: 'Public Holiday',
      color: '#ef4444',
      background: 'rgba(239,68,68,0.18)',
      defaults: { parentVisible: true, blockStudentAttendance: true, blockWorkerAttendance: true, countAsSchoolDay: false, weekendOverrideWorkingDay: false },
    },
    school_break: {
      label: 'School Break',
      color: '#2563eb',
      background: 'rgba(37,99,235,0.18)',
      defaults: { parentVisible: true, blockStudentAttendance: true, blockWorkerAttendance: false, countAsSchoolDay: false, weekendOverrideWorkingDay: false },
    },
    school_event: {
      label: 'School Event',
      color: '#8b5cf6',
      background: 'rgba(139,92,246,0.18)',
      defaults: { parentVisible: true, blockStudentAttendance: false, blockWorkerAttendance: false, countAsSchoolDay: true, weekendOverrideWorkingDay: false },
    },
    working_day_override: {
      label: 'Working Day Override',
      color: '#d97706',
      background: 'rgba(217,119,6,0.2)',
      defaults: { parentVisible: true, blockStudentAttendance: false, blockWorkerAttendance: false, countAsSchoolDay: true, weekendOverrideWorkingDay: true },
    },
    reopening: {
      label: 'Reopening',
      color: '#16a34a',
      background: 'rgba(22,163,74,0.18)',
      defaults: { parentVisible: true, blockStudentAttendance: false, blockWorkerAttendance: false, countAsSchoolDay: true, weekendOverrideWorkingDay: false },
    },
    closure: {
      label: 'Closure',
      color: '#0f766e',
      background: 'rgba(15,118,110,0.2)',
      defaults: { parentVisible: true, blockStudentAttendance: true, blockWorkerAttendance: true, countAsSchoolDay: false, weekendOverrideWorkingDay: false },
    },
  };

  const KNOWN_CLASSES = ['Baby Class', 'Middle Class', 'Pre Unit Class', 'Class 1', 'Class 2', 'Class 3', 'Class 4', 'Class 5', 'Class 6', 'Class 7'];
  const cache = { meta: new Map(), entries: new Map(), schoolProfile: new Map() };

  function getFirebaseDb() {
    if (!global.firebase || typeof global.firebase.database !== 'function') return null;
    try { return global.firebase.database(); } catch (_error) { return null; }
  }

  function getSomap() {
    return global.SOMAP || null;
  }

  function resolveSchoolId() {
    const somap = getSomap();
    return (
      somap?.getSchoolId?.() ||
      somap?.getSchool?.()?.id ||
      somap?.getActiveSchool?.()?.id ||
      (typeof localStorage !== 'undefined' && (localStorage.getItem('somap.currentSchoolId') || localStorage.getItem('somap_school'))) ||
      (typeof sessionStorage !== 'undefined' && (sessionStorage.getItem('somap.currentSchoolId') || sessionStorage.getItem('somap_school'))) ||
      DEFAULT_SCHOOL_ID
    );
  }

  function buildScopedPath(subPath, schoolId) {
    const normalizedPath = String(subPath || '').replace(/^\/+/, '');
    const somap = getSomap();
    if (somap && typeof somap.P === 'function') return somap.P(normalizedPath);
    const sid = String(schoolId || resolveSchoolId()).trim() || DEFAULT_SCHOOL_ID;
    if (!sid || sid === DEFAULT_SCHOOL_ID) return normalizedPath;
    return `schools/${sid}/${normalizedPath}`;
  }

  function schoolRef(subPath, schoolId) {
    const db = getFirebaseDb();
    if (!db) return null;
    return db.ref(buildScopedPath(subPath, schoolId));
  }

  function resolveActiveSchoolMeta() {
    const somap = getSomap();
    let school = null;
    try { school = somap?.getActiveSchool?.() || somap?.getSchool?.() || null; } catch (_error) { school = null; }
    if (school && typeof school === 'object') return school;
    if (typeof localStorage !== 'undefined') {
      try {
        const stored = JSON.parse(localStorage.getItem('somap.currentSchool') || 'null');
        if (stored && typeof stored === 'object') return stored;
      } catch (_error) {
        /* no-op */
      }
    }
    return { id: resolveSchoolId(), name: DEFAULT_SCHOOL_NAME };
  }

  async function loadSchoolProfileMeta(schoolId) {
    const targetId = String(schoolId || resolveSchoolId()).trim() || DEFAULT_SCHOOL_ID;
    if (cache.schoolProfile.has(targetId)) return cache.schoolProfile.get(targetId);
    const fallback = resolveActiveSchoolMeta();
    if (targetId === DEFAULT_SCHOOL_ID) {
      cache.schoolProfile.set(targetId, fallback);
      return fallback;
    }
    const db = getFirebaseDb();
    if (!db) {
      cache.schoolProfile.set(targetId, fallback);
      return fallback;
    }
    try {
      const snap = await db.ref(`/schools/${targetId}/profile`).once('value');
      const merged = { ...fallback, ...(snap.val() || {}), id: targetId };
      cache.schoolProfile.set(targetId, merged);
      return merged;
    } catch (_error) {
      cache.schoolProfile.set(targetId, fallback);
      return fallback;
    }
  }

  function normalizeYear(year) {
    const numeric = Number(year || new Date().getFullYear());
    return String(Number.isFinite(numeric) ? numeric : new Date().getFullYear());
  }

  function pad(value) {
    return String(value).padStart(2, '0');
  }

  function normalizeIsoDate(dateValue) {
    if (!dateValue) return '';
    if (dateValue instanceof Date && !Number.isNaN(dateValue.getTime())) {
      return `${dateValue.getFullYear()}-${pad(dateValue.getMonth() + 1)}-${pad(dateValue.getDate())}`;
    }
    const raw = String(dateValue).trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
    if (/^\d{8}$/.test(raw)) return `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}`;
    const parsed = new Date(raw);
    if (Number.isNaN(parsed.getTime())) return '';
    return `${parsed.getFullYear()}-${pad(parsed.getMonth() + 1)}-${pad(parsed.getDate())}`;
  }

  function isoToDayKey(isoDate) {
    const normalized = normalizeIsoDate(isoDate);
    return normalized ? normalized.replace(/-/g, '') : '';
  }

  function dateInRange(date, startDate, endDate) {
    const day = normalizeIsoDate(date);
    const start = normalizeIsoDate(startDate) || day;
    const end = normalizeIsoDate(endDate) || start;
    if (!day || !start || !end) return false;
    return day >= start && day <= end;
  }

  function normalizeWhitespace(value) {
    return String(value || '').replace(/\s+/g, ' ').trim();
  }

  function normalizeClassName(name) {
    const raw = normalizeWhitespace(name);
    if (!raw) return '';
    const low = raw.toLowerCase();
    if (low.includes('baby')) return 'Baby Class';
    if (low.includes('middle')) return 'Middle Class';
    if (low.includes('pre') || low.includes('nursery') || low.includes('unit')) return 'Pre Unit Class';
    const match = low.match(/class\s*(\d+)/) || low.match(/\b(\d+)\b/);
    if (match) return `Class ${Number(match[1])}`;
    return raw.replace(/\b\w/g, function toUpper(ch) { return ch.toUpperCase(); });
  }

  function normalizeRoleKey(role) {
    return normalizeWhitespace(role).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  }

  function normalizeAudience(audience) {
    return normalizeWhitespace(audience).toLowerCase().startsWith('worker') ? 'workers' : 'students';
  }

  function slugify(value) {
    return normalizeWhitespace(value).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  }

  function getTypeMeta(type) {
    return TYPE_META[type] || TYPE_META.school_event;
  }

  function getEntryDefaults(type) {
    return { ...getTypeMeta(type).defaults };
  }

  function sanitizeList(values, mapper) {
    const input = Array.isArray(values) ? values : [];
    const output = [];
    const seen = new Set();
    input.forEach(function each(item) {
      const mapped = mapper(item);
      if (!mapped || seen.has(mapped)) return;
      seen.add(mapped);
      output.push(mapped);
    });
    return output;
  }

  function normalizeScope(scope) {
    const source = scope && typeof scope === 'object' ? scope : {};
    const classNames = sanitizeList(source.classNames, normalizeClassName);
    const workerRoles = sanitizeList(source.workerRoles, normalizeRoleKey);
    const workerIds = sanitizeList(source.workerIds, function mapWorkerId(id) { return normalizeWhitespace(id); });
    let wholeSchool = !!source.wholeSchool;
    const studentsOnly = !!source.studentsOnly;
    const workersOnly = !!source.workersOnly;
    if (!wholeSchool && !studentsOnly && !workersOnly && !classNames.length && !workerRoles.length && !workerIds.length) wholeSchool = true;
    return { wholeSchool, studentsOnly, workersOnly, classNames, workerRoles, workerIds };
  }

  function normalizeEffects(effects, type) {
    const defaults = getEntryDefaults(type);
    const source = effects && typeof effects === 'object' ? effects : {};
    return {
      blockStudentAttendance: source.blockStudentAttendance == null ? defaults.blockStudentAttendance : !!source.blockStudentAttendance,
      blockWorkerAttendance: source.blockWorkerAttendance == null ? defaults.blockWorkerAttendance : !!source.blockWorkerAttendance,
      countAsSchoolDay: source.countAsSchoolDay == null ? defaults.countAsSchoolDay : !!source.countAsSchoolDay,
      weekendOverrideWorkingDay: source.weekendOverrideWorkingDay == null ? defaults.weekendOverrideWorkingDay : !!source.weekendOverrideWorkingDay,
    };
  }

  function normalizeEntryPayload(entry, context) {
    const source = entry && typeof entry === 'object' ? entry : {};
    const type = TYPE_META[source.type] ? source.type : 'school_event';
    const now = Date.now();
    const startDate = normalizeIsoDate(source.startDate);
    const endDate = normalizeIsoDate(source.endDate || source.startDate);
    const id = normalizeWhitespace(source.id) || source._id || `calendar-${now}-${Math.random().toString(36).slice(2, 8)}`;
    const createdAt = Number(source.createdAt || 0) || now;
    return {
      id,
      title: normalizeWhitespace(source.title) || 'Untitled Calendar Entry',
      type,
      startDate,
      endDate: endDate || startDate,
      description: normalizeWhitespace(source.description),
      reason: normalizeWhitespace(source.reason),
      authorityNote: normalizeWhitespace(source.authorityNote),
      country: normalizeWhitespace(source.country || context.country || DEFAULT_COUNTRY) || DEFAULT_COUNTRY,
      schoolId: normalizeWhitespace(source.schoolId || context.schoolId || DEFAULT_SCHOOL_ID) || DEFAULT_SCHOOL_ID,
      active: source.active === false ? false : true,
      parentVisible: source.parentVisible == null ? getEntryDefaults(type).parentVisible : !!source.parentVisible,
      scope: normalizeScope(source.scope),
      effects: normalizeEffects(source.effects, type),
      createdAt,
      createdByWorkerId: normalizeWhitespace(source.createdByWorkerId || context.createdByWorkerId),
      createdByName: normalizeWhitespace(source.createdByName || context.createdByName),
      updatedAt: now,
    };
  }

  function entryPriority(entry) {
    const type = entry?.type || '';
    if (type === 'working_day_override') return 100;
    if (type === 'closure') return 90;
    if (type === 'school_break') return 80;
    if (type === 'reopening') return 70;
    if (type === 'public_holiday') return 60;
    return 20;
  }

  function getEasterSunday(year) {
    const y = Number(year);
    const a = y % 19;
    const b = Math.floor(y / 100);
    const c = y % 100;
    const d = Math.floor(b / 4);
    const e = b % 4;
    const f = Math.floor((b + 8) / 25);
    const g = Math.floor((b - f + 1) / 3);
    const h = (19 * a + b - d - g + 15) % 30;
    const i = Math.floor(c / 4);
    const k = c % 4;
    const l = (32 + 2 * e + 2 * i - h - k) % 7;
    const m = Math.floor((a + 11 * h + 22 * l) / 451);
    const month = Math.floor((h + l - 7 * m + 114) / 31);
    const day = ((h + l - 7 * m + 114) % 31) + 1;
    return new Date(y, month - 1, day);
  }

  function addDays(date, days) {
    const copy = new Date(date.getTime());
    copy.setDate(copy.getDate() + Number(days || 0));
    return copy;
  }

  function buildGeneratedHolidayEntry(type, date, title, extra) {
    const meta = getTypeMeta(type);
    const iso = normalizeIsoDate(date);
    return {
      id: `generated-${slugify(title)}-${iso}`,
      generated: true,
      title,
      type,
      startDate: iso,
      endDate: iso,
      description: normalizeWhitespace(extra?.description),
      reason: normalizeWhitespace(extra?.reason),
      authorityNote: normalizeWhitespace(extra?.authorityNote),
      parentVisible: true,
      active: true,
      source: extra?.source || 'catalog',
      scope: {
        wholeSchool: true,
        studentsOnly: false,
        workersOnly: false,
        classNames: [],
        workerRoles: [],
        workerIds: [],
      },
      effects: normalizeEffects(extra?.effects || {}, type),
      color: meta.color,
      background: meta.background,
      country: extra?.country || DEFAULT_COUNTRY,
      note: normalizeWhitespace(extra?.note),
    };
  }

  function getCountryCatalog(country) {
    const normalized = normalizeWhitespace(country).toLowerCase();
    if (!normalized || normalized === 'tanzania' || normalized === 'tz') {
      return {
        country: DEFAULT_COUNTRY,
        listPublicHolidays: function listPublicHolidays(year) {
          const yearValue = normalizeYear(year);
          const easter = getEasterSunday(yearValue);
          const generated = FIXED_TANZANIA_HOLIDAYS.map(function mapFixed(item) {
            return buildGeneratedHolidayEntry('public_holiday', `${yearValue}-${item.monthDay}`, item.title, {
              description: `${item.title} public holiday`,
              reason: `${item.title} public holiday`,
              country: DEFAULT_COUNTRY,
              source: 'tanzania-fixed',
            });
          });
          generated.push(
            buildGeneratedHolidayEntry('public_holiday', addDays(easter, -2), 'Good Friday', {
              description: 'Christian public holiday',
              reason: 'Good Friday public holiday',
              country: DEFAULT_COUNTRY,
              source: 'tanzania-easter',
            }),
            buildGeneratedHolidayEntry('public_holiday', addDays(easter, 1), 'Easter Monday', {
              description: 'Christian public holiday',
              reason: 'Easter Monday public holiday',
              country: DEFAULT_COUNTRY,
              source: 'tanzania-easter',
            })
          );
          const islamic = TANZANIA_ISLAMIC_PUBLIC_HOLIDAYS[yearValue];
          if (islamic) {
            (islamic.eidElFitri || []).forEach(function eachFitri(date, index) {
              generated.push(buildGeneratedHolidayEntry('public_holiday', date, index === 0 ? 'Eid el Fitri' : 'Eid el Fitri Holiday', {
                description: 'Islamic public holiday',
                reason: 'Eid el Fitri public holiday',
                authorityNote: 'Tentative in some future years and subject to moon sighting.',
                country: DEFAULT_COUNTRY,
                source: 'tanzania-islamic',
              }));
            });
            (islamic.eidAlAdha || []).forEach(function eachAdha(date) {
              generated.push(buildGeneratedHolidayEntry('public_holiday', date, 'Eid al-Adha', {
                description: 'Islamic public holiday',
                reason: 'Eid al-Adha public holiday',
                authorityNote: 'Tentative in some future years and subject to moon sighting.',
                country: DEFAULT_COUNTRY,
                source: 'tanzania-islamic',
              }));
            });
            (islamic.maulid || []).forEach(function eachMaulid(date) {
              generated.push(buildGeneratedHolidayEntry('public_holiday', date, 'Maulid', {
                description: 'Islamic public holiday',
                reason: 'Maulid public holiday',
                authorityNote: 'Tentative in some future years and subject to moon sighting.',
                country: DEFAULT_COUNTRY,
                source: 'tanzania-islamic',
              }));
            });
          }
          return generated.sort(function sortByDate(a, b) {
            return String(a.startDate).localeCompare(String(b.startDate));
          });
        },
      };
    }
    return {
      country: normalizeWhitespace(country) || DEFAULT_COUNTRY,
      listPublicHolidays: function listEmpty() {
        return [];
      },
    };
  }

  function getAudienceScopeMatch(entry, opts) {
    const scope = normalizeScope(entry?.scope);
    const audience = normalizeAudience(opts?.audience || 'students');
    const className = normalizeClassName(opts?.className);
    const workerRole = normalizeRoleKey(opts?.workerRole);
    const workerId = normalizeWhitespace(opts?.workerId);
    const hasStudentTargets = scope.wholeSchool || scope.studentsOnly || scope.classNames.length > 0;
    const hasWorkerTargets = scope.wholeSchool || scope.workersOnly || scope.workerRoles.length > 0 || scope.workerIds.length > 0;
    const classMatch = !scope.classNames.length || (className && scope.classNames.includes(className));
    const roleMatch = !scope.workerRoles.length || (workerRole && scope.workerRoles.includes(workerRole));
    const workerIdMatch = !scope.workerIds.length || (workerId && scope.workerIds.includes(workerId));
    let affectsStudents = false;
    let affectsWorkers = false;

    if (scope.wholeSchool) {
      affectsStudents = true;
      affectsWorkers = true;
    }
    if (scope.studentsOnly || scope.classNames.length) affectsStudents = classMatch;
    if (scope.workersOnly || scope.workerRoles.length || scope.workerIds.length) affectsWorkers = roleMatch && workerIdMatch;
    if (!hasStudentTargets && !hasWorkerTargets) {
      affectsStudents = true;
      affectsWorkers = true;
    }

    return {
      scope,
      audience,
      affectsStudents,
      affectsWorkers,
      appliesToAudience: audience === 'workers' ? affectsWorkers : affectsStudents,
      classMatch,
      roleMatch,
      workerIdMatch,
      hasStudentTargets,
      hasWorkerTargets,
    };
  }

  function describeScope(entry) {
    const scope = normalizeScope(entry?.scope);
    if (scope.wholeSchool) return 'Whole school';
    if (scope.studentsOnly && !scope.classNames.length) return 'Students only';
    if (scope.workersOnly && !scope.workerRoles.length && !scope.workerIds.length) return 'Workers only';
    if (scope.classNames.length) return `Classes: ${scope.classNames.join(', ')}`;
    if (scope.workerRoles.length) return `Worker roles: ${scope.workerRoles.join(', ')}`;
    if (scope.workerIds.length) return `Selected workers (${scope.workerIds.length})`;
    return 'Whole school';
  }

  function formatDateRange(startDate, endDate) {
    const start = normalizeIsoDate(startDate);
    const end = normalizeIsoDate(endDate || startDate);
    if (!start) return '';
    if (start === end) return start;
    return `${start} to ${end}`;
  }

  function buildBanner(primary, fallbackTitle, fallbackText) {
    const title = normalizeWhitespace(primary?.title || fallbackTitle);
    const range = formatDateRange(primary?.startDate, primary?.endDate);
    const scopeLabel = primary ? describeScope(primary) : '';
    const reason = normalizeWhitespace(primary?.reason || primary?.description);
    const authorityNote = normalizeWhitespace(primary?.authorityNote);
    const textParts = [];
    if (range) textParts.push(range);
    if (scopeLabel) textParts.push(scopeLabel);
    if (reason) textParts.push(reason);
    if (authorityNote) textParts.push(`Authority note: ${authorityNote}`);
    if (!textParts.length && fallbackText) textParts.push(fallbackText);
    return { title, text: textParts.join(' | ') };
  }

  async function getSchoolCalendarMeta(year, options) {
    const yearValue = normalizeYear(year);
    const schoolId = normalizeWhitespace(options?.schoolId || resolveSchoolId()) || DEFAULT_SCHOOL_ID;
    const cacheKey = `${schoolId}:${yearValue}`;
    if (cache.meta.has(cacheKey)) return { ...cache.meta.get(cacheKey) };

    const school = await loadSchoolProfileMeta(schoolId);
    const fallback = {
      country: normalizeWhitespace(options?.country || school?.country || school?.countryName || DEFAULT_COUNTRY) || DEFAULT_COUNTRY,
      schoolName: normalizeWhitespace(options?.schoolName || school?.name || school?.schoolName || school?.code || DEFAULT_SCHOOL_NAME) || DEFAULT_SCHOOL_NAME,
      schoolId,
      timezone: normalizeWhitespace(options?.timezone || school?.timezone || school?.timeZone || DEFAULT_TIMEZONE) || DEFAULT_TIMEZONE,
      weekendDays: Array.isArray(options?.weekendDays) ? options.weekendDays.slice() : DEFAULT_WEEKEND_DAYS.slice(),
      logoUrl: normalizeWhitespace(options?.logoUrl || school?.logoUrl || ''),
    };

    const ref = schoolRef(`years/${yearValue}/schoolCalendar/meta`, schoolId);
    if (!ref) {
      cache.meta.set(cacheKey, fallback);
      return { ...fallback };
    }

    try {
      const snap = await ref.once('value');
      const stored = snap.val() || {};
      const meta = {
        ...fallback,
        ...stored,
        country: normalizeWhitespace(stored.country || fallback.country) || DEFAULT_COUNTRY,
        schoolName: normalizeWhitespace(stored.schoolName || fallback.schoolName) || DEFAULT_SCHOOL_NAME,
        schoolId,
        timezone: normalizeWhitespace(stored.timezone || fallback.timezone) || DEFAULT_TIMEZONE,
        weekendDays: Array.isArray(stored.weekendDays) && stored.weekendDays.length ? stored.weekendDays.slice() : fallback.weekendDays.slice(),
        logoUrl: normalizeWhitespace(stored.logoUrl || fallback.logoUrl),
      };
      cache.meta.set(cacheKey, meta);
      return { ...meta };
    } catch (_error) {
      cache.meta.set(cacheKey, fallback);
      return { ...fallback };
    }
  }

  async function listSchoolCalendarEntries(year, options) {
    const yearValue = normalizeYear(year);
    const schoolId = normalizeWhitespace(options?.schoolId || resolveSchoolId()) || DEFAULT_SCHOOL_ID;
    const cacheKey = `${schoolId}:${yearValue}`;
    if (cache.entries.has(cacheKey) && !options?.forceRefresh) {
      return cache.entries.get(cacheKey).map(function cloneEntry(item) {
        return { ...item, scope: normalizeScope(item.scope), effects: normalizeEffects(item.effects, item.type) };
      });
    }

    const ref = schoolRef(`years/${yearValue}/schoolCalendar/entries`, schoolId);
    if (!ref) {
      cache.entries.set(cacheKey, []);
      return [];
    }

    try {
      const snap = await ref.once('value');
      const raw = snap.val() || {};
      const meta = await getSchoolCalendarMeta(yearValue, { schoolId });
      const entries = Object.keys(raw).map(function mapEntry(id) {
        return normalizeEntryPayload({ id, ...raw[id] }, meta);
      }).sort(function sortEntries(a, b) {
        if (a.startDate !== b.startDate) return String(a.startDate).localeCompare(String(b.startDate));
        return entryPriority(b) - entryPriority(a);
      });
      cache.entries.set(cacheKey, entries);
      return entries.map(function cloneEntry(item) {
        return { ...item, scope: normalizeScope(item.scope), effects: normalizeEffects(item.effects, item.type) };
      });
    } catch (_error) {
      cache.entries.set(cacheKey, []);
      return [];
    }
  }

  async function saveSchoolCalendarEntry(year, entry, options) {
    const yearValue = normalizeYear(year);
    const schoolId = normalizeWhitespace(options?.schoolId || entry?.schoolId || resolveSchoolId()) || DEFAULT_SCHOOL_ID;
    const meta = await getSchoolCalendarMeta(yearValue, {
      schoolId,
      country: entry?.country,
      schoolName: options?.schoolName,
      timezone: options?.timezone,
    });
    const ref = schoolRef(`years/${yearValue}/schoolCalendar/entries`, schoolId);
    const metaRef = schoolRef(`years/${yearValue}/schoolCalendar/meta`, schoolId);
    if (!ref || !metaRef) throw new Error('Firebase database is not available for calendar save.');

    const entryId = normalizeWhitespace(entry?.id) || ref.push().key || `calendar-${Date.now()}`;
    let existing = null;
    try {
      const existingSnap = await ref.child(entryId).once('value');
      existing = existingSnap.exists() ? existingSnap.val() || {} : null;
    } catch (_error) {
      existing = null;
    }

    const normalized = normalizeEntryPayload({
      ...(existing || {}),
      ...(entry || {}),
      id: entryId,
      createdAt: existing?.createdAt || entry?.createdAt || Date.now(),
      createdByWorkerId: existing?.createdByWorkerId || entry?.createdByWorkerId || options?.createdByWorkerId,
      createdByName: existing?.createdByName || entry?.createdByName || options?.createdByName,
      schoolId,
      country: entry?.country || meta.country,
    }, {
      ...meta,
      schoolId,
      createdByWorkerId: options?.createdByWorkerId,
      createdByName: options?.createdByName,
    });

    await Promise.all([
      metaRef.update({
        country: meta.country,
        schoolName: meta.schoolName,
        schoolId,
        timezone: meta.timezone,
        weekendDays: Array.isArray(meta.weekendDays) && meta.weekendDays.length ? meta.weekendDays.slice() : DEFAULT_WEEKEND_DAYS.slice(),
        logoUrl: meta.logoUrl || '',
      }),
      ref.child(entryId).set(normalized),
    ]);

    cache.meta.delete(`${schoolId}:${yearValue}`);
    cache.entries.delete(`${schoolId}:${yearValue}`);
    return normalized;
  }

  async function deleteSchoolCalendarEntry(year, entryId, options) {
    const yearValue = normalizeYear(year);
    const schoolId = normalizeWhitespace(options?.schoolId || resolveSchoolId()) || DEFAULT_SCHOOL_ID;
    const ref = schoolRef(`years/${yearValue}/schoolCalendar/entries/${entryId}`, schoolId);
    if (!ref) throw new Error('Firebase database is not available for calendar delete.');
    await ref.remove();
    cache.entries.delete(`${schoolId}:${yearValue}`);
    return true;
  }

  function choosePrimaryAnnouncement(result) {
    const override = result.matchedEntries.find(function findOverride(entry) {
      return entry.effects?.weekendOverrideWorkingDay;
    });
    if (override) return override;
    const blocking = result.matchedEntries.find(function findBlocking(entry) {
      return entry.effects?.blockStudentAttendance || entry.effects?.blockWorkerAttendance || entry.effects?.countAsSchoolDay === false;
    });
    if (blocking) return blocking;
    if (result.publicHolidayEntries[0]) return result.publicHolidayEntries[0];
    if (result.matchedEntries[0]) return result.matchedEntries[0];
    return null;
  }

  async function resolveDateStatus(options) {
    const audience = normalizeAudience(options?.audience || 'students');
    const schoolId = normalizeWhitespace(options?.schoolId || resolveSchoolId()) || DEFAULT_SCHOOL_ID;
    const yearValue = normalizeYear(options?.year || options?.date?.slice?.(0, 4));
    const date = normalizeIsoDate(options?.date);
    const className = normalizeClassName(options?.className);
    const workerRole = normalizeRoleKey(options?.workerRole);
    const workerId = normalizeWhitespace(options?.workerId);
    const meta = await getSchoolCalendarMeta(yearValue, { schoolId });
    const weekendDays = Array.isArray(meta.weekendDays) && meta.weekendDays.length ? meta.weekendDays : DEFAULT_WEEKEND_DAYS;
    const day = date ? new Date(`${date}T00:00:00`) : null;
    const weekDay = day && !Number.isNaN(day.getTime()) ? day.getDay() : -1;
    const isWeekend = weekendDays.includes(weekDay);
    const publicHolidayEntries = getCountryCatalog(meta.country).listPublicHolidays(yearValue).filter(function filterHoliday(item) {
      return item.startDate === date;
    });
    const entries = await listSchoolCalendarEntries(yearValue, { schoolId });
    const matchedEntries = entries
      .filter(function byActive(entry) { return entry.active !== false; })
      .filter(function inDate(entry) { return dateInRange(date, entry.startDate, entry.endDate); })
      .map(function mapEntry(entry) {
        const scopeMatch = getAudienceScopeMatch(entry, { audience, className, workerRole, workerId });
        return { entry, scopeMatch };
      })
      .filter(function byAudience(bundle) { return bundle.scopeMatch.appliesToAudience; })
      .sort(function sortBundles(a, b) {
        return entryPriority(b.entry) - entryPriority(a.entry);
      })
      .map(function unwrap(bundle) {
        return { ...bundle.entry, scopeMatch: bundle.scopeMatch };
      });

    let blockStudentAttendance = isWeekend;
    let blockWorkerAttendance = isWeekend;
    let countAsSchoolDayStudents = !isWeekend;
    let countAsSchoolDayWorkers = !isWeekend;

    if (publicHolidayEntries.length) {
      blockStudentAttendance = true;
      blockWorkerAttendance = true;
      countAsSchoolDayStudents = false;
      countAsSchoolDayWorkers = false;
    }

    let isWorkingOverride = false;
    matchedEntries.forEach(function applyEntry(entry) {
      const effects = normalizeEffects(entry.effects, entry.type);
      if (effects.weekendOverrideWorkingDay && isWeekend) {
        isWorkingOverride = true;
        if (entry.scopeMatch?.affectsStudents) {
          blockStudentAttendance = false;
          countAsSchoolDayStudents = true;
        }
        if (entry.scopeMatch?.affectsWorkers) {
          blockWorkerAttendance = false;
          countAsSchoolDayWorkers = true;
        }
      }
      if (entry.scopeMatch?.affectsStudents) {
        if (typeof effects.blockStudentAttendance === 'boolean' && (!isWeekend || effects.weekendOverrideWorkingDay || effects.blockStudentAttendance)) {
          blockStudentAttendance = effects.blockStudentAttendance;
        }
        if (typeof effects.countAsSchoolDay === 'boolean' && (!isWeekend || effects.weekendOverrideWorkingDay || effects.countAsSchoolDay === false)) {
          countAsSchoolDayStudents = effects.countAsSchoolDay;
        }
      }
      if (entry.scopeMatch?.affectsWorkers) {
        if (typeof effects.blockWorkerAttendance === 'boolean' && (!isWeekend || effects.weekendOverrideWorkingDay || effects.blockWorkerAttendance)) {
          blockWorkerAttendance = effects.blockWorkerAttendance;
        }
        if (typeof effects.countAsSchoolDay === 'boolean' && (!isWeekend || effects.weekendOverrideWorkingDay || effects.countAsSchoolDay === false)) {
          countAsSchoolDayWorkers = effects.countAsSchoolDay;
        }
      }
    });

    const countAsSchoolDay = audience === 'workers' ? countAsSchoolDayWorkers : countAsSchoolDayStudents;
    const primary = choosePrimaryAnnouncement({ matchedEntries, publicHolidayEntries });
    const isHeadteacherHoliday = matchedEntries.some(function findHoliday(entry) {
      return entry.effects?.blockStudentAttendance || entry.effects?.blockWorkerAttendance || entry.effects?.countAsSchoolDay === false;
    });
    const banner = primary
      ? buildBanner(primary, primary.title, '')
      : publicHolidayEntries[0]
        ? buildBanner(publicHolidayEntries[0], publicHolidayEntries[0].title, `${meta.country} public holiday`)
        : isWeekend
          ? buildBanner(null, 'Weekend', `${meta.schoolName} weekend`)
          : buildBanner(null, '', '');

    return {
      year: yearValue,
      date,
      schoolId,
      schoolName: meta.schoolName,
      country: meta.country,
      timezone: meta.timezone,
      weekendDays: weekendDays.slice(),
      audience,
      className,
      workerRole,
      workerId,
      isWeekend,
      isPublicHoliday: publicHolidayEntries.length > 0,
      isHeadteacherHoliday,
      isWorkingOverride,
      blockStudentAttendance,
      blockWorkerAttendance,
      countAsSchoolDay,
      countAsSchoolDayStudents,
      countAsSchoolDayWorkers,
      bannerTitle: banner.title,
      bannerText: banner.text,
      publicHolidayEntries,
      matchedEntries,
      matchedPublicHolidays: publicHolidayEntries,
      primaryEntry: primary,
      scopeLabel: primary ? describeScope(primary) : '',
    };
  }

  async function isStudentOffDay(options) {
    const result = await resolveDateStatus({ ...(options || {}), audience: 'students' });
    return !!result.blockStudentAttendance;
  }

  async function isWorkerOffDay(options) {
    const result = await resolveDateStatus({ ...(options || {}), audience: 'workers' });
    return !!result.blockWorkerAttendance;
  }

  async function isWorkingOverride(options) {
    const result = await resolveDateStatus(options || {});
    return !!result.isWorkingOverride;
  }

  async function getBannerForDate(options) {
    const result = await resolveDateStatus(options || {});
    if (!result.bannerTitle && !result.bannerText) return null;
    return {
      title: result.bannerTitle,
      text: result.bannerText,
      isHoliday: result.audience === 'workers' ? result.blockWorkerAttendance : result.blockStudentAttendance,
      isWorkingOverride: result.isWorkingOverride,
      matchedEntries: result.matchedEntries,
      publicHolidayEntries: result.publicHolidayEntries,
    };
  }

  function getSchoolCalendarTypeOptions() {
    return Object.keys(TYPE_META).map(function mapType(type) {
      return { value: type, label: TYPE_META[type].label, color: TYPE_META[type].color, background: TYPE_META[type].background };
    });
  }

  function getCountryPublicHolidayEntries(year, options) {
    const country = normalizeWhitespace(options?.country || DEFAULT_COUNTRY) || DEFAULT_COUNTRY;
    return getCountryCatalog(country).listPublicHolidays(normalizeYear(year));
  }

  function getDefaultCalendarMeta(overrides) {
    const source = overrides && typeof overrides === 'object' ? overrides : {};
    return {
      country: normalizeWhitespace(source.country || DEFAULT_COUNTRY) || DEFAULT_COUNTRY,
      schoolName: normalizeWhitespace(source.schoolName || DEFAULT_SCHOOL_NAME) || DEFAULT_SCHOOL_NAME,
      schoolId: normalizeWhitespace(source.schoolId || resolveSchoolId()) || DEFAULT_SCHOOL_ID,
      timezone: normalizeWhitespace(source.timezone || DEFAULT_TIMEZONE) || DEFAULT_TIMEZONE,
      weekendDays: Array.isArray(source.weekendDays) && source.weekendDays.length ? source.weekendDays.slice() : DEFAULT_WEEKEND_DAYS.slice(),
      logoUrl: normalizeWhitespace(source.logoUrl || ''),
    };
  }

  function invalidateCalendarCache(year, schoolId) {
    const key = `${normalizeWhitespace(schoolId || resolveSchoolId()) || DEFAULT_SCHOOL_ID}:${normalizeYear(year)}`;
    cache.meta.delete(key);
    cache.entries.delete(key);
  }

  global.SomapSchoolCalendar = {
    DEFAULT_LOGO,
    DEFAULT_COUNTRY,
    DEFAULT_TIMEZONE,
    DEFAULT_WEEKEND_DAYS: DEFAULT_WEEKEND_DAYS.slice(),
    KNOWN_CLASSES: KNOWN_CLASSES.slice(),
    TYPE_META,
    buildScopedPath,
    schoolRef,
    resolveSchoolId,
    normalizeYear,
    normalizeIsoDate,
    isoToDayKey,
    normalizeClassName,
    normalizeRoleKey,
    normalizeScope,
    normalizeEffects,
    normalizeEntryPayload,
    describeScope,
    formatDateRange,
    getDefaultCalendarMeta,
    getSchoolCalendarTypeOptions,
    getCountryPublicHolidayEntries,
    getSchoolCalendarMeta,
    listSchoolCalendarEntries,
    saveSchoolCalendarEntry,
    deleteSchoolCalendarEntry,
    resolveDateStatus,
    isStudentOffDay,
    isWorkerOffDay,
    isWorkingOverride,
    getBannerForDate,
    invalidateCalendarCache,
  };
})(typeof window !== 'undefined' ? window : globalThis);
