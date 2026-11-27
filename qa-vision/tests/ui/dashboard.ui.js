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
function start(cmd, args, cwd, env = process.env, logFile) {
  // Set QA_VISION_UI_SERVER_LOG=<file> to keep the QA Vision server's output for debugging a failed run
  const out = logFile ? fs.openSync(logFile, 'w') : 'ignore';
  const child = spawn(cmd, args, { cwd, shell: true, stdio: ['ignore', out, out], detached: process.platform !== 'win32', env });
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
  start('node', ['server.js'], root, { ...process.env, QA_VISION_DATA_DIR: dataDir, QA_VISION_HEADLESS: '1', QA_VISION_PORT: String(PORT), QA_VISION_DIST_DIR: '.next-ui' }, process.env.QA_VISION_UI_SERVER_LOG);
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
      assert((await page.inputValue('[data-testid="live-url-dev"]')).includes('localhost'), 'URL bar empty');
      assert(Date.now() - t < 5000, 'frames took too long');
      assert((await page.textContent('[data-testid="live-hint"]')).includes('click, scroll and type'), 'live-view hint missing');
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

    await test('DEV pane is interactive: click + typing reach the DEV browser; PROD untouched while READY', async () => {
      // Where the email field sits in the DEV viewport (same app, same default 1280x800 viewport)
      const probe = await browser.newPage({ viewport: { width: 1280, height: 800 } });
      await probe.goto(DEV_URL);
      const box = await probe.locator('input').first().boundingBox();
      await probe.close();
      assert(box, 'email input not found on DEV');
      const img = page.locator('[data-testid="live-frame-dev"]');
      const natural = await img.evaluate((i) => ({ w: i.naturalWidth, h: i.naturalHeight }));
      const shown = await img.boundingBox();
      const frameOf = (side) => page.getAttribute(`[data-testid="live-frame-${side}"]`, 'src');
      const devBefore = await frameOf('dev');
      const prodBefore = await frameOf('prod');
      await page.mouse.click(
        shown.x + ((box.x + box.width / 2) / natural.w) * shown.width,
        shown.y + ((box.y + box.height / 2) / natural.h) * shown.height
      );
      await page.keyboard.press('Control+a');
      await page.keyboard.type('WWWWWWWWWWWWWWWWWWWW');
      let changed = false;
      for (let t = Date.now(); Date.now() - t < 6000 && !changed; ) {
        await sleep(300);
        changed = (await frameOf('dev')) !== devBefore;
      }
      assert(changed, 'DEV frame did not change after click + typing in the pane');
      // Focus is reported (never values): email first, then Tab moves it to the masked password field
      await page.waitForFunction(() => /input/.test(document.querySelector('[data-testid="live-focus"]')?.textContent || ''), null, { timeout: 6000 });
      await page.keyboard.press('Tab');
      await page.waitForFunction(() => /password/i.test(document.querySelector('[data-testid="live-focus"]')?.textContent || ''), null, { timeout: 6000 });
      assert(!(await page.textContent('[data-testid="live-focus"]')).includes('WWWW'), 'focus label leaked a typed value');
      // Nothing is replicated before START COMPARISON: PROD keeps showing the untouched login form
      assert((await page.locator('[data-testid="finding-row"]').count()) === 0, 'typing in READY produced findings');
      assert(prodBefore, 'no PROD frame');
    });

    // Click the first <input> of a target app inside the given Live-view pane (same app layout, 1280x800 viewport)
    const clickFirstInput = async (side, url) => {
      const probe = await browser.newPage({ viewport: { width: 1280, height: 800 } });
      await probe.goto(url);
      const box = await probe.locator('input').first().boundingBox();
      await probe.close();
      assert(box, `input not found on ${side}`);
      const img = page.locator(`[data-testid="live-frame-${side}"]`);
      const natural = await img.evaluate((i) => ({ w: i.naturalWidth, h: i.naturalHeight }));
      const shown = await img.boundingBox();
      await page.mouse.click(
        shown.x + ((box.x + box.width / 2) / natural.w) * shown.width,
        shown.y + ((box.y + box.height / 2) / natural.h) * shown.height
      );
    };
    const prodPaneInteractive = async () => (await page.getAttribute('[data-testid="live-frame-prod"]', 'tabindex')) === '0';

    await test('PROD pane is interactive while READY: click + typing reach PROD only, nothing is compared', async () => {
      assert(await prodPaneInteractive(), 'PROD pane not interactive while READY');
      const frameOf = (side) => page.getAttribute(`[data-testid="live-frame-${side}"]`, 'src');
      await sleep(1200);
      const prodBefore = await frameOf('prod');
      await clickFirstInput('prod', PROD_URL);
      await page.keyboard.press('Control+a');
      await page.keyboard.type('PPPPPPPPPPPPPPPPPPPP');
      let changed = false;
      for (let t = Date.now(); Date.now() - t < 6000 && !changed; ) {
        await sleep(300);
        changed = (await frameOf('prod')) !== prodBefore;
      }
      assert(changed, 'PROD frame did not change after click + typing in the PROD pane');
      await page.waitForFunction(() => /input/.test(document.querySelector('[data-testid="live-focus-prod"]')?.textContent || ''), null, { timeout: 6000 });
      assert(!(await page.textContent('[data-testid="live-focus-prod"]')).includes('PPPP'), 'PROD focus label leaked a typed value');
      await sleep(1000);
      assert((await page.locator('[data-testid="finding-row"]').count()) === 0, 'PROD-pane input produced findings');
    });

    // Address bar / Back / Forward helpers for the Live-view panes
    const urlBar = (side) => page.locator(`[data-testid="live-url-${side}"]`);
    const waitUrl = (side, re, timeout = 15000) =>
      page.waitForFunction(
        ([s, src]) => new RegExp(src).test(document.querySelector(`[data-testid="live-url-${s}"]`)?.value || ''),
        [side, re.source],
        { timeout }
      );
    const typeAddress = async (side, url) => {
      // The pane ignores Enter while its previous navigation is still awaiting the engine's answer (no double
      // sends); the frame URL can update before that answer, so wait for the controls to be idle again.
      await page.waitForFunction((s) => !document.querySelector(`[data-testid="live-reload-${s}"]`)?.disabled, side, { timeout: 30000 });
      await urlBar(side).click();
      await page.keyboard.press('Control+a');
      await page.keyboard.type(url);
      await page.keyboard.press('Enter');
    };

    await test('READY: both panes have an editable address bar with Back/Forward; bad URLs are refused', async () => {
      for (const [side, base] of [['dev', DEV_URL], ['prod', PROD_URL]]) {
        await typeAddress(side, `${base}/qa-nav-check`);
        await waitUrl(side, /\/qa-nav-check$/);
        await page.locator(`[data-testid="live-back-${side}"]`).click();
        await waitUrl(side, /:\d+\/?$/);
        await page.locator(`[data-testid="live-forward-${side}"]`).click();
        await waitUrl(side, /\/qa-nav-check$/);
        await page.locator(`[data-testid="live-back-${side}"]`).click();
        await waitUrl(side, /:\d+\/?$/);
      }
      await typeAddress('prod', 'ftp://example.com/x');
      await page.locator('[data-testid="live-nav-error-prod"]').waitFor({ timeout: 15000 });
      assert(/http\/https/.test(await page.textContent('[data-testid="live-nav-error-prod"]')), 'no reason shown for a rejected URL');
      await page.keyboard.press('Escape');
      assert((await page.locator('[data-testid="finding-row"]').count()) === 0, 'navigation in READY produced findings');
    });

    await test('socket from a foreign Origin is refused; the dashboard origin connects', async () => {
      const { io: ioc } = require('socket.io-client');
      const tryConnect = (origin) =>
        new Promise((resolve) => {
          const s = ioc(BASE, { path: '/socket.io', transports: ['websocket'], reconnection: false, extraHeaders: { Origin: origin }, timeout: 5000 });
          s.on('connect', () => (s.close(), resolve(true)));
          s.on('connect_error', () => (s.close(), resolve(false)));
        });
      assert((await tryConnect('http://evil.example')) === false, 'foreign origin connected (could drive the DEV browser)');
      assert((await tryConnect(`http://localhost:${PORT}`)) === true, 'dashboard origin refused');
    });

    // Reload the page and wait for the dashboard to come back (reconnect-on-load)
    const liveSessions = async () => (await (await fetch(BASE + '/api/session')).json()).sessions;
    const reload = async () => {
      await page.reload();
      await page.getByRole('button', { name: 'Live Comparison' }).waitFor();
    };

    await test('reload while READY: same session is adopted with START COMPARISON; Launch stays blocked', async () => {
      const before = await liveSessions();
      assert(before.length === 1 && before[0].sessionId === sessionId && before[0].phase === 'ready', `sessions ${JSON.stringify(before.map((x) => [x.sessionId, x.phase]))}`);
      const paths = [...JSON.stringify(before).matchAll(/"\w*ScreenshotPath":"([^"]*)"/g)].map((m) => m[1]);
      assert(paths.every((v) => !/[\\/]/.test(v)), `screenshot path leaked: ${paths.find((v) => /[\\/]/.test(v))}`);
      await reload();
      await btn(/START COMPARISON/).waitFor({ timeout: 10000 });
      assert((await page.getByText('Reconnected to running session').count()) > 0, 'status text missing');
      assert((await btn(/LAUNCH ENVIRONMENTS/).count()) === 0, 'Launch offered while a session is active');
      assert((await page.locator('[data-testid="phase-banner"]').getAttribute('data-phase')) === 'ready', 'phase banner not ready');
      await page.getByRole('button', { name: 'Live Comparison' }).click();
      await page.waitForSelector('[data-testid="live-frame-dev"]', { timeout: 10000 });
      await page.waitForSelector('[data-testid="live-frame-prod"]', { timeout: 10000 });
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
      assert(await btn(/Resync/).first().isVisible(), 'Resync missing while running');
      const second = await postJson('/api/session', { action: 'start', sessionId });
      assert(second.status === 409, `second start -> ${second.status}`);
    });

    await test('while COMPARING the PROD pane is view-only; the Live tab shows Pause/Resync/Stop/Restart', async () => {
      assert(!(await prodPaneInteractive()), 'PROD pane interactive while comparing');
      assert((await page.textContent('[data-testid="live-hint"]')).includes('Pause to control'), 'hint does not explain PROD control');
      for (const id of ['live-pause', 'live-resync', 'live-stop', 'live-restart']) {
        assert(await page.locator(`[data-testid="${id}"]`).isVisible(), `${id} missing while running`);
      }
      assert((await page.locator('[data-testid="live-start"]').count()) === 0, 'Start shown while running');
    });

    // The baseline comparison runs at Start; wait for findings to arrive
    await page.waitForSelector('[data-testid="finding-row"]', { timeout: 60000 }).catch(() => {});

    await test('while COMPARING, typing in the DEV pane is replicated to PROD', async () => {
      const probe = await browser.newPage({ viewport: { width: 1280, height: 800 } });
      await probe.goto(DEV_URL);
      const box = await probe.locator('input').first().boundingBox();
      await probe.close();
      assert(box, 'email input not found on DEV');
      const img = page.locator('[data-testid="live-frame-dev"]');
      const natural = await img.evaluate((i) => ({ w: i.naturalWidth, h: i.naturalHeight }));
      const shown = await img.boundingBox();
      const prodFrame = () => page.getAttribute('[data-testid="live-frame-prod"]', 'src');
      await sleep(2500); // let the post-Start comparison settle so PROD frames are steady
      const prodBefore = await prodFrame();
      const fillSteps = () => page.locator('[data-testid="timeline-step"]', { hasText: /fill/i }).count();
      const fillsBefore = await fillSteps();
      await page.mouse.click(
        shown.x + ((box.x + box.width / 2) / natural.w) * shown.width,
        shown.y + ((box.y + box.height / 2) / natural.h) * shown.height
      );
      await page.keyboard.press('Control+a');
      await page.keyboard.type('replica-check-MMMMMMMMMMMM');
      let changed = false;
      for (let t = Date.now(); Date.now() - t < 20000 && !changed; ) {
        await sleep(500);
        changed = (await prodFrame()) !== prodBefore;
      }
      assert(changed, 'PROD frame never changed: DEV-pane typing was not replicated');
      await sleep(2000);
      const added = (await fillSteps()) - fillsBefore;
      assert(added >= 1 && added <= 2, `typing one word made ${added} fill steps (expected 1-2, not one per keystroke)`);
    });

    await test('while COMPARING, PROD navigation is locked and DEV address bar / Back are mirrored to PROD', async () => {
      assert(await page.locator('[data-testid="live-back-prod"]').isDisabled(), 'PROD Back enabled while comparing');
      assert(await page.locator('[data-testid="live-url-prod"]').evaluate((el) => el.readOnly), 'PROD address editable while comparing');
      await typeAddress('dev', `${DEV_URL}/qa-nav-mirror`);
      await waitUrl('dev', /\/qa-nav-mirror$/);
      await waitUrl('prod', /\/qa-nav-mirror$/, 30000);
      await page.locator('[data-testid="live-back-dev"]').click();
      await waitUrl('dev', /:\d+\/?$/);
      await waitUrl('prod', /:\d+\/?$/, 30000);
    });

    await test('PAUSE shows START AGAIN; START AGAIN shows PAUSE again', async () => {
      await btn(/PAUSE/).click();
      await btn(/START AGAIN/).waitFor({ timeout: 10000 });
      assert((await btn(/PAUSE/).count()) === 0, 'PAUSE still shown while paused');
      assert(await btn(/STOP/).first().isVisible(), 'STOP missing while paused');
      assert((await page.locator('[data-testid="phase-banner"]').getAttribute('data-phase')) === 'paused', 'phase banner not paused');
      await btn(/START AGAIN/).click();
      await btn(/PAUSE/).waitFor({ timeout: 30000 });
    });

    await test('Live-tab Pause makes PROD drivable; Live-tab Start again re-locks it and keeps comparing', async () => {
      await page.locator('[data-testid="live-pause"]').click();
      await page.locator('[data-testid="live-resume"]').waitFor({ timeout: 10000 });
      assert((await page.locator('[data-testid="phase-banner"]').getAttribute('data-phase')) === 'paused', 'sidebar did not follow Live-tab pause');
      await page.waitForFunction(() => document.querySelector('[data-testid="live-frame-prod"]')?.getAttribute('tabindex') === '0', null, { timeout: 5000 });
      await page.locator('[data-testid="live-resume"]').click();
      await page.locator('[data-testid="live-pause"]').waitFor({ timeout: 30000 });
      assert(!(await prodPaneInteractive()), 'PROD pane still interactive after Start again');
      assert((await page.locator('[data-testid="phase-banner"]').getAttribute('data-phase')) === 'running', 'not running after Start again');
    });
    await test('reload while RUNNING: findings and logs repopulate, PAUSE/STOP shown, same sessionId', async () => {
      const findingsBefore = await page.locator('[data-testid="finding-row"]').count();
      const live = await liveSessions();
      assert(live.length === 1 && live[0].sessionId === sessionId && live[0].phase === 'running', 'session not listed as running');
      const paths = [...JSON.stringify(live).matchAll(/"\w*ScreenshotPath":"([^"]*)"/g)].map((m) => m[1]);
      assert(paths.length > 0 && paths.every((v) => !/[\\/]/.test(v)), `screenshot paths not base names: ${paths.slice(0, 2)}`);
      await reload();
      await btn(/PAUSE/).waitFor({ timeout: 10000 });
      assert(await btn(/STOP/).first().isVisible(), 'STOP missing after reload');
      assert((await btn(/START COMPARISON/).count()) === 0, 'START COMPARISON shown while running');
      assert((await btn(/LAUNCH ENVIRONMENTS/).count()) === 0, 'Launch offered while a session is active');
      await page.waitForSelector('[data-testid="finding-row"]', { timeout: 10000 });
      const findingsAfter = await page.locator('[data-testid="finding-row"]').count();
      assert(findingsAfter >= findingsBefore && findingsAfter > 0, `findings ${findingsBefore} -> ${findingsAfter}`);
      // The engine refuses a second launch, and the UI never sent one
      const dup = await postJson('/api/session', { action: 'create', devUrl: DEV_URL, prodUrl: PROD_URL });
      assert(dup.status === 409, `second create -> ${dup.status}`);
      assert((await liveSessions()).length === 1, 'a second session exists');
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
      // Stop closes both browsers (~0.5 s): wait until it is done, or the next checks race a closing session
      await page.getByRole('button', { name: /LAUNCH ENVIRONMENTS/ }).first().waitFor({ timeout: 30000 });
      await page.getByRole('button', { name: 'History' }).click();
      await page.waitForSelector('[data-testid="history-run"]', { timeout: 20000 });
      await page.locator('[data-testid="history-open"]').first().click();
      await page.waitForSelector('[data-testid="readonly-banner"]');
      await page.waitForSelector(`[data-finding-id="${markedId}"][data-expected="true"]`, { timeout: 10000 });
      const dim = await page.locator(`[data-finding-id="${markedId}"]`).evaluate((el) => getComputedStyle(el).opacity);
      assert(Number(dim) < 1, 'stored finding not dimmed');
    });

    await test('after Stop no session is orphaned: GET /api/session lists none', async () => {
      assert((await liveSessions()).length === 0, 'session still listed after Stop');
      await reload();
      assert((await btn(/LAUNCH ENVIRONMENTS/).count()) > 0, 'Launch not offered when idle after reload');
    });

    await test('Live tab: Launch, Restart (new session, old one gone), then Stop leaves nothing running', async () => {
      await page.getByRole('button', { name: 'Live Comparison' }).click();
      await page.locator('[data-testid="live-launch"]').click();
      await page.locator('[data-testid="live-start"]').waitFor({ timeout: 60000 });
      const first = (await liveSessions()).map((s) => s.sessionId);
      assert(first.length === 1, `expected 1 session after launch, got ${first.length}`);
      await page.locator('[data-testid="live-restart"]').click();
      await page.waitForFunction(() => /Restarting/.test(document.querySelector('[data-testid="live-controls"]')?.textContent || ''), null, { timeout: 5000 });
      // The old session's Start stays on screen during the restart: wait for the restart itself to finish
      await page.waitForFunction(
        () => !/Restarting/.test(document.querySelector('[data-testid="live-controls"]')?.textContent || '') && !!document.querySelector('[data-testid="live-start"]'),
        null,
        { timeout: 60000 }
      );
      const second = (await liveSessions()).map((s) => s.sessionId);
      assert(second.length === 1 && second[0] !== first[0], `restart did not replace the session: ${first} -> ${second}`);
      await page.waitForSelector('[data-testid="live-frame-prod"]', { timeout: 10000 });
      await page.locator('[data-testid="live-stop"]').click();
      await page.locator('[data-testid="live-launch"]').waitFor({ timeout: 30000 });
      assert((await liveSessions()).length === 0, 'session still listed after Live-tab Stop');
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
