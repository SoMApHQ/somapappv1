// 1) Verify the Firebase ID token (Google login) — RS256 with Google's public keys.
// 2) Map the user to a school and role exactly like login.html does:
//      users/{emailKey}  { role, schoolId (empty = legacy Socrates), active }
//      schools/{id}/meta.email  = the school's registered admin Gmail
// 3) HQ = an email listed in the HQ_EMAILS secret.

import { HttpError } from './http.js';
import { base64UrlToBytes, emailKeyAllDots, emailKeyFirstDot, isSafeKey, normalizeRole, splitList } from './util.js';

export const SOCRATES_ID = 'socrates-school';
const JWKS_URL = 'https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com';
let jwksCache = { keys: null, exp: 0 };

const unauth = (en) => new HttpError(401, 'NOT_LOGGED_IN', 'Tafadhali ingia (login) tena.', en);

async function getJwks(fetchImpl, forceRefresh) {
  if (!forceRefresh && jwksCache.keys && jwksCache.exp > Date.now()) return jwksCache.keys;
  const res = await fetchImpl(JWKS_URL);
  if (!res.ok) throw new HttpError(503, 'AUTH_KEYS_UNAVAILABLE', 'Imeshindwa kuthibitisha login kwa sasa.', 'Could not fetch Google signing keys.');
  const data = await res.json();
  const m = /max-age=(\d+)/.exec(res.headers.get('cache-control') || '');
  jwksCache = { keys: data.keys || [], exp: Date.now() + (m ? Number(m[1]) * 1000 : 3600 * 1000) };
  return jwksCache.keys;
}

/** Returns the verified token claims, or throws 401. */
export async function verifyIdToken(token, env, fetchImpl = fetch) {
  const parts = String(token || '').split('.');
  if (parts.length !== 3) throw unauth('Missing or malformed ID token.');
  let header;
  let claims;
  try {
    header = JSON.parse(new TextDecoder().decode(base64UrlToBytes(parts[0])));
    claims = JSON.parse(new TextDecoder().decode(base64UrlToBytes(parts[1])));
  } catch (_) {
    throw unauth('Undecodable ID token.');
  }
  if (header.alg !== 'RS256' || !header.kid) throw unauth('Unexpected token algorithm.');
  let keys = await getJwks(fetchImpl, false);
  let jwk = keys.find((k) => k.kid === header.kid);
  if (!jwk) {
    keys = await getJwks(fetchImpl, true);
    jwk = keys.find((k) => k.kid === header.kid);
  }
  if (!jwk) throw unauth('Unknown signing key.');
  const key = await crypto.subtle.importKey('jwk', { kty: jwk.kty, n: jwk.n, e: jwk.e, alg: 'RS256', ext: true }, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
  const valid = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, base64UrlToBytes(parts[2]), new TextEncoder().encode(`${parts[0]}.${parts[1]}`));
  if (!valid) throw unauth('Bad token signature.');

  const project = env.FIREBASE_PROJECT_ID;
  const nowSec = Math.floor(Date.now() / 1000);
  if (claims.aud !== project) throw unauth('Token audience mismatch.');
  if (claims.iss !== `https://securetoken.google.com/${project}`) throw unauth('Token issuer mismatch.');
  if (!(Number(claims.exp) > nowSec)) throw unauth('Token expired.');
  if (Number(claims.iat) > nowSec + 300) throw unauth('Token issued in the future.');
  if (claims.auth_time && Number(claims.auth_time) > nowSec + 300) throw unauth('Bad auth_time.');
  if (!claims.sub || typeof claims.sub !== 'string') throw unauth('Token has no subject.');
  if (!claims.email || claims.email_verified !== true) {
    throw new HttpError(403, 'EMAIL_NOT_VERIFIED', 'Akaunti hii haina barua pepe iliyothibitishwa.', 'A verified email is required.');
  }
  return claims;
}

export function bearerToken(request) {
  const h = request.headers.get('Authorization') || '';
  const m = /^Bearer\s+(.+)$/i.exec(h.trim());
  return m ? m[1].trim() : '';
}

export function isHqEmail(email, env) {
  const list = splitList(env.HQ_EMAILS).map((e) => e.toLowerCase());
  return list.includes(String(email || '').toLowerCase());
}

/**
 * Who is this user for `schoolId`?
 * Returns { email, name, isHq, schoolId, schoolName, role, belongs, reason }.
 */
export async function resolveStaff(claims, schoolId, env, fb) {
  const email = String(claims.email || '').trim().toLowerCase();
  const isHq = isHqEmail(email, env);
  const out = { email, name: claims.name || email, isHq, schoolId: schoolId || '', schoolName: '', role: '', belongs: false, reason: '' };
  if (!schoolId) return { ...out, reason: 'NO_SCHOOL' };
  if (!isSafeKey(schoolId)) throw new HttpError(400, 'BAD_SCHOOL', 'Shule haijulikani.', 'Invalid school id.');

  const meta = (await fb.get(`schools/${schoolId}/meta`)) || null;
  if (!meta && schoolId !== SOCRATES_ID) {
    const exists = await fb.get(`schools/${schoolId}`, { shallow: true });
    if (!exists) throw new HttpError(404, 'UNKNOWN_SCHOOL', 'Shule hii haipo kwenye SoMAp.', 'Unknown school.');
  }
  out.schoolName = (meta && (meta.name || meta.schoolName)) || (schoolId === SOCRATES_ID ? 'Socrates School' : schoolId);

  let profile = await fb.get(`users/${emailKeyAllDots(email)}`);
  if (!profile && emailKeyFirstDot(email) !== emailKeyAllDots(email)) profile = await fb.get(`users/${emailKeyFirstDot(email)}`);

  if (profile && typeof profile === 'object') {
    if (profile.active === false) return { ...out, reason: 'DISABLED' };
    const profileSchool = String(profile.schoolId || profile.school || '').trim();
    const sameSchool = profileSchool ? profileSchool === schoolId : schoolId === SOCRATES_ID;
    if (sameSchool) {
      return { ...out, role: normalizeRole(profile.role || profile.userType), belongs: true };
    }
  }
  // Registered school admin Gmail (same rule as login.html), for non-Socrates schools.
  if (schoolId !== SOCRATES_ID && meta && meta.email && String(meta.email).trim().toLowerCase() === email) {
    return { ...out, role: 'admin', belongs: true };
  }
  return { ...out, reason: profile ? 'OTHER_SCHOOL' : 'NO_PROFILE' };
}

export function _resetJwksCacheForTests() {
  jwksCache = { keys: null, exp: 0 };
}
