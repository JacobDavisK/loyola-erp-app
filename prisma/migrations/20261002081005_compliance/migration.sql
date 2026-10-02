-- CreateEnum
CREATE TYPE "NadBatchKind" AS ENUM ('ABC_CREDITS', 'NAD_MARKSHEET', 'NAD_DEGREE');

-- CreateEnum
CREATE TYPE "NadBatchStatus" AS ENUM ('GENERATED', 'SUBMITTED', 'ACKNOWLEDGED', 'REJECTED');

-- CreateEnum
CREATE TYPE "ExitRequestStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'WITHDRAWN');

-- CreateEnum
CREATE TYPE "ExternalCreditSource" AS ENUM ('SWAYAM', 'NPTEL', 'MOOC', 'INSTITUTION');

-- CreateEnum
CREATE TYPE "ExternalCreditStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "OutcomeKind" AS ENUM ('PO', 'PSO');

-- CreateEnum
CREATE TYPE "NoticeAudience" AS ENUM ('ALL', 'STUDENT', 'STAFF', 'GUARDIAN');

-- CreateEnum
CREATE TYPE "ConsentDecision" AS ENUM ('GRANTED', 'WITHDRAWN');

-- CreateEnum
CREATE TYPE "DataRequestType" AS ENUM ('ACCESS', 'CORRECTION', 'ERASURE', 'NOMINATION', 'GRIEVANCE');

-- CreateEnum
CREATE TYPE "DataRequestStatus" AS ENUM ('OPEN', 'IN_PROGRESS', 'COMPLETED', 'REJECTED');

-- CreateEnum
CREATE TYPE "BreachStatus" AS ENUM ('OPEN', 'CONTAINED', 'NOTIFIED', 'CLOSED');

-- AlterEnum
ALTER TYPE "CredentialType" ADD VALUE 'EXIT_CERTIFICATE';

-- AlterEnum
ALTER TYPE "StudentStatus" ADD VALUE 'EXITED';

-- AlterTable
ALTER TABLE "Student" ADD COLUMN     "apaarId" TEXT,
ADD COLUMN     "apaarVerifiedAt" TIMESTAMP(3),
ADD COLUMN     "apaarVerifiedById" TEXT;

-- CreateTable
CREATE TABLE "NadBatch" (
    "id" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "kind" "NadBatchKind" NOT NULL,
    "termId" TEXT,
    "title" TEXT NOT NULL,
    "rows" JSONB NOT NULL,
    "rowCount" INTEGER NOT NULL,
    "skipped" JSONB NOT NULL,
    "status" "NadBatchStatus" NOT NULL DEFAULT 'GENERATED',
    "reference" TEXT,
    "remarks" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "submittedAt" TIMESTAMP(3),
    "respondedAt" TIMESTAMP(3),

    CONSTRAINT "NadBatch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProgramExitAward" (
    "id" TEXT NOT NULL,
    "programId" TEXT NOT NULL,
    "level" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "minCredits" DOUBLE PRECISION NOT NULL,
    "minYears" DOUBLE PRECISION NOT NULL,
    "reentryYears" INTEGER NOT NULL DEFAULT 7,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProgramExitAward_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExitRequest" (
    "id" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "awardId" TEXT NOT NULL,
    "status" "ExitRequestStatus" NOT NULL DEFAULT 'PENDING',
    "reason" TEXT NOT NULL,
    "creditsEarned" DOUBLE PRECISION NOT NULL,
    "workflowId" TEXT,
    "credentialId" TEXT,
    "reentryUntil" TIMESTAMP(3),
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decidedAt" TIMESTAMP(3),

    CONSTRAINT "ExitRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExternalCredit" (
    "id" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "source" "ExternalCreditSource" NOT NULL,
    "provider" TEXT NOT NULL,
    "courseTitle" TEXT NOT NULL,
    "courseCode" TEXT,
    "credits" DOUBLE PRECISION NOT NULL,
    "grade" TEXT,
    "completedOn" DATE NOT NULL,
    "certificateNo" TEXT,
    "certificateAssetId" TEXT,
    "mappedCourseId" TEXT,
    "status" "ExternalCreditStatus" NOT NULL DEFAULT 'PENDING',
    "remarks" TEXT,
    "reviewedById" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ExternalCredit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProgramOutcome" (
    "id" TEXT NOT NULL,
    "programId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "kind" "OutcomeKind" NOT NULL DEFAULT 'PO',
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "order" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "ProgramOutcome_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CoPoMapping" (
    "outcomeId" TEXT NOT NULL,
    "programOutcomeId" TEXT NOT NULL,
    "strength" INTEGER NOT NULL,

    CONSTRAINT "CoPoMapping_pkey" PRIMARY KEY ("outcomeId","programOutcomeId")
);

-- CreateTable
CREATE TABLE "ComponentOutcome" (
    "componentId" TEXT NOT NULL,
    "outcomeId" TEXT NOT NULL,

    CONSTRAINT "ComponentOutcome_pkey" PRIMARY KEY ("componentId","outcomeId")
);

-- CreateTable
CREATE TABLE "ConsentNotice" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "purpose" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "audience" "NoticeAudience" NOT NULL DEFAULT 'ALL',
    "required" BOOLEAN NOT NULL DEFAULT false,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ConsentNotice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ConsentRecord" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "noticeId" TEXT NOT NULL,
    "decision" "ConsentDecision" NOT NULL,
    "studentId" TEXT,
    "ip" TEXT,
    "userAgent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ConsentRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DataRequest" (
    "id" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" "DataRequestType" NOT NULL,
    "details" TEXT NOT NULL,
    "status" "DataRequestStatus" NOT NULL DEFAULT 'OPEN',
    "dueAt" TIMESTAMP(3) NOT NULL,
    "response" TEXT,
    "exportAssetId" TEXT,
    "handledById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closedAt" TIMESTAMP(3),

    CONSTRAINT "DataRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BreachIncident" (
    "id" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "detectedAt" TIMESTAMP(3) NOT NULL,
    "severity" TEXT NOT NULL,
    "dataCategories" TEXT NOT NULL,
    "affectedCount" INTEGER NOT NULL DEFAULT 0,
    "status" "BreachStatus" NOT NULL DEFAULT 'OPEN',
    "containment" TEXT,
    "boardNotifiedAt" TIMESTAMP(3),
    "usersNotifiedAt" TIMESTAMP(3),
    "closedAt" TIMESTAMP(3),
    "reportedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BreachIncident_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RetentionRule" (
    "id" TEXT NOT NULL,
    "dataset" TEXT NOT NULL,
    "retainDays" INTEGER NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "lastRunAt" TIMESTAMP(3),
    "lastAffected" INTEGER,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RetentionRule_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "NadBatch_number_key" ON "NadBatch"("number");

-- CreateIndex
CREATE INDEX "NadBatch_kind_createdAt_idx" ON "NadBatch"("kind", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "ProgramExitAward_programId_level_key" ON "ProgramExitAward"("programId", "level");

-- CreateIndex
CREATE UNIQUE INDEX "ExitRequest_workflowId_key" ON "ExitRequest"("workflowId");

-- CreateIndex
CREATE UNIQUE INDEX "ExitRequest_credentialId_key" ON "ExitRequest"("credentialId");

-- CreateIndex
CREATE INDEX "ExitRequest_studentId_idx" ON "ExitRequest"("studentId");

-- CreateIndex
CREATE INDEX "ExternalCredit_studentId_status_idx" ON "ExternalCredit"("studentId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "ProgramOutcome_programId_code_key" ON "ProgramOutcome"("programId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "ConsentNotice_key_version_key" ON "ConsentNotice"("key", "version");

-- CreateIndex
CREATE INDEX "ConsentRecord_userId_noticeId_idx" ON "ConsentRecord"("userId", "noticeId");

-- CreateIndex
CREATE INDEX "ConsentRecord_studentId_idx" ON "ConsentRecord"("studentId");

-- CreateIndex
CREATE UNIQUE INDEX "DataRequest_number_key" ON "DataRequest"("number");

-- CreateIndex
CREATE INDEX "DataRequest_status_dueAt_idx" ON "DataRequest"("status", "dueAt");

-- CreateIndex
CREATE INDEX "DataRequest_userId_idx" ON "DataRequest"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "BreachIncident_number_key" ON "BreachIncident"("number");

-- CreateIndex
CREATE UNIQUE INDEX "RetentionRule_dataset_key" ON "RetentionRule"("dataset");

-- CreateIndex
CREATE UNIQUE INDEX "Student_apaarId_key" ON "Student"("apaarId");

-- AddForeignKey
ALTER TABLE "NadBatch" ADD CONSTRAINT "NadBatch_termId_fkey" FOREIGN KEY ("termId") REFERENCES "AcademicTerm"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProgramExitAward" ADD CONSTRAINT "ProgramExitAward_programId_fkey" FOREIGN KEY ("programId") REFERENCES "Program"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExitRequest" ADD CONSTRAINT "ExitRequest_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExitRequest" ADD CONSTRAINT "ExitRequest_awardId_fkey" FOREIGN KEY ("awardId") REFERENCES "ProgramExitAward"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExternalCredit" ADD CONSTRAINT "ExternalCredit_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExternalCredit" ADD CONSTRAINT "ExternalCredit_mappedCourseId_fkey" FOREIGN KEY ("mappedCourseId") REFERENCES "Course"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProgramOutcome" ADD CONSTRAINT "ProgramOutcome_programId_fkey" FOREIGN KEY ("programId") REFERENCES "Program"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CoPoMapping" ADD CONSTRAINT "CoPoMapping_outcomeId_fkey" FOREIGN KEY ("outcomeId") REFERENCES "LearningOutcome"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CoPoMapping" ADD CONSTRAINT "CoPoMapping_programOutcomeId_fkey" FOREIGN KEY ("programOutcomeId") REFERENCES "ProgramOutcome"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ComponentOutcome" ADD CONSTRAINT "ComponentOutcome_componentId_fkey" FOREIGN KEY ("componentId") REFERENCES "AssessmentComponent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ComponentOutcome" ADD CONSTRAINT "ComponentOutcome_outcomeId_fkey" FOREIGN KEY ("outcomeId") REFERENCES "LearningOutcome"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConsentRecord" ADD CONSTRAINT "ConsentRecord_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConsentRecord" ADD CONSTRAINT "ConsentRecord_noticeId_fkey" FOREIGN KEY ("noticeId") REFERENCES "ConsentNotice"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DataRequest" ADD CONSTRAINT "DataRequest_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- ── Hand-written integrity rules ──
-- The consent ledger is evidence: rows are never changed or removed.
CREATE TRIGGER "ConsentRecord_immutable" BEFORE UPDATE OR DELETE ON "ConsentRecord" FOR EACH ROW EXECUTE FUNCTION examcore_forbid_mutation();

ALTER TABLE "Student" ADD CONSTRAINT "Student_apaar_format" CHECK ("apaarId" IS NULL OR "apaarId" ~ '^[0-9]{12}$');
ALTER TABLE "CoPoMapping" ADD CONSTRAINT "CoPoMapping_strength" CHECK ("strength" BETWEEN 1 AND 3);
ALTER TABLE "ProgramExitAward" ADD CONSTRAINT "ProgramExitAward_values" CHECK ("level" >= 1 AND "minCredits" >= 0 AND "minYears" >= 0 AND "reentryYears" >= 0);
ALTER TABLE "ExternalCredit" ADD CONSTRAINT "ExternalCredit_credits" CHECK ("credits" > 0 AND "credits" <= 40);
ALTER TABLE "RetentionRule" ADD CONSTRAINT "RetentionRule_days" CHECK ("retainDays" >= 1);
ALTER TABLE "BreachIncident" ADD CONSTRAINT "BreachIncident_severity" CHECK ("severity" IN ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL'));

-- At most one open exit request per student.
CREATE UNIQUE INDEX "ExitRequest_one_pending" ON "ExitRequest" ("studentId") WHERE "status" = 'PENDING';
