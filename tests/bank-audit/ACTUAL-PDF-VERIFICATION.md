# Actual CRDB PDF repair — crdb-block-v3

Verified source: `C:\Users\user\Downloads\accountTransactionHistory (3).pdf` (11,957 bytes, four pages). This verification uses the original PDF, not the earlier reconstructed text. The prior incorrect SoMAp report was also located in Downloads. No live Firebase audit or Google Drive file was written during this verification; changes are local and must be deployed to update the website.

## Precise zero-transaction root cause

All four pages report `page.rotate = 90`. PDF.js returns text matrices such as `[0, 11, -11, 0, 374.5, 60.228]`. The v2 code sorted raw `transform[5]` descending as if it were the displayed vertical coordinate. For this rotated document that coordinate is the displayed horizontal coordinate. The resulting lines merged columns across transactions and began with balances, followed by credits, debits, value dates, and only then posting dates. No valid posting-date/time/REF sequence survived: the original PDF produced zero rows in v2.

The header totals remained detectable because their text items contained complete header labels and values. That did not establish correct transaction reading order.

## Real PDF.js item samples (page 1, original indices)

| Index | Text | Raw X | Raw Y | Width | Height | Display X | Display Y |
|---:|---|---:|---:|---:|---:|---:|---:|
| 25 | 01.09.2026 | 374.5 | 60.228 | 55.044 | 11 | 60.228 | 374.5 |
| 26 | 14:41:00 | 385.5 | 64.81 | 42.812 | 11 | 64.81 | 385.5 |
| 27 | REF:1a05cc6285a25b33 AGENCY FT | 358 | 152.918 | 187.693 | 11 | 152.918 | 358 |
| 32 | 01.09.2026 | 374.5 | 397.438 | 55.044 | 11 | 397.438 | 374.5 |
| 35 | 0.00 | 380 | 548.248 | 21.406 | 11 | 548.248 | 380 |
| 37 | 54,000.00 | 380 | 637.898 | 48.928 | 11 | 637.898 | 380 |
| 39 | 56,141.3 | 380 | 761.188 | 42.812 | 11 | 761.188 | 380 |

Viewport transform: `[0, 1, 1, 0, 0, 0]`.

The narration begins above the vertically centered posting date. Therefore transaction geometry uses REF-block boundaries, not posting-date baselines, before reading each column. Pages 2–4 have no repeated column header; they inherit the first page's column geometry.

## Reconstructed logical block

```text
01.09.2026
14:41:00
REF:1a05cc6285a25b33 AGENCY FT
FROM ZEBEDAYO DODO TATIAYA TO
SOCRATES
AB17882628850752276675:Suhailathatibu
kimeza:Usafiri N/A
01.09.2026
00:00:00
0.00
54,000.00
56,141.3
```

## Repair

- Apply the page viewport transform before grouping visual lines and ordering columns.
- Preserve PDF.js content-item order as an independent extraction path. Keep `hasEOL` lines separately for diagnostics.
- Parse explicit posting date → posting time → REF → narration → value date/time → three accounting values.
- Tokenize only the accounting section. Support inline time/amount rows, separate amount items, integer zero, one-decimal balances and negative book balances.
- Validate each extraction path against statement headers. Prefer a complete valid path; reject conflicting complete parses. Never combine paths or count transactions twice.
- The actual PDF passes independently through both content-item and rotation-aware visual-column paths. Content-stream `hasEOL` alone yields 21 lines and fails validation, so it is not selected.
- Preserve bank references, AB references, raw narration and bank-written names. Repair the actual `Scho` / `olbus` line wrap for classification. The original PDF spells one name `ABBGAEL CHARLES MAHONA`; raw evidence preserves that spelling rather than inventing a correction.
- Group mobile debits by reference/date/time/recipient; largest debit is principal and the remaining grouped debits are charges.
- On failure, show “Statement not yet analysed,” hide financial totals/ledgers, disable saving/export, retain the selected file, and offer Retry Parse plus downloadable diagnostics.
- Versioned script URLs load `crdb-block-v3` rather than cached v2 assets.

## Actual statement result

| Measure | Result |
|---|---:|
| REF blocks | 27 |
| Accounting rows | 27 |
| Valid transactions | 27 |
| Rejected blocks (selected path) | 0 |
| Credit lines | 15 |
| Debit lines | 12 |
| Deposits | TSh 538,800.00 |
| Withdrawals | TSh 258,100.02 |
| Net movement | TSh 280,699.98 |
| Available balance | TSh 282,841.28 |
| Transport | TSh 326,000.00 |
| Remedial | TSh 18,000.00 |
| Graduation | TSh 0.00 |
| Unclassified income | TSh 194,800.00 |
| Grouped withdrawals | 4 |
| Grouped business events | 19 |
| Transfer principal | TSh 249,000.00 |
| Transfer charges | TSh 9,100.02 |
| Implied opening book balance | TSh 2,141.30 |
| Printed book/cleared balance | TSh -36,500.01 |
| Running-balance discontinuity magnitude | TSh 319,341.29 |

## Tests A–F, in order

A PASS: first deposit 0 / 54,000 / 56,141.30; correct AB/reference/name/sender/purpose.

B PASS: first mobile withdrawal has 3 debit lines, principal 49,000, charges 2,000.01, total 51,000.01, recipient MUSSA FARAJI MVUNGI, phone 0756877887, transaction type IB FT TO MPESA.

C PASS: Elia Elichilia, Standard 4, Remidial → Remedial, AB17883339746205188493, credit 18,000.

D PASS: 27 raw lines, 15 credits, 12 debits, 4 withdrawal groups, 19 events; exact credit/debit totals.

E PASS: all category totals above.

F PASS: no false TSh 202/42 transactions, no November 1999 fallback, no header payers or date-as-money tokens.

Additional checks cover all three accounting layouts, rotated coordinates at 0/90/180/270 degrees, shuffled PDF items, malformed blocks, negative balances, grouping independent of debit order, and existing history/PDF guard tests.

Commands:

```text
node --test tests/bank-audit/actual-crdb.test.cjs tests/bank-audit/crdb.test.cjs
28 tests, 28 passed, 0 failed
node tests/bank-audit/actual-upload.cjs
Actual PDF upload and failed-processing UI checks passed; 58 report pages rendered.
```

All bank-audit JavaScript syntax checks and `git diff --check` pass. Other modules were not edited.

## Browser and PDF evidence

Files in `evidence/actual/`:
- `summary.png`: actual PDF successfully uploaded through the production parse handler.
- `income.png`, `withdrawals.png`, `review.png`, `mobile.png`: actual transaction screens.
- `failed-processing.png`: deliberately corrupted accounting rows; disabled save/export and retained selected file.
- `browser-checks.json`: upload and failure-state assertions, including zero calls to the save stub after failure.
- `SoMAp_CRDB_September_2026_corrected.pdf`: corrected report generated from the original PDF's transactions, 10-point table text.
- `pdf-pages-1.png`, `pdf-pages-13.png`, `pdf-pages-25.png`, `pdf-pages-37.png`, `pdf-pages-49.png`: every report page rendered for visual inspection.
- `pdf-page-6-full.png`: full-resolution incoming-ledger sample.
- `pdfjs-before.json`: original raw items and the failing v2 reconstructed lines.
- `upload-result.json`: actual v3 extraction, per-page coordinates/visual lines, chosen path, counts and audit.
- `test-output.txt`: full automated test output.

PDF rendering uses PDF.js bundled standard fonts to avoid the local Windows system-font substitution issue. No PDF layout redesign was needed in this repair; the existing readable report generator was verified after accounting passed.

## Exact production files changed in this repair

1. `Tofinancehtml/bank-audit-analyzer.html`: failed-processing panel and versioned script URLs.
2. `Tojs/bank-audit/bank_audit_crdb.js`: rotation-aware reconstruction, state parser, diagnostics and actual split-purpose handling.
3. `Tojs/bank-audit/bank_audit_parser.js`: viewport-aware PDF extraction, validated path selection and retryable script-loading failure.
4. `Tojs/bank-audit/bank_audit_engine.js`: largest-principal grouping independent of raw debit order.
5. `Tojs/bank-audit/bank_audit_ui.js`: failure-state gating, Retry Parse and diagnostic download.

New verification files: actual-crdb.test.cjs, actual-upload.cjs, inspect-pdf.cjs, inspect.html, fixtures/september-original.pdf, fixtures/september-pdfjs-items.json, this document and evidence/actual outputs. `.gitignore` excludes temporary browser profiles.

Validation remains mandatory. The original statement passes without bypasses or hard-coded financial results. The local failure test made zero save calls; no live failed audit was saved by this session. Live website deployment and authenticated saving were not performed.
