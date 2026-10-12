const router = require('express').Router();
const db = require('../../db');
const { requireManager } = require('../../middleware/auth');
const { logSettingsChange } = require('./shared');
const { contractTypes, checkContractTypes, saveContractTypes } = require('../../customerContracts');

/* Settings → Contract types: the types managers pick for a managed customer's
   contract (24x7, 8x5...). Managers only. Renaming a type renames it on the
   contracts that use it; removing one leaves those contracts unchanged (they
   keep it until someone picks another). */

async function view() {
  const [types, used] = await Promise.all([
    contractTypes(),
    db.prepare('SELECT service_level, COUNT(*) AS n FROM customer_contracts WHERE service_level IS NOT NULL GROUP BY service_level').all(),
  ]);
  const counts = new Map(used.map(row => [row.service_level, Number(row.n)]));
  return {
    types: types.map(name => ({ name, contracts: counts.get(name) || 0 })),
    no_longer_offered: [...counts].filter(([name]) => !types.includes(name)).map(([name, contracts]) => ({ name, contracts })),
  };
}

router.get('/contract-types', requireManager, async (req, res) => res.json(await view()));

router.put('/contract-types', requireManager, async (req, res) => {
  const checked = checkContractTypes(req.body);
  if (checked.error) return res.status(400).json({ error: checked.error });
  // renames: { old name: new name }, for types that were offered and are still in the list.
  const before = await contractTypes(), renames = req.body.renames ?? {};
  if (!renames || typeof renames !== 'object' || Array.isArray(renames)) return res.status(400).json({ error: 'renames must be an object' });
  const pairs = Object.entries(renames).filter(([from, to]) => from !== to);
  if (pairs.some(([from, to]) => !before.includes(from) || !checked.value.includes(to)))
    return res.status(400).json({ error: 'A renamed type must be an existing type, renamed to one in the list' });
  await db.transaction(async tx => {
    await saveContractTypes(checked.value, tx);
    for (const [from, to] of pairs) await tx.prepare('UPDATE customer_contracts SET service_level = ? WHERE service_level = ?').run(to, from);
  });
  const renamed = pairs.length ? `; renamed ${pairs.map(([from, to]) => `${from} → ${to}`).join(', ')}` : '';
  await logSettingsChange(req, 'contract_types_updated', `${checked.value.join(', ') || '(none)'}${renamed}`);
  res.json(await view());
});

module.exports = router;
