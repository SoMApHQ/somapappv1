// SoMAp SMS Worker — entry point and routes.
//
//  GET  /health                         no login
//  POST /webhook/swalasms               SwalaSMS delivery reports (signed)
//  GET  /me?school=ID                   who am I, may I send, wallet, mode
//  POST /campaigns/start                { schoolId, purpose, name, estimatedRecipients, estimatedUnits }
//  POST /campaigns/chunk                { schoolId, campaignId, chunkIndex, items:[{phone, text, ref}] }
//  POST /campaigns/finish               { schoolId, campaignId }
//  GET  /campaigns?school=ID            history
//  GET  /campaigns/get?school=ID&id=    one campaign with its messages
//  GET  /templates?school=ID            saved templates (Violezo)
//  POST /templates/save                 { schoolId, id?, name, purpose, body }
//  POST /templates/delete               { schoolId, id }
//  HQ only:
//  GET  /hq/overview
//  POST /hq/config                      { mode, fallbackSenderId, sandboxSenderId, buyPricePerSms }
//  POST /hq/school-settings             { schoolId, allowedRoles, dailyLimit, approvalAbove, pricePerSms }
//  POST /hq/wallet/adjust               { schoolId, bucket:'test', units, note }
//  GET  /hq/gateway?key=test|live&what=balance|sender-ids|message&uid=
//  POST /hq/pipe-test                   { to, senderId, text }   (LIVE key, HQ test numbers only)
//  POST /hq/school-sender               { schoolId, senderId }   (own Sender ID; used once approved)
import { bearerToken, resolveStaff, verifyIdToken } from './auth.js';
import { bucketForMode, getBalance, getConfig, getSchoolSettings } from './db.js';
import { createFirebaseReader } from './firebase.js';
import { HttpError, corsHeaders, errorResponse, json, readJson } from './http.js';
import { adjustWallet, assertHq, gatewayInfo, overview, pipeTest, setSchoolSender, updateConfig, updateSchoolSettings } from './hq.js';
import { finishCampaign, getCampaign, listCampaigns, resolveSender, schoolPrefixes, sendChunk, startCampaign } from './send.js';
import { handleWebhook } from './webhook.js';
import { deleteTemplate, listTemplates, saveTemplate } from './templates.js';
import { eatDayStart } from './util.js';

export const VERSION = 'live-2026-11-26';

async function me(env, staff) {
  const db = env.DB;
  const cfg = await getConfig(db);
  const out = {
    ok: true,
    version: VERSION,
    email: staff.email,
    name: staff.name,
    isHq: staff.isHq,
    schoolId: staff.schoolId,
    schoolName: staff.schoolName,
    role: staff.role,
    belongs: staff.belongs,
    reason: staff.reason || null,
    mode: cfg.mode,
    liveEnabled: String(env.LIVE_ENABLED) === 'true',
  };
  if (!staff.schoolId) return out;
  const settings = await getSchoolSettings(db, staff.schoolId);
  const bucket = bucketForMode(cfg.mode);
  const sender = await resolveSender(env, db, cfg, staff.schoolId, cfg.mode);
  sender.prefixRequired = sender.source !== 'school';
  sender.schoolPrefixes = schoolPrefixes(staff.schoolName);
  const used = await db.prepare(
    `SELECT COALESCE(SUM(COALESCE(units, units_est)), 0) AS used FROM messages WHERE school_id = ?1 AND bucket = ?2 AND created_at >= ?3 AND status NOT IN ('failed', 'rejected')`
  ).bind(staff.schoolId, bucket, eatDayStart()).first();
  return {
    ...out,
    canSend: staff.belongs && settings.allowedRoles.includes(staff.role) && Boolean(sender.senderId),
    allowedRoles: settings.allowedRoles,
    wallet: { bucket, balance: await getBalance(db, staff.schoolId, bucket) },
    sender,
    limits: { dailyLimit: settings.dailyLimit, usedToday: Number(used?.used || 0), approvalAbove: settings.approvalAbove },
  };
}

export async function handle(request, env) {
  const url = new URL(request.url);
  const path = url.pathname.replace(/\/+$/, '') || '/';
  const method = request.method.toUpperCase();

  if (method === 'GET' && path === '/health') {
    const cfg = await getConfig(env.DB).catch(() => null);
    return json({ ok: true, service: 'somap-sms', version: VERSION, mode: cfg ? cfg.mode : 'unknown (database not ready)', liveEnabled: String(env.LIVE_ENABLED) === 'true' });
  }
  if (method === 'POST' && path === '/webhook/swalasms') return handleWebhook(request, env);

  const claims = await verifyIdToken(bearerToken(request), env);
  const fb = createFirebaseReader(env);
  const body = method === 'POST' ? await readJson(request) : {};
  const schoolId = String(body.schoolId || url.searchParams.get('school') || '').trim();

  if (path.startsWith('/hq/')) {
    const staff = await resolveStaff(claims, '', env, fb);
    assertHq(staff);
    if (method === 'GET' && path === '/hq/overview') return json(await overview(env, fb));
    if (method === 'POST' && path === '/hq/config') return json(await updateConfig(env, staff, body));
    if (method === 'POST' && path === '/hq/school-settings') return json(await updateSchoolSettings(env, staff, body, fb));
    if (method === 'POST' && path === '/hq/wallet/adjust') return json(await adjustWallet(env, staff, body, fb));
    if (method === 'GET' && path === '/hq/gateway') {
      return json(await gatewayInfo(env, url.searchParams.get('key'), url.searchParams.get('what'), url.searchParams.get('uid')));
    }
    if (method === 'POST' && path === '/hq/pipe-test') return json(await pipeTest(env, staff, body));
    if (method === 'POST' && path === '/hq/school-sender') return json(await setSchoolSender(env, staff, body, fb));
    throw new HttpError(404, 'NOT_FOUND', 'Haipo.', 'Not found.');
  }

  const staff = await resolveStaff(claims, schoolId, env, fb);
  if (method === 'GET' && path === '/me') return json(await me(env, staff));
  if (!schoolId) throw new HttpError(400, 'NO_SCHOOL', 'Chagua shule kwanza.', 'schoolId is required.');
  if (method === 'POST' && path === '/campaigns/start') return json(await startCampaign(env, staff, body));
  if (method === 'POST' && path === '/campaigns/chunk') {
    const r = await sendChunk(env, staff, body);
    return json(r, r.retry ? 202 : 200);
  }
  if (method === 'POST' && path === '/campaigns/finish') return json(await finishCampaign(env, staff, body));
  if (method === 'GET' && path === '/templates') return json(await listTemplates(env, staff));
  if (method === 'POST' && path === '/templates/save') return json(await saveTemplate(env, staff, body));
  if (method === 'POST' && path === '/templates/delete') return json(await deleteTemplate(env, staff, body));
  if (!staff.belongs) throw new HttpError(403, 'NOT_ALLOWED', 'Huna ruhusa kwa shule hii.', 'Not a member of this school.');
  if (method === 'GET' && path === '/campaigns') return json(await listCampaigns(env, staff));
  if (method === 'GET' && path === '/campaigns/get') return json(await getCampaign(env, staff, String(url.searchParams.get('id') || '')));
  throw new HttpError(404, 'NOT_FOUND', 'Haipo.', 'Not found.');
}

export default {
  async fetch(request, env) {
    const cors = corsHeaders(request, env);
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    let res;
    try {
      res = await handle(request, env);
    } catch (err) {
      res = errorResponse(err);
    }
    const out = new Response(res.body, res);
    Object.entries(cors).forEach(([k, v]) => out.headers.set(k, v));
    return out;
  },
};
