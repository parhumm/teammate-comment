# Deploying

One Node process, one SQLite file, behind a Cloudflare Tunnel. No reverse proxy, no
certificate to manage, no inbound ports open except SSH.

**HTTPS is not optional.** The widget is embedded on HTTPS pages, so a plain-HTTP API is
blocked as mixed content and never loads. The tunnel provides it.

Substitute your own hostname for `comments.jaan.to` throughout.

---

## 1. VPS, once

Node 24 so type stripping needs no flag and `node:sqlite` is stable.

```bash
curl -fsSL https://deb.nodesource.com/setup_24.x | sudo -E bash -
sudo apt-get install -y nodejs sqlite3

sudo mkdir -p /opt/tc /var/lib/tc
sudo chown -R "$USER:$USER" /opt/tc /var/lib/tc
```

Data lives in `/var/lib/tc`, deliberately outside `/opt/tc`, so `rsync --delete` on deploy can
never reach the database.

### `/etc/tc.env`

```ini
NODE_ENV=production
PORT=8787
TC_PUBLIC_ORIGIN=https://comments.jaan.to
TC_DB=/var/lib/tc/comments.db
TC_SECRET_FILE=/var/lib/tc/.secret
```

`TC_PUBLIC_ORIGIN` is the one that fails silently. Without it the panel builds snippets from
`http://localhost:8787` and hands you a script tag that will never load. Nothing errors; the
widget just never appears.

`NODE_ENV=production` is what makes the session cookie `secure`.

### `/etc/systemd/system/tc.service`

```ini
[Unit]
Description=Teammate Comment
After=network.target

[Service]
User=YOUR_USER
WorkingDirectory=/opt/tc/server
EnvironmentFile=/etc/tc.env
ExecStart=/usr/bin/node src/index.ts
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
```

`WorkingDirectory` matters: the widget bundle path resolves relative to it.

On Node 22.x, `ExecStart` needs `--experimental-strip-types` before the filename. Node 23.6+
and 24+ need no flag.

```bash
sudo systemctl daemon-reload && sudo systemctl enable tc
```

---

## 2. Cloudflare Tunnel, once

```bash
curl -L https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64.deb -o cf.deb
sudo dpkg -i cf.deb

cloudflared tunnel login
cloudflared tunnel create tc
cloudflared tunnel route dns tc comments.jaan.to
```

`/etc/cloudflared/config.yml`, using the UUID printed by `tunnel create`:

```yaml
tunnel: <UUID>
credentials-file: /root/.cloudflared/<UUID>.json
ingress:
  - hostname: comments.jaan.to
    service: http://localhost:8787
  - service: http_status:404
```

```bash
sudo cloudflared service install
sudo systemctl start cloudflared
```

The DNS record is created for you, proxied, with a valid certificate and nothing to renew.

### One Cloudflare setting to confirm

**Speed → Optimization → Rocket Loader: off.** It rewrites script tags, which nulls
`document.currentScript` — the mechanism the widget uses to recover its project key from its
own URL. It is off by default; just check it, and check it on any zone hosting a commented
page, not only this one.

Leave caching alone. The bundle is served with `Cache-Control: no-cache` plus an ETag, so
Cloudflare revalidates and deploys propagate immediately. **Never put a "Cache Everything" rule
on `/w/*`**: embedded sites cannot be asked to re-paste their snippet, so a stale bundle is
unfixable from their side.

---

## 3. Deploy

Once, on the server, so restarts need no password (`sudo visudo`):

```
YOUR_USER ALL=(ALL) NOPASSWD: /bin/systemctl restart tc
```

Then, from your machine, every time:

```bash
TC_HOST=you@your-vps ./deploy.sh
```

That builds the widget locally, rsyncs `package.json`, `package-lock.json`, `shared/`,
`server/` and `widget/`, runs `npm ci --omit=dev`, and restarts the service. The remote install
is four packages; Vite and TypeScript never reach the server.

---

## 4. First run

1. Open `https://comments.jaan.to` and create your account.
2. Create a project. `jaan.to` covers `jaan.to` and every subdomain at any depth, so that is
   one project. Shared hosts like `pages.dev` or `vercel.app` need their own.
3. Copy the snippet into any page on that domain.
4. The project screen flips from `Waiting for first page view` to `Installed` on first load.

---

## 5. Verify

In the order things actually go wrong:

1. **The snippet in the panel starts with `https://comments.jaan.to`, not `localhost`.**
   This is the failure that presents as "the widget is broken" and sends you looking in the
   wrong place entirely.
2. On a real page: select text, comment, reload, the comment is still there.
3. Load that same snippet from a domain not in the project. The widget should say
   `This domain isn't allowed for this project.` rather than failing silently.
4. `sudo systemctl stop tc`, then reload a commented page. It must render normally with no
   widget. Our being down must never block the host page.

```bash
ssh you@your-vps journalctl -u tc -f
```

---

## 6. Backup

Everything anyone ever wrote is in one file, and copying a live SQLite database can capture a
torn WAL. Use SQLite's own online backup, nightly:

```
0 4 * * * sqlite3 /var/lib/tc/comments.db ".backup '/var/lib/tc/backup.db'" && gzip -f /var/lib/tc/backup.db
```

Copy `/var/lib/tc/.secret` somewhere safe once. Losing it only signs everyone out, but it is a
single small file.

To restore: stop the service, gunzip over `comments.db`, delete any `-wal` and `-shm` siblings,
start.

---

## Known gaps in this setup

Deliberate for a private V1. See [ROADMAP.md](ROADMAP.md).

- **Signup is open.** Anyone reaching the panel can create their own account and projects. They
  cannot see or touch yours, but the login form has no rate limiting.
- **Anyone can edit or delete any comment** within a project they can reach.
- **No password reset.** Recovery is `sqlite3` on the VPS.
- **Shared-suffix domains are broad.** `vercel.app` as a project domain matches every Vercel
  site, not only yours. The project key ships publicly in the snippet, so prefer a narrower
  domain where you can.
- The service runs as your own user with no systemd hardening. The tunnel means nothing is
  listening publicly, which is what makes that acceptable here.
