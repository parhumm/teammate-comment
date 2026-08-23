# Deploying to teammate.jaan.to

One Node process and one SQLite file, listening on loopback behind something that terminates TLS.

**HTTPS is not optional.** The widget is embedded on HTTPS pages, so a plain-HTTP API is blocked
as mixed content and never loads.

Step 3 offers two ways to get it. If the box already runs a reverse proxy, use that. If the box is
empty, a Cloudflare Tunnel is less to set up.

Follow the steps in order. Steps 1 to 3 are once; step 4 is every deploy.

| | |
|---|---|
| Service URL | `https://teammate.jaan.to` |
| Code on the VPS | `/opt/teammate` |
| Data on the VPS | `/var/lib/teammate` |
| systemd unit | `teammate` |
| Listens on | `127.0.0.1:8787` (loopback by default; `TC_BIND` overrides) |

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
TC_BIND=127.0.0.1
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

`TC_BIND` already defaults to `127.0.0.1`; it is in the file so the binding is stated rather than
assumed. Set it to `0.0.0.0` only if you genuinely want the process reachable with no proxy in
front, and only behind a firewall — signup is open, so an exposed port is an open panel. Whatever
you set, confirm it after the first deploy rather than trusting this table: `ss -ltnp | grep 8787`.

### `/etc/systemd/system/teammate.service`

Give the service its own account rather than running it as yours. The deploy user writes
`/opt/teammate`; the service user only reads it, and owns nothing but the data directory.

```bash
sudo useradd --system --no-create-home --shell /usr/sbin/nologin teammate
sudo chown teammate:teammate /var/lib/teammate
sudo chmod 750 /var/lib/teammate
```

```bash
sudo tee /etc/systemd/system/teammate.service > /dev/null <<'EOF'
[Unit]
Description=Teammate Comment
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=teammate
Group=teammate
WorkingDirectory=/opt/teammate/server
EnvironmentFile=/etc/teammate.env
ExecStart=/usr/bin/node src/index.ts
Restart=always
RestartSec=3

# The process reads its code and writes exactly one directory. Say so.
NoNewPrivileges=true
ProtectSystem=strict
ProtectHome=true
PrivateTmp=true
ReadWritePaths=/var/lib/teammate

# On a shared box, the unbounded process is the one that takes the box down.
# MemoryHigh throttles before MemoryMax kills, so pressure shows up as slowness
# rather than as a Restart=always crash loop.
MemoryHigh=192M
MemoryMax=256M
CPUWeight=50

[Install]
WantedBy=multi-user.target
EOF

sudo systemctl daemon-reload
sudo systemctl enable teammate
```

`ReadWritePaths` must name whatever `TC_DB` and `TC_SECRET_FILE` point at. `ProtectSystem=strict`
makes everything else read-only, so a wrong path here surfaces as `SQLITE_CANTOPEN` on boot.

`enable` without `--now`: the unit points at `/opt/teammate/server`, which does not exist until
the first deploy. Step 4 starts it.

`WorkingDirectory` matters beyond tidiness: the widget bundle path resolves relative to it.

On Node 22.x only, `ExecStart` needs the flag: `/usr/bin/node --experimental-strip-types src/index.ts`.
Node 23.6+ and 24+ need nothing. If your Node prints an `ExperimentalWarning` for `node:sqlite`,
it is harmless.

### Passwordless restart for deploys

Skip this if you deploy as `root` — `sudo` is already a no-op there, and an extra sudoers file is
one more thing to get wrong. It is for the case where `TC_HOST` is an unprivileged account.

```bash
echo "$(whoami) ALL=(ALL) NOPASSWD: /usr/bin/systemctl restart teammate" \
  | sudo tee /etc/sudoers.d/teammate > /dev/null
sudo chmod 440 /etc/sudoers.d/teammate
```

The path must be `/usr/bin/systemctl`, which is what `sudo systemctl` resolves to on Ubuntu.
`/bin/systemctl` will not match and you will be prompted for a password on every deploy.

---

## Step 3 — HTTPS

Two ways in. Pick one.

**A — the box already has a reverse proxy.** Add a site block to it. Nothing new runs, the
certificate story is whatever the other sites on that box already use, and rollback is restoring
one file. This is what `teammate.jaan.to` actually uses.

**B — the box is empty.** A Cloudflare Tunnel needs no open inbound port and no certificate at all.

---

### A — Behind an existing reverse proxy

DNS first: an `A` record for `teammate` pointing at the box's IP. If the zone is on Cloudflare and
the proxy issues its own certificates, that record must be **DNS-only (grey cloud)** — Let's
Encrypt's HTTP-01 challenge has to reach the box directly on port 80.

```sh
dig +short teammate.jaan.to     # the box's IP, not a 104.x/172.x Cloudflare edge IP
```

Then the site block. Caddy, matching what we run:

```caddyfile
teammate.jaan.to {
	encode zstd gzip

	header {
		Strict-Transport-Security "max-age=31536000; includeSubDomains"
		X-Content-Type-Options    "nosniff"
		Referrer-Policy           "strict-origin-when-cross-origin"
		X-Robots-Tag              "noindex, nofollow, noarchive, nosnippet"
		-Server
	}

	# The app already sets Cache-Control: no-cache plus an ETag on the bundle.
	# Do not add a max-age here — see the caching note at the end of this step.
	handle /w/* {
		reverse_proxy 127.0.0.1:8787
	}

	handle {
		reverse_proxy 127.0.0.1:8787 {
			header_up X-Forwarded-Proto {scheme}
			header_up X-Real-IP         {remote_host}
		}
	}
}
```

**No `X-Frame-Options: DENY`, deliberately.** If the proxy has a shared security-header snippet it
applies to every other site, do not import it here without reading it. This host serves a script to
third-party pages; a blanket header set written for a first-party dashboard is the wrong shape.

Never edit a live proxy config in place. Back it up, validate a staged copy, then swap and reload:

```sh
sudo cp /etc/caddy/Caddyfile /etc/caddy/Caddyfile.bak.$(date +%Y%m%d-%H%M%S)
sudo cp /etc/caddy/Caddyfile /tmp/Caddyfile.staged
# append the block above to /tmp/Caddyfile.staged
caddy validate --adapter caddyfile --config /tmp/Caddyfile.staged
sudo mv /tmp/Caddyfile.staged /etc/caddy/Caddyfile
sudo systemctl reload caddy      # reload, never restart
```

Then re-check the **other** sites on that box before you look at this one. A config that breaks a
neighbour is the failure mode that matters, and `reload` is what keeps it recoverable:

```sh
sudo cp "$(ls -t /etc/caddy/Caddyfile.bak.* | head -1)" /etc/caddy/Caddyfile
sudo systemctl reload caddy
```

Until step 4 this returns 502, because nothing is listening on 8787 yet. That is expected.

---

### B — Cloudflare Tunnel

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

---

### Cloudflare settings — only for zones Cloudflare actually proxies

Both of these are edge behaviours, so they apply to **orange-clouded** hostnames and to tunnels.
A grey-cloud record runs no Cloudflare features at all, and neither setting can reach it.

**Speed → Optimization → Rocket Loader: off.** It rewrites script tags, which nulls
`document.currentScript` — the mechanism the widget uses to recover its project key from its own
URL. It is off by default.

Check it on **the zone serving the commented page**, which is the case that actually bites: our own
host can be grey-cloud and perfectly healthy while a proxied customer zone silently breaks the
widget on their pages. The symptom is the widget never appearing, with nothing in the console.

**Never add a "Cache Everything" rule covering `/w/*`.** The bundle ships `Cache-Control: no-cache`
plus an ETag, so a proxy that respects origin headers revalidates and deploys propagate
immediately. Override that and you have pinned a stale bundle on sites that cannot be asked to
re-paste their snippet, which makes it unfixable from their side.

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
ssh you@your-vps systemctl is-active teammate       # expect: active
ssh you@your-vps 'ss -ltnp | grep 8787'             # expect 127.0.0.1:8787, NOT 0.0.0.0:8787
curl -s  https://teammate.jaan.to/healthz           # expect: ok
curl -sI https://teammate.jaan.to/signin | head -1  # expect: HTTP/2 200
```

Assert the bind address rather than trusting the config. `TC_BIND` is a default in code and a line
in an env file; only `ss` knows what the process actually did with them.

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
| Snippet shows `localhost` | `TC_PUBLIC_ORIGIN` is not reaching the process — read it off the process itself (below) |
| `teammate.jaan.to` returns 502 | App is down. `systemctl status teammate`, `journalctl -u teammate -n 50` |
| Widget never appears, no console error | Rocket Loader on for the **host page's** zone |
| Widget logs a CORS or 403 error | Page's domain is not in that project |
| Deploy prompts for a sudo password | sudoers path must be `/usr/bin/systemctl`, not `/bin/systemctl` |
| `npm ci` fails on the VPS | A workspace manifest is missing; `widget/` must be rsynced whole |
| Comments vanished after a deploy | `TC_DB` is pointing inside `/opt/teammate`; it must be `/var/lib/teammate` |

To read the environment the service actually got, ask the **process**, not systemd:

```bash
PID=$(systemctl show teammate -p MainPID --value)
sudo tr '\0' '\n' < /proc/$PID/environ | grep TC_
```

`systemctl show teammate -p Environment` will not help: it lists only inline `Environment=`
directives, and everything here arrives via `EnvironmentFile=`. It prints an empty line whether the
env file loaded perfectly or was never read at all — the one answer a diagnostic must never give.

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
- **There is no health check beyond `/healthz`.** It answers `ok` without touching the database,
  which is the point — it reports whether the process is alive, not whether it is useful. Nothing
  watches it for you; wire it into whatever monitors the box.
