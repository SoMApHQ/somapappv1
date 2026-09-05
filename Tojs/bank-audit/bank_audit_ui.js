(function (global) {
  "use strict";

  const state = {
    user: null,
    audits: [],
    activeAudit: null,
    parsed: null,
    settings: null,
    role: "",
    readOnly: false
  };

  const $ = (id) => document.getElementById(id);
  const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const money = (v) => global.SomapBankAuditEngine.formatTsh(v);

  function db() {
    return global.firebase.database();
  }

  function year() {
    return global.SomapBankAuditStorage.year();
  }

  function school() {
    return global.SomapBankAuditStorage.school();
  }

  function toast(message, type) {
    if (global.Swal) Swal.fire(type === "error" ? "Bank Audit" : "Done", message, type || "success");
    else alert(message);
  }

  function setText(id, text) {
    const el = $(id);
    if (el) el.textContent = text;
  }

  function currentLogoPath() {
    return "../images/somap-logo.png.jpg";
  }

  async function fetchProfile(user) {
    const email = String(user?.email || "").toLowerCase();
    const keys = Array.from(new Set([email.replace(/\./g, "_"), email.replace(/[@.]/g, "_")])).filter(Boolean);
    for (const key of keys) {
      const snap = await db().ref(`users/${key}`).once("value");
      if (snap.exists()) return snap.val();
    }
    return {};
  }

  function normalizeRole(role) {
    return String(role || "").toLowerCase().replace(/[\s-]+/g, "_");
  }

  function allowedRole(role) {
    return ["admin", "administrator", "director", "accountant", "finance", "head_finance", "finance_manager", "bursar"].includes(normalizeRole(role));
  }

  function setStatus(text, type) {
    const el = $("parseStatus");
    if (!el) return;
    el.textContent = text;
    el.className = `rounded-lg px-3 py-2 text-sm ${type === "error" ? "bg-rose-50 text-rose-700" : type === "warn" ? "bg-amber-50 text-amber-700" : "bg-emerald-50 text-emerald-700"}`;
  }

  function renderSummary(audit) {
    const t = audit?.totals || {};
    setText("sumDeposits", money(t.totalDeposits));
    setText("sumWithdrawals", money(t.totalWithdrawals));
    setText("sumNet", money(t.netMovement));
    setText("sumClosing", money(t.closingBalance));
    setText("sumRemedial", money(audit?.categoryTotals?.Remedial || 0));
    setText("sumTransport", money(audit?.categoryTotals?.["Transport / Usafiri"] || 0));
    setText("sumGraduation", money(audit?.categoryTotals?.Graduation || 0));
    setText("sumReview", String(t.reviewItems || 0));
    setText("activeAuditTitle", audit ? `${audit.bankName || "Bank"} - ${audit.uploadedFileName || "Statement"}` : "No audit selected");
    setText("activeAuditMeta", audit ? `${audit.statementPeriodFrom || "Period not set"} to ${audit.statementPeriodTo || "not set"} | ${audit.transactions?.length || 0} transactions` : "Upload or open a saved audit.");
  }

  function rowHtml(t) {
    return `<tr>
      <td>${esc(t.dateLabel || t.date || "")}</td>
      <td>${esc(t.category || "")}</td>
      <td>${esc(t.detectedStudentName || t.counterpartyName || "")}</td>
      <td class="num">${t.moneyIn ? money(t.moneyIn) : ""}</td>
      <td class="num">${t.moneyOut ? money(t.moneyOut) : ""}</td>
      <td>${esc(t.description || "")}</td>
      <td>${esc((t.reviewFlags || []).join("; "))}</td>
    </tr>`;
  }

  function renderTable(id, rows, empty) {
    const el = $(id);
    if (!el) return;
    el.innerHTML = rows?.length ? rows.map(rowHtml).join("") : `<tr><td colspan="7" class="empty">${esc(empty || "No records.")}</td></tr>`;
  }

  function renderWithdrawalEvents(audit) {
    const el = $("withdrawalBody");
    if (!el) return;
    const rows = audit?.withdrawalEvents || [];
    el.innerHTML = rows.length ? rows.map((w) => `<tr>
      <td>${esc(w.dateLabel || w.date || "")}</td>
      <td>${esc(w.dayOfWeek || "")}</td>
      <td>${esc(w.category || "")}</td>
      <td class="num">${money(w.amountWithdrawn)}</td>
      <td class="num">${money(w.charges)}</td>
      <td class="num">${money(w.totalImpact)}</td>
      <td>${esc(w.description || "")}</td>
      <td>${esc((w.reviewFlags || []).join("; "))}</td>
    </tr>`).join("") : `<tr><td colspan="8" class="empty">No withdrawal events.</td></tr>`;
  }

  function renderFindings(audit) {
    const el = $("findingsList");
    if (!el) return;
    el.innerHTML = (audit?.findings || []).length
      ? audit.findings.map((f) => `<li>${esc(f)}</li>`).join("")
      : "<li>No findings yet.</li>";
  }

  function renderCategoryTotals(audit) {
    const el = $("categoryTotals");
    if (!el) return;
    const rows = Object.entries(audit?.categoryTotals || {});
    el.innerHTML = rows.length
      ? rows.map(([name, total]) => `<div><span>${esc(name)}</span><strong>${money(total)}</strong></div>`).join("")
      : "<p>No category totals yet.</p>";
  }

  function renderAudit(audit) {
    state.activeAudit = audit;
    renderSummary(audit);
    renderCategoryTotals(audit);
    renderFindings(audit);
    const txns = audit?.transactions || [];
    renderTable("incomeBody", txns.filter((t) => t.moneyIn > 0), "No income transactions.");
    renderWithdrawalEvents(audit);
    renderTable("reviewBody", audit?.reviewItems || [], "No review items.");
    renderTable("allTxnBody", txns, "No transaction register.");
    renderStudentTrace();
  }

  function renderStudentTrace() {
    const q = String($("studentSearch")?.value || "").toLowerCase().trim();
    const rows = (state.activeAudit?.transactions || []).filter((t) => {
      if (!q) return t.detectedStudentName;
      return `${t.detectedStudentName || ""} ${t.description || ""}`.toLowerCase().includes(q);
    });
    renderTable("studentTraceBody", rows, "No matching student/payment trace.");
  }

  function renderSavedAudits() {
    const el = $("savedAudits");
    if (!el) return;
    el.innerHTML = state.audits.length ? state.audits.map((audit) => `<article class="audit-item">
      <div>
        <strong>${esc(audit.bankName || "Bank statement")}</strong>
        <span>${esc(audit.uploadedFileName || "")}</span>
        <small>${audit.uploadedAt ? new Date(audit.uploadedAt).toLocaleString() : ""} | ${audit.transactions?.length || 0} txns</small>
      </div>
      <div class="audit-actions">
        <button type="button" data-open="${esc(audit.id)}">Open</button>
        <button type="button" data-pdf="${esc(audit.id)}">PDF</button>
        ${state.readOnly ? "" : `<button type="button" class="danger" data-delete="${esc(audit.id)}">Delete</button>`}
      </div>
    </article>`).join("") : `<p class="empty-box">No bank audits saved for ${esc(year())}.</p>`;
    el.querySelectorAll("[data-open]").forEach((btn) => btn.addEventListener("click", () => openAudit(btn.dataset.open)));
    el.querySelectorAll("[data-pdf]").forEach((btn) => btn.addEventListener("click", () => downloadAuditPdf(btn.dataset.pdf)));
    el.querySelectorAll("[data-delete]").forEach((btn) => btn.addEventListener("click", () => deleteAudit(btn.dataset.delete)));
  }

  async function loadAudits() {
    state.audits = await global.SomapBankAuditStorage.listAudits(year());
    renderSavedAudits();
    if (!state.activeAudit && state.audits[0]) renderAudit(state.audits[0]);
    if (!state.audits[0]) renderAudit(null);
  }

  async function openAudit(id) {
    const audit = await global.SomapBankAuditStorage.getAudit(id, year());
    if (audit) renderAudit(audit);
  }

  async function downloadAuditPdf(id) {
    const audit = id ? await global.SomapBankAuditStorage.getAudit(id, year()) : state.activeAudit;
    if (!audit) return toast("Open or save an audit first.", "error");
    await global.SomapBankAuditPdf.download(audit);
  }

  async function deleteAudit(id) {
    if (!id || state.readOnly) return;
    const ok = global.confirm("Delete this saved bank audit? This does not affect other uploaded statements.");
    if (!ok) return;
    await global.SomapBankAuditStorage.deleteAudit(id, year());
    if (state.activeAudit?.id === id) state.activeAudit = null;
    await loadAudits();
  }

  function formSettings() {
    const existing = global.SomapBankAuditEngine.mergeSettings(state.settings || {});
    existing.remedialMonthlyAmount = Number($("setRemedial")?.value || existing.remedialMonthlyAmount);
    existing.graduationGraduandAmount = Number($("setGradMain")?.value || existing.graduationGraduandAmount);
    existing.graduationOtherAmount = Number($("setGradOther")?.value || existing.graduationOtherAmount);
    existing.largeWithdrawalThreshold = Number($("setLargeWithdrawal")?.value || existing.largeWithdrawalThreshold);
    existing.weekendFlagEnabled = $("setWeekend")?.checked !== false;
    return existing;
  }

  function inferPeriod(transactions) {
    const dates = (transactions || [])
      .map((t) => t.date)
      .filter(Boolean)
      .sort();
    return {
      from: dates[0] || "",
      to: dates[dates.length - 1] || ""
    };
  }

  function fillSettings() {
    const s = global.SomapBankAuditEngine.mergeSettings(state.settings || {});
    if ($("setRemedial")) $("setRemedial").value = s.remedialMonthlyAmount;
    if ($("setGradMain")) $("setGradMain").value = s.graduationGraduandAmount;
    if ($("setGradOther")) $("setGradOther").value = s.graduationOtherAmount;
    if ($("setLargeWithdrawal")) $("setLargeWithdrawal").value = s.largeWithdrawalThreshold;
    if ($("setWeekend")) $("setWeekend").checked = s.weekendFlagEnabled;
  }

  async function saveSettings() {
    state.settings = formSettings();
    await global.SomapBankAuditStorage.saveSettings(state.settings, year());
    toast("Bank audit settings saved.");
  }

  async function parseUpload() {
    if (state.readOnly) return toast("This account has read-only access.", "error");
    const file = $("statementFile")?.files?.[0];
    if (!file) return toast("Choose a PDF, Excel, or CSV bank statement first.", "error");
    setStatus("Parsing statement. Please wait...", "warn");
    try {
      const parsed = await global.SomapBankAuditParser.parseFile(file);
      const analysis = global.SomapBankAuditEngine.analyze(parsed.rows, { settings: formSettings() });
      const inferredPeriod = inferPeriod(analysis.transactions);
      if (!$("periodFrom")?.value && inferredPeriod.from && $("periodFrom")) $("periodFrom").value = inferredPeriod.from;
      if (!$("periodTo")?.value && inferredPeriod.to && $("periodTo")) $("periodTo").value = inferredPeriod.to;
      const audit = {
        ...analysis,
        id: "",
        bankName: $("bankName")?.value || "CRDB",
        statementPeriodFrom: $("periodFrom")?.value || inferredPeriod.from || "",
        statementPeriodTo: $("periodTo")?.value || inferredPeriod.to || "",
        uploadedFileName: file.name,
        sourceType: parsed.sourceType,
        parserMeta: parsed.meta,
        extractedTextPreview: parsed.extractedText || "",
        schoolLogoUrl: currentLogoPath()
      };
      state.parsed = audit;
      renderAudit(audit);
      setStatus(`Parsed ${analysis.transactions.length} transaction(s). Review the preview, then save this audit session.`, analysis.transactions.length ? "ok" : "warn");
      $("saveAuditBtn").disabled = !analysis.transactions.length;
    } catch (error) {
      console.error(error);
      setStatus(error.message || "Could not parse statement.", "error");
    }
  }

  async function saveParsedAudit() {
    if (!state.parsed || state.readOnly) return;
    const saved = await global.SomapBankAuditStorage.saveAudit(state.parsed, year());
    state.parsed = null;
    $("saveAuditBtn").disabled = true;
    renderAudit(saved);
    await loadAudits();
    toast("This uploaded statement has been saved as its own audit session.");
  }

  function bindTabs() {
    document.querySelectorAll("[data-tab]").forEach((btn) => {
      btn.addEventListener("click", () => {
        document.querySelectorAll("[data-tab]").forEach((b) => b.classList.toggle("active", b === btn));
        document.querySelectorAll("[data-panel]").forEach((panel) => panel.classList.toggle("active", panel.dataset.panel === btn.dataset.tab));
      });
    });
  }

  async function initYearSelect() {
    const select = $("auditYear");
    if (select && global.somapYearContext?.attachYearDropdown) {
      global.somapYearContext.attachYearDropdown(select);
      select.addEventListener("change", async () => {
        state.activeAudit = null;
        state.settings = await global.SomapBankAuditStorage.getSettings(year());
        fillSettings();
        await loadAudits();
      });
    }
  }

  async function start(user) {
    state.user = user;
    const activeSchool = school();
    if (!activeSchool?.id) {
      location.href = "../somapappv1multischool/multischool.html";
      return;
    }
    const profile = await fetchProfile(user);
    state.role = normalizeRole(profile.role || localStorage.getItem("role") || "");
    state.readOnly = !allowedRole(state.role);
    if (state.readOnly) document.body.classList.add("read-only");
    setText("schoolName", activeSchool.name || activeSchool.schoolName || activeSchool.id);
    setText("userRole", state.readOnly ? "Read-only" : state.role || "authorized");
    await initYearSelect();
    state.settings = await global.SomapBankAuditStorage.getSettings(year());
    fillSettings();
    await loadAudits();
  }

  function bind() {
    bindTabs();
    $("parseBtn")?.addEventListener("click", parseUpload);
    $("saveAuditBtn")?.addEventListener("click", saveParsedAudit);
    $("downloadPdfBtn")?.addEventListener("click", () => downloadAuditPdf());
    $("saveSettingsBtn")?.addEventListener("click", saveSettings);
    $("studentSearch")?.addEventListener("input", renderStudentTrace);
  }

  document.addEventListener("DOMContentLoaded", () => {
    bind();
    firebase.auth().onAuthStateChanged((user) => {
      if (!user) {
        setStatus("Please sign in before using the Bank Audit & Analyzer.", "error");
        return;
      }
      start(user).catch((error) => {
        console.error(error);
        setStatus(error.message || "Analyzer failed to load.", "error");
      });
    });
  });
})(window);
