/**
 * shared/finance_math.js
 * Centralised finance computations shared across dashboards/pages.
 * Mirrors the math used inside finance.html so that every surface stays in sync.
 */
(function(global){
  'use strict';

  const SOMAP_DEFAULT_YEAR = Number(global.SOMAP_DEFAULT_YEAR) || 2025;
  const DEFAULT_CLASS_ORDER = ['Baby Class','Middle Class','Pre Unit Class','Class 1','Class 2','Class 3','Class 4','Class 5','Class 6','Class 7'];
  const CLASS_ORDER = Array.isArray(global.CLASS_ORDER) && global.CLASS_ORDER.length
    ? global.CLASS_ORDER
    : DEFAULT_CLASS_ORDER;
  const L = (s) => String(s || '').trim().toLowerCase();
  const CLASS_ALIASES = {
    'middle': 'Middle Class',
    'middle class': 'Middle Class',
    'pre unit': 'Pre Unit Class',
    'pre-unit': 'Pre Unit Class',
    'preunit': 'Pre Unit Class',
    'preunit class': 'Pre Unit Class',
    'pre unit class': 'Pre Unit Class',
    'pre-primary': 'Middle Class',
    'pre primary': 'Middle Class'
  };

  const normalizeClassLabel = (label) => {
    const key = L(label);
    return CLASS_ALIASES[key] || label;
  };

  const shiftClassFallback = (baseClass, deltaYears) => {
    const normalizedBase = normalizeClassLabel(baseClass);
    const i = CLASS_ORDER.findIndex((c) => L(c) === L(normalizedBase));
    if (i < 0) return baseClass || '';
    const j = i + Number(deltaYears || 0);
    if (j < 0) return 'PRE-ADMISSION';
    if (j >= CLASS_ORDER.length) return 'GRADUATED';
    return CLASS_ORDER[j];
  };
  const shiftClassFn = typeof global.shiftClass === 'function' ? global.shiftClass : shiftClassFallback;

  const datasetCache = {};
  const summaryCache = {};
  const expensesCache = {};

  function getDb(){
    if (global.db && typeof global.db.ref === 'function') return global.db;
    if (global.firebase?.database) {
      try { return global.firebase.database(); } catch (_) {}
    }
    return null;
  }

  function schoolPrefix(){
    const schoolId =
      global.currentSchoolId ||
      (global.SOMAP && (typeof SOMAP.getSchoolId === 'function' ? SOMAP.getSchoolId() : (SOMAP.getSchool?.()?.id)));
    if (!schoolId || schoolId === 'socrates-school') return '';
    return `schools/${schoolId.replace(/\/+$/,'')}/`;
  }

  function pref(path){
    const trimmed = String(path || '').replace(/^\/+/, '');
    return `${schoolPrefix()}${trimmed}`;
  }

  function normalizeYear(year){
    const num = Number(year);
    if (!Number.isFinite(num)) return String(SOMAP_DEFAULT_YEAR);
    return String(num);
  }

  function clamp(n){ return Math.max(0, Math.round(Number(n) || 0)); }
  function fmtNumber(n){ return Number(n) || 0; }

  const financeDedupe = global.SOMAP_FINANCE || {};
  function dedupePayments(paymentsSource, workingYear, studentRef){
    if (financeDedupe.dedupePaymentMap) {
      return financeDedupe.dedupePaymentMap(paymentsSource, workingYear, studentRef);
    }
    const seen = new Set();
    const clean = {};
    Object.entries(paymentsSource || {}).forEach(([key, value]) => {
      if (!value || typeof value !== 'object') return;
      const amount = Number(value.amount || value.paidAmount || 0);
      const ref = String(value.referenceCode || value.ref || '').trim().toUpperCase();
      const ts = String(value.timestamp || value.date || value.paymentDate || '');
      const idKey = `${workingYear}|${studentRef}|${amount}|${ref}|${ts}`;
      if (seen.has(idKey)) return;
      seen.add(idKey);
      clean[key] = value;
    });
    return clean;
  }
  function todayYMD(targetYear){
    const now = new Date();
    const y = Number(targetYear);
    return {
      y: Number.isFinite(y) ? y : now.getFullYear(),
      m: now.getMonth() + 1,
      d: now.getDate()
    };
  }
  function dateFromYMD(y, m, d){ return new Date(y, m - 1, d).getTime(); }
  function isPast(ts){ return Date.now() > ts; }
  function apportion(total, weights){
    if (!Array.isArray(weights) || !weights.length) return [];
    const sumW = weights.reduce((a, b) => a + b, 0);
    let amounts = weights.map((w) => Math.floor((w * total) / sumW));
    let sumA = amounts.reduce((a, b) => a + b, 0);
    let rem = total - sumA;
    if (rem > 0) {
      const sortedIdx = [...weights.keys()].sort((a, b) => weights[b] - weights[a]);
      for (let i = 0; i < rem; i++) amounts[sortedIdx[i % sortedIdx.length]]++;
    }
    return amounts;
  }

  const installmentConfigs = {
    lower: {
      type: '6',
      weights: [44, 13, 12, 22, 22, 16],
      labels: ['Inst 1', 'Inst 2', 'Inst 3', 'Inst 4', 'Inst 5', 'Inst 6'],
      windows: [
        { from: [12, 1], to: [1, 10] },
        { from: [3, 1], to: [3, 15] },
        { from: [4, 1], to: [4, 15] },
        { from: [5, 1], to: [5, 15] },
        { from: [7, 1], to: [7, 15] },
        { from: [9, 1], to: [9, 15] },
      ]
    },
    class4_7: {
      type: '4',
      weights: [328, 180, 176, 132],
      labels: ['Inst 1', 'Inst 2', 'Inst 3', 'Inst 4'],
      windows: [
        { from: [12, 1], to: [1, 10] },
        { from: [3, 1], to: [3, 15] },
        { from: [4, 1], to: [4, 15] },
        { from: [5, 1], to: [5, 15] },
      ]
    },
    class5: {
      type: '6',
      weights: [44, 23, 22, 32, 26, 17],
      labels: ['Inst 1','Inst 2','Inst 3','Inst 4','Inst 5','Inst 6'],
      windows: [
        { from: [12, 1], to: [1, 10] },
        { from: [3, 1], to: [3, 15] },
        { from: [4, 1], to: [4, 15] },
        { from: [5, 1], to: [5, 15] },
        { from: [7, 1], to: [7, 15] },
        { from: [9, 1], to: [9, 15] },
      ]
    },
    class6: {
      type: '6',
      weights: [236, 115, 110, 160, 160, 100],
      labels: ['Inst 1','Inst 2','Inst 3','Inst 4','Inst 5','Inst 6'],
      windows: [
        { from: [12, 1], to: [1, 10] },
        { from: [3, 1], to: [3, 15] },
        { from: [4, 1], to: [4, 15] },
        { from: [5, 1], to: [5, 15] },
        { from: [7, 1], to: [7, 15] },
        { from: [9, 1], to: [9, 15] },
      ]
    },
    class7: {
      type: '4',
      weights: [340, 190, 180, 110],
      labels: ['Inst 1','Inst 2','Inst 3','Inst 4'],
      windows: [
        { from: [12, 1], to: [1, 10] },
        { from: [3, 1], to: [3, 15] },
        { from: [4, 1], to: [4, 15] },
        { from: [5, 1], to: [5, 15] },
      ]
    },
    monthly: {
      type: 'monthly',
      weights: [2, 1, 1, 1, 1, 1, 2, 1, 1, 1],
      labels: ['Jan (2 months)', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul (2 months)', 'Aug', 'Sep', 'Oct'],
      windows: [
        { from: [1, 1], to: [1, 10] }, { from: [2, 1], to: [2, 10] }, { from: [3, 1], to: [3, 10] },
        { from: [4, 1], to: [4, 10] }, { from: [5, 1], to: [5, 10] }, { from: [6, 1], to: [6, 10] },
        { from: [7, 1], to: [7, 10] }, { from: [8, 1], to: [8, 10] }, { from: [9, 1], to: [9, 10] },
        { from: [10, 1], to: [10, 10] },
      ]
    },
    '2inst': {
      type: '2',
      weights: [1, 1],
      labels: ['1st Half', '2nd Half'],
      windows: [
        { from: [1, 1], to: [1, 10] },
        { from: [7, 1], to: [7, 5] },
      ]
    },
    full: {
      type: 'full',
      weights: [1],
      labels: ['Full Year'],
      windows: [
        { from: [1, 1], to: [1, 10] },
      ]
    }
  };

  function getConfig(student){
    const plan = L(student?.paymentPlan || '');
    const cls = L(student?.classLevel || student?.className || '');
    if (plan.includes('monthly') || plan.includes('mwezi')) return installmentConfigs.monthly || installmentConfigs.lower;
    if (plan.includes('2')) return installmentConfigs['2inst'];
    if (plan.includes('full')) return installmentConfigs.full;
    if (plan.includes('4') || (plan.includes('inst') && (cls === 'class 4' || cls === 'class 7'))) return installmentConfigs.class4_7;
    if (plan.includes('inst')) {
      if (cls === 'class 1' || cls === 'class 2' || cls === 'class 3') return installmentConfigs.lower;
      if (cls === 'class 5') return installmentConfigs.class5;
      if (cls === 'class 6') return installmentConfigs.class6;
    }
    return installmentConfigs.full;
  }

  function normalizePayments(source, targetYear){
    if (!source) return {};
    const normalized = {};
    const desiredYear = Number(targetYear);
    Object.entries(source).forEach(([key, raw]) => {
      if (raw == null) return;
      if (typeof raw === 'number') {
        if (raw <= 0) return;
        normalized[key] = {
          amount: Number(raw),
          timestamp: Date.now(),
          academicYear: Number.isFinite(desiredYear) ? desiredYear : undefined,
        };
        return;
      }
      const amount = Number(raw.amount ?? raw.value ?? raw.paid ?? raw.payment ?? raw.total ?? 0);
      if (!Number.isFinite(amount) || amount <= 0) return;
      const timestamp = Number(
        raw.timestamp ?? raw.datePaid ?? raw.createdAt ?? raw.recordedAt ?? raw.updatedAt ?? raw.time ?? Date.now()
      );
      let paymentYear = Number(
        raw.academicYear ??
        raw.financeYear ??
        raw.feeYear ??
        raw.year ??
        raw._year ??
        raw.academic_session
      );
      if (!Number.isFinite(paymentYear)) {
        const tsDate = new Date(timestamp);
        if (!Number.isNaN(tsDate.getTime())) paymentYear = tsDate.getFullYear();
      }
      if (Number.isFinite(desiredYear) && Number.isFinite(paymentYear) && paymentYear !== desiredYear) return;
      const payload = { ...raw, amount, timestamp };
      if (Number.isFinite(paymentYear)) payload.academicYear = paymentYear;
      else if (Number.isFinite(desiredYear)) payload.academicYear = desiredYear;
      normalized[key] = payload;
    });
    return normalized;
  }

  function buildSchedule(student, targetYear){
    if (!student || student.isGraduated) {
      return { items: [], periodLabelNow: '-', expectedToDate: 0 };
    }
    const { y } = todayYMD(targetYear);

    if (Array.isArray(student._customSchedule) && student._customSchedule.length) {
      const sc = student._customSchedule
        .filter((it) => it && it.label && it.from && it.to)
        .map((it, idx) => ({
          key: `custom${idx + 1}`,
          label: String(it.label || 'Item'),
          fromTS: new Date(it.from).getTime() || 0,
          toTS: new Date(it.to).getTime() || 0,
          amount: Math.max(0, Math.round(Number(it.amount) || 0)),
          paidAllocated: 0,
          status: 'Pending'
        }));
      let lastDueIndex = -1, periodLabel = '-', expectedToDate = 0;
      const now = Date.now();
      sc.forEach((it, idx) => { if (it.toTS < now) { lastDueIndex = idx; expectedToDate += it.amount; } });
      if (lastDueIndex >= 0) periodLabel = sc[lastDueIndex].label;
      return { items: sc, periodLabelNow: periodLabel, expectedToDate };
    }

    if (Array.isArray(student._planSchedule) && student._planSchedule.length) {
      const baseFee = Math.max(0, Math.round(Number(student.baseFee ?? (student.feePerYear - (student.carryAmount || 0))) || 0));
      const carryAmount = Math.max(0, Number(student.carryAmount || 0));
      const weights = student._planSchedule.map((s) => Math.max(0, Number(s.weight) || 0));
      const amounts = apportion(baseFee, weights);
      if (carryAmount > 0) {
        if (amounts.length) amounts[0] += carryAmount; else amounts.push(carryAmount);
      }
      const planName = String(student.paymentPlan || '').toLowerCase();
      const isMonthlyPlan = planName.includes('monthly') || planName.includes('mwezi') ||
        student._planSchedule.some((s) => String(s.label || '').includes('Monthly:'));
      const sc = student._planSchedule.map((s, i) => {
        let toTS = s.to ? new Date(s.to).getTime() : 0;
        if (isMonthlyPlan && toTS > 0 && !Number.isNaN(toTS)) {
          const d = new Date(toTS);
          if (d.getDate() !== 10) {
            toTS = new Date(d.getFullYear(), d.getMonth(), 10, 23, 59, 59, 999).getTime();
          }
        }
        return {
          key: `inst${i + 1}`,
          label: s.label || `Inst ${i + 1}`,
          fromTS: s.from ? new Date(s.from).getTime() : 0,
          toTS,
          amount: Math.max(0, amounts[i] || 0),
          paidAllocated: 0,
          status: 'Pending'
        };
      });
      let lastDueIndex = -1, periodLabel = '-', expectedToDate = 0;
      const now = Date.now();
      sc.forEach((it, idx) => { if (it.toTS < now) { lastDueIndex = idx; expectedToDate += it.amount; } });
      if (lastDueIndex >= 0) periodLabel = sc[lastDueIndex].label;
      return { items: sc, periodLabelNow: periodLabel, expectedToDate };
    }

    const config = getConfig(student);
    const baseFee = Math.max(0, Math.round(Number(student.baseFee ?? (student.feePerYear - (student.carryAmount || 0))) || 0));
    const carryAmount = Math.max(0, Number(student.carryAmount || 0));
    const amounts = apportion(baseFee, config.weights);
    if (carryAmount > 0) {
      if (amounts.length) amounts[0] += carryAmount;
      else amounts.push(carryAmount);
    }
    const sc = [];
    config.labels.forEach((label, i) => {
      let fromY = y, toY = y;
      const fromM = config.windows[i].from[0], fromD = config.windows[i].from[1];
      const toM = config.windows[i].to[0], toD = config.windows[i].to[1];
      if (fromM === 12) fromY = y - 1;
      if (toM === 12) toY = y - 1;
      const fromTS = dateFromYMD(fromY, fromM, fromD);
      const toTS = dateFromYMD(toY, toM, toD);
      sc.push({ key: `inst${i + 1}`, label, fromTS, toTS, amount: amounts[i] || 0, paidAllocated: 0, status: 'Pending' });
    });
    let lastDueIndex = -1, periodLabel = '-', expectedToDate = 0;
    const now = Date.now();
    sc.forEach((it, idx) => { if (it.toTS < now) { lastDueIndex = idx; expectedToDate += it.amount; } });
    if (lastDueIndex >= 0) periodLabel = sc[lastDueIndex].label;
    return { items: sc, periodLabelNow: periodLabel, expectedToDate };
  }

  function allocatePayments(student, schedule){
    const payList = [];
    if (student?.payments) {
      Object.values(student.payments).forEach((p) => {
        payList.push({ amount: clamp(p.amount), ts: Number(p.timestamp) || 0 });
      });
    }
    payList.sort((a, b) => a.ts - b.ts);
    let pot = payList.reduce((s, p) => s + p.amount, 0);
    const totalPaid = pot;
    let prevDebt = clamp(student.previousDebt || 0);
    const toPrev = Math.min(prevDebt, pot);
    prevDebt -= toPrev;
    pot -= toPrev;

    for (const it of schedule.items) {
      const need = Math.max(0, it.amount - it.paidAllocated);
      if (need <= 0) continue;
      if (pot <= 0) break;
      const use = Math.min(need, pot);
      it.paidAllocated += use;
      pot -= use;
    }
    const credit = Math.max(0, pot);
    const now = Date.now();
    for (const it of schedule.items) {
      const a = it.paidAllocated, need = it.amount;
      if (a >= need) it.status = 'Cleared';
      else if (isPast(it.toTS)) it.status = a > 0 ? 'Partially Paid (Overdue)' : 'Overdue';
      else it.status = a > 0 ? 'Partially Paid' : 'Pending';
    }
    const expectedToDate = schedule.items.filter((it) => it.toTS < now).reduce((s, it) => s + it.amount, 0);
    const paidConsumed = totalPaid - credit;
    const debtTillNow = Math.max(0, expectedToDate - paidConsumed);
    return { scheduleItems: schedule.items, prevDebtAfter: prevDebt, credit, totalPaid, debtTillNow };
  }

  function computeStudentFinancials(student, targetYear){
    const feePerYear = Math.max(0, Number(student.feePerYear) || 0);
    const previousDebt = 0;
    const schedule = buildSchedule(student, targetYear);
    const alloc = allocatePayments(student, schedule);
    const paidAfterPrev = Math.max(0, alloc.totalPaid - (previousDebt - alloc.prevDebtAfter));
    const yearBalance = Math.max(0, feePerYear - paidAfterPrev);
    return {
      feePerYear,
      previousDebt,
      paidAmount: alloc.totalPaid,
      balance: yearBalance,
      periodDebtLabel: schedule.periodLabelNow || '-',
      periodDebtValue: alloc.debtTillNow,
      credit: alloc.credit,
      scheduleItems: alloc.scheduleItems
    };
  }

function coerceFeeValue(value){
  if (value == null) return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string') {
    const cleaned = value.replace(/[^\d.-]/g, '');
    if (!cleaned) return null;
    const parsed = Number(cleaned);
    return Number.isFinite(parsed) ? parsed : null;
  }
  if (typeof value === 'object') {
    const maybe =
      value.feePerYear ??
      value.baseFee ??
      value.amount ??
      value.total ??
      value.value;
    return coerceFeeValue(maybe);
  }
  return null;
}

function buildFinanceStudents(
  baseStudents = {},
  anchorEnrollments = {},
  enrollments = {},
  classFees = {},
  overrides = {},
  plans = {},
  ledgers = {},
  carryForward = {},
  studentFees = {},
  year = SOMAP_DEFAULT_YEAR
){
    const targetYear = String(year || SOMAP_DEFAULT_YEAR);
    const deltaYears = Number(targetYear) - SOMAP_DEFAULT_YEAR;
    const map = {};
  const ids = new Set([
    ...Object.keys(baseStudents || {}),
    ...Object.keys(anchorEnrollments || {}),
    ...Object.keys(enrollments || {}),
    ...Object.keys(overrides || {}),
    ...Object.keys(ledgers || {}),
    ...Object.keys(carryForward || {}),
    ...Object.keys(studentFees || {})
  ]);

    ids.forEach((id) => {
      const base = baseStudents[id] || {};
      const anchor = anchorEnrollments[id] || {};
      const enrollment = enrollments[id] || {};
    const override = overrides[id] || {};
    const ledgerEntry = ledgers[id] || {};
    const carry = carryForward[id] || {};
    let studentFeeOverride = studentFees[id];
    if (!studentFeeOverride) {
      const admKey =
        base.admissionNumber ||
        base.admissionNo ||
        anchor.admissionNumber ||
        anchor.admissionNo ||
        enrollment.admissionNumber ||
        enrollment.admissionNo ||
        '';
      if (admKey && studentFees[admKey]) {
        studentFeeOverride = studentFees[admKey];
      }
    }

      const baseClass =
        anchor.className ||
        anchor.classLevel ||
        base.classLevel ||
        base.class ||
        enrollment.className ||
        enrollment.classLevel ||
        '';
      const classLevel = shiftClassFn(baseClass, deltaYears);
      const classDefaults = classFees[classLevel] || classFees[baseClass] || {};

      const resolvedPlanId = override.planId || classDefaults.defaultPlanId || null;
      const resolvedPlan = resolvedPlanId ? plans[resolvedPlanId] : null;

      const isMonthlyPlan = resolvedPlan?.schedule && Array.isArray(resolvedPlan.schedule) &&
        resolvedPlan.schedule.length > 0 &&
        resolvedPlan.schedule.some((row) => String(row.label || '').includes('Monthly:'));

      let paymentPlan =
        (resolvedPlan && resolvedPlan.name) ||
        override.planName ||
        override.paymentPlan ||
        enrollment.planName ||
        enrollment.paymentPlan ||
        classDefaults.defaultPlan ||
        base.paymentPlan ||
        '6-instalments';

      if (isMonthlyPlan) paymentPlan = 'Malipo kwa mwezi';

      const admissionNumber =
        enrollment.admissionNumber ||
        enrollment.admissionNo ||
        base.admissionNumber ||
        id;

    const explicitStudentFee = coerceFeeValue(studentFeeOverride);

    let baseFeeCandidate =
      (explicitStudentFee != null ? explicitStudentFee : undefined) ??
      override.feePerYear ??
      classDefaults.feePerYear ??
      base.feePerYear ??
      base.feeDue ??
      base.requiredFee ??
      0;

      if (isMonthlyPlan && (!baseFeeCandidate || baseFeeCandidate === 0) && resolvedPlan?.schedule) {
        const totalFromSchedule = resolvedPlan.schedule.reduce((sum, row) => sum + (Number(row.amount) || 0), 0);
        if (totalFromSchedule > 0) baseFeeCandidate = totalFromSchedule;
      }

      const baseFee = Math.max(0, Math.round(Number(baseFeeCandidate) || 0));
      const carryAmount = Math.max(0, Number(carry.amount ?? carry.balance ?? 0));
      const effectiveFee = Math.max(0, baseFee + carryAmount);

      let paymentsSource = {};
      if (ledgerEntry && typeof ledgerEntry === 'object') {
        const yearBucket =
          ledgerEntry[targetYear] ||
          ledgerEntry[String(targetYear)] ||
          ledgerEntry[Number(targetYear)];
        if (yearBucket && typeof yearBucket === 'object') {
          if (yearBucket.payments) paymentsSource = yearBucket.payments;
          else if (yearBucket.entries) paymentsSource = yearBucket.entries;
          else if (yearBucket.records) paymentsSource = yearBucket.records;
          else paymentsSource = yearBucket;
        } else if (ledgerEntry.payments || ledgerEntry.entries || ledgerEntry.records) {
          paymentsSource =
            ledgerEntry.payments ||
            ledgerEntry.entries ||
            ledgerEntry.records;
        } else {
          paymentsSource = ledgerEntry;
        }
      } else if (ledgerEntry != null) {
        paymentsSource = ledgerEntry;
      }
      if (!Object.keys(paymentsSource || {}).length && base.payments) {
        paymentsSource = base.payments;
      }
      const dedupedPayments = dedupePayments(paymentsSource, targetYear, admissionNumber || id);
      const payments = normalizePayments(dedupedPayments, targetYear);

      const parentContact =
        enrollment.parentPhone ||
        enrollment.guardianPhone ||
        base.primaryParentContact ||
        base.parentPhone ||
        base.guardianPhone ||
        base.contact ||
        '';

      const hasYearData =
        (enrollment && Object.keys(enrollment).length > 0) ||
        (override && Object.keys(override).length > 0) ||
        (classDefaults && Object.keys(classDefaults).length > 0) ||
        carryAmount > 0 ||
        Object.keys(payments || {}).length > 0 ||
        Object.keys(base.payments || {}).length > 0;

      const record = {
        ...base,
        classLevel,
        classLevelRaw: baseClass || '',
        paymentPlan,
        feePerYear: effectiveFee,
        baseFee,
        carryAmount,
        payments,
        financeYear: targetYear,
        academicYear: targetYear,
        primaryParentContact: parentContact || base.primaryParentContact,
        admissionNumber: admissionNumber || id,
        hasYearData,
        isGraduated: classLevel === 'GRADUATED',
      };

      if (Array.isArray(override.customSchedule) && override.customSchedule.length) {
        record._customSchedule = override.customSchedule;
      } else if (resolvedPlan && Array.isArray(resolvedPlan.schedule)) {
        record._planSchedule = resolvedPlan.schedule;
      }

      record.previousDebt = 0;
      if (!record.firstName && enrollment.firstName) record.firstName = enrollment.firstName;
      if (!record.lastName && enrollment.lastName) record.lastName = enrollment.lastName;
      if (!record.middleName && enrollment.middleName) record.middleName = enrollment.middleName;
      if (override && Object.keys(override).length) record.override = override;
      record._classDefaults = classDefaults;
      map[id] = record;
    });

    return map;
  }

  async function ensureYearDataset(year){
    const y = normalizeYear(year);
    if (!datasetCache[y]) {
      datasetCache[y] = (async () => {
        const database = getDb();
        if (!database) throw new Error('SomapFinance: Firebase database not initialised.');
        const [
          baseSnap,
          anchorEnrollSnap,
          enrollmentSnap,
          classFeesSnap,
          overridesSnap,
          studentFeesSnap,
          plansSnap,
          ledgerSnap,
          carrySnap
        ] = await Promise.all([
          database.ref(pref('students')).once('value'),
          database.ref(pref(`enrollments/${SOMAP_DEFAULT_YEAR}`)).once('value'),
          database.ref(pref(`enrollments/${y}`)).once('value'),
          database.ref(pref(`feesStructure/${y}`)).once('value'),
          database.ref(pref(`studentOverrides/${y}`)).once('value'),
          database.ref(pref(`studentFees/${y}`)).once('value'),
          database.ref(pref(`installmentPlans/${y}`)).once('value'),
          database.ref(pref(`financeLedgers/${y}`)).once('value'),
          database.ref(pref(`financeCarryForward/${y}`)).once('value'),
        ]);
        let ledgerData = ledgerSnap.val() || {};
        if (!Object.keys(ledgerData || {}).length) {
          try {
            const legacy = await database.ref(pref('financeLedgers')).once('value');
            ledgerData = legacy.val() || {};
          } catch (legacyErr) {
            console.warn('SomapFinance: legacy financeLedgers read failed', legacyErr?.message || legacyErr);
          }
        }
        let studentFeesData = studentFeesSnap.val() || {};
        if (!Object.keys(studentFeesData || {}).length) {
          try {
            const legacyStudentFeesSnap = await database.ref(pref(`finance/${y}/studentFees`)).once('value');
            studentFeesData = legacyStudentFeesSnap.val() || {};
          } catch (studentFeesErr) {
            console.warn('SomapFinance: student fee override read failed', studentFeesErr?.message || studentFeesErr);
          }
        }
        const dataset = {
          year: y,
          baseStudents: baseSnap.val() || {},
          anchorEnrollments: anchorEnrollSnap.val() || {},
          yearEnrollments: enrollmentSnap.val() || {},
          classFees: classFeesSnap.val() || {},
          overrides: overridesSnap.val() || {},
          plans: plansSnap.val() || {},
          ledgers: ledgerData,
          carryForward: carrySnap.val() || {},
          studentFees: studentFeesData,
        };
        dataset.students = buildFinanceStudents(
          dataset.baseStudents,
          dataset.anchorEnrollments,
          dataset.yearEnrollments,
          dataset.classFees,
          dataset.overrides,
          dataset.plans,
          dataset.ledgers,
          dataset.carryForward,
          dataset.studentFees,
          y
        );
        return dataset;
      })();
    }
    return datasetCache[y];
  }

  async function ensureYearSummary(year){
    const y = normalizeYear(year);
    if (!summaryCache[y]) {
      summaryCache[y] = (async () => {
        const dataset = await ensureYearDataset(y);
        const entries = {};
        let totalDue = 0;
        let totalPaid = 0;
        Object.entries(dataset.students || {}).forEach(([id, student]) => {
          let fin = computeStudentFinancials(student, y);
          if (!student.hasYearData || student.isGraduated) {
            const effectiveFee = student.isGraduated ? 0 : Number(student.feePerYear) || 0;
            fin = {
              feePerYear: effectiveFee,
              previousDebt: 0,
              paidAmount: 0,
              balance: student.isGraduated ? 0 : effectiveFee,
              periodDebtLabel: '-',
              periodDebtValue: 0,
              credit: 0,
              scheduleItems: []
            };
          }
          const due = Number(fin.feePerYear) || 0;
          const paid = Number(fin.paidAmount) || 0;
          if (!student.isGraduated) {
            totalDue += due;
            totalPaid += paid;
          }
          entries[id] = {
            student,
            finance: fin,
            due,
            paid,
            outstanding: Math.max(0, due - paid)
          };
        });
        return { year: y, entries, totalDue, totalPaid, dataset };
      })();
    }
    return summaryCache[y];
  }

  async function loadStudentFinance(year, studentId){
    const y = normalizeYear(year);
    const [dataset, summary] = await Promise.all([
      ensureYearDataset(y),
      ensureYearSummary(y)
    ]);
    const base = dataset.baseStudents?.[studentId] || {};
    const summaryEntry = summary.entries?.[studentId];
    const studentRecord = summaryEntry?.student || dataset.students?.[studentId];
    const finance = summaryEntry?.finance || {
      feePerYear: 0,
      paidAmount: 0,
      balance: 0,
      periodDebtLabel: '-',
      periodDebtValue: 0,
      credit: 0,
      scheduleItems: []
    };
    const admissionNo = studentRecord?.admissionNumber || base.admissionNumber || studentId;
    const nameParts = [
      studentRecord?.firstName || base.firstName,
      studentRecord?.middleName || base.middleName,
      studentRecord?.lastName || base.lastName
    ].filter(Boolean);
    const fullName = nameParts.join(' ').trim() || admissionNo;
    const due = Number(finance.feePerYear) || 0;
    const paid = Number(finance.paidAmount) || 0;
    const outstanding = Number(finance.balance) || Math.max(0, due - paid);

    return {
      year: y,
      studentId,
      admissionNumber: admissionNo,
      fullName,
      classLevel: studentRecord?.classLevel || '',
      classLevelRaw: studentRecord?.classLevelRaw || '',
      paymentPlan: studentRecord?.paymentPlan || base.paymentPlan || '',
      due,
      paid,
      outstanding,
      hasYearData: Boolean(studentRecord?.hasYearData),
      isGraduated: Boolean(studentRecord?.isGraduated),
      scheduleItems: finance.scheduleItems || [],
      record: studentRecord || null
    };
  }

  async function loadStudentFinanceAtCutoff(year, studentId, cutoffDateISO){
    const base = await loadStudentFinance(year, studentId);
    const cutoffTs = Date.parse(String(cutoffDateISO || '').trim());
    if (!Number.isFinite(cutoffTs)) {
      return {
        ...base,
        expectedDueAtCutoff: Number(base.due || 0),
        paidAtCutoff: Number(base.paid || 0),
        outstandingAtCutoff: Number(base.outstanding || 0),
        creditAtCutoff: Math.max(0, Number(base.paid || 0) - Number(base.due || 0)),
        cutoffDateISO: ''
      };
    }

    const schedule = Array.isArray(base.scheduleItems) ? base.scheduleItems : [];
    const expectedDueAtCutoff = schedule
      .filter((item) => Number(item?.fromTS || 0) > 0 && Number(item.fromTS) <= cutoffTs)
      .reduce((sum, item) => sum + (Number(item?.amount || 0)), 0);

    const paidFromAlloc = schedule.reduce((sum, item) => {
      if (Number(item?.fromTS || 0) > cutoffTs) return sum;
      return sum + (Number(item?.paidAllocated || 0));
    }, 0);
    const paidAtCutoff = Math.max(0, Math.min(Number(base.paid || 0), paidFromAlloc > 0 ? paidFromAlloc : Number(base.paid || 0)));
    const outstandingAtCutoff = Math.max(0, expectedDueAtCutoff - paidAtCutoff);
    const creditAtCutoff = Math.max(0, paidAtCutoff - expectedDueAtCutoff);

    return {
      ...base,
      expectedDueAtCutoff: Number(expectedDueAtCutoff.toFixed(2)),
      paidAtCutoff: Number(paidAtCutoff.toFixed(2)),
      outstandingAtCutoff: Number(outstandingAtCutoff.toFixed(2)),
      creditAtCutoff: Number(creditAtCutoff.toFixed(2)),
      cutoffDateISO: String(cutoffDateISO || '').trim()
    };
  }

  async function loadSchoolTotals(year){
    const summary = await ensureYearSummary(year);
    const due = Number(summary.totalDue || 0);
    const collected = Number(summary.totalPaid || 0);
    const outstanding = due - collected;
    return {
      year: summary.year,
      due: Number(due.toFixed(2)),
      collected: Number(collected.toFixed(2)),
      outstanding: Number(outstanding.toFixed(2))
    };
  }

  async function loadExpensesTotal(year){
    const y = normalizeYear(year);
    if (!expensesCache[y]) {
      expensesCache[y] = (async () => {
        const database = getDb();
        if (!database) throw new Error('SomapFinance: Firebase database not initialised.');
        let snap = await database.ref(pref(`expenses/${y}`)).once('value');
        let raw = snap.val();
        if (!raw || (typeof raw === 'object' && !Object.keys(raw).length)) {
          snap = await database.ref(pref('expenses')).once('value');
          raw = snap.val();
        }
        const total = Object.values(raw || {}).reduce((sum, row) => sum + (Number(row?.amount) || 0), 0);
        return Number(total.toFixed(2));
      })();
    }
    return expensesCache[y];
  }

  async function listRecentPayments(year, limit = 10){
    const dataset = await ensureYearDataset(year);
    const entries = [];
    Object.entries(dataset.students || {}).forEach(([id, student]) => {
      Object.values(student.payments || {}).forEach((p) => {
        const amount = Number(p?.amount) || 0;
        if (!amount) return;
        entries.push({
          studentId: id,
          fullName: `${student.firstName || ''} ${student.middleName || ''} ${student.lastName || ''}`.replace(/\s+/g, ' ').trim() || student.admissionNumber || id,
          amount,
          method: p?.method || p?.mode || '',
          timestamp: Number(p?.timestamp || p?.datePaid || 0) || 0,
          note: p?.note || ''
        });
      });
    });
    entries.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
    if (limit > 0) return entries.slice(0, limit);
    return entries;
  }

  function findStudentRecord(dataset, identifier){
    const key = String(identifier || '').trim();
    if (!key) return null;
    const students = dataset?.students || {};
    if (students[key]) return students[key];
    const matchKey = Object.keys(students).find((id) => {
      if (id === key) return true;
      const entry = students[id] || {};
      const adm = String(entry.admissionNumber || entry.admissionNo || '').trim();
      if (adm && adm === key) return true;
      const alt = String(entry.studentId || '').trim();
      if (alt && alt === key) return true;
      return false;
    });
    return matchKey ? students[matchKey] : null;
  }

  async function getBalanceForYearAdmission(year, identifier){
    const y = normalizeYear(year);
    const dataset = await ensureYearDataset(y);
    const student = findStudentRecord(dataset, identifier);
    if (!student) return 0;
    const fin = computeStudentFinancials(student, y);
    return Math.max(0, Number(fin.balance) || 0);
  }

  const parseWindow = (win) => {
    const [a, b] = String(win || '').split('-').map((s) => s.trim());
    const sa = Date.parse(a);
    const sb = Date.parse(b);
    return { start: Number.isNaN(sa) ? 0 : sa, end: Number.isNaN(sb) ? 0 : sb };
  };
  const extractIndex = (label) => {
    const m = String(label || '').match(/(\d+)/);
    return m ? Number(m[1]) : Number.POSITIVE_INFINITY;
  };
  function installmentCompare(A, B){
    const aw = parseWindow(A?.window);
    const bw = parseWindow(B?.window);
    if (aw.start !== bw.start) return aw.start - bw.start;
    const ai = extractIndex(A?.label);
    const bi = extractIndex(B?.label);
    return ai - bi;
  }

  async function getYearStudents(year){
    const dataset = await ensureYearDataset(year);
    return dataset.students || {};
  }

  async function getYearFinanceEntries(year){
    const summary = await ensureYearSummary(year);
    return summary.entries || {};
  }

  function clearCaches(){
    Object.keys(datasetCache).forEach((k) => delete datasetCache[k]);
    Object.keys(summaryCache).forEach((k) => delete summaryCache[k]);
    Object.keys(expensesCache).forEach((k) => delete expensesCache[k]);
  }

  const api = {
    loadStudentFinance,
    loadStudentFinanceAtCutoff,
    loadSchoolTotals,
    loadExpensesTotal,
    listRecentPayments,
    installmentCompare,
    getYearStudents,
    getYearFinanceEntries,
    getBalanceForYearAdmission,
    _clearFinanceCaches: clearCaches
  };

  global.SomapFinance = Object.assign(global.SomapFinance || {}, api);
})(typeof window !== 'undefined' ? window : globalThis);
