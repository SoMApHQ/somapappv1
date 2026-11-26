import test from 'node:test';
import assert from 'node:assert/strict';
import SomapSms from '../../smshtml/sms-service.js';
import report from '../../smshtml/phone-report.js';

// A fake Worker that behaves like the real one for the client's purposes.
function fakeWorker({ chunkScript = {} } = {}) {
  const calls = [];
  const fetchImpl = async (url, init = {}) => {
    const path = url.replace('https://w.test', '');
    const body = init.body ? JSON.parse(init.body) : null;
    calls.push({ path, body, auth: init.headers && init.headers.authorization });
    const reply = (status, data) => ({ ok: status >= 200 && status < 300, status, json: async () => data });
    if (path === '/campaigns/start') return reply(200, { ok: true, campaignId: 'camp-1', mode: 'sandbox', senderId: 'UPDATE' });
    if (path === '/campaigns/finish') return reply(200, { ok: true });
    if (path === '/campaigns/chunk') {
      const script = chunkScript[body.chunkIndex] || [];
      const attempt = calls.filter((c) => c.path === '/campaigns/chunk' && c.body.chunkIndex === body.chunkIndex).length - 1;
      const step = script[attempt] || 'ok';
      if (step === 'network') throw new TypeError('Failed to fetch');
      if (step === 'unknown') return reply(202, { ok: false, retry: true, status: 'unknown' });
      if (step === 'broke') return reply(402, { ok: false, code: 'INSUFFICIENT_BALANCE', message: 'Salio halitoshi', required: 50, balance: 3 });
      return reply(200, {
        ok: true, status: 'done', unitsUsed: body.items.length, walletBalance: 1000 - body.items.length,
        results: body.items.map((it, index) => ({ index, phone: it.phone, status: it.text.includes('FAIL') ? 'failed' : (it.text.includes('UNK') ? 'unknown' : 'queued'), units: it.text.includes('FAIL') ? 0 : 1, reason: it.text.includes('FAIL') ? 'Number is undeliverable' : null })),
        rejected: [],
      });
    }
    return reply(404, { ok: false, code: 'NOT_FOUND' });
  };
  return { calls, client: SomapSms.create({ workerUrl: 'https://w.test', fetch: fetchImpl, getIdToken: async () => 'tok', sleep: async () => {}, retryDelaysMs: [1, 1, 1] }) };
}

const msgs = (n, text = (i) => `Habari ${i}`) => Array.from({ length: n }, (_, i) => ({ phone: `0712${String(i).padStart(6, '0')}`, text: text(i), ref: `S${i}` }));

test('splits into chunks of 200, keeps refs in order, finishes the campaign', async () => {
  const { calls, client } = fakeWorker();
  const progress = [];
  const r = await client.sendAll({ schoolId: 'socrates-school', purpose: 'general', name: 'T', messages: msgs(450), onProgress: (p) => progress.push(p.done) });
  const chunks = calls.filter((c) => c.path === '/campaigns/chunk');
  assert.deepEqual(chunks.map((c) => [c.body.chunkIndex, c.body.items.length]), [[0, 200], [1, 200], [2, 50]]);
  assert.equal(calls[0].path, '/campaigns/start');
  assert.equal(calls[0].body.estimatedUnits, 450);
  assert.equal(calls.at(-1).path, '/campaigns/finish');
  assert.ok(calls.every((c) => c.auth === 'Bearer tok'));
  assert.equal(r.sent, 450);
  assert.equal(r.rows[449].ref, 'S449');
  assert.equal(r.rows[449].status, 'queued');
  assert.deepEqual(progress, [0, 200, 400, 450]);
});

test('retries the SAME chunk after network loss and unknown answers', async () => {
  const { calls, client } = fakeWorker({ chunkScript: { 0: ['network', 'unknown', 'ok'] } });
  const r = await client.sendAll({ schoolId: 's', purpose: 'general', messages: msgs(3) });
  const chunkCalls = calls.filter((c) => c.path === '/campaigns/chunk');
  assert.equal(chunkCalls.length, 3);
  assert.ok(chunkCalls.every((c) => c.body.chunkIndex === 0 && c.body.items.length === 3), 'same chunk each time');
  assert.equal(r.sent, 3);
  assert.equal(r.stoppedBy, null);
});

test('stops on a wallet problem and reports exactly what was not sent', async () => {
  const { calls, client } = fakeWorker({ chunkScript: { 1: ['broke'] } });
  const r = await client.sendAll({ schoolId: 's', purpose: 'fee_reminder', messages: msgs(250) });
  assert.equal(r.stoppedBy.code, 'INSUFFICIENT_BALANCE');
  assert.equal(r.stoppedBy.chunkIndex, 1);
  assert.equal(r.sent, 200);
  assert.equal(r.notSent, 50);
  assert.equal(calls.filter((c) => c.path === '/campaigns/chunk').length, 2, 'no further chunks after the stop');
  assert.equal(calls.at(-1).path, '/campaigns/finish');
});

test('retry list = failed + never sent, but NEVER "unknown" (could double-send)', async () => {
  const { client } = fakeWorker();
  const r = await client.sendAll({ schoolId: 's', purpose: 'general', messages: [
    { phone: '0712000001', text: 'ok', ref: 'A' }, { phone: '0712000002', text: 'FAIL', ref: 'B' }, { phone: '0712000003', text: 'UNK', ref: 'C' },
  ] });
  assert.equal(r.failed, 1);
  assert.deepEqual(client.retryable(r).map((m) => m.ref), ['B']);
});

test('start refusal (e.g. NO_SENDER) surfaces as a clear error', async () => {
  const fetchImpl = async () => ({ ok: false, status: 409, json: async () => ({ ok: false, code: 'NO_SENDER', message: 'Jina la mtumaji halijaidhinishwa' }) });
  const client = SomapSms.create({ workerUrl: 'https://w.test', fetch: fetchImpl, getIdToken: async () => 't' });
  await assert.rejects(client.sendAll({ schoolId: 's', purpose: 'general', messages: msgs(1) }), (e) => e.code === 'NO_SENDER' && e.status === 409);
});

test('CSV keeps the leading 0, quotes commas and starts with a BOM', () => {
  assert.equal(SomapSms.displayPhone('255712345678'), '0712 345 678');
  const csv = SomapSms.reportCsv({ rows: [{ ref: 'S1', phone: '+255712345678', status: 'failed', reason: 'DUPLICATE_24H', units: 0, text: 'Habari, mzazi "Amina"' }] });
  assert.ok(csv.startsWith('﻿'));
  assert.match(csv, /0712 345 678,Imeshindwa,Ujumbe huu huu ulishatumwa/);
  assert.match(csv, /"Habari, mzazi ""Amina"""/);
});

test('phone report: counts and problems match the real SoMAp shapes', () => {
  const rows = [
    { admissionNumber: '1', fullName: 'A', classLevel: 'Class 1', parentContact: '0712345678', rawStudent: { primaryParentName: 'Mama A' } },
    { admissionNumber: '2', fullName: 'B', classLevel: 'Class 1', parentContact: '0712345678', rawStudent: { primaryParentName: 'Mama A' } },
    { admissionNumber: '3', fullName: 'C', classLevel: 'Class 2', parentContact: 'N/A', rawStudent: {} },
    { admissionNumber: '4', fullName: 'D', classLevel: 'Class 2', parentContact: '25571234567', rawStudent: { primaryParentName: 'X' } },
    { admissionNumber: '5', fullName: 'E', classLevel: 'Class 3', parentContact: '2550766000222', rawStudent: { primaryParentName: 'Y' } },
    { admissionNumber: '6', fullName: 'F', classLevel: 'Class 3', parentContact: '0677123456/0712000999', rawStudent: {} },
  ];
  const r = report.buildPhoneReport(rows);
  assert.deepEqual(r.counts, { total: 6, valid: 4, missing: 1, invalid: 1, fixed: 1, multiple: 1, noParentName: 1 });
  assert.equal(r.uniquePhones, 3);
  assert.equal(r.familiesWithSeveralChildren, 1);
  assert.deepEqual(r.problems.map((p) => [p.admissionNumber, p.kind]), [['3', 'MISSING'], ['4', 'INVALID'], ['5', 'FIXED_2550'], ['6', 'MULTIPLE_NUMBERS'], ['6', 'NO_PARENT_NAME']]);
  assert.equal(r.problems.find((p) => p.kind === 'FIXED_2550').sendTo, '0766000222');
});
