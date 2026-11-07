#!/usr/bin/env bash
# Run FROM your Mac: downloads the newest encrypted backup from the VM into ~/WhtapBotBackups (keeps the last 30).
# The files are AES-256 encrypted; you need the BACKUP_PASSPHRASE to restore them (see README).
# Usage: deploy/pull-backups.sh <vm-public-ip> [path-to-ssh-key]
set -euo pipefail
HOST="${1:?usage: pull-backups.sh <vm-ip> [ssh-key]}"
KEY="${2:-$HOME/.ssh/whtapbot_oracle}"
DEST="${WHTAPBOT_BACKUP_DIR:-$HOME/WhtapBotBackups}"
SSH="ssh -i $KEY -o BatchMode=yes -o ConnectTimeout=20"
mkdir -p "$DEST"

NAME=$($SSH "ubuntu@$HOST" 'curl -sf localhost:3000/api/backups' | python3 -c 'import sys,json; l=json.load(sys.stdin)["list"]; print(l[0]["name"] if l else "")')
[ -n "$NAME" ] || { echo "No backup exists on the VM yet."; exit 1; }
if [ -s "$DEST/$NAME" ]; then echo "Already have $NAME"; exit 0; fi
$SSH "ubuntu@$HOST" "curl -sf localhost:3000/api/backups/$NAME/download" > "$DEST/$NAME.tmp"
[ -s "$DEST/$NAME.tmp" ] || { rm -f "$DEST/$NAME.tmp"; echo "Download failed"; exit 1; }
mv "$DEST/$NAME.tmp" "$DEST/$NAME"
ls -1t "$DEST"/whtapbot-*.wbk 2>/dev/null | tail -n +31 | xargs -I{} rm -f {}
echo "Saved $DEST/$NAME ($(wc -c < "$DEST/$NAME") bytes)"
