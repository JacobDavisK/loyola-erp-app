# Video administration

## Where things are

| Page | Who | Purpose |
|---|---|---|
| **Meetings** (`/video`) | anyone with `video.join` | Today, upcoming, past, recordings, cancelled, drafts; start a meeting now; schedule |
| Meeting detail (`/video/{id}`) | people who can see it | Overview, participants (lobby, roles, guests), attendance (CSV, adjust, apply to class register), recordings, notes, chat |
| **Video administration** (`/video/admin`) | `video.view_analytics` | Live meetings, totals, by type/department/month, attendance mix, recording storage, failures, CSV export |
| Configuration centre → **Video & collaboration** (`/admin/video`) | `video.manage_settings` / `video.manage_global_settings` | Service status and settings |
| Class workspace → **Live classes** | instructors, department | Online classes for the class, "Go online" for timetabled sessions, recordings |
| Student course → **Live classes** | students | Join, recordings |

## Settings

Two levels. *Meeting settings* (`video.manage_settings`, e.g. a university administrator): which meeting types
can be scheduled, default duration, how early people can join, reminders, default lobby/chat/screen-share,
default recording access. *Institution-wide settings* (`video.manage_global_settings`, IT administrators):
maximum duration and participants, whether recording and downloads are allowed, retention for recordings and
chat, attendance thresholds, and guest access. Changes are audited (`settings.video.update`).

Connection details (server URL, keys, storage) are **not** settings: they live in the server environment
(see `openvidu-setup.md`).

## Roles (defaults)

| Role group | Video permissions |
|---|---|
| Faculty, visiting faculty, exam, placement, admissions, counsellors | create, schedule, start, join, end, manage/mute/remove participants, co-hosts, recording, view recordings and attendance |
| HOD, Dean, Associate Dean, Principal, Registrar | the above + modify attendance, analytics, delete recordings |
| University Admin | the above + meeting settings |
| IT Admin | join, analytics, meeting and institution-wide settings |
| Student | join, view recordings |
| Guardian | join (parent meetings) |
| External examiner | join, view recordings |

Adjust in Configuration centre → Roles & permissions (module "Video & collaboration"). After an update the
installer runs `npm run rbac:sync`, which adds new permissions to roles without touching your customisations.

## Everyday tasks

- **Online class for a timetabled session**: class workspace → Live classes → *Go online*. The whole roll is
  invited; attendance can be applied to the class register after the class.
- **Viva voce / PhD review**: schedule the type, add panel members with their panel role, invite external
  examiners as guests; the candidate waits in the lobby; panel notes stay private to the panel.
- **Webinar / guest lecture**: participants join muted with cameras off unless made presenters.
- **Attendance correction**: meeting → Attendance → adjust, with a reason (ended meetings only).
- **Cancel**: meeting → Cancel with a reason; everyone is notified; nothing is deleted.

## Retention

The `video.retention` job (daily, in the worker) deletes recordings older than `recordingRetentionDays` and chat
older than `chatRetentionDays`. Attendance records are kept with the academic record.
