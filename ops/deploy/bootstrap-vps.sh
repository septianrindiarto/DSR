#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# DSR Solution — one-time setup of a FRESH Ubuntu 22.04 / 24.04 VPS.
# Run as root:   bash bootstrap-vps.sh
# Safe to re-run (each step checks before it acts).
#
# Installs: Node 22 (NodeSource), PM2, nginx, certbot, ufw, fail2ban, git.
# Creates:  user "dsr", /var/lib/dsr/{uploads,uploads-private,backups},
#           /var/log/pm2, 2 GB swap (small VPS builds need it), WIB timezone.
# Does NOT touch the database, the code, DNS or TLS — see the runbook.
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

if [ "$(id -u)" -ne 0 ]; then echo "Run as root."; exit 1; fi
echo "== DSR VPS bootstrap =="

# 1. Base packages + security updates
export DEBIAN_FRONTEND=noninteractive
apt-get update -y
apt-get upgrade -y
apt-get install -y curl git nginx ufw fail2ban ca-certificates gnupg unattended-upgrades \
                   certbot python3-certbot-nginx postgresql-client rsync
dpkg-reconfigure -f noninteractive unattended-upgrades || true

# 2. Timezone (jobs run on WIB)
timedatectl set-timezone Asia/Jakarta || true

# 3. Swap (2 GB) — `npm run build` can run out of memory on 1–2 GB VPS
if ! swapon --show | grep -q '/swapfile'; then
  fallocate -l 2G /swapfile && chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile
  grep -q '/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi

# 4. Node 22 + PM2
if ! command -v node >/dev/null || ! node -v | grep -q '^v22'; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -y nodejs
fi
npm install -g pm2@latest
node -v && npm -v && pm2 -v

# 5. App user
if ! id dsr >/dev/null 2>&1; then
  adduser --disabled-password --gecos "DSR app" dsr
fi
# nginx (www-data) must be able to traverse /home/dsr to read the web build
chmod o+x /home/dsr
# reuse root's SSH keys for the dsr user (so "ssh dsr@<ip>" works)
if [ -f /root/.ssh/authorized_keys ]; then
  mkdir -p /home/dsr/.ssh && cp /root/.ssh/authorized_keys /home/dsr/.ssh/authorized_keys
  chown -R dsr:dsr /home/dsr/.ssh && chmod 700 /home/dsr/.ssh && chmod 600 /home/dsr/.ssh/authorized_keys
fi

# 6. Data folders (outside the code folder, so deploys never touch them)
mkdir -p /var/lib/dsr/uploads /var/lib/dsr/uploads-private /var/lib/dsr/backups /var/log/pm2
chown -R dsr:dsr /var/lib/dsr /var/log/pm2
chmod 750 /var/lib/dsr/uploads-private /var/lib/dsr/backups

# 7. Firewall: SSH + HTTP + HTTPS only
ufw allow OpenSSH
ufw allow 'Nginx Full'
ufw --force enable
systemctl enable --now fail2ban

# 8. nginx default site off (our site is added in the runbook)
rm -f /etc/nginx/sites-enabled/default
systemctl enable --now nginx

echo
echo "== Done. Next: follow docs/Redeploy_2026-10_Runbook.md from step 4 (as user dsr). =="
