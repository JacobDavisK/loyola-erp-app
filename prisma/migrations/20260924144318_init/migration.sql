CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- CreateEnum
CREATE TYPE "UserStatus" AS ENUM ('ACTIVE', 'SUSPENDED', 'INVITED');

-- CreateEnum
CREATE TYPE "TermType" AS ENUM ('ODD', 'EVEN');

-- CreateEnum
CREATE TYPE "ProgramLevel" AS ENUM ('UG', 'PG', 'DIPLOMA', 'DOCTORAL');

-- CreateEnum
CREATE TYPE "CourseType" AS ENUM ('CORE', 'ELECTIVE', 'ALLIED', 'SKILL_ENHANCEMENT', 'ABILITY_ENHANCEMENT', 'PROJECT');

-- CreateEnum
CREATE TYPE "CourseMode" AS ENUM ('THEORY', 'PRACTICAL', 'THEORY_PRACTICAL');

-- CreateEnum
CREATE TYPE "ExamType" AS ENUM ('REGULAR', 'SUPPLEMENTARY', 'REVALUATION', 'IMPROVEMENT', 'BACKLOG', 'SPECIAL');

-- CreateEnum
CREATE TYPE "SessionStatus" AS ENUM ('PLANNING', 'OPEN', 'PAPER_SETTING', 'MODERATION', 'SCRUTINY', 'APPROVAL', 'LOCKED', 'PUBLISHED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "ExamSlot" AS ENUM ('FN', 'AN');

-- CreateEnum
CREATE TYPE "QuestionType" AS ENUM ('MCQ', 'TRUE_FALSE', 'FILL_BLANK', 'VERY_SHORT', 'SHORT', 'DESCRIPTIVE', 'ESSAY', 'CASE_STUDY', 'PROBLEM', 'NUMERICAL', 'ASSERTION_REASON', 'MATCH');

-- CreateEnum
CREATE TYPE "Difficulty" AS ENUM ('EASY', 'MODERATE', 'HARD');

-- CreateEnum
CREATE TYPE "BloomLevel" AS ENUM ('REMEMBER', 'UNDERSTAND', 'APPLY', 'ANALYZE', 'EVALUATE', 'CREATE');

-- CreateEnum
CREATE TYPE "QuestionStatus" AS ENUM ('DRAFT', 'PENDING_REVIEW', 'ACTIVE', 'RETIRED');

-- CreateEnum
CREATE TYPE "BlueprintDimension" AS ENUM ('DIFFICULTY', 'BLOOM', 'UNIT', 'OUTCOME', 'QUESTION_TYPE');

-- CreateEnum
CREATE TYPE "PaperStatus" AS ENUM ('DRAFT', 'SUBMITTED', 'UNDER_MODERATION', 'REVISION_REQUIRED', 'RESUBMITTED', 'UNDER_SCRUTINY', 'AWAITING_APPROVAL', 'APPROVED', 'LOCKED', 'RELEASED', 'ARCHIVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "AssignmentStatus" AS ENUM ('ASSIGNED', 'ACCEPTED', 'DECLINED', 'IN_PROGRESS', 'SUBMITTED', 'RETURNED', 'RESUBMITTED', 'APPROVED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ModerationStatus" AS ENUM ('PENDING', 'IN_REVIEW', 'CHANGES_REQUESTED', 'APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "ModerationCommentKind" AS ENUM ('COMMENT', 'ISSUE', 'SUGGEST_REPLACEMENT', 'REPLACED');

-- CreateEnum
CREATE TYPE "ScrutinyStatus" AS ENUM ('PENDING', 'IN_PROGRESS', 'PASSED', 'RETURNED');

-- CreateEnum
CREATE TYPE "ApprovalDecision" AS ENUM ('APPROVED', 'RETURNED', 'REJECTED');

-- CreateEnum
CREATE TYPE "FileKind" AS ENUM ('QUESTION_IMAGE', 'LOGO', 'AVATAR', 'EXPORT', 'PACKAGE', 'OTHER');

-- CreateEnum
CREATE TYPE "TemplateKind" AS ENUM ('PAPER', 'INSTRUCTIONS', 'HEADER', 'FOOTER');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "designation" TEXT,
    "phone" TEXT,
    "passwordHash" TEXT NOT NULL,
    "status" "UserStatus" NOT NULL DEFAULT 'ACTIVE',
    "departmentId" TEXT,
    "avatarAssetId" TEXT,
    "failedLoginCount" INTEGER NOT NULL DEFAULT 0,
    "lockedUntil" TIMESTAMP(3),
    "lastLoginAt" TIMESTAMP(3),
    "passwordChangedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "mustChangePassword" BOOLEAN NOT NULL DEFAULT false,
    "mfaEnabled" BOOLEAN NOT NULL DEFAULT false,
    "mfaSecretEnc" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Role" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "isSystem" BOOLEAN NOT NULL DEFAULT false,
    "rank" INTEGER NOT NULL DEFAULT 100,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Role_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Permission" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "module" TEXT NOT NULL,
    "description" TEXT NOT NULL,

    CONSTRAINT "Permission_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RolePermission" (
    "roleId" TEXT NOT NULL,
    "permissionId" TEXT NOT NULL,

    CONSTRAINT "RolePermission_pkey" PRIMARY KEY ("roleId","permissionId")
);

-- CreateTable
CREATE TABLE "UserRole" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "roleId" TEXT NOT NULL,
    "departmentId" TEXT,
    "grantedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UserRole_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ip" TEXT,
    "userAgent" TEXT,
    "deviceLabel" TEXT,
    "remember" BOOLEAN NOT NULL DEFAULT false,
    "mfaPending" BOOLEAN NOT NULL DEFAULT false,
    "revokedAt" TIMESTAMP(3),

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LoginAttempt" (
    "id" TEXT NOT NULL,
    "identifier" TEXT NOT NULL,
    "ip" TEXT,
    "userAgent" TEXT,
    "success" BOOLEAN NOT NULL,
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LoginAttempt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PasswordResetToken" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PasswordResetToken_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Institution" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "shortName" TEXT NOT NULL,
    "tagline" TEXT,
    "address" TEXT,
    "phone" TEXT,
    "email" TEXT,
    "website" TEXT,
    "logoAssetId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Institution_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Department" (
    "id" TEXT NOT NULL,
    "institutionId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "Department_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Program" (
    "id" TEXT NOT NULL,
    "departmentId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "level" "ProgramLevel" NOT NULL,
    "durationYears" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "Program_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Regulation" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "effectiveFromYear" INTEGER NOT NULL,
    "description" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Regulation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AcademicYear" (
    "id" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "startDate" TIMESTAMP(3) NOT NULL,
    "endDate" TIMESTAMP(3) NOT NULL,
    "isCurrent" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AcademicYear_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Semester" (
    "id" TEXT NOT NULL,
    "number" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "termType" "TermType" NOT NULL,

    CONSTRAINT "Semester_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Course" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "credits" INTEGER NOT NULL,
    "departmentId" TEXT NOT NULL,
    "programId" TEXT NOT NULL,
    "semesterId" TEXT NOT NULL,
    "regulationId" TEXT NOT NULL,
    "courseType" "CourseType" NOT NULL,
    "mode" "CourseMode" NOT NULL DEFAULT 'THEORY',
    "maxMarks" INTEGER NOT NULL,
    "internalMarks" INTEGER NOT NULL,
    "externalMarks" INTEGER NOT NULL,
    "durationMinutes" INTEGER NOT NULL,
    "syllabus" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "Course_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CourseUnit" (
    "id" TEXT NOT NULL,
    "courseId" TEXT NOT NULL,
    "number" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "hours" INTEGER,
    "description" TEXT,

    CONSTRAINT "CourseUnit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CourseTopic" (
    "id" TEXT NOT NULL,
    "unitId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "order" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "CourseTopic_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LearningOutcome" (
    "id" TEXT NOT NULL,
    "courseId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "bloom" "BloomLevel",

    CONSTRAINT "LearningOutcome_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExaminationSession" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "academicYearId" TEXT NOT NULL,
    "termType" "TermType" NOT NULL,
    "examType" "ExamType" NOT NULL DEFAULT 'REGULAR',
    "status" "SessionStatus" NOT NULL DEFAULT 'PLANNING',
    "startDate" TIMESTAMP(3) NOT NULL,
    "endDate" TIMESTAMP(3) NOT NULL,
    "settingDeadline" TIMESTAMP(3),
    "moderationDeadline" TIMESTAMP(3),
    "scrutinyDeadline" TIMESTAMP(3),
    "approvalDeadline" TIMESTAMP(3),
    "description" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ExaminationSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Examination" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "courseId" TEXT NOT NULL,
    "blueprintId" TEXT,
    "templateId" TEXT,
    "moderatorId" TEXT,
    "scrutinizerId" TEXT,
    "maxMarks" INTEGER NOT NULL,
    "durationMinutes" INTEGER NOT NULL,
    "isLocked" BOOLEAN NOT NULL DEFAULT false,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Examination_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExamSchedule" (
    "id" TEXT NOT NULL,
    "examinationId" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "slot" "ExamSlot" NOT NULL,
    "startsAt" TIMESTAMP(3) NOT NULL,
    "endsAt" TIMESTAMP(3) NOT NULL,
    "venue" TEXT,

    CONSTRAINT "ExamSchedule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Tag" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,

    CONSTRAINT "Tag_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Question" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "courseId" TEXT NOT NULL,
    "unitId" TEXT NOT NULL,
    "topicId" TEXT,
    "outcomeId" TEXT,
    "type" "QuestionType" NOT NULL,
    "bloom" "BloomLevel" NOT NULL,
    "difficulty" "Difficulty" NOT NULL,
    "marks" INTEGER NOT NULL,
    "estimatedMinutes" INTEGER NOT NULL,
    "status" "QuestionStatus" NOT NULL DEFAULT 'ACTIVE',
    "authorId" TEXT NOT NULL,
    "currentVersion" INTEGER NOT NULL DEFAULT 1,
    "plainText" TEXT NOT NULL,
    "searchText" TEXT NOT NULL DEFAULT '',
    "keywords" TEXT[],
    "usageCount" INTEGER NOT NULL DEFAULT 0,
    "lastUsedAt" TIMESTAMP(3),
    "lastUsedSessionId" TEXT,
    "search" tsvector GENERATED ALWAYS AS (to_tsvector('english', coalesce("searchText", ''))) STORED,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "Question_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QuestionVersion" (
    "id" TEXT NOT NULL,
    "questionId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "body" TEXT NOT NULL,
    "options" JSONB,
    "answerKey" TEXT,
    "marks" INTEGER NOT NULL,
    "difficulty" "Difficulty" NOT NULL,
    "bloom" "BloomLevel" NOT NULL,
    "type" "QuestionType" NOT NULL,
    "changeNote" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "QuestionVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QuestionTag" (
    "questionId" TEXT NOT NULL,
    "tagId" TEXT NOT NULL,

    CONSTRAINT "QuestionTag_pkey" PRIMARY KEY ("questionId","tagId")
);

-- CreateTable
CREATE TABLE "QuestionUsage" (
    "id" TEXT NOT NULL,
    "questionId" TEXT NOT NULL,
    "questionVersionId" TEXT NOT NULL,
    "paperId" TEXT NOT NULL,
    "examinationId" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "usedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "QuestionUsage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SavedFilter" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "query" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SavedFilter_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Blueprint" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "courseId" TEXT,
    "totalMarks" INTEGER NOT NULL,
    "durationMinutes" INTEGER NOT NULL,
    "isPattern" BOOLEAN NOT NULL DEFAULT false,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "Blueprint_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BlueprintSection" (
    "id" TEXT NOT NULL,
    "blueprintId" TEXT NOT NULL,
    "order" INTEGER NOT NULL,
    "label" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "instructions" TEXT,
    "questionCount" INTEGER NOT NULL,
    "attemptCount" INTEGER NOT NULL,
    "marksPerQuestion" INTEGER NOT NULL,
    "questionTypes" "QuestionType"[],
    "units" INTEGER[],

    CONSTRAINT "BlueprintSection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BlueprintRule" (
    "id" TEXT NOT NULL,
    "blueprintId" TEXT NOT NULL,
    "dimension" "BlueprintDimension" NOT NULL,
    "key" TEXT NOT NULL,
    "targetPercent" DOUBLE PRECISION NOT NULL,
    "tolerance" DOUBLE PRECISION NOT NULL DEFAULT 5,

    CONSTRAINT "BlueprintRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SetterAssignment" (
    "id" TEXT NOT NULL,
    "examinationId" TEXT NOT NULL,
    "setterId" TEXT NOT NULL,
    "backupSetterId" TEXT,
    "assignedById" TEXT NOT NULL,
    "blueprintId" TEXT,
    "setLabel" TEXT NOT NULL DEFAULT 'A',
    "deadline" TIMESTAMP(3) NOT NULL,
    "instructions" TEXT,
    "status" "AssignmentStatus" NOT NULL DEFAULT 'ASSIGNED',
    "respondedAt" TIMESTAMP(3),
    "declineReason" TEXT,
    "submittedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SetterAssignment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SetterRecommendation" (
    "id" TEXT NOT NULL,
    "examinationId" TEXT NOT NULL,
    "departmentId" TEXT NOT NULL,
    "setterId" TEXT NOT NULL,
    "recommenderId" TEXT NOT NULL,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SetterRecommendation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QuestionPaper" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "examinationId" TEXT NOT NULL,
    "assignmentId" TEXT,
    "setterId" TEXT NOT NULL,
    "blueprintId" TEXT,
    "setLabel" TEXT NOT NULL DEFAULT 'A',
    "title" TEXT NOT NULL,
    "instructions" TEXT,
    "status" "PaperStatus" NOT NULL DEFAULT 'DRAFT',
    "revision" INTEGER NOT NULL DEFAULT 0,
    "versionMajor" INTEGER NOT NULL DEFAULT 0,
    "versionMinor" INTEGER NOT NULL DEFAULT 0,
    "revisionCount" INTEGER NOT NULL DEFAULT 0,
    "submittedAt" TIMESTAMP(3),
    "approvedAt" TIMESTAMP(3),
    "lockedAt" TIMESTAMP(3),
    "lockedById" TEXT,
    "releasedAt" TIMESTAMP(3),
    "archivedAt" TIMESTAMP(3),
    "finalHash" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "QuestionPaper_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QuestionPaperSection" (
    "id" TEXT NOT NULL,
    "paperId" TEXT NOT NULL,
    "parentId" TEXT,
    "order" INTEGER NOT NULL,
    "label" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "instructions" TEXT,
    "attemptCount" INTEGER,
    "marksPerQuestion" INTEGER,

    CONSTRAINT "QuestionPaperSection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QuestionPaperItem" (
    "id" TEXT NOT NULL,
    "sectionId" TEXT NOT NULL,
    "order" INTEGER NOT NULL,
    "questionId" TEXT NOT NULL,
    "questionVersionId" TEXT NOT NULL,
    "marks" INTEGER NOT NULL,

    CONSTRAINT "QuestionPaperItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QuestionPaperVersion" (
    "id" TEXT NOT NULL,
    "paperId" TEXT NOT NULL,
    "major" INTEGER NOT NULL,
    "minor" INTEGER NOT NULL,
    "label" TEXT NOT NULL,
    "isFinal" BOOLEAN NOT NULL DEFAULT false,
    "status" "PaperStatus" NOT NULL,
    "snapshot" JSONB NOT NULL,
    "contentHash" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "QuestionPaperVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PaperTransition" (
    "id" TEXT NOT NULL,
    "paperId" TEXT NOT NULL,
    "from" "PaperStatus" NOT NULL,
    "to" "PaperStatus" NOT NULL,
    "action" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PaperTransition_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Moderation" (
    "id" TEXT NOT NULL,
    "paperId" TEXT NOT NULL,
    "moderatorId" TEXT NOT NULL,
    "round" INTEGER NOT NULL DEFAULT 1,
    "status" "ModerationStatus" NOT NULL DEFAULT 'PENDING',
    "checklist" JSONB,
    "summary" TEXT,
    "versionLabel" TEXT,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Moderation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ModerationComment" (
    "id" TEXT NOT NULL,
    "moderationId" TEXT,
    "paperId" TEXT NOT NULL,
    "itemId" TEXT,
    "authorId" TEXT NOT NULL,
    "kind" "ModerationCommentKind" NOT NULL DEFAULT 'COMMENT',
    "body" TEXT NOT NULL,
    "suggestedQuestionId" TEXT,
    "resolved" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ModerationComment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Scrutiny" (
    "id" TEXT NOT NULL,
    "paperId" TEXT NOT NULL,
    "officerId" TEXT NOT NULL,
    "round" INTEGER NOT NULL DEFAULT 1,
    "status" "ScrutinyStatus" NOT NULL DEFAULT 'PENDING',
    "checks" JSONB,
    "remarks" TEXT,
    "versionLabel" TEXT,
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Scrutiny_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Approval" (
    "id" TEXT NOT NULL,
    "paperId" TEXT NOT NULL,
    "approverId" TEXT NOT NULL,
    "decision" "ApprovalDecision" NOT NULL,
    "remarks" TEXT,
    "versionLabel" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Approval_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Notification" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT,
    "link" TEXT,
    "readAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmailOutbox" (
    "id" TEXT NOT NULL,
    "to" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'QUEUED',
    "sentAt" TIMESTAMP(3),
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EmailOutbox_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" BIGSERIAL NOT NULL,
    "actorId" TEXT,
    "actorName" TEXT,
    "action" TEXT NOT NULL,
    "resourceType" TEXT NOT NULL,
    "resourceId" TEXT,
    "summary" TEXT,
    "ip" TEXT,
    "userAgent" TEXT,
    "oldValue" JSONB,
    "newValue" JSONB,
    "metadata" JSONB,
    "prevHash" TEXT,
    "hash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FileAsset" (
    "id" TEXT NOT NULL,
    "storageKey" TEXT NOT NULL,
    "originalName" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "sha256" TEXT NOT NULL,
    "kind" "FileKind" NOT NULL,
    "ownerId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "FileAsset_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Template" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" "TemplateKind" NOT NULL DEFAULT 'PAPER',
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "headerTitle" TEXT,
    "headerSubtitle" TEXT,
    "showLogo" BOOLEAN NOT NULL DEFAULT true,
    "instructions" TEXT,
    "footerText" TEXT,
    "fontFamily" TEXT NOT NULL DEFAULT 'Times New Roman',
    "fontSizePt" INTEGER NOT NULL DEFAULT 12,
    "marginMm" INTEGER NOT NULL DEFAULT 18,
    "showRegNoBoxes" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Template_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Watermark" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "opacity" DOUBLE PRECISION NOT NULL DEFAULT 0.08,
    "angle" INTEGER NOT NULL DEFAULT -30,
    "appliesTo" TEXT[],
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Watermark_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SystemSetting" (
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "updatedById" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SystemSetting_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "_ExaminationSessionToProgram" (
    "A" TEXT NOT NULL,
    "B" TEXT NOT NULL,

    CONSTRAINT "_ExaminationSessionToProgram_AB_pkey" PRIMARY KEY ("A","B")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "User_employeeId_key" ON "User"("employeeId");

-- CreateIndex
CREATE INDEX "User_departmentId_idx" ON "User"("departmentId");

-- CreateIndex
CREATE INDEX "User_status_idx" ON "User"("status");

-- CreateIndex
CREATE UNIQUE INDEX "Role_key_key" ON "Role"("key");

-- CreateIndex
CREATE UNIQUE INDEX "Permission_key_key" ON "Permission"("key");

-- CreateIndex
CREATE INDEX "UserRole_roleId_idx" ON "UserRole"("roleId");

-- CreateIndex
CREATE UNIQUE INDEX "UserRole_userId_roleId_departmentId_key" ON "UserRole"("userId", "roleId", "departmentId");

-- CreateIndex
CREATE UNIQUE INDEX "Session_tokenHash_key" ON "Session"("tokenHash");

-- CreateIndex
CREATE INDEX "Session_userId_idx" ON "Session"("userId");

-- CreateIndex
CREATE INDEX "Session_expiresAt_idx" ON "Session"("expiresAt");

-- CreateIndex
CREATE INDEX "LoginAttempt_identifier_createdAt_idx" ON "LoginAttempt"("identifier", "createdAt");

-- CreateIndex
CREATE INDEX "LoginAttempt_ip_createdAt_idx" ON "LoginAttempt"("ip", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "PasswordResetToken_tokenHash_key" ON "PasswordResetToken"("tokenHash");

-- CreateIndex
CREATE UNIQUE INDEX "Department_code_key" ON "Department"("code");

-- CreateIndex
CREATE UNIQUE INDEX "Program_code_key" ON "Program"("code");

-- CreateIndex
CREATE UNIQUE INDEX "Regulation_code_key" ON "Regulation"("code");

-- CreateIndex
CREATE UNIQUE INDEX "AcademicYear_label_key" ON "AcademicYear"("label");

-- CreateIndex
CREATE UNIQUE INDEX "Semester_number_key" ON "Semester"("number");

-- CreateIndex
CREATE INDEX "Course_departmentId_idx" ON "Course"("departmentId");

-- CreateIndex
CREATE INDEX "Course_programId_idx" ON "Course"("programId");

-- CreateIndex
CREATE UNIQUE INDEX "Course_code_regulationId_key" ON "Course"("code", "regulationId");

-- CreateIndex
CREATE UNIQUE INDEX "CourseUnit_courseId_number_key" ON "CourseUnit"("courseId", "number");

-- CreateIndex
CREATE INDEX "CourseTopic_unitId_idx" ON "CourseTopic"("unitId");

-- CreateIndex
CREATE UNIQUE INDEX "LearningOutcome_courseId_code_key" ON "LearningOutcome"("courseId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "ExaminationSession_code_key" ON "ExaminationSession"("code");

-- CreateIndex
CREATE INDEX "ExaminationSession_status_idx" ON "ExaminationSession"("status");

-- CreateIndex
CREATE INDEX "Examination_moderatorId_idx" ON "Examination"("moderatorId");

-- CreateIndex
CREATE INDEX "Examination_scrutinizerId_idx" ON "Examination"("scrutinizerId");

-- CreateIndex
CREATE UNIQUE INDEX "Examination_sessionId_courseId_key" ON "Examination"("sessionId", "courseId");

-- CreateIndex
CREATE UNIQUE INDEX "ExamSchedule_examinationId_key" ON "ExamSchedule"("examinationId");

-- CreateIndex
CREATE INDEX "ExamSchedule_date_idx" ON "ExamSchedule"("date");

-- CreateIndex
CREATE UNIQUE INDEX "Tag_name_key" ON "Tag"("name");

-- CreateIndex
CREATE UNIQUE INDEX "Question_code_key" ON "Question"("code");

-- CreateIndex
CREATE INDEX "Question_courseId_unitId_idx" ON "Question"("courseId", "unitId");

-- CreateIndex
CREATE INDEX "Question_courseId_difficulty_bloom_idx" ON "Question"("courseId", "difficulty", "bloom");

-- CreateIndex
CREATE INDEX "Question_courseId_marks_idx" ON "Question"("courseId", "marks");

-- CreateIndex
CREATE INDEX "Question_status_idx" ON "Question"("status");

-- CreateIndex
CREATE INDEX "Question_authorId_idx" ON "Question"("authorId");

-- CreateIndex
CREATE INDEX "Question_usageCount_idx" ON "Question"("usageCount");

-- CreateIndex
CREATE INDEX "Question_createdAt_idx" ON "Question"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "QuestionVersion_questionId_version_key" ON "QuestionVersion"("questionId", "version");

-- CreateIndex
CREATE INDEX "QuestionTag_tagId_idx" ON "QuestionTag"("tagId");

-- CreateIndex
CREATE INDEX "QuestionUsage_questionId_usedAt_idx" ON "QuestionUsage"("questionId", "usedAt");

-- CreateIndex
CREATE INDEX "QuestionUsage_sessionId_idx" ON "QuestionUsage"("sessionId");

-- CreateIndex
CREATE UNIQUE INDEX "QuestionUsage_questionId_paperId_key" ON "QuestionUsage"("questionId", "paperId");

-- CreateIndex
CREATE INDEX "SavedFilter_userId_scope_idx" ON "SavedFilter"("userId", "scope");

-- CreateIndex
CREATE UNIQUE INDEX "BlueprintSection_blueprintId_label_key" ON "BlueprintSection"("blueprintId", "label");

-- CreateIndex
CREATE UNIQUE INDEX "BlueprintRule_blueprintId_dimension_key_key" ON "BlueprintRule"("blueprintId", "dimension", "key");

-- CreateIndex
CREATE INDEX "SetterAssignment_setterId_status_idx" ON "SetterAssignment"("setterId", "status");

-- CreateIndex
CREATE INDEX "SetterAssignment_deadline_idx" ON "SetterAssignment"("deadline");

-- CreateIndex
CREATE UNIQUE INDEX "SetterAssignment_examinationId_setLabel_key" ON "SetterAssignment"("examinationId", "setLabel");

-- CreateIndex
CREATE UNIQUE INDEX "SetterRecommendation_examinationId_setterId_key" ON "SetterRecommendation"("examinationId", "setterId");

-- CreateIndex
CREATE UNIQUE INDEX "QuestionPaper_code_key" ON "QuestionPaper"("code");

-- CreateIndex
CREATE UNIQUE INDEX "QuestionPaper_assignmentId_key" ON "QuestionPaper"("assignmentId");

-- CreateIndex
CREATE INDEX "QuestionPaper_examinationId_idx" ON "QuestionPaper"("examinationId");

-- CreateIndex
CREATE INDEX "QuestionPaper_setterId_idx" ON "QuestionPaper"("setterId");

-- CreateIndex
CREATE INDEX "QuestionPaper_status_idx" ON "QuestionPaper"("status");

-- CreateIndex
CREATE INDEX "QuestionPaperSection_paperId_order_idx" ON "QuestionPaperSection"("paperId", "order");

-- CreateIndex
CREATE INDEX "QuestionPaperItem_sectionId_order_idx" ON "QuestionPaperItem"("sectionId", "order");

-- CreateIndex
CREATE INDEX "QuestionPaperItem_questionId_idx" ON "QuestionPaperItem"("questionId");

-- CreateIndex
CREATE UNIQUE INDEX "QuestionPaperVersion_paperId_major_minor_key" ON "QuestionPaperVersion"("paperId", "major", "minor");

-- CreateIndex
CREATE INDEX "PaperTransition_paperId_createdAt_idx" ON "PaperTransition"("paperId", "createdAt");

-- CreateIndex
CREATE INDEX "Moderation_moderatorId_status_idx" ON "Moderation"("moderatorId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "Moderation_paperId_round_key" ON "Moderation"("paperId", "round");

-- CreateIndex
CREATE INDEX "ModerationComment_paperId_idx" ON "ModerationComment"("paperId");

-- CreateIndex
CREATE INDEX "Scrutiny_officerId_status_idx" ON "Scrutiny"("officerId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "Scrutiny_paperId_round_key" ON "Scrutiny"("paperId", "round");

-- CreateIndex
CREATE INDEX "Approval_paperId_idx" ON "Approval"("paperId");

-- CreateIndex
CREATE INDEX "Notification_userId_readAt_createdAt_idx" ON "Notification"("userId", "readAt", "createdAt");

-- CreateIndex
CREATE INDEX "EmailOutbox_status_createdAt_idx" ON "EmailOutbox"("status", "createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_actorId_createdAt_idx" ON "AuditLog"("actorId", "createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_resourceType_resourceId_idx" ON "AuditLog"("resourceType", "resourceId");

-- CreateIndex
CREATE INDEX "AuditLog_action_createdAt_idx" ON "AuditLog"("action", "createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_createdAt_idx" ON "AuditLog"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "FileAsset_storageKey_key" ON "FileAsset"("storageKey");

-- CreateIndex
CREATE INDEX "_ExaminationSessionToProgram_B_index" ON "_ExaminationSessionToProgram"("B");

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "Department"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RolePermission" ADD CONSTRAINT "RolePermission_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "Role"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RolePermission" ADD CONSTRAINT "RolePermission_permissionId_fkey" FOREIGN KEY ("permissionId") REFERENCES "Permission"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserRole" ADD CONSTRAINT "UserRole_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserRole" ADD CONSTRAINT "UserRole_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "Role"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserRole" ADD CONSTRAINT "UserRole_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "Department"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PasswordResetToken" ADD CONSTRAINT "PasswordResetToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Department" ADD CONSTRAINT "Department_institutionId_fkey" FOREIGN KEY ("institutionId") REFERENCES "Institution"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Program" ADD CONSTRAINT "Program_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "Department"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Course" ADD CONSTRAINT "Course_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "Department"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Course" ADD CONSTRAINT "Course_programId_fkey" FOREIGN KEY ("programId") REFERENCES "Program"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Course" ADD CONSTRAINT "Course_semesterId_fkey" FOREIGN KEY ("semesterId") REFERENCES "Semester"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Course" ADD CONSTRAINT "Course_regulationId_fkey" FOREIGN KEY ("regulationId") REFERENCES "Regulation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CourseUnit" ADD CONSTRAINT "CourseUnit_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "Course"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CourseTopic" ADD CONSTRAINT "CourseTopic_unitId_fkey" FOREIGN KEY ("unitId") REFERENCES "CourseUnit"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LearningOutcome" ADD CONSTRAINT "LearningOutcome_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "Course"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExaminationSession" ADD CONSTRAINT "ExaminationSession_academicYearId_fkey" FOREIGN KEY ("academicYearId") REFERENCES "AcademicYear"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Examination" ADD CONSTRAINT "Examination_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "ExaminationSession"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Examination" ADD CONSTRAINT "Examination_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "Course"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Examination" ADD CONSTRAINT "Examination_blueprintId_fkey" FOREIGN KEY ("blueprintId") REFERENCES "Blueprint"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Examination" ADD CONSTRAINT "Examination_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "Template"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Examination" ADD CONSTRAINT "Examination_moderatorId_fkey" FOREIGN KEY ("moderatorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Examination" ADD CONSTRAINT "Examination_scrutinizerId_fkey" FOREIGN KEY ("scrutinizerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExamSchedule" ADD CONSTRAINT "ExamSchedule_examinationId_fkey" FOREIGN KEY ("examinationId") REFERENCES "Examination"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Question" ADD CONSTRAINT "Question_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "Course"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Question" ADD CONSTRAINT "Question_unitId_fkey" FOREIGN KEY ("unitId") REFERENCES "CourseUnit"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Question" ADD CONSTRAINT "Question_topicId_fkey" FOREIGN KEY ("topicId") REFERENCES "CourseTopic"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Question" ADD CONSTRAINT "Question_outcomeId_fkey" FOREIGN KEY ("outcomeId") REFERENCES "LearningOutcome"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Question" ADD CONSTRAINT "Question_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuestionVersion" ADD CONSTRAINT "QuestionVersion_questionId_fkey" FOREIGN KEY ("questionId") REFERENCES "Question"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuestionVersion" ADD CONSTRAINT "QuestionVersion_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuestionTag" ADD CONSTRAINT "QuestionTag_questionId_fkey" FOREIGN KEY ("questionId") REFERENCES "Question"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuestionTag" ADD CONSTRAINT "QuestionTag_tagId_fkey" FOREIGN KEY ("tagId") REFERENCES "Tag"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuestionUsage" ADD CONSTRAINT "QuestionUsage_questionId_fkey" FOREIGN KEY ("questionId") REFERENCES "Question"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuestionUsage" ADD CONSTRAINT "QuestionUsage_questionVersionId_fkey" FOREIGN KEY ("questionVersionId") REFERENCES "QuestionVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuestionUsage" ADD CONSTRAINT "QuestionUsage_paperId_fkey" FOREIGN KEY ("paperId") REFERENCES "QuestionPaper"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuestionUsage" ADD CONSTRAINT "QuestionUsage_examinationId_fkey" FOREIGN KEY ("examinationId") REFERENCES "Examination"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SavedFilter" ADD CONSTRAINT "SavedFilter_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Blueprint" ADD CONSTRAINT "Blueprint_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "Course"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BlueprintSection" ADD CONSTRAINT "BlueprintSection_blueprintId_fkey" FOREIGN KEY ("blueprintId") REFERENCES "Blueprint"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BlueprintRule" ADD CONSTRAINT "BlueprintRule_blueprintId_fkey" FOREIGN KEY ("blueprintId") REFERENCES "Blueprint"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SetterAssignment" ADD CONSTRAINT "SetterAssignment_examinationId_fkey" FOREIGN KEY ("examinationId") REFERENCES "Examination"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SetterAssignment" ADD CONSTRAINT "SetterAssignment_setterId_fkey" FOREIGN KEY ("setterId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SetterAssignment" ADD CONSTRAINT "SetterAssignment_backupSetterId_fkey" FOREIGN KEY ("backupSetterId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SetterAssignment" ADD CONSTRAINT "SetterAssignment_assignedById_fkey" FOREIGN KEY ("assignedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SetterAssignment" ADD CONSTRAINT "SetterAssignment_blueprintId_fkey" FOREIGN KEY ("blueprintId") REFERENCES "Blueprint"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SetterRecommendation" ADD CONSTRAINT "SetterRecommendation_examinationId_fkey" FOREIGN KEY ("examinationId") REFERENCES "Examination"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SetterRecommendation" ADD CONSTRAINT "SetterRecommendation_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "Department"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SetterRecommendation" ADD CONSTRAINT "SetterRecommendation_setterId_fkey" FOREIGN KEY ("setterId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SetterRecommendation" ADD CONSTRAINT "SetterRecommendation_recommenderId_fkey" FOREIGN KEY ("recommenderId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuestionPaper" ADD CONSTRAINT "QuestionPaper_examinationId_fkey" FOREIGN KEY ("examinationId") REFERENCES "Examination"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuestionPaper" ADD CONSTRAINT "QuestionPaper_assignmentId_fkey" FOREIGN KEY ("assignmentId") REFERENCES "SetterAssignment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuestionPaper" ADD CONSTRAINT "QuestionPaper_setterId_fkey" FOREIGN KEY ("setterId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuestionPaper" ADD CONSTRAINT "QuestionPaper_blueprintId_fkey" FOREIGN KEY ("blueprintId") REFERENCES "Blueprint"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuestionPaperSection" ADD CONSTRAINT "QuestionPaperSection_paperId_fkey" FOREIGN KEY ("paperId") REFERENCES "QuestionPaper"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuestionPaperSection" ADD CONSTRAINT "QuestionPaperSection_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "QuestionPaperSection"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuestionPaperItem" ADD CONSTRAINT "QuestionPaperItem_sectionId_fkey" FOREIGN KEY ("sectionId") REFERENCES "QuestionPaperSection"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuestionPaperItem" ADD CONSTRAINT "QuestionPaperItem_questionId_fkey" FOREIGN KEY ("questionId") REFERENCES "Question"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuestionPaperItem" ADD CONSTRAINT "QuestionPaperItem_questionVersionId_fkey" FOREIGN KEY ("questionVersionId") REFERENCES "QuestionVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuestionPaperVersion" ADD CONSTRAINT "QuestionPaperVersion_paperId_fkey" FOREIGN KEY ("paperId") REFERENCES "QuestionPaper"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuestionPaperVersion" ADD CONSTRAINT "QuestionPaperVersion_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaperTransition" ADD CONSTRAINT "PaperTransition_paperId_fkey" FOREIGN KEY ("paperId") REFERENCES "QuestionPaper"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaperTransition" ADD CONSTRAINT "PaperTransition_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Moderation" ADD CONSTRAINT "Moderation_paperId_fkey" FOREIGN KEY ("paperId") REFERENCES "QuestionPaper"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Moderation" ADD CONSTRAINT "Moderation_moderatorId_fkey" FOREIGN KEY ("moderatorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ModerationComment" ADD CONSTRAINT "ModerationComment_moderationId_fkey" FOREIGN KEY ("moderationId") REFERENCES "Moderation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ModerationComment" ADD CONSTRAINT "ModerationComment_paperId_fkey" FOREIGN KEY ("paperId") REFERENCES "QuestionPaper"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ModerationComment" ADD CONSTRAINT "ModerationComment_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "QuestionPaperItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ModerationComment" ADD CONSTRAINT "ModerationComment_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Scrutiny" ADD CONSTRAINT "Scrutiny_paperId_fkey" FOREIGN KEY ("paperId") REFERENCES "QuestionPaper"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Scrutiny" ADD CONSTRAINT "Scrutiny_officerId_fkey" FOREIGN KEY ("officerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Approval" ADD CONSTRAINT "Approval_paperId_fkey" FOREIGN KEY ("paperId") REFERENCES "QuestionPaper"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Approval" ADD CONSTRAINT "Approval_approverId_fkey" FOREIGN KEY ("approverId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FileAsset" ADD CONSTRAINT "FileAsset_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_ExaminationSessionToProgram" ADD CONSTRAINT "_ExaminationSessionToProgram_A_fkey" FOREIGN KEY ("A") REFERENCES "ExaminationSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_ExaminationSessionToProgram" ADD CONSTRAINT "_ExaminationSessionToProgram_B_fkey" FOREIGN KEY ("B") REFERENCES "Program"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ─────────────── EXAMCORE hand-written additions ───────────────

-- Full-text search and fuzzy/duplicate matching over the question bank
CREATE INDEX "Question_search_idx" ON "Question" USING GIN ("search");
CREATE INDEX "Question_plainText_trgm_idx" ON "Question" USING GIN ("plainText" gin_trgm_ops);
CREATE INDEX "Course_title_trgm_idx" ON "Course" USING GIN ("title" gin_trgm_ops);
CREATE INDEX "User_name_trgm_idx" ON "User" USING GIN ("name" gin_trgm_ops);

-- Immutable history: audit log, question versions, paper versions, usage history and transitions
CREATE OR REPLACE FUNCTION examcore_forbid_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'EXAMCORE: % on % is not permitted (immutable record)', TG_OP, TG_TABLE_NAME
    USING ERRCODE = 'insufficient_privilege';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "AuditLog_immutable" BEFORE UPDATE OR DELETE ON "AuditLog"
  FOR EACH ROW EXECUTE FUNCTION examcore_forbid_mutation();
CREATE TRIGGER "QuestionVersion_immutable" BEFORE UPDATE OR DELETE ON "QuestionVersion"
  FOR EACH ROW EXECUTE FUNCTION examcore_forbid_mutation();
CREATE TRIGGER "QuestionPaperVersion_immutable" BEFORE UPDATE OR DELETE ON "QuestionPaperVersion"
  FOR EACH ROW EXECUTE FUNCTION examcore_forbid_mutation();
CREATE TRIGGER "QuestionUsage_immutable" BEFORE UPDATE OR DELETE ON "QuestionUsage"
  FOR EACH ROW EXECUTE FUNCTION examcore_forbid_mutation();
CREATE TRIGGER "PaperTransition_immutable" BEFORE UPDATE OR DELETE ON "PaperTransition"
  FOR EACH ROW EXECUTE FUNCTION examcore_forbid_mutation();

-- Locked / released / archived papers: content (sections & items) cannot change
CREATE OR REPLACE FUNCTION examcore_forbid_locked_paper_edit() RETURNS trigger AS $$
DECLARE
  pid TEXT;
  st  TEXT;
BEGIN
  IF TG_TABLE_NAME = 'QuestionPaperSection' THEN
    pid := COALESCE(NEW."paperId", OLD."paperId");
  ELSE
    SELECT s."paperId" INTO pid FROM "QuestionPaperSection" s
      WHERE s.id = COALESCE(NEW."sectionId", OLD."sectionId");
  END IF;
  SELECT p.status::text INTO st FROM "QuestionPaper" p WHERE p.id = pid;
  IF st IN ('APPROVED', 'LOCKED', 'RELEASED', 'ARCHIVED') THEN
    RAISE EXCEPTION 'EXAMCORE: paper % is % and cannot be edited', pid, st
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "QuestionPaperSection_lock_guard" BEFORE INSERT OR UPDATE OR DELETE ON "QuestionPaperSection"
  FOR EACH ROW EXECUTE FUNCTION examcore_forbid_locked_paper_edit();
CREATE TRIGGER "QuestionPaperItem_lock_guard" BEFORE INSERT OR UPDATE OR DELETE ON "QuestionPaperItem"
  FOR EACH ROW EXECUTE FUNCTION examcore_forbid_locked_paper_edit();
