// SoMAp Letters & Minutes Studio — data, roles, encrypted vault, numbering, audit.
// Data lives under {school prefix}letters/ (Socrates at the root, other schools under schools/{id}/):
//   index/{id}              safe summary for lists and stats (protected rows carry `sealed` instead of subject/recipient)
//   bodies/{id}             { enc:false, data:{doc,versions} }  or  { enc:true, iv, ct }  (AES-GCM, vault key)
//   types/{id}              custom letter types
//   settings                letterheads, numbering prefixes, defaults, AI/OTP service URL
//   vault                   { salt, iter, wrap:{iv,ct}, otp:{enabled} } — the data key, wrapped by the director password
//   signatures/director     encrypted with the vault key (the Head Teacher can never read it)
//   signatures/workers/{id} a worker's own signature (Head Teacher)
//   counters/{year}/{key}   reference-number sequences
//   audit/{push}            who opened / unlocked / signed / downloaded what
// Protection is cryptographic: company and confidential letters are stored only as ciphertext,
// so hiding buttons is never what keeps them private.
(function (global) {
  'use strict';
  const T = global.SomapLettersT;
  const SOCRATES_ID = 'socrates-school';
  const ROOT = 'letters';
  const PBKDF2_ITER = 310000;
  const UNLOCK_MS = 30 * 60 * 1000;
  const MAX_VERSIONS = 40;

  // ---------- helpers ----------
  const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
  const pad = (n) => String(n).padStart(2, '0');
  function todayYMD() { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; }
  function uid(prefix) { return `${prefix || ''}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`; }
  function clone(v) { return v == null ? v : JSON.parse(JSON.stringify(v)); }
  const keySafe = (v) => String(v || '').replace(/[.#$\[\]\/]/g, '_');
  function initials(name) {
    const skip = new Set(['and', 'of', 'the', 'na', 'ya', 'wa', 'pre', '&']);
    return String(name || '').split(/\s+/).filter((w) => w && !skip.has(w.toLowerCase())).map((w) => w[0]).join('').toUpperCase().slice(0, 5) || 'LTR';
  }
  function storageGet(key) { try { return global.localStorage.getItem(key); } catch (_) { return null; } }

  // ---------- firebase & paths ----------
  const db = () => global.firebase.database();
  function prefix(schoolId) {
    if (!schoolId) throw new Error('No school selected');
    return schoolId === SOCRATES_ID ? '' : `schools/${schoolId}/`;
  }
  function lref(ctx, sub) { return db().ref(`${prefix(ctx.schoolId)}${ROOT}${sub ? `/${sub}` : ''}`); }
  async function val(ref) { const snap = await ref.once('value'); return snap.val(); }

  // ---------- context & roles ----------
  async function authUser() {
    const auth = global.firebase.auth();
    if (auth.currentUser) return auth.currentUser;
    return new Promise((resolve) => {
      let done = false;
      const off = auth.onAuthStateChanged((u) => { if (!done) { done = true; off(); resolve(u); } });
      setTimeout(() => { if (!done) { done = true; try { off(); } catch (_) { /* ignore */ } resolve(null); } }, 3000);
    });
  }

  // director: a signed-in (non-anonymous) dashboard administrator.
  // headteacher: a worker session whose role / teacher type is Head Teacher.
  // ?as=headteacher (the link from the Teacher Dashboard) prefers the worker session.
  async function resolveContext() {
    const INV = global.SomapInventory;
    if (!INV) throw new Error('Role helper missing');
    const base = await INV.resolveContext({ detectAdmin: true });
    const user = await authUser();
    const wantsHead = /(^|[?&])as=headteacher\b/.test(global.location.search || '');
    const realDirector = !!(user && !user.isAnonymous && base.isAdmin);
    const ctx = {
      schoolId: base.schoolId, schoolName: base.schoolName, year: base.year,
      workerId: base.workerId || '', workerName: base.workerName || '', uid: user ? user.uid : '',
      email: user && !user.isAnonymous ? user.email || '' : '',
    };
    if (base.isHeadteacher && (wantsHead || !realDirector)) {
      ctx.role = 'headteacher'; ctx.actorName = base.workerName; ctx.actorId = `worker:${base.workerId}`;
      ctx.position = 'Head Teacher';
    } else if (realDirector) {
      ctx.role = 'director'; ctx.actorName = base.adminName || user.displayName || 'Director'; ctx.actorId = `director:${user.uid}`;
      ctx.position = 'Director';
    } else {
      ctx.role = 'none';
    }
    ctx.isDirector = ctx.role === 'director';
    ctx.isHead = ctx.role === 'headteacher';
    // Workers usually run without a Firebase account; an anonymous session gives them a token for rules and the AI service.
    if (!user && ctx.isHead) { try { await global.firebase.auth().signInAnonymously(); } catch (_) { /* rules may not need it */ } }
    return ctx;
  }

  // ---------- crypto (WebCrypto, AES-256-GCM) ----------
  const subtle = () => { if (!global.crypto?.subtle) throw new Error('This browser cannot encrypt (open the page over https)'); return global.crypto.subtle; };
  const enc = new TextEncoder(); const dec = new TextDecoder();
  function b64(buf) { const bytes = new Uint8Array(buf); let s = ''; for (let i = 0; i < bytes.length; i += 1) s += String.fromCharCode(bytes[i]); return btoa(s); }
  function unb64(str) { const s = atob(String(str || '')); const out = new Uint8Array(s.length); for (let i = 0; i < s.length; i += 1) out[i] = s.charCodeAt(i); return out; }
  function rand(n) { const a = new Uint8Array(n); global.crypto.getRandomValues(a); return a; }

  // Password -> 256-bit key; when the email OTP is on, the server share is mixed in so both factors are required.
  async function deriveKek(password, saltB64, iter, shareB64) {
    const base = await subtle().importKey('raw', enc.encode(String(password)), 'PBKDF2', false, ['deriveBits']);
    const bits = new Uint8Array(await subtle().deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: unb64(saltB64), iterations: iter }, base, 256));
    let material = bits;
    if (shareB64) {
      const share = unb64(shareB64);
      const joined = new Uint8Array(bits.length + share.length); joined.set(bits); joined.set(share, bits.length);
      material = new Uint8Array(await subtle().digest('SHA-256', joined));
    }
    return subtle().importKey('raw', material, 'AES-GCM', false, ['encrypt', 'decrypt']);
  }
  async function aesEncrypt(key, bytes) { const iv = rand(12); const ct = await subtle().encrypt({ name: 'AES-GCM', iv }, key, bytes); return { iv: b64(iv), ct: b64(ct) }; }
  async function aesDecrypt(key, box) { return new Uint8Array(await subtle().decrypt({ name: 'AES-GCM', iv: unb64(box.iv) }, key, unb64(box.ct))); }

  // ---------- vault (session state lives only in memory) ----------
  const vault = { key: null, raw: null, unlockedAt: 0, timer: null, listeners: new Set() };
  function isUnlocked() { return !!vault.key && Date.now() - vault.unlockedAt < UNLOCK_MS; }
  function unlockRemainingMs() { return isUnlocked() ? UNLOCK_MS - (Date.now() - vault.unlockedAt) : 0; }
  function onVaultChange(fn) { vault.listeners.add(fn); return () => vault.listeners.delete(fn); }
  function emitVault() { vault.listeners.forEach((fn) => { try { fn(isUnlocked()); } catch (err) { console.warn(err); } }); }
  function lock() {
    vault.key = null; if (vault.raw) vault.raw.fill(0); vault.raw = null; vault.unlockedAt = 0;
    clearTimeout(vault.timer); emitVault();
  }
  async function setKey(raw) {
    vault.raw = raw;
    vault.key = await subtle().importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt']);
    vault.unlockedAt = Date.now();
    clearTimeout(vault.timer); vault.timer = setTimeout(lock, UNLOCK_MS);
    emitVault();
  }
  async function loadVault(ctx) { return val(lref(ctx, 'vault')); }

  // First-time setup. Returns the recovery key (the raw data key) which the director must keep offline.
  async function createVault(ctx, password) {
    if (!ctx.isDirector) throw new Error('Only the director can create the letters vault');
    if (await loadVault(ctx)) throw new Error('A vault already exists for this school');
    const raw = rand(32); const salt = b64(rand(16));
    const kek = await deriveKek(password, salt, PBKDF2_ITER);
    const wrap = await aesEncrypt(kek, raw);
    await lref(ctx, 'vault').set({ v: 1, salt, iter: PBKDF2_ITER, wrap, otp: { enabled: false }, createdAt: Date.now(), createdBy: ctx.actorId });
    await setKey(raw);
    audit(ctx, 'vault.created');
    return b64(raw);
  }
  async function unlock(ctx, password, shareB64) {
    const v = await loadVault(ctx);
    if (!v) throw new Error('No vault yet');
    if (v.otp?.enabled && !shareB64) throw new Error('OTP_REQUIRED');
    try {
      const kek = await deriveKek(password, v.salt, v.iter, v.otp?.enabled ? shareB64 : '');
      const raw = await aesDecrypt(kek, v.wrap);
      await setKey(raw);
      audit(ctx, 'vault.unlocked', { result: 'ok' });
      return true;
    } catch (err) {
      audit(ctx, 'vault.unlock_failed', { result: 'fail' });
      throw new Error('Wrong password or code');
    }
  }
  // Re-wrap the data key (password change, switching email OTP on/off, recovery).
  async function rewrap(ctx, password, shareB64, otpEnabled) {
    if (!isUnlocked()) throw new Error('Unlock first');
    const salt = b64(rand(16));
    const kek = await deriveKek(password, salt, PBKDF2_ITER, otpEnabled ? shareB64 : '');
    const wrap = await aesEncrypt(kek, vault.raw);
    await lref(ctx, 'vault').update({ salt, iter: PBKDF2_ITER, wrap, otp: { enabled: !!otpEnabled }, updatedAt: Date.now(), updatedBy: ctx.actorId });
    audit(ctx, otpEnabled ? 'vault.rewrapped_with_otp' : 'vault.rewrapped');
  }
  async function recover(ctx, recoveryKey, newPassword) {
    const raw = unb64(String(recoveryKey || '').trim());
    if (raw.length !== 32) throw new Error('That recovery key is not valid');
    const index = await val(lref(ctx, 'index')) || {};
    const probe = Object.keys(index).find((id) => index[id]?.protected);
    await setKey(raw);
    if (probe) {
      try { await openBody(ctx, probe); } catch (_) { lock(); throw new Error('That recovery key does not match this school'); }
    }
    await rewrap(ctx, newPassword, '', false);
    audit(ctx, 'vault.recovered');
  }
  async function sealJSON(obj) { if (!isUnlocked()) throw new Error('LOCKED'); return Object.assign({ enc: true }, await aesEncrypt(vault.key, enc.encode(JSON.stringify(obj)))); }
  async function openJSON(box) { if (!isUnlocked()) throw new Error('LOCKED'); return JSON.parse(dec.decode(await aesDecrypt(vault.key, box))); }

  // ---------- settings ----------
  function defaultLetterheads(ctx) {
    const school = ctx.schoolName || 'School';
    return {
      school: { id: 'school', label: 'School letterhead', kind: 'structured', name: school.toUpperCase(), subtitle: '', regNo: '', address: '', phones: '', email: '', website: '', motto: '', logo: '', color: '#0f3d6e', footer: '' },
      company: { id: 'company', label: 'Company letterhead', kind: 'structured', name: '', subtitle: '', regNo: '', address: '', phones: '', email: '', website: '', motto: '', logo: '', color: '#14532d', footer: '' },
    };
  }
  async function loadSettings(ctx) {
    const raw = await val(lref(ctx, 'settings')) || {};
    const heads = Object.assign(defaultLetterheads(ctx), raw.letterheads || {});
    const projectId = global.firebase.app().options.projectId;
    return {
      letterheads: heads,
      companyName: raw.companyName || heads.company.name || '',
      // Until the company letterhead is filled in, company letters number as CO/LTR/2026/001.
      prefixes: Object.assign({ school: initials(heads.school.name || ctx.schoolName), company: heads.company.name || raw.companyName ? initials(heads.company.name || raw.companyName) : 'CO' }, raw.prefixes || {}),
      defaults: Object.assign({}, T.DEFAULT_FORMAT, raw.defaults || {}),
      serviceUrl: raw.serviceUrl || `https://us-central1-${projectId}.cloudfunctions.net`,
      otpEmailHint: raw.otpEmailHint || '',
      configured: !!raw.letterheads,
    };
  }
  async function saveSettings(ctx, patch) {
    if (!ctx.isDirector) throw new Error('Only the director can change letter settings');
    await lref(ctx, 'settings').update(Object.assign({}, patch, { updatedAt: Date.now(), updatedBy: ctx.actorId }));
  }
  // Letterhead logos are school branding, not secrets; they ride inside settings as small data URLs.
  async function saveLetterhead(ctx, head) {
    if (!ctx.isDirector) throw new Error('Only the director can change letterheads');
    await lref(ctx, `settings/letterheads/${keySafe(head.id)}`).set(head);
  }
  async function deleteLetterhead(ctx, id) {
    if (!ctx.isDirector || ['school', 'company'].includes(id)) return;
    await lref(ctx, `settings/letterheads/${keySafe(id)}`).remove();
  }

  // ---------- letter types ----------
  async function loadTypes(ctx) {
    const custom = await val(lref(ctx, 'types')) || {};
    const list = T.TYPES.map((t) => Object.assign({}, t, { builtin: true }));
    Object.values(custom).forEach((t) => { if (t && t.id && !t.deleted) list.push(Object.assign({ group: 'custom', code: t.scope === 'company' ? 'LTR' : 'GEN', icon: '✳️' }, t, { builtin: false })); });
    return list;
  }
  async function saveType(ctx, type) {
    if (type.scope === 'company' && !ctx.isDirector) throw new Error('Only the director can add company letter types');
    const id = type.id || `custom_${uid()}`;
    const record = { id, en: type.en, sw: type.sw || type.en, scope: type.scope === 'company' ? 'company' : 'school', confidential: !!type.confidential, mode: type.mode === 'minutes' ? 'minutes' : 'letter', subject: String(type.subject || type.en || '').toUpperCase(), subjectSw: String(type.subjectSw || '').toUpperCase(), tone: type.tone || '', icon: type.icon || '✳️', group: 'custom', code: type.code || (type.scope === 'company' ? 'LTR' : 'GEN'), createdBy: ctx.actorId, createdAt: Date.now() };
    await lref(ctx, `types/${id}`).set(record);
    return record;
  }
  // A type is protected (encrypted) when it belongs to the company or is confidential.
  const isProtectedType = (t) => !!(t && (t.scope === 'company' || t.confidential));

  // ---------- reference numbers ----------
  async function nextRefNo(ctx, settings, type, ymd) {
    const year = String(ymd || todayYMD()).slice(0, 4);
    const pre = type.scope === 'company' ? settings.prefixes.company : settings.prefixes.school;
    const code = type.code || 'LTR';
    const res = await lref(ctx, `counters/${year}/${keySafe(`${pre}_${code}`)}`).transaction((n) => (Number(n) || 0) + 1);
    const seq = res.snapshot.val();
    return `${pre}/${code}/${year}/${String(seq).padStart(3, '0')}`;
  }

  // ---------- letters ----------
  function newDoc(ctx, settings, type) {
    const lang = 'en';
    const head = type.scope === 'company' ? 'company' : 'school';
    return {
      typeId: type.id, typeName: type.en, mode: type.mode || 'letter', scope: type.scope, confidential: !!type.confidential,
      lang, date: todayYMD(), refNo: '', recipient: '', salutation: T.L.en.dearSir, subject: type.subject || '', body: '', closing: T.L.en.faithfully,
      onBehalf: type.scope === 'company', onBehalfName: '', signers: [{ name: ctx.actorName || '', position: ctx.position || '', key: ctx.isDirector ? 'director' : `worker:${ctx.workerId}`, signed: false }],
      enclosures: '', cc: '',
      format: Object.assign({}, settings.defaults, { letterheadId: head }),
      minutes: type.mode === 'minutes' ? T.blankMinutes(lang) : null,
      status: 'draft', authorId: ctx.actorId, authorName: ctx.actorName, authorRole: ctx.role,
    };
  }

  function summaryOf(doc) {
    return {
      typeId: doc.typeId, typeName: doc.typeName || '', mode: doc.mode || 'letter', scope: doc.scope, confidential: !!doc.confidential,
      protected: !!(doc.scope === 'company' || doc.confidential), date: doc.date || '', year: String(doc.date || '').slice(0, 4),
      refNo: doc.refNo || '', status: doc.status || 'draft', lang: doc.lang || 'en',
      authorId: doc.authorId || '', authorName: doc.authorName || '', authorRole: doc.authorRole || '',
      signedBy: (doc.signers || []).filter((s) => s.signed).map((s) => s.name).join(', '),
    };
  }

  function canOpen(ctx, row) {
    if (!row) return false;
    if (ctx.isDirector) return true;
    if (ctx.isHead) return row.scope === 'school' && !row.protected;
    return false;
  }
  function canSee(ctx, row) { return ctx.isDirector || (ctx.isHead && row && row.scope === 'school'); }

  async function listLetters(ctx) {
    const raw = await val(lref(ctx, 'index')) || {};
    const rows = Object.entries(raw).map(([id, r]) => Object.assign({ id }, r)).filter((r) => !r.deleted && canSee(ctx, r));
    // Protected subjects/recipients are sealed; reveal them only inside an unlocked director session.
    if (isUnlocked()) {
      await Promise.all(rows.filter((r) => r.sealed).map(async (r) => {
        try { Object.assign(r, await openJSON(r.sealed)); r.revealed = true; } catch (_) { /* wrong key: leave masked */ }
      }));
    }
    return rows.sort((a, b) => String(b.date).localeCompare(String(a.date)) || (b.updatedAt || 0) - (a.updatedAt || 0));
  }

  async function createLetter(ctx, settings, type, seed) {
    const prot = isProtectedType(type);
    if (prot && !ctx.isDirector) throw new Error('Only the director can write this kind of letter');
    if (prot && !isUnlocked()) throw new Error('LOCKED');
    const id = uid('L');
    const doc = Object.assign(newDoc(ctx, settings, type), seed || {});
    doc.refNo = doc.refNo || await nextRefNo(ctx, settings, type, doc.date);
    await saveLetter(ctx, id, doc, [], { created: true });
    audit(ctx, 'letter.created', { letterId: id, typeId: type.id });
    return { id, doc, versions: [] };
  }

  async function saveLetter(ctx, id, doc, versions, opts = {}) {
    const row = summaryOf(doc);
    if (!canOpen(ctx, row) && !(opts.created && ctx.isDirector)) throw new Error('You cannot change this letter');
    const now = Date.now();
    const payload = { doc, versions: (versions || []).slice(-MAX_VERSIONS) };
    const updates = {};
    const base = `${prefix(ctx.schoolId)}${ROOT}`;
    if (row.protected) {
      updates[`${base}/bodies/${id}`] = await sealJSON(payload);
      row.sealed = await sealJSON({ subject: doc.subject || doc.minutes?.title || '', recipient: firstLine(doc.recipient) });
    } else {
      updates[`${base}/bodies/${id}`] = { enc: false, data: payload };
      row.subject = doc.subject || doc.minutes?.title || '';
      row.recipient = firstLine(doc.recipient);
    }
    row.updatedAt = now;
    if (opts.created) row.createdAt = now;
    row.updatedBy = ctx.actorId;
    if (!opts.created) {
      const existing = await val(lref(ctx, `index/${id}/createdAt`));
      row.createdAt = existing || now;
    }
    updates[`${base}/index/${id}`] = row;
    await db().ref().update(updates);
    return row;
  }
  function firstLine(text) { return String(text || '').split(/\n/).map((s) => s.trim().replace(/[,.]+$/, '')).filter(Boolean).slice(0, 2).join(', '); }

  async function openBody(ctx, id) {
    const box = await val(lref(ctx, `bodies/${id}`));
    if (!box) throw new Error('Letter not found');
    if (box.enc) {
      if (!ctx.isDirector) throw new Error('This letter is protected');
      const data = await openJSON(box);
      return { doc: data.doc, versions: data.versions || [] };
    }
    return { doc: box.data.doc, versions: box.data.versions || [] };
  }
  async function openLetter(ctx, id, row) {
    if (!canOpen(ctx, row)) { audit(ctx, 'letter.open_denied', { letterId: id, result: 'denied' }); throw new Error('This letter is protected'); }
    if (row.protected && !isUnlocked()) throw new Error('LOCKED');
    const out = await openBody(ctx, id);
    if (row.protected) audit(ctx, 'letter.opened', { letterId: id });
    return out;
  }
  async function deleteLetter(ctx, id, row) {
    if (!canOpen(ctx, row)) throw new Error('You cannot delete this letter');
    if (row.status === 'signed' || row.status === 'filed') throw new Error('Signed letters are kept on file and cannot be deleted');
    await lref(ctx, `index/${id}`).update({ deleted: true, deletedAt: Date.now(), deletedBy: ctx.actorId });
    await lref(ctx, `bodies/${id}`).remove();
    audit(ctx, 'letter.deleted', { letterId: id });
  }
  function pushVersion(versions, doc, kind, ctx) {
    const list = (versions || []).slice();
    list.push({ at: Date.now(), kind, by: ctx.actorName || '', subject: doc.subject || '', salutation: doc.salutation || '', body: doc.body || '', closing: doc.closing || '', lang: doc.lang, minutes: doc.minutes ? clone(doc.minutes) : null });
    return list.slice(-MAX_VERSIONS);
  }

  // ---------- signatures ----------
  // The director's signature is encrypted with the vault key: it can be read only in an unlocked director session.
  async function saveMySignature(ctx, dataUrl) {
    if (ctx.isDirector) {
      if (!isUnlocked()) throw new Error('LOCKED');
      await lref(ctx, 'signatures/director').set(Object.assign(await sealJSON({ dataUrl }), { updatedAt: Date.now() }));
    } else if (ctx.isHead && ctx.workerId) {
      await lref(ctx, `signatures/workers/${keySafe(ctx.workerId)}`).set({ dataUrl, name: ctx.actorName, updatedAt: Date.now() });
    } else throw new Error('No signature slot for this account');
    audit(ctx, 'signature.uploaded');
  }
  async function loadMySignature(ctx) {
    if (ctx.isDirector) {
      const box = await val(lref(ctx, 'signatures/director'));
      if (!box) return { exists: false };
      if (!isUnlocked()) return { exists: true, locked: true };
      try { return { exists: true, dataUrl: (await openJSON(box)).dataUrl }; } catch (_) { return { exists: true, locked: true }; }
    }
    if (ctx.isHead && ctx.workerId) {
      const rec = await val(lref(ctx, `signatures/workers/${keySafe(ctx.workerId)}`));
      return rec ? { exists: true, dataUrl: rec.dataUrl } : { exists: false };
    }
    return { exists: false };
  }
  // Images for the signers of a letter, limited to what this session may see.
  async function signatureImages(ctx, doc) {
    const out = {};
    for (const s of doc.signers || []) {
      if (!s.signed || !s.key || out[s.key]) continue;
      try {
        if (s.key === 'director') {
          if (ctx.isDirector && isUnlocked()) { const box = await val(lref(ctx, 'signatures/director')); if (box) out[s.key] = (await openJSON(box)).dataUrl; }
        } else if (s.key.startsWith('worker:')) {
          const rec = await val(lref(ctx, `signatures/workers/${keySafe(s.key.slice(7))}`));
          if (rec?.dataUrl) out[s.key] = rec.dataUrl;
        }
      } catch (err) { console.warn('signature unavailable', err); }
    }
    return out;
  }
  function mySignerKey(ctx) { return ctx.isDirector ? 'director' : `worker:${ctx.workerId}`; }

  // ---------- audit ----------
  function audit(ctx, action, extra) {
    try {
      lref(ctx, 'audit').push(Object.assign({ at: Date.now(), action, actorId: ctx.actorId || '', actorName: ctx.actorName || '', role: ctx.role || '' }, extra || {}));
    } catch (err) { console.warn('audit failed', err); }
  }
  async function listAudit(ctx, limit) {
    if (!ctx.isDirector) return [];
    const snap = await lref(ctx, 'audit').limitToLast(limit || 60).once('value');
    return Object.values(snap.val() || {}).sort((a, b) => b.at - a.at);
  }

  // ---------- stats ----------
  function stats(rows, year) {
    const inYear = rows.filter((r) => !year || r.year === String(year));
    const byType = {};
    inYear.forEach((r) => { byType[r.typeId] = (byType[r.typeId] || 0) + 1; });
    return {
      total: inYear.length, byType,
      drafts: inYear.filter((r) => r.status === 'draft').length,
      awaiting: inYear.filter((r) => r.status === 'final').length,
      signed: inYear.filter((r) => r.status === 'signed' || r.status === 'filed').length,
      protectedCount: inYear.filter((r) => r.protected).length,
      minutes: inYear.filter((r) => r.mode === 'minutes').length,
    };
  }

  global.SomapLetters = {
    T, util: { esc, todayYMD, uid, clone, keySafe, initials, storageGet },
    resolveContext, lref, prefix,
    vault: { load: loadVault, create: createVault, unlock, lock, rewrap, recover, isUnlocked, remaining: unlockRemainingMs, onChange: onVaultChange },
    loadSettings, saveSettings, saveLetterhead, deleteLetterhead, defaultLetterheads,
    loadTypes, saveType, isProtectedType,
    listLetters, createLetter, saveLetter, openLetter, deleteLetter, pushVersion, summaryOf, canOpen, nextRefNo,
    saveMySignature, loadMySignature, signatureImages, mySignerKey,
    audit, listAudit, stats,
  };
})(window);
