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
  return {
    id,
    gender: gender.startsWith('m') || gender.startsWith('b') ? 'boys'
      : gender.startsWith('f') || gender.startsWith('g') ? 'girls'
      : 'unknown',
    className,
    fullName
  };
}

function isPresent(rec = {}) {
  const raw = (rec.status || rec.daily || rec.value || '').toString().toUpperCase();
  return (
    rec.present === true ||
    rec.am === 'P' ||
    rec.pm === 'P' ||
    raw === 'P' ||
    raw === 'PRESENT' ||
    raw === 'PR'
  );
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
  const [registerLoading, setRegisterLoading] = useState(true);
  const [registerError, setRegisterError] = useState('');

  const [inventoryItems, setInventoryItems] = useState([]);
  const [logicRules, setLogicRules] = useState({});

  const [headcount, setHeadcount] = useState({ breakfast: '', lunch: '' });
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
  const [newItem, setNewItem] = useState({ name: '', unit: '', onHand: '' });
  const [newRule, setNewRule] = useState({ itemId: '', perChild: '', unit: '', perMeal: 'both', rounding: 'round' });

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

  useEffect(() => {
    const breakfast = safeNumber(headcount.breakfast);
    const lunch = safeNumber(headcount.lunch);
    computeCookProjection({ breakfastPax: breakfast, lunchPax: lunch })
      .then(setExpectedPolicy)
      .catch(err => console.error(err));
  }, [headcount.breakfast, headcount.lunch]);

  useEffect(() => {
    const breakfast = safeNumber(headcount.breakfast);
    const lunch = safeNumber(headcount.lunch);
    const rules = logicRules || {};
    const breakfastList = computeExpectedList({
      pax: breakfast,
      selections: menuSelections.breakfast,
      rules,
      meal: 'breakfast',
      inventoryItems
    });
    const lunchList = computeExpectedList({
      pax: lunch,
      selections: menuSelections.lunch,
      rules,
      meal: 'lunch',
      inventoryItems
    });
    setExpectedList(aggregateExpected([...breakfastList, ...lunchList]));
  }, [headcount.breakfast, headcount.lunch, menuSelections, logicRules, inventoryItems]);

  useEffect(() => {
    if (!existingReport && registerStats.totals.present.total > 0 && !headcountLocked) {
      setHeadcount({
        breakfast: registerStats.totals.present.total,
        lunch: registerStats.totals.present.total
      });
    }
  }, [existingReport, registerStats, headcountLocked]);

  async function loadBootstrap() {
    try {
      setRegisterLoading(true);
      await ensureKitchenSeeded({ schoolId: workerSession.schoolId, yearLike: currentYear });

      const [studentsMap, items, rules, kItems] = await Promise.all([
        loadStudents(workerSession.schoolId, currentYear),
        fetchInventoryItems(workerSession.schoolId),
        loadLogicRules(workerSession.schoolId),
        listKitchenItems({ schoolId: workerSession.schoolId, yearLike: currentYear })
      ]);
      setStudents(studentsMap);
      setInventoryItems(items);
      setLogicRules(rules);
      setKitchenItems(kItems);
      
      await loadRegister(reportDate, studentsMap);
    } catch (err) {
      console.error(err);
      setFatalError(err.message || 'Hitilafu ya kuanzisha ukurasa.');
    } finally {
      setRegisterLoading(false);
    }
  }

  async function loadStudents(schoolId, yearKey) {
    const scopedPath = `years/${yearKey}/students`;
    const snap = await scopedOrSocratesLegacy(scopedPath, 'students').catch(() => null);
    if (snap && snap.exists()) {
      const raw = snap.val() || {};
      const normalized = {};
      Object.entries(raw).forEach(([id, data]) => {
        normalized[id] = normalizeStudent(id, data);
      });
      return normalized;
    }
    return {};
  }

  async function loadAttendance(dateKey, schoolId, yearKey) {
    const scopedPath = `years/${yearKey}/attendance_students/${dateKey}`;
    const snap = await scopedOrSocratesLegacy(scopedPath, `attendance_students/${dateKey}`).catch(() => null);
    if (snap && snap.exists()) return snap.val() || {};
    return {};
  }

  async function loadRegister(dateKey, studentMap = students) {
    setRegisterLoading(true);
    setRegisterError('');
    try {
      const attendance = await loadAttendance(dateKey, workerSession.schoolId, currentYear);
      const stats = buildRegisterStats(studentMap, attendance);
      setRegisterStats(stats);
    } catch (err) {
      console.error(err);
      setRegisterError(err.message || 'Imeshindikana kupakia rejesta.');
    } finally {
      setRegisterLoading(false);
    }
  }

  function buildRegisterStats(studentMap, attendanceMap) {
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

    const presentSet = new Set();
    Object.entries(attendanceMap || {}).forEach(([id, rec]) => {
      const student = studentMap[id] || normalizeStudent(id, rec);
      const cls = student.className || 'Unknown';
      if (!perClass[cls]) perClass[cls] = makeBlankCounts();
      classNamesSet.add(cls);
      if (isPresent(rec)) {
        perClass[cls].present.total += 1;
        if (student.gender === 'boys') perClass[cls].present.boys += 1;
        if (student.gender === 'girls') perClass[cls].present.girls += 1;
        presentSet.add(id);
      }
    });

    Object.entries(studentMap || {}).forEach(([id, student]) => {
      const cls = student.className || 'Unknown';
      if (!perClass[cls]) perClass[cls] = makeBlankCounts();
      if (!presentSet.has(id)) {
        perClass[cls].absent.total += 1;
        if (student.gender === 'boys') perClass[cls].absent.boys += 1;
        if (student.gender === 'girls') perClass[cls].absent.girls += 1;
      }
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
      const snap = await ref.once('value');
      if (snap.exists()) {
        const data = snap.val();
        setExistingReport(data);
        setReportStatus(data.status || 'ok');
        setHeadcount({
          breakfast: data.headcount?.breakfast ?? '',
          lunch: data.headcount?.lunch ?? ''
        });
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
        setHeadcountLocked(false);
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
          h('button', { className: 'workers-btn primary', onClick: addStoreItem }, 'Ongeza stoo')
        ]),
        h('div', { className: 'mini-list' },
          inventoryItems.length
            ? inventoryItems.map(item =>
                h('div', { key: item.id, className: 'mini-list__item' }, [
                  h('strong', null, item.name),
                  h('span', { className: 'mini-list__meta' }, `${item.onHand} ${item.unit || ''}`)
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

  async function handleSave() {
    const breakfast = safeNumber(headcount.breakfast);
    const lunch = safeNumber(headcount.lunch);
    if (!breakfast && !lunch) {
      toast('Weka idadi ya walioshiriki mlo.', 'warning');
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
        headcount: { breakfast, lunch },
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
      setExistingReport(payload);
      setReportStatus(payload.status);
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

  async function addStoreItem() {
    if (!newItem.name) {
      toast('Weka jina la bidhaa.', 'warning');
      return;
    }
    try {
      const canonical = normalizeItemName(newItem.name);
      const existing = inventoryItems.find(item => normalizeItemName(item.name) === canonical);
      const qty = safeNumber(newItem.onHand);
      if (existing && existing.id) {
        const updatedOnHand = safeNumber(existing.onHand) + qty;
        await schoolRef(`${inventoryPath()}/${existing.id}`).update({
          onHand: updatedOnHand,
          unit: newItem.unit || existing.unit || ''
        });
        toast('Imesasishwa stoo.', 'success');
      } else {
        const ref = schoolRef(inventoryPath()).push();
        await ref.set({
          name: newItem.name,
          unit: newItem.unit || '',
          onHand: qty,
          createdAt: Date.now()
        });
        toast('Imeongezwa stoo.', 'success');
      }
      setNewItem({ name: '', unit: '', onHand: '' });
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
                h('span', null, `Walikosa ${registerStats.totals.absent.total}`)
              ]),
              renderRegisterTable()
            ])
    ]),

    h('section', { className: 'workers-card', id: 'menu-section' }, [
      h('header', { className: 'workers-card__header' }, [
        h('h2', null, 'Mlo wa Leo'),
        h('p', { className: 'workers-card__subtitle' }, 'Waliohudhuria na menyu hutokana na rejesta na stoo.')
      ]),
      h('div', { className: 'workers-card__content' }, [
        h('div', { className: 'workers-grid' }, [
          h('label', null, [
            'Waliohudhuria Breakfast',
            h('input', {
              type: 'number',
              min: 0,
              value: headcount.breakfast,
              onChange: e => setHeadcount({ ...headcount, breakfast: e.target.value })
            })
          ]),
          h('label', null, [
            'Waliohudhuria Lunch',
            h('input', {
              type: 'number',
              min: 0,
              value: headcount.lunch,
              onChange: e => setHeadcount({ ...headcount, lunch: e.target.value })
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
          onChange: e => setMenuText({ ...menuText, [mealKey]: e.target.value })
        })
      ]),
      h('div', { className: 'store-checklist' }, [
        h('div', { className: 'store-checklist__title' }, 'Chagua kutoka stoo'),
        inventoryItems.length === 0
          ? h('p', { className: 'workers-card__subtitle' }, 'Hakuna bidhaa stoo.')
          : inventoryItems.map(item =>
              h('label', { key: `${mealKey}-${item.id}`, className: 'store-checklist__item' }, [
                h('input', {
                  type: 'checkbox',
                  checked: menuSelections[mealKey].includes(item.id),
                  onChange: () => toggleSelection(mealKey, item.id)
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
