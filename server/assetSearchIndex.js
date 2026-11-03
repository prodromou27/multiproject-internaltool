/* A blind index for searching customer assets, following customerSearchIndex.js.
   Asset names, hostnames, serials, tags, IPs, MACs and models are encrypted at
   rest, so the database cannot match them. Instead each asset stores keyed hashes
   (HMAC with the field key) of the 3-letter pieces of those fields. A search hashes
   the pieces of what was typed and asks the database for assets holding all of
   them; only those few candidates are decrypted and checked. The hashes reveal no
   values, and they are rebuilt when the key changes (its fingerprint is kept). */
const { decrypt, keyStatus, searchTokenHash } = require('./fieldCipher');
const { searchGrams } = require('./customerSearchIndex');

const MAX_CANDIDATES = 2000;
const FIELDS = ['name', 'hostname', 'serial_number', 'asset_tag', 'ip_address', 'mac_address', 'model'];
// The hashes are domain-separated from the customers' ("asset:" in front).
const hashOf = gram => searchTokenHash(`asset:${gram}`);

function assetTokenHashes(asset) {
  const hashes = new Set();
  for (const field of FIELDS) for (const gram of searchGrams(asset[field])) { const hash = hashOf(gram); if (hash) hashes.add(hash); }
  return [...hashes];
}

/** (Re)indexes one asset; `asset` holds the plain (decrypted) values. */
async function replaceAssetSearchDocument(store, asset) {
  const fingerprint = keyStatus().fingerprint;
  if (!fingerprint) return false;
  await store.prepare('DELETE FROM asset_search_tokens WHERE asset_id=?').run(asset.id);
  await store.prepare('DELETE FROM asset_search_documents WHERE asset_id=?').run(asset.id);
  await store.prepare('INSERT INTO asset_search_documents (asset_id,key_fingerprint,updated_at) VALUES (?,?,app_now())').run(asset.id, fingerprint);
  const insert = store.prepare('INSERT INTO asset_search_tokens (asset_id,token_hash) VALUES (?,?) ON CONFLICT DO NOTHING');
  for (const hash of assetTokenHashes(asset)) await insert.run(asset.id, hash);
  return true;
}

/** Asset ids holding every piece of `search`, or null when the index cannot answer
 *  (no field key, or fewer than 3 characters). */
async function candidateAssetIds(store, search) {
  const grams = searchGrams(search), fingerprint = keyStatus().fingerprint;
  if (!fingerprint || !grams.length) return null;
  const hashes = [...new Set(grams.map(hashOf))];
  const list = values => values.map(() => '?').join(',');
  // Rarest pieces first: common ones ("fgt", "60f") are in every asset, so they are
  // only counted here, and the candidates come from the two rarest.
  const counts = await store.prepare(`SELECT token_hash,COUNT(*) AS n FROM asset_search_tokens WHERE token_hash IN (${list(hashes)}) GROUP BY token_hash`).all(...hashes);
  if (counts.length < hashes.length) return new Set(); // a piece no asset has
  const rarest = counts.sort((a, b) => Number(a.n) - Number(b.n)).slice(0, 2).map(row => row.token_hash);
  let ids = null;
  for (const hash of rarest) {
    const found = new Set((await store.prepare('SELECT asset_id FROM asset_search_tokens WHERE token_hash=?').all(hash)).map(row => Number(row.asset_id)));
    ids = ids ? new Set([...ids].filter(id => found.has(id))) : found;
    if (!ids.size) return ids;
  }
  // Search shows the newest matches first, and only a few: keep the newest
  // MAX_CANDIDATES so a very common term stays bounded (and within query limits).
  if (ids.size > MAX_CANDIDATES) ids = new Set([...ids].sort((a, b) => b - a).slice(0, MAX_CANDIDATES));
  if (hashes.length <= rarest.length) return ids;
  // The few left must hold every piece.
  const rows = await store.prepare(`SELECT asset_id,COUNT(DISTINCT token_hash) AS hits FROM asset_search_tokens
    WHERE asset_id IN (${list([...ids])}) AND token_hash IN (${list(hashes)}) GROUP BY asset_id`).all(...ids, ...hashes);
  return new Set(rows.filter(row => Number(row.hits) === hashes.length).map(row => Number(row.asset_id)));
}

/** Indexes assets that have no entry for the current key (new installs, key rotation). */
async function ensureAssetSearchIndex(store) {
  const fingerprint = keyStatus().fingerprint;
  if (!fingerprint) return { indexed: 0, skipped: true };
  const rows = await store.prepare(`SELECT a.id,${FIELDS.map(field => `a.${field}`).join(',')} FROM customer_assets a
    LEFT JOIN asset_search_documents d ON d.asset_id=a.id AND d.key_fingerprint=?
    WHERE d.asset_id IS NULL`).all(fingerprint);
  if (!rows.length) return { indexed: 0, skipped: false };
  await store.transaction(async tx => {
    for (const row of rows) await replaceAssetSearchDocument(tx, Object.fromEntries([['id', row.id], ...FIELDS.map(field => [field, decrypt(row[field])])]));
  });
  return { indexed: rows.length, skipped: false };
}

module.exports = { FIELDS, MAX_CANDIDATES, assetTokenHashes, replaceAssetSearchDocument, candidateAssetIds, ensureAssetSearchIndex };
