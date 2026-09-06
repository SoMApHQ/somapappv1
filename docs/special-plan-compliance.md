Special payment-plan compliance — implementation and verification

Implemented locally on 6 September 2026. The approval flow was verified with isolated database fixtures and the actual approval/rejection handlers in an offline browser. No production Firebase connection, production scan, deployment, or real student configuration change was performed.

**Behavior**

For the selected school and academic year (2026 onward), a student-specific plan with a distinct plan override and an explicit custom schedule is checked cumulatively at each expired deadline. Several timely payments are acceptable. Later settlement cannot erase a missed deadline. The literal plan name is not used to identify eligibility.

Only approved school-fee payments with reliable receipt dates count. Pending, rejected, deleted, reversed, cancelled, and unapproved payments do not count. Amounts are integer TSh. Date-only deadlines include the full final day, using the same browser-local calendar convention as Finance.

Detection creates a Finance Config proposal. It does not change live fees, plans, schedules, payments, balances, or class defaults. Approval rechecks the agreement, student, school, year, class, payment evidence and current class defaults. An atomic multi-location update removes the relevant override fields, archives the request and records the decision. Existing payments and carry records are never written. The existing Finance calculations produce the resulting balance when the data is refreshed.

Rejection retains the agreement and stores the decision. Repeated reviews suppress already reviewed deadlines, including when only a subset of the rejected breaches remains. A newly breached deadline or a materially changed agreement can produce another review. Later individual agreements still use the existing protected configuration approval handler.

**Exact files**

| File | Change |
| --- | --- |
| `AGENTS.md` | Persistent project preference: examples apply across schools and applicable years; compliance excludes closed years. |
| `js/special_plan_compliance.js` | Evaluator, scoped loader, request reservation, decision handling, authentication checks, notices and automatic review watchers. |
| `shared/finance_math.js` | Exposes existing pure preparation/calculation functions; pure-only loading does not activate the shared roster on Finance. No allocation formula changed. |
| `finance.html` | Loads the isolated helper; requests authorized automatic review; displays pending/decision notices in Student Finance Details. |
| `Tofinancehtml/paymentedits.html` | Student notices, Review Special Plans link, automatic review and cache invalidation on refresh; scopes existing configuration reads/writes and queue creation through the existing school path helper; fixes the affected installment date separator. |
| `Todashboardhtml/approvals.html` | Review Special Plans button and result text inside Finance Configuration; loads the helper. |
| `Todashboardhtml/approvals.js` | Routes compliance approve/reject through validated decisions; includes structured deadline details; shares agreement locks with ordinary student configuration approvals. |
| `tests/special-plan-compliance.test.cjs` | Automated evaluator, data-flow, isolation and integration tests. |
| `tests/special-plan-browser.cjs` | Offline desktop/mobile preview and actual approval/rejection handler smoke test. |
| `docs/special-plan-compliance.md` | This handoff and verification record. |

`Tofinancehtml/payment.html` is unchanged. Its shared fee/plan resolver is covered by the integration tests. No new payment-entry or allocation implementation was introduced.

Before editing, the five existing changed finance/approval files were copied to `C:\Users\user\AppData\Local\Temp\somap-special-plans-20260906-091956`.

**Firebase paths and fields**

Every path below is relative to the school root returned by `SOMAP.P`. The existing context chooses either the legacy root or `schools/{schoolId}/`. No business rule hard-codes a school or student.

New data:

- `specialPlanCompliance/{year}/{studentId}/pending`: complete reserved Finance Config request, retained for interrupted queue-write recovery.
- `specialPlanCompliance/{year}/{studentId}/decisions/{agreementFingerprint}/{breachKey}`: immutable decision snapshot with `status`, `at`, `by`, `approvalId`, `before`, `after`, `planId`, `breaches`, and `reason`.
- `specialPlanCompliance/{year}/{studentId}/latest`: most recent decision for Finance notices.
- `specialPlanCompliance/{year}/{studentId}/decisionLock`: short-lived `{token, at}` transaction lock shared by compliance and ordinary student configuration approvals. Five-minute stale-lock recovery; token recheck before applying a decision.

Existing paths reused:

- `approvalsPending/{approvalId}`: existing Finance Config queue; adds `schoolId` and `modulePayload.compliance` to the ordinary queue fields. The compliance payload stores `kind`, `schoolId`, `year`, `studentId`, agreement fingerprint, breach key, before/after snapshots, plan ID, class, and each breached deadline's label, date, required cumulative amount, paid cumulative amount and shortfall. No claimed payment amount is created.
- `approvalsHistory/{year}/{requestMonth}/{approvalId}`: archived approved/rejected request with decision actor/time and `appliedAfter`.
- `financeConfigHistory/{year}/overrides/{studentId}/{approvalId}`: complete compliance decision and before/after audit.
- `studentOverrides/{year}/{studentId}`: approval removes only fee/plan/custom-schedule fields, preserving unrelated notes/metadata.
- `finance/{year}/studentFees/{studentId}`, `finance/{year}/studentPlans/{studentId}`, `finance/{year}/studentCustomSchedules/{studentId}`: relevant override records removed on approval.
- `studentFees/{year}/{studentId}` and, where present, the matching admission-number alias: removes the alternate fee override so it cannot mask the restored default.

Read-only inputs are the selected year's `feesStructure`, `finance/{year}/classes`, `installmentPlans`, `finance/{year}/plans`, both current-year enrollment layouts, `financeLedgers`, `financeCarryForward`, `financeDeadlineExtensions`, override records, and candidate student records. The approved-history fallback reads only `approvalsHistory/{year}`. Authentication uses the existing `users/{emailKey}`/school-admin profile conventions. The broad historical Finance loader is not invoked by the compliance review.

**Triggers and duplicate protection**

Automatic review runs for authenticated school administrators on Finance/configuration data loading, auth restoration, Approvals loading/refresh and selected-year changes. Year-scoped ledger, override, student-plan and custom-schedule listeners debounce subsequent reviews. Normal viewers can see notices but cannot run or apply reviews. No background cloud scheduler was added: automatic detection requires an authorized relevant page to be open.

The manual action is **Approvals → Finance Configuration → Review Special Plans**. Payment Edits links to that existing admin page. Results show compliant, breached, newly queued, already queued, already reviewed and skipped counts, plus the first five skipped reasons. An explicit attempt to review a year before 2026 fails before database access.

An SHA-256 fingerprint includes school, year, student and the complete override snapshot. A breach key identifies the expired breached obligations. A persistent per-student Firebase transaction reserves one unresolved request, and the request ID is deterministic. Previously decided obligations remain suppressed after the queue item is archived. Queue reservation/repair and approval/rejection use the same student lock. Ordinary student configuration approvals also acquire that lock so a newer agreement cannot be overwritten by a simultaneous compliance decision.

**Verification**

Run `node --test --test-reporter=spec tests/special-plan-compliance.test.cjs` and `node tests/special-plan-browser.cjs`. The browser test uses an isolated temporary profile, a loopback server, in-memory data and extracted production handlers. It does not load Firebase SDKs or contact production.

| Mandatory scenario | Result |
| --- | --- |
| 1. Gracious's two timely payments | PASS — no request; 680,000 fee and two-payment agreement retained. |
| 2. Jeyden's late settlement | PASS — one proposal containing both missed deadlines; no live configuration mutation. |
| 3. Approval | PASS — payments unchanged; fee and six-period plan restored; shared engine calculates the legitimate fee difference; audit notice displayed. A separate resolver test verifies the source used by Payment and Payment Edits. |
| 4. Rejection | PASS — overrides retained; rejection archived; refresh creates no duplicate. |
| 5. Partial but timely | PASS — cumulative timely payments accepted. |
| 6. Partial and late | PASS — later zero balance does not erase deadline shortfall. |
| 7. Duplicate protection | PASS — repeated/simultaneous review yields one pending request. |
| 8. Historical protection | PASS — pre-2026 review rejected before any read; selected-year review/approval has no pre-2026 paths; closed-year fixture records unchanged. |
| 9. Tenant protection | PASS — school A review never accesses school B data; cross-school approval rejected. |
| 10. Future reconfiguration | PASS — actual ordinary Finance Configuration commit handler accepts a later agreement; it remains reviewable. |

Additional passing checks cover stale agreements, corrected payment evidence, current class defaults at approval, rejected-breach subsets, newly missed deadlines after rejection, approved-history receipt dates, positive carry allocation, unresolved credits, role denial, interrupted writes/retry, inclusive deadline dates, future academic year 2027, and isolation of Finance's existing roster behavior.

The offline browser checks pass for the actual preview, approval and rejection handlers, ledger preservation and rejection deduplication at desktop/mobile sizes. The review panel has no page-wide horizontal overflow at 390px. All inline scripts in Finance, Payment Edits, Payment and Approvals parse successfully; changed JavaScript files and `git diff --check` pass.

**Assumptions and remaining production verification**

- Eligibility currently requires a distinct student plan override plus explicit custom schedule rows. Fee-only discounts, class-default plans, inferred schedules and malformed dates are not penalized automatically.
- The existing Finance calendar convention is browser-local. The browser should use the school's calendar timezone. No new timezone standard or grace period is introduced.
- Carry is passed through the existing Finance allocation. Explicit schedule totals may match the base fee or total fee including carry. Unresolved credit representations, deadline extensions, missing approval/receipt evidence, absent class defaults, and inconsistent schedule totals are skipped for manual Finance verification instead of generating speculative reversals.
- The test suite includes 24 passing tests. Browser screenshots are temporary local artifacts; this is not a deployed-site screenshot or a live-database audit.
- No production records, including 2025 and earlier, were read or changed during implementation. No approved ledger was rewritten. Production Firebase rules/permissions for the new review node have not been tested; this repository does not contain the complete deployed ruleset. No rules were replaced or deployed.
- Production rollout and an authenticated live-school verification remain outstanding. The completed verification is the local fixture flow: detect → pending queue → details → approve/reject → restore/preserve → existing calculation/resolver → audit notice.
