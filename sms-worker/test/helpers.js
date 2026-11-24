// Test doubles: D1 on Node's built-in SQLite, fake Google/Firebase/SwalaSMS network.
// Nothing here touches the real internet or the real database.
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { _resetFirebaseCachesForTests } from '../src/firebase.js';
import { _resetJwksCacheForTests } from '../src/auth.js';
import { bytesToBase64Url, textToBase64Url } from '../src/util.js';

const SCHEMA = readFileSync(fileURLToPath(new URL('../schema.sql', import.meta.url)), 'utf8');

// D1 binds "?1 ?2 ?1" by number; node:sqlite treats them as named. Rewrite to plain "?".
function positional(sql, args) {
  const order = [];
  const out = sql.replace(/\?(\d+)/g, (_, n) => { order.push(Number(n) - 1); return '?'; });
  return order.length ? { sql: out, args: order.map((i) => args[i]) } : { sql, args };
}

class FakeStmt {
  constructor(sqlite, sql, args = []) {
    this.sqlite = sqlite;
    this.rawSql = sql;
    const p = positional(sql, args);
    this.sql = p.sql;
    this.args = p.args;
  }
  bind(...args) { return new FakeStmt(this.sqlite, this.rawSql, args); }
  isQuery() { return /^\s*(SELECT|WITH)\b/i.test(this.sql) || /\bRETURNING\b/i.test(this.sql); }
  async first() { return this.firstSync(); }
  firstSync() { return this.sqlite.prepare(this.sql).get(...this.args) ?? null; }
  async all() { return this.allSync(); }
  allSync() { return { success: true, results: this.sqlite.prepare(this.sql).all(...this.args), meta: {} }; }
  async run() { return this.runSync(); }
  runSync() {
    const r = this.sqlite.prepare(this.sql).run(...this.args);
    return { success: true, meta: { changes: Number(r.changes), last_row_id: Number(r.lastInsertRowid) } };
  }
}

export function makeD1() {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec(SCHEMA);
  return {
    sqlite,
    prepare: (sql) => new FakeStmt(sqlite, sql),
    async batch(stmts) {
      sqlite.exec('BEGIN');
      try {
        const out = stmts.map((s) => (s.isQuery() ? s.allSync() : s.runSync()));
        sqlite.exec('COMMIT');
        return out;
      } catch (err) {
        sqlite.exec('ROLLBACK');
        throw err;
      }
    },
    rows: (sql, ...args) => sqlite.prepare(sql).all(...args),
    one: (sql, ...args) => sqlite.prepare(sql).get(...args),
  };
}

async function rsaPair() {
  return crypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify']);
}

export async function makeWorld() {
  const signer = await rsaPair();
  const jwk = { ...(await crypto.subtle.exportKey('jwk', signer.publicKey)), kid: 'test-kid', alg: 'RS256', use: 'sig' };
  const sa = await rsaPair();
  const pkcs8 = new Uint8Array(await crypto.subtle.exportKey('pkcs8', sa.privateKey));
  const pem = `-----BEGIN PRIVATE KEY-----\n${Buffer.from(pkcs8).toString('base64')}\n-----END PRIVATE KEY-----\n`;

  const rtdb = {
    'users/admin_socrates@example_com': { role: 'admin', schoolId: '' },
    'users/acct@example_com': { role: 'accountant', schoolId: 'mnyore-academy-dampo-map' },
    'users/teacher@example_com': { role: 'teacher', schoolId: 'mnyore-academy-dampo-map' },
    'users/off@example_com': { role: 'admin', schoolId: '', active: false },
    'users/hq@example_com': { role: 'admin', schoolId: '' },
    'schools/socrates-school/meta': { name: 'Socrates School' },
    'schools/mnyore-academy-dampo-map/meta': { name: 'Mnyore Academy Dampo (MAP)', email: 'owner@map.com' },
    'schools/mnyore-academy-dampo-map': true,
    schools: { 'socrates-school': true, 'mnyore-academy-dampo-map': true },
  };

  const calls = [];
  const world = {
    calls,
    rtdb,
    swala: null, // (url, init, body) => { status, json }
    env: null,
    async token(email, extra = {}) {
      const now = Math.floor(Date.now() / 1000);
      const header = textToBase64Url(JSON.stringify({ alg: 'RS256', kid: 'test-kid', typ: 'JWT' }));
      const claims = textToBase64Url(JSON.stringify({
        iss: 'https://securetoken.google.com/somaptestt', aud: 'somaptestt', sub: 'uid-' + email, email, email_verified: true,
        iat: now - 10, exp: now + 3600, auth_time: now - 10, ...extra,
      }));
      const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', signer.privateKey, new TextEncoder().encode(`${header}.${claims}`));
      return `${header}.${claims}.${bytesToBase64Url(new Uint8Array(sig))}`;
    },
  };

  globalThis.fetch = async (input, init = {}) => {
    const url = String(input);
    calls.push({ url, init });
    const respond = (status, data, headers = {}) => new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json', ...headers } });
    if (url.startsWith('https://www.googleapis.com/service_accounts/v1/jwk/')) return respond(200, { keys: [jwk] }, { 'cache-control': 'public, max-age=3600' });
    if (url === 'https://oauth2.googleapis.com/token') return respond(200, { access_token: 'fake-access', expires_in: 3600 });
    if (url.startsWith('https://fake-rtdb/')) {
      if ((init.headers || {}).authorization !== 'Bearer fake-access') return respond(401, { error: 'Permission denied' });
      const path = decodeURIComponent(new URL(url).pathname.replace(/^\//, '').replace(/\.json$/, ''));
      return respond(200, rtdb[path] === undefined ? null : rtdb[path]);
    }
    if (url.startsWith('https://api.swalasms.com/')) {
      if (!world.swala) throw new Error('Unexpected SwalaSMS call: ' + url);
      const r = await world.swala(url, init, init.body ? JSON.parse(init.body) : null);
      if (r === 'network') throw new TypeError('network down');
      return respond(r.status, r.json);
    }
    throw new Error('Unexpected network call: ' + url);
  };

  world.env = {
    DB: makeD1(),
    FIREBASE_PROJECT_ID: 'somaptestt',
    FIREBASE_DB_URL: 'https://fake-rtdb',
    FIREBASE_SERVICE_ACCOUNT: JSON.stringify({ client_email: 'sa@somaptestt.iam.gserviceaccount.com', private_key: pem, private_key_id: 'k1' }),
    HQ_EMAILS: 'hq@example.com, boss@example.com',
    HQ_TEST_NUMBERS: '0686000111',
    SWALASMS_TEST_KEY: 'swl_test_abc',
    SWALASMS_LIVE_KEY: 'swl_live_xyz',
    SWALASMS_WEBHOOK_SECRET: 'whsec_test',
    LIVE_ENABLED: 'false',
    ALLOWED_ORIGINS: 'https://somapv2i.com,http://localhost:*',
  };
  _resetFirebaseCachesForTests();
  _resetJwksCacheForTests();
  return world;
}

/** Call the Worker like a browser would. */
export async function call(worker, world, method, path, { email, body, origin, headers = {} } = {}) {
  const h = { ...headers };
  if (email) h.authorization = `Bearer ${await world.token(email)}`;
  if (origin) h.origin = origin;
  if (body !== undefined) h['content-type'] = 'application/json';
  const res = await worker.fetch(new Request('https://somap-sms.example.workers.dev' + path, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) }), world.env);
  const text = await res.text();
  let data = null;
  try { data = JSON.parse(text); } catch (_) { data = text; }
  return { status: res.status, data, headers: res.headers };
}
