const { decryptCustomer,keyStatus,searchTokenHash }=require('./fieldCipher');
const { SEARCH_FIELDS }=require('./customerDirectory');

function normalizeSearch(value) {
  return String(value || '').normalize('NFKC').toLocaleLowerCase('en').replace(/\s+/g,' ').trim();
}

function searchGrams(value) {
  const normalized=normalizeSearch(value);
  if (normalized.length<3) return [];
  const grams=new Set();
  for (let index=0;index<=normalized.length-3;index++) grams.add(normalized.slice(index,index+3));
  return [...grams];
}

function customerTokenHashes(customer) {
  const hashes=new Set();
  for (const field of SEARCH_FIELDS) for (const gram of searchGrams(customer[field])) {
    const hash=searchTokenHash(gram);if (hash) hashes.add(hash);
  }
  const normalizedName=normalizeSearch(customer.name);
  const nameHash=normalizedName ? searchTokenHash(`name:${normalizedName}`) : null;
  if (nameHash) hashes.add(nameHash);
  return [...hashes];
}

async function replaceCustomerSearchDocument(store,customer) {
  const fingerprint=keyStatus().fingerprint;
  if (!fingerprint) return false;
  await store.prepare('DELETE FROM customer_search_documents WHERE customer_id=?').run(customer.id);
  await store.prepare('INSERT INTO customer_search_documents (customer_id,key_fingerprint,updated_at) VALUES (?,?,app_now())').run(customer.id,fingerprint);
  const insert=store.prepare('INSERT INTO customer_search_tokens (customer_id,token_hash) VALUES (?,?) ON CONFLICT DO NOTHING');
  for (const hash of customerTokenHashes(customer)) await insert.run(customer.id,hash);
  return true;
}

async function candidateCustomerIds(store,search) {
  const grams=searchGrams(search),fingerprint=keyStatus().fingerprint;
  if (!fingerprint || !grams.length) return null;
  const hashes=grams.map(searchTokenHash);
  const placeholders=hashes.map(() => '?').join(',');
  const rows=await store.prepare(`SELECT customer_id,token_hash FROM customer_search_tokens
    WHERE token_hash IN (${placeholders})`).all(...hashes);
  const matches=new Map();
  for (const row of rows) {
    const id=Number(row.customer_id);if (!matches.has(id)) matches.set(id,new Set());matches.get(id).add(row.token_hash);
  }
  return new Set([...matches].filter(([,tokens]) => tokens.size===hashes.length).map(([id]) => id));
}

async function candidateCustomerNameIds(store,name) {
  const normalized=normalizeSearch(name),fingerprint=keyStatus().fingerprint;
  if (!fingerprint || !normalized) return null;
  const hash=searchTokenHash(`name:${normalized}`);
  const rows=await store.prepare('SELECT customer_id FROM customer_search_tokens WHERE token_hash=?').all(hash);
  return new Set(rows.map(row => Number(row.customer_id)));
}

async function ensureCustomerSearchIndex(store) {
  const fingerprint=keyStatus().fingerprint;
  if (!fingerprint) return { indexed:0,skipped:true };
  const rows=await store.prepare(`SELECT c.* FROM customers c
    LEFT JOIN customer_search_documents d ON d.customer_id=c.id AND d.key_fingerprint=?
    WHERE d.customer_id IS NULL`).all(fingerprint);
  if (!rows.length) return { indexed:0,skipped:false };
  await store.transaction(async tx => {
    for (const row of rows) await replaceCustomerSearchDocument(tx,decryptCustomer(row));
  });
  return { indexed:rows.length,skipped:false };
}

module.exports={ normalizeSearch,searchGrams,customerTokenHashes,replaceCustomerSearchDocument,candidateCustomerIds,candidateCustomerNameIds,ensureCustomerSearchIndex };
