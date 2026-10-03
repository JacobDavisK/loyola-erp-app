# Video API

All endpoints are under `/api/video`, use the ERP session cookie (same-origin, CSRF-checked), return JSON, and
apply the same service-layer permission checks as the UI. A meeting `id` parameter accepts the database id or
the public id (`ERP-ACD-2026-000184`). Meetings the caller may not see return **404**, not 403.

Successful responses are `{ "data": … }`. Errors are `{ "error": "message", "code"? }`: 401 (not signed in),
403 (permission), 404, 409 (state / workflow, e.g. "this meeting is over", outside the join window),
422 (validation, with `issues`), 429 (rate limited). When the video service is unavailable, start and join answer 409 with a plain message ("Unable to start the meeting. Please try again."); the recording media route answers 503. Every API caller is also
limited to 240 requests per minute.

## Meetings

| Method | Path | Permission | Notes |
|---|---|---|---|
| GET | `/meetings?view=today\|upcoming\|past\|cancelled` | `video.join` | Only meetings visible to the caller |
| POST | `/meetings` | `video.schedule` / `video.create` | Body: `title, meetingType, scheduledStart, scheduledEnd, description?, offeringId?, mentoringStudentId?, departmentId?, visibility?, participantIds[], coHostIds[], presenterIds[], panelRoles{}, lobbyEnabled?, recordingEnabled?, autoRecord?, chatEnabled?, screenShareEnabled?, participantsCanPublish?, recordingAccess?, draft?` |
| GET | `/meetings/{id}` | can see | |
| PATCH | `/meetings/{id}` | host | Same fields as create; rescheduling notifies participants |
| DELETE | `/meetings/{id}` | host | Cancels (body `{ reason }`); records are kept |
| POST | `/meetings/{id}/start` | host / co-host, `video.start` | Within the join window |
| POST | `/meetings/{id}/join` | can join, `video.join` | `{status:"ready", token, url, role, …}`, `{status:"lobby"}` or `{status:"waiting", startsAt}`. Rate limit 30/min |
| POST | `/meetings/{id}/end` | host / co-host, `video.end` | |

## Participants

| Method | Path | Notes |
|---|---|---|
| GET | `/meetings/{id}/participants` | Invitations, connection state, lobby |
| POST | `/meetings/{id}/participants` | `{ userIds[], role? }` — host, `video.manage_participants`; re-admits people removed earlier |
| PATCH | `/meetings/{id}/participants/{pid}` | `{ action: "role", role }`, `{ action: "mute", source }`, `{ action: "admit" }`, `{ action: "deny" }` |
| DELETE | `/meetings/{id}/participants/{pid}` | Removes and blocks rejoining (`video.remove_participant`) |

## Chat, notes, guests

| Method | Path | Notes |
|---|---|---|
| GET/POST | `/meetings/{id}/chat` | Stored in the ERP and relayed to the room; 20 messages / 10 s per person |
| DELETE | `/meetings/{id}/chat/{mid}` | Author or host |
| GET/POST | `/meetings/{id}/notes` | Host and panel notes (viva, PhD review); private to hosts/panel |
| POST | `/meetings/{id}/guests` | `{ name, email, role, panelRole? }` — e-mails a personal link; requires guest access enabled |
| DELETE | `/meetings/{id}/guests/{gid}` | Revokes the link |
| POST | `/guest/join` | `{ token }` — public, rate limited per IP; the token is only ever stored hashed |

## Recordings

| Method | Path | Notes |
|---|---|---|
| GET | `/meetings/{id}/recordings` | Recordings the caller may watch |
| POST | `/meetings/{id}/recordings` | Start (host, `video.enable_recording`, recording allowed for the meeting) |
| POST | `/meetings/{id}/recordings/stop` | Stop |
| GET | `/recordings/{rid}?download=1` | Returns a signed playback URL valid for 2 hours, bound to the caller |
| PATCH | `/recordings/{rid}` | `{ title?, access? }` |
| DELETE | `/recordings/{rid}` | `video.delete_recording`; removes the object from storage |
| GET | `/recordings/{rid}/media?exp&d&sig` | Streams the file (HTTP Range). Requires the session **and** a valid signature **and** current permission |

## Attendance and analytics

| Method | Path | Notes |
|---|---|---|
| GET | `/meetings/{id}/attendance[?format=csv]` | `video.view_attendance` (host) or oversight |
| PATCH | `/meetings/{id}/attendance/{aid}` | `{ status, reason }` — `video.modify_attendance`, ended meetings only, audited |
| GET | `/analytics/export` | CSV of meetings in scope — `video.view_analytics` |

## Platform

| Method | Path | Notes |
|---|---|---|
| POST | `/webhooks/openvidu` | Called by OpenVidu only. JWT-signed (`Authorization`), idempotent by event id |
| GET | `/health` | Public: `{status: ok\|degraded\|not_configured}`. Administrators also get component and webhook health |
