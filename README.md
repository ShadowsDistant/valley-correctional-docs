# Valley Correctional Facility — Documentation Platform

A self-hosted, Mintlify-style documentation & handbook site for **Valley Correctional Facility**, with everything built in:

- 📚 **Docs site** — clean sidebar navigation, search, dark/light themes, "on this page" TOC, prev/next, callouts, cards, and tables.
- ✍️ **Live editor** — logged-in staff edit any page in a split-pane Markdown editor with **live preview** and one-click save. Changes go live instantly, no redeploy.
- 🔒 **Auth & internal docs** — staff login with hashed passwords; the *Internal Documents* section is gated to logged-in staff.
- 📈 **Traffic analytics** — a built-in, privacy-preserving dashboard (views/day chart, top pages, referrers, unique visitors). No third-party trackers.
- 🕓 **Revision history** — every save is versioned and can be restored.
- 👥 **Staff management** — admins can create editor/admin accounts and reset passwords.

All 20 pages from the original site (public + internal placeholders) are pre-loaded.

> **Heads up:** this project was authored on a machine without Node.js, so it could not be run/tested locally before delivery. The code is complete and self-contained; the **first `docker compose up` on your DigitalOcean droplet is the first real run.** If anything trips on first boot, the logs will point right at it — see *Troubleshooting* below.

---

## Tech stack

| Layer | Choice |
| --- | --- |
| Runtime | Node.js 20 (Express) |
| Storage | SQLite (`better-sqlite3`) — a single file in `./data`, no external DB |
| Views | EJS server-side templates |
| Auth | `express-session` + `bcryptjs`, sessions persisted in SQLite |
| Markdown | `marked` + `sanitize-html` (safe rendering) |
| Realtime | `yjs` + `ws` — live co-editing in the page editor (WebSocket at `/ws/edit`) |
| Proxy/TLS | Caddy (automatic Let's Encrypt HTTPS) |

> The browser Yjs bundle is committed at `public/vendor/y.js`. After upgrading
> `yjs`, rebuild it once with:
> `npx esbuild scripts/y-entry.js --bundle --minify --format=iife --global-name=YB --outfile=public/vendor/y.js`
>
> Behind Cloudflare → Caddy set `TRUST_PROXY=2` in `.env` so rate limits key on
> the real client IP (two proxy hops).

---

## Deploy to DigitalOcean (recommended: Droplet + Docker)

This path gives you **persistent SQLite storage** and **automatic HTTPS** for `docs.valleycorrectional.xyz`.

### 1. Create a Droplet
- Create a **Ubuntu 24.04** Droplet (the smallest, $6/mo, is plenty).
- Add your SSH key, then SSH in: `ssh root@YOUR_DROPLET_IP`

### 2. Install Docker
```bash
curl -fsSL https://get.docker.com | sh
```

### 3. Point your domain at the droplet
In your DNS provider, create an **A record**:
```
docs.valleycorrectional.xyz  →  YOUR_DROPLET_IP
```
Wait for it to resolve (`ping docs.valleycorrectional.xyz`) — Caddy needs this to issue the certificate.

### 4. Upload this project
From your PC (in the project folder):
```bash
scp -r . root@YOUR_DROPLET_IP:/opt/vcf-docs
```
…or `git clone` your repo onto the droplet into `/opt/vcf-docs`.

### 5. Configure environment
```bash
cd /opt/vcf-docs
cp .env.example .env
# generate a session secret:
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))" 2>/dev/null \
  || openssl rand -hex 48
nano .env      # paste SESSION_SECRET, set ADMIN_PASSWORD, confirm SITE_URL
```

### 6. Launch
```bash
docker compose up -d --build
```
Caddy will fetch a TLS cert automatically. Visit **https://docs.valleycorrectional.xyz** 🎉

### 7. First login
- Go to `/login` and sign in with `ADMIN_USERNAME` / `ADMIN_PASSWORD` from your `.env`.
- Open **Admin → Staff** and set a strong password (or add more staff).
- You can now edit any page via **✎ Edit this page**, fill in the internal handbooks, and watch traffic under **Admin → Analytics**.

### Updating later
```bash
cd /opt/vcf-docs
git pull            # or re-scp your changes
docker compose up -d --build
```
Your content and analytics live in `./data` (a Docker volume) and survive rebuilds.

---

## Alternative: Cloudflare (Workers + Containers, GitHub method)

See **[CLOUDFLARE.md](CLOUDFLARE.md)**. Note the app's native SQLite can't run on the plain Workers runtime, so Cloudflare runs it as a container fronted by a Worker — with an important data-persistence caveat documented there.

## Alternative: DigitalOcean App Platform

A spec is provided at [`.do/app.yaml`](.do/app.yaml), deployable with `doctl apps create --spec .do/app.yaml`.

⚠️ **App Platform filesystems are ephemeral** — the SQLite database is wiped on every redeploy. Use this only for a quick demo, or migrate storage to a managed database first. For real use, prefer the Droplet path above.

---

## Running without Docker (bare Node)

```bash
npm install
cp .env.example .env      # edit SESSION_SECRET + ADMIN_PASSWORD
NODE_ENV=production node server.js
```
Then put Nginx/Caddy in front for TLS. Requires build tools for `better-sqlite3`
(`apt install build-essential python3` on Debian/Ubuntu).

---

## Editing content

| Action | Where |
| --- | --- |
| Edit a page live | Any page → **✎ Edit this page**, or **Admin → Pages** |
| Create a page | **Admin → New page** (set a `section/slug`, group, icon, order) |
| Make a page staff-only | Tick **🔒 Internal** in the editor |
| Restore an old version | Editor → **Revision history** |
| See traffic | **Admin → Analytics** |
| Manage staff | **Admin → Staff** (admins only) |

### Markdown callouts
```
:::warning Read this first
Content of the callout goes here.
:::
```
Types: `note`, `info`, `tip`, `success`, `warning`, `danger`, `important`.

### Cards & signatures
Use raw HTML in Markdown (already used on the Home and ToS pages):
```html
<div class="card-grid">
  <a class="doc-card" href="/shifts/shift-information">
    <span class="doc-card-icon">📋</span>
    <span class="doc-card-title">Shift Information</span>
    <span class="doc-card-desc">Short description.</span>
  </a>
</div>
```

---

## Project structure
```
server.js            Express app: routes, auth, editor, analytics
lib/
  db.js              SQLite schema + connection
  seed.js            Page manifest + first-boot seeding
  markdown.js        Markdown → safe HTML, callouts, TOC
  auth.js            Password hashing, session guards, CSRF
  nav.js             Sidebar grouping / ordering
content/*.md         Seeded page content (source of truth on first boot)
views/               EJS templates (docs, admin, editor, analytics)
public/              CSS, client JS, favicon
Dockerfile           Production image
docker-compose.yml   App + Caddy (HTTPS)
Caddyfile            Reverse-proxy / TLS config
.do/app.yaml         App Platform spec (see caveat)
```

---

## Security notes
- Passwords are hashed with bcrypt; sessions are httpOnly cookies (Secure in production).
- All state-changing forms/requests are CSRF-protected.
- Rendered Markdown is sanitized (`sanitize-html`) with a strict tag/attribute allowlist.
- Login is rate-limited (20 attempts / 15 min / IP).
- Analytics hash IP + user-agent; raw IPs are never stored.
- **Change the default admin password on first login**, and set a unique `SESSION_SECRET`.

---

## Troubleshooting
- **Cert not issued / site not loading:** confirm the DNS A record resolves to the droplet *before* `docker compose up`. Check `docker compose logs caddy`.
- **App won't start:** `docker compose logs app`. A native-build error for `better-sqlite3` means the base image lacked build tools — the provided Dockerfile installs `python3 make g++`, so rebuild with `--build`.
- **Locked out:** stop the stack, delete `./data/vcf.sqlite*`, and it will re-seed a fresh admin from `.env` on next boot (this also wipes edits + analytics).
- **Reset a page to its shipped default:** delete it in **Admin → Pages**, then run `npm run seed` (or `docker compose exec app npm run seed`).
