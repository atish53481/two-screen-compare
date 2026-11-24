// Expected differences (persisted per profile) and element highlighting in both browsers.
const os = require('os');
const fs = require('fs');
const path = require('path');
process.env.QA_VISION_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'qav-expected-'));
const { engine, DEV_URL, PROD_URL, SAMPLE_EMAIL, SAMPLE_PASSWORD, idle, waitForLoginForm, runSuite } = require('./helpers');

async function reachDashboard(s) {
  await waitForLoginForm(s);
  await idle(s);
  await s.devPage.locator('[data-testid="login-email"]').pressSequentially(SAMPLE_EMAIL, { delay: 5 });
  await s.devPage.locator('[data-testid="login-password"]').pressSequentially(SAMPLE_PASSWORD, { delay: 5 });
  await s.devPage.click('[data-testid="login-submit"]');
  await idle(s);
  await s.devPage.waitForSelector('[data-testid="btn-continue-dashboard"]', { timeout: 8000 });
  await s.devPage.click('[data-testid="btn-continue-dashboard"]');
  await idle(s);
}
const isAddUser = (x) => /btn-add-user/.test(`${x.devSelector} ${x.prodSelector} ${x.component}`) && x.type === 'DOM' && x.property === 'enabled';

runSuite('Expected + highlight', async ({ check }) => {
  const opts = { projectName: 'expected-e2e', profileId: 'prof-expected', safetyAllowlist: ['login-submit'] };
  const id = await engine.createSession(DEV_URL, PROD_URL, opts);
  const s = engine.getSession(id);
  await reachDashboard(s);

  const f = s.mismatches.find(isAddUser);
  check('baseline finding is POTENTIAL_DEFECT', f && f.classification === 'POTENTIAL_DEFECT', f ? f.classification : 'missing');
  const before = s.mismatches.length;

  const r = await engine.markExpected({ sessionId: id }, f.id, true, 'known sample difference');
  check('mark expected reclassifies live finding with provenance',
    r.ok && f.classification === 'EXPECTED_DIFFERENCE' && /user-expectation/.test(f.ruleApplied) && /known sample difference/.test(f.ruleApplied),
    `${f.classification} ${f.ruleApplied}`);
  check('expected differences remain visible in session.mismatches', s.mismatches.length === before && s.mismatches.includes(f));

  const h = await engine.highlightFinding(id, f.id);
  check('highlight returns {dev:true, prod:true} for btn-add-user and overlay exists on both pages', h.dev && h.prod
    && (await s.devPage.locator('[data-qa-vision-highlight]').count()) === 1
    && (await s.prodPage.locator('[data-qa-vision-highlight]').count()) === 1, JSON.stringify(h));
  const steps = s.stepCounter;
  await s.devPage.locator('[data-qa-vision-highlight]').dispatchEvent('click');
  await idle(s);
  check('clicking the overlay is not recorded as an action', s.stepCounter === steps);

  // DEV-only element: injected into the DEV page only (sample apps stay untouched)
  await s.devPage.evaluate(() => {
    const d = document.createElement('div');
    d.setAttribute('data-testid', 'dev-only-probe');
    d.textContent = 'dev only';
    document.body.appendChild(d);
  });
  const synthetic = { id: 'synthetic_dev_only', type: 'DOM', component: 'dev-only-probe', devSelector: '[data-testid="dev-only-probe"]', prodSelector: '[data-testid="dev-only-probe"]' };
  s.mismatches.push(synthetic);
  const h2 = await engine.highlightFinding(id, synthetic.id);
  check('highlight on DEV-only element returns prod:false with reason', h2.dev === true && h2.prod === false && /PROD/.test(h2.reason || ''), JSON.stringify(h2));
  await engine.closeSession(id);

  const id2 = await engine.createSession(DEV_URL, PROD_URL, opts);
  const s2 = engine.getSession(id2);
  await reachDashboard(s2);
  const f2 = s2.mismatches.find(isAddUser);
  check('expectation persists: second session on same profile classifies the same difference EXPECTED_DIFFERENCE on first comparison',
    f2 && f2.classification === 'EXPECTED_DIFFERENCE', f2 ? f2.classification : 'missing');

  const u = await engine.markExpected({ sessionId: id2 }, f2.id, false);
  check('unmark returns finding to POTENTIAL_DEFECT', u.ok && f2.classification === 'POTENTIAL_DEFECT');
  await engine.closeSession(id2);
});
