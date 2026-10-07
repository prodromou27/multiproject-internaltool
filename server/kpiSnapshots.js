/**
 * Once a day, records every enabled KPI's value in its history (kpi_values),
 * so trends build up without anyone pressing "Calculate". A KPI with nothing
 * to measure yet is skipped.
 */
const db = require('./db');
const appTime = require('./appTime');
const { calculateDefinition, evaluate } = require('./kpiDefinitions');

async function snapshotAll({ today = appTime.today(), store = db } = {}) {
  const definitions = await store.prepare('SELECT * FROM kpi_definitions WHERE enabled=1').all();
  const done = new Set((await store.prepare('SELECT DISTINCT definition_id FROM kpi_values WHERE calculated_by IS NULL AND period_end=?').all(today)).map(row => Number(row.definition_id)));
  let recorded = 0;
  for (const definition of definitions) {
    if (done.has(Number(definition.id))) continue;
    try {
      const result = await calculateDefinition(store, definition, { today });
      const status = evaluate(result.value, definition);
      if (status === 'no_data') continue;
      await store.prepare('INSERT INTO kpi_values (definition_id,value,status,period_start,period_end,calculated_by,source_summary) VALUES (?,?,?,?,?,NULL,?)')
        .run(definition.id, result.value, status, result.period?.from || null, today, JSON.stringify({ ...result.facts, daily: true }));
      recorded++;
    } catch (error) { console.error(`[kpi] daily value for "${definition.name}":`, error.message); }
  }
  return { recorded };
}

let timer = null;
function start() {
  if (timer) return;
  // Hourly is enough: the first run after midnight records the day.
  const tick = () => snapshotAll().catch(error => console.error('[kpi] daily values:', error.message));
  timer = setInterval(tick, 60 * 60 * 1000); timer.unref?.();
  setTimeout(tick, 60 * 1000).unref?.();
}

module.exports = { snapshotAll, start };
