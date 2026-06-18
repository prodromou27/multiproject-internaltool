# Deployment Runbook — DEV & PROD

Two machines, one per environment, each running the app + its own bundled
PostgreSQL in Docker. Deploys are pulled per-box with `deploy/deploy.sh`.

| Environment | Branch | Machine | Postgres |
|-------------|--------|---------|----------|
| DEV  | `dev`  | dev box  | bundled container (`pgdata` volume) |
| PROD | `main` | prod box | bundled container (`pgdata` volume) |

Workflow: changes land on `dev` → deploy to the DEV box → verify → merge `dev`
into `main` → deploy to the PROD box.

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

```bash
# DEV box:
cp deploy/env.dev.example .env
# PROD box:
cp deploy/env.prod.example .env

# Fill in strong, unique values (different per environment):
openssl rand -hex 24   # → POSTGRES_PASSWORD
openssl rand -hex 48   # → JWT_SECRET
openssl rand -hex 32   # → CUSTOMER_FIELD_KEY   (exactly 64 hex chars)
nano .env
```

**Back up `CUSTOMER_FIELD_KEY`** in a secrets manager — losing it makes encrypted
customer PII unrecoverable. Never commit `.env` (it's gitignored).

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

## 4. TLS (production)

The app container serves plain HTTP on the published port. In production, front it
with a TLS-terminating reverse proxy (nginx / Caddy / Traefik) on the host that
forwards 443 → `127.0.0.1:8080`. Keep `APP_PORT` bound to localhost if a proxy is
in front (set `APP_PORT=127.0.0.1:8080` is not supported by the simple mapping —
instead restrict via firewalld or run the proxy on the same host).

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
