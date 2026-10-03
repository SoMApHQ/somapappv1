(function (global) {
  'use strict';

  // Internal Quality Assurance (IQA) helpers shared by lesson plans, lesson notes,
  // class journal, the IQA hub and the worker check-out gate.
  //
  // Every reviewable record carries a `qa` child:
  //   { status: 'pending'|'approved'|'rejected', revision, submittedAt, submittedBy, submittedByName,
  //     decidedAt, decidedBy, decidedByName, decidedRole, comment, seenAt, seenBy, ... }
  // A teacher save always resets `qa` to a fresh pending submission (revision + 1).
  // Records saved before IQA existed have no `qa` child and are treated as pending.

  const SETTINGS_PATH = 'settings/qualityAssurance';

  const DEFAULT_CHECKOUT_RULES = Object.freeze({
    enabled: true,               // master switch for the IQA check-out gate
    blockRejected: true,         // rejected plan/notes/journal blocks check-out until resubmitted
    blockPendingToday: false,    // today's items still awaiting IQA review block check-out
    blockMissingJournal: false,  // classes taught today (per timetable) without a class journal block check-out
    lookbackDays: 14             // how far back rejected items are searched
  });

  function isIqaRole(label) {
    const text = String(label || '').toLowerCase();
    return /quality/.test(text) && /assur/.test(text);
  }

  function isHeadTeacherRole(label) {
    return String(label || '').trim().toLowerCase() === 'head teacher';
  }

  function canAccessHub(label) {
    return isIqaRole(label) || isHeadTeacherRole(label);
  }

  function normalizeStatus(qa) {
    const status = String((qa && qa.status) || '').trim().toLowerCase();
    if (status === 'approved' || status === 'rejected' || status === 'pending') return status;
    return 'pending';
  }

  function buildSubmission(previousQa, meta) {
    const prev = previousQa && typeof previousQa === 'object' ? previousQa : null;
    const info = meta || {};
    const submission = {
      status: 'pending',
      revision: Number((prev && prev.revision) || 0) + 1,
      submittedAt: Date.now(),
      submittedBy: String(info.teacherId || ''),
      submittedByName: String(info.teacherName || '')
    };
    if (prev && normalizeStatus(prev) === 'rejected') {
      submission.resubmittedAfterRejection = true;
      submission.previousRejection = {
        comment: String(prev.comment || ''),
        decidedAt: prev.decidedAt || null,
        decidedByName: String(prev.decidedByName || '')
      };
    }
    return submission;
  }

  function statusLabel(qa) {
    const status = normalizeStatus(qa);
    if (status === 'approved') return 'IQA Approved';
    if (status === 'rejected') return 'IQA Rejected - edit & resubmit';
    return qa && qa.resubmittedAfterRejection ? 'IQA: Resubmitted, awaiting review' : 'IQA: Awaiting approval';
  }

  const BADGE_STYLES = {
    approved: 'background:rgba(16,185,129,0.22);color:#a7f3d0;border:1px solid rgba(16,185,129,0.55);',
    rejected: 'background:rgba(239,68,68,0.22);color:#fecaca;border:1px solid rgba(239,68,68,0.6);',
    pending: 'background:rgba(245,158,11,0.2);color:#fde68a;border:1px solid rgba(245,158,11,0.55);'
  };

  function escapeHtml(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, (ch) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[ch]));
  }

  // Small pill for teacher-side cards. `extraClass` lets pages reuse their own meta-tag class.
  function badgeHtml(qa, extraClass) {
    const status = normalizeStatus(qa);
    const cls = extraClass ? ` class="${escapeHtml(extraClass)}"` : '';
    return `<span${cls} style="${BADGE_STYLES[status]}font-weight:700;">${escapeHtml(statusLabel(qa))}</span>`;
  }

  // Rejection reason block for teacher-side cards; empty string unless rejected.
  function rejectionNoteHtml(qa) {
    if (normalizeStatus(qa) !== 'rejected') return '';
    const who = qa.decidedByName ? ` by ${escapeHtml(qa.decidedByName)}` : '';
    const when = qa.decidedAt ? ` on ${escapeHtml(new Date(Number(qa.decidedAt)).toLocaleString('en-GB'))}` : '';
    return `<p style="margin-top:8px;padding:10px 12px;border-radius:10px;background:rgba(239,68,68,0.14);border:1px solid rgba(239,68,68,0.45);color:#fecaca;">
      <strong>Rejected${who}${when}:</strong> ${escapeHtml(qa.comment || 'No reason given.')}<br>
      <em>Edit this record and save it again to resubmit it to the Internal Quality Assurer. Check-out stays blocked until you do.</em>
    </p>`;
  }

  function mergeCheckoutRules(raw) {
    const source = raw && typeof raw === 'object' ? raw : {};
    const rules = Object.assign({}, DEFAULT_CHECKOUT_RULES);
    ['enabled', 'blockRejected', 'blockPendingToday', 'blockMissingJournal'].forEach((key) => {
      if (typeof source[key] === 'boolean') rules[key] = source[key];
    });
    const lookback = Number(source.lookbackDays);
    if (Number.isFinite(lookback) && lookback >= 1 && lookback <= 60) rules.lookbackDays = Math.round(lookback);
    return rules;
  }

  // schoolRefFn: (subPath) => firebase.database.Reference, already school-scoped.
  async function loadCheckoutRules(schoolRefFn) {
    try {
      const snap = await schoolRefFn(`${SETTINGS_PATH}/checkout`).once('value');
      return mergeCheckoutRules(snap.val());
    } catch (error) {
      console.warn('IQA settings load failed, using defaults', error);
      return Object.assign({}, DEFAULT_CHECKOUT_RULES);
    }
  }

  function ymdFromTs(ts) {
    const d = new Date(Number(ts || 0));
    if (Number.isNaN(d.getTime()) || !Number(ts)) return '';
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }

  // The working date a lesson-notes record belongs to.
  function noteDate(note) {
    const ctx = String((note && note.lessonDateContext) || '').trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(ctx)) return ctx;
    return ymdFromTs((note && (note.updatedAt || note.createdAt)) || 0);
  }

  global.SomapQA = {
    SETTINGS_PATH,
    DEFAULT_CHECKOUT_RULES,
    isIqaRole,
    isHeadTeacherRole,
    canAccessHub,
    normalizeStatus,
    buildSubmission,
    statusLabel,
    badgeHtml,
    rejectionNoteHtml,
    mergeCheckoutRules,
    loadCheckoutRules,
    escapeHtml,
    ymdFromTs,
    noteDate
  };
})(window);
