// Launch -> Ready -> Start Comparison -> Pause -> Start again -> Stop.
// Dashboard sessions start in 'ready': nothing is replicated or compared until startComparison().
const { openStore } = require('../../engine-dist/engine/store.js');
const { engine, DEV_URL, PROD_URL, SAMPLE_EMAIL, sleep, idle, waitForLoginForm, runSuite } = require('./helpers');

const compared = (s) => s.logs.filter((l) => l.action.startsWith('Compared after')).length;
const resyncs = (s) => s.logs.filter((l) => l.action.startsWith('Resynchronized')).length;
const replicated = (s) => s.logs.filter((l) => /\] Replicating/.test(l.action)).length;
const readyLines = (s) => s.logs.filter((l) => l.action.startsWith('Ready')).length;

runSuite('Start flow (ready -> running -> paused)', async ({ check }) => {
  const id = await engine.createSession(DEV_URL, PROD_URL, { projectName: 'start-flow', startImmediately: false });
  const S = engine.getSession(id);
  await waitForLoginForm(S);
  await idle(S);

  check('new dashboard session starts in phase "ready"', engine.getPhase(id) === 'ready' && S.phase === 'ready' && !S.isPaused);
  check('no comparison runs at launch', compared(S) === 0, `compared=${compared(S)}`);

  // Ready: DEV interaction is neither replicated nor counted
  await S.devPage.locator('[data-testid="login-email"]').pressSequentially(SAMPLE_EMAIL, { delay: 0 });
  await S.devPage.click('h1');
  await S.devPage.goto(`${DEV_URL.replace(/\/$/, '')}/?view=reports`, { waitUntil: 'domcontentloaded' });
  await S.devPage.click('h1');
  await idle(S);
  await sleep(500);
  check('ready: DEV actions are not replicated or counted', replicated(S) === 0 && S.stepCounter === 0 && S.pendingActions === 0, `replicated=${replicated(S)} steps=${S.stepCounter}`);
  check('ready: no comparison ran', compared(S) === 0);
  check('ready: logs a single "Ready" line', readyLines(S) === 1, `lines=${readyLines(S)}`);
  check('ready: PROD did not follow DEV', new URL(S.prodPage.url()).search === '');

  // Start
  const started = await engine.startComparison(id);
  await idle(S);
  check('start: ok and phase "running"', started.ok && engine.getPhase(id) === 'running' && !S.isPaused, JSON.stringify(started));
  check('start: PROD is at DEV\'s path', new URL(S.prodPage.url()).search === '?view=reports', S.prodPage.url());
  check('start: a comparison is logged', compared(S) >= 1);
  check('start: logs "Comparison started"', S.logs.some((l) => l.action === 'Comparison started'));
  const again = await engine.startComparison(id);
  check('start twice is rejected (not ready)', !again.ok && again.status === 'bad-phase', JSON.stringify(again));

  // Running: actions replicate
  const r0 = replicated(S);
  await S.devPage.click('h1');
  await idle(S);
  check('running: DEV action is replicated', replicated(S) > r0);

  // Pause
  await engine.setPaused(id, true);
  check('pause: phase "paused", isPaused consistent', engine.getPhase(id) === 'paused' && S.isPaused);
  const r1 = replicated(S);
  const c1 = compared(S);
  await S.devPage.click('h1');
  await idle(S);
  await sleep(500);
  check('paused: actions are not replicated or compared', replicated(S) === r1 && compared(S) === c1);

  // Start again: resync + comparison
  const rs1 = resyncs(S);
  await engine.setPaused(id, false);
  await idle(S);
  check('start again: phase "running"', engine.getPhase(id) === 'running' && !S.isPaused);
  check('start again: resync and a comparison', resyncs(S) === rs1 + 1 && compared(S) > c1, `resyncs ${rs1}->${resyncs(S)}, compared ${c1}->${compared(S)}`);
  await engine.closeSession(id);
  check('stop from running persists the run', !!openStore().getRun(id));

  // Stop from ready persists a zero-step run
  const b = await engine.createSession(DEV_URL, PROD_URL, { projectName: 'start-flow-ready-stop', startImmediately: false });
  await waitForLoginForm(engine.getSession(b));
  await engine.closeSession(b);
  const run = openStore().getRun(b);
  check('stop from ready persists the run (zero steps)', !!run, run ? '' : 'not persisted');

  // startImmediately keeps the legacy behaviour (default)
  const c = await engine.createSession(DEV_URL, PROD_URL, { projectName: 'start-flow-legacy' });
  const C = engine.getSession(c);
  await waitForLoginForm(C);
  await idle(C);
  check('startImmediately (default): phase "running" with baseline comparison', engine.getPhase(c) === 'running' && compared(C) >= 1);
  await engine.closeSession(c);
});
