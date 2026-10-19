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

Open the app port in firewalld (dev, only if reached from other hosts; production
uses 443 and 80 instead, see section 4):

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

For a fresh Docker server, install prerequisites, generate secrets, deploy, and
perform future updates with one idempotent command:

```bash
sudo APP_URL=http://SERVER_IP:8080 DEPLOY_BRANCH=DEV-2 ./deploy/bootstrap.sh dev
```

The bootstrap supports AlmaLinux/RHEL (`dnf`) and Ubuntu/Debian (`apt-get`). It
installs Docker only when missing, preserves an existing `.env` and named Docker
volumes, pulls the selected branch, rebuilds the app, and waits for the healthcheck.
For production (HTTPS on port 443): put the company certificate in `certs/`
first (section 4), then:

```bash
sudo APP_URL=https://app.example.com DEPLOY_BRANCH=prod ./deploy/bootstrap.sh prod
```

The shorter command below is sufficient once Docker is already installed.

```bash
./deploy/deploy.sh dev     # on the DEV box
./deploy/deploy.sh prod    # on the PROD box
```

The script pulls the right branch, rebuilds, starts the stack, and waits for the
app healthcheck (`/api/health`). On the first empty-database installation, log in
at `http://<host>:8080` (dev) or your `https://` address (production) with username
`admin` and password `admin`. The application
immediately requires a new password.

Re-deploying later is the same command — it pulls the latest commit on the branch
and rebuilds. To deploy a specific build, `git checkout <tag>` first or set
`DEPLOY_BRANCH=<branch>`.

To test another development branch from the same folder and Docker stack, keep
the environment as `dev` and override only the branch:

```bash
DEPLOY_BRANCH=DEV-2 ./deploy/deploy.sh dev
```

If `.env` is missing on a dev deploy, the script generates one automatically
from `deploy/env.dev.example` with fresh secrets. Pass `APP_URL` or `APP_PORT`
in the same command when the defaults are not right for the box:

```bash
APP_URL=http://dev.example.com:8080 APP_PORT=8080 DEPLOY_BRANCH=DEV-2 ./deploy/deploy.sh dev
```

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

## 4. HTTPS on port 443 (production)

`./deploy/deploy.sh prod` serves the app over HTTPS on **port 443**, and port 80
redirects to it. A Caddy container (`proxy` in `docker-compose.prod.yml`,
configured by [`deploy/Caddyfile`](Caddyfile)) holds the company certificate and
forwards to the app. The app itself then listens only on `127.0.0.1:8080`, so
port 8080 is no longer reachable from the network.

**No certificate yet?** Then production serves **plain HTTP on port 80**
([`deploy/Caddyfile.http`](Caddyfile.http)) with `APP_URL=http://<server name>`
(no port), and the deploy prints a warning: passwords and sessions cross the
network unencrypted. Once the certificate is in `certs/`, set
`APP_URL=https://<server name>` and deploy again; it switches to HTTPS on 443 by
itself, and port 80 then redirects.

**1. Put the company certificate on the server**, in `certs/` at the repo root
(the folder is git-ignored):

| File | What it holds |
| --- | --- |
| `certs/tls.crt` | The server certificate, **followed by** the intermediate CA certificate(s), all PEM |
| `certs/tls.key` | Its private key, PEM, without a password |

```bash
mkdir -p certs
cat server.crt intermediate.crt > certs/tls.crt     # the order matters: server first
cp server.key certs/tls.key
sudo chown root:root certs/tls.key && sudo chmod 600 certs/tls.key   # the proxy reads it as root
```

If IT gives you a `.pfx` / `.p12` file instead:

```bash
openssl pkcs12 -in company.pfx -clcerts -nokeys -out server.crt
openssl pkcs12 -in company.pfx -cacerts -nokeys -out intermediate.crt
openssl pkcs12 -in company.pfx -nocerts -nodes  -out certs/tls.key
cat server.crt intermediate.crt > certs/tls.crt
```

To keep the certificate elsewhere, set `TLS_CERT_DIR=/path/to/dir` in `.env`.

**2. Set the address in `.env`**: `APP_URL=https://teamhub.company.local` (the
name on the certificate, which must also resolve in your internal DNS).
`TRUST_PROXY` defaults to 1 in production; `APP_PORT` is not used there.

**3. Deploy**: `DEPLOY_BRANCH=<branch> ./deploy/deploy.sh prod`. Before
building, it checks that the certificate is there, is not expired, matches its
key and covers the host in `APP_URL`, and warns 30 days before it expires.
`bootstrap.sh prod` opens 443 and 80 in firewalld; otherwise:

```bash
sudo firewall-cmd --add-service=https --add-service=http --permanent && sudo firewall-cmd --reload
# and close the old port if it was opened:  sudo firewall-cmd --remove-port=8080/tcp --permanent
```

**Renewing the certificate**: replace the two files, then
`docker compose -f docker-compose.yml -f docker-compose.prod.yml restart proxy`.

**Check it**: `curl -I https://teamhub.company.local/api/health` answers
`200`, and `curl -I http://teamhub.company.local` answers `301` to https.
`./deploy/smoke-test.sh` still runs against `http://localhost:8080` on the server.

Prefer nginx on the host instead? [`deploy/nginx.conf.example`](nginx.conf.example)
does the same job; then deploy without the `proxy` service and bind the app to
`127.0.0.1:8080`.

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

TeamHub backs up its own database: **Settings → Backups**. By default it makes
one backup a day at 02:30 (organisation time) and keeps 14 days, always keeping
the newest 3. From there a manager can back up now, check a backup (restore it
into a temporary database), download one, upload one, and restore one. A
restore first backs up the current data, runs in a single transaction (a
failure changes nothing) and then restarts the app.

Each backup also holds the **uploaded files** (attachments and generated customer
reports, from the `uploads` volume; report exports, which expire within a day,
are left out) in `teamhub-…files.tar.gz` beside the database dump. They are
checked, restored, pruned, deleted and copied off the server together with it;
"Include uploaded files" in the schedule turns this off. Attachments stay
encrypted as stored, so restoring them on a new server needs the same
`ATTACHMENT_KEY` (and `CUSTOMER_FIELD_KEY` for the database): keep `.env` safe
too. To put the files back by hand (e.g. after `deploy/restore.sh`):

```bash
docker run --rm -v <project>_uploads:/u -v "$PWD":/b alpine \
  sh -c 'rm -rf /u/* && tar -xzf /b/teamhub-YYYYmmdd-HHMMSS-scheduled.files.tar.gz -C /u && chown -R 100:101 /u'
# use the app user's uid:gid from `docker compose exec app id`
```

Uploaded backups are checked statement by statement before use: only the kinds
of statement pg_dump writes are accepted (no psql commands, no `DO` blocks or
other queries, no `COPY` to or from a program or server file, no `ALTER SYSTEM`,
no roles, no languages other than sql/plpgsql, no extensions other than
`pg_trgm`). That check narrows what a file can do but is not a sandbox, so only
upload backups you made yourself, and have the app connect as a database user
that is **not a superuser** (the `POSTGRES_USER` the postgres image creates is
one). A role that owns the database and has `CREATEDB` (for the backup check) is
enough, for example:

```sql
CREATE ROLE teamhub LOGIN PASSWORD '…' CREATEDB NOSUPERUSER NOCREATEROLE;
ALTER DATABASE app OWNER TO teamhub;
\c app
ALTER SCHEMA public OWNER TO teamhub;
REASSIGN OWNED BY app TO teamhub;  -- the tables made so far
```

Then set `DATABASE_URL` to that user. Without superuser rights, a backup cannot
run programs or read files on the database server even if one got past the check.

Backups are stored in the `backups` Docker volume (`/app/server/backups`).
Keep copies off this server too. The simplest way is **Off-server copies** on the
same page: after each backup, TeamHub encrypts it (AES-256-GCM, with a passphrase
you set) and uploads it over SFTP to a folder on another server, whose SSH host key
you trust once ("Test connection" → "Trust this key"). Copies past the retention
are removed from that server. Keep the passphrase in your password manager: to
restore a copy, for example on a new server, decrypt it first (needs only Node.js):

```bash
BACKUP_PASSPHRASE='…' node deploy/decrypt-backup.js teamhub-YYYYmmdd-HHMMSS-scheduled.sql.gz.enc
# → teamhub-YYYYmmdd-HHMMSS-scheduled.sql.gz, restorable as below or via Settings → Backups → Upload
```

To copy backups to a **network share** (NAS or file server, SMB or NFS) instead of,
or as well as, SFTP: mount the share into the container under `/mnt`, then use
**Settings → Backups → Network share** (folder `/mnt/backup-share`, "Test folder",
"Turn on"). The same passphrase and retention apply; TeamHub only writes and
removes its own `teamhub-…sql.gz.enc` files there.

```bash
cp deploy/backup-share.compose.example.yml docker-compose.override.yml
# edit it: the share address, user, and uid/gid from `docker compose exec app id`
echo 'BACKUP_SHARE_PASSWORD=…' >> .env
./deploy/deploy.sh prod          # picks up docker-compose.override.yml
```

The app only accepts a folder inside `/mnt` (change with `BACKUP_SHARE_ROOT`) that
is a mounted filesystem, so copies never land on the container's own disk by
mistake. If the share is not mounted, the copy fails and shows on the Backups page and in
System health; the backup itself is unaffected.

Otherwise download a backup regularly, or copy the volume
(`docker run --rm -v <project>_backups:/b -v "$PWD":/out alpine cp -r /b /out`).
The files are the same gzipped SQL as the scripts below, so either can restore
the other's backups. The scripts remain for use from the host, for example to
restore when the app itself will not start:

```bash
./deploy/backup.sh prod                     # one-off dump → deploy/backups/
./deploy/verify-backup.sh prod deploy/backups/app-YYYYmmdd-HHMMSS.sql.gz
./deploy/restore.sh prod deploy/backups/app-YYYYmmdd-HHMMSS.sql.gz
```

Schedule daily dumps via cron:

```bash
( crontab -l 2>/dev/null; echo "30 2 * * * /opt/app/deploy/backup.sh prod >> /var/log/app-backup.log 2>&1" ) | crontab -
```

Dumps older than `BACKUP_RETENTION_DAYS` (default 14) are pruned automatically.
Every backup is checked with `gzip -t` and recorded for the management Deployment
Health screen. Run the non-destructive verifier at least monthly; it restores into a
temporary PostgreSQL database, checks core tables, drops the temporary database and
records the successful verification without changing live application data.

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
