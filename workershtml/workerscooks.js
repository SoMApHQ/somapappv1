import { todayYMD, toast } from './modules/workers_helpers.js';
import { computeCookProjection } from './modules/workers_inventory.js';
import { fetchInventoryItems } from './modules/store.js';
import { loadLogicRules, computeExpectedList, aggregateExpected } from './modules/logicfood.js';
import { 
  ensureKitchenSeeded, 
  listKitchenItems, 
  upsertKitchenItem, 
  archiveKitchenItem, 
  buildDefaultDailyFromItems, 
  mergeDailyWithItems, 
  detectDailyChanges, 
  resolveYearKey 
} from './modules/vifaajikoni.js';

const { createElement: h, useEffect, useMemo, useRef, useState } = React;

const db = firebase.database();
const school = window.SOMAP?.getSchool?.();
if (!school || !school.id) {
  window.location.href = '../somapappv1multischool/multischool.html';
}
const schoolRef = (subPath) => db.ref(SOMAP.P(subPath));
const getYear = () => window.somapYearContext?.getSelectedYear?.() || new Date().getFullYear();
const SOMAP_DEFAULT_YEAR = 2025;
const STORE_ADMIN_PASSWORD = 'REHEMam!';

async function scopedOrSocratesLegacy(scopedSubPath, legacyPath) {
  const scopedSnap = await schoolRef(scopedSubPath).once('value');
  if (scopedSnap.exists()) return scopedSnap;
  const isSocrates = ['socrates-school', 'default', 'socrates'].includes(school?.id);
  if (isSocrates) {
    const legacySnap = await db.ref(legacyPath).once('value');
    if (legacySnap.exists()) return legacySnap;
  }
  return scopedSnap;
}

function normalizeClassKey(value = '') {
  return String(value || '').replace(/\s+/g, '').toLowerCase();
}

function normalizeClassName(name = '') {
  const s = String(name || '').trim();
  if (!s) return 'Unknown';
  const low = s.toLowerCase();
  if (low.includes('baby')) return 'Baby Class';
  if (low.includes('middle')) return 'Middle Class';
  if (low.includes('pre') || low.includes('nursery') || low.includes('unit')) return 'Pre Unit Class';
  const m = low.match(/class\s*(\d+)/) || low.match(/\b(\d+)\b/);
  if (m) return `Class ${parseInt(m[1], 10)}`;
  return s.replace(/\s+/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

const CLASS_ORDER = [
  'Baby Class',
  'Middle Class',
  'Pre Unit Class',
  'Class 1',
  'Class 2',
  'Class 3',
  'Class 4',
  'Class 5',
  'Class 6',
  'Class 7'
];

const WEEKDAYS = [
  { key: 'monday', label: 'Monday' },
  { key: 'tuesday', label: 'Tuesday' },
  { key: 'wednesday', label: 'Wednesday' },
  { key: 'thursday', label: 'Thursday' },
  { key: 'friday', label: 'Friday' },
  { key: 'saturday', label: 'Saturday' },
  { key: 'sunday', label: 'Sunday' }
];

function dayKeyFromDate(dateStr) {
  if (!dateStr) return 'monday';
  const d = new Date(`${dateStr}T00:00:00`);
  const idx = d.getDay(); // 0=Sun
  const map = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
  return map[idx] || 'monday';
}

function mkEmptyDayPlan() {
  return { studentBreakfast: [], workerBreakfast: [], lunch: [], note: '', updatedAt: 0 };
}

function schoolNameLabel() {
  return school?.name || school?.id || 'Socrates School';
}

function formatTzs(value) {
  return `TZS ${Math.round(Number(value) || 0).toLocaleString()}`;
}

function shiftClass(baseClass, deltaYears) {
  const normalized = normalizeClassName(baseClass);
  const idx = CLASS_ORDER.findIndex(c => c.toLowerCase() === normalized.toLowerCase());
  if (idx < 0) return normalized || 'Unknown';
  const next = idx + Number(deltaYears || 0);
  if (next < 0) return 'Pre-Admission';
  if (next >= CLASS_ORDER.length) return 'GRADUATED';
  return CLASS_ORDER[next];
}

function normalizeEnrollments(raw) {
  if (!raw || typeof raw !== 'object') return {};
  const normalized = {};
  Object.entries(raw).forEach(([key, value]) => {
    if (value && typeof value === 'object' && (value.studentId || value.id || value.className || value.classLevel || value.class || value.grade)) {
      const entryId = value.id || value.studentId || key;
      normalized[entryId] = { ...value };
      return;
    }
    if (value && typeof value === 'object') {
      Object.entries(value).forEach(([stuId, stuVal]) => {
        const entry = (stuVal && typeof stuVal === 'object') ? { ...stuVal } : {};
        if (!entry.className && !entry.classLevel && !entry.class && !entry.grade) {
          entry.className = key;
        }
        const entryId = entry.id || entry.studentId || stuId;
        normalized[entryId] = Object.assign(normalized[entryId] || {}, entry);
      });
    }
  });
  return normalized;
}

function buildEnrollmentIndex(enrollments) {
  const byId = enrollments || {};
  const byAdmission = {};
  Object.entries(enrollments || {}).forEach(([key, value]) => {
    if (!value || typeof value !== 'object') return;
    const admission = value.admissionNumber || value.admissionNo || value.admNo || '';
    if (admission && !byAdmission[admission]) {
      byAdmission[admission] = value;
    }
    if (!byId[key]) byId[key] = value;
  });
  return { byId, byAdmission };
}

function lookupEnrollment(index, studentId, admissionNo) {
  if (!index) return {};
  if (studentId && index.byId?.[studentId]) return index.byId[studentId];
  if (admissionNo && index.byId?.[admissionNo]) return index.byId[admissionNo];
  if (admissionNo && index.byAdmission?.[admissionNo]) return index.byAdmission[admissionNo];
  return {};
}

function getPromotedClassName(current = '') {
  const key = normalizeClassKey(current);
  const ladder = {
    baby: 'Middle',
    middle: 'Preunit',
    preunit: 'Class1',
    class1: 'Class2',
    class2: 'Class3',
    class3: 'Class4',
    class4: 'Class5',
    class5: 'Class6',
    class6: 'Class7',
    class7: 'Graduated/Archive'
  };
  return ladder[key] || current || '';
}

async function runRolloverIfNeeded(targetYear) {
  if (!targetYear) return;
  const flagRef = schoolRef(`meta/rolloverDone/${targetYear}`);
  const flagSnap = await flagRef.get();
  if (flagSnap.exists()) return;

  const previousYear = String(Number(targetYear) - 1);
  const srcSnap = await schoolRef(`years/${previousYear}/students`).get();
  const existingDestSnap = await schoolRef(`years/${targetYear}/students`).get();
  const existingIds = new Set();
  existingDestSnap.forEach(ch => existingIds.add(ch.key));
  if (srcSnap.exists()) {
    const updates = {};
    srcSnap.forEach(ch => {
      if (existingIds.has(ch.key)) return;
      const student = ch.val() || {};
      const nextClass = getPromotedClassName(student.class || student.className || '');
      updates[ch.key] = {
        ...student,
        class: nextClass,
        className: nextClass,
        rolledOverFrom: previousYear
      };
    });
    if (Object.keys(updates).length) {
      await schoolRef(`years/${targetYear}/students`).update(updates);
    }
  }
  await flagRef.set(true);
}

const statusLabels = {
  pending: 'Bado hujatoa ripoti leo.',
  ok: 'Ripoti imehifadhiwa',
  flagged: 'Ripoti imeangaziwa',
  missing: 'Ripoti haijatumwa'
};

function safeNumber(value) {
  const cleaned = String(value ?? '').replace(/[\s,]+/g, '');
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : 0;
}

function normalizeItemName(value = '') {
  const raw = String(value || '').trim().toLowerCase();
  if (!raw) return '';
  const compact = raw.replace(/\s+/g, '');
  if (compact.includes('mahindi') || compact.includes('maize')) return 'maize';
  return compact;
}

function getWorkerSession() {
  const workerId = localStorage.getItem('workerId') || sessionStorage.getItem('workerId') || '';
  const workerRole = localStorage.getItem('workerRole') || sessionStorage.getItem('workerRole') || '';
  const schoolId = school?.id || '';
  return { workerId, workerRole, schoolId };
}

function normalizeStudent(id, data = {}) {
  const gender = (data.gender || '').toString().toLowerCase();
  const className = data.className || data.classLevel || data.class || data.grade || 'Unknown';
  const fullName = [data.firstName, data.middleName, data.lastName, data.fullName, data.name]
    .filter(Boolean)
    .join(' ')
    .trim() || id;
  const admissionNo = data.admissionNumber || data.admissionNo || data.admNo || '';
  return {
    id,
    gender: gender.startsWith('m') || gender.startsWith('b') ? 'boys'
      : gender.startsWith('f') || gender.startsWith('g') ? 'girls'
      : 'unknown',
    className,
    fullName,
    admissionNo
  };
}

function isPresent(rec = {}) {
  // Must match attendance.html Daily Register logic exactly
  const dailyCode = String(rec?.daily || rec?.status || '').toUpperCase();
  return dailyCode.startsWith('P');
}

function App() {
  const today = todayYMD();
  const [reportDate, setReportDate] = useState(today);
  const [workerSession, setWorkerSession] = useState(getWorkerSession());
  const [currentYear, setCurrentYear] = useState(String(getYear()));
  const [students, setStudents] = useState({});
  const [registerStats, setRegisterStats] = useState({
    classNames: [],
    perClass: {},
    totals: { registered: { boys: 0, girls: 0, total: 0 }, present: { boys: 0, girls: 0, total: 0 }, absent: { boys: 0, girls: 0, total: 0 } }
  });
  const autoPax = Number(registerStats?.totals?.present?.total || 0);
  const [registerLoading, setRegisterLoading] = useState(true);
  const [registerError, setRegisterError] = useState('');

  const [inventoryItems, setInventoryItems] = useState([]);
  const [logicRules, setLogicRules] = useState({});
  const [marketCatalog, setMarketCatalog] = useState({ categories: [], shops: [], itemsBySeller: {} });

  const [headcountLocked, setHeadcountLocked] = useState(false);
  const [menuSelections, setMenuSelections] = useState({ breakfast: [], lunch: [] });
  const [menuText, setMenuText] = useState({ breakfast: '', lunch: '' });
  const [issued, setIssued] = useState({ sugar_kg: '', oil_l: '' });
  const [used, setUsed] = useState({ sugar_kg: '', oil_l: '' });
  const [expectedPolicy, setExpectedPolicy] = useState({ sugar_kg: 0, oil_l: 0 });
  const [expectedList, setExpectedList] = useState([]);

  const [existingReport, setExistingReport] = useState(null);
  const [reportStatus, setReportStatus] = useState('pending');
  const [saving, setSaving] = useState(false);
  const [fatalError, setFatalError] = useState('');
  const [storeOpen, setStoreOpen] = useState(true);
  const [logicOpen, setLogicOpen] = useState(false);
  const [newItem, setNewItem] = useState({ name: '', unit: '', onHand: '', unitPrice: '', marketCatId: '', marketSellerId: '', marketItemId: '' });
  const [editingStoreItem, setEditingStoreItem] = useState(null);
  const [newRule, setNewRule] = useState({ itemId: '', perChild: '', unit: '', perMeal: 'both', rounding: 'round' });
  const [weekPlan, setWeekPlan] = useState({});
  const [savingPlan, setSavingPlan] = useState(false);
  const [workerPresence, setWorkerPresence] = useState({ totalWorkers: 0, present: 0, pending: 0, absent: 0, malePresent: 0, femalePresent: 0 });
  const [foodInvoice, setFoodInvoice] = useState(null);

  const [kitchenItems, setKitchenItems] = useState([]);
  const [kitchenDaily, setKitchenDaily] = useState({});
  const [kitchenYesterday, setKitchenYesterday] = useState({});
  const [kitchenMasterOpen, setKitchenMasterOpen] = useState(false);
  const [editingKitchenItem, setEditingKitchenItem] = useState(null);
  const [kitchenForm, setKitchenForm] = useState({ 
    name: '', unit: 'pcs', category: 'utensil', 
    qtyTotal: 0, sourceType: 'purchased', sourceName: '', 
    unitPrice: 0, note: '', acquiredDate: '' 
  });
  const yearInitRef = useRef(false);

  useEffect(() => {
    if (!workerSession.workerId) {
      toast('Hakuna taarifa za mtumiaji. Tafadhali ingia tena.', 'error');
      window.location.href = '../index.html';
      return;
    }
    loadBootstrap();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workerSession.workerId]);

  useEffect(() => {
    if (!workerSession.workerId) return;
    loadExistingReport(reportDate);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reportDate, workerSession.workerId, kitchenItems, currentYear]);

  useEffect(() => {
    if (!reportDate) return;
    if (!Object.keys(students || {}).length) return;
    loadRegister(reportDate);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reportDate, students]);

  useEffect(() => {
    if (!reportDate || !workerSession.workerId) return;
    loadWorkerPresence(reportDate);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reportDate, workerSession.workerId, currentYear]);

  useEffect(() => {
    const yearSelect = document.getElementById('yearSelect');
    if (window.somapYearContext && yearSelect) {
      somapYearContext.attachYearDropdown(yearSelect);
      if (!yearInitRef.current) {
        const systemYear = String(new Date().getFullYear());
        const selected = String(somapYearContext.getSelectedYear?.() || systemYear);
        if (Number(selected) < Number(systemYear)) {
          somapYearContext.resetToCurrentYear?.();
        }
        somapYearContext.onYearChanged((y) => {
          const nextYear = String(y);
          setCurrentYear(nextYear);
          setReportDate((prev) => {
            if (!prev) return `${nextYear}-01-01`;
            const parts = String(prev).split('-');
            if (parts.length !== 3) return `${nextYear}-01-01`;
            return `${nextYear}-${parts[1]}-${parts[2]}`;
          });
        });
        yearInitRef.current = true;
      }
    }
  }, [currentYear]);

  useEffect(() => {
    if (!workerSession.workerId) return;
    runRolloverIfNeeded(currentYear).catch(err => console.error('Rollover error', err));
    loadBootstrap();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentYear]);

  const selectedDayKey = useMemo(() => dayKeyFromDate(reportDate), [reportDate]);
  const selectedDayPlan = useMemo(() => weekPlan[selectedDayKey] || mkEmptyDayPlan(), [weekPlan, selectedDayKey]);
  const saturdayStudentPax = (registerStats?.perClass?.['Class 4']?.present?.total || 0) + (registerStats?.perClass?.['Class 7']?.present?.total || 0);
  const studentBreakfastPax = selectedDayKey === 'sunday' ? 0 : (selectedDayKey === 'saturday' ? saturdayStudentPax : autoPax);
  const workersBreakfastPax = selectedDayKey === 'sunday' ? 0 : Number(workerPresence.present || 0);
  const lunchPax = selectedDayKey === 'sunday' ? 0 : studentBreakfastPax + workersBreakfastPax;

  useEffect(() => {
    computeCookProjection({ breakfastPax: studentBreakfastPax + workersBreakfastPax, lunchPax })
      .then(setExpectedPolicy)
      .catch(err => console.error(err));
  }, [studentBreakfastPax, workersBreakfastPax, lunchPax]);

  useEffect(() => {
    const rules = logicRules || {};
    const studentBreakfastList = computeExpectedList({
      pax: studentBreakfastPax,
      selections: selectedDayPlan.studentBreakfast || [],
      rules,
      meal: 'breakfast',
      inventoryItems
    });
    const workerBreakfastList = computeExpectedList({
      pax: workersBreakfastPax,
      selections: selectedDayPlan.workerBreakfast || [],
      rules,
      meal: 'breakfast',
      inventoryItems
    });
    const lunchList = computeExpectedList({
      pax: lunchPax,
      selections: selectedDayPlan.lunch || [],
      rules,
      meal: 'lunch',
      inventoryItems
    });
    const allExpected = aggregateExpected([...studentBreakfastList, ...workerBreakfastList, ...lunchList]);
    setExpectedList(allExpected);

    const breakfastUnion = Array.from(new Set([...(selectedDayPlan.studentBreakfast || []), ...(selectedDayPlan.workerBreakfast || [])]));
    setMenuSelections({ breakfast: breakfastUnion, lunch: selectedDayPlan.lunch || [] });
    setMenuText({
      breakfast: breakfastUnion
        .map(id => inventoryItems.find(it => it.id === id)?.name || id)
        .join(', '),
      lunch: (selectedDayPlan.lunch || [])
        .map(id => inventoryItems.find(it => it.id === id)?.name || id)
        .join(', ')
    });
  }, [selectedDayPlan, studentBreakfastPax, workersBreakfastPax, lunchPax, logicRules, inventoryItems]);

  useEffect(() => {
    const timer = setTimeout(() => {
      upsertDraftInvoice().catch(err => console.warn('Draft invoice sync failed', err));
    }, 600);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reportDate, selectedDayKey, selectedDayPlan, expectedList, studentBreakfastPax, workersBreakfastPax, lunchPax, currentYear]);

  async function loadBootstrap() {
    try {
      setRegisterLoading(true);
      await ensureKitchenSeeded({ schoolId: workerSession.schoolId, yearLike: currentYear });

      const [studentsMap, items, rules, kItems, marketData, weeklyPlan] = await Promise.all([
        loadStudents(workerSession.schoolId, currentYear),
        fetchInventoryItems(workerSession.schoolId),
        loadLogicRules(workerSession.schoolId),
        listKitchenItems({ schoolId: workerSession.schoolId, yearLike: currentYear }),
        loadMarketCatalog(),
        loadWeekPlan()
      ]);
      setStudents(studentsMap);
      setInventoryItems(items);
      setLogicRules(rules);
      setKitchenItems(kItems);
      setMarketCatalog(marketData);
      setWeekPlan(weeklyPlan);
      
      await loadRegister(reportDate, studentsMap);
      await loadWorkerPresence(reportDate);
    } catch (err) {
      console.error(err);
      setFatalError(err.message || 'Hitilafu ya kuanzisha ukurasa.');
    } finally {
      setRegisterLoading(false);
    }
  }

  async function loadWeekPlan() {
    const ref = schoolRef(`years/${currentYear}/kitchen_timetable/weekly`);
    const snap = await ref.once('value').catch(() => null);
    const raw = snap?.val() || {};
    const plan = {};
    WEEKDAYS.forEach(({ key }) => {
      plan[key] = {
        ...mkEmptyDayPlan(),
        ...(raw[key] || {})
      };
    });
    return plan;
  }

  async function saveDayPlan(dayKey, patch) {
    const next = {
      ...mkEmptyDayPlan(),
      ...(weekPlan[dayKey] || {}),
      ...(patch || {}),
      updatedAt: Date.now(),
      updatedBy: workerSession.workerId || ''
    };
    setSavingPlan(true);
    try {
      await schoolRef(`years/${currentYear}/kitchen_timetable/weekly/${dayKey}`).set(next);
      setWeekPlan(prev => ({ ...prev, [dayKey]: next }));
      toast(`Ratiba ya ${dayKey} imehifadhiwa.`, 'success');
    } catch (err) {
      console.error(err);
      toast(err.message || 'Imeshindikana kuhifadhi ratiba.', 'error');
    } finally {
      setSavingPlan(false);
    }
  }

  async function loadWorkerPresence(dateKey) {
    if (!dateKey) return;
    try {
      const ymdCompact = String(dateKey).replace(/-/g, '');
      const monthKey = `${String(currentYear)}${String(dateKey).slice(5, 7)}`;
      const [workersSnap, attendanceSnap] = await Promise.all([
        schoolRef(`years/${currentYear}/workers`).once('value'),
        schoolRef(`years/${currentYear}/workerAttendance`).once('value')
      ]);
      const workers = workersSnap.val() || {};
      const attendance = attendanceSnap.val() || {};
      let totalWorkers = 0;
      let present = 0;
      let pending = 0;
      let absent = 0;
      let malePresent = 0;
      let femalePresent = 0;

      Object.entries(workers).forEach(([workerId, worker]) => {
        const profile = worker?.profile || {};
        const status = String(profile.status || worker.status || 'active').toLowerCase();
        if (status && status !== 'active' && status !== 'hai') return;
        totalWorkers += 1;
        const record = attendance?.[workerId]?.[monthKey]?.[ymdCompact] || null;
        const inStatus = String(record?.checkInStatus || '').toLowerCase();
        const approvedLegacy = record?.approved === true;
        const isApproved = inStatus === 'approved' || approvedLegacy;
        const isPending = !!record?.checkInTs && !isApproved && inStatus !== 'rejected';
        if (isApproved) {
          present += 1;
          const g = String(profile.gender || profile.sex || '').toLowerCase();
          if (g.startsWith('m')) malePresent += 1;
          else if (g.startsWith('f')) femalePresent += 1;
        } else if (isPending) {
          pending += 1;
        } else {
          absent += 1;
        }
      });
      setWorkerPresence({ totalWorkers, present, pending, absent, malePresent, femalePresent });
    } catch (err) {
      console.error('Failed to load worker presence', err);
      setWorkerPresence({ totalWorkers: 0, present: 0, pending: 0, absent: 0, malePresent: 0, femalePresent: 0 });
    }
  }

  async function loadMarketCatalog() {
    try {
      const [catSnap, shopSnap, itemsSnap] = await Promise.all([
        db.ref('marketinghub/public/categories').once('value'),
        db.ref('marketinghub/public/shops').once('value'),
        db.ref('marketinghub/public/items').once('value')
      ]);
      const categories = Object.entries(catSnap.val() || {}).map(([id, v]) => ({ id, ...(v || {}) }));
      const shops = Object.entries(shopSnap.val() || {}).map(([id, v]) => ({ id, ...(v || {}) }));
      const itemsBySeller = {};
      Object.entries(itemsSnap.val() || {}).forEach(([sellerId, items]) => {
        itemsBySeller[sellerId] = Object.entries(items || {}).map(([id, item]) => ({ id, sellerId, ...(item || {}) }));
      });
      return { categories, shops, itemsBySeller };
    } catch (err) {
      console.warn('Failed to load market data', err);
      return { categories: [], shops: [], itemsBySeller: {} };
    }
  }

  async function loadStudents(schoolId, yearKey) {
    const selectedYear = String(yearKey || SOMAP_DEFAULT_YEAR);
    const baseSnap = await scopedOrSocratesLegacy('students', 'students').catch(() => null);
    const baseStudents = baseSnap?.exists() ? baseSnap.val() || {} : {};
    const deltaYears = Number(selectedYear) - SOMAP_DEFAULT_YEAR;
    const [yearEnrollSnap, anchorEnrollSnap] = await Promise.all([
      scopedOrSocratesLegacy(`enrollments/${selectedYear}`, `enrollments/${selectedYear}`).catch(() => null),
      scopedOrSocratesLegacy(`enrollments/${SOMAP_DEFAULT_YEAR}`, `enrollments/${SOMAP_DEFAULT_YEAR}`).catch(() => null)
    ]);
    const yearIndex = buildEnrollmentIndex(normalizeEnrollments(yearEnrollSnap?.exists() ? yearEnrollSnap.val() : {}));
    const anchorIndex = buildEnrollmentIndex(normalizeEnrollments(anchorEnrollSnap?.exists() ? anchorEnrollSnap.val() : {}));

    const normalized = {};
    Object.entries(baseStudents).forEach(([id, data]) => {
      const status = String(data?.status || '').toLowerCase();
      if (status === 'shifted') return;
      const admissionNo = data?.admissionNumber || data?.admissionNo || data?.admNo || '';
      const yearEnroll = lookupEnrollment(yearIndex, id, admissionNo);
      let classRaw = yearEnroll.className || yearEnroll.classLevel || yearEnroll.class || yearEnroll.grade || '';
      if (!classRaw) {
        const anchorEnroll = lookupEnrollment(anchorIndex, id, admissionNo);
        const baseClass = anchorEnroll.className || anchorEnroll.classLevel || anchorEnroll.class || anchorEnroll.grade ||
          data.className || data.classLevel || data.class || data.grade || 'Unknown';
        classRaw = shiftClass(baseClass, deltaYears);
        if (classRaw === 'GRADUATED') return;
      } else if (String(classRaw).trim().toUpperCase() === 'GRADUATED') {
        return;
      }
      const className = normalizeClassName(classRaw);
      normalized[id] = normalizeStudent(id, { ...data, className, class: className, grade: className, admissionNo });
    });

    if (Object.keys(normalized).length) return normalized;

    const scopedPath = `years/${yearKey}/students`;
    const snap = await scopedOrSocratesLegacy(scopedPath, 'students').catch(() => null);
    if (snap && snap.exists()) {
      const raw = snap.val() || {};
      const fallback = {};
      Object.entries(raw).forEach(([id, data]) => {
        fallback[id] = normalizeStudent(id, data);
      });
      return fallback;
    }
    return {};
  }

async function loadAttendance(dateKey) {
  if (!dateKey) return {};
  const monthKeyDash = String(dateKey.slice(0, 7)); // "2026-02"
  const monthKeyCompact = `${dateKey.slice(0, 4)}${dateKey.slice(5, 7)}`; // fallback "202602" (legacy)
  const byClass = {};

  await Promise.all(
    CLASS_ORDER.map(async (cls) => {
      try {
        let snap = await schoolRef(`attendance/${cls}/${monthKeyDash}/${dateKey}`).get();
        if (!snap.exists()) {
          // fallback for any legacy stored monthKey formats
          snap = await schoolRef(`attendance/${cls}/${monthKeyCompact}/${dateKey}`).get();
        }
        byClass[cls] = snap.exists() ? (snap.val() || {}) : {};
      } catch (err) {
        console.warn(`Failed to load attendance for ${cls} on ${dateKey}:`, err?.message || err);
        byClass[cls] = {};
      }
    })
  );

  return byClass;
}

  async function loadRegister(dateKey, studentMap = students) {
    setRegisterLoading(true);
    setRegisterError('');
    try {
      const attendanceByClass = await loadAttendance(dateKey);
      const stats = buildRegisterStats(studentMap, attendanceByClass);
      setRegisterStats(stats);
    } catch (err) {
      console.error(err);
      setRegisterError(err.message || 'Imeshindikana kupakia rejesta.');
    } finally {
      setRegisterLoading(false);
    }
  }

function buildRegisterStats(studentMap, attendanceByClass) {
    const perClass = { Unknown: makeBlankCounts() };
    const classNamesSet = new Set(['Unknown']);
    Object.values(studentMap || {}).forEach(student => {
      const cls = student.className || 'Unknown';
      classNamesSet.add(cls);
      if (!perClass[cls]) perClass[cls] = makeBlankCounts();
      perClass[cls].registered.total += 1;
      if (student.gender === 'boys') perClass[cls].registered.boys += 1;
      if (student.gender === 'girls') perClass[cls].registered.girls += 1;
    });

    // Present counts MUST follow attendance.html:
    // present if String(record.daily||\"\").toUpperCase().startsWith(\"P\")
    Object.entries(attendanceByClass || {}).forEach(([cls, records]) => {
      if (!perClass[cls]) perClass[cls] = makeBlankCounts();
      classNamesSet.add(cls);

      Object.entries(records || {}).forEach(([key, rec]) => {
        if (!isPresent(rec)) return;

        perClass[cls].present.total += 1;

        // Gender: prefer roster lookup, fallback to record
        const rosterStudent = studentMap[key];
        const gender = rosterStudent?.gender || normalizeStudent(key, rec).gender;

        if (gender === 'boys') perClass[cls].present.boys += 1;
        if (gender === 'girls') perClass[cls].present.girls += 1;
      });
    });

    Object.keys(perClass).forEach(cls => {
      perClass[cls].absent.total = Math.max(0, perClass[cls].registered.total - perClass[cls].present.total);
      perClass[cls].absent.boys = Math.max(0, perClass[cls].registered.boys - perClass[cls].present.boys);
      perClass[cls].absent.girls = Math.max(0, perClass[cls].registered.girls - perClass[cls].present.girls);
    });

    const classNames = Array.from(classNamesSet).sort();
    const totals = classNames.reduce(
      (acc, cls) => {
        acc.registered.boys += perClass[cls].registered.boys;
        acc.registered.girls += perClass[cls].registered.girls;
        acc.registered.total += perClass[cls].registered.total;
        acc.present.boys += perClass[cls].present.boys;
        acc.present.girls += perClass[cls].present.girls;
        acc.present.total += perClass[cls].present.total;
        acc.absent.boys += perClass[cls].absent.boys;
        acc.absent.girls += perClass[cls].absent.girls;
        acc.absent.total += perClass[cls].absent.total;
        return acc;
      },
      makeBlankCounts()
    );

    return { classNames, perClass, totals };
  }

  function makeBlankCounts() {
    return {
      registered: { boys: 0, girls: 0, total: 0 },
      present: { boys: 0, girls: 0, total: 0 },
      absent: { boys: 0, girls: 0, total: 0 }
    };
  }

  async function loadExistingReport(dateKey) {
    try {
      // Load yesterday
      const yesterday = new Date(new Date(dateKey).getTime() - 86400000).toISOString().split('T')[0];
      const prevRef = schoolRef(`years/${currentYear}/workerRoles/cook/daily/${yesterday}/${workerSession.workerId}/kitchenInventory`);
      const prevSnap = await prevRef.once('value').catch(() => null);
      setKitchenYesterday(prevSnap?.val() || {});

      const ref = schoolRef(`years/${currentYear}/workerRoles/cook/daily/${dateKey}/${workerSession.workerId}`);
      const [snap, invoiceSnap] = await Promise.all([
        ref.once('value'),
        schoolRef(`years/${currentYear}/foodInvoices/${dateKey}`).once('value')
      ]);
      setFoodInvoice(invoiceSnap.exists() ? invoiceSnap.val() : null);
      if (snap.exists()) {
        const data = snap.val();
        setExistingReport(data);
        setReportStatus(data.status || 'ok');
        setHeadcountLocked(true);
        setMenuSelections({
          breakfast: data.menuIds?.breakfast || [],
          lunch: data.menuIds?.lunch || []
        });
        setMenuText({
          breakfast: data.menuText?.breakfast || (data.menu?.breakfast || []).join(', '),
          lunch: data.menuText?.lunch || (data.menu?.lunch || []).join(', ')
        });
        setIssued({
          sugar_kg: data.issued?.sugar_kg ?? '',
          oil_l: data.issued?.oil_l ?? ''
        });
        setUsed({
          sugar_kg: data.used?.sugar_kg ?? '',
          oil_l: data.used?.oil_l ?? ''
        });
        setKitchenDaily(mergeDailyWithItems(data.kitchenInventory, kitchenItems));
      } else {
        setExistingReport(null);
        setReportStatus('pending');
        setKitchenDaily(mergeDailyWithItems({}, kitchenItems));
      }
    } catch (err) {
      console.error(err);
      setExistingReport(null);
      setReportStatus('pending');
      setKitchenDaily(mergeDailyWithItems({}, kitchenItems));
    }
  }

  function toggleSelection(meal, itemId) {
    setMenuSelections(prev => {
      const current = new Set(prev[meal]);
      if (current.has(itemId)) current.delete(itemId);
      else current.add(itemId);
      const nextArr = Array.from(current);
      const itemNames = inventoryItems
        .filter(it => nextArr.includes(it.id))
        .map(it => it.name)
        .join(', ');
      setMenuText(v => ({ ...v, [meal]: itemNames }));
      return { ...prev, [meal]: nextArr };
    });
  }

  function statusBadge(statusKey) {
    const key = statusKey || 'pending';
    return h('span', { className: `status-badge status-${key}` }, statusLabels[key] || statusLabels.pending);
  }

  function inventoryPath() {
    return `years/${currentYear}/workers_inventory/items`;
  }

  function promptStorePassword(actionLabel) {
    const pwd = window.prompt(`Ingiza nenosiri kwa ${actionLabel}:`);
    if (pwd === STORE_ADMIN_PASSWORD) return true;
    toast('Nenosiri si sahihi.', 'error');
    return false;
  }

  async function deleteStoreItem(item) {
    if (!promptStorePassword('kufuta bidhaa')) return;
    if (!confirm(`Una uhakika unataka kufuta "${item.name}"?`)) return;
    try {
      await schoolRef(`${inventoryPath()}/${item.id}`).remove();
      const isSocrates = ['socrates-school', 'default', 'socrates'].includes(school?.id);
      if (isSocrates) {
        await db.ref(`inventory/items/${item.id}`).remove();
      }
      toast('Bidhaa imefutwa.', 'success');
      const items = await fetchInventoryItems(workerSession.schoolId);
      setInventoryItems(items);
    } catch (err) {
      console.error(err);
      toast(err.message || 'Imeshindikana kufuta bidhaa.', 'error');
    }
  }

  function startEditStoreItem(item) {
    if (!promptStorePassword('kuhariri bidhaa')) return;
    setEditingStoreItem(item);
    setNewItem({
      name: item.name,
      unit: item.unit || '',
      onHand: String(item.onHand ?? ''),
      unitPrice: String(item.unitPrice ?? ''),
      marketCatId: item.market?.catId || '',
      marketSellerId: item.market?.sellerId || '',
      marketItemId: item.market?.itemId || ''
    });
    setStoreOpen(true);
    scrollToSection('store-panel');
  }

  function cancelEditStoreItem() {
    setEditingStoreItem(null);
    setNewItem({ name: '', unit: '', onHand: '', unitPrice: '', marketCatId: '', marketSellerId: '', marketItemId: '' });
  }

  function logicPath() {
    return `years/${currentYear}/kitchen_logic/rules`;
  }

  function scrollToSection(sectionId) {
    const el = document.getElementById(sectionId);
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function renderQuickCards() {
    return h('section', { className: 'quick-cards' }, [
      h('div', { className: 'mini-card', onClick: () => { setStoreOpen(true); scrollToSection('store-panel'); } }, [
        h('p', { className: 'mini-card__label' }, 'Stoo'),
        h('p', { className: 'mini-card__value' }, `${inventoryItems.length} bidhaa`),
        h('p', { className: 'mini-card__hint' }, 'Fungua, ongeza, chagua menyu')
      ]),
      h('div', { className: 'mini-card', onClick: () => { setLogicOpen(true); scrollToSection('logic-panel'); } }, [
        h('p', { className: 'mini-card__label' }, 'Logic Food'),
        h('p', { className: 'mini-card__value' }, `${Object.keys(logicRules || {}).length} kanuni`),
        h('p', { className: 'mini-card__hint' }, 'Ongeza au hakiki kanuni za matumizi')
      ]),
      h('div', { className: 'mini-card', onClick: () => scrollToSection('menu-section') }, [
        h('p', { className: 'mini-card__label' }, 'Workers Today'),
        h('p', { className: 'mini-card__value' }, `${workerPresence.present}/${workerPresence.totalWorkers}`),
        h('p', { className: 'mini-card__hint' }, 'Approved, kutoka Headteacher')
      ])
    ]);
  }

  function renderRegisterTable() {
    const classNames = registerStats.classNames.length ? registerStats.classNames : ['Unknown'];
    const headers = [...classNames, 'Total'];
    const rows = [
      { label: 'Registered Boys', getter: cls => registerStats.perClass[cls]?.registered?.boys || 0 },
      { label: 'Registered Girls', getter: cls => registerStats.perClass[cls]?.registered?.girls || 0 },
      { label: 'Registered Total', getter: cls => registerStats.perClass[cls]?.registered?.total || 0 },
      { label: 'Present Boys', getter: cls => registerStats.perClass[cls]?.present?.boys || 0 },
      { label: 'Present Girls', getter: cls => registerStats.perClass[cls]?.present?.girls || 0 },
      { label: 'Present Total', getter: cls => registerStats.perClass[cls]?.present?.total || 0 },
      { label: 'Absent Boys', getter: cls => registerStats.perClass[cls]?.absent?.boys || 0 },
      { label: 'Absent Girls', getter: cls => registerStats.perClass[cls]?.absent?.girls || 0 },
      { label: 'Absent Total', getter: cls => registerStats.perClass[cls]?.absent?.total || 0 }
    ];

    return h('div', { className: 'register-table-wrap' }, [
      h('table', { className: 'workers-table register-table' }, [
        h('thead', null, [
          h('tr', null, [
            h('th', null, ' '),
            ...headers.map(head => h('th', { key: head }, head))
          ])
        ]),
        h('tbody', null, rows.map(row => {
          return h('tr', { key: row.label }, [
            h('th', null, row.label),
            ...classNames.map(cls => h('td', { key: `${row.label}-${cls}` }, row.getter(cls))),
            h('td', { className: 'table-total' }, classNames.reduce((sum, cls) => sum + row.getter(cls), 0))
          ]);
        }))
      ])
    ]);
  }

  const expectedUsageText = useMemo(() => {
    return `Inatarajiwa: Sukari ${expectedPolicy.sugar_kg} kg - Mafuta ${expectedPolicy.oil_l} l`;
  }, [expectedPolicy]);

  function renderStorePanel() {
    const catOptions = marketCatalog.categories || [];
    const selectedCatId = String(newItem.marketCatId || '');
    const sellerIdsWithCatItems = new Set(
      Object.entries(marketCatalog.itemsBySeller || {})
        .filter(([, items]) => (items || []).some(it => !selectedCatId || String(it.catId || '') === selectedCatId))
        .map(([sellerId]) => sellerId)
    );
    const shopsInCat = (marketCatalog.shops || []).filter(shop => {
      if (!selectedCatId) return true;
      const cats = shop.categories || {};
      const declaredInCat = !!cats[selectedCatId];
      const hasItemsInCat = sellerIdsWithCatItems.has(String(shop.id));
      return declaredInCat || hasItemsInCat;
    });
    const marketItems = newItem.marketSellerId
      ? (marketCatalog.itemsBySeller?.[newItem.marketSellerId] || []).filter(it => !selectedCatId || String(it.catId || '') === selectedCatId)
      : [];
    const selectedMarketItem = marketItems.find(it => it.id === newItem.marketItemId);
    const selectedShop = shopsInCat.find(shop => shop.id === newItem.marketSellerId);
    return h('section', { className: `workers-card mini-panel${storeOpen ? ' open' : ''}`, id: 'store-panel' }, [
      h('header', { className: 'workers-card__header mini-panel__header' }, [
        h('h3', null, 'Stoo - Bidhaa'),
        h('div', { className: 'mini-panel__actions' }, [
          h('button', { className: 'workers-btn secondary', onClick: () => setStoreOpen(o => !o) }, storeOpen ? 'Funga' : 'Fungua'),
          h('button', { className: 'workers-btn', onClick: () => scrollToSection('menu-section') }, 'Nenda Menyu')
        ])
      ]),
      !storeOpen ? null : h('div', { className: 'mini-panel__body' }, [
        h('div', { className: 'mini-form' }, [
          h('label', null, [
            'Soko (MarketingHub)',
            h('select', {
              value: newItem.marketCatId,
              onChange: e => setNewItem({
                ...newItem,
                marketCatId: e.target.value,
                marketSellerId: '',
                marketItemId: '',
                name: '',
                unit: '',
                unitPrice: ''
              })
            }, [
              h('option', { value: '' }, '-- Chagua soko --'),
              ...catOptions.map(cat => h('option', { key: cat.id, value: cat.id }, `${cat.icon || 'SOKO'} - ${cat.nameSw || cat.nameEn || cat.id}`))
            ])
          ]),
          h('label', null, [
            'Shop / Muuzaji',
            h('select', {
              value: newItem.marketSellerId,
              onChange: e => setNewItem({
                ...newItem,
                marketSellerId: e.target.value,
                marketItemId: '',
                name: '',
                unit: '',
                unitPrice: ''
              })
            }, [
              h('option', { value: '' }, '-- Chagua shop --'),
              ...shopsInCat.map(shop => h('option', { key: shop.id, value: shop.id }, `${shop.shopName || 'Shop'} (${shop.phones?.[0] || shop.whatsappPhone || '-'})`))
            ])
          ]),
          h('label', null, [
            'Bidhaa kutoka shop',
            h('select', {
              value: newItem.marketItemId,
              onChange: e => {
                const item = marketItems.find(it => it.id === e.target.value) || {};
                setNewItem({
                  ...newItem,
                  marketItemId: e.target.value,
                  name: item.title || '',
                  unit: item.unit || '',
                  unitPrice: item.price || ''
                });
              }
            }, [
              h('option', { value: '' }, '-- Chagua item --'),
              ...marketItems.map(item => h('option', { key: item.id, value: item.id }, `${item.title || item.id} @ ${formatTzs(item.price || 0)} / ${item.unit || 'pcs'}`))
            ])
          ]),
          h('label', null, [
            'Jina la bidhaa',
            h('input', { value: newItem.name, onChange: e => setNewItem({ ...newItem, name: e.target.value }) })
          ]),
          h('label', null, [
            'Kipimo (kg, l, pcs...)',
            h('input', { value: newItem.unit, onChange: e => setNewItem({ ...newItem, unit: e.target.value }) })
          ]),
          h('label', null, [
            'Kiasi kilichopo',
            h('input', { type: 'number', value: newItem.onHand, onChange: e => setNewItem({ ...newItem, onHand: e.target.value }) })
          ]),
          h('label', null, [
            'Bei kwa kipimo (TZS)',
            h('input', { type: 'number', min: 0, step: '1', value: newItem.unitPrice, onChange: e => setNewItem({ ...newItem, unitPrice: e.target.value }) })
          ]),
          selectedMarketItem ? h('p', { className: 'workers-card__subtitle' }, `Chanzo: ${selectedShop?.shopName || '-'} · Simu: ${selectedShop?.phones?.[0] || selectedShop?.whatsappPhone || '-'} · Bei: ${formatTzs(selectedMarketItem.price || 0)}`) : null,
          editingStoreItem ? h('div', { className: 'workers-card__actions', style: { marginTop: '8px' } }, [
            h('button', { className: 'workers-btn primary', onClick: addStoreItem }, 'Sasisha bidhaa'),
            h('button', { className: 'workers-btn secondary', onClick: cancelEditStoreItem }, 'Ghairi')
          ]) : h('button', { className: 'workers-btn primary', onClick: addStoreItem }, 'Ongeza stoo')
        ]),
        h('div', { className: 'mini-list' },
          inventoryItems.length
            ? inventoryItems.map(item =>
                h('div', { key: item.id, className: 'mini-list__item' }, [
                  h('div', { className: 'mini-list__item-main' }, [
                    h('strong', null, item.name),
                    h('span', { className: 'mini-list__meta' }, `${item.onHand} ${item.unit || ''} · ${formatTzs(item.unitPrice || 0)} · ${item.market?.shopName || 'No shop'}`)
                  ]),
                  h('div', { className: 'mini-list__item-actions' }, [
                    h('button', {
                      type: 'button',
                      className: 'workers-btn small',
                      title: 'Hariri',
                      onClick: () => startEditStoreItem(item)
                    }, '✏️'),
                    h('button', {
                      type: 'button',
                      className: 'workers-btn small danger',
                      title: 'Futa',
                      onClick: () => deleteStoreItem(item)
                    }, '🗑')
                  ])
                ])
              )
            : h('p', { className: 'workers-card__subtitle' }, 'Hakuna bidhaa stoo.')
        )
      ])
    ]);
  }

  function renderLogicPanel() {
    return h('section', { className: `workers-card mini-panel${logicOpen ? ' open' : ''}`, id: 'logic-panel' }, [
      h('header', { className: 'workers-card__header mini-panel__header' }, [
        h('h3', null, 'Logic Food - Kanuni za Matumizi'),
        h('div', { className: 'mini-panel__actions' }, [
          h('button', { className: 'workers-btn secondary', onClick: () => setLogicOpen(o => !o) }, logicOpen ? 'Funga' : 'Fungua'),
          h('button', { className: 'workers-btn', onClick: () => scrollToSection('logic-section') }, 'Nenda Matumizi')
        ])
      ]),
      !logicOpen ? null : h('div', { className: 'mini-panel__body' }, [
        h('div', { className: 'mini-form' }, [
          h('label', null, [
            'Chagua bidhaa',
            h('select', {
              value: newRule.itemId,
              onChange: e => setNewRule({ ...newRule, itemId: e.target.value })
            }, [
              h('option', { value: '' }, '-- Chagua bidhaa --'),
              inventoryItems.map(it => h('option', { key: it.id, value: it.id }, it.name))
            ])
          ]),
          h('label', null, [
            'Kiasi kwa mwanafunzi (perChild)',
            h('input', { type: 'number', step: '0.001', value: newRule.perChild, onChange: e => setNewRule({ ...newRule, perChild: e.target.value }) })
          ]),
          h('label', null, [
            'Kipimo (kg, l, pcs...)',
            h('input', { value: newRule.unit, onChange: e => setNewRule({ ...newRule, unit: e.target.value }) })
          ]),
          h('label', null, [
            'Mlo',
            h('select', { value: newRule.perMeal, onChange: e => setNewRule({ ...newRule, perMeal: e.target.value }) }, [
              h('option', { value: 'both' }, 'Breakfast & Lunch'),
              h('option', { value: 'breakfast' }, 'Breakfast'),
              h('option', { value: 'lunch' }, 'Lunch')
            ])
          ]),
          h('label', null, [
            'Rounding',
            h('select', { value: newRule.rounding, onChange: e => setNewRule({ ...newRule, rounding: e.target.value }) }, [
              h('option', { value: 'round' }, 'Round'),
              h('option', { value: 'ceil' }, 'Ceil'),
              h('option', { value: 'none' }, 'Floor')
            ])
          ]),
          h('button', { className: 'workers-btn primary', onClick: addLogicRule }, 'Hifadhi kanuni')
        ]),
        h('div', { className: 'mini-list' },
          Object.entries(logicRules || {}).length
            ? Object.entries(logicRules).map(([itemId, rule]) => {
                const label = inventoryItems.find(it => it.id === itemId)?.name || itemId;
                return h('div', { key: itemId, className: 'mini-list__item' }, [
                  h('strong', null, label),
                  h('span', { className: 'mini-list__meta' }, `${rule.perChild || 0} ${rule.unit || ''} / mwanafunzi (${rule.perMeal || 'both'})`)
                ]);
              })
            : h('p', { className: 'workers-card__subtitle' }, 'Hakuna kanuni bado. Ongeza ili kupata matumizi yanayotarajiwa.')
        )
      ])
    ]);
  }

  function renderMealChecklist(dayKey, field, title, pax, hint = '') {
    const dayPlan = weekPlan[dayKey] || mkEmptyDayPlan();
    const selected = dayPlan[field] || [];
    return h('div', { className: 'time-meal-box' }, [
      h('div', { className: 'time-meal-header' }, [
        h('strong', null, title),
        h('span', { className: 'workers-chip' }, `${pax} pax`)
      ]),
      hint ? h('p', { className: 'workers-card__subtitle' }, hint) : null,
      h('div', { className: 'store-checklist compact' },
        inventoryItems.length === 0
          ? h('p', { className: 'workers-card__subtitle' }, 'Hakuna bidhaa stoo.')
          : inventoryItems.map(item => {
              const available = Number(item.onHand || 0) > 0;
              return h('label', { key: `${dayKey}-${field}-${item.id}`, className: 'store-checklist__item' }, [
                h('input', {
                  type: 'checkbox',
                  disabled: !available,
                  checked: selected.includes(item.id),
                  onChange: e => updateDayPlanSelection(dayKey, field, item.id, e.target.checked)
                }),
                h('span', null, `${item.name} (${item.onHand} ${item.unit || ''}) ${!available ? '- imeisha' : ''}`)
              ]);
            })
      )
    ]);
  }

  function renderTimetablePlanner() {
    return h('section', { className: 'workers-card', id: 'weekly-timetable' }, [
      h('header', { className: 'workers-card__header' }, [
        h('div', null, [
          h('h2', null, 'Weekly Food Timetable'),
          h('p', { className: 'workers-card__subtitle' }, 'Ratiba hubaki kila wiki mpaka ubadilishe. Jumamosi: workers + Class 4 & 7. Jumapili: hakuna chakula.')
        ])
      ]),
      h('div', { className: 'workers-card__content timetable-grid' }, WEEKDAYS.map(({ key, label }) => {
        const isSelected = key === selectedDayKey;
        const dayPlan = weekPlan[key] || mkEmptyDayPlan();
        const studentPax = key === 'sunday' ? 0 : (key === 'saturday' ? saturdayStudentPax : autoPax);
        const workersPax = key === 'sunday' ? 0 : workerPresence.present;
        const lunchAll = key === 'sunday' ? 0 : studentPax + workersPax;
        return h('article', { key, className: `timetable-day${isSelected ? ' active' : ''}` }, [
          h('div', { className: 'timetable-day__title' }, `${label}${isSelected ? ' (Leo)' : ''}`),
          renderMealChecklist(key, 'studentBreakfast', 'Breakfast - Students', studentPax, key === 'saturday' ? 'Only Class 4 & 7 on Saturday.' : ''),
          renderMealChecklist(key, 'workerBreakfast', 'Breakfast - Workers', workersPax, 'Tea + accompaniment according to stock.'),
          renderMealChecklist(key, 'lunch', 'Lunch - Wote', lunchAll),
          h('label', null, [
            'Maelezo ya siku',
            h('input', {
              value: dayPlan.note || '',
              placeholder: 'mf. Tea + andazi',
              onChange: e => setWeekPlan(prev => ({ ...prev, [key]: { ...dayPlan, note: e.target.value } }))
            })
          ]),
          h('button', {
            className: 'workers-btn',
            disabled: savingPlan,
            onClick: () => saveDayPlan(key, { note: (weekPlan[key]?.note || '').trim() })
          }, savingPlan ? 'Saving...' : `Hifadhi ${label}`)
        ]);
      }))
    ]);
  }

  function renderInvoicePanel() {
    return h('section', { className: 'workers-card', id: 'food-invoice-section' }, [
      h('header', { className: 'workers-card__header' }, [
        h('div', null, [
          h('h2', null, 'Food Invoice ya Leo'),
          h('p', { className: 'workers-card__subtitle' }, 'Invoice hii ndiyo mhasibu atatumia kutoa bidhaa stoo na kufanya manunuzi sokoni.')
        ]),
        h('div', { className: 'workers-card__actions' }, [
          h('button', { className: 'workers-btn secondary', onClick: () => downloadFoodInvoiceFodt(foodInvoice) }, 'Download ODF (.fodt)')
        ])
      ]),
      !foodInvoice
        ? h('p', { className: 'workers-card__subtitle' }, 'Hakuna invoice bado. Bonyeza "Hifadhi Ripoti" kwanza.')
        : h('div', { className: 'workers-card__content' }, [
            h('div', { className: 'register-summary' }, [
              h('span', null, `Status: ${foodInvoice.status}`),
              h('span', null, `Total: ${formatTzs(foodInvoice.totalAmount)}`),
              h('span', null, `Missing Items: ${(foodInvoice.missingLines || []).length}`)
            ]),
            h('div', { className: 'expected-list' }, (foodInvoice.lines || []).map(line =>
              h('div', { key: `inv-${line.itemId}`, className: 'expected-chip' }, `${line.name}: ${line.requiredQty} ${line.unit || ''} · ${formatTzs(line.total)} · ${line.shopName || 'No shop'}`)
            ))
          ])
    ]);
  }

  async function handleSave() {
    const breakfast = studentBreakfastPax + workersBreakfastPax;
    const lunch = lunchPax;

    if (selectedDayKey === 'sunday') {
      toast('Jumapili hakuna huduma ya chakula. Hakuna invoice itatengenezwa.', 'warning');
      return;
    }

    if (!breakfast && !lunch) {
      toast('Hakuna waliopo kwa tarehe hii. Pakia Daily Register na mahudhurio ya wafanyakazi kwanza.', 'warning');
      return;
    }

    if (!(selectedDayPlan.studentBreakfast || []).length && !(selectedDayPlan.workerBreakfast || []).length) {
      toast('Chagua menu ya breakfast kwenye timetable ya leo.', 'warning');
      return;
    }
    if (!(selectedDayPlan.lunch || []).length) {
      toast('Chagua menu ya lunch kwenye timetable ya leo.', 'warning');
      return;
    }

    // Kitchen validation
    const { changedIds, missingLocationIds } = detectDailyChanges(kitchenDaily, kitchenYesterday);
    if (changedIds.length > 0 && missingLocationIds.length > 0) {
      const missingNames = missingLocationIds
        .map(id => kitchenItems.find(it => it.id === id)?.name || id)
        .join(', ');
      toast(`Tafadhali weka mahali kwa vifaa vilivyobadilika: ${missingNames}`, 'warning');
      return;
    }

    setSaving(true);
    try {
      const payload = {
        dayKey: selectedDayKey,
        headcount: {
          breakfast,
          lunch,
          studentBreakfast: studentBreakfastPax,
          workerBreakfast: workersBreakfastPax,
          lunchCombined: lunchPax
        },
        menuIds: menuSelections,
        menuText,
        issued: { sugar_kg: safeNumber(issued.sugar_kg), oil_l: safeNumber(issued.oil_l) },
        used: { sugar_kg: safeNumber(used.sugar_kg), oil_l: safeNumber(used.oil_l) },
        expected: {
          policy: expectedPolicy,
          items: expectedList
        },
        kitchenInventory: kitchenDaily,
        status: computeStatus(),
        variance: {
          sugar_kg: Number((safeNumber(used.sugar_kg) - safeNumber(expectedPolicy.sugar_kg)).toFixed(2)),
          oil_l: Number((safeNumber(used.oil_l) - safeNumber(expectedPolicy.oil_l)).toFixed(2))
        },
        createdAt: existingReport?.createdAt || Date.now(),
        updatedAt: Date.now(),
        workerRole: workerSession.workerRole || 'cook',
        workerId: workerSession.workerId
      };
      await schoolRef(`years/${currentYear}/workerRoles/cook/daily/${reportDate}/${workerSession.workerId}`).set(payload);

      const invoice = await buildAndSaveFoodInvoice(payload);
      setExistingReport(payload);
      setReportStatus(payload.status);
      setFoodInvoice(invoice);
      setHeadcountLocked(true);
      toast('Ripoti imehifadhiwa.', 'success');
    } catch (err) {
      console.error(err);
      toast(err.message || 'Imeshindikana kuhifadhi ripoti.', 'error');
    } finally {
      setSaving(false);
    }
  }

  function computeStatus() {
    const varSugar = Math.abs(safeNumber(used.sugar_kg) - safeNumber(expectedPolicy.sugar_kg));
    const varOil = Math.abs(safeNumber(used.oil_l) - safeNumber(expectedPolicy.oil_l));
    if (varSugar > 0.5 || varOil > 0.5) return 'flagged';
    return 'ok';
  }

  function getDayPlanValue(dayKey, field) {
    return (weekPlan[dayKey] && weekPlan[dayKey][field]) || [];
  }

  function updateDayPlanSelection(dayKey, field, itemId, checked) {
    const current = new Set(getDayPlanValue(dayKey, field));
    if (checked) current.add(itemId);
    else current.delete(itemId);
    saveDayPlan(dayKey, { [field]: Array.from(current) });
  }

  async function pushFoodAlerts(missingLines = []) {
    if (!missingLines.length) return;
    const alertRef = schoolRef(`years/${currentYear}/foodAlerts/${reportDate}`).push();
    await alertRef.set({
      date: reportDate,
      dayKey: selectedDayKey,
      status: 'open',
      schoolId: workerSession.schoolId,
      schoolName: schoolNameLabel(),
      requestedBy: workerSession.workerId || '',
      items: missingLines.map(line => ({
        itemId: line.itemId,
        name: line.name,
        requiredQty: line.requiredQty,
        onHand: line.onHand,
        unit: line.unit || '',
        shortageQty: Number((line.requiredQty - line.onHand).toFixed(2)),
        shopName: line.shopName || '',
        shopPhone: line.shopPhone || '',
        unitPrice: line.unitPrice || 0
      })),
      createdAt: Date.now()
    });
  }

  function buildFoodInvoiceObject(cookPayload = {}, { markDraft = false } = {}) {
    const lines = expectedList.map(item => {
      const inv = inventoryItems.find(it => it.id === item.itemId) || {};
      const requiredQty = Number(item.expectedQty || 0);
      const onHand = Number(inv.onHand || 0);
      const unitPrice = Number(inv.unitPrice || inv.market?.price || 0);
      const total = Number((requiredQty * unitPrice).toFixed(2));
      const after = Number((onHand - requiredQty).toFixed(2));
      return {
        itemId: item.itemId,
        name: item.name,
        unit: item.unit || inv.unit || '',
        requiredQty,
        onHand,
        balanceAfterIssue: after,
        unitPrice,
        total,
        marketCatId: inv.market?.catId || '',
        shopName: inv.market?.shopName || '',
        shopPhone: inv.market?.shopPhone || '',
        sellerId: inv.market?.sellerId || ''
      };
    });
    const missingLines = lines.filter(line => line.requiredQty > line.onHand);

    const invoice = {
      schoolId: workerSession.schoolId,
      schoolName: schoolNameLabel(),
      year: String(currentYear),
      date: reportDate,
      dayKey: selectedDayKey,
      createdAt: Date.now(),
      generatedBy: workerSession.workerId || '',
      status: missingLines.length ? 'needs-restock' : 'ready',
      headcount: cookPayload.headcount,
      timetable: selectedDayPlan,
      lines,
      totalAmount: Number(lines.reduce((sum, line) => sum + Number(line.total || 0), 0).toFixed(2)),
      missingLines,
      note: selectedDayPlan.note || '',
      draft: !!markDraft
    };
    return invoice;
  }

  async function buildAndSaveFoodInvoice(cookPayload) {
    const invoice = buildFoodInvoiceObject(cookPayload, { markDraft: false });
    await pushFoodAlerts(invoice.missingLines || []);
    await schoolRef(`years/${currentYear}/foodInvoices/${reportDate}`).set(invoice);
    return invoice;
  }

  async function upsertDraftInvoice() {
    if (selectedDayKey === 'sunday') return;
    const hasMenu = (selectedDayPlan.studentBreakfast || []).length || (selectedDayPlan.workerBreakfast || []).length || (selectedDayPlan.lunch || []).length;
    if (!hasMenu || !expectedList.length) return;
    const draftPayload = {
      headcount: {
        studentBreakfast: studentBreakfastPax,
        workerBreakfast: workersBreakfastPax,
        lunchCombined: lunchPax
      }
    };
    const invoice = buildFoodInvoiceObject(draftPayload, { markDraft: true });
    await schoolRef(`years/${currentYear}/foodInvoices/${reportDate}`).update(invoice);
    setFoodInvoice(invoice);
  }

  function downloadFoodInvoiceFodt(invoice = foodInvoice) {
    if (!invoice) {
      toast('Hakuna invoice ya kupakua kwa tarehe hii.', 'warning');
      return;
    }
    const linesXml = (invoice.lines || []).map((line, idx) => `
      <text:p text:style-name="Standard">${idx + 1}. ${line.name} | Qty: ${line.requiredQty} ${line.unit || ''} | Unit: ${formatTzs(line.unitPrice)} | Total: ${formatTzs(line.total)} | Shop: ${line.shopName || '-'} (${line.shopPhone || '-'})</text:p>
    `).join('');
    const missingXml = (invoice.missingLines || []).length
      ? (invoice.missingLines || []).map(line => `<text:p text:style-name="Standard">- ${line.name}: upungufu ${Number((line.requiredQty - line.onHand).toFixed(2))} ${line.unit || ''}</text:p>`).join('')
      : `<text:p text:style-name="Standard">Hakuna upungufu wa bidhaa.</text:p>`;
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<office:document xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0" office:version="1.2">
  <office:body>
    <office:text>
      <text:h text:style-name="Heading_20_1" text:outline-level="1">SOCRATES SCHOOL - DAILY FOOD INVOICE</text:h>
      <text:p text:style-name="Standard">Generated by SoMAP | Date: ${invoice.date} | Year: ${invoice.year}</text:p>
      <text:p text:style-name="Standard">Day: ${invoice.dayKey} | Students Breakfast: ${invoice.headcount?.studentBreakfast || 0} | Workers Breakfast: ${invoice.headcount?.workerBreakfast || 0} | Lunch Total: ${invoice.headcount?.lunchCombined || 0}</text:p>
      <text:p text:style-name="Standard">------------------------------------------------------------</text:p>
      ${linesXml}
      <text:p text:style-name="Standard">------------------------------------------------------------</text:p>
      <text:p text:style-name="Standard">TOTAL: ${formatTzs(invoice.totalAmount)}</text:p>
      <text:h text:style-name="Heading_20_2" text:outline-level="2">Stock Alerts</text:h>
      ${missingXml}
      <text:p text:style-name="Standard">Assistant Headteacher Signature: ______________________</text:p>
      <text:p text:style-name="Standard">Accountant Signature: ______________________</text:p>
    </office:text>
  </office:body>
</office:document>`;
    const blob = new Blob([xml], { type: 'application/vnd.oasis.opendocument.text-flat-xml' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `food-invoice-${invoice.date}.fodt`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  async function addStoreItem() {
    const resolvedMarketItem = newItem.marketSellerId && newItem.marketItemId
      ? (marketCatalog.itemsBySeller?.[newItem.marketSellerId] || []).find(it => it.id === newItem.marketItemId)
      : null;
    const resolvedShop = newItem.marketSellerId
      ? (marketCatalog.shops || []).find(s => s.id === newItem.marketSellerId)
      : null;
    const resolvedName = (newItem.name || resolvedMarketItem?.title || '').trim();
    const resolvedUnit = (newItem.unit || resolvedMarketItem?.unit || '').trim();
    const resolvedPrice = safeNumber(newItem.unitPrice || resolvedMarketItem?.price || 0);
    if (!resolvedName) {
      toast('Weka jina la bidhaa.', 'warning');
      return;
    }
    try {
      if (editingStoreItem && editingStoreItem.id) {
        const qty = safeNumber(newItem.onHand);
        await schoolRef(`${inventoryPath()}/${editingStoreItem.id}`).update({
          name: resolvedName,
          unit: resolvedUnit || '',
          onHand: qty,
          unitPrice: resolvedPrice,
          totalValue: Number((qty * resolvedPrice).toFixed(2)),
          market: {
            catId: newItem.marketCatId || editingStoreItem.market?.catId || '',
            sellerId: newItem.marketSellerId || editingStoreItem.market?.sellerId || '',
            itemId: newItem.marketItemId || editingStoreItem.market?.itemId || '',
            shopName: resolvedShop?.shopName || editingStoreItem.market?.shopName || '',
            shopPhone: resolvedShop?.phones?.[0] || resolvedShop?.whatsappPhone || editingStoreItem.market?.shopPhone || '',
            price: resolvedPrice
          }
        });
        toast('Bidhaa imesasishwa.', 'success');
        cancelEditStoreItem();
      } else {
        const canonical = normalizeItemName(resolvedName);
        const existing = inventoryItems.find(item => normalizeItemName(item.name) === canonical);
        const qty = safeNumber(newItem.onHand);
        if (existing && existing.id) {
          const updatedOnHand = safeNumber(existing.onHand) + qty;
          await schoolRef(`${inventoryPath()}/${existing.id}`).update({
            onHand: updatedOnHand,
            unit: resolvedUnit || existing.unit || '',
            unitPrice: resolvedPrice || safeNumber(existing.unitPrice),
            totalValue: Number((updatedOnHand * (resolvedPrice || safeNumber(existing.unitPrice))).toFixed(2)),
            market: {
              catId: newItem.marketCatId || existing.market?.catId || '',
              sellerId: newItem.marketSellerId || existing.market?.sellerId || '',
              itemId: newItem.marketItemId || existing.market?.itemId || '',
              shopName: resolvedShop?.shopName || existing.market?.shopName || '',
              shopPhone: resolvedShop?.phones?.[0] || resolvedShop?.whatsappPhone || existing.market?.shopPhone || '',
              price: resolvedPrice || safeNumber(existing.market?.price)
            }
          });
          toast('Imesasishwa stoo.', 'success');
        } else {
          const ref = schoolRef(inventoryPath()).push();
          await ref.set({
            name: resolvedName,
            unit: resolvedUnit || '',
            onHand: qty,
            unitPrice: resolvedPrice,
            totalValue: Number((qty * resolvedPrice).toFixed(2)),
            market: {
              catId: newItem.marketCatId || '',
              sellerId: newItem.marketSellerId || '',
              itemId: newItem.marketItemId || '',
              shopName: resolvedShop?.shopName || '',
              shopPhone: resolvedShop?.phones?.[0] || resolvedShop?.whatsappPhone || '',
              price: resolvedPrice
            },
            createdAt: Date.now()
          });
          toast('Imeongezwa stoo.', 'success');
        }
        setNewItem({ name: '', unit: '', onHand: '', unitPrice: '', marketCatId: '', marketSellerId: '', marketItemId: '' });
      }
      const items = await fetchInventoryItems(workerSession.schoolId);
      setInventoryItems(items);
    } catch (err) {
      console.error(err);
      toast(err.message || 'Imeshindikana kuokoa bidhaa.', 'error');
    }
  }

  async function addLogicRule() {
    if (!newRule.itemId) {
      toast('Chagua bidhaa ya kanuni.', 'warning');
      return;
    }
    try {
      const ref = schoolRef(`${logicPath()}/${newRule.itemId}`);
      await ref.set({
        perChild: Number(newRule.perChild || 0),
        unit: newRule.unit || '',
        perMeal: newRule.perMeal || 'both',
        rounding: newRule.rounding || 'round'
      });
      toast('Kanuni imehifadhiwa.', 'success');
      setNewRule({ itemId: '', perChild: '', unit: '', perMeal: 'both', rounding: 'round' });
      const rules = await loadLogicRules(workerSession.schoolId);
      setLogicRules(rules);
    } catch (err) {
      console.error(err);
      toast(err.message || 'Imeshindikana kuokoa kanuni.', 'error');
    }
  }

  async function saveKitchenItem() {
    try {
      await upsertKitchenItem({ schoolId: workerSession.schoolId, yearLike: reportDate, item: kitchenForm });
      const items = await listKitchenItems({ schoolId: workerSession.schoolId, yearLike: reportDate });
      setKitchenItems(items);
      setKitchenMasterOpen(false);
      openKitchenModal(null); // Reset form
    } catch (err) {
      console.error(err);
      toast(err.message, 'error');
    }
  }

  function openKitchenModal(item = null) {
    if (item) {
      setEditingKitchenItem(item);
      setKitchenForm(item);
    } else {
      setEditingKitchenItem(null);
      setKitchenForm({ name: '', unit: 'pcs', category: 'utensil', qtyTotal: 0, sourceType: 'purchased', sourceName: '', unitPrice: 0, note: '', acquiredDate: '', active: true });
    }
    setKitchenMasterOpen(true);
  }

  async function archiveItem(itemId) {
    if (!confirm('Je, una uhakika unataka ku-archive kifaa hiki?')) return;
    await archiveKitchenItem({ schoolId: workerSession.schoolId, yearLike: reportDate, itemId });
    const items = await listKitchenItems({ schoolId: workerSession.schoolId, yearLike: reportDate });
    setKitchenItems(items);
  }

  function renderKitchenMasterPanel() {
    if (!kitchenMasterOpen) {
      return h('section', { className: 'workers-card mini-panel', onClick: () => setKitchenMasterOpen(true) }, [
        h('header', { className: 'workers-card__header mini-panel__header' }, [
          h('h3', null, `Mali za Jikoni (Master) - ${kitchenItems.length} items`),
          h('button', { className: 'workers-btn secondary' }, 'Fungua')
        ])
      ]);
    }

    return h('section', { className: 'workers-card mini-panel open' }, [
      h('header', { className: 'workers-card__header mini-panel__header' }, [
        h('h3', null, 'Mali za Jikoni (Master)'),
        h('button', { className: 'workers-btn secondary', onClick: () => setKitchenMasterOpen(false) }, 'Funga')
      ]),
      h('div', { className: 'mini-panel__body' }, [
        h('div', { className: 'mini-form kitchen-master-form' }, [
          h('h4', null, editingKitchenItem ? 'Hariri Kifaa' : 'Ongeza Kifaa Kipya'),
          h('div', { className: 'workers-grid' }, [
            h('label', null, ['Jina', h('input', { value: kitchenForm.name, onChange: e => setKitchenForm({ ...kitchenForm, name: e.target.value }) })]),
            h('label', null, ['Kipimo', h('input', { value: kitchenForm.unit, onChange: e => setKitchenForm({ ...kitchenForm, unit: e.target.value }) })]),
            h('label', null, ['Kundi', h('select', { value: kitchenForm.category, onChange: e => setKitchenForm({ ...kitchenForm, category: e.target.value }) }, [
              h('option', { value: 'utensil' }, 'Utensil'),
              h('option', { value: 'cookware' }, 'Cookware'),
              h('option', { value: 'equipment' }, 'Equipment'),
              h('option', { value: 'furniture' }, 'Furniture'),
              h('option', { value: 'other' }, 'Other')
            ])]),
            h('label', null, ['Idadi Jumla', h('input', { type: 'number', value: kitchenForm.qtyTotal, onChange: e => setKitchenForm({ ...kitchenForm, qtyTotal: e.target.value }) })]),
            h('label', null, ['Chanzo', h('select', { value: kitchenForm.sourceType, onChange: e => setKitchenForm({ ...kitchenForm, sourceType: e.target.value }) }, [
              h('option', { value: 'purchased' }, 'Purchased'),
              h('option', { value: 'donated' }, 'Donated'),
              h('option', { value: 'school' }, 'School Existing')
            ])]),
            h('label', null, ['Supplier / Mtoaji', h('input', { value: kitchenForm.sourceName, onChange: e => setKitchenForm({ ...kitchenForm, sourceName: e.target.value }) })]),
            h('label', null, ['Bei (Unit)', h('input', { type: 'number', value: kitchenForm.unitPrice, onChange: e => setKitchenForm({ ...kitchenForm, unitPrice: e.target.value }) })]),
            h('label', null, ['Tarehe', h('input', { type: 'date', value: kitchenForm.acquiredDate, onChange: e => setKitchenForm({ ...kitchenForm, acquiredDate: e.target.value }) })]),
          ]),
          h('label', null, ['Maelezo', h('textarea', { rows: 2, value: kitchenForm.note, onChange: e => setKitchenForm({ ...kitchenForm, note: e.target.value }) })]),
          h('div', { className: 'workers-card__actions' }, [
            h('button', { className: 'workers-btn primary', onClick: saveKitchenItem }, 'Hifadhi Kifaa'),
            editingKitchenItem && h('button', { className: 'workers-btn', onClick: () => openKitchenModal(null) }, 'Cancel Edit')
          ])
        ]),
        h('div', { className: 'kitchen-master-list' }, [
          h('table', { className: 'workers-table' }, [
            h('thead', null, h('tr', null, [
              h('th', null, 'Item'),
              h('th', null, 'Qty'),
              h('th', null, 'Source'),
              h('th', null, 'Status'),
              h('th', null, 'Action')
            ])),
            h('tbody', null, kitchenItems.map(item =>
              h('tr', { key: item.id, className: item.active ? '' : 'row-inactive' }, [
                h('td', null, [
                  h('div', { className: 'row-title' }, item.name),
                  h('div', { className: 'row-subtitle' }, item.category)
                ]),
                h('td', null, `${item.qtyTotal} ${item.unit}`),
                h('td', null, item.sourceType),
                h('td', null, item.active ? 'Active' : 'Archived'),
                h('td', null, [
                  h('button', { className: 'workers-btn small', onClick: () => openKitchenModal(item) }, 'Edit'),
                  ' ',
                  item.active && h('button', { className: 'workers-btn small danger', onClick: () => archiveItem(item.id) }, 'Archive')
                ])
              ])
            ))
          ])
        ])
      ])
    ]);
  }

  function updateDaily(itemId, field, value) {
    setKitchenDaily(prev => ({
      ...prev,
      [itemId]: {
        ...(prev[itemId] || {}),
        [field]: value
      }
    }));
  }

  function copyYesterdayKitchen() {
    if (!confirm('Copy data kutoka jana? Hii itafuta data ya leo.')) return;
    const newDaily = {};
    kitchenItems.forEach(item => {
      const y = kitchenYesterday[item.id] || {};
      newDaily[item.id] = {
        available: y.available,
        destroyed: y.destroyed,
        lost: y.lost,
        misplaced: y.misplaced,
        location: y.location,
        note: y.note
      };
    });
    setKitchenDaily(newDaily);
    toast('Imenakili kutoka jana.', 'info');
  }

  function renderKitchenDailyCheck() {
    const activeItems = kitchenItems.filter(it => it.active);

    return h('section', { className: 'workers-card', id: 'kitchen-daily' }, [
      h('header', { className: 'workers-card__header' }, [
        h('div', null, [
          h('h2', null, 'Ukaguzi wa Jikoni (Daily Check)'),
          h('p', { className: 'workers-card__subtitle' }, 'Jaza idadi ya vifaa vilivyopo, vilivyoharibika au kupotea.')
        ]),
        h('button', { className: 'workers-btn', onClick: copyYesterdayKitchen }, 'Copy Yesterday')
      ]),
      h('div', { className: 'workers-card__content' }, [
        activeItems.length === 0
          ? h('p', null, 'Hakuna vifaa vilivyosajiliwa. Nenda kwenye "Mali za Jikoni" kuongeza.')
          : h('div', { className: 'kitchen-daily-list' },
              activeItems.map(item => {
                const daily = kitchenDaily[item.id] || {};
                const yesterday = kitchenYesterday[item.id] || {};
                const hasChanged = detectDailyChanges({ [item.id]: daily }, { [item.id]: yesterday }).changedIds.length > 0;

                return h('div', { key: item.id, className: `kitchen-daily-row${hasChanged ? ' changed-row' : ''}` }, [
                  h('div', { className: 'k-item-info' }, [
                    h('strong', null, item.name),
                    h('span', { className: 'sub' }, `Jumla: ${item.qtyTotal}`)
                  ]),
                  h('div', { className: 'k-inputs' }, [
                    h('div', { className: 'k-field' }, ['Kipo', h('input', { type: 'number', className: 'short-input', value: daily.available, onChange: e => updateDaily(item.id, 'available', e.target.value) })]),
                    h('div', { className: 'k-field' }, ['Bovu', h('input', { type: 'number', className: 'short-input', value: daily.destroyed, onChange: e => updateDaily(item.id, 'destroyed', e.target.value) })]),
                    h('div', { className: 'k-field' }, ['Potea', h('input', { type: 'number', className: 'short-input', value: daily.lost, onChange: e => updateDaily(item.id, 'lost', e.target.value) })]),
                    h('div', { className: 'k-field' }, ['Misplaced', h('input', { type: 'number', className: 'short-input', value: daily.misplaced, onChange: e => updateDaily(item.id, 'misplaced', e.target.value) })]),
                  ]),
                  h('div', { className: 'k-meta' }, [
                    h('input', { placeholder: 'Mahali kinahifadhiwa...', value: daily.location, onChange: e => updateDaily(item.id, 'location', e.target.value) }),
                    h('input', { placeholder: 'Maelezo...', value: daily.note, onChange: e => updateDaily(item.id, 'note', e.target.value) })
                  ])
                ]);
              })
            )
      ])
    ]);
  }

  if (fatalError) {
    return h('main', { className: 'workers-main' }, h('div', { className: 'workers-card workers-error' }, fatalError));
  }

  return h('main', { className: 'workers-main' }, [
    h('header', { className: 'workers-page-header' }, [
      h('div', null, [
        h('h1', null, 'Ripoti ya Chakula ya Leo'),
        h('p', { className: 'workers-card__subtitle' }, `Shule: ${school?.name || school?.id || ''} · Mwaka: ${currentYear}`),
        h('p', { className: 'workers-card__subtitle' }, 'Weka takwimu za rejesta, menyu, na matumizi ya jikoni. Idadi ya wanafunzi hujazwa kiotomatiki.'),
      ]),
      h('div', { className: 'workers-card__toolbar' }, [
        h('label', { className: 'workers-chip' }, [
          'Mwaka ',
          h('select', { id: 'yearSelect', 'data-somap-year-select': true })
        ]),
        statusBadge(reportStatus)
      ])
    ]),

    renderQuickCards(),
    renderStorePanel(),
    renderLogicPanel(),
    renderKitchenMasterPanel(),
    renderTimetablePlanner(),

    h('section', { className: 'workers-card' }, [
      h('header', { className: 'workers-card__header' }, [
        h('div', null, [
          h('h2', null, 'Daily Register'),
          h('p', { className: 'workers-card__subtitle' }, 'Boys / girls per class. Mirrors the paper register.')
        ]),
        h('div', { className: 'workers-card__toolbar' }, [
          h('label', { className: 'workers-chip' }, [
            'Tarehe ',
            h('input', {
              type: 'date',
              value: reportDate,
              onChange: e => setReportDate(e.target.value || today)
            })
          ]),
          h('button', {
            className: 'workers-btn',
            onClick: () => loadRegister(reportDate),
            disabled: registerLoading
          }, registerLoading ? 'Inapakia...' : 'Load Daily Register')
        ])
      ]),
      registerError
        ? h('p', { className: 'workers-error' }, registerError)
        : registerLoading
          ? h('p', { className: 'workers-card__subtitle' }, 'Inapakia rejesta...')
          : h('div', { className: 'workers-card__content' }, [
              h('div', { className: 'register-summary' }, [
                h('span', null, `Waliosajiliwa ${registerStats.totals.registered.total}`),
                h('span', null, `Waliopo ${registerStats.totals.present.total}`),
                h('span', null, `Walikosa ${registerStats.totals.absent.total}`),
                h('span', null, `Workers Present (Approved) ${workerPresence.present}/${workerPresence.totalWorkers}`),
                h('span', null, `Workers Pending ${workerPresence.pending}`)
              ]),
              renderRegisterTable()
            ])
    ]),

    h('section', { className: 'workers-card', id: 'menu-section' }, [
      h('header', { className: 'workers-card__header' }, [
        h('h2', null, 'Mlo wa Leo'),
        h('p', { className: 'workers-card__subtitle' }, `Waliohudhuria na menyu hutokana na rejesta, attendance ya workers, na timetable ya ${selectedDayKey}.`)
      ]),
      h('div', { className: 'workers-card__content' }, [
        h('div', { className: 'workers-grid' }, [
          h('label', null, [
            'Breakfast Students',
            h('input', {
              type: 'number',
              min: 0,
              value: studentBreakfastPax,
              readOnly: true,
              disabled: true
            })
          ]),
          h('label', null, [
            'Breakfast Workers',
            h('input', {
              type: 'number',
              min: 0,
              value: workersBreakfastPax,
              readOnly: true,
              disabled: true
            })
          ]),
          h('label', null, [
            'Lunch Total (Workers + Students)',
            h('input', {
              type: 'number',
              min: 0,
              value: lunchPax,
              readOnly: true,
              disabled: true
            })
          ])
        ]),

        h('div', { className: 'menu-grid' }, [
          renderMenuColumn('breakfast', 'Menyu (Breakfast)', menuText.breakfast),
          renderMenuColumn('lunch', 'Menyu (Lunch)', menuText.lunch)
        ]),

        h('fieldset', { className: 'workers-fieldset' }, [
        h('legend', { id: 'logic-section' }, 'Matumizi (kg/l)'),
          h('div', { className: 'workers-grid' }, [
            h('label', null, [
              'Sugar Issued (kg)',
              h('input', { type: 'number', step: '0.01', value: issued.sugar_kg, onChange: e => setIssued({ ...issued, sugar_kg: e.target.value }) })
            ]),
            h('label', null, [
              'Sugar Used (kg)',
              h('input', { type: 'number', step: '0.01', value: used.sugar_kg, onChange: e => setUsed({ ...used, sugar_kg: e.target.value }) })
            ]),
            h('label', null, [
              'Oil Issued (l)',
              h('input', { type: 'number', step: '0.01', value: issued.oil_l, onChange: e => setIssued({ ...issued, oil_l: e.target.value }) })
            ]),
            h('label', null, [
              'Oil Used (l)',
              h('input', { type: 'number', step: '0.01', value: used.oil_l, onChange: e => setUsed({ ...used, oil_l: e.target.value }) })
            ])
          ]),
          h('p', { className: 'workers-card__subtitle expected-line' }, expectedUsageText),
          h('div', { className: 'expected-list' },
            expectedList.length
              ? expectedList.map(item => h('div', { key: item.itemId, className: 'expected-chip' }, `Unatakiwa kutoa ${item.name} ${item.expectedQty} ${item.unit || ''}`))
              : h('p', { className: 'workers-card__subtitle' }, 'Chagua bidhaa kutoka stoo ili kuona matumizi yanayotarajiwa.')
          )
        ]),

        renderKitchenDailyCheck(),
        renderInvoicePanel(),

        h('div', { className: 'workers-card__actions' }, [
          h('button', {
            className: 'workers-btn primary',
            onClick: handleSave,
            disabled: saving
          }, saving ? 'Inaokoa...' : 'Hifadhi Ripoti')
        ])
      ])
    ])
  ]);

  function renderMenuColumn(mealKey, title, textValue) {
    return h('div', { className: 'menu-column' }, [
      h('label', null, [
        title,
        h('textarea', {
          rows: 3,
          placeholder: mealKey === 'breakfast' ? 'Uji, chai...' : 'Wali, maharage...',
          value: textValue,
          readOnly: true
        })
      ]),
      h('div', { className: 'store-checklist' }, [
        h('div', { className: 'store-checklist__title' }, 'Imetoka kwenye timetable'),
        inventoryItems.length === 0
          ? h('p', { className: 'workers-card__subtitle' }, 'Hakuna bidhaa stoo.')
          : inventoryItems.map(item =>
              h('label', { key: `${mealKey}-${item.id}`, className: 'store-checklist__item' }, [
                h('input', {
                  type: 'checkbox',
                  checked: menuSelections[mealKey].includes(item.id),
                  disabled: true
                }),
                h('span', null, `${item.name}${item.onHand ? ` (${item.onHand} ${item.unit || ''})` : ''}`)
              ])
            )
      ])
    ]);
  }
}

const rootEl = document.getElementById('root');
if (rootEl) {
  const root = ReactDOM.createRoot(rootEl);
  root.render(h(App));
}
