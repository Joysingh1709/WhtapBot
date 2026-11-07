# WhtapBot

Self-hosted WhatsApp message scheduler (a Blueticks-style queue). You link your own WhatsApp once by
scanning a QR code; after that the server sends queued messages at their scheduled time. It only sends while
the server process is running, so for "laptop closed" use, deploy it (see below).

## Features

- Calendar planner (month / week / day), sidebar search + filters, contacts, groups, templates, `{name}` personalisation
- **Quick add** – type "wish Mom happy birthday every Nov 12 at 9am" and the form fills itself (rule-based, offline)
- **Repeats** – daily, weekdays, weekly, monthly, **yearly**, with an end date or a number of sends
- **Per-message timezone** – a daily 9:00 stays 9:00 across daylight-saving changes; the 31st doesn't drift to the 30th
- **Send window** – "between 9 and 11 AM": goes out at a random moment inside the window
- **Attachments** – photos, videos, PDFs/documents, audio, and real **voice notes** (any audio is converted with ffmpeg)
- **Drag & drop** on the calendar (mouse, or long-press on touch) and **multi-select** with bulk cancel / shift / move
- **Alerts** via [ntfy](https://ntfy.sh) (and optionally WhatsApp to yourself): WhatsApp disconnected, message failed/missed, server restarted
- **Heartbeat** for an external dead-man's switch (e.g. healthchecks.io) so you learn if the whole VM goes down
- **Nightly encrypted backups** of the queue, WhatsApp login and pending attachments
- **Installable PWA** – "Add to Home Screen" for a full-screen phone app

## Run locally

```bash
npm install
npm start          # http://localhost:3000 – scan the QR (WhatsApp → Settings → Linked devices)
npm test           # unit tests: timezone maths, repeats, quick-add parser
```

Needs Node 22.13+. For voice-note conversion locally, install `ffmpeg` (the Docker image includes it).

## Configuration (environment variables)

| Variable | Default | Meaning |
|---|---|---|
| `PORT` | `3000` | HTTP port |
| `HOST` | `127.0.0.1` | Bind address (Docker uses `0.0.0.0`) |
| `DATA_DIR` | `./data` | WhatsApp session, SQLite queue, attachments, backups. **Keep on a persistent volume.** |
| `DEFAULT_TZ` | `UTC` | Timezone for messages that don't specify one (e.g. `Asia/Kolkata`) |
| `APP_PASSWORD` | _(none)_ | If set, HTTP basic auth with this password. Set it if the app is reachable from the public internet. |
| `MAX_LATE_MINUTES` | `120` | Messages overdue by more than this (server was off) are marked `missed` instead of sent. `0` = always send. |
| `BACKUP_PASSPHRASE` | _(none)_ | Enables nightly backups; 12+ characters. **Store a copy outside the server** – backups can't be opened without it. |
| `BACKUP_AT_UTC` / `BACKUP_KEEP` | `21:30` / `14` | Backup time (UTC) and how many to keep |
| `UPLOAD_MAX_MB` | `64` | Largest attachment. WhatsApp itself limits photos/videos/audio to ~16 MB (documents can be larger). |

Alerts, topic and heartbeat are configured in the app under **Settings** (stored in the database).

## Deploy to an Oracle Cloud Always Free VM

```bash
deploy/setup-vm.sh      # run ON the VM once (swap + Docker):  ssh ... 'bash -s' < deploy/setup-vm.sh
deploy/deploy.sh <vm-ip>  # run on your Mac: copies the app, builds the image, restarts the container
```

Put secrets in `~/whtapbot.env` **on the VM** (`BACKUP_PASSPHRASE=...`, `DEFAULT_TZ=...`); `deploy.sh` passes it to the container.
The app listens only on `127.0.0.1:3000` on the VM. Reach it through an SSH tunnel, or privately over Tailscale:

```bash
sudo tailscale serve --bg 3000      # on the VM → https://<machine>.<tailnet>.ts.net (tailnet devices only)
```

### Alerts

1. Install the free **ntfy** app and subscribe to your topic (Settings → Alerts shows/generates it; treat it like a password).
2. Press **Send test alert**.
3. To also detect the *VM itself* dying, create a free check on healthchecks.io (period 5 min, grace 5 min), add an ntfy
   notification to the same topic, and paste its ping URL into **Heartbeat URL**.

### Backups

The VM keeps the last 14 encrypted backups in `/data/backups`. To keep a copy off the VM, run on your Mac:

```bash
deploy/pull-backups.sh <vm-ip>     # saves the newest backup to ~/WhtapBotBackups (keeps 30)
```

Restore onto a fresh VM (before starting the container):

```bash
docker run --rm -v whtapbot-data:/data -v "$PWD":/b -e BACKUP_PASSPHRASE=... whtapbot \
  node src/restore.js /b/whtapbot-YYYYMMDD-HHMMSS.wbk /data
```

or locally: `BACKUP_PASSPHRASE=... node src/restore.js backup.wbk ./data`.

## Notes and risks

- Uses [Baileys](https://github.com/WhiskeySockets/Baileys), an **unofficial** WhatsApp Web client. It's against WhatsApp's
  terms; accounts that send bulk or unsolicited messages can be banned. Keep volume low and message people who know you.
- The session in `DATA_DIR/auth` (and any backup) is equivalent to being logged in to your WhatsApp. Treat it like a password.
- Delivery: if WhatsApp is disconnected a message stays queued; failed sends retry up to 4 times (after 5 s, 20 s, 60 s);
  a number not on WhatsApp fails immediately; a crash mid-send is flagged `failed` rather than risking a duplicate.
- Voice notes need ffmpeg; without it audio is sent as a normal audio file. Videos are sent as-is (MP4/H.264 plays best).
- Alerts go through the public ntfy.sh server (title + short reason, never message text); self-host ntfy and set the server in the API if you prefer.
- Regenerate the PWA icons with `node tools/make-icons.mjs`.
