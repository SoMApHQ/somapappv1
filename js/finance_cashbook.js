(function (global) {
  const ENTRY_TYPES = {
    DEDUCT_MAIN: 'deduct_main_income',
    EXTERNAL: 'external_support',
    REFUNDABLE: 'refundable',
  };

  function toAmount(value) {
    const n = Number(value);
    if (!Number.isFinite(n)) return 0;
    return Math.max(0, Math.round(n));
  }

  function sanitizeType(value) {
    const raw = String(value || '').trim().toLowerCase();
    if (raw === ENTRY_TYPES.DEDUCT_MAIN) return ENTRY_TYPES.DEDUCT_MAIN;
    if (raw === ENTRY_TYPES.REFUNDABLE) return ENTRY_TYPES.REFUNDABLE;
    return ENTRY_TYPES.EXTERNAL;
  }

  function normalizeFundingEntry(raw, id) {
    const row = raw && typeof raw === 'object' ? raw : {};
    return {
      id: id || row.id || '',
      amount: toAmount(row.amount),
      receivedFrom: String(row.receivedFrom || '').trim(),
      receivedBy: String(row.receivedBy || '').trim(),
      entryType: sanitizeType(row.entryType),
      note: String(row.note || '').trim(),
      date: String(row.date || '').trim(),
      timestamp: Number(row.timestamp) || Number(row.createdAt) || 0,
      createdAt: Number(row.createdAt) || 0,
    };
  }

  function summarize(input) {
    const fundingEntries = Array.isArray(input?.fundingEntries) ? input.fundingEntries : [];
    const expenseEntries = Array.isArray(input?.expenseEntries) ? input.expenseEntries : [];

    let totalReceived = 0;
    let deductFromMain = 0;
    let externalSupport = 0;
    let refundCorner = 0;
    let totalExpenses = 0;

    fundingEntries.forEach((entry) => {
      const amt = toAmount(entry?.amount);
      totalReceived += amt;
      const type = sanitizeType(entry?.entryType);
      if (type === ENTRY_TYPES.DEDUCT_MAIN) deductFromMain += amt;
      else if (type === ENTRY_TYPES.REFUNDABLE) refundCorner += amt;
      else externalSupport += amt;
    });

    expenseEntries.forEach((entry) => {
      totalExpenses += toAmount(entry?.amount);
    });

    const inPocket = totalReceived - totalExpenses;

    return {
      totalReceived,
      deductFromMain,
      externalSupport,
      refundCorner,
      totalExpenses,
      inPocket,
    };
  }

  global.SomapFinanceCashbook = {
    ENTRY_TYPES,
    toAmount,
    sanitizeType,
    normalizeFundingEntry,
    summarize,
  };
})(window);
