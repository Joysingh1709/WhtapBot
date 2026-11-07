# WhtapBot

Self-hosted WhatsApp message scheduler (a Blueticks-style queue). You link your own WhatsApp
once by scanning a QR code; after that the server sends queued messages at their scheduled time.
It only keeps sending while the server process is running, so for "laptop closed" use, deploy it.

## Run locally

```bash
npm install
npm start
```

Open http://localhost:3000, scan the QR code (WhatsApp → Settings → Linked devices), then schedule messages.

## Configuration (environment variables)

| Variable | Default | Meaning |
|---|---|---|
| `PORT` | `3000` | HTTP port |
| `HOST` | `127.0.0.1` | Bind address (Docker uses `0.0.0.0`) |
| `DATA_DIR` | `./data` | WhatsApp session + SQLite queue. **Back this up / keep it on a persistent volume.** |
| `APP_PASSWORD` | _(none)_ | If set, the UI/API require HTTP basic auth with this password. **Always set this when deployed.** |
| `MAX_LATE_MINUTES` | `120` | Messages overdue by more than this (server was off) are marked `missed` instead of sent. `0` = always send. |

## Deploy so it runs with your laptop closed

Any host that runs a Docker container with a persistent volume works (Railway, Fly.io, a VPS):

```bash
docker build -t whtapbot .
docker run -d --restart unless-stopped -p 3000:3000 -v whtapbot-data:/data -e APP_PASSWORD=choose-a-password whtapbot
```

Then open the deployed URL, scan the QR once, and you're done. Use HTTPS (the host usually provides it)
since the password is sent via basic auth.

## Notes and risks

- Uses [Baileys](https://github.com/WhiskeySockets/Baileys), an **unofficial** WhatsApp Web client. It's against WhatsApp's
  terms; accounts that send bulk or unsolicited messages can be banned. Keep volume low and message people who know you.
- The session in `DATA_DIR/auth` is equivalent to being logged in to your WhatsApp. Treat it like a password.
- Delivery behaviour: if WhatsApp is disconnected the message stays queued; failed sends retry up to 4 times (after 5s, 20s, 60s), a number not on
  WhatsApp fails immediately; a crash mid-send is flagged `failed` rather than risking a duplicate.
