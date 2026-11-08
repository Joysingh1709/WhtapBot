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
- **MCP server with OAuth sign-in** – connect an AI assistant and just say "message Mom happy birthday tomorrow at 9" (see below)
- **Google sign-in** – the app is public on the internet but only your Google account gets in; sessions persist across restarts
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
| `MAX_LATE_MINUTES` | `120` | Messages overdue by more than this (server was off) are marked `missed` instead of sent. `0` = always send. |
| `BACKUP_PASSPHRASE` | _(none)_ | Enables nightly backups; 12+ characters. **Store a copy outside the server** – backups can't be opened without it. |
| `BACKUP_AT_UTC` / `BACKUP_KEEP` | `21:30` / `14` | Backup time (UTC) and how many to keep |
| `PUBLIC_URL` | _(none)_ | The public https address, e.g. `https://whtapbot.duckdns.org`. Required when sign-in is on. |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | _(none)_ | A Google OAuth *web* client. **Setting the client id turns sign-in on**; without it the app is open (fine on localhost only). Redirect URI: `<PUBLIC_URL>/auth/google/callback`. |
| `ALLOWED_EMAILS` | _(none)_ | Comma-separated Google accounts allowed in. Everyone else is refused. |
| `MCP_TOKEN` | _(none)_ | Optional static bearer token for `/mcp` (scripts, local clients). OAuth sign-in works without it. |
| `UPLOAD_MAX_MB` | `64` | Largest attachment. WhatsApp itself limits photos/videos/audio to ~16 MB (documents can be larger). |

Alerts, topic and heartbeat are configured in the app under **Settings** (stored in the database).

## Deploy to an Oracle Cloud Always Free VM

```bash
deploy/setup-vm.sh      # run ON the VM once (swap + Docker):  ssh ... 'bash -s' < deploy/setup-vm.sh
deploy/deploy.sh <vm-ip>  # run on your Mac: copies the app, builds the image, restarts the container
```

Secrets and settings live in `~/whtapbot.env` **on the VM** (`BACKUP_PASSPHRASE`, `DEFAULT_TZ`, `PUBLIC_URL`, `GOOGLE_CLIENT_ID`,
`GOOGLE_CLIENT_SECRET`, `ALLOWED_EMAILS`, …); `deploy.sh` passes it to the container. The app itself listens only on
`127.0.0.1:3000`; a reverse proxy on the VM terminates HTTPS.

### Public HTTPS address (free)

1. **Name:** create a free subdomain at [duckdns.org](https://www.duckdns.org) and point it at the VM's public IP.
2. **Ports:** allow TCP 80 and 443 in the VCN's security list (Oracle console) and in the VM firewall
   (`sudo iptables -I INPUT 6 -p tcp -m multiport --dports 80,443 -j ACCEPT && sudo netfilter-persistent save`).
3. **HTTPS:** run Caddy; it fetches and renews the certificate by itself:
   ```bash
   mkdir -p ~/caddy && printf 'whtapbot.duckdns.org {\n\tencode zstd gzip\n\treverse_proxy 127.0.0.1:3000\n}\n' > ~/caddy/Caddyfile
   sudo docker run -d --name caddy --restart unless-stopped --network host \
     -v ~/caddy/Caddyfile:/etc/caddy/Caddyfile:ro -v caddy_data:/data -v caddy_config:/config caddy:2
   ```
4. **Sign-in:** in Google Cloud Console create an OAuth client (type *Web application*) with redirect URI
   `https://<your-name>.duckdns.org/auth/google/callback`, add your Google account as a test user, and put the client id/secret,
   `PUBLIC_URL` and `ALLOWED_EMAILS` in `~/whtapbot.env`. **Do not start the proxy before sign-in is configured** – without a client id
   the app has no login.

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

## Use it from an AI assistant (MCP)

WhtapBot is an MCP server at `<PUBLIC_URL>/mcp`, so an assistant can schedule, list, edit, cancel and send messages for you.
Tools: `whatsapp_status`, `find_contact`, `schedule_message`, `list_scheduled_messages`, `update_scheduled_message`,
`cancel_scheduled_message`, `send_message_now`. Attachments are not available through MCP.

**Connectors with OAuth (recommended).** Add a custom connector / remote MCP server in your assistant and give it
`https://<your-name>.duckdns.org/mcp`. The assistant discovers the OAuth endpoints itself, registers, and opens a browser tab:
sign in with Google, press **Allow**, done. Access tokens last an hour and refresh automatically for 90 days; everything is stored on
the data volume, so redeploys don't disconnect it.

**Static token (scripts, local clients).** Set `MCP_TOKEN` and send `Authorization: Bearer <token>`. For clients that only launch local
commands, `tools/mcp-stdio.mjs` bridges stdio to the endpoint:

```json
{ "mcpServers": { "whtapbot": {
    "command": "node", "args": ["/path/to/WhtapBot/tools/mcp-stdio.mjs"],
    "env": { "WHTAPBOT_MCP_URL": "https://<your-name>.duckdns.org/mcp", "WHTAPBOT_MCP_TOKEN": "<token>" } } } }
```

The OAuth server (`src/auth.js`) implements discovery (RFC 9728 / 8414), dynamic client registration (RFC 7591), authorization code +
PKCE (S256 only), consent, refresh-token rotation. `npm test` exercises the whole flow against a fake Google.

## Notes and risks

- Uses [Baileys](https://github.com/WhiskeySockets/Baileys), an **unofficial** WhatsApp Web client. It's against WhatsApp's
  terms; accounts that send bulk or unsolicited messages can be banned. Keep volume low and message people who know you.
- Because the app is on the public internet, the Google sign-in is the only lock. Keep `ALLOWED_EMAILS` to yourself and keep the OAuth client secret private.
- The session in `DATA_DIR/auth` (and any backup) is equivalent to being logged in to your WhatsApp. Treat it like a password.
- Delivery: if WhatsApp is disconnected a message stays queued; failed sends retry up to 4 times (after 5 s, 20 s, 60 s);
  a number not on WhatsApp fails immediately; a crash mid-send is flagged `failed` rather than risking a duplicate.
- Voice notes need ffmpeg; without it audio is sent as a normal audio file. Videos are sent as-is (MP4/H.264 plays best).
- Alerts go through the public ntfy.sh server (title + short reason, never message text); self-host ntfy and set the server in the API if you prefer.
- Regenerate the PWA icons with `node tools/make-icons.mjs`.
