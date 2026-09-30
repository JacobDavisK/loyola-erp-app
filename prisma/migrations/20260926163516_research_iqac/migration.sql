-- CreateEnum
CREATE TYPE "ProjectStatus" AS ENUM ('DRAFT', 'UNDER_REVIEW', 'APPROVED', 'SANCTIONED', 'COMPLETED', 'REJECTED', 'WITHDRAWN');

-- CreateEnum
CREATE TYPE "ProjectRole" AS ENUM ('PI', 'CO_PI', 'MEMBER');

-- CreateEnum
CREATE TYPE "BudgetHead" AS ENUM ('EQUIPMENT', 'CONSUMABLES', 'TRAVEL', 'MANPOWER', 'CONTINGENCY', 'OVERHEAD');

-- CreateEnum
CREATE TYPE "PublicationType" AS ENUM ('JOURNAL', 'CONFERENCE', 'BOOK', 'CHAPTER', 'PATENT');

-- CreateEnum
CREATE TYPE "Indexing" AS ENUM ('SCOPUS', 'WEB_OF_SCIENCE', 'UGC_CARE', 'PUBMED', 'OTHER', 'NONE');

-- CreateEnum
CREATE TYPE "MetricKind" AS ENUM ('QUANTITATIVE', 'QUALITATIVE');

-- CreateEnum
CREATE TYPE "ResponseStatus" AS ENUM ('NOT_STARTED', 'DRAFT', 'SUBMITTED', 'APPROVED', 'RETURNED');

-- AlterEnum
ALTER TYPE "FileKind" ADD VALUE 'EVIDENCE';

-- CreateTable
CREATE TABLE "ResearchProject" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "abstract" TEXT NOT NULL,
    "departmentId" TEXT,
    "fundingAgency" TEXT NOT NULL,
    "scheme" TEXT,
    "proposedAmount" DECIMAL(14,2) NOT NULL,
    "sanctionedAmount" DECIMAL(14,2),
    "grantRef" TEXT,
    "startDate" DATE,
    "endDate" DATE,
    "durationMonths" INTEGER NOT NULL,
    "status" "ProjectStatus" NOT NULL DEFAULT 'DRAFT',
    "outcome" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ResearchProject_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProjectMember" (
    "projectId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "role" "ProjectRole" NOT NULL,

    CONSTRAINT "ProjectMember_pkey" PRIMARY KEY ("projectId","employeeId")
);

-- CreateTable
CREATE TABLE "ProjectBudgetLine" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "head" "BudgetHead" NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,

    CONSTRAINT "ProjectBudgetLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProjectExpense" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "head" "BudgetHead" NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "date" DATE NOT NULL,
    "voucherNo" TEXT,
    "description" TEXT NOT NULL,
    "recordedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProjectExpense_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Publication" (
    "id" TEXT NOT NULL,
    "type" "PublicationType" NOT NULL,
    "title" TEXT NOT NULL,
    "venue" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "volume" TEXT,
    "pages" TEXT,
    "doi" TEXT,
    "isbn" TEXT,
    "url" TEXT,
    "authorsText" TEXT NOT NULL,
    "indexing" "Indexing" NOT NULL DEFAULT 'NONE',
    "impactFactor" DOUBLE PRECISION,
    "departmentId" TEXT,
    "projectId" TEXT,
    "verifiedAt" TIMESTAMP(3),
    "verifiedById" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Publication_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PublicationAuthor" (
    "publicationId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,

    CONSTRAINT "PublicationAuthor_pkey" PRIMARY KEY ("publicationId","employeeId")
);

-- CreateTable
CREATE TABLE "AccreditationFramework" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AccreditationFramework_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AccreditationMetric" (
    "id" TEXT NOT NULL,
    "frameworkId" TEXT NOT NULL,
    "parentId" TEXT,
    "code" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "kind" "MetricKind" NOT NULL,
    "weight" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "guidance" TEXT,
    "source" TEXT,
    "unit" TEXT,
    "order" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "AccreditationMetric_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AccreditationCycle" (
    "id" TEXT NOT NULL,
    "frameworkId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "academicYearId" TEXT NOT NULL,
    "yearsCovered" INTEGER NOT NULL DEFAULT 1,
    "dueDate" DATE,
    "isClosed" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AccreditationCycle_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MetricResponse" (
    "id" TEXT NOT NULL,
    "cycleId" TEXT NOT NULL,
    "metricId" TEXT NOT NULL,
    "assigneeId" TEXT,
    "value" DOUBLE PRECISION,
    "narrative" TEXT,
    "computed" JSONB,
    "status" "ResponseStatus" NOT NULL DEFAULT 'NOT_STARTED',
    "reviewNote" TEXT,
    "submittedAt" TIMESTAMP(3),
    "reviewedAt" TIMESTAMP(3),
    "reviewedById" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MetricResponse_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MetricEvidence" (
    "id" TEXT NOT NULL,
    "responseId" TEXT NOT NULL,
    "fileId" TEXT,
    "url" TEXT,
    "label" TEXT NOT NULL,
    "addedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MetricEvidence_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ResearchProject_code_key" ON "ResearchProject"("code");

-- CreateIndex
CREATE INDEX "ResearchProject_status_idx" ON "ResearchProject"("status");

-- CreateIndex
CREATE INDEX "ResearchProject_departmentId_idx" ON "ResearchProject"("departmentId");

-- CreateIndex
CREATE INDEX "ProjectMember_employeeId_idx" ON "ProjectMember"("employeeId");

-- CreateIndex
CREATE UNIQUE INDEX "ProjectBudgetLine_projectId_head_key" ON "ProjectBudgetLine"("projectId", "head");

-- CreateIndex
CREATE INDEX "ProjectExpense_projectId_head_idx" ON "ProjectExpense"("projectId", "head");

-- CreateIndex
CREATE UNIQUE INDEX "Publication_doi_key" ON "Publication"("doi");

-- CreateIndex
CREATE INDEX "Publication_year_idx" ON "Publication"("year");

-- CreateIndex
CREATE INDEX "Publication_departmentId_year_idx" ON "Publication"("departmentId", "year");

-- CreateIndex
CREATE INDEX "PublicationAuthor_employeeId_idx" ON "PublicationAuthor"("employeeId");

-- CreateIndex
CREATE UNIQUE INDEX "AccreditationFramework_code_key" ON "AccreditationFramework"("code");

-- CreateIndex
CREATE UNIQUE INDEX "AccreditationMetric_frameworkId_code_key" ON "AccreditationMetric"("frameworkId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "AccreditationCycle_frameworkId_academicYearId_key" ON "AccreditationCycle"("frameworkId", "academicYearId");

-- CreateIndex
CREATE INDEX "MetricResponse_assigneeId_status_idx" ON "MetricResponse"("assigneeId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "MetricResponse_cycleId_metricId_key" ON "MetricResponse"("cycleId", "metricId");

-- AddForeignKey
ALTER TABLE "ResearchProject" ADD CONSTRAINT "ResearchProject_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "Department"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectMember" ADD CONSTRAINT "ProjectMember_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "ResearchProject"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectMember" ADD CONSTRAINT "ProjectMember_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectBudgetLine" ADD CONSTRAINT "ProjectBudgetLine_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "ResearchProject"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectExpense" ADD CONSTRAINT "ProjectExpense_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "ResearchProject"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Publication" ADD CONSTRAINT "Publication_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "Department"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Publication" ADD CONSTRAINT "Publication_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "ResearchProject"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PublicationAuthor" ADD CONSTRAINT "PublicationAuthor_publicationId_fkey" FOREIGN KEY ("publicationId") REFERENCES "Publication"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PublicationAuthor" ADD CONSTRAINT "PublicationAuthor_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AccreditationMetric" ADD CONSTRAINT "AccreditationMetric_frameworkId_fkey" FOREIGN KEY ("frameworkId") REFERENCES "AccreditationFramework"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AccreditationMetric" ADD CONSTRAINT "AccreditationMetric_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "AccreditationMetric"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AccreditationCycle" ADD CONSTRAINT "AccreditationCycle_frameworkId_fkey" FOREIGN KEY ("frameworkId") REFERENCES "AccreditationFramework"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AccreditationCycle" ADD CONSTRAINT "AccreditationCycle_academicYearId_fkey" FOREIGN KEY ("academicYearId") REFERENCES "AcademicYear"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MetricResponse" ADD CONSTRAINT "MetricResponse_cycleId_fkey" FOREIGN KEY ("cycleId") REFERENCES "AccreditationCycle"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MetricResponse" ADD CONSTRAINT "MetricResponse_metricId_fkey" FOREIGN KEY ("metricId") REFERENCES "AccreditationMetric"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MetricResponse" ADD CONSTRAINT "MetricResponse_assigneeId_fkey" FOREIGN KEY ("assigneeId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MetricEvidence" ADD CONSTRAINT "MetricEvidence_responseId_fkey" FOREIGN KEY ("responseId") REFERENCES "MetricResponse"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MetricEvidence" ADD CONSTRAINT "MetricEvidence_fileId_fkey" FOREIGN KEY ("fileId") REFERENCES "FileAsset"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- ── Hand-written integrity rules ─────────────────────────────────────
ALTER TABLE "ResearchProject" ADD CONSTRAINT "ResearchProject_values" CHECK ("proposedAmount" >= 0 AND ("sanctionedAmount" IS NULL OR "sanctionedAmount" >= 0) AND "durationMonths" BETWEEN 1 AND 120 AND ("endDate" IS NULL OR "startDate" IS NULL OR "endDate" >= "startDate"));
ALTER TABLE "ProjectBudgetLine" ADD CONSTRAINT "ProjectBudgetLine_amount" CHECK ("amount" >= 0);
ALTER TABLE "ProjectExpense" ADD CONSTRAINT "ProjectExpense_amount" CHECK ("amount" <> 0);
ALTER TABLE "Publication" ADD CONSTRAINT "Publication_year" CHECK ("year" BETWEEN 1900 AND 2200 AND ("impactFactor" IS NULL OR "impactFactor" >= 0));
ALTER TABLE "PublicationAuthor" ADD CONSTRAINT "PublicationAuthor_position" CHECK ("position" >= 1);
ALTER TABLE "AccreditationCycle" ADD CONSTRAINT "AccreditationCycle_years" CHECK ("yearsCovered" BETWEEN 1 AND 10);
ALTER TABLE "MetricEvidence" ADD CONSTRAINT "MetricEvidence_target" CHECK (num_nonnulls("fileId", "url") = 1);
ALTER TABLE "AccreditationMetric" ADD CONSTRAINT "AccreditationMetric_not_own_parent" CHECK ("parentId" IS NULL OR "parentId" <> "id");

-- Grant spending is a ledger: append-only.
CREATE TRIGGER "ProjectExpense_immutable" BEFORE UPDATE OR DELETE ON "ProjectExpense" FOR EACH ROW EXECUTE FUNCTION examcore_forbid_mutation();
