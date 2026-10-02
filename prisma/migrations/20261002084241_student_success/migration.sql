-- CreateEnum
CREATE TYPE "RiskLevel" AS ENUM ('LOW', 'MEDIUM', 'HIGH');

-- CreateEnum
CREATE TYPE "CaseSource" AS ENUM ('SYSTEM', 'STAFF', 'SELF');

-- CreateEnum
CREATE TYPE "CaseStatus" AS ENUM ('OPEN', 'IN_PROGRESS', 'RESOLVED', 'CLOSED');

-- CreateEnum
CREATE TYPE "CaseNoteKind" AS ENUM ('NOTE', 'CONTACT', 'REFERRAL', 'STATUS');

-- CreateEnum
CREATE TYPE "MeetingMode" AS ENUM ('IN_PERSON', 'ONLINE', 'PHONE');

-- AlterTable
ALTER TABLE "QuizQuestion" ADD COLUMN     "outcomeId" TEXT;

-- CreateTable
CREATE TABLE "StudentRisk" (
    "id" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "termId" TEXT NOT NULL,
    "score" DOUBLE PRECISION NOT NULL,
    "level" "RiskLevel" NOT NULL,
    "factors" JSONB NOT NULL,
    "computedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StudentRisk_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SupportCase" (
    "id" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "source" "CaseSource" NOT NULL,
    "raisedById" TEXT,
    "level" "RiskLevel" NOT NULL,
    "summary" TEXT NOT NULL,
    "reasons" JSONB NOT NULL,
    "status" "CaseStatus" NOT NULL DEFAULT 'OPEN',
    "assigneeId" TEXT,
    "dueAt" TIMESTAMP(3) NOT NULL,
    "resolution" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "closedAt" TIMESTAMP(3),

    CONSTRAINT "SupportCase_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CaseNote" (
    "id" TEXT NOT NULL,
    "caseId" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "kind" "CaseNoteKind" NOT NULL DEFAULT 'NOTE',
    "body" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CaseNote_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MentorAssignment" (
    "id" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "mentorId" TEXT NOT NULL,
    "startsOn" DATE NOT NULL,
    "endsOn" DATE,
    "assignedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MentorAssignment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MentorMeeting" (
    "id" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "mentorId" TEXT NOT NULL,
    "heldOn" TIMESTAMP(3) NOT NULL,
    "mode" "MeetingMode" NOT NULL DEFAULT 'IN_PERSON',
    "summary" TEXT NOT NULL,
    "actionItems" JSONB NOT NULL DEFAULT '[]',
    "privateNotes" TEXT,
    "followUpOn" DATE,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MentorMeeting_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "KnowledgeArticle" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "audience" "NoticeAudience" NOT NULL DEFAULT 'ALL',
    "tags" TEXT[],
    "published" BOOLEAN NOT NULL DEFAULT false,
    "updatedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "KnowledgeArticle_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PlanEntry" (
    "id" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "courseId" TEXT NOT NULL,
    "semester" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PlanEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LearningItemOutcome" (
    "itemId" TEXT NOT NULL,
    "outcomeId" TEXT NOT NULL,

    CONSTRAINT "LearningItemOutcome_pkey" PRIMARY KEY ("itemId","outcomeId")
);

-- CreateIndex
CREATE INDEX "StudentRisk_termId_level_idx" ON "StudentRisk"("termId", "level");

-- CreateIndex
CREATE UNIQUE INDEX "StudentRisk_studentId_termId_key" ON "StudentRisk"("studentId", "termId");

-- CreateIndex
CREATE UNIQUE INDEX "SupportCase_number_key" ON "SupportCase"("number");

-- CreateIndex
CREATE INDEX "SupportCase_status_dueAt_idx" ON "SupportCase"("status", "dueAt");

-- CreateIndex
CREATE INDEX "SupportCase_studentId_idx" ON "SupportCase"("studentId");

-- CreateIndex
CREATE INDEX "SupportCase_assigneeId_status_idx" ON "SupportCase"("assigneeId", "status");

-- CreateIndex
CREATE INDEX "CaseNote_caseId_createdAt_idx" ON "CaseNote"("caseId", "createdAt");

-- CreateIndex
CREATE INDEX "MentorAssignment_mentorId_endsOn_idx" ON "MentorAssignment"("mentorId", "endsOn");

-- CreateIndex
CREATE INDEX "MentorAssignment_studentId_idx" ON "MentorAssignment"("studentId");

-- CreateIndex
CREATE INDEX "MentorMeeting_studentId_heldOn_idx" ON "MentorMeeting"("studentId", "heldOn");

-- CreateIndex
CREATE INDEX "MentorMeeting_mentorId_heldOn_idx" ON "MentorMeeting"("mentorId", "heldOn");

-- CreateIndex
CREATE UNIQUE INDEX "KnowledgeArticle_slug_key" ON "KnowledgeArticle"("slug");

-- CreateIndex
CREATE INDEX "KnowledgeArticle_published_category_idx" ON "KnowledgeArticle"("published", "category");

-- CreateIndex
CREATE INDEX "KnowledgeArticle_title_trgm_idx" ON "KnowledgeArticle" USING GIN ("title" gin_trgm_ops);

-- CreateIndex
CREATE UNIQUE INDEX "PlanEntry_studentId_courseId_key" ON "PlanEntry"("studentId", "courseId");

-- AddForeignKey
ALTER TABLE "QuizQuestion" ADD CONSTRAINT "QuizQuestion_outcomeId_fkey" FOREIGN KEY ("outcomeId") REFERENCES "LearningOutcome"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StudentRisk" ADD CONSTRAINT "StudentRisk_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StudentRisk" ADD CONSTRAINT "StudentRisk_termId_fkey" FOREIGN KEY ("termId") REFERENCES "AcademicTerm"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupportCase" ADD CONSTRAINT "SupportCase_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupportCase" ADD CONSTRAINT "SupportCase_raisedById_fkey" FOREIGN KEY ("raisedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupportCase" ADD CONSTRAINT "SupportCase_assigneeId_fkey" FOREIGN KEY ("assigneeId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CaseNote" ADD CONSTRAINT "CaseNote_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "SupportCase"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CaseNote" ADD CONSTRAINT "CaseNote_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MentorAssignment" ADD CONSTRAINT "MentorAssignment_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MentorAssignment" ADD CONSTRAINT "MentorAssignment_mentorId_fkey" FOREIGN KEY ("mentorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MentorMeeting" ADD CONSTRAINT "MentorMeeting_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MentorMeeting" ADD CONSTRAINT "MentorMeeting_mentorId_fkey" FOREIGN KEY ("mentorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlanEntry" ADD CONSTRAINT "PlanEntry_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlanEntry" ADD CONSTRAINT "PlanEntry_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "Course"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LearningItemOutcome" ADD CONSTRAINT "LearningItemOutcome_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "LearningItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LearningItemOutcome" ADD CONSTRAINT "LearningItemOutcome_outcomeId_fkey" FOREIGN KEY ("outcomeId") REFERENCES "LearningOutcome"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- ── Hand-written integrity rules ──
CREATE TRIGGER "CaseNote_immutable" BEFORE UPDATE OR DELETE ON "CaseNote" FOR EACH ROW EXECUTE FUNCTION examcore_forbid_mutation();
-- One current mentor per student.
CREATE UNIQUE INDEX "MentorAssignment_one_active" ON "MentorAssignment" ("studentId") WHERE "endsOn" IS NULL;
-- One open support case per student at a time.
CREATE UNIQUE INDEX "SupportCase_one_open" ON "SupportCase" ("studentId") WHERE "status" IN ('OPEN', 'IN_PROGRESS');
ALTER TABLE "StudentRisk" ADD CONSTRAINT "StudentRisk_score" CHECK ("score" >= 0 AND "score" <= 100);
ALTER TABLE "PlanEntry" ADD CONSTRAINT "PlanEntry_semester" CHECK ("semester" BETWEEN 1 AND 16);
ALTER TABLE "MentorAssignment" ADD CONSTRAINT "MentorAssignment_dates" CHECK ("endsOn" IS NULL OR "endsOn" >= "startsOn");
