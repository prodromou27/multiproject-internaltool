const db = require('./db');
const { defaults } = require('./workloadPolicy');

async function getPolicy() {
  const row = await db.prepare('SELECT version,configuration FROM workload_policy WHERE id=1').get();
  return row ? { ...JSON.parse(row.configuration),version: row.version } : { ...defaults(),version: 0 };
}

module.exports = { getPolicy };
