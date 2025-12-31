// js/finance_dedupe.js
// Shared helpers to fingerprint payments and avoid double-counting.
(function (global) {
  const root = (global.SOMAP_FINANCE = global.SOMAP_FINANCE || {});

  function normalizeRef(raw) {
    if (raw == null) return "N/A";
    return String(raw).trim().toUpperCase();
  }

  function coerceAmount(p) {
    return Number(
      p?.amount ||
        p?.paidAmount ||
        p?.paid ||
        p?.allocation ||
        p?.value ||
        0
    );
  }

  function buildIdentity(p, workingYearFallback) {
    const year =
      p?.year ||
      p?.academicYear ||
      p?.financeYear ||
      p?.workingYear ||
      workingYearFallback ||
      "";

    const student =
      p?.studentAdm ||
      p?.admissionNo ||
      p?.admissionNumber ||
      p?.adm ||
      p?.studentId ||
      "";

    const amount = coerceAmount(p);
    const ref = normalizeRef(
      p?.refCode ||
        p?.referenceCode ||
        p?.receipt ||
        p?.paymentRef ||
        p?.ref ||
        p?.bankRef ||
        p?.mpesaRef ||
        p?.reference
    );

    const date = p?.paymentDate || p?.date || p?.txDate || p?.timestamp || "";

    const moduleName =
      p?.sourceModule || p?.module || p?.feeType || "School Fees";

    return [year, student, moduleName, amount, ref, date].join("|");
  }

  function iterateLedger(source, cb) {
    if (!source) return;
    if (typeof source.forEach === "function") {
      source.forEach((child) => {
        cb(child.key, typeof child.val === "function" ? child.val() : child);
      });
      return;
    }
    Object.entries(source || {}).forEach(([key, value]) => cb(key, value));
  }

  function extractPaymentEntries(entry) {
    if (!entry || typeof entry !== "object") return [];

    const looksLikePayment =
      entry.amount != null ||
      entry.paidAmount != null ||
      entry.allocation != null ||
      entry.value != null;

    if (looksLikePayment) return [{ key: "", payment: entry }];

    const paymentsSource =
      entry.payments || entry.entries || entry.records || entry || {};

    return Object.entries(paymentsSource).map(([key, payment]) => ({
      key,
      payment,
    }));
  }

  function decoratePayment(payment, studentHint, workingYear) {
    const base = payment || {};
    return {
      ...base,
      studentAdm:
        base.studentAdm ||
        base.admissionNo ||
        base.admissionNumber ||
        base.studentId ||
        studentHint ||
        "",
      year:
        base.year ||
        base.academicYear ||
        base.financeYear ||
        base.workingYear ||
        workingYear,
      sourceModule: base.sourceModule || base.module || "School Fees",
      paymentDate: base.paymentDate || base.date || base.txDate || base.timestamp,
      refCode:
        base.refCode ||
        base.referenceCode ||
        base.ref ||
        base.receipt ||
        base.paymentRef ||
        base.bankRef ||
        base.mpesaRef,
    };
  }

  function ledgerHasIdentity(source, workingYear, targetId, studentHint) {
    let found = false;
    iterateLedger(source, (studentKey, ledgerEntry) => {
      const studentRef = studentHint || studentKey;
      extractPaymentEntries(ledgerEntry).forEach(({ payment }) => {
        if (found || !payment) return;
        const decorated = decoratePayment(payment, studentRef, workingYear);
        const idKey = buildIdentity(decorated, workingYear);
        if (idKey === targetId) found = true;
      });
    });
    return found;
  }

  function aggregateLedgerSnapshot(source, workingYear, studentHint) {
    const seen = new Set();
    const perStudentPaid = {};
    let totalCollected = 0;

    iterateLedger(source, (studentKey, ledgerEntry) => {
      const studentRef = studentHint || studentKey;
      extractPaymentEntries(ledgerEntry).forEach(({ payment }) => {
        if (!payment) return;
        const decorated = decoratePayment(payment, studentRef, workingYear);
        const idKey = buildIdentity(decorated, workingYear);
        if (seen.has(idKey)) return;
        seen.add(idKey);

        const amount = coerceAmount(decorated);
        if (!amount) return;

        totalCollected += amount;
        const key = decorated.studentAdm || studentRef || "UNKNOWN";
        perStudentPaid[key] = (perStudentPaid[key] || 0) + amount;
      });
    });

    return { totalCollected, perStudentPaid, uniqueCount: seen.size };
  }

  function dedupePaymentMap(paymentsSource, workingYear, studentHint) {
    const clean = {};
    const seen = new Set();
    Object.entries(paymentsSource || {}).forEach(([key, value]) => {
      if (!value || typeof value !== "object") return;
      const decorated = decoratePayment(value, studentHint, workingYear);
      const idKey = buildIdentity(decorated, workingYear);
      if (seen.has(idKey)) return;
      seen.add(idKey);
      clean[key] = value;
    });
    return clean;
  }

  async function fetchLedgerData(db, ledgerPath) {
    if (!db || !ledgerPath) return null;
    if (typeof db.ref === "function") {
      const snap = await db.ref(ledgerPath).once("value");
      return snap.exists() ? snap.val() : null;
    }
    try {
      const { get, ref } = await import(
        "https://www.gstatic.com/firebasejs/9.22.2/firebase-database.js"
      );
      const snap = await get(ref(db, ledgerPath));
      return snap.exists() ? snap.val() : null;
    } catch (err) {
      console.warn("finance_dedupe: failed to fetch ledger data", err);
      return null;
    }
  }

  async function isDuplicateInLedger(db, ledgerPath, payment, workingYear, studentHint) {
    const ledgerData = await fetchLedgerData(db, ledgerPath);
    if (!ledgerData) return false;
    const targetId = buildIdentity(
      decoratePayment(payment, studentHint, workingYear),
      workingYear
    );
    return ledgerHasIdentity(ledgerData, workingYear, targetId, studentHint);
  }

  root.normalizeRef = normalizeRef;
  root.buildIdentity = buildIdentity;
  root.aggregateLedgerSnapshot = aggregateLedgerSnapshot;
  root.dedupePaymentMap = dedupePaymentMap;
  root.isDuplicateInLedger = isDuplicateInLedger;
})(typeof window !== "undefined" ? window : globalThis);
