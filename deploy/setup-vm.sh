#!/usr/bin/env bash
# One-time setup, run ON the Oracle VM (Ubuntu): installs Docker.
set -euo pipefail
sudo apt-get update -y
sudo apt-get install -y docker.io rsync
sudo systemctl enable --now docker
sudo usermod -aG docker "$USER"
echo "Docker installed."
