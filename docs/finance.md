# Finance: fees, payments, scholarships & ledger

## Model

| Entity | Notes |
|---|---|
| `FeeHead` | What is charged (tuition, examination, revaluation, hostel…). It can map to its own income account. |
| `FeeStructure` + lines | Versioned per academic year, optionally per programme or batch. Each line has an amount, an optional semester and an optional term type (odd/even), plus the number of days until it is due. Draft structures are edited in place; editing an active structure creates the next version. Invoices record the version they came from. |
| `Invoice` + lines | Totals are checked by the database: `total = subtotal − concession`, and `0 ≤ amountPaid ≤ total`. Status (unpaid, part paid, paid, cancelled) is derived from payments. `sourceType`/`sourceId` link invoices raised by other modules (examination fees, revaluation fees). |
| `Payment` | **Immutable** (database trigger): amount, student, method, idempotency key, receipt number and gateway ids never change. Status can only move PENDING → SUCCEEDED/FAILED, or SUCCEEDED → REVERSED. Payments cannot be deleted. |
| `PaymentAllocation` | Append-only split of a payment across invoices. Allocations of reversed payments stop counting. |
| `Concession` | A waiver, concession or scholarship credit on an invoice, approved through the workflow engine and spread across the invoice lines exactly. |
| `Refund` | Workflow-approved, then marked paid by Accounts. Only the **unapplied credit** of a payment (an overpayment) can be refunded. |
| `ScholarshipScheme` / `ScholarshipApplication` | Rule-based eligibility, application workflow, and disbursal as scholarship concessions. |
| `LedgerAccount`, `JournalEntry`, `JournalLine` | Double-entry general ledger. Entries are append-only and **must balance**; a deferred constraint trigger checks this at commit. |

Money is DECIMAL(14,2) in the database. All arithmetic is done in integer minor units (`src/lib/domain/money.ts`).

## Automatic postings

| Event | Debit | Credit |
|---|---|---|
| Invoice issued | 1200 Student fees receivable | Income account of each fee head (default 4100 Fee income) |
| Payment confirmed | 1100 Cash, 1110 Bank or 1120 Gateway clearing | 1200 Receivable (applied part); 2100 Student advances (any excess) |
| Concession / scholarship approved | 5100 Concessions & scholarships | 1200 Receivable |
| Refund paid | 2100 Student advances | 1110 Bank |
| Payment reversed / invoice cancelled | Reversing entries of the originals | |

The standard accounts are created on first use. The trial balance and manual journal entries are under **Finance → Ledger**.

## Payments

- **Counter collections.** Each time the payment dialog opens, it creates a fresh **idempotency key**. A double click or a retried request returns the existing receipt instead of recording a second payment. Cheque, DD, transfer and card payments need a reference.
- **Allocation.** A payment is applied to the invoice it was recorded against first, then to the oldest open invoices. Any excess is held as credit (advance).
- **Online payment** (`PAYMENT_GATEWAY=razorpay` plus keys in `.env`):
  1. The server creates the order for the exact balance.
  2. The browser opens the provider's checkout. The CSP allows the provider only when the gateway is configured.
  3. The callback **and** the webhook both verify the provider's HMAC signature, **re-fetch the payment from the provider's API**, and check that it is captured for the exact amount and currency before confirming.
  4. Settlement is idempotent, keyed on the unique gateway order and payment ids, so whichever of callback or webhook arrives first wins.
  5. The browser is never trusted about payment status.

  The webhook `/api/payments/webhook` is exempt from the browser-origin CSRF check because it authenticates with the provider's signature.
- With no gateway configured, the portal says so plainly and students pay at the counter. Nothing simulates success.

## Integration with other modules

- **Examination fees.** When `examination.examFeeRequired` is on, exam registrations start with the fee *pending*. *Exam operations → Raise exam fee invoices* raises one invoice per candidate. Paying the invoice marks the registrations paid, and hall tickets are issued only after that.
- **Revaluation fees.** A request raises an invoice when a Revaluation fee head exists. Paying it moves the request to *ready to start*. The desk can still record an offline receipt or waiver.
- **Dues and eligibility.** When `finance.blockExamOnDues` is on, a student with overdue invoices is not eligible for examinations. The reason shown is "Overdue fees".
- **Scholarships.** A student's CGPA, attendance and failures come from the academic record. Declared income comes from the application.

## Approvals

- `finance.concession`: Finance Officer, then Registrar when the amount is ≥ 50,000. The threshold is a condition in the workflow definition, editable under Configuration → Workflows.
- `finance.refund`: Finance Officer, then Registrar.
- `scholarship.application`: HoD recommendation, then scholarship desk (Finance Officer).

## Settings (`finance`)

`invoicePrefix`, `receiptPrefix`, `examFeePerPaper`, `blockExamOnDues`.
