-- CreateEnum
CREATE TYPE "CopyStatus" AS ENUM ('AVAILABLE', 'ON_LOAN', 'LOST', 'WITHDRAWN');

-- CreateEnum
CREATE TYPE "TicketStatus" AS ENUM ('OPEN', 'IN_PROGRESS', 'WAITING', 'RESOLVED', 'CLOSED');

-- CreateEnum
CREATE TYPE "TicketPriority" AS ENUM ('LOW', 'NORMAL', 'HIGH', 'URGENT');

-- CreateEnum
CREATE TYPE "AnnouncementAudience" AS ENUM ('EVERYONE', 'STAFF', 'STUDENTS', 'GUARDIANS');

-- CreateEnum
CREATE TYPE "DocumentStatus" AS ENUM ('PENDING', 'VERIFIED', 'REJECTED');

-- CreateEnum
CREATE TYPE "ApplicantStatus" AS ENUM ('SUBMITTED', 'VERIFIED', 'REJECTED', 'OFFERED', 'ACCEPTED', 'DECLINED', 'ENROLLED', 'WITHDRAWN');

-- CreateEnum
CREATE TYPE "DriveStatus" AS ENUM ('DRAFT', 'OPEN', 'CLOSED', 'COMPLETED');

-- CreateEnum
CREATE TYPE "PlacementStatus" AS ENUM ('APPLIED', 'SHORTLISTED', 'SELECTED', 'REJECTED', 'WITHDRAWN');

-- AlterEnum
ALTER TYPE "FileKind" ADD VALUE 'STUDENT_DOCUMENT';

-- CreateTable
CREATE TABLE "LibraryItem" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "authors" TEXT NOT NULL,
    "isbn" TEXT,
    "publisher" TEXT,
    "year" INTEGER,
    "edition" TEXT,
    "subject" TEXT,
    "callNo" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LibraryItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LibraryCopy" (
    "id" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "accessionNo" TEXT NOT NULL,
    "location" TEXT,
    "status" "CopyStatus" NOT NULL DEFAULT 'AVAILABLE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LibraryCopy_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LibraryLoan" (
    "id" TEXT NOT NULL,
    "copyId" TEXT NOT NULL,
    "studentId" TEXT,
    "employeeId" TEXT,
    "issuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "dueAt" TIMESTAMP(3) NOT NULL,
    "renewals" INTEGER NOT NULL DEFAULT 0,
    "returnedAt" TIMESTAMP(3),
    "fineAmount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "fineInvoiceId" TEXT,
    "issuedById" TEXT NOT NULL,
    "returnedToId" TEXT,

    CONSTRAINT "LibraryLoan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LibraryHold" (
    "id" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "studentId" TEXT,
    "employeeId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "fulfilledAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),

    CONSTRAINT "LibraryHold_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Hostel" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "campusId" TEXT,
    "gender" "Gender",
    "wardenId" TEXT,
    "feePerTerm" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Hostel_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HostelRoom" (
    "id" TEXT NOT NULL,
    "hostelId" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "floor" INTEGER NOT NULL DEFAULT 0,
    "capacity" INTEGER NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "HostelRoom_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HostelAllocation" (
    "id" TEXT NOT NULL,
    "roomId" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "fromDate" DATE NOT NULL,
    "vacatedAt" DATE,
    "vacateReason" TEXT,
    "invoiceId" TEXT,
    "allocatedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "HostelAllocation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TransportRoute" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "vehicle" TEXT,
    "driver" TEXT,
    "capacity" INTEGER NOT NULL,
    "stops" JSONB NOT NULL,
    "feePerTerm" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TransportRoute_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TransportPass" (
    "id" TEXT NOT NULL,
    "routeId" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "stop" TEXT NOT NULL,
    "validFrom" DATE NOT NULL,
    "validTo" DATE NOT NULL,
    "cancelledAt" TIMESTAMP(3),
    "invoiceId" TEXT,
    "issuedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TransportPass_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Ticket" (
    "id" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "requesterId" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "priority" "TicketPriority" NOT NULL DEFAULT 'NORMAL',
    "status" "TicketStatus" NOT NULL DEFAULT 'OPEN',
    "assigneeId" TEXT,
    "dueAt" TIMESTAMP(3) NOT NULL,
    "firstResponseAt" TIMESTAMP(3),
    "resolvedAt" TIMESTAMP(3),
    "closedAt" TIMESTAMP(3),
    "satisfaction" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Ticket_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TicketMessage" (
    "id" TEXT NOT NULL,
    "ticketId" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "internal" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TicketMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Announcement" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "audience" "AnnouncementAudience" NOT NULL,
    "departmentId" TEXT,
    "programId" TEXT,
    "pinned" BOOLEAN NOT NULL DEFAULT false,
    "publishAt" TIMESTAMP(3) NOT NULL,
    "expiresAt" TIMESTAMP(3),
    "notified" BOOLEAN NOT NULL DEFAULT false,
    "authorId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Announcement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StudentDocument" (
    "id" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "fileId" TEXT NOT NULL,
    "status" "DocumentStatus" NOT NULL DEFAULT 'PENDING',
    "note" TEXT,
    "uploadedById" TEXT NOT NULL,
    "verifiedById" TEXT,
    "verifiedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StudentDocument_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AdmissionCycle" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "academicYearId" TEXT NOT NULL,
    "opensAt" TIMESTAMP(3) NOT NULL,
    "closesAt" TIMESTAMP(3) NOT NULL,
    "isPublic" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AdmissionCycle_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AdmissionSeat" (
    "id" TEXT NOT NULL,
    "cycleId" TEXT NOT NULL,
    "programId" TEXT NOT NULL,
    "batchId" TEXT NOT NULL,
    "seats" INTEGER NOT NULL,
    "offerValidDays" INTEGER NOT NULL DEFAULT 7,

    CONSTRAINT "AdmissionSeat_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AdmissionApplication" (
    "id" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "cycleId" TEXT NOT NULL,
    "programId" TEXT NOT NULL,
    "firstName" TEXT NOT NULL,
    "lastName" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "dateOfBirth" DATE NOT NULL,
    "gender" "Gender",
    "category" TEXT,
    "qualifyingExam" TEXT NOT NULL,
    "qualifyingPercent" DOUBLE PRECISION NOT NULL,
    "entranceScore" DOUBLE PRECISION,
    "meritScore" DOUBLE PRECISION,
    "status" "ApplicantStatus" NOT NULL DEFAULT 'SUBMITTED',
    "remarks" TEXT,
    "offerExpiresAt" TIMESTAMP(3),
    "studentId" TEXT,
    "accessTokenHash" TEXT NOT NULL,
    "submittedIp" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AdmissionApplication_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Company" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "industry" TEXT,
    "website" TEXT,
    "contactName" TEXT,
    "contactEmail" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Company_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PlacementDrive" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "location" TEXT,
    "ctc" DECIMAL(14,2) NOT NULL,
    "eligibility" JSONB NOT NULL,
    "applyBy" TIMESTAMP(3) NOT NULL,
    "driveDate" TIMESTAMP(3),
    "status" "DriveStatus" NOT NULL DEFAULT 'DRAFT',
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PlacementDrive_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PlacementApplication" (
    "id" TEXT NOT NULL,
    "driveId" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "status" "PlacementStatus" NOT NULL DEFAULT 'APPLIED',
    "snapshot" JSONB NOT NULL,
    "offerCtc" DECIMAL(14,2),
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PlacementApplication_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AlumniProfile" (
    "id" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "phone" TEXT,
    "employer" TEXT,
    "designation" TEXT,
    "city" TEXT,
    "higherStudies" TEXT,
    "linkedin" TEXT,
    "inDirectory" BOOLEAN NOT NULL DEFAULT false,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AlumniProfile_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "LibraryItem_title_idx" ON "LibraryItem"("title");

-- CreateIndex
CREATE INDEX "LibraryItem_isbn_idx" ON "LibraryItem"("isbn");

-- CreateIndex
CREATE UNIQUE INDEX "LibraryCopy_accessionNo_key" ON "LibraryCopy"("accessionNo");

-- CreateIndex
CREATE INDEX "LibraryCopy_itemId_status_idx" ON "LibraryCopy"("itemId", "status");

-- CreateIndex
CREATE INDEX "LibraryLoan_studentId_returnedAt_idx" ON "LibraryLoan"("studentId", "returnedAt");

-- CreateIndex
CREATE INDEX "LibraryLoan_employeeId_returnedAt_idx" ON "LibraryLoan"("employeeId", "returnedAt");

-- CreateIndex
CREATE INDEX "LibraryLoan_copyId_returnedAt_idx" ON "LibraryLoan"("copyId", "returnedAt");

-- CreateIndex
CREATE INDEX "LibraryHold_itemId_fulfilledAt_cancelledAt_idx" ON "LibraryHold"("itemId", "fulfilledAt", "cancelledAt");

-- CreateIndex
CREATE UNIQUE INDEX "Hostel_code_key" ON "Hostel"("code");

-- CreateIndex
CREATE UNIQUE INDEX "HostelRoom_hostelId_number_key" ON "HostelRoom"("hostelId", "number");

-- CreateIndex
CREATE INDEX "HostelAllocation_roomId_vacatedAt_idx" ON "HostelAllocation"("roomId", "vacatedAt");

-- CreateIndex
CREATE INDEX "HostelAllocation_studentId_vacatedAt_idx" ON "HostelAllocation"("studentId", "vacatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "TransportRoute_code_key" ON "TransportRoute"("code");

-- CreateIndex
CREATE INDEX "TransportPass_routeId_cancelledAt_idx" ON "TransportPass"("routeId", "cancelledAt");

-- CreateIndex
CREATE INDEX "TransportPass_studentId_idx" ON "TransportPass"("studentId");

-- CreateIndex
CREATE UNIQUE INDEX "Ticket_number_key" ON "Ticket"("number");

-- CreateIndex
CREATE INDEX "Ticket_status_category_idx" ON "Ticket"("status", "category");

-- CreateIndex
CREATE INDEX "Ticket_requesterId_idx" ON "Ticket"("requesterId");

-- CreateIndex
CREATE INDEX "Ticket_assigneeId_status_idx" ON "Ticket"("assigneeId", "status");

-- CreateIndex
CREATE INDEX "TicketMessage_ticketId_createdAt_idx" ON "TicketMessage"("ticketId", "createdAt");

-- CreateIndex
CREATE INDEX "Announcement_publishAt_expiresAt_idx" ON "Announcement"("publishAt", "expiresAt");

-- CreateIndex
CREATE INDEX "StudentDocument_studentId_type_idx" ON "StudentDocument"("studentId", "type");

-- CreateIndex
CREATE UNIQUE INDEX "AdmissionSeat_cycleId_programId_key" ON "AdmissionSeat"("cycleId", "programId");

-- CreateIndex
CREATE UNIQUE INDEX "AdmissionApplication_number_key" ON "AdmissionApplication"("number");

-- CreateIndex
CREATE UNIQUE INDEX "AdmissionApplication_studentId_key" ON "AdmissionApplication"("studentId");

-- CreateIndex
CREATE UNIQUE INDEX "AdmissionApplication_accessTokenHash_key" ON "AdmissionApplication"("accessTokenHash");

-- CreateIndex
CREATE INDEX "AdmissionApplication_cycleId_programId_status_idx" ON "AdmissionApplication"("cycleId", "programId", "status");

-- CreateIndex
CREATE INDEX "AdmissionApplication_email_idx" ON "AdmissionApplication"("email");

-- CreateIndex
CREATE UNIQUE INDEX "Company_name_key" ON "Company"("name");

-- CreateIndex
CREATE INDEX "PlacementDrive_status_applyBy_idx" ON "PlacementDrive"("status", "applyBy");

-- CreateIndex
CREATE INDEX "PlacementApplication_studentId_status_idx" ON "PlacementApplication"("studentId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "PlacementApplication_driveId_studentId_key" ON "PlacementApplication"("driveId", "studentId");

-- CreateIndex
CREATE UNIQUE INDEX "AlumniProfile_studentId_key" ON "AlumniProfile"("studentId");

-- AddForeignKey
ALTER TABLE "LibraryCopy" ADD CONSTRAINT "LibraryCopy_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "LibraryItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LibraryLoan" ADD CONSTRAINT "LibraryLoan_copyId_fkey" FOREIGN KEY ("copyId") REFERENCES "LibraryCopy"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LibraryLoan" ADD CONSTRAINT "LibraryLoan_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LibraryLoan" ADD CONSTRAINT "LibraryLoan_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LibraryHold" ADD CONSTRAINT "LibraryHold_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "LibraryItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LibraryHold" ADD CONSTRAINT "LibraryHold_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LibraryHold" ADD CONSTRAINT "LibraryHold_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Hostel" ADD CONSTRAINT "Hostel_campusId_fkey" FOREIGN KEY ("campusId") REFERENCES "Campus"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Hostel" ADD CONSTRAINT "Hostel_wardenId_fkey" FOREIGN KEY ("wardenId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HostelRoom" ADD CONSTRAINT "HostelRoom_hostelId_fkey" FOREIGN KEY ("hostelId") REFERENCES "Hostel"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HostelAllocation" ADD CONSTRAINT "HostelAllocation_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "HostelRoom"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HostelAllocation" ADD CONSTRAINT "HostelAllocation_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TransportPass" ADD CONSTRAINT "TransportPass_routeId_fkey" FOREIGN KEY ("routeId") REFERENCES "TransportRoute"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TransportPass" ADD CONSTRAINT "TransportPass_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Ticket" ADD CONSTRAINT "Ticket_requesterId_fkey" FOREIGN KEY ("requesterId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Ticket" ADD CONSTRAINT "Ticket_assigneeId_fkey" FOREIGN KEY ("assigneeId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TicketMessage" ADD CONSTRAINT "TicketMessage_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "Ticket"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TicketMessage" ADD CONSTRAINT "TicketMessage_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Announcement" ADD CONSTRAINT "Announcement_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Announcement" ADD CONSTRAINT "Announcement_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "Department"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Announcement" ADD CONSTRAINT "Announcement_programId_fkey" FOREIGN KEY ("programId") REFERENCES "Program"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StudentDocument" ADD CONSTRAINT "StudentDocument_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StudentDocument" ADD CONSTRAINT "StudentDocument_fileId_fkey" FOREIGN KEY ("fileId") REFERENCES "FileAsset"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AdmissionCycle" ADD CONSTRAINT "AdmissionCycle_academicYearId_fkey" FOREIGN KEY ("academicYearId") REFERENCES "AcademicYear"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AdmissionSeat" ADD CONSTRAINT "AdmissionSeat_cycleId_fkey" FOREIGN KEY ("cycleId") REFERENCES "AdmissionCycle"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AdmissionSeat" ADD CONSTRAINT "AdmissionSeat_programId_fkey" FOREIGN KEY ("programId") REFERENCES "Program"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AdmissionSeat" ADD CONSTRAINT "AdmissionSeat_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "Batch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AdmissionApplication" ADD CONSTRAINT "AdmissionApplication_cycleId_fkey" FOREIGN KEY ("cycleId") REFERENCES "AdmissionCycle"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AdmissionApplication" ADD CONSTRAINT "AdmissionApplication_programId_fkey" FOREIGN KEY ("programId") REFERENCES "Program"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AdmissionApplication" ADD CONSTRAINT "AdmissionApplication_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlacementDrive" ADD CONSTRAINT "PlacementDrive_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlacementApplication" ADD CONSTRAINT "PlacementApplication_driveId_fkey" FOREIGN KEY ("driveId") REFERENCES "PlacementDrive"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlacementApplication" ADD CONSTRAINT "PlacementApplication_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AlumniProfile" ADD CONSTRAINT "AlumniProfile_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- ── Hand-written integrity rules ─────────────────────────────────────
ALTER TABLE "LibraryLoan" ADD CONSTRAINT "LibraryLoan_borrower" CHECK (num_nonnulls("studentId", "employeeId") = 1 AND "dueAt" > "issuedAt" AND "fineAmount" >= 0 AND "renewals" >= 0);
ALTER TABLE "LibraryHold" ADD CONSTRAINT "LibraryHold_borrower" CHECK (num_nonnulls("studentId", "employeeId") = 1);
-- A copy can be on only one open loan.
CREATE UNIQUE INDEX "LibraryLoan_one_open_per_copy" ON "LibraryLoan" ("copyId") WHERE "returnedAt" IS NULL;

ALTER TABLE "HostelRoom" ADD CONSTRAINT "HostelRoom_capacity" CHECK ("capacity" BETWEEN 1 AND 50);
ALTER TABLE "Hostel" ADD CONSTRAINT "Hostel_fee" CHECK ("feePerTerm" >= 0);
ALTER TABLE "HostelAllocation" ADD CONSTRAINT "HostelAllocation_dates" CHECK ("vacatedAt" IS NULL OR "vacatedAt" >= "fromDate");
-- A student holds at most one bed at a time.
CREATE UNIQUE INDEX "HostelAllocation_one_open_per_student" ON "HostelAllocation" ("studentId") WHERE "vacatedAt" IS NULL;

-- Room capacity is enforced under a row lock, so concurrent allocations cannot overfill a room.
CREATE OR REPLACE FUNCTION examcore_hostel_capacity() RETURNS trigger AS $$
DECLARE cap int; used int;
BEGIN
  SELECT "capacity" INTO cap FROM "HostelRoom" WHERE "id" = NEW."roomId" FOR UPDATE;
  SELECT count(*) INTO used FROM "HostelAllocation" WHERE "roomId" = NEW."roomId" AND "vacatedAt" IS NULL;
  IF used >= cap THEN RAISE EXCEPTION 'EXAMCORE: The room is full (% of % beds taken).', used, cap; END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
CREATE TRIGGER "HostelAllocation_capacity" BEFORE INSERT ON "HostelAllocation" FOR EACH ROW EXECUTE FUNCTION examcore_hostel_capacity();

ALTER TABLE "TransportRoute" ADD CONSTRAINT "TransportRoute_values" CHECK ("capacity" BETWEEN 1 AND 200 AND "feePerTerm" >= 0);
ALTER TABLE "TransportPass" ADD CONSTRAINT "TransportPass_dates" CHECK ("validTo" >= "validFrom");
CREATE OR REPLACE FUNCTION examcore_route_capacity() RETURNS trigger AS $$
DECLARE cap int; used int;
BEGIN
  SELECT "capacity" INTO cap FROM "TransportRoute" WHERE "id" = NEW."routeId" FOR UPDATE;
  SELECT count(*) INTO used FROM "TransportPass" WHERE "routeId" = NEW."routeId" AND "cancelledAt" IS NULL
    AND "validFrom" <= NEW."validTo" AND "validTo" >= NEW."validFrom";
  IF used >= cap THEN RAISE EXCEPTION 'EXAMCORE: The route is full (% of % seats taken).', used, cap; END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
CREATE TRIGGER "TransportPass_capacity" BEFORE INSERT ON "TransportPass" FOR EACH ROW EXECUTE FUNCTION examcore_route_capacity();

ALTER TABLE "Ticket" ADD CONSTRAINT "Ticket_satisfaction" CHECK ("satisfaction" IS NULL OR "satisfaction" BETWEEN 1 AND 5);
CREATE TRIGGER "TicketMessage_immutable" BEFORE UPDATE OR DELETE ON "TicketMessage" FOR EACH ROW EXECUTE FUNCTION examcore_forbid_mutation();
ALTER TABLE "Announcement" ADD CONSTRAINT "Announcement_window" CHECK ("expiresAt" IS NULL OR "expiresAt" > "publishAt");

ALTER TABLE "AdmissionCycle" ADD CONSTRAINT "AdmissionCycle_window" CHECK ("closesAt" > "opensAt");
ALTER TABLE "AdmissionSeat" ADD CONSTRAINT "AdmissionSeat_values" CHECK ("seats" >= 0 AND "offerValidDays" BETWEEN 1 AND 90);
ALTER TABLE "AdmissionApplication" ADD CONSTRAINT "AdmissionApplication_scores" CHECK ("qualifyingPercent" BETWEEN 0 AND 100 AND ("entranceScore" IS NULL OR "entranceScore" >= 0));
ALTER TABLE "PlacementDrive" ADD CONSTRAINT "PlacementDrive_ctc" CHECK ("ctc" >= 0);
ALTER TABLE "PlacementApplication" ADD CONSTRAINT "PlacementApplication_offer" CHECK ("offerCtc" IS NULL OR "offerCtc" >= 0);
