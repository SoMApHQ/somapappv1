# CRDB repair verification

Status: implemented locally; original-PDF acceptance and live saved-audit reparse remain pending.

## Root cause
The old parser independently parsed visual lines using an unanchored money regex with a one-to-three-digit integer prefix. It split 2026 into 202 and 6, treated header dates as transactions, dropped multiline narration and debit/credit columns, and guessed transaction direction from words. Permissive Date parsing rolled invalid date parts instead of rejecting them. Withdrawal grouping omitted time and recipient.

## Changed production files
- Tofinancehtml/bank-audit-analyzer.html
- Tojs/bank-audit/bank_audit_crdb.js (new)
- Tojs/bank-audit/bank_audit_parser.js
- Tojs/bank-audit/bank_audit_engine.js
- Tojs/bank-audit/bank_audit_storage.js
- Tojs/bank-audit/bank_audit_ui.js
- Tojs/bank-audit/bank_audit_pdf.js

## Algorithm
PDF.js extracts pages and positioned text items. CRDB column headers locate posting, details, value date, debit, credit and book-balance columns. Complete posting blocks are reconstructed in logical order. Strict dates, times, bank references and decimal accounting tokens gate inclusion. Invalid blocks produce diagnostics. Header totals must reconcile within TSh 0.02 before saving or exporting a successful report. Explicit columns never change in response to balance discontinuities.

AB and bank references, written purpose, class, sender, recipient and raw narration remain separate. Classification uses written purposes, never amounts. Mobile debit groups require identical bank reference, date, time and recipient/account. Three-line CRDB mobile groups use the printed final debit as principal and preceding lines as charges; the basis is disclosed for review.

Reparse uses an atomic update of the existing audit ID, preserving its previous snapshot under history. SHA-256 identifies new PDF uploads and prevents same-byte duplicate statements. Allocation records remain separate from bank-written categories. Name suggestions currently use exact normalized-name matches from the school student directory, with manual confirmation and split allocation.

## Reconstructed fixture results
The original statement and bad report PDFs were NOT present. `reconstructed-september.txt` is generated from the user's supplied acceptance specification; its unknown bank references/senders are synthetic. It must not be mistaken for bank-source evidence.

| Metric | Reported old result | Reconstructed fixture result |
|---|---:|---:|
| Deposits | 1,658 | 538,800.00 |
| Debits | 0 | 258,100.02 |
| Net | 1,658 | 280,699.98 |
| Raw lines | 15 | 27 (15 credits, 12 debits) |
| Withdrawal events | 0 | 4 |
| Business events | — | 19 |
| Transport | 0 | 326,000.00 |
| Remedial | 0 | 18,000.00 |
| Graduation | 0 | 0.00 |
| Unclassified | — | 194,800.00 |
| Principal | — | 249,000.00 |
| Charges | — | 9,100.02 |
| Available | — | 282,841.28 |
| Implied opening | — | 2,141.30 |
| Printed book | 6 (incorrect closing display) | -36,500.01 |
| Discontinuity magnitude | — | 319,341.29 |

Run: `node --test tests/bank-audit/crdb.test.cjs`

14 tests pass. Tests cover strict dates/money, metadata isolation, multiline examples, references, accounting/category totals, grouping, discontinuity, coordinate reconstruction, validation, mocked atomic history preservation, and PDF layout configuration. All bank-audit JavaScript files pass `node --check`; `git diff --check` passes. Other SoMAp modules were not changed; there is no repository-wide test runner available.

## Browser evidence
Run `node tests/bank-audit/browser-preview.cjs` on Windows with Edge. This isolated local harness loads the production renderer with reconstructed data, without Firebase writes. Screenshots in `evidence/`: summary.png, income.png, withdrawals.png, review.png, mobile.png. The reconstructed-september-report.pdf is a test report, not a corrected original-statement report. PDF contact sheets cover all generated pages.

## Remaining acceptance work
1. Supply `accountTransactionHistory (3)(1).pdf` and `SoMAp_Bank_Audit_CRDB_2026_-P0kfq79vGJDcDbYT8dr.pdf` and verify actual PDF coordinate reconstruction, including page breaks and unknown name wraps.
2. Verify the report and overview against these original files; reconstructed fixtures cannot establish original-PDF accuracy.
3. Deploy the reviewed local changes and run Reparse Statement on saved audit `-P0kfq79vGJDcDbYT8dr` in an authenticated SoMAp session. No live record has been changed in this session.
4. Confirm real school-directory matching and allocation persistence. Fuzzy suggestions and legacy school-directory fallback are not implemented.
5. Verify authenticated Drive preservation/report upload and database security rules in the live environment. Legacy audits missing source PDFs require selecting the original PDF before reparse; period checks alone cannot prove original-file identity.
