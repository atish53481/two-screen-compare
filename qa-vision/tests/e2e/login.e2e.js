// Profile auto-login: form strategy, secrets never logged/stored, nothing recorded, wrong key -> manual fallback.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { engine, DEV_URL, PROD_URL, SAMPLE_EMAIL, SAMPLE_PASSWORD, idle, runSuite } = require('./helpers');
const S = require('../../engine-dist/engine/secrets.js');

const LOGIN = {
  strategy: 'form',
  loginPath: '/',
  usernameSelector: '[data-testid="login-email"]',
  passwordSelector: '[data-testid="login-password"]',
  submitSelector: '[data-testid="login-submit"]',
  successSelector: '[data-testid="btn-continue-dashboard"]',
  timeoutMs: 15000,
};

runSuite('Profile auto-login', async ({ check }) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qav-login-'));
  const env = { QA_VISION_SECRET_KEY: Buffer.alloc(32, 5).toString('base64') };
  const profile = S.storeProfileSecrets(
    {
      id: 'e2e',
      credentialsA: { username: SAMPLE_EMAIL, password: SAMPLE_PASSWORD },
      credentialsB: { username: SAMPLE_EMAIL, password: SAMPLE_PASSWORD },
    },
    dir,
    env
  );
  const resolve = (side, e = env) => S.resolveProfileCredentials(profile, side, dir, e);

  const id = await engine.createSession(DEV_URL, PROD_URL, {
    projectName: 'login-e2e',
    login: LOGIN,
    loginCredentials: { dev: resolve('A'), prod: resolve('B') },
  });
  const s = engine.getSession(id);
  await idle(s);
  const devOk = await s.devPage.locator('[data-testid="btn-continue-dashboard"]').count();
  const prodOk = await s.prodPage.locator('[data-testid="btn-continue-dashboard"]').count();
  check('DEV shows login success element', devOk > 0);
  check('PROD shows login success element', prodOk > 0);
  check('no steps recorded during auto-login', s.stepCounter === 0, `stepCounter ${s.stepCounter}`);
  const logText = JSON.stringify(s.logs);
  check('logs record login on both sides', logText.includes('Logged in on DEV as') && logText.includes('Logged in on PROD as'));
  check('PROD login POST audited via guard log', logText.includes('PROD login submitted (profile login flow)'));
  check('auto-login never logs or stores the password',
    !logText.includes(SAMPLE_PASSWORD) &&
      !JSON.stringify(s.mismatches).includes(SAMPLE_PASSWORD) &&
      !JSON.stringify(profile).includes(SAMPLE_PASSWORD) &&
      !['qa-vision.db', 'qa-vision.db-wal'].some((f) => fs.existsSync(path.join(dir, f)) && fs.readFileSync(path.join(dir, f)).includes(SAMPLE_PASSWORD)));
  await engine.closeSession(id);

  // Wrong key: decrypt fails -> manual fallback is logged, session still starts
  const wrong = { QA_VISION_SECRET_KEY: Buffer.alloc(32, 6).toString('base64') };
  const id2 = await engine.createSession(DEV_URL, PROD_URL, {
    projectName: 'login-wrongkey-e2e',
    login: LOGIN,
    loginCredentials: { dev: resolve('A', wrong), prod: resolve('B', wrong) },
  });
  const s2 = engine.getSession(id2);
  await idle(s2);
  const log2 = JSON.stringify(s2.logs);
  check('wrong key -> manual fallback logged', log2.includes('Auto-login unavailable on DEV') && log2.includes('log in manually in the window'));
  check('wrong key -> login form still shown', (await s2.devPage.locator('[data-testid="login-email"]').count()) > 0);
  await engine.closeSession(id2);
});
