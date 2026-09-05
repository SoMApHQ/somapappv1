(function (global) {
  "use strict";

  function db() {
    return global.firebase?.database?.();
  }

  function path(subPath) {
    return global.SOMAP?.P ? global.SOMAP.P(subPath) : subPath;
  }

  function year() {
    return global.somapYearContext?.getSelectedYear?.() || String(new Date().getFullYear());
  }

  function money(value) {
    return `TSh ${new Intl.NumberFormat("en-TZ", { maximumFractionDigits: 0 }).format(Number(value) || 0)}`;
  }

  async function refreshBankAuditCard() {
    const countEl = document.getElementById("bankAuditStatCount");
    if (!countEl || !db()) return;
    try {
      const snap = await db().ref(path(`years/${year()}/bankAudits`)).once("value");
      const audits = Object.values(snap.val() || {}).sort((a, b) => Number(b.uploadedAt || 0) - Number(a.uploadedAt || 0));
      const latest = audits[0] || null;
      countEl.textContent = String(audits.length);
      const lastEl = document.getElementById("bankAuditStatLast");
      const inEl = document.getElementById("bankAuditStatIn");
      const outEl = document.getElementById("bankAuditStatOut");
      const reviewEl = document.getElementById("bankAuditStatReview");
      if (lastEl) lastEl.textContent = latest?.uploadedAt ? new Date(latest.uploadedAt).toLocaleDateString("en-GB") : "No audit yet";
      if (inEl) inEl.textContent = money(latest?.totals?.totalDeposits || 0);
      if (outEl) outEl.textContent = money(latest?.totals?.totalWithdrawals || 0);
      if (reviewEl) reviewEl.textContent = String(latest?.totals?.reviewItems || 0);
    } catch (error) {
      console.warn("[BankAudit] Dashboard summary failed", error);
    }
  }

  document.addEventListener("DOMContentLoaded", refreshBankAuditCard);
  global.addEventListener("somapYearChanged", refreshBankAuditCard);
  global.SomapBankAuditDashboard = { refreshBankAuditCard };
})(window);
