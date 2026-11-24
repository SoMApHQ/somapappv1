// JSON responses, errors (Swahili first) and CORS.

export class HttpError extends Error {
  constructor(status, code, sw, en, extra) {
    super(en || sw || code);
    this.status = status;
    this.code = code;
    this.sw = sw || en || code;
    this.en = en || sw || code;
    this.extra = extra || null;
  }
}

export function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers },
  });
}

export function errorResponse(err) {
  if (err instanceof HttpError) {
    return json({ ok: false, code: err.code, message: err.sw, messageEn: err.en, ...(err.extra || {}) }, err.status);
  }
  console.error('Unhandled error', err && err.stack ? err.stack : err);
  return json({ ok: false, code: 'SERVER_ERROR', message: 'Hitilafu ya mfumo. Jaribu tena baadaye.', messageEn: 'Server error. Please try again later.' }, 500);
}

function originAllowed(origin, allowedList) {
  if (!origin) return false;
  return allowedList.some((rule) => {
    if (rule === origin) return true;
    if (rule.endsWith(':*')) {
      const base = rule.slice(0, -2);
      return origin === base || new RegExp('^' + base.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ':\\d{1,5}$').test(origin);
    }
    return false;
  });
}

export function corsHeaders(request, env) {
  const origin = request.headers.get('Origin') || '';
  const list = String(env.ALLOWED_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean);
  if (!originAllowed(origin, list)) return {};
  return {
    'access-control-allow-origin': origin,
    'access-control-allow-methods': 'GET, POST, OPTIONS',
    'access-control-allow-headers': 'authorization, content-type',
    'access-control-max-age': '600',
    vary: 'Origin',
  };
}

export async function readJson(request, maxBytes = 262144) {
  const text = await request.text();
  if (text.length > maxBytes) throw new HttpError(413, 'TOO_LARGE', 'Ombi ni kubwa mno.', 'Request body too large.');
  if (!text) return {};
  try {
    const data = JSON.parse(text);
    if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('not an object');
    return data;
  } catch (_) {
    throw new HttpError(400, 'BAD_JSON', 'Ombi si sahihi (JSON).', 'Invalid JSON body.');
  }
}
