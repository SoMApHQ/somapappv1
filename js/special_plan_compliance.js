/* Approval-only special agreement review. Never writes a payment or a class default. */
(function (global) {
  'use strict';
  const KIND = 'special-plan-compliance';
  const math = () => global.SomapFinanceComplianceMath || global.SomapFinance;
  const clone = value => JSON.parse(JSON.stringify(value));
  const stable = value => JSON.stringify(value, function (_, v) {
    return v && typeof v === 'object' && !Array.isArray(v)
      ? Object.keys(v).sort().reduce((o, k) => { o[k] = v[k]; return o; }, {}) : v;
  });
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const money = value => `TSh ${Number(value || 0).toLocaleString('en-US')}`;
  function yearValue(year) {
    if (!/^20\d{2}$/.test(String(year)) || Number(year) < 2026) throw new Error('Special plan review is available only for 2026 onward.');
    return String(year);
  }
  function context(year) {
    const y = yearValue(year);
    const schoolId = global.SOMAP?.getSchool?.()?.id;
    if (!schoolId || !global.SOMAP?.P) throw new Error('Select a school before reviewing special plans.');
    const root = global.SOMAP.P('');
    const prefix = root ? root.replace(/\/$/, '') + '/' : '';
    const database = global.db || global.firebase.database();
    return { year: y, schoolId, database, path: p => prefix + p,
      check() { if (global.SOMAP.getSchool()?.id !== schoolId) throw new Error('School changed. Refresh before continuing.'); } };
  }
  // Date-only agreements use the same browser-local calendar as Finance, through end of day.
  function deadline(value, year) {
    const text = String(value || '');
    let m = text.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!m) return NaN; // Do not guess ambiguous or incomplete agreement dates.
    const [y, month, day] = m.slice(1).map(Number);
    if (y !== Number(year)) return NaN;
    const date = new Date(y, month - 1, day, 23, 59, 59, 999);
    return date.getFullYear() === y && date.getMonth() === month - 1 && date.getDate() === day ? date.getTime() : NaN;
  }
  function paymentTime(p) {
    const value = p.timestamp ?? p.datePaid ?? p.paymentDate ?? p.date;
    if (value == null || value === '') return NaN;
    if (typeof value === 'number' || /^\d{10,13}$/.test(String(value))) {
      const n = Number(value); return n < 1e12 ? n * 1000 : n;
    }
    const m = String(value).match(/^(\d{4})-(\d{2})-(\d{2})$/);
    return m ? new Date(+m[1], +m[2] - 1, +m[3]).getTime() : Date.parse(value);
  }
  function validPayment(p) {
    if (!p || typeof p !== 'object') return false;
    if (p.deleted || p.isDeleted || p.deletedAt || p.reversed || p.isReversed || p.reversedAt || p.voided || p.voidedAt || p.cancelled || p.cancelledAt || p.approved === false || p.isApproved === false) return false;
    const module = String(p.sourceModule || p.module || '').toLowerCase();
    if (module && !['finance', 'schoolfees', 'school-fees', 'school fees'].includes(module)) return false;
    const status = String(p.finalStatus || p.approvalStatus || p.status || '').toLowerCase();
    if (status && !['approved', 'completed', 'paid'].includes(status)) return false;
    return status === 'approved' || Number(p.approvedAt) > 0 || p.approved === true;
  }
  // Input comes from the existing Finance student builder; raw agreement rows remain explicit.
  function evaluate(input, now = Date.now()) {
    yearValue(input.year);
    const { student, rows, defaultPlanId, planId } = input;
    if (!student || student.isGraduated || !planId || planId === defaultPlanId || !Array.isArray(rows) || !rows.length || !student._customSchedule?.length) return { status: 'skipped', reason: 'No distinct student agreement with an active explicit custom schedule.' };
    if (input.uncertainPayments) return { status: 'skipped', reason: 'Payment dates or approval evidence need verification.' };
    const ordered = rows.map(r => ({ ...r, deadlineTs: deadline(r.to, input.year) })).sort((a, b) => a.deadlineTs - b.deadlineTs);
    if (ordered.some(r => !Number.isFinite(r.deadlineTs) || !Number.isSafeInteger(Number(r.amount)) || Number(r.amount) <= 0)) return { status: 'skipped', reason: 'Agreement needs explicit integer amounts and valid academic-year deadlines.' };
    const agreedTotal = ordered.reduce((s, r) => s + Number(r.amount), 0);
    if (![Number(student.baseFee), Number(student.feePerYear)].includes(agreedTotal)) return { status: 'skipped', reason: 'Agreement total does not match the effective annual fee.' };
    // Carry remains in the Finance record. Use its existing custom-schedule allocation,
    // which consumes the approved payment pot directly; do not subtract carry a second time.
    if (Number(input.carry?.credit || 0) !== 0 || Number(input.carry?.amount ?? input.carry?.balance ?? 0) < 0) return { status: 'skipped', reason: 'Unresolved credit agreement requires Finance allocation review.' };
    let required = 0;
    const breaches = [];
    for (const row of ordered) {
      required += Number(row.amount);
      if (now <= row.deadlineTs) continue;
      const payments = Object.fromEntries(Object.entries(student.payments || {}).filter(([, p]) => validPayment(p) && paymentTime(p) <= row.deadlineTs));
      const paid = math().computeStudentFinancials({ ...student, payments }, input.year).paidAmount;
      if (paid < required) breaches.push({ label: String(row.label || `Installment ending ${row.to}`), deadline: row.to, deadlineTs: row.deadlineTs, required, paid, shortfall: required - paid });
    }
    return { status: breaches.length ? 'breached' : 'compliant', breaches };
  }
  async function digest(value) {
    const bytes = await global.crypto.subtle.digest('SHA-256', new TextEncoder().encode(stable(value)));
    return Array.from(new Uint8Array(bytes), b => b.toString(16).padStart(2, '0')).join('');
  }
  const get = async (ctx, path) => (await ctx.database.ref(ctx.path(path)).once('value')).val();
  function unwrap(bucket, year) {
    const value = bucket?.[year] || bucket || {};
    return value.payments || value.entries || value.records || value;
  }
  async function load(ctx) {
    const y = ctx.year;
    const paths = [`studentOverrides/${y}`, `finance/${y}/studentFees`, `finance/${y}/studentPlans`, `finance/${y}/studentCustomSchedules`, `studentFees/${y}`, `feesStructure/${y}`, `finance/${y}/classes`, `installmentPlans/${y}`, `finance/${y}/plans`, `enrollments/${y}`, `years/${y}/enrollments`, `financeCarryForward/${y}`, `financeDeadlineExtensions/${y}`];
    const values = await Promise.all(paths.map(p => get(ctx, p)));
    const [overrides, fees, plans, schedules, directFees, classes, newClasses, templates, newTemplates, enrollments, yearEnrollments, carry, extensions] = values.map(v => v || {});
    const ids = [...new Set([...Object.keys(overrides), ...Object.keys(plans), ...Object.keys(schedules)])];
    const result = {};
    let history;
    // Only candidate students, only the selected year's ledgers. No historical-year loader.
    for (const id of ids) {
      const [base, ledger] = await Promise.all([get(ctx, `students/${id}`), get(ctx, `financeLedgers/${y}/${id}`)]);
      if (!base) continue;
      const admissionKey = base.admissionNumber || base.admissionNo || id;
      const before = { legacy: overrides[id] || null, fee: fees[id] || null, plan: plans[id] || null, schedule: schedules[id] || null, directFee: directFees[id] || null,
        directFeeAdmission: admissionKey !== id ? directFees[admissionKey] || null : null };
      const ov = { ...(overrides[id] || {}) };
      const planId = plans[id]?.planId || plans[id]?.id || ov.planId || ov.defaultPlanId || ov.paymentPlanId || '';
      ov.planId = planId;
      const custom = schedules[id] ? schedules[id].rows : ov.customSchedule;
      const rows = Array.isArray(custom) ? custom : [];
      ov.customSchedule = rows;
      const selectedPayments = Object.keys(unwrap(ledger, y)).length ? unwrap(ledger, y) : (base.payments || {});
      const payments = {};
      let uncertainPayments = false;
      Object.entries(selectedPayments).forEach(([key, p]) => {
        const explicitYear = p?.academicYear ?? p?.financeYear ?? p?.feeYear ?? p?.year;
        const ts = paymentTime(p || {});
        const paymentYear = explicitYear == null ? new Date(ts).getFullYear() : Number(explicitYear);
        if (Number.isFinite(paymentYear) && paymentYear !== Number(y)) return;
        if (!validPayment(p)) {
          // Explicitly non-approved entries cannot count. Unmarked legacy rows need verification.
          if (p && !p.status && !p.finalStatus && !p.deleted && !p.isDeleted && !p.deletedAt && !p.reversed && !p.reversedAt && p.approved !== false) uncertainPayments = true;
          return;
        }
        const amount = Number(p.amount ?? p.value ?? p.paid ?? p.payment ?? p.total);
        if (!Number.isFinite(ts) || !Number.isSafeInteger(amount) || amount <= 0) { uncertainPayments = true; return; }
        payments[key] = { ...p, timestamp: ts, amount, academicYear: Number(y) };
      });
      if (!Object.keys(payments).length && !uncertainPayments && !Object.keys(unwrap(ledger, y)).length) {
        // Same fallback source as Finance, restricted to this year. Receipt date, never
        // approval date, determines timeliness. Missing receipt evidence is not guessed.
        history ??= await get(ctx, `approvalsHistory/${y}`) || {};
        for (const records of Object.values(history)) for (const [key, record] of Object.entries(records || {})) {
          const studentKey = record.studentId || record.modulePayload?.studentKey || record.studentAdm;
          if (![id, admissionKey].includes(studentKey) || record.sourceModule !== 'finance' || String(record.finalStatus || record.status).toLowerCase() !== 'approved') continue;
          if (String(record.forYear || record.academicYear || y) !== y) continue;
          const raw = record.modulePayload?.payment || {};
          const p = { ...raw, amount: Number(record.amountPaidNow ?? record.amount ?? raw.amount), timestamp: raw.timestamp ?? raw.datePaid ?? record.datePaid, academicYear: Number(y), status: 'approved', approvedAt: record.approvedAt, referenceCode: record.referenceCode || raw.referenceCode };
          const ts = paymentTime(p);
          if (!Number.isFinite(ts) || !Number.isSafeInteger(p.amount) || p.amount <= 0) { uncertainPayments = true; continue; }
          payments[key] = { ...p, timestamp: ts };
        }
      }
      const classMap = { ...newClasses, ...classes };
      const templateMap = { ...templates, ...newTemplates };
      const cleanBase = { ...base, payments: {} };
      const built = math().buildFinanceStudentsForCompliance({ [id]: cleanBase }, {}, { [id]: enrollments[id] || yearEnrollments[id] || {} }, classMap, { [id]: ov }, templateMap, { [id]: payments }, { [id]: carry[id] || {} }, { [id]: directFees[id] ?? fees[id] ?? directFees[admissionKey] }, {}, y);
      const student = built[id];
      if (!student) continue;
      const cfg = student._classDefaults || {};
      const defaultPlanId = cfg.defaultPlanId || cfg.defaultPlan || '';
      // Preserve the prepared payment identities; builder normalization is shared with Finance.
      const input = { year: y, student, rows, planId, defaultPlanId, before, carry: carry[id] || {}, uncertainPayments: uncertainPayments || !!extensions[id],
        after: { feePerYear: cfg.feePerYear, planId: defaultPlanId, customSchedule: Object.values(cfg.installments || templateMap[defaultPlanId]?.schedule || []) },
        classConfig: cfg, className: student.classLevel, studentId: id, studentAdm: student.admissionNumber,
        studentName: [student.firstName, student.middleName, student.lastName].filter(Boolean).join(' ') || id };
      if (!Number.isSafeInteger(Number(cfg.feePerYear)) || Number(cfg.feePerYear) <= 0 || !defaultPlanId) input.uncertainPayments = true;
      result[id] = input;
    }
    ctx.check();
    return result;
  }
  let authorize = null;
  function setAuthorizer(fn) { authorize = fn; }
  async function authenticatedAdmin(ctx) {
    const user = global.firebase?.auth?.().currentUser;
    if (!user?.email) return false;
    const email = user.email.trim().toLowerCase();
    for (const key of [...new Set([email.replace(/\./g, '_'), email.replace(/[@.]/g, '_')])]) {
      const profile = (await ctx.database.ref(`users/${key}`).once('value')).val();
      if (!profile) continue;
      // Same role source as the approvals-page access guard: some admins only carry
      // 'role' in localStorage, not on the Firebase profile record.
      const role = String(profile.role || global.localStorage?.getItem('role') || '').toLowerCase();
      if (role !== 'admin') return false;
      const ids = new Set();
      const add = id => { if (typeof id === 'string' && id) ids.add(id.toLowerCase().replace(/_/g, '-')); };
      ['schoolId', 'schoolid', 'school', 'currentSchoolId', 'activeSchoolId'].forEach(k => add(profile[k]));
      ['schoolIds', 'schools', 'schoolMemberships', 'memberships'].forEach(k => {
        const value = profile[k];
        if (Array.isArray(value)) value.forEach(v => add(typeof v === 'string' ? v : v?.id || v?.schoolId || v?.key));
        else if (value && typeof value === 'object') Object.keys(value).forEach(add);
        else add(value);
      });
      if (ids.has(ctx.schoolId.toLowerCase().replace(/_/g, '-'))) return true;
      // Root legacy membership follows the existing approvals guard via the official path helper.
      if (!ctx.path('') && !ids.size) return true;
      const meta = (await ctx.database.ref(`schools/${ctx.schoolId}/meta`).once('value')).val() || {};
      return ['email', 'schoolEmail', 'ownerEmail', 'adminEmail', 'contactEmail'].some(k => String(meta[k] || '').toLowerCase() === email);
    }
    return false;
  }
  async function requireAdmin(ctx) {
    if (!(authorize ? await authorize(ctx.schoolId) : await authenticatedAdmin(ctx))) throw new Error('Special plan review requires an authenticated administrator of this school.');
    ctx.check();
  }
  function reviewPath(ctx, id) { return `specialPlanCompliance/${ctx.year}/${id}`; }
  async function withStudentLock(ctx, id, work) {
    const lockRef = ctx.database.ref(ctx.path(`${reviewPath(ctx, id)}/decisionLock`));
    const token = global.crypto.randomUUID();
    const at = Date.now();
    const lock = await lockRef.transaction(current => current && at - current.at < 300000 ? undefined : { token, at });
    if (!lock.committed) throw new Error('Another administrator is reviewing this student. Refresh shortly.');
    try {
      return await work(async () => {
        ctx.check();
        const held = (await lockRef.once('value')).val();
        if (held?.token !== token) throw new Error('Review lock expired. Run review again.');
      });
    } finally { await lockRef.transaction(current => current?.token === token ? null : undefined); }
  }
  async function withConfigurationLock(record, year, work) {
    if (Number(year) < 2026) return work();
    const targets = new Map();
    for (const operation of record.modulePayload?.operations || []) {
      const m = String(operation.path || '').match(/^(?:studentOverrides\/(20\d{2})|finance\/(20\d{2})\/(?:studentFees|studentPlans|studentCustomSchedules))\/([^/]+)(?:\/|$)/);
      if (m && Number(m[1] || m[2]) >= 2026) targets.set(`${m[1] || m[2]}/${m[3]}`, { year: m[1] || m[2], id: m[3] });
    }
    const list = [...targets.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([, v]) => v);
    async function next(index) {
      if (index === list.length) return work();
      const item = list[index]; const ctx = context(item.year);
      await requireAdmin(ctx);
      return withStudentLock(ctx, item.id, async check => { await check(); return next(index + 1); });
    }
    return next(0);
  }
  async function queue(ctx, input, evaluation) {
    return withStudentLock(ctx, input.studentId, async checkLock => {
      await checkLock();
      return queueLocked(ctx, input, evaluation);
    });
  }
  async function queueLocked(ctx, input, evaluation) {
    const fingerprint = await digest({ schoolId: ctx.schoolId, year: ctx.year, studentId: input.studentId, before: input.before });
    const breachKey = await digest(evaluation.breaches.map(b => [b.deadline, b.required]));
    const approvalId = `spc_${ctx.year}_${await digest([ctx.schoolId, input.studentId, fingerprint, breachKey])}`;
    const summary = `Return ${input.studentName} to the ${input.className} default fee and instalment plan: ${input.planId} deadline ${evaluation.breaches.at(-1).deadline} was missed.`;
    const stamp = Date.now();
    const evidence = { kind: KIND, schoolId: ctx.schoolId, year: ctx.year, studentId: input.studentId, fingerprint, breachKey, before: clone(input.before), after: clone(input.after), planId: input.planId, breaches: evaluation.breaches, className: input.className };
    const record = { approvalId, schoolId: ctx.schoolId, sourceModule: 'financeconfig', source: 'Finance Config', status: 'pending', forYear: Number(ctx.year), academicYear: Number(ctx.year), financeYear: Number(ctx.year), createdAt: stamp, datePaid: stamp, recordedBy: 'SYSTEM - SPECIAL PLAN COMPLIANCE', studentName: input.studentName, studentAdm: input.studentAdm, studentId: input.studentId, className: input.className, amountPaidNow: 0, paymentMethod: 'Config Change', configSummary: summary, notes: summary,
      modulePayload: { configAction: KIND, compliance: evidence, studentId: input.studentId, historyEntries: [{ year: ctx.year, category: 'overrides', id: input.studentId, action: 'Revert student override', before: { feePerYear: input.student.baseFee, planId: input.planId, customSchedule: input.rows }, after: input.after }] } };
    ctx.check();
    // The persistent per-student transaction is the dedupe authority, even after rejection.
    const ref = ctx.database.ref(ctx.path(reviewPath(ctx, input.studentId)));
    const tx = await ref.transaction(current => {
      if (current?.pending) return;
      if (current?.decisions?.[fingerprint]?.[breachKey]) return;
      const decisions = Object.values(current?.decisions?.[fingerprint] || {});
      if (evaluation.breaches.every(b => decisions.some(d => (d.breaches || []).some(old => old.deadline === b.deadline && old.required === b.required)))) return;
      return { ...(current || {}), pending: record };
    });
    const pending = tx.snapshot.val()?.pending;
    if (pending) {
      // Repair a queue write interrupted after reserving the id. Never overwrite a decision.
      await ctx.database.ref(ctx.path(`approvalsPending/${pending.approvalId}`)).transaction(current => current || pending);
    }
    return tx.committed ? 'queued' : (pending ? 'alreadyQueued' : 'alreadyReviewed');
  }
  let scanning = null;
  async function review(year) {
    const ctx = context(year);
    await requireAdmin(ctx);
    if (scanning) return scanning;
    scanning = (async () => {
      const inputs = await load(ctx);
      const counts = { compliant: 0, breached: 0, queued: 0, alreadyQueued: 0, alreadyReviewed: 0, skipped: 0, skippedDetails: [] };
      for (const input of Object.values(inputs)) {
        const result = evaluate(input);
        if (result.status !== 'breached') {
          counts[result.status]++;
          if (result.status === 'skipped') counts.skippedDetails.push({ student: input.studentName, reason: result.reason });
          continue;
        }
        counts.breached++;
        counts[await queue(ctx, input, result)]++;
      }
      return counts;
    })().finally(() => { scanning = null; });
    return scanning;
  }
  async function decide(record, status, actor) {
    const e = record.modulePayload?.compliance;
    if (e?.kind !== KIND || !['approved', 'rejected'].includes(status)) throw new Error('Invalid compliance decision.');
    const ctx = context(e.year);
    await requireAdmin(ctx);
    if (e.schoolId !== ctx.schoolId || record.schoolId !== ctx.schoolId || String(record.forYear) !== ctx.year || record.studentId !== e.studentId) throw new Error('School, year or student does not match this review.');
    return withStudentLock(ctx, e.studentId, checkLock => decideLocked(ctx, record, status, actor, checkLock));
  }
  async function decideLocked(ctx, record, status, actor, checkLock) {
    const e = record.modulePayload.compliance;
    const path = reviewPath(ctx, e.studentId);
    const saved = await get(ctx, path);
    if (saved?.decisions?.[e.fingerprint]?.[e.breachKey]) throw new Error('This review has already been decided. Refresh the queue.');
    if (saved?.pending?.approvalId !== record.approvalId || stable(saved.pending.modulePayload.compliance) !== stable(e)) throw new Error('Review snapshot changed. Refresh the queue.');
    const updates = {};
    let after = e.after;
    if (status === 'approved') {
      const input = (await load(ctx))[e.studentId];
      if (!input || stable(input.before) !== stable(e.before) || input.className !== e.className) throw new Error('Agreement or class changed. Reject this stale review and run Review Special Plans again.');
      const result = evaluate(input);
      if (result.status !== 'breached' || !result.breaches.some(b => e.breaches.some(old => old.deadline === b.deadline && old.required === b.required))) throw new Error('The payment evidence no longer supports this request. Reject and review again.');
      after = input.after;
      // Remove only agreement fields; retain unrelated legacy metadata.
      for (const field of ['feePerYear', 'locked', 'planId', 'defaultPlanId', 'paymentPlanId', 'planName', 'paymentPlan', 'customSchedule']) updates[ctx.path(`studentOverrides/${ctx.year}/${e.studentId}/${field}`)] = null;
      for (const bucket of ['studentFees', 'studentPlans', 'studentCustomSchedules']) updates[ctx.path(`finance/${ctx.year}/${bucket}/${e.studentId}`)] = null;
      updates[ctx.path(`studentFees/${ctx.year}/${e.studentId}`)] = null;
      if (e.before.directFeeAdmission && input.studentAdm !== e.studentId) updates[ctx.path(`studentFees/${ctx.year}/${input.studentAdm}`)] = null;
    }
    const at = Date.now();
    const decision = { status, at, by: actor, approvalId: record.approvalId, before: e.before, after, planId: e.planId, breaches: e.breaches, reason: record.configSummary };
    updates[ctx.path(`${path}/pending`)] = null;
    updates[ctx.path(`${path}/decisions/${e.fingerprint}/${e.breachKey}`)] = decision;
    updates[ctx.path(`${path}/latest`)] = decision;
    updates[ctx.path(`financeConfigHistory/${ctx.year}/overrides/${e.studentId}/${record.approvalId}`)] = { action: `${KIND}:${status}`, ...decision };
    updates[ctx.path(`approvalsPending/${record.approvalId}`)] = null;
    const month = String(new Date(record.createdAt).getMonth() + 1).padStart(2, '0');
    updates[ctx.path(`approvalsHistory/${ctx.year}/${month}/${record.approvalId}`)] = { ...record, status: 'completed', finalStatus: status, [status === 'approved' ? 'approvedBy' : 'rejectedBy']: actor, [status === 'approved' ? 'approvedAt' : 'rejectedAt']: at, appliedAfter: after };
    await checkLock();
    await ctx.database.ref().update(updates);
    global.SomapFinance?._clearFinanceCaches?.();
  }
  function details(record) {
    const e = record.modulePayload?.compliance;
    if (!e) return '';
    const status = record.finalStatus || record.status || 'pending';
    const after = record.appliedAfter || e.after;
    return `<div class="my-3 rounded border p-3 text-sm" style="overflow-wrap:anywhere"><strong>Special plan compliance — ${esc(status === 'pending' ? 'awaiting approval' : status)}</strong><p>School: ${esc(e.schoolId)} · Academic year: ${esc(e.year)}</p><p>${esc(record.configSummary)}</p>${e.breaches.map(b => `<p>${esc(b.label)} · Deadline ${esc(b.deadline)} · Required ${money(b.required)} · Paid by deadline ${money(b.paid)} · Shortfall ${money(b.shortfall)}</p>`).join('')}<p>Class default: ${money(after.feePerYear)} · ${esc(after.planId)} · ${after.customSchedule.length} schedule row(s). Approved payments are preserved.</p><p>Review ID: ${esc(record.approvalId)}${record.approvedBy || record.rejectedBy ? ` · Decision by ${esc(record.approvedBy || record.rejectedBy)}` : ''}</p></div>`;
  }
  async function notice(year, studentId) {
    if (Number(year) < 2026) return '';
    const ctx = context(year);
    const data = await get(ctx, reviewPath(ctx, studentId));
    ctx.check();
    let message = '';
    if (data?.pending) message = 'Special payment arrangement missed. Return to the class default fee and plan is awaiting approval. ' + data.pending.configSummary;
    else if (data?.latest?.status === 'approved') message = `Previous ${data.latest.planId} arrangement ended because its payment deadline was not met. Student returned to the class default plan after approval on ${new Date(data.latest.at).toLocaleDateString()}. Later approved agreements remain allowed.`;
    else if (data?.latest?.status === 'rejected') message = 'Special plan review rejected. The agreement was retained.';
    return message ? `<div class="my-3 rounded border border-amber-500 p-3 text-sm">${esc(message)}</div>` : '';
  }
  async function autoReview(year) {
    // Returns a status object so callers (e.g. approvals.html) can show the user why
    // nothing happened, instead of a silent no-op. Never throws.
    if (Number(year) < 2026) return { ok: false, reason: 'year-not-supported' };
    try {
      const ctx = context(year);
      if (!(authorize ? await authorize(ctx.schoolId) : await authenticatedAdmin(ctx))) return { ok: false, reason: 'not-authorized' };
      const counts = await review(year);
      return { ok: true, counts };
    } catch (err) { console.warn('Special plan review:', err.message); return { ok: false, reason: err.message }; }
  }
  let watchedKey = '';
  let unwatch = [];
  let reviewTimer;
  async function watchYear(year) {
    if (Number(year) < 2026) { unwatch.forEach(fn => fn()); unwatch = []; watchedKey = ''; return; }
    const ctx = context(year);
    if (!(authorize ? await authorize(ctx.schoolId) : await authenticatedAdmin(ctx))) return;
    ctx.check();
    const key = `${ctx.schoolId}/${ctx.year}`;
    if (watchedKey === key) return;
    unwatch.forEach(fn => fn()); unwatch = []; watchedKey = key;
    for (const path of [`financeLedgers/${ctx.year}`, `studentOverrides/${ctx.year}`, `finance/${ctx.year}/studentPlans`, `finance/${ctx.year}/studentCustomSchedules`]) {
      const ref = ctx.database.ref(ctx.path(path));
      const callback = () => {
        clearTimeout(reviewTimer);
        reviewTimer = setTimeout(() => { if (global.SOMAP?.getSchool?.()?.id === ctx.schoolId) autoReview(ctx.year); }, 600);
      };
      ref.on('value', callback, err => console.warn('Special plan review watch:', err.message));
      unwatch.push(() => ref.off('value', callback));
    }
  }
  if (global.document) global.document.addEventListener('DOMContentLoaded', () => {
    // Auth restoration can finish after the first Finance data load.
    if (!global.location.pathname.includes('/Todashboardhtml/approvals.html')) {
      global.firebase?.auth?.().onAuthStateChanged(user => {
        if (user) watchYear(global.somapYearContext?.getSelectedYear?.() || new Date().getFullYear()).catch(err => console.warn(err.message));
      });
      global.somapYearContext?.onYearChanged?.(year => watchYear(year).catch(err => console.warn(err.message)));
    }
  });
  global.SomapSpecialPlans = { evaluate, review, autoReview, watchYear, decide, details, notice, setAuthorizer, withConfigurationLock, yearValue, load, context, validPayment, paymentTime };
})(typeof window !== 'undefined' ? window : globalThis);
