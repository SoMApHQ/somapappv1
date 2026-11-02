// Transport approval guard (Management mode).
// Drivers, conductors, gate staff and other non-admin roles may open every Transport Hub
// page, but what they save is NOT written. Each write is captured here, batched, and sent
// to Approvals as a 'transportpricing' record (modulePayload.kind = 'transportmanage').
// Todashboardhtml/approvals.js commitTransportPricingChange replays the exact writes only
// after an admin approves. Still written directly (their own work, or already gated):
//   - attendance / boarding events / bus locations
//   - payment submissions (unapproved ledger rows + approval queues)
//   - new fuel / maintenance requests
// Admin roles (TransportRoles.isAdmin) are untouched.
(function () {
  'use strict';
  const fb = window.firebase;
  if (!fb || !fb.database || !fb.database.Reference || window.TransportApprovalGuard) return;

  const Ref = fb.database.Reference.prototype;
  const orig = { set: Ref.set, update: Ref.update, remove: Ref.remove, push: Ref.push, transaction: Ref.transaction, setWithPriority: Ref.setWithPriority };

  const ADMIN_FALLBACK = /admin|owner|director|principal|headteacher|head_teacher|transport_officer|^transport$|^dashboard/;
  let guarded = true; // safe default until the role is known
  let actor = { uid: '', email: '', name: '', role: '' };
  let resolveReady;
  const ready = new Promise((r) => { resolveReady = r; });

  function normRole(role) {
    if (window.TransportRoles?.normalize) return window.TransportRoles.normalize(role);
    return String(role || '').trim().toLowerCase().replace(/[\s\-/\\]+/g, '_');
  }
  function isAdminRole(role) {
    if (window.TransportRoles?.isAdmin) return window.TransportRoles.isAdmin(role);
    const n = normRole(role);
    return !n || ADMIN_FALLBACK.test(n);
  }

  try {
    fb.auth().onAuthStateChanged(async (user) => {
      if (!user) { guarded = true; resolveReady(); return; }
      actor = { uid: user.uid, email: user.email || '', name: user.displayName || '', role: '' };
      try {
        const snap = await fb.database().ref(`users/${user.uid}`).once('value');
        const u = snap.val() || {};
        actor.role = u.role || u.profile?.role || '';
        actor.name = u.fullName || u.name || u.profile?.fullName || actor.name || actor.email;
        guarded = !isAdminRole(actor.role);
      } catch (err) {
        console.warn('TransportApprovalGuard: role check failed, staying in approval mode', err);
        guarded = true;
      }
      resolveReady();
      if (guarded) showBanner();
    });
  } catch (err) {
    console.warn('TransportApprovalGuard: auth unavailable', err);
    resolveReady();
  }
  setTimeout(resolveReady, 8000);

  // ---------- path helpers ----------
  function refPath(ref) {
    const full = ref.toString();
    const root = ref.root.toString();
    return decodeURIComponent(full.slice(root.length)).replace(/^\/+|\/+$/g, '');
  }
  const join = (a, b) => [a, b].map((s) => String(s || '').replace(/^\/+|\/+$/g, '')).filter(Boolean).join('/');

  function schoolId() {
    let sid = '';
    try { sid = window.SOMAP?.getSchoolId?.() || ''; } catch (_) { /* no context */ }
    if (!sid) {
      try {
        const q = new URLSearchParams(location.search);
        sid = q.get('school') || q.get('schoolId') || '';
      } catch (_) { /* ignore */ }
    }
    sid = String(sid || window.currentSchoolId || '').trim();
    const low = sid.toLowerCase();
    if (low === 'socrates' || low === 'default' || low === 'socrates school') return 'socrates-school';
    return sid;
  }

  const PENDING_STATUS = /^(pending|requested|submitted|new|open)$/i;
  function isDirect(path, value) {
    if (/(^|\/)(approvalsPending|pendingApprovals|expenseApprovals)(\/|$)/.test(path)) return true;
    if (/(^|\/)(attendance[A-Za-z_]*|boarding_events|bus_locations|payment_reservations)(\/|$)/.test(path)) return true;
    if (/(^|\/)transportLedgers\/[^/]+\/payments\/[^/]+$/.test(path)) return !!value && value.approved === false;
    if (/(^|\/)transportPayments\/[^/]+\/[^/]+$/.test(path)) return !!value && value.status === 'pending';
    if (/^(fuel_requests|maintenance_requests)\/[^/]+$/.test(path)) {
      return !!value && typeof value === 'object' && (!value.status || PENDING_STATUS.test(String(value.status)));
    }
    return false;
  }

  // ---------- batching ----------
  let batch = [];
  let flushTimer = null;
  const clone = (v) => (v === undefined ? null : JSON.parse(JSON.stringify(v)));

  function addOp(path, value) {
    const v = clone(value);
    // A later write under an op already in the batch is folded into that op's value,
    // and a later write above existing ops replaces them — keeps the replay a valid multi-path update.
    for (const op of batch) {
      if (path === op.path) { op.value = v; return; }
      if (path.startsWith(`${op.path}/`)) {
        const rest = path.slice(op.path.length + 1).split('/');
        if (!op.value || typeof op.value !== 'object') op.value = {};
        let cur = op.value;
        rest.slice(0, -1).forEach((k) => { if (!cur[k] || typeof cur[k] !== 'object') cur[k] = {}; cur = cur[k]; });
        cur[rest[rest.length - 1]] = v;
        return;
      }
    }
    batch = batch.filter((op) => !op.path.startsWith(`${path}/`));
    batch.push({ op: 'set', path, value: v, abs: true });
  }

  function enqueue(entries) {
    entries.forEach(([p, v]) => addOp(p, v));
    clearTimeout(flushTimer);
    flushTimer = setTimeout(() => { flush().catch((err) => { console.error(err); toast('Imeshindikana kutuma kwa idhini · Could not send for approval', true); }); }, 1200);
    toast('⏳ Inatumwa kwa idhini… · Sending for approval…');
  }

  function describe(path, value) {
    const v = value && typeof value === 'object' ? value : {};
    const who = v.fullName || v.studentName || v.name || v.plate || v.plateNumber || v.vehicleName || '';
    const rules = [
      [/transport(Assignments|Enrollments|Periods|Registry)\//, 'Student transport registration'],
      [/transport\/buses/, 'Vehicle'],
      [/transportCatalog\/\d{4}\/stops/, 'Stop'],
      [/monthMultipliers/, 'Monthly multipliers'],
      [/transportOverrides/, 'Student override'],
      [/transportRoutes/, 'Route'],
      [/^fuel_/, 'Fuel'],
      [/^maintenance/, 'Maintenance'],
      [/^settings\/transport/, 'Transport operations settings'],
    ];
    const label = (rules.find(([re]) => re.test(path)) || [null, 'Transport change'])[1];
    const removed = value === null;
    return { label, who, text: `${label}${who ? `: ${who}` : ''}${removed ? ' (remove)' : ''}` };
  }

  function yearOf(path) {
    const m = path.match(/(?:years|transportCatalog|transportSettings|transportOverrides|transportAssignments|transportRegistry)\/(20\d{2})(\/|$)/) || path.match(/^transport\/[^/]+\/(20\d{2})\//);
    if (m) return Number(m[1]);
    const ctx = Number(window.somapYearContext?.getSelectedYear?.());
    return Number.isFinite(ctx) && ctx > 2000 ? ctx : new Date().getFullYear();
  }

  async function flush() {
    const ops = batch;
    batch = [];
    if (!ops.length) return;
    const db = fb.database();
    const befores = await Promise.all(ops.map((op, i) => (i < 60
      ? db.ref(op.path).once('value').then((s) => s.val()).catch(() => null)
      : Promise.resolve(null))));
    const sid = schoolId();
    const year = yearOf(ops[0].path);
    const page = (document.title || location.pathname.split('/').pop() || 'Transport').trim();
    const described = ops.map((op, i) => describe(op.path, op.value === null ? befores[i] : op.value));
    const uniq = [...new Set(described.map((d) => d.text))];
    const summary = `${uniq.slice(0, 3).join('; ')}${uniq.length > 3 ? ` +${uniq.length - 3} more` : ''}`;
    const students = [...new Set(described.filter((d) => d.label === 'Student transport registration' && d.who).map((d) => d.who))];
    const approvalRef = db.ref(sid ? `schools/${sid}/approvalsPending` : 'approvalsPending').push();
    const recordedBy = actor.email || actor.uid || 'unknown';
    await orig.set.call(approvalRef, {
      approvalId: approvalRef.key,
      sourceModule: 'transportpricing',
      source: 'Transport Management',
      status: 'pending',
      forYear: year,
      academicYear: year,
      financeYear: year,
      createdAt: Date.now(),
      datePaid: Date.now(),
      recordedBy,
      requestedByName: actor.name || recordedBy,
      requestedByRole: actor.role || '',
      studentName: students.length === 1 ? students[0] : '',
      studentAdm: '',
      studentId: '',
      className: '',
      parentContact: '',
      amountPaidNow: 0,
      paymentMethod: 'Transport Management Change',
      configTarget: `${page} · ${actor.name || recordedBy}${actor.role ? ` (${actor.role})` : ''}`,
      configSummary: summary,
      notes: summary,
      modulePayload: {
        kind: 'transportmanage',
        schoolId: sid,
        page: location.pathname.split('/').pop() || '',
        configAction: 'manage',
        operations: ops,
        historyEntries: ops.map((op, i) => ({
          year: yearOf(op.path),
          category: 'manage',
          id: op.path.replace(/[.#$[\]/]+/g, '_').slice(-120),
          action: op.value === null ? 'manage:remove' : (befores[i] == null ? 'manage:create' : 'manage:update'),
          label: described[i].text,
          path: op.path,
          before: clone(befores[i]),
          after: op.value,
        })),
      },
    });
    toast(`📨 Imetumwa kwa idhini · Sent for approval (${uniq.length}). Haitabadilika hadi iidhinishwe · Nothing changes until approved.`);
  }
  window.addEventListener('pagehide', () => { if (batch.length) { clearTimeout(flushTimer); flush(); } });

  // ---------- interception ----------
  function intercept(base, entries, passFn) {
    return ready.then(() => {
      if (!guarded) return passFn();
      const direct = entries.filter(([p, v]) => isDirect(p, v));
      const queued = entries.filter(([p, v]) => !isDirect(p, v));
      if (queued.length) enqueue(queued);
      if (!direct.length) return undefined;
      const updates = {};
      direct.forEach(([p, v]) => { updates[p] = v === undefined ? null : v; });
      return orig.update.call(fb.database().ref(), updates);
    });
  }

  Ref.set = function (value, onComplete) {
    const path = refPath(this);
    const p = intercept(this, [[path, value]], () => orig.set.call(this, value));
    if (typeof onComplete === 'function') p.then(() => onComplete(null), onComplete);
    return p;
  };
  Ref.setWithPriority = function (value, priority, onComplete) {
    const path = refPath(this);
    const p = intercept(this, [[path, value]], () => orig.setWithPriority.call(this, value, priority));
    if (typeof onComplete === 'function') p.then(() => onComplete(null), onComplete);
    return p;
  };
  Ref.update = function (values, onComplete) {
    const base = refPath(this);
    const entries = Object.entries(values || {}).map(([k, v]) => [join(base, k), v]);
    const p = intercept(this, entries, () => orig.update.call(this, values));
    if (typeof onComplete === 'function') p.then(() => onComplete(null), onComplete);
    return p;
  };
  Ref.remove = function (onComplete) {
    const path = refPath(this);
    const p = intercept(this, [[path, null]], () => orig.remove.call(this));
    if (typeof onComplete === 'function') p.then(() => onComplete(null), onComplete);
    return p;
  };
  Ref.push = function (value, onComplete) {
    const child = orig.push.call(this); // key only, no write
    if (value === undefined) return child;
    const p = child.set(value, onComplete);
    child.then = p.then.bind(p);
    child.catch = p.catch.bind(p);
    return child;
  };
  Ref.transaction = function (updateFn, onComplete, applyLocally) {
    const self = this;
    const path = refPath(self);
    return ready.then(async () => {
      if (!guarded || isDirect(path, {})) return orig.transaction.call(self, updateFn, onComplete, applyLocally);
      const current = (await self.once('value')).val();
      const next = updateFn(current);
      const snapshot = { val: () => (next === undefined ? current : next), exists: () => (next === undefined ? current : next) != null, key: self.key };
      if (next === undefined) return { committed: false, snapshot };
      enqueue([[path, next]]);
      if (typeof onComplete === 'function') onComplete(null, true, snapshot);
      return { committed: true, snapshot };
    });
  };

  // ---------- UI ----------
  function toast(msg, bad) {
    let el = document.getElementById('tagToast');
    if (!el) {
      el = document.createElement('div');
      el.id = 'tagToast';
      el.setAttribute('role', 'status');
      el.style.cssText = 'position:fixed;left:50%;bottom:18px;transform:translateX(-50%);z-index:99999;max-width:min(560px,calc(100vw - 32px));padding:12px 16px;border-radius:12px;font:600 14px/1.4 system-ui,sans-serif;box-shadow:0 10px 30px rgba(0,0,0,.35);transition:opacity .3s';
      document.body.appendChild(el);
    }
    el.style.background = bad ? '#7f1d1d' : '#0f766e';
    el.style.color = '#fff';
    el.textContent = msg;
    el.style.opacity = '1';
    clearTimeout(el._t);
    el._t = setTimeout(() => { el.style.opacity = '0'; }, 6000);
  }

  function showBanner() {
    const mount = () => {
      if (document.getElementById('tagBanner')) return;
      const b = document.createElement('div');
      b.id = 'tagBanner';
      b.style.cssText = 'position:sticky;top:0;z-index:9999;background:#fef3c7;color:#78350f;border-bottom:1px solid #f59e0b;padding:8px 16px;font:600 13px/1.4 system-ui,sans-serif;text-align:center';
      b.textContent = '🔒 Hali ya idhini · Approval mode — kila unachohifadhi kinatumwa kwa Approvals na hakibadiliki hadi kiidhinishwe. Mahudhurio (attendance) yanahifadhiwa moja kwa moja.';
      document.body.prepend(b);
    };
    if (document.body) mount(); else document.addEventListener('DOMContentLoaded', mount);
  }

  window.TransportApprovalGuard = {
    ready,
    isGuarded: () => guarded,
    whenGuarded: () => ready.then(() => guarded),
    flush,
  };
})();
