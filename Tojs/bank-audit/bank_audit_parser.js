(function (global) {
  "use strict";

  function clean(value) {
    return String(value ?? "").replace(/\s+/g, " ").trim();
  }

  function money(value) {
    return global.SomapBankAuditEngine?.parseMoney(value) || 0;
  }

  function normalizeHeader(value) {
    return clean(value).toLowerCase().replace(/[^a-z0-9]+/g, "");
  }

  function findField(row, names) {
    const entries = Object.entries(row || {});
    for (const wanted of names) {
      const n = normalizeHeader(wanted);
      const hit = entries.find(([key]) => normalizeHeader(key).includes(n));
      if (hit) return hit[1];
    }
    return "";
  }

  function signedAmountToSides(amount, debitCreditHint) {
    const amt = money(amount);
    const hint = clean(debitCreditHint).toLowerCase();
    if (hint.startsWith("d") || hint.includes("debit")) return { moneyOut: Math.abs(amt), moneyIn: 0 };
    if (hint.startsWith("c") || hint.includes("credit")) return { moneyIn: Math.abs(amt), moneyOut: 0 };
    if (amt < 0) return { moneyOut: Math.abs(amt), moneyIn: 0 };
    return { moneyIn: amt, moneyOut: 0 };
  }

  function normalizeObjectRows(rows) {
    return (rows || []).map((row, index) => {
      const debit = findField(row, ["debit", "withdrawal", "money out", "paid out", "dr"]);
      const credit = findField(row, ["credit", "deposit", "money in", "paid in", "cr"]);
      const amount = findField(row, ["amount", "transaction amount"]);
      const dc = findField(row, ["dr/cr", "debit/credit", "type"]);
      const sides = amount && !debit && !credit ? signedAmountToSides(amount, dc) : {};
      return {
        sourceRow: index + 1,
        date: findField(row, ["transaction date", "posting date", "date", "trans date"]),
        valueDate: findField(row, ["value date"]),
        description: findField(row, ["description", "narration", "details", "particulars", "transaction details"]),
        reference: findField(row, ["reference", "ref", "transaction id", "cheque no", "rrn"]),
        moneyIn: money(credit) || sides.moneyIn || 0,
        moneyOut: money(debit) || sides.moneyOut || 0,
        charges: findField(row, ["charge", "charges", "fee"]),
        balance: findField(row, ["balance", "running balance", "closing balance"])
      };
    });
  }

  async function parseExcel(file) {
    if (!global.XLSX) throw new Error("Excel library is not loaded.");
    const buffer = await file.arrayBuffer();
    const workbook = global.XLSX.read(buffer, { type: "array", cellDates: true });
    const sheetName = workbook.SheetNames[0];
    const rows = global.XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], { defval: "" });
    return {
      sourceType: "excel",
      rows: normalizeObjectRows(rows),
      meta: { sheetName, rawRows: rows.length }
    };
  }

  async function parseCsv(file) {
    if (!global.XLSX) throw new Error("CSV parser library is not loaded.");
    const text = await file.text();
    const workbook = global.XLSX.read(text, { type: "string" });
    const sheetName = workbook.SheetNames[0];
    const rows = global.XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], { defval: "" });
    return {
      sourceType: "csv",
      rows: normalizeObjectRows(rows),
      meta: { sheetName, rawRows: rows.length }
    };
  }

  function splitPdfLine(line) {
    const dateMatch = line.match(/\b(\d{1,2}[\/\-. ](?:\d{1,2}|[A-Za-z]{3,})[\/\-. ]\d{2,4})\b/);
    if (!dateMatch) return null;
    const numberMatches = Array.from(line.matchAll(/(?:TZS\s*)?-?\(?\d{1,3}(?:,\d{3})*(?:\.\d{1,2})?\)?/gi));
    if (!numberMatches.length) return null;
    const values = numberMatches.map((m) => ({ raw: m[0], index: m.index || 0, value: money(m[0]) }));
    const balance = values.length >= 2 ? values[values.length - 1].value : 0;
    const amount = values.length >= 2 ? values[values.length - 2].value : values[0].value;
    const beforeAmount = line.slice(dateMatch.index + dateMatch[0].length, values[values.length >= 2 ? values.length - 2 : 0].index);
    const afterDate = clean(beforeAmount.replace(/\b\d{1,2}[\/\-. ](?:\d{1,2}|[A-Za-z]{3,})[\/\-. ]\d{2,4}\b/g, ""));
    const desc = afterDate || clean(line.slice(dateMatch.index + dateMatch[0].length));
    const lower = line.toLowerCase();
    const isDebit = /\b(debit|withdraw|cash|atm|charge|fee|dr)\b/.test(lower) && !/\bcredit|deposit|cr\b/.test(lower);
    const isCredit = /\b(credit|deposit|cr)\b/.test(lower);
    const sides = isDebit && !isCredit ? { moneyOut: Math.abs(amount), moneyIn: 0 } : { moneyIn: Math.abs(amount), moneyOut: 0 };
    return {
      date: dateMatch[1],
      description: desc,
      reference: (line.match(/\b(?:FT|TT|RRN|REF|TRX|TXN)[A-Z0-9/-]{4,}\b/i) || [])[0] || "",
      balance,
      ...sides
    };
  }

  async function ensurePdfJs() {
    if (global.pdfjsLib) return;
    await new Promise((resolve, reject) => {
      const existing = document.querySelector("script[data-lib='pdfjs']");
      if (existing) {
        existing.addEventListener("load", resolve, { once: true });
        existing.addEventListener("error", reject, { once: true });
        return;
      }
      const script = document.createElement("script");
      script.src = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js";
      script.dataset.lib = "pdfjs";
      script.onload = resolve;
      script.onerror = reject;
      document.head.appendChild(script);
    });
  }

  async function extractPdfText(file) {
    await ensurePdfJs();
    global.pdfjsLib.GlobalWorkerOptions.workerSrc = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";
    const buffer = await file.arrayBuffer();
    const pdf = await global.pdfjsLib.getDocument({ data: buffer }).promise;
    const pages = [];
    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
      const page = await pdf.getPage(pageNumber);
      const content = await page.getTextContent();
      const items = (content.items || []).map((item) => ({
        str: clean(item.str),
        x: Number(item.transform?.[4] || 0),
        y: Number(item.transform?.[5] || 0)
      })).filter((item) => item.str);
      items.sort((a, b) => Math.abs(b.y - a.y) > 2 ? b.y - a.y : a.x - b.x);
      const lines = [];
      items.forEach((item) => {
        const current = lines[lines.length - 1];
        if (!current || Math.abs(current.y - item.y) > 3) lines.push({ y: item.y, parts: [item] });
        else current.parts.push(item);
      });
      pages.push(lines.map((line) => line.parts.sort((a, b) => a.x - b.x).map((p) => p.str).join(" ")).join("\n"));
    }
    return { text: pages.join("\n"), pageCount: pdf.numPages };
  }

  async function parsePdf(file) {
    const extracted = await extractPdfText(file);
    const rows = extracted.text
      .split(/\n+/)
      .map(clean)
      .map(splitPdfLine)
      .filter(Boolean)
      .map((row, index) => ({ ...row, sourceRow: index + 1 }));
    return {
      sourceType: "pdf",
      rows,
      extractedText: extracted.text.slice(0, 5000),
      meta: { pageCount: extracted.pageCount, rawRows: rows.length }
    };
  }

  async function parseFile(file) {
    const name = clean(file?.name).toLowerCase();
    if (!file) throw new Error("No file selected.");
    if (name.endsWith(".csv")) return parseCsv(file);
    if (name.endsWith(".xlsx") || name.endsWith(".xls")) return parseExcel(file);
    if (name.endsWith(".pdf")) return parsePdf(file);
    throw new Error("Unsupported file type. Upload PDF, Excel, or CSV.");
  }

  global.SomapBankAuditParser = { parseFile, normalizeObjectRows };
})(window);
