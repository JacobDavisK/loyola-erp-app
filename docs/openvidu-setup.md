# OpenVidu setup

The ERP works without a video server: meetings can be scheduled, invitations and reminders go out, and the
admin pages show "not configured". Meetings can only **start** once an OpenVidu server is connected.

The ERP targets **OpenVidu 3.x** (LiveKit protocol) through `livekit-server-sdk` 2.x on the server and
`livekit-client` 2.x in the browser. This project does not ship a Docker setup; deploy OpenVidu with the
official installer on its own server.

## 1. Deploy OpenVidu

Follow the official self-hosting guide for your version — <https://openvidu.io/latest/docs/self-hosting/> —
"Single Node" is enough for one campus; "Elastic" / "High availability" scale out. You need:

- A Linux server with a public IP and a DNS name (for example `video.university.edu`) with a valid TLS certificate
  (the installer can obtain one).
- The firewall ports listed in the guide for your deployment type (HTTPS, TURN and the WebRTC media ports).
  Media will not flow if UDP is blocked and no TURN server is reachable.
- The installer prints/creates the **API key and secret** (LiveKit credentials) and the S3/MinIO credentials
  used for recordings. Keep them in your secrets store; never commit them.

## 2. Configure the ERP

In the ERP server's `.env` (never in the database or the repository):

```env
VIDEO_PROVIDER="openvidu"
OPENVIDU_URL="https://video.university.edu"
OPENVIDU_API_KEY="<api key>"
OPENVIDU_API_SECRET="<api secret>"          # OPENVIDU_SECRET is accepted as an alias

# Recording (optional)
OPENVIDU_RECORDING_ENABLED="true"
OPENVIDU_RECORDING_STORAGE="s3"
OPENVIDU_RECORDING_PREFIX="recordings/erp"
RECORDING_S3_ENDPOINT="https://video.university.edu:9000"   # MinIO bundled with OpenVidu, or any S3
RECORDING_S3_REGION="us-east-1"
RECORDING_S3_BUCKET="openvidu-appdata"
RECORDING_S3_ACCESS_KEY="<access key>"
RECORDING_S3_SECRET_KEY="<secret key>"
RECORDING_S3_FORCE_PATH_STYLE="true"

# Optional: ICE servers handed to browsers in addition to OpenVidu's own
OPENVIDU_STUN_SERVER=""
OPENVIDU_TURN_SERVER=""
OPENVIDU_TURN_USERNAME=""
OPENVIDU_TURN_CREDENTIAL=""
```

In production the ERP refuses to boot with an `http://` OpenVidu URL, a secret shorter than 32 characters, or
recording enabled without S3 storage.

Restart the ERP. Configuration centre → **Video & collaboration** should show *Connected (n ms)*, and
`GET /api/video/health` returns `{"status":"ok"}`.

## 3. Webhooks (required for attendance and recordings)

Point OpenVidu's webhook at the ERP and sign it with the **same API key** the ERP uses:

```
https://erp.university.edu/api/video/webhooks/openvidu
```

In OpenVidu 3 this is the `webhook` section of the LiveKit configuration on the OpenVidu server
(`api_key` + `urls`); see "Webhooks" in the official documentation for the file location in your deployment.
The ERP verifies the JWT in the `Authorization` header and the body hash, stores every event once (by event id)
and ignores duplicates and retries.

Check: Video administration shows "webhooks received in the last 24 h" via the health endpoint (administrators).

## 4. Recording storage

OpenVidu egress writes MP4 files to its S3/MinIO bucket. The ERP never hands out bucket URLs: it streams the
file itself after checking the viewer's permission and a short-lived signed link. Give the ERP read and delete
access to the bucket (delete is used by retention and "delete recording").

## 5. Verify end to end

1. Schedule a meeting for now with two accounts, start it as host, join from a second browser.
2. Check camera, microphone, screen share, chat, raise hand, mute by host, remove.
3. Start and stop a recording; it appears as *processing*, then *available* after the egress webhook.
4. End the meeting; the Attendance tab shows minutes and percentages.
