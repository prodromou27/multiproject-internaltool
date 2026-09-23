const { performance } = require('node:perf_hooks');

const configuredThreshold = Number(process.env.SLOW_QUERY_MS);
const slowQueryMs = Number.isFinite(configuredThreshold) && configuredThreshold >= 10 ? configuredThreshold : 250;
const recentSlow = [];
const totals = { count: 0, failed: 0, slow: 0, duration_ms: 0, max_ms: 0 };

function queryLabel(sql) {
  const text = String(sql || '').replace(/\s+/g, ' ').trim();
  const operation = (text.match(/^(select|insert|update|delete|alter|create|drop|truncate|with)\b/i)?.[1] || 'statement').toUpperCase();
  const relation = text.match(/\b(?:from|into|update|table|join)\s+(?:if\s+(?:not\s+)?exists\s+)?["']?([a-z_][a-z0-9_]*)/i)?.[1];
  return relation ? `${operation} ${relation}` : operation;
}

async function observeQuery(sql, execute) {
  const started = performance.now();
  let failed = false;
  try {
    return await execute();
  } catch (error) {
    failed = true;
    throw error;
  } finally {
    const duration = Math.max(0, performance.now() - started);
    totals.count += 1;
    totals.duration_ms += duration;
    totals.max_ms = Math.max(totals.max_ms, duration);
    if (failed) totals.failed += 1;
    if (duration >= slowQueryMs) {
      totals.slow += 1;
      const entry = { label: queryLabel(sql), duration_ms: Math.round(duration * 10) / 10, failed, occurred_at: new Date().toISOString() };
      recentSlow.unshift(entry);
      recentSlow.splice(25);
      console.warn(`[db:slow] ${entry.label} ${entry.duration_ms}ms${failed ? ' failed' : ''}`);
    }
  }
}

function snapshot(pool) {
  return {
    threshold_ms: slowQueryMs,
    count: totals.count,
    failed: totals.failed,
    slow: totals.slow,
    average_ms: totals.count ? Math.round((totals.duration_ms / totals.count) * 10) / 10 : 0,
    max_ms: Math.round(totals.max_ms * 10) / 10,
    recent_slow: recentSlow.map(item => ({ ...item })),
    pool: { total: Number(pool?.totalCount) || 0, idle: Number(pool?.idleCount) || 0, waiting: Number(pool?.waitingCount) || 0 },
  };
}

function reset() {
  totals.count = 0;totals.failed = 0;totals.slow = 0;totals.duration_ms = 0;totals.max_ms = 0;
  recentSlow.length = 0;
}

module.exports = { observeQuery, queryLabel, snapshot, reset, slowQueryMs };
