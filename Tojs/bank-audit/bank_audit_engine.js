(function (global) {
  "use strict";

  const DEFAULT_SETTINGS = {
    remedialMonthlyAmount: 18000,
    graduationGraduandAmount: 45000,
    graduationOtherAmount: 10000,
    largeWithdrawalThreshold: 500000,
    weekendFlagEnabled: true,
    keywords: {
      remedial: ["remedial", "remed", "rem ", "tuition", "class 4", "class 7", "std 4", "std 7"],
      graduation: ["graduation", "grad", "mahafali", "sherehe"],
      transport: ["transport", "usafiri", "bus", "basi", "gari", "route", "pickup", "drop"],
      fuel: ["fuel", "mafuta", "petrol", "diesel", "oil"],
      vehicleRepair: ["repair", "service", "garage", "spea", "spare", "mechanic", "matengenezo"],
      bankCharge: ["charge", "charges", "levy", "fee", "commission", "excise", "vat"],
      transfer: ["transfer", "trf", "mobile", "sim banking", "airtel", "tigopesa", "mpesa", "halopesa"],
      withdrawal: ["withdraw", "cash", "atm", "agent", "wakala", "teller"]
    },
    studentAliases: {}
  };

  const MONEY = new Intl.NumberFormat("en-TZ", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  function mergeSettings(settings) {
    const merged = JSON.parse(JSON.stringify(DEFAULT_SETTINGS));
    const src = settings || {};
    Object.assign(merged, src);
    merged.keywords = Object.assign({}, DEFAULT_SETTINGS.keywords, src.keywords || {});
    merged.studentAliases = Object.assign({}, src.studentAliases || {});
    return merged;
  }

  function formatTsh(value) {
    return `TSh ${MONEY.format(Number(value) || 0)}`;
  }

  function cleanText(value) {
    return String(value || "").replace(/\s+/g, " ").trim();
  }

  function normalizeSearch(value) {
    return cleanText(value).toLowerCase();
  }

  function parseMoney(value) {
    if (typeof value === "number" && Number.isFinite(value)) return value;
    const raw = String(value || "").trim();
    if (/^\d{4}$/.test(raw) || /\d[./-]\d+[./-]/.test(raw)) return 0;
    if (!raw || /^[-–—]$/.test(raw)) return 0;
    const negative = /^\(|\)$/.test(raw) || /^-/.test(raw);
    const cleaned = raw
      .replace(/[TZS,\s]/gi, "")
      .replace(/[()]/g, "")
      .replace(/[^\d.-]/g, "");
    const n = Number(cleaned);
    if (!Number.isFinite(n)) return 0;
    return negative ? -Math.abs(n) : n;
  }

  function parseDate(value) {
    if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
    if (typeof value === 'number' && value > 20000 && value < 80000) return new Date(Math.round((value - 25569) * 86400000));
    return global.SomapCrdb.date(value);
  }

  function ymd(date) {
    if (!date) return "";
    return [
      date.getFullYear(),
      String(date.getMonth() + 1).padStart(2, "0"),
      String(date.getDate()).padStart(2, "0")
    ].join("-");
  }

  function longDate(value) {
    const d = value instanceof Date ? value : parseDate(value);
    if (!d) return "";
    return d.toLocaleDateString("en-GB", {
      weekday: "long",
      day: "2-digit",
      month: "long",
      year: "numeric"
    });
  }

  function dayOfWeek(value) {
    const d = value instanceof Date ? value : parseDate(value);
    return d ? d.toLocaleDateString("en-GB", { weekday: "long" }) : "";
  }

  function containsAny(text, keywords) {
    const n = normalizeSearch(text);
    return (keywords || []).some((k) => n.includes(String(k).toLowerCase()));
  }

  function titleName(value) {
    return cleanText(value)
      .split(" ")
      .filter(Boolean)
      .map((p) => p.charAt(0).toUpperCase() + p.slice(1).toLowerCase())
      .join(" ");
  }

  function detectName(description, settings) {
    const n = normalizeSearch(description);
    for (const [alias, canonical] of Object.entries(settings.studentAliases || {})) {
      if (alias && n.includes(alias.toLowerCase())) return canonical || titleName(alias);
    }
    const ignored = new Set(["crdb", "bank", "tzs", "cash", "deposit", "withdrawal", "transfer", "mobile", "remedial", "graduation", "transport", "usafiri"]);
    const words = cleanText(description).match(/[A-Za-z][A-Za-z'.-]{2,}/g) || [];
    const candidates = words.filter((w) => !ignored.has(w.toLowerCase()));
    if (candidates.length >= 2) return titleName(candidates.slice(0, 3).join(" "));
    return candidates[0] ? titleName(candidates[0]) : "";
  }

  function categoryFor(txn, settings) {
    const text = `${txn.description || ""} ${txn.reference || ""}`;
    const kw = settings.keywords;
    const isIn = Number(txn.moneyIn) > 0;
    const isOut = Number(txn.moneyOut) > 0;
    if (containsAny(text, kw.bankCharge) && isOut) return ["Bank charge", 0.92];
    if (containsAny(text, kw.remedial) && isIn) return ["Remedial", 0.9];
    if (containsAny(text, kw.graduation) && isIn) return ["Graduation", 0.9];
    if (containsAny(text, kw.transport) && isIn) return ["Transport / Usafiri", 0.88];
    if (containsAny(text, kw.fuel) && isOut) return ["Fuel", 0.84];
    if (containsAny(text, kw.vehicleRepair) && isOut) return ["Vehicle repair / maintenance", 0.84];
    if (containsAny(text, kw.withdrawal) && isOut) return ["Cash withdrawal", 0.82];
    if (containsAny(text, kw.transfer)) return [isIn ? "Transfer in" : "Transfer out", 0.76];
    if (isIn) return ["Unknown income", 0.35];
    if (isOut) return ["Unknown expense", 0.35];
    return ["Unclassified transaction", 0.2];
  }

  // CRDB posts its own fees and taxes as rows without a REF (e.g. "Debit Arrangement Tax",
  // "Charge - Capitalise Maintenance Fee"); they are bank charges, not transfer charges.
  const BANK_CHARGE_ROW = /\b(tax|charges?|fees?|levy|excise|vat|commission)\b/i;
  const INTERNAL_FLAG = "Possible owner / internal movement - confirm source before treating as school income";
  const LOAN_FLAG = "Narration mentions a loan - possible owner / internal movement; supporting documentation required";
  const REVERSAL_FLAG = "Reversal of an outgoing transfer with the same bank reference - confirm with the bank";

  function incomeCategory(row, config) {
    const category = global.SomapCrdb.category(row.writtenPurpose ?? row.description ?? "", config);
    return [category, category === "Unknown income" ? 0.35 : 0.9];
  }

  function normalizeTransaction(row, index, settings, purposeConfig) {
    const dateObj = parseDate(row.date || row.transactionDate || row.postingDate);
    const valueDateObj = parseDate(row.valueDate);
    const moneyIn = Math.max(0, parseMoney(row.moneyIn ?? row.credit ?? row.deposit));
    const moneyOut = Math.max(0, parseMoney(row.moneyOut ?? row.debit ?? row.withdrawal));
    const desc = cleanText(row.description || row.narration || row.details || row.particulars);
    const reference = cleanText(row.bankReference || row.reference || row.ref || row.transactionId || row.chequeNo);
    const balance = parseMoney(row.balance);
    const chargeAmount = Math.max(0, parseMoney(row.chargeAmount || row.charges));
    const bankChargeRow = row.nonRef === true && moneyOut > 0 && BANK_CHARGE_ROW.test(desc);
    const [category, confidence] = moneyIn > 0 ? incomeCategory({ writtenPurpose: row.writtenPurpose, description: desc }, purposeConfig)
      : bankChargeRow ? ["Bank charge", 0.95]
      : categoryFor({ description: desc, reference, moneyIn, moneyOut }, settings);
    const flags = [];
    if (!dateObj) flags.push("Date requires review");
    if (!desc) flags.push("Narration missing");
    if (moneyOut > 0 && !bankChargeRow) flags.push("Purpose not stated in bank narration. Supporting documentation required for company records.");
    if (moneyOut > 0 && /loan\b|mkopo/i.test(desc)) flags.push(LOAN_FLAG);
    if (confidence < 0.5) flags.push("Purpose unclear");
    if (moneyOut >= settings.largeWithdrawalThreshold) flags.push("Large withdrawal - supporting evidence recommended");
    const dow = dayOfWeek(dateObj);
    if (settings.weekendFlagEnabled && moneyOut > 0 && ["Saturday", "Sunday"].includes(dow)) {
      flags.push("Weekend withdrawal - supporting evidence recommended");
    }
    if (category === "Bank charge") flags.push("Bank charge separated from principal");

    return {
      ...row,
      id: row.id || `txn_${String(index + 1).padStart(4, "0")}`,
      sourceRow: row.sourceRow ?? index + 1,
      date: ymd(dateObj),
      dateLabel: longDate(dateObj),
      dayOfWeek: dow,
      valueDate: ymd(valueDateObj),
      description: desc,
      reference,
      moneyIn,
      moneyOut,
      chargeAmount,
      balance,
      counterpartyName: cleanText(row.counterpartyName),
      detectedStudentName: moneyIn > 0 ? (row.detectedStudentName ?? "") : "",
      detectedPurpose: category,
      category,
      confidence,
      bankChargeRow,
      reviewFlags: flags,
      notes: []
    };
  }

  // A credit carrying the same bank reference as a debit in this statement is the bank
  // returning that transfer (e.g. a failed M-Pesa payout), not new income.
  // A credit without an AB payment reference that arrives through the account's own
  // banking channels (SIMAPP / IB), or from someone this statement pays out to, is flagged
  // as a possible owner / internal movement. It is never auto-classified.
  function markReversals(transactions) {
    const debitRefs = new Set(transactions.filter(t => t.moneyOut > 0 && t.bankReference).map(t => t.bankReference));
    const recipients = new Set(transactions.filter(t => t.moneyOut > 0 && t.recipient).map(t => normalizeSearch(t.recipient)));
    transactions.forEach(t => {
      if (t.moneyIn > 0 && !t.paymentReference && (/^(SIMAPP|IB)\b/i.test(t.transactionType || "") || (t.sender && recipients.has(normalizeSearch(t.sender))))) t.reviewFlags.push(INTERNAL_FLAG);
      if (!(t.moneyIn > 0) || !t.bankReference || !debitRefs.has(t.bankReference)) return;
      t.reversalOf = t.bankReference;
      t.category = t.detectedPurpose = "Transfer reversal";
      t.confidence = 0.9;
      t.reviewFlags = t.reviewFlags.filter(f => f !== INTERNAL_FLAG && f !== "Purpose unclear");
      t.reviewFlags.push(REVERSAL_FLAG);
    });
  }

  // Unknown-income purpose labels, grouped by normalised spelling, excluding labels the school
  // already rejected. A label that looks like a misspelling of an existing type is offered as a
  // merge into that type (even once); any other label becomes a "new payment type" card once
  // at least `config.minCount` payments (default 2) use it.
  function purposeSuggestions(transactions, config) {
    const minCount = Math.max(1, Number(config?.minCount) || 2);
    const C = global.SomapCrdb, rejected = config?.rejectedLabels || {}, groups = [];
    (transactions || []).forEach(t => {
      if (!(t.moneyIn > 0) || t.category !== "Unknown income" || t.reversalOf) return;
      const label = cleanText(t.writtenPurpose), key = C.purposeKey(label);
      if (!key || rejected[key]) return;
      let g = groups.find(g => g.keys.some(k => C.similarPurpose(k, key)));
      if (!g) groups.push(g = { keys: [], labels: {}, count: 0, total: 0, names: [], transactionIds: [] });
      if (!g.keys.includes(key)) g.keys.push(key);
      g.labels[label] = (g.labels[label] || 0) + 1;
      g.count += 1;
      g.total = C.round(g.total + t.moneyIn);
      const name = t.detectedStudentName || t.sender;
      if (name && !g.names.includes(name)) g.names.push(name);
      g.transactionIds.push(t.id);
    });
    return groups
      .map(g => {
        const label = Object.entries(g.labels).sort((a, b) => b[1] - a[1])[0][0];
        return { ...g, key: g.keys[0], label, variants: Object.keys(g.labels), mergeInto: C.nearPurpose(label, config) };
      })
      .filter(g => g.mergeInto || g.count >= minCount)
      .sort((a, b) => Number(!!b.mergeInto) - Number(!!a.mergeInto) || b.count - a.count || b.total - a.total);
  }

  function categoryTotalsOf(transactions) {
    const totals = {};
    transactions.forEach(t => { totals[t.category] = global.SomapCrdb.round((totals[t.category] || 0) + (t.moneyIn || t.moneyOut || 0)); });
    return totals;
  }

  // Re-apply the school's current purpose decisions to an analysed or saved audit.
  // Only bank-written income purposes change; amounts, references and debits are untouched.
  function applyPurposes(audit, config) {
    if (!audit?.transactions) return audit;
    audit.transactions.forEach(t => {
      if (!(t.moneyIn > 0) || t.reversalOf) return;
      const [category, confidence] = incomeCategory(t, config);
      if (category === t.category) return;
      t.category = t.detectedPurpose = category;
      t.confidence = confidence;
      t.reviewFlags = (t.reviewFlags || []).filter(f => f !== "Purpose unclear");
      if (confidence < 0.5) t.reviewFlags.push("Purpose unclear");
    });
    audit.categoryTotals = categoryTotalsOf(audit.transactions);
    audit.income = audit.transactions.filter(t => t.moneyIn > 0);
    audit.reviewItems = audit.transactions.filter(t => (t.reviewFlags || []).length);
    if (audit.totals) audit.totals.reviewItems = audit.reviewItems.length;
    audit.purposeSuggestions = purposeSuggestions(audit.transactions, config);
    return audit;
  }

  function isIncomingCategory(category) {
    return ["Remedial", "Graduation", "Transport / Usafiri", "School fees / general payment", "Donation / support", "Transfer in", "Unknown income"].includes(category);
  }

  function summarize(transactions) {
    const totals = {
      transactionCount: transactions.length,
      totalDeposits: 0,
      totalWithdrawals: 0,
      totalCharges: 0,
      netMovement: 0,
      openingBalance: 0,
      closingBalance: 0,
      recalculatedClosingBalance: 0,
      balanceVariance: 0,
      creditsCount: 0,
      debitsCount: 0,
      reviewItems: 0
    };
    const categoryTotals = {};
    transactions.forEach((t, i) => {
      totals.totalDeposits += Number(t.moneyIn) || 0;
      totals.totalWithdrawals += Number(t.moneyOut) || 0;
      totals.totalCharges += Number(t.chargeAmount) || 0;
      if (t.moneyIn > 0) totals.creditsCount += 1;
      if (t.moneyOut > 0) totals.debitsCount += 1;
      totals.reviewItems += (t.reviewFlags || []).length ? 1 : 0;
      categoryTotals[t.category] = (categoryTotals[t.category] || 0) + (t.moneyIn || t.moneyOut || 0);
      if (i === 0 && Number.isFinite(Number(t.balance))) {
        totals.openingBalance = Number(t.balance) - Number(t.moneyIn || 0) + Number(t.moneyOut || 0);
      }
      if (Number.isFinite(Number(t.balance)) && Number(t.balance) !== 0) totals.closingBalance = Number(t.balance);
    });
    totals.netMovement = totals.totalDeposits - totals.totalWithdrawals;
    totals.recalculatedClosingBalance = totals.openingBalance + totals.netMovement;
    if (totals.closingBalance) totals.balanceVariance = totals.closingBalance - totals.recalculatedClosingBalance;
    return { totals, categoryTotals };
  }

  function groupWithdrawalEvents(transactions) {
    const groups = new Map();
    const reversedRefs = new Set(transactions.filter(t => t.reversalOf).map(t => t.reversalOf));
    transactions.filter(t => t.moneyOut > 0 && !t.bankChargeRow).forEach(t => {
      const key = t.bankReference && t.postingTime && t.recipient ? [t.bankReference,t.date,t.postingTime,t.recipient,t.recipientAccount].join('|') : t.id;
      if (!groups.has(key)) groups.set(key, { ...t, id: 'wd_' + (groups.size + 1), transactions: [], rawLines: [], reviewFlags: [], amountWithdrawn: 0, charges: 0, totalImpact: 0,
        businessPurpose: 'Not stated in bank narration', evidence: 'Required', reviewer: '', reviewStatus: 'Pending documentation' });
      const g = groups.get(key); g.rawLines.push(t); g.transactions.push(t.id);
      g.totalImpact = global.SomapCrdb.round(g.totalImpact + t.moneyOut);
      g.reviewFlags = [...new Set([...g.reviewFlags, ...t.reviewFlags])];
    });
    return [...groups.values()].map(g => {
      // CRDB posts principal, fee and tax under one reference (mobile wallets and TIPS transfers alike).
      const largest = Math.max(...g.rawLines.map(t => t.moneyOut));
      const mobileTriplet = g.rawLines.length === 3 && /TO (MPESA|AIRTEL|TIGO|HALOPESA|HALOTEL)/i.test(g.description);
      const chargeTriplet = mobileTriplet || (g.rawLines.length === 3 && g.rawLines.filter(t => t.moneyOut < largest * 0.1).length === 2);
      g.amountWithdrawn = chargeTriplet ? largest : g.totalImpact;
      g.charges = global.SomapCrdb.round(g.totalImpact - g.amountWithdrawn);
      g.principalBasis = mobileTriplet ? 'CRDB mobile transfer: largest debit principal; remaining lines charges'
        : chargeTriplet ? 'CRDB transfer: largest debit principal; two small lines under the same reference are fee and tax'
        : 'Unseparated debit; verify against supporting evidence';
      g.reviewFlags.push('Purpose not stated in bank narration. Supporting documentation required for company records.');
      if (reversedRefs.has(g.bankReference)) g.reviewFlags.push('Bank returned this transfer: credit(s) with the same reference appear in this statement.');
      return g;
    });
  }

  function detectDuplicates(transactions) {
    const seen = new Map();
    transactions.forEach((t) => {
      const key = [t.date, t.moneyIn, t.moneyOut, normalizeSearch(t.reference || t.description).slice(0, 40)].join("|");
      if (seen.has(key)) {
        t.reviewFlags.push("Possible duplicate transaction");
        const prev = seen.get(key);
        prev.reviewFlags = prev.reviewFlags || [];
        if (!prev.reviewFlags.includes("Possible duplicate transaction")) prev.reviewFlags.push("Possible duplicate transaction");
      } else {
        seen.set(key, t);
      }
    });
  }

  function correctDirectionFromBalances(transactions, settings) {
    for (let i = 1; i < transactions.length; i += 1) {
      const prev = Number(transactions[i - 1].balance);
      const current = Number(transactions[i].balance);
      const t = transactions[i];
      if (!Number.isFinite(prev) || !Number.isFinite(current) || (!t.moneyIn && !t.moneyOut)) continue;
      const diff = current - prev;
      const amount = Math.abs(Number(t.moneyIn || t.moneyOut || 0));
      if (!amount || Math.abs(Math.abs(diff) - amount) > 2) continue;
      if (diff > 0 && !t.moneyIn) {
        t.moneyIn = amount;
        t.moneyOut = 0;
      } else if (diff < 0 && !t.moneyOut) {
        t.moneyOut = amount;
        t.moneyIn = 0;
      } else {
        continue;
      }
      const [category, confidence] = categoryFor(t, settings);
      t.category = category;
      t.detectedPurpose = category;
      t.confidence = Math.max(t.confidence || 0, confidence, 0.7);
      if (t.moneyOut > 0 && settings.weekendFlagEnabled && ["Saturday", "Sunday"].includes(t.dayOfWeek)) {
        const flag = "Weekend withdrawal - supporting evidence recommended";
        if (!t.reviewFlags.includes(flag)) t.reviewFlags.push(flag);
      }
      t.notes.push("Debit/credit direction confirmed from running balance movement.");
    }
  }

  // CRDB sometimes posts near-simultaneous rows in a different order than it prints them
  // (e.g. a 16:22 debit applied before a 16:21 credit). Replay the printed balances, letting
  // a row within the next few same-day rows be applied first when that exactly explains the
  // printed balance. Anything still unexplained is a genuine discontinuity.
  const REORDER_WINDOW = 8;
  function checkRunningBalance(transactions) {
    const round = global.SomapCrdb.round, discontinuities = [], reordered = [];
    const pending = transactions.slice(1);
    let balance = transactions[0]?.balance;
    const fits = t => Math.abs(round(balance + t.moneyIn - t.moneyOut) - t.balance) <= 0.02;
    while (pending.length) {
      const head = pending[0];
      let pick = fits(head) ? 0 : -1;
      for (let i = 1; pick < 0 && i < Math.min(pending.length, REORDER_WINDOW); i += 1) {
        if (pending[i].date === head.date && fits(pending[i])) pick = i;
      }
      if (pick < 0) {
        const expected = round(balance + head.moneyIn - head.moneyOut);
        discontinuities.push({ transactionId: head.id, date: head.date, expected, displayed: head.balance, difference: round(head.balance - expected) });
        pick = 0;
      } else if (pick > 0) {
        reordered.push({ transactionId: pending[pick].id, date: pending[pick].date, postingTime: pending[pick].postingTime, before: head.id });
      }
      balance = pending[pick].balance;
      pending.splice(pick, 1);
    }
    return { discontinuities, reordered };
  }

  function buildFindings(transactions, totals) {
    const findings = [];
    if (totals.totalDeposits || totals.totalWithdrawals) {
      findings.push(`Statement movement: ${formatTsh(totals.totalDeposits)} deposited and ${formatTsh(totals.totalWithdrawals)} withdrawn.`);
    }
    const weekend = transactions.filter((t) => t.reviewFlags?.some((f) => f.includes("Weekend withdrawal"))).length;
    if (weekend) findings.push(`${weekend} withdrawal transaction(s) occurred on a weekend and should have supporting evidence attached where applicable.`);
    const unclear = transactions.filter((t) => t.reviewFlags?.includes("Purpose unclear")).length;
    if (unclear) findings.push(`${unclear} transaction(s) require purpose classification or a finance note.`);
    if (Math.abs(totals.balanceVariance) > 1) findings.push(`Running balance variance detected: ${formatTsh(totals.balanceVariance)}. Verify extraction against the bank statement.`);
    return findings;
  }

  function analyze(rawRows, options) {
    const settings = mergeSettings(options?.settings);
    const purposeConfig = options?.purposeConfig || {};
    // Zero-value rows stay in the raw rows as evidence but are excluded here from totals and grouping.
    const transactions = (rawRows || [])
      .map((row, index) => normalizeTransaction(row, index, settings, purposeConfig))
      .filter((t) => t.date && (t.moneyIn > 0) !== (t.moneyOut > 0));
    // Printed debit/credit columns are authoritative; balance gaps never change direction.
    markReversals(transactions);
    detectDuplicates(transactions);
    const { totals } = summarize(transactions);
    const categoryTotals = categoryTotalsOf(transactions);
    const withdrawalEvents = groupWithdrawalEvents(transactions);
    const validation = global.SomapCrdb.validate(rawRows || [], options?.meta);
    const statement = options?.meta?.statement || {};
    const { discontinuities, reordered } = checkRunningBalance(transactions);
    totals.totalCharges = global.SomapCrdb.round(withdrawalEvents.reduce((n,g) => n + g.charges,0));
    totals.totalPrincipal = global.SomapCrdb.round(withdrawalEvents.reduce((n,g) => n + g.amountWithdrawn,0));
    const bankCharges = transactions.filter(t => t.bankChargeRow);
    totals.bankCharges = global.SomapCrdb.round(bankCharges.reduce((n,t) => n + t.moneyOut,0));
    totals.bankChargeCount = bankCharges.length;
    totals.withdrawalEventCount = withdrawalEvents.length;
    totals.groupedEventCount = totals.creditsCount + withdrawalEvents.length;
    Object.keys(totals).forEach(k => { if (typeof totals[k] === 'number') totals[k] = global.SomapCrdb.round(totals[k]); });
    const reviewItems = transactions.filter((t) => (t.reviewFlags || []).length);
    const income = transactions.filter((t) => t.moneyIn > 0);
    const expenses = transactions.filter((t) => t.moneyOut > 0);
    return {
      parserVersion: options?.meta?.parserVersion || global.SomapCrdb.VERSION,
      validation, statement, discontinuities, postingOrderNotes: reordered,
      generatedAt: Date.now(),
      settings,
      totals,
      categoryTotals,
      transactions,
      withdrawalEvents,
      reviewItems,
      income,
      expenses,
      purposeSuggestions: purposeSuggestions(transactions, purposeConfig),
      findings: [...buildFindings(transactions, totals),
        ...(bankCharges.length ? [`${bankCharges.length} bank charge row(s) without a bank reference: ${formatTsh(totals.bankCharges)} (${bankCharges.map(t => t.description).join('; ')}).`] : []),
        ...(reordered.length ? [`${reordered.length} row(s) on ${[...new Set(reordered.map(r => r.date))].join(', ')} were posted by the bank in a different order than printed; the printed balances reconcile.`] : []),
        ...discontinuities.map(d => `Running-balance discontinuity on ${d.date}: expected ${formatTsh(d.expected)}, printed ${formatTsh(d.displayed)}, difference ${formatTsh(d.difference)}.`)]
    };
  }

  global.SomapBankAuditEngine = {
    DEFAULT_SETTINGS,
    mergeSettings,
    parseMoney,
    parseDate,
    formatTsh,
    analyze,
    applyPurposes,
    purposeSuggestions,
    longDate
  };
})(window);
