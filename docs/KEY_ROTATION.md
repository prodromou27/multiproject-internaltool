# Rotating `CUSTOMER_FIELD_KEY` and `ATTACHMENT_KEY`

This is a runbook, not a script. Both keys use a **single-key** design
(`server/fieldCipher.js`, `server/cipher.js`) — there is no key ID stored
alongside the ciphertext, and `decrypt()` only ever tries the one key
currently in the environment. That means **this app cannot decrypt old
data with a new key**: rotating either key requires re-encrypting every
existing row/file with the new key in one pass, during a maintenance
window. There is no zero-downtime path today. See "Why this is a runbook
and not a rotation feature" below before deciding when to do this.

## Before you start

- **Back up the database and the `attachments` upload directory.** A
  mistake here (wrong key, interrupted run, wrong environment) can make
  data permanently unrecoverable — there is no way to guess a lost key.
- Schedule a maintenance window. Writes to `customers` or `attachments`
  during the rotation can be silently skipped or double-encrypted,
  depending on when they land relative to the migration pass. Stop the
  app (or at minimum block writes to those tables) for the duration.
- Confirm you have the **current** key value before generating a new
  one — you need both to re-encrypt, not just the new one.

## Rotating `CUSTOMER_FIELD_KEY` (customer PII: name, contact, address, notes)

1. Generate a new key: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`.
2. With the app stopped (or writes to `customers` blocked), write a
   one-off script modeled on `server/scripts/encrypt-existing-customers.js`
   that, for every customer row:
   - reads each encrypted field with the **old** key (`fieldCipher.decrypt`,
     old `CUSTOMER_FIELD_KEY` in the environment),
   - re-encrypts it with the **new** key,
   - writes it back.
   `encrypt-existing-customers.js` already contains the field list and the
   `enc:` prefix convention (`isEncrypted()`/`decrypt()`/`encrypt()` in
   `fieldCipher.js`) to copy from — this is a rotation pass of the same
   shape as that initial backfill, not new logic to design from scratch.
3. Set `CUSTOMER_FIELD_KEY` to the new value in the environment.
4. Restart the app. The customer search index (`customer_search_tokens`) is
   keyed by `CUSTOMER_FIELD_KEY` too; it records the key fingerprint it was
   built with and `ensureCustomerSearchIndex()` rebuilds any customer whose
   fingerprint no longer matches, so no manual step is needed — but search
   results will be incomplete until that finishes, so check it after the
   restart. Then spot-check a handful of customers (names, contact
   info) render correctly — a wrong key doesn't error, it just returns
   garbage or throws inside `decrypt()`, so check actual values, not just
   "no crash."
5. Only after confirming: securely destroy the old key.

## Rotating `ATTACHMENT_KEY` (uploaded files)

Same shape, at the file level instead of the row level:

1. Generate a new key the same way.
2. With the app stopped, write a one-off script that, for every row in
   `attachments` with `enc_iv`/`enc_tag` set:
   - reads the stored file and decrypts it with `cipher.decrypt()` using
     the **old** key,
   - re-encrypts with `cipher.encrypt()` using the **new** key,
   - writes the new ciphertext back to disk and updates `enc_iv`/`enc_tag`
     in the `attachments` row (the IV changes on every encrypt call, so
     both must be updated together — don't reuse the old IV).
3. Set `ATTACHMENT_KEY` to the new value, restart, and spot-check by
   downloading a few existing attachments end-to-end (not just checking
   the file changed on disk).
4. Only after confirming: securely destroy the old key.

## Why this is a runbook and not a rotation feature

Adding real, zero-downtime key rotation (encrypt with the newest key,
decrypt-with-any-known-key) is a legitimate improvement, but it changes
the on-disk/on-row format (a key ID would need to be stored per record)
and needs to be validated against real encrypted data to trust — neither
of which is safe to do blind, without a database to test against, in a
single pass. This runbook is the safe alternative for now: manual,
downtime-based, but doesn't touch the cipher format or risk the existing
encrypted data. If/when zero-downtime rotation is worth building, start
in `server/fieldCipher.js` and `server/cipher.js`: add a key ID prefix to
the stored value, keep a small ordered list of known keys for `decrypt()`
to try, and always encrypt with the newest one.
