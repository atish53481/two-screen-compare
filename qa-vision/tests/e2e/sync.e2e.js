// Synchronization & findings: ordered queue (no skipped comparisons), de-duplication,
// out-of-sync detection + resync, Stop draining in-flight work, ignore rules.
const { engine, DEV_URL, PROD_URL, SAMPLE_EMAIL, SAMPLE_PASSWORD, idle, waitForLoginForm, runSuite } = require('./helpers');

const compareLogs = (s) => s.logs.filter((l) => l.action.startsWith('Compared after'));
function coveredSteps(logs) {
  const out = new Set();
  for (const l of logs) {
    const m = l.action.match(/^Compared after (.+?):/);
    if (!m) continue;
    const range = m[1].match(/^(step-\d+)…(step-\d+) \((\d+) steps\)$/);
    if (range) {
      for (let i = +range[1].slice(5); i <= +range[2].slice(5); i++) out.add('step-' + String(i).padStart(4, '0'));
    } else m[1].split(', ').forEach((x) => out.add(x));
  }
  return out;
}
const replayedSteps = (logs) => logs.map((l) => (l.action.match(/^\[(step-\d+)\] Replicating/) || [])[1]).filter(Boolean);

runSuite('Synchronization & findings', async ({ check }) => {
  // ---------- Session A: no ignore rules ----------
  const a = await engine.createSession(DEV_URL, PROD_URL, { projectName: 'sync-A' });
  const A = engine.getSession(a);
  await waitForLoginForm(A);
  await idle(A);
  check('baseline comparison runs at session start', coveredSteps(A.logs).has('initial'));

  // Burst: fast typing in two fields + immediate click
  await A.devPage.locator('[data-testid="login-email"]').pressSequentially(SAMPLE_EMAIL, { delay: 0 });
  await A.devPage.locator('[data-testid="login-password"]').pressSequentially(SAMPLE_PASSWORD, { delay: 0 });
  await A.devPage.click('[data-testid="login-submit"]');
  await idle(A);
  const replayed = replayedSteps(A.logs);
  const uncovered = replayed.filter((st) => !coveredSteps(A.logs).has(st));
  check('every replayed step is covered by a comparison', replayed.length >= 3 && uncovered.length === 0,
    `replayed=${replayed.length}, comparisons=${compareLogs(A).length}, uncovered=${uncovered.join(',') || 'none'}`);
  const order = replayed.slice().reverse();
  check('steps replay in capture order', order.every((x, i) => i === 0 || x > order[i - 1]));
  const prodIn = await A.prodPage.locator('[data-testid="btn-logout"], [data-testid="btn-continue-dashboard"]').count();
  check('burst login replayed correctly on PROD', prodIn > 0);

  // Dismiss the post-login modal (replays on PROD too)
  await A.devPage.waitForSelector('[data-testid="btn-continue-dashboard"]', { timeout: 5000 }).catch(() => {});
  if (await A.devPage.locator('[data-testid="btn-continue-dashboard"]').count()) {
    await A.devPage.click('[data-testid="btn-continue-dashboard"]');
    await idle(A);
  }

  // Repeated actions on the same page must not multiply findings
  const before = A.mismatches.length;
  for (let i = 0; i < 3; i++) {
    await A.devPage.click('h1');
    await idle(A);
  }
  const fps = A.mismatches.map((m) => [m.page, m.type, m.component, m.devValue, m.prodValue].join('|'));
  const dupes = fps.length - new Set(fps).size;
  const repeated = A.mismatches.find((m) => (m.occurrences || 1) > 1);
  check('no duplicate findings after repeated actions', dupes === 0, `findings ${before} -> ${A.mismatches.length}`);
  check('repeats increment occurrences instead', !!repeated, repeated ? `"${repeated.component}" ×${repeated.occurrences}` : '');

  // Out of sync + resync
  await A.devPage.goto(`${DEV_URL.replace(/\/$/, '')}/?view=reports`, { waitUntil: 'domcontentloaded' });
  await A.devPage.click('h1');
  await idle(A);
  check('out-of-sync state detected and logged', A.outOfSync && A.logs.some((l) => l.action.startsWith('OUT OF SYNC')));
  const rs = await engine.resync(a);
  await idle(A);
  check('resync aligns PROD to the DEV page', rs.ok && new URL(A.prodPage.url()).search === '?view=reports', A.prodPage.url());
  check('resync clears out-of-sync and runs a comparison', !A.outOfSync && coveredSteps(A.logs).has('resync'));
  const envDiffA = A.mismatches.some((m) => /environment/i.test(`${m.devValue} ${m.prodValue}`));

  // Stop drains in-flight work
  await A.devPage.click('h1');
  await engine.closeSession(a);
  const snap = engine.getLastSnapshot();
  const lastStep = replayedSteps(snap.logs)[0];
  check('Stop waits for the last action and its comparison', !!lastStep && coveredSteps(snap.logs).has(lastStep), `last=${lastStep}`);
  check('Stop is logged in the archived run', snap.logs.some((l) => l.action === 'Session stopped by user'));

  // ---------- Session B: ignore rules ----------
  const b = await engine.createSession(DEV_URL, PROD_URL, { projectName: 'sync-B', ignoreRules: ['numbers', 'text:environment'] });
  const B = engine.getSession(b);
  await waitForLoginForm(B);
  await idle(B);
  await B.devPage.click('h1');
  await idle(B);
  const envDiffB = B.mismatches.some((m) => /environment/i.test(`${m.component} ${m.devValue} ${m.prodValue}`));
  const numberOnlyB = B.mismatches.some((m) => m.type === 'Text' && /^[\d,.$\sMk]+$/.test(m.devValue) && /^[\d,.$\sMk]+$/.test(m.prodValue));
  check('without rules, the environment banner difference is reported', envDiffA);
  check('text: rule excludes matching findings', !envDiffB);
  check('numbers rule suppresses number-only differences', !numberOnlyB);
  check('suppressions are logged, not silent', B.logs.some((l) => /suppressed by ignore rules/.test(l.action)));
  await engine.closeSession(b);
});
