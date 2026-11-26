// Small helpers shared by the Worker modules. Web APIs only (Workers + Node 20+).

const enc = new TextEncoder();

export function now() {
  return Date.now();
}

export async function sha256Bytes(text) {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', enc.encode(String(text))));
}

export async function sha256Hex(text) {
  return bytesToHex(await sha256Bytes(text));
}

export function bytesToHex(bytes) {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

/** Deterministic UUID (v5 layout) from any string — same input, same key. */
export async function uuidFromString(text) {
  const b = (await sha256Bytes(text)).slice(0, 16);
  b[6] = (b[6] & 0x0f) | 0x50;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = bytesToHex(b);
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

export function base64UrlToBytes(s) {
  const b64 = String(s).replace(/-/g, '+').replace(/_/g, '/');
  const padded = b64 + '='.repeat((4 - (b64.length % 4)) % 4);
  const bin = atob(padded);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function bytesToBase64Url(bytes) {
  let bin = '';
  const arr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  for (let i = 0; i < arr.length; i++) bin += String.fromCharCode(arr[i]);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function textToBase64Url(text) {
  return bytesToBase64Url(enc.encode(text));
}

/** Start of today in East Africa Time (UTC+3), as epoch ms. */
export function eatDayStart(ms = Date.now()) {
  const offset = 3 * 3600 * 1000;
  const day = 24 * 3600 * 1000;
  return Math.floor((ms + offset) / day) * day - offset;
}

export function splitList(value) {
  return String(value || '')
    .split(/[,\s]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/** Firebase RTDB keys may not contain . # $ [ ] / */
export function isSafeKey(id) {
  return typeof id === 'string' && id.length > 0 && id.length <= 120 && !/[.#$\[\]\/\u0000-\u001f]/.test(id);
}

export function normalizeRole(role) {
  const r = String(role || '').trim().toLowerCase().replace(/[\s-]+/g, '_');
  if (r === 'headteacher' || r === 'head_teacher' || r === 'headmaster') return 'head_teacher';
  if (r === 'administrator') return 'admin';
  return r;
}

export function emailKeyAllDots(email) {
  return String(email || '').trim().toLowerCase().replace(/\./g, '_');
}

export function emailKeyFirstDot(email) {
  return String(email || '').trim().toLowerCase().replace('.', '_');
}

/** Constant-time string compare. */
export function safeEqual(a, b) {
  const x = String(a || '');
  const y = String(b || '');
  let diff = x.length ^ y.length;
  const n = Math.max(x.length, y.length);
  for (let i = 0; i < n; i++) diff |= (x.charCodeAt(i) || 0) ^ (y.charCodeAt(i) || 0);
  return diff === 0;
}

/** Start of the current calendar month in East Africa Time (UTC+3), as epoch ms. */
export function eatMonthStart(ms = Date.now()) {
  const offset = 3 * 3600 * 1000;
  const d = new Date(ms + offset);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1) - offset;
}
