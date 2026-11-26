// Campaigns and chunks.
//
// The browser splits a send into chunks of up to 200 messages it has ALREADY
// filled in (one message per phone). For each chunk the Worker:
//   1. re-checks every message: valid phone, no {placeholder} left, not empty,
//      not too long, not repeated in this send, not the same text to the same
//      phone in the last 24 h;
//   2. checks the school's daily limit;
//   3. reserves the SMS units from the wallet (atomic, with a ledger row);
//   4. makes ONE gateway call with a fixed Idempotency-Key (so a retry can never
//      send twice);
//   5. writes all results in one batch and refunds whatever was not used.
import core from '../../shared/sms_core.js';
import { HttpError } from './http.js';
import { bucketForMode, credit, debit, getBalance, getConfig, getSchoolSettings, getSender } from './db.js';
import { gatewayForKey, gatewayForMode } from './gateway/index.js';
import { eatDayStart, sha256Hex, uuidFromString } from './util.js';

export const MAX_CHUNK = 200;
export const MAX_PARTS_PER_MESSAGE = 6;
const PURPOSES = ['general', 'fee_reminder', 'invitation', 'other'];
const DAY = 24 * 3600 * 1000;

// SwalaSMS sender list, cached for 10 minutes per key kind (keeps sends fast).
let senderCache = { at: 0, kind: '', list: null };
async function gatewaySenders(env, mode) {
  const kind = mode === 'live' ? 'live' : 'test';
  if (senderCache.list && senderCache.kind === kind && Date.now() - senderCache.at < 10 * 60 * 1000) return senderCache.list;
  try {
    const r = await gatewayForKey(kind, env).senderIds();
    if (r && r.ok && Array.isArray(r.data)) { senderCache = { at: Date.now(), kind, list: r.data }; return r.data; }
  } catch (_) { /* fall back to the stored status */ }
  return null;
}
export function _resetSenderCacheForTests() { senderCache = { at: 0, kind: '', list: null }; }

/**
 * Which sender a school uses. Automatic switch: the school's OWN sender (e.g. SOCRATES)
 * as soon as SwalaSMS reports it approved + usable; otherwise the SoMAp fallback (UPDATE).
 */
export async function resolveSender(env, db, cfg, schoolId, mode) {
  const own = await getSender(db, schoolId);
  const requested = own && own.sender_id ? own.sender_id : null;
  if (requested) {
    let usable = Number(own.is_usable) === 1 && own.status === 'approved';
    if (mode !== 'dryrun') {
      const list = await gatewaySenders(env, mode);
      const hit = list && list.find((s) => String(s.sender_id || '').toUpperCase() === String(requested).toUpperCase());
      if (hit) {
        const nowUsable = hit.is_usable === true && String(hit.status) === 'approved';
        if (nowUsable !== usable || String(hit.status) !== String(own.status)) {
          await db.prepare('UPDATE school_senders SET status = ?2, is_usable = ?3, updated_at = ?4 WHERE school_id = ?1')
            .bind(schoolId, String(hit.status || ''), nowUsable ? 1 : 0, Date.now()).run();
        }
        usable = nowUsable;
      }
    }
    if (usable) return { senderId: requested, source: 'school', requested };
  }
  if (cfg.fallback_sender_id) return { senderId: cfg.fallback_sender_id, source: 'fallback', requested };
  if (mode === 'sandbox' && cfg.sandbox_sender_id) return { senderId: cfg.sandbox_sender_id, source: 'sandbox-test', requested };
  if (mode === 'dryrun') return { senderId: cfg.sandbox_sender_id || 'DRYRUN', source: 'dryrun', requested };
  return { senderId: '', source: 'none', requested };
}

/** Accepted school-name prefixes: "Mnyore Academy Dampo (MAP)" -> full name, "Mnyore Academy Dampo", "MAP". */
export function schoolPrefixes(name) {
  const full = String(name || '').replace(/\s+/g, ' ').trim();
  const noParen = full.replace(/\s*\([^)]*\)\s*/g, ' ').replace(/\s+/g, ' ').trim();
  const codes = Array.from(full.matchAll(/\(([^)]+)\)/g)).map((m) => m[1].trim());
  return Array.from(new Set([noParen, full, ...codes])).filter((s) => s.length >= 2);
}

/** Message starts with one of the school names (any case), followed by a non-letter. */
export function startsWithSchoolName(text, prefixes) {
  const t = String(text || '').trim().toLowerCase();
  return prefixes.some((p) => {
    const pl = p.toLowerCase();
    return t.startsWith(pl) && !/[a-z0-9]/.test(t.charAt(pl.length));
  });
}

/** When the school's own sender is not used (e.g. UPDATE), every message must start with the school name. */
async function prefixRuleFor(db, schoolId, senderId, mode) {
  if (mode === 'dryrun') return false; // nothing reaches parents in dry-run
  const own = await getSender(db, schoolId);
  const ownInUse = own && own.sender_id && own.sender_id === senderId && Number(own.is_usable) === 1;
  return !ownInUse;
}

const TOPUP_HINT = ' Wasiliana na SoMAp kununua SMS.';

export function assertCanSend(staff, settings) {
  if (!staff.belongs) {
    throw new HttpError(403, 'NOT_ALLOWED', 'Huna ruhusa ya kutuma SMS kwa shule hii.', `Not a member of this school (${staff.reason || 'unknown'}).`);
  }
  if (!settings.allowedRoles.includes(staff.role)) {
    throw new HttpError(403, 'ROLE_NOT_ALLOWED', `Nafasi yako (${staff.role || 'haijulikani'}) haina ruhusa ya kutuma SMS.`, `Role ${staff.role} may not send SMS.`);
  }
}

async function unitsUsedToday(db, schoolId, bucket) {
  const row = await db.prepare(
    `SELECT COALESCE(SUM(COALESCE(units, units_est)), 0) AS used FROM messages
     WHERE school_id = ?1 AND bucket = ?2 AND created_at >= ?3 AND status NOT IN ('failed', 'rejected')`
  ).bind(schoolId, bucket, eatDayStart()).first();
  return Number(row?.used || 0);
}

export async function startCampaign(env, staff, body) {
  const db = env.DB;
  const cfg = await getConfig(db);
  const settings = await getSchoolSettings(db, staff.schoolId);
  assertCanSend(staff, settings);
  const mode = cfg.mode;
  if (mode === 'live' && String(env.LIVE_ENABLED) !== 'true') {
    throw new HttpError(403, 'LIVE_LOCKED', 'Utumaji halisi umefungwa kwa sasa.', 'Live sending is locked.');
  }
  const purpose = PURPOSES.includes(body.purpose) ? body.purpose : 'other';
  const estRecipients = Math.max(0, Math.floor(Number(body.estimatedRecipients) || 0));
  const estUnits = Math.max(0, Math.floor(Number(body.estimatedUnits) || 0));
  const sender = await resolveSender(env, db, cfg, staff.schoolId, mode);
  if (!sender.senderId) {
    throw new HttpError(409, 'NO_SENDER', 'Jina la mtumaji (Sender ID) la shule bado halijaidhinishwa. Huwezi kutuma kwa wazazi bado.', 'This school has no approved, usable Sender ID and no fallback sender is set.');
  }
  if (settings.approvalAbove > 0 && estUnits > settings.approvalAbove) {
    throw new HttpError(409, 'NEEDS_APPROVAL', `Ujumbe huu unahitaji SMS ${estUnits}, zaidi ya kikomo cha idhini (${settings.approvalAbove}).`, 'Campaign is above the approval threshold.');
  }
  const bucket = bucketForMode(mode);
  const balance = await getBalance(db, staff.schoolId, bucket);
  if (estUnits > balance) {
    throw new HttpError(402, 'INSUFFICIENT_BALANCE', `Salio halitoshi: unahitaji SMS ${estUnits}, salio ni ${balance}.${TOPUP_HINT}`, 'Not enough SMS credits.', { required: estUnits, balance });
  }
  const used = await unitsUsedToday(db, staff.schoolId, bucket);
  if (used + estUnits > settings.dailyLimit) {
    throw new HttpError(429, 'DAILY_LIMIT', `Kikomo cha leo ni SMS ${settings.dailyLimit}; zimeshatumika ${used}.`, 'Daily limit would be exceeded.', { dailyLimit: settings.dailyLimit, usedToday: used });
  }
  const id = crypto.randomUUID();
  const t = Date.now();
  const name = String(body.name || '').slice(0, 120) || `${purpose} ${new Date(t).toISOString().slice(0, 10)}`;
  await db.prepare(
    `INSERT INTO campaigns (id, school_id, bucket, mode, purpose, name, sender_id, created_by, created_role, status, est_recipients, est_units, created_at, updated_at)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, 'open', ?10, ?11, ?12, ?12)`
  ).bind(id, staff.schoolId, bucket, mode, purpose, name, sender.senderId, staff.email, staff.role, estRecipients, estUnits, t).run();
  const prefixRequired = sender.source !== 'school';
  return { ok: true, campaignId: id, mode, bucket, senderId: sender.senderId, senderSource: sender.source, prefixRequired, schoolPrefixes: prefixRequired ? schoolPrefixes(staff.schoolName) : [], walletBalance: balance, dailyLimit: settings.dailyLimit, usedToday: used, maxChunk: MAX_CHUNK };
}

function validateItems(items, prefixes) {
  if (!Array.isArray(items) || items.length < 1 || items.length > MAX_CHUNK) {
    throw new HttpError(400, 'BAD_CHUNK', `Kila kifurushi kiwe na ujumbe 1 hadi ${MAX_CHUNK}.`, `items must have 1..${MAX_CHUNK} entries.`);
  }
  const seen = new Set();
  const accepted = [];
  const rejected = [];
  items.forEach((item, index) => {
    const text = typeof item?.text === 'string' ? item.text.trim() : '';
    const phone = core.normalizeTzPhone(item?.phone);
    const ref = item?.ref === undefined || item?.ref === null ? null : String(item.ref).slice(0, 120);
    const reject = (reason) => rejected.push({ index, phone: phone.msisdn || String(item?.phone || ''), reason, ref });
    if (phone.status !== 'VALID') return reject(phone.status === 'MISSING' ? 'PHONE_MISSING' : 'PHONE_INVALID');
    if (!text) return reject('EMPTY_MESSAGE');
    if (core.hasUnfilledPlaceholder(text)) return reject('PLACEHOLDER_UNFILLED');
    if (prefixes && !startsWithSchoolName(text, prefixes)) return reject('SCHOOL_NAME_MISSING');
    if (text.length > 1600) return reject('TOO_LONG');
    const parts = core.countSmsParts(text).parts;
    if (parts > MAX_PARTS_PER_MESSAGE) return reject('TOO_MANY_PARTS');
    if (seen.has(phone.msisdn)) return reject('DUPLICATE_IN_SEND');
    seen.add(phone.msisdn);
    accepted.push({ index, msisdn: phone.msisdn, text, parts, ref });
  });
  return { accepted, rejected };
}

async function loadChunk(db, campaignId, chunkIndex) {
  return db.prepare('SELECT * FROM chunks WHERE campaign_id = ?1 AND chunk_index = ?2').bind(campaignId, chunkIndex).first();
}

export async function sendChunk(env, staff, body) {
  const db = env.DB;
  const settings = await getSchoolSettings(db, staff.schoolId);
  assertCanSend(staff, settings);
  const campaignId = String(body.campaignId || '');
  const chunkIndex = Number(body.chunkIndex);
  if (!Number.isInteger(chunkIndex) || chunkIndex < 0 || chunkIndex > 100000) throw new HttpError(400, 'BAD_CHUNK_INDEX', 'Namba ya kifurushi si sahihi.', 'chunkIndex must be a non-negative integer.');
  const campaign = await db.prepare('SELECT * FROM campaigns WHERE id = ?1 AND school_id = ?2').bind(campaignId, staff.schoolId).first();
  if (!campaign) throw new HttpError(404, 'NO_CAMPAIGN', 'Kampeni haipo.', 'Campaign not found for this school.');
  if (campaign.created_by !== staff.email) throw new HttpError(403, 'NOT_YOUR_CAMPAIGN', 'Kampeni hii imeanzishwa na mtu mwingine.', 'Only the creator can send this campaign.');

  // Already handled? Return the stored answer (no second send, no second charge).
  let chunk = await loadChunk(db, campaignId, chunkIndex);
  if (chunk && (chunk.status === 'done' || chunk.status === 'failed')) {
    return { ...JSON.parse(chunk.result || '{}'), replay: true };
  }

  const cfg = await getConfig(db);
  if (campaign.status !== 'open' && !chunk) throw new HttpError(409, 'CAMPAIGN_CLOSED', 'Kampeni imeshafungwa.', 'Campaign is closed.');
  if (cfg.mode !== campaign.mode && !chunk) {
    await db.prepare("UPDATE campaigns SET status = 'closed', updated_at = ?2 WHERE id = ?1").bind(campaignId, Date.now()).run();
    throw new HttpError(409, 'MODE_CHANGED', 'Hali ya mfumo imebadilika (dry-run/sandbox/live). Anza upya.', 'System mode changed since the campaign started; start again.');
  }
  const bucket = campaign.bucket;
  let rejected = [];
  let reserved = 0;

  if (!chunk) {
    const prefixes = (await prefixRuleFor(db, staff.schoolId, campaign.sender_id, campaign.mode)) ? schoolPrefixes(staff.schoolName) : null;
    const v = validateItems(body.items, prefixes);
    rejected = v.rejected;
    let accepted = v.accepted;
    const t = Date.now();

    if (accepted.length) {
      const phones = JSON.stringify(accepted.map((a) => a.msisdn));
      // Not twice in the same campaign (earlier chunks), unless that one failed.
      const inCampaign = await db.prepare(
        `SELECT DISTINCT msisdn FROM messages WHERE campaign_id = ?1 AND status NOT IN ('failed', 'rejected') AND msisdn IN (SELECT value FROM json_each(?2))`
      ).bind(campaignId, phones).all();
      const dupCampaign = new Set((inCampaign.results || []).map((r) => r.msisdn));
      // Same text to the same phone in the last 24 hours.
      const recent = await db.prepare(
        `SELECT msisdn, text_hash FROM messages WHERE school_id = ?1 AND bucket = ?2 AND created_at > ?3 AND status NOT IN ('failed', 'rejected')
         AND msisdn IN (SELECT value FROM json_each(?4))`
      ).bind(staff.schoolId, bucket, t - DAY, phones).all();
      const recentSet = new Set((recent.results || []).map((r) => `${r.msisdn}|${r.text_hash}`));
      const kept = [];
      for (const a of accepted) {
        a.hash = await sha256Hex(a.text);
        if (dupCampaign.has(a.msisdn)) rejected.push({ index: a.index, phone: a.msisdn, reason: 'DUPLICATE_IN_SEND', ref: a.ref });
        else if (recentSet.has(`${a.msisdn}|${a.hash}`)) rejected.push({ index: a.index, phone: a.msisdn, reason: 'DUPLICATE_24H', ref: a.ref });
        else kept.push(a);
      }
      accepted = kept;
    }

    reserved = accepted.reduce((s, a) => s + a.parts, 0);
    if (reserved > 0) {
      const used = await unitsUsedToday(db, staff.schoolId, bucket);
      if (used + reserved > settings.dailyLimit) {
        throw new HttpError(429, 'DAILY_LIMIT', `Kikomo cha leo ni SMS ${settings.dailyLimit}; zimeshatumika ${used}.`, 'Daily limit would be exceeded.', { dailyLimit: settings.dailyLimit, usedToday: used, needed: reserved });
      }
      const d = await debit(db, { schoolId: staff.schoolId, bucket, units: reserved, kind: 'reserve', ref: `${campaignId}#${chunkIndex}`, actor: staff.email });
      if (!d.ok) {
        throw new HttpError(402, 'INSUFFICIENT_BALANCE', `Salio halitoshi: unahitaji SMS ${reserved}, salio ni ${d.balance}.${TOPUP_HINT}`, 'Not enough SMS credits.', { required: reserved, balance: d.balance });
      }
    }

    const idemKey = await uuidFromString(`somap-sms:${campaignId}:${chunkIndex}`);
    const rows = accepted.map((a) => ({ id: crypto.randomUUID(), item: a.index, msisdn: a.msisdn, text: a.text, hash: a.hash, ref: a.ref, est: a.parts }));
    const rejRows = rejected.map((r) => ({ id: crypto.randomUUID(), item: r.index, msisdn: r.phone || null, ref: r.ref || null, reason: r.reason }));
    const status = accepted.length ? 'reserved' : 'done';
    try {
      await db.batch([
        db.prepare(
          `INSERT INTO chunks (campaign_id, chunk_index, school_id, idem_key, status, units_reserved, item_count, created_at, updated_at)
           VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?8)`
        ).bind(campaignId, chunkIndex, staff.schoolId, idemKey, status, reserved, accepted.length + rejected.length, t),
        db.prepare(
          `INSERT INTO messages (id, campaign_id, chunk_index, item_index, school_id, bucket, msisdn, text, text_hash, ref, units_est, status, created_at, updated_at)
           SELECT json_extract(value, '$.id'), ?1, ?2, json_extract(value, '$.item'), ?3, ?4, json_extract(value, '$.msisdn'), json_extract(value, '$.text'),
                  json_extract(value, '$.hash'), json_extract(value, '$.ref'), json_extract(value, '$.est'), 'pending', ?5, ?5
           FROM json_each(?6)`
        ).bind(campaignId, chunkIndex, staff.schoolId, bucket, t, JSON.stringify(rows)),
        db.prepare(
          `INSERT INTO messages (id, campaign_id, chunk_index, item_index, school_id, bucket, msisdn, ref, units_est, units, status, failure_reason, created_at, updated_at)
           SELECT json_extract(value, '$.id'), ?1, ?2, json_extract(value, '$.item'), ?3, ?4, json_extract(value, '$.msisdn'), json_extract(value, '$.ref'),
                  0, 0, 'rejected', json_extract(value, '$.reason'), ?5, ?5
           FROM json_each(?6)`
        ).bind(campaignId, chunkIndex, staff.schoolId, bucket, t, JSON.stringify(rejRows)),
      ]);
    } catch (err) {
      // Someone sent the same chunk at the same moment: give the units back.
      if (reserved > 0) await credit(db, { schoolId: staff.schoolId, bucket, units: reserved, kind: 'refund', ref: `${campaignId}#${chunkIndex}`, note: 'concurrent duplicate chunk', actor: staff.email });
      throw new HttpError(409, 'CHUNK_IN_PROGRESS', 'Kifurushi hiki kinatumwa tayari. Subiri kidogo kisha jaribu tena.', 'This chunk is already being processed; retry shortly.');
    }
    if (!accepted.length) {
      const result = summarise({ campaignId, chunkIndex, status: 'done', rejected, results: [], reserved: 0, used: 0, balance: await getBalance(db, staff.schoolId, bucket), mode: campaign.mode });
      await db.prepare('UPDATE chunks SET result = ?3 WHERE campaign_id = ?1 AND chunk_index = ?2').bind(campaignId, chunkIndex, JSON.stringify(result)).run();
      return result;
    }
    chunk = await loadChunk(db, campaignId, chunkIndex);
  }

  return dispatchChunk(env, staff, campaign, chunk);
}

/** Calls the gateway for a reserved/unknown chunk and settles the wallet. */
async function dispatchChunk(env, staff, campaign, chunk) {
  const db = env.DB;
  const { results: pending } = await db.prepare(
    `SELECT id, item_index, msisdn, text, units_est, ref FROM messages WHERE campaign_id = ?1 AND chunk_index = ?2 AND status IN ('pending', 'unknown') ORDER BY item_index`
  ).bind(chunk.campaign_id, chunk.chunk_index).all();
  const { results: rejectedRows } = await db.prepare(
    `SELECT item_index, msisdn, ref, failure_reason FROM messages WHERE campaign_id = ?1 AND chunk_index = ?2 AND status = 'rejected' ORDER BY item_index`
  ).bind(chunk.campaign_id, chunk.chunk_index).all();
  const rejected = (rejectedRows || []).map((r) => ({ index: r.item_index, phone: r.msisdn, reason: r.failure_reason, ref: r.ref }));

  const gateway = gatewayForMode(campaign.mode, env);
  const res = await gateway.sendBulk({
    senderId: campaign.sender_id,
    items: pending.map((p) => ({ msisdn: p.msisdn, text: p.text })),
    campaignName: `${campaign.school_id} ${campaign.name}`,
    idempotencyKey: chunk.idem_key,
  });
  const t = Date.now();
  const bucket = campaign.bucket;
  const ref = `${chunk.campaign_id}#${chunk.chunk_index}`;

  if (!res.accepted && res.certainty === 'unknown') {
    await db.batch([
      db.prepare("UPDATE chunks SET status = 'unknown', updated_at = ?3 WHERE campaign_id = ?1 AND chunk_index = ?2").bind(chunk.campaign_id, chunk.chunk_index, t),
      db.prepare("UPDATE messages SET status = 'unknown', failure_reason = ?3, updated_at = ?4 WHERE campaign_id = ?1 AND chunk_index = ?2 AND status = 'pending'")
        .bind(chunk.campaign_id, chunk.chunk_index, res.code, t),
    ]);
    return { ok: false, retry: true, campaignId: chunk.campaign_id, chunkIndex: chunk.chunk_index, status: 'unknown', code: res.code,
      message: 'Hatujapata jibu la uhakika kutoka kwa mtoa huduma. Bonyeza "Jaribu tena" — hakuna SMS itakayotumwa mara mbili.',
      messageEn: 'Gateway answer unknown. Retry this chunk; the idempotency key prevents double sending.' };
  }

  const results = [];
  if (!res.accepted) {
    pending.forEach((p) => results.push({ id: p.id, index: p.item_index, msisdn: p.msisdn, status: 'failed', units: 0, uid: null, reason: `${res.code}: ${res.message}`, ref: p.ref }));
  } else {
    pending.forEach((p) => {
      const ok = res.results.get(p.msisdn);
      const fail = res.failures.get(p.msisdn);
      if (ok) results.push({ id: p.id, index: p.item_index, msisdn: p.msisdn, status: ok.status, units: ok.units === null ? p.units_est : ok.units, uid: ok.uid, reason: null, ref: p.ref });
      else if (fail) results.push({ id: p.id, index: p.item_index, msisdn: p.msisdn, status: 'failed', units: 0, uid: null, reason: fail, ref: p.ref });
      else results.push({ id: p.id, index: p.item_index, msisdn: p.msisdn, status: 'unknown', units: p.units_est, uid: null, reason: 'NOT_IN_GATEWAY_RESPONSE', ref: p.ref });
    });
  }
  const used = results.reduce((s, r) => s + (r.status === 'failed' ? 0 : Number(r.units) || 0), 0);
  const reserved = Number(chunk.units_reserved) || 0;
  const sentCount = results.filter((r) => r.status !== 'failed').length;
  const failedCount = results.length - sentCount;
  const chunkStatus = res.accepted ? 'done' : 'failed';

  await db.batch([
    db.prepare(
      `UPDATE messages SET status = json_extract(u.value, '$.status'), units = json_extract(u.value, '$.units'), gateway_uid = json_extract(u.value, '$.uid'),
         failure_reason = json_extract(u.value, '$.reason'), updated_at = ?1
       FROM (SELECT value FROM json_each(?2)) AS u WHERE messages.id = json_extract(u.value, '$.id')`
    ).bind(t, JSON.stringify(results.map((r) => ({ id: r.id, status: r.status, units: r.units, uid: r.uid, reason: r.reason })))),
    db.prepare('UPDATE campaigns SET sent_count = sent_count + ?2, failed_count = failed_count + ?3, units_used = units_used + ?4, updated_at = ?5 WHERE id = ?1')
      .bind(chunk.campaign_id, sentCount, failedCount, used, t),
  ]);

  if (used < reserved) {
    await credit(db, { schoolId: campaign.school_id, bucket, units: reserved - used, kind: 'refund', ref, note: `${failedCount} failed / recount`, actor: staff.email });
  } else if (used > reserved) {
    const extra = await debit(db, { schoolId: campaign.school_id, bucket, units: used - reserved, kind: 'reserve', ref, note: 'gateway counted more parts', actor: staff.email });
    if (!extra.ok) {
      await db.prepare('INSERT INTO ledger (school_id, bucket, delta, balance_after, kind, ref, note, actor, created_at) VALUES (?1, ?2, 0, ?3, ?4, ?5, ?6, ?7, ?8)')
        .bind(campaign.school_id, bucket, extra.balance, 'shortfall', ref, `gateway used ${used - reserved} more units than reserved`, staff.email, t).run();
    }
  }
  const balance = await getBalance(db, campaign.school_id, bucket);
  const result = summarise({ campaignId: chunk.campaign_id, chunkIndex: chunk.chunk_index, status: chunkStatus, rejected, results, reserved, used, balance, mode: campaign.mode,
    gatewayError: res.accepted ? null : { code: res.code, message: res.message } });
  await db.prepare('UPDATE chunks SET status = ?3, units_used = ?4, result = ?5, updated_at = ?6 WHERE campaign_id = ?1 AND chunk_index = ?2')
    .bind(chunk.campaign_id, chunk.chunk_index, chunkStatus, used, JSON.stringify(result), t).run();
  return result;
}

function summarise({ campaignId, chunkIndex, status, rejected, results, reserved, used, balance, mode, gatewayError }) {
  return {
    ok: status === 'done',
    campaignId,
    chunkIndex,
    status,
    mode,
    sent: results.filter((r) => r.status !== 'failed').length,
    failed: results.filter((r) => r.status === 'failed').length,
    rejectedCount: rejected.length,
    unitsReserved: reserved,
    unitsUsed: used,
    walletBalance: balance,
    results: results.map((r) => ({ index: r.index, phone: r.msisdn, status: r.status, units: r.units, reason: r.reason, ref: r.ref })),
    rejected: rejected.sort((a, b) => a.index - b.index),
    gatewayError: gatewayError || null,
    replay: false,
  };
}

export async function finishCampaign(env, staff, body) {
  const r = await env.DB.prepare("UPDATE campaigns SET status = 'closed', updated_at = ?3 WHERE id = ?1 AND school_id = ?2 AND created_by = ?4")
    .bind(String(body.campaignId || ''), staff.schoolId, Date.now(), staff.email).run();
  return { ok: Number(r.meta?.changes || 0) === 1 };
}

export async function listCampaigns(env, staff) {
  const { results } = await env.DB.prepare(
    `SELECT id, mode, purpose, name, sender_id, created_by, status, est_recipients, sent_count, failed_count, units_used, created_at
     FROM campaigns WHERE school_id = ?1 ORDER BY created_at DESC LIMIT 50`
  ).bind(staff.schoolId).all();
  return { ok: true, campaigns: results || [] };
}

export async function getCampaign(env, staff, id) {
  const campaign = await env.DB.prepare('SELECT * FROM campaigns WHERE id = ?1 AND school_id = ?2').bind(id, staff.schoolId).first();
  if (!campaign) throw new HttpError(404, 'NO_CAMPAIGN', 'Kampeni haipo.', 'Campaign not found.');
  const { results } = await env.DB.prepare(
    `SELECT chunk_index, item_index, msisdn, text, ref, units, units_est, status, failure_reason, created_at, updated_at
     FROM messages WHERE campaign_id = ?1 ORDER BY chunk_index, item_index LIMIT 5000`
  ).bind(id).all();
  return { ok: true, campaign, messages: results || [] };
}
