// Safety allowlist: an allowlisted action may trigger PROD writes (audited); others stay blocked.
const { engine, DEV_URL, PROD_URL, sleep, idle, waitForLoginForm, runSuite } = require('./helpers');

runSuite('Allowlist', async ({ check }) => {
  const id = await engine.createSession(DEV_URL, PROD_URL, { projectName: 'allowlist-e2e', safetyPolicy: 'read-only', safetyAllowlist: ['refresh data'] });
  const s = engine.getSession(id);
  await waitForLoginForm(s);

  const fixtures = () => {
    const mk = (id, label) => {
      const b = document.createElement('button');
      b.id = id;
      b.type = 'button';
      b.textContent = label;
      b.onclick = () => {
        window['__' + id] = 'pending';
        fetch('/api/qa-write-test', { method: 'POST', body: '{}' })
          .then(() => (window['__' + id] = 'sent'))
          .catch(() => (window['__' + id] = 'blocked'));
      };
      document.body.prepend(b);
    };
    mk('allowed', 'Refresh data');
    mk('other', 'Sync records');
  };
  await s.devPage.evaluate(fixtures);
  await s.prodPage.evaluate(fixtures);

  await s.devPage.click('#allowed');
  await idle(s);
  await sleep(500);
  const allowed = await s.prodPage.evaluate(() => window.__allowed);
  check('allowlisted action lets its PROD write through', allowed === 'sent', `result: ${allowed}`);
  check('  …permitted write is audited in the log', s.logs.some((l) => /PROD write permitted/.test(l.action)));

  await sleep(5500); // let the 5s permit window expire
  await s.devPage.click('#other');
  await idle(s);
  await sleep(500);
  const other = await s.prodPage.evaluate(() => window.__other);
  check('non-allowlisted action is still blocked afterwards', other === 'blocked', `result: ${other}`);

  await engine.closeSession(id);
});
