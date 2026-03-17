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
  const approvalsCache = {};

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

  const CARRY_FORWARD_START_YEAR = 2025;

  function clamp(n){ return Math.max(0, Math.round(Number(n) || 0)); }
  function fmtNumber(n){ return Number(n) || 0; }

  function getStudentBaseFee(student){
    const rawCarry = Math.max(0, Number(student?.carryAmount || 0));
    const baseFeeRaw = student?.baseFee != null
      ? Number(student.baseFee)
      : Number(student?.feePerYear || 0) - rawCarry;
    return Math.max(0, Number.isFinite(baseFeeRaw) ? baseFeeRaw : 0);
  }

  function resolveCarryForwardState(student, previousYearBalance){
    const existingCarry = Math.max(0, Number(student?.carryAmount || 0));
    const priorBalance = Math.max(0, Number(previousYearBalance || 0));
    const effectiveCarry = Math.max(existingCarry, priorBalance);
    const carryDelta = Math.max(0, effectiveCarry - existingCarry);
    return {
      existingCarry,
      previousYearBalance: priorBalance,
      effectiveCarry,
      carryDelta,
    };
  }

  function buildEffectiveFinanceStudent(student, previousYearBalance){
    const carryState = resolveCarryForwardState(student, previousYearBalance);
    const baseFee = getStudentBaseFee(student);
    return {
      carryState,
      financeStudent: {
        ...student,
        baseFee,
        carryAmount: carryState.effectiveCarry,
        feePerYear: Math.max(0, baseFee + carryState.effectiveCarry),
      }
    };
  }

  function ensureScheduleCarryComponent(items, carryAmount){
    if (!Array.isArray(items) || !items.length) return items;
    const expectedCarry = Math.max(0, Number(carryAmount || 0));
    if (!(expectedCarry > 0)) return items;

    const existingCarry = items.reduce((sum, item) => sum + Math.max(0, Number(item?.carryComponent || 0)), 0);
    const missingCarry = Math.max(0, expectedCarry - existingCarry);
    if (!(missingCarry > 0)) return items;

    const firstItem = items[0];
    firstItem.carryComponent = Math.max(0, Number(firstItem?.carryComponent || 0)) + missingCarry;
    if (Number(firstItem?.amount || 0) < Number(firstItem.carryComponent || 0)) {
      firstItem.amount = Math.max(0, Number(firstItem.amount || 0)) + missingCarry;
    }
    return items;
  }

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
  function academicDateFromYMD(targetYear, m, d, endOfDay){
    const yearNum = Number(targetYear);
    const resolvedYear = m === 12 ? yearNum - 1 : yearNum;
    return endOfDay
      ? new Date(resolvedYear, m - 1, d, 23, 59, 59, 999).getTime()
      : new Date(resolvedYear, m - 1, d, 0, 0, 0, 0).getTime();
  }
  function parseExplicitDate(value, endOfDay){
    if (!value) return null;
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'string') {
      const trimmed = value.trim();
      if (!trimmed) return null;
      if (/^\d+$/.test(trimmed)) {
        const numericTs = Number(trimmed);
        return Number.isFinite(numericTs) ? numericTs : null;
      }
      if (!/\d{4}/.test(trimmed)) return null;
    }
    const directDate = new Date(value);
    if (!Number.isNaN(directDate.getTime())) {
      if (endOfDay) {
        return new Date(
          directDate.getFullYear(),
          directDate.getMonth(),
          directDate.getDate(),
          23, 59, 59, 999
        ).getTime();
      }
      return new Date(
        directDate.getFullYear(),
        directDate.getMonth(),
        directDate.getDate(),
        0, 0, 0, 0
      ).getTime();
    }
    return null;
  }
  function resolveAcademicWindowTS(targetYear, raw, fallbackPair, endOfDay){
    const explicit = parseExplicitDate(raw, endOfDay);
    if (explicit != null) return explicit;
    let pair = Array.isArray(raw) ? raw : null;
    if (!pair && typeof raw === 'string') {
      const nums = raw.match(/\d+/g);
      if (nums && nums.length >= 2) {
        const hasYearFirst = nums[0].length === 4;
        const month = Number(hasYearFirst ? nums[1] : nums[0]);
        const day = Number(hasYearFirst ? nums[2] : nums[1]);
        if (Number.isFinite(month) && Number.isFinite(day) && month > 0 && day > 0) {
          pair = [month, day];
        }
      }
    }
    if (!pair) pair = fallbackPair;
    let [month, day] = Array.isArray(pair) ? pair : [1, endOfDay ? 10 : 1];
    month = Number(month);
    day = Number(day);
    if (!Number.isFinite(month) || month <= 0 || month > 12) month = 1;
    if (!Number.isFinite(day) || day <= 0 || day > 31) day = endOfDay ? 10 : 1;
    return academicDateFromYMD(targetYear, month, day, endOfDay);
  }
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

    if (student._classInstallments && typeof student._classInstallments === 'object') {
      const config = getConfig(student);
      const entries = Object.values(student._classInstallments).filter((inst) => inst && inst.active !== false);
      if (entries.length) {
        const sorted = entries.slice().sort((a, b) => {
          const af = Array.isArray(a?.window?.from) ? a.window.from : [];
          const bf = Array.isArray(b?.window?.from) ? b.window.from : [];
          if (!af.length && !bf.length) return 0;
          if (!af.length) return 1;
          if (!bf.length) return -1;
          if (Number(af[0]) !== Number(bf[0])) return Number(af[0]) - Number(bf[0]);
          return Number(af[1]) - Number(bf[1]);
        });
        const items = sorted.map((inst, idx) => {
          const fallback = config?.windows?.[idx] || { from: [1, 1], to: [1, 10] };
          const fromRaw = inst?.from ?? inst?.fromDate ?? inst?.window?.from;
          const toRaw = inst?.to ?? inst?.toDate ?? inst?.window?.to;
          return {
            key: `classinst${idx + 1}`,
            label: inst?.label || (config?.labels?.[idx] || `Inst ${idx + 1}`),
            fromTS: resolveAcademicWindowTS(targetYear, fromRaw, fallback.from, false),
            toTS: resolveAcademicWindowTS(targetYear, toRaw, fallback.to, true),
            amount: Math.max(0, Math.round(Number(inst?.amount) || 0)),
            paidAllocated: 0,
            status: 'Pending',
            carryComponent: 0,
            windowText: inst?.windowText || ''
          };
        });
        const carryAmount = Math.max(0, Number(student.carryAmount || 0));
        const plannedTotal = items.reduce((sum, row) => sum + Math.max(0, Number(row.amount || 0)), 0);
        const targetTotal = Math.max(0, Number(student.feePerYear || 0));
        const shouldApplyCarry = carryAmount > 0 && items.length && plannedTotal + 1 < targetTotal;
        if (shouldApplyCarry) {
          items[0].amount += carryAmount;
          items[0].carryComponent = Math.max(0, Number(items[0].carryComponent || 0)) + carryAmount;
        }
        let lastDueIndex = -1, periodLabel = '-', expectedToDate = 0;
        const now = Date.now();
        items.forEach((it, idx) => {
          if (Number(it.toTS || 0) < now) {
            lastDueIndex = idx;
            expectedToDate += Math.max(0, Number(it.amount || 0));
          }
        });
        if (lastDueIndex >= 0) periodLabel = items[lastDueIndex].label;
        return { items, periodLabelNow: periodLabel, expectedToDate };
      }
    }

    if (Array.isArray(student._customSchedule) && student._customSchedule.length) {
      const sc = student._customSchedule
        .filter((it) => it && it.label && it.from && it.to)
        .map((it, idx) => ({
          key: `custom${idx + 1}`,
          label: String(it.label || 'Item'),
          fromTS: resolveAcademicWindowTS(targetYear, it.from, [1, 1], false),
          toTS: resolveAcademicWindowTS(targetYear, it.to, [1, 10], true),
          amount: Math.max(0, Math.round(Number(it.amount) || 0)),
          carryComponent: Math.max(0, Number(it.carryComponent || 0)),
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
      const config = getConfig(student);
      const baseFee = Math.max(0, Math.round(Number(student.baseFee ?? (student.feePerYear - (student.carryAmount || 0))) || 0));
      const carryAmount = Math.max(0, Number(student.carryAmount || 0));
      const explicitAmounts = student._planSchedule.map((s) => Math.max(0, Math.round(Number(s.amount) || 0)));
      const explicitTotal = explicitAmounts.reduce((sum, amount) => sum + amount, 0);
      const weights = student._planSchedule.map((s) => Math.max(0, Number(s.weight) || 0));
      const amounts = explicitTotal > 0
        ? explicitAmounts.slice()
        : apportion(baseFee, weights);
      const plannedTotal = amounts.reduce((sum, amount) => sum + Math.max(0, Number(amount || 0)), 0);
      const targetTotal = Math.max(0, Number(student.feePerYear || 0));
      const shouldApplyCarry = carryAmount > 0 && (plannedTotal + 1 < targetTotal);
      if (shouldApplyCarry) {
        if (amounts.length) amounts[0] += carryAmount;
        else amounts.push(carryAmount);
      }
      const planName = String(student.paymentPlan || '').toLowerCase();
      const isMonthlyPlan = planName.includes('monthly') || planName.includes('mwezi') ||
        student._planSchedule.some((s) => String(s.label || '').includes('Monthly:'));
      const sc = student._planSchedule.map((s, i) => {
        const fallback = config?.windows?.[i] || config?.windows?.[config.windows.length - 1] || { from: [1, 1], to: [1, 10] };
        const fromRaw = s?.from ?? s?.fromDate ?? s?.window?.from;
        const toRaw = s?.to ?? s?.toDate ?? s?.window?.to;
        const fromTS = resolveAcademicWindowTS(targetYear, fromRaw, fallback.from, false);
        let toTS = resolveAcademicWindowTS(targetYear, toRaw, fallback.to, true);
        if (isMonthlyPlan && Number.isFinite(toTS) && toTS > 0) {
          const d = new Date(toTS);
          if (d.getDate() !== 10) {
            toTS = new Date(d.getFullYear(), d.getMonth(), 10, 23, 59, 59, 999).getTime();
          }
        }
        return {
          key: `inst${i + 1}`,
          label: s.label || `Inst ${i + 1}`,
          fromTS,
          toTS,
          amount: Math.max(0, amounts[i] || 0),
          paidAllocated: 0,
          status: 'Pending',
          carryComponent: shouldApplyCarry && i === 0 ? carryAmount : Math.max(0, Number(s.carryComponent || 0)),
          windowText: s.windowText || ''
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
    ensureScheduleCarryComponent(schedule.items, student?.carryAmount || 0);
    const alloc = allocatePayments(student, schedule);
    const paidAfterPrev = Math.max(0, alloc.totalPaid - (previousDebt - alloc.prevDebtAfter));
    const yearBalance = Math.max(0, feePerYear - paidAfterPrev);
    const carryAmount = Math.max(0, Number(student.carryAmount || 0));
    const totalPaid = Math.max(0, Number(alloc.totalPaid || 0));
    const overdueRows = alloc.scheduleItems.filter(it =>
      Number(it.toTS || 0) > 0 &&
      Date.now() > Number(it.toTS) &&
      Math.max(0, Number(it.amount || 0) - Number(it.paidAllocated || 0)) > 0
    );
    const carryOutstanding = Math.max(0, carryAmount - totalPaid);
    const paidAfterCarry = Math.max(0, totalPaid - carryAmount);
    const overdueCarry = Math.max(0, Math.min(carryOutstanding, Number(alloc.debtTillNow || 0)));
    const overdueCurrentYear = Math.max(0, Number(alloc.debtTillNow || 0) - overdueCarry);
    return {
      feePerYear,
      previousDebt,
      paidAmount: alloc.totalPaid,
      balance: yearBalance,
      periodDebtLabel: schedule.periodLabelNow || '-',
      periodDebtValue: alloc.debtTillNow,
      isOverdueDebt: overdueRows.length > 0,
      hasCarryOutstanding: carryOutstanding > 0,
      carryOutstanding,
      paidAfterCarry,
      overdueCarry,
      overdueCurrentYear,
      overdueThroughTs: overdueRows.length ? Math.max(...overdueRows.map(it => Number(it.toTS || 0))) : 0,
      overdueWindowLabel: '-',
      credit: alloc.credit,
      scheduleItems: alloc.scheduleItems
    };
  }

  function extractSummaryValue(summary, keys, fallback){
    if (!summary || typeof summary !== 'object') return fallback;
    for (const key of keys) {
      const parts = String(key).split('.');
      let cursor = summary;
      let found = true;
      for (const part of parts) {
        if (cursor && Object.prototype.hasOwnProperty.call(cursor, part)) cursor = cursor[part];
        else {
          found = false;
          break;
        }
      }
      if (!found) continue;
      const value = Number(cursor);
      if (Number.isFinite(value)) return value;
    }
    return fallback;
  }

  function buildBreakdownFromSummary(scheduleItems, feeForYear, paidTotal) {
    const items = Array.isArray(scheduleItems) ? scheduleItems : [];
    const paid = Math.max(0, Number(paidTotal) || 0);
    const fee = Math.max(0, Number(feeForYear) || 0);
    let remainingPaid = paid;
    const now = Date.now();

    const getCarryAwareStatus = (expected, allocated, carryComponent, toTs) => {
      const totalExpected = Math.max(0, Number(expected) || 0);
      if (totalExpected <= 0) return 'Cleared';

      const totalAllocated = Math.max(0, Number(allocated) || 0);
      const carryPart = Math.min(totalExpected, Math.max(0, Number(carryComponent) || 0));
      const baseExpected = Math.max(0, totalExpected - carryPart);
      const progressExpected = baseExpected > 0 ? baseExpected : totalExpected;
      const progressAllocated = baseExpected > 0
        ? Math.max(0, totalAllocated - carryPart)
        : totalAllocated;

      if (progressAllocated >= progressExpected) return 'Cleared';
      if (now > Number(toTs || 0)) return progressAllocated > 0 ? 'Partially Paid (Overdue)' : 'Overdue';
      return progressAllocated > 0 ? 'Partially Paid' : 'Pending';
    };

    const rows = items.map((item) => {
      const expected = Math.max(0, Number(item?.amount) || 0);
      const allocated = Math.min(expected, remainingPaid);
      const carryComponent = Math.max(0, Number(item?.carryComponent || 0));
      remainingPaid -= allocated;
      return {
        label: item?.label || '',
        expected,
        allocated,
        remaining: Math.max(0, expected - allocated),
        carryComponent,
        status: getCarryAwareStatus(expected, allocated, carryComponent, item?.toTS),
        fromTS: Number(item?.fromTS || 0),
        toTS: Number(item?.toTS || 0),
        windowText: item?.windowText || '',
      };
    });

    const allocatedTotalRaw = rows.reduce((sum, row) => sum + Math.max(0, Number(row.allocated || 0)), 0);
    const usedForFee = Math.min(allocatedTotalRaw, fee);
    const expectedToDate = rows
      .filter((row) => Number(row.toTS || 0) > 0 && Number(row.toTS || 0) < now)
      .reduce((sum, row) => sum + Math.max(0, Number(row.expected || 0)), 0);
    const paidConsumedToDate = Math.min(expectedToDate, allocatedTotalRaw);
    const debtTillNowRaw = Math.max(0, expectedToDate - paidConsumedToDate);
    const remainingForYear = Math.max(0, fee - usedForFee);
    const debtTillNow = Math.min(debtTillNowRaw, remainingForYear);
    const credit = Math.max(0, paid - fee);

    return {
      rows,
      allocated: usedForFee,
      paidTotal: paid,
      remainingForYear,
      credit,
      debtTillNow,
    };
  }

  function computeDebtStateFromSummary(student, targetYear, scheduleItems, summary) {
    if (!summary || typeof summary !== 'object') return null;
    const fallbackFee = Math.max(0, Number(student?.feePerYear || 0));
    const feeForYear = Math.max(0, extractSummaryValue(summary, [
      'feeTotal',
      'fee',
      'totalDue',
      'total',
      'finance.feePerYear',
      'baseFee'
    ], fallbackFee) || fallbackFee);
    const paidTotal = Math.max(0, extractSummaryValue(summary, [
      'paidTotal',
      'paid',
      'collected',
      'finance.paidAmount'
    ], 0));
    const summaryBalanceRaw = extractSummaryValue(summary, [
      'balanceTotal',
      'balance',
      'outstanding',
      'finance.balance'
    ], Number.NaN);
    const clonedSchedule = (Array.isArray(scheduleItems) ? scheduleItems : []).map((item) => ({ ...item }));
    const breakdown = buildBreakdownFromSummary(clonedSchedule, feeForYear, paidTotal);
    const remainingWithCarry = Number.isFinite(summaryBalanceRaw) && summaryBalanceRaw >= 0
      ? Math.max(0, summaryBalanceRaw)
      : Math.max(0, Number(breakdown.remainingForYear || 0));
    const periodDebtValue = Math.min(
      Math.max(0, Number(breakdown.debtTillNow || 0)),
      remainingWithCarry
    );
    const earliestOverdueRow = breakdown.rows
      .filter((row) => String(row.status || '').includes('Overdue') && Math.max(0, Number(row.remaining || 0)) > 0)
      .sort((a, b) => Number(a.toTS || 0) - Number(b.toTS || 0))[0] || null;
    const hasDueDate = Boolean(earliestOverdueRow && periodDebtValue > 0);
    const periodDebtLabel = hasDueDate && Number(earliestOverdueRow.toTS || 0) > 0
      ? new Date(Number(earliestOverdueRow.toTS)).toLocaleDateString()
      : '-';
    const overdueWindowLabel = hasDueDate
      ? ((Number(earliestOverdueRow.fromTS || 0) > 0 && Number(earliestOverdueRow.toTS || 0) > 0)
          ? `${new Date(Number(earliestOverdueRow.fromTS)).toLocaleDateString()} - ${new Date(Number(earliestOverdueRow.toTS)).toLocaleDateString()}`
          : (earliestOverdueRow.windowText || '-'))
      : '-';
    const isOverdueDebt = hasDueDate;
    return {
      periodDebtValue: hasDueDate ? periodDebtValue : 0,
      periodDebtLabel,
      overdueWindowLabel,
      isOverdueDebt,
      rowNeedsHighlight: isOverdueDebt,
      debtValue: hasDueDate ? periodDebtValue : 0,
      debtLabel: hasDueDate ? `Overdue till ${periodDebtLabel}` : '-',
      hasDueDate,
      isOverdue: isOverdueDebt,
      amountClass: isOverdueDebt ? 'text-red-700' : '',
      windowClass: isOverdueDebt ? 'text-red-700' : 'text-slate-500',
      breakdown,
      overdueRow: earliestOverdueRow,
      source: 'approved-summary'
    };
  }

  function getDebtDisplayState(fin, targetYear){
    if (fin?.summaryDebtState && typeof fin.summaryDebtState === 'object') {
      const state = fin.summaryDebtState;
      return {
        debtValue: Math.max(0, Number(state.debtValue ?? state.periodDebtValue ?? 0)),
        debtLabel: state.debtLabel || '-',
        overdueWindowLabel: state.overdueWindowLabel || '-',
        hasDueDate: Boolean(state.hasDueDate),
        isOverdue: Boolean(state.isOverdue),
        rowNeedsHighlight: Boolean(state.rowNeedsHighlight),
        amountClass: state.amountClass || '',
        windowClass: state.windowClass || 'text-slate-500',
        overdueCarry: Math.max(0, Number(fin?.overdueCarry || 0)),
        overdueCurrentYear: Math.max(0, Number(fin?.overdueCurrentYear || 0)),
        carryYearLabel: Number.isFinite(Number(targetYear)) ? Number(targetYear) - 1 : null,
      };
    }
    const parseWindowTextDates = (windowText) => {
      const parts = String(windowText || '').match(/\d{1,2}\/\d{1,2}(?:\/\d{2,4})?/g) || [];
      const [fromText = '', toText = ''] = parts;
      return { fromText, toText };
    };
    const isDateLikeLabel = (value) => /\b\d{1,2}\/\d{1,2}(?:\/\d{2,4})?\b/.test(String(value || '').trim());

    const scheduleItems = Array.isArray(fin?.scheduleItems) ? fin.scheduleItems : [];
    const nowTs = Date.now();
    const overdueItems = scheduleItems
      .filter((item) => {
        const amount = Math.max(0, Number(item?.amount || 0));
        const allocated = Math.max(0, Number(item?.paidAllocated || 0));
        const remaining = Math.max(0, amount - allocated);
        const toTs = Number(item?.toTS || 0);
        const status = String(item?.status || '');
        return remaining > 0 && ((toTs > 0 && toTs < nowTs) || status.includes('Overdue'));
      })
      .sort((a, b) => Number(b?.toTS || 0) - Number(a?.toTS || 0));
    const latestOverdueItem = overdueItems[0] || null;
    const overdueRemaining = overdueItems.reduce((sum, item) => {
      const amount = Math.max(0, Number(item?.amount || 0));
      const allocated = Math.max(0, Number(item?.paidAllocated || 0));
      return sum + Math.max(0, amount - allocated);
    }, 0);
    const balanceValue = Math.max(0, Number(fin?.balance || 0));
    const inferredOverdueDebt = overdueRemaining > 0
      ? Math.min(balanceValue > 0 ? balanceValue : overdueRemaining, overdueRemaining)
      : 0;
    const debtValue = Math.max(0, Number(fin?.periodDebtValue || 0), inferredOverdueDebt);
    if (!(debtValue > 0)) {
      return {
        debtValue,
        debtLabel: '-',
        overdueWindowLabel: '-',
        hasDueDate: false,
        isOverdue: false,
        rowNeedsHighlight: false,
        amountClass: '',
        windowClass: 'text-slate-500',
      };
    }

    const overdueWindowText = parseWindowTextDates(latestOverdueItem?.windowText);
    const resolvedOverdueThroughTs = Math.max(0, Number(fin?.overdueThroughTs || fin?.originalOverdueThroughTs || 0));
    const fallbackDueDate = resolvedOverdueThroughTs > 0
      ? new Date(resolvedOverdueThroughTs).toLocaleDateString()
      : ((latestOverdueItem && Number(latestOverdueItem.toTS || 0) > 0)
        ? new Date(Number(latestOverdueItem.toTS)).toLocaleDateString()
        : overdueWindowText.toText);
    const fallbackWindowEndTs = resolvedOverdueThroughTs > 0
      ? resolvedOverdueThroughTs
      : Number(latestOverdueItem?.toTS || 0);
    const fallbackWindow = latestOverdueItem && fallbackWindowEndTs > 0
      ? `${new Date(Number(latestOverdueItem.fromTS || latestOverdueItem.toTS)).toLocaleDateString()} - ${new Date(fallbackWindowEndTs).toLocaleDateString()}`
      : (overdueWindowText.fromText && overdueWindowText.toText ? `${overdueWindowText.fromText} - ${overdueWindowText.toText}` : '-');

    const periodDebtLabel = String(fin?.periodDebtLabel || '').trim();
    const overdueWindowLabel = String(fin?.overdueWindowLabel || '').trim();
    const resolvedDueDate = isDateLikeLabel(periodDebtLabel)
      ? periodDebtLabel
      : (fallbackDueDate || (periodDebtLabel && periodDebtLabel !== '-' ? periodDebtLabel : ''));
    const resolvedWindow = overdueWindowLabel && overdueWindowLabel !== '-' ? overdueWindowLabel : fallbackWindow;
    const baseIsOverdue = Boolean(fin?.isOverdueDebt || latestOverdueItem);
    const hasCarryOutstanding = Boolean(fin?.hasCarryOutstanding);
    const isCarryOnlyDebt = hasCarryOutstanding && !baseIsOverdue;
    const isOverdue = baseIsOverdue || isCarryOnlyDebt;
    const hasDueDate = Boolean(resolvedDueDate);
    const debtLabel = hasDueDate
      ? `${fin?.extensionActive && !isOverdue ? 'Due by' : 'Overdue till'} ${resolvedDueDate}`
      : '-';
    const yearNum = Number(targetYear);

    return {
      debtValue,
      debtLabel,
      overdueWindowLabel: resolvedWindow,
      hasDueDate,
      isOverdue,
      rowNeedsHighlight: isOverdue,
      amountClass: isOverdue ? 'text-red-700' : '',
      windowClass: isOverdue ? 'text-red-700' : 'text-slate-500',
      overdueCarry: Math.max(0, Number(fin?.overdueCarry || 0)),
      overdueCurrentYear: Math.max(0, Number(fin?.overdueCurrentYear || 0)),
      carryYearLabel: Number.isFinite(yearNum) ? yearNum - 1 : null,
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
  approvalsByStudent = {},
  year = SOMAP_DEFAULT_YEAR
){
    const targetYear = String(year || SOMAP_DEFAULT_YEAR);
    const targetYearNum = Number(targetYear);
    const currentSchoolId = String(global.SOMAP?.getSchool?.()?.id || global.currentSchoolId || '').trim();
    const isNonEmptyObj = (o) => o && typeof o === 'object' && !Array.isArray(o) && Object.keys(o).length > 0;
    const toMs = (value) => {
      if (value === null || value === undefined) return null;
      if (typeof value === 'number' && Number.isFinite(value)) {
        if (value > 1e12) return value;
        if (value > 1e10) return value;
        if (value > 1e9) return value * 1000;
        return value;
      }
      const s = String(value).trim();
      if (!s) return null;
      if (/^\d{10,13}$/.test(s)) {
        const n = Number(s);
        if (!Number.isFinite(n)) return null;
        return n > 1e12 ? n : n * 1000;
      }
      const parsed = Date.parse(s);
      return Number.isFinite(parsed) ? parsed : null;
    };
    const getRegistrationMs = (stu) => {
      if (!stu || typeof stu !== 'object') return null;
      return (
        toMs(stu.timestamp) ??
        toMs(stu.createdAt) ??
        toMs(stu.registeredAt) ??
        toMs(stu.regTimestamp) ??
        toMs(stu.dateRegistered) ??
        toMs(stu.dateOfRegistration) ??
        null
      );
    };
    const getRegistrationYear = (stu) => {
      const ms = getRegistrationMs(stu);
      if (!ms) return null;
      const d = new Date(ms);
      const y = d.getFullYear();
      return Number.isFinite(y) ? y : null;
    };
    const looksDeleted = (stu) => {
      const status = String(stu?.status || '').trim().toLowerCase();
      return Boolean(
        stu?.deleted === true ||
        stu?.isDeleted === true ||
        stu?.archived === true ||
        stu?.isArchived === true ||
        stu?.removed === true ||
        stu?.isRemoved === true ||
        stu?.active === false ||
        status === 'deleted' ||
        status === 'archived' ||
        status === 'removed' ||
        status === 'shifted'
      );
    };
    const isCompleteStudent = (stu) => {
      if (!stu || typeof stu !== 'object') return false;
      if (looksDeleted(stu)) return false;
      const sid = String(stu.schoolId || '').trim();
      if (sid && currentSchoolId && sid !== currentSchoolId) return false;
      const admission = String(stu.admissionNumber || '').trim();
      const first = String(stu.firstName || '').trim();
      const last = String(stu.lastName || '').trim();
      if (!admission || L(admission) === 'n/a' || L(admission) === 'na') return false;
      if (!first || L(first) === 'n/a' || L(first) === 'na') return false;
      if (!last || L(last) === 'n/a' || L(last) === 'na') return false;
      return Number.isFinite(getRegistrationYear(stu));
    };
    const belongsToSelectedYear = (stu, selectedYear) => {
      const regYear = getRegistrationYear(stu);
      if (!regYear || !Number.isFinite(selectedYear)) return false;
      return regYear >= SOMAP_DEFAULT_YEAR && regYear <= selectedYear;
    };
    const hasPaymentsForYear = (paymentsObj, yNum) => {
      if (!paymentsObj || typeof paymentsObj !== 'object') return false;
      return Object.values(paymentsObj).some((p) => {
        if (!p) return false;
        const ay = Number(p.academicYear ?? p.financeYear ?? p.year);
        if (Number.isFinite(ay) && ay === yNum) return true;
        const ts = Number(p.timestamp ?? p.datePaid ?? p.createdAt);
        if (Number.isFinite(ts)) {
          const dt = new Date(ts);
          if (!Number.isNaN(dt.getTime()) && dt.getFullYear() === yNum) return true;
        }
        return false;
      });
    };

    const ids = new Set([
      ...Object.keys(anchorEnrollments || {}),
      ...Object.keys(enrollments || {}),
      ...Object.keys(overrides || {}),
      ...Object.keys(ledgers || {}),
      ...Object.keys(carryForward || {}),
      ...Object.keys(studentFees || {}),
      ...Object.keys(baseStudents || {}),
    ]);

    const map = {};
    ids.forEach((id) => {
      const base = baseStudents[id] || {};
      const anchor = anchorEnrollments[id] || {};
      const enrollment = enrollments[id] || {};
      const override = overrides[id] || {};
      const ledgerEntry = ledgers[id] || {};
      const carry = carryForward[id] || {};
      const registrationYear = getRegistrationYear(base);

      if (!isCompleteStudent(base)) return;
      if (!belongsToSelectedYear(base, targetYearNum)) return;

      const hasTargetEnroll = isNonEmptyObj(enrollment);
      const carryAmount = Math.max(0, Number(carry.amount ?? carry.balance ?? 0));

      let studentFeeOverride = studentFees[id];
      if (!studentFeeOverride) {
        const admKey =
          base.admissionNumber || base.admissionNo ||
          anchor.admissionNumber || anchor.admissionNo ||
          enrollment.admissionNumber || enrollment.admissionNo || '';
        if (admKey && studentFees[admKey]) studentFeeOverride = studentFees[admKey];
      }

      const baseHasYearPayments = hasPaymentsForYear(base.payments, targetYearNum);

      let baseClass = '';
      if (hasTargetEnroll) {
        baseClass = enrollment.className || enrollment.classLevel || enrollment.class || '';
      } else {
        baseClass = base.classLevel || base.class || anchor.className || anchor.classLevel || anchor.class || '';
      }
      baseClass = normalizeClassLabel(baseClass);

      let delta = 0;
      if (!hasTargetEnroll && Number.isFinite(registrationYear) && Number.isFinite(targetYearNum)) {
        delta = targetYearNum - registrationYear;
      }
      const classLevel = shiftClassFn(baseClass, delta);
      const classDefaults = classFees[classLevel] || classFees[baseClass] || {};
      const resolvedPlanId = override.planId || classDefaults.defaultPlanId || null;
      const resolvedPlan = resolvedPlanId ? plans[resolvedPlanId] : null;
      const classDefaultPlanId = classDefaults.defaultPlanId || classDefaults.defaultPlan || '';
      const hasPlanOverride = Boolean(override.planId) &&
        (!classDefaultPlanId || String(override.planId) !== String(classDefaultPlanId));

      const isMonthlyPlan = resolvedPlan?.schedule && Array.isArray(resolvedPlan.schedule) &&
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
          paymentsSource = ledgerEntry.payments || ledgerEntry.entries || ledgerEntry.records;
        } else {
          paymentsSource = ledgerEntry;
        }
      } else if (ledgerEntry != null) {
        paymentsSource = ledgerEntry;
      }
      if (!Object.keys(paymentsSource || {}).length && base.payments) {
        const approvedFallback = {};
        Object.entries(base.payments).forEach(([key, entry]) => {
          if (!entry) return;
          const approvedMarker = Number(entry.approvedAt || entry.approved || 0);
          if (approvedMarker > 0) approvedFallback[key] = entry;
        });
        if (Object.keys(approvedFallback).length) paymentsSource = approvedFallback;
      }
      if (!Object.keys(paymentsSource || {}).length) {
        const fallbackEntries = approvalsByStudent[id] || [];
        if (fallbackEntries.length) {
          paymentsSource = {};
          fallbackEntries.forEach((entry, idx) => {
            const entryKey = entry.approvalId || `appr-${id}-${idx}`;
            paymentsSource[entryKey] = {
              amount: Number(entry.amount || 0),
              timestamp: Number(entry.timestamp || entry.approvedAt || Date.now()),
              method: entry.method || '',
              note: entry.note || '',
              referenceCode: entry.referenceCode || '',
              academicYear: Number(targetYear),
              approvedAt: Number(entry.approvedAt || entry.timestamp || Date.now()),
            };
          });
        }
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
        hasYearData: Boolean(
          isNonEmptyObj(enrollment) ||
          isNonEmptyObj(override) ||
          isNonEmptyObj(classDefaults) ||
          carryAmount > 0 ||
          effectiveFee > 0 ||
          Object.keys(payments || {}).length > 0 ||
          baseHasYearPayments
        ),
        isGraduated: classLevel === 'GRADUATED',
      };

      if (Array.isArray(override.customSchedule) && override.customSchedule.length) {
        record._customSchedule = override.customSchedule;
      } else if (resolvedPlan && Array.isArray(resolvedPlan.schedule)) {
        record._planSchedule = resolvedPlan.schedule;
      }
      if (classDefaults && classDefaults.installments && typeof classDefaults.installments === 'object') {
        record._classInstallments = classDefaults.installments;
      }

      record.previousDebt = 0;
      if (!record.firstName && enrollment.firstName) record.firstName = enrollment.firstName;
      if (!record.lastName && enrollment.lastName) record.lastName = enrollment.lastName;
      if (!record.middleName && enrollment.middleName) record.middleName = enrollment.middleName;
      if (override && Object.keys(override).length) record.override = override;
      record._hasPlanOverride = hasPlanOverride;
      record._classDefaults = classDefaults;
      map[id] = record;
    });

    return map;
  }

  async function loadApprovedFinanceApprovals(year){
    const y = normalizeYear(year);
    if (!approvalsCache[y]) {
      approvalsCache[y] = (async () => {
        const database = getDb();
        if (!database) return {};
        try {
          const snapshot = await database.ref(pref('approvalsHistory')).once('value');
          const tree = snapshot.val() || {};
          const grouped = {};
          const normalizedTargetYear = Number(y);
          Object.entries(tree).forEach(([_, months]) => {
            Object.entries(months || {}).forEach(([__, records]) => {
              Object.entries(records || {}).forEach(([key, record]) => {
                if (!record) return;
                const recordYear = Number(record.forYear ?? record.academicYear ?? record.year);
                if (!Number.isFinite(recordYear) || recordYear !== normalizedTargetYear) return;
                const finalStatus = String(record.finalStatus || record.status || '').toLowerCase();
                if (!['approved', 'completed'].includes(finalStatus)) return;
                const moduleSource = String(record.sourceModule || record.module || '').toLowerCase();
                if (!moduleSource.includes('finance')) return;
                const studentKey = record.studentId || record.modulePayload?.studentKey || record.studentAdm;
                if (!studentKey) return;
                const amount = Number(record.amountPaidNow ?? record.amount ?? record.paidAmount ?? 0);
                if (!(amount > 0)) return;
                const timestamp = Number(record.approvedAt || record.datePaid || record.createdAt || Date.now());
                if (!grouped[studentKey]) grouped[studentKey] = [];
                grouped[studentKey].push({
                  approvalId: key,
                  amount,
                  timestamp,
                  method: record.method || record.paymentMethod || record.modulePayload?.payment?.method || '',
                  note: record.note || record.modulePayload?.payment?.note || '',
                  referenceCode: record.referenceCode || record.paymentReferenceCode || record.modulePayload?.payment?.referenceCode || '',
                  academicYear: normalizedTargetYear,
                  approvedAt: timestamp,
                });
              });
            });
          });
          return grouped;
        } catch (err) {
          console.warn('SomapFinance: approvals history read failed', err?.message || err);
          return {};
        }
      })();
    }
    return approvalsCache[y];
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
          carrySnap,
          studentPlansSnap,
          financePlansSnap
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
          database.ref(pref(`finance/${y}/studentPlans`)).once('value'),
          database.ref(pref(`finance/${y}/plans`)).once('value'),
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
        const studentPlansRaw = studentPlansSnap.val() || {};
        const financePlansRaw = financePlansSnap.val() || {};
        const mergedOverrides = { ...(dataset.overrides || {}) };
        Object.keys(studentPlansRaw || {}).forEach((sid) => {
          const sp = studentPlansRaw[sid];
          if (sp && (sp.planId || sp.id)) {
            mergedOverrides[sid] = { ...(mergedOverrides[sid] || {}), planId: sp.planId || sp.id };
          }
        });
        const mergedPlans = { ...(dataset.plans || {}), ...(financePlansRaw || {}) };
        const approvalsByStudent = await loadApprovedFinanceApprovals(y);
        dataset.students = buildFinanceStudents(
          dataset.baseStudents,
          dataset.anchorEnrollments,
          dataset.yearEnrollments,
          dataset.classFees,
          mergedOverrides,
          mergedPlans,
          dataset.ledgers,
          dataset.carryForward,
          dataset.studentFees,
          approvalsByStudent,
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

  async function getFinanceRoster(year, options = {}){
    const summary = await ensureYearSummary(year);
    const includeGraduated = Boolean(options.includeGraduated);
    const classFilter = String(options.className || options.classLevel || '').trim().toLowerCase();
    const rows = Object.entries(summary.entries || {}).map(([id, entry]) => {
      const student = entry?.student || {};
      const finance = entry?.finance || {};
      const fullName = `${student.firstName || ''} ${student.middleName || ''} ${student.lastName || ''}`
        .replace(/\s+/g, ' ')
        .trim() || student.admissionNumber || id;
      return {
        id,
        studentId: id,
        admissionNumber: String(student.admissionNumber || student.admissionNo || id || '').trim(),
        fullName,
        classLevel: student.classLevel || student.className || '',
        className: student.classLevel || student.className || '',
        gender: String(student.gender || student.sex || student.meta?.gender || '').trim(),
        status: String(student.status || 'active').trim().toLowerCase() || 'active',
        fee: Math.max(0, Number(finance.feePerYear ?? entry?.due ?? student.feePerYear ?? 0) || 0),
        paid: Math.max(0, Number(finance.paidAmount ?? entry?.paid ?? 0) || 0),
        balance: Math.max(0, Number(finance.balance ?? entry?.outstanding ?? 0) || 0),
        paymentPlan: student.paymentPlan || '',
        carryForward: Math.max(0, Number(student.carryAmount || 0) || 0),
        parentContact: String(student.primaryParentContact || student.parentPhone || student.guardianPhone || student.contact || '').trim(),
        isGraduated: Boolean(student.isGraduated),
        rawStudent: student,
        finance,
      };
    });
    return rows.filter((row) => {
      if (!includeGraduated && row.isGraduated) return false;
      if (classFilter && String(row.classLevel || '').trim().toLowerCase() !== classFilter) return false;
      return true;
    });
  }

  async function getYearFinanceEntries(year){
    const summary = await ensureYearSummary(year);
    return summary.entries || {};
  }

  function clearCaches(){
    Object.keys(datasetCache).forEach((k) => delete datasetCache[k]);
    Object.keys(summaryCache).forEach((k) => delete summaryCache[k]);
    Object.keys(expensesCache).forEach((k) => delete expensesCache[k]);
    Object.keys(approvalsCache).forEach((k) => delete approvalsCache[k]);
  }

  const api = {
    loadStudentFinance,
    loadStudentFinanceAtCutoff,
    loadSchoolTotals,
    loadExpensesTotal,
    listRecentPayments,
    installmentCompare,
    getYearStudents,
    getFinanceRoster,
    getYearFinanceEntries,
    getBalanceForYearAdmission,
    getStudentBaseFee,
    resolveCarryForwardState,
    buildEffectiveFinanceStudent,
    buildSchedule,
    buildBreakdownFromSummary,
    computeDebtStateFromSummary,
    ensureScheduleCarryComponent,
    getDebtDisplayState,
    computeStudentFinancials,
    _clearFinanceCaches: clearCaches
  };

  global.SomapFinance = Object.assign(global.SomapFinance || {}, api);
})(typeof window !== 'undefined' ? window : globalThis);
