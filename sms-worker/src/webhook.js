// SwalaSMS delivery reports.
// Header X-SwalaSMS-Signature = HMAC-SHA256(exact raw body, webhook secret).
// The timestamp is not signed, so replays are stopped by remembering each event.
import { HttpError, json } from './http.js';
import { bytesToHex, safeEqual } from './util.js';

export async function hmacSha256(secret, body) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(body)));
}

export async function verifySignature(secret, rawBody, header) {
  const sig = String(header || '').trim().replace(/^sha256=/i, '');
  if (!sig) return false;
  const mac = await hmacSha256(secret, rawBody);
  const hex = bytesToHex(mac);
  let b64 = '';
  for (let i = 0; i < mac.length; i++) b64 += String.fromCharCode(mac[i]);
  b64 = btoa(b64);
  return safeEqual(sig.toLowerCase(), hex) || safeEqual(sig, b64);
}

const STATUS = { 'sms.delivered': 'delivered', 'sms.failed': 'failed' };

export async function handleWebhook(request, env) {
  const secret = String(env.SWALASMS_WEBHOOK_SECRET || '');
  if (!secret) throw new HttpError(503, 'WEBHOOK_NOT_CONFIGURED', 'Webhook haijawekwa.', 'SWALASMS_WEBHOOK_SECRET is not set.');
  const raw = await request.text();
  if (raw.length > 65536) throw new HttpError(413, 'TOO_LARGE', 'Ombi ni kubwa mno.', 'Body too large.');
  if (!(await verifySignature(secret, raw, request.headers.get('X-SwalaSMS-Signature')))) {
    throw new HttpError(401, 'BAD_SIGNATURE', 'Sahihi ya webhook si sahihi.', 'Invalid webhook signature.');
  }
  let evt;
  try { evt = JSON.parse(raw); } catch (_) { throw new HttpError(400, 'BAD_JSON', 'JSON si sahihi.', 'Invalid JSON.'); }
  const event = String(evt.event || '');
  const uid = String(evt.message_id || evt.order_uid || '');
  const eventId = `${event}:${uid}:${evt.status || ''}`;
  const ins = await env.DB.prepare('INSERT OR IGNORE INTO webhook_events (id, event, received_at) VALUES (?1, ?2, ?3)').bind(eventId, event, Date.now()).run();
  if (Number(ins.meta?.changes || 0) === 0) return json({ ok: true, duplicate: true });

  const status = STATUS[event];
  if (status && uid) {
    const reason = status === 'failed' ? String(evt.error || evt.status || 'failed').slice(0, 200) : null;
    const t = Date.now();
    await env.DB.batch([
      env.DB.prepare('UPDATE messages SET status = ?2, failure_reason = COALESCE(?3, failure_reason), updated_at = ?4 WHERE gateway_uid = ?1').bind(uid, status, reason, t),
      env.DB.prepare('UPDATE pipe_tests SET status = ?2 WHERE gateway_uid = ?1').bind(uid, status),
    ]);
  }
  return json({ ok: true });
}
