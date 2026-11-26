// Saved message templates (Violezo), per school, in D1.
// Reading: any staff member of the school. Saving/deleting: roles allowed to send.
import { HttpError } from './http.js';
import { getSchoolSettings } from './db.js';
import { assertCanSend } from './send.js';

const PURPOSES = ['general', 'fee_reminder', 'invitation', 'other'];
const MAX_PER_SCHOOL = 50;

function assertBelongs(staff) {
  if (!staff.belongs) throw new HttpError(403, 'NOT_ALLOWED', 'Huna ruhusa kwa shule hii.', 'Not a member of this school.');
}

export async function listTemplates(env, staff) {
  assertBelongs(staff);
  const { results } = await env.DB.prepare(
    'SELECT id, name, purpose, body, created_by, updated_by, updated_at FROM templates WHERE school_id = ?1 ORDER BY updated_at DESC LIMIT ?2'
  ).bind(staff.schoolId, MAX_PER_SCHOOL).all();
  return { ok: true, templates: results || [] };
}

export async function saveTemplate(env, staff, body) {
  assertCanSend(staff, await getSchoolSettings(env.DB, staff.schoolId));
  const name = String(body.name || '').trim().slice(0, 60);
  const text = String(body.body || '').trim();
  const purpose = PURPOSES.includes(body.purpose) ? body.purpose : 'other';
  if (!name) throw new HttpError(400, 'NO_NAME', 'Weka jina la kiolezo.', 'Template name is required.');
  if (!text || text.length > 1600) throw new HttpError(400, 'BAD_BODY', 'Ujumbe wa kiolezo uwe na herufi 1 hadi 1600.', 'Template body must be 1-1600 characters.');
  const t = Date.now();
  const id = String(body.id || '');
  if (id) {
    const r = await env.DB.prepare('UPDATE templates SET name = ?3, purpose = ?4, body = ?5, updated_by = ?6, updated_at = ?7 WHERE id = ?1 AND school_id = ?2')
      .bind(id, staff.schoolId, name, purpose, text, staff.email, t).run();
    if (Number(r.meta?.changes || 0) !== 1) throw new HttpError(404, 'NO_TEMPLATE', 'Kiolezo hakipo.', 'Template not found.');
    return { ok: true, id };
  }
  const count = await env.DB.prepare('SELECT COUNT(*) AS n FROM templates WHERE school_id = ?1').bind(staff.schoolId).first();
  if (Number(count?.n || 0) >= MAX_PER_SCHOOL) throw new HttpError(409, 'TOO_MANY', `Kikomo ni violezo ${MAX_PER_SCHOOL} kwa shule.`, 'Too many templates.');
  const newId = crypto.randomUUID();
  await env.DB.prepare('INSERT INTO templates (id, school_id, name, purpose, body, created_by, created_at, updated_by, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?6, ?7)')
    .bind(newId, staff.schoolId, name, purpose, text, staff.email, t).run();
  return { ok: true, id: newId };
}

export async function deleteTemplate(env, staff, body) {
  assertCanSend(staff, await getSchoolSettings(env.DB, staff.schoolId));
  const r = await env.DB.prepare('DELETE FROM templates WHERE id = ?1 AND school_id = ?2').bind(String(body.id || ''), staff.schoolId).run();
  return { ok: Number(r.meta?.changes || 0) === 1 };
}
