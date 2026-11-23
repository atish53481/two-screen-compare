#!/usr/bin/env node
/**
 * End-to-end runner:  npm run test:e2e
 * Starts the sample DEV (3002) and PROD (3003) apps if they are not already running,
 * runs every tests/e2e/*.e2e.js suite with headless Chromium, then stops the apps it started.
 * Point at other targets with QA_DEV_URL / QA_PROD_URL (apps are then not started).
 */
const { spawn, execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const http = require('http');

const root = path.resolve(__dirname, '..');
const DEV_URL = process.env.QA_DEV_URL || 'http://localhost:3002';
const PROD_URL = process.env.QA_PROD_URL || 'http://localhost:3003';
const useSamples = !process.env.QA_DEV_URL && !process.env.QA_PROD_URL;

const isUp = (url) =>
  new Promise((resolve) => {
    const req = http.get(url, (res) => {
      res.resume();
      resolve(res.statusCode < 500);
    });
    req.on('error', () => resolve(false));
    req.setTimeout(3000, () => {
      req.destroy();
      resolve(false);
    });
  });

async function waitUp(url, ms) {
  const t = Date.now();
  while (Date.now() - t < ms) {
    if (await isUp(url)) return true;
    await new Promise((r) => setTimeout(r, 1500));
  }
  return false;
}

const started = [];
function startApp(dir) {
  const child = spawn('npm run dev', {
    cwd: path.resolve(root, '..', dir),
    shell: true,
    stdio: 'ignore',
    detached: process.platform !== 'win32',
  });
  started.push(child);
}

function stopApps() {
  for (const child of started) {
    try {
      if (process.platform === 'win32') execSync(`taskkill /pid ${child.pid} /T /F`, { stdio: 'ignore' });
      else process.kill(-child.pid, 'SIGTERM');
    } catch {
      /* already gone */
    }
  }
}

function runSuite(file) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [file], { cwd: root, stdio: 'inherit', env: process.env });
    child.on('exit', (code) => resolve(code ?? 1));
  });
}

(async () => {
  if (useSamples) {
    for (const [url, dir] of [[DEV_URL, 'sample-dev'], [PROD_URL, 'sample-prod']]) {
      if (!(await isUp(url))) {
        console.log(`Starting ${dir} (${url})…`);
        startApp(dir);
      }
    }
  }
  const ready = (await waitUp(DEV_URL, 90000)) && (await waitUp(PROD_URL, 90000));
  if (!ready) {
    console.error(`Target apps not reachable: ${DEV_URL}, ${PROD_URL}`);
    stopApps();
    process.exit(2);
  }

  const dir = path.join(__dirname, 'e2e');
  const only = process.argv[2];
  const suites = fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.e2e.js') && (!only || f.includes(only)))
    .sort();

  const failed = [];
  for (const f of suites) {
    const code = await runSuite(path.join(dir, f));
    if (code !== 0) failed.push(f);
  }

  stopApps();
  console.log(failed.length ? `\n✖ Failed suites: ${failed.join(', ')}` : `\n✔ All ${suites.length} e2e suites passed`);
  process.exit(failed.length ? 1 : 0);
})();
