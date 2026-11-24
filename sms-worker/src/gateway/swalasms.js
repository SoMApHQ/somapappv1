// SwalaSMS adapter (spec: https://docs.swalasms.com/openapi.json).
// Everything SwalaSMS-specific lives here, so the gateway can be switched later.
//
// Normalised sendBulk result:
//   { accepted: true,  results: Map(msisdn -> {status, uid, units}), failures: Map(msisdn -> reason),
//     campaignUid, totalUnits, replay, mode }
//   { accepted: false, certainty: 'not_accepted' | 'unknown', httpStatus, code, message }

const BASE_URL = 'https://api.swalasms.com';
const digits = (v) => String(v || '').replace(/\D/g, '');
const toMsisdn = (v) => {
  const d = digits(v);
  if (/^0[67]\d{8}$/.test(d)) return '255' + d.slice(1);
  return d;
};

export function createSwalaGateway({ apiKey, fetchImpl = fetch, timeoutMs = 20000, baseUrl = BASE_URL }) {
  async function call(method, path, body, extraHeaders = {}) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetchImpl(baseUrl + path, {
        method,
        headers: { authorization: `Bearer ${apiKey}`, accept: 'application/json', ...(body ? { 'content-type': 'application/json' } : {}), ...extraHeaders },
        body: body ? JSON.stringify(body) : undefined,
        signal: ctrl.signal,
      });
      const data = await res.json().catch(() => null);
      return { status: res.status, ok: res.ok, data };
    } catch (err) {
      return { status: 0, ok: false, data: null, networkError: String(err && err.name === 'AbortError' ? 'timeout' : err) };
    } finally {
      clearTimeout(timer);
    }
  }

  function failure(r) {
    const d = r.data || {};
    const code = d.error_code || (r.status === 0 ? 'NETWORK' : `HTTP_${r.status}`);
    let certainty = 'not_accepted';
    if (r.status === 0 || r.status >= 500 || d.acceptance_state === 'UNKNOWN') certainty = 'unknown';
    if (d.acceptance_state === 'DEFINITELY_NOT_ACCEPTED') certainty = 'not_accepted';
    return { accepted: false, certainty, httpStatus: r.status, code, message: String(d.message || r.networkError || `HTTP ${r.status}`).slice(0, 300), details: d.data || null };
  }

  return {
    name: 'swalasms',

    /** items: [{ msisdn, text }]. Same text for all -> plain bulk; otherwise one {msg} tag per recipient. */
    async sendBulk({ senderId, items, campaignName, idempotencyKey }) {
      const sameText = items.every((i) => i.text === items[0].text);
      const body = sameText
        ? { recipients: items.map((i) => '+' + i.msisdn), message: items[0].text, sender_id: senderId }
        : { recipients: items.map((i) => ({ to: '+' + i.msisdn, msg: i.text })), message: '{msg}', sender_id: senderId };
      if (campaignName) body.campaign_name = String(campaignName).slice(0, 120);
      const r = await call('POST', '/v2/sms/send-bulk', body, idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {});
      if (!r.ok || !r.data || r.data.success === false) return failure(r);
      const d = r.data.data || {};
      const results = new Map();
      (d.messages || []).forEach((m) => {
        results.set(toMsisdn(m.to || m.recipient), { status: String(m.status || 'queued').toLowerCase(), uid: m.message_uid || m.uid || null, units: Number.isFinite(Number(m.units)) ? Number(m.units) : null });
      });
      const failures = new Map();
      (d.failures || []).forEach((f) => {
        const who = toMsisdn(f.to || f.recipient || f.phone || f.number);
        failures.set(who, String(f.reason || f.error || f.message || f.error_code || 'FAILED').slice(0, 200));
      });
      return { accepted: true, results, failures, campaignUid: d.uid || null, totalUnits: Number(d.total_units) || null, replay: Boolean(d.idempotent_replay || r.data.idempotent_replay), mode: r.data.mode || null };
    },

    async sendOne({ senderId, msisdn, text, idempotencyKey }) {
      const r = await call('POST', '/v1/sms/messages', { recipient: '+' + msisdn, sender_id: senderId, body: text }, idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {});
      if (!r.ok || !r.data || r.data.success === false) return failure(r);
      const d = r.data.data || {};
      return { accepted: true, uid: d.uid || null, status: String(d.status || 'queued').toLowerCase(), units: Number(d.units) || null, mode: r.data.mode || null, encoding: r.data.encoding || null };
    },

    async balance() {
      const r = await call('GET', '/v1/balance');
      return r.ok ? { ok: true, data: (r.data && r.data.data) || r.data } : { ok: false, ...failure(r) };
    },

    async senderIds() {
      const r = await call('GET', '/v1/sender-ids');
      return r.ok ? { ok: true, data: (r.data && r.data.data) || [] } : { ok: false, ...failure(r) };
    },

    async message(uid) {
      const r = await call('GET', `/v1/sms/messages/${encodeURIComponent(uid)}`);
      return r.ok ? { ok: true, data: (r.data && r.data.data) || r.data } : { ok: false, ...failure(r) };
    },
  };
}
