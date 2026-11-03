(function (global) {
  "use strict";
  // The full transport expense book for one school and year, read-only. Three sources:
  //   1. transport  - the transport_expenses ledger the caller already read (as transportpayments.html reads it)
  //   2. approval   - every APPROVED "transport" request in years/{Y}/expenseApprovals whose approvalId is not
  //                   already in the ledger. The approvals queue is the record of what was approved, so an
  //                   approval that was written somewhere the page does not read still counts.
  //   3. finance    - Finance-book expenses (expenses/{Y}) whose category is transport / usafiri, e.g. the
  //                   "FUEL SCHOOL BUS" entries raised from finance.html.
  // Rows keep their own id and gain `source`; nothing is ever written back.
  //   collect({ db, P, year, ledger }) -> { rows, counts: {transport, approval, finance}, totals, warnings }

  const TRANSPORT_CATEGORY = /\b(transport|usafiri|school\s*bus|schoolbus)\b/i;

  async function readVal(db, path, warnings) {
    try { return (await db.ref(path).once("value")).val() || {}; }
    catch (error) { warnings.push(`${path}: ${error.message || error}`); return {}; }
  }

  function yearMatches(row, year) {
    return !row.year || String(row.year) === String(year);
  }

  async function collect(opts) {
    const db = opts.db, P = opts.P || ((p) => p), year = String(opts.year), warnings = [];
    const rows = [];
    // An approval is already in the ledger if the ledger row carries its approvalId, sits at its
    // recordedPath key, or (older rows) has the same description, amount and request timestamp.
    const seenApprovals = new Set(), ledgerKeys = new Set(), fingerprints = new Set();
    const fingerprint = (desc, amount, ts) => `${String(desc || "").trim().toLowerCase()}|${Number(amount) || 0}|${Number(ts) || 0}`;

    Object.entries(opts.ledger || {}).forEach(([id, e]) => {
      if (!e || typeof e !== "object" || !yearMatches(e, year)) return;
      if (e.approvalId) seenApprovals.add(String(e.approvalId));
      ledgerKeys.add(id);
      fingerprints.add(fingerprint(e.description, e.amount, e.timestamp));
      rows.push({ ...e, id, source: "transport" });
    });

    const queue = await readVal(db, P(`years/${year}/expenseApprovals`), warnings);
    Object.entries(queue).forEach(([id, r]) => {
      if (!r || String(r.module || "").toLowerCase() !== "transport" || String(r.status || "").toLowerCase() !== "approved") return;
      const p = r.targetPayload && typeof r.targetPayload === "object" ? r.targetPayload : {};
      const recordedKey = String(r.recordedPath || "").split("/").pop();
      if (seenApprovals.has(id) || (recordedKey && ledgerKeys.has(recordedKey))
        || fingerprints.has(fingerprint(p.description ?? r.description, p.amount ?? r.amount, p.timestamp))) return;
      const when = Number(p.timestamp) || Number(r.requestedAt) || (r.expenseDate ? new Date(`${r.expenseDate}T00:00:00`).getTime() : 0);
      rows.push({
        category: p.category || r.category || "OTHER", description: p.description || r.description || "",
        amount: Number(p.amount ?? r.amount) || 0, timestamp: when, addedBy: p.addedBy || r.requestedBy || "",
        year, approvalId: id, approvedBy: r.approvedBy || "", approvedAt: r.approvedAt || "", recordedPath: r.recordedPath || "",
        id: `approval_${id}`, source: "approval"
      });
    });

    const finance = await readVal(db, P(`expenses/${year}`), warnings);
    Object.entries(finance).forEach(([id, e]) => {
      if (!e || typeof e !== "object" || !TRANSPORT_CATEGORY.test(`${e.category || ""}`)) return;
      const when = Number(e.timestamp) || Number(e.createdAt) || (e.date ? new Date(`${e.date}T00:00:00`).getTime() : 0);
      rows.push({ ...e, amount: Number(e.amount) || 0, timestamp: when, addedBy: e.addedBy || e.createdBy || e.approvedBy || "",
        year, id: `finance_${id}`, source: "finance" });
    });

    const counts = { transport: 0, approval: 0, finance: 0 }, totals = { transport: 0, approval: 0, finance: 0 };
    rows.forEach((r) => { counts[r.source] += 1; totals[r.source] += Number(r.amount) || 0; });
    return { rows, counts, totals, warnings };
  }

  global.SomapTransportExpenseBook = { collect, TRANSPORT_CATEGORY };
})(window);
