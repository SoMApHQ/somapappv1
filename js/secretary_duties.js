// SoMAp Secretary Desk — daily duty gates for workersattendance.html.
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
//     4. Linked-school (MAU / MAP) student attendance reminder for today.
//   Check-out
//     Today's 20 graduation calls and MAU / MAP student attendance must be done,
//     or the secretary writes a 300-word explanation before leaving.
//
// Duty records live under the home school: years/{Y}/secretaryDuty/{workerId}/{YYYYMM}/
//   missedCalls/{dayKey}                 300-word letter for a missed calls day
//   days/{dayKey}/preformOne             morning Preform One answer
//   days/{dayKey}/checkoutOverride       explanation for leaving with unfinished duties
//   days/{dayKey}/followUp               next-morning follow-up for that override
//   days/{dayKey}/morningBriefing        what the secretary was shown at check-in
(function (global) {
  'use strict';

  // Duties are only enforced for working days on/after this date (the call log
  // and Secretary Hub went live 2026-10-08; nobody is punished retroactively).
  const DUTY_START_YMD = '2026-10-09';
  const STRIKE_EVERY = 3;
  const STRIKE_AMOUNT = 1000;
  const WORDS = { missedCalls: 300, preformMismatch: 200, checkout: 300, followUp: 150 };
  const PREFORM_WINDOW = { from: '09-15', to: '12-25' };
  const PREFORM_BASE = 'schools/Socrates School Preform one';
  const HUB_URL = 'secretary/secretaryhub.html';
  const CALLS_URL = 'secretary/graduation_followup.html';
  const PREFORM_URL = '../preformonehtml/prefoneadmission.html';
  const SECRETARY_ROLES = ['secretary', 'katibu'];

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
      const status = await ctx.resolveWorkerCalendar(ymd);
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

  async function preformCount(ctx, year) {
    const students = (await readVal(ctx.db.ref(`${PREFORM_BASE}/${year}/students`))) || {};
    return Object.values(students).filter(Boolean).length;
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

  async function classAttendanceCount(ctx, schoolId, cls, ymd) {
    const variants = Array.from(new Set([cls, cls.toUpperCase(), cls.replace(/\b\w/g, (c) => c.toUpperCase())]));
    for (const name of variants) {
      const records = await readVal(ctx.db.ref(`schools/${schoolId}/attendance/${name}/${ymd.slice(0, 7)}/${ymd}`));
      const count = records && typeof records === 'object' ? Object.keys(records).length : 0;
      if (count) return count;
    }
    return 0;
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

  async function attendanceStatus(ctx, desk, ymd) {
    const schools = await Promise.all(desk.linkedSchools.map(async (school) => {
      const classes = await linkedClasses(ctx, school.id, yearOf(ymd));
      const rows = await Promise.all(classes.map(async (cls) => {
        if (!(await classIsSchoolDay(school.id, cls, ymd))) return { cls, status: 'off', count: 0 };
        const count = await classAttendanceCount(ctx, school.id, cls, ymd);
        return { cls, status: count ? 'marked' : 'missing', count };
      }));
      return { ...school, classes: rows, done: rows.every((r) => r.status !== 'missing') };
    }));
    return { ymd, schools, allDone: schools.every((s) => s.done) };
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
      .sd-school{border-radius:16px;border:1px solid rgba(255,255,255,.09);background:rgba(7,11,29,.45);padding:12px 14px;margin-bottom:10px}
      .sd-school h4{margin:0 0 8px;display:flex;justify-content:space-between;gap:8px;font:600 .95rem 'Poppins','Inter',sans-serif;color:#fff}
      .sd-pills{display:flex;flex-wrap:wrap;gap:6px}
      .sd-pill{padding:5px 10px;border-radius:99px;font-size:.76rem;font-weight:600;border:1px solid}
      .sd-pill.marked{color:#86efac;border-color:rgba(52,211,153,.4);background:rgba(52,211,153,.1)}
      .sd-pill.missing{color:#fda4af;border-color:rgba(251,113,133,.45);background:rgba(251,113,133,.1)}
      .sd-pill.off{color:#9aa4c7;border-color:rgba(148,163,184,.3);background:rgba(148,163,184,.08)}
      .sd-list{margin:0 0 14px;padding:0;list-style:none;display:grid;gap:8px}
      .sd-list li{display:flex;gap:10px;align-items:flex-start;padding:10px 12px;border-radius:12px;background:rgba(7,11,29,.5);border:1px solid rgba(255,255,255,.07)}
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
      .sd-btn[disabled]{opacity:.45;cursor:not-allowed;transform:none}
      @media (max-width:560px){.sd-head,.sd-body{padding-left:18px;padding-right:18px}.sd-actions{padding:14px 18px 18px}.sd-actions .sd-btn{flex:1 1 100%}}
    `;
    document.head.appendChild(style);
  }

  // Opens a styled duty dialog. `input` is { type:'letter', minWords, label, placeholder }
  // or { type:'number', label }. Resolves with { action, value } (action null on Cancel).
  function openDialog({ accent = '#f472b6', icon, eyebrow, title, subtitle, html = '', step, input, actions }) {
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
      const valid = () => {
        if (!input) return true;
        if (input.type === 'number') return field$.value !== '' && Number(field$.value) >= 0 && Number.isInteger(Number(field$.value));
        return countWords(field$.value) >= input.minWords;
      };
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
        const btn = document.createElement(a.href ? 'a' : 'button');
        btn.className = `sd-btn${a.primary ? ' primary' : ''}`;
        btn.textContent = a.label;
        if (a.href) {
          btn.href = a.href;
          btn.target = '_blank';
          btn.rel = 'noopener';
        } else {
          btn.type = 'button';
          btn.addEventListener('click', () => { if (!a.needsInput || valid()) finish(a.value ?? null); });
          if (a.needsInput) gated.push(btn);
        }
        host.appendChild(btn);
      });
      field$?.addEventListener('input', refresh);
      refresh();
      setTimeout(() => field$?.focus(), 60);
    });
  }

  function attendanceHtml(status) {
    return status.schools.map((s) => {
      const pills = s.classes.length
        ? s.classes.map((r) => `<span class="sd-pill ${r.status}">${r.status === 'marked' ? '✓' : r.status === 'off' ? '—' : '✗'} ${esc(r.cls)}${r.status === 'marked' ? ` · ${r.count}` : r.status === 'off' ? ' · si siku ya shule' : ''}</span>`).join('')
        : '<span class="sd-pill off">Hakuna darasa lenye wanafunzi</span>';
      return `<div class="sd-school"><h4><span>🏫 ${esc(s.name)} (${esc(s.short)})</span><span>${s.done ? '✅' : '⏳'}</span></h4><div class="sd-pills">${pills}</div></div>`;
    }).join('');
  }

  // ---------- check-in ----------
  async function runCheckIn(ctx) {
    const desk = deskFor(ctx.schoolId);
    if (!hasDuties(desk) || ctx.todayYmd < DUTY_START_YMD || !isMonToFri(ctx.todayYmd)) return { ok: true };
    const today = ctx.todayYmd;
    const prev = await previousDutyDay(ctx, today);
    const prevRecord = prev ? await ctx.getDayRecord(prev).catch(() => null) : null;
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
    const todayKey = dayKeyOf(today);
    const todayPath = dutyPath(ctx, today, `days/${todayKey}`);
    let preformAnswer = null;
    if (desk.preformOne && inPreformWindow(today)) {
      preformAnswer = await readVal(ctx.schoolRef(`${todayPath}/preformOne`));
      // Unanswered today, or answered wrongly without the explanation yet.
      if (!preformAnswer || (preformAnswer.match === false && !preformAnswer.explanation)) plan.push('preform');
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
    const total = plan.length;
    const stepOf = (name) => ({ index: plan.indexOf(name) + 1, total });

    // 1. Follow-up: left yesterday with unfinished duties.
    if (plan.includes('followUp')) {
      const pending = Array.isArray(override.pending) ? override.pending : [];
      const res = await openDialog({
        accent: '#fb7185', icon: '🌙', eyebrow: 'Kazi za jana bado zinakufuata', step: stepOf('followUp'),
        title: `Jana (${prettyDate(prev)}) uliondoka bila kumaliza kazi zako`,
        subtitle: 'Uliandika maelezo wakati wa kuondoka. Leo asubuhi lazima ueleze tena hatua utakazochukua.',
        html: `<ul class="sd-list">${pending.map((p) => `<li>⏳ <span>${esc(p)}</span></li>`).join('')}</ul>
          <div class="sd-alert warn">✍️ <span>Eleza kwa nini kazi hizi hazikumalizika, nani alijulishwa, na utazimaliza lini leo. Maelezo haya yanaonekana kwa uongozi.</span></div>`,
        input: { type: 'letter', minWords: WORDS.followUp, label: `Maelezo ya ufuatiliaji (maneno ${WORDS.followUp}+)`, placeholder: 'Jana sikumaliza kwa sababu... Leo nitafanya...' },
        actions: [{ label: 'Ghairi', value: null }, { label: 'Hifadhi & Endelea', value: 'save', primary: true, needsInput: true }],
      });
      if (res.action !== 'save') return { ok: false, message: 'Check-in imeghairiwa; maelezo ya kazi za jana yanahitajika kwanza.' };
      await ctx.schoolRef(dutyPath(ctx, prev, `days/${dayKeyOf(prev)}/followUp`)).set({
        explanation: res.value, words: countWords(res.value), writtenOn: today, at: Date.now(),
      });
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
        actions: [{ label: 'Ghairi', value: null }, { label: 'Fungua Simu za Wazazi', href: CALLS_URL }, { label: 'Hifadhi Barua & Endelea', value: 'save', primary: true, needsInput: true }],
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
          ctx.toast('Makato ya posho hayakuhifadhiwa — uongozi utaarifiwa.', 'warning', 6000);
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
        if (record.match) ctx.toast(`✅ Sahihi! Preform One ${actual} wamesajiliwa — inaendana na faili.`, 'success', 4500);
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
          actions: [{ label: 'Ghairi', value: null }, { label: 'Fungua Usajili wa Preform One', href: PREFORM_URL }, { label: 'Hifadhi Maelezo & Endelea', value: 'save', primary: true, needsInput: true }],
        });
        if (letter.action !== 'save') return { ok: false, message: 'Check-in imeghairiwa; maelezo ya tofauti ya Preform One yanahitajika.' };
        await preformRef.update({ explanation: letter.value, words: countWords(letter.value), explainedAt: Date.now() });
      }
    }

    // 4. Linked-school student attendance reminder.
    if (plan.includes('attendance')) {
      const pending = attendance.schools.filter((s) => !s.done);
      const shortNames = desk.linkedSchools.map((s) => s.short).join(' na ');
      await openDialog({
        accent: '#a78bfa', icon: '🗓️', eyebrow: `Mahudhurio ya wanafunzi · ${shortNames}`, step: stepOf('attendance'),
        title: pending.length ? `Kumbuka kuweka mahudhurio ya ${shortNames} leo` : `Mahudhurio ya ${shortNames} yamekamilika leo`,
        subtitle: `${prettyDate(today)} — Jumatatu hadi Ijumaa hii ni kazi yako ya kila siku.`,
        html: `${attendanceHtml(attendance)}
          <div class="sd-alert ${pending.length ? 'warn' : 'good'}">${pending.length ? '🔒' : '🎉'} <span>${pending.length
            ? `Huwezi kufanya check-out jioni kabla ya kuweka mahudhurio ya ${shortNames}${desk.graduation ? ' na kupiga simu za wazazi wa mahafali za leo' : ''}. Fungua Secretary Hub → dashibodi ya shule → Attendance.`
            : 'Vizuri sana! Endelea na kazi nyingine za ofisi.'}</span></div>`,
        actions: [{ label: 'Fungua Secretary Hub', href: HUB_URL }, { label: 'Nimeelewa, Endelea', value: 'ok', primary: true }],
      });
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
    const todayPath = dutyPath(ctx, today, `days/${dayKeyOf(today)}`);
    const pending = [];
    let calls = null;
    let attendance = null;
    if (desk.graduation) {
      try {
        calls = await callsStatus(ctx, today);
        if (!calls.complete) pending.push(`Simu za wazazi wa mahafali: ${calls.made}/${calls.required} zimepigwa leo`);
      } catch (err) { console.warn('Secretary checkout calls check skipped', err); }
    }
    if (desk.linkedSchools.length) {
      try {
        attendance = await attendanceStatus(ctx, desk, today);
        attendance.schools.filter((s) => !s.done).forEach((s) => {
          const missing = s.classes.filter((r) => r.status === 'missing').map((r) => r.cls);
          pending.push(`Mahudhurio ya ${s.short} hayajawekwa: ${missing.join(', ')}`);
        });
      } catch (err) { console.warn('Secretary checkout attendance check skipped', err); }
    }
    if (!pending.length) {
      ctx.toast('🌟 Kazi zote za Katibu za leo zimekamilika. Asante!', 'success', 4500);
      return { ok: true };
    }
    const existing = await readVal(ctx.schoolRef(`${todayPath}/checkoutOverride`));
    if (existing) return { ok: true };

    const res = await openDialog({
      accent: '#fb7185', icon: '🚪', eyebrow: 'Check-out ya Katibu',
      title: 'Huwezi kuondoka kabla ya kumaliza kazi za leo',
      subtitle: 'Kazi hizi ni za kila siku, Jumatatu hadi Ijumaa.',
      html: `${calls ? `<div class="sd-stats">
            <div class="sd-stat ${calls.complete ? 'good' : 'bad'}"><b>${calls.made}/${calls.required}</b><small>Simu za mahafali leo</small></div>
            ${attendance ? `<div class="sd-stat ${attendance.allDone ? 'good' : 'bad'}"><b>${attendance.schools.filter((s) => s.done).length}/${attendance.schools.length}</b><small>Shule zenye mahudhurio</small></div>` : ''}
          </div>` : ''}
        <ul class="sd-list">${pending.map((p) => `<li>⏳ <span>${esc(p)}</span></li>`).join('')}</ul>
        ${attendance ? attendanceHtml(attendance) : ''}
        <div class="sd-alert bad">⚠️ <span>Njia bora ni kumaliza kazi kwanza. Ukiamua kuondoka, lazima uandike maelezo ya kina — na kesho asubuhi utaulizwa tena kuhusu kazi hizi${desk.graduation && calls && !calls.complete ? `, pamoja na barua ya simu za mahafali (maneno ${WORDS.missedCalls})` : ''}.</span></div>`,
      input: { type: 'letter', minWords: WORDS.checkout, label: `Eleza kwa kina kwa nini unaondoka bila kumaliza (maneno ${WORDS.checkout}+)`, placeholder: 'Leo sikuweza kumaliza kazi zangu kwa sababu...' },
      actions: [
        { label: 'Ghairi, nitamaliza kwanza', value: null },
        { label: 'Fungua Secretary Hub', href: HUB_URL },
        { label: 'Hifadhi Maelezo & Ondoka', value: 'save', primary: true, needsInput: true },
      ],
    });
    if (res.action !== 'save') return { ok: false, message: 'Check-out imesitishwa. Maliza kazi za Katibu kwanza, kisha ujaribu tena.' };
    await ctx.schoolRef(`${todayPath}/checkoutOverride`).set({
      pending, explanation: res.value, words: countWords(res.value), at: Date.now(),
      calls: calls ? { made: calls.made, required: calls.required } : null,
      attendance: attendance ? attendance.schools.map((s) => ({ id: s.id, short: s.short, done: s.done })) : null,
    });
    return { ok: true };
  }

  global.SecretaryDuties = {
    DUTY_START_YMD, STRIKE_EVERY, STRIKE_AMOUNT, WORDS,
    isSecretaryRole, deskFor, hasDuties, runCheckIn, runCheckOut,
    callsStatus, attendanceStatus, inPreformWindow,
  };
})(window);
