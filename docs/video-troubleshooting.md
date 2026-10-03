# Video troubleshooting

Start with Configuration centre → Video & collaboration (service status) and `GET /api/video/health`
(signed in as an administrator for details). Server logs are structured JSON lines with an `event` field
prefixed `video.` or `openvidu.` (for example `video.meeting_started`, `video.meeting_start_failed`, `video.webhook_rejected`, `video.webhook_failed`, `openvidu.call_failed`, `openvidu.health_failed`).

| Symptom | Likely cause | What to do |
|---|---|---|
| "Video service not configured" | `VIDEO_PROVIDER` unset or `none` | Set the variables in `openvidu-setup.md`, restart the ERP |
| Status "not responding" | Wrong `OPENVIDU_URL`, firewall, OpenVidu down, wrong key/secret | `curl -I $OPENVIDU_URL`; check OpenVidu service status; compare key/secret with the OpenVidu configuration |
| Meeting goes to **FAILED** — "Unable to start the meeting" | Provider unreachable at start | Fix connectivity; the host can start the meeting again (FAILED is not final) |
| "You can start this meeting from N minutes before…" | Outside the join window | Wait, or change `joinEarlyMinutes` |
| Participant sees "Waiting for the host to start" | Meeting not started yet | Host starts it; participants join automatically |
| Stuck in the lobby | Lobby enabled (default for vivas/interviews) | Host admits from the participants panel |
| Removed participant cannot rejoin | Host removed (or denied) them | Host adds them again from the meeting's People tab; this re-admits them and is audited |
| Joins but no audio/video for some users | UDP blocked on their network, no TURN | Ensure OpenVidu's TURN is enabled and reachable on 443; optionally set `OPENVIDU_TURN_*` |
| Camera "not available" | Browser permission denied, device in use, or page not on HTTPS | Allow camera/microphone for the ERP's site; close other apps using the camera. Joining with audio only still works |
| Attendance empty after a meeting | Webhooks not reaching the ERP | Check the OpenVidu webhook URL and that it is signed with the same API key; look for `video.webhook_rejected` / `video.webhook_failed` in logs; health shows webhooks received/unprocessed |
| Recording stays "processing" | Egress not finished, or egress webhook not delivered | Check OpenVidu egress logs and the bucket; webhook delivery as above |
| Recording "available" but won't play | ERP cannot read the bucket | Check `RECORDING_S3_*`, path-style setting, bucket name and that the object key exists |
| "Link expired" when playing | Signed links last 2 hours and are tied to the person | Reopen the recording from the meeting page |
| Guest link "not valid" | Revoked, expired (`guestGraceHours` after end), or guest access disabled | Send a new invitation |
| 429 Too many requests | Rate limits (join, chat, guest) | Wait a minute |

## Known limits of the browser test environment

Automated tests use a fake provider (`tests/support/fake-video-provider.ts`); real media, TURN traversal and
egress can only be verified against a running OpenVidu server (see the checklist in `openvidu-setup.md`).
