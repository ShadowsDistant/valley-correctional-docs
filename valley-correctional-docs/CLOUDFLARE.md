# Hosting on Cloudflare (Workers + Containers, GitHub method)

## Read this first — the important constraint

This app is **Express + native SQLite (`better-sqlite3`)**. That stack **cannot run on the plain Cloudflare Workers runtime** (a V8 isolate with no filesystem and no native modules). So "deploy to Workers" for this app means deploying it as a **Cloudflare Container** that a small Worker sits in front of. Cloudflare builds the container from the existing [`Dockerfile`](Dockerfile) and deploys it from your GitHub repo — this is still the Workers + GitHub flow, just container-backed.

Files that make this work (already in the repo):

| File | Purpose |
| --- | --- |
| [`wrangler.jsonc`](wrangler.jsonc) | Worker + container + Durable Object config |
| [`cf/container-worker.js`](cf/container-worker.js) | The Worker that forwards every request to the container |
| [`Dockerfile`](Dockerfile) | Builds the Node image Cloudflare runs |
| [`.github/workflows/deploy-cloudflare.yml`](.github/workflows/deploy-cloudflare.yml) | Optional: deploy via GitHub Actions instead of the dashboard |

> ⚠️ **Data persistence caveat.** A container's local disk is **ephemeral** — the SQLite file at `/app/data` is reset whenever the container is rebuilt or replaced (i.e. on every deploy, and after long idle sleeps). Seeded pages come back automatically, but **staff accounts, page edits, revisions, and analytics do not persist** across deploys. That's fine for a demo/preview. For a production site whose content is edited in the UI, use one of the persistence options below.

---

## Deploy with the GitHub method (dashboard)

1. **Push this project to a GitHub repository** (see the git steps at the bottom).

2. In the **Cloudflare dashboard** → **Workers & Pages** → **Create** → **Workers** → **Connect to Git**.
   - Authorize GitHub and pick your repo.
   - Cloudflare detects [`wrangler.jsonc`](wrangler.jsonc) and the [`Dockerfile`](Dockerfile) and configures a **Workers Build** that builds the container image and deploys the Worker.
   - Every push to your default branch redeploys automatically.

3. **Add your secrets** (Worker → Settings → Variables and Secrets → *Encrypted*):
   - `SESSION_SECRET` — a long random string
     (`node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"`)
   - `ADMIN_USERNAME`, `ADMIN_EMAIL`, `ADMIN_PASSWORD` — the first admin account
   - (`NODE_ENV=production`, `PORT=3000`, `TRUST_PROXY=1` are already set as plain vars in `wrangler.jsonc`.)

4. **First deploy** builds the image (a few minutes the first time). When it finishes you get a `*.workers.dev` URL. Log in at `/login` with the admin credentials above and change the password.

5. **Custom domain** (`docs.valleycorrectional.xyz`): Worker → **Settings → Domains & Routes → Add** → Custom Domain. Cloudflare provisions TLS automatically. (If the domain isn't already on Cloudflare, add the site to your Cloudflare account first.)

---

## Deploy with GitHub Actions (alternative)

If you'd rather deploy from CI instead of connecting the repo in the dashboard, the workflow in [`.github/workflows/deploy-cloudflare.yml`](.github/workflows/deploy-cloudflare.yml) runs `wrangler deploy` on every push. Add two **repository secrets** (Settings → Secrets and variables → Actions):

- `CLOUDFLARE_API_TOKEN` — a token with the *Edit Cloudflare Workers* template
- `CLOUDFLARE_ACCOUNT_ID` — from the Cloudflare dashboard sidebar

Then set your app secrets once from your machine:

```bash
npm install
npx wrangler secret put SESSION_SECRET
npx wrangler secret put ADMIN_PASSWORD
# ...etc
```

## Deploy from your machine (no CI)

```bash
npm install
npx wrangler login
npx wrangler deploy      # builds the container from ./Dockerfile and deploys
```

---

## Making data persist in production

Pick one when you're past the demo stage:

1. **Easiest — keep SQLite, host somewhere with a disk.** Cloudflare Containers aren't the right tool for a UI-edited SQLite app. The existing [`docker-compose.yml`](docker-compose.yml) runs the app unchanged on a **DigitalOcean droplet**, **Fly.io**, **Railway**, or any VM/VPS with a persistent volume for `./data`. This is the least work and keeps everything you've built.

2. **Cloudflare-native — migrate data to D1.** Keep this Worker+Container setup for compute but move the database to **[Cloudflare D1](https://developers.cloudflare.com/d1/)** (serverless SQLite). This requires swapping the data layer in `lib/db.js` (and the synchronous `better-sqlite3` calls) for the async D1 client, plus a KV-backed session store. It's a real code change — open an issue/ask and it can be scaffolded.

3. **External database.** Point the app at hosted Postgres/MySQL or **Turso** (libSQL, SQLite-compatible) and adapt `lib/db.js` accordingly.

---

## Pushing to GitHub (first time)

```bash
cd valley-correctional-docs
git init
git add -A
git commit -m "Valley Correctional Facility docs platform"
git branch -M main
git remote add origin https://github.com/<you>/valley-correctional-docs.git
git push -u origin main
```

`node_modules/`, `data/`, and `.env` are already gitignored — your secrets never leave your machine.
