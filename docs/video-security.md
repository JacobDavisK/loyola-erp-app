# Video security

## Principles

- **The server decides everything.** Meeting ids, roles, permissions, attendance and recording URLs from the
  browser are never trusted. Every join, moderation action and recording request is re-checked in
  `src/server/services/video/access.ts` against the database.
- **Secrets stay on the server.** `OPENVIDU_API_SECRET` and the S3 keys exist only in the server environment.
  Browsers receive a short-lived (15 min) LiveKit access token for one room and one identity.
- **No guessable rooms.** Provider room names are random (`erp_<24 hex>`), unrelated to titles or ids, and
  never shown to users. Public meeting ids identify meetings in the ERP but grant nothing on their own.

## Access model

| Check | Rule |
|---|---|
| See a meeting | Host, invited participant, course roll (COURSE visibility), department (DEPARTMENT), everyone (INSTITUTION), or oversight. Restricted types (viva voce, PhD review, interviews, mentoring, parent meetings) are visible only to participants and the Super Admin |
| Join | Can see + not removed + within the join window + meeting live (or host starting it). Lobby for viva/interview types and when enabled |
| Moderate | Host or co-host, plus the matching `video.*` permission |
| Watch a recording | Recording access level (host only / participants / course / department / admins) + `video.view_recording` |
| Attendance | Host with `video.view_attendance`, or departmental oversight; changes need `video.modify_attendance` and a reason |

Token grants follow the role: participants publish only if the meeting allows it; screen share only for
presenters/hosts when participant sharing is off; only hosts get room-admin rights, and the ERP performs
moderation through the server SDK rather than trusting client admin calls.

Removing a participant disconnects them at the provider and marks them REMOVED, so a fresh join is refused
until a host deliberately adds them again (audited).

## Recordings

- Stored in the S3/MinIO bucket OpenVidu writes to; the bucket is never exposed.
- Playback URL: `/api/video/recordings/{id}/media?exp&d&sig` — HMAC over recording, user, expiry (2 h) and
  disposition. The media route also requires the session of the **same** user and re-checks permission, so a
  copied link is useless to anyone else and dies after two hours.
- Downloads need `allowRecordingDownload` (hosts may always download their own meeting's recording); deletion requires `video.delete_recording` and is audited.
- Retention job deletes recordings after `recordingRetentionDays`.

## Webhooks

- `POST /api/video/webhooks/openvidu` is exempt from the browser origin check but verifies the LiveKit JWT
  (`Authorization` header) signed with the API secret, including the SHA-256 of the body.
- Each event is stored once by event id (`VideoWebhookEvent.eventId` unique, rows immutable by trigger);
  duplicates and retries are acknowledged without reprocessing. Rate limited per source.

## Guests

- External examiners and speakers receive a personal link by e-mail. Only `sha256(token)` is stored; links expire
  `guestGraceHours` after the scheduled end and can be revoked. Guest joins are rate limited per IP and go
  through the lobby whenever the meeting has one (the default for viva voce, PhD reviews and interviews).

## Abuse controls and audit

- Rate limits: join 30/min/user, chat 20/10 s/user, guest join 20/min/IP, webhooks 600/min.
- Chat messages are length-limited (CHECK constraint) and rendered as text.
- CSV exports are protected against spreadsheet formula injection.
- Audited: create, update, publish, cancel, start, end, participant add/remove/role/mute/admit/deny, guest invite
  and revoke, recording start/stop/update/delete/playback, attendance adjustment, settings changes.

## Database safeguards

CHECK constraints (times, limits, percentages, adjustment reason when manual, chat length, presence interval) and
triggers (`video_meeting_final_status`, `video_webhook_immutable`) protect the data even from faulty code.
