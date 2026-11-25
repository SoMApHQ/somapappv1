// HQ-only endpoints (email must be in the HQ_EMAILS secret).
import core from '../../shared/sms_core.js';
import { HttpError } from './http.js';
import { credit, debit, getConfig, getSchoolSettings, saveSchoolSettings, setConfig, assertInt } from './db.js';
import { gatewayForKey, MODES } from './gateway/index.js';
import { isSafeKey, normalizeRole, splitList } from './util.js';

const DAY = 24 * 3600 * 1000;

export function assertHq(staff) {
  if (!staff.isHq) throw new HttpError(403, 'HQ_ONLY', 'Ukurasa huu ni wa SoMAp HQ tu.', 'HQ only.');
}

export async function overview(env, fb) {
  const db = env.DB;
  const cfg = await getConfig(db);
  const schoolsShallow = (await fb.get('schools', { shallow: true })) || {};
  const ids = Array.from(new Set(['socrates-school', ...Object.keys(schoolsShallow)]));
  const since30 = Date.now() - 30 * DAY;
  const [wallets, senders, usage, settings] = await Promise.all([
    db.prepare('SELECT school_id, bucket, balance FROM wallets').all(),
    db.prepare('SELECT * FROM school_senders').all(),
    db.prepare(
      `SELECT school_id, bucket, COUNT(*) AS messages, COALESCE(SUM(units), 0) AS units FROM messages
       WHERE created_at >= ?1 AND status NOT IN ('failed', 'rejected', 'pending') GROUP BY school_id, bucket`
    ).bind(since30).all(),
    db.prepare('SELECT school_id FROM school_settings').all(),
  ]);
  const schools = [];
  for (const id of ids) {
    const meta = (await fb.get(`schools/${id}/meta`)) || {};
    const w = (b) => Number((wallets.results || []).find((r) => r.school_id === id && r.bucket === b)?.balance || 0);
    const u = (b) => (usage.results || []).find((r) => r.school_id === id && r.bucket === b) || { messages: 0, units: 0 };
    const sender = (senders.results || []).find((r) => r.school_id === id) || null;
    const live30 = Number(u('live').units || 0);
    schools.push({
      schoolId: id,
      name: meta.name || meta.schoolName || id,
      wallet: { test: w('test'), live: w('live') },
      last30Days: { liveUnits: live30, testUnits: Number(u('test').units || 0) },
      sender,
      senderWarning: sender && sender.status === 'approved' && live30 < 100 ? 'Chini ya SMS 100 ndani ya siku 30: Sender ID inaweza kusimamishwa.' : null,
      settings: await getSchoolSettings(db, id),
      hasCustomSettings: (settings.results || []).some((r) => r.school_id === id),
    });
  }
  return { ok: true, config: cfg, liveEnabled: String(env.LIVE_ENABLED) === 'true', schools };
}

export async function updateConfig(env, staff, body) {
  const entries = {};
  if (body.mode !== undefined) {
    if (!MODES.includes(body.mode)) throw new HttpError(400, 'BAD_MODE', 'Hali si sahihi.', 'mode must be dryrun, sandbox or live.');
    if (body.mode === 'live' && String(env.LIVE_ENABLED) !== 'true') {
      throw new HttpError(403, 'LIVE_LOCKED', 'Live imefungwa katika awamu hii (LIVE_ENABLED=false).', 'Live is locked in this phase.');
    }
    entries.mode = body.mode;
  }
  for (const k of ['fallbackSenderId', 'sandboxSenderId']) {
    if (body[k] !== undefined) {
      const v = String(body[k] || '').trim();
      if (v && !/^[A-Za-z0-9 ]{3,11}$/.test(v)) throw new HttpError(400, 'BAD_SENDER', 'Jina la mtumaji liwe herufi/namba 3-11.', 'Sender ID must be 3-11 letters/digits.');
      entries[k === 'fallbackSenderId' ? 'fallback_sender_id' : 'sandbox_sender_id'] = v;
    }
  }
  if (body.buyPricePerSms !== undefined) entries.buy_price_per_sms = assertInt(body.buyPricePerSms, 'buyPricePerSms', 0, 1000);
  await setConfig(env.DB, entries, staff.email);
  return { ok: true, config: await getConfig(env.DB) };
}

export async function updateSchoolSettings(env, staff, body, fb) {
  const schoolId = String(body.schoolId || '');
  if (!isSafeKey(schoolId)) throw new HttpError(400, 'BAD_SCHOOL', 'Shule si sahihi.', 'Invalid schoolId.');
  if (schoolId !== 'socrates-school' && !(await fb.get(`schools/${schoolId}`, { shallow: true }))) throw new HttpError(404, 'UNKNOWN_SCHOOL', 'Shule haipo.', 'Unknown school.');
  const s = await getSchoolSettings(env.DB, schoolId);
  if (body.allowedRoles !== undefined) {
    const roles = (Array.isArray(body.allowedRoles) ? body.allowedRoles : splitList(body.allowedRoles)).map(normalizeRole).filter(Boolean);
    if (!roles.length) throw new HttpError(400, 'BAD_ROLES', 'Weka angalau nafasi moja.', 'At least one role is required.');
    s.allowedRoles = Array.from(new Set(roles));
  }
  if (body.dailyLimit !== undefined) s.dailyLimit = assertInt(body.dailyLimit, 'dailyLimit', 0, 1000000);
  if (body.approvalAbove !== undefined) s.approvalAbove = assertInt(body.approvalAbove, 'approvalAbove', 0, 1000000);
  if (body.pricePerSms !== undefined) s.pricePerSms = body.pricePerSms === null ? null : assertInt(body.pricePerSms, 'pricePerSms', 0, 1000);
  await saveSchoolSettings(env.DB, schoolId, s, staff.email);
  return { ok: true, schoolId, settings: s };
}

/** Phase 2: only the TEST wallet can be adjusted (live wallets come with buying in Phase 5). */
export async function adjustWallet(env, staff, body, fb) {
  const schoolId = String(body.schoolId || '');
  if (!isSafeKey(schoolId)) throw new HttpError(400, 'BAD_SCHOOL', 'Shule si sahihi.', 'Invalid schoolId.');
  if (schoolId !== 'socrates-school' && !(await fb.get(`schools/${schoolId}`, { shallow: true }))) throw new HttpError(404, 'UNKNOWN_SCHOOL', 'Shule haipo.', 'Unknown school.');
  if (body.bucket !== 'test') throw new HttpError(403, 'TEST_WALLET_ONLY', 'Kwa sasa ni salio la majaribio tu linaloweza kubadilishwa.', 'Only the test wallet can be adjusted in this phase.');
  const units = assertInt(body.units, 'units', -1000000, 1000000);
  if (units === 0) throw new HttpError(400, 'BAD_INPUT', 'Weka idadi isiyo sifuri.', 'units must not be 0.');
  const note = String(body.note || '').slice(0, 200) || 'HQ adjustment';
  const r = units > 0
    ? await credit(env.DB, { schoolId, bucket: 'test', units, kind: 'adjust', note, actor: staff.email })
    : await debit(env.DB, { schoolId, bucket: 'test', units: -units, kind: 'adjust', note, actor: staff.email });
  if (!r.ok) throw new HttpError(409, 'INSUFFICIENT_BALANCE', 'Salio halitoshi kupunguza kiasi hicho.', 'Balance too low for that reduction.');
  return { ok: true, schoolId, bucket: 'test', balance: r.balance };
}

export async function gatewayInfo(env, kind, what, uid) {
  const gw = gatewayForKey(kind === 'live' ? 'live' : 'test', env);
  if (what === 'balance') return gw.balance();
  if (what === 'sender-ids') return gw.senderIds();
  if (what === 'message') {
    if (!/^[0-9a-fA-F-]{36}$/.test(String(uid || ''))) throw new HttpError(400, 'BAD_UID', 'UID si sahihi.', 'uid must be a UUID.');
    return gw.message(uid);
  }
  throw new HttpError(404, 'NOT_FOUND', 'Haipo.', 'Unknown gateway info.');
}

/**
 * ONE real SMS with the LIVE key, only to numbers in the HQ_TEST_NUMBERS secret,
 * max 160 characters, at most one per minute. Schools stay in dry-run/sandbox.
 */
export async function pipeTest(env, staff, body) {
  const phone = core.normalizeTzPhone(body.to);
  const allowed = splitList(env.HQ_TEST_NUMBERS).map((n) => core.normalizeTzPhone(n).msisdn).filter(Boolean);
  if (phone.status !== 'VALID' || !allowed.includes(phone.msisdn)) {
    throw new HttpError(403, 'NOT_A_TEST_NUMBER', 'Namba hii haiko kwenye orodha ya namba za majaribio za HQ.', 'Number is not in HQ_TEST_NUMBERS.');
  }
  const senderId = String(body.senderId || '').trim();
  if (!/^[A-Za-z0-9 ]{3,11}$/.test(senderId)) throw new HttpError(400, 'BAD_SENDER', 'Andika jina la mtumaji wa majaribio (herufi 3-11).', 'senderId required (3-11 chars).');
  const text = core.cleanText(body.text || '');
  const count = core.countSmsParts(text);
  if (!text || count.parts !== 1 || core.hasUnfilledPlaceholder(text)) {
    throw new HttpError(400, 'BAD_TEXT', 'Ujumbe wa majaribio uwe SMS 1 (herufi 160 au chini) bila { }.', 'Test text must be exactly one SMS part with no braces.');
  }
  const recent = await env.DB.prepare('SELECT COUNT(*) AS n FROM pipe_tests WHERE created_at > ?1').bind(Date.now() - 60 * 1000).first();
  if (Number(recent?.n || 0) > 0) throw new HttpError(429, 'WAIT', 'Subiri dakika 1 kabla ya jaribio jingine.', 'One pipe test per minute.');

  const gw = gatewayForKey('live', env); // fails early (NO_LIVE_KEY) before anything is recorded
  const id = crypto.randomUUID();
  await env.DB.prepare("INSERT INTO pipe_tests (id, actor, msisdn, sender_id, text, status, created_at) VALUES (?1, ?2, ?3, ?4, ?5, 'sending', ?6)")
    .bind(id, staff.email, phone.msisdn, senderId, text, Date.now()).run();
  const res = await gw.sendOne({ senderId, msisdn: phone.msisdn, text, idempotencyKey: id });
  await env.DB.prepare('UPDATE pipe_tests SET status = ?2, gateway_uid = ?3, response = ?4 WHERE id = ?1')
    .bind(id, res.accepted ? res.status : 'failed', res.uid || null, JSON.stringify(res).slice(0, 2000)).run();
  return { ok: Boolean(res.accepted), id, to: phone.local, senderId, text, parts: count.parts, gateway: res };
}
