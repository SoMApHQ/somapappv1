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

  function canonClass(name) {
    const low = String(name || '').trim().toLowerCase();
    if (!low) return '';
    if (low.includes('baby')) return 'baby';
    if (low.includes('middle')) return 'middle';
    if (low.includes('pre') || low.includes('unit') || low.includes('nursery')) return 'preunit';
    const m = low.match(/(\d+)/);
    if (m) return 'class' + parseInt(m[1], 10);
    return low.replace(/[^a-z0-9]/g, '');
  }

  const TRANSPORT_NODES = ['transportAssignments', 'transportEnrollments', 'transportRegistry', 'transportLedgers', 'transportPeriods'];

  async function readTransportSnapshot(y, ids) {
    const out = {};
    for (const node of TRANSPORT_NODES) {
      for (const id of ids) {
        try {
          const snap = await schoolRef(`years/${y}/${node}/${id}`).get();
          if (snap.exists()) { out[node] = out[node] || {}; out[node][id] = snap.val(); }
        } catch (_) {}
      }
    }
    return out;
  }

  async function computeCutoffFinance(year, studentId, shiftDateISO, snapshot, admissionNo) {
    const y = String(year || getYear());
    const cutoff = String(shiftDateISO || '').trim();
    const financeApi = global.SomapFinance || {};
    // 2026+: fair debt up to the shift date (January rule, instalments due, transport).
    const settle = global.SomapShiftSettlement;
    if (settle?.compute && Number(y) >= settle.RULE_FROM_YEAR) {
      const res = await settle.compute({ year: y, studentId, admissionNo, shiftDateISO: cutoff, snapshot });
      if (res && res.ok) {
        return {
          expectedDueAtShift: num(res.yearDueAtShift),
          paidAtShift: num(res.paidYear),
          outstandingBalance: num(res.schoolDebt),
          creditAtShift: num(res.credit),
          settlement: res
        };
      }
    }
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

    const finance = await computeCutoffFinance(y, sid, shiftDateISO, studentData, admissionNo);
    const settlement = finance.settlement || null;

    // A learner belongs to one class only. If the shift was reported from a class that is not
    // the learner's class for this year, it is a class mix-up: correct the class, do not shift.
    const reportedFrom = String(report.teacherClass || report.className || '').trim();
    const resolvedClass = String(settlement?.classLevel || '').trim();
    if (!options.allowClassMismatch && reportedFrom && resolvedClass && canonClass(reportedFrom) !== canonClass(resolvedClass)) {
      const err = new Error(`Class mix-up: this learner belongs to ${resolvedClass} in ${y}, but the shift was reported from ${reportedFrom}. A learner can only be in one class. Correct the class instead of shifting, unless the learner has truly left the school.`);
      err.code = 'CLASS_MISMATCH';
      err.resolvedClass = resolvedClass;
      err.reportedFrom = reportedFrom;
      throw err;
    }
    const finalClassName = resolvedClass || className;
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
      className: finalClassName,
      reportedFromClass: reportedFrom || '',
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
    if (settlement) {
      shiftedRecord.settlementRule = settlement.rule;
      shiftedRecord.feePerYearAtShift = num(settlement.feePerYear);
      if (settlement.classLevel) shiftedRecord.classResolvedAtShift = settlement.classLevel;
      shiftedRecord.schoolDebtAtShift = num(settlement.schoolDebt);
      shiftedRecord.transportDebtAtShift = num(settlement.transport?.debt);
      shiftedRecord.totalDebtAtShift = num(settlement.totalDebt);
      shiftedRecord.transportSummary = {
        used: Boolean(settlement.transport?.used),
        stop: settlement.transport?.stop || '',
        dueToShift: num(settlement.transport?.dueToShift),
        paid: num(settlement.transport?.paid),
        debt: num(settlement.transport?.debt),
        months: (settlement.transport?.months || []).map((m) => ({ month: m.month, due: num(m.due), paid: num(m.paid), counted: Boolean(m.counted) }))
      };
      shiftedRecord.settlementComputedAt = nowIso;
    }
    // The learner's transport records travel with the shifted file before route lists are cleared.
    const transportIds = Array.from(new Set([sid, admissionNo].filter(Boolean)));
    const transportData = await readTransportSnapshot(y, transportIds);
    if (Object.keys(transportData).length) shiftedRecord.transportData = transportData;

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
      debtStatus: shiftedRecord.debtStatus,
      totalDebtAtShift: shiftedRecord.totalDebtAtShift ?? shiftedRecord.outstandingBalance
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

    // Route lists are cleared (copies kept in shiftedRecord.transportData). Transport payment
    // ledgers are never deleted: they are the approved payment history.
    transportIds.forEach((id) => {
      set(`years/${y}/transportAssignments/${id}`, null);
      set(`years/${y}/transportEnrollments/${id}`, null);
      set(`years/${y}/transportRegistry/${id}`, null);
    });

    set(`years/${y}/shiftReports/${sid}`, shiftReportRecord);

    if (legacy) {
      set(`shiftReports/${sid}`, shiftReportRecord);
    }

    await getDb().ref().update(update);
    return { ok: true, alreadyShifted: false, studentId: sid, year: y, shiftedRecord };
  }

  const CLASS_ORDER = ['Baby Class', 'Middle Class', 'Pre Unit Class', 'Class 1', 'Class 2', 'Class 3', 'Class 4', 'Class 5', 'Class 6', 'Class 7'];

  /** Class the learner would be in during `year` had they stayed (shift class + 1 per year). */
  function expectedClassFor(className, shiftYear, year) {
    const idx = CLASS_ORDER.findIndex((c) => canonClass(c) === canonClass(className));
    if (idx < 0) return String(className || '');
    const delta = Number(year) - Number(shiftYear);
    const next = idx + (Number.isFinite(delta) ? delta : 0);
    if (next < 0) return CLASS_ORDER[0];
    if (next >= CLASS_ORDER.length) return 'GRADUATED';
    return CLASS_ORDER[next];
  }

  /**
   * Return a shifted learner to the active roll with the SAME record, payments and admission
   * number (never re-register). The class for the return year is written as that year's
   * enrollment, so the learner is in exactly one class.
   */
  async function returnShiftedStudent(studentId, options = {}) {
    const sid = String(studentId || '').trim();
    if (!sid) throw new Error('studentId is required');
    const y = String(options.year || getYear());
    const nowIso = new Date().toISOString();
    const by = String(options.returnedBy || 'staff').trim() || 'staff';
    const snap = await schoolRef(`shiftedStudents/${sid}`).get();
    if (!snap.exists()) throw new Error('This learner is not in the shifted list.');
    const rec = snap.val() || {};
    if (normalizeStatus(rec.status) === 'returned') return { ok: true, alreadyReturned: true, studentId: sid };
    const shiftYear = rec.shiftYear || String(rec.dateShifted || rec.shiftedAt || '').slice(0, 4) || y;
    const fromClass = rec.classResolvedAtShift || rec.className || rec.studentData?.classLevel || rec.classLevel || '';
    const toClass = String(options.className || expectedClassFor(fromClass, shiftYear, y)).trim();
    if (!toClass) throw new Error('The class to return the learner to is not known.');
    if (toClass === 'GRADUATED') throw new Error('By this year the learner would have completed the school, so they cannot be returned to a class.');

    const liveSnap = await schoolRef(`students/${sid}`).get();
    const live = liveSnap.exists() ? (liveSnap.val() || {}) : null;
    const update = {};
    const set = (p, v) => { update[global.SOMAP.P(p)] = v; };
    if (live) {
      set(`students/${sid}/status`, 'active');
      set(`students/${sid}/shiftedAt`, null);
      set(`students/${sid}/shiftedYear`, null);
      set(`students/${sid}/returnedFromShiftAt`, nowIso);
      set(`students/${sid}/returnedFromShiftBy`, by);
    } else {
      // Old admission-page shifts removed the learner and copied them onto the shifted record.
      let base = rec.studentData && Object.keys(rec.studentData).length ? { ...rec.studentData } : null;
      if (!base) {
        const { shiftReport, studentData, status, shiftedAt, outstandingBalance, returnHistory, ...rest } = rec;
        base = rest;
      }
      set(`students/${sid}`, { ...base, status: 'active', returnedFromShiftAt: nowIso, returnedFromShiftBy: by });
    }
    set(`enrollments/${y}/${sid}/className`, toClass);
    set(`enrollments/${y}/${sid}/classLevel`, toClass);
    set(`enrollments/${y}/${sid}/admissionNumber`, rec.admissionNo || live?.admissionNumber || rec.studentData?.admissionNumber || '');
    set(`enrollments/${y}/${sid}/returnedFromShiftAt`, nowIso);
    set(`shiftedStudents/${sid}/status`, 'returned');
    set(`shiftedStudents/${sid}/returnedAt`, nowIso);
    set(`shiftedStudents/${sid}/returnedBy`, by);
    set(`shiftedStudents/${sid}/returnedToClass`, toClass);
    set(`shiftedStudents/${sid}/returnedYear`, y);
    set(`shiftedStudents/${sid}/returnHistory/${Date.now()}`, { at: nowIso, by, toClass, year: y, note: String(options.note || '') });
    set(`years/${shiftYear}/shiftReports/${sid}/status`, 'returned');
    set(`years/${shiftYear}/shiftReports/${sid}/returnedAt`, nowIso);
    await getDb().ref().update(update);
    return {
      ok: true,
      studentId: sid,
      toClass,
      year: y,
      transportNote: rec.transportData || rec.transportSummary?.used
        ? 'If the learner will use school transport again, register them again in transport.html.'
        : ''
    };
  }

  function normName(v) {
    return String(v || '').toUpperCase().replace(/[^A-Z ]/g, ' ').replace(/\s+/g, ' ').trim();
  }
  function normPhone(v) {
    const d = String(v || '').replace(/\D/g, '');
    return d.length >= 9 ? d.slice(-9) : '';
  }
  // Optimal-string-alignment distance (typos incl. swapped letters).
  function editDistance(a, b) {
    const s = String(a || ''); const t = String(b || '');
    const d = Array.from({ length: s.length + 1 }, (_, i) => [i, ...Array(t.length).fill(0)]);
    for (let j = 1; j <= t.length; j += 1) d[0][j] = j;
    for (let i = 1; i <= s.length; i += 1) {
      for (let j = 1; j <= t.length; j += 1) {
        const cost = s[i - 1] === t[j - 1] ? 0 : 1;
        d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
        if (i > 1 && j > 1 && s[i - 1] === t[j - 2] && s[i - 2] === t[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
      }
    }
    return d[s.length][t.length];
  }
  function nearlySame(a, b) {
    if (!a || !b) return false;
    if (a === b) return true;
    const limit = Math.max(a.length, b.length) >= 6 ? 2 : 1;
    return editDistance(a, b) <= limit;
  }

  /**
   * Shifted (not returned) learners matching a new admission: same admission number, same
   * first + last name, same first name + parent phone, or same first + middle name.
   */
  async function findShiftedMatch(candidate = {}) {
    const snap = await schoolRef('shiftedStudents').get();
    const all = snap.val() || {};
    const first = normName(candidate.firstName);
    const last = normName(candidate.lastName);
    const middle = normName(candidate.middleName);
    const adm = String(candidate.admissionNumber || '').trim().toUpperCase();
    const phone = normPhone(candidate.primaryParentContact || candidate.parentContact);
    const matches = [];
    Object.entries(all).forEach(([key, rec]) => {
      if (!rec || normalizeStatus(rec.status) === 'returned') return;
      const sd = (rec.studentData && Object.keys(rec.studentData).length) ? rec.studentData : rec;
      const rFirst = normName(sd.firstName);
      const rLast = normName(sd.lastName);
      const rMiddle = normName(sd.middleName);
      const rAdm = String(rec.admissionNo || sd.admissionNumber || '').trim().toUpperCase();
      const rPhone = normPhone(rec.parentContact || sd.primaryParentContact);
      const why = [];
      let strength = '';
      if (adm && rAdm && adm === rAdm) { why.push('same admission number'); strength = 'strong'; }
      if (first && last && rFirst === first && rLast === last) { why.push('same first and last name'); strength = 'strong'; }
      else if (first && rFirst === first && phone && rPhone === phone) { why.push('same first name and parent phone'); strength = 'strong'; }
      else if (first && middle && rMiddle === middle && nearlySame(rFirst, first)) {
        why.push('very similar first name and same middle name');
        strength = strength || 'possible';
      }
      if (why.length) {
        matches.push({
          studentId: key,
          name: normName(rec.studentName || [sd.firstName, sd.middleName, sd.lastName].join(' ')),
          admissionNo: rAdm,
          className: rec.className || sd.classLevel || '',
          shiftYear: rec.shiftYear || '',
          dateShifted: rec.dateShifted || rec.shiftedAt || '',
          dob: sd.dob || '',
          parentContact: rec.parentContact || sd.primaryParentContact || '',
          strength,
          why
        });
      }
    });
    return matches;
  }

  global.SomapShift = Object.assign(global.SomapShift || {}, {
    approveShiftFromReport,
    returnShiftedStudent,
    findShiftedMatch,
    expectedClassFor,
    canonClass
  });
})(typeof window !== 'undefined' ? window : globalThis);
