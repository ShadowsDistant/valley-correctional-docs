#!/usr/bin/env bash
# Valley Correctional Facility docs — host-side update watcher.
#
# WHY THIS EXISTS
#   The app runs in a container with no Docker socket mounted (deliberately —
#   the socket is root-equivalent on the host, so exposing it to a web app is a
#   privilege-escalation risk). The container therefore cannot rebuild itself.
#   Instead, Admin → System writes a request file into the mounted ./data
#   volume; this script runs on the HOST, performs the real update, and writes
#   the result back so the admin page can report it.
#
# INSTALL (one time, as root on the droplet):
#   chmod +x /opt/vcf-docs/deploy/update-watcher.sh
#   ( crontab -l 2>/dev/null; echo '* * * * * /opt/vcf-docs/deploy/update-watcher.sh >> /var/log/vcf-update.log 2>&1' ) | crontab -
#
# It also touches a heartbeat every run; if the heartbeat is missing/stale the
# admin page says the updater isn't installed instead of pretending to work.
set -uo pipefail

APP_DIR="${APP_DIR:-/opt/vcf-docs}"
COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.cloudflare.yml}"
BRANCH="${BRANCH:-main}"

DATA="$APP_DIR/data"
REQ="$DATA/update-request.json"
STATUS="$DATA/update-status.json"
BUILD="$DATA/build.json"
BEAT="$DATA/updater-alive"
LOCK="$DATA/.update.lock"

mkdir -p "$DATA"
touch "$BEAT"                 # heartbeat — proves the watcher is installed
[ -f "$REQ" ] || exit 0       # nothing queued

# Never run two updates at once.
exec 9>"$LOCK"
flock -n 9 || exit 0

esc() { printf '%s' "$1" | tr -d '\r' | tr '\n' ' ' | sed 's/\\/\\\\/g; s/"/\\"/g' | cut -c1-600; }
now() { date -u +%Y-%m-%dT%H:%M:%SZ; }
sha() { git -C "$APP_DIR" rev-parse --short HEAD 2>/dev/null || echo unknown; }

write_status() { # $1=state  $2=detail
  printf '{"state":"%s","at":"%s","detail":"%s","commit":"%s"}\n' \
    "$1" "$(now)" "$(esc "$2")" "$(sha)" > "$STATUS"
}

# Consume the request first so a failing update can't loop forever.
rm -f "$REQ"
write_status running "Pulling $BRANCH…"

cd "$APP_DIR" || { write_status error "APP_DIR $APP_DIR not found"; exit 1; }

out=$(git fetch --all 2>&1 && git reset --hard "origin/$BRANCH" 2>&1)
if [ $? -ne 0 ]; then
  write_status error "git failed: $out"
  exit 1
fi

# Record what we just deployed so the admin page can show the real build.
printf '{"commit":"%s","branch":"%s","subject":"%s","time":"%s"}\n' \
  "$(sha)" "$(esc "$BRANCH")" \
  "$(esc "$(git -C "$APP_DIR" log -1 --pretty=%s 2>/dev/null || echo '')")" \
  "$(now)" > "$BUILD"

write_status running "Rebuilding containers…"
out=$(docker compose -f "$COMPOSE_FILE" up -d --build 2>&1)
if [ $? -ne 0 ]; then
  write_status error "docker compose failed: $out"
  exit 1
fi

write_status ok "Updated to $(sha) — $(git -C "$APP_DIR" log -1 --pretty=%s 2>/dev/null)"
