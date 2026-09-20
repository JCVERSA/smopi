# Deploying to a temporary VPS

Verified against a clean clone of this branch on Node 22 (Debian/Ubuntu).

> **Do not use the `curl … install.sh | sh` one-liner from the README.**
> The bundled `scripts/` installers are stale: they clone `JCVERSA/file`
> (this repo is `JCVERSA/smopi`) and expect `dist/server.mjs`, while the
> build produces `dist/server.cjs`. `fsd start` fails with
> *"dist/server.mjs missing"*. Use the manual steps below.

---

## 1. Install Node.js 22

```bash
sudo apt-get update
sudo apt-get install -y curl git
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt-get install -y nodejs
node -v     # expect v22.x
```

## 2. Clone and build

```bash
sudo mkdir -p /opt/smopi && sudo chown "$USER" /opt/smopi
git clone -b arena/01a0bf28-smopi https://github.com/JCVERSA/smopi.git /opt/smopi
cd /opt/smopi

# --legacy-peer-deps is required: the scaffold has loose peer ranges.
npm install --legacy-peer-deps

npm run build          # -> dist/server.cjs + dist/assets/*
```

Optional sanity check (34 tests, ~5s, no network needed):

```bash
npm test
```

## 3. Configure

```bash
cd /opt/smopi
mkdir -p shared_files

cat > .env <<'EOF'
SHARE_PASSWORD=change-me-to-something-strong
SHARE_EXPIRY=3600
PORT=3000
SHARE_DIR=/opt/smopi/shared_files
EOF

chmod 600 .env
```

| Variable | Purpose | Default |
|---|---|---|
| `SHARE_PASSWORD` | Password guests type to unlock the share | random 12-hex, printed to the log |
| `SHARE_EXPIRY` | Share lifetime in seconds; `0` = never expires | `1800` (30 min) |
| `SHARE_ONE_TIME` | `true` stops the share after the first completed download | `false` |
| `PORT` | HTTP listen port | `3000` |
| `SHARE_DIR` | Absolute path to the shared files directory | `./shared_files` |
| `OWNER_SESSION_SECRET` | If set, stop/restart/password-disclosure require `POST /api/login-owner`. **Recommended when sharing with others.** | unset = anyone with the password is admin |
| `GEMINI_API_KEY` | Enables the Gemini-backed Smopi agent | unset = local fallback engine |

> **Security note:** with `OWNER_SESSION_SECRET` unset, every guest who has the
> share password can delete all files and stop the share. Set it if the link
> goes to anyone you don't fully trust.

## 4. Run

Foreground (quick test — `Ctrl+C` to stop):

```bash
cd /opt/smopi
NODE_ENV=production node dist/server.cjs
```

Background with systemd (survives logout and reboots):

```bash
sudo tee /etc/systemd/system/smopi.service > /dev/null <<EOF
[Unit]
Description=Smopi File Share
After=network.target

[Service]
Type=simple
User=$USER
WorkingDirectory=/opt/smopi
EnvironmentFile=/opt/smopi/.env
Environment=NODE_ENV=production
ExecStart=/usr/bin/node /opt/smopi/dist/server.cjs
Restart=on-failure
RestartSec=5

# Hardening
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=full
ProtectHome=read-only
ReadWritePaths=/opt/smopi/shared_files

[Install]
WantedBy=multi-user.target
EOF

sudo systemctl daemon-reload
sudo systemctl enable --now smopi
sudo systemctl status smopi --no-pager
```

Logs, restart, stop:

```bash
journalctl -u smopi -f      # follow logs (the password is printed at boot)
sudo systemctl restart smopi
sudo systemctl stop smopi
```

## 5. Open the firewall

```bash
sudo ufw allow 22/tcp
sudo ufw allow 3000/tcp
sudo ufw --force enable
```

Visit `http://<your-vps-ip>:3000` and enter `SHARE_PASSWORD`.

## 6. HTTPS (recommended if the link leaves your machine)

Plain HTTP sends the share password in clear text. With a domain pointed at the
VPS:

```bash
sudo apt-get install -y nginx certbot python3-certbot-nginx

sudo tee /etc/nginx/sites-available/smopi > /dev/null <<'EOF'
server {
    listen 80;
    server_name share.example.com;          # <-- your domain

    client_max_body_size 0;                 # allow large uploads

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host              $host;
        proxy_set_header X-Real-IP         $remote_addr;
        proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_buffering off;                # stream downloads
    }
}
EOF

sudo ln -sf /etc/nginx/sites-available/smopi /etc/nginx/sites-enabled/smopi
sudo nginx -t && sudo systemctl reload nginx
sudo certbot --nginx -d share.example.com
```

Then close the direct port so traffic only arrives over TLS:

```bash
sudo ufw delete allow 3000/tcp
sudo ufw allow 'Nginx Full'
```

The app already sets `trust proxy 1`, so `X-Forwarded-For` is honoured for
rate limiting behind exactly one proxy hop.

## 7. Updating

```bash
cd /opt/smopi
git pull --ff-only
npm install --legacy-peer-deps
npm run build
sudo systemctl restart smopi
```

## 8. Tear down

```bash
sudo systemctl disable --now smopi
sudo rm /etc/systemd/system/smopi.service
sudo systemctl daemon-reload
sudo rm -rf /opt/smopi          # deletes shared files too
```

---

## Troubleshooting

| Symptom | Cause / fix |
|---|---|
| `dist/server.mjs missing` | You ran the stale `fsd` installer. Use `node dist/server.cjs`. |
| `ERESOLVE` on install | Add `--legacy-peer-deps`. |
| Site unreachable from outside | Firewall, or the server bound to localhost. It binds `0.0.0.0` by default; check `sudo ufw status`. |
| Password unknown | It's printed at boot: `journalctl -u smopi | grep Password`. |
| Share says expired | `SHARE_EXPIRY` elapsed. Set a larger value (or `0`) and restart. |
| Uploads fail >1 MB behind nginx | `client_max_body_size 0;` must be in the server block. |
