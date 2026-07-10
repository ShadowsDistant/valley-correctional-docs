#!/usr/bin/env bash
# One-shot deploy for the Valley Correctional Facility docs on a fresh Ubuntu
# droplet, behind Cloudflare. Idempotent — safe to re-run to update.
#
#   curl -fsSL https://raw.githubusercontent.com/ShadowsDistant/valley-correctional-docs/main/deploy/bootstrap.sh -o bootstrap.sh
#   DOMAIN=docs.valleycorrectional.xyz bash bootstrap.sh
#
# Optional env: DOMAIN, ADMIN_USERNAME, ADMIN_EMAIL, ADMIN_PASSWORD
set -euo pipefail

DOMAIN="${DOMAIN:-docs.valleycorrectional.xyz}"
APP_DIR="/opt/vcf-docs"
REPO="https://github.com/ShadowsDistant/valley-correctional-docs.git"
ADMIN_USERNAME="${ADMIN_USERNAME:-shadowsdistant}"
ADMIN_EMAIL="${ADMIN_EMAIL:-shadowsdistant@gmail.com}"

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
ADMIN_EMAIL=$ADMIN_EMAIL
ADMIN_PASSWORD=$PASS
EOF
  echo "$PASS" > /root/vcf-admin-password.txt
  NEWPASS=1
fi

echo "==> [5/6] Web server (Caddy, self-signed origin cert; pair with Cloudflare SSL = Full)"
cat > Caddyfile.live <<EOF
$DOMAIN {
	encode gzip zstd
	tls internal
	reverse_proxy app:3000
}
EOF
cat > docker-compose.live.yml <<'YML'
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
      - ./caddy_data:/data
      - ./caddy_config:/config
YML

echo "==> [6/6] Build & start (first build takes a few minutes)"
docker compose -f docker-compose.live.yml up -d --build

echo
echo "===================================================================="
echo " ✅ App is running on the droplet."
if [ "$NEWPASS" = "1" ]; then
  echo "    Admin username: $ADMIN_USERNAME"
  echo "    Admin password: $(grep '^ADMIN_PASSWORD=' .env | cut -d= -f2-)"
  echo "    (also saved to /root/vcf-admin-password.txt — delete after login)"
fi
echo
echo " NEXT — in the Cloudflare dashboard for your domain:"
echo "   1. DNS -> Add an A record:  name 'docs'  ->  this droplet's IP,  Proxied (orange)."
echo "   2. SSL/TLS -> Overview -> set encryption mode to 'Full'."
echo "   3. (optional) SSL/TLS -> Edge Certificates -> enable 'Always Use HTTPS'."
echo
echo " Then open:  https://$DOMAIN   and log in."
echo "===================================================================="
