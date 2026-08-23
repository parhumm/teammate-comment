# Deploying to teammate.jaan.to

One Node process, one SQLite file, behind a Cloudflare Tunnel. No reverse proxy, no certificate
to manage, no inbound ports open except SSH.

**HTTPS is not optional.** The widget is embedded on HTTPS pages, so a plain-HTTP API is blocked
as mixed content and never loads. The tunnel provides it.

Follow the steps in order. Steps 1 to 3 are once; step 4 is every deploy.

| | |
|---|---|
| Service URL | `https://teammate.jaan.to` |
| Code on the VPS | `/opt/teammate` |
| Data on the VPS | `/var/lib/teammate` |
| systemd unit | `teammate` |
| Listens on | `127.0.0.1:8787` (never exposed directly) |

---

## Step 1 — VPS base

Node 24 so type stripping needs no flag. `sqlite3` is only for backups.

```bash
curl -fsSL https://deb.nodesource.com/setup_24.x | sudo -E bash -
sudo apt-get install -y nodejs sqlite3
node --version    # expect v24.x
```

```bash
sudo mkdir -p /opt/teammate /var/lib/teammate
sudo chown -R "$USER:$USER" /opt/teammate /var/lib/teammate
```

Data lives in `/var/lib/teammate`, deliberately outside `/opt/teammate`, so the `rsync --delete`
on every deploy can never reach the database.

---

## Step 2 — Config and service

### `/etc/teammate.env`

```bash
sudo tee /etc/teammate.env > /dev/null <<'EOF'
NODE_ENV=production
PORT=8787
TC_PUBLIC_ORIGIN=https://teammate.jaan.to
TC_DB=/var/lib/teammate/comments.db
TC_SECRET_FILE=/var/lib/teammate/.secret
EOF
sudo chmod 600 /etc/teammate.env
```

`TC_PUBLIC_ORIGIN` is the one that fails silently. Without it the panel builds snippets from
`http://localhost:8787` and hands you a script tag that never loads. Nothing errors, the widget
just never appears.

`NODE_ENV=production` is what makes the session cookie `secure`.

### `/etc/systemd/system/teammate.service`

Replace `YOUR_USER` with your login name (`whoami`).

```bash
sudo tee /etc/systemd/system/teammate.service > /dev/null <<EOF
[Unit]
Description=Teammate Comment
After=network.target

[Service]
User=$(whoami)
WorkingDirectory=/opt/teammate/server
EnvironmentFile=/etc/teammate.env
ExecStart=/usr/bin/node src/index.ts
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
EOF

sudo systemctl daemon-reload
sudo systemctl enable teammate
```

`enable` without `--now`: the unit points at `/opt/teammate/server`, which does not exist until
the first deploy. Step 4 starts it.

`WorkingDirectory` matters beyond tidiness: the widget bundle path resolves relative to it.

On Node 22.x only, `ExecStart` needs the flag: `/usr/bin/node --experimental-strip-types src/index.ts`.
Node 23.6+ and 24+ need nothing. If your Node prints an `ExperimentalWarning` for `node:sqlite`,
it is harmless.

### Passwordless restart for deploys

```bash
echo "$(whoami) ALL=(ALL) NOPASSWD: /usr/bin/systemctl restart teammate" \
  | sudo tee /etc/sudoers.d/teammate > /dev/null
sudo chmod 440 /etc/sudoers.d/teammate
```

The path must be `/usr/bin/systemctl`, which is what `sudo systemctl` resolves to on Ubuntu.
`/bin/systemctl` will not match and you will be prompted for a password on every deploy.

---

## Step 3 — Cloudflare Tunnel

Use the dashboard flow. It creates the DNS record for you and needs no `config.yml`, no
`cert.pem`, and no credentials-file path to get wrong.

1. Open **[one.dash.cloudflare.com](https://one.dash.cloudflare.com)** → **Networks → Tunnels**
   → **Create a tunnel** → **Cloudflared**.
2. Name it `teammate`, then **Save tunnel**.
3. It shows an install command containing your tunnel token. Run that command on the VPS. It
   looks like:

   ```bash
   curl -L --output cloudflared.deb \
     https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64.deb \
   && sudo dpkg -i cloudflared.deb \
   && sudo cloudflared service install eyJhIjoiXXXXXXXX...
   ```

   On an ARM VPS, swap `amd64` for `arm64` in the URL. Check with `dpkg --print-architecture`.

4. Back in the dashboard, on the **Public Hostname** tab, **Add a public hostname**:

   | Field | Value |
   |---|---|
   | Subdomain | `teammate` |
   | Domain | `jaan.to` |
   | Path | *(leave empty)* |
   | Type | `HTTP` |
   | URL | `localhost:8787` |

   Type is **HTTP**, not HTTPS: the tunnel already encrypts the hop, and the app speaks plain
   HTTP on loopback.

5. **Save hostname.** The proxied DNS record for `teammate.jaan.to` is created automatically.

```bash
sudo systemctl status cloudflared    # expect active (running)
```

Until step 4 the tunnel will return 502, because nothing is listening on 8787 yet. That is
expected.

### One Cloudflare setting to confirm

**Speed → Optimization → Rocket Loader: off.** It rewrites script tags, which nulls
`document.currentScript` — the mechanism the widget uses to recover its project key from its own
URL. It is off by default; confirm it, and confirm it on any zone hosting a commented page, not
only this one.

Leave caching alone. The bundle is served with `Cache-Control: no-cache` plus an ETag, so
Cloudflare revalidates and deploys propagate immediately. **Never add a "Cache Everything" rule
covering `/w/*`**: embedded sites cannot be asked to re-paste their snippet, so a stale bundle
is unfixable from their side.

---

## Step 4 — Deploy

From your machine, in the repo:

```bash
TC_HOST=you@your-vps ./deploy.sh
```

That builds the widget locally, rsyncs `package.json`, `package-lock.json`, `shared/`, `server/`
and `widget/`, runs `npm ci --omit=dev`, and restarts the service. The remote install is four
packages; Vite and TypeScript never reach the server.

Confirm it came up:

```bash
ssh you@your-vps systemctl is-active teammate     # expect: active
curl -sI https://teammate.jaan.to/signin | head -1  # expect: HTTP/2 200
```

---

## Step 5 — First run

1. Open `https://teammate.jaan.to` and create your account.
2. Create a project. One domain per project:

   | Commenting on | Project domain |
   |---|---|
   | `jaan.to` and every subdomain, any depth | `jaan.to` |
   | a Cloudflare Pages site | `your-site.pages.dev` |
   | a Vercel site | `your-app.vercel.app` |

   `jaan.to` alone covers `a.jaan.to` and `a.b.jaan.to`, so that is one project, not several.

3. Copy the snippet and paste it before `</body>` on any page in that domain:

   ```html
   <script src="https://teammate.jaan.to/w/YOUR_KEY.js"></script>
   ```

4. Load the page. The project screen flips from `Waiting for first page view` to `Installed`.
5. Select some text on that page. A **Comment** button appears.

---

## Step 6 — Verify

In the order things actually go wrong:

1. **The snippet in the panel starts with `https://teammate.jaan.to`, not `localhost`.**
   This is the failure that presents as "the widget is broken" and sends you looking in entirely
   the wrong place. If it says localhost, `TC_PUBLIC_ORIGIN` is not reaching the process.

2. On a real page: select text, comment, reload. The comment and its highlight are still there.

3. Load that same snippet from a domain **not** in the project. The widget should say
   `This domain isn't allowed for this project.` rather than failing silently.

4. Stop the service and reload a commented page:

   ```bash
   ssh you@your-vps sudo systemctl stop teammate
   ```

   The page must render completely normally, just without the widget. Our being down must never
   block the host page. Then start it again.

5. Bundle caching behaves:

   ```bash
   curl -sI https://teammate.jaan.to/w/YOUR_KEY.js | grep -i 'cache-control\|etag'
   ```

   Expect `cache-control: no-cache` and an `etag`.

```bash
ssh you@your-vps journalctl -u teammate -f
```

---

## Step 7 — Backup

Everything anyone ever wrote is in one file, and copying a live SQLite database can capture a
torn WAL. Use SQLite's own online backup. On the VPS, `crontab -e`:

```
0 4 * * * sqlite3 /var/lib/teammate/comments.db ".backup '/var/lib/teammate/backup.db'" && gzip -f /var/lib/teammate/backup.db
```

Copy `/var/lib/teammate/.secret` somewhere safe once. Losing it only signs everyone out, but it
is a single small file and there is no way to regenerate the old one.

To restore: stop the service, `gunzip` over `comments.db`, delete any `-wal` and `-shm`
siblings, start.

---

## When something is wrong

| Symptom | Cause |
|---|---|
| Snippet shows `localhost` | `TC_PUBLIC_ORIGIN` missing. `sudo systemctl show teammate -p Environment` |
| `teammate.jaan.to` returns 502 | App is down. `systemctl status teammate`, `journalctl -u teammate -n 50` |
| Widget never appears, no console error | Rocket Loader on for the **host page's** zone |
| Widget logs a CORS or 403 error | Page's domain is not in that project |
| Deploy prompts for a sudo password | sudoers path must be `/usr/bin/systemctl`, not `/bin/systemctl` |
| `npm ci` fails on the VPS | A workspace manifest is missing; `widget/` must be rsynced whole |
| Comments vanished after a deploy | `TC_DB` is pointing inside `/opt/teammate`; it must be `/var/lib/teammate` |

---

## Known gaps in this setup

Deliberate for a private V1. See [ROADMAP.md](ROADMAP.md).

- **Signup is open.** Anyone reaching the panel can create their own account and projects. They
  cannot see or touch yours, but the login form has no rate limiting.
- **Anyone can edit or delete any comment** within a project they can reach.
- **No password reset.** Recovery means editing the SQLite file on the VPS.
- **Shared-suffix domains are broad.** `vercel.app` as a project domain matches every Vercel
  site, not only yours. The project key ships publicly in the snippet, so use the most specific
  domain you can.
- The service runs as your own user with no systemd hardening. The tunnel means nothing is
  listening publicly, which is what makes that acceptable here.
