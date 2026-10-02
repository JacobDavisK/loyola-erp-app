-- CreateEnum
CREATE TYPE "MessageChannel" AS ENUM ('SMS', 'WHATSAPP');

-- CreateEnum
CREATE TYPE "MessageStatus" AS ENUM ('QUEUED', 'SENT', 'FAILED', 'SKIPPED');

-- CreateEnum
CREATE TYPE "CounsellingMode" AS ENUM ('IN_PERSON', 'ONLINE', 'PHONE');

-- CreateEnum
CREATE TYPE "SlotStatus" AS ENUM ('OPEN', 'BOOKED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "BookingStatus" AS ENUM ('BOOKED', 'ATTENDED', 'NO_SHOW', 'CANCELLED');

-- CreateEnum
CREATE TYPE "GrievanceCategory" AS ENUM ('ACADEMIC', 'EXAMINATION', 'FEES', 'ADMINISTRATION', 'FACILITIES', 'HARASSMENT', 'RAGGING', 'DISCRIMINATION', 'OTHER');

-- CreateEnum
CREATE TYPE "GrievanceLevel" AS ENUM ('DEPARTMENT', 'INSTITUTION', 'OMBUDSPERSON');

-- CreateEnum
CREATE TYPE "GrievanceStatus" AS ENUM ('SUBMITTED', 'UNDER_REVIEW', 'RESOLVED', 'APPEALED', 'CLOSED');

-- CreateEnum
CREATE TYPE "ClubKind" AS ENUM ('CLUB', 'NSS', 'NCC', 'SPORTS', 'CULTURAL', 'PROFESSIONAL');

-- CreateEnum
CREATE TYPE "EventStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'CANCELLED', 'COMPLETED');

-- CreateEnum
CREATE TYPE "ConvocationStatus" AS ENUM ('PLANNED', 'REGISTRATION_OPEN', 'REGISTRATION_CLOSED', 'HELD');

-- CreateEnum
CREATE TYPE "ConvocationAttendance" AS ENUM ('IN_PERSON', 'IN_ABSENTIA');

-- AlterTable
ALTER TABLE "Notification" ADD COLUMN     "dispatchedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "PushSubscription" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "endpoint" TEXT NOT NULL,
    "p256dh" TEXT NOT NULL,
    "auth" TEXT NOT NULL,
    "userAgent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastUsedAt" TIMESTAMP(3),

    CONSTRAINT "PushSubscription_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ContactPreference" (
    "userId" TEXT NOT NULL,
    "phone" TEXT,
    "sms" BOOLEAN NOT NULL DEFAULT false,
    "whatsapp" BOOLEAN NOT NULL DEFAULT false,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ContactPreference_pkey" PRIMARY KEY ("userId")
);

-- CreateTable
CREATE TABLE "MessageOutbox" (
    "id" TEXT NOT NULL,
    "channel" "MessageChannel" NOT NULL,
    "userId" TEXT,
    "to" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "status" "MessageStatus" NOT NULL DEFAULT 'QUEUED',
    "providerId" TEXT,
    "error" TEXT,
    "notificationId" TEXT,
    "inbound" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sentAt" TIMESTAMP(3),

    CONSTRAINT "MessageOutbox_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CounsellingSlot" (
    "id" TEXT NOT NULL,
    "counsellorId" TEXT NOT NULL,
    "startsAt" TIMESTAMP(3) NOT NULL,
    "endsAt" TIMESTAMP(3) NOT NULL,
    "mode" "CounsellingMode" NOT NULL DEFAULT 'IN_PERSON',
    "location" TEXT,
    "status" "SlotStatus" NOT NULL DEFAULT 'OPEN',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CounsellingSlot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CounsellingBooking" (
    "id" TEXT NOT NULL,
    "slotId" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "reason" TEXT,
    "status" "BookingStatus" NOT NULL DEFAULT 'BOOKED',
    "notes" TEXT,
    "crisis" BOOLEAN NOT NULL DEFAULT false,
    "followUpOn" DATE,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CounsellingBooking_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Grievance" (
    "id" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "raisedById" TEXT NOT NULL,
    "studentId" TEXT,
    "anonymous" BOOLEAN NOT NULL DEFAULT false,
    "category" "GrievanceCategory" NOT NULL,
    "subject" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "departmentId" TEXT,
    "level" "GrievanceLevel" NOT NULL DEFAULT 'DEPARTMENT',
    "status" "GrievanceStatus" NOT NULL DEFAULT 'SUBMITTED',
    "dueAt" TIMESTAMP(3) NOT NULL,
    "resolution" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "closedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Grievance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GrievanceAction" (
    "id" TEXT NOT NULL,
    "grievanceId" TEXT NOT NULL,
    "actorId" TEXT,
    "action" TEXT NOT NULL,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GrievanceAction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AntiRaggingUndertaking" (
    "id" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "academicYearId" TEXT NOT NULL,
    "referenceNo" TEXT NOT NULL,
    "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AntiRaggingUndertaking_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Club" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" "ClubKind" NOT NULL,
    "description" TEXT NOT NULL,
    "coordinatorId" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Club_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClubMember" (
    "id" TEXT NOT NULL,
    "clubId" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'MEMBER',
    "hours" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "leftAt" TIMESTAMP(3),

    CONSTRAINT "ClubMember_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CampusEvent" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "clubId" TEXT,
    "venue" TEXT NOT NULL,
    "roomId" TEXT,
    "startsAt" TIMESTAMP(3) NOT NULL,
    "endsAt" TIMESTAMP(3) NOT NULL,
    "capacity" INTEGER,
    "registrationCloses" TIMESTAMP(3),
    "hours" DOUBLE PRECISION,
    "badgeId" TEXT,
    "status" "EventStatus" NOT NULL DEFAULT 'DRAFT',
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CampusEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EventRegistration" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "studentId" TEXT,
    "registeredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "attendedAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),

    CONSTRAINT "EventRegistration_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Convocation" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "heldOn" TIMESTAMP(3) NOT NULL,
    "venue" TEXT NOT NULL,
    "registrationCloses" TIMESTAMP(3) NOT NULL,
    "maxGuests" INTEGER NOT NULL DEFAULT 2,
    "status" "ConvocationStatus" NOT NULL DEFAULT 'PLANNED',
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Convocation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ConvocationGraduate" (
    "id" TEXT NOT NULL,
    "convocationId" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "attendance" "ConvocationAttendance",
    "guests" INTEGER NOT NULL DEFAULT 0,
    "seatNo" TEXT,
    "registeredAt" TIMESTAMP(3),
    "gownIssuedAt" TIMESTAMP(3),
    "degreeHandedAt" TIMESTAMP(3),

    CONSTRAINT "ConvocationGraduate_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PushSubscription_endpoint_key" ON "PushSubscription"("endpoint");

-- CreateIndex
CREATE INDEX "PushSubscription_userId_idx" ON "PushSubscription"("userId");

-- CreateIndex
CREATE INDEX "MessageOutbox_status_createdAt_idx" ON "MessageOutbox"("status", "createdAt");

-- CreateIndex
CREATE INDEX "MessageOutbox_userId_createdAt_idx" ON "MessageOutbox"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "CounsellingSlot_counsellorId_startsAt_idx" ON "CounsellingSlot"("counsellorId", "startsAt");

-- CreateIndex
CREATE INDEX "CounsellingSlot_status_startsAt_idx" ON "CounsellingSlot"("status", "startsAt");

-- CreateIndex
CREATE UNIQUE INDEX "CounsellingBooking_slotId_key" ON "CounsellingBooking"("slotId");

-- CreateIndex
CREATE INDEX "CounsellingBooking_studentId_idx" ON "CounsellingBooking"("studentId");

-- CreateIndex
CREATE UNIQUE INDEX "Grievance_number_key" ON "Grievance"("number");

-- CreateIndex
CREATE INDEX "Grievance_status_dueAt_idx" ON "Grievance"("status", "dueAt");

-- CreateIndex
CREATE INDEX "Grievance_raisedById_idx" ON "Grievance"("raisedById");

-- CreateIndex
CREATE INDEX "GrievanceAction_grievanceId_createdAt_idx" ON "GrievanceAction"("grievanceId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "AntiRaggingUndertaking_studentId_academicYearId_key" ON "AntiRaggingUndertaking"("studentId", "academicYearId");

-- CreateIndex
CREATE UNIQUE INDEX "Club_name_key" ON "Club"("name");

-- CreateIndex
CREATE UNIQUE INDEX "ClubMember_clubId_studentId_key" ON "ClubMember"("clubId", "studentId");

-- CreateIndex
CREATE INDEX "CampusEvent_status_startsAt_idx" ON "CampusEvent"("status", "startsAt");

-- CreateIndex
CREATE UNIQUE INDEX "EventRegistration_eventId_userId_key" ON "EventRegistration"("eventId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "ConvocationGraduate_convocationId_studentId_key" ON "ConvocationGraduate"("convocationId", "studentId");

-- AddForeignKey
ALTER TABLE "PushSubscription" ADD CONSTRAINT "PushSubscription_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContactPreference" ADD CONSTRAINT "ContactPreference_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CounsellingSlot" ADD CONSTRAINT "CounsellingSlot_counsellorId_fkey" FOREIGN KEY ("counsellorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CounsellingBooking" ADD CONSTRAINT "CounsellingBooking_slotId_fkey" FOREIGN KEY ("slotId") REFERENCES "CounsellingSlot"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CounsellingBooking" ADD CONSTRAINT "CounsellingBooking_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Grievance" ADD CONSTRAINT "Grievance_raisedById_fkey" FOREIGN KEY ("raisedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Grievance" ADD CONSTRAINT "Grievance_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GrievanceAction" ADD CONSTRAINT "GrievanceAction_grievanceId_fkey" FOREIGN KEY ("grievanceId") REFERENCES "Grievance"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AntiRaggingUndertaking" ADD CONSTRAINT "AntiRaggingUndertaking_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AntiRaggingUndertaking" ADD CONSTRAINT "AntiRaggingUndertaking_academicYearId_fkey" FOREIGN KEY ("academicYearId") REFERENCES "AcademicYear"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Club" ADD CONSTRAINT "Club_coordinatorId_fkey" FOREIGN KEY ("coordinatorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClubMember" ADD CONSTRAINT "ClubMember_clubId_fkey" FOREIGN KEY ("clubId") REFERENCES "Club"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClubMember" ADD CONSTRAINT "ClubMember_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CampusEvent" ADD CONSTRAINT "CampusEvent_clubId_fkey" FOREIGN KEY ("clubId") REFERENCES "Club"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EventRegistration" ADD CONSTRAINT "EventRegistration_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "CampusEvent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EventRegistration" ADD CONSTRAINT "EventRegistration_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConvocationGraduate" ADD CONSTRAINT "ConvocationGraduate_convocationId_fkey" FOREIGN KEY ("convocationId") REFERENCES "Convocation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConvocationGraduate" ADD CONSTRAINT "ConvocationGraduate_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- ── Hand-written integrity rules ──
CREATE TRIGGER "GrievanceAction_immutable" BEFORE UPDATE OR DELETE ON "GrievanceAction" FOR EACH ROW EXECUTE FUNCTION examcore_forbid_mutation();
ALTER TABLE "CounsellingSlot" ADD CONSTRAINT "CounsellingSlot_times" CHECK ("endsAt" > "startsAt");
ALTER TABLE "CampusEvent" ADD CONSTRAINT "CampusEvent_times" CHECK ("endsAt" > "startsAt" AND ("capacity" IS NULL OR "capacity" > 0) AND ("hours" IS NULL OR "hours" > 0));
ALTER TABLE "ConvocationGraduate" ADD CONSTRAINT "ConvocationGraduate_guests" CHECK ("guests" BETWEEN 0 AND 10);
-- Anonymity is only for ragging and harassment complaints.
ALTER TABLE "Grievance" ADD CONSTRAINT "Grievance_anonymous" CHECK (NOT "anonymous" OR "category" IN ('RAGGING', 'HARASSMENT'));
-- Event capacity is enforced in the database, so simultaneous registrations cannot overbook.
CREATE OR REPLACE FUNCTION examcore_event_capacity() RETURNS trigger AS $$
DECLARE cap INT; taken INT;
BEGIN
  SELECT "capacity" INTO cap FROM "CampusEvent" WHERE id = NEW."eventId" FOR UPDATE;
  IF cap IS NULL OR NEW."cancelledAt" IS NOT NULL THEN RETURN NEW; END IF;
  SELECT count(*) INTO taken FROM "EventRegistration" WHERE "eventId" = NEW."eventId" AND "cancelledAt" IS NULL AND id <> NEW.id;
  IF taken >= cap THEN RAISE EXCEPTION 'EXAMCORE: the event is full'; END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
CREATE TRIGGER "EventRegistration_capacity" BEFORE INSERT OR UPDATE OF "cancelledAt" ON "EventRegistration" FOR EACH ROW EXECUTE FUNCTION examcore_event_capacity();
