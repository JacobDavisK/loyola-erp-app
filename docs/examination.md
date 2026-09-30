# Examinations, results & credentials

This document covers everything after the question paper. Paper setting, moderation, scrutiny and locking are described in [question-paper-system.md](question-paper-system.md).

```
Class registrations + attendance
  → Eligibility (per paper) ─→ condonation workflow (HoD → CoE) when in the condonation band
  → Hall tickets (+ anonymous dummy numbers)
  → Seating per sitting · invigilation duties
  → Answer scripts coded → first / second / third valuation (anonymous)
  → Internal marks: components → mark sheet → HoD verification (→ CoE for external-type components)
  → Result run: compute → department verification → Controller → Registrar → publish
  → Revaluation / retotalling → new result version
  → Transcripts & certificates with a verification code and seal
```

## Eligibility and hall tickets (`/exam-ops`)

- A session must be linked to its teaching term. *Generate / refresh eligibility* builds one registration per student per paper from class registrations in that term.
- **Eligibility** comes from the configured attendance policy. Below the condonation band, the student is not eligible. Inside the band, they are marked *condonation needed* and can request condonation from the portal; the request goes to HoD then Controller. The student's status is also checked.
- Generation is idempotent. Issued tickets, cancellations and condonations in progress are never overwritten.
- **Overrides.** The Controller can override eligibility, and must give a reason. The reason stays on the registration and in the audit log.
- **Issuing hall tickets.**
  - Tickets go to eligible candidates whose fees are settled (the fee requirement is a setting).
  - Each student gets one ticket number per session, and each paper gets an **anonymous dummy number** for the answer script.
  - Students are notified and can print the ticket at `/portal/exams/<session>`.

## Seating and invigilation

- `allocateSeats` fills the chosen rooms in order, using their examination seat count. It interleaves papers so neighbouring candidates write different papers. The allocation fails, instead of leaving anyone unseated, when rooms are short.
- The printable plan at `/exam-ops/seating` is grouped by room. Invigilators see only the rooms they are on duty in.
- **Duties.** A staff member can have one duty per sitting. They are refused a room where a paper they set or teach is being written.

## Valuation

- Valuers (the Valuer and External Examiner roles) see only dummy numbers, the paper and the maximum marks (`/valuation`).
- **Rounds.**
  - The second valuer is never the first valuer.
  - With double valuation on, a difference within the allowed percentage produces the final mark: the average, rounded up to half a mark, or the higher mark, depending on policy.
  - A larger difference requires a third valuation by someone else. The final mark is then the average of the third valuation and whichever earlier mark is closer to it.
- **Absence and malpractice** are recorded per script by the valuation office (`/exam-ops/scripts/<exam>`).
- Once results are published, scripts can change only through revaluation.

## Internal marks

- Components (tests, assignments, practicals…) have a *marked out of* value and a weight. Weights cannot exceed the course's internal maximum.
- Instructors enter marks in a keyboard-driven grid, then submit the sheet into the `marks.sheet` workflow. The HoD verifies it; external-type components also need the Controller.
- A returned sheet becomes editable again. Approved marks can be changed only by the Controller's office, with a reason, and each change is kept as a `MarkRevision`, which is append-only.

## Grading and results (`/results`)

- **Grading schemes** are versioned. A scheme defines grade bands, the overall pass %, the minimum % in the end-semester and internal components, grace limits per course and per student, and the special grades (absent, fail, withheld). Regulations point to a scheme. Every result run records the scheme version it used.
- **A run** covers one session and one programme.
  - *Compute* combines approved internal components with the final script marks, scaled to the course's external maximum. It then applies the pass rules.
  - **Grace** is applied only when it alone closes the gap, within both limits.
  - Missing data yields *incomplete*, and a warning lists what is not ready.
  - SGPA includes failed credits. CGPA uses each course's latest attempt.
- **Publication.** A run goes through the `result.publication` workflow: department verification (HoD), then Controller review, then Registrar approval. Publication stamps every row, completes the class registrations and notifies students and guardians.
- **Immutability.** Database triggers forbid editing or deleting a published result or term result. Revisions (revaluation, withholding after publication) insert a **new version** and move the current-version flag. A partial unique index guarantees exactly one current version per student, course, term and attempt.

## Revaluation (`/results/revaluation`)

1. The student applies from the portal within the window: the session's `revaluationUntil`, or publication plus the configured number of days.
2. The fee is recorded. Until the finance module is connected, the desk records the receipt number or a waiver reference.
3. **Retotalling:** the desk enters the recounted total, and any difference applies.
4. **Revaluation:** a valuer who has never seen the script values it anonymously. The change applies only if it reaches the configured minimum.
5. A new result version (and term result) is recorded with the reason, and the student is notified. The original stays in history.

## Transcripts & certificates

- The payload is a frozen snapshot built only from published data.
- `contentHash` is the SHA-256 of its canonical JSON. `seal` is an HMAC with a key derived from `APP_SECRET`.
- A database trigger forbids any change to the snapshot, hash, seal, serial or verification code. Credentials can only be revoked (or superseded by a newer transcript).
- **Public verification** at `/verify/<code>` needs no sign-in and is rate-limited. It recomputes the seal, so an altered record shows *Integrity check failed*. It shows only what a verifier needs.
- The seal proves the document came from this system unaltered. It is **not** a PKI digital signature. A PAdES/PKCS#7 signer can be added behind `sealPayload` when the institution has a signing certificate.
- Students request certificates from the portal (`credential.request` workflow, Registrar approval). Staff with `credential.issue` issue them directly from the student record.

## Configuration (Configuration → settings, key `examination`)

`hallTicketPrefix`, `examFeeRequired`, `allowCondonation`, `doubleValuation`, `valuationMaxDifferencePercent`, `valuationMethod`, `revaluationWindowDays`, `revaluationFee`, `retotallingFee`, `revaluationMinChange`. Grading rules live in the grading schemes.
