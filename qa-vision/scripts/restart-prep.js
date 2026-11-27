#!/usr/bin/env node
/**
 * Run by "Start QA Vision.bat" before the server starts, so a double-click always restarts cleanly:
 *   1. Stops the node process(es) already listening on the dashboard port (default 3001) and waits for it to free.
 *   2. Rebuilds the engine (engine-dist/) if lib/ changed since its last build.
 *   3. Rebuilds the Next.js production bundle (.next/) if the dashboard sources changed since its last build.
 * Production mode serves .next as built, so without step 3 source changes would silently not show up.
 */
const { execSync, execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const port = Number(process.env.QA_VISION_PORT) || 3001;
const isWin = process.platform === 'win32';

function listenerPids() {
  try {
    if (isWin) {
      const out = execSync('netstat -ano -p tcp', { encoding: 'utf8' });
      const pids = new Set();
      for (const line of out.split(/\r?\n/)) {
        const cols = line.trim().split(/\s+/);
        // Proto  Local Address  Foreign Address  State  PID
        if (cols.length >= 5 && cols[3] === 'LISTENING' && cols[1].endsWith(`:${port}`)) pids.add(Number(cols[4]));
      }
      return [...pids].filter((p) => p > 0);
    }
    return execSync(`lsof -ti tcp:${port} -sTCP:LISTEN`, { encoding: 'utf8' }).split(/\s+/).filter(Boolean).map(Number);
  } catch {
    return [];
  }
}

function processName(pid) {
  try {
    if (isWin) {
      const out = execSync(`tasklist /FI "PID eq ${pid}" /FO CSV /NH`, { encoding: 'utf8' });
      return (out.split(',')[0] || '').replace(/"/g, '').trim().toLowerCase();
    }
    return execSync(`ps -p ${pid} -o comm=`, { encoding: 'utf8' }).trim().toLowerCase();
  } catch {
    return '';
  }
}

function sleep(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function stopRunningServer() {
  const pids = listenerPids();
  if (pids.length === 0) {
    console.log(`No server running on port ${port}.`);
    return;
  }
  for (const pid of pids) {
    const name = processName(pid);
    if (!name.startsWith('node')) {
      console.error(`Port ${port} is used by "${name || 'unknown'}" (PID ${pid}), not a QA Vision server. Free the port and try again.`);
      process.exit(1);
    }
    console.log(`Stopping the running QA Vision server (PID ${pid})...`);
    try {
      if (isWin) execSync(`taskkill /PID ${pid} /T /F`, { stdio: 'ignore' });
      else process.kill(pid, 'SIGTERM');
    } catch {
      /* already gone */
    }
  }
  for (let i = 0; i < 40 && listenerPids().length > 0; i++) sleep(250);
  if (listenerPids().length > 0) {
    console.error(`Port ${port} is still in use after stopping the old server. Close it manually and try again.`);
    process.exit(1);
  }
  console.log('Old server stopped.');
}

/** Newest modification time (ms) of the files under the given paths; 0 when none exist. */
function newest(paths, skip = /node_modules|[\\/]\.next|engine-dist/) {
  let max = 0;
  const visit = (p) => {
    if (skip.test(p) || !fs.existsSync(p)) return;
    const st = fs.statSync(p);
    if (st.isDirectory()) for (const e of fs.readdirSync(p)) visit(path.join(p, e));
    else max = Math.max(max, st.mtimeMs);
  };
  for (const p of paths) visit(path.join(root, p));
  return max;
}

function mtime(p) {
  const f = path.join(root, p);
  return fs.existsSync(f) ? fs.statSync(f).mtimeMs : 0;
}

function run(cmd, args) {
  execFileSync(cmd, args, { cwd: root, stdio: 'inherit', shell: isWin });
}

stopRunningServer();

if (newest(['lib/playwright.ts', 'lib/engine']) > mtime('engine-dist/playwright.js')) {
  console.log('Engine sources changed: rebuilding the engine...');
  run('npm', ['run', 'build:engine']);
} else {
  console.log('Engine is up to date.');
}

const appSources = ['app', 'lib', 'public', 'next.config.ts', 'package.json', 'tsconfig.json', 'postcss.config.mjs'];
if (newest(appSources) > mtime('.next/BUILD_ID')) {
  console.log('Dashboard sources changed: rebuilding the dashboard (this takes about a minute)...');
  run('npx', ['next', 'build']);
} else {
  console.log('Dashboard build is up to date.');
}
