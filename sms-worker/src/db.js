// D1 access: config, school settings, wallets + ledger.
// Wallet rule: every change is ONE atomic batch = the balance update + its ledger row.
import { HttpError } from './http.js';

export const DEFAULT_SETTINGS = { allowedRoles: ['admin', 'accountant'], dailyLimit: 1000, approvalAbove: 0, pricePerSms: null };

export async function getConfig(db) {
  const { results } = await db.prepare('SELECT key, value FROM config').all();
  const cfg = { mode: 'dryrun', active_gateway: 'swalasms', fallback_sender_id: '', sandbox_sender_id: '', buy_price_per_sms: '13' };
  (results || []).forEach((r) => { cfg[r.key] = r.value; });
  return cfg;
}

export async function setConfig(db, entries, actor) {
  const t = Date.now();
  const stmts = Object.entries(entries).map(([k, v]) =>
    db.prepare('INSERT INTO config (key, value, updated_at, updated_by) VALUES (?1, ?2, ?3, ?4) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at, updated_by = excluded.updated_by')
      .bind(k, String(v), t, actor));
  if (stmts.length) await db.batch(stmts);
}

export async function getSchoolSettings(db, schoolId) {
  const row = await db.prepare('SELECT * FROM school_settings WHERE school_id = ?1').bind(schoolId).first();
  if (!row) return { ...DEFAULT_SETTINGS, allowedRoles: [...DEFAULT_SETTINGS.allowedRoles] };
  let roles = DEFAULT_SETTINGS.allowedRoles;
  try { roles = JSON.parse(row.allowed_roles); } catch (_) { /* keep default */ }
  return { allowedRoles: Array.isArray(roles) ? roles : DEFAULT_SETTINGS.allowedRoles, dailyLimit: Number(row.daily_limit), approvalAbove: Number(row.approval_above) || 0, pricePerSms: row.price_per_sms === null ? null : Number(row.price_per_sms) };
}

export async function saveSchoolSettings(db, schoolId, s, actor) {
  await db.prepare(
    `INSERT INTO school_settings (school_id, allowed_roles, daily_limit, approval_above, price_per_sms, updated_at, updated_by)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
     ON CONFLICT(school_id) DO UPDATE SET allowed_roles = excluded.allowed_roles, daily_limit = excluded.daily_limit,
       approval_above = excluded.approval_above, price_per_sms = excluded.price_per_sms, updated_at = excluded.updated_at, updated_by = excluded.updated_by`
  ).bind(schoolId, JSON.stringify(s.allowedRoles), s.dailyLimit, s.approvalAbove, s.pricePerSms, Date.now(), actor).run();
}

export async function getSender(db, schoolId) {
  return db.prepare('SELECT sender_id, status, is_usable FROM school_senders WHERE school_id = ?1').bind(schoolId).first();
}

export async function getBalance(db, schoolId, bucket) {
  const row = await db.prepare('SELECT balance FROM wallets WHERE school_id = ?1 AND bucket = ?2').bind(schoolId, bucket).first();
  return row ? Number(row.balance) : 0;
}

function ensureWallet(db, schoolId, bucket, t) {
  return db.prepare('INSERT OR IGNORE INTO wallets (school_id, bucket, balance, updated_at) VALUES (?1, ?2, 0, ?3)').bind(schoolId, bucket, t);
}

/** Take `units` from the wallet only if enough is there. Returns { ok, balance }. */
export async function debit(db, { schoolId, bucket, units, kind, ref, note, actor }) {
  const t = Date.now();
  const res = await db.batch([
    ensureWallet(db, schoolId, bucket, t),
    db.prepare('UPDATE wallets SET balance = balance - ?1, updated_at = ?2 WHERE school_id = ?3 AND bucket = ?4 AND balance >= ?1').bind(units, t, schoolId, bucket),
    db.prepare(
      `INSERT INTO ledger (school_id, bucket, delta, balance_after, kind, ref, note, actor, created_at)
       SELECT ?1, ?2, ?3, balance, ?4, ?5, ?6, ?7, ?8 FROM wallets WHERE school_id = ?1 AND bucket = ?2 AND changes() = 1`
    ).bind(schoolId, bucket, -units, kind, ref || null, note || null, actor || null, t),
  ]);
  const ok = Number(res[1]?.meta?.changes || 0) === 1;
  return { ok, balance: await getBalance(db, schoolId, bucket) };
}

/** Add `units` (refund, top-up, adjustment). */
export async function credit(db, { schoolId, bucket, units, kind, ref, note, actor }) {
  if (!(units > 0)) return { ok: true, balance: await getBalance(db, schoolId, bucket) };
  const t = Date.now();
  await db.batch([
    ensureWallet(db, schoolId, bucket, t),
    db.prepare('UPDATE wallets SET balance = balance + ?1, updated_at = ?2 WHERE school_id = ?3 AND bucket = ?4').bind(units, t, schoolId, bucket),
    db.prepare(
      `INSERT INTO ledger (school_id, bucket, delta, balance_after, kind, ref, note, actor, created_at)
       SELECT ?1, ?2, ?3, balance, ?4, ?5, ?6, ?7, ?8 FROM wallets WHERE school_id = ?1 AND bucket = ?2`
    ).bind(schoolId, bucket, units, kind, ref || null, note || null, actor || null, t),
  ]);
  return { ok: true, balance: await getBalance(db, schoolId, bucket) };
}

export function bucketForMode(mode) {
  return mode === 'live' ? 'live' : 'test';
}

export function assertInt(v, name, min, max) {
  const n = Number(v);
  if (!Number.isInteger(n) || n < min || n > max) {
    throw new HttpError(400, 'BAD_INPUT', `Thamani ya ${name} si sahihi.`, `${name} must be an integer between ${min} and ${max}.`);
  }
  return n;
}
