#!/usr/bin/env node
/**
 * Dashboard UI tests:  npm run test:ui
 * Starts the sample DEV (3002) / PROD (3003) apps when they are down and its own server.js (port 3101), drives the dashboard with
 * headless Chromium, then stops only what it started. server.js runs with a temp QA_VISION_DATA_DIR so data/ is untouched.
 * If something already listens on the UI port the suite refuses to run: it could not isolate the data directory.
 */
const { spawn, execSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { chromium } = require('playwright');

const root = path.resolve(__dirname, '..', '..');
const PORT = Number(process.env.QA_VISION_UI_PORT) || 3101; // own port: never touches a dashboard already on 3001
const BASE = `http://localhost:${PORT}`;
const DEV_URL = process.env.QA_DEV_URL || 'http://localhost:3002';
const PROD_URL = process.env.QA_PROD_URL || 'http://localhost:3003';
const useSamples = !process.env.QA_DEV_URL && !process.env.QA_PROD_URL;
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'qav-ui-'));
const PASSWORD = 'S3cret-pw-Zq81';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const isUp = (url) =>
  new Promise((resolve) => {
    const req = http.get(url, (res) => {
      res.resume();
      resolve(res.statusCode < 500);
    });
    req.on('error', () => resolve(false));
    req.setTimeout(5000, () => {
      req.destroy();
      resolve(false);
    });
  });
async function waitUp(url, ms) {
  const t = Date.now();
  while (Date.now() - t < ms) {
    if (await isUp(url)) return true;
    await sleep(1500);
  }
  return false;
}

const started = [];
function start(cmd, args, cwd, env = process.env) {
  const child = spawn(cmd, args, { cwd, shell: true, stdio: 'ignore', detached: process.platform !== 'win32', env });
  started.push(child);
  return child;
}
function stopAll() {
  for (const child of started) {
    try {
      if (process.platform === 'win32') execSync(`taskkill /pid ${child.pid} /T /F`, { stdio: 'ignore' });
      else process.kill(-child.pid, 'SIGTERM');
    } catch {
      /* already gone */
    }
  }
  try {
    fs.rmSync(dataDir, { recursive: true, force: true });
    fs.rmSync(path.join(root, '.next-ui'), { recursive: true, force: true });
  } catch {
    /* sqlite may still be closing; temp dir */
  }
}

const results = [];
async function test(name, fn) {
  try {
    await fn();
    results.push(true);
    console.log(`  PASS  ${name}`);
  } catch (e) {
    results.push(false);
    console.log(`  FAIL  ${name}  — ${String(e && e.message ? e.message : e).split('\n')[0]}`);
  }
}
const assert = (cond, msg) => {
  if (!cond) throw new Error(msg || 'assertion failed');
};

const postJson = (p, body) =>
  fetch(BASE + p, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

(async () => {
  if (await isUp(BASE)) {
    console.error(`Something already listens on ${BASE}; free it or set QA_VISION_UI_PORT (the UI suite needs its own server with a temp data dir).`);
    process.exit(2);
  }
  if (useSamples) {
    for (const [url, dir] of [[DEV_URL, 'sample-dev'], [PROD_URL, 'sample-prod']]) {
      if (!(await isUp(url))) {
        console.log(`Starting ${dir} (${url})…`);
        start('npm', ['run', 'dev'], path.resolve(root, '..', dir));
      }
    }
  }
  console.log('Starting QA Vision server.js…');
  start('node', ['server.js'], root, { ...process.env, QA_VISION_DATA_DIR: dataDir, QA_VISION_HEADLESS: '1', QA_VISION_PORT: String(PORT), QA_VISION_DIST_DIR: '.next-ui' });
  const ready = (await waitUp(DEV_URL, 90000)) && (await waitUp(PROD_URL, 90000)) && (await waitUp(BASE, 180000));
  if (!ready) {
    console.error('Target apps or QA Vision server not reachable');
    stopAll();
    process.exit(2);
  }
  // Warm the API routes so first-compile latency does not eat into the timed checks
  for (const p of ['/api/profiles', '/api/runs', '/api/session', '/api/evidence?session=x&file=x.png']) await fetch(BASE + p).catch(() => {});

  console.log('\n▶ Dashboard UI');
  const browser = await chromium.launch({ headless: true });
  const page = await (await browser.newContext({ acceptDownloads: true, viewport: { width: 1500, height: 1000 } })).newPage();
  let sessionId = null;
  let markedId = null;

  try {
    await test('evidence route rejects ../ traversal with 400', async () => {
      const bad = [
        '/api/evidence?session=sess_1&file=../../package.json',
        '/api/evidence?session=sess_1&file=..%2F..%2Fpackage.json',
        '/api/evidence?session=sess_1&file=C:%5CWindows%5Cwin.ini',
        '/api/evidence?session=sess_1&file=/etc/passwd',
        '/api/evidence?session=..&file=a.png',
        '/api/evidence?session=sess_1&file=notes.txt',
      ];
      for (const u of bad) {
        const r = await fetch(BASE + u);
        assert(r.status === 400, `${u} -> ${r.status}`);
      }
      const missing = await fetch(BASE + '/api/evidence?session=sess_1&file=nope.png');
      assert(missing.status === 404, `missing png -> ${missing.status}`);
    });

    await test('saved password is never returned by GET /api/profiles', async () => {
      const res = await postJson('/api/profiles', {
        action: 'save',
        profile: {
          name: 'Login Test',
          labelA: 'DEV',
          labelB: 'PROD',
          urlA: DEV_URL,
          urlB: PROD_URL,
          safetyPolicy: 'read-only',
          ignoreRules: [],
          login: { strategy: 'form', loginPath: '/', usernameSelector: '#u', passwordSelector: '#p', submitSelector: '#s' },
          credentialsA: { username: 'qa-user', password: PASSWORD },
        },
      });
      const saved = await res.json();
      assert(saved.success, `save failed: ${JSON.stringify(saved)}`);
      assert(!JSON.stringify(saved).includes(PASSWORD), 'POST response leaked password');
      const text = await (await fetch(BASE + '/api/profiles')).text();
      assert(!text.includes(PASSWORD), 'GET leaked the password');
      assert(!text.includes('secretRef'), 'GET exposed a secretRef');
      const prof = JSON.parse(text).profiles.find((p) => p.name === 'Login Test');
      assert(prof && prof.credentialsA.username === 'qa-user' && prof.credentialsA.stored === true, 'stored flag missing');
    });

    await page.goto(BASE);
    await page.waitForSelector('[data-testid="profile-name"]');

    await test('launch shows two live frames within 5s', async () => {
      await page.locator('[data-testid="profile-name"]', { hasText: 'Sample DEV vs PROD' }).first().waitFor();
      const responded = page.waitForResponse((r) => r.url().endsWith('/api/session') && r.request().method() === 'POST', { timeout: 60000 });
      await page.getByRole('button', { name: /LAUNCH ENVIRONMENTS/ }).first().click();
      const body = await (await responded).json();
      assert(body.success, `launch failed: ${JSON.stringify(body)}`);
      sessionId = body.sessionId;
      await page.getByRole('button', { name: 'Live Comparison' }).click();
      const t = Date.now();
      await page.waitForSelector('[data-testid="live-frame-dev"]', { timeout: 5000 });
      await page.waitForSelector('[data-testid="live-frame-prod"]', { timeout: 5000 });
      const w = await page.$eval('[data-testid="live-frame-dev"]', (i) => i.naturalWidth);
      assert(w > 0, 'DEV frame did not decode');
      assert((await page.textContent('[data-testid="live-url-dev"]')).includes('localhost'), 'URL bar empty');
      assert(Date.now() - t < 5000, 'frames took too long');
      assert(await page.getByText('Live view: interact in the QA Vision DEV window').isVisible(), 'label missing');
    });

    const btn = (name) => page.getByRole('button', { name });

    await test('after Launch: START COMPARISON and STOP are visible, PAUSE is not; nothing is compared', async () => {
      await btn(/START COMPARISON/).waitFor({ timeout: 10000 });
      assert(await btn(/STOP/).first().isVisible(), 'STOP missing');
      assert((await btn(/PAUSE/).count()) === 0, 'PAUSE must not show before Start');
      assert((await btn(/LAUNCH ENVIRONMENTS/).count()) === 0, 'Launch still shown while a session is active');
      assert((await page.locator('[data-testid="phase-banner"]').getAttribute('data-phase')) === 'ready', 'phase banner not ready');
      await sleep(1500);
      assert((await page.locator('[data-testid="finding-row"]').count()) === 0, 'findings appeared before Start');
    });

    await test('start: unknown session -> 404', async () => {
      const r = await postJson('/api/session', { action: 'start', sessionId: 'sess_nope' });
      assert(r.status === 404, `status ${r.status}`);
    });

    await test('clicking START COMPARISON shows PAUSE; starting again via the route -> 409', async () => {
      const responded = page.waitForResponse((r) => r.url().endsWith('/api/session') && r.request().method() === 'POST', { timeout: 60000 });
      await btn(/START COMPARISON/).click();
      // While Start is in flight the controls are busy but Stop must stay enabled
      assert(await btn(/STOP/).first().isEnabled(), 'Stop disabled while Start is in flight');
      assert((await responded).status() === 200, 'start did not return 200');
      await btn(/PAUSE/).waitFor({ timeout: 10000 });
      assert((await btn(/START COMPARISON/).count()) === 0, 'START COMPARISON still shown');
      assert(await btn(/Resync/).isVisible(), 'Resync missing while running');
      const second = await postJson('/api/session', { action: 'start', sessionId });
      assert(second.status === 409, `second start -> ${second.status}`);
    });

    // The baseline comparison runs at Start; wait for findings to arrive
    await page.waitForSelector('[data-testid="finding-row"]', { timeout: 60000 }).catch(() => {});

    await test('PAUSE shows START AGAIN; START AGAIN shows PAUSE again', async () => {
      await btn(/PAUSE/).click();
      await btn(/START AGAIN/).waitFor({ timeout: 10000 });
      assert((await btn(/PAUSE/).count()) === 0, 'PAUSE still shown while paused');
      assert(await btn(/STOP/).first().isVisible(), 'STOP missing while paused');
      assert((await page.locator('[data-testid="phase-banner"]').getAttribute('data-phase')) === 'paused', 'phase banner not paused');
      await btn(/START AGAIN/).click();
      await btn(/PAUSE/).waitFor({ timeout: 30000 });
    });

    await test('finding filters narrow list', async () => {
      const count = async () => page.locator('[data-testid="finding-row"]').count();
      const total = await count();
      assert(total >= 2, `need >= 2 findings, got ${total}`);
      const types = await page.$$eval('[data-testid="filter-type"] option', (o) => o.map((x) => x.value).filter(Boolean));
      let narrowed = false;
      for (const t of types) {
        await page.selectOption('[data-testid="filter-type"]', t);
        const n = await count();
        if (n > 0 && n < total) narrowed = true;
        const allMatch = await page.$$eval('[data-testid="finding-row"]', (rows, type) => rows.every((r) => r.textContent.includes(type)), t);
        assert(allMatch, `rows not all of type ${t}`);
      }
      assert(narrowed || types.length === 1, 'type filter never narrowed the list');
      await page.selectOption('[data-testid="filter-type"]', '');
      await page.selectOption('[data-testid="filter-severity"]', 'critical');
      assert((await count()) <= total, 'severity filter widened list');
      await page.selectOption('[data-testid="filter-severity"]', '');
      await page.fill('[data-testid="filter-search"]', 'zzz-no-such-finding');
      assert((await count()) === 0, 'search did not empty the list');
      await page.fill('[data-testid="filter-search"]', '');
      assert((await count()) === total, 'clearing filters did not restore list');
    });

    await test('clicking a finding opens evidence with images that load (naturalWidth > 0)', async () => {
      const rows = page.locator('[data-testid="finding-row"]');
      const n = await rows.count();
      let checked = 0;
      for (let i = 0; i < n && !checked; i++) {
        await rows.nth(i).click();
        await page.waitForSelector('[data-testid="evidence-viewer"]');
        await sleep(600);
        const imgs = page.locator('[data-testid="evidence-img"]');
        const k = await imgs.count();
        if (!k) continue;
        for (let j = 0; j < k; j++) {
          await imgs.nth(j).evaluate((el) => (el.complete ? null : new Promise((r) => { el.onload = r; el.onerror = r; })));
          const w = await imgs.nth(j).evaluate((el) => el.naturalWidth);
          assert(w > 0, `image ${j} did not load (naturalWidth ${w})`);
        }
        checked = k;
      }
      assert(checked > 0, 'no finding had screenshots to show');
      for (const id of ['evidence-dev-value', 'evidence-prod-value', 'evidence-steps', 'evidence-rule', 'evidence-ai']) {
        assert(await page.locator(`[data-testid="${id}"]`).count(), `${id} missing`);
      }
      for (const label of ['Mark expected', 'Highlight in browsers', 'Analyze with AI']) {
        assert(await page.getByRole('button', { name: label }).count(), `${label} button missing`);
      }
    });

    await test('mark expected dims the finding and persists in history', async () => {
      const rows = page.locator('[data-testid="finding-row"][data-expected="false"]');
      await rows.first().click();
      markedId = await rows.first().getAttribute('data-finding-id');
      await page.getByRole('button', { name: 'Mark expected' }).click();
      const row = page.locator(`[data-testid="finding-row"][data-finding-id="${markedId}"]`);
      await page.waitForSelector(`[data-finding-id="${markedId}"][data-expected="true"]`, { timeout: 10000 });
      const opacity = await row.evaluate((el) => getComputedStyle(el).opacity);
      assert(Number(opacity) < 1, `row not dimmed (opacity ${opacity})`);
      await page.uncheck('[data-testid="toggle-expected"]');
      assert((await row.count()) === 0, 'expected row still listed with toggle off');
      await page.check('[data-testid="toggle-expected"]');
      assert((await row.count()) === 1, 'expected row not listed with toggle on');
      // Persist: stop the session, then open the stored run read-only
      await page.getByRole('button', { name: /STOP/ }).first().click();
      await page.getByRole('button', { name: 'History' }).click();
      await page.waitForSelector('[data-testid="history-run"]', { timeout: 20000 });
      await page.locator('[data-testid="history-open"]').first().click();
      await page.waitForSelector('[data-testid="readonly-banner"]');
      await page.waitForSelector(`[data-finding-id="${markedId}"][data-expected="true"]`, { timeout: 10000 });
      const dim = await page.locator(`[data-finding-id="${markedId}"]`).evaluate((el) => getComputedStyle(el).opacity);
      assert(Number(dim) < 1, 'stored finding not dimmed');
    });

    await test('history exports HTML (content-type text/html)', async () => {
      await page.getByRole('button', { name: 'History' }).click();
      await page.waitForSelector('[data-testid="history-run"]');
      const [resp] = await Promise.all([
        page.waitForResponse((r) => r.url().endsWith('/api/report') && r.request().method() === 'POST'),
        page.locator('[data-testid="history-export-html"]').first().click(),
      ]);
      assert(resp.status() === 200, `status ${resp.status()}`);
      assert((resp.headers()['content-type'] || '').startsWith('text/html'), `content-type ${resp.headers()['content-type']}`);
      const body = await resp.text();
      assert(/<html/i.test(body) && !body.includes(PASSWORD), 'not an HTML report');
    });

    await test('profile duplicate creates "<name> (copy)"', async () => {
      await page.getByRole('button', { name: 'Profiles' }).first().click();
      const card = page.locator('div.rounded-3xl', { has: page.locator('[data-testid="profile-name"]', { hasText: /^Login Test$/ }) }).first();
      await card.locator('[data-testid="profile-duplicate"]').click();
      await page.locator('[data-testid="profile-name"]', { hasText: 'Login Test (copy)' }).first().waitFor({ timeout: 10000 });
      const list = (await (await fetch(BASE + '/api/profiles')).json()).profiles;
      const copy = list.find((p) => p.name === 'Login Test (copy)');
      assert(copy, 'copy not persisted');
      assert(copy.credentialsA && copy.credentialsA.username === 'qa-user', 'username should carry over');
      assert(copy.credentialsA.stored === false, 'duplicate must not inherit the stored password');
      assert(list.find((p) => p.name === 'Login Test').credentialsA.stored === true, 'original lost its password');
    });
  } finally {
    await postJson('/api/session', { action: 'stop' }).catch(() => {});
    await browser.close().catch(() => {});
    stopAll();
  }
  const failed = results.filter((x) => !x).length;
  console.log(`  ${results.length - failed}/${results.length} checks passed`);
  process.exit(failed ? 1 : 0);
})().catch((e) => {
  console.error('CRASH', e && e.stack ? e.stack.split('\n').slice(0, 4).join('\n') : e);
  stopAll();
  process.exit(2);
});
