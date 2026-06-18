# Deployment Runbook — DEV & PROD

Two machines, one per environment, each running the app + its own bundled
PostgreSQL in Docker. Deploys are pulled per-box with `deploy/deploy.sh`.

| Environment | Branch | Machine | Postgres |
|-------------|--------|---------|----------|
| DEV  | `dev`  | dev box  | bundled container (`pgdata` volume) |
| PROD | `prod` | prod box | bundled container (`pgdata` volume) |

Workflow: changes land on `dev`, deploy to the DEV box, verify, promote the exact
tested commit to `prod`, then deploy to the PROD box. The legacy `main` and
`Windows_Server` branches are not part of this AlmaLinux/Docker/PostgreSQL flow.

---

## 1. First-time machine setup (AlmaLinux)

Install Docker Engine + Compose plugin:

```bash
sudo dnf -y install dnf-plugins-core git
sudo dnf config-manager --add-repo https://download.docker.com/linux/centos/docker-ce.repo
sudo dnf -y install docker-ce docker-ce-cli containerd.io docker-compose-plugin
sudo systemctl enable --now docker
sudo usermod -aG docker "$USER"   # log out/in so docker runs without sudo
```

Open the app port in firewalld (only if reached from other hosts):

```bash
sudo firewall-cmd --add-port=8080/tcp --permanent && sudo firewall-cmd --reload
```

SELinux note: the stack uses **named volumes** (`pgdata`, `uploads`), which Docker
labels correctly, so enforcing SELinux needs no extra flags.

Clone the repo:

```bash
sudo mkdir -p /opt/app && sudo chown "$USER" /opt/app
git clone https://github.com/prodromou27/multiproject-internaltool.git /opt/app
cd /opt/app
```

## 2. Configure secrets (per machine)

Easiest — generate `.env` with fresh secrets from the template:

```bash
./deploy/gen-secrets.sh dev     # on the DEV box
./deploy/gen-secrets.sh prod    # on the PROD box   (writes .env, mode 600)
```

Then review `.env` (`APP_PORT`, `TRUST_PROXY`, etc.). Or do it by hand:

```bash
cp deploy/env.prod.example .env
openssl rand -hex 24   # → POSTGRES_PASSWORD
openssl rand -hex 48   # → JWT_SECRET
openssl rand -hex 32   # → CUSTOMER_FIELD_KEY   (exactly 64 hex chars)
openssl rand -hex 32   # → ATTACHMENT_KEY       (exactly 64 hex chars)
nano .env
```

`deploy.sh` runs a preflight check and refuses to deploy if secrets are still
`CHANGE_ME`, `JWT_SECRET` is under 32 chars, or either encryption key isn't 64 hex.

**Back up `CUSTOMER_FIELD_KEY` and `ATTACHMENT_KEY`** in a secrets manager. Losing
either key makes the corresponding encrypted data unrecoverable. Never commit `.env`
(it's gitignored).

After enabling or changing `CUSTOMER_FIELD_KEY`, run the customer encryption
backfill from the `server/` directory:

```bash
npm run encrypt:customers -- --dry
npm run encrypt:customers
```

The Admin `Deployment Health` tab reports the active customer-key fingerprint and
whether any populated customer fields are still plaintext.

## 3. Deploy

```bash
./deploy/deploy.sh dev     # on the DEV box
./deploy/deploy.sh prod    # on the PROD box
```

The script pulls the right branch, rebuilds, starts the stack, and waits for the
app healthcheck (`/api/health`). On the very first run the seeded admin password
is printed once to the app logs:

```bash
docker compose logs app | grep -A4 'admin account'
```

Log in at `http://<host>:8080` as `admin@company.com` and change the password.

Re-deploying later is the same command — it pulls the latest commit on the branch
and rebuilds. To deploy a specific build, `git checkout <tag>` first or set
`DEPLOY_BRANCH=<branch>`.

## 3b. Promote DEV to PROD

Only promote after the DEV box is running the commit you intend to release and the
verification checklist passes.

```bash
git fetch origin
git checkout prod
git merge --ff-only dev
git push origin prod
```

If `prod` does not exist yet, create it from the verified DEV commit:

```bash
git checkout -b prod dev
git push -u origin prod
```

Then deploy from the PROD box:

```bash
./deploy/deploy.sh prod
```

Use a tag for important releases:

```bash
git tag prod-YYYYMMDD
git push origin prod-YYYYMMDD
```

## 4. TLS (production)

The app container serves plain HTTP. In production, front it with a TLS-terminating
reverse proxy on the host. A ready nginx config is in
[`deploy/nginx.conf.example`](nginx.conf.example) (Caddy one-liner alternative
included):

```bash
sudo cp deploy/nginx.conf.example /etc/nginx/conf.d/solutionshub.conf
# edit server_name; then get a cert:
sudo dnf install -y certbot python3-certbot-nginx
sudo certbot --nginx -d app.example.com
sudo nginx -t && sudo systemctl reload nginx
```

In `.env` set `APP_PORT=127.0.0.1:8080` (only the proxy can reach the app) and
`TRUST_PROXY=1` (so the audit log and rate limiter see the real client IP from
`X-Forwarded-For`). The prod env template already has both.

## 4b. Auto-start on boot (systemd, optional)

Docker's `restart: unless-stopped` already restarts containers when the daemon
starts. To manage the whole stack as one service and re-apply config on boot,
install the unit:

```bash
sudo cp deploy/systemd/solutionshub.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now solutionshub
sudo systemctl status solutionshub
```

The app handles `SIGTERM` (stops accepting connections, drains, closes the DB
pool), so `systemctl stop` / `docker compose down` / redeploys shut down cleanly
instead of being force-killed.

## 5. Backups (production)

```bash
./deploy/backup.sh prod                     # one-off dump → deploy/backups/
./deploy/restore.sh prod deploy/backups/app-YYYYmmdd-HHMMSS.sql.gz
```

Schedule daily dumps via cron:

```bash
( crontab -l 2>/dev/null; echo "30 2 * * * /opt/app/deploy/backup.sh prod >> /var/log/app-backup.log 2>&1" ) | crontab -
```

Dumps older than `BACKUP_RETENTION_DAYS` (default 14) are pruned automatically.

## 6. Import legacy SQLite data (one-time, PROD promotion)

To carry data over from the old Windows/SQLite app, copy its `app.db` to the box
and run:

```bash
./deploy/migrate-from-sqlite.sh prod /path/to/app.db
```

It preserves ids, resets sequences, transfers encrypted PII verbatim, and is
re-runnable. Afterward, verify row counts and that a known customer decrypts via
the API.

## 7. Common operations

```bash
docker compose logs -f app                 # tail app logs
docker compose ps                          # status + health
docker compose down                        # stop (keeps volumes/data)
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d --build   # prod up (what deploy.sh prod runs)
```

**Rollback:** `git checkout <previous-commit>` then re-run `./deploy/deploy.sh <env>`.
Data in the `pgdata` volume is unaffected by redeploys. If a release includes a
breaking schema change, restore the latest pre-deploy backup (step 5).

## 8. Verify a deploy

```bash
BASE=http://localhost:8080
curl -s $BASE/api/health                                              # {"status":"ok","db":"up"}
TOKEN=$(curl -s $BASE/api/auth/login -H 'Content-Type: application/json' \
  -d '{"email":"admin@company.com","password":"<from logs>"}' | jq -r .token)
curl -s -o /dev/null -w '%{http_code}\n' $BASE/api/projects -H "Authorization: Bearer $TOKEN"  # 200
curl -s -o /dev/null -w '%{http_code}\n' $BASE/api/projects                                    # 401
```

See the project-root `docs/DEPLOY.md` for the fuller verification checklist.

You can also run the automated smoke test against a live environment:

```bash
SMOKE_PASSWORD='<admin password>' ./deploy/smoke-test.sh
```

Security controls are tracked in [`docs/SECURITY_OWASP.md`](../docs/SECURITY_OWASP.md).
