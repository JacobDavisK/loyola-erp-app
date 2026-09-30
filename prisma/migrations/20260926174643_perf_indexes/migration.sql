-- CreateIndex
CREATE INDEX "Payslip_employeeId_idx" ON "Payslip"("employeeId");

-- CreateIndex
CREATE INDEX "QuizAttempt_studentId_status_idx" ON "QuizAttempt"("studentId", "status");

-- CreateIndex
CREATE INDEX "Submission_studentId_idx" ON "Submission"("studentId");

-- CreateIndex
CREATE INDEX "Ticket_status_dueAt_idx" ON "Ticket"("status", "dueAt");


-- Overdue lists and reminders scan open loans by due date only.
CREATE INDEX "LibraryLoan_open_due_idx" ON "LibraryLoan" ("dueAt") WHERE "returnedAt" IS NULL;
