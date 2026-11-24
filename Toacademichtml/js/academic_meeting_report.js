/*
 * Whole-school academic meeting report (academicreport.html, class = Whole School).
 *
 * Two audiences:
 *   - 'academic'  : academic teachers' meeting, English, full detail (data corrections, drops,
 *                   learner support names, teacher table).
 *   - 'committee' : school committee meeting (parents on the board + staff), Kiswahili, plain
 *                   words, no money-collected figures, no learner movement/shift counts, no
 *                   names of weak learners.
 *
 * Money rule (both audiences): only what is still NOT paid is shown (per class and school),
 * plus how many learners have fully paid. Totals due/collected are never printed.
 *
 * Input is the page's whole-school report (buildSchoolReportAnalysis). Fees come from the
 * shared finance engine (SomapFinance.getFinanceRoster), the same figures as finance.html.
 */
(function (global) {
  'use strict';

  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const MONTHS_SW = ['Januari', 'Februari', 'Machi', 'Aprili', 'Mei', 'Juni', 'Julai', 'Agosti', 'Septemba', 'Oktoba', 'Novemba', 'Desemba'];
  const MONTHS_EN = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  const NOT_MAPPED = 'Teacher not mapped';

  // Grade bands are the school's own (gradeFromPercent in academicreport.html / report forms).
  const GRADE_CUTS = [[80.5, 'A'], [60.5, 'B'], [40.5, 'C'], [20.5, 'D'], [-1, 'F']];
  const GRADE_WORDS = {
    sw: { A: 'Bora sana', B: 'Vizuri', C: 'Wastani', D: 'Chini ya wastani', F: 'Hafifu' },
    en: { A: 'Excellent', B: 'Good', C: 'Average', D: 'Below average', F: 'Weak' }
  };

  // ---------------------------------------------------------------- small helpers
  const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
  const mean = (list) => {
    const clean = (list || []).map(Number).filter(Number.isFinite);
    return clean.length ? clean.reduce((s, v) => s + v, 0) / clean.length : 0;
  };
  const firstText = (...values) => {
    for (const v of values) { const t = String(v == null ? '' : v).trim(); if (t) return t; }
    return '';
  };
  const pct = (v) => num(v).toFixed(1) + '%';
  const money = (v) => 'TSh ' + Math.round(num(v)).toLocaleString('en-US');
  const gradeOf = (p) => { const x = Math.max(0, Math.min(100, num(p))); return GRADE_CUTS.find(([cut]) => x >= cut)[1]; };
  const monthIndex = (key) => {
    const raw = String(key || '').trim();
    if (!raw) return -1;
    const short = raw.slice(0, 3);
    const idx = MONTHS.findIndex((m) => m.toLowerCase() === short.toLowerCase());
    if (idx >= 0) return idx;
    const n = Number(raw.replace(/^\d{4}-/, ''));
    return Number.isFinite(n) && n >= 1 && n <= 12 ? n - 1 : -1;
  };
  const isPrePrimary = (cls) => /baby|middle|pre/i.test(String(cls || ''));
  const titleName = (name) => String(name || '').trim().replace(/\s+/g, ' ').toUpperCase();
  const shortName = (name) => {
    const parts = titleName(name).split(' ');
    return parts.length > 3 ? parts.slice(0, 3).join(' ') : parts.join(' ');
  };
  const listJoin = (items, lang) => {
    const list = (items || []).filter(Boolean);
    if (list.length <= 1) return list.join('');
    return list.slice(0, -1).join(', ') + (lang === 'sw' ? ' na ' : ' and ') + list[list.length - 1];
  };
  function formatDate(iso, lang) {
    const m = String(iso || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!m) return String(iso || '');
    const names = lang === 'sw' ? MONTHS_SW : MONTHS_EN;
    return Number(m[3]) + ' ' + names[Number(m[2]) - 1] + ' ' + m[1];
  }
  function localIso(d) { d = d || new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
  function isoPlusDays(iso, days) { const p = String(iso || '').split('-').map(Number); const d = p.length === 3 ? new Date(p[0], p[1] - 1, p[2]) : new Date(); d.setDate(d.getDate() + Number(days || 0)); return localIso(d); }
  const monthName = (idx, lang) => (lang === 'sw' ? MONTHS_SW : MONTHS_EN)[idx] || '';

  /** Positions with shared ties (1,1,3), compared at 2 decimals like the awards engine. */
  function rankRows(rows, valueOf) {
    const sorted = rows.slice().sort((a, b) => valueOf(b) - valueOf(a));
    let lastValue = null;
    let lastPos = 0;
    return sorted.map((row, i) => {
      const value = Math.round(valueOf(row) * 100) / 100;
      const pos = value === lastValue ? lastPos : i + 1;
      lastValue = value;
      lastPos = pos;
      return { ...row, position: pos };
    });
  }
  /**
   * Top-learner order (agreed with the school 2026-11-24): highest average first, but when two
   * neighbours are within CLOSE_MARGIN points, the one who sat more exam papers goes higher.
   * Every such move is recorded so the report can explain it to parents.
   */
  const CLOSE_MARGIN = 1;
  function rankLearners(list) {
    // Compare the SHARE of the class's exams sat (classes sit different numbers of papers).
    const share = (r) => Math.round(num(r.participation) * 1000) / 1000;
    const rows = list.slice().sort((a, b) => num(b.overallPct) - num(a.overallPct) || share(b) - share(a));
    const moves = [];
    for (let pass = 0; pass < rows.length; pass += 1) {
      let swapped = false;
      for (let i = 0; i < rows.length - 1; i += 1) {
        const hi = rows[i]; const lo = rows[i + 1];
        const gap = num(hi.overallPct) - num(lo.overallPct);
        if (gap <= CLOSE_MARGIN && share(lo) > share(hi)) {
          rows[i] = lo; rows[i + 1] = hi; swapped = true;
          moves.push({ up: lo, down: hi });
        }
      }
      if (!swapped) break;
    }
    let lastKey = null; let lastPos = 0;
    const ranked = rows.map((r, i) => {
      const key = num(r.overallPct).toFixed(2) + '|' + share(r);
      const position = key === lastKey ? lastPos : i + 1;
      lastKey = key; lastPos = position;
      return { ...r, position };
    });
    return { ranked, moves };
  }
  /** High scorers kept out of a top list by the gates (exams sat / attendance), for the explanation. */
  function gateExclusions(scored, cutoff) {
    return scored.filter((s) => !s.isEligible && num(s.overallPct) >= cutoff)
      .sort((a, b) => num(b.overallPct) - num(a.overallPct))
      .slice(0, 6);
  }
  const takeTop = (ranked, n, cap) => ranked.filter((r) => r.position <= n).slice(0, cap || n + 3);

  // ---------------------------------------------------------------- learner profiles
  /** Month-by-month result of one learner: all subjects sat that month, sum(score)/sum(max). */
  function monthlyProfile(student) {
    const byMonth = new Map();
    (student.subjectRows || []).forEach((row) => {
      (row.history || []).forEach((h) => {
        const m = monthIndex(h.monthKey);
        const max = num(h.max);
        const score = num(h.score);
        if (m < 0 || max <= 0 || score > max) return;
        const bucket = byMonth.get(m) || { score: 0, max: 0, subjects: new Set() };
        bucket.score += score;
        bucket.max += max;
        bucket.subjects.add(row.subject);
        byMonth.set(m, bucket);
      });
    });
    return Array.from(byMonth.entries())
      .map(([m, b]) => ({ m, pct: b.max > 0 ? (b.score * 100) / b.max : 0, subjects: b.subjects.size }))
      .sort((a, b) => a.m - b.m);
  }

  function analyseClass(analysis, opts) {
    const className = analysis.className || (analysis.filters && analysis.filters.className) || 'Class';
    const students = (analysis.students || []).map((s) => ({ ...s, className }));
    const scored = students.filter((s) => num(s.attemptedCount) > 0);
    const maxExams = Math.max(0, ...scored.map((s) => (s.examSeries || []).length));
    const maxSubjects = Math.max(0, ...scored.map((s) => num(s.attemptedCount)));

    // Fair ranking: a learner who sat one easy test must not top the class.
    // Top-learner rules (same as graduation): sat at least 80% of the papers the class sat
    // (a paper = one subject in one exam) and attended at least 70% of recorded school days.
    // The rank score then multiplies the average by the share of papers sat, so a learner who
    // sat every exam beats one with a slightly higher average from fewer exams.
    const papersOf = (s) => (s.subjectRows || []).reduce((n, row) => n + (row.history || []).length, 0);
    const maxPapers = Math.max(0, ...scored.map(papersOf));
    const classHasRegister = students.some((s) => num(s.attendance && s.attendance.days) > 0);
    scored.forEach((s) => {
      s.papersSat = papersOf(s);
      s.papersMax = maxPapers;
      s.participation = maxPapers > 0 ? s.papersSat / maxPapers : 0;
      s.rankScore = num(s.overallPct) * s.participation;
      s.attendanceOk = !classHasRegister || (num(s.attendance && s.attendance.days) > 0 && num(s.attendancePct) >= 70);
    });
    const eligible = scored.filter((s) => s.participation >= 0.8 && s.attendanceOk
      && num(s.attemptedCount) >= Math.ceil(0.8 * maxSubjects));
    scored.forEach((s) => { s.isEligible = eligible.includes(s); s.classPapers = maxPapers; });
    const classOrder = rankLearners(eligible);
    const ranked = classOrder.ranked;

    // Monthly profiles: a month counts for a learner only when they sat enough of that month's subjects.
    const profiles = new Map();
    const classMonthMaxSubjects = {};
    students.forEach((s) => {
      const prof = monthlyProfile(s);
      profiles.set(s, prof);
      prof.forEach((p) => { classMonthMaxSubjects[p.m] = Math.max(classMonthMaxSubjects[p.m] || 0, p.subjects); });
    });
    const validMonths = (s) => (profiles.get(s) || []).filter((p) => p.subjects >= Math.max(2, Math.ceil(0.5 * (classMonthMaxSubjects[p.m] || 0))));
    const monthBuckets = {};
    students.forEach((s) => validMonths(s).forEach((p) => { (monthBuckets[p.m] = monthBuckets[p.m] || []).push(p.pct); }));
    const classMonthAvg = {};
    Object.keys(monthBuckets).forEach((m) => { classMonthAvg[m] = mean(monthBuckets[m]); });

    const movers = [];
    scored.forEach((s) => {
      if ((s.examSeries || []).length < Math.ceil(0.5 * maxExams)) return;
      const months = validMonths(s);
      if (months.length < 2) return;
      const first = months[0];
      const last = months[months.length - 1];
      if (last.m - first.m < 2) return;
      const gain = last.pct - first.pct;
      // Relative to classmates in the same months, so an easier later exam does not count as growth.
      const relative = (last.pct - num(classMonthAvg[last.m])) - (first.pct - num(classMonthAvg[first.m]));
      movers.push({ student: s, name: s.name, className, firstMonth: first.m, lastMonth: last.m, firstPct: first.pct, lastPct: last.pct, gain, relative, overallPct: num(s.overallPct) });
    });
    const improvers = movers.filter((m) => m.gain >= 10 && m.relative > 0).sort((a, b) => b.gain - a.gain);
    const drops = movers.filter((m) => m.gain <= -15 && m.relative < 0).sort((a, b) => a.gain - b.gain);

    const weakLearners = scored
      .filter((s) => (s.examSeries || []).length >= Math.ceil(0.5 * maxExams) && num(s.overallPct) < 40.5)
      .sort((a, b) => num(a.overallPct) - num(b.overallPct));

    const gradeCounts = { A: 0, B: 0, C: 0, D: 0, F: 0 };
    scored.forEach((s) => { gradeCounts[gradeOf(s.overallPct)] += 1; });

    const subjects = (analysis.subjectStats || [])
      .filter((row) => !row.notAttempted && num(row.avgPct) > 0)
      .map((row) => ({ subject: row.subject, teacher: row.teacher || NOT_MAPPED, avg: num(row.avgPct), attention: num(row.attentionCount), className }));
    const bySubjectDesc = subjects.slice().sort((a, b) => b.avg - a.avg);
    const classAverage = scored.length ? num(analysis.summary && analysis.summary.classAverage) : 0;
    const attendanceDays = students.reduce((s, st) => s + num(st.attendance && st.attendance.days), 0);
    const monthKeys = Object.keys(classMonthAvg).map(Number).sort((a, b) => a - b);
    const teacher = opts.classTeacherFor ? opts.classTeacherFor(className) : null;

    return {
      className,
      prePrimary: isPrePrimary(className),
      classTeacher: firstText(teacher && teacher.name, teacher && teacher.fullName, teacher && teacher.teacherName),
      learners: students.length,
      scoredCount: scored.length,
      unscoredCount: students.length - scored.length,
      average: classAverage,
      grade: gradeOf(classAverage),
      gradeCounts,
      attendancePct: attendanceDays > 0 ? num(analysis.summary && analysis.summary.attendancePct) : null,
      exams: ((analysis.summary && analysis.summary.records) || []).length,
      maxExams,
      top: takeTop(ranked, 5, 7),
      rankedCount: ranked.length,
      eligible,
      improvers,
      drops,
      weakLearners,
      subjects,
      bestSubject: bySubjectDesc[0] || null,
      weakSubject: bySubjectDesc.length > 1 ? bySubjectDesc[bySubjectDesc.length - 1] : null,
      monthAvg: classMonthAvg,
      trend: monthKeys.length >= 2 ? { from: monthKeys[0], to: monthKeys[monthKeys.length - 1], first: classMonthAvg[monthKeys[0]], last: classMonthAvg[monthKeys[monthKeys.length - 1]] } : null,
      students,
      validMonths
    };
  }

  // ---------------------------------------------------------------- teachers
  /**
   * gap = how far the teacher's subject sits above/below the class it is taught in. A teacher who
   * teaches (almost) every subject of a class owns the class average, so for them the class is
   * compared with its own group (Pre-Primary or Primary) instead; otherwise their gap is always 0.
   *
   * Accountability: every class-subject below 60% is named with its teacher (or "not assigned").
   * A teacher is "support" when any of their subjects is below 55% or clearly below the class
   * (gap <= -10); "watch" when a subject is 55-60%. Class teachers of classes below 55% are
   * accountable for the class too.
   */
  const WATCH_PCT = 60;
  const SUPPORT_PCT = 55;
  const targetFor = (avg) => Math.min(75, Math.max(SUPPORT_PCT, Math.ceil((num(avg) + 10) / 5) * 5));

  function analyseTeachers(classes, report, groupAverage, opts) {
    const map = new Map();
    const failing = [];
    classes.forEach((c) => {
      if (!(c.scoredCount > 0)) return;
      const perTeacher = {};
      c.subjects.forEach((row) => { perTeacher[row.teacher] = (perTeacher[row.teacher] || 0) + 1; });
      c.subjects.forEach((row) => {
        if (row.avg < WATCH_PCT) {
          failing.push({ className: c.className, subject: row.subject, teacher: row.teacher, avg: row.avg, gap: row.avg - c.average, below40: row.attention, learners: c.scoredCount, target: targetFor(row.avg) });
        }
        if (!row.teacher || row.teacher === NOT_MAPPED) return;
        const ownsClass = c.subjects.length >= 3 && perTeacher[row.teacher] >= Math.ceil(0.8 * c.subjects.length);
        const gap = ownsClass ? c.average - num(groupAverage(c)) : row.avg - c.average;
        const t = map.get(row.teacher) || { teacher: row.teacher, items: [] };
        t.items.push({ className: c.className, subject: row.subject, avg: row.avg, gap, ownsClass, below40: row.attention, learners: c.scoredCount });
        map.set(row.teacher, t);
      });
    });
    const effort = new Map((report.teacherInsights || []).map((t) => [t.teacher, t]));
    const rows = Array.from(map.values()).map((t) => {
      const e = effort.get(t.teacher) || {};
      return {
        teacher: t.teacher,
        workerId: opts && opts.resolveWorkerId ? opts.resolveWorkerId(t.teacher) || '' : '',
        items: t.items.sort((a, b) => a.avg - b.avg),
        avg: mean(t.items.map((i) => i.avg)),
        gap: mean(t.items.map((i) => i.gap)),
        below40: t.items.reduce((s, i) => s + num(i.below40), 0),
        classes: Array.from(new Set(t.items.map((i) => i.className))),
        attendancePct: e.attendancePct == null ? null : num(e.attendancePct),
        lateDays: num(e.lateDays)
      };
    });
    // Praise is kept modest on purpose: at most three names, only when clearly above their classes.
    const strong = rows.filter((r) => r.avg >= 65 && r.gap >= 3).sort((a, b) => b.gap - a.gap).slice(0, 3);
    const support = rows.filter((r) => r.items.some((i) => i.avg < SUPPORT_PCT) || r.gap <= -10).sort((a, b) => a.avg - b.avg);
    const watch = rows.filter((r) => !support.includes(r) && r.items.some((i) => i.avg < WATCH_PCT)).sort((a, b) => a.avg - b.avg);
    const unmappedList = classes.flatMap((c) => c.subjects.filter((s) => s.teacher === NOT_MAPPED).map((s) => ({ className: c.className, subject: s.subject, avg: s.avg })));

    // Class teachers of classes in trouble.
    const classOwners = classes.filter((c) => c.scoredCount > 0 && c.average < SUPPORT_PCT).map((c) => ({
      className: c.className, teacher: c.classTeacher, avg: c.average, target: targetFor(c.average),
      workerId: opts && opts.resolveWorkerId && c.classTeacher ? opts.resolveWorkerId(c.classTeacher) || '' : ''
    }));

    // Pledges: one per accountable teacher (subject role and/or class role), plus a blank-name pledge
    // for every weak subject nobody is assigned to, so the head teacher names the teacher in the meeting.
    const pledgeMap = new Map();
    support.forEach((r) => {
      const weakItems = r.items.filter((i) => i.avg < WATCH_PCT);
      pledgeMap.set(r.teacher, {
        teacher: r.teacher, workerId: r.workerId, roles: ['subject'],
        items: (weakItems.length ? weakItems : r.items).map((i) => ({ className: i.className, subject: i.subject, avg: i.avg })),
        baseline: mean((weakItems.length ? weakItems : r.items).map((i) => i.avg))
      });
    });
    classOwners.forEach((o) => {
      if (!o.teacher) return;
      const p = pledgeMap.get(o.teacher) || { teacher: o.teacher, workerId: o.workerId, roles: [], items: [], baseline: o.avg };
      if (!p.roles.includes('class')) p.roles.push('class');
      p.classRole = { className: o.className, avg: o.avg };
      pledgeMap.set(o.teacher, p);
    });
    const pledges = Array.from(pledgeMap.values()).map((p) => ({ ...p, target: targetFor(p.classRole ? Math.min(p.baseline, p.classRole.avg) : p.baseline) }));
    unmappedList.filter((u) => u.avg < SUPPORT_PCT).forEach((u) => pledges.push({
      teacher: '', workerId: '', roles: ['subject'], unassigned: true, items: [{ className: u.className, subject: u.subject, avg: u.avg }], baseline: u.avg, target: targetFor(u.avg)
    }));
    pledges.forEach((p, i) => { p.id = 'p' + (i + 1); });

    return {
      rows: rows.sort((a, b) => b.avg - a.avg), strong, support, watch,
      failing: failing.sort((a, b) => a.avg - b.avg),
      unmapped: unmappedList.length, unmappedList, classOwners, pledges
    };
  }

  // ---------------------------------------------------------------- fees (unpaid only)
  /**
   * Same per-learner figures as the rows of finance.html: the shared engine fee and payments for the
   * year, plus finance.html's carry-forward step (last year's unpaid balance, minus any carry already
   * recorded). Verified learner by learner on live data (2026-11-24): due 264,556,400, collected
   * 253,373,800, outstanding 11,182,600 = finance.html's table. finance.html's KPI cards showed the
   * carry-forward twice at the time (265,510,400 / 12,136,600).
   */
  async function analyseFees(year, canonClass, classOrder) {
    const engine = global.SomapFinance;
    if (!engine || typeof engine.getFinanceRoster !== 'function') return null;
    const y = String(year);
    const [rows, prevRows] = await Promise.all([
      engine.getFinanceRoster(y),
      Number(y) - 1 >= 2025 ? engine.getFinanceRoster(String(Number(y) - 1), { includeGraduated: true }).catch(() => []) : Promise.resolve([])
    ]);
    const prevBalance = {};
    (prevRows || []).forEach((r) => {
      const adm = String(r && r.admissionNumber || '').trim();
      if (!adm) return;
      const fin = r.finance || {};
      prevBalance[adm] = Math.max(0, num(fin.balance != null ? fin.balance : r.balance));
    });
    const left = ['graduated', 'shifted', 'deleted', 'archived', 'removed'];
    const active = (rows || []).filter((r) => r && !r.isGraduated && !left.includes(String(r.status || '').toLowerCase()));
    const byClass = new Map();
    let carryCount = 0; let carryAmount = 0;
    active.forEach((r) => {
      const cls = canonClass ? canonClass(r.classLevel || r.className || '') || r.classLevel : r.classLevel;
      const raw = r.rawStudent || {};
      const fin = r.finance || {};
      const adm = String(r.admissionNumber || '').trim();
      const fee = Math.max(0, num(fin.feePerYear != null ? fin.feePerYear : r.fee));
      const paid = Math.max(0, num(fin.paidAmount != null ? fin.paidAmount : r.paid));
      const carry = Math.max(0, num(prevBalance[adm]) - Math.max(0, num(raw.carryAmount)));
      if (carry > 0) { carryCount += 1; carryAmount += carry; }
      const due = fee + carry;
      const balance = due - paid;
      const overdue = Math.max(0, num(fin.periodDebtValue));
      const bucket = byClass.get(cls) || { className: cls, roll: 0, debtors: [], cleared: 0, owed: 0, advance: 0, overdueCount: 0, overdueAmount: 0 };
      bucket.roll += 1;
      if (balance > 0.5) {
        bucket.owed += balance;
        bucket.debtors.push({
          name: titleName(r.fullName),
          adm,
          className: cls,
          parent: titleName(firstText(raw.primaryParentName, raw.parentName, raw.guardianName, raw.secondaryGuardian)),
          contact: firstText(r.parentContact, raw.primaryParentContact, raw.parentPhone, raw.guardianPhone),
          contact2: firstText(raw.secondaryParentContact, raw.secondaryContact, raw.guardianContact),
          balance,
          carry,
          overdue: Math.min(balance, overdue + carry)
        });
      } else {
        bucket.cleared += 1;
        if (balance < -0.5) bucket.advance += -balance;
      }
      if (overdue + carry > 0.5 && balance > 0.5) { bucket.overdueCount += 1; bucket.overdueAmount += Math.min(balance, overdue + carry); }
      byClass.set(cls, bucket);
    });
    const order = (name) => { const i = classOrder.indexOf(name); return i < 0 ? 99 : i; };
    const classes = Array.from(byClass.values()).map((c) => {
      const debtors = c.debtors.sort((a, b) => b.balance - a.balance);
      return { ...c, debtors, debtorCount: debtors.length, net: c.owed - c.advance, topDebtors: debtors.slice(0, 5) };
    }).sort((a, b) => order(a.className) - order(b.className));
    const sum = (k) => classes.reduce((s, c) => s + num(c[k]), 0);
    const roll = sum('roll');
    const cleared = sum('cleared');
    const allDebtors = classes.flatMap((c) => c.debtors);
    return {
      classes,
      roll,
      cleared,
      clearedPct: roll ? (cleared * 100) / roll : 0,
      debtors: allDebtors.length,
      owed: sum('owed'),
      advance: sum('advance'),
      net: sum('owed') - sum('advance'),
      carryCount,
      carryAmount,
      overdueCount: sum('overdueCount'),
      overdueAmount: sum('overdueAmount'),
      allDebtors,
      largestDebtors: allDebtors.slice().sort((a, b) => b.balance - a.balance).slice(0, 10)
    };
  }

  /** Does unpaid fee go together with weak results? Uses the learners' own engine fee rows. */
  function feeAcademicLink(classes) {
    const learners = classes.flatMap((c) => c.students.filter((s) => num(s.attemptedCount) > 0));
    const inDebt = learners.filter((s) => num(s.fee && s.fee.balance) > 0.5);
    const clear = learners.filter((s) => !(num(s.fee && s.fee.balance) > 0.5));
    const weak = classes.flatMap((c) => c.weakLearners);
    const weakInDebt = weak.filter((s) => num(s.fee && s.fee.balance) > 0.5);
    return {
      debtAvg: mean(inDebt.map((s) => s.overallPct)),
      clearAvg: mean(clear.map((s) => s.overallPct)),
      debtCount: inDebt.length,
      clearCount: clear.length,
      weakCount: weak.length,
      weakInDebt: weakInDebt.length,
      debtShare: learners.length ? (inDebt.length * 100) / learners.length : 0,
      weakDebtShare: weak.length ? (weakInDebt.length * 100) / weak.length : 0
    };
  }

  // ---------------------------------------------------------------- whole meeting model
  async function buildMeeting(report, opts) {
    opts = opts || {};
    const classes = (report.classAnalyses || []).map((a) => analyseClass(a, opts));
    const active = classes.filter((c) => c.scoredCount > 0);
    const classOrder = classes.map((c) => c.className);
    const pre = active.filter((c) => c.prePrimary);
    const pri = active.filter((c) => !c.prePrimary);
    const allScored = active.flatMap((c) => c.students.filter((s) => num(s.attemptedCount) > 0));
    const avgOf = (list) => mean(list.flatMap((c) => c.students.filter((s) => num(s.attemptedCount) > 0).map((s) => s.overallPct)));

    const priOrder = rankLearners(pri.flatMap((c) => c.eligible));
    const preOrder = rankLearners(pre.flatMap((c) => c.eligible));
    const schoolTop = takeTop(priOrder.ranked, 10, 12);
    const preTop = takeTop(preOrder.ranked, 5, 7);
    const inList = (list) => (s) => list.some((t) => t.id === s.id && t.className === s.className);
    const movesIn = (order, list) => order.moves.filter((mv) => inList(list)(mv.up) || inList(list)(mv.down))
      .filter((mv, i, arr) => arr.findIndex((x) => x.up.id === mv.up.id && x.down.id === mv.down.id) === i);
    const cutoff = (list) => (list.length ? Math.min(...list.map((t) => num(t.overallPct))) : 101);
    const rankingNotes = {
      primary: { moves: movesIn(priOrder, schoolTop), excluded: gateExclusions(pri.flatMap((c) => c.students.filter((s) => num(s.attemptedCount) > 0)), cutoff(schoolTop)) },
      pre: { moves: movesIn(preOrder, preTop), excluded: gateExclusions(pre.flatMap((c) => c.students.filter((s) => num(s.attemptedCount) > 0)), cutoff(preTop)) }
    };
    const improvers = active.flatMap((c) => c.improvers).sort((a, b) => b.gain - a.gain).slice(0, 10);

    // School month trend, Primary and Pre-Primary separately (different curricula).
    // Only months most classes sat count; a month where one class sat a test is not a school trend.
    const trendFor = (list) => {
      const buckets = {};
      const classSets = {};
      list.forEach((c) => c.students.forEach((s) => c.validMonths(s).forEach((p) => {
        (buckets[p.m] = buckets[p.m] || []).push(p.pct);
        (classSets[p.m] = classSets[p.m] || new Set()).add(c.className);
      })));
      const needed = Math.max(1, Math.ceil(0.6 * list.length));
      return Object.keys(buckets).map(Number).sort((a, b) => a - b)
        .map((m) => ({ m, value: mean(buckets[m]), learners: buckets[m].length, classes: classSets[m].size }))
        .filter((p) => p.learners >= 5 && p.classes >= needed);
    };

    const subjects = active.flatMap((c) => c.subjects.map((s) => ({ ...s, classAverage: c.average })));
    const preAvg = avgOf(pre);
    const priAvg = avgOf(pri);
    const teachers = analyseTeachers(active, report, (c) => (c.prePrimary ? preAvg : priAvg), opts);
    let fees = null;
    try { fees = await analyseFees(opts.year || (report.filters && report.filters.year), opts.canonClass, classOrder); } catch (err) {
      console.warn('[meeting] fee summary failed', err && err.message || err);
    }

    const withAttendance = active.filter((c) => c.attendancePct !== null && c.attendancePct > 0);
    const byAvg = active.slice().sort((a, b) => b.average - a.average);
    const anomalies = (report.scoreAnomalies || []).map((a) => {
      const cls = classes.find((c) => c.className === a.className);
      const learner = cls && cls.students.find((s) => String(s.adm || '').trim() === String(a.adm || '').trim());
      const subj = cls && cls.subjects.find((x) => String(x.subject).toLowerCase() === String(a.subject).toLowerCase());
      return { ...a, name: learner ? learner.name : a.adm, onRoll: Boolean(learner), teacher: subj && subj.teacher !== NOT_MAPPED ? subj.teacher : '' };
    });

    return {
      generatedAt: new Date().toISOString(),
      meetingDate: opts.meetingDate || localIso(),
      schoolName: opts.schoolName || 'School',
      filters: report.filters,
      classes,
      active,
      summary: {
        average: avgOf(active),
        primaryAverage: pri.length ? avgOf(pri) : null,
        preAverage: pre.length ? avgOf(pre) : null,
        scored: allScored.length,
        learners: classes.reduce((s, c) => s + c.learners, 0),
        exams: active.reduce((s, c) => s + c.exams, 0),
        attendancePct: num(report.summary && report.summary.attendancePct),
        bestClass: byAvg[0] || null,
        weakClass: byAvg.length > 1 ? byAvg[byAvg.length - 1] : null,
        bestAttendance: withAttendance.slice().sort((a, b) => b.attendancePct - a.attendancePct)[0] || null,
        weakAttendance: withAttendance.length > 1 ? withAttendance.slice().sort((a, b) => a.attendancePct - b.attendancePct)[0] : null,
        noAttendance: active.filter((c) => c.attendancePct === null || !(c.attendancePct > 0)).map((c) => c.className),
        weakLearners: active.reduce((s, c) => s + c.weakLearners.length, 0),
        gradeCounts: ['A', 'B', 'C', 'D', 'F'].reduce((acc, g) => { acc[g] = active.reduce((s, c) => s + c.gradeCounts[g], 0); return acc; }, {})
      },
      trend: { primary: trendFor(pri), pre: trendFor(pre) },
      schoolTop,
      preTop,
      rankingNotes,
      improvers,
      drops: active.flatMap((c) => c.drops).sort((a, b) => a.gain - b.gain).slice(0, 10),
      subjects: {
        strong: subjects.filter((s) => s.avg >= 75).sort((a, b) => b.avg - a.avg).slice(0, 6),
        weak: subjects.filter((s) => s.avg < 50).sort((a, b) => a.avg - b.avg).slice(0, 8)
      },
      teachers,
      fees,
      feeLink: feeAcademicLink(active),
      anomalies,
      dataNotes: {
        unscored: active.filter((c) => c.unscoredCount > 0).map((c) => ({ className: c.className, count: c.unscoredCount })),
        classesWithoutScores: classes.filter((c) => !(c.scoredCount > 0)).map((c) => c.className)
      }
    };
  }

  // ---------------------------------------------------------------- words
  /** Every sentence the report speaks, per language. */
  function narrative(m, lang) {
    const s = m.summary;
    const sw = lang === 'sw';
    const from = formatDate(m.filters.fromDate, lang);
    const to = formatDate(m.filters.toDate, lang);
    const gw = GRADE_WORDS[lang];
    const out = {};

    out.intro = sw ? [
      'Taarifa hii inaeleza hali ya taaluma ya ' + m.schoolName + ' kuanzia ' + from + ' hadi ' + to + '. Imeandaliwa kwa ajili ya kikao cha Kamati ya Shule pamoja na walimu, ili kila mjumbe aone kwa uwazi tulipotoka, tulipo sasa na hatua tunazopaswa kuchukua.',
      'Takwimu zote zimetoka moja kwa moja kwenye mfumo wa SoMAp: alama za mitihani zilizoingizwa na walimu, mahudhurio ya kila siku na kumbukumbu rasmi za ada. Hakuna namba iliyokadiriwa kwa mkono.',
      'Wastani wa kila mwanafunzi umehesabiwa kwa jumla ya alama alizopata katika masomo aliyoyafanya, ukigawanywa kwa jumla ya alama za juu za masomo hayo. Masomo ambayo mwanafunzi hakuyafanya hayajahesabiwa kama sifuri.'
    ] : [
      'This report sets out the academic position of ' + m.schoolName + ' from ' + from + ' to ' + to + '. It is prepared for the academic teachers\' meeting so that every subject teacher and class teacher can see, with evidence, where we stand and what must change.',
      'Every figure comes directly from SoMAp: exam marks entered by teachers, daily attendance registers and the official finance engine (the same figures as finance.html). Nothing is estimated by hand.',
      'A learner\'s average is total marks scored in the subjects they sat divided by the total possible marks of those subjects. Subjects a learner did not sit are not counted as zero.'
    ];
    if (m.anomalies.length) {
      out.intro.push(sw
        ? 'Alama ' + m.anomalies.length + ' ziliingizwa kimakosa (alama kubwa kuliko alama ya juu ya mtihani, mfano 700 kati ya 100). Alama hizo hazikutumika katika hesabu yoyote ya taarifa hii. Jedwali lililo hapa chini linaonyesha kila alama: darasa, mtihani na mwezi, mwanafunzi, somo, mwalimu wa somo, alama iliyoandikwa na alama ya juu, ili kila mwalimu airekebishe.'
        : m.anomalies.length + ' mark(s) were entered above the exam maximum (for example 700 out of 100). They are excluded from every figure in this report. The table below lists each one by class, exam, learner, subject and subject teacher so it can be corrected.');
    }

    const trendPri = m.trend.primary;
    const overall = [];
    overall.push(sw
      ? 'Kwa kipindi hiki, wastani wa shule nzima ni ' + pct(s.average) + ' (daraja ' + gradeOf(s.average) + ' - ' + gw[gradeOf(s.average)].toLowerCase() + '). Wanafunzi ' + s.scored + ' wamepimwa kupitia mitihani ' + s.exams + ' iliyofanyika katika madarasa ' + m.active.length + '.'
      : 'Across the window the whole-school average is ' + pct(s.average) + ' (grade ' + gradeOf(s.average) + ', ' + gw[gradeOf(s.average)].toLowerCase() + '). ' + s.scored + ' learners were assessed through ' + s.exams + ' exam sittings across ' + m.active.length + ' classes.');
    if (s.primaryAverage !== null && s.preAverage !== null) {
      overall.push(sw
        ? 'Elimu ya Awali (Baby, Middle na Pre-Unit) ina wastani wa ' + pct(s.preAverage) + ', na Elimu ya Msingi (Darasa la 1 hadi la 7) ina wastani wa ' + pct(s.primaryAverage) + '. Makundi haya mawili yana mitaala na upimaji tofauti, kwa hiyo kila kundi linalinganishwa na wenzake tu.'
        : 'Pre-Primary (Baby, Middle and Pre-Unit) averages ' + pct(s.preAverage) + ' while Primary (Class 1 to 7) averages ' + pct(s.primaryAverage) + '. The two groups follow different curricula and assessment, so each is ranked only against itself.');
    }
    if (trendPri.length >= 2) {
      const a = trendPri[0];
      const b = trendPri[trendPri.length - 1];
      const diff = b.value - a.value;
      const tail = diff >= 3
        ? (sw ? ' Hii ni dalili njema kwamba juhudi za walimu na wanafunzi zinazaa matunda.' : ' This is a genuine upward movement.')
        : diff <= -3
          ? (sw ? ' Kushuka huku kunahitaji kufanyiwa kazi mapema kabla ya mitihani ya mwisho.' : ' This decline must be addressed before the final examinations.')
          : (sw ? ' Hali imebaki karibu sawa; tunahitaji msukumo mpya ili kupanda.' : ' Performance has been broadly flat; a deliberate push is needed to lift it.');
      overall.push(sw
        ? 'Kwa Elimu ya Msingi, katika miezi ambayo madarasa yote (au mengi) yalifanya mitihani, wastani ulikuwa ' + trendPri.map((p) => pct(p.value) + ' mwezi ' + monthName(p.m, lang)).join(', ') + '. Kutoka ' + monthName(a.m, lang) + ' hadi ' + monthName(b.m, lang) + ' tofauti ni ' + (diff >= 0 ? '+' : '') + diff.toFixed(1) + ' alama.' + tail
        : 'In Primary, across the months most classes sat exams, the average was ' + trendPri.map((p) => pct(p.value) + ' in ' + monthName(p.m, lang)).join(', ') + '. From ' + monthName(a.m, lang) + ' to ' + monthName(b.m, lang) + ' that is ' + (diff >= 0 ? '+' : '') + diff.toFixed(1) + ' points.' + tail);
    }
    if (s.bestClass && s.weakClass) {
      overall.push(sw
        ? 'Darasa linaloongoza ni ' + s.bestClass.className + ' kwa wastani wa ' + pct(s.bestClass.average) + '. Darasa linalohitaji msaada wa karibu zaidi ni ' + s.weakClass.className + ' lenye wastani wa ' + pct(s.weakClass.average) + '.'
        : 'The strongest class is ' + s.bestClass.className + ' at ' + pct(s.bestClass.average) + '. The class needing the closest support is ' + s.weakClass.className + ' at ' + pct(s.weakClass.average) + '.');
    }
    const gc = s.gradeCounts;
    const totalGraded = Object.values(gc).reduce((a, b) => a + b, 0) || 1;
    overall.push(sw
      ? 'Kwa madaraja: wanafunzi ' + gc.A + ' wamepata A, ' + gc.B + ' B, ' + gc.C + ' C, ' + gc.D + ' D na ' + gc.F + ' F. Kwa maneno mengine, ' + Math.round(((gc.A + gc.B) * 100) / totalGraded) + '% ya wanafunzi wako daraja B au zaidi, na ' + Math.round(((gc.D + gc.F) * 100) / totalGraded) + '% wako daraja D au F (chini ya 40.5%) na wanahitaji msaada maalum.'
      : 'By grade: ' + gc.A + ' learners at A, ' + gc.B + ' at B, ' + gc.C + ' at C, ' + gc.D + ' at D and ' + gc.F + ' at F. In other words ' + Math.round(((gc.A + gc.B) * 100) / totalGraded) + '% are at B or better, and ' + Math.round(((gc.D + gc.F) * 100) / totalGraded) + '% are at grade D or F (below 40.5%) and need structured support.');
    out.overall = overall;

    // Class cards: who teaches what, in plain words a parent can follow.
    const tName = (t) => (!t || t === NOT_MAPPED)
      ? (sw ? 'mwalimu hajapangwa kwenye mfumo' : 'no teacher assigned in SoMAp')
      : (sw ? 'Mwalimu ' : 'Teacher ') + shortName(t);
    const byTeacher = (t) => (!t || t === NOT_MAPPED) ? 'mwalimu wake hajapangwa kwenye mfumo' : 'linafundishwa na Mwalimu ' + shortName(t);
    out.classLines = m.active.map((c) => {
      const lines = [];
      const good = c.gradeCounts.A + c.gradeCounts.B;
      const low = c.gradeCounts.D + c.gradeCounts.F;
      lines.push(sw
        ? 'Mwalimu wa darasa: ' + (c.classTeacher ? shortName(c.classTeacher) : 'hajapangwa') + '. Wanafunzi ' + c.learners + ', kati yao ' + c.scoredCount + ' wamefanya mitihani. Wastani wa darasa ni ' + pct(c.average) + ' (daraja ' + c.grade + ' - ' + gw[c.grade].toLowerCase() + ')' + (c.attendancePct ? ', na mahudhurio ni ' + pct(c.attendancePct) : '') + '.'
        : 'Class teacher: ' + (c.classTeacher ? shortName(c.classTeacher) : 'not assigned') + '. ' + c.learners + ' learners, ' + c.scoredCount + ' assessed. Class average ' + pct(c.average) + ' (grade ' + c.grade + ')' + (c.attendancePct ? ', attendance ' + pct(c.attendancePct) : '') + '.');
      if (c.bestSubject) {
        lines.push(sw
          ? 'Somo linaloongoza: ' + c.bestSubject.subject + ' (' + pct(c.bestSubject.avg) + ') - ' + byTeacher(c.bestSubject.teacher) + '.'
          : 'Strongest subject: ' + c.bestSubject.subject + ' (' + pct(c.bestSubject.avg) + ') - ' + tName(c.bestSubject.teacher) + '.');
      }
      if (c.weakSubject) {
        lines.push(sw
          ? 'Somo la mwisho: ' + c.weakSubject.subject + ' (' + pct(c.weakSubject.avg) + ') - ' + byTeacher(c.weakSubject.teacher) + '.'
          : 'Weakest subject: ' + c.weakSubject.subject + ' (' + pct(c.weakSubject.avg) + ') - ' + tName(c.weakSubject.teacher) + '.');
      }
      lines.push(sw
        ? 'Kwa lugha rahisi: kati ya wanafunzi ' + c.scoredCount + ' waliopimwa, ' + good + ' wanafanya vizuri (A au B)' + (low ? ' na ' + low + ' wako chini ya 40% na wanahitaji msaada wa karibu.' : ', na hakuna aliye chini ya 40%.')
        : 'In plain terms: of ' + c.scoredCount + ' assessed, ' + good + ' are doing well (A or B)' + (low ? ' and ' + low + ' are below 40% and need close support.' : ' and none is below 40%.'));
      if (c.trend && Math.abs(c.trend.last - c.trend.first) >= 3) {
        const up = c.trend.last > c.trend.first;
        lines.push(sw
          ? (up ? 'Mwenendo: darasa limepanda' : 'Mwenendo: darasa limeshuka') + ' kutoka ' + pct(c.trend.first) + ' (' + monthName(c.trend.from, lang) + ') hadi ' + pct(c.trend.last) + ' (' + monthName(c.trend.to, lang) + ').'
          : 'Trend: ' + (up ? 'rose' : 'fell') + ' from ' + pct(c.trend.first) + ' (' + monthName(c.trend.from, lang) + ') to ' + pct(c.trend.last) + ' (' + monthName(c.trend.to, lang) + ').');
      }
      if (c.average < SUPPORT_PCT) {
        lines.push(sw
          ? 'Darasa hili liko chini ya kiwango. Mwalimu wa darasa atasaini ahadi ya kulipandisha katika taarifa hii.'
          : 'This class is below standard. The class teacher signs a recovery pledge in this report.');
      }
      return { className: c.className, lines, tone: c.average >= 60.5 ? 'good' : c.average >= 50 ? 'mid' : 'low' };
    });

    const strongSub = m.subjects.strong.slice(0, 4).map((x) => x.subject + ' (' + x.className + ', ' + pct(x.avg) + ')');
    const weakSub = m.subjects.weak.slice(0, 5).map((x) => x.subject + ' (' + x.className + ', ' + pct(x.avg) + ')');
    out.subjects = [];
    if (strongSub.length) out.subjects.push(sw ? 'Masomo yaliyofanya vizuri zaidi ni ' + listJoin(strongSub, lang) + '.' : 'The strongest subject results are ' + listJoin(strongSub, lang) + '.');
    out.subjects.push(weakSub.length
      ? (sw ? 'Masomo yanayohitaji msukumo wa haraka (chini ya 50%) ni ' + listJoin(weakSub, lang) + '. Haya ndiyo maeneo ambayo kamati na uongozi wa taaluma vinapaswa kuyafuatilia kwa karibu.' : 'Subjects below 50% that need urgent attention: ' + listJoin(weakSub, lang) + '.')
      : (sw ? 'Hakuna somo lenye wastani chini ya 50% katika kipindi hiki. Hongera kwa walimu.' : 'No subject averaged below 50% in this window.'));

    out.top = sw
      ? 'Jinsi nafasi zilivyopangwa (kanuni zile zile za mahafali): (1) mwanafunzi anaingia kwenye nafasi tu kama amefanya angalau 80% ya mitihani ya darasa lake na amehudhuria shule angalau 70% ya siku; (2) kisha wanapangwa kwa wastani, wa juu kwanza; (3) wanafunzi wawili wakikaribiana sana (tofauti ya alama 1 au chini), aliyefanya mitihani mingi zaidi anatangulia, kwa sababu wastani wake umethibitishwa na mitihani mingi zaidi. Lakini tofauti ikiwa kubwa kuliko alama 1, wastani ndio unaoamua. Elimu ya Awali na Elimu ya Msingi zimepangwa kila moja peke yake.'
      : 'How positions were set (same rules as graduation): (1) a learner is ranked only after sitting at least 80% of the class\'s exams and attending at least 70% of school days; (2) learners are then ordered by average, highest first; (3) when two are very close (1 point or less), the one who sat more exams goes first, because their average rests on more evidence. A gap larger than 1 point is decided by the average. Pre-Primary and Primary are ranked separately.';
    // Plain explanations of every judgement, so parents see why each learner is where they are.
    const explain = (notes) => {
      const lines = [];
      (notes.excluded || []).forEach((x) => {
        const why = [];
        if (num(x.participation) < 0.8) why.push(sw ? 'alifanya mitihani ' + x.papersSat + ' tu kati ya ' + x.papersMax + ' (' + Math.round(x.participation * 100) + '%)' : 'sat only ' + x.papersSat + ' of ' + x.papersMax + ' exam papers (' + Math.round(x.participation * 100) + '%)');
        if (!x.attendanceOk) why.push(sw ? 'alihudhuria shule ' + pct(x.attendancePct) + ' ya siku' : 'attended ' + pct(x.attendancePct) + ' of school days');
        if (!why.length) why.push(sw ? 'hakufanya masomo yote ya darasa' : 'did not sit all the class subjects');
        const fewExams = num(x.participation) < 0.8;
        const reasonSw = fewExams ? 'wastani wake unatokana na sehemu ndogo tu ya mitihani ya darasa, si kipindi chote'
          : (!x.attendanceOk ? 'kanuni inataka mahudhurio ya angalau 70%; mwanafunzi asiyekuwepo shuleni mara nyingi hawezi kuwekwa juu ya wenzake waliokuwepo kila siku' : 'kanuni inataka masomo yote ya darasa');
        const reasonEn = fewExams ? 'the average rests on only part of the class exams'
          : (!x.attendanceOk ? 'the rule requires at least 70% attendance' : 'the rule requires all the class subjects');
        lines.push(sw
          ? titleName(x.name) + ' (' + x.className + ') alipata wastani wa ' + pct(x.overallPct) + ', lakini ' + listJoin(why, lang) + '. Hakuingizwa kwenye nafasi za juu kwa sababu ' + reasonSw + '.'
          : titleName(x.name) + ' (' + x.className + ') averaged ' + pct(x.overallPct) + ' but ' + listJoin(why, lang) + ', so is not ranked: ' + reasonEn + '.');
      });
      (notes.moves || []).forEach((mv) => {
        lines.push(sw
          ? titleName(mv.up.name) + ' (wastani ' + pct(mv.up.overallPct) + ', mitihani ' + mv.up.papersSat + '/' + mv.up.papersMax + ') amewekwa juu ya ' + titleName(mv.down.name) + ' (wastani ' + pct(mv.down.overallPct) + ', mitihani ' + mv.down.papersSat + '/' + mv.down.papersMax + '). Ingawa wastani wake ni mdogo kidogo, tofauti ni ya alama ' + (num(mv.down.overallPct) - num(mv.up.overallPct)).toFixed(1) + ' tu, na yeye alifanya sehemu kubwa zaidi ya mitihani ya darasa lake (' + Math.round(num(mv.up.participation) * 100) + '% dhidi ya ' + Math.round(num(mv.down.participation) * 100) + '%).'
          : titleName(mv.up.name) + ' (' + pct(mv.up.overallPct) + ', ' + mv.up.papersSat + '/' + mv.up.papersMax + ' exams) is placed above ' + titleName(mv.down.name) + ' (' + pct(mv.down.overallPct) + ', ' + mv.down.papersSat + '/' + mv.down.papersMax + ' exams): the averages differ by only ' + (num(mv.down.overallPct) - num(mv.up.overallPct)).toFixed(1) + ' point(s) and they sat a larger share of their class exams (' + Math.round(num(mv.up.participation) * 100) + '% vs ' + Math.round(num(mv.down.participation) * 100) + '%).');
      });
      return lines;
    };
    out.rankExplainPrimary = explain(m.rankingNotes ? m.rankingNotes.primary : {});
    out.rankExplainPre = explain(m.rankingNotes ? m.rankingNotes.pre : {});

    out.improvers = sw
      ? 'Mafanikio si kuwa wa kwanza tu. Wanafunzi wafuatao wamepanda kwa kiwango kikubwa kutoka mwezi wa kwanza walipopimwa hadi mwezi wa karibuni, na wamewazidi wenzao katika kupanda huko. Wanastahili kutambuliwa ili waendelee kujituma.'
      : 'Success is not only being first. These learners rose the most from their first assessed month to their latest, and rose faster than their classmates over the same months. Recognise them so the effort continues.';

    // Teachers: name the subject, the class, the teacher and the number. Praise stays short.
    const t = m.teachers;
    const itemText = (i) => i.subject + ' ' + i.className + ' (' + pct(i.avg) + (i.below40 ? (sw ? ', wanafunzi ' + i.below40 + ' kati ya ' + i.learners + ' chini ya 40%' : ', ' + i.below40 + ' of ' + i.learners + ' below 40%') : '') + ')';
    out.teachers = [];
    out.teachers.push(sw
      ? 'Sehemu hii inaonyesha wazi kila somo lililo chini ya 60%, darasa lake na mwalimu anayelifundisha. Lengo si kumdhalilisha mtu yeyote, bali kila mwalimu ajue eneo lake, awajibike kwa matokeo, na atoe ahadi inayopimika ya kuyabadilisha.'
      : 'This section names every subject below 60%, its class and its teacher. The aim is not to shame anyone but to make each teacher own their results and give a measurable commitment to change them.');
    if (t.strong.length) {
      const names = t.strong.map((r) => shortName(r.teacher) + ' (' + pct(r.avg) + ')');
      out.teachers.push(sw
        ? 'Tunatambua kazi nzuri ya ' + listJoin(names, lang) + ', ambao matokeo yao yako juu ya wastani wa madarasa wanayofundisha. Tunawashukuru na tunawahimiza kuendelea hivyo.'
        : 'Good work is noted from ' + listJoin(names, lang) + ', whose results sit clearly above the classes they teach. Keep it up.');
    }
    if (t.failing.length) {
      out.teachers.push(sw
        ? 'Masomo ' + t.failing.length + ' katika madarasa mbalimbali yako chini ya 60%. Walimu ' + t.support.length + ' wana masomo yaliyo chini ya ' + SUPPORT_PCT + '% au chini sana ya wastani wa darasa; hawa ndio wanaoshusha wastani wa shule kwa kiasi kikubwa na watasaini ahadi katika taarifa hii.'
        : t.failing.length + ' class-subjects are below 60%. ' + t.support.length + ' teacher(s) have a subject below ' + SUPPORT_PCT + '% or far below their class; they pull the school average down most and sign a pledge in this report.');
    }
    out.teacherProfiles = t.support.map((r) => {
      const weak = r.items.filter((i) => i.avg < WATCH_PCT);
      const list = (weak.length ? weak : r.items).map(itemText);
      const tgt = targetFor(mean((weak.length ? weak : r.items).map((i) => i.avg)));
      const verdict = r.avg < 50
        ? (sw ? 'Hili ni eneo kubwa linaloshusha shule; ufuatiliaji wa karibu unaanza mara moja.' : 'This is a major drag on the school; close supervision starts immediately.')
        : (sw ? 'Matokeo haya yako chini ya kiwango tunachokitaka; juhudi za ziada zinahitajika.' : 'These results are below the standard we expect; extra effort is required.');
      return {
        teacher: r.teacher,
        avg: r.avg,
        text: sw
          ? 'Mwalimu ' + shortName(r.teacher) + ' anafundisha ' + listJoin(list, lang) + '. Wastani wa masomo yake ni ' + pct(r.avg) + ', yaani alama ' + Math.abs(r.gap).toFixed(1) + (r.gap < 0 ? ' chini' : ' juu') + ' ya wastani wa madarasa husika. ' + verdict + ' Lengo la chini: ' + tgt + '% ndani ya siku 60.'
          : shortName(r.teacher) + ' teaches ' + listJoin(list, lang) + '. Their subject average is ' + pct(r.avg) + ', ' + Math.abs(r.gap).toFixed(1) + ' points ' + (r.gap < 0 ? 'below' : 'above') + ' the classes concerned. ' + verdict + ' Minimum target: ' + tgt + '% within 60 days.'
      };
    });
    out.teachersTail = [];
    if (t.watch.length) {
      out.teachersTail.push(sw
        ? 'Walimu wa kuangaliwa (masomo kati ya 55% na 60%): ' + listJoin(t.watch.map((r) => shortName(r.teacher) + ' - ' + r.items.filter((i) => i.avg < WATCH_PCT).map((i) => i.subject + ' ' + i.className + ' ' + pct(i.avg)).join(', ')), lang) + '. Hawajaanguka, lakini wakiendelea hivi wataingia kwenye orodha ya ahadi kikao kijacho.'
        : 'Watch list (subjects between 55% and 60%): ' + listJoin(t.watch.map((r) => shortName(r.teacher) + ' - ' + r.items.filter((i) => i.avg < WATCH_PCT).map((i) => i.subject + ' ' + i.className + ' ' + pct(i.avg)).join(', ')), lang) + '. Not failing yet, but they join the pledge list next meeting if this continues.');
    }
    if (t.classOwners.length) {
      out.teachersTail.push(sw
        ? 'Walimu wa darasa wanaowajibika kwa madarasa yaliyo chini ya ' + SUPPORT_PCT + '%: ' + listJoin(t.classOwners.map((o) => (o.teacher ? shortName(o.teacher) : 'hajapangwa') + ' (' + o.className + ', ' + pct(o.avg) + ')'), lang) + '.'
        : 'Class teachers accountable for classes below ' + SUPPORT_PCT + '%: ' + listJoin(t.classOwners.map((o) => (o.teacher ? shortName(o.teacher) : 'not assigned') + ' (' + o.className + ', ' + pct(o.avg) + ')'), lang) + '.');
    }
    if (t.unmappedList.length) {
      const weakUnmapped = t.unmappedList.filter((u) => u.avg < WATCH_PCT);
      out.teachersTail.push(sw
        ? 'Masomo ' + t.unmappedList.length + ' hayana mwalimu kwenye mfumo wa SoMAp' + (weakUnmapped.length ? ', yakiwemo yaliyo chini ya 60%: ' + listJoin(weakUnmapped.map((u) => u.subject + ' ' + u.className + ' (' + pct(u.avg) + ')'), lang) + '. Mwalimu Mkuu ataje walimu wa masomo haya kwenye kikao hiki, nao wasaini ahadi zilizoachwa wazi.' : '.')
        : t.unmappedList.length + ' class-subject(s) have no teacher in SoMAp' + (weakUnmapped.length ? ', including these below 60%: ' + listJoin(weakUnmapped.map((u) => u.subject + ' ' + u.className + ' (' + pct(u.avg) + ')'), lang) + '. The head teacher names their teachers in this meeting and they sign the open pledges.' : '.'));
    }

    out.attendance = [];
    if (s.attendancePct > 0) {
      out.attendance.push(sw
        ? 'Mahudhurio ya wanafunzi kwa shule nzima ni ' + pct(s.attendancePct) + '.' + (s.bestAttendance ? ' Darasa lenye mahudhurio bora ni ' + s.bestAttendance.className + ' (' + pct(s.bestAttendance.attendancePct) + ')' : '') + (s.weakAttendance ? ', na lenye mahudhurio ya chini ni ' + s.weakAttendance.className + ' (' + pct(s.weakAttendance.attendancePct) + ').' : '.')
        : 'Learner attendance across the school is ' + pct(s.attendancePct) + '.' + (s.bestAttendance ? ' Best: ' + s.bestAttendance.className + ' (' + pct(s.bestAttendance.attendancePct) + ')' : '') + (s.weakAttendance ? '; lowest: ' + s.weakAttendance.className + ' (' + pct(s.weakAttendance.attendancePct) + ').' : '.'));
    }
    if (s.noAttendance.length) {
      out.attendance.push(sw
        ? listJoin(s.noAttendance, lang) + ': hakuna kumbukumbu za mahudhurio kwenye mfumo kwa kipindi hiki, kwa hiyo hazikuhesabiwa kwenye wastani wa mahudhurio. Mwalimu wa darasa ahakikishe daftari la mahudhurio linajazwa kila siku.'
        : listJoin(s.noAttendance, lang) + ': no attendance register in SoMAp for this window, so excluded from the attendance average. The class teacher must mark the register daily.');
    }

    const f = m.fees;
    const link = m.feeLink;
    const prevYear = Number(m.filters.year) - 1;
    out.fees = [];
    if (f) {
      out.fees.push(sw
        ? 'Sehemu hii haionyeshi kiasi cha fedha kilichokusanywa. Inaonyesha kiasi ambacho bado hakijalipwa, darasa kwa darasa, pamoja na wazazi wanaohusika, ili kamati isaidie ufuatiliaji.'
        : 'This section does not show money collected. It shows what is still unpaid, class by class, with the parents concerned, for follow-up.');
      out.fees.push(sw
        ? 'Hadi ' + to + ', wanafunzi ' + f.debtors + ' kati ya ' + f.roll + ' wana salio la ada. Wazazi wao wanadaiwa jumla ya ' + money(f.owed) + (f.carryCount ? ' (pamoja na ' + money(f.carryAmount) + ' ya madeni ya mwaka ' + prevYear + ' ya wanafunzi ' + f.carryCount + ')' : '') + '.'
        : 'As of ' + to + ', ' + f.debtors + ' of ' + f.roll + ' learners carry a fee balance. Their parents owe ' + money(f.owed) + (f.carryCount ? ' (including ' + money(f.carryAmount) + ' carried from ' + prevYear + ' for ' + f.carryCount + ' learner(s))' : '') + '.');
      if (f.advance > 0.5) {
        out.fees.push(sw
          ? 'Wazazi wengine wamelipa mapema kwa ajili ya muda ujao jumla ya ' + money(f.advance) + '. Kwa hiyo deni halisi la shule (ada inayotakiwa kutoa ada iliyolipwa) ni ' + money(f.net) + '. Hiki ndicho kiasi cha "Total Outstanding" kwenye jedwali la finance.html.'
          : 'Other parents have paid ahead a total of ' + money(f.advance) + '. The school\'s net outstanding (due minus collected) is therefore ' + money(f.net) + ', the same as the rows of finance.html.');
      }
      out.fees.push(sw
        ? 'Wanafunzi ' + f.cleared + ' (' + Math.round(f.clearedPct) + '%) wamekamilisha ada zao zote. Hongera kwa wazazi hawa; mfano wao uwe chachu kwa wengine.'
        : f.cleared + ' learners (' + Math.round(f.clearedPct) + '%) have paid in full.');
      out.fees.push(sw
        ? 'Wanafunzi ' + f.overdueCount + ' wamepitisha muda wao wa kulipa. Kamati ya Shule inaombwa kuwaita wazazi 10 wenye madeni makubwa zaidi (wameorodheshwa hapa chini pamoja na namba zao za simu) waje shuleni waeleze sababu ya kuchelewa na tarehe kamili watakayolipa. Ahadi zao ziandikwe kwenye orodha kamili iliyo mwishoni mwa sehemu hii, nayo isainiwe.'
        : f.overdueCount + ' learners are past their payment date. The committee is asked to call in the 10 largest debtors (listed below with phone numbers) to explain and give a firm payment date, recorded on the full list at the end of this section.');
    }
    if (link.debtCount && link.clearCount) {
      const diff = link.clearAvg - link.debtAvg;
      out.fees.push(sw
        ? 'Uhusiano wa ada na taaluma: wanafunzi wasio na deni wana wastani wa ' + pct(link.clearAvg) + ', na wenye deni wana wastani wa ' + pct(link.debtAvg) + '. ' + (diff >= 5
          ? 'Tofauti hii inaonyesha kwamba kuchelewa kwa ada kunaenda sambamba na kushuka kwa taaluma (mfano kukosa vifaa au utulivu wa mtoto).'
          : (diff <= -5 ? 'Kwa sasa wanafunzi wenye deni hawaonekani kuathirika kitaaluma; hata hivyo deni linapaswa kufuatiliwa.' : 'Tofauti ni ndogo, kwa hiyo ada haionekani kuwa sababu kubwa ya matokeo kwa sasa.'))
          + (link.weakCount ? ' Kati ya wanafunzi ' + link.weakCount + ' wa daraja D au F, ' + link.weakInDebt + ' wana deni la ada.' : '')
        : 'Fees and results: learners with no balance average ' + pct(link.clearAvg) + ' versus ' + pct(link.debtAvg) + ' for those with a balance. ' + (diff >= 5
          ? 'The gap suggests unpaid fees travel with weaker results.'
          : (diff <= -5 ? 'Learners with a balance are not weaker on results at present.' : 'The gap is small, so fees are not a major driver of results right now.'))
          + (link.weakCount ? ' Of the ' + link.weakCount + ' learners at grade D or F, ' + link.weakInDebt + ' carry a fee balance.' : ''));
    }

    // Resolutions: every row has an action, a named owner, a deadline and a measure.
    const meet = m.meetingDate;
    const by = (days) => formatDate(isoPlusDays(meet, days), lang);
    const res = [];
    t.support.forEach((r) => {
      const weak = r.items.filter((i) => i.avg < WATCH_PCT);
      const use = weak.length ? weak : r.items;
      res.push({
        action: sw
          ? 'Kupandisha ' + listJoin(use.map((i) => i.subject + ' ' + i.className + ' (' + pct(i.avg) + ')'), lang) + ': kuwasilisha mpango wa maandishi kwa Mwalimu wa Taaluma, vipindi 2 vya ziada kila wiki, jaribio fupi kila Ijumaa na kusahihisha madaftari yote.'
          : 'Raise ' + listJoin(use.map((i) => i.subject + ' ' + i.className + ' (' + pct(i.avg) + ')'), lang) + ': written plan to the Academic Teacher, 2 extra periods a week, a short test every Friday and all exercise books marked.',
        owner: shortName(r.teacher),
        due: (sw ? 'Mpango: ' : 'Plan: ') + by(7) + (sw ? '; Lengo: ' : '; Target: ') + by(60),
        measure: (sw ? 'Wastani ufike angalau ' : 'Average reaches at least ') + targetFor(mean(use.map((i) => i.avg))) + '%'
      });
    });
    t.classOwners.forEach((o) => res.push({
      action: sw
        ? 'Mpango wa kuokoa darasa la ' + o.className + ' (wastani ' + pct(o.avg) + '): kikao na walimu wote wa darasa, ratiba ya vipindi vya ziada, kufuatilia kazi za nyumbani na kuwaita wazazi wa wanafunzi walio chini ya 40%.'
        : 'Recovery plan for ' + o.className + ' (average ' + pct(o.avg) + '): meeting with all its subject teachers, extra-period timetable, homework follow-up and calls to parents of learners below 40%.',
      owner: o.teacher ? shortName(o.teacher) + (sw ? ' (mwalimu wa darasa)' : ' (class teacher)') : (sw ? 'Mwalimu Mkuu' : 'Head Teacher'),
      due: (sw ? 'Mpango: ' : 'Plan: ') + by(7) + (sw ? '; Lengo: ' : '; Target: ') + by(60),
      measure: (sw ? 'Wastani wa darasa ufike angalau ' : 'Class average reaches at least ') + o.target + '%'
    }));
    const weakUnmapped = t.unmappedList.filter((u) => u.avg < WATCH_PCT);
    if (weakUnmapped.length) {
      res.push({
        action: sw
          ? 'Kuwapangia walimu masomo yasiyo na mwalimu kwenye SoMAp: ' + listJoin(weakUnmapped.map((u) => u.subject + ' ' + u.className + ' (' + pct(u.avg) + ')'), lang) + '. Walimu hao wasaini ahadi zilizoachwa wazi.'
          : 'Assign teachers in SoMAp for: ' + listJoin(weakUnmapped.map((u) => u.subject + ' ' + u.className + ' (' + pct(u.avg) + ')'), lang) + '. They sign the open pledges.',
        owner: sw ? 'Mwalimu Mkuu' : 'Head Teacher',
        due: by(3),
        measure: sw ? 'Kila somo lina mwalimu kwenye mfumo' : 'Every subject has a teacher in SoMAp'
      });
    }
    if (t.support.length || t.classOwners.length) {
      res.push({
        action: sw
          ? 'Kukagua maandalio ya masomo ya walimu walio kwenye orodha hii kila Ijumaa, kuingia darasani kwao angalau mara 2 kwa mwezi, na kutoa mrejesho wa maandishi.'
          : 'Check the lesson plans of every teacher on this list each Friday, observe each of them at least twice a month and give written feedback.',
        owner: sw ? 'Mwalimu wa Taaluma' : 'Academic Teacher',
        due: sw ? 'Kila wiki' : 'Weekly',
        measure: sw ? 'Ripoti ya maandishi kwa Mwalimu Mkuu kila mwezi' : 'Monthly written report to the Head Teacher'
      });
    }
    if (s.weakLearners) {
      res.push({
        action: sw
          ? 'Wanafunzi ' + s.weakLearners + ' wa daraja D au F: vikundi vidogo vya msaada, kazi za nyumbani zinazofuatiliwa, na kuonana na kila mzazi.'
          : s.weakLearners + ' learners at grade D or F: small-group support, checked homework, and a meeting with each parent.',
        owner: sw ? 'Walimu wa darasa' : 'Class teachers',
        due: by(14),
        measure: sw ? 'Kila mzazi ameonana na mwalimu; mwanafunzi amepanda daraja' : 'Every parent met; learner moves up a grade'
      });
    }
    if (m.anomalies.length) {
      const owners = Array.from(new Set(m.anomalies.map((a) => (a.teacher ? shortName(a.teacher) : '')).filter(Boolean)));
      res.push({
        action: sw ? 'Kurekebisha alama ' + m.anomalies.length + ' zilizokosewa (orodha iko Sehemu ya 1) na kuhakiki kila alama kabla ya kuhifadhi.' : 'Correct the ' + m.anomalies.length + ' invalid marks listed in Section 1 and double-check every mark before saving.',
        owner: owners.length && owners.length <= 2 ? owners.join(', ') : (sw ? 'Walimu ' + (owners.length || '') + ' wa masomo husika (Sehemu ya 1)' : (owners.length || '') + ' subject teachers (Section 1)'),
        due: by(7),
        measure: sw ? 'Alama zote sahihi kwenye scoresheet' : 'All marks valid in the scoresheet'
      });
    }
    if (f && f.debtors) {
      res.push({
        action: sw
          ? 'Kuwaita wazazi 10 wenye madeni makubwa zaidi waeleze sababu na tarehe ya kulipa; wazazi wengine wenye salio wapigiwe simu.'
          : 'Call in the 10 largest debtors for a reason and a payment date; phone every other parent with a balance.',
        owner: sw ? 'Kamati ya Shule na Mhasibu' : 'School Committee and Bursar',
        due: by(14),
        measure: sw ? 'Kila mzazi ametoa tarehe ya kulipa kwa maandishi' : 'Every parent has given a written payment date'
      });
    }
    s.noAttendance.forEach((cls) => {
      const c = m.active.find((x) => x.className === cls);
      res.push({
        action: sw ? 'Kujaza daftari la mahudhurio la ' + cls + ' kila siku kwenye SoMAp.' : 'Mark the ' + cls + ' attendance register daily in SoMAp.',
        owner: c && c.classTeacher ? shortName(c.classTeacher) : (sw ? 'Mwalimu wa darasa' : 'Class teacher'),
        due: sw ? 'Kuanzia kesho' : 'From tomorrow',
        measure: sw ? 'Mahudhurio yanaonekana kwenye mfumo' : 'Attendance visible in SoMAp'
      });
    });
    res.push({
      action: sw ? 'Kuwatambua hadharani wanafunzi bora na walioimarika zaidi (vyeti au zawadi ndogo).' : 'Publicly recognise the top and most-improved learners (certificates or small prizes).',
      owner: sw ? 'Uongozi wa shule' : 'School leadership',
      due: by(30),
      measure: sw ? 'Wanafunzi wametambuliwa' : 'Learners recognised'
    });
    if (sw) {
      res.push({
        action: 'Kuhamasisha wazazi kufuatilia kazi za nyumbani, kusoma na mtoto nyumbani na kuhudhuria vikao vya wazazi.',
        owner: 'Kamati ya Shule',
        due: by(30),
        measure: 'Mahudhurio ya wazazi kwenye vikao yameongezeka'
      });
    }
    res.push({
      action: sw ? 'Kuwasilisha taarifa ya utekelezaji wa maazimio haya na ahadi za walimu kwenye kikao kijacho.' : 'Report on these resolutions and the teachers\' pledges at the next meeting.',
      owner: sw ? 'Mwalimu wa Taaluma' : 'Academic Teacher',
      due: by(60),
      measure: sw ? 'Taarifa mpya ya taaluma imesomwa' : 'New academic report presented'
    });
    out.resolutions = res;
    out.resolutionsNote = sw
      ? 'Maazimio haya yakishakubaliwa na kusainiwa na kikao, yanakuwa maagizo rasmi ya shule. Kila mhusika atapimwa kwa kipimo kilichoandikwa, na matokeo yatasomwa hadharani kwenye kikao kijacho.'
      : 'Once agreed and signed by this meeting, these resolutions are formal school instructions. Each owner is measured against the stated measure and results are read out at the next meeting.';
    out.pledgeIntro = sw
      ? 'Kila mwalimu aliyetajwa hapa chini atajaza na kusaini ahadi yake mbele ya kikao. Siku, lengo na hatua anayoomba ichukuliwe asipotimiza vitaandikwa kwa mkono, kisha vitahifadhiwa kwenye SoMAp na mwalimu atakumbushwa kila siku kwenye ukurasa wake hadi tarehe ya mwisho.'
      : 'Each teacher named below completes and signs their pledge in front of the meeting. Days, target and the consequence they accept are handwritten, then recorded in SoMAp, where the teacher is reminded daily on their dashboard until the deadline.';

    out.closing = sw
      ? 'Matokeo haya ni kioo cha juhudi zetu sote: walimu, wazazi na wanafunzi. Yapo mafanikio ya kujivunia na yapo maeneo yanayohitaji kazi zaidi. Tukishirikiana, tuna uwezo wa kupandisha wastani wa shule katika kipindi kijacho.'
      : 'These results reflect the work of all of us. There are real gains to protect and clear gaps to close. With the actions above, the next window should show a measurable rise.';
    return out;
  }

  // ---------------------------------------------------------------- labels
  const LABELS = {
    sw: {
      kicker: 'TAARIFA RASMI YA TAALUMA',
      title1: 'Taarifa ya Taaluma',
      title2: 'ya Shule Nzima',
      meeting: 'Kikao cha Kamati ya Shule',
      year: 'Mwaka wa masomo',
      glance: 'Muhtasari kwa Haraka',
      keyMessage: 'Ujumbe Mkuu',
      contents: 'Yaliyomo',
      preparedBy: 'Imeandaliwa na Idara ya Taaluma',
      printed: 'Tarehe ya taarifa',
      confidential: 'Kwa matumizi ya kikao',
      page: 'Ukurasa',
      sections: ['Utangulizi', 'Hali ya Taaluma kwa Ujumla', 'Matokeo kwa Kila Darasa', 'Masomo', 'Wanafunzi Bora', 'Wanafunzi Walioimarika Zaidi', 'Walimu na Ufundishaji', 'Mahudhurio ya Wanafunzi', 'Ada: Kiasi Ambacho Hakijalipwa', 'Maazimio ya Kikao', 'Ahadi za Walimu', 'Hitimisho'],
      card: {
        avg: ['Wastani wa Shule', (g, w) => 'Daraja ' + g + ' - ' + w],
        scored: ['Wanafunzi Waliopimwa', (n) => 'kati ya ' + n + ' walioandikishwa'],
        att: ['Mahudhurio', () => 'wastani wa wanafunzi wote'],
        exams: ['Mitihani', () => 'iliyofanyika madarasa yote'],
        best: ['Darasa Bora', (p) => 'wastani ' + p],
        weak: ['Darasa la Kusaidiwa', (p) => 'wastani ' + p],
        owed: ['Deni la Ada', (n) => 'wanafunzi ' + n + ' wenye salio'],
        cleared: ['Wamekamilisha Ada', (p) => p + ' ya wanafunzi wote']
      },
      col: {
        cls: 'Darasa', learners: 'Wanafunzi', scored: 'Waliopimwa', avg: 'Wastani', grade: 'Daraja', att: 'Mahudhurio', ct: 'Mwalimu wa Darasa',
        pos: 'Nafasi', name: 'Jina la Mwanafunzi', subject: 'Somo', teacher: 'Mwalimu', start: 'Mwanzo', latest: 'Karibuni', gain: 'Ongezeko',
        vsClass: 'Ukilinganisha na darasa', cleared: 'Wamekamilisha', debtors: 'Wenye Salio', owed: 'Salio Lililobaki', late: 'Waliochelewa',
        parent: 'Mzazi / Mlezi', balance: 'Salio', subjects: 'Masomo na Madarasa', total: 'JUMLA'
      },
      classBars: 'Wastani wa kila darasa (mstari wa dhahabu = wastani wa shule)',
      trendTitle: 'Mwenendo wa wastani kwa mwezi',
      primary: 'Elimu ya Msingi', pre: 'Elimu ya Awali',
      gradeTitle: 'Mgawanyo wa madaraja ya wanafunzi',
      legend: 'Kijani: 60% na zaidi   Njano: 50% - 60%   Nyekundu: chini ya 50%',
      weakSubjects: 'Masomo yaliyo chini ya 50%',
      strongSubjects: 'Masomo yaliyofanya vizuri zaidi (75% na zaidi)',
      topPrimary: 'Wanafunzi 10 Bora - Elimu ya Msingi (Darasa 1-7)',
      topPre: 'Wanafunzi 5 Bora - Elimu ya Awali',
      topPerClass: 'Wanafunzi 5 bora wa kila darasa',
      noImprovers: 'Hakuna mwanafunzi aliyekidhi vigezo vya kuimarika katika kipindi hiki.',
      supportTitle: 'Walimu wanaohitaji ufuatiliaji wa karibu',
      attBars: 'Mahudhurio kwa darasa (kipimo kinaanzia 70%)',
      feeTable: 'Salio la ada kwa kila darasa',
      debtorsTitle: 'Wanafunzi 5 wenye salio kubwa zaidi kwa kila darasa',
      noDebt: 'Hakuna salio',
      signatures: ['Mwalimu wa Taaluma', 'Mwalimu Mkuu', 'Mwenyekiti wa Kamati ya Shule'],
      signName: 'Jina', signSign: 'Sahihi', signDate: 'Tarehe',
      monthWord: (m) => MONTHS_SW[m],
      x: {
        anomTitle: 'Alama zilizokosewa (zirekebishwe)', anomHead: ['Darasa', 'Mtihani / Mwezi', 'Mwanafunzi', 'Somo', 'Mwalimu wa somo', 'Iliyoandikwa', 'Juu'], notOnRoll: '(hayupo kwenye orodha ya sasa)', noTeacher: 'Hajapangwa',
        failingTitle: 'Masomo yaliyo chini ya 60% na walimu wake', failingHead: ['Darasa', 'Somo', 'Mwalimu', 'Wastani', 'Na darasa', 'Chini ya 40%', 'Lengo'],
        profilesTitle: 'Walimu wanaoshusha wastani wa shule', feeHead: ['Darasa', 'Wanafunzi', 'Wamemaliza', 'Wenye salio', 'Wanadaiwa', 'Wamelipa mapema', 'Deni halisi', 'Wamechelewa'],
        callTitle: 'Wazazi 10 wa kuitwa na Kamati ya Shule', callHead: ['#', 'Mwanafunzi', 'Darasa', 'Mzazi / Mlezi', 'Simu', 'Salio', 'Tarehe ya kulipa'],
        fullTitle: 'Orodha kamili ya wanafunzi wenye salio la ada', fullNote: 'Wanafunzi 5 wa kwanza wa kila darasa (rangi ya njano) ndio wenye salio kubwa zaidi. Safu ya mwisho ijazwe kwa mkono wazazi wanapotoa ahadi.', fullHead: ['#', 'Mwanafunzi', 'Mzazi / Mlezi', 'Simu', 'Salio', 'Ahadi ya kulipa'],
        listSign: ['Mhasibu', 'Mwalimu Mkuu', 'Mwenyekiti wa Kamati'],
        resHead: ['#', 'Hatua', 'Mhusika', 'Muda', 'Kipimo cha mafanikio'],
        pledgeLabel: 'AHADI'
      }
    },
    en: {
      kicker: 'OFFICIAL ACADEMIC REPORT',
      title1: 'Whole-School',
      title2: 'Academic Report',
      meeting: 'Academic Teachers\' Meeting',
      year: 'Academic year',
      glance: 'At a Glance',
      keyMessage: 'Key Message',
      contents: 'Contents',
      preparedBy: 'Prepared by the Academic Office',
      printed: 'Report date',
      confidential: 'Staff meeting use',
      page: 'Page',
      sections: ['Introduction', 'Overall Academic Position', 'Results by Class', 'Subjects', 'Top Learners', 'Most Improved Learners', 'Teachers and Teaching', 'Learner Attendance', 'Fees: Amount Still Unpaid', 'Resolutions', 'Teacher Pledges', 'Conclusion'],
      card: {
        avg: ['School Average', (g, w) => 'Grade ' + g + ' - ' + w],
        scored: ['Learners Assessed', (n) => 'of ' + n + ' on the roll'],
        att: ['Attendance', () => 'all learners'],
        exams: ['Exam Sittings', () => 'across all classes'],
        best: ['Strongest Class', (p) => 'average ' + p],
        weak: ['Class to Support', (p) => 'average ' + p],
        owed: ['Fees Outstanding', (n) => n + ' learners with a balance'],
        cleared: ['Fully Paid', (p) => p + ' of all learners']
      },
      col: {
        cls: 'Class', learners: 'Learners', scored: 'Assessed', avg: 'Average', grade: 'Grade', att: 'Attendance', ct: 'Class Teacher',
        pos: 'Pos', name: 'Learner', subject: 'Subject', teacher: 'Teacher', start: 'First', latest: 'Latest', gain: 'Gain',
        vsClass: 'vs class', cleared: 'Fully paid', debtors: 'With balance', owed: 'Unpaid balance', late: 'Overdue',
        parent: 'Parent / Guardian', balance: 'Balance', subjects: 'Subjects and classes', total: 'TOTAL'
      },
      classBars: 'Average per class (gold line = school average)',
      trendTitle: 'Monthly average trend',
      primary: 'Primary', pre: 'Pre-Primary',
      gradeTitle: 'Learners by grade',
      legend: 'Green: 60% and above   Amber: 50% - 60%   Red: below 50%',
      weakSubjects: 'Subjects below 50%',
      strongSubjects: 'Strongest subjects (75% and above)',
      topPrimary: 'Top 10 Learners - Primary (Class 1-7)',
      topPre: 'Top 5 Learners - Pre-Primary',
      topPerClass: 'Top 5 learners in each class',
      noImprovers: 'No learner met the improvement criteria in this window.',
      supportTitle: 'Teachers needing close follow-up',
      attBars: 'Attendance by class (scale starts at 70%)',
      feeTable: 'Unpaid fees by class',
      debtorsTitle: 'Five largest balances in each class',
      noDebt: 'No balance',
      signatures: ['Academic Teacher', 'Head Teacher', 'Chairperson'],
      signName: 'Name', signSign: 'Signature', signDate: 'Date',
      monthWord: (m) => MONTHS_EN[m],
      x: {
        anomTitle: 'Invalid marks to correct', anomHead: ['Class', 'Exam / Month', 'Learner', 'Subject', 'Subject teacher', 'Entered', 'Max'], notOnRoll: '(not on current roll)', noTeacher: 'Not assigned',
        failingTitle: 'Subjects below 60% and their teachers', failingHead: ['Class', 'Subject', 'Teacher', 'Average', 'vs class', 'Below 40%', 'Target'],
        profilesTitle: 'Teachers pulling the school average down', feeHead: ['Class', 'Learners', 'Fully paid', 'With balance', 'Owed', 'Paid ahead', 'Net unpaid', 'Overdue'],
        callTitle: '10 parents for the committee to call in', callHead: ['#', 'Learner', 'Class', 'Parent / Guardian', 'Phone', 'Balance', 'Payment date'],
        fullTitle: 'Full list of learners with a fee balance', fullNote: 'The first five in each class (shaded) are the largest balances. Fill the last column by hand as parents commit.', fullHead: ['#', 'Learner', 'Parent / Guardian', 'Phone', 'Balance', 'Payment promise'],
        listSign: ['Bursar', 'Head Teacher', 'Committee Chair'],
        resHead: ['#', 'Action', 'Owner', 'When', 'Measure of success'],
        pledgeLabel: 'PLEDGE'
      }
    }
  };

  // ---------------------------------------------------------------- PDF
  // Palette: navy + teal + gold, with green/amber/red only where they mean good/watch/concern.
  const C = {
    navy: [15, 42, 74], navy2: [30, 62, 104], teal: [15, 118, 110], gold: [191, 144, 46], cream: [251, 248, 241],
    ink: [30, 41, 59], muted: [100, 116, 139], line: [226, 232, 240], white: [255, 255, 255], soft: [248, 250, 252],
    green: [21, 128, 61], amber: [180, 83, 9], red: [185, 28, 28],
    navyTint: [232, 238, 246], tealTint: [225, 242, 239], goldTint: [249, 241, 222], greenTint: [230, 245, 235], amberTint: [253, 242, 225], redTint: [252, 234, 234]
  };
  const toneOf = (p) => (p >= 60.5 ? 'green' : p >= 50 ? 'amber' : 'red');
  const tintOf = (tone) => C[tone + 'Tint'] || C.navyTint;

  /** The words a teacher signs. Blanks are filled by hand at the meeting. */
  function pledgeText(p, lang) {
    const sw = lang === 'sw';
    const who = p.teacher ? shortName(p.teacher) : '________________________';
    const bySub = {};
    (p.items || []).forEach((i) => { (bySub[i.subject] = bySub[i.subject] || []).push(i); });
    const subj = Object.keys(bySub).map((sub) => (sw ? sub + ' katika ' : sub + ' in ') + listJoin(bySub[sub].map((i) => i.className + ' (' + pct(i.avg) + ')'), lang));
    const roles = [];
    if (subj.length) roles.push((sw ? 'kama mwalimu wa somo la ' : 'as subject teacher of ') + listJoin(subj, lang));
    if (p.classRole) roles.push((sw ? 'kama mwalimu wa darasa la ' : 'as class teacher of ') + p.classRole.className + (sw ? ' (wastani ' : ' (average ') + pct(p.classRole.avg) + ')');
    return sw
      ? 'Mimi Mwalimu ' + who + ', ' + roles.join(', na pia ') + ', natambua kwamba matokeo haya yako chini ya kiwango na yameshusha wastani wa shule. Naahidi kwamba ndani ya siku ______ nitakuwa nimejitahidi na kupandisha wastani hadi ______% (lengo la chini ni ' + p.target + '%). Nisipotimiza ahadi hii, naomba ____________________________________________________.'
      : 'I, ' + who + ', ' + roles.join(', and also ') + ', acknowledge that these results are below standard and have pulled the school average down. I commit that within ______ days I will have raised the average to ______% (minimum target ' + p.target + '%). If I do not, I ask that ____________________________________________________.';
  }

  function createPdf(m, mode, assets) {
    const jsPDF = global.jspdf && global.jspdf.jsPDF;
    if (!jsPDF) throw new Error('PDF library not loaded.');
    const lang = mode === 'committee' ? 'sw' : 'en';
    const L = LABELS[lang];
    const words = narrative(m, lang);
    const s = m.summary;
    const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
    const W = 210; const H = 297; const M = 16; const CW = W - 2 * M;
    const TOP = 24; const BOTTOM = 279;
    let y = TOP;
    let currentSection = '';
    const sectionOfPage = {};

    const fill = (c) => doc.setFillColor(c[0], c[1], c[2]);
    const stroke = (c) => doc.setDrawColor(c[0], c[1], c[2]);
    const ink = (c) => doc.setTextColor(c[0], c[1], c[2]);
    const font = (style, size) => { doc.setFont('helvetica', style); doc.setFontSize(size); };
    const split = (text, w) => doc.splitTextToSize(String(text || ''), w);
    const markPage = () => { const p = doc.getNumberOfPages(); if (!sectionOfPage[p]) sectionOfPage[p] = currentSection; };
    const addPage = () => { doc.addPage(); y = TOP; markPage(); };
    const ensure = (h) => { if (y + h > BOTTOM) addPage(); };

    // ---- building blocks
    function section(no, title) {
      currentSection = title;
      if (y > TOP + 1) { if (y + 70 > BOTTOM) addPage(); else y += 5; }
      markPage();
      fill(C.navy); doc.roundedRect(M, y, 10, 10, 2, 2, 'F');
      ink(C.white); font('bold', 11); doc.text(String(no), M + 5, y + 6.9, { align: 'center' });
      ink(C.navy); font('bold', 15); doc.text(title, M + 14, y + 7.3);
      fill(C.gold); doc.rect(M + 14, y + 10, 24, 0.9, 'F');
      y += 16;
    }
    function subheading(text) {
      ensure(14);
      ink(C.teal); font('bold', 10.5); doc.text(text, M, y + 4);
      y += 7.5;
    }
    function para(text, opts) {
      const o = opts || {};
      const x = o.x || M; const w = o.w || CW;
      font(o.bold ? 'bold' : 'normal', o.size || 10.2); ink(o.color || C.ink);
      split(text, w).forEach((line) => { ensure(5.2); doc.text(line, x, y + 3.7); y += 5.1; });
      y += o.after == null ? 2.6 : o.after;
    }
    function callout(title, text, tone) {
      const bar = C[tone] || C.gold; const bg = tintOf(tone || 'gold');
      font('normal', 9.8);
      const lines = split(text, CW - 12);
      const h = 5.5 + (title ? 5.5 : 0) + lines.length * 4.05;
      ensure(h + 3);
      fill(bg); doc.roundedRect(M, y, CW, h, 3, 3, 'F');
      fill(bar); doc.rect(M, y, 2.4, h, 'F');
      let ty = y + 5.6;
      if (title) { ink(bar); font('bold', 10); doc.text(title, M + 7, ty); ty += 5.5; }
      ink(C.ink); font('normal', 9.8); doc.text(lines, M + 7, ty);
      y += h + 4;
    }
    function table(head, body, opts) {
      const o = opts || {};
      ensure(o.minStart || 22);
      doc.autoTable({
        startY: y,
        head: [head],
        body,
        foot: o.foot ? [o.foot] : undefined,
        showFoot: o.foot ? 'lastPage' : 'never',
        margin: { left: o.left || M, right: o.right || M, top: TOP + 2, bottom: H - BOTTOM + 2 },
        tableWidth: o.width || 'auto',
        theme: 'plain',
        styles: { font: 'helvetica', fontSize: o.fontSize || 8.6, cellPadding: { top: 2.1, bottom: 2.1, left: 2.4, right: 2.4 }, textColor: C.ink, lineColor: C.line, lineWidth: { bottom: 0.2 }, valign: 'middle' },
        headStyles: { fillColor: o.headColor || C.navy, textColor: 255, fontStyle: 'bold', fontSize: (o.fontSize || 8.6) - 0.2 },
        footStyles: { fillColor: C.goldTint, textColor: C.ink, fontStyle: 'bold' },
        alternateRowStyles: { fillColor: C.soft },
        columnStyles: o.columnStyles || {},
        didParseCell: o.didParseCell,
        didDrawPage: () => markPage()
      });
      y = doc.lastAutoTable.finalY + 5;
    }
    const toneCell = (columnIndex, valueOf) => (data) => {
      if (data.section !== 'body' || data.column.index !== columnIndex) return;
      const v = valueOf(data.row.index);
      if (v == null) return;
      data.cell.styles.textColor = C[toneOf(v)];
      data.cell.styles.fontStyle = 'bold';
    };

    function hbars(title, rows, opts) {
      const o = opts || {};
      const labelW = o.labelW || 30;
      const rowH = 7;
      const h = rows.length * rowH + 20;
      ensure(h + 4);
      stroke(C.line); fill(C.white); doc.roundedRect(M, y, CW, h, 3, 3, 'FD');
      ink(C.navy); font('bold', 9.5); doc.text(title, M + 5, y + 6.5);
      const x0 = M + 5 + labelW; const x1 = M + CW - 22; const span = x1 - x0;
      const min = o.min || 0; const max = o.max || 100;
      const px = (v) => x0 + (Math.max(min, Math.min(max, v)) - min) / (max - min) * span;
      const top = y + 11;
      const ticks = o.ticks || [0, 25, 50, 75, 100];
      font('normal', 6.8); ink(C.muted);
      ticks.forEach((t) => {
        stroke(C.line); doc.setLineWidth(0.2); doc.line(px(t), top - 1, px(t), top + rows.length * rowH);
        doc.text(o.tickLabel ? o.tickLabel(t) : t + '%', px(t), top + rows.length * rowH + 4, { align: 'center' });
      });
      rows.forEach((r, i) => {
        const ry = top + i * rowH;
        ink(C.ink); font('normal', 8.2);
        doc.text(String(r.label), x0 - 3, ry + 4.4, { align: 'right' });
        fill(C.soft); doc.roundedRect(x0, ry + 1.2, span, 4.4, 1.6, 1.6, 'F');
        const c = r.color || C[toneOf(r.value)];
        fill(c); doc.roundedRect(x0, ry + 1.2, Math.max(1.5, px(r.value) - x0), 4.4, 1.6, 1.6, 'F');
        ink(C.ink); font('bold', 8.2);
        doc.text(r.text || pct(r.value), px(r.value) + 2, ry + 4.6);
      });
      if (o.avgLine != null) {
        const ax = px(o.avgLine);
        stroke(C.gold); doc.setLineWidth(0.6); doc.setLineDashPattern([1.2, 1], 0);
        doc.line(ax, top - 2, ax, top + rows.length * rowH);
        doc.setLineDashPattern([], 0); doc.setLineWidth(0.2);
      }
      y += h + 5;
    }

    function lineChart(title, series) {
      const all = series.flatMap((sr) => sr.points);
      if (!all.length) return;
      const h = 66;
      ensure(h + 4);
      stroke(C.line); fill(C.white); doc.roundedRect(M, y, CW, h, 3, 3, 'FD');
      ink(C.navy); font('bold', 9.5); doc.text(title, M + 5, y + 6.5);
      // legend
      let lx = M + CW - 5;
      series.slice().reverse().forEach((sr) => {
        font('normal', 7.8); const tw = doc.getTextWidth(sr.name);
        lx -= tw; ink(C.ink); doc.text(sr.name, lx, y + 6.5);
        lx -= 6; fill(sr.color); doc.roundedRect(lx, y + 4.2, 4, 2.6, 0.8, 0.8, 'F'); lx -= 6;
      });
      const months = Array.from(new Set(all.map((p) => p.m))).sort((a, b) => a - b);
      const lo = Math.max(0, Math.floor((Math.min(...all.map((p) => p.value)) - 8) / 10) * 10);
      const hi = Math.min(100, Math.ceil((Math.max(...all.map((p) => p.value)) + 6) / 10) * 10);
      const x0 = M + 14; const x1 = M + CW - 8; const y0 = y + 14; const y1 = y + h - 10;
      const pad = 8;
      const px = (m) => (months.length === 1 ? (x0 + x1) / 2 : x0 + pad + (months.indexOf(m) / (months.length - 1)) * (x1 - x0 - 2 * pad));
      const py = (v) => y1 - ((v - lo) / (hi - lo || 1)) * (y1 - y0);
      font('normal', 6.8);
      for (let t = lo; t <= hi; t += 10) {
        stroke(C.line); doc.setLineWidth(0.2); doc.line(x0, py(t), x1, py(t));
        ink(C.muted); doc.text(t + '%', x0 - 2, py(t) + 1, { align: 'right' });
      }
      months.forEach((mm) => { ink(C.muted); doc.text(L.monthWord(mm).slice(0, 3), px(mm), y1 + 5, { align: 'center' }); });
      series.forEach((sr) => {
        const pts = sr.points.slice().sort((a, b) => a.m - b.m);
        stroke(sr.color); doc.setLineWidth(0.9);
        for (let i = 1; i < pts.length; i += 1) doc.line(px(pts[i - 1].m), py(pts[i - 1].value), px(pts[i].m), py(pts[i].value));
        pts.forEach((p) => {
          fill(C.white); stroke(sr.color); doc.setLineWidth(0.7); doc.circle(px(p.m), py(p.value), 1.3, 'FD');
          ink(sr.color); font('bold', 7); doc.text(p.value.toFixed(1), px(p.m), py(p.value) - 2.6, { align: 'center' });
        });
      });
      doc.setLineWidth(0.2);
      y += h + 5;
    }

    function gradeStrip() {
      const gc = s.gradeCounts; const total = Object.values(gc).reduce((a, b) => a + b, 0);
      if (!total) return;
      const h = 30; ensure(h + 4);
      stroke(C.line); fill(C.white); doc.roundedRect(M, y, CW, h, 3, 3, 'FD');
      ink(C.navy); font('bold', 9.5); doc.text(L.gradeTitle, M + 5, y + 6.5);
      // One teal family, dark (A) to light (F): reads as an order, not a rainbow.
      const shades = { A: [15, 94, 88], B: [15, 118, 110], C: [94, 160, 151], D: [214, 176, 98], F: [185, 28, 28] };
      let x = M + 5; const w = CW - 10; const by = y + 10;
      ['A', 'B', 'C', 'D', 'F'].forEach((g) => {
        const segW = (gc[g] / total) * w;
        if (segW <= 0) return;
        fill(shades[g]); doc.rect(x, by, segW, 8, 'F');
        if (segW > 9) { ink(C.white); font('bold', 7.6); doc.text(g + ' ' + gc[g], x + segW / 2, by + 5.3, { align: 'center' }); }
        x += segW;
      });
      font('normal', 7.4); ink(C.muted);
      doc.text(['A', 'B', 'C', 'D', 'F'].map((g) => g + ': ' + gc[g] + ' (' + Math.round((gc[g] * 100) / total) + '%) ' + GRADE_WORDS[lang][g]).join('    '), M + 5, by + 15);
      y += h + 5;
    }

    function miniCardsTopPerClass(classes) {
      const colW = (CW - 5) / 2;
      let col = 0; let rowTop = y; let rowH = 0;
      classes.forEach((c) => {
        const list = c.top.slice(0, 6);
        const h = 10 + Math.max(1, list.length) * 4.7 + 3;
        if (col === 0) { if (y + h > BOTTOM) { addPage(); } rowTop = y; rowH = 0; }
        const x = M + col * (colW + 5);
        fill(C.white); doc.roundedRect(x, rowTop, colW, h, 2.5, 2.5, 'F');
        fill(c.prePrimary ? C.gold : C.teal); doc.roundedRect(x, rowTop, colW, 7.5, 2.5, 2.5, 'F'); doc.rect(x, rowTop + 4, colW, 3.5, 'F');
        stroke(C.line); doc.setLineWidth(0.2); doc.roundedRect(x, rowTop, colW, h, 2.5, 2.5, 'S');
        ink(C.white); font('bold', 8.6); doc.text(c.className, x + 3.5, rowTop + 5.2);
        font('normal', 7.6); doc.text((lang === 'sw' ? 'wastani wa darasa ' : 'class average ') + pct(c.average), x + colW - 3.5, rowTop + 5.2, { align: 'right' });
        let ly = rowTop + 12;
        if (!list.length) { ink(C.muted); font('italic', 8); doc.text(lang === 'sw' ? 'Hakuna aliyekidhi vigezo vya nafasi.' : 'No learner met the ranking rule.', x + 3.5, ly); }
        list.forEach((st) => {
          ink(C.navy); font('bold', 8); doc.text(String(st.position) + '.', x + 3.5, ly);
          ink(C.ink); font('normal', 8); doc.text(split(shortName(st.name), colW - 26)[0], x + 9, ly);
          ink(C[toneOf(st.overallPct)]); font('bold', 8); doc.text(pct(st.overallPct), x + colW - 3.5, ly, { align: 'right' });
          ly += 4.7;
        });
        rowH = Math.max(rowH, h);
        col += 1;
        if (col === 2) { col = 0; y = rowTop + rowH + 4; }
      });
      if (col === 1) y = rowTop + rowH + 4;
      y += 2;
    }

    // ================================================================ cover
    const X = L.x;
    const lighten = (c, t) => c.map((v) => Math.round(v + (255 - v) * t));
    fill(C.cream); doc.rect(0, 0, W, H, 'F');
    // Slim header band: identity only, no wasted space.
    fill(C.navy); doc.rect(0, 0, W, 50, 'F');
    fill(C.navy2); doc.circle(W - 8, 4, 30, 'F');
    fill(C.gold); doc.rect(0, 50, W, 1.4, 'F');
    fill(C.white); doc.roundedRect(M, 11, 27, 27, 4, 4, 'F');
    if (assets && assets.logo) { try { doc.addImage(assets.logo, /^data:image\/png/i.test(assets.logo) ? 'PNG' : 'JPEG', M + 2, 13, 23, 23); } catch (_) {} }
    ink(C.gold); font('bold', 7.6); doc.text(L.kicker, M + 33, 16, { charSpace: 0.5 });
    ink(C.white); font('bold', 18); doc.text(L.title1 + ' ' + L.title2, M + 33, 24.5);
    font('normal', 10); ink([226, 232, 240]); doc.text(m.schoolName + '   |   ' + L.meeting + '   |   ' + L.year + ' ' + m.filters.year, M + 33, 31.5);
    const period = formatDate(m.filters.fromDate, lang) + '  -  ' + formatDate(m.filters.toDate, lang);
    font('bold', 8.6); const pw = doc.getTextWidth(period) + 10;
    fill(C.gold); doc.roundedRect(M + 33, 35.5, pw, 7.5, 3.7, 3.7, 'F'); ink(C.navy); doc.text(period, M + 38, 40.4);

    // Colour cards: every card carries its own colour; value and words in white.
    y = 58;
    ink(C.navy); font('bold', 12.5); doc.text(L.glance, M, y + 3.5); fill(C.gold); doc.rect(M, y + 5.6, 18, 0.9, 'F');
    y += 9;
    const f = m.fees;
    const g = gradeOf(s.average);
    const toneColor = { green: [21, 101, 52], amber: [161, 98, 7], red: [153, 27, 27] };
    const cards = [
      [L.card.avg[0], pct(s.average), L.card.avg[1](g, GRADE_WORDS[lang][g]), toneColor[toneOf(s.average)]],
      [L.card.scored[0], String(s.scored), L.card.scored[1](s.learners), C.navy],
      [L.card.att[0], s.attendancePct > 0 ? pct(s.attendancePct) : '-', L.card.att[1](), C.teal],
      [L.card.exams[0], String(s.exams), L.card.exams[1](), [30, 62, 104]],
      [L.card.best[0], s.bestClass ? s.bestClass.className : '-', s.bestClass ? L.card.best[1](pct(s.bestClass.average)) : '', [21, 128, 61]],
      [L.card.weak[0], s.weakClass ? s.weakClass.className : '-', s.weakClass ? L.card.weak[1](pct(s.weakClass.average)) : '', [153, 27, 27]],
      [L.card.owed[0], f ? money(f.net) : '-', f ? L.card.owed[1](f.debtors) : '', [161, 98, 7]],
      [L.card.cleared[0], f ? String(f.cleared) : '-', f ? L.card.cleared[1](Math.round(f.clearedPct) + '%') : '', [15, 94, 88]]
    ];
    const cw = (CW - 3 * 4) / 4; const ch = 30;
    cards.forEach((card, i) => {
      const cx = M + (i % 4) * (cw + 4); const cy = y + Math.floor(i / 4) * (ch + 4);
      const base = card[3];
      fill(base); doc.roundedRect(cx, cy, cw, ch, 3.5, 3.5, 'F');
      // Decoration stays inside the card.
      fill(lighten(base, 0.12)); doc.circle(cx + cw - 9, cy + 9.5, 6.5, 'F');
      fill(lighten(base, 0.22)); doc.circle(cx + cw - 5, cy + ch - 5, 2.6, 'F');
      ink(lighten(base, 0.78)); font('bold', 6.8); doc.text(card[0].toUpperCase(), cx + 3.5, cy + 7.4);
      ink(C.white); font('bold', card[1].length > 11 ? 11.5 : 16); doc.text(card[1], cx + 3.5, cy + 17);
      ink(lighten(base, 0.82)); font('normal', 7.1); doc.text(split(card[2], cw - 7).slice(0, 2), cx + 3.5, cy + 23);
    });
    y += 2 * ch + 4 + 5;

    const keyLines = [];
    keyLines.push(lang === 'sw'
      ? 'Wastani wa shule ni ' + pct(s.average) + ' (daraja ' + g + '). ' + (s.bestClass ? s.bestClass.className + ' linaongoza; ' : '') + (s.weakClass ? s.weakClass.className + ' linahitaji msaada wa karibu.' : '')
      : 'The school average is ' + pct(s.average) + ' (grade ' + g + '). ' + (s.bestClass ? s.bestClass.className + ' leads; ' : '') + (s.weakClass ? s.weakClass.className + ' needs the closest support.' : ''));
    if (m.teachers.failing.length) {
      keyLines.push(lang === 'sw'
        ? 'Masomo ' + m.teachers.failing.length + ' yako chini ya 60%; walimu ' + m.teachers.pledges.length + ' (pamoja na nafasi zisizo na mwalimu) watasaini ahadi za kupandisha matokeo.'
        : m.teachers.failing.length + ' subjects are below 60%; ' + m.teachers.pledges.length + ' pledge(s) will be signed to raise them.');
    }
    if (m.improvers.length) keyLines.push(lang === 'sw' ? 'Wanafunzi ' + m.improvers.length + ' wameimarika kwa kiwango kikubwa na wanatambuliwa katika taarifa hii.' : m.improvers.length + ' learners improved strongly and are recognised in this report.');
    callout(L.keyMessage, keyLines.join(' '), 'gold');

    // Mini class chart on the cover.
    const rowsC = m.active;
    const chH = 11 + rowsC.length * 5.2;
    stroke(C.line); fill(C.white); doc.roundedRect(M, y, CW, chH, 3, 3, 'FD');
    ink(C.navy); font('bold', 9); doc.text(L.classBars, M + 4, y + 6);
    const bx0 = M + 30; const bx1 = M + CW - 18; const span = bx1 - bx0;
    rowsC.forEach((c, i) => {
      const ry = y + 9 + i * 5.2;
      ink(C.ink); font('normal', 7.6); doc.text(c.className, bx0 - 2.5, ry + 3.2, { align: 'right' });
      fill(C.soft); doc.roundedRect(bx0, ry + 0.8, span, 3.2, 1.4, 1.4, 'F');
      fill(C[toneOf(c.average)]); doc.roundedRect(bx0, ry + 0.8, Math.max(1.5, span * c.average / 100), 3.2, 1.4, 1.4, 'F');
      ink(C.ink); font('bold', 7.4); doc.text(pct(c.average), bx0 + span * c.average / 100 + 1.8, ry + 3.4);
    });
    const avx = bx0 + span * s.average / 100;
    stroke(C.gold); doc.setLineWidth(0.5); doc.setLineDashPattern([1, 0.8], 0); doc.line(avx, y + 8.5, avx, y + chH - 1.5); doc.setLineDashPattern([], 0); doc.setLineWidth(0.2);
    y += chH + 5;

    ink(C.navy); font('bold', 9.5); doc.text(L.contents, M, y + 3); y += 5.5;
    const secList = L.sections;
    const half = Math.ceil(secList.length / 2);
    secList.forEach((name, i) => {
      const cx = M + (i < half ? 0 : CW / 2); const cy = y + (i % half) * 4.5;
      ink(C.gold); font('bold', 8); doc.text(String(i + 1).padStart(2, '0'), cx, cy + 3);
      ink(C.ink); font('normal', 8); doc.text(name, cx + 7, cy + 3);
    });
    stroke(C.line); doc.line(M, 281, W - M, 281);
    ink(C.muted); font('normal', 7.6);
    const leaders = (assets && assets.leaders || []).filter(Boolean);
    doc.text(L.preparedBy + (leaders.length ? ': ' + leaders.join(' & ') : ''), M, 286);
    doc.text(L.printed + ': ' + formatDate(localIso(), lang), W - M, 286, { align: 'right' });

    // ================================================================ body
    function classCard(cl) {
      const tone = cl.tone === 'good' ? 'green' : cl.tone === 'mid' ? 'amber' : 'red';
      const wrapped = cl.lines.map((ln, i) => { font(i === 0 ? 'bold' : 'normal', 9.3); return split(ln, CW - 12); });
      const h = 10.5 + wrapped.reduce((sum, w) => sum + w.length * 3.95 + 0.9, 0);
      ensure(h + 3);
      fill(tintOf(tone)); doc.roundedRect(M, y, CW, h, 3, 3, 'F');
      fill(C[tone]); doc.rect(M, y, 2.4, h, 'F');
      ink(C[tone]); font('bold', 10.5); doc.text(cl.className, M + 7, y + 6.3);
      let ty = y + 11.3;
      wrapped.forEach((w, i) => { ink(C.ink); font(i === 0 ? 'bold' : 'normal', 9.3); doc.text(w, M + 7, ty); ty += w.length * 3.95 + 0.9; });
      y += h + 3;
    }
    function signatureRow(titles) {
      ensure(34);
      const sw3 = (CW - 8) / titles.length;
      titles.forEach((title, i) => {
        const sx = M + i * (sw3 + 4);
        fill(C.white); stroke(C.line); doc.roundedRect(sx, y, sw3, 30, 3, 3, 'FD');
        ink(C.navy); font('bold', 8.4); doc.text(title, sx + 4, y + 6);
        ink(C.muted); font('normal', 7.6);
        [L.signName, L.signSign].forEach((lab, k) => {
          doc.text(lab + ':', sx + 4, y + 15 + k * 9);
          stroke([203, 213, 225]); doc.line(sx + 19, y + 15.4 + k * 9, sx + sw3 - 4, y + 15.4 + k * 9);
        });
      });
      y += 35;
    }
    function pledgeBox(p, n) {
      font('normal', 8.7);
      const lines = split(pledgeText(p, lang), CW - 22);
      const h = 7 + lines.length * 3.75 + 10;
      ensure(h + 2.5);
      const tone = p.unassigned ? C.red : C.amber;
      fill(C.white); stroke(C.line); doc.roundedRect(M, y, CW, h, 2.5, 2.5, 'FD');
      fill(tone); doc.roundedRect(M, y, 14, h, 2.5, 2.5, 'F'); doc.rect(M + 10, y, 4, h, 'F');
      ink(C.white); font('bold', 6.4); doc.text(X.pledgeLabel, M + 7, y + 6, { align: 'center' });
      font('bold', 13); doc.text(String(n), M + 7, y + 13.5, { align: 'center' });
      ink(C.ink); font('normal', 8.7); doc.text(lines, M + 18, y + 6);
      const sy = y + 7 + lines.length * 3.75 + 5;
      ink(C.muted); font('normal', 7.6);
      const cols = [[L.signSign, M + 18], [L.signDate, M + 78], [lang === 'sw' ? 'Shahidi (Mwalimu wa Taaluma)' : 'Witness (Academic Teacher)', M + 118]];
      cols.forEach(([lab, x], k) => {
        doc.text(lab + ':', x, sy);
        const end = k === 2 ? M + CW - 4 : cols[k + 1][1] - 4;
        stroke([203, 213, 225]); doc.line(x + doc.getTextWidth(lab + ':') + 2, sy + 0.4, end, sy + 0.4);
      });
      y += h + 2.5;
    }

    addPage();
    section(1, L.sections[0]);
    words.intro.forEach((t) => para(t));
    if (m.anomalies.length) {
      subheading(X.anomTitle);
      table(X.anomHead,
        m.anomalies.map((a) => [a.className, a.examLabel + ' / ' + L.monthWord(monthIndex(a.monthKey)), titleName(a.name) + (a.onRoll ? '' : ' ' + X.notOnRoll), a.subject, a.teacher ? shortName(a.teacher) : X.noTeacher, Number(a.score).toLocaleString('en-US'), String(a.max)]),
        { headColor: C.red, fontSize: 8, columnStyles: { 5: { halign: 'right', textColor: C.red, fontStyle: 'bold' }, 6: { halign: 'center' } } });
    }

    section(2, L.sections[1]);
    words.overall.forEach((t) => para(t));
    gradeStrip();
    const trendSeries = [];
    if (m.trend.primary.length >= 2) trendSeries.push({ name: L.primary, color: C.teal, points: m.trend.primary });
    if (m.trend.pre.length >= 2) trendSeries.push({ name: L.pre, color: C.gold, points: m.trend.pre });
    if (trendSeries.length) lineChart(L.trendTitle, trendSeries);

    section(3, L.sections[2]);
    hbars(L.classBars, m.active.map((c) => ({ label: c.className, value: c.average })), { avgLine: s.average });
    ink(C.muted); font('normal', 7.6); doc.text(L.legend, M, y - 1); y += 4;
    table(
      [L.col.cls, L.col.learners, L.col.scored, L.col.avg, L.col.grade, L.col.att, L.col.ct],
      m.active.map((c) => [c.className, String(c.learners), String(c.scoredCount), pct(c.average), c.grade, c.attendancePct ? pct(c.attendancePct) : '-', shortName(c.classTeacher) || '-']),
      { columnStyles: { 1: { halign: 'center' }, 2: { halign: 'center' }, 3: { halign: 'center' }, 4: { halign: 'center' }, 5: { halign: 'center' } }, didParseCell: toneCell(3, (i) => m.active[i] && m.active[i].average) }
    );
    words.classLines.forEach(classCard);

    section(4, L.sections[3]);
    words.subjects.forEach((t) => para(t));
    if (m.subjects.weak.length) {
      subheading(L.weakSubjects);
      table([L.col.cls, L.col.subject, L.col.teacher, L.col.avg],
        m.subjects.weak.map((x) => [x.className, x.subject, x.teacher === NOT_MAPPED ? X.noTeacher : shortName(x.teacher), pct(x.avg)]),
        { headColor: C.red, columnStyles: { 3: { halign: 'center', fontStyle: 'bold', textColor: C.red } } });
    }
    if (m.subjects.strong.length) {
      subheading(L.strongSubjects);
      table([L.col.cls, L.col.subject, L.col.teacher, L.col.avg],
        m.subjects.strong.map((x) => [x.className, x.subject, x.teacher === NOT_MAPPED ? X.noTeacher : shortName(x.teacher), pct(x.avg)]),
        { headColor: C.teal, columnStyles: { 3: { halign: 'center', fontStyle: 'bold', textColor: C.green } } });
    }

    section(5, L.sections[4]);
    para(words.top);
    const topHead = [L.col.pos, L.col.name, L.col.cls, L.col.avg, (lang === 'sw' ? 'Mitihani aliyofanya' : 'Exams sat'), (lang === 'sw' ? 'Mahudhurio' : 'Attendance'), L.col.grade];
    const topRow = (st) => [String(st.position), titleName(st.name), st.className, pct(st.overallPct), st.papersSat + '/' + st.papersMax, st.attendancePct ? pct(st.attendancePct) : '-', gradeOf(st.overallPct)];
    const topCols = { 0: { halign: 'center', cellWidth: 15, fontStyle: 'bold' }, 3: { halign: 'center', fontStyle: 'bold', textColor: C.teal }, 4: { halign: 'center' }, 5: { halign: 'center' }, 6: { halign: 'center' } };
    const explainBox = (lines) => { if (lines.length) callout(lang === 'sw' ? 'Maelezo ya nafasi hizi' : 'Why these positions', lines.join('  '), 'navy'); };
    if (m.schoolTop.length) {
      subheading(L.topPrimary);
      table(topHead, m.schoolTop.map(topRow),
        { headColor: C.teal, fontSize: 8.2, columnStyles: topCols,
          didParseCell: (d) => { if (d.section === 'body' && d.row.index < 3) { d.cell.styles.fillColor = C.goldTint; } } });
      explainBox(words.rankExplainPrimary);
    }
    if (m.preTop.length) {
      subheading(L.topPre);
      table(topHead, m.preTop.map(topRow), { headColor: C.gold, fontSize: 8.2, columnStyles: topCols });
      explainBox(words.rankExplainPre);
    }
    subheading(L.topPerClass);
    miniCardsTopPerClass(m.active);

    section(6, L.sections[5]);
    para(words.improvers);
    if (m.improvers.length) {
      table([L.col.name, L.col.cls, L.col.start, L.col.latest, L.col.gain],
        m.improvers.map((r) => [titleName(r.name), r.className, L.monthWord(r.firstMonth) + ': ' + pct(r.firstPct), L.monthWord(r.lastMonth) + ': ' + pct(r.lastPct), '+' + r.gain.toFixed(1)]),
        { headColor: C.green, columnStyles: { 4: { halign: 'center', fontStyle: 'bold', textColor: C.green } } });
      para(lang === 'sw'
        ? 'Kanuni: tunalinganisha mwezi wa kwanza na wa mwisho ambao mwanafunzi alipimwa (angalau miezi miwili tofauti, na masomo ya kutosha kila mwezi). Ongezeko lazima liwe angalau alama 10 na liwe kubwa kuliko la wenzake wa darasa moja.'
        : 'Rule: first and latest assessed months (at least two months apart, enough subjects each month). Gain must be at least 10 points and larger than the class\'s own movement.', { size: 8.4, color: C.muted });
    } else {
      callout(null, L.noImprovers, 'navy');
    }

    section(7, L.sections[6]);
    words.teachers.forEach((t) => para(t));
    if (m.teachers.failing.length) {
      subheading(X.failingTitle);
      const fl = m.teachers.failing;
      table(X.failingHead,
        fl.map((r) => [r.className, r.subject, r.teacher === NOT_MAPPED ? X.noTeacher : shortName(r.teacher), pct(r.avg), (r.gap >= 0 ? '+' : '') + r.gap.toFixed(1), r.below40 + ' / ' + r.learners, r.target + '%']),
        { fontSize: 8, headColor: C.red,
          columnStyles: { 3: { halign: 'center', fontStyle: 'bold' }, 4: { halign: 'center' }, 5: { halign: 'center' }, 6: { halign: 'center', fontStyle: 'bold', textColor: C.teal } },
          didParseCell: (d) => {
            if (d.section !== 'body') return;
            const r = fl[d.row.index]; if (!r) return;
            if (d.column.index === 3) d.cell.styles.textColor = C[toneOf(r.avg)];
            if (d.column.index === 2 && r.teacher === NOT_MAPPED) { d.cell.styles.textColor = C.red; d.cell.styles.fontStyle = 'bold'; }
          } });
      ink(C.muted); font('normal', 7.4);
      doc.text(lang === 'sw' ? '"Na darasa" = tofauti kati ya somo na wastani wa darasa lake. "Chini ya 40%" = wanafunzi walio chini ya 40% kati ya waliofanya.' : '"vs class" = subject minus its class average. "Below 40%" = learners under 40% of those assessed.', M, y - 1.5);
      y += 3;
    }
    if (words.teacherProfiles.length) {
      subheading(X.profilesTitle);
      words.teacherProfiles.forEach((p) => callout(shortName(p.teacher) + '  -  ' + pct(p.avg), p.text, p.avg < 50 ? 'red' : 'amber'));
    }
    (words.teachersTail || []).forEach((t) => para(t));
    if (mode !== 'committee' && m.teachers.rows.length) {
      const hasEffort = m.teachers.rows.some((r) => r.attendancePct != null || r.lateDays > 0);
      subheading(hasEffort ? 'All teacher blocks (subject results, worker attendance)' : 'All teacher blocks (subject results)');
      table(['Teacher', 'Classes', 'Average', 'vs class'].concat(hasEffort ? ['Attendance', 'Late'] : []),
        m.teachers.rows.map((r) => [shortName(r.teacher), r.classes.join(', '), pct(r.avg), (r.gap >= 0 ? '+' : '') + r.gap.toFixed(1)]
          .concat(hasEffort ? [r.attendancePct == null ? '-' : pct(r.attendancePct), String(r.lateDays || 0)] : [])),
        { fontSize: 8, columnStyles: { 2: { halign: 'center' }, 3: { halign: 'center' }, 4: { halign: 'center' }, 5: { halign: 'center' } }, didParseCell: toneCell(2, (i) => m.teachers.rows[i] && m.teachers.rows[i].avg) });
    }

    section(8, L.sections[7]);
    words.attendance.forEach((t) => para(t));
    const attRows = m.active.filter((c) => c.attendancePct > 0).map((c) => ({ label: c.className, value: c.attendancePct, color: c.attendancePct >= 92 ? C.teal : c.attendancePct >= 85 ? C.amber : C.red }));
    if (attRows.length) hbars(L.attBars, attRows, { min: 70, max: 100, ticks: [70, 80, 90, 100] });

    section(9, L.sections[8]);
    words.fees.forEach((t) => para(t));
    if (f) {
      subheading(L.feeTable);
      table(X.feeHead,
        f.classes.map((c) => [c.className, String(c.roll), String(c.cleared), String(c.debtorCount), c.owed > 0 ? money(c.owed) : '-', c.advance > 0.5 ? money(c.advance) : '-', money(c.net), String(c.overdueCount)]),
        { headColor: C.navy, fontSize: 7.8, foot: [L.col.total, String(f.roll), String(f.cleared), String(f.debtors), money(f.owed), money(f.advance), money(f.net), String(f.overdueCount)],
          columnStyles: { 1: { halign: 'center' }, 2: { halign: 'center', textColor: C.green, fontStyle: 'bold' }, 3: { halign: 'center' }, 4: { halign: 'right' }, 5: { halign: 'right' }, 6: { halign: 'right', fontStyle: 'bold' }, 7: { halign: 'center' } } });
      const maxOwed = Math.max(1, ...f.classes.map((c) => c.owed));
      hbars(lang === 'sw' ? 'Kiasi wanachodaiwa wazazi kwa darasa' : 'Amount owed by class',
        f.classes.map((c) => ({ label: c.className, value: (c.owed * 78) / maxOwed, text: c.owed > 0 ? money(c.owed) : '-', color: C.gold })),
        { ticks: [], labelW: 30 });
      subheading(X.callTitle);
      table(X.callHead,
        f.largestDebtors.map((d, i) => [String(i + 1), d.name, d.className, d.parent || '-', d.contact || '-', money(d.balance), '']),
        { headColor: C.red, fontSize: 8, columnStyles: { 0: { cellWidth: 9, halign: 'center' }, 5: { halign: 'right', fontStyle: 'bold', cellWidth: 25 }, 6: { cellWidth: 26 } } });

      // Full list, grouped by class, largest first; first five per class shaded.
      currentSection = X.fullTitle;
      if (y + 60 > BOTTOM) addPage(); else y += 3;
      subheading(X.fullTitle);
      para(X.fullNote, { size: 8.4, color: C.muted });
      const fullRows = []; const groupRows = []; const topRows = [];
      f.classes.filter((c) => c.debtorCount).forEach((c) => {
        groupRows.push(fullRows.length);
        fullRows.push([{ content: c.className + '   -   ' + (lang === 'sw' ? 'wenye salio ' : 'with balance ') + c.debtorCount + '   -   ' + money(c.owed), colSpan: 6 }]);
        c.debtors.forEach((d, i) => {
          if (i < 5) topRows.push(fullRows.length);
          fullRows.push([String(i + 1), d.name, d.parent || '-', [d.contact, d.contact2].filter(Boolean).join(' / ') || '-', money(d.balance), '']);
        });
      });
      table(X.fullHead, fullRows, {
        fontSize: 7.9,
        columnStyles: { 0: { cellWidth: 9, halign: 'center' }, 4: { halign: 'right', fontStyle: 'bold', cellWidth: 25 }, 5: { cellWidth: 30 } },
        didParseCell: (d) => {
          if (d.section !== 'body') return;
          if (groupRows.includes(d.row.index)) { d.cell.styles.fillColor = C.navyTint; d.cell.styles.fontStyle = 'bold'; d.cell.styles.textColor = C.navy; }
          else if (topRows.includes(d.row.index)) { d.cell.styles.fillColor = C.goldTint; }
        }
      });
      para(lang === 'sw' ? 'Orodha hii imehakikiwa na:' : 'List verified by:', { size: 9, bold: true });
      signatureRow(X.listSign);
    }

    section(10, L.sections[9]);
    table(X.resHead,
      words.resolutions.map((r, i) => [String(i + 1), r.action, r.owner, r.due, r.measure]),
      { headColor: C.teal, fontSize: 7.9,
        columnStyles: { 0: { cellWidth: 9, halign: 'center', fontStyle: 'bold' }, 1: { cellWidth: 70 }, 2: { cellWidth: 30, fontStyle: 'bold', textColor: C.navy }, 3: { cellWidth: 30 } } });
    callout(null, words.resolutionsNote, 'navy');

    section(11, L.sections[10]);
    para(words.pledgeIntro);
    m.teachers.pledges.forEach((p, i) => pledgeBox(p, i + 1));

    section(12, L.sections[11]);
    para(words.closing);
    ensure(52);
    y += 4;
    const sw3 = (CW - 8) / 3;
    L.signatures.forEach((title, i) => {
      const sx = M + i * (sw3 + 4);
      fill(C.white); stroke(C.line); doc.roundedRect(sx, y, sw3, 42, 3, 3, 'FD');
      ink(C.navy); font('bold', 8.8); doc.text(title, sx + 4, y + 7);
      ink(C.muted); font('normal', 7.8);
      [L.signName, L.signSign, L.signDate].forEach((lab, k) => {
        doc.text(lab + ':', sx + 4, y + 17 + k * 9);
        stroke([203, 213, 225]); doc.line(sx + 19, y + 17.4 + k * 9, sx + sw3 - 4, y + 17.4 + k * 9);
      });
    });
    y += 48;

    // ================================================================ appendices (teachers only)
    if (mode !== 'committee') {
      const weakRows = m.active.flatMap((c) => c.weakLearners.map((st) => [c.className, titleName(st.name), pct(st.overallPct), st.attendancePct ? pct(st.attendancePct) : '-', num(st.fee && st.fee.balance) > 0.5 ? money(st.fee.balance) : 'Clear']));
      if (weakRows.length) {
        currentSection = 'Appendix - Learner support list';
        addPage();
        ink(C.amber); font('bold', 14); doc.text('Appendix - Learners at grade D or F (support list)', M, y + 6); y += 11;
        para('Learners who sat at least half of their class\'s exams and average below 40.5% (grade D or F). Each needs a named teacher, small-group support and a parent meeting.', { size: 9.4 });
        table(['Class', 'Learner', 'Average', 'Attendance', 'Fee balance'], weakRows, { headColor: C.amber, fontSize: 8.2, columnStyles: { 2: { halign: 'center', textColor: C.red, fontStyle: 'bold' }, 3: { halign: 'center' }, 4: { halign: 'right' } } });
      }
      if (m.drops.length) {
        subheading('Biggest drops (first vs latest assessed month)');
        table(['Learner', 'Class', 'First', 'Latest', 'Change'],
          m.drops.map((r) => [titleName(r.name), r.className, MONTHS_EN[r.firstMonth] + ': ' + pct(r.firstPct), MONTHS_EN[r.lastMonth] + ': ' + pct(r.lastPct), r.gain.toFixed(1)]),
          { headColor: C.red, fontSize: 8.2, columnStyles: { 4: { halign: 'center', textColor: C.red, fontStyle: 'bold' } } });
      }
      const notes = [];
      m.dataNotes.unscored.forEach((u) => notes.push(u.className + ': ' + u.count + ' learner(s) on the roll have no mark in this window.'));
      if (m.teachers.unmappedList.length) notes.push('No teacher mapped: ' + m.teachers.unmappedList.map((u) => u.subject + ' ' + u.className).join(', ') + '.');
      s.noAttendance.forEach((c) => notes.push(c + ': no attendance register found for the window.'));
      if (notes.length) {
        subheading('Data notes for the Academic Office');
        notes.forEach((n) => para('- ' + n, { size: 9 }));
      }
    }

    // ================================================================ header / footer on every body page
    const total = doc.getNumberOfPages();
    for (let p = 2; p <= total; p += 1) {
      doc.setPage(p);
      fill(C.navy); doc.rect(0, 0, W, 13, 'F');
      fill(C.gold); doc.rect(0, 13, W, 0.8, 'F');
      ink(C.white); font('bold', 8.8); doc.text(m.schoolName, M, 8.5);
      ink([203, 213, 225]); font('normal', 8.2); doc.text(sectionOfPage[p] || '', W - M, 8.5, { align: 'right' });
      stroke(C.line); doc.setLineWidth(0.2); doc.line(M, H - 12, W - M, H - 12);
      ink(C.muted); font('normal', 7.4);
      doc.text(L.meeting + '  |  ' + period, M, H - 7);
      doc.text(L.confidential, W / 2 + 18, H - 7, { align: 'center' });
      doc.text(L.page + ' ' + p + ' / ' + total, W - M, H - 7, { align: 'right' });
    }
    return doc;
  }

  async function downloadPdf(report, mode, assets) {
    const m = report && report.meeting;
    if (!m) throw new Error('Meeting data not ready. Run the whole-school report again.');
    const doc = createPdf(m, mode, assets);
    const tag = mode === 'committee' ? 'Kamati_ya_Shule' : 'Academic_Meeting';
    const school = String(m.schoolName || 'School').replace(/[^A-Za-z0-9]+/g, '_');
    doc.save(school + '_' + tag + '_' + m.filters.fromDate + '_to_' + m.filters.toDate + '.pdf');
  }

  // ---------------------------------------------------------------- on-screen brief
  function esc(v) { return String(v == null ? '' : v).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }

  // ---------------------------------------------------------------- pledges saved to SoMAp
  // Path: academicCommitments/{year}/{key} (school-scoped via SOMAP.P). The teacher dashboard
  // (shared/academic_commitments_reminder.js) reminds each teacher until the deadline.
  const slugKey = (v) => String(v || '').toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 60) || 'X';
  function commitmentsRef(year, key) {
    const db = global.firebase && global.firebase.database ? global.firebase.database() : null;
    if (!db) return null;
    const path = 'academicCommitments/' + year + (key ? '/' + key : '');
    return db.ref(global.SOMAP && global.SOMAP.P ? global.SOMAP.P(path) : path);
  }
  function pledgeKey(m, p) {
    const subject = (p.items || []).map((i) => i.subject + '_' + i.className).join('_');
    return slugKey(m.meetingDate + '_' + (p.teacher || 'UNASSIGNED_' + subject));
  }

  function renderCommitments(box, m, lang, opts) {
    const sw = lang === 'sw';
    const pledges = m.teachers.pledges || [];
    if (!pledges.length) { box.innerHTML = ''; return; }
    const canSave = Boolean(opts && opts.canSave);
    const itemsText = (p) => [(p.items || []).map((i) => i.subject + ' ' + i.className + ' ' + pct(i.avg)).join(', '), p.classRole ? (sw ? 'Darasa ' : 'Class ') + p.classRole.className + ' ' + pct(p.classRole.avg) : ''].filter(Boolean).join(' | ');
    box.innerHTML = '<div class="mt-5 rounded-2xl border border-amber-200 bg-white p-4">'
      + '<div class="flex flex-wrap items-center justify-between gap-2"><div><div class="text-sm font-semibold text-slate-900">' + esc(sw ? 'Ahadi za walimu (jaza baada ya kikao kutoka kwenye karatasi iliyosainiwa)' : 'Teacher pledges (enter from the signed paper after the meeting)') + '</div>'
      + '<div class="text-xs text-slate-500 mt-1">' + esc(sw ? 'Ikihifadhiwa, mwalimu ataona ukumbusho kwenye ukurasa wake kila siku hadi tarehe ya mwisho.' : 'Once saved, the teacher sees a reminder on their dashboard every day until the deadline.') + '</div></div>'
      + (canSave ? '' : '<span class="mini-chip">' + esc(sw ? 'Mwalimu wa Taaluma / Mwalimu Mkuu pekee' : 'Academic Teacher / Head only') + '</span>') + '</div>'
      + '<div class="mt-3 space-y-3">' + pledges.map((p, i) => '<div class="rounded-xl border border-slate-200 p-3" data-pledge="' + i + '">'
        + '<div class="flex flex-wrap items-center gap-2 text-sm"><span class="mini-chip" style="background:' + (p.unassigned ? '#fee2e2;color:#991b1b' : '#fef3c7;color:#92400e') + '">' + (i + 1) + '</span>'
        + (p.unassigned
          ? '<input data-f="teacher" class="soft-input" style="max-width:260px;padding:.45rem .7rem" placeholder="' + esc(sw ? 'Jina la mwalimu' : 'Teacher name') + '">'
          : '<strong>' + esc(shortName(p.teacher)) + '</strong>')
        + '<span class="text-slate-500">' + esc(itemsText(p)) + '</span></div>'
        + '<div class="grid sm:grid-cols-[110px_110px_1fr_auto] gap-2 mt-2">'
        + '<input data-f="days" type="number" min="1" class="soft-input" style="padding:.45rem .7rem" placeholder="' + esc(sw ? 'Siku' : 'Days') + '">'
        + '<input data-f="target" type="number" min="1" max="100" class="soft-input" style="padding:.45rem .7rem" placeholder="' + esc((sw ? 'Lengo % (min ' : 'Target % (min ') + p.target + ')') + '">'
        + '<input data-f="consequence" class="soft-input" style="padding:.45rem .7rem" placeholder="' + esc(sw ? 'Nisipotimiza, naomba...' : 'If I fail, I ask that...') + '">'
        + '<button data-f="save" class="px-3 py-2 rounded-xl bg-slate-900 text-white text-sm"' + (canSave ? '' : ' disabled style="opacity:.45"') + '>' + esc(sw ? 'Hifadhi' : 'Save') + '</button>'
        + '</div><div data-f="status" class="text-xs text-slate-500 mt-1"></div></div>').join('') + '</div></div>';

    const ref = commitmentsRef(m.filters.year);
    // Prefill from anything already saved for this meeting.
    if (ref) {
      ref.once('value').then((snap) => {
        const saved = (snap && snap.val && snap.val()) || {};
        pledges.forEach((p, i) => {
          const row = box.querySelector('[data-pledge="' + i + '"]');
          const rec = saved[pledgeKey(m, p)];
          if (!row || !rec) return;
          if (rec.teacher && row.querySelector('[data-f="teacher"]')) row.querySelector('[data-f="teacher"]').value = rec.teacher;
          row.querySelector('[data-f="days"]').value = rec.days || '';
          row.querySelector('[data-f="target"]').value = rec.targetPct || '';
          row.querySelector('[data-f="consequence"]').value = rec.consequence || '';
          row.querySelector('[data-f="status"]').textContent = (sw ? 'Imehifadhiwa. Mwisho: ' : 'Saved. Deadline: ') + formatDate(rec.deadline, lang);
        });
      }).catch(() => {});
    }
    box.querySelectorAll('[data-f="save"]').forEach((btn) => btn.addEventListener('click', async () => {
      const row = btn.closest('[data-pledge]');
      const p = pledges[Number(row.getAttribute('data-pledge'))];
      const status = row.querySelector('[data-f="status"]');
      const teacherInput = row.querySelector('[data-f="teacher"]');
      const teacher = p.teacher || (teacherInput ? teacherInput.value.trim().toUpperCase() : '');
      const days = Math.round(Number(row.querySelector('[data-f="days"]').value));
      const targetPct = Number(row.querySelector('[data-f="target"]').value);
      const consequence = row.querySelector('[data-f="consequence"]').value.trim();
      if (!teacher) { status.textContent = sw ? 'Andika jina la mwalimu.' : 'Enter the teacher name.'; return; }
      if (!(days > 0) || !(targetPct > 0 && targetPct <= 100)) { status.textContent = sw ? 'Jaza siku na lengo (%) kama zilivyoandikwa kwenye karatasi.' : 'Fill days and target (%) as written on the paper.'; return; }
      const r = commitmentsRef(m.filters.year, pledgeKey(m, { ...p, teacher: p.teacher || '' }));
      if (!r) { status.textContent = 'Database not available.'; return; }
      const record = {
        teacher,
        workerId: p.workerId || (opts && opts.resolveWorkerId ? opts.resolveWorkerId(teacher) || '' : ''),
        roles: p.roles || ['subject'],
        items: (p.items || []).map((i) => ({ className: i.className, subject: i.subject, baselinePct: Math.round(i.avg * 10) / 10 })),
        classRole: p.classRole ? { className: p.classRole.className, baselinePct: Math.round(p.classRole.avg * 10) / 10 } : null,
        baselinePct: Math.round(num(p.baseline) * 10) / 10,
        minimumTargetPct: p.target,
        targetPct,
        days,
        consequence,
        meetingDate: m.meetingDate,
        deadline: isoPlusDays(m.meetingDate, days),
        window: { from: m.filters.fromDate, to: m.filters.toDate },
        status: 'active',
        savedBy: (opts && opts.savedBy) || '',
        savedAt: Date.now()
      };
      btn.disabled = true;
      try {
        await r.set(record);
        status.textContent = (sw ? 'Imehifadhiwa. Mwisho: ' : 'Saved. Deadline: ') + formatDate(record.deadline, lang);
      } catch (err) {
        status.textContent = (sw ? 'Imeshindikana: ' : 'Failed: ') + (err && err.message || err);
      } finally { btn.disabled = false; }
    }));
  }

  function renderBrief(el, report, mode, opts) {
    if (!el) return;
    const m = report && report.meeting;
    if (!m) { el.classList.add('hidden'); el.innerHTML = ''; return; }
    const lang = mode === 'committee' ? 'sw' : 'en';
    const L = LABELS[lang];
    const w = narrative(m, lang);
    const s = m.summary; const f = m.fees;
    const toneText = { green: 'text-emerald-700', amber: 'text-amber-700', red: 'text-red-700' };
    const card = (label, value, note, tone) => '<div class="rounded-2xl bg-white border border-slate-200 p-4 shadow-sm"><div class="text-[11px] uppercase tracking-[0.14em] text-slate-500 font-semibold">' + esc(label) + '</div><div class="text-2xl font-bold mt-1 ' + (toneText[tone] || 'text-slate-900') + '">' + esc(value) + '</div><div class="text-xs text-slate-500 mt-1">' + esc(note) + '</div></div>';
    const g = gradeOf(s.average);
    const list = (rows, fmt) => rows.length ? '<ol class="space-y-1.5 mt-3">' + rows.map(fmt).join('') + '</ol>' : '<p class="text-sm text-slate-500 mt-3">-</p>';
    const html = [
      '<div class="rounded-[28px] border border-amber-200 bg-gradient-to-br from-white via-amber-50/40 to-teal-50/40 p-5 shadow-sm">',
      '<div class="flex flex-wrap items-start justify-between gap-3"><div><p class="text-xs uppercase tracking-[0.16em] text-amber-700 font-semibold">' + esc(L.meeting) + '</p>',
      '<h3 class="text-xl font-semibold text-slate-900 mt-1">' + esc(L.title1 + ' ' + L.title2) + '</h3>',
      '<p class="text-sm text-slate-600 mt-1">' + esc(formatDate(m.filters.fromDate, lang) + ' - ' + formatDate(m.filters.toDate, lang)) + '</p></div>',
      '<span class="mini-chip">' + (mode === 'committee' ? 'Kiswahili' : 'English') + '</span></div>',
      '<div class="grid grid-cols-2 lg:grid-cols-4 gap-3 mt-4">',
      card(L.card.avg[0], pct(s.average), L.card.avg[1](g, GRADE_WORDS[lang][g]), toneOf(s.average)),
      card(L.card.best[0], s.bestClass ? s.bestClass.className : '-', s.bestClass ? L.card.best[1](pct(s.bestClass.average)) : '', 'green'),
      card(L.card.weak[0], s.weakClass ? s.weakClass.className : '-', s.weakClass ? L.card.weak[1](pct(s.weakClass.average)) : '', s.weakClass ? toneOf(s.weakClass.average) : ''),
      card(L.card.owed[0], f ? money(f.net) : '-', f ? L.card.owed[1](f.debtors) + ' | ' + L.card.cleared[0] + ': ' + f.cleared : '', 'amber'),
      '</div>',
      '<div class="mt-4 space-y-2 text-sm text-slate-700">' + w.overall.slice(0, 3).map((t) => '<p>' + esc(t) + '</p>').join('') + '</div>',
      '<div class="grid lg:grid-cols-3 gap-4 mt-5">',
      '<article class="watch-card p-4"><div class="text-sm font-semibold text-slate-900">' + esc(L.topPrimary) + '</div>' + list(m.schoolTop, (st) => '<li class="text-sm flex justify-between gap-2"><span><strong>' + st.position + '.</strong> ' + esc(titleName(st.name)) + ' <span class="text-slate-500">' + esc(st.className) + '</span></span><span class="font-semibold text-emerald-700">' + pct(st.overallPct) + '</span></li>') + '</article>',
      '<article class="watch-card p-4"><div class="text-sm font-semibold text-slate-900">' + esc(L.sections[5]) + '</div>' + list(m.improvers, (r) => '<li class="text-sm flex justify-between gap-2"><span>' + esc(titleName(r.name)) + ' <span class="text-slate-500">' + esc(r.className) + '</span><span class="block text-xs text-slate-500">' + esc(L.monthWord(r.firstMonth) + ' ' + pct(r.firstPct) + ' > ' + L.monthWord(r.lastMonth) + ' ' + pct(r.lastPct)) + '</span></span><span class="font-semibold text-emerald-700">+' + r.gain.toFixed(1) + '</span></li>') + '</article>',
      '<article class="watch-card p-4"><div class="text-sm font-semibold text-slate-900">' + esc(L.sections[6]) + '</div>' + w.teachers.map((t) => '<p class="text-sm text-slate-700 mt-2">' + esc(t) + '</p>').join('') +
        (m.teachers.support.length ? '<div class="flex flex-wrap gap-2 mt-3">' + m.teachers.support.map((r) => '<span class="mini-chip" style="background:#fef3c7;color:#92400e">' + esc(shortName(r.teacher)) + ' ' + pct(r.avg) + '</span>').join('') + '</div>' : '') + '</article>',
      '</div>',
      f ? '<div class="mt-5 overflow-x-auto"><div class="text-sm font-semibold text-slate-900 mb-2">' + esc(L.feeTable) + '</div><table class="data-table"><thead><tr><th>' + esc(L.col.cls) + '</th><th>' + esc(L.col.learners) + '</th><th>' + esc(L.col.cleared) + '</th><th>' + esc(L.col.debtors) + '</th><th>' + esc(L.col.owed) + '</th><th>' + esc(L.col.late) + '</th></tr></thead><tbody>' +
        f.classes.map((c) => '<tr><td class="font-semibold">' + esc(c.className) + '</td><td>' + c.roll + '</td><td class="text-emerald-700 font-semibold">' + c.cleared + '</td><td>' + c.debtorCount + '</td><td class="font-semibold">' + (c.owed > 0 ? money(c.owed) : '-') + '</td><td>' + c.overdueCount + '</td></tr>').join('') +
        '<tr class="bg-amber-50 font-semibold"><td>' + esc(L.col.total) + '</td><td>' + f.roll + '</td><td>' + f.cleared + '</td><td>' + f.debtors + '</td><td>' + money(f.owed) + '</td><td>' + f.overdueCount + '</td></tr></tbody></table></div>' : '',
      (mode !== 'committee' && m.anomalies.length) ? '<div class="mt-4 rounded-2xl bg-red-50 border border-red-200 p-4 text-sm text-red-800"><strong>' + m.anomalies.length + ' mark(s) above the exam maximum were excluded:</strong> ' + m.anomalies.map((a) => esc(a.className + ' ' + a.subject + ' (' + a.monthKey + ') ' + titleName(a.name) + ': ' + Number(a.score).toLocaleString('en-US') + '/' + a.max)).join('; ') + '</div>' : '',
      '</div>'
    ].join('');
    el.innerHTML = html + '<div data-commitments></div>';
    el.classList.remove('hidden');
    try { renderCommitments(el.querySelector('[data-commitments]'), m, lang, opts); } catch (err) { console.warn('[meeting] pledges panel failed', err); }
  }

  global.SomapAcademicMeeting = Object.assign(global.SomapAcademicMeeting || {}, {
    buildMeeting,
    narrative,
    createPdf,
    downloadPdf,
    renderBrief,
    helpers: { pct, money, gradeOf, formatDate, monthName, shortName, titleName, listJoin, GRADE_WORDS, MONTHS_SW, MONTHS_EN }
  });
}(typeof window !== 'undefined' ? window : globalThis));
