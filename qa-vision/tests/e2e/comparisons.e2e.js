// Per-step comparisons: DOM, CSS/layout, a11y, data rules, network and console.
const { engine, DEV_URL, PROD_URL, SAMPLE_EMAIL, SAMPLE_PASSWORD, idle, waitForLoginForm, runSuite } = require('./helpers');

runSuite('Comparisons', async ({ check }) => {
  const id = await engine.createSession(DEV_URL, PROD_URL, {
    projectName: 'comparisons-e2e',
    safetyAllowlist: ['login-submit'],
    dataRules: [{ target: 'table:tid:orders:*', mode: 'exact' }],
  });
  const s = engine.getSession(id);
  await waitForLoginForm(s);
  await idle(s); // let the initial comparison finish before driving
  await s.devPage.locator('[data-testid="login-email"]').pressSequentially(SAMPLE_EMAIL, { delay: 5 });
  await s.devPage.locator('[data-testid="login-password"]').pressSequentially(SAMPLE_PASSWORD, { delay: 5 });
  await s.devPage.click('[data-testid="login-submit"]');
  await idle(s);
  await s.devPage.waitForSelector('[data-testid="btn-continue-dashboard"]', { timeout: 8000 });
  await s.devPage.click('[data-testid="btn-continue-dashboard"]');
  await idle(s);

  const m = s.mismatches;
  const find = (pred) => m.find(pred);
  const has = (re, v) => re.test(String(v || ''));
  const found = {
    'CSS/Layout on btn-add-user': find((x) => (x.type === 'CSS' || x.type === 'Layout') && has(/btn-add-user/, `${x.devSelector} ${x.prodSelector} ${x.component}`)),
    'Accessibility alt': find((x) => x.type === 'Accessibility' && x.property === 'alt'),
    'Network /api/stats growth': find((x) => x.type === 'Network' && has(/\/api\/stats/, `${x.component} ${x.description}`) && has(/growth/, `${x.devValue} ${x.prodValue} ${x.description}`)),
    'Console Legacy chart': find((x) => x.type === 'Console' && has(/Legacy chart/, `${x.devValue} ${x.prodValue} ${x.description}`)),
    'Data row count orders': find((x) => x.type === 'Data' && has(/orders/, x.component) && has(/row/i, `${x.property} ${x.description}`)),
    'DOM enabled on btn-add-user': find((x) => x.type === 'DOM' && x.property === 'enabled' && has(/btn-add-user/, `${x.devSelector} ${x.prodSelector} ${x.component}`)),
  };
  for (const [name, f] of Object.entries(found)) {
    check(`finding: ${name}`, !!f && f.classification === 'POTENTIAL_DEFECT', f ? f.classification : 'missing');
  }
  check('no finding for class differences', !m.some((x) => x.property === 'class'));
  check('compare log carries per-type counts', s.logs.some((l) => /Compared after .*\d+ new \(Text \d+, DOM \d+, CSS \d+, Layout \d+, A11y \d+, Data \d+, Network \d+, Console \d+\)/.test(l.action)));

  await engine.closeSession(id);

  // (a) ignore rules apply to structural findings
  const b = await engine.createSession(DEV_URL, PROD_URL, {
    projectName: 'comparisons-ignore',
    safetyAllowlist: ['login-submit'],
    ignoreRules: ['text:add test user'],
  });
  const B = engine.getSession(b);
  await waitForLoginForm(B);
  await B.devPage.locator('[data-testid="login-email"]').pressSequentially(SAMPLE_EMAIL, { delay: 5 });
  await B.devPage.locator('[data-testid="login-password"]').pressSequentially(SAMPLE_PASSWORD, { delay: 5 });
  await B.devPage.click('[data-testid="login-submit"]');
  await idle(B);
  await B.devPage.waitForSelector('[data-testid="btn-continue-dashboard"]', { timeout: 8000 });
  await B.devPage.click('[data-testid="btn-continue-dashboard"]');
  await idle(B);
  const addUser = (x) => /btn-add-user/.test(`${x.devSelector} ${x.prodSelector}`) && (x.type === 'CSS' || x.type === 'Layout' || x.type === 'DOM');
  check('ignore rule suppresses structural findings for btn-add-user', !B.mismatches.some(addUser));
  check('structural suppression is logged', B.logs.some((l) => /suppressed by ignore rules/.test(l.action)));
  check('other structural findings still reported under ignore rules', B.mismatches.some((x) => x.type === 'Network'));
  await engine.closeSession(b);

  // (b) budget exceeded: text/visual kept, logs drained in place
  process.env.QA_VISION_COMPARE_BUDGET_MS = '1';
  try {
    const c = await engine.createSession(DEV_URL, PROD_URL, { projectName: 'comparisons-budget' });
    const C = engine.getSession(c);
    await waitForLoginForm(C);
    await idle(C);
    const refs = [C.netLog.dev, C.netLog.prod, C.runtimeLog.dev, C.runtimeLog.prod];
    C.netLog.dev.push({ method: 'GET', path: '/x', status: 200, keys: [] });
    await C.devPage.click('h1');
    await idle(C);
    check('budget exceeded is logged', C.logs.some((l) => /Comparison budget exceeded/.test(l.action)));
    check('text findings still recorded when budget exceeded', C.mismatches.some((x) => x.type === 'Text'));
    check('no structural findings when budget exceeded', !C.mismatches.some((x) => ['DOM', 'CSS', 'Layout', 'Accessibility', 'Network', 'Console'].includes(x.type)));
    check('logs drained in place', refs[0] === C.netLog.dev && refs[1] === C.netLog.prod && refs[2] === C.runtimeLog.dev && refs[3] === C.runtimeLog.prod && refs.every((r) => r.length === 0));
  } finally {
    delete process.env.QA_VISION_COMPARE_BUDGET_MS;
  }

  // (c) non-budget structural failure: text/visual findings and the summary line survive
  const d = await engine.createSession(DEV_URL, PROD_URL, { projectName: 'comparisons-failure' });
  const D = engine.getSession(d);
  await waitForLoginForm(D);
  await idle(D);
  const realEval = D.devPage.evaluate.bind(D.devPage);
  D.devPage.evaluate = (fn, ...rest) => (fn && fn.name === 'extractPageSnapshot' ? Promise.reject(new Error('boom extraction')) : realEval(fn, ...rest));
  const logsBefore = D.logs.length;
  await D.devPage.click('h1');
  await idle(D);
  D.devPage.evaluate = realEval;
  const after = D.logs.slice(0, D.logs.length - logsBefore); // logs are newest-first
  check('structural failure is logged', after.some((l) => /Structural comparison failed.*boom extraction/.test(l.action)));
  check('Compared line still produced after structural failure', after.some((l) => /^Compared after/.test(l.action)));
  check('text findings kept after structural failure', D.mismatches.some((x) => x.type === 'Text'));
  check('no "Comparison failed" after structural failure', !after.some((l) => /^Comparison failed/.test(l.action)));
});
