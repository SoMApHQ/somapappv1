/**
 * shared/shift_settlement.js
 * Fair debt of a shifted learner, worked out up to the day they shifted.
 *
 * Rules (all schools, years >= 2026; earlier years are never recalculated):
 *  1. January rule: a learner shifted in January of year Y (or before Y started) never
 *     studied in Y. Y's school fee and Y's transport are NOT charged. Debt from Y-1
 *     (carry forward or the unpaid Y-1 balance) is kept unchanged.
 *  2. Otherwise the learner owes every instalment of Y whose window had opened by the
 *     shift date (class plan, special plan or per-student override/custom schedule, the
 *     same schedule finance.html builds). Monthly plans count the shift month.
 *  3. Payments for Y clear carry forward first, then the instalments due by the shift date;
 *     anything above that is credit.
 *  4. Transport: months up to and including the shift month (rule 1 => none), less approved
 *     transport payments, using the same engine as transportpayments.html.
 *  Previous-year debt is counted only when finance carried it forward into Y
 *  (financeCarryForward/Y); the Y-1 books themselves are never touched or re-read by default,
 *  because late-registered learners (Oct-Dec for January) show phantom full-year Y-1 balances.
 *  Total debt = school-fee debt (incl. carried previous-year debt) + transport debt.
 *
 * Read-only: this file never writes. Callers decide what to save.
 */
(function (global) {
  'use strict';

  const RULE_FROM_YEAR = 2026;
  const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
  const round = (v) => Math.round(num(v));

  function parseISODate(value) {
    const s = String(value || '').trim();
    const m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
    if (m) return { y: Number(m[1]), m: Number(m[2]), d: Number(m[3]), iso: `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}` };
    const ts = Date.parse(s);
    if (!Number.isFinite(ts)) return null;
    const dt = new Date(ts);
    const y = dt.getFullYear(); const mo = dt.getMonth() + 1; const d = dt.getDate();
    return { y, m: mo, d, iso: `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}` };
  }

  /** True when the learner shifted in January of `year` (or before it began): never studied that year. */
  function isJanuaryShift(year, shiftDateISO) {
    const p = parseISODate(shiftDateISO);
    const y = Number(year);
    if (!p || !Number.isFinite(y)) return false;
    if (p.y < y) return true;
    return p.y === y && p.m === 1;
  }

  function cleanStudent(snapshot) {
    const out = { ...(snapshot || {}) };
    ['status', 'shiftedAt', 'shiftedYear', 'shifted', 'isShifted'].forEach((k) => { delete out[k]; });
    out.status = 'active';
    return out;
  }

  /** Build the learner's finance record for `year` even though they are marked shifted. */
  async function buildRecord(year, studentId, snapshot) {
    const F = global.SomapFinance;
    if (!F?.getYearDataset || !F?.buildFinanceStudentsForCompliance) throw new Error('SomapFinance not loaded');
    const ds = await F.getYearDataset(year);
    const live = ds.baseStudents?.[studentId] || {};
    const base = cleanStudent({ ...(snapshot || {}), ...live });
    const built = F.buildFinanceStudentsForCompliance(
      { [studentId]: base },
      ds.anchorEnrollments, ds.yearEnrollments, ds.classFees, ds.mergedOverrides, ds.mergedPlans,
      ds.ledgers, ds.carryForward, ds.studentFees, ds.approvalsByStudent || {}, String(year)
    );
    return built?.[studentId] || null;
  }

  function sumPayments(rec) {
    return Object.values(rec?.payments || {}).reduce((s, p) => s + Math.max(0, round(p?.amount)), 0);
  }

  /** Full-year outstanding of the year before the shift year (kept unchanged by every rule). */
  async function previousYearDebt(year, studentId, snapshot) {
    const py = Number(year) - 1;
    try {
      const rec = await buildRecord(py, studentId, snapshot);
      if (!rec || rec.isGraduated || !rec.hasYearData) return { year: py, due: 0, paid: 0, outstanding: 0, found: false };
      const fin = global.SomapFinance.computeStudentFinancials(rec, String(py));
      const due = round(fin.feePerYear);
      const paid = round(fin.paidAmount);
      return { year: py, due, paid, outstanding: Math.max(0, due - paid), found: true, classLevel: rec.classLevel || '' };
    } catch (err) {
      return { year: py, due: 0, paid: 0, outstanding: 0, found: false, error: err?.message || String(err) };
    }
  }

  async function schoolFeeAtShift({ year, studentId, shiftDateISO, snapshot, includePreviousYear = false }) {
    const y = Number(year);
    const rec = await buildRecord(y, studentId, snapshot);
    if (!rec) return { ok: false, reason: 'No finance record could be built for this learner.' };
    const F = global.SomapFinance;
    const carry = Math.max(0, round(rec.carryAmount));
    const baseFee = Math.max(0, round(rec.baseFee ?? (num(rec.feePerYear) - carry)));
    const paidYear = sumPayments(rec);
    const january = isJanuaryShift(y, shiftDateISO);

    // Schedule without carry so instalment amounts are the plain year fee.
    const plain = { ...rec, carryAmount: 0, feePerYear: baseFee };
    const fin = F.computeStudentFinancials(plain, String(y));
    const p = parseISODate(shiftDateISO);
    const cutoffTs = p ? new Date(p.y, p.m - 1, p.d, 23, 59, 59, 999).getTime() : Date.now();
    const schedule = (fin.scheduleItems || []).map((it) => {
      const fromTS = num(it.originalFromTS || it.fromTS);
      const dueByShift = !january && fromTS > 0 && fromTS <= cutoffTs;
      return {
        label: it.label || '',
        fromTS,
        toTS: num(it.originalToTS || it.toTS),
        amount: Math.max(0, round(it.amount)),
        dueByShift,
      };
    });
    let yearDueAtShift = schedule.filter((r) => r.dueByShift).reduce((s, r) => s + r.amount, 0);
    // Year-end rule: once 10 Oct has passed, the whole year fee is due.
    if (!january && p && y >= RULE_FROM_YEAR && cutoffTs > new Date(y, 9, 10, 23, 59, 59, 999).getTime()) yearDueAtShift = baseFee;
    yearDueAtShift = Math.min(yearDueAtShift, baseFee);

    const toCarry = Math.min(carry, paidYear);
    const carryOutstanding = carry - toCarry;
    const remaining = paidYear - toCarry;
    const yearOutstanding = Math.max(0, yearDueAtShift - remaining);
    const credit = Math.max(0, remaining - yearDueAtShift);

    let previous = { year: y - 1, due: 0, paid: 0, outstanding: 0, found: false, viaCarry: carry > 0 };
    if (includePreviousYear && carry <= 0) previous = { ...(await previousYearDebt(y, studentId, snapshot)), viaCarry: false };
    const previousYearOutstanding = carry > 0 ? carryOutstanding : previous.outstanding;

    return {
      ok: true,
      year: y,
      shiftDate: p?.iso || String(shiftDateISO || ''),
      rule: january ? 'january-no-fee' : 'due-by-shift-date',
      januaryRule: january,
      classLevel: rec.classLevel || '',
      paymentPlan: rec.paymentPlan || '',
      feePerYear: baseFee,
      schedule,
      yearDueAtShift,
      paidYear,
      carryForward: carry,
      carryOutstanding,
      previousYear: previous,
      previousYearOutstanding,
      yearOutstanding,
      credit,
      schoolDebt: yearOutstanding + previousYearOutstanding,
      // January shift but money was paid for Y: the office should review (refund or real attendance).
      needsReview: january && paidYear > 0,
    };
  }

  // ---- transport ----
  const engineCache = {};
  function transportEngine(year) {
    const E = global.TransportDebtEngine;
    const db = global.db || (global.firebase?.database ? global.firebase.database() : null);
    const schoolId = global.SOMAP?.getSchoolId?.() || global.SOMAP?.getSchool?.()?.id || global.currentSchoolId || 'socrates-school';
    if (!E?.load || !db) return null;
    const key = `${schoolId}::${year}`;
    if (!engineCache[key]) engineCache[key] = E.load({ db, schoolId, year: Number(year) }).catch((err) => { delete engineCache[key]; throw err; });
    return engineCache[key];
  }

  async function transportAtShift({ year, studentId, admissionNo, shiftDateISO }) {
    const empty = { used: false, months: [], dueToShift: 0, paid: 0, debt: 0 };
    let engine;
    try { engine = await transportEngine(year); } catch (err) { return { ...empty, error: err?.message || String(err) }; }
    if (!engine) return { ...empty, unavailable: true };
    const ids = [studentId, admissionNo].filter(Boolean);
    let status = null;
    for (const id of ids) {
      if (!engine.enrollments?.[id]) continue;
      try { status = await engine.statusFor(id); } catch (_) { status = null; }
      if (status) break;
    }
    if (!status) return empty;
    const p = parseISODate(shiftDateISO);
    const january = isJanuaryShift(year, shiftDateISO);
    const lastMonth = january ? 0 : (p && p.y === Number(year) ? p.m : 12);
    const months = (status.months || []).map((m) => ({ ...m, counted: m.month <= lastMonth }));
    const dueToShift = months.filter((m) => m.counted).reduce((s, m) => s + num(m.due), 0);
    const paid = num(status.approvedPaid);
    const enr = status.enrollment || {};
    return {
      used: true,
      januaryRule: january,
      stop: [enr.amStop, enr.pmStop].filter(Boolean).join(' / '),
      drivers: status.drivers || {},
      months,
      dueToShift: round(dueToShift),
      paid: round(paid),
      debt: Math.max(0, round(dueToShift - paid)),
      credit: Math.max(0, round(paid - dueToShift)),
    };
  }

  /**
   * Full settlement for one shifted learner.
   * @param {object} opts { year, studentId, admissionNo, shiftDateISO, snapshot, includeTransport }
   */
  async function compute(opts = {}) {
    const year = Number(opts.year);
    if (!Number.isFinite(year) || year < RULE_FROM_YEAR) {
      return { ok: false, skipped: true, reason: `Shift-debt rules apply from ${RULE_FROM_YEAR}; earlier years keep their recorded debt.` };
    }
    const school = await schoolFeeAtShift(opts);
    if (!school.ok) return school;
    const transport = opts.includeTransport === false
      ? { used: false, months: [], dueToShift: 0, paid: 0, debt: 0, skipped: true }
      : await transportAtShift(opts);
    return { ...school, transport, totalDebt: school.schoolDebt + num(transport.debt) };
  }

  global.SomapShiftSettlement = { compute, schoolFeeAtShift, transportAtShift, isJanuaryShift, RULE_FROM_YEAR };
})(typeof window !== 'undefined' ? window : globalThis);
