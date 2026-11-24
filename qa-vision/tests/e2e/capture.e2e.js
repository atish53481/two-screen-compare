// Configurable capture: viewport, masking, scope.
const fs = require('fs');
const path = require('path');
const { PNG } = require('pngjs');
const { engine, DEV_URL, PROD_URL, idle, waitForLoginForm, runSuite } = require('./helpers');

runSuite('Capture settings', async ({ check }) => {
  const id = await engine.createSession(DEV_URL, PROD_URL, {
    projectName: 'capture-e2e',
    capture: { viewport: { width: 800, height: 600 }, maskSelectors: ['[data-testid="login-email"]'] },
  });
  const s = engine.getSession(id);
  await waitForLoginForm(s);
  await idle(s);
  const vp = s.devPage.viewportSize();
  check('DEV viewport honours capture.viewport', vp && vp.width === 800 && vp.height === 600, JSON.stringify(vp));
  const pvp = s.prodPage.viewportSize();
  check('PROD viewport honours capture.viewport', pvp && pvp.width === 800 && pvp.height === 600, JSON.stringify(pvp));
  const pngs = fs.readdirSync(s.evidenceDir).filter((f) => /^dev-\d+\.png$/.test(f)).sort();
  check('evidence PNG written', pngs.length > 0);
  if (pngs.length) {
    const img = PNG.sync.read(fs.readFileSync(path.join(s.evidenceDir, pngs[0])));
    check('first evidence PNG is 800px wide', img.width === 800, `width ${img.width}`);
  }
  await engine.closeSession(id);

  const id2 = await engine.createSession(DEV_URL, PROD_URL, {
    projectName: 'scope-e2e',
    capture: { scopeSelector: '#qa-no-such-element' },
  });
  const s2 = engine.getSession(id2);
  await waitForLoginForm(s2);
  await idle(s2);
  check('missing scope element records NOT_COMPARABLE', s2.mismatches.some((m) => m.classification === 'NOT_COMPARABLE'));
  await engine.closeSession(id2);
});
