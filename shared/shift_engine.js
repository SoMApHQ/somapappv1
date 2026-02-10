(function (global) {
  'use strict';

  function getDb() {
    if (global.db && typeof global.db.ref === 'function') return global.db;
    if (global.firebase?.database) {
      try { return global.firebase.database(); } catch (_) {}
    }
    return null;
  }

  function getYear() {
    return String(global.somapYearContext?.getSelectedYear?.() || new Date().getFullYear());
  }

  function schoolRef(path) {
    const db = getDb();
    if (!db) throw new Error('Firebase database not initialized');
    if (!global.SOMAP?.P) throw new Error('SOMAP.P is not available');
    return db.ref(global.SOMAP.P(String(path || '').replace(/^\/+/, '')));
  }

  function normalizeStatus(v) {
    return String(v || '').trim().toLowerCase();
  }

  function num(v) {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
  }

  async function getShiftReport(year, studentId) {
    const y = String(year || getYear());
    const scopedSnap = await schoolRef(`years/${y}/shiftReports/${studentId}`).get();
    if (scopedSnap.exists()) return { report: scopedSnap.val() || {}, reportYear: y, legacy: false };

    const legacySnap = await schoolRef(`shiftReports/${studentId}`).get();
    if (legacySnap.exists()) return { report: legacySnap.val() || {}, reportYear: y, legacy: true };

    return { report: null, reportYear: y, legacy: false };
  }

  async function computeCutoffFinance(year, studentId, shiftDateISO) {
    const y = String(year || getYear());
    const cutoff = String(shiftDateISO || '').trim();
    const financeApi = global.SomapFinance || {};
    if (typeof financeApi.loadStudentFinanceAtCutoff === 'function') {
      const atCutoff = await financeApi.loadStudentFinanceAtCutoff(y, studentId, cutoff, { mode: 'from' });
      return {
        expectedDueAtShift: num(atCutoff.expectedDueAtCutoff ?? atCutoff.expectedDueAtShift ?? atCutoff.due),
        paidAtShift: num(atCutoff.paidAtCutoff ?? atCutoff.paidAtShift ?? atCutoff.paid),
        outstandingBalance: num(atCutoff.outstandingAtCutoff ?? atCutoff.outstandingAtShift ?? atCutoff.outstanding),
        creditAtShift: num(atCutoff.creditAtCutoff ?? atCutoff.creditAtShift ?? 0)
      };
    }

    if (typeof financeApi.loadStudentFinance === 'function') {
      const base = await financeApi.loadStudentFinance(y, studentId);
      return {
        expectedDueAtShift: num(base.due),
        paidAtShift: num(base.paid),
        outstandingBalance: num(base.outstanding),
        creditAtShift: Math.max(0, num(base.paid) - num(base.due))
      };
    }

    return { expectedDueAtShift: 0, paidAtShift: 0, outstandingBalance: 0, creditAtShift: 0 };
  }

  async function approveShiftFromReport(year, studentId, options = {}) {
    const y = String(year || getYear());
    const sid = String(studentId || '').trim();
    if (!sid) throw new Error('studentId is required');

    const nowIso = new Date().toISOString();
    const approvedBy = String(options.approvedBy || 'admin').trim() || 'admin';

    const shiftedSnap = await schoolRef(`shiftedStudents/${sid}`).get();
    const shiftedExisting = shiftedSnap.exists() ? (shiftedSnap.val() || {}) : null;
    if (normalizeStatus(shiftedExisting?.status) === 'shifted') {
      return { ok: true, alreadyShifted: true, studentId: sid, year: y };
    }

    const { report, legacy } = await getShiftReport(y, sid);
    if (!report) throw new Error('No shift report found for this student');

    const studentSnap = await schoolRef(`students/${sid}`).get();
    const studentData = studentSnap.exists() ? (studentSnap.val() || {}) : {};
    if (!studentSnap.exists() && shiftedExisting) {
      return { ok: true, alreadyShifted: true, studentId: sid, year: y };
    }

    const shiftDateISO = String(report.dateShifted || options.shiftDateISO || nowIso.slice(0, 10)).trim();
    const admissionNo = String(
      studentData.admissionNumber ||
      studentData.admissionNo ||
      report.admissionNo ||
      sid
    ).trim();

    const className = String(
      report.className ||
      studentData.classLevel ||
      studentData.className ||
      studentData.class ||
      ''
    ).trim();

    const finance = await computeCutoffFinance(y, sid, shiftDateISO);
    const outstandingBalance = num(finance.outstandingBalance);
    const creditAtShift = num(finance.creditAtShift);
    const debtStatus = outstandingBalance > 0 ? 'not cleared' : 'cleared';

    const shiftedRecord = {
      status: 'shifted',
      studentId: sid,
      admissionNo,
      studentName: String(
        report.studentName ||
        [studentData.firstName, studentData.middleName, studentData.lastName].filter(Boolean).join(' ') ||
        studentData.name ||
        sid
      ).trim(),
      className,
      shiftYear: y,
      dateShifted: shiftDateISO,
      probableSchool: String(report.probableSchool || '').trim(),
      reason: String(report.reason || '').trim(),
      infoSource: String(report.infoSource || 'Class Teacher').trim(),
      parentName: String(report.parentName || studentData.primaryParentName || '').trim(),
      parentContact: String(report.parentContact || studentData.primaryParentContact || '').trim(),
      expectedDueAtShift: num(finance.expectedDueAtShift),
      paidAtShift: num(finance.paidAtShift),
      outstandingBalance,
      creditAtShift,
      debtStatus,
      approvedAt: nowIso,
      approvedBy,
      studentData: studentData || {}
    };
    const shiftReportRecord = {
      ...report,
      status: 'shifted',
      approvedAt: nowIso,
      approvedBy,
      shiftYear: y,
      dateShifted: shiftDateISO,
      expectedDueAtShift: shiftedRecord.expectedDueAtShift,
      paidAtShift: shiftedRecord.paidAtShift,
      outstandingBalance: shiftedRecord.outstandingBalance,
      creditAtShift: shiftedRecord.creditAtShift,
      debtStatus: shiftedRecord.debtStatus
    };

    const update = {};
    const set = (p, v) => { update[global.SOMAP.P(p)] = v; };

    set(`shiftedStudents/${sid}`, shiftedRecord);
    set(`students/${sid}/status`, 'shifted');
    set(`students/${sid}/shiftedAt`, shiftDateISO);
    set(`students/${sid}/shiftedYear`, y);

    set(`years/${y}/students/${sid}`, null);
    set(`years/${y}/enrollments/${sid}`, null);
    set(`enrollments/${y}/${sid}`, null);

    if (admissionNo) {
      set(`years/${y}/transportAssignments/${admissionNo}`, null);
      set(`years/${y}/transportEnrollments/${admissionNo}`, null);
      set(`years/${y}/transportRegistry/${admissionNo}`, null);
      set(`years/${y}/transportLedgers/${admissionNo}`, null);
    }
    set(`years/${y}/transportAssignments/${sid}`, null);
    set(`years/${y}/transportEnrollments/${sid}`, null);
    set(`years/${y}/transportRegistry/${sid}`, null);
    set(`years/${y}/transportLedgers/${sid}`, null);

    set(`years/${y}/shiftReports/${sid}`, shiftReportRecord);

    if (legacy) {
      set(`shiftReports/${sid}`, shiftReportRecord);
    }

    await getDb().ref().update(update);
    return { ok: true, alreadyShifted: false, studentId: sid, year: y, shiftedRecord };
  }

  global.SomapShift = Object.assign(global.SomapShift || {}, {
    approveShiftFromReport
  });
})(typeof window !== 'undefined' ? window : globalThis);
