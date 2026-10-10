// SoMAp Secretary Desk — daily duty gates for workersattendance.html, plus the
// shared duty readers the Secretary Hub and work report use.
//
// A worker registered as "secretary" follows every normal attendance rule. On top
// of those, the duties of their school's desk (SECRETARY_DESKS in
// secretary_access.js) are checked at check-in and check-out, Monday to Friday:
//
//   Check-in
//     1. Left yesterday with unfinished duties  → 150-word follow-up letter.
//     2. Graduation calls not done yesterday    → 300-word letter. Every 3rd
//        missed day in a month cuts TSh 1,000 from the responsibility allowance
//        (a workerDiscipline manual_adjustment event — the same ledger payroll
//        already reads, reviewable/cancellable by Finance in payroll.html).
//     3. 15 Sep – 25 Dec: "How many Preform One are registered?" — compared with
//        the Preform One admission file; a mismatch needs a 200-word letter.
//     4. Yesterday's missed attendance / expenses → reminder before signing in.
//     5. "Do you know you must mark Preform One attendance today?" — only YES is
//        accepted; then mark now or later (before 08:00).
//     6. Same question for MAU / MAP student attendance and daily expenses, with
//        the links ready.
//     7. Preform One debtors list: must download the PDF; NO CASH warning.
//   Check-out
//     a. "Did anyone pay fees today (Preform One / MAU / MAP)?" — links ready.
//     b. Today's 20 graduation calls, Preform One attendance, MAU / MAP student
//        attendance and MAU / MAP expenses must be done, or the secretary writes
//        an explanation (300 words if calls are missing, otherwise 200) to leave.
//
// Duty records live under the home school: years/{Y}/secretaryDuty/{workerId}/{YYYYMM}/
//   missedCalls/{dayKey}                 300-word letter for a missed calls day
//   days/{dayKey}/preformOne             morning Preform One count answer
//   days/{dayKey}/morningPlan            YES answers + "mark now / later" choices
//   days/{dayKey}/yesterdayReminder      reminder shown for yesterday's missed duties
//   days/{dayKey}/preformDebts           debtors PDF downloaded + NO CASH acknowledged
//   days/{dayKey}/feesCheck              check-out answer about fees paid today
//   days/{dayKey}/checkoutReview         what was done / not done at check-out
//   days/{dayKey}/checkoutOverride       explanation for leaving with unfinished duties
//   days/{dayKey}/followUp               next-morning follow-up for that override
//   days/{dayKey}/morningBriefing        what the secretary was shown at check-in
(function (global) {
  'use strict';

  // Duties are only enforced for working days on/after these dates; nobody is
  // punished retroactively. The original desk (calls, MAU/MAP attendance) went
  // live 2026-10-09; Preform One attendance, MAU/MAP expenses, the fees question
  // and the debtors PDF start on Monday 2026-10-12.
  const DUTY_START_YMD = '2026-10-09';
  const DAILY_DUTY_START_YMD = '2026-10-12';
  const STRIKE_EVERY = 3;
  const STRIKE_AMOUNT = 1000;
  const WORDS = { missedCalls: 300, preformMismatch: 200, checkout: 300, dailyDuty: 200, followUp: 150 };
  const PREFORM_WINDOW = { from: '09-15', to: '12-25' };
  // Preform One classes run until 15 December (see calculateTotalFee in prefonecommon.js).
  const PREFORM_LAST_MD = '12-15';
  const PREFORM_BASE = 'schools/Socrates School Preform one';
  const SECRETARY_ROLES = ['secretary', 'katibu'];
  const MARK_BEFORE = '08:00';

  // URLs are built from this script's location (js/secretary_duties.js) so they
  // work from any page that loads it.
  const APP_ROOT = (() => {
    try { return new URL('../', global.document.currentScript.src).href; } catch (_) { return '../'; }
  })();
  const URLS = {
    hub: `${APP_ROOT}workershtml/secretary/secretaryhub.html`,
    calls: `${APP_ROOT}workershtml/secretary/graduation_followup.html`,
    preformAdmission: `${APP_ROOT}preformonehtml/prefoneadmission.html`,
    preformAttendance: `${APP_ROOT}preformonehtml/prefoneclassattendance.html`,
    preformFinance: `${APP_ROOT}preformonehtml/prefonefinance.html`,
    logo: `${APP_ROOT}images/somap-logo.png.jpg`,
  };
  function linkedUrl(schoolId, page) {
    const S = global.SomapSecretary;
    return S?.linkedPageHref ? S.linkedPageHref(URLS.hub, schoolId, page)
      : `${URLS.hub}?go=${encodeURIComponent(page)}&school=${encodeURIComponent(schoolId)}`;
  }

  // ---------- small helpers ----------
  const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const countWords = (t) => String(t || '').trim().split(/\s+/).filter(Boolean).length;
  const pad = (n) => String(n).padStart(2, '0');
  const dayKeyOf = (ymd) => ymd.replace(/-/g, '');
  const monthKeyOf = (ymd) => ymd.slice(0, 7).replace('-', '');
  const yearOf = (ymd) => ymd.slice(0, 4);
  const tsh = (v) => `TSh ${Math.round(Number(v) || 0).toLocaleString('en-US')}`;

  function shiftYmd(ymd, days) {
    const d = new Date(`${ymd}T12:00:00`);
    d.setDate(d.getDate() + days);
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  }

  function todayYmd() {
    const parts = new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Africa/Nairobi', year: 'numeric', month: '2-digit', day: '2-digit',
    }).format(new Date()).split('/');
    return `${parts[2]}-${parts[1]}-${parts[0]}`;
  }

  function toYmd(value) {
    if (!value) return '';
    if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}/.test(value)) return value.slice(0, 10);
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return '';
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  }

  function weekday(ymd) {
    return new Date(`${ymd}T12:00:00`).getDay();
  }

  function isMonToFri(ymd) {
    const d = weekday(ymd);
    return d >= 1 && d <= 5;
  }

  function prettyDate(ymd) {
    try {
      return new Intl.DateTimeFormat('sw-TZ', { weekday: 'long', day: 'numeric', month: 'long' })
        .format(new Date(`${ymd}T12:00:00`));
    } catch (_) { return ymd; }
  }

  function isSecretaryRole(role) {
    return SECRETARY_ROLES.includes(String(role || '').trim().toLowerCase());
  }

  function deskFor(schoolId) {
    return global.SomapSecretary?.deskFor?.(schoolId) || { graduation: false, preformOne: false, linkedSchools: [] };
  }

  function hasDuties(desk) {
    return Boolean(desk.graduation || desk.preformOne || desk.linkedSchools.length);
  }

  function dutyPath(ctx, ymd, sub) {
    return `years/${yearOf(ymd)}/secretaryDuty/${ctx.workerId}/${monthKeyOf(ymd)}/${sub}`;
  }

  async function readVal(ref) {
    const snap = await ref.once('value');
    return snap.val();
  }

  // ---------- working days ----------
  // A Mon–Fri day that the home school's worker calendar does not mark as off.
  async function isDutyDay(ctx, ymd) {
    if (!isMonToFri(ymd)) return false;
    try {
      const status = await ctx.resolveWorkerCalendar?.(ymd);
      if (status?.blockWorkerAttendance) return false;
    } catch (_) { /* calendar unavailable → weekday rule only */ }
    return true;
  }

  async function previousDutyDay(ctx, ymd) {
    for (let i = 1; i <= 10; i += 1) {
      const candidate = shiftYmd(ymd, -i);
      if (candidate < DUTY_START_YMD) return null;
      if (await isDutyDay(ctx, candidate)) return candidate;
    }
    return null;
  }

  // The worker's own check-in/out record for a day (scoped path, Socrates legacy fallback).
  async function workerDayRecord(ctx, ymd) {
    if (ctx.getDayRecord) return ctx.getDayRecord(ymd);
    const monthKey = monthKeyOf(ymd);
    const dayKey = dayKeyOf(ymd);
    const scoped = await readVal(ctx.schoolRef(`years/${yearOf(ymd)}/workerAttendance/${ctx.workerId}/${monthKey}/${dayKey}`));
    if (scoped) return scoped;
    if (global.SomapSecretary?.isSocrates?.(ctx.schoolId)) {
      return readVal(ctx.db.ref(`attendance/${ctx.workerId}/${monthKey}/${dayKey}`));
    }
    return null;
  }

  // ---------- graduation calls ----------
  async function callsStatus(ctx, ymd) {
    const G = global.SecretaryGraduation;
    if (!G) throw new Error('Graduation module missing');
    const year = yearOf(ymd);
    const base = `${G.gradBase(ctx.schoolId, year)}/secretaryCalls`;
    const [students, reports, day] = await Promise.all([
      G.loadStudents(ctx.db, ctx.schoolId, year),
      G.loadReports(ctx.db, ctx.schoolId, year),
      readVal(ctx.db.ref(`${base}/days/${ymd}`)),
    ]);
    const list = Array.isArray(day?.adms) ? day.adms : Object.values(day?.adms || {});
    const called = new Set();
    Object.entries(reports).forEach(([adm, entries]) => {
      if ((entries || []).some((r) => r.ymd === ymd)) called.add(adm);
    });
    const debtors = students.filter((s) => s.balance > 0);
    const required = list.length
      ? Math.min(G.CALLS_PER_DAY, list.length)
      : Math.min(G.CALLS_PER_DAY, debtors.length);
    const made = called.size;
    return {
      ymd,
      required,
      made,
      listSize: list.length,
      debtors: debtors.length,
      paidUp: students.length - debtors.length,
      students: students.length,
      outstanding: debtors.reduce((sum, s) => sum + s.balance, 0),
      complete: made >= required,
    };
  }

  // Adds a TSh 1,000 manual_adjustment to the worker's responsibility ledger for
  // the month of the missed day, and mirrors it into a still-draft payroll run
  // exactly as the late-coming flow does. Paid/published payroll is never touched.
  async function applyStrike(ctx, ymd, strikeNumber, missedCount) {
    const Core = global.SomapPayrollCore;
    const year = yearOf(ymd);
    const monthKey = monthKeyOf(ymd);
    const base = `years/${year}/workerDiscipline/${monthKey}/workers/${ctx.workerId}`;
    const eventId = `${dayKeyOf(ymd)}_secretary_calls_strike${strikeNumber}`;
    const record = (await readVal(ctx.schoolRef(base))) || {};
    const events = { ...(record.events || {}) };
    if (events[eventId]) return { applied: false, eventId };
    const now = Date.now();
    events[eventId] = {
      eventId, workerId: ctx.workerId, schoolId: ctx.schoolId, year, month: monthKey, date: ymd,
      eventType: 'manual_adjustment', source: 'secretary_duty', duty: 'graduation_calls',
      eventLabel: `Secretary: graduation calls missed ×${missedCount} (strike ${strikeNumber})`,
      reason: `Graduation parent calls were not completed on ${missedCount} working days this month. Every ${STRIKE_EVERY} missed days cut TSh ${STRIKE_AMOUNT.toLocaleString('en-US')}.`,
      deductionAmount: STRIKE_AMOUNT, linkedAttendanceId: dayKeyOf(ymd),
      workerAccepted: false, workerRejected: false, reviewStatus: 'pending',
      createdAt: now, updatedAt: now,
    };
    const summary = Core.responsibilitySummary(events);
    const updates = {
      [`${base}/events/${eventId}`]: events[eventId],
      [`${base}/summary`]: { ...summary, updatedAt: now },
    };
    const payroll = (await readVal(ctx.schoolRef(`years/${year}/workers_payroll/${monthKey}`))) || {};
    if (payroll.items?.[ctx.workerId] && ['draft', ''].includes(String(payroll.status || 'draft').toLowerCase())) {
      const item = `years/${year}/workers_payroll/${monthKey}/items/${ctx.workerId}`;
      updates[`${item}/deductions/responsibilityAllowanceDeduction`] = summary.totalResponsibilityDeduction;
      updates[`${item}/responsibilityDiscipline`] = summary;
    }
    await ctx.schoolRootRef().update(updates);
    return { applied: true, eventId, summary };
  }

  // ---------- Preform One ----------
  function inPreformWindow(ymd) {
    const md = ymd.slice(5);
    return md >= PREFORM_WINDOW.from && md <= PREFORM_WINDOW.to;
  }

  async function readPreformStudents(db, year) {
    return (await readVal(db.ref(`${PREFORM_BASE}/${year}/students`))) || {};
  }

  async function preformCount(ctx, year) {
    const students = await readPreformStudents(ctx.db, year);
    return Object.values(students).filter(Boolean).length;
  }

  const ATT_CODES = ['P', 'A', 'S', 'L', 'E', 'M', 'T', 'G'];
  // Attendance codes are one letter; early saves stored "P (Present)".
  function attCode(v) {
    const c = String(v || '').trim().charAt(0).toUpperCase();
    return ATT_CODES.includes(c) ? c : 'P';
  }

  function preformEnrolledOn(s, ymd) {
    if (!s || typeof s !== 'object') return false;
    if (s.inactive === true || s.shifted === true) return false;
    if (['inactive', 'shifted', 'left', 'withdrawn', 'graduated'].includes(String(s.status || '').toLowerCase())) return false;
    const start = toYmd(s.reportingDate || s.planStart || s.joinDate || s.registrationDate);
    return !start || start <= ymd;
  }

  // Preform One attendance for one day, from the learners' own attendance records.
  function preformDay(students, ymd) {
    const active = Object.entries(students || {}).filter(([, s]) => preformEnrolledOn(s, ymd));
    let marked = 0;
    let present = 0;
    let absent = 0;
    let savedBy = '';
    let savedAt = 0;
    active.forEach(([, s]) => {
      const rec = Object.values(s.attendance || {}).find((a) => a && a.date === ymd);
      if (!rec) return;
      marked += 1;
      const am = attCode(rec.am);
      const pm = attCode(rec.pm);
      if (['P', 'L'].includes(am) && ['P', 'L'].includes(pm)) present += 1; else absent += 1;
      if (Number(rec.markedAt || 0) > savedAt) { savedAt = Number(rec.markedAt); savedBy = rec.markedByName || ''; }
    });
    const total = active.length;
    const required = total > 0 && isMonToFri(ymd) && ymd.slice(5) <= PREFORM_LAST_MD;
    return { ymd, required, total, marked, present, absent, done: !required || marked > 0, savedBy, savedAt };
  }

  async function preformStatus(ctx, ymd) {
    return preformDay(await readPreformStudents(ctx.db, yearOf(ymd)), ymd);
  }

  // Learners with a balance, using the same due-date rule as prefonefinance.html.
  function preformDebtors(students, ymd) {
    const today = new Date(`${ymd}T12:00:00`);
    const rows = [];
    Object.entries(students || {}).forEach(([adm, s]) => {
      if (!s || typeof s !== 'object' || s.inactive === true || s.shifted === true) return;
      const paid = Object.values(s.payments || {}).reduce((t, p) => t + Number(p?.amount || 0), 0);
      const totalFee = Number(s.totalFee || s.required || 0);
      const bal = totalFee - paid;
      if (bal <= 0) return;
      const planStart = toYmd(s.reportingDate || s.planStart || s.joinDate || s.registrationDate);
      let due = toYmd(s.nextDueDate || s.nextDue || s.dueDate || s.expectedDueDate || s.debtDueDate
        || s.planDueDate || s.paymentDueDate || s.nextPaymentDate || s.nextPaymentDue);
      if (!due && planStart) {
        const d = new Date(`${planStart}T12:00:00`);
        d.setMonth(d.getMonth() + 1);
        due = toYmd(d);
      }
      let status = 'pending';
      let label = 'Hakuna tarehe ya malipo';
      if (due) {
        const days = Math.round((new Date(`${due}T12:00:00`) - today) / 86400000);
        if (days < 0) { status = 'overdue'; label = `Amechelewa siku ${Math.abs(days)}`; }
        else if (days <= 7) { status = 'soon'; label = days === 0 ? 'Alipe leo' : `Siku ${days} kabla ya malipo`; }
        else { label = `Alipe kabla ya ${due}`; }
      }
      rows.push({
        adm,
        name: `${s.firstName || s.firstname || ''} ${s.middleName || ''} ${s.lastName || s.lastname || ''}`.replace(/\s+/g, ' ').trim() || s.name || adm,
        contact: s.parentContact || s.parentPhone || s.guardianPhone || s.phone || '',
        totalFee, paid, bal, due, status, label,
      });
    });
    const order = { overdue: 0, soon: 1, pending: 2 };
    rows.sort((a, b) => (order[a.status] - order[b.status]) || (b.bal - a.bal));
    return {
      rows,
      outstanding: rows.reduce((t, r) => t + r.bal, 0),
      overdue: rows.filter((r) => r.status === 'overdue').length,
      learners: Object.values(students || {}).filter((s) => s && typeof s === 'object' && s.inactive !== true && s.shifted !== true).length,
    };
  }

  // ---------- linked-school student attendance (MAU / MAP) ----------
  async function linkedClasses(ctx, schoolId, year) {
    const classes = new Set();
    const add = (v) => { const c = String(v || '').trim(); if (c) classes.add(c); };
    const enrollments = (await readVal(ctx.db.ref(`schools/${schoolId}/enrollments/${year}`))) || {};
    Object.values(enrollments).forEach((e) => {
      if (!e || typeof e !== 'object') return;
      if (['inactive', 'graduated', 'shifted', 'left'].includes(String(e.status || '').toLowerCase())) return;
      add(e.className || e.classLevel);
    });
    if (!classes.size) {
      const students = (await readVal(ctx.db.ref(`schools/${schoolId}/students`))) || {};
      Object.values(students).forEach((s) => {
        if (!s || typeof s !== 'object' || s.inactive === true) return;
        if (['inactive', 'graduated', 'shifted', 'left'].includes(String(s.status || '').toLowerCase())) return;
        const cls = s.className || s.classLevel;
        if (String(cls || '').trim().toUpperCase() === 'GRADUATED') return;
        add(cls);
      });
    }
    return Array.from(classes).sort((a, b) => a.localeCompare(b));
  }

  function classVariants(cls) {
    return Array.from(new Set([cls, cls.toUpperCase(), cls.replace(/\b\w/g, (c) => c.toUpperCase())]));
  }

  // Present/absent split of one class-day record ({studentId: {am, pm, daily}} as
  // written by classattendance.html). Present = in school for at least one session.
  function countClassDay(records) {
    let present = 0;
    let absent = 0;
    Object.values(records || {}).forEach((r) => {
      if (!r || typeof r !== 'object') return;
      const am = String(r.am || '').toUpperCase();
      const pm = String(r.pm || '').toUpperCase();
      const daily = String(r.daily || '').toUpperCase();
      if (!am && !pm && !daily) return;
      if (am === 'P' || pm === 'P' || daily === 'P') present += 1; else absent += 1;
    });
    return { count: present + absent, present, absent };
  }

  async function classAttendanceDay(ctx, schoolId, cls, ymd) {
    for (const name of classVariants(cls)) {
      const records = await readVal(ctx.db.ref(`schools/${schoolId}/attendance/${name}/${ymd.slice(0, 7)}/${ymd}`));
      if (records && typeof records === 'object' && Object.keys(records).length) return countClassDay(records);
    }
    return { count: 0, present: 0, absent: 0 };
  }

  async function classIsSchoolDay(schoolId, cls, ymd) {
    const Cal = global.SomapSchoolCalendar;
    if (!Cal?.resolveDateStatus) return isMonToFri(ymd);
    try {
      const status = await Cal.resolveDateStatus({ year: yearOf(ymd), date: ymd, schoolId, audience: 'students', className: cls });
      return !status?.blockStudentAttendance;
    } catch (_) {
      return isMonToFri(ymd);
    }
  }

  // ---------- linked-school expenses (finance.html → expenseApprovals queue) ----------
  async function readLinkedExpenses(db, schoolId, year) {
    const raw = (await readVal(db.ref(`schools/${schoolId}/years/${year}/expenseApprovals`))) || {};
    return Object.entries(raw).map(([id, r]) => ({
      id,
      date: toYmd(r?.expenseDate || r?.targetPayload?.date),
      amount: Number(r?.amount || r?.targetPayload?.amount || 0),
      status: String(r?.status || 'pending').toLowerCase(),
      category: r?.category || '',
      description: r?.description || '',
    }));
  }

  function expensesOn(list, ymd) {
    const day = (list || []).filter((e) => e.date === ymd && e.status !== 'rejected');
    return { count: day.length, amount: day.reduce((t, e) => t + e.amount, 0) };
  }

  async function attendanceStatus(ctx, desk, ymd) {
    const schools = await Promise.all(desk.linkedSchools.map(async (school) => {
      const [classes, expenseList] = await Promise.all([
        linkedClasses(ctx, school.id, yearOf(ymd)),
        readLinkedExpenses(ctx.db, school.id, yearOf(ymd)).catch(() => []),
      ]);
      const rows = await Promise.all(classes.map(async (cls) => {
        if (!(await classIsSchoolDay(school.id, cls, ymd))) return { cls, status: 'off', count: 0, present: 0, absent: 0 };
        const day = await classAttendanceDay(ctx, school.id, cls, ymd);
        return { cls, status: day.count ? 'marked' : 'missing', ...day };
      }));
      const schoolDay = rows.some((r) => r.status !== 'off');
      const exp = expensesOn(expenseList, ymd);
      return {
        ...school,
        classes: rows,
        done: rows.every((r) => r.status !== 'missing'),
        present: rows.reduce((t, r) => t + (r.present || 0), 0),
        absent: rows.reduce((t, r) => t + (r.absent || 0), 0),
        schoolDay,
        expenses: { ...exp, required: schoolDay && isMonToFri(ymd), done: !(schoolDay && isMonToFri(ymd)) || exp.count > 0 },
      };
    }));
    return {
      ymd,
      schools,
      allDone: schools.every((s) => s.done),
      expensesDone: schools.every((s) => s.expenses.done),
    };
  }

  // ---------- fees recorded today (queued for approval) ----------
  async function paymentsQueuedOn(db, path, ymd, keep) {
    const start = new Date(`${ymd}T00:00:00+03:00`).getTime();
    const snap = await db.ref(path).orderByChild('createdAt').startAt(start).endAt(start + 86400000 - 1).once('value');
    const rows = Object.values(snap.val() || {}).filter((r) => r && (!keep || keep(r)));
    return { count: rows.length, amount: rows.reduce((t, r) => t + Number(r.amountPaidNow || 0), 0) };
  }

  async function paymentsToday(ctx, desk, ymd) {
    const out = [];
    if (desk.preformOne) {
      const res = await paymentsQueuedOn(ctx.db, 'approvalsPending', ymd, (r) => r.sourceModule === 'prefonefinance' && Number(r.amountPaidNow || 0) > 0)
        .catch(() => null);
      out.push({ id: 'preform', short: 'Preform One', href: URLS.preformFinance, ...(res || { count: null, amount: 0 }) });
    }
    await Promise.all(desk.linkedSchools.map(async (s) => {
      const res = await paymentsQueuedOn(ctx.db, `schools/${s.id}/approvalsPending`, ymd, (r) => Number(r.amountPaidNow || 0) > 0)
        .catch(() => null);
      out.push({ id: s.id, short: s.short, href: linkedUrl(s.id, 'finance'), ...(res || { count: null, amount: 0 }) });
    }));
    return out;
  }

  // ---------- one day of secretary work (hub stats, reminders, reports) ----------
  async function dayStatus(ctx, ymd) {
    const desk = deskFor(ctx.schoolId);
    const safe = (p) => p.catch((err) => { console.warn('Secretary day status part failed', err); return null; });
    const [preform, linked, calls, worker, doc] = await Promise.all([
      desk.preformOne ? safe(preformStatus(ctx, ymd)) : null,
      desk.linkedSchools.length ? safe(attendanceStatus(ctx, desk, ymd)) : null,
      desk.graduation ? safe(callsStatus(ctx, ymd)) : null,
      safe(workerDayRecord(ctx, ymd)),
      safe(readVal(ctx.schoolRef(dutyPath(ctx, ymd, `days/${dayKeyOf(ymd)}`)))),
    ]);
    return { ymd, desk, preform, linked, calls, worker: worker || null, doc: doc || {} };
  }

  // Human-readable list of the daily duties (attendance, expenses) left undone on a day.
  function missedDailyDuties(status) {
    const out = [];
    if (status.preform?.required && !status.preform.done) out.push(`Mahudhurio ya Preform One hayakuwekwa (${status.preform.total} wanafunzi)`);
    (status.linked?.schools || []).forEach((s) => {
      if (!s.done) out.push(`Mahudhurio ya ${s.short} hayakuwekwa: ${s.classes.filter((r) => r.status === 'missing').map((r) => r.cls).join(', ')}`);
      if (!s.expenses.done) out.push(`Matumizi (expenses) ya ${s.short} hayakurekodiwa`);
    });
    return out;
  }

  // ---------- PDF helpers (jsPDF + autoTable, loaded on demand) ----------
  function loadScript(src) {
    return new Promise((resolve, reject) => {
      const s = global.document.createElement('script');
      s.src = src;
      s.onload = resolve;
      s.onerror = () => reject(new Error(`Could not load ${src}`));
      global.document.head.appendChild(s);
    });
  }

  async function ensurePdf() {
    if (!global.jspdf?.jsPDF) await loadScript('https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js');
    const probe = new global.jspdf.jsPDF();
    if (typeof probe.autoTable !== 'function') await loadScript('https://cdnjs.cloudflare.com/ajax/libs/jspdf-autotable/3.8.0/jspdf.plugin.autotable.min.js');
    return global.jspdf.jsPDF;
  }

  let logoPromise = null;
  function logoDataUrl() {
    if (!logoPromise) {
      logoPromise = new Promise((resolve) => {
        const img = new Image();
        img.crossOrigin = 'anonymous';
        img.onload = () => {
          try {
            const c = global.document.createElement('canvas');
            c.width = img.naturalWidth; c.height = img.naturalHeight;
            c.getContext('2d').drawImage(img, 0, 0);
            resolve(c.toDataURL('image/jpeg', 0.92));
          } catch (_) { resolve(null); }
        };
        img.onerror = () => resolve(null);
        img.src = URLS.logo;
      });
    }
    return logoPromise;
  }

  // Branded SoMAp page header; returns the y position under it.
  async function pdfHeader(doc, { title, subtitle, accent = [190, 24, 93] }) {
    const w = doc.internal.pageSize.getWidth();
    doc.setFillColor(15, 22, 48);
    doc.rect(0, 0, w, 30, 'F');
    doc.setFillColor(...accent);
    doc.rect(0, 30, w, 1.6, 'F');
    const logo = await logoDataUrl();
    if (logo) {
      doc.setFillColor(255, 255, 255);
      doc.roundedRect(10, 5, 20, 20, 3, 3, 'F');
      doc.addImage(logo, 'JPEG', 11.5, 6.5, 17, 17);
    }
    doc.setTextColor(255, 255, 255);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(15);
    doc.text(title, 35, 14);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    doc.setTextColor(200, 208, 240);
    doc.text(subtitle || 'SoMAp · Society Management App', 35, 21);
    doc.text(`Imetolewa: ${new Date().toLocaleString('en-GB', { timeZone: 'Africa/Nairobi' })}`, w - 10, 21, { align: 'right' });
    doc.setTextColor(30, 30, 30);
    return 40;
  }

  function pdfFooter(doc) {
    const pages = doc.internal.getNumberOfPages();
    const w = doc.internal.pageSize.getWidth();
    const h = doc.internal.pageSize.getHeight();
    for (let i = 1; i <= pages; i += 1) {
      doc.setPage(i);
      doc.setFontSize(8);
      doc.setTextColor(120, 120, 140);
      doc.text('SoMAp · Secretary Desk', 10, h - 6);
      doc.text(`Ukurasa ${i} / ${pages}`, w - 10, h - 6, { align: 'right' });
    }
  }

  function pdfStatBoxes(doc, y, boxes) {
    const w = doc.internal.pageSize.getWidth();
    const gap = 4;
    const bw = (w - 20 - gap * (boxes.length - 1)) / boxes.length;
    boxes.forEach((b, i) => {
      const x = 10 + i * (bw + gap);
      doc.setFillColor(...(b.fill || [241, 245, 249]));
      doc.roundedRect(x, y, bw, 18, 2.5, 2.5, 'F');
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(12);
      doc.setTextColor(...(b.color || [15, 23, 42]));
      doc.text(String(b.value), x + 4, y + 8);
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(7.5);
      doc.setTextColor(90, 100, 120);
      doc.text(String(b.label), x + 4, y + 14);
    });
    return y + 24;
  }

  async function downloadPreformDebtsPdf(debts, { schoolName, ymd, by }) {
    const JsPDF = await ensurePdf();
    const doc = new JsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
    const w = doc.internal.pageSize.getWidth();
    let y = await pdfHeader(doc, {
      title: 'Preform One · Orodha ya Madeni',
      subtitle: `${schoolName || 'Socrates School'} · ${prettyDate(ymd)} ${ymd}${by ? ` · ${by}` : ''}`,
    });
    y = pdfStatBoxes(doc, y, [
      { label: 'Wanafunzi wenye deni', value: debts.rows.length, color: [190, 18, 60] },
      { label: 'Deni lote', value: tsh(debts.outstanding), color: [190, 18, 60] },
      { label: 'Wamechelewa kulipa', value: debts.overdue, color: [180, 83, 9] },
      { label: 'Wanafunzi wote', value: debts.learners },
    ]);
    doc.setFillColor(254, 226, 226);
    doc.roundedRect(10, y, w - 20, 14, 2.5, 2.5, 'F');
    doc.setTextColor(153, 27, 27);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10);
    doc.text('HAKUNA CASH (NO CASH). Mzazi alipe kupitia akaunti ya benki ya shule (CRDB) au mtoto arudi nyumbani.', 14, y + 6);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8.5);
    doc.text('Katibu akipatikana amepokea fedha taslimu za mwanafunzi, posho ya uwajibikaji itakatwa MARA MBILI ya kiasi alichopokea.', 14, y + 11);
    y += 19;
    doc.autoTable({
      startY: y,
      head: [['#', 'ADM', 'Jina la mwanafunzi', 'Simu ya mzazi', 'Ada', 'Amelipa', 'Deni', 'Hali', 'Simu imepigwa?']],
      body: debts.rows.map((r, i) => [i + 1, r.adm, r.name, r.contact || '--', tsh(r.totalFee), tsh(r.paid), tsh(r.bal), r.label, '']),
      foot: [['', '', `JUMLA (${debts.rows.length})`, '', '', '', tsh(debts.outstanding), '', '']],
      styles: { fontSize: 8.5, cellPadding: 2.2 },
      headStyles: { fillColor: [15, 22, 48], textColor: 255 },
      footStyles: { fillColor: [241, 245, 249], textColor: [15, 23, 42], fontStyle: 'bold' },
      alternateRowStyles: { fillColor: [248, 250, 252] },
      columnStyles: { 6: { textColor: [190, 18, 60], fontStyle: 'bold' } },
      didParseCell: (data) => {
        if (data.section === 'body' && data.column.index === 7) {
          const row = debts.rows[data.row.index];
          if (row?.status === 'overdue') data.cell.styles.textColor = [190, 18, 60];
          else if (row?.status === 'soon') data.cell.styles.textColor = [180, 83, 9];
        }
      },
      margin: { left: 10, right: 10 },
    });
    pdfFooter(doc);
    doc.save(`PreformOne_Madeni_${ymd}.pdf`);
  }

  // ---------- dialog UI ----------
  function injectStyles() {
    if (document.getElementById('sdStyles')) return;
    const style = document.createElement('style');
    style.id = 'sdStyles';
    style.textContent = `
      .sd-overlay{position:fixed;inset:0;z-index:100000;display:grid;place-items:center;padding:16px;background:rgba(3,6,18,.78);backdrop-filter:blur(8px);animation:sdFade .2s ease}
      @keyframes sdFade{from{opacity:0}to{opacity:1}}
      @keyframes sdRise{from{transform:translateY(18px) scale(.98);opacity:0}to{transform:none;opacity:1}}
      .sd-card{--sd-accent:#f472b6;width:min(720px,100%);max-height:92vh;overflow:auto;border-radius:26px;background:#0f1630;color:#e7ecff;border:1px solid rgba(255,255,255,.1);box-shadow:0 40px 100px -30px color-mix(in srgb,var(--sd-accent) 55%,transparent),0 0 0 1px rgba(255,255,255,.03);animation:sdRise .28s cubic-bezier(.2,.8,.2,1);font-family:'Inter',system-ui,sans-serif}
      .sd-head{position:relative;overflow:hidden;padding:22px 24px 20px;background:linear-gradient(135deg,color-mix(in srgb,var(--sd-accent) 32%,transparent),rgba(167,139,250,.14) 55%,rgba(56,189,248,.08));border-bottom:1px solid rgba(255,255,255,.08)}
      .sd-head::after{content:'';position:absolute;right:-50px;top:-60px;width:200px;height:200px;border-radius:50%;background:radial-gradient(circle,rgba(255,255,255,.16),transparent 70%)}
      .sd-top{display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:12px}
      .sd-eyebrow{font-size:.7rem;font-weight:800;letter-spacing:.18em;text-transform:uppercase;color:color-mix(in srgb,var(--sd-accent) 70%,#fff)}
      .sd-steps{display:flex;gap:6px}.sd-steps i{width:22px;height:6px;border-radius:99px;background:rgba(255,255,255,.14)}.sd-steps i.on{background:var(--sd-accent)}.sd-steps i.done{background:color-mix(in srgb,var(--sd-accent) 45%,transparent)}
      .sd-title{display:flex;gap:14px;align-items:center}
      .sd-icon{flex:none;width:54px;height:54px;border-radius:17px;display:grid;place-items:center;font-size:1.7rem;background:color-mix(in srgb,var(--sd-accent) 24%,transparent);border:1px solid color-mix(in srgb,var(--sd-accent) 50%,transparent)}
      .sd-icon img{width:46px;height:46px;border-radius:13px;background:#fff;padding:3px;object-fit:contain}
      .sd-title h2{margin:0;font:700 1.25rem/1.25 'Poppins','Inter',sans-serif;color:#fff}
      .sd-title p{margin:4px 0 0;color:#c4cbe8;font-size:.88rem;line-height:1.45}
      .sd-body{padding:20px 24px 4px;line-height:1.6;font-size:.93rem;color:#d4daf3}
      .sd-body p{margin:0 0 12px}
      .sd-stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(130px,1fr));gap:10px;margin:4px 0 16px}
      .sd-stat{padding:12px 14px;border-radius:15px;background:rgba(7,11,29,.55);border:1px solid rgba(255,255,255,.08)}
      .sd-stat b{display:block;font:700 1.25rem 'Poppins','Inter',sans-serif;color:#fff}.sd-stat small{color:#9aa4c7;font-size:.72rem}
      .sd-stat.bad b{color:#fda4af}.sd-stat.good b{color:#86efac}.sd-stat.warn b{color:#fcd34d}
      .sd-alert{display:flex;gap:10px;padding:12px 14px;border-radius:14px;margin:0 0 14px;font-size:.87rem;line-height:1.5}
      .sd-alert.bad{background:rgba(251,113,133,.12);border:1px solid rgba(251,113,133,.35);color:#fecdd3}
      .sd-alert.warn{background:rgba(251,191,36,.1);border:1px solid rgba(251,191,36,.35);color:#fde68a}
      .sd-alert.good{background:rgba(52,211,153,.1);border:1px solid rgba(52,211,153,.35);color:#bbf7d0}
      .sd-nocash{margin:0 0 14px;padding:14px 16px;border-radius:16px;background:linear-gradient(135deg,rgba(225,29,72,.28),rgba(190,18,60,.18));border:2px solid rgba(251,113,133,.7);color:#fff}
      .sd-nocash b{display:block;font:800 1.15rem 'Poppins','Inter',sans-serif;letter-spacing:.04em;color:#ffe4e6}
      .sd-nocash span{display:block;margin-top:4px;font-size:.86rem;color:#fecdd3;line-height:1.5}
      .sd-school{border-radius:16px;border:1px solid rgba(255,255,255,.09);background:rgba(7,11,29,.45);padding:12px 14px;margin-bottom:10px}
      .sd-school h4{margin:0 0 8px;display:flex;justify-content:space-between;gap:8px;font:600 .95rem 'Poppins','Inter',sans-serif;color:#fff}
      .sd-pills{display:flex;flex-wrap:wrap;gap:6px}
      .sd-pill{padding:5px 10px;border-radius:99px;font-size:.76rem;font-weight:600;border:1px solid}
      .sd-pill.marked{color:#86efac;border-color:rgba(52,211,153,.4);background:rgba(52,211,153,.1)}
      .sd-pill.missing{color:#fda4af;border-color:rgba(251,113,133,.45);background:rgba(251,113,133,.1)}
      .sd-pill.off{color:#9aa4c7;border-color:rgba(148,163,184,.3);background:rgba(148,163,184,.08)}
      .sd-links{display:flex;flex-wrap:wrap;gap:8px;margin:10px 0 2px}
      .sd-link{display:inline-flex;align-items:center;gap:6px;padding:8px 12px;border-radius:11px;font-size:.8rem;font-weight:700;text-decoration:none;color:#e7ecff;background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.14)}
      .sd-link:hover{background:rgba(255,255,255,.12)}
      .sd-list{margin:0 0 14px;padding:0;list-style:none;display:grid;gap:8px}
      .sd-list li{display:flex;gap:10px;align-items:flex-start;padding:10px 12px;border-radius:12px;background:rgba(7,11,29,.5);border:1px solid rgba(255,255,255,.07)}
      .sd-table{width:100%;border-collapse:collapse;font-size:.8rem;margin:0 0 14px}
      .sd-table th{text-align:left;color:#9aa4c7;font-weight:700;padding:6px 8px;border-bottom:1px solid rgba(255,255,255,.1)}
      .sd-table td{padding:6px 8px;border-bottom:1px solid rgba(255,255,255,.05)}
      .sd-scroll{max-height:220px;overflow:auto;border-radius:12px;border:1px solid rgba(255,255,255,.08);margin-bottom:14px}
      .sd-scroll .sd-table{margin:0}
      .sd-check{display:flex;gap:10px;align-items:flex-start;padding:12px 14px;border-radius:14px;background:rgba(7,11,29,.55);border:1px solid rgba(255,255,255,.12);cursor:pointer;margin:0 0 12px;font-weight:600;color:#fff}
      .sd-check input{width:20px;height:20px;margin-top:2px;accent-color:var(--sd-accent);flex:none}
      .sd-field label{display:block;font-weight:700;margin-bottom:8px;color:#fff}
      .sd-field textarea,.sd-field input{width:100%;box-sizing:border-box;border-radius:14px;border:1px solid rgba(255,255,255,.14);background:#080d22;color:#eef2ff;padding:13px 14px;font:inherit;outline:none;transition:border-color .2s,box-shadow .2s}
      .sd-field textarea{min-height:190px;resize:vertical}
      .sd-field input{font:700 1.6rem 'Poppins','Inter',sans-serif;text-align:center;letter-spacing:.04em}
      .sd-field textarea:focus,.sd-field input:focus{border-color:var(--sd-accent);box-shadow:0 0 0 3px color-mix(in srgb,var(--sd-accent) 25%,transparent)}
      .sd-meter{margin-top:10px;display:flex;align-items:center;gap:12px;font-size:.8rem;color:#9aa4c7}
      .sd-meter .bar{flex:1;height:8px;border-radius:99px;background:rgba(255,255,255,.08);overflow:hidden}
      .sd-meter .bar i{display:block;height:100%;width:0;border-radius:99px;background:linear-gradient(90deg,#fb7185,#fbbf24);transition:width .25s ease}
      .sd-meter.ok .bar i{background:linear-gradient(90deg,#34d399,#22d3ee)}.sd-meter.ok b{color:#86efac}
      .sd-actions{display:flex;flex-wrap:wrap;gap:10px;justify-content:flex-end;padding:16px 24px 22px}
      .sd-btn{display:inline-flex;align-items:center;justify-content:center;gap:8px;min-height:44px;padding:10px 16px;border-radius:13px;border:1px solid rgba(255,255,255,.14);background:rgba(255,255,255,.05);color:#e7ecff;font:600 .9rem 'Inter',sans-serif;cursor:pointer;text-decoration:none;transition:transform .15s,background .2s,opacity .2s}
      .sd-btn:hover{transform:translateY(-1px);background:rgba(255,255,255,.1)}
      .sd-btn.primary{border-color:transparent;color:#1a0b24;background:linear-gradient(135deg,var(--sd-accent),color-mix(in srgb,var(--sd-accent) 50%,#fff))}
      .sd-btn.danger{border-color:rgba(251,113,133,.45);color:#fecdd3}
      .sd-btn[disabled]{opacity:.45;cursor:not-allowed;transform:none}
      @media (max-width:560px){.sd-head,.sd-body{padding-left:18px;padding-right:18px}.sd-actions{padding:14px 18px 18px}.sd-actions .sd-btn{flex:1 1 100%}}
    `;
    document.head.appendChild(style);
  }

  // Opens a styled duty dialog. `input` is { type:'letter', minWords, label, placeholder }
  // or { type:'number', label }. Actions: { label, value, primary, danger, needsInput }
  // close the dialog with that value; { href } is a plain link (new tab); { href, value }
  // opens the link AND closes with the value. `onMount(overlay, api)` may add extra
  // gating with api.setReady(bool). Resolves with { action, value } (action null on Cancel).
  function openDialog({ accent = '#f472b6', icon, eyebrow, title, subtitle, html = '', step, input, actions, onMount }) {
    injectStyles();
    return new Promise((resolve) => {
      const overlay = document.createElement('div');
      overlay.className = 'sd-overlay';
      const steps = step ? `<div class="sd-steps">${Array.from({ length: step.total }, (_, i) =>
        `<i class="${i + 1 === step.index ? 'on' : i + 1 < step.index ? 'done' : ''}"></i>`).join('')}</div>` : '';
      let field = '';
      if (input?.type === 'letter') {
        field = `<div class="sd-field"><label for="sdInput">${esc(input.label || 'Maelezo yako')}</label>
          <textarea id="sdInput" placeholder="${esc(input.placeholder || 'Andika hapa...')}"></textarea>
          <div class="sd-meter"><div class="bar"><i></i></div><span><b id="sdCount">0</b> / ${input.minWords} maneno</span></div></div>`;
      } else if (input?.type === 'number') {
        field = `<div class="sd-field"><label for="sdInput">${esc(input.label || 'Idadi')}</label>
          <input id="sdInput" type="number" min="0" step="1" inputmode="numeric" placeholder="0" /></div>`;
      }
      overlay.innerHTML = `
        <section class="sd-card" role="dialog" aria-modal="true" style="--sd-accent:${accent}">
          <header class="sd-head">
            <div class="sd-top"><span class="sd-eyebrow">${esc(eyebrow || 'Secretary Desk')}</span>${steps}</div>
            <div class="sd-title"><div class="sd-icon">${icon || '🗂️'}</div>
              <div><h2>${esc(title)}</h2>${subtitle ? `<p>${esc(subtitle)}</p>` : ''}</div></div>
          </header>
          <div class="sd-body">${html}${field}</div>
          <footer class="sd-actions"></footer>
        </section>`;
      document.body.appendChild(overlay);

      const field$ = overlay.querySelector('#sdInput');
      const host = overlay.querySelector('.sd-actions');
      const gated = [];
      let extraReady = true;
      const inputValid = () => {
        if (!input) return true;
        if (input.type === 'number') return field$.value !== '' && Number(field$.value) >= 0 && Number.isInteger(Number(field$.value));
        return countWords(field$.value) >= input.minWords;
      };
      const valid = () => extraReady && inputValid();
      const refresh = () => {
        if (input?.type === 'letter') {
          const words = countWords(field$.value);
          overlay.querySelector('#sdCount').textContent = words;
          overlay.querySelector('.sd-meter .bar i').style.width = `${Math.min(100, (words / input.minWords) * 100)}%`;
          overlay.querySelector('.sd-meter').classList.toggle('ok', words >= input.minWords);
        }
        gated.forEach((b) => { b.disabled = !valid(); });
      };
      const finish = (action) => {
        overlay.remove();
        resolve({ action, value: field$ ? field$.value.trim() : '' });
      };
      (actions || [{ label: 'Endelea', value: 'ok', primary: true }]).forEach((a) => {
        const plainLink = a.href && a.value === undefined;
        const btn = document.createElement(plainLink ? 'a' : 'button');
        btn.className = `sd-btn${a.primary ? ' primary' : ''}${a.danger ? ' danger' : ''}`;
        btn.textContent = a.label;
        if (plainLink) {
          btn.href = a.href;
          btn.target = '_blank';
          btn.rel = 'noopener';
        } else {
          btn.type = 'button';
          btn.addEventListener('click', () => {
            if (a.needsInput && !valid()) return;
            if (a.href) global.open(a.href, '_blank', 'noopener');
            finish(a.value ?? null);
          });
          if (a.needsInput) gated.push(btn);
        }
        host.appendChild(btn);
      });
      field$?.addEventListener('input', refresh);
      if (onMount) {
        onMount(overlay, { setReady: (ok) => { extraReady = Boolean(ok); refresh(); }, refresh });
      }
      refresh();
      setTimeout(() => field$?.focus(), 60);
    });
  }

  function attendanceHtml(status, { withExpenses = false } = {}) {
    return status.schools.map((s) => {
      const pills = s.classes.length
        ? s.classes.map((r) => `<span class="sd-pill ${r.status}">${r.status === 'marked' ? '✓' : r.status === 'off' ? '—' : '✗'} ${esc(r.cls)}${r.status === 'marked' ? ` · ${r.count}` : r.status === 'off' ? ' · si siku ya shule' : ''}</span>`).join('')
        : '<span class="sd-pill off">Hakuna darasa lenye wanafunzi</span>';
      const expPill = withExpenses && s.expenses?.required
        ? `<span class="sd-pill ${s.expenses.done ? 'marked' : 'missing'}">${s.expenses.done ? `✓ Matumizi ${s.expenses.count} · ${tsh(s.expenses.amount)}` : '✗ Matumizi ya leo hayajarekodiwa'}</span>`
        : '';
      const ok = s.done && (!withExpenses || s.expenses?.done !== false);
      return `<div class="sd-school"><h4><span>🏫 ${esc(s.name)} (${esc(s.short)})</span><span>${ok ? '✅' : '⏳'}</span></h4><div class="sd-pills">${pills}${expPill}</div></div>`;
    }).join('');
  }

  function linkedLinksHtml(desk, pages) {
    return `<div class="sd-links">${desk.linkedSchools.map((s) => pages.map((p) =>
      `<a class="sd-link" target="_blank" rel="noopener" href="${esc(linkedUrl(s.id, p.page))}">${p.icon} ${esc(p.label)} ${esc(s.short)}</a>`).join('')).join('')}</div>`;
  }

  const NO_CASH_HTML = `<div class="sd-nocash"><b>🚫 HAKUNA CASH · NO CASH</b><span>Usipokee fedha taslimu za mwanafunzi yeyote. Mzazi alipe kupitia akaunti ya benki ya shule (CRDB). Ukipatikana umepokea cash ya mtoto, <u>posho yako ya uwajibikaji itakatwa MARA MBILI ya kiasi ulichopokea</u>.</span></div>`;

  // "Do you know you must ... today?" — only YES moves on. Returns false if cancelled.
  async function mustKnow({ accent, icon, eyebrow, step, title, subtitle, html }) {
    for (;;) {
      const res = await openDialog({
        accent, icon, eyebrow, step, title, subtitle, html,
        actions: [{ label: 'HAPANA', value: 'no', danger: true }, { label: 'NDIYO, NINAJUA', value: 'yes', primary: true }],
      });
      if (res.action === 'yes') return true;
      const again = await openDialog({
        accent: '#fb7185', icon: '⛔', eyebrow, step,
        title: 'Jibu sahihi ni NDIYO',
        subtitle: 'Leo ni siku ya kazi (Jumatatu hadi Ijumaa). Kazi hii ni yako kila siku ya kazi.',
        html: '<div class="sd-alert bad">⚠️ <span>Huwezi kuendelea na check-in mpaka ukubali kwamba unajua kazi hii ya leo.</span></div>',
        actions: [{ label: 'Ghairi Check-in', value: null }, { label: 'Nimeelewa — Rudi kwenye swali', value: 'retry', primary: true }],
      });
      if (again.action !== 'retry') return false;
    }
  }

  // Debtors popup: shows the list, must download the PDF and accept the NO CASH rule.
  // Used at check-in (mandatory) and by the Secretary Hub. Returns true when completed.
  async function preformDebtsDialog(ctx, { ymd = todayYmd(), step, mandatory = true, schoolName } = {}) {
    const students = await readPreformStudents(ctx.db, yearOf(ymd));
    const debts = preformDebtors(students, ymd);
    const todayRef = ctx.schoolRef(dutyPath(ctx, ymd, `days/${dayKeyOf(ymd)}/preformDebts`));
    const already = await readVal(todayRef).catch(() => null);
    let downloaded = Boolean(already?.downloadedAt);
    const rowsHtml = debts.rows.map((r, i) => `<tr><td>${i + 1}</td><td>${esc(r.name)}<br><small style="color:#9aa4c7">${esc(r.adm)}</small></td><td>${esc(r.contact || '--')}</td><td style="color:#fda4af;font-weight:700">${tsh(r.bal)}</td><td style="color:${r.status === 'overdue' ? '#fda4af' : r.status === 'soon' ? '#fcd34d' : '#9aa4c7'}">${esc(r.label)}</td></tr>`).join('');
    const res = await openDialog({
      accent: '#38bdf8',
      icon: `<img src="${esc(URLS.logo)}" alt="SoMAp">`,
      eyebrow: `SoMAp · Preform One · ${prettyDate(ymd)}`,
      step,
      title: debts.rows.length ? 'Madeni ya Preform One — wapigie simu leo' : 'Preform One — hakuna deni leo',
      subtitle: debts.rows.length
        ? 'Pakua PDF, wapigie wazazi wa watoto hawa: walipe kupitia benki au mtoto arudi nyumbani.'
        : 'Wanafunzi wote wa Preform One wamelipa ada yao. Kumbuka sheria ya NO CASH.',
      html: `${NO_CASH_HTML}
        <div class="sd-stats">
          <div class="sd-stat ${debts.rows.length ? 'bad' : 'good'}"><b>${debts.rows.length}</b><small>Wanafunzi wenye deni</small></div>
          <div class="sd-stat ${debts.rows.length ? 'bad' : 'good'}"><b>${tsh(debts.outstanding)}</b><small>Deni lote</small></div>
          <div class="sd-stat warn"><b>${debts.overdue}</b><small>Wamechelewa kulipa</small></div>
          <div class="sd-stat"><b>${debts.learners}</b><small>Wanafunzi wote</small></div>
        </div>
        ${debts.rows.length ? `<div class="sd-scroll"><table class="sd-table"><thead><tr><th>#</th><th>Mwanafunzi</th><th>Simu ya mzazi</th><th>Deni</th><th>Hali</th></tr></thead><tbody>${rowsHtml}</tbody></table></div>
        <div class="sd-links"><button type="button" class="sd-btn primary" data-pdf>📄 Pakua PDF ya Madeni</button><a class="sd-link" target="_blank" rel="noopener" href="${esc(URLS.preformFinance)}">💳 Fungua Preform One Finance</a></div>
        <p data-pdf-state style="font-size:.82rem;color:${downloaded ? '#86efac' : '#fcd34d'};margin:8px 0 12px">${downloaded ? '✓ PDF ya leo imeshapakuliwa.' : '⏳ Lazima upakue PDF kabla ya kuendelea.'}</p>` : ''}
        <label class="sd-check"><input type="checkbox" data-ack> <span>Nimeelewa: SIPOKEI CASH. Malipo yote ni kupitia akaunti ya benki ya shule (CRDB). Nikipokea cash, posho yangu itakatwa mara mbili ya kiasi hicho.</span></label>`,
      actions: mandatory
        ? [{ label: 'Ghairi', value: null }, { label: 'Nimeelewa, Endelea', value: 'ok', primary: true, needsInput: true }]
        : [{ label: 'Funga', value: null }, { label: 'Nimeelewa', value: 'ok', primary: true, needsInput: true }],
      onMount: (overlay, api) => {
        const ack = overlay.querySelector('[data-ack]');
        const update = () => api.setReady(ack.checked && (downloaded || !debts.rows.length));
        ack.addEventListener('change', update);
        overlay.querySelector('[data-pdf]')?.addEventListener('click', async (e) => {
          const btn = e.currentTarget;
          btn.disabled = true;
          btn.textContent = 'Inaandaa PDF...';
          try {
            await downloadPreformDebtsPdf(debts, { schoolName, ymd, by: ctx.workerName });
            downloaded = true;
            await todayRef.update({ downloadedAt: Date.now(), debtors: debts.rows.length, outstanding: debts.outstanding });
            const state = overlay.querySelector('[data-pdf-state]');
            state.textContent = '✓ PDF imepakuliwa. Wapigie wazazi hawa leo.';
            state.style.color = '#86efac';
          } catch (err) {
            console.error('Preform One debts PDF failed', err);
            global.alert(`PDF haikutengenezwa: ${err.message}`);
          } finally {
            btn.disabled = false;
            btn.textContent = '📄 Pakua PDF tena';
            update();
          }
        });
        update();
      },
    });
    if (res.action !== 'ok') return false;
    await todayRef.update({
      ackNoCash: true, ackAt: Date.now(), debtors: debts.rows.length, outstanding: debts.outstanding,
      ...(debts.rows.length ? {} : { downloadedAt: already?.downloadedAt || Date.now(), noDebtors: true }),
    });
    return true;
  }

  // ---------- check-in ----------
  async function runCheckIn(ctx) {
    const desk = deskFor(ctx.schoolId);
    if (!hasDuties(desk) || ctx.todayYmd < DUTY_START_YMD || !isMonToFri(ctx.todayYmd)) return { ok: true };
    const today = ctx.todayYmd;
    const daily = today >= DAILY_DUTY_START_YMD;
    const todayKey = dayKeyOf(today);
    const todayPath = dutyPath(ctx, today, `days/${todayKey}`);
    const todayDoc = (await readVal(ctx.schoolRef(todayPath)).catch(() => null)) || {};
    const prev = await previousDutyDay(ctx, today);
    const prevRecord = prev ? await workerDayRecord(ctx, prev).catch(() => null) : null;
    const workedPrev = Boolean(prev && prevRecord?.checkInTs);

    // Work out which steps apply before showing anything, so the step bar is honest.
    const plan = [];
    let override = null;
    if (workedPrev) {
      const prevDay = (await readVal(ctx.schoolRef(dutyPath(ctx, prev, `days/${dayKeyOf(prev)}`)))) || {};
      if (prevDay.checkoutOverride && !prevDay.followUp) { override = prevDay.checkoutOverride; plan.push('followUp'); }
    }
    let calls = null;
    if (desk.graduation && workedPrev) {
      const already = await readVal(ctx.schoolRef(dutyPath(ctx, prev, `missedCalls/${dayKeyOf(prev)}`)));
      if (!already) {
        try {
          calls = await callsStatus(ctx, prev);
          if (!calls.complete) plan.push('calls');
        } catch (err) {
          console.warn('Secretary calls check skipped', err);
        }
      }
    }
    let preformAnswer = null;
    if (desk.preformOne && inPreformWindow(today)) {
      preformAnswer = todayDoc.preformOne || null;
      // Unanswered today, or answered wrongly without the explanation yet.
      if (!preformAnswer || (preformAnswer.match === false && !preformAnswer.explanation)) plan.push('preform');
    }
    // Yesterday's missed attendance / expenses: reminded once, before signing in.
    let yesterdayMissed = [];
    if (daily && workedPrev && prev >= DAILY_DUTY_START_YMD && !todayDoc.yesterdayReminder) {
      try {
        yesterdayMissed = missedDailyDuties(await dayStatus(ctx, prev));
        if (yesterdayMissed.length && !plan.includes('followUp')) plan.push('yesterday');
      } catch (err) { console.warn('Yesterday duty check skipped', err); }
    }
    let preformToday = null;
    if (daily && desk.preformOne) {
      try {
        preformToday = await preformStatus(ctx, today);
        if (preformToday.required && !todayDoc.morningPlan?.preformAttendance) plan.push('preformAttendance');
      } catch (err) { console.warn('Preform One attendance check skipped', err); }
    }
    let attendance = null;
    if (desk.linkedSchools.length) {
      try {
        attendance = await attendanceStatus(ctx, desk, today);
        plan.push('attendance');
      } catch (err) {
        console.warn('Linked-school attendance check skipped', err);
      }
    }
    if (daily && desk.preformOne && !(todayDoc.preformDebts?.downloadedAt && todayDoc.preformDebts?.ackNoCash)) plan.push('preformDebts');
    const total = plan.length;
    const stepOf = (name) => ({ index: plan.indexOf(name) + 1, total });
    const morningPlanRef = ctx.schoolRef(`${todayPath}/morningPlan`);
    const missedHtml = (list) => `<ul class="sd-list">${list.map((p) => `<li>❌ <span>${esc(p)}</span></li>`).join('')}</ul>`;

    // 1. Follow-up: left yesterday with unfinished duties.
    if (plan.includes('followUp')) {
      const pending = Array.isArray(override.pending) ? override.pending : [];
      const res = await openDialog({
        accent: '#fb7185', icon: '🌙', eyebrow: 'Kazi za jana bado zinakufuata', step: stepOf('followUp'),
        title: `Jana (${prettyDate(prev)}) uliondoka bila kumaliza kazi zako`,
        subtitle: 'Uliandika maelezo wakati wa kuondoka. Leo asubuhi lazima ueleze tena hatua utakazochukua.',
        html: `<ul class="sd-list">${pending.map((p) => `<li>⏳ <span>${esc(p)}</span></li>`).join('')}</ul>
          ${yesterdayMissed.length ? `<div class="sd-alert bad">📌 <span>Kumbuka: jana hukuweka/kurekodi yafuatayo — yanaonekana kwenye ripoti ya kazi zako.</span></div>${missedHtml(yesterdayMissed)}` : ''}
          <div class="sd-alert warn">✍️ <span>Eleza kwa nini kazi hizi hazikumalizika, nani alijulishwa, na utazimaliza lini leo. Maelezo haya yanaonekana kwa uongozi.</span></div>`,
        input: { type: 'letter', minWords: WORDS.followUp, label: `Maelezo ya ufuatiliaji (maneno ${WORDS.followUp}+)`, placeholder: 'Jana sikumaliza kwa sababu... Leo nitafanya...' },
        actions: [{ label: 'Ghairi', value: null }, { label: 'Hifadhi & Endelea', value: 'save', primary: true, needsInput: true }],
      });
      if (res.action !== 'save') return { ok: false, message: 'Check-in imeghairiwa; maelezo ya kazi za jana yanahitajika kwanza.' };
      await ctx.schoolRef(dutyPath(ctx, prev, `days/${dayKeyOf(prev)}/followUp`)).set({
        explanation: res.value, words: countWords(res.value), writtenOn: today, at: Date.now(),
      });
      if (yesterdayMissed.length) {
        await ctx.schoolRef(`${todayPath}/yesterdayReminder`).set({ ymd: prev, missed: yesterdayMissed, at: Date.now(), via: 'followUp' });
      }
    }

    // 2. Graduation calls not completed on the previous working day.
    let strikeNotice = null;
    if (plan.includes('calls')) {
      const monthPath = dutyPath(ctx, prev, 'missedCalls');
      const priorMissed = Object.keys((await readVal(ctx.schoolRef(monthPath))) || {}).length;
      const missedNumber = priorMissed + 1;
      const untilStrike = STRIKE_EVERY - (missedNumber % STRIKE_EVERY || STRIKE_EVERY);
      const willStrike = missedNumber % STRIKE_EVERY === 0;
      const res = await openDialog({
        accent: '#f472b6', icon: '📞', eyebrow: 'Mahafali · Simu za wazazi', step: stepOf('calls'),
        title: 'Hukuwapigia simu wazazi wa mahafali jana',
        subtitle: `${prettyDate(prev)} — kazi ya kila siku ni kupiga simu kwa wazazi ${calls.required} wenye deni la mahafali.`,
        html: `<div class="sd-stats">
            <div class="sd-stat bad"><b>${calls.made}/${calls.required}</b><small>Simu zilizopigwa jana</small></div>
            <div class="sd-stat warn"><b>${calls.debtors}</b><small>Wazazi wenye deni</small></div>
            <div class="sd-stat warn"><b>${tsh(calls.outstanding)}</b><small>Deni la mahafali</small></div>
            <div class="sd-stat ${willStrike ? 'bad' : 'warn'}"><b>${missedNumber}</b><small>Siku zilizokosa mwezi huu</small></div>
          </div>
          <div class="sd-alert ${willStrike ? 'bad' : 'warn'}">⚖️ <span>${willStrike
            ? `Hii ni siku ya ${missedNumber} mwezi huu. Kwa kila siku ${STRIKE_EVERY} zilizokosa, posho ya uwajibikaji inakatwa <b>${tsh(STRIKE_AMOUNT)}</b>. Makato haya yataingia kwenye mshahara wako.`
            : `Kwa kila siku ${STRIKE_EVERY} zilizokosa ndani ya mwezi, posho ya uwajibikaji inakatwa ${tsh(STRIKE_AMOUNT)}. Zimebaki siku ${untilStrike} kabla ya makato.`}</span></div>`,
        input: { type: 'letter', minWords: WORDS.missedCalls, label: `Eleza kwa nini hukupiga simu jana (maneno ${WORDS.missedCalls}+)`, placeholder: 'Jana sikupiga simu kwa wazazi wa mahafali kwa sababu...' },
        actions: [{ label: 'Ghairi', value: null }, { label: 'Fungua Simu za Wazazi', href: URLS.calls }, { label: 'Hifadhi Barua & Endelea', value: 'save', primary: true, needsInput: true }],
      });
      if (res.action !== 'save') return { ok: false, message: 'Check-in imeghairiwa; barua ya simu za mahafali za jana inahitajika kwanza.' };
      const letterRef = ctx.schoolRef(`${monthPath}/${dayKeyOf(prev)}`);
      await letterRef.set({
        ymd: prev, required: calls.required, made: calls.made, missedNumber,
        letter: res.value, words: countWords(res.value), writtenOn: today, at: Date.now(),
        workerName: ctx.workerName || '',
      });
      if (willStrike) {
        try {
          const strike = await applyStrike(ctx, prev, missedNumber / STRIKE_EVERY, missedNumber);
          await letterRef.update({ strikeNumber: missedNumber / STRIKE_EVERY, deductionApplied: STRIKE_AMOUNT, disciplineEventId: strike.eventId });
          strikeNotice = { missedNumber, summary: strike.summary };
        } catch (err) {
          console.error('Secretary strike could not be written', err);
          ctx.toast?.('Makato ya posho hayakuhifadhiwa — uongozi utaarifiwa.', 'warning', 6000);
        }
      }
    }
    if (strikeNotice) {
      await openDialog({
        accent: '#fb7185', icon: '✂️', eyebrow: 'Posho ya uwajibikaji', title: `Posho imekatwa ${tsh(STRIKE_AMOUNT)}`,
        subtitle: `Siku ${strikeNotice.missedNumber} za simu za mahafali zimekosekana mwezi huu.`,
        html: `<div class="sd-stats">
            <div class="sd-stat bad"><b>${tsh(strikeNotice.summary?.totalResponsibilityDeduction)}</b><small>Jumla ya makato mwezi huu</small></div>
            <div class="sd-stat good"><b>${tsh(strikeNotice.summary?.remainingResponsibilityAllowance)}</b><small>Posho iliyobaki</small></div>
          </div><p>Makato haya yameingia kwenye daftari la nidhamu linalosomwa na payroll. Kama unaona si sahihi, utaweza kuyakataa kwenye uthibitisho wa mshahara utakaofuata na Finance itayapitia.</p>`,
        actions: [{ label: 'Nimeelewa', value: 'ok', primary: true }],
      });
    }

    // 3. Preform One registration count (15 Sep – 25 Dec).
    if (plan.includes('preform')) {
      const year = yearOf(today);
      const preformRef = ctx.schoolRef(`${todayPath}/preformOne`);
      let record = preformAnswer;
      if (!record) {
        const res = await openDialog({
          accent: '#38bdf8', icon: '🌱', eyebrow: `Preform One · Programu ya ${year}`, step: stepOf('preform'),
          title: 'Preform One wangapi wamesajiliwa mwaka huu?',
          subtitle: 'Kuanzia 15 Septemba hadi 25 Desemba, kila asubuhi unathibitisha idadi ya wanafunzi wa Preform One uliowasajili.',
          html: '<div class="sd-alert warn">🔎 <span>Andika idadi unayoijua. Mfumo utailinganisha na faili la usajili (Live Admissions) mara moja.</span></div>',
          input: { type: 'number', label: 'Idadi ya Preform One waliosajiliwa' },
          actions: [{ label: 'Ghairi', value: null }, { label: 'Thibitisha', value: 'save', primary: true, needsInput: true }],
        });
        if (res.action !== 'save') return { ok: false, message: 'Check-in imeghairiwa; jibu idadi ya Preform One kwanza.' };
        const declared = Number(res.value);
        let actual = null;
        try { actual = await preformCount(ctx, year); } catch (err) { console.warn('Preform One count failed', err); }
        // The morning answer is final: saved before any explanation so it cannot be re-guessed.
        record = { declared, actual, match: actual === null ? null : declared === actual, year, at: Date.now() };
        await preformRef.set(record);
        if (record.match) ctx.toast?.(`✅ Sahihi! Preform One ${actual} wamesajiliwa — inaendana na faili.`, 'success', 4500);
      }
      const { declared, actual } = record;
      if (record.match === false) {
        const diff = declared - actual;
        const letter = await openDialog({
          accent: '#fbbf24', icon: '⚖️', eyebrow: 'Preform One · Tofauti ya idadi', step: stepOf('preform'),
          title: 'Idadi uliyotaja haiendani na faili la usajili',
          subtitle: `Umesema ${declared}, lakini faili la Preform One linaonyesha ${actual}.`,
          html: `<div class="sd-stats">
              <div class="sd-stat warn"><b>${declared}</b><small>Ulichosema asubuhi hii</small></div>
              <div class="sd-stat good"><b>${actual}</b><small>Faili la usajili (Live)</small></div>
              <div class="sd-stat bad"><b>${diff > 0 ? '+' : ''}${diff}</b><small>${diff > 0 ? 'Hawapo kwenye faili' : 'Kwenye faili zaidi ya ulivyosema'}</small></div>
            </div>
            <div class="sd-alert warn">✍️ <span>Eleza kwa nini faili linaonyesha ${actual} wakati wewe umesema ${declared}: ${diff > 0 ? 'ni wanafunzi gani hawajaingizwa kwenye mfumo na lini wataingizwa' : 'ni nani walisajiliwa bila wewe kujua au kwa nini idadi yako iko chini'}.</span></div>`,
          input: { type: 'letter', minWords: WORDS.preformMismatch, label: `Maelezo ya tofauti (maneno ${WORDS.preformMismatch}+)`, placeholder: 'Faili linaonyesha idadi tofauti kwa sababu...' },
          actions: [{ label: 'Ghairi', value: null }, { label: 'Fungua Usajili wa Preform One', href: URLS.preformAdmission }, { label: 'Hifadhi Maelezo & Endelea', value: 'save', primary: true, needsInput: true }],
        });
        if (letter.action !== 'save') return { ok: false, message: 'Check-in imeghairiwa; maelezo ya tofauti ya Preform One yanahitajika.' };
        await preformRef.update({ explanation: letter.value, words: countWords(letter.value), explainedAt: Date.now() });
      }
    }

    // 4. Reminder of yesterday's missed attendance / expenses.
    if (plan.includes('yesterday')) {
      const prevDoc = (await readVal(ctx.schoolRef(dutyPath(ctx, prev, `days/${dayKeyOf(prev)}`))).catch(() => null)) || {};
      const reason = prevDoc.checkoutOverride?.explanation || '';
      const res = await openDialog({
        accent: '#fb7185', icon: '📌', eyebrow: 'Kumbukumbu ya jana', step: stepOf('yesterday'),
        title: `Jana (${prettyDate(prev)}) hukumaliza kazi hizi`,
        subtitle: 'Kabla ya kuingia leo, kumbuka kazi ambazo hazikufanyika jana. Leo usirudie.',
        html: `${missedHtml(yesterdayMissed)}
          ${reason ? `<div class="sd-alert warn">✍️ <span><b>Sababu uliyoandika jana:</b> ${esc(reason.length > 400 ? `${reason.slice(0, 400)}…` : reason)}</span></div>` : ''}
          <div class="sd-alert bad">👀 <span>Uongozi unaona kila siku kama mahudhurio na matumizi yamewekwa. Unaweza bado kuweka mahudhurio ya jana kwa kuchagua tarehe ya jana kwenye ukurasa wa mahudhurio.</span></div>
          <div class="sd-links">${desk.preformOne ? `<a class="sd-link" target="_blank" rel="noopener" href="${esc(URLS.preformAttendance)}">🌱 Mahudhurio Preform One</a>` : ''}</div>
          ${desk.linkedSchools.length ? linkedLinksHtml(desk, [{ page: 'attendance', icon: '🗓️', label: 'Mahudhurio' }, { page: 'expenses', icon: '💸', label: 'Matumizi' }]) : ''}`,
        actions: [{ label: 'Ghairi', value: null }, { label: 'Nimekumbuka, Endelea', value: 'ok', primary: true }],
      });
      if (res.action !== 'ok') return { ok: false, message: 'Check-in imeghairiwa. Soma kumbukumbu ya kazi za jana kwanza.' };
      await ctx.schoolRef(`${todayPath}/yesterdayReminder`).set({ ymd: prev, missed: yesterdayMissed, at: Date.now() });
    }

    // 5. Preform One class attendance: must know it is today's duty; mark now or later.
    if (plan.includes('preformAttendance')) {
      const step = stepOf('preformAttendance');
      const knows = await mustKnow({
        accent: '#38bdf8', icon: '🌱', eyebrow: 'Preform One · Mahudhurio ya leo', step,
        title: 'Je, unajua kwamba leo lazima uweke mahudhurio ya watoto wa Preform One?',
        subtitle: `${prettyDate(today)} — Jumatatu hadi Ijumaa, mahudhurio ya Preform One huwekwa na Katibu.`,
        html: `<div class="sd-stats">
            <div class="sd-stat"><b>${preformToday.total}</b><small>Wanafunzi wa Preform One</small></div>
            <div class="sd-stat ${preformToday.done ? 'good' : 'warn'}"><b>${preformToday.done ? `${preformToday.present}/${preformToday.marked}` : 'Bado'}</b><small>${preformToday.done ? 'Waliopo leo' : 'Mahudhurio ya leo'}</small></div>
          </div>`,
      });
      if (!knows) return { ok: false, message: 'Check-in imeghairiwa; lazima ukubali kazi ya mahudhurio ya Preform One ya leo.' };
      let choice = 'done';
      if (!preformToday.done) {
        const res = await openDialog({
          accent: '#38bdf8', icon: '⏰', eyebrow: 'Preform One · Mahudhurio ya leo', step,
          title: 'Utaweka mahudhurio sasa au baadaye?',
          subtitle: `Ukichagua baadaye, kumbuka kuweka kabla ya saa ${MARK_BEFORE} asubuhi.`,
          html: `<div class="sd-alert bad">🔒 <span>Hutaweza kufanya check-out jioni bila mahudhurio ya Preform One ya leo — au utaandika barua ya maneno ${WORDS.dailyDuty} kueleza kwa nini. Kesho asubuhi utakumbushwa tena.</span></div>`,
          actions: [
            { label: `⏰ Nitaweka kabla ya ${MARK_BEFORE}`, value: 'later' },
            { label: '✅ Weka Sasa (fungua ukurasa)', href: URLS.preformAttendance, value: 'now', primary: true },
          ],
        });
        choice = res.action || 'later';
      }
      await morningPlanRef.update({ preformAttendance: { knows: true, choice, at: Date.now() } });
    }

    // 6. Linked-school (MAU / MAP) student attendance and daily expenses.
    if (plan.includes('attendance')) {
      const step = stepOf('attendance');
      const shortNames = desk.linkedSchools.map((s) => s.short).join(' na ');
      const pendingAtt = attendance.schools.filter((s) => !s.done);
      const pendingExp = daily ? attendance.schools.filter((s) => !s.expenses.done) : [];
      const links = linkedLinksHtml(desk, [
        { page: 'attendance', icon: '🗓️', label: 'Mahudhurio' },
        ...(daily ? [{ page: 'expenses', icon: '💸', label: 'Matumizi' }] : []),
      ]);
      if (daily && !todayDoc.morningPlan?.linked) {
        const knows = await mustKnow({
          accent: '#a78bfa', icon: '🏫', eyebrow: `${shortNames} · Kazi za leo`, step,
          title: `Je, unajua kwamba leo lazima uweke mahudhurio ya ${shortNames} na kurekodi matumizi (expenses) ya siku?`,
          subtitle: `${prettyDate(today)} — Jumatatu hadi Ijumaa hizi ni kazi zako za kila siku.`,
          html: attendanceHtml(attendance, { withExpenses: true }),
        });
        if (!knows) return { ok: false, message: `Check-in imeghairiwa; lazima ukubali kazi za ${shortNames} za leo.` };
      }
      const res = await openDialog({
        accent: '#a78bfa', icon: '🗓️', eyebrow: `Mahudhurio & matumizi · ${shortNames}`, step,
        title: pendingAtt.length || pendingExp.length ? `Utafanya kazi za ${shortNames} sasa au baadaye?` : `Kazi za ${shortNames} za leo zimekamilika`,
        subtitle: `${prettyDate(today)} — viungo vyako viko tayari hapa chini.`,
        html: `${attendanceHtml(attendance, { withExpenses: daily })}
          ${links}
          <div class="sd-alert ${pendingAtt.length || pendingExp.length ? 'warn' : 'good'}" style="margin-top:12px">${pendingAtt.length || pendingExp.length ? '🔒' : '🎉'} <span>${pendingAtt.length || pendingExp.length
            ? `Huwezi kufanya check-out jioni kabla ya kuweka mahudhurio ya ${shortNames}${daily ? ' na kurekodi matumizi ya siku' : ''}${desk.graduation ? ', na kupiga simu za wazazi wa mahafali za leo' : ''} — au utaandika barua ya kueleza kwa nini.`
            : 'Vizuri sana! Endelea na kazi nyingine za ofisi.'}</span></div>`,
        actions: pendingAtt.length || pendingExp.length
          ? [{ label: `⏰ Nitafanya baadaye (kabla ya ${MARK_BEFORE})`, value: 'later' }, { label: 'Nafanya sasa — tumia viungo hapo juu', value: 'now', primary: true }]
          : [{ label: 'Nimeelewa, Endelea', value: 'done', primary: true }],
      });
      if (daily) await morningPlanRef.update({ linked: { knows: true, choice: res.action || 'later', at: Date.now() } });
    }

    // 7. Preform One debtors: download the PDF and accept the NO CASH rule.
    if (plan.includes('preformDebts')) {
      const done = await preformDebtsDialog(ctx, { ymd: today, step: stepOf('preformDebts'), mandatory: true, schoolName: ctx.schoolName });
      if (!done) return { ok: false, message: 'Check-in imeghairiwa; pakua PDF ya madeni ya Preform One na ukubali sheria ya NO CASH.' };
    }

    if (total) {
      ctx.schoolRef(`${todayPath}/morningBriefing`).set({
        at: Date.now(), steps: plan,
        attendance: attendance ? attendance.schools.map((s) => ({ id: s.id, done: s.done })) : null,
      }).catch((err) => console.warn('Secretary briefing log failed', err));
    }
    return { ok: true };
  }

  // ---------- check-out ----------
  async function runCheckOut(ctx) {
    const desk = deskFor(ctx.schoolId);
    const today = ctx.todayYmd;
    if (!hasDuties(desk) || today < DUTY_START_YMD || !isMonToFri(today)) return { ok: true };
    const daily = today >= DAILY_DUTY_START_YMD;
    const todayPath = dutyPath(ctx, today, `days/${dayKeyOf(today)}`);
    const todayDoc = (await readVal(ctx.schoolRef(todayPath)).catch(() => null)) || {};

    // a. Fees paid today (Preform One / MAU / MAP) — the link is always ready.
    if (daily && (desk.preformOne || desk.linkedSchools.length) && !todayDoc.feesCheck) {
      const queued = await paymentsToday(ctx, desk, today).catch(() => []);
      const res = await openDialog({
        accent: '#34d399', icon: '💳', eyebrow: 'Check-out · Ada za leo',
        title: 'Kuna aliyelipa ada leo ambaye hujamwingiza kwenye mfumo?',
        subtitle: `Preform One${desk.linkedSchools.map((s) => `, ${s.short}`).join('')} — kila malipo ya leo lazima yaingizwe kabla ya kuondoka.`,
        html: `${NO_CASH_HTML}
          <div class="sd-stats">${queued.map((q) => `<div class="sd-stat ${q.count ? 'good' : ''}"><b>${q.count == null ? '—' : q.count}</b><small>${esc(q.short)}: malipo yaliyoingizwa leo${q.amount ? ` · ${tsh(q.amount)}` : ''}</small></div>`).join('')}</div>
          <div class="sd-links">${queued.map((q) => `<a class="sd-link" target="_blank" rel="noopener" href="${esc(q.href)}">💳 Ingiza malipo · ${esc(q.short)}</a>`).join('')}</div>
          <p style="font-size:.82rem;color:#9aa4c7;margin-top:10px">Malipo yote yanasubiri idhini (approval) kabla ya kuhesabiwa.</p>`,
        actions: [
          { label: 'Ndiyo, bado — nitaingiza kwanza', value: 'pending', danger: true },
          { label: 'Ndiyo, nimeshaingiza yote', value: 'entered' },
          { label: 'Hapana, hakuna aliyelipa', value: 'none', primary: true },
        ],
      });
      if (!res.action || res.action === 'pending') {
        return { ok: false, message: 'Check-out imesitishwa. Ingiza malipo ya leo (Preform One / MAU / MAP) kwanza, kisha ujaribu tena.' };
      }
      await ctx.schoolRef(`${todayPath}/feesCheck`).set({
        answer: res.action, at: Date.now(),
        queued: queued.map((q) => ({ id: q.id, short: q.short, count: q.count, amount: q.amount })),
      });
    }

    // b. Daily duties.
    const pending = [];
    let calls = null;
    let attendance = null;
    let preform = null;
    if (desk.graduation) {
      try {
        calls = await callsStatus(ctx, today);
        if (!calls.complete) pending.push(`Simu za wazazi wa mahafali: ${calls.made}/${calls.required} zimepigwa leo`);
      } catch (err) { console.warn('Secretary checkout calls check skipped', err); }
    }
    if (daily && desk.preformOne) {
      try {
        preform = await preformStatus(ctx, today);
        if (preform.required && !preform.done) pending.push(`Mahudhurio ya Preform One hayajawekwa leo (${preform.total} wanafunzi)`);
      } catch (err) { console.warn('Secretary checkout Preform One check skipped', err); }
    }
    if (desk.linkedSchools.length) {
      try {
        attendance = await attendanceStatus(ctx, desk, today);
        attendance.schools.forEach((s) => {
          if (!s.done) pending.push(`Mahudhurio ya ${s.short} hayajawekwa: ${s.classes.filter((r) => r.status === 'missing').map((r) => r.cls).join(', ')}`);
          if (daily && !s.expenses.done) pending.push(`Matumizi (expenses) ya ${s.short} ya leo hayajarekodiwa`);
        });
      } catch (err) { console.warn('Secretary checkout attendance check skipped', err); }
    }
    const review = {
      at: Date.now(),
      pending,
      calls: calls ? { made: calls.made, required: calls.required, complete: calls.complete } : null,
      preformOne: preform ? { required: preform.required, marked: preform.marked, present: preform.present, absent: preform.absent, total: preform.total } : null,
      linked: attendance ? attendance.schools.map((s) => ({
        id: s.id, short: s.short, attendanceDone: s.done, present: s.present, absent: s.absent,
        expensesCount: s.expenses.count, expensesAmount: s.expenses.amount, expensesDone: s.expenses.done,
      })) : null,
    };
    ctx.schoolRef(`${todayPath}/checkoutReview`).set(review).catch((err) => console.warn('Secretary checkout review log failed', err));
    if (!pending.length) {
      ctx.toast?.('🌟 Kazi zote za Katibu za leo zimekamilika. Asante!', 'success', 4500);
      return { ok: true };
    }
    if (todayDoc.checkoutOverride) return { ok: true };

    const callsMissing = Boolean(calls && !calls.complete);
    const minWords = callsMissing ? WORDS.checkout : WORDS.dailyDuty;
    const res = await openDialog({
      accent: '#fb7185', icon: '🚪', eyebrow: 'Check-out ya Katibu',
      title: 'Huwezi kuondoka kabla ya kumaliza kazi za leo',
      subtitle: 'Kazi hizi ni za kila siku, Jumatatu hadi Ijumaa.',
      html: `<div class="sd-stats">
          ${calls ? `<div class="sd-stat ${calls.complete ? 'good' : 'bad'}"><b>${calls.made}/${calls.required}</b><small>Simu za mahafali leo</small></div>` : ''}
          ${preform?.required ? `<div class="sd-stat ${preform.done ? 'good' : 'bad'}"><b>${preform.done ? `${preform.present}/${preform.marked}` : 'Bado'}</b><small>Mahudhurio Preform One</small></div>` : ''}
          ${attendance ? `<div class="sd-stat ${attendance.allDone ? 'good' : 'bad'}"><b>${attendance.schools.filter((s) => s.done).length}/${attendance.schools.length}</b><small>Shule zenye mahudhurio</small></div>` : ''}
          ${attendance && daily ? `<div class="sd-stat ${attendance.expensesDone ? 'good' : 'bad'}"><b>${attendance.schools.filter((s) => s.expenses.done).length}/${attendance.schools.length}</b><small>Shule zenye matumizi ya leo</small></div>` : ''}
        </div>
        <ul class="sd-list">${pending.map((p) => `<li>⏳ <span>${esc(p)}</span></li>`).join('')}</ul>
        ${attendance ? attendanceHtml(attendance, { withExpenses: daily }) : ''}
        <div class="sd-links">
          ${preform?.required && !preform.done ? `<a class="sd-link" target="_blank" rel="noopener" href="${esc(URLS.preformAttendance)}">🌱 Mahudhurio Preform One</a>` : ''}
          ${callsMissing ? `<a class="sd-link" target="_blank" rel="noopener" href="${esc(URLS.calls)}">📞 Simu za Wazazi</a>` : ''}
        </div>
        ${attendance ? linkedLinksHtml(desk, [{ page: 'attendance', icon: '🗓️', label: 'Mahudhurio' }, ...(daily ? [{ page: 'expenses', icon: '💸', label: 'Matumizi' }] : [])]) : ''}
        <div class="sd-alert bad" style="margin-top:12px">⚠️ <span>Njia bora ni kumaliza kazi kwanza. Ukiamua kuondoka, lazima uandike maelezo ya kina (maneno ${minWords}) — na kesho asubuhi utakumbushwa tena kuhusu kazi hizi${callsMissing ? `, pamoja na barua ya simu za mahafali (maneno ${WORDS.missedCalls})` : ''}.</span></div>`,
      input: { type: 'letter', minWords, label: `Eleza kwa kina kwa nini unaondoka bila kumaliza (maneno ${minWords}+)`, placeholder: 'Leo sikuweza kumaliza kazi zangu kwa sababu...' },
      actions: [
        { label: 'Ghairi, nitamaliza kwanza', value: null },
        { label: 'Fungua Secretary Hub', href: URLS.hub },
        { label: 'Hifadhi Maelezo & Ondoka', value: 'save', primary: true, needsInput: true },
      ],
    });
    if (res.action !== 'save') return { ok: false, message: 'Check-out imesitishwa. Maliza kazi za Katibu kwanza, kisha ujaribu tena.' };
    await ctx.schoolRef(`${todayPath}/checkoutOverride`).set({
      pending, explanation: res.value, words: countWords(res.value), minWords, at: Date.now(),
      calls: review.calls ? { made: calls.made, required: calls.required } : null,
      preformOne: review.preformOne,
      attendance: attendance ? attendance.schools.map((s) => ({ id: s.id, short: s.short, done: s.done, expensesDone: s.expenses.done })) : null,
    });
    return { ok: true };
  }

  global.SecretaryDuties = {
    DUTY_START_YMD, DAILY_DUTY_START_YMD, STRIKE_EVERY, STRIKE_AMOUNT, WORDS, URLS, PREFORM_BASE,
    isSecretaryRole, deskFor, hasDuties, runCheckIn, runCheckOut,
    callsStatus, attendanceStatus, inPreformWindow,
    // Shared readers for the Secretary Hub and work report.
    todayYmd, shiftYmd, isMonToFri, prettyDate, dutyPath, dayKeyOf, monthKeyOf, attCode, toYmd, tsh,
    readPreformStudents, preformDay, preformStatus, preformDebtors, preformEnrolledOn,
    linkedClasses, classVariants, countClassDay, classIsSchoolDay, readLinkedExpenses, expensesOn,
    workerDayRecord, dayStatus, missedDailyDuties, linkedUrl,
    preformDebtsDialog, downloadPreformDebtsPdf, openDialog,
    pdf: { ensurePdf, logoDataUrl, pdfHeader, pdfFooter, pdfStatBoxes },
  };
})(window);
