-- CreateEnum
CREATE TYPE "TimetableRunStatus" AS ENUM ('DRAFT', 'APPLIED', 'DISCARDED');

-- CreateEnum
CREATE TYPE "ProctoringMode" AS ENUM ('NONE', 'BASIC', 'WEBCAM');

-- CreateEnum
CREATE TYPE "SurveyKind" AS ENUM ('COURSE_EXIT', 'TEACHER_FEEDBACK', 'STUDENT_SATISFACTION', 'ALUMNI', 'EMPLOYER', 'GENERAL');

-- CreateEnum
CREATE TYPE "SurveyAudience" AS ENUM ('CLASS', 'STUDENTS', 'STAFF', 'PUBLIC_LINK');

-- CreateEnum
CREATE TYPE "SurveyStatus" AS ENUM ('DRAFT', 'OPEN', 'CLOSED');

-- AlterEnum
ALTER TYPE "LearningItemKind" ADD VALUE 'LTI';

-- AlterTable
ALTER TABLE "CourseOffering" ADD COLUMN     "weeklyLabs" INTEGER,
ADD COLUMN     "weeklyLectures" INTEGER;

-- AlterTable
ALTER TABLE "LearningItem" ADD COLUMN     "ltiLinkId" TEXT;

-- AlterTable
ALTER TABLE "Quiz" ADD COLUMN     "proctoring" "ProctoringMode" NOT NULL DEFAULT 'NONE';

-- AlterTable
ALTER TABLE "QuizAttempt" ADD COLUMN     "proctorConsentAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "TimetableRun" (
    "id" TEXT NOT NULL,
    "termId" TEXT NOT NULL,
    "departmentId" TEXT,
    "status" "TimetableRunStatus" NOT NULL DEFAULT 'DRAFT',
    "proposal" JSONB NOT NULL,
    "unplaced" JSONB NOT NULL,
    "stats" JSONB NOT NULL,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "appliedAt" TIMESTAMP(3),

    CONSTRAINT "TimetableRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CheckInWindow" (
    "id" TEXT NOT NULL,
    "meetingId" TEXT NOT NULL,
    "openedById" TEXT NOT NULL,
    "opensAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closesAt" TIMESTAMP(3) NOT NULL,
    "lateAfterMinutes" INTEGER NOT NULL DEFAULT 10,
    "requireLocation" BOOLEAN NOT NULL DEFAULT false,
    "latitude" DOUBLE PRECISION,
    "longitude" DOUBLE PRECISION,
    "radiusMeters" INTEGER,
    "secret" TEXT NOT NULL,

    CONSTRAINT "CheckInWindow_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CheckIn" (
    "id" TEXT NOT NULL,
    "windowId" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "deviceHash" TEXT NOT NULL,
    "latitude" DOUBLE PRECISION,
    "longitude" DOUBLE PRECISION,
    "accuracy" DOUBLE PRECISION,
    "distanceM" DOUBLE PRECISION,
    "late" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CheckIn_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProctorEvent" (
    "id" TEXT NOT NULL,
    "attemptId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "detail" TEXT,
    "fileId" TEXT,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProctorEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SimilarityReport" (
    "id" TEXT NOT NULL,
    "assignmentId" TEXT NOT NULL,
    "computedById" TEXT NOT NULL,
    "computedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "pairs" JSONB NOT NULL,
    "unreadable" JSONB NOT NULL,
    "threshold" DOUBLE PRECISION NOT NULL,

    CONSTRAINT "SimilarityReport_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LtiTool" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "deploymentId" TEXT NOT NULL,
    "oidcLoginUrl" TEXT NOT NULL,
    "launchUrl" TEXT NOT NULL,
    "redirectUris" TEXT[],
    "jwksUrl" TEXT NOT NULL,
    "sharePersonalData" BOOLEAN NOT NULL DEFAULT false,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LtiTool_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LtiLink" (
    "id" TEXT NOT NULL,
    "toolId" TEXT NOT NULL,
    "offeringId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "custom" JSONB NOT NULL DEFAULT '{}',
    "maxScore" DOUBLE PRECISION,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LtiLink_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LtiLaunch" (
    "id" TEXT NOT NULL,
    "linkId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "usedAt" TIMESTAMP(3),

    CONSTRAINT "LtiLaunch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LtiKey" (
    "id" TEXT NOT NULL,
    "kid" TEXT NOT NULL,
    "privateKey" TEXT NOT NULL,
    "publicJwk" JSONB NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LtiKey_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LtiToken" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "scopes" TEXT[],
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LtiToken_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LtiScore" (
    "id" TEXT NOT NULL,
    "linkId" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "scoreGiven" DOUBLE PRECISION,
    "scoreMaximum" DOUBLE PRECISION NOT NULL,
    "activityProgress" TEXT NOT NULL,
    "gradingProgress" TEXT NOT NULL,
    "comment" TEXT,
    "timestamp" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LtiScore_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Survey" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "kind" "SurveyKind" NOT NULL,
    "audience" "SurveyAudience" NOT NULL,
    "offeringId" TEXT,
    "termId" TEXT,
    "anonymous" BOOLEAN NOT NULL DEFAULT true,
    "questions" JSONB NOT NULL,
    "status" "SurveyStatus" NOT NULL DEFAULT 'DRAFT',
    "opensAt" TIMESTAMP(3) NOT NULL,
    "closesAt" TIMESTAMP(3) NOT NULL,
    "publicTokenHash" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Survey_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SurveyResponse" (
    "id" TEXT NOT NULL,
    "surveyId" TEXT NOT NULL,
    "respondentHash" TEXT NOT NULL,
    "userId" TEXT,
    "answers" JSONB NOT NULL,
    "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SurveyResponse_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TimetableRun_termId_createdAt_idx" ON "TimetableRun"("termId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "CheckInWindow_meetingId_key" ON "CheckInWindow"("meetingId");

-- CreateIndex
CREATE UNIQUE INDEX "CheckIn_windowId_studentId_key" ON "CheckIn"("windowId", "studentId");

-- CreateIndex
CREATE UNIQUE INDEX "CheckIn_windowId_deviceHash_key" ON "CheckIn"("windowId", "deviceHash");

-- CreateIndex
CREATE INDEX "ProctorEvent_attemptId_at_idx" ON "ProctorEvent"("attemptId", "at");

-- CreateIndex
CREATE INDEX "SimilarityReport_assignmentId_computedAt_idx" ON "SimilarityReport"("assignmentId", "computedAt");

-- CreateIndex
CREATE UNIQUE INDEX "LtiTool_clientId_key" ON "LtiTool"("clientId");

-- CreateIndex
CREATE INDEX "LtiLink_offeringId_idx" ON "LtiLink"("offeringId");

-- CreateIndex
CREATE INDEX "LtiLaunch_userId_createdAt_idx" ON "LtiLaunch"("userId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "LtiKey_kid_key" ON "LtiKey"("kid");

-- CreateIndex
CREATE UNIQUE INDEX "LtiToken_tokenHash_key" ON "LtiToken"("tokenHash");

-- CreateIndex
CREATE INDEX "LtiScore_linkId_studentId_timestamp_idx" ON "LtiScore"("linkId", "studentId", "timestamp");

-- CreateIndex
CREATE UNIQUE INDEX "Survey_publicTokenHash_key" ON "Survey"("publicTokenHash");

-- CreateIndex
CREATE INDEX "Survey_status_closesAt_idx" ON "Survey"("status", "closesAt");

-- CreateIndex
CREATE INDEX "Survey_offeringId_idx" ON "Survey"("offeringId");

-- CreateIndex
CREATE UNIQUE INDEX "SurveyResponse_surveyId_respondentHash_key" ON "SurveyResponse"("surveyId", "respondentHash");

-- AddForeignKey
ALTER TABLE "TimetableRun" ADD CONSTRAINT "TimetableRun_termId_fkey" FOREIGN KEY ("termId") REFERENCES "AcademicTerm"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CheckInWindow" ADD CONSTRAINT "CheckInWindow_meetingId_fkey" FOREIGN KEY ("meetingId") REFERENCES "ClassMeeting"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CheckIn" ADD CONSTRAINT "CheckIn_windowId_fkey" FOREIGN KEY ("windowId") REFERENCES "CheckInWindow"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CheckIn" ADD CONSTRAINT "CheckIn_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProctorEvent" ADD CONSTRAINT "ProctorEvent_attemptId_fkey" FOREIGN KEY ("attemptId") REFERENCES "QuizAttempt"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SimilarityReport" ADD CONSTRAINT "SimilarityReport_assignmentId_fkey" FOREIGN KEY ("assignmentId") REFERENCES "Assignment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LtiLink" ADD CONSTRAINT "LtiLink_toolId_fkey" FOREIGN KEY ("toolId") REFERENCES "LtiTool"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LtiLink" ADD CONSTRAINT "LtiLink_offeringId_fkey" FOREIGN KEY ("offeringId") REFERENCES "CourseOffering"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LtiLaunch" ADD CONSTRAINT "LtiLaunch_linkId_fkey" FOREIGN KEY ("linkId") REFERENCES "LtiLink"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LtiScore" ADD CONSTRAINT "LtiScore_linkId_fkey" FOREIGN KEY ("linkId") REFERENCES "LtiLink"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LtiScore" ADD CONSTRAINT "LtiScore_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Survey" ADD CONSTRAINT "Survey_offeringId_fkey" FOREIGN KEY ("offeringId") REFERENCES "CourseOffering"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SurveyResponse" ADD CONSTRAINT "SurveyResponse_surveyId_fkey" FOREIGN KEY ("surveyId") REFERENCES "Survey"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- ── Hand-written integrity rules ──
-- Proctoring evidence and check-ins are records of what happened: never edited.
CREATE TRIGGER "ProctorEvent_immutable" BEFORE UPDATE OR DELETE ON "ProctorEvent" FOR EACH ROW EXECUTE FUNCTION examcore_forbid_mutation();
ALTER TABLE "CheckInWindow" ADD CONSTRAINT "CheckInWindow_geo" CHECK (NOT "requireLocation" OR ("latitude" IS NOT NULL AND "longitude" IS NOT NULL AND "radiusMeters" BETWEEN 10 AND 5000));
ALTER TABLE "CheckInWindow" ADD CONSTRAINT "CheckInWindow_times" CHECK ("closesAt" > "opensAt");
ALTER TABLE "Survey" ADD CONSTRAINT "Survey_times" CHECK ("closesAt" > "opensAt");
ALTER TABLE "CourseOffering" ADD CONSTRAINT "CourseOffering_weekly_load" CHECK (("weeklyLectures" IS NULL OR "weeklyLectures" BETWEEN 0 AND 12) AND ("weeklyLabs" IS NULL OR "weeklyLabs" BETWEEN 0 AND 6));
