#!/usr/bin/env node
/* Large-data benchmark (review I11): list and search latency, queries per request
   and decryptions per request on a representative dataset.

   Needs a disposable PostgreSQL database (it is filled with test data):
     BENCH_DATABASE_URL=postgres://user:pass@host/bench_db node scripts/benchmark-large-data.js
   Sizes: BENCH_CUSTOMERS (default 1000), BENCH_ASSETS (20000), BENCH_TASKS (20000),
   BENCH_RUNS per request (30). Prints a table; nothing is kept but the database. */
const crypto = require('crypto');
const { performance } = require('node:perf_hooks');

const url = process.env.BENCH_DATABASE_URL;
if (!url) { console.error('Set BENCH_DATABASE_URL to a disposable PostgreSQL database.'); process.exit(1); }
process.env.DATABASE_URL = url;
process.env.JWT_SECRET = process.env.JWT_SECRET || 'b'.repeat(40);
// A fixed key for the disposable benchmark database, so a second run can read the data it kept.
process.env.CUSTOMER_FIELD_KEY = process.env.CUSTOMER_FIELD_KEY || 'be'.repeat(32);
const SIZES = { customers: Number(process.env.BENCH_CUSTOMERS || 1000), assets: Number(process.env.BENCH_ASSETS || 20000), tasks: Number(process.env.BENCH_TASKS || 20000) };
const RUNS = Number(process.env.BENCH_RUNS || 30);

// Count decryptions: patched before the routes take their copy of decrypt.
const cipher = require('../fieldCipher');
let decrypts = 0;
const realDecrypt = cipher.decrypt;
cipher.decrypt = value => { decrypts += 1; return realDecrypt(value); };

const db = require('../db');
const queryMetrics = require('../queryMetrics');
const { signJwt } = require('../middleware/auth');
const { customerTokenHashes } = require('../customerSearchIndex');
const { assetTokenHashes } = require('../assetSearchIndex');

async function insertMany(table, columns, rows, chunk = 1000) {
  for (let i = 0; i < rows.length; i += chunk) {
    const part = rows.slice(i, i + chunk), params = [];
    const values = part.map(row => `(${row.map(value => { params.push(value); return `$${params.length}`; }).join(',')})`).join(',');
    await db.pool.query(`INSERT INTO ${table} (${columns.join(',')}) VALUES ${values} ON CONFLICT DO NOTHING`, params);
  }
}

async function seed() {
  const { rows: [{ n }] } = await db.pool.query('SELECT COUNT(*)::int AS n FROM customer_assets');
  if (n >= SIZES.assets) { console.log(`Reusing the data already there (${n} assets).`); return; }
  console.log(`Filling: ${SIZES.customers} customers, ${SIZES.assets} assets, ${SIZES.tasks} tasks…`);
  const started = Date.now();
  const hash = crypto.createHash('sha256').update('x').digest('hex');
  const { rows: [manager] } = await db.pool.query("INSERT INTO users (name,email,password,role) VALUES ('Bench Manager','bench.manager@test.local',$1,'manager') ON CONFLICT (email) DO UPDATE SET name=EXCLUDED.name RETURNING id", [hash]);
  const { rows: [engineer] } = await db.pool.query("INSERT INTO users (name,email,password,role) VALUES ('Bench Engineer','bench.engineer@test.local',$1,'engineer') ON CONFLICT (email) DO UPDATE SET name=EXCLUDED.name RETURNING id", [hash]);
  const customers = [];
  for (let i = 1; i <= SIZES.customers; i++) customers.push({ name: `Customer ${String(i).padStart(5, '0')} ${['Logistics', 'Retail', 'Bank', 'Hotel', 'Clinic'][i % 5]}`, contact_name: `Contact ${i}`, contact_email: `it${i}@customer${i}.example` });
  const encrypted = customers.map(c => cipher.encryptCustomer({ ...c }));
  const ids = [];
  for (const c of encrypted) ids.push((await db.pool.query('INSERT INTO customers (name,contact_name,contact_email,active) VALUES ($1,$2,$3,1) RETURNING id', [c.name, c.contact_name, c.contact_email])).rows[0].id);
  const fingerprint = cipher.keyStatus().fingerprint;
  await insertMany('customer_search_documents', ['customer_id', 'key_fingerprint', 'updated_at'], ids.map(id => [id, fingerprint, new Date().toISOString()]));
  await insertMany('customer_search_tokens', ['customer_id', 'token_hash'], customers.flatMap((c, i) => customerTokenHashes(c).map(token => [ids[i], token])), 5000);
  // The engineer works with every 10th customer.
  await insertMany('customer_engineers', ['customer_id', 'user_id'], ids.filter((_, i) => i % 10 === 0).map(id => [id, engineer.id]));

  const assetRows = [], tokens = [];
  const { rows: [{ next }] } = await db.pool.query("SELECT COALESCE(MAX(id),0)+1 AS next FROM customer_assets");
  for (let i = 0; i < SIZES.assets; i++) {
    const plain = { name: `FW-${String(i).padStart(6, '0')}`, hostname: `fw-${i}.site${i % 300}.example.local`, serial_number: `FGT60F${String(1000000 + i)}`, asset_tag: `TAG-${i}`, ip_address: `10.${(i >> 16) & 255}.${(i >> 8) & 255}.${i & 255}`, mac_address: null, model: ['FortiGate 60F', 'FortiGate 100F', 'Catalyst 9300', 'PA-440'][i % 4] };
    const id = Number(next) + i;
    assetRows.push([id, ids[i % ids.length], cipher.encrypt(plain.name), cipher.encrypt(plain.hostname), cipher.encrypt(plain.serial_number), cipher.encrypt(plain.asset_tag), cipher.encrypt(plain.ip_address), cipher.encrypt(plain.model), 'Firewall', manager.id]);
    for (const token of assetTokenHashes(plain)) tokens.push([id, token]);
  }
  await insertMany('customer_assets', ['id', 'customer_id', 'name', 'hostname', 'serial_number', 'asset_tag', 'ip_address', 'model', 'asset_type', 'created_by'], assetRows, 500);
  await db.pool.query("SELECT setval(pg_get_serial_sequence('customer_assets','id'), (SELECT MAX(id) FROM customer_assets))");
  await insertMany('asset_search_documents', ['asset_id', 'key_fingerprint', 'updated_at'], assetRows.map(row => [row[0], fingerprint, new Date().toISOString()]), 2000);
  await insertMany('asset_search_tokens', ['asset_id', 'token_hash'], tokens, 5000);

  const projectIds = [];
  for (let i = 0; i < Math.max(1, SIZES.tasks / 20); i++) projectIds.push((await db.pool.query('INSERT INTO projects (title,customer_id,created_by) VALUES ($1,$2,$3) RETURNING id', [`Project ${i}`, ids[i % ids.length], manager.id])).rows[0].id);
  await insertMany('tasks', ['project_id', 'title', 'status', 'assigned_to', 'created_by', 'deadline'], Array.from({ length: SIZES.tasks }, (_, i) => [projectIds[i % projectIds.length], `Task ${i}`, ['todo', 'in_progress', 'completed'][i % 3], i % 7 === 0 ? engineer.id : null, manager.id, '2026-12-01']));
  console.log(`Filled in ${Math.round((Date.now() - started) / 1000)} s (${tokens.length} asset hashes).`);
}

const percentile = (values, p) => { const sorted = [...values].sort((a, b) => a - b); return sorted[Math.min(sorted.length - 1, Math.ceil(p / 100 * sorted.length) - 1)]; };

async function main() {
  await db.init();
  await seed();
  const express = require('express');
  const app = express();
  app.use(express.json());
  app.use('/api/search', require('../routes/search'));
  app.use('/api/customers', require('../routes/customers'));
  app.use('/api/tasks', require('../routes/tasks'));
  app.use('/api/projects', require('../routes/projects'));
  const server = await new Promise(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const users = (await db.pool.query("SELECT id,role FROM users WHERE email IN ('bench.manager@test.local','bench.engineer@test.local') ORDER BY role DESC")).rows;
  const tokenFor = role => signJwt({ id: users.find(u => u.role === role).id, token_version: 0 });

  const cases = [
    ['Search: asset serial (manager)', 'manager', '/api/search?q=FGT60F1012345'],
    ['Search: asset hostname (engineer)', 'engineer', '/api/search?q=fw-4242.site'],
    ['Search: 2 letters (bounded scan)', 'manager', '/api/search?q=FW'],
    ['Customers: paged search', 'manager', '/api/customers?paged=1&search=logistics&page_size=25'],
    ['Customers: first page', 'manager', '/api/customers?paged=1&page_size=25'],
    ['Projects: first page', 'manager', '/api/projects?paged=1&page_size=25'],
    ['Tasks: first page', 'manager', '/api/tasks?page=1&page_size=25'],
  ];
  const results = [];
  for (const [label, role, path] of cases) {
    const token = tokenFor(role), times = [], queries = [], decrypted = [];
    let status = 0;
    for (let run = 0; run < RUNS + 3; run++) {
      queryMetrics.reset(); decrypts = 0;
      const started = performance.now();
      const res = await fetch(base + path, { headers: { Authorization: `Bearer ${token}` } });
      await res.arrayBuffer();
      if (run < 3) continue; // warm-up
      status = res.status;
      times.push(performance.now() - started); queries.push(queryMetrics.snapshot().count); decrypted.push(decrypts);
    }
    results.push({ request: label, status, p50_ms: Math.round(percentile(times, 50)), p95_ms: Math.round(percentile(times, 95)), queries: Math.max(...queries), decrypts: Math.max(...decrypted) });
  }

  // The old asset search (every active asset decrypted in the app), for comparison.
  const legacy = [];
  let legacyDecrypts = 0;
  for (let run = 0; run < Math.min(RUNS, 10); run++) {
    decrypts = 0;
    const started = performance.now();
    const rows = (await db.pool.query('SELECT a.name,a.hostname,a.serial_number,a.asset_tag,a.ip_address,a.mac_address,a.model FROM customer_assets a JOIN customers c ON c.id=a.customer_id WHERE c.active=1 ORDER BY a.id DESC')).rows;
    rows.find(row => ['name', 'hostname', 'serial_number', 'asset_tag', 'ip_address', 'mac_address', 'model'].some(field => String(cipher.decrypt(row[field]) || '').toLowerCase().includes('fgt60f1000001')));
    legacy.push(performance.now() - started); legacyDecrypts = decrypts;
  }
  results.push({ request: 'Old asset search (full scan, for comparison)', status: 200, p50_ms: Math.round(percentile(legacy, 50)), p95_ms: Math.round(percentile(legacy, 95)), queries: 1, decrypts: legacyDecrypts });

  console.log(`\nDataset: ${SIZES.customers} customers, ${SIZES.assets} assets, ${SIZES.tasks} tasks; ${RUNS} timed runs each (after 3 warm-up).\n`);
  console.table(results);
  server.close();
  await db.pool.end();
}

main().catch(error => { console.error(error); process.exit(1); });
