#!/usr/bin/env bash
# One-time setup, run ON the Oracle VM (Ubuntu): adds swap (the free micro VM has ~1 GB RAM) and installs Docker.
set -euo pipefail
if ! swapon --show | grep -q /swapfile; then
  sudo fallocate -l 2G /swapfile
  sudo chmod 600 /swapfile
  sudo mkswap /swapfile >/dev/null
  sudo swapon /swapfile
  grep -q '/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab >/dev/null
fi
sudo apt-get update -y
sudo DEBIAN_FRONTEND=noninteractive apt-get install -y docker.io rsync
sudo systemctl enable --now docker
sudo usermod -aG docker "$USER"
echo "Setup complete."
