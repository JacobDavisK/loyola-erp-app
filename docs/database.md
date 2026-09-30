# Database

PostgreSQL 14+, accessed through Prisma 7 with the `pg` driver adapter. The schema is split by module under `prisma/schema/`:

| File | Contents |
|---|---|
| `core.prisma` | Identity and RBAC (User, Role, Permission, UserRole, Session, LoginAttempt), organisation (Institution, Campus, AcademicUnit, Department, Program, Regulation, AcademicYear, Semester, Course, CourseUnit, CourseTopic, LearningOutcome), examinations and the question-paper subsystem, notifications, audit log, files, templates, settings |
| `platform.prisma` | Workflow engine (WorkflowDefinition, WorkflowInstance, WorkflowTask, WorkflowAction, WorkflowDelegation), DomainEvent outbox, Job queue, NumberSequence |
| `academic.prisma` | SIS and academic operations: Batch, Student, Guardian, StudentStatusChange, AcademicTerm, CalendarEvent, Building, Room, CourseOffering, OfferingInstructor, CourseRegistration, TimetableSlot, ClassMeeting, AttendanceRecord, CoursePrerequisite, Curriculum, ElectiveGroup, CurriculumCourse |
| `results.prisma` | Examination operations, marks, valuation, grading, results, revaluation, credentials (see examination.md) |
| `finance.prisma` | Fees, invoices, payments, concessions, refunds, scholarships, general ledger (see finance.md) |
| `lms.prisma` | CourseModule, LearningItem, LearningItemView, CourseAnnouncement, Assignment, Submission (+files), Quiz, QuizQuestion, QuizAttempt (see lms.md) |
| `hr.prisma` | Positions, Employee, leave types/balances/requests, StaffAttendance, salary components and versioned structures, EmployeeSalary history, PayrollRun, Payslip, appraisal cycles (see hr.md) |
| `quality.prisma` | ResearchProject, ProjectMember, ProjectBudgetLine, ProjectExpense, Publication, PublicationAuthor, AccreditationFramework, AccreditationMetric, AccreditationCycle, MetricResponse, MetricEvidence (see research-iqac.md) |
| `campus.prisma` | Library (items, copies, loans, holds), hostels, transport, helpdesk tickets and messages, announcements, student documents, admissions (cycles, seats, applications), placements (companies, drives, applications), alumni profiles (see campus-services.md) |
| `insight.prisma` | SavedReport (report builder definitions) and AiRequest (append-only AI usage log without prompt content) (see reporting-ai.md) |

## Conventions

- `cuid()` string ids; `createdAt` / `updatedAt` on mutable rows.
- **Soft deletion** (`deletedAt`) for rows that history refers to: users, students, courses, departments, programmes and batches. Queries filter `deletedAt: null`.
- **Master data is referenced, never copied.** One denormalisation is deliberate: `Student.departmentId` is copied from the programme so that scope filtering is a single indexed column. It is rewritten whenever the programme changes.
- **Versioned configuration.** Curricula, workflow definitions, questions and paper snapshots are versioned. Records that depend on them (batches, workflow instances, papers) pin a specific version, so historical outcomes remain reproducible.

## Integrity enforced by the database

| Rule | Mechanism |
|---|---|
| Append-only history | `examcore_forbid_mutation()` trigger on AuditLog, QuestionVersion, QuestionPaperVersion, QuestionUsage, PaperTransition, WorkflowAction, StudentStatusChange |
| Approved papers frozen | `examcore_forbid_locked_paper_edit()` trigger on paper sections and items |
| LMS | Submission content and files immutable (`examcore_protect_submission`); submitted quiz attempts keep their answers (`examcore_protect_quiz_attempt`); CHECKs on windows, penalties, attempts, marks and item content |
| Campus services | One open loan per copy and one open hostel bed per student (partial unique indexes); room and route capacity enforced by triggers under row locks; ticket messages append-only; exactly one borrower per loan/hold; CHECKs on dates, capacities, fees and scores |
| Research & IQAC | ProjectExpense append-only; unique DOI; CHECKs on amounts, durations, dates, evidence (exactly one of file or link) |
| HR & payroll | EmployeeSalary append-only; payslips frozen once the run is approved (`examcore_protect_payslip`); payroll status forward-only after approval (`examcore_protect_payroll_run`); CHECKs on leave dates/half days, balances, payslip arithmetic (`net = gross − deductions`), period format |
| One scope per grant | `CHECK (num_nonnulls(departmentId, academicUnitId, campusId) <= 1)` on UserRole |
| Sensible ranges | CHECKs on semesters, batch years, term and event dates, room and class capacity, timetable time format and order, meeting times, self-prerequisites, curriculum credits, sequence values |
| Uniqueness | Student number, admission number, registration number; one section per course per term; one registration per student per class; one attendance mark per student per session; one session per class per start time |
| Referential integrity | Foreign keys on every relation, with `RESTRICT` by default and `CASCADE` only for owned children (e.g. timetable slots of a class) |

## Concurrency

- **Registration capacity**: the class row is locked (`SELECT … FOR UPDATE`) before seats are counted, so parallel registrations cannot overfill a class.
- **Number sequences**: `INSERT … ON CONFLICT DO UPDATE … RETURNING` gives each transaction a unique number. The number is released if the transaction rolls back.
- **Workflow decisions**: an advisory lock per task serialises concurrent decisions.
- **Audit chain**: an advisory lock keeps the hash chain linear.
- **Jobs and events**: claimed with `FOR UPDATE SKIP LOCKED`, so any number of workers can run safely.

## Migrations

- Edit `prisma/schema/*.prisma`, then run `npm run db:new-migration -- <name>`. This writes the SQL diff for review. Append hand-written SQL such as CHECK constraints and triggers to the same file, then run `npm run db:migrate`.
- Never edit a migration that has already been applied anywhere. Add a new one instead.
- After upgrading an existing deployment, run `npm run rbac:sync` to add new permissions and roles.

## Performance notes

- Lists are paged, sorted and filtered on the server, and every filter column is indexed: `Student(departmentId,status)`, `(programId,batchId)`, `(batchId,section)`, trigram name search, `CourseOffering(termId)`, `ClassMeeting(date)`, `AttendanceRecord(studentId)`, `WorkflowTask(assigneeId,status)` and others.
- Attendance summaries count per class. At very large scale, a nightly materialised summary table can replace the live aggregation without changing callers (`src/server/services/attendance.ts`).
