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
    const eligible = scored.filter((s) => (s.examSeries || []).length >= Math.ceil(0.8 * maxExams)
      && num(s.attemptedCount) >= Math.ceil(0.8 * maxSubjects));
    const ranked = rankRows(eligible, (s) => num(s.overallPct));

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
   */
  function analyseTeachers(classes, report, groupAverage) {
    const map = new Map();
    classes.forEach((c) => {
      if (!(c.scoredCount > 0)) return;
      const perTeacher = {};
      c.subjects.forEach((row) => { perTeacher[row.teacher] = (perTeacher[row.teacher] || 0) + 1; });
      c.subjects.forEach((row) => {
        if (!row.teacher || row.teacher === NOT_MAPPED) return;
        const ownsClass = c.subjects.length >= 3 && perTeacher[row.teacher] >= Math.ceil(0.8 * c.subjects.length);
        const gap = ownsClass ? c.average - num(groupAverage(c)) : row.avg - c.average;
        const t = map.get(row.teacher) || { teacher: row.teacher, items: [] };
        t.items.push({ className: c.className, subject: row.subject, avg: row.avg, gap, ownsClass });
        map.set(row.teacher, t);
      });
    });
    const effort = new Map((report.teacherInsights || []).map((t) => [t.teacher, t]));
    const rows = Array.from(map.values()).map((t) => {
      const e = effort.get(t.teacher) || {};
      return {
        teacher: t.teacher,
        items: t.items.sort((a, b) => a.avg - b.avg),
        avg: mean(t.items.map((i) => i.avg)),
        gap: mean(t.items.map((i) => i.gap)),
        classes: Array.from(new Set(t.items.map((i) => i.className))),
        attendancePct: e.attendancePct == null ? null : num(e.attendancePct),
        lateDays: num(e.lateDays)
      };
    });
    // Praise is kept modest on purpose: at most three names, only when clearly above their classes.
    const strong = rows.filter((r) => r.avg >= 65 && r.gap >= 3).sort((a, b) => b.gap - a.gap).slice(0, 3);
    const support = rows.filter((r) => r.avg < 50 || r.gap <= -10).sort((a, b) => a.avg - b.avg);
    const unmapped = classes.reduce((n, c) => n + c.subjects.filter((s) => s.teacher === NOT_MAPPED).length, 0);
    return { rows: rows.sort((a, b) => b.avg - a.avg), strong, support, unmapped };
  }

  // ---------------------------------------------------------------- fees (unpaid only)
  async function analyseFees(year, canonClass, classOrder) {
    const engine = global.SomapFinance;
    if (!engine || typeof engine.getFinanceRoster !== 'function') return null;
    const rows = await engine.getFinanceRoster(String(year));
    const left = ['graduated', 'shifted', 'deleted', 'archived', 'removed'];
    const active = (rows || []).filter((r) => r && !r.isGraduated && !left.includes(String(r.status || '').toLowerCase()));
    const byClass = new Map();
    active.forEach((r) => {
      const cls = canonClass ? canonClass(r.classLevel || r.className || '') || r.classLevel : r.classLevel;
      const raw = r.rawStudent || {};
      const fin = r.finance || {};
      const balance = Math.max(0, num(fin.balance != null ? fin.balance : r.balance));
      const overdue = Math.max(0, num(fin.periodDebtValue));
      const bucket = byClass.get(cls) || { className: cls, roll: 0, debtors: [], cleared: 0, owed: 0, overdueCount: 0, overdueAmount: 0 };
      bucket.roll += 1;
      if (balance > 0.5) {
        bucket.owed += balance;
        bucket.debtors.push({
          name: titleName(r.fullName),
          parent: firstText(raw.primaryParentName, raw.parentName, raw.guardianName, raw.secondaryGuardian),
          contact: firstText(r.parentContact, raw.primaryParentContact, raw.parentPhone),
          balance,
          overdue
        });
      } else {
        bucket.cleared += 1;
      }
      if (overdue > 0.5) { bucket.overdueCount += 1; bucket.overdueAmount += overdue; }
      byClass.set(cls, bucket);
    });
    const order = (name) => { const i = classOrder.indexOf(name); return i < 0 ? 99 : i; };
    const classes = Array.from(byClass.values()).map((c) => ({
      ...c,
      debtorCount: c.debtors.length,
      topDebtors: c.debtors.sort((a, b) => b.balance - a.balance).slice(0, 5)
    })).sort((a, b) => order(a.className) - order(b.className));
    const roll = classes.reduce((s, c) => s + c.roll, 0);
    const cleared = classes.reduce((s, c) => s + c.cleared, 0);
    return {
      classes,
      roll,
      cleared,
      clearedPct: roll ? (cleared * 100) / roll : 0,
      debtors: classes.reduce((s, c) => s + c.debtorCount, 0),
      owed: classes.reduce((s, c) => s + c.owed, 0),
      overdueCount: classes.reduce((s, c) => s + c.overdueCount, 0),
      overdueAmount: classes.reduce((s, c) => s + c.overdueAmount, 0),
      largestDebtors: classes.flatMap((c) => c.debtors.map((d) => ({ ...d, className: c.className }))).sort((a, b) => b.balance - a.balance).slice(0, 10)
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

    const schoolTop = takeTop(rankRows(pri.flatMap((c) => c.eligible), (s) => num(s.overallPct)), 10, 12);
    const preTop = takeTop(rankRows(pre.flatMap((c) => c.eligible), (s) => num(s.overallPct)), 5, 7);
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
    const teachers = analyseTeachers(active, report, (c) => (c.prePrimary ? preAvg : priAvg));
    let fees = null;
    try { fees = await analyseFees(opts.year || (report.filters && report.filters.year), opts.canonClass, classOrder); } catch (err) {
      console.warn('[meeting] fee summary failed', err && err.message || err);
    }

    const withAttendance = active.filter((c) => c.attendancePct !== null && c.attendancePct > 0);
    const byAvg = active.slice().sort((a, b) => b.average - a.average);
    const anomalies = (report.scoreAnomalies || []).map((a) => {
      const cls = classes.find((c) => c.className === a.className);
      const learner = cls && cls.students.find((s) => String(s.adm || '').trim() === String(a.adm || '').trim());
      return { ...a, name: learner ? learner.name : a.adm };
    });

    return {
      generatedAt: new Date().toISOString(),
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
        ? 'Alama ' + m.anomalies.length + ' ziliingizwa kimakosa (alama kubwa kuliko alama ya juu ya mtihani, mfano 700 kati ya 100). Alama hizo hazikutumika katika hesabu yoyote ya taarifa hii, na orodha yake imeandaliwa kwa walimu husika ili wazirekebishe.'
        : m.anomalies.length + ' mark(s) were entered above the exam maximum (for example 700 out of 100). They are excluded from every figure in this report and listed in the data-correction appendix for the subject teachers to fix.');
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

    out.classLines = m.active.map((c) => {
      const parts = [];
      parts.push(sw
        ? c.className + ': wanafunzi ' + c.learners + ' (' + c.scoredCount + ' wamepimwa), wastani ' + pct(c.average) + (c.attendancePct ? ', mahudhurio ' + pct(c.attendancePct) : '') + '.'
        : c.className + ': ' + c.learners + ' learners (' + c.scoredCount + ' assessed), average ' + pct(c.average) + (c.attendancePct ? ', attendance ' + pct(c.attendancePct) : '') + '.');
      if (c.bestSubject && c.weakSubject) {
        parts.push(sw
          ? 'Somo linalofanya vizuri ni ' + c.bestSubject.subject + ' (' + pct(c.bestSubject.avg) + '), na linalohitaji juhudi zaidi ni ' + c.weakSubject.subject + ' (' + pct(c.weakSubject.avg) + ').'
          : 'Strongest subject: ' + c.bestSubject.subject + ' (' + pct(c.bestSubject.avg) + '); weakest: ' + c.weakSubject.subject + ' (' + pct(c.weakSubject.avg) + ').');
      }
      if (c.trend && Math.abs(c.trend.last - c.trend.first) >= 3) {
        const up = c.trend.last > c.trend.first;
        parts.push(sw
          ? (up ? 'Darasa limepanda' : 'Darasa limeshuka') + ' kutoka ' + pct(c.trend.first) + ' (' + monthName(c.trend.from, lang) + ') hadi ' + pct(c.trend.last) + ' (' + monthName(c.trend.to, lang) + ').'
          : (up ? 'Rose' : 'Fell') + ' from ' + pct(c.trend.first) + ' (' + monthName(c.trend.from, lang) + ') to ' + pct(c.trend.last) + ' (' + monthName(c.trend.to, lang) + ').');
      }
      if (c.average < 50) parts.push(sw ? 'Darasa hili linahitaji mpango maalum wa kuinua ufaulu.' : 'This class needs a written recovery plan.');
      return { className: c.className, text: parts.join(' '), tone: c.average >= 60.5 ? 'good' : c.average >= 50 ? 'mid' : 'low' };
    });

    const strongSub = m.subjects.strong.slice(0, 4).map((x) => x.subject + ' (' + x.className + ', ' + pct(x.avg) + ')');
    const weakSub = m.subjects.weak.slice(0, 5).map((x) => x.subject + ' (' + x.className + ', ' + pct(x.avg) + ')');
    out.subjects = [];
    if (strongSub.length) out.subjects.push(sw ? 'Masomo yaliyofanya vizuri zaidi ni ' + listJoin(strongSub, lang) + '.' : 'The strongest subject results are ' + listJoin(strongSub, lang) + '.');
    out.subjects.push(weakSub.length
      ? (sw ? 'Masomo yanayohitaji msukumo wa haraka (chini ya 50%) ni ' + listJoin(weakSub, lang) + '. Haya ndiyo maeneo ambayo kamati na uongozi wa taaluma vinapaswa kuyafuatilia kwa karibu.' : 'Subjects below 50% that need urgent attention: ' + listJoin(weakSub, lang) + '.')
      : (sw ? 'Hakuna somo lenye wastani chini ya 50% katika kipindi hiki. Hongera kwa walimu.' : 'No subject averaged below 50% in this window.'));

    out.top = sw
      ? 'Wanafunzi hawa wamefanya vizuri mfululizo katika kipindi chote. Ili kuwe na haki, mwanafunzi ameingizwa kwenye nafasi tu kama amefanya angalau 80% ya mitihani na masomo ya darasa lake. Elimu ya Awali na Elimu ya Msingi zimepangwa kila moja peke yake.'
      : 'These learners performed consistently across the window. To be fair, a learner is ranked only if they sat at least 80% of their class\'s exams and subjects. Pre-Primary and Primary are ranked separately.';

    out.improvers = sw
      ? 'Mafanikio si kuwa wa kwanza tu. Wanafunzi wafuatao wamepanda kwa kiwango kikubwa kutoka mwezi wa kwanza walipopimwa hadi mwezi wa karibuni, na wamewazidi wenzao katika kupanda huko. Wanastahili kutambuliwa ili waendelee kujituma.'
      : 'Success is not only being first. These learners rose the most from their first assessed month to their latest, and rose faster than their classmates over the same months. Recognise them so the effort continues.';

    // Teachers: short, factual, modest.
    const t = m.teachers;
    out.teachers = [];
    if (t.strong.length) {
      const names = t.strong.map((r) => shortName(r.teacher) + ' (' + pct(r.avg) + ')');
      out.teachers.push(sw
        ? 'Tunatambua kazi nzuri ya ' + listJoin(names, lang) + ', ambao matokeo yao yako juu ya wastani wa madarasa wanayofundisha. Tunawashukuru na tunawahimiza kuendelea hivyo.'
        : 'Good work is noted from ' + listJoin(names, lang) + ', whose results sit clearly above the classes they teach. Keep it up.');
    }
    if (t.support.length) {
      out.teachers.push(sw
        ? 'Walimu ' + t.support.length + ' wana masomo yaliyo chini ya 50% au chini sana ya wastani wa darasa husika. Lengo si kulaumu bali kushirikiana: Mwalimu wa Taaluma atakagua maandalio ya masomo, madaftari ya mazoezi na namna ya ufundishaji, kisha kutoa mrejesho wa maandishi na kufuatilia maendeleo kila mwezi.'
        : t.support.length + ' teacher(s) have subjects below 50% or clearly below their class average. The Academic Teacher will review lesson plans, exercise books and classroom delivery, give written feedback and track progress monthly. Results will be re-checked at the next meeting.');
    } else {
      out.teachers.push(sw ? 'Hakuna mwalimu mwenye matokeo chini ya kiwango cha hatari katika kipindi hiki.' : 'No teacher block is below the warning level in this window.');
    }
    if (t.unmapped) {
      out.teachers.push(sw
        ? 'Masomo ' + t.unmapped + ' hayajaunganishwa na mwalimu kwenye mfumo; yanapaswa kukamilishwa ili kila somo liwe na mwenyewe.'
        : t.unmapped + ' class-subject(s) have no teacher mapped in SoMAp and must be assigned so every subject has an owner.');
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
    out.fees = [];
    if (f) {
      out.fees.push(sw
        ? 'Sehemu hii haionyeshi kiasi cha fedha kilichokusanywa. Inaonyesha tu kiasi ambacho bado hakijalipwa, ili kamati isaidie katika ufuatiliaji.'
        : 'This section does not show money collected. It shows only what is still unpaid, for follow-up.');
      out.fees.push(sw
        ? 'Hadi ' + to + ', wanafunzi ' + f.debtors + ' kati ya ' + f.roll + ' bado wana salio la ada lenye jumla ya ' + money(f.owed) + '. Wanafunzi ' + f.cleared + ' (' + Math.round(f.clearedPct) + '%) wamekamilisha ada zao zote. Hongera kwa wazazi hawa; mfano wao uwe chachu kwa wengine.'
        : 'As of ' + to + ', ' + f.debtors + ' of ' + f.roll + ' learners still carry a fee balance totalling ' + money(f.owed) + '. ' + f.cleared + ' learners (' + Math.round(f.clearedPct) + '%) have paid in full.');
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

    // Recommendations built from the evidence, most important first.
    const rec = [];
    if (s.weakClass) {
      rec.push(sw
        ? [s.weakClass.className, 'Mwalimu wa darasa na walimu wa masomo waandae mpango wa wiki sita wa kuinua ufaulu, wenye mazoezi ya ziada na majaribio mafupi kila wiki. Mwalimu wa Taaluma aukague mpango huu kila mwezi.']
        : [s.weakClass.className, 'Class and subject teachers submit a six-week recovery plan with extra practice and a short weekly test. The Academic Teacher reviews it monthly.']);
    }
    if (m.subjects.weak.length) {
      rec.push(sw
        ? ['Masomo dhaifu', 'Kwa masomo yaliyo chini ya 50%, walimu wake waandae vipindi vya ziada (remedial) na Mwalimu wa Taaluma akague ufundishaji darasani angalau mara mbili kwa mwezi.']
        : ['Weak subjects', 'Subjects under 50%: remedial periods, and at least two classroom observations a month by the Academic Teacher.']);
    }
    if (s.weakLearners) {
      rec.push(sw
        ? ['Wanafunzi ' + s.weakLearners + ' wa daraja D au F', 'Wapewe msaada wa karibu (vikundi vidogo, kazi za nyumbani zinazofuatiliwa) na wazazi wao waitwe kwa mazungumzo ya pamoja na mwalimu wa darasa.']
        : [s.weakLearners + ' learners at grade D or F', 'Small-group support, checked homework, and a joint meeting with each parent and the class teacher.']);
    }
    if (f && f.debtors) {
      rec.push(sw
        ? ['Ada', 'Wazazi wenye madeni makubwa wafikiwe kwa heshima na wapewe mpango wa malipo wa maandishi, ili mtoto asiathirike kitaaluma. Kamati isaidie kuhamasisha ulipaji kwa wakati.']
        : ['Fees', 'Reach the largest debtors respectfully with a written payment plan so the learner is not affected academically.']);
    }
    if (s.noAttendance.length || (s.weakAttendance && s.weakAttendance.attendancePct < 92)) {
      rec.push(sw
        ? ['Mahudhurio', 'Daftari la mahudhurio lijazwe kila siku kwa kila darasa; mwanafunzi akikosa siku mbili mfululizo mzazi apigiwe simu siku hiyo hiyo.']
        : ['Attendance', 'Every class marks the register daily; two consecutive absences trigger a same-day call to the parent.']);
    }
    if (m.anomalies.length) {
      rec.push(sw
        ? ['Usahihi wa alama', 'Walimu warekebishe alama ' + m.anomalies.length + ' zilizokosewa ndani ya wiki moja, na kila alama ihakikiwe kabla ya kuhifadhiwa.']
        : ['Mark accuracy', 'Correct the ' + m.anomalies.length + ' invalid mark(s) within one week; double-check marks before saving.']);
    }
    rec.push(sw
      ? ['Motisha', 'Wanafunzi bora na walioimarika zaidi watambuliwe hadharani (vyeti au zawadi ndogo) ili kuhamasisha wengine.']
      : ['Recognition', 'Recognise top and most-improved learners publicly (certificates or small prizes) to motivate others.']);
    if (sw) rec.push(['Wazazi', 'Kamati ihamasishe wazazi kufuatilia kazi za nyumbani, kusoma na mtoto nyumbani, na kuhudhuria vikao vya wazazi.']);
    out.recommendations = rec;

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
      sections: ['Utangulizi', 'Hali ya Taaluma kwa Ujumla', 'Matokeo kwa Kila Darasa', 'Masomo', 'Wanafunzi Bora', 'Wanafunzi Walioimarika Zaidi', 'Walimu na Ufundishaji', 'Mahudhurio ya Wanafunzi', 'Ada: Kiasi Ambacho Hakijalipwa', 'Mapendekezo', 'Hitimisho'],
      card: {
        avg: ['Wastani wa Shule', (g, w) => 'Daraja ' + g + ' - ' + w],
        scored: ['Wanafunzi Waliopimwa', (n) => 'kati ya ' + n + ' walioandikishwa'],
        att: ['Mahudhurio', () => 'wastani wa wanafunzi wote'],
        exams: ['Mitihani', () => 'iliyofanyika madarasa yote'],
        best: ['Darasa Bora', (p) => 'wastani ' + p],
        weak: ['Darasa la Kusaidiwa', (p) => 'wastani ' + p],
        owed: ['Ada Haijalipwa', (n) => 'wanafunzi ' + n + ' wenye salio'],
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
      monthWord: (m) => MONTHS_SW[m]
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
      sections: ['Introduction', 'Overall Academic Position', 'Results by Class', 'Subjects', 'Top Learners', 'Most Improved Learners', 'Teachers and Teaching', 'Learner Attendance', 'Fees: Amount Still Unpaid', 'Recommendations', 'Conclusion'],
      card: {
        avg: ['School Average', (g, w) => 'Grade ' + g + ' - ' + w],
        scored: ['Learners Assessed', (n) => 'of ' + n + ' on the roll'],
        att: ['Attendance', () => 'all learners'],
        exams: ['Exam Sittings', () => 'across all classes'],
        best: ['Strongest Class', (p) => 'average ' + p],
        weak: ['Class to Support', (p) => 'average ' + p],
        owed: ['Fees Unpaid', (n) => n + ' learners with a balance'],
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
      monthWord: (m) => MONTHS_EN[m]
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
    fill(C.cream); doc.rect(0, 0, W, H, 'F');
    fill(C.navy); doc.rect(0, 0, W, 116, 'F');
    fill(C.navy2); doc.circle(W - 18, 18, 44, 'F'); doc.circle(W - 52, 102, 22, 'F');
    fill(C.gold); doc.rect(0, 116, W, 1.6, 'F');
    // logo
    fill(C.white); doc.roundedRect(M, 16, 24, 24, 4, 4, 'F');
    if (assets && assets.logo) { try { doc.addImage(assets.logo, /^data:image\/png/i.test(assets.logo) ? 'PNG' : 'JPEG', M + 2, 18, 20, 20); } catch (_) {} }
    ink(C.white); font('bold', 13); doc.text(m.schoolName, M + 30, 25.5);
    font('normal', 9.5); ink([203, 213, 225]); doc.text(L.year + ' ' + m.filters.year, M + 30, 31.5);
    ink(C.gold); font('bold', 8.5); doc.text(L.kicker, M, 56, { charSpace: 0.6 });
    ink(C.white); font('bold', 27); doc.text(L.title1, M, 68); doc.text(L.title2, M, 79.5);
    font('normal', 12.5); ink([226, 232, 240]); doc.text(L.meeting, M, 90);
    const period = formatDate(m.filters.fromDate, lang) + '  -  ' + formatDate(m.filters.toDate, lang);
    font('bold', 9.5); const pw = doc.getTextWidth(period) + 12;
    fill(C.navy2); doc.roundedRect(M, 96, pw, 9, 4.5, 4.5, 'F'); ink(C.white); doc.text(period, M + 6, 101.8);

    // cards
    y = 126;
    ink(C.navy); font('bold', 13); doc.text(L.glance, M, y + 4); fill(C.gold); doc.rect(M, y + 6.5, 18, 0.9, 'F');
    y += 11;
    const f = m.fees;
    const g = gradeOf(s.average);
    const cards = [
      [L.card.avg[0], pct(s.average), L.card.avg[1](g, GRADE_WORDS[lang][g]), toneOf(s.average)],
      [L.card.scored[0], String(s.scored), L.card.scored[1](s.learners), 'navy'],
      [L.card.att[0], s.attendancePct > 0 ? pct(s.attendancePct) : '-', L.card.att[1](), s.attendancePct >= 92 ? 'green' : s.attendancePct >= 85 ? 'amber' : 'red'],
      [L.card.exams[0], String(s.exams), L.card.exams[1](), 'navy'],
      [L.card.best[0], s.bestClass ? s.bestClass.className : '-', s.bestClass ? L.card.best[1](pct(s.bestClass.average)) : '', 'green'],
      [L.card.weak[0], s.weakClass ? s.weakClass.className : '-', s.weakClass ? L.card.weak[1](pct(s.weakClass.average)) : '', toneOf(s.weakClass ? s.weakClass.average : 0)],
      [L.card.owed[0], f ? money(f.owed) : '-', f ? L.card.owed[1](f.debtors) : '', 'gold'],
      [L.card.cleared[0], f ? String(f.cleared) : '-', f ? L.card.cleared[1](Math.round(f.clearedPct) + '%') : '', 'teal']
    ];
    const cw = (CW - 3 * 4) / 4; const ch = 31;
    cards.forEach((card, i) => {
      const cx = M + (i % 4) * (cw + 4); const cy = y + Math.floor(i / 4) * (ch + 4);
      const tone = card[3]; const accent = C[tone] || C.navy;
      fill(C.white); doc.roundedRect(cx, cy, cw, ch, 3, 3, 'F');
      fill(accent); doc.roundedRect(cx, cy, cw, 5, 3, 3, 'F');
      fill(C.white); doc.rect(cx, cy + 2.4, cw, 2.8, 'F');
      stroke(C.line); doc.setLineWidth(0.2); doc.roundedRect(cx, cy, cw, ch, 3, 3, 'S');
      ink(C.muted); font('bold', 6.9); doc.text(card[0].toUpperCase(), cx + 3.5, cy + 8.2);
      ink(accent); font('bold', card[1].length > 11 ? 11 : 15.5); doc.text(card[1], cx + 3.5, cy + 17.5);
      ink(C.muted); font('normal', 7.2); doc.text(split(card[2], cw - 7).slice(0, 2), cx + 3.5, cy + 23.5);
    });
    y += 2 * ch + 4 + 6;

    // key message
    const keyLines = [];
    keyLines.push(lang === 'sw'
      ? 'Wastani wa shule ni ' + pct(s.average) + ' (daraja ' + g + '). ' + (s.bestClass ? s.bestClass.className + ' linaongoza; ' : '') + (s.weakClass ? s.weakClass.className + ' linahitaji msaada wa karibu.' : '')
      : 'The school average is ' + pct(s.average) + ' (grade ' + g + '). ' + (s.bestClass ? s.bestClass.className + ' leads; ' : '') + (s.weakClass ? s.weakClass.className + ' needs the closest support.' : ''));
    if (m.subjects.weak.length) {
      const ws = Array.from(new Set(m.subjects.weak.map((x) => x.subject))).slice(0, 3);
      keyLines.push(lang === 'sw' ? 'Masomo yanayohitaji msukumo zaidi: ' + listJoin(ws, lang) + '.' : 'Subjects needing the strongest push: ' + listJoin(ws, lang) + '.');
    }
    if (m.improvers.length) keyLines.push(lang === 'sw' ? 'Wanafunzi ' + m.improvers.length + ' wameimarika kwa kiwango kikubwa na wanatambuliwa katika taarifa hii.' : m.improvers.length + ' learners improved strongly and are recognised in this report.');
    callout(L.keyMessage, keyLines.join(' '), 'gold');

    // contents
    ink(C.navy); font('bold', 10); doc.text(L.contents, M, y + 3); y += 6;
    const secList = L.sections;
    const half = Math.ceil(secList.length / 2);
    font('normal', 8.4);
    secList.forEach((name, i) => {
      const cx = M + (i < half ? 0 : CW / 2); const cy = y + (i % half) * 4.9;
      ink(C.gold); font('bold', 8.4); doc.text(String(i + 1).padStart(2, '0'), cx, cy + 3);
      ink(C.ink); font('normal', 8.4); doc.text(name, cx + 7, cy + 3);
    });
    y += half * 4.9 + 3;
    stroke(C.line); doc.line(M, 280, W - M, 280);
    ink(C.muted); font('normal', 7.8);
    const leaders = (assets && assets.leaders || []).filter(Boolean);
    doc.text(L.preparedBy + (leaders.length ? ': ' + leaders.join(' & ') : ''), M, 285);
    const now = new Date();
    const localIso = now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0') + '-' + String(now.getDate()).padStart(2, '0');
    doc.text(L.printed + ': ' + formatDate(localIso, lang), W - M, 285, { align: 'right' });

    // ================================================================ body
    addPage();
    section(1, L.sections[0]);
    words.intro.forEach((t) => para(t));

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
    words.classLines.forEach((cl) => callout(null, cl.text, cl.tone === 'good' ? 'green' : cl.tone === 'mid' ? 'amber' : 'red'));

    section(4, L.sections[3]);
    words.subjects.forEach((t) => para(t));
    if (m.subjects.weak.length) {
      subheading(L.weakSubjects);
      table([L.col.cls, L.col.subject, L.col.teacher, L.col.avg],
        m.subjects.weak.map((x) => [x.className, x.subject, x.teacher === NOT_MAPPED ? (lang === 'sw' ? 'Hajapangwa kwenye mfumo' : 'Not mapped') : shortName(x.teacher), pct(x.avg)]),
        { headColor: C.red, columnStyles: { 3: { halign: 'center', fontStyle: 'bold', textColor: C.red } } });
    }
    if (m.subjects.strong.length) {
      subheading(L.strongSubjects);
      table([L.col.cls, L.col.subject, L.col.teacher, L.col.avg],
        m.subjects.strong.map((x) => [x.className, x.subject, x.teacher === NOT_MAPPED ? '-' : shortName(x.teacher), pct(x.avg)]),
        { headColor: C.teal, columnStyles: { 3: { halign: 'center', fontStyle: 'bold', textColor: C.green } } });
    }

    section(5, L.sections[4]);
    para(words.top);
    if (m.schoolTop.length) {
      subheading(L.topPrimary);
      table([L.col.pos, L.col.name, L.col.cls, L.col.avg, L.col.grade],
        m.schoolTop.map((st) => [String(st.position), titleName(st.name), st.className, pct(st.overallPct), gradeOf(st.overallPct)]),
        { headColor: C.teal, columnStyles: { 0: { halign: 'center', cellWidth: 14, fontStyle: 'bold' }, 3: { halign: 'center', fontStyle: 'bold' }, 4: { halign: 'center' } },
          didParseCell: (d) => { if (d.section === 'body' && d.row.index < 3) { d.cell.styles.fillColor = C.goldTint; } } });
    }
    if (m.preTop.length) {
      subheading(L.topPre);
      table([L.col.pos, L.col.name, L.col.cls, L.col.avg, L.col.grade],
        m.preTop.map((st) => [String(st.position), titleName(st.name), st.className, pct(st.overallPct), gradeOf(st.overallPct)]),
        { headColor: C.gold, columnStyles: { 0: { halign: 'center', cellWidth: 14, fontStyle: 'bold' }, 3: { halign: 'center', fontStyle: 'bold' }, 4: { halign: 'center' } } });
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
    if (m.teachers.support.length) {
      subheading(L.supportTitle);
      table([L.col.teacher, L.col.subjects, L.col.avg, L.col.vsClass],
        m.teachers.support.map((r) => [shortName(r.teacher), r.items.slice(0, 4).map((i) => i.subject + ' (' + i.className + ') ' + pct(i.avg)).join('; '), pct(r.avg), (r.gap >= 0 ? '+' : '') + r.gap.toFixed(1)]),
        { headColor: C.amber, columnStyles: { 0: { cellWidth: 40, fontStyle: 'bold' }, 2: { halign: 'center', cellWidth: 18 }, 3: { halign: 'center', cellWidth: 26 } } });
    }
    if (mode !== 'committee' && m.teachers.rows.length) {
      // Worker attendance columns only when the attendance data actually matched these teachers.
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
      table([L.col.cls, L.col.learners, L.col.cleared, L.col.debtors, L.col.owed, L.col.late],
        f.classes.map((c) => [c.className, String(c.roll), String(c.cleared), String(c.debtorCount), c.owed > 0 ? money(c.owed) : '-', String(c.overdueCount)]),
        { headColor: C.navy, foot: [L.col.total, String(f.roll), String(f.cleared), String(f.debtors), money(f.owed), String(f.overdueCount)],
          columnStyles: { 1: { halign: 'center' }, 2: { halign: 'center', textColor: C.green, fontStyle: 'bold' }, 3: { halign: 'center' }, 4: { halign: 'right', fontStyle: 'bold' }, 5: { halign: 'center' } } });
      const maxOwed = Math.max(1, ...f.classes.map((c) => c.owed));
      hbars(lang === 'sw' ? 'Salio lililobaki kwa darasa' : 'Unpaid balance by class',
        f.classes.map((c) => ({ label: c.className, value: (c.owed * 78) / maxOwed, text: c.owed > 0 ? money(c.owed) : '-', color: C.gold })),
        { ticks: [], labelW: 30 });
      subheading(L.debtorsTitle);
      const debtorRows = [];
      const groupRows = [];
      f.classes.filter((c) => c.topDebtors.length).forEach((c) => {
        groupRows.push(debtorRows.length);
        debtorRows.push([{ content: c.className + '  -  ' + (lang === 'sw' ? 'wenye salio: ' : 'learners with a balance: ') + c.debtorCount, colSpan: mode === 'committee' ? 3 : 4 }]);
        c.topDebtors.forEach((d) => {
          const row = [titleName(d.name), titleName(d.parent) || '-', money(d.balance)];
          if (mode !== 'committee') row.splice(2, 0, d.contact || '-');
          debtorRows.push(row);
        });
      });
      const head = mode === 'committee' ? [L.col.name, L.col.parent, L.col.balance] : [L.col.name, L.col.parent, 'Contact', L.col.balance];
      const lastCol = head.length - 1;
      table(head, debtorRows, {
        fontSize: 8.2,
        columnStyles: { [lastCol]: { halign: 'right', fontStyle: 'bold' } },
        didParseCell: (d) => {
          if (d.section === 'body' && groupRows.includes(d.row.index)) { d.cell.styles.fillColor = C.navyTint; d.cell.styles.fontStyle = 'bold'; d.cell.styles.textColor = C.navy; }
        }
      });
    }

    section(10, L.sections[9]);
    words.recommendations.forEach((r, i) => {
      font('normal', 9.6);
      const lines = split(r[1], CW - 20);
      const h = 10 + lines.length * 3.95;
      ensure(h + 3);
      fill(C.white); stroke(C.line); doc.roundedRect(M, y, CW, h, 3, 3, 'FD');
      fill(C.teal); doc.circle(M + 7, y + 6.5, 3.6, 'F');
      ink(C.white); font('bold', 9); doc.text(String(i + 1), M + 7, y + 7.8, { align: 'center' });
      ink(C.navy); font('bold', 10); doc.text(r[0], M + 14, y + 7.4);
      ink(C.ink); font('normal', 9.6); doc.text(lines, M + 14, y + 12.4);
      y += h + 3;
    });

    section(11, L.sections[10]);
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
      if (m.anomalies.length) {
        currentSection = 'Appendix A - Marks to correct';
        addPage();
        ink(C.red); font('bold', 14); doc.text('Appendix A - Marks to correct in the scoresheet', M, y + 6); y += 11;
        para('These marks are higher than the exam maximum, so they cannot be real. They were left out of every figure above. Subject teachers should enter the correct mark.', { size: 9.4 });
        table(['Class', 'Exam', 'Month', 'Learner', 'Subject', 'Entered', 'Max'],
          m.anomalies.map((a) => [a.className, a.examLabel, a.monthKey, titleName(a.name), a.subject, Number(a.score).toLocaleString('en-US'), String(a.max)]),
          { headColor: C.red, fontSize: 8, columnStyles: { 5: { halign: 'right', textColor: C.red, fontStyle: 'bold' }, 6: { halign: 'center' } } });
      }
      const weakRows = m.active.flatMap((c) => c.weakLearners.map((st) => [c.className, titleName(st.name), pct(st.overallPct), st.attendancePct ? pct(st.attendancePct) : '-', num(st.fee && st.fee.balance) > 0.5 ? money(st.fee.balance) : 'Clear']));
      if (weakRows.length) {
        currentSection = 'Appendix B - Learner support list';
        addPage();
        ink(C.amber); font('bold', 14); doc.text('Appendix B - Learners at grade D or F (support list)', M, y + 6); y += 11;
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
      if (m.teachers.unmapped) notes.push(m.teachers.unmapped + ' class-subject pair(s) have no teacher mapped.');
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

  function renderBrief(el, report, mode) {
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
      card(L.card.owed[0], f ? money(f.owed) : '-', f ? L.card.owed[1](f.debtors) + ' | ' + L.card.cleared[0] + ': ' + f.cleared : '', 'amber'),
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
    el.innerHTML = html;
    el.classList.remove('hidden');
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
