(function (global) {
  "use strict";
  // Structured worksheet parser for legacy .xls / .xlsx CRDB-style exports.
  // The PDF text parser (bank_audit_crdb.js) must never run against these files:
  // this module reads the workbook as rows/columns, not as flattened text.
  const VERSION = "xls-worksheet-v1";

  function clean(value) {
    return String(value ?? "").replace(/\s+/g, " ").trim();
  }

  function normalizeHeaderCell(value) {
    return clean(value).toLowerCase().replace(/[^a-z]/g, "");
  }

  function findHeaderRow(rows) {
    for (let i = 0; i < rows.length; i += 1) {
      const cells = (rows[i] || []).map(normalizeHeaderCell);
      if (cells.includes("postingdate") && cells.includes("bookbalance") && cells.includes("debit") && cells.includes("credit")) return i;
    }
    return -1;
  }

  function buildHeaderText(rows, endIndex) {
    const lines = [];
    for (let i = 0; i < endIndex; i += 1) {
      const parts = (rows[i] || []).map(clean).filter(Boolean);
      if (parts.length) lines.push(parts.join(" "));
    }
    return lines.join("\n");
  }

  function pad2(n) {
    return String(n).padStart(2, "0");
  }

  function excelSerialToDate(n) {
    return new Date(Math.round((n - 25569) * 86400000));
  }

  function splitDateTime(d) {
    if (!(d instanceof Date) || Number.isNaN(d.getTime())) return { date: "", time: "" };
    return {
      date: `${pad2(d.getDate())}.${pad2(d.getMonth() + 1)}.${d.getFullYear()}`,
      time: `${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`
    };
  }

  // Supports: "DD.MM.YYYY HH:mm:ss", "YYYY-MM-DDTHH:mm:ss", bare dates/times,
  // Excel serial date/time numbers, and JavaScript Date objects (cellDates:true callers).
  function parseDateTimeCell(raw) {
    if (raw instanceof Date) return splitDateTime(raw);
    if (typeof raw === "number" && Number.isFinite(raw)) return splitDateTime(excelSerialToDate(raw));
    const s = String(raw ?? "").trim();
    if (!s) return { date: "", time: "" };
    let m = s.match(/^(\d{2})[./](\d{2})[./](\d{4})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?$/);
    if (m) return { date: `${m[1]}.${m[2]}.${m[3]}`, time: m[4] ? `${m[4]}:${m[5]}:${m[6] || "00"}` : "" };
    m = s.match(/^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?$/);
    if (m) return { date: `${m[3]}.${m[2]}.${m[1]}`, time: m[4] ? `${m[4]}:${m[5]}:${m[6] || "00"}` : "" };
    m = s.match(/^(\d{2}):(\d{2})(?::(\d{2}))?$/);
    if (m) return { date: "", time: `${m[1]}:${m[2]}:${m[3] || "00"}` };
    return { date: "", time: "" };
  }

  function money(value) {
    // Column D/E/F only. Never parseInt; never treat the value as a date fragment.
    return global.SomapBankAuditEngine.parseMoney(value);
  }

  function isBlankRow(cells) {
    return !(cells || []).some((c) => clean(c));
  }

  function isHeaderRepeat(cells) {
    return normalizeHeaderCell(cells?.[0]) === "postingdate";
  }

  // rows: array-of-arrays (sheet_to_json with header:1), column order A-F fixed by position.
  function parseRows(rows, sourceType) {
    const headerIndex = findHeaderRow(rows);
    if (headerIndex === -1) {
      return {
        rows: [],
        meta: {
          parserVersion: VERSION,
          statement: {},
          diagnostics: ["Could not locate the Posting Date / Details / Value Date / Debit / Credit / Book Balance table header row."],
          rejectedBlocks: [],
          counts: { rawRows: 0, validTransactions: 0, rejectedBlocks: 0 },
          rawRows: 0
        }
      };
    }
    const statement = global.SomapCrdb.header(buildHeaderText(rows, headerIndex));
    const rejected = [];
    const out = [];
    for (let i = headerIndex + 1; i < rows.length; i += 1) {
      const cells = rows[i] || [];
      if (isBlankRow(cells)) continue;
      if (isHeaderRepeat(cells)) continue;
      const posting = parseDateTimeCell(cells[0]);
      const value = parseDateTimeCell(cells[2]);
      const detailsText = clean(cells[1]);
      const moneyOut = money(cells[3]);
      const moneyIn = money(cells[4]);
      const balance = money(cells[5]);
      if (!posting.date) { rejected.push({ line: i + 1, reason: "Invalid or missing posting date" }); continue; }
      if ((moneyIn > 0) === (moneyOut > 0)) { rejected.push({ line: i + 1, reason: "Debit and credit must contain exactly one positive value" }); continue; }
      // Reuse the same narration parser as the PDF path: bank reference, AB payment
      // reference, sender/recipient, class and written purpose all come from one regex set.
      const detail = global.SomapCrdb.narration([detailsText]);
      out.push({
        ...detail,
        date: posting.date,
        postingTime: posting.time,
        valueDate: value.date,
        valueTime: value.time,
        moneyOut,
        moneyIn,
        balance,
        sourceType: sourceType || "xls",
        sourceRow: out.length + 1,
        sourceLine: i + 1
      });
    }
    const counts = { rawRows: rows.length - headerIndex - 1, validTransactions: out.length, rejectedBlocks: rejected.length };
    const meta = {
      parserVersion: VERSION,
      statement,
      diagnostics: rejected.map((r) => `Row ${r.line}: ${r.reason}`),
      rejectedBlocks: rejected,
      counts,
      rawRows: out.length,
      headerRowIndex: headerIndex
    };
    return { rows: out, meta, sourceType: sourceType || "xls" };
  }

  function parseWorkbook(workbook, sourceType) {
    const sheetName = workbook.SheetNames[0];
    const sheet = workbook.Sheets[sheetName];
    const rows = global.XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "", raw: true });
    const result = parseRows(rows, sourceType);
    result.meta.sheetName = sheetName;
    return result;
  }

  global.SomapXls = { VERSION, parseDateTimeCell, parseRows, parseWorkbook };
})(window);
