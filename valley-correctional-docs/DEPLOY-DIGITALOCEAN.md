# Deploy to DigitalOcean, reachable on your Cloudflare domain

A complete walkthrough: put the app on a DigitalOcean Droplet with Docker, then
serve it at `docs.valleycorrectional.xyz` through Cloudflare with real HTTPS.

**Time:** ~20–30 minutes. **Cost:** ~$6/month (smallest Droplet).

You'll do everything as a few copy‑paste commands. Replace
`docs.valleycorrectional.xyz` with your domain and `YOUR_DROPLET_IP` with the
Droplet's IP wherever they appear.

---

## Step 1 — Create the Droplet

1. Log in to DigitalOcean → **Create → Droplets**.
2. **Choose an image:** Ubuntu **24.04 (LTS)**.
3. **Choose size:** Basic → Regular → the **$6/mo** option (1 GB / 1 CPU) is enough.
4. **Choose a region** close to your players.
5. **Authentication:** pick **SSH Key** (recommended) and add your public key, or choose Password and set a strong one.
6. **Hostname:** e.g. `vcf-docs`. Click **Create Droplet**.
7. Copy the Droplet's **public IPv4 address** → this is `YOUR_DROPLET_IP`.

## Step 2 — Connect and install Docker

From your computer's terminal:

```bash
ssh root@YOUR_DROPLET_IP
```

Then on the Droplet:

```bash
# install Docker + Compose
curl -fsSL https://get.docker.com | sh

# basic firewall: allow SSH + web
apt-get install -y ufw
ufw allow OpenSSH
ufw allow 80/tcp
ufw allow 443/tcp
ufw --force enable
```

## Step 3 — Get the app onto the Droplet

**Option A — from GitHub** (if you've pushed the repo):

```bash
git clone https://github.com/<you>/valley-correctional-docs.git /opt/vcf-docs
cd /opt/vcf-docs
```

**Option B — copy from your PC** (run this on *your computer*, not the Droplet):

```bash
scp -r "C:/Users/shado/OneDrive/Documents/AI/valley-correctional-docs" root@YOUR_DROPLET_IP:/opt/vcf-docs
```

Then back on the Droplet: `cd /opt/vcf-docs`.

## Step 4 — Point your Cloudflare domain at the Droplet

In the **Cloudflare dashboard** → your domain → **DNS → Records → Add record**:

| Field | Value |
| --- | --- |
| Type | **A** |
| Name | `docs` (for `docs.yourdomain`) or `@` for the root |
| IPv4 address | `YOUR_DROPLET_IP` |
| Proxy status | **Proxied** (orange cloud) ✅ |
| TTL | Auto |

Proxied means Cloudflare handles edge HTTPS, hides your Droplet's IP, and gives
you DDoS protection.

## Step 5 — Create a Cloudflare Origin Certificate

This lets Caddy serve HTTPS to Cloudflare without fighting the proxy over Let's Encrypt.

1. Cloudflare dashboard → **SSL/TLS → Origin Server → Create Certificate**.
2. Leave defaults (RSA, hostnames `docs.yourdomain.com` + `*.yourdomain.com`), **Create**.
3. You'll see two boxes. On the Droplet, save them into a `certs` folder:

```bash
mkdir -p /opt/vcf-docs/certs
nano /opt/vcf-docs/certs/origin.pem     # paste the "Origin Certificate" box, save (Ctrl+O, Enter, Ctrl+X)
nano /opt/vcf-docs/certs/origin.key     # paste the "Private Key" box, save
chmod 600 /opt/vcf-docs/certs/origin.key
```

4. Cloudflare dashboard → **SSL/TLS → Overview** → set encryption mode to **Full (strict)**.
5. (Recommended) **SSL/TLS → Edge Certificates** → turn on **Always Use HTTPS**.

## Step 6 — Configure the app

```bash
cd /opt/vcf-docs
cp .env.example .env
# generate a strong session secret:
openssl rand -hex 48
nano .env
```

In `.env` set:
- `SITE_URL=https://docs.yourdomain.com`
- `SESSION_SECRET=` the random string you just generated
- `ADMIN_USERNAME`, `ADMIN_EMAIL`, and a strong `ADMIN_PASSWORD` (no `#` character — it's treated as a comment)
- leave `NODE_ENV=production`, `PORT=3000`, `TRUST_PROXY=1`

Edit the domain in the Cloudflare Caddy config if it isn't `docs.valleycorrectional.xyz`:

```bash
nano deploy/Caddyfile.cloudflare
```

## Step 7 — Launch 🚀

```bash
docker compose -f docker-compose.cloudflare.yml up -d --build
```

The first build takes a few minutes (it compiles the container). Check it's healthy:

```bash
docker compose -f docker-compose.cloudflare.yml ps
docker compose -f docker-compose.cloudflare.yml logs -f app     # Ctrl+C to stop watching
```

You should see `Valley Correctional Facility docs running on http://localhost:3000`.

## Step 8 — Visit your site

Open **https://docs.yourdomain.com** 🎉

- Click **Staff Login**, sign in with the `ADMIN_USERNAME` / `ADMIN_PASSWORD` from `.env`.
- Go to **Admin → Staff** and change your password / add staff.
- Fill in handbooks, watch traffic under **Admin → Analytics**.

---

## Updating later

```bash
cd /opt/vcf-docs
git pull                 # or re-scp your changes
docker compose -f docker-compose.cloudflare.yml up -d --build
```

Your data (accounts, edits, analytics) lives in `/opt/vcf-docs/data` and survives rebuilds.

## Backups

The whole database is one folder. Copy it anywhere:

```bash
tar czf vcf-backup-$(date +%F).tgz -C /opt/vcf-docs data
```

---

## Troubleshooting

- **Error 521 / 522 in the browser (Cloudflare can't reach origin):** the Droplet firewall is blocking 443, or the container isn't up. Check `ufw status` (443 allowed) and `docker compose -f docker-compose.cloudflare.yml logs caddy`.
- **Redirect loop / "too many redirects":** Cloudflare SSL mode is wrong. It must be **Full (strict)** (not Flexible).
- **Cert error at the origin:** confirm `certs/origin.pem` and `certs/origin.key` exist and were pasted completely (including the `-----BEGIN/END-----` lines).
- **Site loads but login fails:** make sure `ADMIN_PASSWORD` has no `#`, and that you're on HTTPS (secure cookies require it — you are, via Cloudflare).
- **Want to test without Cloudflare first?** Set the DNS record to **DNS only** (grey cloud) and use the plain `docker-compose.yml` (Let's Encrypt via Caddy). Once it works, switch the cloud to orange and follow Steps 5–7.

---

## Simpler alternative (Cloudflare DNS only, no proxy)

If you don't need Cloudflare's proxy/CDN and just want your domain to resolve:

1. Step 4 but set **Proxy status: DNS only** (grey cloud).
2. Skip Step 5. Use the default files: `cp .env.example .env`, edit it, then
   `docker compose up -d --build` (this uses `Caddyfile`, which gets a free
   Let's Encrypt certificate automatically).

This is the setup described in [README.md](README.md).
