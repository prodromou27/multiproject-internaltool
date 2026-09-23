const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const db = require('./db');

const workerId = `${process.pid}-${crypto.randomUUID().slice(0,8)}`;
let timer = null;
let active = 0;
let handlers = {};
let lastCleanup = 0;

function safeJson(value, fallback = {}) {
  if (value == null) return fallback;
  if (typeof value === 'object') return value;
  try { return JSON.parse(value); } catch { return fallback; }
}

function dbTimestamp(value = new Date()) { return new Date(value).toISOString().replace('T',' ').slice(0,19); }
function isoAfter(delayMs = 0) { return dbTimestamp(Date.now() + Math.max(0,delayMs)); }

async function enqueue(type,payload={},options={}) {
  if (!/^[a-z][a-z0-9_.-]{1,63}$/.test(type)) throw Object.assign(new Error('Invalid background job type'),{ status:400 });
  const maxAttempts=Math.max(1,Math.min(10,Number(options.maxAttempts) || 3));
  const priority=Math.max(1,Math.min(1000,Number(options.priority) || 100));
  const runAfter=options.runAfter ? new Date(options.runAfter) : new Date();
  if (Number.isNaN(runAfter.getTime())) throw Object.assign(new Error('Invalid background job run time'),{ status:400 });
  const dedupeKey=options.dedupeKey ? String(options.dedupeKey).slice(0,200) : null;
  const row=await db.prepare(`INSERT INTO background_jobs
    (type,payload,priority,run_after,max_attempts,dedupe_key,created_by)
    VALUES (?,?,?,?,?,?,?) ON CONFLICT(dedupe_key) DO NOTHING RETURNING id,status`).get(
      type,JSON.stringify(payload ?? {}),priority,dbTimestamp(runAfter),maxAttempts,dedupeKey,options.createdBy || null);
  if (row) return { ...row,deduplicated:false };
  const existing=dedupeKey ? await db.prepare('SELECT id,status FROM background_jobs WHERE dedupe_key=?').get(dedupeKey) : null;
  return existing ? { ...existing,deduplicated:true } : null;
}

async function claim() {
  return db.transaction(async tx => tx.prepare(`WITH candidate AS (
    SELECT id FROM background_jobs WHERE status='queued' AND run_after<=app_now()
    ORDER BY priority,id FOR UPDATE SKIP LOCKED LIMIT 1
  ) UPDATE background_jobs j SET status='running',attempts=j.attempts+1,locked_at=app_now(),locked_by=?,started_at=COALESCE(j.started_at,app_now()),error=NULL
    FROM candidate WHERE j.id=candidate.id RETURNING j.*`).get(workerId));
}

async function finish(job,result) {
  const artifact=result?.artifact || null;
  const publicResult={ ...(result || {}) };delete publicResult.artifact;
  const updated=await db.prepare("UPDATE background_jobs SET status='completed',result=?,completed_at=app_now(),locked_at=NULL,locked_by=NULL,dedupe_key=NULL,artifact_name=?,artifact_path=?,artifact_type=?,artifact_iv=?,artifact_tag=?,artifact_expires_at=? WHERE id=? AND status='running' AND locked_by=?")
    .run(JSON.stringify(publicResult),artifact?.name || null,artifact?.path || null,artifact?.type || null,artifact?.iv || null,artifact?.tag || null,artifact?.expires_at || null,job.id,workerId);
  if (!updated.changes) {
    if (artifact?.path) await fs.promises.unlink(path.resolve(__dirname,'uploads','exports',path.basename(artifact.path))).catch(() => {});
    return;
  }
  if (job.created_by && artifact) await db.prepare("INSERT INTO notifications(user_id,type,title,body,link) VALUES (?,'export.ready','Export ready',?,?)")
    .run(job.created_by,`${artifact.name} is ready to download.`,`/api/reports/custom/exports/${job.id}/download`);
}

async function fail(job,error) {
  const message=String(error?.message || 'Background job failed').slice(0,1000);
  if (!error?.permanent && job.attempts < job.max_attempts) {
    const delay=Math.min(15*60_000,Math.max(5_000,2 ** (job.attempts-1) * 30_000));
    await db.prepare("UPDATE background_jobs SET status='queued',run_after=?,error=?,locked_at=NULL,locked_by=NULL WHERE id=? AND status='running' AND locked_by=?")
      .run(isoAfter(delay),message,job.id,workerId);
  } else {
    await db.prepare("UPDATE background_jobs SET status='failed',error=?,completed_at=app_now(),locked_at=NULL,locked_by=NULL,dedupe_key=NULL WHERE id=? AND status='running' AND locked_by=?")
      .run(message,job.id,workerId);
  }
}

async function workOne() {
  const job=await claim();
  if (!job) return false;
  const handler=handlers[job.type];
  try {
    if (!handler) throw new Error(`No handler registered for ${job.type}`);
    await finish(job,await handler(safeJson(job.payload),job));
  } catch(error) {
    console.error(`[jobs] ${job.type} #${job.id}:`,error.message);
    await fail(job,error);
  }
  return true;
}

async function poll() {
  if (Date.now()-lastCleanup > 24*60*60_000) {
    const cutoff=dbTimestamp(Date.now()-30*24*60*60_000);
    const expired=await db.prepare("SELECT artifact_path FROM background_jobs WHERE artifact_path IS NOT NULL AND (artifact_expires_at<? OR completed_at<?)").all(dbTimestamp(),cutoff);
    const exportRoot=path.resolve(__dirname,'uploads','exports');
    for (const row of expired) {
      const target=path.resolve(exportRoot,path.basename(row.artifact_path));
      if (target.startsWith(`${exportRoot}${path.sep}`)) await fs.promises.unlink(target).catch(() => {});
    }
    await db.prepare("DELETE FROM background_jobs WHERE status IN ('completed','failed') AND completed_at<?").run(cutoff);
    await db.prepare("UPDATE background_jobs SET artifact_path=NULL,artifact_iv=NULL,artifact_tag=NULL WHERE artifact_path IS NOT NULL AND artifact_expires_at<?").run(dbTimestamp());
    lastCleanup=Date.now();
  }
  const concurrency=Math.max(1,Math.min(8,Number(process.env.BACKGROUND_JOB_CONCURRENCY) || 2));
  const slots=Math.max(0,concurrency-active);
  const workers=[];
  for (let index=0;index<slots;index += 1) {
    active += 1;
    workers.push(workOne().catch(error => { console.error('[jobs] worker:',error.message);return false; }).finally(() => { active -= 1; }));
  }
  await Promise.all(workers);
}

async function recoverStale() {
  const cutoff=dbTimestamp(Date.now()-15*60_000);
  await db.prepare("UPDATE background_jobs SET status='queued',run_after=app_now(),locked_at=NULL,locked_by=NULL,error='Recovered after worker interruption' WHERE status='running' AND locked_at<?").run(cutoff);
}

async function health() {
  const rows=await db.prepare('SELECT status,COUNT(*)::int AS count FROM background_jobs GROUP BY status').all();
  const counts={ queued:0,running:0,completed:0,failed:0 };
  rows.forEach(row => { if (counts[row.status]!==undefined) counts[row.status]=row.count; });
  const oldest=await db.prepare("SELECT run_after FROM background_jobs WHERE status='queued' ORDER BY run_after,id LIMIT 1").get();
  const latestFailure=await db.prepare("SELECT type,error,completed_at FROM background_jobs WHERE status='failed' ORDER BY completed_at DESC,id DESC LIMIT 1").get();
  const recentFailure=await db.prepare("SELECT COUNT(*)::int AS count FROM background_jobs WHERE status='failed' AND completed_at>=?").get(dbTimestamp(Date.now()-24*60*60_000));
  return { ...counts,recent_failed:recentFailure?.count || 0,active_workers:active,oldest_queued_at:oldest?.run_after || null,latest_failure:latestFailure || null };
}

async function start(nextHandlers) {
  if (timer) return;
  handlers={ ...nextHandlers };
  await recoverStale();
  timer=setInterval(poll,2000);timer.unref?.();
  poll();
}

function stop() { if (timer) clearInterval(timer);timer=null;handlers={}; }

module.exports={ enqueue,claim,workOne,recoverStale,health,start,stop,safeJson,isoAfter,dbTimestamp };
