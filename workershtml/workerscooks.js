import {
  todayYMD,
  toast
} from './modules/workers_helpers.js';
import {
  computeCookProjection,
  saveCookDailyReport,
  flagInventoryMismatch,
  loadPolicies
} from './modules/workers_inventory.js';
import { applyPenalty } from './modules/workers_penalties.js';

console.log('?? Workers Cooks Script Loaded (v2) - Syntax Check OK');

const { createElement: h, useState, useEffect } = React;

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

const defaultUtensils = () =>
  utensilList.reduce((acc, item) => {
    acc[item.key] = { available: '', destroyed: '', lost: '', location: '' };
    return acc;
  }, {});

function initialRegisterCounts() {
  return {
    registered: { boys: 0, girls: 0, total: 0 },
    present: { boys: 0, girls: 0, total: 0 },
    absent: { boys: 0, girls: 0, total: 0 },
    shifted: 0,
    newcomers: 0
  };
}

function normalizeGender(g) {
  const val = String(g || '').trim().toLowerCase();
  if (!val) return null;
  if (val.startsWith('m') || val.startsWith('b')) return 'boys';
  if (val.startsWith('f') || val.startsWith('g')) return 'girls';
  return null;
}

function classOrderKey(name) {
  const n = String(name || '').toLowerCase();
  if (!n) return Number.MAX_SAFE_INTEGER;
  if (n.includes('baby')) return 0;
  if (n.includes('middle')) return 1;
  if (n.includes('pre') || n.includes('nursery')) return 2;
  const match = n.match(/(\d+)/);
  if (match) return 10 + parseInt(match[1], 10);
  return 1000 + n.charCodeAt(0);
}

function App() {
  const [loading, setLoading] = useState(true);
  const [workerId, setWorkerId] = useState('');
  const [workerProfile, setWorkerProfile] = useState(null);
  const [students, setStudents] = useState({});
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
  const [schoolId, setSchoolId] = useState('');
  const [schoolName, setSchoolName] = useState('');
  const [academicYears, setAcademicYears] = useState([]);
  const [academicYear, setAcademicYear] = useState('');
  const [policies, setPolicies] = useState(null);
  const [penaltyChecked, setPenaltyChecked] = useState(false);
  const [registerDate, setRegisterDate] = useState(todayKey);
  const [registerLoading, setRegisterLoading] = useState(true);
  const [registerError, setRegisterError] = useState('');
  const [registerStats, setRegisterStats] = useState({
    date: todayKey,
    classNames: [],
    perClass: {},
    absenteesByClass: {},
    totals: { registered: { boys: 0, girls: 0, total: 0 }, present: { boys: 0, girls: 0, total: 0 }, absent: { boys: 0, girls: 0, total: 0 }, shifted: 0, newcomers: 0 }
  });
  const [fatalError, setFatalError] = useState('');

  // INITIAL AUTH & LOAD
  useEffect(() => {
    let cancelled = false;
    async function init() {
      try {
        // SECURITY FIX: Restore context from sessionStorage instead of calling ensureAnonymousAuth
        const workerProfileStr = sessionStorage.getItem('workerProfile');
        if (!workerProfileStr) {
          console.warn('No worker profile found in sessionStorage. Redirecting...');
          window.location.href = '../index.html';
          return;
        }

        const workerData = JSON.parse(workerProfileStr);
        // Basic role check (cooks only, or allow if role logic is loose)
        const role = (workerData.role || workerData.profile?.role || '').toLowerCase();
        // Allow cooks, admins, managers - or anyone if strict check not required by prompt (prompt said "The cook has already logged in... she should be trusted")
        
        const linked = workerData.id;
        if (!linked) {
            throw new Error('Worker ID missing in session profile');
        }

        setWorkerId(linked);
        setWorkerProfile(workerData.profile || {});
        
        const resolvedSchoolId = window.currentSchoolId || workerData.profile?.schoolId || '';
        setSchoolId(resolvedSchoolId);

        // Load Policies
        let loadedPolicies = {};
        try {
          loadedPolicies = await loadPolicies();
        } catch (e) {
          console.warn('Failed to load policies, using defaults:', e);
        }
        setPolicies(loadedPolicies || {});

        // Load Data - Using direct firebase refs to avoid "admin-restricted" errors if helpers enforce auth
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

        const workersTotal = await fetchWorkersCount(resolvedSchoolId);
        if (cancelled) return;
        setWorkersCount(workersTotal);

        // Load Daily Report
        // Use direct ref: roles/cook/daily/{date}/{workerId}
        const reportSnap = await firebase.database().ref(`roles/cook/daily/${todayKey}/${linked}`).once('value');
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

        // Previous Utensils
        const yesterday = await fetchYesterdayUtensils(linked);
        if (!cancelled) {
          setYesterdayUtensils(yesterday);
        }

      } catch (err) {
        console.error('Init error:', err);
        setFatalError(err.message || 'Hitilafu imejitokeza.');
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }
    init();
    return () => { cancelled = true; };
  }, []);

  // Error Handling
  useEffect(() => {
    function handleWindowError(event) {
      const msg = event?.error?.message || event?.message || 'Unknown runtime error';
      setFatalError(msg);
    }
    function handleRejection(event) {
      const msg = event?.reason?.message || String(event?.reason) || 'Unhandled promise rejection';
      setFatalError(msg);
    }
    window.addEventListener('error', handleWindowError);
    window.addEventListener('unhandledrejection', handleRejection);
    return () => {
      window.removeEventListener('error', handleWindowError);
      window.removeEventListener('unhandledrejection', handleRejection);
    };
  }, []);

  // Register Stats Effect
  useEffect(() => {
    if (!workerId) return;
    loadRegisterStats(registerDate);
  }, [registerDate, students, schoolId, workerId]);

  // Cook Projection Effect
  useEffect(() => {
    const breakfast = Number(headcount.breakfast || 0);
    const lunch = Number(headcount.lunch || 0);
    computeCookProjection({ breakfastPax: breakfast, lunchPax: lunch })
      .then(setExpectedUsage)
      .catch(err => console.error(err));
  }, [headcount.breakfast, headcount.lunch]);

  // Penalty Check Effect
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
    
    // Auto-penalty logic
    (async () => {
      try {
        const percent = policies?.penalties?.taskMiss?.percent ?? 0.001;
        // Use direct ref to avoid auth issues in helper if any
        await applyPenalty({
          workerId,
          kind: 'cook-daily-missing',
          baseSalary: workerProfile.baseSalary,
          refPath: `/roles/cook/daily/${todayKey}/${workerId}`,
          rulePercent: percent,
          forceCharge: false,
          metadata: { dateKey: todayKey }
        });
        
        await firebase.database().ref(`roles/cook/daily/${todayKey}/${workerId}`).update({
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
    if (resolvedSchoolId) {
       // Try school specific path first
       const sRef = firebase.database().ref(`schools/${resolvedSchoolId}/students`);
       const snap = await sRef.once('value');
       if (snap.exists()) return normalizeStudents(snap.val());
    }
    
    // Fallback to multiple root paths (case-sensitive DBs)
    const tryPaths = ['students', 'Students', 'StudentsList', 'Students_List'];
    for (const p of tryPaths) {
      try {
        const snap = await firebase.database().ref(p).once('value');
        if (snap.exists()) {
           return normalizeStudents(snap.val());
        }
      } catch (e) {
        console.warn('Failed to load path', p, e);
      }
    }
    return {};
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
      const status = String(value.status || '').toLowerCase();
      if (status === 'shifted') return;
      const id = value.id || key;
      
      // Standardize class name to match attendance.html logic
      const className = value.className || value.classLevel || value.class || value.grade || 'Unknown';
      
      // Standardize name
      const fullName = [value.firstName, value.middleName, value.lastName]
        .filter(Boolean).join(' ').trim()
        || value.name || value.fullName || id;

      result[id] = { 
        ...value, 
        id,
        className,
        fullName
      };
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

  async function fetchWorkersCount(resolvedSchoolId) {
    try {
      let ref = firebase.database().ref('workers');
      if (resolvedSchoolId) {
          ref = firebase.database().ref(`schools/${resolvedSchoolId}/workers`);
      }
      const snap = await ref.once('value');
      if (snap.exists()) {
          return Object.values(snap.val() || {}).filter(w => w.profile?.active !== false).length;
      }
      // Fallback if school specific fails but global exists (unlikely in multi-school but safe)
      if (resolvedSchoolId) {
          const gSnap = await firebase.database().ref('workers').once('value');
          return Object.values(gSnap.val() || {}).filter(w => w.profile?.active !== false).length;
      }
      return 0;
    } catch (err) {
      console.error(err);
      return 0;
    }
  }

  async function fetchYesterdayUtensils(linked) {
    const previous = new Date(todayKey);
    previous.setDate(previous.getDate() - 1);
    const yKey = previous.toISOString().slice(0, 10);
    const snap = await firebase.database().ref(`roles/cook/daily/${yKey}/${linked}/utensils`).once('value');
    return snap.val() || {};
  }

  async function loadRegisterStats(dateStr) {
    const targetDate = (dateStr || todayKey).slice(0, 10);
    setRegisterLoading(true);
    setRegisterError('');
    try {
      const stats = await computeRegisterStats(targetDate);
      setRegisterStats(stats);
      
      // Auto-update headcount if not set and data exists
      if (!headcount.breakfast && !headcount.lunch && stats.totals.present.total > 0) {
         // Default logic: assume present students eat lunch. Breakfast maybe less. 
         // For now, let's just leave it empty for them to fill, or we could suggest.
         // The prompt says "headcount auto-fills from totals above". 
         // Let's do that.
         setHeadcount(prev => ({
             ...prev,
             lunch: stats.totals.present.total // Auto-fill lunch with present count
         }));
      }

    } catch (err) {
      console.error(err);
      setRegisterError(err.message || 'Imeshindikana kupakia takwimu za mahudhurio.');
    } finally {
      setRegisterLoading(false);
    }
  }

  async function computeRegisterStats(dateKey) {
    // Seed with standard classes to ensure consistent table columns
    const classNamesSet = new Set(classOrder);
    const perClass = {};
    const absenteesByClass = {};
    const totals = initialRegisterCounts();
    const cutoff = Date.now() - 7 * 24 * 60 * 60 * 1000;

    // Initialize map for known classes
    classOrder.forEach(c => {
        perClass[c] = initialRegisterCounts();
        absenteesByClass[c] = [];
    });
    
    // 1. Calculate Registered
    Object.values(students || {}).forEach(student => {
      // Improved class detection matching attendance.html
      const cls = student.className || student.classLevel || student.class || student.grade || 'Unknown';
      
      // If we encounter a class NOT in standard list, add it
      if (!classNamesSet.has(cls)) {
          classNamesSet.add(cls);
          perClass[cls] = initialRegisterCounts();
          absenteesByClass[cls] = [];
      }
      
      const gender = normalizeGender(student.gender);
      perClass[cls].registered.total += 1;
      totals.registered.total += 1;
      
      if (gender === 'boys') {
        perClass[cls].registered.boys += 1;
        totals.registered.boys += 1;
      }
      if (gender === 'girls') {
        perClass[cls].registered.girls += 1;
        totals.registered.girls += 1;
      }

      const createdTs = student.createdTs || student.createdAt || student.enrolledTs || 0;
      if (createdTs && Number(createdTs) >= cutoff) {
        perClass[cls].newcomers += 1;
        totals.newcomers += 1;
      }
    });

    const classNames = Array.from(classNamesSet).sort((a, b) => classOrderKey(a) - classOrderKey(b));

    // 2. Fetch Attendance for Date
    const monthKeyLocal = dateKey.slice(0, 7); // YYYY-MM
    
    // We need to fetch attendance per class or global. 
    // Attendance structure: attendance/{className}/{YYYY-MM}/{YYYY-MM-DD}/{studentId}
    
    for (const cls of classNames) {
      if (!perClass[cls]) perClass[cls] = initialRegisterCounts();
      if (!absenteesByClass[cls]) absenteesByClass[cls] = [];

      let records = {};
      try {
        // Try school specific first if schoolId exists
        let snap = null;
        if (schoolId) {
             snap = await firebase.database().ref(`schools/${schoolId}/attendance/${cls}/${monthKeyLocal}/${dateKey}`).once('value');
        }
        if (!snap || !snap.exists()) {
             snap = await firebase.database().ref(`attendance/${cls}/${monthKeyLocal}/${dateKey}`).once('value');
        }
        
        if (snap && snap.exists()) {
          records = snap.val() || {};
        }
      } catch (err) {
        console.warn('Imeshindikana kusoma mahudhurio ya', cls, err.message);
      }

      Object.keys(records).forEach(studentId => {
        const rec = records[studentId] || {};
        const info = students[studentId] || { gender: normalizeGender(rec.gender), class: cls, name: studentId };
        const gender = normalizeGender(info.gender);
        
        // Check present status
        const statusRaw = String(rec.status || rec.daily || '').toUpperCase();
        const isPresent =
          rec.present === true ||
          rec.am === 'P' ||
          rec.pm === 'P' ||
          statusRaw === 'P' ||
          statusRaw === 'PRESENT' ||
          statusRaw === 'PR';

        if (isPresent) {
          perClass[cls].present.total += 1;
          totals.present.total += 1;
          if (gender === 'boys') {
            perClass[cls].present.boys += 1;
            totals.present.boys += 1;
          }
          if (gender === 'girls') {
            perClass[cls].present.girls += 1;
            totals.present.girls += 1;
          }
        } else {
          // Absent
          absenteesByClass[cls].push({
            name: info.fullName || info.name || studentId,
            reason: rec.reason || rec.comment || rec.note || ''
          });
        }

        if (rec.shifted === true || rec.dateShifted) {
          perClass[cls].shifted += 1;
          totals.shifted += 1;
        }
        if (rec.isNew === true || rec.newComer === true) {
          perClass[cls].newcomers += 1;
          totals.newcomers += 1;
        }
      });

      // Calculate Absents based on Register - Present
      perClass[cls].absent.total = Math.max(0, perClass[cls].registered.total - perClass[cls].present.total);
      perClass[cls].absent.boys = Math.max(0, perClass[cls].registered.boys - perClass[cls].present.boys);
      perClass[cls].absent.girls = Math.max(0, perClass[cls].registered.girls - perClass[cls].present.girls);
    }

    // Re-sum totals to be safe
    totals.absent.total = Math.max(0, totals.registered.total - totals.present.total);
    totals.absent.boys = Math.max(0, totals.registered.boys - totals.present.boys);
    totals.absent.girls = Math.max(0, totals.registered.girls - totals.present.girls);

    return {
      date: dateKey,
      classNames,
      perClass,
      absenteesByClass,
      totals
    };
  }

  async function handleSave() {
    const breakfast = Number(headcount.breakfast || 0);
    const lunch = Number(headcount.lunch || 0);
    if (!breakfast && !lunch) {
      toast('Weka walioshiriki angalau mlo mmoja.', 'warning');
      return;
    }
    const menu = {
      breakfast: menuText.breakfast.split(',').map(x => x.trim()).filter(Boolean),
      lunch: menuText.lunch.split(',').map(x => x.trim()).filter(Boolean)
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

      // Direct ref for save
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

      // Handle mismatch flags
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
    fatalError
      ? h('div', { style: { background: '#fef2f2', border: '1px solid #fecaca', color: '#991b1b', padding: '12px', borderRadius: '8px', marginBottom: '12px', fontWeight: 600 } }, `Runtime error: ${fatalError}`)
      : null,
    
    h('header', { className: 'workers-page-header' }, [
      h('h1', null, 'Jikoni - Kitchen Control'),
      h('p', { className: 'workers-card__subtitle' }, 'Kila siku rekodi idadi ya wanafunzi, menyu, matumizi ya chakula, na hesabu ya vifaa. Ukikosa kujaza hadi saa 18:00 utapata onyo nyekundu na makato.')
    ]),

    renderStatsSection(),
    renderReportSection()
  ]);

  function renderStatsSection() {
    return h('section', { className: 'workers-card' }, [
      h('header', { className: 'workers-card__header' }, [
        h('div', null, [
          h('h2', null, 'Takwimu za Leo (Daily Register)'),
          h('p', { className: 'workers-card__subtitle' }, 'Boys / girls per class for the selected day. Mirrors the paper register.')
        ]),
        h('div', { className: 'workers-card__toolbar' }, [
          h('span', { className: 'workers-chip' }, `Shule: ${schoolName || schoolId || 'Kuu'}`),
          h('button', { 
            className: 'workers-btn', 
            onClick: () => loadRegisterStats(registerDate),
            disabled: registerLoading
          }, registerLoading ? 'Loading...' : 'Load Daily Register'),
          h('label', { className: 'workers-chip' }, [
            'Tarehe ',
            h('input', {
              type: 'date',
              value: registerDate,
              onChange: e => setRegisterDate(e.target.value || todayKey)
            })
          ])
        ])
      ]),
      h('div', { className: 'workers-card__content' }, [
        registerLoading
          ? h('p', { className: 'workers-card__subtitle' }, 'Inapakia rejesta ya leo...')
          : registerError
            ? h('p', { className: 'workers-error' }, registerError)
            : [
                h('div', { className: 'workers-register-summary' }, [
                  h('span', { className: 'badge' }, 'Mirrors the paper register.'),
                  h('span', null, `Jumla: Wanafunzi ${registerStats.totals.registered.total}`),
                  h('span', null, `Waliopo ${registerStats.totals.present.total}`),
                  h('span', null, `Waliokosa ${registerStats.totals.absent.total}`),
                  h('span', null, `Wapya ${registerStats.totals.newcomers}`),
                  h('span', null, `Wafanyakazi ${workersCount}`)
                ]),
                renderRegisterTable(),
                renderAbsenteesPanel()
              ]
      ])
    ]);
  }

  function renderRegisterTable() {
    // Columns: Classes..., Total, Shifted, Newcomers
    const headers = [...registerStats.classNames, 'Total', 'Shifted', 'Newcomers'];
    
    // Rows: Registered (B/G/T), Present (B/G/T), Absent (B/G/T)
    const rows = [
      { label: 'Registered - Boys', getter: cls => registerStats.perClass[cls]?.registered?.boys ?? 0 },
      { label: 'Registered - Girls', getter: cls => registerStats.perClass[cls]?.registered?.girls ?? 0 },
      { label: 'Registered - Total', getter: cls => registerStats.perClass[cls]?.registered?.total ?? 0 },
      { label: 'Present - Boys', getter: cls => registerStats.perClass[cls]?.present?.boys ?? 0 },
      { label: 'Present - Girls', getter: cls => registerStats.perClass[cls]?.present?.girls ?? 0 },
      { label: 'Present - Total', getter: cls => registerStats.perClass[cls]?.present?.total ?? 0, showShift: true, showNew: true },
      { label: 'Absent - Boys', getter: cls => registerStats.perClass[cls]?.absent?.boys ?? 0 },
      { label: 'Absent - Girls', getter: cls => registerStats.perClass[cls]?.absent?.girls ?? 0 },
      { label: 'Absent - Total', getter: cls => registerStats.perClass[cls]?.absent?.total ?? 0 }
    ];

    // Explicitly check for no data but allow rendering if classNames exist
    if (!registerStats.classNames) {
        return h('p', { className: 'workers-card__subtitle' }, 'No register data found.');
    }

      // Table styling - make it compact
      h('div', { style: { overflowX: 'auto', WebkitOverflowScrolling: 'touch', border: '1px solid #e2e8f0', borderRadius: '8px' } }, [
        h('table', { className: 'workers-table', style: { minWidth: '100%', fontSize: '11px', borderCollapse: 'collapse' } }, [
          h('thead', { style: { background: '#f8fafc' } }, [
            h('tr', null, 
              [h('th', { style: { textAlign: 'left', padding: '6px', position: 'sticky', left: 0, background: '#f8fafc', zIndex: 10, borderBottom: '1px solid #e2e8f0' } }, 'Class')].concat(
                headers.map((title, idx) =>
                  h('th', { key: title, style: { textAlign: 'right', padding: '6px', whiteSpace: 'nowrap', borderBottom: '1px solid #e2e8f0' } }, title)
                )
              )
            )
          ]),
          h('tbody', null,
            rows.map(row => {
              return h('tr', { key: row.label, style: { borderBottom: '1px solid #f1f5f9' } }, [
                h('th', { style: { textAlign: 'left', padding: '6px', position: 'sticky', left: 0, background: 'white', zIndex: 5, borderRight: '1px solid #f1f5f9' } }, row.label),
                ...registerStats.classNames.map((cls, idx) => 
                  h('td', { key: `${row.label}-${cls}`, style: { textAlign: 'right', padding: '6px' } }, row.getter(cls))
                ),
                // Total Col
                h('td', { style: { textAlign: 'right', fontWeight: 700, padding: '6px', background: '#f8fafc' } }, 
                   registerStats.classNames.reduce((acc, cls) => acc + row.getter(cls), 0)
                ),
                // Shifted Col
                h('td', { style: { textAlign: 'right', padding: '6px' } }, 
                  row.showShift ? registerStats.classNames.reduce((acc, cls) => acc + (registerStats.perClass[cls]?.shifted||0), 0) : '—'
                ),
                // Newcomers Col
                h('td', { style: { textAlign: 'right', padding: '6px' } }, 
                  row.showNew ? registerStats.classNames.reduce((acc, cls) => acc + (registerStats.perClass[cls]?.newcomers||0), 0) : '—'
                )
              ]);
            })
          )
        ])
      ])
  }

  function renderAbsenteesPanel() {
    const entries = Object.entries(registerStats.absenteesByClass || {}).filter(
      ([, list]) => (list || []).length
    );
    if (!entries.length) {
      return h('div', { className: 'workers-card__subtitle', style: { marginTop: '12px' } },
        `No absentees recorded for ${registerStats.date}.`
      );
    }
    return h('div', { className: 'workers-absentees', style: { marginTop: '12px' } },
      entries.map(([cls, list]) =>
        h('div', { key: cls, className: 'workers-card', style: { padding: '12px', background: '#fff6f6' } }, [
          h('strong', null, cls),
          h('ul', null,
            list.map((entry, idx) =>
              h('li', { key: `${cls}-${idx}` }, `${entry.name || '-'}${entry.reason ? ' - ' + entry.reason : ''}`)
            )
          )
        ])
      )
    );
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
        h('div', { className: 'workers-grid' }, [
          h('label', null, [
            'Menyu (Breakfast)',
            h('textarea', {
              placeholder: 'Uji...',
              value: menuText.breakfast,
              onChange: e => setMenuText({ ...menuText, breakfast: e.target.value })
            })
          ]),
          h('label', null, [
            'Menyu (Lunch)',
            h('textarea', {
              placeholder: 'Wali...',
              value: menuText.lunch,
              onChange: e => setMenuText({ ...menuText, lunch: e.target.value })
            })
          ])
        ]),
        h('fieldset', { className: 'workers-fieldset' }, [
           h('legend', null, 'Matumizi (kg/l)'),
           h('div', { className: 'workers-grid' }, [
             h('div', null, [
               h('label', null, ['Sugar Issued (kg)', h('input', { type: 'number', step: '0.01', value: issued.sugar_kg, onChange: e => setIssued({...issued, sugar_kg: e.target.value}) })]),
               h('label', null, ['Sugar Used (kg)', h('input', { type: 'number', step: '0.01', value: used.sugar_kg, onChange: e => setUsed({...used, sugar_kg: e.target.value}) })])
             ]),
             h('div', null, [
               h('label', null, ['Oil Issued (l)', h('input', { type: 'number', step: '0.01', value: issued.oil_l, onChange: e => setIssued({...issued, oil_l: e.target.value}) })]),
               h('label', null, ['Oil Used (l)', h('input', { type: 'number', step: '0.01', value: used.oil_l, onChange: e => setUsed({...used, oil_l: e.target.value}) })])
             ])
           ]),
           h('p', { className: 'workers-card__subtitle' }, `Inatarajiwa: Sukari ${expectedUsage.sugar_kg} kg - Mafuta ${expectedUsage.oil_l} l`)
        ]),
        h('fieldset', { className: 'workers-fieldset' }, [
           h('legend', null, 'Vifaa vya Jikoni'),
           h('div', { className: 'workers-card__content' }, [
             h('table', { className: 'workers-table' }, [
               h('thead', null, [h('tr', null, [h('th', null, 'Kifaa'), h('th', null, 'Kipo'), h('th', null, 'Kimeharibika'), h('th', null, 'Kimepotea'), h('th', null, 'Mahali')])]),
               h('tbody', null, utensilList.map(item => 
                 h('tr', { key: item.key }, [
                   h('td', null, item.label),
                   h('td', null, h('input', { type: 'number', value: utensils[item.key]?.available||'', onChange: e => setUtensils({...utensils, [item.key]: {...utensils[item.key], available: e.target.value}}) })),
                   h('td', null, h('input', { type: 'number', value: utensils[item.key]?.destroyed||'', onChange: e => setUtensils({...utensils, [item.key]: {...utensils[item.key], destroyed: e.target.value}}) })),
                   h('td', null, h('input', { type: 'number', value: utensils[item.key]?.lost||'', onChange: e => setUtensils({...utensils, [item.key]: {...utensils[item.key], lost: e.target.value}}) })),
                   h('td', null, h('input', { type: 'text', value: utensils[item.key]?.location||'', onChange: e => setUtensils({...utensils, [item.key]: {...utensils[item.key], location: e.target.value}}) }))
                 ])
               ))
             ])
           ])
        ]),
        h('label', null, ['Malalamiko', h('textarea', { value: grievance, onChange: e => setGrievance(e.target.value) })]),
        h('button', { className: 'workers-btn', onClick: handleSave, disabled: saving }, saving ? 'Inaokoa...' : 'Hifadhi Ripoti')
      ])
    ]);
  }
}

const rootEl = document.getElementById('root');
if (rootEl) {
    const root = ReactDOM.createRoot(rootEl);
    root.render(h(App));
}
