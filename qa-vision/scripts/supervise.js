#!/usr/bin/env node
/**
 * Keeps the QA Vision server running in this console window, started by "Start QA Vision.bat".
 *   R  restart the server (stops it, rebuilds anything that changed, starts it again)
 *   Q  stop the server and quit (Ctrl+C does the same)
 * Every start, including the first, runs scripts/restart-prep.js: it stops any other server on the port and
 * rebuilds the engine / dashboard when their sources are newer than the last build.
 */
const { spawn, spawnSync, execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const port = Number(process.env.QA_VISION_PORT) || 3001;
const url = `http://localhost:${port}`;
const isWin = process.platform === 'win32';

let child = null;
let busy = false; // a restart is in progress: ignore further keys until it finishes
let quitting = false;
let openedBrowser = false;

// The previous QA Vision window (if any) is recorded here so a new launch can close it, wherever it runs
// (cmd window or Windows Terminal tab: window titles cannot be relied on).
const lockFile = path.join(process.env.QA_VISION_DATA_DIR || path.join(root, 'data'), 'supervisor.json');

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

function closePreviousWindow() {
  let prev;
  try {
    prev = JSON.parse(fs.readFileSync(lockFile, 'utf8'));
  } catch {
    return;
  }
  const alive = (pid) => Number.isInteger(pid) && pid > 0 && pid !== process.pid && processName(pid) !== '';
  // Only act when the recorded supervisor is still a node process (guards against a reused PID)
  if (!alive(prev.pid) || !processName(prev.pid).startsWith('node')) return;
  console.log('Closing the previous QA Vision window...');
  try {
    if (isWin) {
      // Its console (cmd.exe) goes too, so the old window/tab closes; /T takes the server with it
      const shell = alive(prev.ppid) && processName(prev.ppid) === 'cmd.exe' ? prev.ppid : prev.pid;
      execSync(`taskkill /PID ${shell} /T /F`, { stdio: 'ignore' });
    } else {
      process.kill(prev.pid, 'SIGTERM');
    }
  } catch {
    /* already gone */
  }
}

function writeLock() {
  try {
    fs.mkdirSync(path.dirname(lockFile), { recursive: true });
    fs.writeFileSync(lockFile, JSON.stringify({ pid: process.pid, ppid: process.ppid, startedAt: new Date().toISOString() }));
  } catch {
    /* not fatal */
  }
}

function clearLock() {
  try {
    const cur = JSON.parse(fs.readFileSync(lockFile, 'utf8'));
    if (cur.pid === process.pid) fs.unlinkSync(lockFile);
  } catch {
    /* not fatal */
  }
}

const help = () => console.log(`\n  [R] restart server   [Q] quit      (dashboard: ${url})\n`);

function prep() {
  const r = spawnSync(process.execPath, [path.join(__dirname, 'restart-prep.js')], { cwd: root, stdio: 'inherit' });
  return r.status === 0;
}

function openBrowser() {
  if (openedBrowser || process.env.QA_VISION_NO_BROWSER === '1') return;
  openedBrowser = true;
  const cmd = isWin ? `start "" ${url}` : process.platform === 'darwin' ? `open ${url}` : `xdg-open ${url}`;
  try {
    execSync(cmd, { stdio: 'ignore', shell: true });
  } catch {
    console.log(`Open ${url} in your browser.`);
  }
}

function start() {
  if (!prep()) {
    console.log('\nCould not start QA Vision (see the message above). Fix it, then press R to try again.');
    help();
    return;
  }
  console.log(`\nStarting QA Vision at ${url} ...`);
  child = spawn(process.execPath, ['server.js'], {
    cwd: root,
    env: { ...process.env, NODE_ENV: 'production' },
    // The server gets no stdin: keys typed in this window are for the supervisor
    stdio: ['ignore', 'pipe', 'inherit'],
  });
  const me = child;
  me.stdout.on('data', (buf) => {
    process.stdout.write(buf);
    if (/running at/.test(String(buf))) {
      openBrowser();
      help();
    }
  });
  me.on('exit', (code, signal) => {
    if (child === me) child = null;
    if (quitting || busy) return;
    console.log(`\nThe server stopped (${signal || `exit code ${code}`}).`);
    help();
  });
}

function stop() {
  const c = child;
  child = null;
  if (!c || c.exitCode !== null) return Promise.resolve();
  return new Promise((resolve) => {
    c.once('exit', () => resolve());
    try {
      if (isWin) execSync(`taskkill /PID ${c.pid} /T /F`, { stdio: 'ignore' });
      else c.kill('SIGTERM');
    } catch {
      resolve();
    }
    setTimeout(resolve, 10000);
  });
}

async function restart() {
  if (busy) return;
  busy = true;
  console.log('\nRestarting QA Vision...');
  await stop();
  busy = false; // start() reports its own failures
  start();
}

async function quit() {
  if (quitting) return;
  quitting = true;
  console.log('\nStopping QA Vision...');
  await stop();
  clearLock();
  console.log('Stopped.');
  process.exit(0);
}

function onKey(k) {
  if (k === '\u0003' || k === 'q') void quit(); // Ctrl+C or Q
  else if (k === 'r') void restart();
}
if (process.stdin.isTTY) {
  // Console: single key presses, no Enter needed
  process.stdin.setRawMode(true);
  process.stdin.resume();
  process.stdin.on('data', (buf) => {
    for (const k of String(buf).toLowerCase()) onKey(k);
  });
} else {
  // Piped input (scripts, tests): one command per line, "r" or "q"
  let pending = '';
  process.stdin.on('data', (buf) => {
    pending += String(buf);
    const lines = pending.split(/\r?\n/);
    pending = lines.pop();
    for (const line of lines) onKey(line.trim().toLowerCase());
  });
  process.stdin.on('end', () => void quit());
}
process.on('SIGINT', () => void quit());
process.on('SIGTERM', () => void quit());

closePreviousWindow();
writeLock();
start();
