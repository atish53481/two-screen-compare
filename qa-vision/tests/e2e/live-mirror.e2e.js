// DEV is the master: input sent to the DEV pane of the Live view (handleLiveInput) is mirrored on PROD
// once Start Comparison is pressed, and only then.
const { engine, DEV_URL, PROD_URL, SAMPLE_EMAIL, sleep, idle, waitForLoginForm, runSuite } = require('./helpers');

const replicated = (s) => s.logs.filter((l) => /\] Replicating/.test(l.action)).length;
const compared = (s) => s.logs.filter((l) => l.action.startsWith('Compared after')).length;

/** Center of a DEV element in viewport CSS pixels, the coordinates the Live view sends. */
async function center(page, selector) {
  const box = await page.locator(selector).boundingBox();
  return { x: Math.round(box.x + box.width / 2), y: Math.round(box.y + box.height / 2) };
}

/** Send one Live-view input to DEV and wait for it to be applied. */
async function live(id, S, input) {
  engine.handleLiveInput(id, { side: 'dev', ...input });
  await S.liveInputQueue;
}

runSuite('Live view: DEV is master, PROD mirrors after Start Comparison', async ({ check }) => {
  const id = await engine.createSession(DEV_URL, PROD_URL, { projectName: 'live-mirror', startImmediately: false });
  const S = engine.getSession(id);
  await waitForLoginForm(S);
  await idle(S);

  const email = '[data-testid="login-email"]';

  // Before Start: DEV input is applied to DEV only
  await live(id, S, { kind: 'click', ...(await center(S.devPage, email)) });
  await live(id, S, { kind: 'text', text: 'before@start.com' });
  await idle(S);
  await sleep(800);
  check('ready: Live input reaches DEV', (await S.devPage.inputValue(email)) === 'before@start.com');
  check('ready: PROD does not follow', (await S.prodPage.inputValue(email)) === '' && replicated(S) === 0, `prod="${await S.prodPage.inputValue(email)}"`);

  // Before Start: the PROD pane drives PROD directly (not mirrored to DEV)
  engine.handleLiveInput(id, { side: 'prod', kind: 'click', ...(await center(S.prodPage, email)) });
  engine.handleLiveInput(id, { side: 'prod', kind: 'text', text: 'prod@direct.com' });
  await S.prodLiveInputQueue;
  await sleep(500);
  check('ready: PROD pane input reaches PROD', (await S.prodPage.inputValue(email)) === 'prod@direct.com', `prod="${await S.prodPage.inputValue(email)}"`);
  check('ready: PROD pane input does not touch DEV', (await S.devPage.inputValue(email)) === 'before@start.com');

  // Start Comparison
  const started = await engine.startComparison(id);
  await idle(S);
  check('start: running', started.ok && engine.getPhase(id) === 'running', JSON.stringify(started));

  // After Start: the same Live input is mirrored on PROD
  const c0 = compared(S);
  await live(id, S, { kind: 'click', count: 3, ...(await center(S.devPage, email)) }); // select existing text
  await live(id, S, { kind: 'key', key: 'Control+a' });
  await live(id, S, { kind: 'key', key: 'Backspace' });
  await live(id, S, { kind: 'text', text: SAMPLE_EMAIL });
  await live(id, S, { kind: 'click', ...(await center(S.devPage, 'h1')) }); // blur: commits the field
  await sleep(1500);
  await idle(S, 30000);

  check('running: DEV has the typed value', (await S.devPage.inputValue(email)) === SAMPLE_EMAIL);
  check('running: PROD mirrors the typed value', (await S.prodPage.inputValue(email)) === SAMPLE_EMAIL, `prod="${await S.prodPage.inputValue(email)}"`);
  check('running: actions were replicated', replicated(S) > 0, `replicated=${replicated(S)}`);
  check('running: a comparison ran after the mirrored steps', compared(S) > c0, `compared ${c0}->${compared(S)}`);

  // 2-step verification: a one-time code typed on DEV is never replayed on PROD; the session pauses instead
  const addOtp = (page) =>
    page.evaluate(() => {
      const wrap = document.createElement('div');
      wrap.innerHTML = '<label for="totpPin">Enter code</label><input id="totpPin" name="totpPin" type="tel" autocomplete="one-time-code">';
      wrap.style.cssText = 'position:fixed;top:4px;left:4px;z-index:99999;background:#fff';
      document.body.appendChild(wrap);
    });
  await addOtp(S.devPage);
  await addOtp(S.prodPage);
  await sleep(300);
  await live(id, S, { kind: 'click', ...(await center(S.devPage, '#totpPin')) });
  await live(id, S, { kind: 'text', text: '123456' });
  await live(id, S, { kind: 'click', ...(await center(S.devPage, 'h1')) });
  await sleep(1500);
  await idle(S);
  check('otp: DEV has the code', (await S.devPage.inputValue('#totpPin')) === '123456');
  check('otp: code is NOT replayed on PROD', (await S.prodPage.inputValue('#totpPin')) === '', `prod="${await S.prodPage.inputValue('#totpPin')}"`);
  check('otp: session auto-paused', engine.getPhase(id) === 'paused', engine.getPhase(id));
  check('otp: logged as not replayed', S.logs.some((l) => /One-time code not replayed/.test(l.action)));
  // Start again resumes mirroring
  const resumed = await engine.setPaused(id, false);
  await idle(S);
  check('otp: Start again resumes', resumed.ok && engine.getPhase(id) === 'running', JSON.stringify(resumed));

  // While running, the PROD pane is locked: direct PROD input is ignored
  const prodBefore = await S.prodPage.inputValue(email);
  engine.handleLiveInput(id, { side: 'prod', kind: 'click', ...(await center(S.prodPage, email)) });
  engine.handleLiveInput(id, { side: 'prod', kind: 'text', text: 'x' });
  await S.prodLiveInputQueue;
  await sleep(500);
  check('running: PROD pane input is ignored', (await S.prodPage.inputValue(email)) === prodBefore, `prod="${await S.prodPage.inputValue(email)}"`);

  // Paused: PROD pane is drivable again
  await engine.setPaused(id, true);
  engine.handleLiveInput(id, { side: 'prod', kind: 'click', count: 3, ...(await center(S.prodPage, email)) });
  engine.handleLiveInput(id, { side: 'prod', kind: 'key', key: 'Control+a' });
  engine.handleLiveInput(id, { side: 'prod', kind: 'text', text: 'paused@prod.com' });
  await S.prodLiveInputQueue;
  await sleep(500);
  check('paused: PROD pane input reaches PROD', (await S.prodPage.inputValue(email)) === 'paused@prod.com', `prod="${await S.prodPage.inputValue(email)}"`);

  await engine.closeSession(id);
});
