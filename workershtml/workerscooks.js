import {
  ensureAnonymousAuth,
  getLinkedWorkerId,
  dbRefs,
  todayYMD,
  yyyymm,
  toast
} from './modules/workers_helpers.js';
import {
  computeCookProjection,
  saveCookDailyReport,
  flagInventoryMismatch,
  loadPolicies
} from './modules/workers_inventory.js';
import { applyPenalty } from './modules/workers_penalties.js';

const { createElement: h, useState, useEffect, useMemo } = React;

const classOrder = [
  'Baby Class',
  'Middle Class',
  'Pre Unit',
  'Class 1',
  'Class 2',
  'Class 3',
  'Class 4',
  'Class 5',
  'Class 6',
  'Class 7'
];

const utensilList = [
  { key: 'plates', label: 'Plates / Sahani' },
  { key: 'cups', label: 'Vikombe / Cups' },
  { key: 'saucepan', label: 'Sufuria / Saucepan' },
  { key: 'buckets', label: 'Ndoo / Buckets' },
  { key: 'spoons', label: 'Vijiko / Spoons' },
  { key: 'thermos', label: 'Thermos' },
  { key: 'rolling', label: 'Mti wa kupikia / Rolling Spoon' },
  { key: 'knives', label: 'Visu / Knives' },
  { key: 'others', label: 'Vifaa vingine (andika)' }
];

const todayKey = todayYMD();
const dayKeyCompact = todayKey.replace(/-/g, '');
const monthKey = yyyymm();

const defaultUtensils = () =>
  utensilList.reduce((acc, item) => {
    acc[item.key] = { available: '', destroyed: '', lost: '', location: '' };
    return acc;
  }, {});

function App() {
  const [loading, setLoading] = useState(true);
  const [workerId, setWorkerId] = useState('');
  const [workerProfile, setWorkerProfile] = useState(null);
  const [students, setStudents] = useState({});
  const [attendancePrimary, setAttendancePrimary] = useState(null);
  const [attendanceFallback, setAttendanceFallback] = useState({});
  const [workersCount, setWorkersCount] = useState(0);
  const [existingReport, setExistingReport] = useState(null);
  const [reportStatus, setReportStatus] = useState('');
  const [headcount, setHeadcount] = useState({ breakfast: '', lunch: '' });
  const [menuText, setMenuText] = useState({ breakfast: '', lunch: '' });
  const [issued, setIssued] = useState({ sugar_kg: '', oil_l: '' });
  const [used, setUsed] = useState({ sugar_kg: '', oil_l: '' });
  const [expectedUsage, setExpectedUsage] = useState({ sugar_kg: 0, oil_l: 0 });
  const [utensils, setUtensils] = useState(() => defaultUtensils());
  const [yesterdayUtensils, setYesterdayUtensils] = useState({});
  const [grievance, setGrievance] = useState('');
  const [saving, setSaving] = useState(false);
  const [schoolId, setSchoolId] = useState(window.currentSchoolId || '');
  const [schoolName, setSchoolName] = useState('');
  const [academicYears, setAcademicYears] = useState([]);
  const [academicYear, setAcademicYear] = useState('');
  const [policies, setPolicies] = useState(null);
  const [penaltyChecked, setPenaltyChecked] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function init() {
      try {
        await ensureAnonymousAuth();
        const linked = await getLinkedWorkerId();
        if (!linked) {
          toast('Ingia tena ili kuendelea.', 'error');
          return;
        }
        if (cancelled) return;
        setWorkerId(linked);

        const [workerSnap, loadedPolicies] = await Promise.all([
          dbRefs.worker(linked).once('value'),
          loadPolicies()
        ]);
        const profile = workerSnap.val()?.profile || {};
        setWorkerProfile(profile);
        const resolvedSchoolId = window.currentSchoolId || profile.schoolId || '';
        setSchoolId(resolvedSchoolId || '');
        setPolicies(loadedPolicies || {});

        const [studentsMap, schoolLabel] = await Promise.all([
          loadStudents(resolvedSchoolId),
          fetchSchoolName(resolvedSchoolId)
        ]);
        if (cancelled) return;
        setStudents(studentsMap);
        setSchoolName(schoolLabel);
        const derivedYears = deriveAcademicYears(studentsMap);
        setAcademicYears(derivedYears);
        setAcademicYear(derivedYears[0] || `${new Date().getFullYear()}`);

        const primaryAttendance = await fetchAttendancePrimary();
        const fallbackAttendance = primaryAttendance
          ? {}
          : await fetchAttendanceFallback(resolvedSchoolId);
        const workersTotal = await fetchWorkersCount(resolvedSchoolId);
        if (cancelled) return;
        setAttendancePrimary(primaryAttendance);
        setAttendanceFallback(fallbackAttendance);
        setWorkersCount(workersTotal);

        const reportSnap = await dbRefs.rolesCookDaily(todayKey).child(linked).once('value');
        const reportVal = reportSnap.exists() ? reportSnap.val() : null;
        if (reportVal) {
          hydrateFromReport(reportVal);
          setExistingReport(reportVal);
          setReportStatus(
            `Ripoti imehifadhiwa ${new Date(reportVal.updatedTs || Date.now()).toLocaleTimeString('sw-TZ')}`
          );
        } else {
          setReportStatus('Bado hujatoa ripoti leo.');
        }

        const yesterday = await fetchYesterdayUtensils(linked);
        if (!cancelled) {
          setYesterdayUtensils(yesterday);
        }
      } catch (err) {
        console.error(err);
        toast(err.message || 'Hitilafu imejitokeza.', 'error');
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }
    init();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const breakfast = Number(headcount.breakfast || 0);
    const lunch = Number(headcount.lunch || 0);
    computeCookProjection({ breakfastPax: breakfast, lunchPax: lunch })
      .then(setExpectedUsage)
      .catch(err => console.error(err));
  }, [headcount.breakfast, headcount.lunch]);

  useEffect(() => {
    if (loading || penaltyChecked) return;
    if (!workerId || !workerProfile) return;
    if (existingReport?.penaltyLogged) {
      setPenaltyChecked(true);
      return;
    }
    const hour = new Date().getHours();
    if (hour < 18) return;
    const hasReport = Boolean(existingReport && existingReport.headcount);
    if (hasReport) {
      setPenaltyChecked(true);
      return;
    }
    (async () => {
      try {
        const percent = policies?.penalties?.taskMiss?.percent ?? 0.001;
        await applyPenalty({
          workerId,
          kind: 'cook-daily-missing',
          baseSalary: workerProfile.baseSalary,
          refPath: `/roles/cook/daily/${todayKey}/${workerId}`,
          rulePercent: percent,
          forceCharge: false,
          metadata: { dateKey: todayKey }
        });
        await dbRefs.rolesCookDaily(todayKey).child(workerId).update({
          penaltyLogged: true,
          status: 'missing'
        });
        toast('Onyo: hukujaza ripoti kwa wakati. Faini imewekwa.', 'warning');
      } catch (err) {
        console.error(err);
      } finally {
        setPenaltyChecked(true);
      }
    })();
  }, [loading, penaltyChecked, workerId, workerProfile, existingReport, policies]);

  function hydrateFromReport(reportVal) {
    setHeadcount({
      breakfast: reportVal.headcount?.breakfast ?? '',
      lunch: reportVal.headcount?.lunch ?? ''
    });
    setMenuText({
      breakfast: (reportVal.menu?.breakfast || []).join(', '),
      lunch: (reportVal.menu?.lunch || []).join(', ')
    });
    setIssued({
      sugar_kg: reportVal.issued?.sugar_kg ?? '',
      oil_l: reportVal.issued?.oil_l ?? ''
    });
    setUsed({
      sugar_kg: reportVal.used?.sugar_kg ?? '',
      oil_l: reportVal.used?.oil_l ?? ''
    });
    setUtensils(() => {
      const base = defaultUtensils();
      utensilList.forEach(item => {
        const data = reportVal.utensils?.[item.key] || {};
        base[item.key] = {
          available: data.available ?? '',
          destroyed: data.destroyed ?? '',
          lost: data.lost ?? '',
          location: data.location ?? ''
        };
      });
      return base;
    });
    setGrievance(reportVal.grievance || '');
  }

  async function loadStudents(resolvedSchoolId) {
    if (!resolvedSchoolId) {
      const snap = await firebase.database().ref('students').once('value');
      return normalizeStudents(snap.val() || {});
    }
    const schoolSnap = await firebase.database().ref(`schools/${resolvedSchoolId}/students`).once('value');
    if (schoolSnap.exists()) {
      return normalizeStudents(schoolSnap.val() || {});
    }
    const snap = await firebase.database().ref('students').once('value');
    return normalizeStudents(snap.val() || {});
  }

  async function fetchSchoolName(resolvedSchoolId) {
    if (!resolvedSchoolId) return '';
    try {
      const snap = await firebase.database().ref(`schools/${resolvedSchoolId}/profile/name`).once('value');
      if (snap.exists()) return snap.val();
    } catch (err) {
      console.error(err);
    }
    return resolvedSchoolId;
  }

  function normalizeStudents(raw) {
    const result = {};
    Object.entries(raw || {}).forEach(([key, value]) => {
      const id = value.id || key;
      result[id] = { ...value, id };
    });
    return result;
  }

  function deriveAcademicYears(studentsMap) {
    const years = new Set();
    Object.values(studentsMap || {}).forEach(student => {
      if (student.academicYear) years.add(String(student.academicYear));
      if (student.year) years.add(String(student.year));
    });
    if (years.size === 0) {
      const current = new Date().getFullYear();
      years.add(`${current}/${current + 1}`);
    }
    return Array.from(years);
  }

  async function fetchAttendancePrimary() {
    try {
      const snap = await firebase.database().ref(`attendance_students/${dayKeyCompact}`).once('value');
      return snap.exists() ? snap.val() : null;
    } catch (err) {
      console.error(err);
      return null;
    }
  }

  async function fetchAttendanceFallback(resolvedSchoolId) {
    const fallback = {};
    for (const className of classOrder) {
      const schoolPath = resolvedSchoolId
        ? `schools/${resolvedSchoolId}/attendance/${className}/${monthKey}/${todayKey}`
        : '';
      const globalPath = `attendance/${className}/${monthKey}/${todayKey}`;
      try {
        let snap = schoolPath ? await firebase.database().ref(schoolPath).once('value') : null;
        if (snap && snap.exists()) {
          fallback[className] = snap.val();
          continue;
        }
        const globalSnap = await firebase.database().ref(globalPath).once('value');
        if (globalSnap.exists()) {
          fallback[className] = globalSnap.val();
        }
      } catch (err) {
        console.error(err);
      }
    }
    return fallback;
  }

  async function fetchWorkersCount(resolvedSchoolId) {
    try {
      if (resolvedSchoolId) {
        const snap = await firebase.database().ref(`schools/${resolvedSchoolId}/workers`).once('value');
        if (snap.exists()) {
          return Object.values(snap.val() || {}).filter(w => w.profile?.active !== false).length;
        }
      }
      const snap = await firebase.database().ref('workers').once('value');
      return Object.values(snap.val() || {}).filter(w => w.profile?.active !== false).length;
    } catch (err) {
      console.error(err);
      return 0;
    }
  }

  async function fetchYesterdayUtensils(linked) {
    const previous = new Date(todayKey);
    previous.setDate(previous.getDate() - 1);
    const yKey = previous.toISOString().slice(0, 10);
    const snap = await dbRefs.rolesCookDaily(yKey).child(linked).child('utensils').once('value');
    return snap.val() || {};
  }

  function presentFromPrimary(studentId, className) {
    if (!attendancePrimary) return null;
    const classNode = attendancePrimary[className];
    const direct = attendancePrimary[studentId];
    const record = (classNode && classNode[studentId]) || direct;
    return record ? isPresentRecord(record) : null;
  }

  function presentFromFallback(studentId, className) {
    const classNode = attendanceFallback[className];
    if (!classNode) return null;
    const record = classNode[studentId] || classNode?.records?.[studentId];
    return record ? isPresentRecord(record) : null;
  }

  function isPresentRecord(record) {
    if (!record) return false;
    if (record.present === true) return true;
    if (record.am === 'P' || record.pm === 'P') return true;
    return false;
  }

  const stats = useMemo(() => {
    const classes = classOrder.reduce((acc, name) => {
      acc[name] = {
        registered: { boys: 0, girls: 0, total: 0 },
        present: { boys: 0, girls: 0, total: 0 },
        newcomers: 0
      };
      return acc;
    }, {});
    const cutoff = Date.now() - 7 * 24 * 60 * 60 * 1000;
    Object.values(students || {}).forEach(student => {
      const className = student.class || 'Unknown';
      if (!classes[className]) {
        classes[className] = {
          registered: { boys: 0, girls: 0, total: 0 },
          present: { boys: 0, girls: 0, total: 0 },
          newcomers: 0
        };
      }
      const node = classes[className];
      node.registered.total += 1;
      if (student.gender === 'M') node.registered.boys += 1;
      if (student.gender === 'F') node.registered.girls += 1;
      const createdTs = student.createdTs || student.createdAt || student.enrolledTs || 0;
      if (createdTs && Number(createdTs) >= cutoff) {
        node.newcomers += 1;
      }
      const presentPrimary = presentFromPrimary(student.id, className);
      const presentFallback = presentFromFallback(student.id, className);
      const isPresent = presentPrimary !== null ? presentPrimary : presentFallback || false;
      if (isPresent) {
        node.present.total += 1;
        if (student.gender === 'M') node.present.boys += 1;
        if (student.gender === 'F') node.present.girls += 1;
      }
    });
    return classes;
  }, [students, attendancePrimary, attendanceFallback]);

  const totals = useMemo(() => {
    const base = { registered: 0, present: 0, absent: 0, newcomers: 0 };
    Object.values(stats).forEach(stat => {
      base.registered += stat.registered.total;
      base.present += stat.present.total;
      base.absent += stat.registered.total - stat.present.total;
      base.newcomers += stat.newcomers;
    });
    return base;
  }, [stats]);

  async function handleSave() {
    const breakfast = Number(headcount.breakfast || 0);
    const lunch = Number(headcount.lunch || 0);
    if (!breakfast && !lunch) {
      toast('Weka walioshiriki angalau mlo mmoja.', 'warning');
      return;
    }
    const menu = {
      breakfast: menuText.breakfast
        .split(',')
        .map(x => x.trim())
        .filter(Boolean),
      lunch: menuText.lunch
        .split(',')
        .map(x => x.trim())
        .filter(Boolean)
    };
    const issuedPayload = {
      sugar_kg: Number(issued.sugar_kg || 0),
      oil_l: Number(issued.oil_l || 0)
    };
    const usedPayload = {
      sugar_kg: Number(used.sugar_kg || 0),
      oil_l: Number(used.oil_l || 0)
    };
    const utensilsPayload = normalizeUtensilsForSave(utensils);
    const changeCheck = detectUtensilChanges(utensilsPayload, yesterdayUtensils);
    if (changeCheck.missingLocation) {
      toast('Ongeza maelezo ya mahali vinahifadhiwa kwa vifaa vilivyobadilika leo.', 'warning');
      return;
    }
    setSaving(true);
    try {
      const expected = await computeCookProjection({ breakfastPax: breakfast, lunchPax: lunch });
      const varianceExpected = {
        sugar: usedPayload.sugar_kg - expected.sugar_kg,
        oil: usedPayload.oil_l - expected.oil_l
      };
      const varianceIssued = {
        sugar: issuedPayload.sugar_kg - usedPayload.sugar_kg,
        oil: issuedPayload.oil_l - usedPayload.oil_l
      };
      const flagged =
        Math.abs(varianceExpected.sugar) > 0.5 ||
        Math.abs(varianceExpected.oil) > 0.5 ||
        Math.abs(varianceIssued.sugar) > 0.5 ||
        Math.abs(varianceIssued.oil) > 0.5;

      await saveCookDailyReport({
        dateKey: todayKey,
        workerId,
        headcount: { breakfast, lunch },
        menu,
        expected,
        issued: issuedPayload,
        used: usedPayload,
        photos: [],
        status: flagged ? 'flagged' : 'pending',
        utensils: utensilsPayload,
        grievance: grievance.trim(),
        penaltyLogged: existingReport?.penaltyLogged || false
      });

      if (Math.abs(varianceExpected.sugar) > 0.5) {
        await flagInventoryMismatch({
          dateKey: todayKey,
          item: 'sugar_kg',
          previousCount: expected.sugar_kg,
          newCount: usedPayload.sugar_kg,
          explanation: 'Matumizi ya sukari hayalingani na matarajio.',
          workerId
        });
      }
      if (Math.abs(varianceExpected.oil) > 0.5) {
        await flagInventoryMismatch({
          dateKey: todayKey,
          item: 'oil_l',
          previousCount: expected.oil_l,
          newCount: usedPayload.oil_l,
          explanation: 'Matumizi ya mafuta hayalingani na matarajio.',
          workerId
        });
      }
      if (Math.abs(varianceIssued.sugar) > 0.5) {
        await flagInventoryMismatch({
          dateKey: todayKey,
          item: 'sugar_issued_vs_used',
          previousCount: issuedPayload.sugar_kg,
          newCount: usedPayload.sugar_kg,
          explanation: 'Tofauti kati ya sukari iliyotolewa na iliyotumika.',
          workerId
        });
      }
      if (Math.abs(varianceIssued.oil) > 0.5) {
        await flagInventoryMismatch({
          dateKey: todayKey,
          item: 'oil_issued_vs_used',
          previousCount: issuedPayload.oil_l,
          newCount: usedPayload.oil_l,
          explanation: 'Tofauti kati ya mafuta yaliyotolewa na yaliyotumika.',
          workerId
        });
      }

      setExistingReport(prev => ({
        ...(prev || {}),
        headcount: { breakfast, lunch },
        menu,
        expected,
        issued: issuedPayload,
        used: usedPayload,
        utensils: utensilsPayload,
        grievance: grievance.trim(),
        updatedTs: Date.now()
      }));
      setReportStatus(`Ripoti imehifadhiwa ${new Date().toLocaleTimeString('sw-TZ')}`);
      toast('Ripoti ya jikoni imehifadhiwa.', 'success');
    } catch (err) {
      console.error(err);
      toast(err.message || 'Imeshindikana kuhifadhi.', 'error');
    } finally {
      setSaving(false);
    }
  }

  function normalizeUtensilsForSave(current) {
    const result = {};
    utensilList.forEach(item => {
      const node = current[item.key] || {};
      result[item.key] = {
        available: Number(node.available || 0),
        destroyed: Number(node.destroyed || 0),
        lost: Number(node.lost || 0),
        location: node.location || ''
      };
    });
    return result;
  }

  function detectUtensilChanges(current, previous) {
    let missingLocation = false;
    utensilList.forEach(item => {
      const prev = previous?.[item.key] || {};
      const curr = current?.[item.key] || {};
      const changed =
        Number(prev.available || 0) !== Number(curr.available || 0) ||
        Number(prev.destroyed || 0) !== Number(curr.destroyed || 0) ||
        Number(prev.lost || 0) !== Number(curr.lost || 0);
      if (changed && !curr.location) {
        missingLocation = true;
      }
    });
    return { missingLocation };
  }

  if (loading) {
    return h('div', { className: 'workers-card', style: { padding: '24px' } }, 'Inapakia...');
  }

  return h('main', { className: 'workers-main' }, [
    h('header', { className: 'workers-page-header' }, [
      h('h1', null, 'Jikoni - Kitchen Control'),
      h(
        'p',
        { className: 'workers-card__subtitle' },
        'Kila siku rekodi idadi ya wanafunzi, menyu, matumizi ya chakula, na hesabu ya vifaa. Ukikosa kujaza hadi saa 18:00 utapata onyo nyekundu na makato.'
      )
    ]),
    renderStatsSection(),
    renderReportSection()
  ]);

  function renderStatsSection() {
    return h('section', { className: 'workers-card' }, [
      h('header', { className: 'workers-card__header' }, [
        h('div', null, [
          h('h2', null, 'Takwimu za Leo'),
          h(
            'p',
            { className: 'workers-card__subtitle' },
            'Wanafunzi, wavulana/wasichana kwa darasa, waliopo, waliokosa, wapya, wafanyakazi.'
          )
        ]),
        h('div', { className: 'workers-card__toolbar' }, [
          h(
            'span',
            { className: 'workers-chip' },
            `Shule: ${schoolName || schoolId || 'Kuu'}`
          ),
          h('label', { className: 'workers-chip' }, [
            'Academic Year ',
            h(
              'select',
              {
                value: academicYear,
                onChange: e => setAcademicYear(e.target.value)
              },
              (academicYears.length ? academicYears : [academicYear || '']).map(option =>
                h('option', { key: option, value: option }, option)
              )
            )
          ])
        ])
      ]),
      h('div', { className: 'workers-card__content' }, [
        h(
          'p',
          { className: 'workers-card__subtitle' },
          `Jumla: Wanafunzi ${totals.registered}, Waliopo ${totals.present}, Waliokosa ${totals.absent}, Wapya ${totals.newcomers}, Wafanyakazi ${workersCount}`
        ),
        h('table', { className: 'workers-table' }, [
          h('thead', null, [
            h('tr', null, [
              h('th', null, 'Darasa'),
              h('th', null, 'Waliosajiliwa (B/G/T)'),
              h('th', null, 'Waliohudhuria (B/G/T)'),
              h('th', null, 'Waliokosa'),
              h('th', null, 'Wapya (7d)')
            ])
          ]),
          h(
            'tbody',
            null,
            [...classOrder, ...Object.keys(stats).filter(name => !classOrder.includes(name))].map(name => {
              const data = stats[name] || {
                registered: { boys: 0, girls: 0, total: 0 },
                present: { boys: 0, girls: 0, total: 0 },
                newcomers: 0
              };
              const absent = data.registered.total - data.present.total;
              return h('tr', { key: name }, [
                h('td', null, name),
                h(
                  'td',
                  null,
                  `${data.registered.boys}/${data.registered.girls}/${data.registered.total}`
                ),
                h(
                  'td',
                  null,
                  `${data.present.boys}/${data.present.girls}/${data.present.total}`
                ),
                h('td', null, absent),
                h('td', null, data.newcomers)
              ]);
            })
          )
        ])
      ])
    ]);
  }

  function renderReportSection() {
    return h('section', { className: 'workers-card', style: { marginTop: '24px' } }, [
      h('header', { className: 'workers-card__header' }, [
        h('div', null, [
          h('h2', null, 'Ripoti ya Chakula ya Leo'),
          h('p', { className: 'workers-card__subtitle' }, reportStatus)
        ])
      ]),
      h('div', { className: 'workers-card__content workers-form' }, [
        h('div', { className: 'workers-grid' }, [
          h('label', null, [
            'Waliohudhuria Breakfast (07:20-10:20)',
            h('input', {
              type: 'number',
              min: 0,
              value: headcount.breakfast,
              onChange: e => setHeadcount({ ...headcount, breakfast: e.target.value })
            })
          ]),
          h('label', null, [
            'Waliohudhuria Lunch (12:30-14:00)',
            h('input', {
              type: 'number',
              min: 0,
              value: headcount.lunch,
              onChange: e => setHeadcount({ ...headcount, lunch: e.target.value })
            })
          ])
        ]),
        h('div', { className: 'workers-grid' }, [
          h('label', null, [
            'Menyu (Breakfast)',
            h('textarea', {
              placeholder: 'Uji, mandazi...',
              value: menuText.breakfast,
              onChange: e => setMenuText({ ...menuText, breakfast: e.target.value })
            })
          ]),
          h('label', null, [
            'Menyu (Lunch)',
            h('textarea', {
              placeholder: 'Wali, Maharage...',
              value: menuText.lunch,
              onChange: e => setMenuText({ ...menuText, lunch: e.target.value })
            })
          ])
        ]),
        h(
          'fieldset',
          { className: 'workers-fieldset' },
          [
            h('legend', null, 'Matumizi ya Mahitaji (kg / l)'),
            h('div', { className: 'workers-grid' }, [
              h('div', null, [
                h('label', null, [
                  'Sugar Issued (kg)',
                  h('input', {
                    type: 'number',
                    step: '0.01',
                    value: issued.sugar_kg,
                    onChange: e => setIssued({ ...issued, sugar_kg: e.target.value })
                  })
                ]),
                h('label', null, [
                  'Sugar Used (kg)',
                  h('input', {
                    type: 'number',
                    step: '0.01',
                    value: used.sugar_kg,
                    onChange: e => setUsed({ ...used, sugar_kg: e.target.value })
                  })
                ])
              ]),
              h('div', null, [
                h('label', null, [
                  'Oil Issued (l)',
                  h('input', {
                    type: 'number',
                    step: '0.01',
                    value: issued.oil_l,
                    onChange: e => setIssued({ ...issued, oil_l: e.target.value })
                  })
                ]),
                h('label', null, [
                  'Oil Used (l)',
                  h('input', {
                    type: 'number',
                    step: '0.01',
                    value: used.oil_l,
                    onChange: e => setUsed({ ...used, oil_l: e.target.value })
                  })
                ])
              ])
            ]),
            h(
              'p',
              { className: 'workers-card__subtitle' },
              `Inatarajiwa: Sukari ${expectedUsage.sugar_kg} kg - Mafuta ${expectedUsage.oil_l} l`
            )
          ]
        ),
        h(
          'fieldset',
          { className: 'workers-fieldset' },
          [
            h('legend', null, 'Vifaa vya Jikoni (ingia idadi halisi leo)'),
            h('div', { className: 'workers-card__content' }, [
              h('table', { className: 'workers-table' }, [
                h('thead', null, [
                  h('tr', null, [
                    h('th', null, 'Kifaa'),
                    h('th', null, 'Kipo (leo)'),
                    h('th', null, 'Kimeharibika'),
                    h('th', null, 'Kimepotea'),
                    h('th', null, 'Mahali Kinahifadhiwa')
                  ])
                ]),
                h(
                  'tbody',
                  null,
                  utensilList.map(item =>
                    h('tr', { key: item.key }, [
                      h('td', null, item.label),
                      h('td', null,
                        h('input', {
                          type: 'number',
                          min: 0,
                          value: utensils[item.key]?.available ?? '',
                          onChange: e =>
                            setUtensils({
                              ...utensils,
                              [item.key]: { ...(utensils[item.key] || {}), available: e.target.value }
                            })
                        })
                      ),
                      h('td', null,
                        h('input', {
                          type: 'number',
                          min: 0,
                          value: utensils[item.key]?.destroyed ?? '',
                          onChange: e =>
                            setUtensils({
                              ...utensils,
                              [item.key]: { ...(utensils[item.key] || {}), destroyed: e.target.value }
                            })
                        })
                      ),
                      h('td', null,
                        h('input', {
                          type: 'number',
                          min: 0,
                          value: utensils[item.key]?.lost ?? '',
                          onChange: e =>
                            setUtensils({
                              ...utensils,
                              [item.key]: { ...(utensils[item.key] || {}), lost: e.target.value }
                            })
                        })
                      ),
                      h('td', null,
                        h('input', {
                          type: 'text',
                          placeholder: 'Mahali vinahifadhiwa',
                          value: utensils[item.key]?.location ?? '',
                          onChange: e =>
                            setUtensils({
                              ...utensils,
                              [item.key]: { ...(utensils[item.key] || {}), location: e.target.value }
                            })
                        })
                      )
                    ])
                  )
                )
              ])
            ])
          ]
        ),
        h('label', null, [
          'Malalamiko / Grievances',
          h('textarea', {
            placeholder: 'Eleza changamoto za leo jikoni...',
            value: grievance,
            onChange: e => setGrievance(e.target.value)
          })
        ]),
        h(
          'div',
          { className: 'workers-card__actions' },
          h(
            'button',
            {
              className: 'workers-btn',
              onClick: handleSave,
              disabled: saving
            },
            saving ? 'Inaokoa...' : 'Hifadhi Ripoti'
          )
        )
      ])
    ]);
  }
}

ReactDOM.createRoot(document.getElementById('root')).render(h(App));
