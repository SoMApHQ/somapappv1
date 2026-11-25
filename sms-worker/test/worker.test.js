import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/index.js';
import { call, makeWorld } from './helpers.js';
import { hmacSha256 } from '../src/webhook.js';
import { bytesToHex } from '../src/util.js';

const SOC = 'socrates-school';
const MAP = 'mnyore-academy-dampo-map';
const ADMIN = 'admin.socrates@example.com';
const HQ = 'hq@example.com';
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

async function topUp(w, schoolId, units) {
  const r = await call(worker, w, 'POST', '/hq/wallet/adjust', { email: HQ, body: { schoolId, bucket: 'test', units, note: 'test credits' } });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  return r.data.balance;
}
async function start(w, email, schoolId, extra = {}) {
  const r = await call(worker, w, 'POST', '/campaigns/start', { email, body: { schoolId, purpose: 'general', name: 'Test', estimatedRecipients: 2, estimatedUnits: 2, ...extra } });
  return r;
}
const balance = (w, schoolId) => Number(w.env.DB.one("SELECT balance FROM wallets WHERE school_id = ? AND bucket = 'test'", schoolId)?.balance || 0);

// ------------------------------------------------------------------ basics
test('health needs no login and reports dry-run by default', async () => {
  const w = await makeWorld();
  const r = await call(worker, w, 'GET', '/health');
  assert.equal(r.status, 200);
  assert.equal(r.data.mode, 'dryrun');
  assert.equal(r.data.liveEnabled, false);
});

test('login is required and checked (signature, audience, expiry)', async () => {
  const w = await makeWorld();
  assert.equal((await call(worker, w, 'GET', `/me?school=${SOC}`)).status, 401);
  const badAud = await w.token(ADMIN, { aud: 'other-project' });
  assert.equal((await call(worker, w, 'GET', `/me?school=${SOC}`, { headers: { authorization: `Bearer ${badAud}` } })).status, 401);
  const expired = await w.token(ADMIN, { exp: Math.floor(Date.now() / 1000) - 5 });
  assert.equal((await call(worker, w, 'GET', `/me?school=${SOC}`, { headers: { authorization: `Bearer ${expired}` } })).status, 401);
  const good = await w.token(ADMIN);
  const tampered = good.slice(0, -4) + (good.endsWith('AAAA') ? 'BBBB' : 'AAAA');
  assert.equal((await call(worker, w, 'GET', `/me?school=${SOC}`, { headers: { authorization: `Bearer ${tampered}` } })).status, 401);
  const unverified = await w.token(ADMIN, { email_verified: false });
  assert.equal((await call(worker, w, 'GET', `/me?school=${SOC}`, { headers: { authorization: `Bearer ${unverified}` } })).status, 403);
});

test('school + role mapping matches login.html', async () => {
  const w = await makeWorld();
  const soc = await call(worker, w, 'GET', `/me?school=${SOC}`, { email: ADMIN });
  assert.equal(soc.data.belongs, true);
  assert.equal(soc.data.role, 'admin');
  assert.equal(soc.data.canSend, true);
  assert.equal(soc.data.schoolName, 'Socrates School');

  const legacyAdminOtherSchool = await call(worker, w, 'GET', `/me?school=${MAP}`, { email: ADMIN });
  assert.equal(legacyAdminOtherSchool.data.belongs, false, 'empty schoolId means Socrates only');

  const acct = await call(worker, w, 'GET', `/me?school=${MAP}`, { email: 'acct@example.com' });
  assert.equal(acct.data.role, 'accountant');
  assert.equal(acct.data.canSend, true);

  const teacher = await call(worker, w, 'GET', `/me?school=${MAP}`, { email: 'teacher@example.com' });
  assert.equal(teacher.data.belongs, true);
  assert.equal(teacher.data.canSend, false);
  const tStart = await start(w, 'teacher@example.com', MAP);
  assert.equal(tStart.status, 403);
  assert.equal(tStart.data.code, 'ROLE_NOT_ALLOWED');

  const owner = await call(worker, w, 'GET', `/me?school=${MAP}`, { email: 'owner@map.com' });
  assert.equal(owner.data.role, 'admin', 'registered school Gmail is admin');

  const off = await call(worker, w, 'GET', `/me?school=${SOC}`, { email: 'off@example.com' });
  assert.equal(off.data.belongs, false);
  assert.equal(off.data.reason, 'DISABLED');

  const unknown = await call(worker, w, 'GET', '/me?school=no-such-school', { email: ADMIN });
  assert.equal(unknown.status, 404);

  const accountantIntoSocrates = await start(w, 'acct@example.com', SOC);
  assert.equal(accountantIntoSocrates.data.code, 'NOT_ALLOWED');
});

test('HQ endpoints are HQ-only; Firebase is only READ (no writes)', async () => {
  const w = await makeWorld();
  assert.equal((await call(worker, w, 'GET', '/hq/overview', { email: ADMIN })).status, 403);
  const r = await call(worker, w, 'GET', '/hq/overview', { email: HQ });
  assert.equal(r.status, 200);
  assert.deepEqual(r.data.schools.map((s) => s.schoolId).sort(), [MAP, SOC].sort());
  const fbCalls = w.calls.filter((c) => c.url.startsWith('https://fake-rtdb/'));
  assert.ok(fbCalls.length > 0);
  assert.ok(fbCalls.every((c) => !c.init.method || c.init.method === 'GET'), 'Firebase is read-only');
});

// ------------------------------------------------------------------ dry-run flow
test('dry-run chunk: validation, wallet reserve, ledger, replay never double-charges', async () => {
  const w = await makeWorld();
  assert.equal(await topUp(w, SOC, 20), 20);
  const st = await start(w, ADMIN, SOC);
  assert.equal(st.status, 200, JSON.stringify(st.data));
  assert.equal(st.data.mode, 'dryrun');
  const long = 'Habari mzazi. '.repeat(13); // > 160 chars => 2 parts
  const items = [
    { phone: '0712345678', text: 'Habari mzazi wa Amina. Kikao ni Jumamosi.', ref: 'A1' },
    { phone: '+255712345678', text: 'Duplicate phone', ref: 'A2' },
    { phone: '--', text: 'No phone', ref: 'A3' },
    { phone: '0755000111', text: 'Habari {parentName}', ref: 'A4' },
    { phone: '2550766000222', text: long, ref: 'A5' },
    { phone: '0766000333', text: '   ', ref: 'A6' },
    { phone: '25571234567', text: 'bad phone', ref: 'A7' },
  ];
  const body = { schoolId: SOC, campaignId: st.data.campaignId, chunkIndex: 0, items };
  const r = await call(worker, w, 'POST', '/campaigns/chunk', { email: ADMIN, body });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.sent, 2);
  assert.equal(r.data.unitsUsed, 3);
  assert.equal(r.data.walletBalance, 17);
  assert.deepEqual(r.data.rejected.map((x) => [x.ref, x.reason]), [
    ['A2', 'DUPLICATE_IN_SEND'], ['A3', 'PHONE_MISSING'], ['A4', 'PLACEHOLDER_UNFILLED'], ['A6', 'EMPTY_MESSAGE'], ['A7', 'PHONE_INVALID'],
  ]);
  assert.deepEqual(r.data.results.map((x) => x.phone), ['255712345678', '255766000222'], '2550… fixed automatically');
  assert.equal(balance(w, SOC), 17);

  const replay = await call(worker, w, 'POST', '/campaigns/chunk', { email: ADMIN, body });
  assert.equal(replay.data.replay, true);
  assert.equal(balance(w, SOC), 17, 'replay is free');

  const ledger = w.env.DB.rows('SELECT kind, delta, balance_after FROM ledger WHERE school_id = ? ORDER BY id', SOC);
  assert.deepEqual(ledger.map((l) => [l.kind, l.delta, l.balance_after]), [['adjust', 20, 20], ['reserve', -3, 17]]);

  const hist = await call(worker, w, 'GET', `/campaigns?school=${SOC}`, { email: ADMIN });
  assert.equal(hist.data.campaigns.length, 1);
  assert.equal(hist.data.campaigns[0].sent_count, 2);
  const otherSchool = await call(worker, w, 'GET', `/campaigns?school=${MAP}`, { email: 'acct@example.com' });
  assert.equal(otherSchool.data.campaigns.length, 0, 'schools never see each other');
});

test('24-hour duplicate guard, insufficient balance and daily limit', async () => {
  const w = await makeWorld();
  await topUp(w, SOC, 3);
  const c1 = await start(w, ADMIN, SOC, { estimatedUnits: 1 });
  await call(worker, w, 'POST', '/campaigns/chunk', { email: ADMIN, body: { schoolId: SOC, campaignId: c1.data.campaignId, chunkIndex: 0, items: [{ phone: '0712345678', text: 'Kikao Jumamosi' }] } });
  const c2 = await start(w, ADMIN, SOC, { estimatedUnits: 1 });
  const dup = await call(worker, w, 'POST', '/campaigns/chunk', { email: ADMIN, body: { schoolId: SOC, campaignId: c2.data.campaignId, chunkIndex: 0, items: [{ phone: '0712345678', text: 'Kikao Jumamosi' }, { phone: '0712345678', text: 'x' }] } });
  assert.equal(dup.data.rejected[0].reason, 'DUPLICATE_24H');
  assert.equal(balance(w, SOC), 2);

  const tooMuch = await start(w, ADMIN, SOC, { estimatedUnits: 50 });
  assert.equal(tooMuch.status, 402);
  assert.equal(tooMuch.data.code, 'INSUFFICIENT_BALANCE');

  const c3 = await start(w, ADMIN, SOC, { estimatedUnits: 0 });
  const many = Array.from({ length: 3 }, (_, i) => ({ phone: `071200000${i}`, text: `Ujumbe ${i}` }));
  const broke = await call(worker, w, 'POST', '/campaigns/chunk', { email: ADMIN, body: { schoolId: SOC, campaignId: c3.data.campaignId, chunkIndex: 0, items: many } });
  assert.equal(broke.status, 402);
  assert.equal(balance(w, SOC), 2, 'nothing reserved when the wallet is short');

  const set = await call(worker, w, 'POST', '/hq/school-settings', { email: HQ, body: { schoolId: SOC, dailyLimit: 2 } });
  assert.equal(set.status, 200);
  const c4 = await start(w, ADMIN, SOC, { estimatedUnits: 0 });
  const lim = await call(worker, w, 'POST', '/campaigns/chunk', { email: ADMIN, body: { schoolId: SOC, campaignId: c4.data.campaignId, chunkIndex: 0, items: many.slice(0, 2) } });
  assert.equal(lim.status, 429);
  assert.equal(lim.data.code, 'DAILY_LIMIT');
});

// ------------------------------------------------------------------ sandbox (fake SwalaSMS)
async function sandbox(w) {
  const r = await call(worker, w, 'POST', '/hq/config', { email: HQ, body: { mode: 'sandbox', sandboxSenderId: 'SWALATECH' } });
  assert.equal(r.status, 200, JSON.stringify(r.data));
}

test('sandbox: test key, UUID idempotency key, per-recipient {msg}, failures refunded', async () => {
  const w = await makeWorld();
  await sandbox(w);
  await topUp(w, SOC, 10);
  const seen = [];
  w.swala = async (url, init, body) => {
    seen.push({ url, auth: init.headers.authorization, key: init.headers['Idempotency-Key'], body });
    return { status: 202, json: { success: true, mode: 'sandbox', data: {
      uid: 'camp-1', status: 'queued', total_units: 1,
      messages: [{ to: '+255712345678', message_uid: '11111111-1111-4111-8111-111111111111', status: 'queued', units: 1 }],
      failures: [{ to: '+255755000111', reason: 'Number is undeliverable' }],
    } } };
  };
  const st = await start(w, ADMIN, SOC);
  assert.equal(st.data.senderId, 'SWALATECH');
  const r = await call(worker, w, 'POST', '/campaigns/chunk', { email: ADMIN, body: { schoolId: SOC, campaignId: st.data.campaignId, chunkIndex: 0, items: [
    { phone: '0712345678', text: 'Habari Mama Amina' }, { phone: '0755000111', text: 'Habari Baba Neema' },
  ] } });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(seen.length, 1);
  assert.equal(seen[0].url, 'https://api.swalasms.com/v2/sms/send-bulk');
  assert.equal(seen[0].auth, 'Bearer swl_test_abc');
  assert.match(seen[0].key, UUID_RE);
  assert.equal(seen[0].body.message, '{msg}');
  assert.deepEqual(seen[0].body.recipients, [{ to: '+255712345678', msg: 'Habari Mama Amina' }, { to: '+255755000111', msg: 'Habari Baba Neema' }]);
  assert.equal(seen[0].body.sender_id, 'SWALATECH');
  assert.equal(r.data.sent, 1);
  assert.equal(r.data.failed, 1);
  assert.equal(r.data.results[1].reason, 'Number is undeliverable');
  assert.equal(balance(w, SOC), 9, '2 reserved, 1 refunded');
  const kinds = w.env.DB.rows('SELECT kind, delta FROM ledger WHERE school_id = ? ORDER BY id', SOC).map((l) => `${l.kind}:${l.delta}`);
  assert.deepEqual(kinds, ['adjust:10', 'reserve:-2', 'refund:1']);
});

test('sandbox: same text for everyone is sent as one plain message', async () => {
  const w = await makeWorld();
  await sandbox(w);
  await topUp(w, SOC, 10);
  let body = null;
  w.swala = async (url, init, b) => { body = b; return { status: 202, json: { success: true, data: { messages: b.recipients.map((to, i) => ({ to, message_uid: `u${i}`, status: 'queued', units: 1 })) } } }; };
  const st = await start(w, ADMIN, SOC);
  await call(worker, w, 'POST', '/campaigns/chunk', { email: ADMIN, body: { schoolId: SOC, campaignId: st.data.campaignId, chunkIndex: 0, items: [
    { phone: '0712345678', text: 'Shule itafungwa Ijumaa.' }, { phone: '0755000111', text: 'Shule itafungwa Ijumaa.' },
  ] } });
  assert.deepEqual(body.recipients, ['+255712345678', '+255755000111']);
  assert.equal(body.message, 'Shule itafungwa Ijumaa.');
});

test('sandbox: unknown gateway answer keeps the reservation; retry reuses the SAME key and never double-charges', async () => {
  const w = await makeWorld();
  await sandbox(w);
  await topUp(w, SOC, 10);
  const keys = [];
  let attempt = 0;
  w.swala = async (url, init) => {
    keys.push(init.headers['Idempotency-Key']);
    attempt += 1;
    if (attempt === 1) return 'network';
    return { status: 202, json: { success: true, data: { idempotent_replay: false, messages: [{ to: '+255712345678', message_uid: 'u1', status: 'queued', units: 1 }] } } };
  };
  const st = await start(w, ADMIN, SOC);
  const body = { schoolId: SOC, campaignId: st.data.campaignId, chunkIndex: 0, items: [{ phone: '0712345678', text: 'Habari' }] };
  const first = await call(worker, w, 'POST', '/campaigns/chunk', { email: ADMIN, body });
  assert.equal(first.status, 202);
  assert.equal(first.data.retry, true);
  assert.equal(balance(w, SOC), 9, 'units stay reserved while unknown');
  const second = await call(worker, w, 'POST', '/campaigns/chunk', { email: ADMIN, body });
  assert.equal(second.status, 200, JSON.stringify(second.data));
  assert.equal(second.data.sent, 1);
  assert.equal(keys.length, 2);
  assert.equal(keys[0], keys[1], 'same Idempotency-Key on retry');
  assert.equal(balance(w, SOC), 9, 'charged once');
  const third = await call(worker, w, 'POST', '/campaigns/chunk', { email: ADMIN, body });
  assert.equal(third.data.replay, true);
  assert.equal(keys.length, 2, 'finished chunk is never sent again');
});

test('sandbox: gateway refusal (422) refunds everything', async () => {
  const w = await makeWorld();
  await sandbox(w);
  await topUp(w, SOC, 10);
  w.swala = async () => ({ status: 422, json: { success: false, error_code: 'INSUFFICIENT_BALANCE', message: 'Not enough units', acceptance_state: 'DEFINITELY_NOT_ACCEPTED' } });
  const st = await start(w, ADMIN, SOC);
  const r = await call(worker, w, 'POST', '/campaigns/chunk', { email: ADMIN, body: { schoolId: SOC, campaignId: st.data.campaignId, chunkIndex: 0, items: [
    { phone: '0712345678', text: 'A' }, { phone: '0755000111', text: 'B' },
  ] } });
  assert.equal(r.data.status, 'failed');
  assert.equal(r.data.failed, 2);
  assert.equal(r.data.gatewayError.code, 'INSUFFICIENT_BALANCE');
  assert.equal(balance(w, SOC), 10);
});

test('mode switch mid-campaign stops it; live is locked in Phase 2', async () => {
  const w = await makeWorld();
  await topUp(w, SOC, 10);
  const st = await start(w, ADMIN, SOC);
  await sandbox(w);
  const r = await call(worker, w, 'POST', '/campaigns/chunk', { email: ADMIN, body: { schoolId: SOC, campaignId: st.data.campaignId, chunkIndex: 0, items: [{ phone: '0712345678', text: 'A' }] } });
  assert.equal(r.data.code, 'MODE_CHANGED');
  const live = await call(worker, w, 'POST', '/hq/config', { email: HQ, body: { mode: 'live' } });
  assert.equal(live.status, 403);
  assert.equal(live.data.code, 'LIVE_LOCKED');
  const liveWallet = await call(worker, w, 'POST', '/hq/wallet/adjust', { email: HQ, body: { schoolId: SOC, bucket: 'live', units: 100 } });
  assert.equal(liveWallet.data.code, 'TEST_WALLET_ONLY');
});

test('no sender => clear refusal in sandbox', async () => {
  const w = await makeWorld();
  await call(worker, w, 'POST', '/hq/config', { email: HQ, body: { mode: 'sandbox', sandboxSenderId: '' } });
  await topUp(w, SOC, 10);
  const st = await start(w, ADMIN, SOC);
  assert.equal(st.status, 409);
  assert.equal(st.data.code, 'NO_SENDER');
  assert.match(st.data.message, /Sender ID/);
});

// ------------------------------------------------------------------ live pipe test
test('pipe test: live key, HQ test numbers only, one per minute', async () => {
  const w = await makeWorld();
  const sent = [];
  w.swala = async (url, init, body) => { sent.push({ url, auth: init.headers.authorization, body }); return { status: 202, json: { success: true, mode: 'live', data: { uid: '22222222-2222-4222-8222-222222222222', status: 'queued', units: 1 } } }; };
  const notHq = await call(worker, w, 'POST', '/hq/pipe-test', { email: ADMIN, body: { to: '0686000111', senderId: 'SWALATECH', text: 'Jaribio' } });
  assert.equal(notHq.status, 403);
  const stranger = await call(worker, w, 'POST', '/hq/pipe-test', { email: HQ, body: { to: '0712345678', senderId: 'SWALATECH', text: 'Jaribio' } });
  assert.equal(stranger.data.code, 'NOT_A_TEST_NUMBER');
  const tooLong = await call(worker, w, 'POST', '/hq/pipe-test', { email: HQ, body: { to: '0686000111', senderId: 'SWALATECH', text: 'x'.repeat(161) } });
  assert.equal(tooLong.data.code, 'BAD_TEXT');
  const ok = await call(worker, w, 'POST', '/hq/pipe-test', { email: HQ, body: { to: '+255 686 000 111', senderId: 'SWALATECH', text: 'SoMAp: jaribio la kwanza.' } });
  assert.equal(ok.status, 200, JSON.stringify(ok.data));
  assert.equal(sent.length, 1);
  assert.equal(sent[0].url, 'https://api.swalasms.com/v1/sms/messages');
  assert.equal(sent[0].auth, 'Bearer swl_live_xyz');
  assert.deepEqual(sent[0].body, { recipient: '+255686000111', sender_id: 'SWALATECH', body: 'SoMAp: jaribio la kwanza.' });
  const again = await call(worker, w, 'POST', '/hq/pipe-test', { email: HQ, body: { to: '0686000111', senderId: 'SWALATECH', text: 'Tena' } });
  assert.equal(again.status, 429);
  assert.equal(sent.length, 1);
});

test('pipe test without a live key: clear NO_LIVE_KEY, nothing recorded, no rate-limit lockout', async () => {
  const w = await makeWorld();
  delete w.env.SWALASMS_LIVE_KEY;
  const r = await call(worker, w, 'POST', '/hq/pipe-test', { email: HQ, body: { to: '0686000111', senderId: 'SWALATECH', text: 'Jaribio' } });
  assert.equal(r.data.code, 'NO_LIVE_KEY');
  assert.equal(w.env.DB.one('SELECT COUNT(*) AS n FROM pipe_tests').n, 0);
  w.env.SWALASMS_LIVE_KEY = 'swl_live_xyz';
  w.swala = async () => ({ status: 202, json: { success: true, data: { uid: '33333333-3333-4333-8333-333333333333', status: 'queued', units: 1 } } });
  const ok = await call(worker, w, 'POST', '/hq/pipe-test', { email: HQ, body: { to: '0686000111', senderId: 'SWALATECH', text: 'Jaribio' } });
  assert.equal(ok.status, 200, 'not blocked by the earlier failed attempt');
});

test('wrong key type is refused before any call', async () => {
  const w = await makeWorld();
  w.env.SWALASMS_TEST_KEY = 'swl_live_oops';
  const r = await call(worker, w, 'GET', '/hq/gateway?key=test&what=balance', { email: HQ });
  assert.equal(r.data.code, 'WRONG_TEST_KEY');
  assert.equal(w.calls.filter((c) => c.url.includes('swalasms')).length, 0);
});

// ------------------------------------------------------------------ webhook + CORS
test('webhook: signature required, status updated, replays ignored', async () => {
  const w = await makeWorld();
  await sandbox(w);
  await topUp(w, SOC, 5);
  w.swala = async () => ({ status: 202, json: { success: true, data: { messages: [{ to: '+255712345678', message_uid: 'gw-uid-1', status: 'queued', units: 1 }] } } });
  const st = await start(w, ADMIN, SOC);
  await call(worker, w, 'POST', '/campaigns/chunk', { email: ADMIN, body: { schoolId: SOC, campaignId: st.data.campaignId, chunkIndex: 0, items: [{ phone: '0712345678', text: 'Habari' }] } });

  const payload = JSON.stringify({ event: 'sms.delivered', message_id: 'gw-uid-1', to: '0712345678', status: 'delivered', timestamp: 1 });
  const post = (sig) => worker.fetch(new Request('https://x/webhook/swalasms', { method: 'POST', headers: sig ? { 'X-SwalaSMS-Signature': sig } : {}, body: payload }), w.env);
  assert.equal((await post('deadbeef')).status, 401);
  assert.equal((await post(null)).status, 401);
  const sig = bytesToHex(await hmacSha256('whsec_test', payload));
  const ok = await post(sig);
  assert.equal(ok.status, 200);
  assert.equal(w.env.DB.one("SELECT status FROM messages WHERE gateway_uid = 'gw-uid-1'").status, 'delivered');
  const dup = await (await post(sig)).json();
  assert.equal(dup.duplicate, true);
});

test('CORS: only somapv2i.com and localhost get access headers', async () => {
  const w = await makeWorld();
  const good = await call(worker, w, 'GET', '/health', { origin: 'https://somapv2i.com' });
  assert.equal(good.headers.get('access-control-allow-origin'), 'https://somapv2i.com');
  const local = await call(worker, w, 'GET', '/health', { origin: 'http://localhost:5500' });
  assert.equal(local.headers.get('access-control-allow-origin'), 'http://localhost:5500');
  const evil = await call(worker, w, 'GET', '/health', { origin: 'https://evil.example' });
  assert.equal(evil.headers.get('access-control-allow-origin'), null);
  const tricky = await call(worker, w, 'GET', '/health', { origin: 'http://localhost.evil.example:80' });
  assert.equal(tricky.headers.get('access-control-allow-origin'), null);
});
