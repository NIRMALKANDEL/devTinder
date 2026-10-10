#!/usr/bin/env bash
# Added: one-command deploy, run ON THE EC2 SERVER (not on your laptop):
#   bash ~/devTinder/scripts/deploy-server.sh
# Pulls both repos, installs, runs the DB migration, restarts the API, checks
# /health, builds the frontend and publishes it (keeping a backup of the old site).
# Stops at the first error. nginx changes (see README) are still done by hand.
set -euo pipefail

BACKEND_DIR="${BACKEND_DIR:-$HOME/devTinder}"
FRONTEND_DIR="${FRONTEND_DIR:-$HOME/devTinder-web}"
PM2_APP="${PM2_APP:-devTinderBackend}"
WEB_ROOT="${WEB_ROOT:-/var/www/html}"
STAMP="$(date +%Y%m%d-%H%M%S)"

# pm2 / node live under nvm
export NVM_DIR="$HOME/.nvm"
# shellcheck disable=SC1091
[ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"

require_clean() {
  if [ -n "$(git status --porcelain --untracked-files=no)" ]; then
    echo "!! $(pwd) has local changes. Commit, stash or reset them first:"
    git status --short --untracked-files=no
    exit 1
  fi
}

echo "== Backend =="
cd "$BACKEND_DIR"
require_clean
git pull --ff-only origin main
npm ci --omit=dev   # exact lockfile versions; never rewrites package-lock.json
npm run migrate:pair-keys
pm2 restart "$PM2_APP" --update-env
sleep 4
if curl -fsS http://localhost:7777/health; then
  echo
else
  echo "!! API health check failed. Recent logs:"
  pm2 logs "$PM2_APP" --lines 40 --nostream
  exit 1
fi

echo "== Frontend =="
cd "$FRONTEND_DIR"
require_clean
git pull --ff-only origin main
npm ci
npm run build
mkdir -p "$HOME/html-backup-$STAMP"
sudo cp -r "$WEB_ROOT"/. "$HOME/html-backup-$STAMP"/
sudo cp -r dist/. "$WEB_ROOT"/
sudo nginx -t && sudo systemctl reload nginx

echo "== Done =="
echo "Old site backed up to ~/html-backup-$STAMP"
echo "Rollback frontend: sudo cp -r ~/html-backup-$STAMP/. $WEB_ROOT/"
echo "Then purge the Cloudflare cache if the old version still shows."
