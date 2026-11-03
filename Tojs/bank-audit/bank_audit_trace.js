(function (global) {
  "use strict";
  // Withdrawal trace: who received money from the account, and how much of it the transport expense
  // book explains. Nothing here is tied to a person: the subject is whichever recipient the user picks,
  // widened by shared name parts and shared phone numbers, plus any other recipients the user adds.
  //   recipients(audit)                    -> one row per distinct recipient name
  //   related(list, subjectKey)            -> other names that look like the same person, with the reason
  //   build(audit, {subjectKeys, otherKeys, transport}) -> everything the trace UI and PDF show
  //   expenseDate(expense)                 -> the day the money was spent (description date beats entry date)

  const round = (v) => Math.round(Number(v || 0) * 100) / 100;
  const sum = (rows, key) => round(rows.reduce((n, r) => n + (Number(r[key]) || 0), 0));
  const DAY = 86400000;
  // Words that say nothing about who a person is.
  const STOP = new Set(["LIMITED", "LTD", "COMPANY", "INVESTMENT", "INVESTMENTS", "SOCRATES", "SCHOOL", "TRADING", "ENTERPRISES",
    "ENTERPRISE", "GROUP", "THE", "AND", "MR", "MRS", "MS", "BIN", "BINTI", "LOAN", "TRANSPORT", "FUEL", "FUELS"]);
  const WEEKDAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
  const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };

  const normName = (v) => String(v || "").toUpperCase().replace(/[^A-Z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();
  const compact = (v) => normName(v).replace(/ /g, "");
  const tokens = (v) => normName(v).split(" ").filter((t) => t.length >= 3 && !STOP.has(t) && !/^\d+$/.test(t));
  function phone(v) {
    const d = String(v || "").replace(/\D/g, "");
    if (/^255\d{9}$/.test(d)) return "0" + d.slice(3);
    if (/^\d{9}$/.test(d)) return "0" + d;
    return /^0\d{9}$/.test(d) ? d : "";
  }
  function iso(d) { return d ? `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}` : ""; }
  function fromIso(s) { const m = String(s || "").match(/^(\d{4})-(\d{2})-(\d{2})/); return m ? new Date(+m[1], +m[2] - 1, +m[3]) : null; }
  const addDays = (s, n) => iso(new Date(fromIso(s).getTime() + n * DAY + 12 * 3600000));
  const weekdayOf = (s) => WEEKDAYS[(fromIso(s).getDay() + 6) % 7];
  function mondayOf(s) { const d = fromIso(s); return addDays(s, -((d.getDay() + 6) % 7)); }

  function channel(w) {
    const t = String(w.transactionType || w.description || "");
    if (/MPESA/i.test(t)) return { label: "M-Pesa", kind: "mobile" };
    if (/AIRTEL/i.test(t)) return { label: "Airtel Money", kind: "mobile" };
    if (/TIGO|MIXX/i.test(t)) return { label: "Tigo Pesa / Mixx", kind: "mobile" };
    if (/HALO/i.test(t)) return { label: "HaloPesa", kind: "mobile" };
    if (/TIPS/i.test(t)) return { label: "Other bank (TIPS)", kind: "bank" };
    if (/\bIB\s+FT\b/i.test(t)) return { label: "CRDB account", kind: "bank" };
    if (/ATM|CASH|TELLER|WITHDRAW/i.test(t)) return { label: "Cash", kind: "cash" };
    return { label: String(w.transactionType || "Other").trim() || "Other", kind: "other" };
  }
  const reasonOf = (w) => (w.rawLines || [w]).map((t) => t.statedReason).find(Boolean) || w.statedReason || "";
  const returnedRefs = (audit) => new Set((audit?.transactions || []).filter((t) => t.reversalOf).map((t) => t.reversalOf));

  function recipients(audit) {
    const back = returnedRefs(audit), map = new Map();
    (audit?.withdrawalEvents || []).forEach((w) => {
      const name = String(w.recipient || "").trim() || "Recipient not stated";
      const key = normName(name) || "UNSTATED";
      const g = map.get(key) || { key, name, tokens: tokens(name), phones: new Set(), channels: new Set(), count: 0, principal: 0, charges: 0, returned: 0 };
      if (back.has(w.bankReference)) { g.returned = round(g.returned + w.amountWithdrawn); map.set(key, g); return; }
      const p = phone(w.recipientAccount);
      if (p) g.phones.add(p);
      g.channels.add(channel(w).label);
      g.count += 1; g.principal = round(g.principal + w.amountWithdrawn); g.charges = round(g.charges + w.charges);
      map.set(key, g);
    });
    return [...map.values()].map((g) => ({ ...g, phones: [...g.phones], channels: [...g.channels] })).sort((a, b) => b.principal - a.principal);
  }

  // strong = pre-ticked (same number, two shared name parts, or a one-word / run-together name that is
  // the subject's first name); weak = one shared name part, shown unticked for the user to decide.
  function related(list, subjectKey) {
    const s = list.find((r) => r.key === subjectKey);
    if (!s) return [];
    const first = s.tokens[0] || "";
    return list.filter((r) => r.key !== s.key).map((r) => {
      const phones = r.phones.filter((p) => s.phones.includes(p));
      const shared = r.tokens.filter((t) => s.tokens.includes(t));
      const joined = first.length >= 4 && (compact(r.name).startsWith(first) || r.tokens.some((t) => t.startsWith(first) && t !== first));
      if (phones.length) return { key: r.key, strong: true, reason: `same number ${phones.join(", ")}` };
      if (shared.length >= 2) return { key: r.key, strong: true, reason: `shares names ${shared.join(" ")}` };
      if (r.tokens.length <= 1 && shared.length) return { key: r.key, strong: true, reason: `name is just ${shared[0]}` };
      if (joined) return { key: r.key, strong: true, reason: `name starts with ${first}` };
      if (shared.length) return { key: r.key, strong: false, reason: `shares the name ${shared[0]}` };
      return null;
    }).filter(Boolean).sort((a, b) => Number(b.strong) - Number(a.strong));
  }

  // The day the money was spent. Clerks type it at the start of the description ("16/04-fuel ...",
  // "7-may yasins van") and record days later, so a plausible date in the description (up to 75 days
  // before the entry, never after it) wins over the entry timestamp.
  function expenseDate(e) {
    const recorded = e.timestamp || e.requestedAt ? new Date(Number(e.timestamp || e.requestedAt)) : fromIso(e.expenseDate || e.date);
    const rec = recorded && !Number.isNaN(recorded.getTime()) ? recorded : null;
    const recordedIso = iso(rec);
    const d = String(e.description || "");
    let day, mon, yr;
    let m = d.match(/(?:^|[^\d])(\d{1,2})\s*[/.]\s*(\d{1,2})(?:\s*[/.]\s*(\d{2,4}))?(?![\d])/);
    if (m) { day = +m[1]; mon = +m[2]; yr = m[3] ? +(m[3].length === 2 ? "20" + m[3] : m[3]) : 0; }
    else if ((m = d.match(/(?:^|[^\d])(\d{1,2})(?:st|nd|rd|th)?\s*[-\s]\s*(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?(?:\s+(\d{4}))?/i))) {
      day = +m[1]; mon = MONTHS[m[2].toLowerCase()]; yr = m[3] ? +m[3] : 0;
    }
    if (rec && day >= 1 && day <= 31 && mon >= 1 && mon <= 12) {
      let y = yr || rec.getFullYear();
      let cand = new Date(y, mon - 1, day);
      if (!yr && cand.getTime() > rec.getTime() + DAY) cand = new Date(y - 1, mon - 1, day);
      const lag = (rec.getTime() - cand.getTime()) / DAY;
      if (cand.getDate() === day && lag >= -1 && lag <= 75) return { date: iso(cand), recordedDate: recordedIso, source: "description" };
    }
    return { date: recordedIso, recordedDate: recordedIso, source: "entry date" };
  }

  function transportBook(raw, from, to) {
    const rows = (raw?.expenses || []).map((e) => ({ ...e, amount: round(e.amount), ...expenseDate(e) })).filter((e) => e.date && e.amount > 0);
    const inPeriod = rows.filter((e) => e.date >= from && e.date <= to).sort((a, b) => a.date.localeCompare(b.date));
    // Entered during the period but for days before it began: belongs to the previous statement.
    const backdated = rows.filter((e) => e.date < from && e.recordedDate >= from).sort((a, b) => a.date.localeCompare(b.date));
    const pending = (raw?.pending || []).map((e) => ({ ...e, amount: round(e.amount), ...expenseDate(e) })).filter((e) => e.date >= from && e.date <= to && e.amount > 0);
    const byCategory = {};
    inPeriod.forEach((e) => { const c = String(e.category || "OTHER").toUpperCase(); byCategory[c] = round((byCategory[c] || 0) + e.amount); });
    const days = new Set(inPeriod.map((e) => e.date));
    const firstDate = inPeriod[0]?.date || "", lastDate = inPeriod.at(-1)?.date || "";
    // Runs of 3+ weekdays with nothing written, inside the covered stretch (the tail is reported separately).
    const gaps = [];
    if (firstDate) {
      let run = null;
      for (let d = from; d <= lastDate; d = addDays(d, 1)) {
        const weekend = ["Saturday", "Sunday"].includes(weekdayOf(d));
        if (days.has(d)) { if (run && run.weekdays >= 3) gaps.push(run); run = null; continue; }
        if (!run) run = { from: d, to: d, days: 0, weekdays: 0 };
        run.to = d; run.days += 1; if (!weekend) run.weekdays += 1;
      }
      if (run && run.weekdays >= 3) gaps.push(run);
    }
    const tail = !lastDate ? { from, to, days: daysBetween(from, to) } : lastDate < to ? { from: addDays(lastDate, 1), to, days: daysBetween(addDays(lastDate, 1), to) } : null;
    return { rows: inPeriod, total: sum(inPeriod, "amount"), byCategory, firstDate, lastDate, gaps, tail, daysWritten: days.size,
      backdated, backdatedTotal: sum(backdated, "amount"), pending, pendingTotal: sum(pending, "amount"),
      fromDescription: inPeriod.filter((e) => e.source === "description").length, warnings: raw?.warnings || [] };
  }
  const daysBetween = (a, b) => Math.round((fromIso(b) - fromIso(a)) / DAY) + 1;

  const BANDS = ["Night (00:00-05:59)", "Morning (06:00-11:59)", "Afternoon (12:00-17:59)", "Evening (18:00-20:59)", "Late night (21:00-23:59)", "Unknown"];
  function hourBand(t) {
    const h = /^\d{2}/.test(t || "") ? Number(t.slice(0, 2)) : NaN;
    if (!Number.isFinite(h)) return "Unknown";
    if (h < 6) return "Night (00:00-05:59)";
    if (h < 12) return "Morning (06:00-11:59)";
    if (h < 18) return "Afternoon (12:00-17:59)";
    if (h < 21) return "Evening (18:00-20:59)";
    return "Late night (21:00-23:59)";
  }
  const afterHours = (t) => { if (!/^\d{2}/.test(t || "")) return false; const h = Number(t.slice(0, 2)); return h < 7 || h >= 19; };

  function build(audit, opts) {
    const o = opts || {};
    const from = audit?.statementPeriodFrom || (audit?.transactions || []).map((t) => t.date).filter(Boolean).sort()[0] || "";
    const to = audit?.statementPeriodTo || (audit?.transactions || []).map((t) => t.date).filter(Boolean).sort().at(-1) || "";
    const subjectKeys = new Set(o.subjectKeys || []), otherKeys = new Set((o.otherKeys || []).filter((k) => !subjectKeys.has(k)));
    const back = returnedRefs(audit), list = recipients(audit);
    const keyOf = (w) => normName(String(w.recipient || "").trim() || "Recipient not stated") || "UNSTATED";
    const subjectPhones = new Set(list.filter((r) => subjectKeys.has(r.key)).flatMap((r) => r.phones));
    const all = (audit?.withdrawalEvents || []).map((w) => ({
      ...w, rawLines: undefined, key: keyOf(w), channel: channel(w), phone: phone(w.recipientAccount), reason: reasonOf(w),
      returned: back.has(w.bankReference), weekday: w.dayOfWeek || (w.date ? weekdayOf(w.date) : ""), time: String(w.postingTime || "").slice(0, 5)
    }));
    const live = all.filter((w) => !w.returned);
    const subjectEvents = live.filter((w) => subjectKeys.has(w.key)).sort(byWhen);
    const otherEvents = live.filter((w) => otherKeys.has(w.key)).sort(byWhen);
    const included = [...subjectEvents.map((w) => ({ ...w, who: "subject" })), ...otherEvents.map((w) => ({ ...w, who: "other" }))].sort(byWhen);
    let running = 0;
    subjectEvents.forEach((w) => { running = round(running + w.amountWithdrawn); w.running = running; });

    const names = list.filter((r) => subjectKeys.has(r.key));
    const label = o.subjectLabel || names[0]?.name || "Selected recipient";
    const channels = groupBy(subjectEvents, (w) => `${w.channel.label}|${w.phone || (w.channel.kind === "bank" ? w.recipient : "")}`, (k, rows) => ({
      label: rows[0].channel.label, kind: rows[0].channel.kind, account: rows[0].phone || (rows[0].channel.kind === "bank" ? rows[0].recipient : ""),
      names: [...new Set(rows.map((w) => w.recipient))], count: rows.length, principal: sum(rows, "amountWithdrawn"), charges: sum(rows, "charges")
    })).sort((a, b) => b.principal - a.principal);
    const kindTotal = (k) => round(channels.filter((c) => c.kind === k).reduce((n, c) => n + c.principal, 0));
    // Money the subject put back into the account (deposits whose sender matches the subject's names).
    const subjectNames = new Set(names.map((r) => r.key)), subjectTokens = new Set(names.flatMap((r) => r.tokens));
    const paidBack = (audit?.transactions || []).filter((t) => t.moneyIn > 0 && !t.reversalOf && t.sender && (subjectNames.has(normName(t.sender))
      || tokens(t.sender).filter((x) => subjectTokens.has(x)).length >= 2)).sort(byWhen);
    // Transfers to the subject's numbers under a different name: the phone, not the name, received it.
    const viaNumber = live.filter((w) => !subjectKeys.has(w.key) && w.phone && subjectPhones.has(w.phone));

    const others = groupBy(otherEvents, (w) => w.key, (k, rows) => ({ key: k, name: rows[0].recipient || "Recipient not stated",
      phones: [...new Set(rows.map((w) => w.phone).filter(Boolean))], channels: [...new Set(rows.map((w) => w.channel.label))],
      count: rows.length, principal: sum(rows, "amountWithdrawn"), charges: sum(rows, "charges"), events: rows })).sort((a, b) => b.principal - a.principal);

    const transport = o.transport ? transportBook(o.transport, from, to) : null;
    const includedPrincipal = sum(included, "amountWithdrawn");
    const expenseIn = (a, b) => transport ? round(transport.rows.filter((e) => e.date >= a && e.date <= b).reduce((n, e) => n + e.amount, 0)) : 0;

    const months = [];
    for (let m = from.slice(0, 7); m && m <= to.slice(0, 7); m = nextMonth(m)) {
      const a = m + "-01" < from ? from : m + "-01", b = (nextMonth(m) + "-01") <= to ? addDays(nextMonth(m) + "-01", -1) : to;
      const rows = included.filter((w) => w.date >= a && w.date <= b), s = rows.filter((w) => w.who === "subject");
      const withdrawn = sum(rows, "amountWithdrawn"), expenses = expenseIn(a, b);
      months.push({ key: m, from: a, to: b, count: rows.length, subject: sum(s, "amountWithdrawn"), others: round(withdrawn - sum(s, "amountWithdrawn")),
        withdrawn, charges: sum(rows, "charges"), expenses, gap: round(withdrawn - expenses) });
    }
    const weeks = [];
    if (from && to) for (let w = mondayOf(from); w <= to; w = addDays(w, 7)) {
      const a = w < from ? from : w, b = addDays(w, 6) > to ? to : addDays(w, 6);
      const rows = included.filter((x) => x.date >= a && x.date <= b), withdrawn = sum(rows, "amountWithdrawn"), expenses = expenseIn(a, b);
      if (rows.length || expenses) weeks.push({ from: a, to: b, count: rows.length, withdrawn, expenses, gap: round(withdrawn - expenses) });
    }
    const weekdays = WEEKDAYS.map((d) => { const rows = subjectEvents.filter((w) => w.weekday === d); return { day: d, count: rows.length, principal: sum(rows, "amountWithdrawn") }; });
    const hours = BANDS.map((band) => { const rows = subjectEvents.filter((w) => hourBand(w.time) === band); return { band, count: rows.length, principal: sum(rows, "amountWithdrawn") }; })
      .filter((h) => h.count || h.band !== "Unknown");
    const busyDays = groupBy(subjectEvents, (w) => w.date, (k, rows) => ({ date: k, count: rows.length, principal: sum(rows, "amountWithdrawn") }))
      .filter((d) => d.count >= 3).sort((a, b) => b.count - a.count || b.principal - a.principal);

    const subjectPrincipal = sum(subjectEvents, "amountWithdrawn");
    return {
      from, to, label,
      subject: { names: names.map((r) => r.name), phones: [...subjectPhones], events: subjectEvents, count: subjectEvents.length,
        principal: subjectPrincipal, charges: sum(subjectEvents, "charges"), channels,
        mobile: kindTotal("mobile"), bank: kindTotal("bank"), cash: kindTotal("cash"), other: kindTotal("other"),
        returned: all.filter((w) => w.returned && subjectKeys.has(w.key)), paidBack, paidBackTotal: sum(paidBack, "moneyIn"), viaNumber,
        largest: [...subjectEvents].sort((a, b) => b.amountWithdrawn - a.amountWithdrawn)[0] || null,
        average: subjectEvents.length ? round(subjectPrincipal / subjectEvents.length) : 0,
        weekend: subjectEvents.filter((w) => ["Saturday", "Sunday"].includes(w.weekday)),
        afterHours: subjectEvents.filter((w) => afterHours(w.time)), busyDays,
        activeDays: new Set(subjectEvents.map((w) => w.date)).size },
      others, included, includedPrincipal, includedCharges: sum(included, "charges"),
      allPrincipal: sum(live, "amountWithdrawn"), shareOfAll: sum(live, "amountWithdrawn") ? includedPrincipal / sum(live, "amountWithdrawn") : 0,
      transport, unexplained: transport ? round(includedPrincipal - transport.total) : null,
      months, weeks, weekdays, hours
    };
  }

  function byWhen(a, b) { return `${a.date} ${a.postingTime || ""}`.localeCompare(`${b.date} ${b.postingTime || ""}`); }
  function nextMonth(m) { const [y, mm] = m.split("-").map(Number); return mm === 12 ? `${y + 1}-01` : `${y}-${String(mm + 1).padStart(2, "0")}`; }
  function groupBy(rows, keyFn, make) {
    const map = new Map();
    rows.forEach((r) => { const k = keyFn(r); if (!map.has(k)) map.set(k, []); map.get(k).push(r); });
    return [...map.entries()].map(([k, v]) => make(k, v));
  }

  global.SomapBankAuditTrace = { recipients, related, build, expenseDate, channel, normName, phone, weekdayOf };
})(window);
