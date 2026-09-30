-- CreateEnum
CREATE TYPE "ExamRegStatus" AS ENUM ('ELIGIBLE', 'NOT_ELIGIBLE', 'CONDONATION_PENDING', 'REGISTERED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ExamFeeStatus" AS ENUM ('NOT_REQUIRED', 'PENDING', 'PAID', 'WAIVED');

-- CreateEnum
CREATE TYPE "SeatRole" AS ENUM ('CHIEF_SUPERINTENDENT', 'INVIGILATOR', 'RELIEVER');

-- CreateEnum
CREATE TYPE "AssessmentKind" AS ENUM ('INTERNAL', 'EXTERNAL', 'PRACTICAL', 'VIVA', 'PROJECT');

-- CreateEnum
CREATE TYPE "MarkSheetStatus" AS ENUM ('DRAFT', 'SUBMITTED', 'VERIFIED', 'APPROVED', 'RETURNED');

-- CreateEnum
CREATE TYPE "MarkStatus" AS ENUM ('PRESENT', 'ABSENT', 'MALPRACTICE', 'EXEMPT');

-- CreateEnum
CREATE TYPE "ScriptStatus" AS ENUM ('PENDING', 'IN_VALUATION', 'VALUED', 'THIRD_VALUATION', 'FINAL');

-- CreateEnum
CREATE TYPE "GradingStatus" AS ENUM ('DRAFT', 'ACTIVE', 'RETIRED');

-- CreateEnum
CREATE TYPE "ResultRunStatus" AS ENUM ('DRAFT', 'COMPUTED', 'IN_APPROVAL', 'APPROVED', 'PUBLISHED');

-- CreateEnum
CREATE TYPE "CourseResultStatus" AS ENUM ('PASS', 'FAIL', 'ABSENT', 'WITHHELD', 'INCOMPLETE');

-- CreateEnum
CREATE TYPE "RevaluationType" AS ENUM ('RETOTALLING', 'REVALUATION');

-- CreateEnum
CREATE TYPE "RevaluationStatus" AS ENUM ('REQUESTED', 'FEE_PENDING', 'IN_PROGRESS', 'COMPLETED', 'REJECTED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "CredentialType" AS ENUM ('TRANSCRIPT', 'MARKSHEET', 'PROVISIONAL_CERTIFICATE', 'DEGREE_CERTIFICATE', 'MIGRATION_CERTIFICATE', 'BONAFIDE_CERTIFICATE', 'COURSE_COMPLETION', 'RANK_CERTIFICATE', 'TRANSFER_CERTIFICATE');

-- CreateEnum
CREATE TYPE "CredentialStatus" AS ENUM ('ISSUED', 'REVOKED', 'SUPERSEDED');

-- AlterTable
ALTER TABLE "ExaminationSession" ADD COLUMN     "revaluationUntil" TIMESTAMP(3),
ADD COLUMN     "termId" TEXT;

-- AlterTable
ALTER TABLE "Regulation" ADD COLUMN     "gradingSchemeId" TEXT;

-- CreateTable
CREATE TABLE "ExamRegistration" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "examinationId" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "attemptType" "AttemptType" NOT NULL DEFAULT 'REGULAR',
    "status" "ExamRegStatus" NOT NULL,
    "reasons" TEXT[],
    "attendancePct" DOUBLE PRECISION,
    "feeStatus" "ExamFeeStatus" NOT NULL DEFAULT 'NOT_REQUIRED',
    "hallTicketNo" TEXT,
    "dummyNo" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ExamRegistration_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExamSeat" (
    "id" TEXT NOT NULL,
    "registrationId" TEXT NOT NULL,
    "roomId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "slot" "ExamSlot" NOT NULL,
    "seatNo" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ExamSeat_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InvigilationDuty" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "roomId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "slot" "ExamSlot" NOT NULL,
    "role" "SeatRole" NOT NULL DEFAULT 'INVIGILATOR',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InvigilationDuty_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AssessmentComponent" (
    "id" TEXT NOT NULL,
    "offeringId" TEXT NOT NULL,
    "examinationId" TEXT,
    "name" TEXT NOT NULL,
    "kind" "AssessmentKind" NOT NULL,
    "maxMarks" DOUBLE PRECISION NOT NULL,
    "weight" DOUBLE PRECISION NOT NULL,
    "order" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AssessmentComponent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MarkSheet" (
    "id" TEXT NOT NULL,
    "componentId" TEXT NOT NULL,
    "status" "MarkSheetStatus" NOT NULL DEFAULT 'DRAFT',
    "submittedAt" TIMESTAMP(3),
    "submittedById" TEXT,
    "approvedAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MarkSheet_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Mark" (
    "id" TEXT NOT NULL,
    "componentId" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "marks" DOUBLE PRECISION,
    "status" "MarkStatus" NOT NULL DEFAULT 'PRESENT',
    "enteredById" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Mark_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MarkRevision" (
    "id" TEXT NOT NULL,
    "markId" TEXT NOT NULL,
    "oldMarks" DOUBLE PRECISION,
    "newMarks" DOUBLE PRECISION,
    "oldStatus" "MarkStatus" NOT NULL,
    "newStatus" "MarkStatus" NOT NULL,
    "reason" TEXT NOT NULL,
    "changedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MarkRevision_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AnswerScript" (
    "id" TEXT NOT NULL,
    "registrationId" TEXT NOT NULL,
    "examinationId" TEXT NOT NULL,
    "status" "ScriptStatus" NOT NULL DEFAULT 'PENDING',
    "finalMarks" DOUBLE PRECISION,
    "finalizedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AnswerScript_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ScriptValuation" (
    "id" TEXT NOT NULL,
    "scriptId" TEXT NOT NULL,
    "round" INTEGER NOT NULL,
    "valuerId" TEXT NOT NULL,
    "marks" DOUBLE PRECISION,
    "remarks" TEXT,
    "assignedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "submittedAt" TIMESTAMP(3),

    CONSTRAINT "ScriptValuation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GradingScheme" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "status" "GradingStatus" NOT NULL DEFAULT 'DRAFT',
    "bands" JSONB NOT NULL,
    "passPercent" DOUBLE PRECISION NOT NULL,
    "minExternalPercent" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "minInternalPercent" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "absentGrade" TEXT NOT NULL DEFAULT 'AB',
    "failGrade" TEXT NOT NULL DEFAULT 'RA',
    "withheldGrade" TEXT NOT NULL DEFAULT 'WH',
    "graceMaxPerCourse" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "graceMaxTotal" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "gpaDecimals" INTEGER NOT NULL DEFAULT 2,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GradingScheme_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ResultRun" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "programId" TEXT,
    "termId" TEXT NOT NULL,
    "gradingSchemeId" TEXT NOT NULL,
    "status" "ResultRunStatus" NOT NULL DEFAULT 'DRAFT',
    "stats" JSONB,
    "computedAt" TIMESTAMP(3),
    "computedById" TEXT,
    "publishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ResultRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CourseResult" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "courseId" TEXT NOT NULL,
    "termId" TEXT NOT NULL,
    "attempt" INTEGER NOT NULL DEFAULT 1,
    "attemptType" "AttemptType" NOT NULL DEFAULT 'REGULAR',
    "version" INTEGER NOT NULL DEFAULT 1,
    "isCurrent" BOOLEAN NOT NULL DEFAULT true,
    "internalMarks" DOUBLE PRECISION,
    "externalMarks" DOUBLE PRECISION,
    "graceMarks" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "totalMarks" DOUBLE PRECISION,
    "maxMarks" DOUBLE PRECISION NOT NULL,
    "percent" DOUBLE PRECISION,
    "grade" TEXT NOT NULL,
    "gradePoint" DOUBLE PRECISION NOT NULL,
    "credits" DOUBLE PRECISION NOT NULL,
    "creditPoints" DOUBLE PRECISION NOT NULL,
    "status" "CourseResultStatus" NOT NULL,
    "withheldReason" TEXT,
    "revisionReason" TEXT,
    "publishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CourseResult_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TermResult" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "termId" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "isCurrent" BOOLEAN NOT NULL DEFAULT true,
    "creditsRegistered" DOUBLE PRECISION NOT NULL,
    "creditsEarned" DOUBLE PRECISION NOT NULL,
    "creditPoints" DOUBLE PRECISION NOT NULL,
    "sgpa" DOUBLE PRECISION,
    "cgpa" DOUBLE PRECISION,
    "cumulativeCredits" DOUBLE PRECISION NOT NULL,
    "status" TEXT NOT NULL,
    "publishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TermResult_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RevaluationRequest" (
    "id" TEXT NOT NULL,
    "courseResultId" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "type" "RevaluationType" NOT NULL,
    "status" "RevaluationStatus" NOT NULL DEFAULT 'REQUESTED',
    "fee" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "originalMarks" DOUBLE PRECISION,
    "revisedMarks" DOUBLE PRECISION,
    "outcome" TEXT,
    "remarks" TEXT,
    "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "decidedById" TEXT,

    CONSTRAINT "RevaluationRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IssuedCredential" (
    "id" TEXT NOT NULL,
    "type" "CredentialType" NOT NULL,
    "serialNo" TEXT NOT NULL,
    "verificationCode" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "contentHash" TEXT NOT NULL,
    "seal" TEXT NOT NULL,
    "status" "CredentialStatus" NOT NULL DEFAULT 'ISSUED',
    "issuedById" TEXT,
    "issuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" TIMESTAMP(3),
    "revokeReason" TEXT,
    "supersededById" TEXT,

    CONSTRAINT "IssuedCredential_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ExamRegistration_hallTicketNo_key" ON "ExamRegistration"("hallTicketNo");

-- CreateIndex
CREATE UNIQUE INDEX "ExamRegistration_dummyNo_key" ON "ExamRegistration"("dummyNo");

-- CreateIndex
CREATE INDEX "ExamRegistration_sessionId_studentId_idx" ON "ExamRegistration"("sessionId", "studentId");

-- CreateIndex
CREATE INDEX "ExamRegistration_status_idx" ON "ExamRegistration"("status");

-- CreateIndex
CREATE UNIQUE INDEX "ExamRegistration_examinationId_studentId_key" ON "ExamRegistration"("examinationId", "studentId");

-- CreateIndex
CREATE UNIQUE INDEX "ExamSeat_registrationId_key" ON "ExamSeat"("registrationId");

-- CreateIndex
CREATE INDEX "ExamSeat_date_slot_idx" ON "ExamSeat"("date", "slot");

-- CreateIndex
CREATE UNIQUE INDEX "ExamSeat_roomId_date_slot_seatNo_key" ON "ExamSeat"("roomId", "date", "slot", "seatNo");

-- CreateIndex
CREATE INDEX "InvigilationDuty_sessionId_date_slot_idx" ON "InvigilationDuty"("sessionId", "date", "slot");

-- CreateIndex
CREATE UNIQUE INDEX "InvigilationDuty_userId_date_slot_key" ON "InvigilationDuty"("userId", "date", "slot");

-- CreateIndex
CREATE UNIQUE INDEX "AssessmentComponent_offeringId_name_key" ON "AssessmentComponent"("offeringId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "MarkSheet_componentId_key" ON "MarkSheet"("componentId");

-- CreateIndex
CREATE UNIQUE INDEX "Mark_componentId_studentId_key" ON "Mark"("componentId", "studentId");

-- CreateIndex
CREATE INDEX "MarkRevision_markId_idx" ON "MarkRevision"("markId");

-- CreateIndex
CREATE UNIQUE INDEX "AnswerScript_registrationId_key" ON "AnswerScript"("registrationId");

-- CreateIndex
CREATE INDEX "AnswerScript_examinationId_status_idx" ON "AnswerScript"("examinationId", "status");

-- CreateIndex
CREATE INDEX "ScriptValuation_valuerId_submittedAt_idx" ON "ScriptValuation"("valuerId", "submittedAt");

-- CreateIndex
CREATE UNIQUE INDEX "ScriptValuation_scriptId_round_key" ON "ScriptValuation"("scriptId", "round");

-- CreateIndex
CREATE UNIQUE INDEX "GradingScheme_code_version_key" ON "GradingScheme"("code", "version");

-- CreateIndex
CREATE INDEX "ResultRun_sessionId_idx" ON "ResultRun"("sessionId");

-- CreateIndex
CREATE INDEX "CourseResult_studentId_isCurrent_idx" ON "CourseResult"("studentId", "isCurrent");

-- CreateIndex
CREATE INDEX "CourseResult_runId_idx" ON "CourseResult"("runId");

-- CreateIndex
CREATE INDEX "CourseResult_courseId_termId_idx" ON "CourseResult"("courseId", "termId");

-- CreateIndex
CREATE INDEX "TermResult_studentId_isCurrent_idx" ON "TermResult"("studentId", "isCurrent");

-- CreateIndex
CREATE INDEX "TermResult_runId_idx" ON "TermResult"("runId");

-- CreateIndex
CREATE INDEX "RevaluationRequest_studentId_idx" ON "RevaluationRequest"("studentId");

-- CreateIndex
CREATE INDEX "RevaluationRequest_status_idx" ON "RevaluationRequest"("status");

-- CreateIndex
CREATE UNIQUE INDEX "IssuedCredential_serialNo_key" ON "IssuedCredential"("serialNo");

-- CreateIndex
CREATE UNIQUE INDEX "IssuedCredential_verificationCode_key" ON "IssuedCredential"("verificationCode");

-- CreateIndex
CREATE INDEX "IssuedCredential_studentId_type_idx" ON "IssuedCredential"("studentId", "type");

-- AddForeignKey
ALTER TABLE "Regulation" ADD CONSTRAINT "Regulation_gradingSchemeId_fkey" FOREIGN KEY ("gradingSchemeId") REFERENCES "GradingScheme"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExaminationSession" ADD CONSTRAINT "ExaminationSession_termId_fkey" FOREIGN KEY ("termId") REFERENCES "AcademicTerm"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExamRegistration" ADD CONSTRAINT "ExamRegistration_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "ExaminationSession"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExamRegistration" ADD CONSTRAINT "ExamRegistration_examinationId_fkey" FOREIGN KEY ("examinationId") REFERENCES "Examination"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExamRegistration" ADD CONSTRAINT "ExamRegistration_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExamSeat" ADD CONSTRAINT "ExamSeat_registrationId_fkey" FOREIGN KEY ("registrationId") REFERENCES "ExamRegistration"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExamSeat" ADD CONSTRAINT "ExamSeat_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "Room"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InvigilationDuty" ADD CONSTRAINT "InvigilationDuty_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "ExaminationSession"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InvigilationDuty" ADD CONSTRAINT "InvigilationDuty_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "Room"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InvigilationDuty" ADD CONSTRAINT "InvigilationDuty_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssessmentComponent" ADD CONSTRAINT "AssessmentComponent_offeringId_fkey" FOREIGN KEY ("offeringId") REFERENCES "CourseOffering"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssessmentComponent" ADD CONSTRAINT "AssessmentComponent_examinationId_fkey" FOREIGN KEY ("examinationId") REFERENCES "Examination"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarkSheet" ADD CONSTRAINT "MarkSheet_componentId_fkey" FOREIGN KEY ("componentId") REFERENCES "AssessmentComponent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Mark" ADD CONSTRAINT "Mark_componentId_fkey" FOREIGN KEY ("componentId") REFERENCES "AssessmentComponent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Mark" ADD CONSTRAINT "Mark_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarkRevision" ADD CONSTRAINT "MarkRevision_markId_fkey" FOREIGN KEY ("markId") REFERENCES "Mark"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AnswerScript" ADD CONSTRAINT "AnswerScript_registrationId_fkey" FOREIGN KEY ("registrationId") REFERENCES "ExamRegistration"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AnswerScript" ADD CONSTRAINT "AnswerScript_examinationId_fkey" FOREIGN KEY ("examinationId") REFERENCES "Examination"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScriptValuation" ADD CONSTRAINT "ScriptValuation_scriptId_fkey" FOREIGN KEY ("scriptId") REFERENCES "AnswerScript"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScriptValuation" ADD CONSTRAINT "ScriptValuation_valuerId_fkey" FOREIGN KEY ("valuerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ResultRun" ADD CONSTRAINT "ResultRun_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "ExaminationSession"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ResultRun" ADD CONSTRAINT "ResultRun_programId_fkey" FOREIGN KEY ("programId") REFERENCES "Program"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ResultRun" ADD CONSTRAINT "ResultRun_termId_fkey" FOREIGN KEY ("termId") REFERENCES "AcademicTerm"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ResultRun" ADD CONSTRAINT "ResultRun_gradingSchemeId_fkey" FOREIGN KEY ("gradingSchemeId") REFERENCES "GradingScheme"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CourseResult" ADD CONSTRAINT "CourseResult_runId_fkey" FOREIGN KEY ("runId") REFERENCES "ResultRun"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CourseResult" ADD CONSTRAINT "CourseResult_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CourseResult" ADD CONSTRAINT "CourseResult_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "Course"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TermResult" ADD CONSTRAINT "TermResult_runId_fkey" FOREIGN KEY ("runId") REFERENCES "ResultRun"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TermResult" ADD CONSTRAINT "TermResult_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RevaluationRequest" ADD CONSTRAINT "RevaluationRequest_courseResultId_fkey" FOREIGN KEY ("courseResultId") REFERENCES "CourseResult"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RevaluationRequest" ADD CONSTRAINT "RevaluationRequest_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IssuedCredential" ADD CONSTRAINT "IssuedCredential_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- ── Hand-written integrity rules ─────────────────────────────────────
ALTER TABLE "AssessmentComponent" ADD CONSTRAINT "AssessmentComponent_marks" CHECK ("maxMarks" > 0 AND "weight" >= 0);
ALTER TABLE "Mark" ADD CONSTRAINT "Mark_nonnegative" CHECK ("marks" IS NULL OR "marks" >= 0);
ALTER TABLE "ScriptValuation" ADD CONSTRAINT "ScriptValuation_nonnegative" CHECK ("marks" IS NULL OR "marks" >= 0);
ALTER TABLE "ExamSeat" ADD CONSTRAINT "ExamSeat_seat" CHECK ("seatNo" > 0);
ALTER TABLE "GradingScheme" ADD CONSTRAINT "GradingScheme_limits" CHECK ("passPercent" BETWEEN 0 AND 100 AND "minExternalPercent" BETWEEN 0 AND 100 AND "minInternalPercent" BETWEEN 0 AND 100 AND "graceMaxPerCourse" >= 0 AND "graceMaxTotal" >= 0);
ALTER TABLE "CourseResult" ADD CONSTRAINT "CourseResult_values" CHECK ("maxMarks" > 0 AND "graceMarks" >= 0 AND "credits" >= 0 AND ("totalMarks" IS NULL OR "totalMarks" >= 0));
-- At most one current version of a student's result per course attempt and per term.
CREATE UNIQUE INDEX "CourseResult_one_current" ON "CourseResult" ("studentId", "courseId", "termId", "attempt") WHERE "isCurrent";
CREATE UNIQUE INDEX "TermResult_one_current" ON "TermResult" ("studentId", "termId") WHERE "isCurrent";

-- Mark revisions are append-only.
CREATE TRIGGER "MarkRevision_immutable" BEFORE UPDATE OR DELETE ON "MarkRevision"
  FOR EACH ROW EXECUTE FUNCTION examcore_forbid_mutation();

-- Published results are never edited or deleted. Only the "current version" pointer may move when a
-- revision supersedes them. Revisions are new rows.
CREATE OR REPLACE FUNCTION examcore_protect_published_result() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD."publishedAt" IS NOT NULL THEN
      RAISE EXCEPTION 'EXAMCORE: Published results cannot be deleted.';
    END IF;
    RETURN OLD;
  END IF;
  IF OLD."publishedAt" IS NOT NULL AND (
       (to_jsonb(NEW) - 'isCurrent') IS DISTINCT FROM (to_jsonb(OLD) - 'isCurrent')
     ) THEN
    RAISE EXCEPTION 'EXAMCORE: Published results cannot be changed; record a revision instead.';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "CourseResult_published_guard" BEFORE UPDATE OR DELETE ON "CourseResult"
  FOR EACH ROW EXECUTE FUNCTION examcore_protect_published_result();
CREATE TRIGGER "TermResult_published_guard" BEFORE UPDATE OR DELETE ON "TermResult"
  FOR EACH ROW EXECUTE FUNCTION examcore_protect_published_result();

-- Issued credentials: the snapshot, hash and seal are immutable; only status/revocation fields may change.
CREATE OR REPLACE FUNCTION examcore_protect_credential() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'EXAMCORE: Issued credentials cannot be deleted; revoke them instead.';
  END IF;
  IF NEW."payload" IS DISTINCT FROM OLD."payload" OR NEW."contentHash" <> OLD."contentHash" OR NEW."seal" <> OLD."seal"
     OR NEW."serialNo" <> OLD."serialNo" OR NEW."verificationCode" <> OLD."verificationCode" OR NEW."studentId" <> OLD."studentId" THEN
    RAISE EXCEPTION 'EXAMCORE: The content of an issued credential cannot be changed.';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "IssuedCredential_guard" BEFORE UPDATE OR DELETE ON "IssuedCredential"
  FOR EACH ROW EXECUTE FUNCTION examcore_protect_credential();
