# Student information & academic operations

## Student records (`/students`)

- **Numbering.** The student number comes from the configured template (Configuration → academic settings, default `{YY}{PROGRAM}` + 4 digits, e.g. `25BCA0007`). It is allocated from a concurrency-safe sequence. The admission number is either given or generated as `ADM{year}-00001`.
- **Scope.** Staff see students of departments in their grant scope (department, faculty/school or campus). Instructors also see students registered in their classes. Students see only themselves; guardians see only their linked wards (`studentWhere`).
- **Changes.** Every edit is audited with old and new values of the key fields. Status changes (leave, suspension, withdrawal, discontinuation, graduation, reinstatement) go through the `student.status_change` workflow (HoD, then Registrar) and are applied on approval. The change is written to the append-only status history. Suspended, withdrawn and discontinued students have their portal account disabled; reinstatement re-enables it.
- **Guardians.** Each guardian record has visibility flags (academics, finance). A guardian's portal account can be linked to several wards.
- **Portal accounts.** Created by staff. The person receives an invitation link and sets their own password; staff never see it.
- **Bulk import** (`/students/import`):
  1. The CSV is validated completely: required columns, programme/batch codes, department permission, formats, and duplicates both within the file and against the database.
  2. The import is refused while any row has an error.
  3. A clean file is queued as a `students.import` job.
  4. The worker inserts every row in **one transaction**. Any failure rolls back the whole file, and the job result names the failing line.
- **Export.** `/api/students/export` exports the full filtered set as CSV. It requires `student.export`, is rate-limited and audited, and neutralises formula injection.

## Terms, calendar, rooms, batches

- **Terms** carry teaching dates, a registration window and an add/drop deadline.
- **Holidays** in the academic calendar are skipped when class sessions are generated.
- **Rooms** have a teaching capacity and a separate examination seat count, used later for seating plans.
- **Batches** are cohorts. Each batch pins a curriculum version.

## Classes (`/academics/offerings`)

A class is a course taught in a term to one section, with instructors, a weekly timetable, dated sessions and registrations.

- **Timetable.**
  - Adding a slot checks room, instructor and cohort clashes. Room double-booking is always refused. Instructor and cohort clashes can be allowed deliberately, for example for combined classes.
  - *Generate class sessions* creates dated sessions for the rest of the term and skips holidays. It is idempotent: re-running after a change only adds new sessions, and cancels future sessions of removed slots when they have no attendance.
- **Registration.** `src/lib/domain/registration.ts` evaluates every rule and reports all problems at once.
  - **Hard rules**: student status, class open, duplicate course.
  - **Soft rules**: window, capacity, reserved batch, credit limit, prerequisites, timetable clash. Staff with `enrollment.manage` may override soft rules with a recorded reason.
  - Students can self-register and drop during the window in the portal.
  - Dropping after attendance exists records a withdrawal instead.

## Attendance

- **Recording.** An instructor records attendance from 30 minutes before the class until the configured edit window closes (default 72 hours after it). After that, only holders of `attendance.manage` (e.g. the HoD) can change marks. Changes are audited as corrections with old and new values. Unmarked students block saving, so nobody is skipped silently.
- **Policy** (configurable):
  - which marks count as present (default present, late, on duty);
  - which are excluded from the denominator (default excused, medical);
  - the minimum percentage (75%) and the condonation band (65%).
- **Projections.** `summarise()` returns the standing and two figures: how many classes a student can still miss, and how many consecutive classes they must attend to recover.

## Curricula & degree audit

- A curriculum version lists courses by semester (mandatory or elective), elective groups with minimum credits, a credit total, an optional minimum CGPA, and extra requirements such as credits from project-type courses.
- **Draft** versions are editable. **Active** versions are frozen; *New version* copies one into a new draft.
- **Prerequisites** are set per course. Circular chains are refused.
- The **degree audit** (`auditDegree`) reports credits earned, mandatory courses remaining, elective and category progress, failed and repeated courses, and graduation blockers.
  - Until results are published (Phase 3), a completed registration counts as passed.
  - The CGPA requirement shows as pending.

## Self-service

- **Students:** `/portal` shows attendance, credits, today's classes, the week timetable, calendar and degree progress. `/portal/attendance` gives the per-course standing. `/portal/registration` handles registration and add/drop.
- **Guardians:** the same portal for their ward(s), limited by the visibility flags on the guardian record.
- **Faculty:** `/teaching` shows today's sessions with *Take attendance*, the week timetable, classes and unmarked past sessions. The attendance sheet works on phones and supports keyboard entry (P, A, L, O, M, E, and the arrow keys).
