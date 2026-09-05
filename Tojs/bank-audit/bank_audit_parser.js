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
      script.onerror = () => { script.remove(); reject(new Error("PDF library could not load. Check your connection and retry.")); };
      document.head.appendChild(script);
    });
  }

  async function extractPdfText(file) {
    await ensurePdfJs();
    global.pdfjsLib.GlobalWorkerOptions.workerSrc = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";
    const buffer = await file.arrayBuffer();
    const pdf = await global.pdfjsLib.getDocument({ data: buffer }).promise;
    const pages = [];
    let columns;
    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
      const page = await pdf.getPage(pageNumber);
      const content = await page.getTextContent();
      const extracted = global.SomapCrdb.extractPage(content.items || [], page.getViewport({scale:1}).transform, columns);
      columns = extracted.columns;
      pages.push({...extracted,page:pageNumber,rotation:page.rotate,viewportTransform:page.getViewport({scale:1}).transform});
    }
    await pdf.destroy();
    return { pages, pageCount: pages.length };
  }

  async function parsePdf(file) {
    const extracted = await extractPdfText(file);
    return global.SomapCrdb.parseExtractedPages(extracted.pages);
  }

  async function parseFile(file) {
    const name = clean(file?.name).toLowerCase();
    if (!file) throw new Error("No file selected.");
    if (name.endsWith(".csv")) return parseCsv(file);
    if (name.endsWith(".xlsx") || name.endsWith(".xls")) return parseExcel(file);
    if (name.endsWith(".pdf")) {
      const parsed = await parsePdf(file);
      const hash = await global.crypto.subtle.digest("SHA-256", await file.arrayBuffer());
      parsed.meta.sourceHash = Array.from(new Uint8Array(hash), b => b.toString(16).padStart(2,"0")).join("");
      return parsed;
    }
    throw new Error("Unsupported file type. Upload PDF, Excel, or CSV.");
  }

  global.SomapBankAuditParser = { parseFile, normalizeObjectRows };
})(window);
