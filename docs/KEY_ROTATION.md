# Rotating `CUSTOMER_FIELD_KEY` and `ATTACHMENT_KEY`

Both keys can be rotated **while the app keeps running**. There is no
maintenance window: a single-server install sees one ordinary restart, and a
multi-server install sees none.

## How it works

Each encrypted store has a *current* key and an optional list of *previous*
keys:

| Store | Current key | Previous keys (decrypt only) |
|---|---|---|
| Customer and asset details, personal webhooks, the RT token | `CUSTOMER_FIELD_KEY` | `CUSTOMER_FIELD_KEYS_PREVIOUS` |
| Attachments, archived managed reports, report exports | `ATTACHMENT_KEY` | `ATTACHMENT_KEYS_PREVIOUS` |

- New data is always encrypted with the current key.
- Reading tries the current key first, then each previous key. Encryption is
  AES-256-GCM, which authenticates, so a wrong key fails cleanly; it can never
  return wrong data.
- The stored format is unchanged, so an older app version can still read
  everything if you need to roll back a deployment.
- `node scripts/rotate-encryption.js` moves everything still on a previous key
  onto the current key, in the background, while the app serves users.

## Procedure

### 1. Back up first

Back up the database and the `uploads` directory, and store the **current**
keys somewhere safe. A lost key cannot be recovered.

### 2. Generate the new keys

```sh
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Generate one per store you are rotating. You can rotate one store or both.

### 3. Switch to the new key, keeping the old one readable

In the environment (`.env` / secrets manager):

```sh
CUSTOMER_FIELD_KEY=<new field key>
CUSTOMER_FIELD_KEYS_PREVIOUS=<old field key>
ATTACHMENT_KEY=<new attachment key>
ATTACHMENT_KEYS_PREVIOUS=<old attachment key>
```

Restart the app. Everything stays readable, and anything written from now on
uses the new key. The customer search index is rebuilt automatically on
startup for the new key.

**Several app servers?** Do this step in two rolling deploys so no server ever
meets data it cannot read:

1. Every server gets the **new** key as an extra previous key, while still
   encrypting with the old one (`CUSTOMER_FIELD_KEY=<old>`,
   `CUSTOMER_FIELD_KEYS_PREVIOUS=<new>`).
2. Once all servers run that, swap them (`CUSTOMER_FIELD_KEY=<new>`,
   `CUSTOMER_FIELD_KEYS_PREVIOUS=<old>`).

### 4. Re-encrypt in the background

From `server/`, with the same environment as the app:

```sh
node scripts/rotate-encryption.js --check   # how much is still on an old key (writes nothing)
node scripts/rotate-encryption.js           # re-encrypt it
node scripts/rotate-encryption.js --check   # confirm
```

The script is safe to run alongside the app, and safe to stop and re-run:

- It finds encrypted values in every table by itself, including encrypted
  values inside JSON settings.
- Each value is only replaced if it is still exactly what was read, so a user
  editing the same record at the same moment is never overwritten.
- Files are written under a new name, the record is switched to it in one
  update, and only then is the old file deleted. Downloads in progress are
  unaffected.
- Anything no known key can read is listed and left untouched.

It exits with code **0** when nothing is left on a previous key; otherwise run
it again, and investigate any item reported as unreadable.

### 5. Retire the old keys

When `--check` exits 0:

- remove `CUSTOMER_FIELD_KEYS_PREVIOUS` and `ATTACHMENT_KEYS_PREVIOUS`;
- restart (rolling restart with several servers);
- spot-check a few customers and download a few attachments and archived
  reports;
- then securely destroy the old keys.

Report exports are kept for 24 hours. The script also re-encrypts unexpired
ones, but if you skipped a run, keep the old attachment key in
`ATTACHMENT_KEYS_PREVIOUS` for at least 24 hours after switching.

## Checks the app performs

- Startup refuses a malformed key in either `*_PREVIOUS` list, or a previous
  key without a current key.
- Settings → System → health shows each current key's fingerprint and warns while
  previous keys are still configured, so an unfinished rotation is not forgotten; fingerprints are
  short one-way hashes, never the keys themselves.

## Verified

`server/test/keyRotation.test.js` covers reading with retired keys, the
unchanged format, JSON settings, startup validation, and (on PostgreSQL) a
full rotation in which the app edits a record mid-rotation. The procedure above
was also rehearsed end to end on a running server: the old keys were retired
and every customer record, asset and archived report still opened.
