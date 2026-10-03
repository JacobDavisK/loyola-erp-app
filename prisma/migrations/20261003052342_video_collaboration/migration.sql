-- CreateEnum
CREATE TYPE "VideoMeetingType" AS ENUM ('ONLINE_CLASS', 'FACULTY_MEETING', 'DEPARTMENT_MEETING', 'STUDENT_MENTORING', 'PARENT_MEETING', 'VIVA_VOCE', 'PHD_REVIEW', 'RESEARCH_MEETING', 'WEBINAR', 'GUEST_LECTURE', 'WORKSHOP', 'PLACEMENT_INTERVIEW', 'ADMISSION_INTERVIEW', 'EXAMINATION_MEETING', 'ADMINISTRATIVE_MEETING', 'GENERAL_MEETING');

-- CreateEnum
CREATE TYPE "VideoMeetingStatus" AS ENUM ('DRAFT', 'SCHEDULED', 'STARTING', 'LIVE', 'ENDED', 'CANCELLED', 'FAILED');

-- CreateEnum
CREATE TYPE "VideoMeetingVisibility" AS ENUM ('INVITED', 'COURSE', 'DEPARTMENT', 'INSTITUTION');

-- CreateEnum
CREATE TYPE "VideoParticipantRole" AS ENUM ('HOST', 'CO_HOST', 'PRESENTER', 'PARTICIPANT', 'MODERATOR', 'OBSERVER');

-- CreateEnum
CREATE TYPE "VideoInvitationStatus" AS ENUM ('PENDING', 'ACCEPTED', 'DECLINED', 'TENTATIVE');

-- CreateEnum
CREATE TYPE "VideoConnectionStatus" AS ENUM ('INVITED', 'IN_LOBBY', 'ADMITTED', 'CONNECTED', 'DISCONNECTED', 'REMOVED');

-- CreateEnum
CREATE TYPE "VideoAttendanceStatus" AS ENUM ('PRESENT', 'PARTIALLY_PRESENT', 'ABSENT');

-- CreateEnum
CREATE TYPE "VideoRecordingStatus" AS ENUM ('STARTING', 'ACTIVE', 'PROCESSING', 'AVAILABLE', 'FAILED', 'ARCHIVED', 'DELETED');

-- CreateEnum
CREATE TYPE "VideoRecordingAccess" AS ENUM ('HOST_ONLY', 'PARTICIPANTS', 'COURSE', 'DEPARTMENT', 'SPECIFIC', 'ADMINS');

-- CreateTable
CREATE TABLE "VideoMeeting" (
    "id" TEXT NOT NULL,
    "publicId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "meetingType" "VideoMeetingType" NOT NULL,
    "hostUserId" TEXT NOT NULL,
    "departmentId" TEXT,
    "offeringId" TEXT,
    "courseId" TEXT,
    "batchId" TEXT,
    "programId" TEXT,
    "academicYearId" TEXT,
    "classMeetingId" TEXT,
    "mentoringStudentId" TEXT,
    "scheduledStart" TIMESTAMP(3) NOT NULL,
    "scheduledEnd" TIMESTAMP(3) NOT NULL,
    "actualStart" TIMESTAMP(3),
    "actualEnd" TIMESTAMP(3),
    "timezone" TEXT NOT NULL,
    "status" "VideoMeetingStatus" NOT NULL DEFAULT 'SCHEDULED',
    "visibility" "VideoMeetingVisibility" NOT NULL DEFAULT 'INVITED',
    "lobbyEnabled" BOOLEAN NOT NULL DEFAULT false,
    "recordingEnabled" BOOLEAN NOT NULL DEFAULT false,
    "autoRecord" BOOLEAN NOT NULL DEFAULT false,
    "chatEnabled" BOOLEAN NOT NULL DEFAULT true,
    "screenShareEnabled" BOOLEAN NOT NULL DEFAULT true,
    "participantsCanPublish" BOOLEAN NOT NULL DEFAULT true,
    "participantLimit" INTEGER NOT NULL,
    "recordingAccess" "VideoRecordingAccess" NOT NULL DEFAULT 'PARTICIPANTS',
    "roomName" TEXT NOT NULL,
    "reminderSentAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "cancelReason" TEXT,
    "failureReason" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VideoMeeting_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VideoMeetingParticipant" (
    "id" TEXT NOT NULL,
    "meetingId" TEXT NOT NULL,
    "userId" TEXT,
    "guestId" TEXT,
    "displayName" TEXT NOT NULL,
    "role" "VideoParticipantRole" NOT NULL DEFAULT 'PARTICIPANT',
    "panelRole" TEXT,
    "invitationStatus" "VideoInvitationStatus" NOT NULL DEFAULT 'PENDING',
    "invitedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "respondedAt" TIMESTAMP(3),
    "connectionStatus" "VideoConnectionStatus" NOT NULL DEFAULT 'INVITED',
    "lobbyRequestedAt" TIMESTAMP(3),
    "lastJoinedAt" TIMESTAMP(3),
    "lastLeftAt" TIMESTAMP(3),
    "removedAt" TIMESTAMP(3),
    "removedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VideoMeetingParticipant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VideoPresence" (
    "id" TEXT NOT NULL,
    "meetingId" TEXT NOT NULL,
    "participantId" TEXT NOT NULL,
    "connectionSid" TEXT NOT NULL,
    "joinedAt" TIMESTAMP(3) NOT NULL,
    "leftAt" TIMESTAMP(3),

    CONSTRAINT "VideoPresence_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VideoMeetingAttendance" (
    "id" TEXT NOT NULL,
    "meetingId" TEXT NOT NULL,
    "participantId" TEXT NOT NULL,
    "userId" TEXT,
    "firstJoinedAt" TIMESTAMP(3),
    "lastLeftAt" TIMESTAMP(3),
    "totalSeconds" INTEGER NOT NULL DEFAULT 0,
    "attendancePercentage" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "attendanceStatus" "VideoAttendanceStatus" NOT NULL,
    "manuallyAdjusted" BOOLEAN NOT NULL DEFAULT false,
    "adjustedById" TEXT,
    "adjustmentReason" TEXT,
    "computedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VideoMeetingAttendance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VideoMeetingRecording" (
    "id" TEXT NOT NULL,
    "meetingId" TEXT NOT NULL,
    "providerRecordingId" TEXT NOT NULL,
    "storageProvider" TEXT NOT NULL,
    "storagePath" TEXT,
    "durationSeconds" INTEGER,
    "fileSize" BIGINT,
    "status" "VideoRecordingStatus" NOT NULL DEFAULT 'STARTING',
    "access" "VideoRecordingAccess" NOT NULL,
    "allowedUserIds" TEXT[],
    "startedById" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt" TIMESTAMP(3),
    "availableAt" TIMESTAMP(3),
    "error" TEXT,
    "archivedAt" TIMESTAMP(3),
    "retainUntil" TIMESTAMP(3),
    "deletedAt" TIMESTAMP(3),
    "deletedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VideoMeetingRecording_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VideoChatMessage" (
    "id" TEXT NOT NULL,
    "meetingId" TEXT NOT NULL,
    "senderUserId" TEXT,
    "senderName" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" TIMESTAMP(3),
    "deletedById" TEXT,

    CONSTRAINT "VideoChatMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VideoMeetingNote" (
    "id" TEXT NOT NULL,
    "meetingId" TEXT NOT NULL,
    "authorUserId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "followUpOn" DATE,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VideoMeetingNote_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VideoMeetingGuest" (
    "id" TEXT NOT NULL,
    "meetingId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "role" "VideoParticipantRole" NOT NULL DEFAULT 'PARTICIPANT',
    "panelRole" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "lastUsedAt" TIMESTAMP(3),
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VideoMeetingGuest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VideoWebhookEvent" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "event" TEXT NOT NULL,
    "roomName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt" TIMESTAMP(3),
    "error" TEXT,
    "payload" JSONB NOT NULL,

    CONSTRAINT "VideoWebhookEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "VideoMeeting_publicId_key" ON "VideoMeeting"("publicId");

-- CreateIndex
CREATE UNIQUE INDEX "VideoMeeting_classMeetingId_key" ON "VideoMeeting"("classMeetingId");

-- CreateIndex
CREATE UNIQUE INDEX "VideoMeeting_roomName_key" ON "VideoMeeting"("roomName");

-- CreateIndex
CREATE INDEX "VideoMeeting_status_scheduledStart_idx" ON "VideoMeeting"("status", "scheduledStart");

-- CreateIndex
CREATE INDEX "VideoMeeting_hostUserId_scheduledStart_idx" ON "VideoMeeting"("hostUserId", "scheduledStart");

-- CreateIndex
CREATE INDEX "VideoMeeting_offeringId_scheduledStart_idx" ON "VideoMeeting"("offeringId", "scheduledStart");

-- CreateIndex
CREATE INDEX "VideoMeeting_departmentId_scheduledStart_idx" ON "VideoMeeting"("departmentId", "scheduledStart");

-- CreateIndex
CREATE UNIQUE INDEX "VideoMeetingParticipant_guestId_key" ON "VideoMeetingParticipant"("guestId");

-- CreateIndex
CREATE INDEX "VideoMeetingParticipant_userId_idx" ON "VideoMeetingParticipant"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "VideoMeetingParticipant_meetingId_userId_key" ON "VideoMeetingParticipant"("meetingId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "VideoPresence_connectionSid_key" ON "VideoPresence"("connectionSid");

-- CreateIndex
CREATE INDEX "VideoPresence_participantId_idx" ON "VideoPresence"("participantId");

-- CreateIndex
CREATE UNIQUE INDEX "VideoMeetingAttendance_participantId_key" ON "VideoMeetingAttendance"("participantId");

-- CreateIndex
CREATE INDEX "VideoMeetingAttendance_meetingId_idx" ON "VideoMeetingAttendance"("meetingId");

-- CreateIndex
CREATE INDEX "VideoMeetingAttendance_userId_idx" ON "VideoMeetingAttendance"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "VideoMeetingRecording_providerRecordingId_key" ON "VideoMeetingRecording"("providerRecordingId");

-- CreateIndex
CREATE INDEX "VideoMeetingRecording_meetingId_idx" ON "VideoMeetingRecording"("meetingId");

-- CreateIndex
CREATE INDEX "VideoMeetingRecording_status_idx" ON "VideoMeetingRecording"("status");

-- CreateIndex
CREATE INDEX "VideoChatMessage_meetingId_createdAt_idx" ON "VideoChatMessage"("meetingId", "createdAt");

-- CreateIndex
CREATE INDEX "VideoMeetingNote_meetingId_idx" ON "VideoMeetingNote"("meetingId");

-- CreateIndex
CREATE UNIQUE INDEX "VideoMeetingGuest_tokenHash_key" ON "VideoMeetingGuest"("tokenHash");

-- CreateIndex
CREATE INDEX "VideoMeetingGuest_meetingId_idx" ON "VideoMeetingGuest"("meetingId");

-- CreateIndex
CREATE UNIQUE INDEX "VideoWebhookEvent_eventId_key" ON "VideoWebhookEvent"("eventId");

-- CreateIndex
CREATE INDEX "VideoWebhookEvent_event_createdAt_idx" ON "VideoWebhookEvent"("event", "createdAt");

-- AddForeignKey
ALTER TABLE "VideoMeeting" ADD CONSTRAINT "VideoMeeting_hostUserId_fkey" FOREIGN KEY ("hostUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VideoMeeting" ADD CONSTRAINT "VideoMeeting_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "Department"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VideoMeeting" ADD CONSTRAINT "VideoMeeting_offeringId_fkey" FOREIGN KEY ("offeringId") REFERENCES "CourseOffering"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VideoMeeting" ADD CONSTRAINT "VideoMeeting_classMeetingId_fkey" FOREIGN KEY ("classMeetingId") REFERENCES "ClassMeeting"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VideoMeetingParticipant" ADD CONSTRAINT "VideoMeetingParticipant_meetingId_fkey" FOREIGN KEY ("meetingId") REFERENCES "VideoMeeting"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VideoMeetingParticipant" ADD CONSTRAINT "VideoMeetingParticipant_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VideoPresence" ADD CONSTRAINT "VideoPresence_meetingId_fkey" FOREIGN KEY ("meetingId") REFERENCES "VideoMeeting"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VideoMeetingAttendance" ADD CONSTRAINT "VideoMeetingAttendance_meetingId_fkey" FOREIGN KEY ("meetingId") REFERENCES "VideoMeeting"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VideoMeetingRecording" ADD CONSTRAINT "VideoMeetingRecording_meetingId_fkey" FOREIGN KEY ("meetingId") REFERENCES "VideoMeeting"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VideoChatMessage" ADD CONSTRAINT "VideoChatMessage_meetingId_fkey" FOREIGN KEY ("meetingId") REFERENCES "VideoMeeting"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VideoMeetingNote" ADD CONSTRAINT "VideoMeetingNote_meetingId_fkey" FOREIGN KEY ("meetingId") REFERENCES "VideoMeeting"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VideoMeetingGuest" ADD CONSTRAINT "VideoMeetingGuest_meetingId_fkey" FOREIGN KEY ("meetingId") REFERENCES "VideoMeeting"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- ───────────── Hand-written rules ─────────────
ALTER TABLE "VideoMeeting" ADD CONSTRAINT "VideoMeeting_times_check" CHECK ("scheduledEnd" > "scheduledStart");
ALTER TABLE "VideoMeeting" ADD CONSTRAINT "VideoMeeting_limit_check" CHECK ("participantLimit" BETWEEN 2 AND 1000);
ALTER TABLE "VideoMeetingParticipant" ADD CONSTRAINT "VideoMeetingParticipant_who_check" CHECK (("userId" IS NOT NULL) <> ("guestId" IS NOT NULL));
ALTER TABLE "VideoMeetingAttendance" ADD CONSTRAINT "VideoMeetingAttendance_pct_check" CHECK ("attendancePercentage" BETWEEN 0 AND 100 AND "totalSeconds" >= 0);
ALTER TABLE "VideoMeetingAttendance" ADD CONSTRAINT "VideoMeetingAttendance_adjust_check" CHECK (NOT "manuallyAdjusted" OR ("adjustedById" IS NOT NULL AND length(coalesce("adjustmentReason", '')) >= 5));
ALTER TABLE "VideoChatMessage" ADD CONSTRAINT "VideoChatMessage_length_check" CHECK (length("message") BETWEEN 1 AND 2000);
ALTER TABLE "VideoPresence" ADD CONSTRAINT "VideoPresence_interval_check" CHECK ("leftAt" IS NULL OR "leftAt" >= "joinedAt");

-- A meeting that has ended or been cancelled is final.
CREATE OR REPLACE FUNCTION video_meeting_final_status() RETURNS trigger AS $$
BEGIN
  IF OLD."status" IN ('ENDED', 'CANCELLED') AND NEW."status" <> OLD."status" THEN
    RAISE EXCEPTION 'EXAMCORE: this meeting has already %', lower(OLD."status"::text);
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "VideoMeeting_final_status" BEFORE UPDATE OF "status" ON "VideoMeeting" FOR EACH ROW EXECUTE FUNCTION video_meeting_final_status();

-- Webhook receipts are a log: never rewritten except to mark processing.
CREATE OR REPLACE FUNCTION video_webhook_immutable() RETURNS trigger AS $$
BEGIN
  IF NEW."eventId" <> OLD."eventId" OR NEW."payload"::text <> OLD."payload"::text OR NEW."event" <> OLD."event" THEN
    RAISE EXCEPTION 'EXAMCORE: webhook receipts cannot be changed';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "VideoWebhookEvent_immutable" BEFORE UPDATE ON "VideoWebhookEvent" FOR EACH ROW EXECUTE FUNCTION video_webhook_immutable();
