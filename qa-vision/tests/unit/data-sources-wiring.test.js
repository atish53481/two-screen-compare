const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const D = require('../../engine-dist/engine/data-sources.js');
const S = require('../../engine-dist/engine/secrets.js');

const ctx = (data, calls) => ({
  get: async (url) => { calls.push(['get', url]); return { ok: () => true, status: () => 200, json: async () => data }; },
  post: async () => { throw new Error('non-GET used'); },
});
const base = { fields: ['total'] };

test('runDataSourceChecks: start runs all API checks via GET on each context; after-comparison filters by path', async () => {
  const dc = [], pc = [];
  const run = {
    apiChecks: [{ name: 'a', path: '/api/a', ...base }, { name: 'b', path: '/api/b', ...base, whenPathStartsWith: '/dash' }],
    devCtx: ctx({ total: 5 }, dc), prodCtx: ctx({ total: 6 }, pc),
    devBase: 'http://dev.test', prodBase: 'http://prod.test', getSecret: () => null,
  };
  const start = await D.runDataSourceChecks(run);
  assert.equal(start.length, 2);
  assert.deepEqual(dc.map((c) => c[1]), ['http://dev.test/api/a', 'http://dev.test/api/b']);
  assert.deepEqual(pc.map((c) => c[1]), ['http://prod.test/api/a', 'http://prod.test/api/b']);
  dc.length = 0;
  const hit = await D.runDataSourceChecks({ ...run, afterDevPath: '/dashboard/x' });
  assert.equal(hit.length, 1);
  assert.equal(hit[0].component, 'api:b.total');
  const miss = await D.runDataSourceChecks({ ...run, afterDevPath: '/other' });
  assert.equal(miss.length, 0);
});

test('runDataSourceChecks never throws and rejects db refs outside the profile prefix', async () => {
  const out = await D.runDataSourceChecks({
    apiChecks: [{ name: 'x', path: '/p', fields: ['a'] }],
    dbChecks: [{ name: 'q', sql: 'select 1', devConnRef: 'profile:other:db:q:dev', prodConnRef: 'profile:other:db:q:prod' }],
    devCtx: {}, prodCtx: {}, devBase: 'http://d', prodBase: 'http://p', getSecret: () => 'postgres://secret',
    refPrefix: S.dbSecretPrefix('mine'),
  });
  assert.equal(out.length, 2);
  assert.match(out[1].description, /not owned by this profile/);
  assert.ok(!JSON.stringify(out).includes('postgres://'));
});

test('profile save encrypts dbCheck connection strings, strips them, ignores client refs', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qav-db-'));
  const env = { QA_VISION_SECRET_KEY: Buffer.alloc(32, 3).toString('base64') };
  const profile = {
    id: 'p1', urlA: 'http://a', urlB: 'http://b',
    dbChecks: [{ name: 'users', sql: 'select 1', devConn: 'postgres://u:pw1@dev/db', prodConn: 'postgres://u:pw2@prod/db', devConnRef: 'profile:victim:db:x:dev', devStored: true }],
  };
  const saved = S.storeProfileSecrets(profile, dir, env);
  const json = JSON.stringify(saved);
  assert.ok(!json.includes('pw1') && !json.includes('pw2') && !json.includes('devConn"'));
  const c = saved.dbChecks[0];
  assert.equal(c.devConnRef, 'profile:p1:db:users:dev');
  assert.equal(c.prodConnRef, 'profile:p1:db:users:prod');
  const key = S.loadKey(env, dir);
  assert.equal(S.decryptSecret(S.getSecretFile(dir, c.devConnRef), key), 'postgres://u:pw1@dev/db');
  // re-save without plaintext keeps the ref; blob unchanged
  const again = S.storeProfileSecrets({ ...profile, dbChecks: [{ name: 'users', sql: 'select 2' }] }, dir, env, saved);
  assert.equal(again.dbChecks[0].devConnRef, 'profile:p1:db:users:dev');
  // renamed check drops the old secret and gets no ref
  const renamed = S.storeProfileSecrets({ ...profile, dbChecks: [{ name: 'people', sql: 'select 2' }] }, dir, env, again);
  assert.equal(renamed.dbChecks[0].devConnRef, '');
  assert.equal(S.getSecretFile(dir, 'profile:p1:db:users:dev'), null);
  assert.throws(() => S.storeProfileSecrets({ ...profile, dbChecks: [{ name: 'a' }, { name: 'a' }] }, dir, env), S.SecretError);
});
