/**
 * shared/finance_discrepancies.js
 * Finance discrepancies ("illogicalities"): figures that cannot both be right, e.g. a fee of
 * 60,000 with 480,000 already paid, or a 2-instalment plan worth 680,000 on a 340,000 fee.
 * Detection is read-only. Fixes happen in paymentedits.html (Per-Student Override), which
 * already queues every change to approvals.html. "Keep as is" only records who reviewed a
 * flag and why; it never changes fees, plans or payments, and it reopens automatically
 * when the student's figures change.
 */
(function (global) {
  'use strict';

  const TOLERANCE = 1000;          // ignore shilling-level rounding
  const FEE_LOW_RATIO = 0.7;       // fee under 70% of the class fee
  const FEE_HIGH_RATIO = 1.3;      // fee over 130% of the class fee
  const PLAN_GAP_RATIO = 0.05;     // plan total differs from fee by more than 5%

  const RULES = {
    PAID_OVER_FEE: { title: 'Paid more than the fee', severity: 'high' },
    FEE_ZERO: { title: 'No fee for an active student', severity: 'high' },
    FEE_BELOW_CLASS: { title: 'Fee far below the class fee', severity: 'high' },
    FEE_ABOVE_CLASS: { title: 'Fee far above the class fee', severity: 'medium' },
    PLAN_TOTAL_MISMATCH: { title: 'Plan total does not match the fee', severity: 'high' },
  };

  const FEE_SOURCE_LABEL = {
    'student-fee-override': 'per-student fee override',
    'plan-override': 'per-student override',
    'class-default': 'class default fee',
    'student-record': 'student registration record',
  };

  const money = (n) => (Math.round(Number(n) || 0)).toLocaleString('en-US');
  const num = (n) => Math.max(0, Math.round(Number(n) || 0));

  function planRowsTotal(student) {
    const rows = Array.isArray(student?._customSchedule) && student._customSchedule.length
      ? student._customSchedule
      : (Array.isArray(student?._planSchedule) ? student._planSchedule : []);
    return rows.reduce((sum, row) => sum + num(row?.amount), 0);
  }

  // Returns [{ code, title, severity, detail }] for one student.
  function detect(student, fin) {
    if (!student || !fin || student.isGraduated) return [];
    const issues = [];
    // Plain sentences with real figures (no percentages): shown on screen and printed in the PDF.
    const add = (code, detail) => issues.push({ code, title: RULES[code].title, severity: RULES[code].severity, detail, short: detail });
    const fee = num(fin.feePerYear);
    const paid = num(fin.paidAmount);
    const carry = num(student.carryAmount);
    const baseFee = num(student.baseFee ?? (fee - carry));
    const classFee = num(student._classDefaults?.feePerYear);
    const cls = student.classLevel || 'this class';
    const source = FEE_SOURCE_LABEL[student._feeSource] || 'fee settings';

    if (fee === 0 && (classFee > 0 || paid > 0)) {
      add('FEE_ZERO', `Fee is 0${classFee ? `, but the ${cls} fee is ${money(classFee)}` : ''}${paid ? `. Already paid ${money(paid)}` : ''}. Typed in the ${source}.`);
    }
    if (fee > 0 && paid > fee + TOLERANCE) {
      add('PAID_OVER_FEE', `Paid ${money(paid)} but the fee is only ${money(fee)}: ${money(paid - fee)} more than the fee. The fee was probably typed too low (${source}).`);
    }
    if (classFee > 0 && baseFee > 0 && baseFee < classFee * FEE_LOW_RATIO) {
      add('FEE_BELOW_CLASS', `Fee is ${money(baseFee)} but the ${cls} fee is ${money(classFee)}: ${money(classFee - baseFee)} less. Typed in the ${source}.`);
    }
    if (classFee > 0 && baseFee > classFee * FEE_HIGH_RATIO) {
      add('FEE_ABOVE_CLASS', `Fee is ${money(baseFee)} but the ${cls} fee is ${money(classFee)}: ${money(baseFee - classFee)} more. Typed in the ${source}.`);
    }
    const hasOwnPlan = Boolean(student._hasPlanOverride) || (Array.isArray(student._customSchedule) && student._customSchedule.length > 0);
    const planTotal = hasOwnPlan ? planRowsTotal(student) : 0;
    if (planTotal > 0 && baseFee > 0 && Math.abs(planTotal - baseFee) > Math.max(TOLERANCE, baseFee * PLAN_GAP_RATIO)) {
      const plan = student.paymentPlan || 'the plan';
      add('PLAN_TOTAL_MISMATCH', planTotal < baseFee
        ? `Plan "${plan}" adds up to ${money(planTotal)} but the fee is ${money(baseFee)}: ${money(baseFee - planTotal)} has no instalment (now due by 10 Oct).`
        : `Plan "${plan}" adds up to ${money(planTotal)} but the fee is only ${money(baseFee)}. Either the plan or the fee is wrong.`);
    }
    return issues;
  }

  // Fingerprint of the figures a reviewer saw; a changed fingerprint reopens a kept flag.
  function signature(student, fin) {
    return [num(fin?.feePerYear), num(fin?.paidAmount), String(student?.paymentPlan || ''), String(student?.classLevel || '')].join('|');
  }

  // One-line meaning of each rule, printed once as a legend in the PDF.
  const LEGEND = {
    PAID_OVER_FEE: 'Paid is higher than the fee per year. Nobody pays more than they owe, so the fee was probably typed too low.',
    FEE_ZERO: 'An active student has no fee per year at all.',
    FEE_BELOW_CLASS: 'Fee per year is much lower than the fee of the class. Check the per-student fee override.',
    FEE_ABOVE_CLASS: 'Fee per year is much higher than the fee of the class. Check the per-student fee override.',
    PLAN_TOTAL_MISMATCH: "The student's own plan or custom schedule adds up to a different amount than the fee per year.",
  };

  global.SomapFinanceDiscrepancies = Object.assign(global.SomapFinanceDiscrepancies || {}, {
    RULES, LEGEND, FEE_SOURCE_LABEL, detect, signature, planRowsTotal,
  });
})(typeof window !== 'undefined' ? window : globalThis);
