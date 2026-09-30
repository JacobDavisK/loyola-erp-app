# Campus services, admissions and careers

## Library

- **Catalogue:** titles (`LibraryItem`) and physical copies (`LibraryCopy`) with accession numbers `ACC000001…`. Any signed-in user can search it.
- **Circulation desk** (`library.circulate`): issue and return by accession number plus the borrower's student or employee number.
  - Borrowing is refused when the reader has overdue items, unpaid fines, or the maximum number of loans.
  - Holds are served first come, first served.
  - A partial unique index prevents two open loans on one copy, and the issue itself is guarded against concurrent desks.
- **Fines:** whole days late × the daily rate, up to a cap.
  - Student fines are raised as invoices on the fine fee head (sourceType `libraryLoan`), so they are paid like any fee and block borrowing until paid.
  - The librarian can waive a fine, with a reason (audited).
- **Readers:** renew online (limited; not when overdue or when someone is waiting), place and cancel holds, and see their history at `/library/my`.
- **Reminders:** the worker sends them daily (`library.reminders`). E-mail goes out for overdue items only.
- Settings (`library`): loan days and limits for students and staff, maximum renewals, fine per day, fine cap, whether student fines are invoiced.

## Hostels

- Hostels have an optional gender restriction and a fee per term; rooms can be added in bulk (`101-110, 201-205`).
- **Allocation** (`hostel.manage`):
  - A database trigger locks the room row and refuses overfilling.
  - A partial unique index gives each student at most one open bed.
  - The hostel fee is invoiced on allocation (fee head of category Hostel).
  - Vacating records the date and reason; allocation history is kept.

## Transport

- Routes list their stops in boarding order (`Stop | 07:15`).
- Passes are issued for a stop on a route for a date range. A trigger enforces seat capacity over overlapping periods, and a student cannot hold overlapping passes. The transport fee is invoiced when a pass is issued.

## Helpdesk

- **Tickets:** anyone signed in raises a ticket in a configured category. The SLA due time is the category's hours scaled by priority (urgent ×0.25, high ×0.5, low ×2). Requesters cannot mark their own ticket urgent.
- **Agents** (`helpdesk.agent`):
  - take tickets, reply, add internal notes (never shown to the requester) and move tickets Open → In progress → Waiting → Resolved → Closed;
  - messages are append-only (trigger);
  - replying to a waiting or resolved ticket re-opens it;
  - the requester rates the help (1–5) when it is resolved.
- **Dashboard:** open tickets, past-SLA tickets, 30-day resolutions, percentage resolved on time, and satisfaction.
- Settings (`helpdesk`): ticket number prefix and categories with SLA hours.

## Announcements

- Holders of `announcement.publish` address everyone, staff, students or guardians. Student and guardian audiences can be narrowed to a department or programme.
- Announcements can be scheduled and set to expire. The worker sends scheduled ones when they go live (`announcements.dispatch`).
- Everyone gets them in-app; pinned (important) announcements are also e-mailed.

## Student documents

- Students upload mark sheets, certificates and proofs from **Services & documents**, or the office uploads them on the student's record (Documents tab). Files are PDF or images, up to 5 MB, stored encrypted.
- Holders of `document.verify` for the student's department verify or reject them, and a rejection must give a reason. The uploader cannot verify their own upload.

## Admissions

1. **Cycle and seat matrix** (`admission.manage`): each programme gets a number of seats and the batch admitted students join.
2. **Online application at `/apply`**, public with no account.
   - Rate-limited per IP and per e-mail, with one open application per e-mail per programme.
   - The applicant gets a private status link: the application number plus a 24-byte secret token. Only its hash is stored, and it is compared in constant time.
   - Confirmations go to the e-mail outbox.
3. **Verification:** the office checks documents and records the entrance score. Merit = weighted qualifying % and entrance score (`admissions` settings). A rejection must give a reason.
4. **Offer rounds:** free seats (seats − accepted/enrolled − valid offers) go to verified applicants in merit order, ties broken by earlier application. Offers lapse after the seat's validity (worker `admissions.expireOffers`), which frees the seat for the next round.
5. **Response:** the applicant accepts or declines on their status page.
6. **Enrolment** creates the student through the normal SIS path (student and admission numbers, audit, `StudentAdmitted` event) in the configured batch.

## Placements and alumni

- **Drives:** a company, role, CTC, apply-by date and eligibility rules (minimum CGPA, programmes, maximum active backlogs, admission years).
  - Opening a drive notifies matching students.
  - When a student applies, eligibility is checked against their academic record: the current CGPA, and failed courses not since passed. A snapshot is kept with the application.
  - A one-offer policy (setting) stops placed students applying again.
- The placement office shortlists, selects (with the offered CTC) or rejects. The dashboard shows offers, students placed, and the highest and median CTC.
- **Alumni:** graduates keep their portal account and maintain an alumni profile, and choose whether to appear in the directory. Staff with `alumni.view` see every profile with contact details; graduates see only people who opted in.

## Roles

Librarian, Library Assistant, Hostel Warden, Transport Officer, Helpdesk Agent, Admissions Officer and Placement Officer. The University Administrator gets the helpdesk and announcement permissions; the Registrar gets announcements, `admission.view`, `alumni.view` and `document.verify`. Run `npm run rbac:sync` on existing databases.
