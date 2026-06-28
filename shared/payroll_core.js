(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.SomapPayrollCore = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const EARNING_KEYS = [
    'basicSalary', 'responsibilityAllowance', 'transportAllowance',
    'housingAllowance', 'overtime', 'bonus', 'arrears', 'otherEarnings'
  ];
  const DEDUCTION_KEYS = [
    'paye', 'nssfEmployee', 'salaryAdvance', 'loanDeduction',
    'responsibilityAllowanceDeduction', 'lateAbsenceDeduction', 'otherDeduction'
  ];
  const RESPONSIBILITY_ALLOWANCE = 50000;

  function money(value) {
    const n = Number(String(value ?? 0).replace(/,/g, '').trim());
    return Number.isFinite(n) && n > 0 ? Math.round(n) : 0;
  }

  function cleanText(value) {
    return String(value ?? '').replace(/\s+/g, ' ').trim();
  }

  function calculate(item) {
    const earnings = {};
    const deductions = {};
    EARNING_KEYS.forEach((key) => { earnings[key] = money(item?.earnings?.[key] ?? item?.[key]); });
    DEDUCTION_KEYS.forEach((key) => { deductions[key] = money(item?.deductions?.[key] ?? item?.[key]); });
    deductions.responsibilityAllowanceDeduction = Math.min(
      earnings.responsibilityAllowance,
      deductions.responsibilityAllowanceDeduction
    );
    const grossPay = EARNING_KEYS.reduce((sum, key) => sum + earnings[key], 0);
    const totalDeductions = DEDUCTION_KEYS.reduce((sum, key) => sum + deductions[key], 0);
    const netPay = Math.max(0, grossPay - totalDeductions);
    const employer = {
      nssfEmployer: money(item?.employer?.nssfEmployer ?? item?.nssfEmployer),
      wcfEmployer: money(item?.employer?.wcfEmployer ?? item?.wcfEmployer),
      otherEmployerCost: money(item?.employer?.otherEmployerCost ?? item?.otherEmployerCost)
    };
    const totalEmployerContributions = Object.values(employer).reduce((sum, value) => sum + value, 0);
    return {
      earnings, deductions, employer, grossPay, totalDeductions, netPay,
      originalResponsibilityAllowance: earnings.responsibilityAllowance,
      responsibilityAllowanceDeduction: deductions.responsibilityAllowanceDeduction,
      remainingResponsibilityAllowance: Math.max(0, earnings.responsibilityAllowance - deductions.responsibilityAllowanceDeduction),
      totalEmployerContributions,
      totalEmployerCost: grossPay + totalEmployerContributions
    };
  }

  function responsibilityLateDeduction(lateCount) {
    const count = Math.max(0, Math.floor(Number(lateCount) || 0));
    if (count <= 3) return 0;
    return 1000 + ((count - 4) * 500);
  }

  function responsibilitySummary(events, allowance = RESPONSIBILITY_ALLOWANCE) {
    const rows = Array.isArray(events) ? events : Object.values(events || {});
    const active = rows.filter(event => {
      const status = cleanText(event?.reviewStatus).toLowerCase();
      return !['cancelled', 'dismissed'].includes(status);
    });
    const lateEvents = active.filter(event => event?.eventType === 'late');
    const noSignInEvents = active.filter(event => event?.eventType === 'no_sign_in');
    const manualEvents = active.filter(event => event?.eventType === 'manual_adjustment');
    const protectedEvents = active.filter(event => event?.eventType === 'approved_permission').map(event => ({
      date: cleanText(event.date),
      eventType: cleanText(event.originalEventType || 'attendance'),
      permissionId: cleanText(event.permissionId),
      reason: cleanText(event.permissionReason || event.reason),
      deductionAmount: 0
    }));
    const lateCount = lateEvents.length;
    const lateDeduction = lateEvents.some(event => event?.deductionOverride != null)
      ? lateEvents.reduce((sum, event) => sum + money(event.deductionOverride ?? event.deductionAmount), 0)
      : responsibilityLateDeduction(lateCount);
    const noSignInDeduction = noSignInEvents.reduce((sum, event) => sum + money(event.deductionOverride ?? event.deductionAmount ?? 2000), 0);
    const otherResponsibilityDeductions = manualEvents.reduce((sum, event) => sum + money(event.deductionOverride ?? event.deductionAmount), 0);
    const uncappedDeduction = lateDeduction + noSignInDeduction + otherResponsibilityDeductions;
    const originalAllowance = money(allowance) || RESPONSIBILITY_ALLOWANCE;
    const totalResponsibilityDeduction = Math.min(originalAllowance, uncappedDeduction);
    const disputed = active.some(event => event?.workerRejected === true || cleanText(event?.reviewStatus).toLowerCase() === 'pending_review');
    return {
      allowance: originalAllowance,
      lateCount,
      lateWarnings: Math.min(3, lateCount),
      noSignInCount: noSignInEvents.length,
      lateDeduction,
      noSignInDeduction,
      otherResponsibilityDeductions,
      uncappedDeduction,
      totalResponsibilityDeduction,
      remainingResponsibilityAllowance: Math.max(0, originalAllowance - totalResponsibilityDeduction),
      capped: uncappedDeduction > originalAllowance,
      finalReviewRequired: uncappedDeduction >= originalAllowance,
      protectedEvents,
      status: disputed ? 'pending_review' : totalResponsibilityDeduction > 0 ? 'deducted' : lateCount > 0 ? 'warning_only' : 'intact'
    };
  }

  function splitInclusiveSalary(totalSalary, allowance = RESPONSIBILITY_ALLOWANCE, explicitBasicSalary) {
    const total = money(totalSalary);
    const special = Math.min(money(allowance) || RESPONSIBILITY_ALLOWANCE, total);
    const explicit = explicitBasicSalary == null ? null : money(explicitBasicSalary);
    return {
      basicSalary: explicit == null ? Math.max(0, total - special) : explicit,
      responsibilityAllowance: special
    };
  }

  function monthKey(value) {
    const raw = cleanText(value).replace(/-/g, '');
    return /^\d{6}$/.test(raw) && Number(raw.slice(4)) >= 1 && Number(raw.slice(4)) <= 12 ? raw : '';
  }

  function monthLabel(value, locale = 'en-US') {
    const key = monthKey(value);
    if (!key) return '';
    return new Intl.DateTimeFormat(locale, { month: 'long', year: 'numeric', timeZone: 'UTC' })
      .format(new Date(Date.UTC(Number(key.slice(0, 4)), Number(key.slice(4)) - 1, 1)));
  }

  function previousMonth(date = new Date()) {
    const d = new Date(date.getFullYear(), date.getMonth() - 1, 1);
    return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}`;
  }

  function maskAccount(value) {
    const account = cleanText(value);
    if (!account) return 'Not provided';
    if (account.length <= 4) return account;
    return `${'•'.repeat(Math.min(8, account.length - 4))}${account.slice(-4)}`;
  }

  function numberToWords(value) {
    const n = money(value);
    if (n === 0) return 'Zero Tanzanian shillings only';
    const ones = ['', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten',
      'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen'];
    const tens = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'];
    function underThousand(x) {
      const words = [];
      if (x >= 100) { words.push(`${ones[Math.floor(x / 100)]} hundred`); x %= 100; }
      if (x >= 20) { words.push(tens[Math.floor(x / 10)]); if (x % 10) words.push(ones[x % 10]); }
      else if (x) words.push(ones[x]);
      return words.join(' ');
    }
    const groups = [[1e9, 'billion'], [1e6, 'million'], [1e3, 'thousand']];
    let remaining = n;
    const out = [];
    groups.forEach(([size, label]) => {
      if (remaining >= size) {
        out.push(`${underThousand(Math.floor(remaining / size))} ${label}`);
        remaining %= size;
      }
    });
    if (remaining) out.push(underThousand(remaining));
    const words = out.join(' ');
    return `${words.charAt(0).toUpperCase()}${words.slice(1)} Tanzanian shillings only`;
  }

  function nmbRow(item, ownReference) {
    const name = cleanText(item?.accountName || item?.staffName || item?.fullName).toUpperCase();
    const account = cleanText(item?.bankAccountNumber).replace(/\s+/g, '');
    const bank = cleanText(item?.bankName || item?.paymentMethod).toUpperCase();
    const net = money(item?.netPay ?? item?.net ?? item?.bankPaymentAmount ?? item?.paymentAmount);
    if (!name) return { skipped: true, reason: 'Missing beneficiary name' };
    if (bank !== 'NMB') return { skipped: true, reason: bank ? 'Payment account is not NMB' : 'Payment method is missing' };
    if (!account) return { skipped: true, reason: 'Missing bank account number' };
    if (!net) return { skipped: true, reason: 'Net pay is zero' };
    return {
      skipped: false,
      row: {
        'BENEFICIARY NAME': name,
        AMOUNT: net,
        'BENEFICIARY-ACCOUNT': account,
        'PAYMENT TYPE': 'INTERNAL',
        DESTINATION: 'NMB',
        NARRATION: 'SALARY',
        'OWN REFERENCE': cleanText(ownReference).toUpperCase()
      }
    };
  }

  function attendanceGateDecision(date, slip) {
    const day = date instanceof Date && !Number.isNaN(date.getTime()) ? date.getDate() : new Date(date).getDate();
    const status = cleanText(slip?.paymentStatus || slip?.status).toLowerCase();
    const paid = ['paid', 'published', 'accepted', 'disputed', 'closed'].includes(status);
    const acknowledgement = slip?.acknowledgement || slip || {};
    const acknowledged = acknowledgement.accepted === true || acknowledgement.downloaded === true || acknowledgement.disputed === true;
    if (!slip || !paid) return { allowed: true, reason: 'NO_PAID_SLIP' };
    if (acknowledged) return { allowed: true, reason: 'ACKNOWLEDGED' };
    if (day < 4) return { allowed: true, reminderOnly: true, reason: 'REMINDER' };
    return { allowed: false, reason: 'SALARY_ACK_REQUIRED' };
  }

  return {
    EARNING_KEYS, DEDUCTION_KEYS, RESPONSIBILITY_ALLOWANCE, money, cleanText, calculate, monthKey,
    monthLabel, previousMonth, maskAccount, numberToWords, nmbRow,
    attendanceGateDecision, responsibilityLateDeduction, responsibilitySummary,
    splitInclusiveSalary
  };
});
