// Double-click, hover and keyboard capture on DEV and replay on PROD.
const { engine, DEV_URL, PROD_URL, SAMPLE_EMAIL, SAMPLE_PASSWORD, sleep, idle, waitForLoginForm, runSuite } = require('./helpers');

runSuite('Actions (dblclick / hover / keyboard)', async ({ check }) => {
  const id = await engine.createSession(DEV_URL, PROD_URL, { projectName: 'actions-e2e' });
  const s = engine.getSession(id);
  const { devPage: dev, prodPage: prod } = s;
  await waitForLoginForm(s);

  // Enter inside a form is a submit: blocked on PROD in read-only mode
  const addForm = () => {
    const f = document.createElement('form');
    f.id = 'qa-enter-form';
    f.onsubmit = (e) => {
      e.preventDefault();
      window.__enterSubmitted = true;
    };
    f.innerHTML = '<input id="qa-enter-input" name="qa-q" type="text"><button id="qa-enter-go">Go</button>';
    document.body.prepend(f);
  };
  await dev.evaluate(addForm);
  await prod.evaluate(addForm);
  await dev.focus('#qa-enter-input');
  await dev.keyboard.press('Enter');
  await idle(s);
  check('Enter inside form NOT submitted on PROD', !(await prod.evaluate(() => !!window.__enterSubmitted)));
  check(
    'Enter in form recorded SKIPPED_BY_SAFETY_POLICY',
    s.mismatches.some((m) => m.classification === 'SKIPPED_BY_SAFETY_POLICY' && /^key /.test(m.devValue || ''))
  );
  await dev.evaluate(() => document.getElementById('qa-enter-form').remove());
  await prod.evaluate(() => document.getElementById('qa-enter-form').remove());

  // Log in on DEV (replays on PROD); both welcome modals appear
  await dev.locator('[data-testid="login-email"]').pressSequentially(SAMPLE_EMAIL, { delay: 5 });
  await dev.locator('[data-testid="login-password"]').pressSequentially(SAMPLE_PASSWORD, { delay: 5 });
  await dev.click('[data-testid="login-submit"]');
  await idle(s);
  await dev.waitForSelector('[data-testid="modal"]');
  await prod.waitForSelector('[data-testid="modal"]');

  // Escape closes the modal on both
  await dev.keyboard.press('Escape');
  await idle(s);
  await sleep(300);
  check('Escape key replays and closes PROD modal', (await prod.locator('[data-testid="modal"]').count()) === 0 && (await dev.locator('[data-testid="modal"]').count()) === 0);

  // Single click and double click, counting native click events on both pages
  const count = () => {
    window.__clicks = 0;
    document.querySelector('[data-testid="row-dbl"]').addEventListener('click', () => window.__clicks++);
  };
  await dev.evaluate(count);
  await prod.evaluate(count);
  await dev.locator('[data-testid="row-dbl"]').dblclick();
  await idle(s);
  await sleep(300);
  check('dblclick replays and opens PROD details panel', (await prod.locator('[data-testid="row-details"]').count()) === 1);
  const devClicks = await dev.evaluate(() => window.__clicks);
  const prodClicks = await prod.evaluate(() => window.__clicks);
  check('single click not replayed twice around a dblclick', devClicks === 2 && prodClicks === 2, `dev=${devClicks} prod=${prodClicks}`);

  await dev.evaluate(() => (window.__clicks = 0));
  await prod.evaluate(() => (window.__clicks = 0));
  await dev.locator('[data-testid="row-dbl"]').click();
  await idle(s);
  await sleep(300);
  check('plain click on a dblclick target still replays once', (await prod.evaluate(() => window.__clicks)) === 1);

  // Hover dwell
  await dev.locator('[data-testid="help-hover"]').hover();
  await sleep(900);
  await idle(s);
  check('hover replays and shows PROD tooltip', (await prod.locator('[data-testid="help-tooltip"]').count()) === 1);
});
