# Human resources: employees, leave, attendance, payroll & appraisal

## Model

| Entity | Notes |
|---|---|
| `Position` | Sanctioned posts per department and grade. The setup screen flags positions filled beyond sanctioned strength. |
| `Employee` | One per staff member, optionally linked to a sign-in (`userId`, unique). Category (teaching / non-teaching), employment type, department, position, reporting line (cycles are refused), join / confirmation / exit dates, status. Bank account and tax id are **encrypted** (`bankAccountEnc`, `taxIdEnc`) and shown masked. |
| `LeaveType` | Annual quota, carry-forward cap, paid/unpaid, half days, most days at a time, "document expected", optional category restriction. |
| `LeaveBalance` | One per employee × type × year: entitled, carried forward, used. Opened in bulk by HR (pro-rated for joiners, carry forward applied, safe to re-run). |
| `LeaveRequest` | Dates, half day, **working days** (weekends and holidays excluded), reason, status. Approved through the `hr.leave` workflow. |
| `StaffAttendance` | One mark per employee per day. Source `LEAVE` marks are written by approved leave and cannot be overwritten from the attendance screen. |
| `SalaryComponent` | Earning, deduction or employer contribution; taxable flag; optional ledger account. |
| `SalaryStructure` + lines | **Versioned** like fee structures: fixed amount, % of basic, % of gross (with optional monthly cap) or income tax. |
| `EmployeeSalary` | Effective-dated basic pay and structure. **Append-only** (trigger): a pay change is a new row. Changes cannot take effect in a month whose payroll is already approved. |
| `PayrollRun` / `Payslip` | One run per month (`YYYY-MM`). Payslips hold the computed lines as JSON. **Frozen by trigger** once the run is approved; the run's status cannot move backwards after approval. |
| `AppraisalCycle` / `Appraisal` | Weighted criteria; self-review, then the reporting manager's review; weighted score (1–5). |

## Leave

1. The applicant (or HR on their behalf, with `leave.manage`) applies. The service checks: working days > 0, half-day rules, most days at a time, no overlap with pending/approved leave (two different half days on one date are allowed), and — for paid leave — the balance **minus pending requests**.
2. `hr.leave` workflow (editable under Configuration → Workflows):
   - **Reporting manager** — approver rule `data_user` on `managerUserId`; runs when the applicant has an active manager with a sign-in;
   - **Head of department** — when there is no such manager;
   - **HR verification** — for more than 3 days, or when no one else can approve (for example a head of department without a manager);
   - **Registrar** — for more than 10 days.
3. On approval, in the same transaction: the balance is charged (re-checked, so two approvals cannot overdraw it), the request is approved, and each working day is marked `ON_LEAVE` (or `HALF_DAY`).
4. The applicant can withdraw a pending request, or cancel approved leave before it starts (balance restored, marks removed). HR can cancel approved leave at any time.

The staff calendar is the configured work week plus academic-calendar events of kind **Holiday**.

## Payroll

1. HR creates a run for a month. Working days default to the HR setting (`0` = calendar days of the month).
2. **Compute** (repeatable until submitted). For every employee employed during the month with pay set:
   - payable days = working days (pro-rated for mid-month joining/exit) − loss of pay;
   - loss of pay = days marked absent (when `absentIsLossOfPay`) + half days (0.5) + approved **unpaid** leave in the month;
   - basic and earnings are pro-rated by payable days; fixed deductions are not; no deduction exceeds what remains of gross;
   - income tax projects the month's taxable gross over 12 months, applies the configured slabs, standard deduction, rebate and cess, and withholds one twelfth. **This is a configurable estimate, not tax advice**; HR must keep the slabs current.
   Employees without pay set are listed as "not included".
3. **Submit** → `hr.payroll` workflow: Finance Officer, then Registrar. A returned run goes back to *computed* and can be recomputed and resubmitted.
4. On approval the run is accrued in the ledger and employees are notified that payslips are available:

   | Debit | Credit |
   |---|---|
   | 5200 Salaries and wages (earnings; or the component's own account) | 2300 Salaries payable (net) |
   | 5210 Employer statutory contributions | 2310 Statutory deductions payable (deductions and employer contributions) |
   | | 2320 Tax deducted at source payable (income-tax deductions) |

5. **Accounts** (`payroll.disburse`) records the bank transfer reference: Dr 2300 Salaries payable, Cr 1110 Bank. The run becomes *paid*.

Payslips (`/me/payslips`) are visible to the employee only after approval; payroll staff see them at any time (marked DRAFT before approval). They print cleanly.

## Permissions & roles

| Permission | Meaning |
|---|---|
| `hr.view` | Employee records in scope (HoD, Dean, Principal: their departments; HR, Registrar: all) |
| `hr.manage` | Create/edit employees, positions, leave types |
| `leave.manage` | Open/adjust balances, apply or cancel leave on someone's behalf |
| `attendance.staff` | Mark staff attendance in scope |
| `payroll.process` | Salary components/structures, pay changes, payroll runs |
| `payroll.view` | Payroll runs and payslips (Finance, Accounts, Registrar) |
| `payroll.disburse` | Mark approved payroll as paid (Accounts) |
| `appraisal.manage` | Open appraisal cycles |

New system role **HR Officer**. Existing databases: run `npm run rbac:sync` after `npm run db:migrate`.

## Settings (`hr`, under *HR setup → Settings*)

`employeePrefix`, `workWeek`, `payrollWorkingDays`, `absentIsLossOfPay`, `taxEnabled`, `tax` (`standardDeduction`, `slabs[]`, `rebateLimit`, `rebateMax`, `cessPercent`). Slabs must increase, with only the last one open-ended.

## Not included yet

Statutory filings (PF/ESI returns, Form 16), arrears computation, loans and advances, reimbursements, biometric device integration (the `source` column and upsert-by-day design are ready for an importer), recruitment.
