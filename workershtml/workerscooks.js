import { todayYMD, toast } from './modules/workers_helpers.js';
import { computeCookProjection } from './modules/workers_inventory.js';
import { fetchInventoryItems } from './modules/store.js';
import { loadLogicRules, computeExpectedList, aggregateExpected } from './modules/logicfood.js';

const { createElement: h, useEffect, useMemo, useState } = React;

const statusLabels = {
  pending: 'Bado hujatoa ripoti leo.',
  ok: 'Ripoti imehifadhiwa',
  flagged: 'Ripoti imeangaziwa',
  missing: 'Ripoti haijatumwa'
};

function safeNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function getWorkerSession() {
  const workerId = localStorage.getItem('workerId') || sessionStorage.getItem('workerId') || '';
  const workerRole = localStorage.getItem('workerRole') || sessionStorage.getItem('workerRole') || '';
  const schoolId = localStorage.getItem('schoolId') || window.currentSchoolId || '';
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
  }, [reportDate, workerSession.workerId]);

  useEffect(() => {
    if (!reportDate) return;
    if (!Object.keys(students || {}).length) return;
    loadRegister(reportDate);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reportDate, students]);

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
      const [studentsMap, items, rules] = await Promise.all([
        loadStudents(workerSession.schoolId),
        fetchInventoryItems(workerSession.schoolId),
        loadLogicRules(workerSession.schoolId)
      ]);
      setStudents(studentsMap);
      setInventoryItems(items);
      setLogicRules(rules);
      await loadRegister(reportDate, studentsMap);
    } catch (err) {
      console.error(err);
      setFatalError(err.message || 'Hitilafu ya kuanzisha ukurasa.');
    } finally {
      setRegisterLoading(false);
    }
  }

  async function loadStudents(schoolId) {
    const paths = schoolId
      ? [`schools/${schoolId}/students`, 'students', 'Students']
      : ['students', 'Students'];
    for (const path of paths) {
      const snap = await firebase.database().ref(path).once('value').catch(() => null);
      if (snap && snap.exists()) {
        const raw = snap.val() || {};
        const normalized = {};
        Object.entries(raw).forEach(([id, data]) => {
          normalized[id] = normalizeStudent(id, data);
        });
        return normalized;
      }
    }
    return {};
  }

  async function loadAttendance(dateKey, schoolId) {
    const paths = schoolId
      ? [`schools/${schoolId}/attendance_students/${dateKey}`, `attendance_students/${dateKey}`]
      : [`attendance_students/${dateKey}`];
    for (const path of paths) {
      const snap = await firebase.database().ref(path).once('value').catch(() => null);
      if (snap && snap.exists()) return snap.val() || {};
    }
    return {};
  }

  async function loadRegister(dateKey, studentMap = students) {
    setRegisterLoading(true);
    setRegisterError('');
    try {
      const attendance = await loadAttendance(dateKey, workerSession.schoolId);
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
      const ref = firebase.database().ref(`roles/cook/daily/${dateKey}/${workerSession.workerId}`);
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
      } else {
        setExistingReport(null);
        setReportStatus('pending');
        setHeadcountLocked(false);
      }
    } catch (err) {
      console.error(err);
      setExistingReport(null);
      setReportStatus('pending');
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
    return workerSession.schoolId
      ? `schools/${workerSession.schoolId}/inventory/items`
      : 'inventory/items';
  }

  function logicPath() {
    return workerSession.schoolId
      ? `schools/${workerSession.schoolId}/kitchen_logic/rules`
      : 'kitchen_logic/rules';
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
      await firebase.database().ref(`roles/cook/daily/${reportDate}/${workerSession.workerId}`).set(payload);
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
      const ref = firebase.database().ref(inventoryPath()).push();
      await ref.set({
        name: newItem.name,
        unit: newItem.unit || '',
        onHand: safeNumber(newItem.onHand),
        createdAt: Date.now()
      });
      toast('Imeongezwa stoo.', 'success');
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
      const ref = firebase.database().ref(`${logicPath()}/${newRule.itemId}`);
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

  if (fatalError) {
    return h('main', { className: 'workers-main' }, h('div', { className: 'workers-card workers-error' }, fatalError));
  }

  return h('main', { className: 'workers-main' }, [
    h('header', { className: 'workers-page-header' }, [
      h('div', null, [
        h('h1', null, 'Ripoti ya Chakula ya Leo'),
        h('p', { className: 'workers-card__subtitle' }, 'Weka takwimu za rejesta, menyu, na matumizi ya jikoni. Idadi ya wanafunzi hujazwa kiotomatiki.'),
      ]),
      statusBadge(reportStatus)
    ]),

    renderQuickCards(),
    renderStorePanel(),
    renderLogicPanel(),

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
