// Matokeo report cards (D1 only, never Firebase).
//
// The report card is the EXACT A4 PDF that Toacademichtml/generatereportform.html
// draws with its own drawReportCard() — the same file its "Download PDF" gives.
// The Worker only stores those bytes and hands them back for the right key.
//
//  POST /reports/create?school=&year=&exam=&month=&student=&filename=   (staff who may send)
//       body = the PDF bytes themselves (no re-encoding, no CPU-heavy decoding)
//       -> { key }        one key per school + student + exam, kept on re-send
//  GET  /r?k=KEY         (public, no login) -> that ONE PDF, if not expired
//
// Keys: 14 random base62 characters (~83 bits). Wrong keys are rate-limited per IP
// (stored only as a hash). Links expire after 60 days.
import { HttpError, json } from './http.js';
import { getSchoolSettings } from './db.js';
import { assertCanSend } from './send.js';
import { sha256Hex } from './util.js';

export const KEY_LENGTH = 14;
export const KEY_RE = /^[A-Za-z0-9]{14}$/;
export const TTL_MS = 60 * 24 * 3600 * 1000;
export const MAX_PDF_BYTES = 1800000;                  // D1 value limit is 2 MB
export const STORAGE_LIMIT_BYTES = 420 * 1024 * 1024;  // stop well before the free 500 MB database cap
export const FAIL_WINDOW_MS = 10 * 60 * 1000;
export const MAX_FAILS_PER_WINDOW = 20;
const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';

export function newKey() {
  let out = '';
  while (out.length < KEY_LENGTH) {
    const bytes = crypto.getRandomValues(new Uint8Array(32));
    for (const b of bytes) {
      if (b < 248 && out.length < KEY_LENGTH) out += ALPHABET[b % 62]; // 248 = 4*62: no modulo bias
    }
  }
  return out;
}

const s = (v, max) => String(v === null || v === undefined ? '' : v).replace(/\s+/g, ' ').trim().slice(0, max);

function examId(exam) {
  return [s(exam.year, 4), s(exam.key, 40), s(exam.month, 3)].join('|');
}

export async function createReport(env, staff, request) {
  assertCanSend(staff, await getSchoolSettings(env.DB, staff.schoolId));
  const q = new URL(request.url).searchParams;
  const exam = { key: q.get('exam'), month: q.get('month') || '', year: q.get('year') };
  if (!/^\d{4}$/.test(String(exam.year || '')) || !s(exam.key, 40)) {
    throw new HttpError(400, 'BAD_EXAM', 'Chagua mwaka na aina ya mtihani.', 'year (YYYY) and exam are required.');
  }
  const ref = s(q.get('student'), 80);
  if (!ref) throw new HttpError(400, 'BAD_STUDENT', 'Mwanafunzi hajulikani.', 'student is required.');
  if (Number(request.headers.get('content-length') || 0) > MAX_PDF_BYTES) {
    throw new HttpError(413, 'PDF_TOO_LARGE', 'Ripoti ni kubwa mno (zaidi ya MB 1.8).', 'PDF larger than 1.8 MB.');
  }
  const pdf = new Uint8Array(await request.arrayBuffer());
  if (pdf.length > MAX_PDF_BYTES) throw new HttpError(413, 'PDF_TOO_LARGE', 'Ripoti ni kubwa mno (zaidi ya MB 1.8).', 'PDF larger than 1.8 MB.');
  if (pdf.length < 5 || String.fromCharCode(pdf[0], pdf[1], pdf[2], pdf[3], pdf[4]) !== '%PDF-') {
    throw new HttpError(400, 'BAD_PDF', 'Faili la ripoti si PDF.', 'Body is not a PDF file.');
  }
  const filename = (s(q.get('filename'), 160).replace(/[^A-Za-z0-9._ -]+/g, '_') || 'report.pdf');

  const db = env.DB;
  const t = Date.now();
  await db.batch([
    db.prepare('DELETE FROM reports WHERE expires_at < ?1').bind(t),
    db.prepare('DELETE FROM report_guard WHERE window_start < ?1').bind(t - 24 * 3600 * 1000),
  ]);
  const used = await db.prepare('SELECT COALESCE(SUM(pdf_size), 0) AS bytes FROM reports').first();
  if (Number(used?.bytes || 0) + pdf.length > STORAGE_LIMIT_BYTES) {
    throw new HttpError(507, 'STORAGE_FULL', 'Hifadhi ya ripoti imejaa kwa sasa. Wasiliana na SoMAp.', 'Report storage is full.');
  }
  const row = await db.prepare(
    `INSERT INTO reports (key, school_id, student_ref, exam_id, pdf, pdf_size, filename, created_by, created_at, updated_at, expires_at, views)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?9, ?10, 0)
     ON CONFLICT(school_id, student_ref, exam_id) DO UPDATE SET pdf = excluded.pdf, pdf_size = excluded.pdf_size, filename = excluded.filename,
       updated_at = excluded.updated_at, expires_at = excluded.expires_at, created_by = excluded.created_by
     RETURNING key`
  ).bind(newKey(), staff.schoolId, ref, examId(exam), pdf, pdf.length, filename, staff.email, t, t + TTL_MS).first();
  return { ok: true, key: row.key, bytes: pdf.length, expiresAt: t + TTL_MS };
}

async function ipHash(request) {
  const ip = request.headers.get('CF-Connecting-IP') || request.headers.get('x-real-ip') || 'unknown';
  return (await sha256Hex('somap-report-ip:' + ip)).slice(0, 32);
}

const PUBLIC_HEADERS = { 'x-robots-tag': 'noindex, nofollow', 'referrer-policy': 'no-referrer' };

export async function getReport(request, env) {
  const db = env.DB;
  const key = String(new URL(request.url).searchParams.get('k') || '').trim();
  const t = Date.now();
  const windowStart = Math.floor(t / FAIL_WINDOW_MS) * FAIL_WINDOW_MS;
  const who = await ipHash(request);
  const guard = await db.prepare('SELECT fails FROM report_guard WHERE ip = ?1 AND window_start = ?2').bind(who, windowStart).first();
  if (Number(guard?.fails || 0) >= MAX_FAILS_PER_WINDOW) {
    return json({ ok: false, code: 'TOO_MANY_TRIES', message: 'Majaribio mengi mno. Jaribu tena baada ya dakika 10.' }, 429, { ...PUBLIC_HEADERS, 'retry-after': '600' });
  }
  const row = KEY_RE.test(key)
    ? await db.prepare('SELECT pdf, filename, expires_at FROM reports WHERE key = ?1 AND expires_at > ?2').bind(key, t).first()
    : null;
  if (!row) {
    await db.prepare('INSERT INTO report_guard (ip, window_start, fails) VALUES (?1, ?2, 1) ON CONFLICT(ip, window_start) DO UPDATE SET fails = fails + 1')
      .bind(who, windowStart).run();
    return json({ ok: false, code: 'NOT_FOUND', message: 'Ripoti haipatikani au muda wake umekwisha (siku 60).' }, 404, PUBLIC_HEADERS);
  }
  await db.prepare('UPDATE reports SET views = views + 1, last_view_at = ?2 WHERE key = ?1').bind(key, t).run();
  const bytes = row.pdf instanceof Uint8Array ? row.pdf : new Uint8Array(row.pdf);
  const filename = String(row.filename || 'report.pdf').replace(/"/g, '');
  return new Response(bytes, {
    status: 200,
    headers: {
      ...PUBLIC_HEADERS,
      'content-type': 'application/pdf',
      'content-disposition': `inline; filename="${filename}"`,
      'cache-control': 'no-store',
      'x-report-expires': String(row.expires_at),
      'x-report-filename': filename,
      'access-control-expose-headers': 'x-report-expires, x-report-filename',
    },
  });
}

/** Daily cleanup (Cron Trigger): remove expired report PDFs and old wrong-key counters. */
export async function cleanupReports(env, now = Date.now()) {
  const db = env.DB;
  const res = await db.batch([
    db.prepare('DELETE FROM reports WHERE expires_at < ?1').bind(now),
    db.prepare('DELETE FROM report_guard WHERE window_start < ?1').bind(now - 24 * 3600 * 1000),
  ]);
  return { reportsDeleted: Number(res[0]?.meta?.changes || 0), guardRowsDeleted: Number(res[1]?.meta?.changes || 0) };
}

/** Storage used by live report PDFs (for the SMS HQ page). */
export async function reportStorage(env) {
  try {
    const row = await env.DB.prepare('SELECT COUNT(*) AS n, COALESCE(SUM(pdf_size), 0) AS bytes FROM reports WHERE expires_at > ?1').bind(Date.now()).first();
    return { reports: Number(row?.n || 0), bytes: Number(row?.bytes || 0), limitBytes: STORAGE_LIMIT_BYTES };
  } catch (_) {
    return { reports: 0, bytes: 0, limitBytes: STORAGE_LIMIT_BYTES, notReady: true }; // before db:init
  }
}
