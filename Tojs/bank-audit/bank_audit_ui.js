(function (global) {
  "use strict";

  const state = {
    user: null,
    audits: [],
    activeAudit: null,
    parsed: null,
    settings: null,
    role: "",
    readOnly: false,
    students: [],
    parsedFile: null
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

  function setBusy(button, busy, text) {
    if (!button) return;
    if (busy) {
      button.dataset.originalText = button.textContent;
      button.disabled = true;
      button.textContent = text || "Working...";
    } else {
      button.disabled = false;
      button.textContent = button.dataset.originalText || button.textContent;
    }
  }

  function renderSummary(audit) {
    const t = audit?.totals || {};
    setText("sumDeposits", money(t.totalDeposits));
    setText("sumWithdrawals", money(t.totalWithdrawals));
    setText("sumNet", money(t.netMovement));
    setText("sumClosing", audit?.statement?.availableBalance == null ? 'Not reported' : money(audit.statement.availableBalance));
    setText('sumBook', audit?.statement?.bookBalance == null ? 'Not reported' : money(audit.statement.bookBalance));
    setText('sumUnallocated', money(audit?.categoryTotals?.['Unknown income']));
    setText('sumCharges', money(t.totalCharges));
    setText('sumRaw', String(t.transactionCount || 0));
    setText('sumEvents', String(t.groupedEventCount || 0));
    setText('sumWithdrawalEvents', String(t.withdrawalEventCount || 0));
    const info = $('statementInfo');
    if (info) info.innerHTML = Object.entries(audit?.statement || {}).map(([k,v]) => '<div><strong>' + esc(k.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/^./, c => c.toUpperCase())) + '</strong>: ' + esc(v == null ? 'Not reported' : typeof v === 'number' ? money(v) : v) + '</div>').join('');
    setText("sumRemedial", money(audit?.categoryTotals?.Remedial || 0));
    setText("sumTransport", money(audit?.categoryTotals?.["Transport / Usafiri"] || 0));
    setText("sumGraduation", money(audit?.categoryTotals?.Graduation || 0));
    setText("sumReview", String(t.reviewItems || 0));
    setText("activeAuditTitle", audit ? `${audit.bankName || "Bank"} - ${audit.uploadedFileName || "Statement"}` : "No audit selected");
    setText("activeAuditMeta", audit ? `${audit.statementPeriodFrom || "Period not set"} to ${audit.statementPeriodTo || "not set"} | ${audit.transactions?.length || 0} transactions` : "Upload or open a saved audit.");
  }

  function rowHtml(t) {
    return `<tr>
      <td>${esc(t.dateLabel || t.date || "")}<br>${esc(t.postingTime || "")}</td>
      <td>${esc(t.category || "")}</td>
      <td>${esc(t.detectedStudentName || t.counterpartyName || "")}<br>${esc(t.extractedClass || "")}<br>Sender: ${esc(t.sender || "Not stated")}</td>
      <td class="num">${t.moneyIn ? money(t.moneyIn) : ""}</td>
      <td class="num">${t.moneyOut ? money(t.moneyOut) : ""}</td>
      <td>${esc(t.description || "")}<br><strong>Bank REF:</strong> ${esc(t.bankReference || t.reference)}<br><strong>AB:</strong> ${esc(t.paymentReference || "Not stated")}<br>Written purpose: ${esc(t.writtenPurpose || "Not stated")}<br>Book balance: ${money(t.balance)}</td>
      <td>${esc((t.reviewFlags || []).join("; "))}<br>Match: ${esc(t.studentMatch?.name || "Not confirmed")}<br>Confidence: ${esc(t.studentMatch?.confidence ?? "Not assessed")}<br>Allocation: ${esc(t.allocationStatus || "Unallocated")}${t.moneyIn > 0 && !state.readOnly ? `<br><button type="button" data-allocate="${esc(t.id)}">Match / split allocation</button>` : ""}</td>
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
      <td>${esc(w.dayOfWeek || "")}<br>${esc(w.postingTime || "")}</td>
      <td>${esc(w.recipient || "Not stated")}<br>${esc(w.recipientAccount || "")}<br>${esc(w.bankReference || w.reference)}</td>
      <td class="num">${money(w.amountWithdrawn)}</td>
      <td class="num">${money(w.charges)}</td>
      <td class="num">${money(w.totalImpact)}</td>
      <td>${esc(w.description || "")}<details><summary>View raw bank lines</summary>${(w.rawLines || []).map(t => `<p>${esc(t.postingTime)} | ${money(t.moneyOut)} | Balance ${money(t.balance)}<br>${esc(t.rawNarration)}</p>`).join("")}</details></td>
      <td>${esc(w.businessPurpose || "Purpose not stated in bank narration")}<br>Supporting evidence: ${esc(w.evidence || "Required")}<br>Reviewer: ${esc(w.reviewer || "Not assigned")}<br>${esc(w.reviewStatus || "Pending documentation")}<br>${esc((w.reviewFlags || []).join("; "))}</td>
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
    if (audit) attachMatches(audit);
    renderSummary(audit);
    renderCategoryTotals(audit);
    renderFindings(audit);
    const txns = audit?.transactions || [];
    renderTable("incomeBody", txns.filter((t) => t.moneyIn > 0), "No income transactions.");
    renderWithdrawalEvents(audit);
    renderTable("reviewBody", audit?.reviewItems || [], "No review items.");
    renderTable("allTxnBody", txns, "No transaction register.");
    renderStudentTrace();
    renderAllocationSections(audit);
    labelCells();
    document.querySelectorAll("tbody:not(#studentTraceBody) [data-allocate]").forEach(btn => btn.addEventListener("click", () => allocate(btn.dataset.allocate)));
  }

  function renderStudentTrace() {
    const q = String($("studentSearch")?.value || "").toLowerCase().trim();
    const rows = (state.activeAudit?.transactions || []).filter((t) => {
      if (t.moneyIn <= 0) return false;
      if (!q) return true;
      return `${t.paymentReference || ""} ${t.bankReference || ""} ${t.detectedStudentName || ""} ${t.sender || ""} ${t.description || ""}`.toLowerCase().includes(q);
    });
    renderTable("studentTraceBody", rows, "No matching student/payment trace.");
    labelCells();
    $("studentTraceBody")?.querySelectorAll("[data-allocate]").forEach(btn => btn.addEventListener("click", () => allocate(btn.dataset.allocate)));
  }

  function renderSavedAudits() {
    const el = $("savedAudits");
    if (!el) return;
    el.innerHTML = state.audits.length ? state.audits.map((audit) => `<article class="audit-item">
      <div>
        <strong>${esc(audit.bankName || "Bank statement")}</strong>
        <span>${esc(audit.uploadedFileName || "")}</span>
        <small>${audit.uploadedAt ? new Date(audit.uploadedAt).toLocaleString() : ""} | ${audit.transactions?.length || 0} txns</small>
        <small>${audit.statementFile?.downloadUrl ? "Statement saved" : "Statement file not saved"} | ${audit.reportFile?.downloadUrl ? "PDF saved" : "PDF can be regenerated"}</small>
      </div>
      <div class="audit-actions">
        <button type="button" data-open="${esc(audit.id)}">Open</button>
        <button type="button" data-pdf="${esc(audit.id)}">PDF</button>
        ${audit.statementFile?.downloadUrl ? `<a href="${esc(audit.statementFile.downloadUrl)}" target="_blank" rel="noopener">Statement</a>` : ""}
        ${audit.reportFile?.downloadUrl ? `<a href="${esc(audit.reportFile.downloadUrl)}" target="_blank" rel="noopener">Saved PDF</a>` : ""}
        ${state.readOnly ? "" : `<button type="button" data-reparse="${esc(audit.id)}">Reparse Statement</button><button type="button" class="danger" data-delete="${esc(audit.id)}">Delete</button>`}
      </div>
    </article>`).join("") : `<p class="empty-box">No bank audits saved for ${esc(year())}.</p>`;
    el.querySelectorAll("[data-reparse]").forEach(btn => btn.addEventListener("click", () => reparseAudit(btn.dataset.reparse)));
    el.querySelectorAll("[data-open]").forEach((btn) => btn.addEventListener("click", () => openAudit(btn.dataset.open)));
    el.querySelectorAll("[data-pdf]").forEach((btn) => btn.addEventListener("click", () => downloadAuditPdf(btn.dataset.pdf)));
    el.querySelectorAll("[data-delete]").forEach((btn) => btn.addEventListener("click", () => deleteAudit(btn.dataset.delete)));
  }

  async function loadAudits() {
    try {
      state.audits = await global.SomapBankAuditStorage.listAudits(year());
      renderSavedAudits();
      if (!state.activeAudit && state.audits[0]) renderAudit(state.audits[0]);
      if (!state.audits[0]) renderAudit(null);
    } catch (error) {
      console.error(error);
      setStatus(`Could not load saved audits: ${error.message || error}`, "error");
    }
  }

  async function openAudit(id) {
    const audit = await global.SomapBankAuditStorage.getAudit(id, year());
    if (audit) renderAudit(audit);
  }

  async function downloadAuditPdf(id) {
    const audit = id ? await global.SomapBankAuditStorage.getAudit(id, year()) : state.activeAudit;
    if (!audit) return toast("Open or save an audit first.", "error");
    await global.SomapBankAuditPdf.download(audit);
    if (audit.id && !audit.reportFile?.downloadUrl && !state.readOnly) {
      try {
        setStatus("Saving regenerated PDF to Google Drive...", "warn");
        audit._driveAccessToken = await global.SomapBankAuditStorage.requestDriveAccessToken();
        const blob = await global.SomapBankAuditPdf.toBlob(audit);
        const reportFile = await global.SomapBankAuditStorage.uploadAuditBlob(
          audit,
          blob,
          global.SomapBankAuditPdf.fileName(audit),
          "application/pdf",
          "reports"
        );
        await global.SomapBankAuditStorage.updateAudit(audit.id, { reportFile }, year());
        audit.reportFile = reportFile;
        delete audit._driveAccessToken;
        await loadAudits();
        setStatus("PDF saved to Google Drive.", "ok");
      } catch (error) {
        console.warn("Generated PDF downloaded but could not be saved to Google Drive", error);
      }
    }
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
    state.parsed = null; state.parsedFile = null;
    $("saveAuditBtn").disabled = true;
    setStatus("Parsing statement. Please wait...", "warn");
    try {
      const parsed = await global.SomapBankAuditParser.parseFile(file);
      const analysis = global.SomapBankAuditEngine.analyze(parsed.rows, { settings: formSettings(), meta: parsed.meta });
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
      const duplicate = state.audits.find(a => parsed.meta.sourceHash && a.parserMeta?.sourceHash === parsed.meta.sourceHash);
      if (duplicate) { renderAudit(duplicate); setStatus('This original statement is already saved. Use Reparse Statement to create a new analysis version.', 'warn'); return; }
      state.parsed = audit;
      state.parsedFile = file;
      renderAudit(audit);
      setStatus(`Parsed ${analysis.transactions.length} transaction(s). Review the preview, then save this audit session.`, analysis.transactions.length ? "ok" : "warn");
      $("saveAuditBtn").disabled = !analysis.validation.valid;
      if (!analysis.validation.valid) setStatus("Parsing failed validation. " + analysis.validation.errors.join(" "), "error");
    } catch (error) {
      console.error(error);
      setStatus(error.message || "Could not parse statement.", "error");
    }
  }

  async function saveParsedAudit() {
    if (!state.parsed?.validation?.valid || state.readOnly) return;
    const btn = $("saveAuditBtn");
    setBusy(btn, true, "Saving files...");
    try {
      setStatus("Requesting Google Drive permission...", "warn");
      const driveAccessToken = await global.SomapBankAuditStorage.requestDriveAccessToken();
      const auditId = state.parsed.id || (state.parsed.parserMeta?.sourceHash ? "statement_" + state.parsed.parserMeta.sourceHash : global.SomapBankAuditStorage.reserveAuditId(year()));
      let savedDraft = { ...state.parsed, id: auditId, auditId, _driveAccessToken: driveAccessToken };
      state.parsed.id = auditId;
      state.parsed.auditId = auditId;
      setStatus("Uploading original statement to Google Drive...", "warn");
      const statementFile = await global.SomapBankAuditStorage.uploadAuditFile(savedDraft, state.parsedFile, "statement");
      setStatus("Statement saved. Generating and saving PDF report...", "warn");
      const pdfBlob = await global.SomapBankAuditPdf.toBlob(savedDraft);
      const reportFile = await global.SomapBankAuditStorage.uploadAuditBlob(
        savedDraft,
        pdfBlob,
        global.SomapBankAuditPdf.fileName(savedDraft),
        "application/pdf",
        "reports"
      );
      const filesPatch = { statementFile, reportFile, storageSavedAt: Date.now() };
      delete savedDraft._driveAccessToken;
      const saved = await global.SomapBankAuditStorage.saveAudit({ ...savedDraft, ...filesPatch }, year());
      state.parsed = null;
      state.parsedFile = null;
      renderAudit(saved);
      await loadAudits();
      setStatus("Audit, original statement, and PDF report saved.", "ok");
      toast("This statement and its PDF report have been saved for later download.");
    } catch (error) {
      console.error(error);
      setStatus(`Save failed: ${error.message || error}`, "error");
      await loadAudits().catch(() => {});
      toast(error.message || "Could not save audit files.", "error");
    } finally {
      if (btn) {
        btn.textContent = btn.dataset.originalText || "Save Audit";
        btn.disabled = !state.parsed?.validation?.valid;
      }
    }
  }



  function attachMatches(audit) {
    for (const t of audit.transactions || []) {
      const norm = v => String(v || '').toLowerCase().replace(/[^a-z]/g,'');
      const name = norm(t.detectedStudentName);
      const matches = name ? state.students.filter(s => norm(s.name) === name) : [];
      t.matchSuggestions = matches.map(s => ({id:s.id,name:s.name,confidence:1}));
      const allocation = audit.allocations?.[t.id];
      t.allocationStatus = allocation ? 'Manually allocated' : 'Unallocated';
      t.studentMatch = allocation ? {name:allocation.parts.map(p => p.studentName).join(', '),confidence:1,confirmed:true} : matches.length === 1 ? {name:matches[0].name,confidence:1,confirmed:false} : null;
    }
  }
  async function allocate(id) {
    const audit=state.activeAudit, t=audit?.transactions?.find(t=>t.id===id);
    if (!t || state.readOnly) return;
    if (!audit.id) return toast('Save the validated audit before allocating payments.', 'error');
    const choices = '<option value="">Select child</option>' + state.students.map(s=>'<option value="'+esc(s.id)+'">'+esc(s.name)+'</option>').join('');
    const result=await Swal.fire({title:'Match or split payment',width:800,html:
      '<p>'+esc(t.detectedStudentName)+' | '+esc(t.paymentReference)+' | '+money(t.moneyIn)+'</p><p>One row per child, month and category. Allocations must total the bank credit.</p><div id="allocationRows"></div><button type="button" id="addAllocation">Add split</button>',
      showCancelButton:true,confirmButtonText:'Save allocation',didOpen:()=>{
        const add=()=>{const row=document.createElement('div');row.className='allocation-row';row.innerHTML='<select data-child>'+choices+'</select><input data-month type="month" value="'+t.date.slice(0,7)+'"><select data-category><option>Transport / Usafiri</option><option>Remedial</option><option>Graduation</option><option>Unknown income</option></select><input data-amount type="number" min="0.01" step="0.01" placeholder="Amount"><button type="button">Remove</button>';row.querySelector('button').onclick=()=>row.remove();$('allocationRows').appendChild(row);return row;};
        const row=add();row.querySelector('[data-amount]').value=t.moneyIn;row.querySelector('[data-category]').value=t.category;
        if(t.matchSuggestions?.length===1)row.querySelector('[data-child]').value=t.matchSuggestions[0].id;
        $('addAllocation').onclick=add;
      },preConfirm:()=>{
        const parts=[...document.querySelectorAll('.allocation-row')].map(row=>{const studentId=row.querySelector('[data-child]').value;return {studentId,studentName:state.students.find(s=>s.id===studentId)?.name || '',month:row.querySelector('[data-month]').value,category:row.querySelector('[data-category]').value,amount:Number(row.querySelector('[data-amount]').value)};});
        if(!parts.length || parts.some(p=>!p.studentId || !p.month || p.amount<=0 || !Number.isFinite(p.amount)) || Math.round(parts.reduce((n,p)=>n+p.amount,0)*100)!==Math.round(t.moneyIn*100)){Swal.showValidationMessage('Choose each child and month, and ensure positive allocations total the payment.');return false;}return parts;
      }});
    if(!result.isConfirmed)return;
    const allocation={parts:result.value,paymentReference:t.paymentReference || '',bankReference:t.bankReference || '',updatedAt:Date.now(),reviewer:state.user?.email || ''};
    await global.SomapBankAuditStorage.updateAudit(audit.id,{['allocations/'+id]:allocation,reportFile:null},year());
    audit.allocations={...(audit.allocations || {}),[id]:allocation};audit.reportFile=null;renderAudit(audit);
  }

  function labelCells() {
    document.querySelectorAll('table').forEach(table => {
      const labels = [...table.querySelectorAll('thead th')].map(x => x.textContent);
      table.querySelectorAll('tbody tr').forEach(row => [...row.children].forEach((cell,i) => cell.dataset.label = labels[i] || ''));
    });
  }
  function renderAllocationSections(audit) {
    const income = audit?.income || (audit?.transactions || []).filter(t => t.moneyIn > 0);
    const sections = [
      ['Payment has a name but purpose is unclear', t => t.detectedStudentName && t.category === 'Unknown income'],
      ['Purpose is known but child name is missing', t => !t.detectedStudentName && t.category !== 'Unknown income'],
      ['Child name not matched in SoMAp', t => !!t.detectedStudentName && !t.studentMatch?.confirmed],
      ['Neither name nor purpose is available', t => !t.detectedStudentName && t.category === 'Unknown income'],
      ['Multiple children or split-payment possibility', t => /\b(and|na)\b|[&/+]/i.test(t.detectedStudentName || '')]
    ];
    const el = $('allocationSections');
    if (el) el.innerHTML = sections.map(([title,filter]) => '<h2>' + esc(title) + '</h2><div class="table-wrap"><table><thead><tr><th>Date</th><th>Category</th><th>Name</th><th>Money in</th><th>Money out</th><th>References and narration</th><th>Review</th></tr></thead><tbody>' + (income.filter(filter).map(rowHtml).join('') || '<tr><td colspan="7">No records.</td></tr>') + '</tbody></table></div>').join('');
  }
  async function reparseAudit(id) {
    if (state.readOnly) return;
    try {
      const previous = await global.SomapBankAuditStorage.getAudit(id, year());
      let file = $('statementFile')?.files?.[0];
      if (previous.statementFile?.driveFileId) {
        const token = await global.SomapBankAuditStorage.requestDriveAccessToken();
        const response = await fetch('https://www.googleapis.com/drive/v3/files/' + encodeURIComponent(previous.statementFile.driveFileId) + '?alt=media', {headers:{Authorization:'Bearer ' + token}});
        if (!response.ok) throw new Error('Original statement download failed. Select the original PDF and retry.');
        file = new File([await response.blob()], previous.uploadedFileName, {type:'application/pdf'});
      }
      if (!file) throw new Error('This legacy audit has no saved original. Select its original bank statement using the file chooser, then click Reparse Statement again.');
      setStatus('Reparsing original statement...', 'warn');
      const parsed = await global.SomapBankAuditParser.parseFile(file);
      if (previous.parserMeta?.sourceHash && previous.parserMeta.sourceHash !== parsed.meta.sourceHash) throw new Error('Selected file differs from the original statement.');
      const inferred = inferPeriod(parsed.rows.map(r => ({date:global.SomapBankAuditEngine.parseDate(r.date)?.toLocaleDateString('sv-SE')})));
      if (!previous.parserMeta?.sourceHash && ((previous.statementPeriodFrom && previous.statementPeriodFrom !== inferred.from) || (previous.statementPeriodTo && previous.statementPeriodTo !== inferred.to))) throw new Error('Selected statement period differs from this saved audit.');
      const analysis = global.SomapBankAuditEngine.analyze(parsed.rows, {settings:formSettings(),meta:parsed.meta});
      if (!analysis.validation.valid) throw new Error('Parsing failed validation. ' + analysis.validation.errors.join(' '));
      let statementFile = previous.statementFile;
      if (!statementFile?.driveFileId) {
        const token = await global.SomapBankAuditStorage.requestDriveAccessToken();
        statementFile = await global.SomapBankAuditStorage.uploadAuditFile({...previous,_driveAccessToken:token},file,'statement');
      }
      const period = inferPeriod(analysis.transactions);
      const saved = await global.SomapBankAuditStorage.reparseAudit(id, {...analysis, parserMeta:parsed.meta, statementFile, statementPeriodFrom:period.from, statementPeriodTo:period.to, reportFile:null}, year());
      renderAudit(saved); await loadAudits();
      setStatus('Statement reparsed successfully. Previous analysis preserved in history; statement ID unchanged.', 'ok');
    } catch(error) { setStatus(error.message || String(error), 'error'); }
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
    try {
      const snap = await db().ref(global.SomapBankAuditStorage.path('students')).once('value');
      state.students = Object.entries(snap.val() || {}).map(([id,s]) => ({id,name:s.fullName || s.name || [s.firstName,s.middleName,s.lastName].filter(Boolean).join(' ')})).filter(s=>s.name);
    } catch(error) { setStatus('Student directory could not be loaded; matching is unavailable. ' + error.message, 'warn'); }
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
