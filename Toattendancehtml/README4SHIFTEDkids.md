# Shifted Students Flow (ClassAttendance ➜ Attendance ➜ Admissions ➜ Shifted Hub)

This document captures how the shifted-student experience operates across the attendance and admissions modules.

## Overview
- **Goal:** allow teachers to flag students who have been absent for 10 consecutive school days, collect context, queue them for admin review, and finally move confirmed cases into the shifted hub while preserving debts.
- **Data paths (Firebase RTDB):**
  - `attendance/{class}/{month}/{date}` – daily AM/PM marks plus daily summary (existing).
  - `shiftReports/{studentId}` – teacher-submitted shift alerts awaiting admin review.
  - `shiftedStudents/{studentId}` – records moved out of the active roll by the admin.

## classattendance.html → teacher workflow
1. **Auto detection** – when a student accrues ≥10 consecutive absent days (based on current month history plus the in-memory mark), the row turns red and the new **Shift** pill appears.
2. **Shift modal** – teachers capture:
   - Shifted? (Yes/No)
   - Reason / notes
   - Information source
   - Date shifted / last seen
   - Probable new school
3. **Persist** – saving writes / updates `shiftReports/{studentId}`, storing a rich snapshot (student name, parent contact, balances, absent streak, teacher notes). The row turns amber to show the alert is awaiting admin review.

## attendance.html → admin attendance dashboard
1. **Shift Alerts section** – new table listing entries from `shiftReports/` with parent contact, reason, date, school, debt status.
2. **Badges** – top analytics card “Yellow Alerts” now reports the number of pending shift alerts; the new pill shows total and pending counts.
3. **Status updates** – when an entry’s status is switched to `shifted` (via admissions flow below) the row highlights as cleared.

## ToSchoolerp/admission.html → admin shift action
1. **Student cards** – pending shift alerts are surfaced beside Edit/Delete with a **Shift** button (uses same password gate `REHEMam!`).
2. **Shift execution** – on approval:
   - Removes the student from the live `/students` list.
   - Writes a full copy (plus shift metadata) into `/shiftedStudents/{studentId}`.
   - Updates the original `shiftReports/{studentId}` entry with status `shifted`, timestamp, and outstanding balance.
3. **Debt handling** – balances are carried over; the report flags whether debt is cleared or not for future follow-up.

## shiftedkids.html → Shifted Students Hub
1. **Glass dashboard** – metrics for total shifted count, outstanding debt sum, most impacted class, and the active filter summary.
2. **Filters** – year dropdown auto-populated from `shiftedStudents`, plus live search (name, admission, school, reason).
3. **Table** – lists each shifted learner with admission, class, shift date, debt, probable school, reason, debt status, and a **View** link that deep-links back to `parent.html?studentKey={id}` for read-only historical data.
4. **Data source** – renders directly from `/shiftedStudents`. Records stay until debts are cleared or the admin archives them manually.

## Key Notes
- Nothing is auto-shifted; only the admin can confirm the move.
- Teachers can update their shift notes any time prior to admin action.
- The hub only shows learners who have fully transitioned; alerts still waiting decision remain on the attendance dashboard.

Maintain this README near the shifted kids resources to keep the handoff clear for future contributors or audits. Any changes to the data paths or password flow should be documented here.*** End Patch


## 2026-11-05 update — fair debt, one class, return, reports
- **Debt rules (2026+, all schools)** live in `shared/shift_settlement.js`:
  - Shifted in **January** of year Y (or earlier) ⇒ never studied Y ⇒ no Y school fee, no Y transport. Earlier-year books untouched.
  - Otherwise ⇒ every instalment of Y (class plan / special plan / per-student override) whose window opened by the shift date; monthly plans count the shift month; after 10 Oct the whole year. Payments clear carry-forward first.
  - Transport ⇒ months up to the shift month (TransportDebtEngine, same as transportpayments.html) minus approved transport payments.
  - Previous-year debt only counts when finance carried it forward (`financeCarryForward/Y`).
- `shared/shift_engine.js` (used by attendance.html and admission.html): uses those rules at approval, refuses a **class mix-up** (reported class ≠ resolved class) unless the admin confirms the learner really left, copies transport records into `transportData` before clearing route lists, never deletes transport payment ledgers. Adds `returnShiftedStudent()` (same record, enrollment written for the return year, class = shift class + years since shift) and `findShiftedMatch()` (admission.html blocks re-registering a shifted learner).
- `shared/shift_reasons.js`: reason analyser (English + Kiswahili, typo tolerant).
- `shiftedkids.html`: fair vs recorded debt, reason cards, Return, per-learner statement PDF, full report PDF (cover cards, class bars, reasons, timeline per month/week/year, register), admin "Save fair debts" (writes only `shiftedStudents/*`, keeps `recordedBeforeRule`). `?class=X&year=Y` = teacher view.
- `staff.html`: "My shifted learners" card → hub teacher view. The teacher shift form now files a `shiftReports/{id}` report for admin approval (it used to write a stray record into `shiftedStudents`).
