#!/usr/bin/env bash
# Run FROM your Mac: copies the app to the VM, then builds and (re)starts the container.
# Usage: deploy/deploy.sh <vm-public-ip> [path-to-ssh-key]
# Settings live in ~/whtapbot.env ON THE VM (BACKUP_PASSPHRASE, DEFAULT_TZ, ...) and are picked up automatically.
set -euo pipefail
HOST="${1:?usage: deploy.sh <vm-ip> [ssh-key]}"
KEY="${2:-$HOME/.ssh/whtapbot_oracle}"
SSH="ssh -i $KEY -o StrictHostKeyChecking=accept-new"
cd "$(dirname "$0")/.."

rsync -az --delete -e "$SSH" --exclude node_modules --exclude data --exclude .git --exclude .env ./ "ubuntu@$HOST:whtapbot/"
$SSH "ubuntu@$HOST" 'cd whtapbot && sudo docker build -t whtapbot . \
  && (sudo docker rm -f whtapbot 2>/dev/null || true) \
  && ENVF=""; if [ -f "$HOME/whtapbot.env" ]; then ENVF="--env-file $HOME/whtapbot.env"; fi; \
     sudo docker run -d --name whtapbot --restart unless-stopped $ENVF \
       -p 127.0.0.1:3000:3000 -v whtapbot-data:/data whtapbot \
  && sleep 4 && sudo docker logs --tail 5 whtapbot'
echo
echo "Deployed. The app is behind the HTTPS reverse proxy at your PUBLIC_URL; for a private look without it, tunnel with:"
echo "  ssh -i $KEY -L 3001:localhost:3000 ubuntu@$HOST   then visit http://localhost:3001"
