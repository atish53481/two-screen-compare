// PROD safety: read-only default, destructive/submit blocking, network write guard,
// unique element matching, navigation mapping, secret redaction, URL validation.
const { engine, DEV_URL, PROD_URL, SAMPLE_EMAIL, SAMPLE_PASSWORD, sleep, idle, waitForLoginForm, runSuite } = require('./helpers');

runSuite('Safety', async ({ check }) => {
  for (const bad of ['file:///etc/passwd', 'http://169.254.169.254/latest/meta-data', 'http://user:pw@localhost:3002']) {
    let rejected = false;
    try {
      await engine.createSession(bad, PROD_URL, { projectName: 'safety' });
    } catch {
      rejected = true;
    }
    check(`rejects unsafe URL ${bad.slice(0, 40)}`, rejected);
  }

  const id = await engine.createSession(DEV_URL, PROD_URL, { projectName: 'safety-e2e' }); // default policy
  const s = engine.getSession(id);
  check('default safety policy is read-only', s.safetyPolicy === 'read-only', s.safetyPolicy);
  const { devPage: dev, prodPage: prod } = s;
  await waitForLoginForm(s);

  // Typing (incl. password) replays to PROD
  await dev.locator('[data-testid="login-email"]').pressSequentially(SAMPLE_EMAIL, { delay: 5 });
  await dev.locator('[data-testid="login-password"]').pressSequentially(SAMPLE_PASSWORD, { delay: 5 });
  await idle(s);
  check('password field replayed on PROD', (await prod.inputValue('[data-testid="login-password"]')) === SAMPLE_PASSWORD);

  // Fixtures injected into both pages
  const fixtures = (isDev) => {
    const box = document.createElement('div');
    box.id = 'qa-fixtures';
    box.innerHTML = `
      <button id="qa-delete" type="button">Delete account</button>
      <form id="qa-form" onsubmit="event.preventDefault(); window.__formSubmitted = true;">
        <button id="qa-submit">Save</button>
      </form>
      <button id="qa-post" type="button">Refresh data</button>
      ${isDev ? '<button id="qa-devonly" type="button">Dev only feature</button>' : ''}
      <button type="button" class="dup">Duplicate</button>
      ${isDev ? '' : '<button type="button" class="dup">Duplicate</button>'}
    `;
    document.body.prepend(box);
    window.__clicked = [];
    box.addEventListener('click', (e) => window.__clicked.push(e.target.id || e.target.className));
    document.getElementById('qa-post').addEventListener('click', () => {
      window.__postResult = 'pending';
      fetch('/api/qa-write-test', { method: 'POST', body: '{}' })
        .then(() => (window.__postResult = 'sent'))
        .catch(() => (window.__postResult = 'blocked'));
    });
  };
  await dev.evaluate(fixtures, true);
  await prod.evaluate(fixtures, false);

  for (const sel of ['#qa-delete', '#qa-submit', '#qa-post', '#qa-devonly', 'button.dup']) {
    await dev.click(sel);
    await idle(s);
  }
  await sleep(500);

  const prodClicked = await prod.evaluate(() => window.__clicked);
  const prodSubmitted = await prod.evaluate(() => !!window.__formSubmitted);
  const prodPost = await prod.evaluate(() => window.__postResult);
  const has = (cls, comp) => s.mismatches.some((m) => m.classification === cls && String(m.component).toLowerCase().includes(comp));

  check('destructive "Delete account" NOT clicked on PROD', !prodClicked.includes('qa-delete'));
  check('  …recorded as SKIPPED_BY_SAFETY_POLICY', has('SKIPPED_BY_SAFETY_POLICY', 'delete'));
  check('form submit NOT replayed on PROD (read-only)', !prodSubmitted && !prodClicked.includes('qa-submit'));
  check('non-GET fetch from PROD aborted by network guard', prodPost === 'blocked', `PROD fetch result: ${prodPost}`);
  check('  …recorded as blocked POST', has('SKIPPED_BY_SAFETY_POLICY', 'post'));
  check('DEV-only element reported UNMAPPED_OR_MISSING_FEATURE', has('UNMAPPED_OR_MISSING_FEATURE', 'dev only'));
  check('nothing else clicked in its place on PROD', prodClicked.every((c) => c === 'qa-post'), JSON.stringify(prodClicked));
  check('ambiguous "Duplicate" not clicked, reported', !prodClicked.includes('dup') && s.mismatches.some((m) => /Ambiguous/.test(m.description || '')));

  // A safe (type=button) login click still replays
  await dev.click('[data-testid="login-submit"]');
  await idle(s);
  await sleep(1000);
  const devIn = await dev.locator('[data-testid="btn-logout"]').count();
  const prodIn = await prod.locator('[data-testid="btn-logout"], [data-testid="btn-continue-dashboard"]').count();
  check('safe login click replayed on PROD', devIn > 0 && prodIn > 0, `dev=${devIn} prod=${prodIn}`);

  // Back/forward maps to the PROD host
  await dev.evaluate(() => {
    history.pushState({}, '', '/qa-nav-test');
    history.back();
  });
  await sleep(1500);
  await idle(s);
  check('popstate navigation maps to PROD host (not DEV)', !prod.url().includes(new URL(DEV_URL).host), prod.url());

  const dump = JSON.stringify({ logs: s.logs, mismatches: s.mismatches });
  check('password absent from logs/findings', !dump.includes(SAMPLE_PASSWORD));
  await engine.closeSession(id);
  check('password absent from archived snapshot', !JSON.stringify(engine.getLastSnapshot()).includes(SAMPLE_PASSWORD));
});
