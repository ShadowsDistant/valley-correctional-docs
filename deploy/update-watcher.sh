#!/usr/bin/env bash
# Valley Correctional Facility docs — host-side update watcher.
#
# WHY THIS EXISTS
#   The app runs in a container with no Docker socket mounted (deliberately —
#   the socket is root-equivalent on the host, so exposing it to a web app is a
#   privilege-escalation risk). The container therefore cannot rebuild itself.
#   Admin → System writes a request file into the mounted ./data volume; this
#   script runs on the HOST, performs the real update, and writes the result
#   back so the admin page can report it.
#
# USAGE
#   sudo ./deploy/update-watcher.sh install    # set it up (systemd timer, or cron)
#   sudo ./deploy/update-watcher.sh status     # show what's configured + why not
#   sudo ./deploy/update-watcher.sh tick       # one pass (what the timer runs)
#   sudo ./deploy/update-watcher.sh uninstall
#
# Running with no arguments does a tick and prints what it did.
set -uo pipefail

# Resolve the app directory from THIS script's location (…/deploy/x.sh -> …),
# so it works wherever the repo lives — not just /opt/vcf-docs.
SELF="$(readlink -f "${BASH_SOURCE[0]}")"
SELF_DIR="$(dirname "$SELF")"
APP_DIR="${APP_DIR:-$(dirname "$SELF_DIR")}"
BRANCH="${BRANCH:-main}"

DATA="$APP_DIR/data"
REQ="$DATA/update-request.json"
STATUS="$DATA/update-status.json"
BUILD="$DATA/build.json"
BEAT="$DATA/updater-alive"
LOCK="$DATA/.update.lock"

SVC=/etc/systemd/system/vcf-update.service
TMR=/etc/systemd/system/vcf-update.timer

say() { printf '%s\n' "$*"; }
die() { printf 'error: %s\n' "$*" >&2; exit 1; }
have() { command -v "$1" >/dev/null 2>&1; }

# Pick the compose file that actually exists (Cloudflare stack or plain).
compose_file() {
  if [ -n "${COMPOSE_FILE:-}" ]; then printf '%s' "$COMPOSE_FILE"; return; fi
  for f in docker-compose.cloudflare.yml docker-compose.yml; do
    [ -f "$APP_DIR/$f" ] && { printf '%s' "$f"; return; }
  done
  printf '%s' 'docker-compose.yml'
}

# Total RAM + swap in MB — the Docker build compiles better-sqlite3 natively,
# which needs roughly 1.5GB of headroom. 1GB droplets OOM without swap.
mem_budget_mb() {
  awk '/^MemTotal:/{m=$2} /^SwapTotal:/{s=$2} END{printf "%d", (m+s)/1024}' /proc/meminfo 2>/dev/null || echo 9999
}

esc() { printf '%s' "$1" | tr -d '\r' | tr '\n' ' ' | sed 's/\\/\\\\/g; s/"/\\"/g' | cut -c1-600; }
now() { date -u +%Y-%m-%dT%H:%M:%SZ; }
sha() { git -C "$APP_DIR" rev-parse --short HEAD 2>/dev/null || echo unknown; }
write_status() { # $1=state $2=detail
  printf '{"state":"%s","at":"%s","detail":"%s","commit":"%s"}\n' \
    "$1" "$(now)" "$(esc "$2")" "$(sha)" > "$STATUS"
}

# ---------------------------------------------------------------- tick ------
tick() {
  local verbose="${1:-}"
  mkdir -p "$DATA" || die "cannot create $DATA"
  touch "$BEAT"                # heartbeat — the admin page reads this
  [ -n "$verbose" ] && say "heartbeat: $BEAT"

  if [ ! -f "$REQ" ]; then
    [ -n "$verbose" ] && say "no update queued — nothing to do (this is normal)"
    return 0
  fi

  exec 9>"$LOCK"
  flock -n 9 || { [ -n "$verbose" ] && say "another update is already running"; return 0; }

  rm -f "$REQ"                 # consume first: a failure must not loop forever
  say "update requested — starting"
  write_status running "Pulling $BRANCH…"

  cd "$APP_DIR" || { write_status error "APP_DIR $APP_DIR not found"; die "APP_DIR missing"; }
  have git || { write_status error "git is not installed on the host"; die "git missing"; }
  git -C "$APP_DIR" rev-parse --git-dir >/dev/null 2>&1 || {
    write_status error "$APP_DIR is not a git checkout — deploy with git clone to use this button"
    die "not a git repo"
  }

  local out prev
  prev="$(sha)"                # remember where we were, to list what this update brings
  out=$(git -C "$APP_DIR" fetch --all 2>&1) || { write_status error "git fetch failed: $out"; die "git fetch failed"; }
  out=$(git -C "$APP_DIR" reset --hard "origin/$BRANCH" 2>&1) || { write_status error "git reset failed: $out"; die "git reset failed"; }
  say "pulled: $prev -> $(sha)"

  # Every commit subject between the old and new HEAD, as a JSON array — this is
  # the changelog Admin → System shows for the update.
  local changes
  changes=$(git -C "$APP_DIR" log --no-merges --pretty=%s "$prev..HEAD" 2>/dev/null \
    | head -40 \
    | while IFS= read -r line; do printf '"%s",' "$(esc "$line")"; done)
  changes="[${changes%,}]"

  # Record the deployed build so Admin → System shows the real commit.
  # `released` is the commit's own date (when the change was authored/pushed);
  # `time` is when this host actually applied it — they are not the same thing.
  printf '{"commit":"%s","branch":"%s","subject":"%s","time":"%s","released":"%s","previous":"%s","changes":%s}\n' \
    "$(sha)" "$(esc "$BRANCH")" \
    "$(esc "$(git -C "$APP_DIR" log -1 --pretty=%s 2>/dev/null || echo '')")" \
    "$(now)" \
    "$(git -C "$APP_DIR" log -1 --pretty=%cI 2>/dev/null || echo '')" \
    "$prev" \
    "$changes" > "$BUILD"

  have docker || { write_status error "docker is not installed on the host"; die "docker missing"; }
  write_status running "Rebuilding containers…"
  local cf; cf="$(compose_file)"
  say "rebuilding with $cf"
  local memnote=""
  if [ "$(mem_budget_mb)" -lt 1600 ]; then
    memnote=" (low memory host — if this fails, add swap: see deploy/update-watcher.sh --help)"
    say "warning: only $(mem_budget_mb)MB RAM+swap — the native build may be tight"
  fi
  out=$(docker compose -f "$cf" up -d --build 2>&1) || {
    # An OOM-killed compile is the classic failure on small droplets; say so.
    if printf '%s' "$out" | grep -qiE 'killed|out of memory|signal 9|cannot allocate'; then
      write_status error "Build ran out of memory on this host. Add swap (see below) and retry.$memnote"
    else
      write_status error "docker compose failed: $out"
    fi
    die "compose failed"
  }

  write_status ok "Updated to $(sha) — $(git -C "$APP_DIR" log -1 --pretty=%s 2>/dev/null)"
  say "done: $(sha)"
}

# ------------------------------------------------------------- install ------
install_systemd() {
  cat > "$SVC" <<EOF
[Unit]
Description=VCF docs update watcher
[Service]
Type=oneshot
ExecStart=$SELF tick
EOF
  cat > "$TMR" <<EOF
[Unit]
Description=Run the VCF docs update watcher every minute
[Timer]
OnBootSec=30
OnUnitActiveSec=60
AccuracySec=10
[Install]
WantedBy=timers.target
EOF
  systemctl daemon-reload || return 1
  systemctl enable --now vcf-update.timer || return 1
  return 0
}
install_cron() {
  local line="* * * * * $SELF tick >> /var/log/vcf-update.log 2>&1"
  ( crontab -l 2>/dev/null | grep -Fv "$SELF"; printf '%s\n' "$line" ) | crontab - || return 1
  have systemctl && systemctl enable --now cron >/dev/null 2>&1
  return 0
}
do_install() {
  [ "$(id -u)" -eq 0 ] || die "run as root:  sudo $SELF install"
  chmod +x "$SELF"
  mkdir -p "$DATA"
  say "app directory: $APP_DIR"
  say "compose file : $(compose_file)"

  # Drop any earlier hand-added cron line for this script so we don't end up
  # double-scheduled (a systemd timer AND cron both ticking).
  if have crontab && crontab -l 2>/dev/null | grep -Fq "update-watcher.sh"; then
    ( crontab -l 2>/dev/null | grep -Fv "update-watcher.sh" ) | crontab -
    say "removed a previous cron entry for this script"
  fi

  if have systemctl && install_systemd; then
    say "installed: systemd timer vcf-update.timer (runs every minute)"
  elif have crontab && install_cron; then
    say "installed: cron entry (runs every minute) — systemd unavailable"
  else
    die "could not install: neither systemctl nor crontab worked. Run '$SELF tick' from your own scheduler."
  fi

  tick verbose                 # prove it works immediately
  say ""
  say "Done. Admin → System should show 'updater online' within a few seconds."
  do_status
}
do_uninstall() {
  [ "$(id -u)" -eq 0 ] || die "run as root:  sudo $SELF uninstall"
  if have systemctl; then systemctl disable --now vcf-update.timer >/dev/null 2>&1; rm -f "$SVC" "$TMR"; systemctl daemon-reload; fi
  have crontab && ( crontab -l 2>/dev/null | grep -Fv "$SELF" ) | crontab -
  rm -f "$BEAT"
  say "uninstalled."
}

# -------------------------------------------------------------- status ------
do_status() {
  say "app dir      : $APP_DIR"
  say "data dir     : $DATA $([ -d "$DATA" ] && echo '(ok)' || echo '(MISSING)')"
  say "git checkout : $(git -C "$APP_DIR" rev-parse --git-dir >/dev/null 2>&1 && echo "yes ($(sha))" || echo 'NO — the update button needs a git clone')"
  say "docker       : $(have docker && echo yes || echo 'NO')"
  say "compose file : $(compose_file)"
  local mb; mb="$(mem_budget_mb)"
  if [ "$mb" -lt 1600 ]; then
    say "memory       : ${mb}MB RAM+swap — TIGHT. The image build compiles better-sqlite3"
    say "               and may be OOM-killed. Add 2GB of swap once:"
    say "                 sudo fallocate -l 2G /swapfile && sudo chmod 600 /swapfile"
    say "                 sudo mkswap /swapfile && sudo swapon /swapfile"
    say "                 echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab"
  else
    say "memory       : ${mb}MB RAM+swap (ok for the native build)"
  fi
  if have systemctl && systemctl list-unit-files 2>/dev/null | grep -q '^vcf-update.timer'; then
    say "schedule     : systemd timer — $(systemctl is-active vcf-update.timer 2>/dev/null)"
    systemctl list-timers vcf-update.timer --no-pager 2>/dev/null | sed -n '2p'
  elif have crontab && crontab -l 2>/dev/null | grep -Fq "$SELF"; then
    say "schedule     : cron — $(crontab -l 2>/dev/null | grep -F "$SELF")"
  else
    say "schedule     : NOT INSTALLED — run: sudo $SELF install"
  fi
  if [ -f "$BEAT" ]; then
    say "heartbeat    : $(date -u -r "$BEAT" +%Y-%m-%dT%H:%M:%SZ) (admin page shows 'online' if < 5 min old)"
  else
    say "heartbeat    : none yet"
  fi
  [ -f "$STATUS" ] && say "last result  : $(cat "$STATUS")"
}

case "${1:-tick}" in
  install)   do_install ;;
  uninstall) do_uninstall ;;
  status)    do_status ;;
  tick)      tick "${2:-}" ;;
  *)         tick verbose ;;
esac
