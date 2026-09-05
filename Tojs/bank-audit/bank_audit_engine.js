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

  function normalizeTransaction(row, index, settings) {
    const dateObj = parseDate(row.date || row.transactionDate || row.postingDate);
    const valueDateObj = parseDate(row.valueDate);
    const moneyIn = Math.max(0, parseMoney(row.moneyIn ?? row.credit ?? row.deposit));
    const moneyOut = Math.max(0, parseMoney(row.moneyOut ?? row.debit ?? row.withdrawal));
    const desc = cleanText(row.description || row.narration || row.details || row.particulars);
    const reference = cleanText(row.bankReference || row.reference || row.ref || row.transactionId || row.chequeNo);
    const balance = parseMoney(row.balance);
    const chargeAmount = Math.max(0, parseMoney(row.chargeAmount || row.charges));
    const [category, confidence] = moneyIn > 0 ? [global.SomapCrdb.category(row.writtenPurpose ?? desc), global.SomapCrdb.category(row.writtenPurpose ?? desc) === "Unknown income" ? 0.35 : 0.9] : categoryFor({ description: desc, reference, moneyIn, moneyOut }, settings);
    const flags = [];
    if (!dateObj) flags.push("Date requires review");
    if (!desc) flags.push("Narration missing");
    if (moneyOut > 0) flags.push("Purpose not stated in bank narration. Supporting documentation required for company records.");
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
      reviewFlags: flags,
      notes: []
    };
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
    transactions.filter(t => t.moneyOut > 0).forEach(t => {
      const key = t.bankReference && t.postingTime && t.recipient ? [t.bankReference,t.date,t.postingTime,t.recipient,t.recipientAccount].join('|') : t.id;
      if (!groups.has(key)) groups.set(key, { ...t, id: 'wd_' + (groups.size + 1), transactions: [], rawLines: [], reviewFlags: [], amountWithdrawn: 0, charges: 0, totalImpact: 0,
        businessPurpose: 'Not stated in bank narration', evidence: 'Required', reviewer: '', reviewStatus: 'Pending documentation' });
      const g = groups.get(key); g.rawLines.push(t); g.transactions.push(t.id);
      g.totalImpact = global.SomapCrdb.round(g.totalImpact + t.moneyOut);
      g.reviewFlags = [...new Set([...g.reviewFlags, ...t.reviewFlags])];
    });
    return [...groups.values()].map(g => {
      // CRDB mobile transfers group principal, fee and tax under one reference.
      const mobileTriplet = g.rawLines.length === 3 && /TO (MPESA|AIRTEL|TIGOPESA|HALOPESA)/i.test(g.description);
      g.amountWithdrawn = mobileTriplet ? Math.max(...g.rawLines.map(t => t.moneyOut)) : g.totalImpact;
      g.charges = global.SomapCrdb.round(g.totalImpact - g.amountWithdrawn);
      g.principalBasis = mobileTriplet ? 'CRDB mobile transfer: largest debit principal; remaining lines charges' : 'Unseparated debit; verify against supporting evidence';
      g.reviewFlags.push('Purpose not stated in bank narration. Supporting documentation required for company records.');
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
    const transactions = (rawRows || [])
      .map((row, index) => normalizeTransaction(row, index, settings))
      .filter((t) => t.date && (t.moneyIn > 0) !== (t.moneyOut > 0));
    // Printed debit/credit columns are authoritative; balance gaps never change direction.
    detectDuplicates(transactions);
    const { totals, categoryTotals } = summarize(transactions);
    const withdrawalEvents = groupWithdrawalEvents(transactions);
    const validation = global.SomapCrdb.validate(rawRows || [], options?.meta);
    const statement = options?.meta?.statement || {};
    const discontinuities = [];
    transactions.forEach((t,i) => {
      if (!i) return;
      const expected = global.SomapCrdb.round(transactions[i-1].balance + t.moneyIn - t.moneyOut);
      const difference = global.SomapCrdb.round(t.balance - expected);
      if (Math.abs(difference) > 0.02) discontinuities.push({ transactionId: t.id, date: t.date, expected, displayed: t.balance, difference });
    });
    totals.totalCharges = global.SomapCrdb.round(withdrawalEvents.reduce((n,g) => n + g.charges,0));
    totals.totalPrincipal = global.SomapCrdb.round(withdrawalEvents.reduce((n,g) => n + g.amountWithdrawn,0));
    totals.withdrawalEventCount = withdrawalEvents.length;
    totals.groupedEventCount = totals.creditsCount + withdrawalEvents.length;
    Object.keys(totals).forEach(k => { if (typeof totals[k] === 'number') totals[k] = global.SomapCrdb.round(totals[k]); });
    const reviewItems = transactions.filter((t) => (t.reviewFlags || []).length);
    const income = transactions.filter((t) => t.moneyIn > 0);
    const expenses = transactions.filter((t) => t.moneyOut > 0);
    return {
      parserVersion: global.SomapCrdb.VERSION,
      validation, statement, discontinuities,
      generatedAt: Date.now(),
      settings,
      totals,
      categoryTotals,
      transactions,
      withdrawalEvents,
      reviewItems,
      income,
      expenses,
      findings: [...buildFindings(transactions, totals), ...discontinuities.map(d => `Running-balance discontinuity on ${d.date}: expected ${formatTsh(d.expected)}, printed ${formatTsh(d.displayed)}, difference ${formatTsh(d.difference)}.`)]
    };
  }

  global.SomapBankAuditEngine = {
    DEFAULT_SETTINGS,
    mergeSettings,
    parseMoney,
    parseDate,
    formatTsh,
    analyze,
    longDate
  };
})(window);
