/**
 * Moves encrypted data onto the current keys while the app keeps running.
 *
 * Database values: every text column of every table is scanned for field
 * ciphertext ("enc:..."), including encrypted strings inside JSON (e.g. the
 * Request Tracker token in settings). Nothing has to be listed by hand, so a
 * column added later cannot be missed.
 *
 * Files: attachments, managed report archives and unexpired report exports are
 * re-encrypted into a NEW file; the row is switched to it in one update, and
 * only then is the old file removed. A download already in progress keeps
 * reading the old file.
 *
 * Every write is compare-and-swap ("... WHERE <key>=? AND <col>=<what we read>"):
 * if the app changed a value in the meantime the update matches nothing, the
 * fresh value is left alone (it was written with the current key anyway), and
 * the item is reported as skipped. Values no known key can decrypt are reported
 * and never overwritten. Safe to stop and re-run at any time.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const db = require('./db');
const fieldCipher = require('./fieldCipher');
const fileCipher = require('./cipher');
const { uploadDir } = require('./uploadUtils');
const { exportRoot } = require('./customReportExport');

const quote = name => `"${String(name).replace(/"/g, '""')}"`;
const looksLikeJson = value => typeof value === 'string' && /^\s*[[{]/.test(value) && value.includes('"enc:');

// Walk parsed JSON, re-encrypting every "enc:..." string; returns [newValue, changed].
function reencryptJson(node) {
  if (typeof node === 'string') {
    if (!fieldCipher.isEncrypted(node)) return [node, false];
    const next = fieldCipher.reencrypt(node);
    return next ? [next, true] : [node, false];
  }
  if (Array.isArray(node)) {
    let changed = false;
    const out = node.map(item => { const [value, didChange] = reencryptJson(item); changed ||= didChange; return value; });
    return [out, changed];
  }
  if (node && typeof node === 'object') {
    let changed = false;
    const out = {};
    for (const [key, item] of Object.entries(node)) { const [value, didChange] = reencryptJson(item); changed ||= didChange; out[key] = value; }
    return [out, changed];
  }
  return [node, false];
}

/** Text columns of user tables, with each table's single-column primary key. */
async function textColumns(store) {
  const columns = await store.prepare(`
    SELECT c.table_name, c.column_name, k.column_name AS pk
    FROM information_schema.columns c
    JOIN information_schema.table_constraints t ON t.table_schema=c.table_schema AND t.table_name=c.table_name AND t.constraint_type='PRIMARY KEY'
    JOIN information_schema.key_column_usage k ON k.constraint_name=t.constraint_name AND k.table_schema=t.table_schema AND k.table_name=t.table_name
    WHERE c.table_schema=current_schema() AND c.data_type IN ('text','character varying')
      AND c.column_name<>k.column_name
      AND (SELECT COUNT(*) FROM information_schema.key_column_usage k2 WHERE k2.constraint_name=t.constraint_name AND k2.table_schema=t.table_schema) = 1
    ORDER BY c.table_name, c.column_name`).all();
  return columns;
}

async function rotateFields({ store = db, dryRun = false, batchSize = 500, log = () => {} } = {}) {
  const summary = { scanned: 0, onCurrentKey: 0, reencrypted: 0, skippedChanged: 0, unreadable: [] };
  for (const { table_name: table, column_name: column, pk } of await textColumns(store)) {
    const t = quote(table), c = quote(column), k = quote(pk);
    let after = null;
    for (;;) {
      // Keyset pagination over candidate rows: whole-value ciphertext or JSON containing it.
      const rows = await store.prepare(`SELECT ${k} AS pk, ${c} AS value FROM ${t}
        WHERE (${c} LIKE 'enc:%' OR ${c} LIKE '%"enc:%')${after === null ? '' : ` AND ${k} > ?`}
        ORDER BY ${k} LIMIT ${Number(batchSize)}`).all(...(after === null ? [] : [after]));
      if (!rows.length) break;
      after = rows[rows.length - 1].pk;
      for (const row of rows) {
        summary.scanned++;
        let next = null;
        try {
          if (fieldCipher.isEncrypted(row.value)) next = fieldCipher.reencrypt(row.value);
          else if (looksLikeJson(row.value)) {
            const [value, changed] = reencryptJson(JSON.parse(row.value));
            next = changed ? JSON.stringify(value) : null;
          }
        } catch (error) {
          summary.unreadable.push(`${table}.${column} ${pk}=${row.pk}: ${error.message}`);
          continue;
        }
        if (next === null) { summary.onCurrentKey++; continue; }
        if (dryRun) { summary.reencrypted++; continue; }
        const result = await store.prepare(`UPDATE ${t} SET ${c}=? WHERE ${k}=? AND ${c}=?`).run(next, row.pk, row.value);
        if (result.changes) summary.reencrypted++;
        else summary.skippedChanged++;
      }
      log(`fields: ${table}.${column} up to ${pk}=${after}`);
    }
  }
  return summary;
}

// File stores: table, its columns, and where the files live.
const FILE_STORES = [
  { table: 'attachments', name: 'stored_name', iv: 'enc_iv', tag: 'enc_tag', dir: () => uploadDir },
  { table: 'managed_report_history', name: 'stored_name', iv: 'enc_iv', tag: 'enc_tag', dir: () => uploadDir },
  // Report exports are deleted after 24 hours, but re-encrypt unexpired ones too.
  { table: 'background_jobs', name: 'artifact_path', iv: 'artifact_iv', tag: 'artifact_tag', dir: () => exportRoot, where: "AND artifact_expires_at > app_now()" },
];

async function rotateFiles({ store = db, dryRun = false, log = () => {} } = {}) {
  const summary = { scanned: 0, onCurrentKey: 0, reencrypted: 0, skippedChanged: 0, missing: 0, unreadable: [] };
  if (!fileCipher.isConfigured()) return summary;
  for (const spec of FILE_STORES) {
    const rows = await store.prepare(`SELECT id, ${spec.name} AS name, ${spec.iv} AS iv, ${spec.tag} AS tag FROM ${spec.table}
      WHERE ${spec.iv} IS NOT NULL AND ${spec.tag} IS NOT NULL AND ${spec.name} IS NOT NULL ${spec.where || ''} ORDER BY id`).all();
    for (const row of rows) {
      summary.scanned++;
      const base = path.basename(String(row.name));
      const dir = spec.dir();
      const oldPath = path.join(dir, base);
      let data;
      try { data = await fs.promises.readFile(oldPath); } catch (error) {
        if (error.code === 'ENOENT') { summary.missing++; continue; }
        throw error;
      }
      let detail;
      try { detail = fileCipher.decryptDetailed(data, row.iv, row.tag); } catch (error) {
        summary.unreadable.push(`${spec.table} id=${row.id} (${base}): ${error.message}`);
        continue;
      }
      if (detail.onCurrentKey) { summary.onCurrentKey++; continue; }
      if (dryRun) { summary.reencrypted++; continue; }
      const encrypted = fileCipher.encrypt(detail.plaintext);
      const ext = path.extname(base);
      const newName = `${path.basename(base, ext)}-k${crypto.randomBytes(4).toString('hex')}${ext}`;
      const newPath = path.join(dir, newName);
      await fs.promises.writeFile(newPath, encrypted.data, { mode: 0o600, flag: 'wx' });
      const result = await store.prepare(`UPDATE ${spec.table} SET ${spec.name}=?, ${spec.iv}=?, ${spec.tag}=?
        WHERE id=? AND ${spec.name}=? AND ${spec.iv}=? AND ${spec.tag}=?`).run(newName, encrypted.iv, encrypted.tag, row.id, row.name, row.iv, row.tag);
      if (result.changes) {
        summary.reencrypted++;
        await fs.promises.unlink(oldPath).catch(error => { if (error.code !== 'ENOENT') throw error; });
      } else {
        summary.skippedChanged++;
        await fs.promises.unlink(newPath).catch(() => {});
      }
    }
    log(`files: ${spec.table} done`);
  }
  return summary;
}

/** Runs both passes. With dryRun nothing is written; counts show what would change. */
async function rotateAll(options = {}) {
  return { fields: await rotateFields(options), files: await rotateFiles(options) };
}

module.exports = { rotateAll, rotateFields, rotateFiles, reencryptJson };
