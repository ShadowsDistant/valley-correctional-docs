#!/usr/bin/env bash
# One-shot deploy for the Valley Correctional Facility docs on a fresh Ubuntu
# droplet, behind Cloudflare. Idempotent — safe to re-run to update or to pick
# up a Cloudflare Origin Certificate.
#
#   curl -fsSL https://raw.githubusercontent.com/ShadowsDistant/valley-correctional-docs/main/deploy/bootstrap.sh -o bootstrap.sh
#   DOMAIN=docs.valleycorrectional.xyz bash bootstrap.sh
#
# TLS: if certs/origin.pem + certs/origin.key exist (a Cloudflare Origin
# Certificate), Caddy uses them (works with Cloudflare SSL "Full" AND "Full
# (strict)"). Otherwise it falls back to a self-signed cert (needs SSL = "Full").
#
# Optional env: DOMAIN, ADMIN_USERNAME, ADMIN_PASSWORD
set -euo pipefail

DOMAIN="${DOMAIN:-docs.valleycorrectional.xyz}"
APP_DIR="/opt/vcf-docs"
REPO="https://github.com/ShadowsDistant/valley-correctional-docs.git"
ADMIN_USERNAME="${ADMIN_USERNAME:-shadowsdistant}"

echo "==> [1/6] Docker"
if ! command -v docker >/dev/null 2>&1; then curl -fsSL https://get.docker.com | sh; fi

echo "==> [2/6] Firewall (allow SSH + web)"
if ! command -v ufw >/dev/null 2>&1; then apt-get update -y && apt-get install -y ufw || true; fi
if command -v ufw >/dev/null 2>&1; then
  ufw allow OpenSSH >/dev/null 2>&1 || true
  ufw allow 80/tcp  >/dev/null 2>&1 || true
  ufw allow 443/tcp >/dev/null 2>&1 || true
  ufw --force enable >/dev/null 2>&1 || true
fi

echo "==> [3/6] App source"
if [ -d "$APP_DIR/.git" ]; then git -C "$APP_DIR" pull --ff-only || true; else git clone "$REPO" "$APP_DIR"; fi
cd "$APP_DIR"

echo "==> [4/6] Config (.env)"
NEWPASS=0
if [ ! -f .env ]; then
  SECRET="$(openssl rand -hex 48)"
  PASS="${ADMIN_PASSWORD:-$(openssl rand -base64 18 | tr -dc 'A-Za-z0-9' | head -c 16)}"
  cat > .env <<EOF
PORT=3000
NODE_ENV=production
TRUST_PROXY=1
SITE_URL=https://$DOMAIN
SESSION_SECRET=$SECRET
ADMIN_USERNAME=$ADMIN_USERNAME
ADMIN_PASSWORD=$PASS
EOF
  echo "$PASS" > /root/vcf-admin-password.txt
  NEWPASS=1
fi

echo "==> [5/6] Web server (Caddy)"
if [ -s "$APP_DIR/certs/origin.pem" ] && [ -s "$APP_DIR/certs/origin.key" ]; then
  TLS_DIRECTIVE="tls /certs/origin.pem /certs/origin.key"
  CERT_MOUNT="      - ./certs:/certs:ro"
  echo "    ✔ Using Cloudflare Origin Certificate (compatible with SSL 'Full' and 'Full (strict)')."
else
  TLS_DIRECTIVE="tls internal"
  CERT_MOUNT=""
  echo "    Using a self-signed cert — set Cloudflare SSL mode to 'Full'."
  echo "    (To use a Cloudflare Origin Certificate: put it in $APP_DIR/certs/origin.pem"
  echo "     + $APP_DIR/certs/origin.key and re-run this script.)"
fi
cat > Caddyfile.live <<EOF
$DOMAIN {
	encode gzip zstd
	$TLS_DIRECTIVE
	reverse_proxy app:3000
}
EOF
cat > docker-compose.live.yml <<EOF
services:
  app:
    build: .
    restart: unless-stopped
    env_file: .env
    volumes: [ "./data:/app/data" ]
    expose: [ "3000" ]
  caddy:
    image: caddy:2
    restart: unless-stopped
    depends_on: [ app ]
    ports: [ "80:80", "443:443" ]
    volumes:
      - ./Caddyfile.live:/etc/caddy/Caddyfile:ro
$CERT_MOUNT
      - ./caddy_data:/data
      - ./caddy_config:/config
EOF

echo "==> [6/6] Build & start (first build takes a few minutes)"
docker compose -f docker-compose.live.yml up -d --build

# Optional post-start tasks:
#   RESET_ADMIN_PASSWORD=...  reset the admin password
#   SYNC_CONTENT=1            re-import the shipped docs into the database
#                            (overwrites any pages edited in the app — use when
#                             deploying updated documentation)
if [ -n "${RESET_ADMIN_PASSWORD:-}" ] || [ "${SYNC_CONTENT:-}" = "1" ]; then
  echo "==> Applying post-start tasks (waiting for the app to be ready)"
  sleep 8
fi
if [ -n "${RESET_ADMIN_PASSWORD:-}" ]; then
  echo "==> Resetting admin password"
  docker compose -f docker-compose.live.yml exec -T -e RESET_ADMIN_PASSWORD="$RESET_ADMIN_PASSWORD" app node scripts/reset-admin.js \
    || echo "    (retry: docker compose -f docker-compose.live.yml exec -e RESET_ADMIN_PASSWORD='...' app node scripts/reset-admin.js)"
fi
if [ "${SYNC_CONTENT:-}" = "1" ]; then
  echo "==> Importing shipped documentation into the database"
  docker compose -f docker-compose.live.yml exec -T app node scripts/sync-content.js \
    || echo "    (retry: docker compose -f docker-compose.live.yml exec app node scripts/sync-content.js)"
fi

echo
echo "===================================================================="
echo " ✅ App is running on the droplet at https://$DOMAIN (via Cloudflare)."
if [ "$NEWPASS" = "1" ]; then
  echo "    Admin username: $ADMIN_USERNAME"
  echo "    Admin password: $(grep '^ADMIN_PASSWORD=' .env | cut -d= -f2-)"
  echo "    (also saved to /root/vcf-admin-password.txt — delete after first login)"
fi
echo "===================================================================="
