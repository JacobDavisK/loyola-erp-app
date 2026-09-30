# Reporting, analytics and AI assistance

## Report builder (`/reports/builder`)

A self-service builder over ten datasets:

| Dataset | Needs | Scope |
|---|---|---|
| Students | `student.view` | `studentWhere` (departments, own classes, self) |
| Fee invoices, Payments | `finance.view` | the student's department within the finance scope |
| Course results | `result.view` | `resultWhere` (current results only) |
| Employees | `hr.view` | `employeeWhere` |
| Publications | `research.view` | `publicationWhere` |
| Helpdesk tickets | `helpdesk.agent` | all |
| Library loans | `library.circulate` | all |
| Admission applications | `admission.view` | all |
| Placement applications | `placement.manage` | all |

- **List reports** choose columns. **Summary reports** group by up to two fields, with measures (count, sum, avg, min, max). Both support filters (type-aware operators), sorting and a row limit (max 5,000).
- Fields are read and filtered in the database. **Computed fields** (for example an invoice's balance, or a ticket's hours to resolve and on-time flag) are derived per row and filtered in memory. At most 20,000 records are read per run; the UI says when a report was truncated.
- **Scope is always the viewer's.** A report is a definition, not data. When a colleague opens a shared report, it runs with their own permissions and department scope.
- **CSV export** (`/api/report-builder/export`) is rate-limited and protected against formula injection. Every export is audited with its definition, and exports of datasets holding personal data are flagged in the log.
- Definitions are validated against the dataset's field catalogue (`src/lib/domain/report.ts`) before anything touches the database.

## Institution analytics (`/insights`)

One dashboard across modules. Each section appears only when the viewer holds its permission, and department-scoped permissions limit the figures to those departments. It shows aggregates only:

- enrolment by programme and status;
- attendance this term (using the attendance policy's present and excluded marks);
- pass percentage by term;
- fee collections over 12 months, outstanding and overdue;
- net payroll;
- publications and grants;
- library circulation;
- the admissions funnel;
- helpdesk SLA;
- placement outcomes.

## AI assistance

The platform works fully without AI. When AI is configured, it offers three **drafting** aids. Each output is shown to a person for review, and nothing is saved or executed on the model's say-so.

| Feature | Who | What the model receives |
|---|---|---|
| Report assistant (report builder) | anyone who can use the builder | the question and the field catalogue of the datasets the user may read, never records. The reply must be a definition that passes the same validation; it then runs through the normal, scoped engine |
| Feedback drafts (assignment grading) | teachers | assignment title, marks and the teacher's own notes, with no student identity |
| Announcement drafts | announcement publishers | the key points and the audience |

### Gateway (`src/server/ai/gateway.ts`)

- **Provider:** `AI_PROVIDER=anthropic` with `ANTHROPIC_API_KEY` (model `AI_MODEL`, default `claude-sonnet-5`), called over the Messages API. With `AI_PROVIDER=none` (the default), every feature says plainly that AI is not configured. **Nothing is simulated.**
- **Institution switches** (Configuration centre → AI assistance): AI on/off, each feature on/off, and requests per user per day.
- **Redaction:** before a request leaves the platform, e-mail addresses, phone numbers, student and employee numbers and tax ids are replaced with placeholders.
- **Usage log (`AiRequest`):** user, feature, provider, model, token counts, latency, outcome and a hash of the redacted prompt. It never stores the prompt or the answer, and it is append-only (trigger). Configuration centre → AI assistance shows it.
- **Failures:** upstream errors are reported to the user without detail; the detail is kept in the log.
