# Learning management (course spaces)

Every class (`CourseOffering` — a section of a course in a term) has a course space. There is no separate LMS enrolment: the class's instructors teach it and its registered students learn in it.

| Who | Access |
|---|---|
| Instructor of the class | Full control of the course space (`/teaching/courses/[id]`) |
| Department staff with `enrollment.manage` or `academic.manage` | Read-only oversight, including the gradebook |
| Student registered in the class (current or completed) | Published content and their own work (`/portal/courses/[id]`) |
| Anyone else | The class does not exist for them (404) |

Access is resolved by `courseSpace(ctx, offeringId)` in `src/server/services/lms.ts`; every service function goes through it.

## Content

- **Modules** (units or weeks) hold **items**: pages (plain text), files, web links and video links. Modules and items can be hidden, and items can be scheduled with *available from*.
- **Files** are stored encrypted like every other upload. Accepted types are PDF, images, Office documents (.docx/.xlsx/.pptx), ZIP and plain text/code. Types are detected from the file content, never from the browser. Limits: 15 MB for material, 10 MB per submission file. Downloads use short-lived signed URLs and also require a session.
- Links must be http(s). They open in a new tab and are never embedded, so the Content Security Policy stays strict.
- **Completion tracking**: each time a student opens an item, the first/last view and a view count are recorded. Instructors see "opened by n/N"; students see ticks.

## Announcements

Posted by instructors. Every student currently registered is notified.

## Assignments

| Setting | Meaning |
|---|---|
| Due / accept late work until | Work after *due* is late. After *until* (or right after *due* when *until* is empty), submissions are refused. |
| Late penalty % | Fixed at submission time and stored on the submission. It is applied to the marks awarded. |
| Attempts | Each attempt is a new, immutable `Submission`. **Returning** a submission for rework grants one extra attempt. |
| Typed answer / files | Either or both; up to 10 files per attempt. |

- First publication notifies the class.
- Grading records marks and feedback. `finalMarks` = marks × (1 − penalty).
- Students see marks and feedback only after **Release marks**, which also notifies them.
- A database trigger makes the submitted content (text, time, lateness, penalty, files) immutable. Submissions cannot be deleted, so an assignment with submissions cannot be deleted either (unpublish it instead).

## Quizzes

- **Question types**: single choice, multiple choice (optionally with partial credit: (right − wrong) / correct, never below zero), true/false, short answer (a list of accepted answers, spacing- and optionally case-insensitive) and numeric (with a ± tolerance).
- **Answer keys never leave the server.** The quiz page sends only prompts and options.
- **Attempts**: the deadline is the earlier of *start + time limit* and the closing time.
  - Answers autosave as the student works.
  - The browser submits automatically at zero.
  - Answers arriving more than 30 s after the deadline are refused.
  - An abandoned attempt is submitted with its saved answers the next time the student, the instructor or the gradebook looks at it.
  - Questions can be shuffled per student. The order is deterministic, so reloading does not reshuffle.
- Questions are **locked** once anyone has attempted the quiz.
- A trigger prevents changes to a submitted attempt's answers.
- **Review policy**: score and answers after submitting, after the quiz closes, score only, or nothing.

## Gradebook

- The gradebook shows every published assignment (latest graded attempt, after any penalty) and every published quiz (best attempt) per student.
- **Transfer to internal marks** copies one column into an internal-assessment component of the same class, scaled to the component's maximum.
  - It goes through the normal marks service, so it works only while the mark sheet is a draft. Every change is audited, and the sheet still needs submission and HoD verification.
  - Students without a score are left blank for the instructor to decide.

## Not included yet

Rubrics, peer review, plagiarism checking, discussion forums, SCORM/LTI, question banks shared between quizzes, and bulk download of submissions. The file and grading model leaves room for each.
