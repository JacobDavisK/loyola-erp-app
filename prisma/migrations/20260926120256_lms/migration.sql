-- CreateEnum
CREATE TYPE "LearningItemKind" AS ENUM ('PAGE', 'FILE', 'LINK', 'VIDEO');

-- CreateEnum
CREATE TYPE "SubmissionStatus" AS ENUM ('SUBMITTED', 'GRADED', 'RETURNED');

-- CreateEnum
CREATE TYPE "QuizQuestionType" AS ENUM ('SINGLE', 'MULTIPLE', 'TRUE_FALSE', 'SHORT', 'NUMERIC');

-- CreateEnum
CREATE TYPE "QuizReviewPolicy" AS ENUM ('AFTER_SUBMIT', 'AFTER_CLOSE', 'SCORE_ONLY', 'NEVER');

-- CreateEnum
CREATE TYPE "QuizAttemptStatus" AS ENUM ('IN_PROGRESS', 'SUBMITTED');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "FileKind" ADD VALUE 'COURSE_MATERIAL';
ALTER TYPE "FileKind" ADD VALUE 'SUBMISSION';

-- CreateTable
CREATE TABLE "CourseModule" (
    "id" TEXT NOT NULL,
    "offeringId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "order" INTEGER NOT NULL DEFAULT 0,
    "isPublished" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CourseModule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LearningItem" (
    "id" TEXT NOT NULL,
    "moduleId" TEXT NOT NULL,
    "kind" "LearningItemKind" NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT,
    "url" TEXT,
    "fileId" TEXT,
    "order" INTEGER NOT NULL DEFAULT 0,
    "isPublished" BOOLEAN NOT NULL DEFAULT false,
    "availableFrom" TIMESTAMP(3),
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LearningItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LearningItemView" (
    "itemId" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "firstViewedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastViewedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "views" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "LearningItemView_pkey" PRIMARY KEY ("itemId","studentId")
);

-- CreateTable
CREATE TABLE "CourseAnnouncement" (
    "id" TEXT NOT NULL,
    "offeringId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CourseAnnouncement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Assignment" (
    "id" TEXT NOT NULL,
    "offeringId" TEXT NOT NULL,
    "moduleId" TEXT,
    "title" TEXT NOT NULL,
    "instructions" TEXT NOT NULL,
    "maxMarks" DOUBLE PRECISION NOT NULL,
    "dueAt" TIMESTAMP(3) NOT NULL,
    "closesAt" TIMESTAMP(3),
    "latePenaltyPercent" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "maxAttempts" INTEGER NOT NULL DEFAULT 1,
    "allowText" BOOLEAN NOT NULL DEFAULT true,
    "allowFiles" BOOLEAN NOT NULL DEFAULT true,
    "maxFiles" INTEGER NOT NULL DEFAULT 3,
    "isPublished" BOOLEAN NOT NULL DEFAULT false,
    "publishedAt" TIMESTAMP(3),
    "gradesReleasedAt" TIMESTAMP(3),
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Assignment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Submission" (
    "id" TEXT NOT NULL,
    "assignmentId" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "attempt" INTEGER NOT NULL,
    "text" TEXT,
    "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "isLate" BOOLEAN NOT NULL DEFAULT false,
    "status" "SubmissionStatus" NOT NULL DEFAULT 'SUBMITTED',
    "marks" DOUBLE PRECISION,
    "penalty" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "finalMarks" DOUBLE PRECISION,
    "feedback" TEXT,
    "gradedById" TEXT,
    "gradedAt" TIMESTAMP(3),

    CONSTRAINT "Submission_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SubmissionFile" (
    "submissionId" TEXT NOT NULL,
    "fileId" TEXT NOT NULL,

    CONSTRAINT "SubmissionFile_pkey" PRIMARY KEY ("submissionId","fileId")
);

-- CreateTable
CREATE TABLE "Quiz" (
    "id" TEXT NOT NULL,
    "offeringId" TEXT NOT NULL,
    "moduleId" TEXT,
    "title" TEXT NOT NULL,
    "instructions" TEXT,
    "opensAt" TIMESTAMP(3) NOT NULL,
    "closesAt" TIMESTAMP(3) NOT NULL,
    "timeLimitMinutes" INTEGER,
    "maxAttempts" INTEGER NOT NULL DEFAULT 1,
    "shuffleQuestions" BOOLEAN NOT NULL DEFAULT false,
    "reviewPolicy" "QuizReviewPolicy" NOT NULL DEFAULT 'AFTER_CLOSE',
    "isPublished" BOOLEAN NOT NULL DEFAULT false,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Quiz_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QuizQuestion" (
    "id" TEXT NOT NULL,
    "quizId" TEXT NOT NULL,
    "order" INTEGER NOT NULL DEFAULT 0,
    "type" "QuizQuestionType" NOT NULL,
    "prompt" TEXT NOT NULL,
    "options" JSONB,
    "answer" JSONB NOT NULL,
    "marks" DOUBLE PRECISION NOT NULL,
    "explanation" TEXT,

    CONSTRAINT "QuizQuestion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QuizAttempt" (
    "id" TEXT NOT NULL,
    "quizId" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "attemptNo" INTEGER NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deadlineAt" TIMESTAMP(3) NOT NULL,
    "submittedAt" TIMESTAMP(3),
    "status" "QuizAttemptStatus" NOT NULL DEFAULT 'IN_PROGRESS',
    "questionOrder" JSONB NOT NULL,
    "answers" JSONB NOT NULL DEFAULT '{}',
    "marksAwarded" JSONB,
    "score" DOUBLE PRECISION,
    "maxScore" DOUBLE PRECISION NOT NULL,

    CONSTRAINT "QuizAttempt_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CourseModule_offeringId_order_idx" ON "CourseModule"("offeringId", "order");

-- CreateIndex
CREATE INDEX "LearningItem_moduleId_order_idx" ON "LearningItem"("moduleId", "order");

-- CreateIndex
CREATE INDEX "CourseAnnouncement_offeringId_createdAt_idx" ON "CourseAnnouncement"("offeringId", "createdAt");

-- CreateIndex
CREATE INDEX "Assignment_offeringId_dueAt_idx" ON "Assignment"("offeringId", "dueAt");

-- CreateIndex
CREATE INDEX "Submission_assignmentId_status_idx" ON "Submission"("assignmentId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "Submission_assignmentId_studentId_attempt_key" ON "Submission"("assignmentId", "studentId", "attempt");

-- CreateIndex
CREATE INDEX "Quiz_offeringId_opensAt_idx" ON "Quiz"("offeringId", "opensAt");

-- CreateIndex
CREATE INDEX "QuizQuestion_quizId_order_idx" ON "QuizQuestion"("quizId", "order");

-- CreateIndex
CREATE INDEX "QuizAttempt_quizId_status_idx" ON "QuizAttempt"("quizId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "QuizAttempt_quizId_studentId_attemptNo_key" ON "QuizAttempt"("quizId", "studentId", "attemptNo");

-- AddForeignKey
ALTER TABLE "CourseModule" ADD CONSTRAINT "CourseModule_offeringId_fkey" FOREIGN KEY ("offeringId") REFERENCES "CourseOffering"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LearningItem" ADD CONSTRAINT "LearningItem_moduleId_fkey" FOREIGN KEY ("moduleId") REFERENCES "CourseModule"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LearningItem" ADD CONSTRAINT "LearningItem_fileId_fkey" FOREIGN KEY ("fileId") REFERENCES "FileAsset"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LearningItemView" ADD CONSTRAINT "LearningItemView_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "LearningItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LearningItemView" ADD CONSTRAINT "LearningItemView_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CourseAnnouncement" ADD CONSTRAINT "CourseAnnouncement_offeringId_fkey" FOREIGN KEY ("offeringId") REFERENCES "CourseOffering"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CourseAnnouncement" ADD CONSTRAINT "CourseAnnouncement_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Assignment" ADD CONSTRAINT "Assignment_offeringId_fkey" FOREIGN KEY ("offeringId") REFERENCES "CourseOffering"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Assignment" ADD CONSTRAINT "Assignment_moduleId_fkey" FOREIGN KEY ("moduleId") REFERENCES "CourseModule"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Submission" ADD CONSTRAINT "Submission_assignmentId_fkey" FOREIGN KEY ("assignmentId") REFERENCES "Assignment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Submission" ADD CONSTRAINT "Submission_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SubmissionFile" ADD CONSTRAINT "SubmissionFile_submissionId_fkey" FOREIGN KEY ("submissionId") REFERENCES "Submission"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SubmissionFile" ADD CONSTRAINT "SubmissionFile_fileId_fkey" FOREIGN KEY ("fileId") REFERENCES "FileAsset"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Quiz" ADD CONSTRAINT "Quiz_offeringId_fkey" FOREIGN KEY ("offeringId") REFERENCES "CourseOffering"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Quiz" ADD CONSTRAINT "Quiz_moduleId_fkey" FOREIGN KEY ("moduleId") REFERENCES "CourseModule"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuizQuestion" ADD CONSTRAINT "QuizQuestion_quizId_fkey" FOREIGN KEY ("quizId") REFERENCES "Quiz"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuizAttempt" ADD CONSTRAINT "QuizAttempt_quizId_fkey" FOREIGN KEY ("quizId") REFERENCES "Quiz"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuizAttempt" ADD CONSTRAINT "QuizAttempt_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- ── Hand-written integrity rules ─────────────────────────────────────
ALTER TABLE "Assignment" ADD CONSTRAINT "Assignment_values" CHECK ("maxMarks" > 0 AND "latePenaltyPercent" BETWEEN 0 AND 100 AND "maxAttempts" BETWEEN 1 AND 20 AND "maxFiles" BETWEEN 0 AND 10 AND ("closesAt" IS NULL OR "closesAt" >= "dueAt") AND ("allowText" OR "allowFiles"));
ALTER TABLE "Submission" ADD CONSTRAINT "Submission_values" CHECK ("attempt" >= 1 AND "penalty" BETWEEN 0 AND 1 AND ("marks" IS NULL OR "marks" >= 0) AND ("finalMarks" IS NULL OR "finalMarks" >= 0));
ALTER TABLE "Quiz" ADD CONSTRAINT "Quiz_values" CHECK ("closesAt" > "opensAt" AND ("timeLimitMinutes" IS NULL OR "timeLimitMinutes" BETWEEN 1 AND 1440) AND "maxAttempts" BETWEEN 1 AND 20);
ALTER TABLE "QuizQuestion" ADD CONSTRAINT "QuizQuestion_marks" CHECK ("marks" > 0);
ALTER TABLE "QuizAttempt" ADD CONSTRAINT "QuizAttempt_values" CHECK ("attemptNo" >= 1 AND "deadlineAt" >= "startedAt" AND "maxScore" >= 0 AND ("score" IS NULL OR "score" >= 0));
ALTER TABLE "LearningItem" ADD CONSTRAINT "LearningItem_content" CHECK (("kind" <> 'FILE' OR "fileId" IS NOT NULL) AND ("kind" NOT IN ('LINK', 'VIDEO') OR "url" IS NOT NULL));

-- What a student handed in never changes: grading only writes marks, feedback and status.
CREATE OR REPLACE FUNCTION examcore_protect_submission() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'EXAMCORE: Submissions cannot be deleted.';
  END IF;
  IF NEW."text" IS DISTINCT FROM OLD."text" OR NEW."submittedAt" <> OLD."submittedAt" OR NEW."isLate" <> OLD."isLate"
     OR NEW."penalty" <> OLD."penalty" OR NEW."studentId" <> OLD."studentId" OR NEW."assignmentId" <> OLD."assignmentId" OR NEW."attempt" <> OLD."attempt" THEN
    RAISE EXCEPTION 'EXAMCORE: A submission''s content cannot be changed.';
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
CREATE TRIGGER "Submission_guard" BEFORE UPDATE OR DELETE ON "Submission" FOR EACH ROW EXECUTE FUNCTION examcore_protect_submission();
CREATE TRIGGER "SubmissionFile_immutable" BEFORE UPDATE OR DELETE ON "SubmissionFile" FOR EACH ROW EXECUTE FUNCTION examcore_forbid_mutation();

-- A submitted quiz attempt keeps its answers; only (re)grading fields may change.
CREATE OR REPLACE FUNCTION examcore_protect_quiz_attempt() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD."status" = 'SUBMITTED' THEN RAISE EXCEPTION 'EXAMCORE: Submitted quiz attempts cannot be deleted.'; END IF;
    RETURN OLD;
  END IF;
  IF OLD."status" = 'SUBMITTED' AND (NEW."status" <> 'SUBMITTED' OR NEW."answers"::text <> OLD."answers"::text OR NEW."submittedAt" IS DISTINCT FROM OLD."submittedAt" OR NEW."deadlineAt" <> OLD."deadlineAt") THEN
    RAISE EXCEPTION 'EXAMCORE: A submitted quiz attempt cannot be changed.';
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
CREATE TRIGGER "QuizAttempt_guard" BEFORE UPDATE OR DELETE ON "QuizAttempt" FOR EACH ROW EXECUTE FUNCTION examcore_protect_quiz_attempt();
