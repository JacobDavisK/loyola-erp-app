# University Video & Collaboration — architecture

Live classes, mentoring sessions, faculty and department meetings, viva voce, PhD reviews, webinars and
interviews run inside the ERP. The ERP owns **who may meet, when, and what is recorded about it**;
OpenVidu (self-hosted, LiveKit protocol) only moves audio and video.

```
 Browser (ERP session) ──HTTPS──▶ ERP (Next.js)                         OpenVidu 3 server
   /video, /meet/[id]              ├─ services/video/*  (rules, RBAC)      ├─ media (WebRTC SFU)
                                   ├─ server/video/openvidu.ts ──REST──────▶├─ egress (recordings → S3/MinIO)
   livekit-client  ◀──WebRTC (token issued by the ERP)─────────────────────▶└─ webhooks ──▶ /api/video/webhooks/openvidu
                                   └─ PostgreSQL: VideoMeeting, Participant, Presence,
                                      Attendance, Recording, Chat, Note, Guest, WebhookEvent
```

## Layers

| Layer | Files | Responsibility |
|---|---|---|
| Domain | `src/lib/domain/video.ts` | Meeting types (16), lifecycle transitions, public IDs (`ERP-ACD-2026-000184`), provider identities, attendance arithmetic (merged presence intervals), join window |
| Provider abstraction | `src/server/video/provider.ts` | `VideoConferenceProvider` interface: rooms, tokens, mute/remove/permissions, data messages, recording, webhook verification, health. `DisabledProvider` when nothing is configured |
| OpenVidu adapter | `src/server/video/openvidu.ts` | `livekit-server-sdk`: `RoomServiceClient`, `AccessToken`, `EgressClient`, `WebhookReceiver`. Retries transient failures; normalises webhooks into `VideoEvent` |
| Recording storage | `src/server/video/recording-storage.ts` | Reads recordings from the S3-compatible bucket OpenVidu egress writes to; ranged streaming |
| Services | `src/server/services/video/` | `access` (who may see/join/host), `meetings` (create, schedule, start, join, lobby, guests, end), `attendance`, `recordings`, `chat`, `webhooks`, `analytics`, `settings` |
| API | `src/app/api/video/**` | REST endpoints (see `video-api.md`) |
| UI | `src/app/(app)/video/**`, `src/app/(app)/admin/video`, `src/app/(meet)/meet/**`, `src/features/video/**` | Meeting lists, scheduler, detail tabs, admin dashboard, settings, the meeting room |

Nothing outside `src/server/video/` imports the LiveKit SDK, so another provider can be added by implementing
the interface and selecting it with `VIDEO_PROVIDER`.

## Lifecycle

`DRAFT → SCHEDULED → STARTING → LIVE → ENDED`, plus `CANCELLED` (from DRAFT/SCHEDULED/FAILED) and `FAILED`
(provider unavailable at start; can be started again). `ENDED` and `CANCELLED` are final — enforced in the
service **and** by the `video_meeting_final_status` database trigger.

- **Start**: a host (or co-host) starts within the join window (`joinEarlyMinutes` before the scheduled start).
  The ERP creates the provider room (random `erp_<hex>` name, never derived from user input), then marks LIVE.
- **Join**: the ERP checks the person against the meeting (invited, course roll, department, institution
  visibility, oversight), applies the lobby, and issues a 15-minute LiveKit token whose identity is
  `u_<userId>` or `g_<guestId>` and whose grants follow the participant role.
- **End**: host ends (provider room deleted) or OpenVidu reports `room_finished`; open presence intervals are
  closed and attendance is computed.

## Attendance

Presence is recorded from webhooks (`participant_joined` / `participant_left` / `participant_connection_aborted`),
one row per connection (`connectionSid`), so multiple tabs and reconnects never double count: intervals are
clipped to the actual meeting time and merged. Status: PRESENT at or above `attendancePresentPercent`,
PARTIALLY_PRESENT from `attendancePartialMinMinutes`, otherwise ABSENT. Hosts with
`video.modify_attendance` can adjust with a mandatory reason (audited). For online classes the result can be
applied to the class attendance register.

## Integrations

- **LMS / timetable**: online classes link to a course offering (whole roll invited, `COURSE` visibility) and
  optionally to a timetabled `ClassMeeting` ("Go online"). Class workspace and student course page have a
  *Live classes* tab; the student portal shows upcoming live classes and "Join online" on today's classes.
- **Mentoring**: "Online session" from the mentoring list schedules a `STUDENT_MENTORING` meeting.
- **Calendar**: the personal ICS feed includes meetings the person hosts or is invited to, with the join link.
- **Notifications**: invitations, reschedules, cancellations, reminders (`video.reminders` job, every minute).
- **Search**: the command palette finds meetings the person can see.
- **Audit**: every create/update/start/end/cancel/participant change/recording action/attendance adjustment.

## Jobs

| Job | Interval | Purpose |
|---|---|---|
| `video.reminders` | 60 s | Reminder notification `reminderMinutes` before start |
| `video.retention` | 24 h | Deletes recordings past `recordingRetentionDays` (object + row) and chat past `chatRetentionDays` |
