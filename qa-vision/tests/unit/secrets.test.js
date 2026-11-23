const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const S = require('../../engine-dist/engine/secrets.js');

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'qav-secrets-'));
const key = () => Buffer.alloc(32, 7);

test('round trip', () => {
  const blob = S.encryptSecret('p@ss w0rd', key());
  assert.match(blob, /^v1:[^:]+:[^:]+:[^:]+$/);
  assert.equal(S.decryptSecret(blob, key()), 'p@ss w0rd');
});

test('ciphertext differs each time', () => {
  assert.notEqual(S.encryptSecret('same', key()), S.encryptSecret('same', key()));
});

test('decrypt with wrong key throws SecretError and login falls back to manual', () => {
  const blob = S.encryptSecret('x', key());
  assert.throws(
    () => S.decryptSecret(blob, Buffer.alloc(32, 9)),
    (e) => e instanceof S.SecretError && /re-enter it in the profile/.test(e.message)
  );
  assert.throws(() => S.decryptSecret('garbage', key()), S.SecretError);
});

test('bad QA_VISION_SECRET_KEY length throws', () => {
  assert.throws(() => S.loadKey({ QA_VISION_SECRET_KEY: Buffer.alloc(16).toString('base64') }, tmp()), S.SecretError);
  const good = Buffer.alloc(32, 1);
  assert.deepEqual(S.loadKey({ QA_VISION_SECRET_KEY: good.toString('base64') }, tmp()), good);
});

test('generated key file is reused on second call', () => {
  const dir = tmp();
  const k1 = S.loadKey({}, dir);
  assert.equal(k1.length, 32);
  assert.ok(fs.existsSync(path.join(dir, '.secret-key')));
  assert.deepEqual(S.loadKey({}, dir), k1);
});

test('secret file helpers store blobs only', () => {
  const dir = tmp();
  const blob = S.encryptSecret('topsecret', key());
  S.putSecretFile(dir, 'profile:a:A', blob);
  assert.equal(S.getSecretFile(dir, 'profile:a:A'), blob);
  assert.equal(S.getSecretFile(dir, 'nope'), null);
  assert.ok(!fs.readFileSync(path.join(dir, 'secrets.json'), 'utf8').includes('topsecret'));
  S.deleteSecretFile(dir, 'profile:a:A');
  assert.equal(S.getSecretFile(dir, 'profile:a:A'), null);
});

test('storeProfileSecrets encrypts plaintext and strips it; resolveProfileCredentials decrypts', () => {
  const dir = tmp();
  const env = { QA_VISION_SECRET_KEY: key().toString('base64') };
  const p = { id: 'p1', credentialsA: { username: 'u', password: 'hunter2' } };
  const out = S.storeProfileSecrets(p, dir, env);
  assert.equal(out.credentialsA.password, undefined);
  assert.equal(out.credentialsA.secretRef, 'profile:p1:A');
  assert.ok(!JSON.stringify(out).includes('hunter2'));
  assert.deepEqual(S.resolveProfileCredentials(out, 'A', dir, env), { creds: { username: 'u', password: 'hunter2' } });
  const bad = S.resolveProfileCredentials(out, 'A', dir, { QA_VISION_SECRET_KEY: Buffer.alloc(32, 3).toString('base64') });
  assert.match(bad.error, /cannot be decrypted/);
  assert.deepEqual(S.resolveProfileCredentials(out, 'B', dir, env), { creds: null });
});
