/*
 * SoMAp Mawasiliano — browser client for the SMS Worker.
 * Load AFTER shared/sms_core.js and Firebase auth. Exposes window.SomapSms.
 *
 * It never reads or writes Firebase data and never touches finance. It only:
 *   - attaches the logged-in user's Google ID token to Worker calls;
 *   - sends a prepared list of { phone, text, ref } in chunks of up to 200,
 *     retrying the SAME chunk on network trouble (the Worker's idempotency key
 *     makes that safe — no SMS is ever sent twice);
 *   - stops cleanly on wallet / daily-limit / mode problems and reports what
 *     was not sent, so "retry failed" can pick it up.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('../shared/sms_core.js'));
  else root.SomapSms = factory(root.SomapSmsCore);
})(typeof self !== 'undefined' ? self : this, function (core) {
  'use strict';
  if (!core) throw new Error('SomapSms needs shared/sms_core.js loaded first.');

  const DEFAULT_WORKER_URL = 'https://somap-sms.somap.workers.dev';
  const CHUNK_SIZE = 200;
  const RETRY_DELAYS_MS = [2000, 5000, 10000, 20000];
  const REQUEST_TIMEOUT_MS = 45000;

  const STATUS_SW = {
    dryrun: 'Dry-run (haikutumwa)',
    pending: 'Inasubiri',
    queued: 'Imepangwa kutumwa',
    processing: 'Inatumwa',
    scheduled: 'Imepangwa',
    sent: 'Imetumwa',
    delivered: 'Imefika',
    failed: 'Imeshindwa',
    rejected: 'Imekataliwa',
    unknown: 'Haijulikani',
    not_sent: 'Haikutumwa',
  };
  const REASON_SW = {
    PHONE_MISSING: 'Hakuna namba ya mzazi',
    PHONE_INVALID: 'Namba si sahihi',
    EMPTY_MESSAGE: 'Ujumbe mtupu',
    PLACEHOLDER_UNFILLED: 'Ujumbe una nafasi { } isiyojazwa',
    TOO_LONG: 'Ujumbe ni mrefu mno',
    TOO_MANY_PARTS: 'Ujumbe ni mrefu mno (zaidi ya SMS 6)',
    DUPLICATE_IN_SEND: 'Namba imerudiwa katika utumaji huu',
    DUPLICATE_24H: 'Ujumbe huu huu ulishatumwa kwa namba hii ndani ya saa 24',
    NOT_IN_GATEWAY_RESPONSE: 'Mtoa huduma hakutoa jibu kwa namba hii',
  };

  class SmsError extends Error {
    constructor(status, code, message, messageEn, data) {
      super(message || code);
      this.status = status;
      this.code = code;
      this.messageEn = messageEn || '';
      this.data = data || null;
    }
  }

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  function create(options) {
    const opts = options || {};
    const workerUrl = String(opts.workerUrl || (typeof window !== 'undefined' && window.SOMAP_SMS_WORKER_URL) || DEFAULT_WORKER_URL).replace(/\/+$/, '');
    const fetchImpl = opts.fetch || ((...a) => fetch(...a));
    const delays = opts.retryDelaysMs || RETRY_DELAYS_MS;
    const wait = opts.sleep || sleep;

    async function idToken() {
      if (opts.getIdToken) return opts.getIdToken();
      const auth = typeof firebase !== 'undefined' && firebase.auth ? firebase.auth() : null;
      if (!auth) throw new SmsError(0, 'NO_AUTH', 'Firebase login haijapakiwa.', 'Firebase auth not loaded.');
      const user = auth.currentUser || await new Promise((resolve) => {
        const t = setTimeout(() => { off(); resolve(null); }, 8000);
        const off = auth.onAuthStateChanged((u) => { if (u) { clearTimeout(t); off(); resolve(u); } });
      });
      if (!user) throw new SmsError(401, 'NOT_LOGGED_IN', 'Tafadhali ingia (login) tena.', 'Please sign in again.');
      return user.getIdToken();
    }

    async function api(method, path, body) {
      const headers = { 'content-type': 'application/json', authorization: 'Bearer ' + (await idToken()) };
      const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
      const timer = ctrl ? setTimeout(() => ctrl.abort(), REQUEST_TIMEOUT_MS) : null;
      let res;
      try {
        res = await fetchImpl(workerUrl + path, { method, headers, body: body ? JSON.stringify(body) : undefined, signal: ctrl ? ctrl.signal : undefined });
      } catch (err) {
        throw new SmsError(0, 'NETWORK', 'Mtandao umekatika au ni wa polepole. Jaribu tena.', String(err && err.message || err));
      } finally {
        if (timer) clearTimeout(timer);
      }
      const data = await res.json().catch(() => ({}));
      if (res.status === 202 && data && data.retry) return { ...data, _status: 202 };
      if (!res.ok || data.ok === false) throw new SmsError(res.status, data.code || 'HTTP_' + res.status, data.message, data.messageEn, data);
      return { ...data, _status: res.status };
    }

    const q = (schoolId) => 'school=' + encodeURIComponent(schoolId || '');

    /**
     * Send prepared messages. messages: [{ phone, text, ref }] — ONE per phone,
     * already filled in. Returns a full report; never throws for per-message problems.
     */
    async function sendAll({ schoolId, purpose, name, messages, onProgress, chunkSize }) {
      const size = Math.min(CHUNK_SIZE, Math.max(1, Number(chunkSize) || CHUNK_SIZE));
      const rows = (messages || []).map((m, i) => ({ i, ref: m.ref === undefined ? String(i) : String(m.ref), phone: String(m.phone || ''), text: String(m.text || ''), status: 'not_sent', reason: null, units: 0 }));
      const report = { campaignId: null, total: rows.length, sent: 0, failed: 0, rejected: 0, notSent: 0, unitsUsed: 0, walletBalance: null, mode: null, stoppedBy: null, rows };
      if (!rows.length) return finalise(report);

      const estimatedUnits = rows.reduce((s, r) => s + core.countSmsParts(r.text).parts, 0);
      const started = await api('POST', '/campaigns/start', { schoolId, purpose, name, estimatedRecipients: rows.length, estimatedUnits });
      report.campaignId = started.campaignId;
      report.mode = started.mode;
      report.senderId = started.senderId;

      const chunks = [];
      for (let s = 0; s < rows.length; s += size) chunks.push(rows.slice(s, s + size));
      const progress = (chunkIndex) => {
        if (typeof onProgress === 'function') {
          const done = rows.filter((r) => r.status !== 'not_sent').length;
          onProgress({ done, total: rows.length, chunkIndex, chunks: chunks.length, sent: report.sent, failed: report.failed, rejected: report.rejected });
        }
      };
      progress(-1);

      for (let c = 0; c < chunks.length; c++) {
        const items = chunks[c].map((r) => ({ phone: r.phone, text: r.text, ref: r.ref }));
        let result = null;
        for (let attempt = 0; attempt <= delays.length; attempt++) {
          try {
            result = await api('POST', '/campaigns/chunk', { schoolId, campaignId: report.campaignId, chunkIndex: c, items });
            if (result._status === 202 && result.retry) {
              result = null;
              if (attempt < delays.length) await wait(delays[attempt]);
              continue;
            }
            break;
          } catch (err) {
            const retryable = err.code === 'NETWORK' || err.code === 'CHUNK_IN_PROGRESS' || err.status >= 500;
            if (retryable && attempt < delays.length) { await wait(delays[attempt]); continue; }
            report.stoppedBy = { code: err.code, message: err.message, messageEn: err.messageEn, data: err.data, chunkIndex: c };
            break;
          }
        }
        if (!result) {
          if (!report.stoppedBy) report.stoppedBy = { code: 'GATEWAY_UNKNOWN', message: 'Hatukupata jibu la uhakika. Bonyeza "Jaribu tena" baadaye — hakuna SMS itakayotumwa mara mbili.', chunkIndex: c };
          break;
        }
        applyChunk(chunks[c], result, report);
        progress(c);
      }

      try { await api('POST', '/campaigns/finish', { schoolId, campaignId: report.campaignId }); } catch (_) { /* history still has everything */ }
      return finalise(report);
    }

    function applyChunk(chunkRows, result, report) {
      (result.results || []).forEach((r) => {
        const row = chunkRows[r.index];
        if (!row) return;
        row.status = r.status;
        row.reason = r.reason || null;
        row.units = Number(r.units) || 0;
        row.msisdn = r.phone;
      });
      (result.rejected || []).forEach((r) => {
        const row = chunkRows[r.index];
        if (!row) return;
        row.status = 'rejected';
        row.reason = r.reason;
      });
      report.unitsUsed += Number(result.unitsUsed) || 0;
      report.walletBalance = result.walletBalance;
    }

    function finalise(report) {
      report.sent = report.rows.filter((r) => !['failed', 'rejected', 'not_sent'].includes(r.status)).length;
      report.failed = report.rows.filter((r) => r.status === 'failed').length;
      report.rejected = report.rows.filter((r) => r.status === 'rejected').length;
      report.notSent = report.rows.filter((r) => r.status === 'not_sent').length;
      return report;
    }

    /**
     * Rows worth trying again in a NEW send: gateway failures and anything never sent.
     * 'unknown' is NOT included — it may have been delivered, and must never be sent twice.
     */
    function retryable(report) {
      return report.rows.filter((r) => r.status === 'failed' || r.status === 'not_sent')
        .map((r) => ({ phone: r.phone, text: r.text, ref: r.ref }));
    }

    return {
      workerUrl,
      me: (schoolId) => api('GET', '/me?' + q(schoolId)),
      health: () => fetchImpl(workerUrl + '/health').then((r) => r.json()),
      listCampaigns: (schoolId) => api('GET', '/campaigns?' + q(schoolId)),
      getCampaign: (schoolId, id) => api('GET', '/campaigns/get?' + q(schoolId) + '&id=' + encodeURIComponent(id)),
      listTemplates: (schoolId) => api('GET', '/templates?' + q(schoolId)),
      saveTemplate: (schoolId, t) => api('POST', '/templates/save', { schoolId, id: t.id || undefined, name: t.name, purpose: t.purpose, body: t.body }),
      deleteTemplate: (schoolId, id) => api('POST', '/templates/delete', { schoolId, id }),
      sendAll,
      retryable,
    };
  }

  // ------------------------------------------------------------ helpers
  function statusLabel(status) { return STATUS_SW[status] || status || ''; }
  function reasonLabel(reason) { return REASON_SW[reason] || reason || ''; }

  function csvCell(v) {
    const s = String(v === null || v === undefined ? '' : v);
    return /[",\n\r;]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }
  /** Phone shown as "0712 345 678" so Excel keeps the leading 0. */
  function displayPhone(v) {
    const p = core.normalizeTzPhone(v);
    if (p.status !== 'VALID') return String(v || '');
    return `${p.local.slice(0, 4)} ${p.local.slice(4, 7)} ${p.local.slice(7)}`;
  }
  /** CSV with a BOM so Excel opens Swahili text correctly. */
  function toCsv(header, rows) {
    return '﻿' + [header, ...rows].map((r) => r.map(csvCell).join(',')).join('\r\n');
  }
  function reportCsv(report) {
    return toCsv(['Ref', 'Namba', 'Hali', 'Sababu', 'SMS', 'Ujumbe'],
      report.rows.map((r) => [r.ref, displayPhone(r.phone), statusLabel(r.status), reasonLabel(r.reason), r.units, r.text]));
  }
  function downloadText(filename, text, type) {
    const blob = new Blob([text], { type: type || 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  }

  return { create, SmsError, statusLabel, reasonLabel, displayPhone, toCsv, reportCsv, downloadText, CHUNK_SIZE, DEFAULT_WORKER_URL };
});
