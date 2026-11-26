import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/index.js';
import { call, makeWorld } from './helpers.js';
import snap from '../../shared/report_snapshot.js';
import core from '../../shared/sms_core.js';
import { KEY_RE, MAX_FAILS_PER_WINDOW, MAX_PDF_BYTES, newKey } from '../src/reports.js';

const SOC = 'socrates-school';
const MAP = 'mnyore-academy-dampo-map';
const ADMIN = 'admin.socrates@example.com';
const EXAM = { key: 'monthly', label: 'Monthly', month: 'Sep', year: '2026' };

// A small but real PDF byte sequence standing in for drawReportCard()'s output.
function fakePdf(tag = 'A', size = 3000) {
  const head = new TextEncoder().encode(`%PDF-1.3\n% report card ${tag}\n`);
  const out = new Uint8Array(size);
  out.set(head);
  for (let i = head.length; i < size; i++) out[i] = (i * 31 + tag.charCodeAt(0)) % 256;
  return out;
}

async function upload(w, email, schoolId, student, bytes, exam = EXAM, filename = `report_${student}_Class 4_2026_monthly_Sep.pdf`) {
  const qs = new URLSearchParams({ school: schoolId, year: exam.year, exam: exam.key, month: exam.month || '', student, filename });
  const headers = { 'content-type': 'application/pdf' };
  if (email) headers.authorization = `Bearer ${await w.token(email)}`;
  const res = await worker.fetch(new Request(`https://w.test/reports/create?${qs}`, { method: 'POST', headers, body: bytes }), w.env);
  return { status: res.status, data: await res.json() };
}
async function view(w, k, ip = '10.0.0.1', origin) {
  const headers = { 'CF-Connecting-IP': ip };
  if (origin) headers.origin = origin;
  const res = await worker.fetch(new Request(`https://w.test/r?k=${encodeURIComponent(k)}`, { headers }), w.env);
  const isPdf = /application\/pdf/.test(res.headers.get('content-type') || '');
  return { status: res.status, headers: res.headers, bytes: isPdf ? new Uint8Array(await res.arrayBuffer()) : null, data: isPdf ? null : await res.json() };
}

test('results SMS uses the card\'s printed figures: exact format, 1 SMS for one child', () => {
  const key = 'Ab3dE5gH7jK9mN';
  const one = snap.resultsSms({ school: 'Socrates School', examTitle: 'Septemba 2026', children: [{ name: 'IKRAM HAMISI', avgText: '78.5%', posLabel: '3/45', key }] });
  assert.equal(one, `Socrates School: Matokeo ya IKRAM (Septemba 2026): wastani 78.5%, nafasi 3/45. Ona ripoti: somapv2i.com/r/?k=${key}`);
  assert.equal(core.countSmsParts(one).parts, 1, `${one.length} chars`);
  const two = snap.resultsSms({ school: 'Socrates School', examTitle: 'Septemba 2026', children: [
    { name: 'AMINA JUMA', avgText: '78.5%', posLabel: '3/42', key }, { name: 'JUMA JUMA', avgText: '64.0%', posLabel: '10/40', key: 'Zz9yX8wV7uT6sR' },
  ] });
  assert.equal(two, 'Socrates School: Matokeo (Septemba 2026): AMINA 78.5% nafasi 3/42 somapv2i.com/r/?k=Ab3dE5gH7jK9mN; JUMA 64.0% nafasi 10/40 somapv2i.com/r/?k=Zz9yX8wV7uT6sR');
  assert.ok(core.countSmsParts(two).parts <= 2);
});

test('exam titles', () => {
  assert.equal(snap.examTitle({ key: 'monthly', month: 'Mar', year: 2026 }), 'Machi 2026');
  assert.equal(snap.examTitle({ key: 'annual', label: 'Annual', year: 2026 }), 'Mwaka 2026');
  assert.equal(snap.examTitle({ key: 'midterm1', label: 'Midterm 1', year: 2026 }), 'Midterm 1 2026');
  assert.equal(snap.examTitle({ key: 'endterm', label: 'End Term', year: 2026 }), 'End Term 2026');
});

test('all parent numbers: every valid number in the Student List contact fields, once each', () => {
  assert.deepEqual(snap.allParentPhones({ primaryParentContact: '0712345678/0755000111', parentPhone: '+255712345678', guardianPhone: '25571234567' }), ['255712345678', '255755000111']);
  assert.deepEqual(snap.allParentPhones({ primaryParentContact: 'N/A' }), []);
});

test('keys are 14 random base62 characters', () => {
  const seen = new Set();
  for (let i = 0; i < 2000; i++) { const k = newKey(); assert.match(k, KEY_RE); seen.add(k); }
  assert.equal(seen.size, 2000);
});

test('the link returns EXACTLY the stored report card PDF (byte for byte), same file name, no login', async () => {
  const w = await makeWorld();
  const pdf = fakePdf('A', 250000);
  const up = await upload(w, ADMIN, SOC, 'SOC-123', pdf);
  assert.equal(up.status, 200, JSON.stringify(up.data));
  assert.match(up.data.key, KEY_RE);
  assert.equal(up.data.bytes, pdf.length);
  const v = await view(w, up.data.key, '10.0.0.1', 'https://somapv2i.com');
  assert.equal(v.status, 200);
  assert.equal(v.headers.get('content-type'), 'application/pdf');
  assert.deepEqual(v.bytes, pdf, 'identical bytes');
  assert.equal(v.headers.get('x-report-filename'), 'report_SOC-123_Class 4_2026_monthly_Sep.pdf');
  assert.equal(v.headers.get('access-control-allow-origin'), 'https://somapv2i.com');
  assert.equal(v.headers.get('cache-control'), 'no-store');
  assert.match(v.headers.get('x-robots-tag'), /noindex/);
});

test('same child + exam keeps its link (shows the newest card); other exams/schools get other links', async () => {
  const w = await makeWorld();
  const first = await upload(w, ADMIN, SOC, 'SOC-1', fakePdf('A'));
  const again = await upload(w, ADMIN, SOC, 'SOC-1', fakePdf('B'));
  assert.equal(again.data.key, first.data.key);
  assert.deepEqual((await view(w, first.data.key)).bytes, fakePdf('B'), 'corrected card behind the same link');
  const otherExam = await upload(w, ADMIN, SOC, 'SOC-1', fakePdf('C'), { key: 'midterm1', label: 'Midterm 1', month: '', year: '2026' });
  assert.notEqual(otherExam.data.key, first.data.key);
  const otherSchool = await upload(w, 'acct@example.com', MAP, 'SOC-1', fakePdf('D'));
  assert.notEqual(otherSchool.data.key, first.data.key);
  assert.deepEqual((await view(w, first.data.key)).bytes, fakePdf('B'), 'never overwritten by another school');
});

test('only staff who may send can store cards; only real PDFs within the size limit', async () => {
  const w = await makeWorld();
  assert.equal((await upload(w, 'teacher@example.com', MAP, 'A', fakePdf())).data.code, 'ROLE_NOT_ALLOWED');
  assert.equal((await upload(w, 'acct@example.com', SOC, 'A', fakePdf())).data.code, 'NOT_ALLOWED');
  assert.equal((await upload(w, null, SOC, 'A', fakePdf())).status, 401);
  assert.equal((await upload(w, ADMIN, SOC, 'A', new TextEncoder().encode('<html>not a pdf</html>'))).data.code, 'BAD_PDF');
  assert.equal((await upload(w, ADMIN, SOC, 'A', fakePdf('A', MAX_PDF_BYTES + 10))).data.code, 'PDF_TOO_LARGE');
  assert.equal((await upload(w, ADMIN, SOC, '', fakePdf())).data.code, 'BAD_STUDENT');
});

test('storage guard refuses new cards before the free database is full', async () => {
  const w = await makeWorld();
  await upload(w, ADMIN, SOC, 'S1', fakePdf());
  w.env.DB.sqlite.prepare('UPDATE reports SET pdf_size = ?').run(430 * 1024 * 1024);
  const r = await upload(w, ADMIN, SOC, 'S2', fakePdf());
  assert.equal(r.status, 507);
  assert.match(r.data.message, /Wasiliana na SoMAp/);
});

test('expired links stop working after 60 days', async () => {
  const w = await makeWorld();
  const up = await upload(w, ADMIN, SOC, 'SOC-1', fakePdf());
  w.env.DB.sqlite.prepare('UPDATE reports SET expires_at = ? WHERE key = ?').run(Date.now() - 1, up.data.key);
  const v = await view(w, up.data.key);
  assert.equal(v.status, 404);
  assert.match(v.data.message, /siku 60/);
});

test('wrong keys are rate-limited per IP (then even a right key waits); other IPs unaffected', async () => {
  const w = await makeWorld();
  const good = (await upload(w, ADMIN, SOC, 'SOC-1', fakePdf())).data.key;
  for (let i = 0; i < MAX_FAILS_PER_WINDOW; i++) {
    assert.equal((await view(w, i % 2 ? newKey() : 'short', '203.0.113.9')).status, 404);
  }
  assert.equal((await view(w, good, '203.0.113.9')).status, 429, 'this IP must wait');
  assert.equal((await view(w, good, '198.51.100.7')).status, 200, 'other parents still see their reports');
  assert.ok(w.env.DB.rows('SELECT ip FROM report_guard').every((x) => !x.ip.includes('203.0.113.9')), 'IP stored only as a hash');
});

test('daily Cron cleanup deletes expired report PDFs (and old wrong-key counters), keeps live ones', async () => {
  const w = await makeWorld();
  const keep = (await upload(w, ADMIN, SOC, 'KEEP', fakePdf('K'))).data.key;
  const old = (await upload(w, ADMIN, SOC, 'OLD', fakePdf('O'))).data.key;
  w.env.DB.sqlite.prepare('UPDATE reports SET expires_at = ? WHERE key = ?').run(Date.now() - 1000, old);
  w.env.DB.sqlite.prepare('INSERT INTO report_guard (ip, window_start, fails) VALUES (?, ?, 3)').run('oldhash', Date.now() - 3 * 24 * 3600 * 1000);
  const jobs = [];
  await worker.scheduled({ cron: '0 1 * * *', scheduledTime: Date.now() }, w.env, { waitUntil: (p) => jobs.push(p) });
  await Promise.all(jobs);
  assert.deepEqual(w.env.DB.rows('SELECT key FROM reports').map((r) => r.key), [keep]);
  assert.equal(w.env.DB.rows('SELECT * FROM report_guard').length, 0);
  assert.equal((await view(w, keep)).status, 200);
});

test('SMS HQ overview shows report storage used', async () => {
  const w = await makeWorld();
  await upload(w, ADMIN, SOC, 'S1', fakePdf('A', 140000));
  await upload(w, ADMIN, SOC, 'S2', fakePdf('B', 136700));
  const r = await call(worker, w, 'GET', '/hq/overview', { email: 'hq@example.com' });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.deepEqual({ reports: r.data.reports.reports, bytes: r.data.reports.bytes }, { reports: 2, bytes: 276700 });
  assert.equal(r.data.reports.limitBytes, 420 * 1024 * 1024);
});
