(function (global) {
  'use strict';

  const Shared = global.SoMApExamShared || global.SoMApExamTemplateEngine;

  function compactText(value) {
    return Shared ? Shared.compactText(value) : String(value == null ? '' : value).replace(/\s+/g, ' ').trim();
  }

  function sanitizeKey(value) {
    return Shared ? Shared.sanitizeKey(value) : compactText(value).replace(/\s+/g, '_');
  }

  function currentSchoolId() {
    return Shared ? Shared.currentSchoolId() : (global.localStorage?.getItem('somap.currentSchoolId') || 'socrates-school');
  }

  function currentYear() {
    return Shared ? Shared.currentYear() : String(new Date().getFullYear());
  }

  function scopedPath(path, schoolId) {
    return Shared ? Shared.scopedPath(path, schoolId) : path;
  }

  function getDb() {
    return Shared ? Shared.getDb() : (global.db || global.firebase?.database?.() || null);
  }

  function buildMonthKey(dateValue) {
    const date = dateValue instanceof Date ? dateValue : new Date(dateValue || Date.now());
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    return `${year}-${month}`;
  }

  function compactMonthKey(monthKey) {
    return compactText(monthKey || '').replace('-', '');
  }

  function resolveSchedule(generalSettings, template) {
    const templateSchedule = template?.settings?.schedule || null;
    const defaultSchedule = generalSettings?.schedule || { mode: 'day_of_month', dayOfMonth: 27 };
    return templateSchedule && templateSchedule.mode ? templateSchedule : defaultSchedule;
  }

  function shouldGenerateNow(options) {
    const settings = options && typeof options === 'object' ? options : {};
    const schedule = settings.schedule || { mode: 'day_of_month', dayOfMonth: 27 };
    const now = settings.now instanceof Date ? settings.now : new Date();
    const monthKey = compactText(settings.monthKey || buildMonthKey(now));
    const firstDay = new Date(`${monthKey}-01T00:00:00`);
    if (Number.isNaN(firstDay.getTime())) {
      return { eligible: false, reason: 'Invalid month key.' };
    }
    if (schedule.mode === 'exact_date') {
      const exact = compactText(schedule.exactDate || '');
      if (!exact) return { eligible: false, reason: 'Exact generation date is missing.' };
      return {
        eligible: now >= new Date(`${exact}T00:00:00`) && exact.slice(0, 7) === monthKey,
        reason: exact.slice(0, 7) !== monthKey ? 'Exact date is outside the selected month.' : ''
      };
    }
    const day = Math.min(31, Math.max(1, Number(schedule.dayOfMonth || 27) || 27));
    return {
      eligible: now.getFullYear() === firstDay.getFullYear() && (now.getMonth() + 1) === (firstDay.getMonth() + 1) && now.getDate() >= day,
      reason: ''
    };
  }

  function generationStatePath(options) {
    const settings = options && typeof options === 'object' ? options : {};
    const schoolId = compactText(settings.schoolId || currentSchoolId());
    const year = String(settings.year || currentYear());
    const monthKey = compactMonthKey(settings.monthKey || buildMonthKey(new Date()));
    const classKey = sanitizeKey(settings.className || settings.classKey || '');
    const subjectKey = sanitizeKey(settings.subject || settings.subjectKey || '');
    const formatKey = sanitizeKey(settings.formatId || settings.templateId || '');
    return scopedPath(`years/${year}/examGenerationState/${monthKey}/${classKey}/${subjectKey}/${formatKey}`, schoolId);
  }

  async function readGenerationState(options) {
    const db = getDb();
    if (!db) return null;
    const snap = await db.ref(generationStatePath(options)).once('value').catch(() => ({ val: () => null }));
    return (snap && typeof snap.val === 'function' && snap.val()) || null;
  }

  async function writeGenerationState(options, patch) {
    const db = getDb();
    if (!db) return null;
    const payload = patch && typeof patch === 'object' ? patch : {};
    await db.ref(generationStatePath(options)).update(payload);
    return payload;
  }

  async function runPendingGeneration(options) {
    const settings = options && typeof options === 'object' ? options : {};
    const templates = Array.isArray(settings.templates) ? settings.templates : [];
    const generalSettings = settings.generalSettings || {};
    const now = settings.now instanceof Date ? settings.now : new Date();
    const monthKey = compactText(settings.monthKey || buildMonthKey(now));
    const generated = [];
    for (const template of templates) {
      const resolvedMonthKey = compactText(
        typeof settings.resolveMonthKey === 'function'
          ? settings.resolveMonthKey(template, monthKey)
          : (template?.monthKey || monthKey)
      ) || monthKey;
      const schedule = resolveSchedule(generalSettings, template);
      const eligibility = shouldGenerateNow({ schedule, now, monthKey: resolvedMonthKey });
      if (!eligibility.eligible && !settings.forceEligible) continue;
      const existingState = await readGenerationState({
        schoolId: settings.schoolId,
        year: settings.year,
        monthKey: resolvedMonthKey,
        className: template.className,
        subject: template.subject,
        formatId: template.formatId || template.id
      });
      if (existingState?.lastGeneratedPaperId) continue;
      if (typeof settings.generateDraft !== 'function') continue;
      const result = await settings.generateDraft(template, resolvedMonthKey);
      if (result?.paper?.id) generated.push(result.paper.id);
    }
    return generated;
  }

  const api = {
    buildMonthKey,
    compactMonthKey,
    resolveSchedule,
    shouldGenerateNow,
    readGenerationState,
    writeGenerationState,
    runPendingGeneration
  };

  global.SoMApExamScheduler = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
