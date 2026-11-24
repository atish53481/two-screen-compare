const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const S = require('../../engine-dist/engine/secrets.js');
const engine = require('../../playwright.js').default;

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'qav-origin-'));
const env = () => ({ QA_VISION_SECRET_KEY: Buffer.alloc(32, 7).toString('base64') });
const CFG = { strategy: 'form', loginPath: '/login', usernameSelector: 'u', passwordSelector: 'p', submitSelector: 's', timeoutMs: 500 };
const CREDS = { username: 'user', password: 'pw-secret' };

function stubSession(id, redirectTo) {
  const fills = [];
  let url = 'http://good.example/';
  const loc = () => ({
    first: () => ({
      fill: async (v) => { fills.push(v); },
      click: async () => {},
      waitFor: async () => {},
    }),
  });
  const page = {
    url: () => url,
    goto: async (u) => { url = redirectTo || u; },
    waitForLoadState: async () => {},
    locator: loc,
  };
  const session = {
    id, devUrl: 'http://good.example/', prodUrl: 'http://good.example/', devPage: page, prodPage: page,
    logs: [], suppressCapture: false, permitMutationsUntil: 0, isRunning: true,
  };
  engine.sessions.set(id, session);
  return { session, fills };
}

test('absolute cross-origin loginPath is rejected, nothing is filled', async () => {
  const { session, fills } = stubSession('s1');
  const ok = await engine.performLogin('s1', 'DEV', CREDS, { ...CFG, loginPath: 'https://evil.example/login' });
  assert.equal(ok, false);
  assert.deepEqual(fills, []);
  assert.match(JSON.stringify(session.logs), /Auto-login unavailable on DEV: login page origin mismatch — log in manually in the window/);
  engine.sessions.delete('s1');
});

test('redirect to another origin: no fill happens', async () => {
  const { session, fills } = stubSession('s2', 'http://evil.example/phish');
  const ok = await engine.performLogin('s2', 'PROD', CREDS, CFG);
  assert.equal(ok, false);
  assert.deepEqual(fills, []);
  assert.match(JSON.stringify(session.logs), /Auto-login unavailable on PROD: login page origin mismatch/);
  assert.ok(!JSON.stringify(session.logs).includes('pw-secret'));
  engine.sessions.delete('s2');
});

test('same-origin login still fills', async () => {
  const { fills } = stubSession('s3');
  assert.equal(await engine.performLogin('s3', 'DEV', CREDS, CFG), true);
  assert.deepEqual(fills, ['user', 'pw-secret']);
  engine.sessions.delete('s3');
});

test('changing urlA origin without a password drops secretRef and blob', () => {
  const dir = tmp();
  const base = { id: 'p', urlA: 'http://a.example', urlB: 'http://b.example', login: { loginPath: '/login' } };
  const saved = S.storeProfileSecrets({ ...base, credentialsA: { username: 'u', password: 'pw' }, credentialsB: { username: 'u', password: 'pw2' } }, dir, env());
  const moved = S.storeProfileSecrets({ ...saved, urlA: 'http://evil.example', credentialsA: { username: 'u' } }, dir, env(), saved);
  assert.equal(moved.credentialsA.secretRef, undefined);
  assert.equal(S.getSecretFile(dir, 'profile:p:A'), null);
  assert.equal(moved.credentialsB.secretRef, 'profile:p:B');
  assert.ok(S.getSecretFile(dir, 'profile:p:B'));
});

test('unchanged origin keeps secretRef; new password with new origin is accepted', () => {
  const dir = tmp();
  const base = { id: 'p', urlA: 'http://a.example', urlB: 'http://b.example', login: { loginPath: '/login' } };
  const saved = S.storeProfileSecrets({ ...base, credentialsA: { username: 'u', password: 'pw' } }, dir, env());
  const same = S.storeProfileSecrets({ ...saved, credentialsA: { username: 'u2' } }, dir, env(), saved);
  assert.equal(same.credentialsA.secretRef, 'profile:p:A');
  const re = S.storeProfileSecrets({ ...saved, urlA: 'http://c.example', credentialsA: { username: 'u', password: 'new' } }, dir, env(), saved);
  assert.equal(re.credentialsA.secretRef, 'profile:p:A');
});

test('changing loginPath to another origin drops the secret', () => {
  const dir = tmp();
  const base = { id: 'p', urlA: 'http://a.example', urlB: 'http://b.example', login: { loginPath: '/login' } };
  const saved = S.storeProfileSecrets({ ...base, credentialsA: { username: 'u', password: 'pw' } }, dir, env());
  const moved = S.storeProfileSecrets({ ...saved, login: { loginPath: 'http://evil.example/x' }, credentialsA: { username: 'u' } }, dir, env(), saved);
  assert.equal(moved.credentialsA.secretRef, undefined);
  assert.equal(S.getSecretFile(dir, 'profile:p:A'), null);
});

test('resolveSessionLogin fails closed on odd URLs', () => {
  const dir = tmp();
  const e = env();
  const mk = (urlA, urlB = 'http://localhost:3003') =>
    S.storeProfileSecrets({ id: 'x', urlA, urlB, login: { strategy: 'form', loginPath: '/' }, credentialsA: { username: 'u', password: 'p' } }, dir, e);
  assert.equal(S.resolveSessionLogin(mk('not a url'), 'http://localhost:3002', 'http://localhost:3003', dir, e).ok, false);
  assert.equal(S.resolveSessionLogin(mk('https://h.example'), 'http://h.example', 'http://localhost:3003', dir, e).ok, false);
  assert.equal(S.resolveSessionLogin(mk('http://h.example:8080'), 'http://h.example', 'http://localhost:3003', dir, e).ok, false);
  assert.equal(S.resolveSessionLogin(mk('http://h.example'), 'http://h.example:80', 'http://localhost:3003', dir, e).ok, true); // :80 is the default http port: same origin
  assert.equal(S.resolveSessionLogin(mk('http://h.example:81'), 'http://h.example:80', 'http://localhost:3003', dir, e).ok, false);
  assert.equal(S.resolveSessionLogin(mk('http://localhost:3002'), 12345, 'http://localhost:3003', dir, e).ok, false);
  assert.equal(S.resolveSessionLogin(mk('http://localhost:3002'), undefined, null, dir, e).ok, false);
});
