// Transport debt engine: the transport debt of each pupil exactly as
// transporthtml/transportpayments.html computes it ("Transport Debt (TO DATE)").
// Driver pages (driver hub, workers-attendance driver gate) use this so a driver
// sees the same debt as the payments page, not a separate approximation.
//
// Ported from transportpayments.html loadAllData() + calculateTransportStatus():
// same Firebase sources, same scoped/legacy merge rules, same overrides, periods,
// approved-payment filter, approvalsHistory merge and "due from the 3rd" rule.
// If you change the debt rules there, change them here too.
//
// Read-only: it never writes to Firebase. Requires transport_pricing.js.
(function (global) {
  const MONTH_NAMES = ['', 'January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  const BASE_YEAR = 2025;
  const CLASS_ORDER = ['Baby Class', 'Middle Class', 'Pre Unit Class', 'Class 1', 'Class 2', 'Class 3', 'Class 4', 'Class 5', 'Class 6', 'Class 7'];

  const isObj = (v) => !!v && typeof v === 'object';
  const nonEmpty = (v) => isObj(v) && Object.keys(v).length > 0;
  const normalizeIdentifier = (value) => String(value || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
  const normalizeStopKey = (value) => String(value || '').trim().toLowerCase();
  const normalizeSchoolId = (value) => String(value || '').trim().toLowerCase().replace(/_/g, '-');
  const numberOrNull = (value) => {
    if (value === null || value === undefined || value === '') return null;
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  };
  const normalizePaymentList = (data) => {
    if (!data) return [];
    if (Array.isArray(data)) return data;
    if (typeof data === 'object') return Object.values(data);
    return [data];
  };

  function canonicalSchoolId(raw) {
    const s = String(raw || '').trim();
    const n = s.toLowerCase();
    if (n === 'socrates school' || n === 'socrates-school' || n === 'socrates' || n === 'default') return 'socrates-school';
    return s;
  }

  function shiftClass(baseClass, deltaYears) {
    const normalized = String(baseClass || '').trim();
    const idx = CLASS_ORDER.findIndex((c) => c.toLowerCase() === normalized.toLowerCase());
    if (idx < 0) return baseClass || '';
    const newIdx = idx + Number(deltaYears || 0);
    if (newIdx < 0) return 'PRE-ADMISSION';
    if (newIdx >= CLASS_ORDER.length) return 'GRADUATED';
    return CLASS_ORDER[newIdx];
  }

  async function load({ db, schoolId, year, now = new Date() } = {}) {
    const Pricing = global.TransportPricing;
    if (!db || !Pricing) throw new Error('TransportDebtEngine: database or TransportPricing missing');
    const sid = canonicalSchoolId(schoolId);
    if (!sid) throw new Error('TransportDebtEngine: school not known');
    const yearNum = Number(year);
    const yearStr = String(yearNum);
    const isSoc = sid === 'socrates-school';
    const scoped = (sub) => `schools/${sid}/${String(sub).replace(/^\/+/, '')}`;
    const read = async (path) => {
      try { const snap = await db.ref(path).once('value'); return snap.val(); } catch (_) { return null; }
    };
    // transportpayments.html scopedOrSocratesLegacy(): scoped wins unless missing/empty (Socrates only)
    const scopedOrLegacy = async (sub, legacyPath) => {
      const val = await read(scoped(sub));
      if (!isSoc || !legacyPath) return val;
      if (val === null || val === undefined || (isObj(val) && !Object.keys(val).length)) return read(legacyPath);
      return val;
    };

    // ---- normalizeDateInput & friends (same behaviour, including timezone quirks) ----
    function normalizeDateInput(raw, fallbackYear = yearNum) {
      if (raw === null || raw === undefined || raw === '') {
        const yr = Number.isFinite(fallbackYear) ? fallbackYear : new Date().getFullYear();
        return `${yr}-01-01`;
      }
      if (typeof raw === 'number') {
        const d = new Date(raw);
        if (!Number.isNaN(d.getTime())) return d.toISOString().slice(0, 10);
      }
      const text = String(raw).trim();
      if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text;
      if (/^\d{1,2}\/\d{1,2}\/\d{4}$/.test(text)) {
        const [dd, mm, yy] = text.split('/').map(Number);
        const date = new Date(yy, mm - 1, dd);
        if (!Number.isNaN(date.getTime())) return date.toISOString().slice(0, 10);
      }
      const tryDate = new Date(text);
      if (!Number.isNaN(tryDate.getTime())) return tryDate.toISOString().slice(0, 10);
      const yr = Number.isFinite(fallbackYear) ? fallbackYear : new Date().getFullYear();
      return `${yr}-01-01`;
    }
    function resolveStartDate(enrollment) {
      if (!enrollment) return normalizeDateInput(null);
      if (enrollment.startDate) return normalizeDateInput(enrollment.startDate);
      if (enrollment.start_date) return normalizeDateInput(enrollment.start_date);
      if (enrollment.startTimestamp) return normalizeDateInput(Number(enrollment.startTimestamp));
      if (enrollment.start_time) return normalizeDateInput(enrollment.start_time);
      if (enrollment.dateRegistered) return normalizeDateInput(enrollment.dateRegistered);
      return normalizeDateInput(null);
    }
    function resolveEndDate(enrollment) {
      if (!enrollment) return '';
      const raw = enrollment.endDate || enrollment.stopDate || enrollment.stoppedAtDate || enrollment.transportEndDate || '';
      return raw ? normalizeDateInput(raw) : '';
    }
    const parseIsoDateParts = (value) => {
      const iso = normalizeDateInput(value, yearNum);
      return { iso, year: Number(iso.slice(0, 4)), month: Number(iso.slice(5, 7)), day: Number(iso.slice(8, 10)) };
    };
    const formatLocalIsoDate = (date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
    const previousDayIso = (iso) => { const p = parseIsoDateParts(iso); return formatLocalIsoDate(new Date(p.year, p.month - 1, p.day - 1)); };
    const maxIsoDate = (a, b) => (!a ? b : (!b ? a : (a >= b ? a : b)));
    const minIsoDate = (a, b) => (!a ? b : (!b ? a : (a <= b ? a : b)));

    // ---- STEP 1: merged enrollments (loadAllData) ----
    const [enrollScoped, enrollLegacy, registryScoped, registryLegacy, assignScoped, assignLegacy, periodsScoped, periodsLegacy] = await Promise.all([
      read(scoped(`years/${yearStr}/transportEnrollments`)),
      isSoc ? read('transport_enrollments') : null,
      read(scoped(`years/${yearStr}/transportRegistry`)),
      isSoc ? read(`transportRegistry/${yearStr}`) : null,
      read(scoped(`years/${yearStr}/transportAssignments`)),
      isSoc ? read(`transportAssignments/${yearStr}`) : null,
      read(scoped(`years/${yearStr}/transportPeriods`)),
      isSoc ? read(`transportPeriods/${yearStr}`) : null,
    ]);
    const merge = (legacy, scopedVal) => (isSoc ? { ...(legacy || {}), ...(scopedVal || {}) } : (scopedVal || {}));
    const enrollmentsRaw = merge(enrollLegacy, enrollScoped);
    const registry = merge(registryLegacy, registryScoped);
    const assignments = merge(assignLegacy, assignScoped);
    const transportPeriods = merge(periodsLegacy, periodsScoped);

    // ---- vehicles + workers: driver attribution exactly like the payments page "Driver" column ----
    const readWorkers = async () => {
      const primary = await read(scoped(`years/${yearStr}/workers`));
      const fourWay = async () => {
        const [legacyRoot, legacyYear, schoolWorkers, schoolYearWorkers] = await Promise.all([
          read('workers'), read(`years/${yearStr}/workers`), read(`schools/${sid}/workers`), read(`schools/${sid}/years/${yearStr}/workers`),
        ]);
        return { ...(legacyRoot || {}), ...(legacyYear || {}), ...(schoolWorkers || {}), ...(schoolYearWorkers || {}) };
      };
      if (nonEmpty(primary)) return isSoc ? { ...(await fourWay()), ...primary } : primary;
      if (isSoc) {
        const merged = await fourWay();
        if (nonEmpty(merged)) return merged;
        return (await read('workers')) || {};
      }
      return (await read(scoped('workers'))) || {};
    };
    const [vehiclesPrimary, legacyBusesA, legacyBusesB, workersVal, catalogStopsVal] = await Promise.all([
      scopedOrLegacy(`years/${yearStr}/transport/buses`, `transport/socrates-school/${yearStr}/buses`),
      isSoc ? read(`transport/socrates-school/${yearStr}/buses`) : null,
      isSoc ? read(`transport/socrates/${yearStr}/buses`) : null,
      readWorkers(),
      read(scoped(`transportCatalog/${yearStr}/stops`)),
    ]);
    const norm = (v) => String(v || '').toLowerCase().trim();
    const isUsableDriverName = (name) => {
      const v = String(name || '').trim();
      if (!v) return false;
      return !['not assigned', 'n/a', 'na', 'none', '-', '—', 'unknown'].includes(v.toLowerCase());
    };
    const normalizeWorkerPhone = (raw) => {
      const digits = String(raw || '').trim().replace(/[^\d]/g, '');
      if (!digits) return '';
      if (digits.startsWith('255')) return digits;
      if (digits.length === 9) return '255' + digits;
      if (digits.length === 10 && digits.startsWith('0')) return '255' + digits.slice(1);
      return digits;
    };
    const workerNameByUid = new Map();
    const workerNameByPhone = new Map();
    Object.entries(isObj(workersVal) ? workersVal : {}).forEach(([uid, worker]) => {
      if (!worker) return;
      const profile = worker.profile || {};
      const fullName = String(profile.fullNameUpper || worker.fullNameUpper || profile.fullName || worker.fullName || worker.name ||
        [profile.firstName, profile.middleName, profile.lastName].filter(Boolean).join(' ') ||
        [worker.firstName, worker.middleName, worker.lastName].filter(Boolean).join(' ') || uid).trim() || uid;
      workerNameByUid.set(uid, fullName);
      const phone = normalizeWorkerPhone(profile.phone || worker.phone || worker.mobile || profile.mobile || '');
      if (phone && !workerNameByPhone.has(phone)) workerNameByPhone.set(phone, fullName);
    });
    const resolveWorkerName = (uidOrPhone) => {
      const key = String(uidOrPhone || '').trim();
      if (!key) return '';
      return workerNameByUid.get(key) || workerNameByPhone.get(normalizeWorkerPhone(key)) || '';
    };
    const hasDriver = (v) => !!v && isUsableDriverName(v.driverName || v.driver || v.assignedDriverName || v.driverFullName);
    const extractDriverNameValue = (raw) => {
      if (!raw) return '';
      if (typeof raw === 'string' || typeof raw === 'number') return String(raw).trim();
      if (typeof raw === 'object') return String(raw.fullName || raw.fullNameUpper || raw.name || raw.driverName || raw.assignedDriverName || raw.label || '').trim();
      return '';
    };
    const vehicles = {};
    [vehiclesPrimary, legacyBusesA, legacyBusesB].forEach((val) => {
      if (!isObj(val)) return;
      Object.entries(val).forEach(([key, v]) => { if (v && !vehicles[key]) vehicles[key] = { id: key, ...(v || {}) }; });
    });
    const vehicleIdByPlate = {};
    Object.entries(vehicles).forEach(([vehicleId, v]) => {
      const plateKey = norm(v.plate || v.plateNo || v.registration || '');
      if (plateKey) vehicleIdByPlate[plateKey] = vehicleId;
    });
    const getVehicleByAnyRef = (ref) => {
      const k = String(ref || '').trim();
      if (!k) return null;
      if (vehicles[k]) return vehicles[k];
      const byPlate = vehicleIdByPlate[norm(k)];
      return byPlate && vehicles[byPlate] ? vehicles[byPlate] : null;
    };
    const normalizeRoutes = (raw) => {
      if (!raw) return [];
      if (Array.isArray(raw)) return raw;
      if (typeof raw === 'object') {
        const entries = Object.entries(raw);
        if (entries.every(([k]) => String(Number(k)) === k)) return entries.sort((x, y) => Number(x[0]) - Number(y[0])).map(([, v]) => v).filter(Boolean);
        if (entries.every(([, v]) => v === true || v === 1 || v === '1')) return entries.map(([k]) => k).filter(Boolean);
        return entries.map(([, v]) => v).filter(Boolean);
      }
      if (typeof raw === 'string') return raw.split(/[|;,\n]+/).map((x) => x.trim()).filter(Boolean);
      return [];
    };
    const routeVehicleMap = {};
    const vehicleIdToDriver = {};
    const shouldReplaceRouteEntry = (existing, incoming) => !existing || (!isUsableDriverName(existing.driverName) && isUsableDriverName(incoming.driverName));
    Object.entries(vehicles).forEach(([vehicleId, v]) => {
      const routesList = [v.assignedRoutes, v.routes, v.routeNames, v.route, v.routeName, v.stopNames, v.stops, v.amStop, v.pmStop, v.morningRoute, v.eveningRoute]
        .flatMap(normalizeRoutes).filter(Boolean);
      const driverUid = v.assignedDriverUid || v.driverUid || v.driverId || v.driverUID || v.assignedDriverId || v.assignedDriver || v.driverUserId || '';
      const resolvedDriverName = resolveWorkerName(driverUid) ||
        extractDriverNameValue(v.assignedDriverName || v.driverName || v.driverFullName || v.assignedDriverFullName || v.driver || '') ||
        (driverUid ? driverUid : '') || 'Not assigned';
      v._resolvedDriverName = resolvedDriverName;
      vehicleIdToDriver[vehicleId] = resolvedDriverName;
      const entry = { vehicleId, driverName: resolvedDriverName };
      routesList.forEach((r) => {
        const key = norm((typeof r === 'string' ? r : (r && (r.route || r.name || r.id))) || '');
        if (key && shouldReplaceRouteEntry(routeVehicleMap[key], entry)) routeVehicleMap[key] = entry;
      });
      if (routesList.length === 0 && (v.amStop || v.pmStop)) {
        [norm(v.amStop), norm(v.pmStop)].forEach((k) => { if (k && shouldReplaceRouteEntry(routeVehicleMap[k], entry)) routeVehicleMap[k] = entry; });
      }
    });
    if (isObj(catalogStopsVal)) {
      Object.entries(catalogStopsVal).forEach(([stopId, stop]) => {
        if (!stop) return;
        const entry = routeVehicleMap[norm(stop.name || stop.id || '')];
        if (!entry) return;
        if (shouldReplaceRouteEntry(routeVehicleMap[stopId], entry)) routeVehicleMap[stopId] = entry;
        if (shouldReplaceRouteEntry(routeVehicleMap[norm(stopId)], entry)) routeVehicleMap[norm(stopId)] = entry;
      });
    }
    const driverForRoute = (routeName) => {
      if (!routeName) return null;
      const key = norm(routeName);
      const entry = routeVehicleMap[key];
      if (entry) return { driverName: entry.driverName, vehicleId: entry.vehicleId };
      const partial = Object.keys(routeVehicleMap).find((k) => key.includes(k) || k.includes(key));
      return partial ? { driverName: routeVehicleMap[partial].driverName, vehicleId: routeVehicleMap[partial].vehicleId } : null;
    };
    const vehicleDriverFromEnrollment = (en) => {
      const v = getVehicleByAnyRef(en?.vehicleId || en?.busId || en?.vehicle || en?.assignedVehicleId || '');
      if (!v) return null;
      const name = String(v._resolvedDriverName || v.assignedDriverName || v.driverName || v.driver || '').trim();
      return isUsableDriverName(name) ? { driverName: name } : null;
    };
    const enrichVehicleWithDriver = (vehicleObj) => {
      if (!vehicleObj) return vehicleObj;
      if (typeof vehicleObj === 'string') {
        const vid = vehicleObj.trim();
        if (!vid) return vehicleObj;
        if (vehicleIdToDriver[vid]) return { vehicleId: vid, id: vid, driverName: vehicleIdToDriver[vid] };
        const v = vehicles[vid] || getVehicleByAnyRef(vid);
        if (v && v._resolvedDriverName) return { vehicleId: vid, id: vid, driverName: v._resolvedDriverName };
        return { vehicleId: vid, id: vid };
      }
      if (typeof vehicleObj !== 'object') return vehicleObj;
      if (hasDriver(vehicleObj)) return vehicleObj;
      const vid = vehicleObj.vehicleId || vehicleObj.id;
      if (vid && vehicleIdToDriver[vid]) return { ...vehicleObj, driverName: vehicleIdToDriver[vid] };
      const v = vehicles[vid] || getVehicleByAnyRef(vid);
      if (v && v._resolvedDriverName) return { ...vehicleObj, driverName: v._resolvedDriverName };
      return vehicleObj;
    };

    const enrollments = {};
    Object.entries(enrollmentsRaw).forEach(([id, en]) => { if (en) enrollments[id] = en; });
    Object.entries(registry).forEach(([id, reg]) => {
      if (!reg || reg.using !== true) return;
      if (!enrollments[id]) enrollments[id] = { amStop: reg.routeId || '', pmStop: reg.stopName || '', monthlyFee: reg.monthlyFee || 0 };
    });
    Object.entries(assignments).forEach(([id, rec]) => {
      const stopped = String(rec?.status || '').toLowerCase() === 'stopped';
      if (!rec || (rec.status !== 'Using' && !stopped)) { delete enrollments[id]; return; }
      const existing = enrollments[id] || {};
      const amStop = rec.morningRouteId || rec.amStop || existing.amStop || '';
      const pmStop = rec.eveningRouteId || rec.pmStop || existing.pmStop || '';
      const pickVehicle = (own, fromRec, stop) => enrichVehicleWithDriver(
        (hasDriver(own) && own) ? own : (hasDriver(fromRec) && fromRec) ? fromRec : (driverForRoute(stop) || own || fromRec));
      const morningVehicle = pickVehicle(existing.morningVehicle, rec.morningVehicle, amStop);
      const eveningVehicle = pickVehicle(existing.eveningVehicle, rec.eveningVehicle, pmStop);
      enrollments[id] = {
        ...existing,
        ...rec,
        amStop,
        pmStop,
        route: rec.route || existing.route || amStop || pmStop || '',
        baseMonthlyFee: rec.baseMonthlyFee || rec.monthlyFee || existing.baseMonthlyFee || existing.monthlyFee,
        monthlyFee: rec.monthlyFee || rec.baseMonthlyFee || existing.monthlyFee || existing.baseMonthlyFee,
        startDate: rec.startDate || existing.startDate,
        endDate: rec.endDate || rec.stoppedAtDate || existing.endDate || existing.stoppedAtDate || null,
        status: stopped ? 'Stopped' : 'Using',
        morningVehicle: morningVehicle || existing.morningVehicle,
        eveningVehicle: eveningVehicle || existing.eveningVehicle,
      };
    });
    Object.values(enrollments).forEach((en) => {
      if (!en) return;
      const direct = vehicleDriverFromEnrollment(en);
      if (direct) {
        if (!hasDriver(en.morningVehicle)) en.morningVehicle = direct;
        if (!hasDriver(en.eveningVehicle)) en.eveningVehicle = direct;
      }
      if (!hasDriver(en.morningVehicle) && en.amStop) en.morningVehicle = driverForRoute(en.amStop);
      if (!hasDriver(en.eveningVehicle) && en.pmStop) en.eveningVehicle = driverForRoute(en.pmStop);
      en.morningVehicle = enrichVehicleWithDriver(en.morningVehicle);
      en.eveningVehicle = enrichVehicleWithDriver(en.eveningVehicle);
    });
    // getDriverDisplay(): the names the payments page prints in its Driver column
    const driverNamesFor = (id) => {
      const en = enrollments[id] || {};
      const pick = (v) => {
        const name = String(v?.driverName || v?.assignedDriverName || v?.driverFullName || v?.driver || '').trim();
        return isUsableDriverName(name) ? name : '';
      };
      return { morning: pick(en.morningVehicle), evening: pick(en.eveningVehicle) };
    };
    const studentIds = Object.keys(enrollments);

    // ---- shared year data, loaded once ----
    const [overrideScoped, overrideLegacy, ledgers, scopedPayments, multipliers] = await Promise.all([
      read(scoped(`transportOverrides/${yearStr}`)),
      isSoc ? read(`transportOverrides/${yearStr}`) : null,
      scopedOrLegacy(`years/${yearStr}/transportLedgers`, `transportLedgers/${yearStr}`),
      read(scoped(`years/${yearStr}/transport_payments`)),
      Pricing.loadYearMultipliers(yearNum),
    ]);
    // fetchTransportOverridesForYear(): Object.assign in [scoped, legacy] order
    const transportOverrides = {};
    [overrideScoped, isSoc ? overrideLegacy : null].forEach((val) => { if (isObj(val)) Object.assign(transportOverrides, val); });
    const overrideIndex = {};
    Object.entries(transportOverrides).forEach(([key, value]) => { const k = normalizeIdentifier(key); if (k) overrideIndex[k] = value; });
    const scopedPaymentsVal = isObj(scopedPayments) ? scopedPayments : {};
    const legacyPaymentsVal = (isSoc && !nonEmpty(scopedPaymentsVal)) ? ((await read('transport_payments')) || {}) : {};
    const ledgersVal = isObj(ledgers) ? ledgers : {};
    let historyPromise = null;
    const approvalsHistory = () => {
      if (!historyPromise) {
        historyPromise = (async () => {
          const merged = {};
          for (const path of [scoped(`approvalsHistory/${yearStr}`), `approvalsHistory/${yearStr}`]) {
            const val = await read(path);
            if (nonEmpty(val)) Object.entries(val).forEach(([month, records]) => { merged[month] = { ...(merged[month] || {}), ...(records || {}) }; });
          }
          return merged;
        })();
      }
      return historyPromise;
    };

    // ---- students ----
    const students = {};
    const studentKeyAliases = {};
    let allStudentsPromise = null;
    async function studentFor(id) {
      if (Object.prototype.hasOwnProperty.call(students, id)) return students[id];
      let data = await scopedOrLegacy(`students/${id}`, `students/${id}`);
      if (!data) {
        // alias match by admission number, like loadAllData()
        if (!allStudentsPromise) {
          allStudentsPromise = scopedOrLegacy('students', 'students').then((all) => {
            const index = new Map();
            Object.entries(all || {}).forEach(([key, rec]) => {
              if (!isObj(rec)) return;
              [key, rec.admissionNumber, rec.admissionNo, rec.admission, rec.studentAdm, rec.studentId].forEach((candidate) => {
                const k = normalizeIdentifier(candidate);
                if (k && !index.has(k)) index.set(k, { key, record: rec });
              });
            });
            return index;
          });
        }
        const index = await allStudentsPromise;
        const enrollment = enrollments[id] || {};
        for (const candidate of [id, enrollment.admissionNumber, enrollment.admissionNo, enrollment.admission, enrollment.studentAdm, enrollment.studentId]) {
          const k = normalizeIdentifier(candidate);
          if (k && index.has(k)) { const match = index.get(k); data = match.record; studentKeyAliases[id] = match.key; break; }
        }
      }
      students[id] = data || buildFallbackStudent(id, enrollments[id] || {});
      return students[id];
    }
    function buildFallbackStudent(id, enrollment) {
      const clean = String(enrollment.studentName || enrollment.fullName || enrollment.name || id).replace(/\s+/g, ' ').trim();
      const parts = clean ? clean.split(' ') : [];
      return {
        firstName: parts[0] || '',
        middleName: parts.length > 2 ? parts.slice(1, -1).join(' ') : '',
        lastName: parts.length > 1 ? parts[parts.length - 1] : '',
        classLevel: enrollment.classLevel || enrollment.className || enrollment.class || '',
        admissionNumber: enrollment.admissionNumber || enrollment.admissionNo || enrollment.studentAdm || id,
        primaryParentContact: enrollment.primaryParentContact || enrollment.parentContact || enrollment.parentPhone || enrollment.guardianPhone || '',
        timestamp: enrollment.timestamp || enrollment.createdAt || enrollment.dateRegistered || null,
        createdAt: enrollment.createdAt || enrollment.timestamp || enrollment.dateRegistered || null,
        __synthetic: true,
      };
    }
    function registrationYear(stu) {
      const ts = stu?.timestamp ?? stu?.createdAt;
      const explicitYear = Number(stu?.academicYear || stu?.admissionYear || stu?.admYear || stu?.year);
      if (Number.isFinite(explicitYear)) return explicitYear;
      if (ts && Number.isFinite(Number(ts))) return new Date(Number(ts)).getFullYear();
      const dateValue = stu?.registeredAt || stu?.regTimestamp || stu?.dateRegistered || stu?.dateOfRegistration;
      if (dateValue) { const parsed = Date.parse(String(dateValue)); if (Number.isFinite(parsed)) return new Date(parsed).getFullYear(); }
      return BASE_YEAR;
    }
    function classForYear(student) {
      const baseClass = student?._resolvedClass || student?.classLevel || student?.className || '';
      if (baseClass === 'GRADUATED') return 'GRADUATED';
      const delta = yearNum - Number(registrationYear(student) || BASE_YEAR);
      return shiftClass(baseClass, Number.isFinite(delta) ? delta : 0) || baseClass;
    }
    function belongsToSchool(student) {
      const active = normalizeSchoolId(sid);
      const recSid = String(student?.schoolId || student?.schoolID || student?.school_id || student?.currentSchoolId || student?.ownerSchoolId || student?.meta?.schoolId || '').trim();
      if (recSid && normalizeSchoolId(recSid) !== active) return false;
      const recName = String(student?.schoolName || student?.school || student?.schoolBranch || student?.campusName || student?.meta?.schoolName || '').trim().toLowerCase();
      if (recName) {
        const named = /socrates/.test(recName);
        if (active === 'socrates-school' && !named) return false;
        if (active !== 'socrates-school' && named) return false;
      }
      if (active === 'socrates-school' && !recSid && !recName) {
        const toMs = (value) => {
          if (value === null || value === undefined) return null;
          if (typeof value === 'number' && Number.isFinite(value)) return value > 1e9 && value < 1e12 ? value * 1000 : value;
          const text = String(value || '').trim();
          if (!text) return null;
          const auto = text.match(/^AUTO-(\d{10,13})$/i);
          if (auto) { const n = Number(auto[1]); return Number.isFinite(n) ? (n > 1e12 ? n : n * 1000) : null; }
          const parsed = /^\d{10,13}$/.test(text) ? Number(text) : Date.parse(text);
          if (!Number.isFinite(parsed)) return null;
          return parsed > 1e9 && parsed < 1e12 ? parsed * 1000 : parsed;
        };
        const createdMs = toMs(student?.createdAt ?? student?.timestamp ?? student?.registeredAt ?? student?.dateRegistered) ?? (() => {
          const auto = String(student?.id || student?.studentId || student?.admissionNumber || student?.admissionNo || '').match(/^AUTO-(\d{10,13})$/i);
          if (!auto) return null;
          const n = Number(auto[1]);
          return Number.isFinite(n) ? (n > 1e12 ? n : n * 1000) : null;
        })();
        if (Number.isFinite(createdMs) && createdMs >= Date.UTC(2026, 6, 1)) return false;
      }
      return true;
    }
    // isDisplayableTransportStudent(): whether the payments page lists this pupil at all
    function isListed(student) {
      if (!isObj(student)) return false;
      const synthetic = student.__synthetic === true;
      const admission = String(student.admissionNumber || student.admissionNo || '').trim().toLowerCase();
      if (synthetic) {
        const fullName = `${student.firstName || ''} ${student.middleName || ''} ${student.lastName || ''}`.replace(/\s+/g, ' ').trim().toLowerCase();
        if (!(admission && admission !== 'n/a' && admission !== 'na' && fullName && fullName !== admission)) return false;
      }
      if (!synthetic && !belongsToSchool(student)) return false;
      const status = String(student.status || '').trim().toLowerCase();
      if (student.deleted === true || student.isDeleted === true || student.archived === true || student.isArchived === true ||
          student.removed === true || student.isRemoved === true || student.active === false ||
          ['deleted', 'archived', 'removed', 'shifted'].includes(status)) return false;
      const first = String(student.firstName || '').trim().toLowerCase();
      const last = String(student.lastName || '').trim().toLowerCase();
      if (!admission || admission === 'n/a' || admission === 'na') return false;
      if (!first || first === 'n/a' || first === 'na') return false;
      if (!last || last === 'n/a' || last === 'na') return false;
      return classForYear(student) !== 'GRADUATED';
    }

    // ---- payments (STEP 3 of loadAllData) ----
    async function paymentsFor(id, student) {
      const alias = studentKeyAliases[id];
      let list = null;
      if (ledgersVal[id] && ledgersVal[id].payments) list = normalizePaymentList(ledgersVal[id].payments);
      else if (alias && ledgersVal[alias] && ledgersVal[alias].payments) list = normalizePaymentList(ledgersVal[alias].payments);
      if (!list || !list.length) {
        if (scopedPaymentsVal[id]) list = normalizePaymentList(scopedPaymentsVal[id]);
        else if (alias && scopedPaymentsVal[alias]) list = normalizePaymentList(scopedPaymentsVal[alias]);
        else if (legacyPaymentsVal[id]) list = normalizePaymentList(legacyPaymentsVal[id]).filter((p) => Number(p?.year) === yearNum);
        else if (alias && legacyPaymentsVal[alias]) list = normalizePaymentList(legacyPaymentsVal[alias]).filter((p) => Number(p?.year) === yearNum);
      }
      list = (list || []).slice();
      const history = await approvalsHistory();
      const enrollment = enrollments[id] || {};
      const admNo = student?.admissionNumber || enrollment.admissionNumber || enrollment.admissionNo || '';
      Object.values(history).forEach((monthRecords) => {
        Object.values(monthRecords || {}).forEach((record) => {
          if (!record || record.finalStatus !== 'approved' || record.sourceModule !== 'transport') return;
          const key = record.modulePayload?.studentKey;
          const adm = record.studentAdm || record.admissionNumber || record.modulePayload?.admissionNumber;
          if (!(key === id || adm === id || adm === admNo || key === admNo)) return;
          const pmt = record.modulePayload?.payment;
          const ref = record.paymentReferenceCode || pmt?.reference || pmt?.ref;
          if (!ref) return;
          let found = false;
          list.forEach((p, i) => {
            if ((p.ref || p.reference) === ref) { list[i] = { ...p, approved: true, approvedAt: p.approvedAt || record.approvedAt }; found = true; }
          });
          if (!found && pmt) {
            list.push({ amount: record.amountPaidNow ?? pmt.amount, ref, reference: ref, approved: true, approvedAt: record.approvedAt });
          }
        });
      });
      return list;
    }

    // ---- pricing (calculateBaseMonthlyFee / overrides / periods) ----
    const baseFeeCache = {};
    async function baseMonthlyFee(amStop, pmStop, month) {
      const key = `${month}:${normalizeStopKey(amStop)}:${normalizeStopKey(pmStop)}`;
      if (!Object.prototype.hasOwnProperty.call(baseFeeCache, key)) {
        const onDate = `${yearNum}-${String(Number(month) || 1).padStart(2, '0')}-01`;
        baseFeeCache[key] = Promise.all([
          amStop ? Pricing.baseFeeOnDate({ year: yearNum, stopName: amStop, onDate }) : 0,
          pmStop ? Pricing.baseFeeOnDate({ year: yearNum, stopName: pmStop, onDate }) : 0,
        ]).then(([m, e]) => (Number(m) || 0) + (Number(e) || 0));
      }
      return baseFeeCache[key];
    }
    function enrollmentBaseFee(enrollment) {
      for (const value of [enrollment?.baseMonthlyFee, enrollment?.monthlyFee, enrollment?.transportFee, enrollment?.currentMonthTransportFee, enrollment?.fee, enrollment?.amount]) {
        const amount = Number(value);
        if (Number.isFinite(amount) && amount > 0) return amount;
      }
      return 0;
    }
    function overrideFor(id) {
      const student = students[id] || {};
      for (const key of [id, studentKeyAliases[id], student.admissionNumber, student.admissionNo, student.studentId].filter(Boolean)) {
        if (isObj(transportOverrides[key])) return transportOverrides[key];
        const indexed = overrideIndex[normalizeIdentifier(key)];
        if (isObj(indexed)) return indexed;
      }
      return null;
    }
    function overrideAppliesToMonth(override, month) {
      if (!isObj(override)) return false;
      const effectiveFrom = override.effectiveFrom || override.startDate || override.effectiveDate || '';
      if (effectiveFrom) {
        const eff = normalizeDateInput(effectiveFrom, yearNum);
        const effYear = Number(eff.slice(0, 4));
        const effMonth = Number(eff.slice(5, 7));
        if (yearNum < effYear || (yearNum === effYear && month < effMonth)) return false;
      }
      const months = override.months;
      if (!isObj(months) || !Object.keys(months).length) return true;
      const monthKey = `${yearNum}-${String(month).padStart(2, '0')}`;
      return months[monthKey] === true || months[String(month)] === true || months[month] === true;
    }
    async function defaultBase(enrollment, month) {
      const am = enrollment?.amStop || '';
      const pm = enrollment?.pmStop || '';
      if (!am && !pm) return enrollmentBaseFee(enrollment);
      return baseMonthlyFee(am, pm, month);
    }
    async function baseWithOverride(enrollment, month, id) {
      const am = enrollment?.amStop || '';
      const pm = enrollment?.pmStop || '';
      const override = overrideFor(id);
      if (!am && !pm) return enrollmentBaseFee(enrollment);
      if (!overrideAppliesToMonth(override, month)) return baseMonthlyFee(am, pm, month);
      const applyTo = String(override?.applyTo || 'both').toLowerCase();
      const feeM = numberOrNull(override?.feePerMonthMorning);
      const feeE = numberOrNull(override?.feePerMonthEvening);
      if (feeM === null && feeE === null) return baseMonthlyFee(am, pm, month);
      const [morningPart, eveningPart] = await Promise.all([am ? baseMonthlyFee(am, '', month) : 0, pm ? baseMonthlyFee('', pm, month) : 0]);
      const morning = (applyTo === 'both' || applyTo === 'morning') && feeM !== null ? feeM : morningPart;
      const evening = (applyTo === 'both' || applyTo === 'evening') && feeE !== null ? feeE : eveningPart;
      return Math.max(0, (Number(morning) || 0) + (Number(evening) || 0));
    }
    const due = (base, month, startDate, endDate) => Pricing.dueForMonth({ year: yearNum, month, baseMonthlyFee: base, startDate, endDate, multipliers });
    async function monthDue(enrollment, month, id, startDate, endDate) {
      const override = overrideFor(id);
      if (!overrideAppliesToMonth(override, month)) return Number(await due(await defaultBase(enrollment, month), month, startDate, endDate) || 0);
      const effectiveFrom = override?.effectiveFrom || override?.startDate || override?.effectiveDate || '';
      const effective = effectiveFrom ? parseIsoDateParts(effectiveFrom) : null;
      const overrideBase = await baseWithOverride(enrollment, month, id);
      if (!effective || effective.year !== yearNum || effective.month !== month || effective.day <= 1) {
        return Number(await due(overrideBase, month, startDate, endDate) || 0);
      }
      const plainBase = await defaultBase(enrollment, month);
      if (Number(plainBase) === Number(overrideBase)) return Number(await due(overrideBase, month, startDate, endDate) || 0);
      const before = await due(plainBase, month, startDate, minIsoDate(endDate, previousDayIso(effective.iso)));
      const after = await due(overrideBase, month, maxIsoDate(startDate, effective.iso), endDate);
      return Number(before || 0) + Number(after || 0);
    }
    function periodsFor(id, enrollment) {
      const normalizePeriod = (period, fallback) => {
        const source = { ...(fallback || {}), ...(period || {}) };
        return {
          ...source,
          amStop: source.amStop || source.morningRouteId || '',
          pmStop: source.pmStop || source.eveningRouteId || '',
          startDate: normalizeDateInput(source.startDate || source.start_date || source.dateRegistered || fallback.startDate || fallback.start_date || null),
          endDate: resolveEndDate(source),
        };
      };
      const raw = transportPeriods[id];
      const list = isObj(raw) ? Object.values(raw).filter(isObj) : [];
      const periods = list.map((p) => normalizePeriod(p, enrollment)).filter((p) => p.startDate)
        .sort((a, b) => String(a.startDate).localeCompare(String(b.startDate)));
      return periods.length ? periods : [normalizePeriod(enrollment, enrollment)];
    }

    // ---- calculateTransportStatus() ----
    const statusCache = {};
    async function computeStatus(id) {
      const enrollment = enrollments[id];
      if (!enrollment) return null;
      const student = await studentFor(id);
      const listed = isListed(student);
      const payments = (await paymentsFor(id, student)).filter((p) => p && (p.approved === true || p.approved === 'true' || !!p.approvedAt));
      const periods = periodsFor(id, enrollment);
      const months = [];
      let carry = payments.reduce((sum, p) => sum + (Number(p?.amount || p?.paidAmount || p?.value || 0) || 0), 0);
      const totalPaidInput = carry;
      for (let month = 1; month <= 12; month += 1) {
        const dues = await Promise.all(periods.map((p) => monthDue(p, month, id, resolveStartDate(p), resolveEndDate(p))));
        const monthDueValue = +Number(dues.reduce((s, d) => s + Number(d || 0), 0)).toFixed(2);
        const paid = Math.min(monthDueValue, Math.max(0, carry));
        carry = Math.max(0, carry - paid);
        months.push({ month, due: monthDueValue, paid: +paid.toFixed(2), balance: +Math.max(0, monthDueValue - paid).toFixed(2) });
      }
      const currentYear = now.getFullYear();
      const currentMonth = now.getMonth() + 1;
      const lastDueMonth = now.getDate() >= 3 ? currentMonth : Math.max(0, currentMonth - 1);
      const isDue = (m) => (yearNum < currentYear ? true : (yearNum > currentYear ? false : m <= lastDueMonth));
      let totalExpected = 0;
      let totalPaid = 0;
      let totalYearExpected = 0;
      const unpaid = [];
      months.forEach(({ month, due: expected, paid }) => {
        totalYearExpected += expected;
        if (!isDue(month)) return;
        totalExpected += expected;
        totalPaid += paid;
        if ((paid + 0.01) < expected && expected > 0) unpaid.push({ month, name: MONTH_NAMES[month], balance: Math.max(0, expected - paid) });
      });
      const focusMonth = yearNum === currentYear ? currentMonth : 1;
      const fmt = (n) => Math.round(n || 0).toLocaleString('en-US');
      return {
        studentId: id,
        listed,
        student,
        enrollment,
        // display fields as the payments page shows them
        fullName: `${student.firstName || ''} ${student.middleName || ''} ${student.lastName || ''}`.replace(/\s+/g, ' ').trim(),
        admissionNumber: student.admissionNumber || 'N/A',
        className: classForYear(student),
        parentContact: student.primaryParentContact || student.parentPhone || student.guardianPhone || student.motherPhone ||
          student.fatherPhone || student.emergencyPhone || enrollment.primaryParentContact || enrollment.parentContact ||
          enrollment.parentPhone || enrollment.guardianPhone || '',
        transportStatus: enrollment.status === 'Stopped' ? 'Stopped' : 'Using',
        drivers: driverNamesFor(id),
        debt: Math.max(0, totalExpected - totalPaid),
        totalPaid,
        approvedPaid: totalPaidInput,
        baseMonthlyFee: await baseWithOverride(enrollment, focusMonth, id),
        totalExpected,
        totalYearExpected,
        totalYearDebt: Math.max(0, +(totalYearExpected - totalPaidInput).toFixed(2)),
        currentMonthExpected: Number((months.find((m) => m.month === focusMonth) || {}).due || 0),
        unpaidMonths: unpaid,
        unpaidMonthsDisplay: unpaid.length ? unpaid.map((m) => `${m.name.substring(0, 3)}=${fmt(m.balance)}`).join(', ') : 'None',
        months,
      };
    }

    return {
      schoolId: sid,
      year: yearNum,
      enrollments,
      studentIds,
      driverNamesFor,
      // Pupils the payments page lists under this driver (AM or PM), including ones who stopped
      // transport but still owe. Matches the driver's names and the name their worker uid resolves to.
      idsForDriver({ uid = '', names = [] } = {}) {
        const wanted = new Set([...names, resolveWorkerName(uid)].map(norm).filter(Boolean));
        if (!wanted.size) return [];
        return studentIds.filter((id) => {
          const d = driverNamesFor(id);
          return wanted.has(norm(d.morning)) || wanted.has(norm(d.evening));
        });
      },
      statusFor(id) {
        if (!statusCache[id]) statusCache[id] = computeStatus(id).catch((err) => { delete statusCache[id]; throw err; });
        return statusCache[id];
      },
    };
  }

  global.TransportDebtEngine = { load };
})(typeof window !== 'undefined' ? window : globalThis);
