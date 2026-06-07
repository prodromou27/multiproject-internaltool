/**
 * update-manager.js
 * Handles the system update lifecycle:
 *   1. Check — npm outdated in server + client
 *   2. Install — npm install in server + client
 *   3. Build   — npm run build in client
 *   4. Restart — graceful server restart
 */

const { spawn } = require('child_process');
const path = require('path');
const fs   = require('fs');
const os   = require('os');

const ROOT_DIR   = path.join(__dirname, '..');
const SERVER_DIR = path.join(ROOT_DIR, 'server');
const CLIENT_DIR = path.join(ROOT_DIR, 'client');

// Full path to the node executable running this process
const NODE_EXE = process.execPath;

// Full path to npm (same directory as node)
const NPM_CMD  = path.join(path.dirname(NODE_EXE), 'npm.cmd');

// ── In-memory state (survives per process) ───────────────────
const state = {
  running:    false,
  phase:      'idle',    // idle | checking | checked | installing | building | done | error
  log:        [],        // [{ t, msg, level }]  level: info|ok|warn|error
  started_at: null,
  done_at:    null,
  error:      null,
  outdated:   null,      // { server: {...}, client: {...} } from npm outdated
  needs_restart: false,
};

function pushLog(msg, level = 'info') {
  state.log.push({ t: new Date().toISOString(), msg, level });
  // Keep last 200 lines
  if (state.log.length > 200) state.log.shift();
}

function runCommand(cmd, args, cwd) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, {
      cwd,
      shell: false,  // use explicit paths — avoids PATH lookup issues on Windows
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env },   // inherit full env including PATH
    });

    child.stdout.on('data', d => {
      d.toString().split('\n').filter(l => l.trim()).forEach(line => pushLog(line, 'info'));
    });
    child.stderr.on('data', d => {
      d.toString().split('\n').filter(l => l.trim()).forEach(line => {
        const lower = line.toLowerCase();
        const level = lower.startsWith('npm warn') || lower.startsWith('warning') ? 'warn' : 'info';
        pushLog(line, level);
      });
    });

    child.on('close', code => {
      if (code === 0) resolve();
      else reject(new Error(`Process exited with code ${code}`));
    });
    child.on('error', err => reject(new Error(`Failed to spawn ${cmd}: ${err.message}`)));
  });
}

// ── Check for outdated packages ──────────────────────────────
async function checkOutdated() {
  const result = { server: {}, client: {} };

  for (const [key, dir] of [['server', SERVER_DIR], ['client', CLIENT_DIR]]) {
    try {
      const raw = await new Promise((resolve) => {
        let out = '';
        const child = spawn(NPM_CMD, ['outdated', '--json'], {
          cwd: dir, shell: false, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env },
        });
        child.stdout.on('data', d => { out += d.toString(); });
        child.stderr.on('data', () => {});
        child.on('close', () => resolve(out));
        child.on('error', () => resolve('{}'));
      });
      try { result[key] = JSON.parse(raw || '{}'); } catch { result[key] = {}; }
    } catch {
      result[key] = {};
    }
  }
  return result;
}

// ── Full update flow ─────────────────────────────────────────
async function runUpdate() {
  state.running    = true;
  state.log        = [];
  state.error      = null;
  state.done_at    = null;
  state.needs_restart = false;

  try {
    pushLog(`ℹ️  Node: ${NODE_EXE}`, 'info');
    pushLog(`ℹ️  npm:  ${NPM_CMD}`, 'info');
    pushLog(`ℹ️  Server dir: ${SERVER_DIR}`, 'info');
    pushLog(`ℹ️  Client dir: ${CLIENT_DIR}`, 'info');

    // Step 1 — Server dependencies
    state.phase = 'install_server';
    pushLog('📦  Installing server dependencies…', 'info');
    await runCommand(NPM_CMD, ['install', '--no-audit'], SERVER_DIR);
    pushLog('✅  Server dependencies up-to-date', 'ok');

    // Step 2 — Client dependencies
    state.phase = 'install_client';
    pushLog('📦  Installing client dependencies…', 'info');
    await runCommand(NPM_CMD, ['install', '--no-audit'], CLIENT_DIR);
    pushLog('✅  Client dependencies up-to-date', 'ok');

    // Step 3 — Rebuild React app
    state.phase = 'build_client';
    pushLog('🔨  Building client application…', 'info');
    await runCommand(NPM_CMD, ['run', 'build'], CLIENT_DIR);
    pushLog('✅  Client build complete', 'ok');

    state.phase        = 'done';
    state.needs_restart = true;
    state.done_at      = new Date().toISOString();
    pushLog('🚀  Update complete — restart the server to apply changes.', 'ok');

  } catch (err) {
    state.phase = 'error';
    state.error = err.message;
    pushLog(`❌  Update failed: ${err.message}`, 'error');
  } finally {
    state.running = false;
  }
}

// ── Restart (graceful) ───────────────────────────────────────
function scheduleRestart() {
  // Write to a uniquely-named temp file under the OS temp directory so that
  // (a) no other process can predict or pre-create the path, and
  // (b) the project directory stays clean.
  const tmpDir     = os.tmpdir();
  const uniqueName = `solutions-hub-restart-${Date.now()}-${Math.random().toString(36).slice(2)}.bat`;
  const restartBat = path.join(tmpDir, uniqueName);

  // Use absolute paths so the script works regardless of PATH in the shell context
  const nodeDir  = path.dirname(NODE_EXE).replace(/\//g, '\\');
  const nodePath = NODE_EXE.replace(/\//g, '\\');
  const srvDir   = SERVER_DIR.replace(/\//g, '\\');

  const script = [
    '@echo off',
    `SET PATH=${nodeDir};%PATH%`,          // ensure node is findable
    'timeout /t 3 /nobreak > nul',         // wait 3 s for port to free
    `del /f "${restartBat}"`,              // self-delete the temp script
    `cd /d "${srvDir}"`,
    `"${nodePath}" index.js`,              // start server with full node path
  ].join('\r\n');

  fs.writeFileSync(restartBat, script, 'utf8');
  pushLog(`ℹ️  Restart script written to: ${restartBat}`, 'info');

  const child = spawn('cmd.exe', ['/c', restartBat], {
    detached: true,
    stdio:    'ignore',
    shell:    false,
    env:      { ...process.env },
  });
  child.unref();

  pushLog('ℹ️  Restart scheduled — exiting in 1s…', 'info');

  // Exit current process after a short window for the HTTP response to flush
  setTimeout(() => process.exit(0), 1000);
}

module.exports = { state, runUpdate, checkOutdated, scheduleRestart, pushLog };
