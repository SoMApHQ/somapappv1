// READ-ONLY access to the Firebase Realtime Database through its REST API,
// authenticated with the service account (so it keeps working after the
// database rules are tightened). This module never writes to Firebase.

import { HttpError } from './http.js';
import { textToBase64Url, bytesToBase64Url } from './util.js';

let tokenCache = { token: '', exp: 0, email: '' };
const readCache = new Map(); // path -> { at, value }
const READ_TTL_MS = 60 * 1000;

function parseServiceAccount(env) {
  let sa;
  try { sa = JSON.parse(env.FIREBASE_SERVICE_ACCOUNT || ''); } catch (_) { sa = null; }
  if (!sa || !sa.client_email || !sa.private_key) {
    throw new HttpError(503, 'NOT_CONFIGURED', 'Mfumo wa SMS bado haujawekwa (service account).', 'FIREBASE_SERVICE_ACCOUNT secret is missing or invalid.');
  }
  return sa;
}

async function importPrivateKey(pem) {
  const body = String(pem).replace(/-----[^-]+-----/g, '').replace(/\s+/g, '');
  const der = Uint8Array.from(atob(body), (c) => c.charCodeAt(0));
  return crypto.subtle.importKey('pkcs8', der, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']);
}

async function getAccessToken(env, fetchImpl) {
  const nowSec = Math.floor(Date.now() / 1000);
  const sa = parseServiceAccount(env);
  if (tokenCache.token && tokenCache.email === sa.client_email && tokenCache.exp - 120 > nowSec) return tokenCache.token;
  const header = textToBase64Url(JSON.stringify({ alg: 'RS256', typ: 'JWT', kid: sa.private_key_id }));
  const claims = textToBase64Url(JSON.stringify({
    iss: sa.client_email,
    scope: 'https://www.googleapis.com/auth/firebase.database https://www.googleapis.com/auth/userinfo.email',
    aud: 'https://oauth2.googleapis.com/token',
    iat: nowSec,
    exp: nowSec + 3600,
  }));
  const key = await importPrivateKey(sa.private_key);
  const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(`${header}.${claims}`));
  const assertion = `${header}.${claims}.${bytesToBase64Url(new Uint8Array(sig))}`;
  const res = await fetchImpl('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: `grant_type=${encodeURIComponent('urn:ietf:params:oauth:grant-type:jwt-bearer')}&assertion=${encodeURIComponent(assertion)}`,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.access_token) {
    throw new HttpError(503, 'FIREBASE_AUTH_FAILED', 'Imeshindwa kuunganisha na Firebase.', `Service account token exchange failed (${res.status}).`);
  }
  tokenCache = { token: data.access_token, exp: nowSec + Number(data.expires_in || 3600), email: sa.client_email };
  return tokenCache.token;
}

function encodePath(path) {
  return String(path || '')
    .split('/')
    .filter(Boolean)
    .map((seg) => encodeURIComponent(seg))
    .join('/');
}

/** Firebase reader. `get(path, { shallow })` returns the value or null. */
export function createFirebaseReader(env, fetchImpl = fetch) {
  const base = String(env.FIREBASE_DB_URL || '').replace(/\/+$/, '');
  return {
    async get(path, opts = {}) {
      const cacheKey = `${opts.shallow ? 's:' : ''}${path}`;
      const hit = readCache.get(cacheKey);
      if (hit && Date.now() - hit.at < READ_TTL_MS) return hit.value;
      const token = await getAccessToken(env, fetchImpl);
      const url = `${base}/${encodePath(path)}.json${opts.shallow ? '?shallow=true' : ''}`;
      const res = await fetchImpl(url, { headers: { authorization: `Bearer ${token}` } });
      if (!res.ok) {
        throw new HttpError(503, 'FIREBASE_READ_FAILED', 'Imeshindwa kusoma taarifa za Firebase.', `Firebase read failed (${res.status}).`);
      }
      const value = await res.json();
      readCache.set(cacheKey, { at: Date.now(), value });
      if (readCache.size > 500) readCache.delete(readCache.keys().next().value);
      return value;
    },
  };
}

export function _resetFirebaseCachesForTests() {
  tokenCache = { token: '', exp: 0, email: '' };
  readCache.clear();
}
