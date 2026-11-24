const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { openStore } = require('../../engine-dist/engine/store.js');
const S = require('../../engine-dist/engine/secrets.js');

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'qav-store-'));
const dbIn = (dir) => path.join(dir, 'qa-vision.db');
const KEY = Buffer.alloc(32, 7).toString('base64');

test('profiles CRUD round trip', () => {
  const store = openStore(dbIn(tmp()));
  assert.deepEqual(store.listProfiles(), []);
  store.saveProfile({ id: 'p1', name: 'One', urlA: 'http://a' });
  store.saveProfile({ id: 'p1', name: 'One v2', urlA: 'http://a' });
  store.saveProfile({ id: 'p2', name: 'Two' });
  assert.equal(store.getProfile('p1').name, 'One v2');
  assert.deepEqual(store.listProfiles().map((p) => p.id), ['p1', 'p2']);
  assert.equal(store.deleteProfile('p1'), true);
  assert.equal(store.deleteProfile('p1'), false);
  assert.equal(store.getProfile('p1'), undefined);
});

test('openStore caches one instance per path', () => {
  const f = dbIn(tmp());
  assert.equal(openStore(f), openStore(f));
});

const snap = (over = {}) => ({
  id: 'run1', projectName: 'Proj', devUrl: 'http://d', prodUrl: 'http://p',
  startedAt: '2026-01-01T00:00:00.000Z', endedAt: '2026-01-01T00:05:00.000Z',
  logs: [{ id: 'l1', action: 'a' }, { id: 'l2', action: 'b' }, { id: 'l3', action: 'c' }],
  mismatches: [
    { id: 'm1', fingerprint: 'f1', severity: 'High', type: 'Text', classification: 'POTENTIAL_DEFECT' },
    { id: 'm2', fingerprint: 'f2', severity: 'Low', type: 'Style', classification: 'EXPECTED_DIFFERENCE' },
    { id: 'm3', fingerprint: 'f3', severity: 'High', type: 'Text', classification: 'POTENTIAL_DEFECT' },
  ],
  ...over,
});

test('saveRun then getRun returns logs and findings in order', () => {
  const store = openStore(dbIn(tmp()));
  store.saveRun({ ...snap(), profileId: 'p1' });
  const run = store.getRun('run1');
  assert.deepEqual(run.logs.map((l) => l.id), ['l1', 'l2', 'l3']);
  assert.deepEqual(run.mismatches.map((m) => m.id), ['m1', 'm2', 'm3']);
  assert.equal(run.profileId, 'p1');
  assert.equal(run.projectName, 'Proj');
  assert.equal(store.getRun('nope'), null);
  store.saveRun(snap({ mismatches: [] })); // re-archive replaces
  assert.equal(store.getRun('run1').mismatches.length, 0);
});

test('listRuns counts by severity and type', () => {
  const store = openStore(dbIn(tmp()));
  store.saveRun(snap());
  store.saveRun(snap({ id: 'run2', startedAt: '2026-02-01T00:00:00.000Z', mismatches: [] }));
  const runs = store.listRuns();
  assert.deepEqual(runs.map((r) => r.id), ['run2', 'run1']);
  assert.deepEqual(runs[1].counts, { total: 3, bySeverity: { High: 2, Low: 1 }, byType: { Text: 2, Style: 1 }, expected: 1 });
  assert.equal(store.listRuns(1).length, 1);
});

test('expectations add/list/remove', () => {
  const store = openStore(dbIn(tmp()));
  store.addExpectation('p1', 'fp1', 'known');
  store.addExpectation('p1', 'fp2', 'also');
  store.addExpectation('p2', 'fp1', 'other profile');
  assert.deepEqual(store.listExpectations('p1').map((e) => [e.fingerprint, e.note]), [['fp1', 'known'], ['fp2', 'also']]);
  store.removeExpectation('p1', 'fp1');
  assert.deepEqual(store.listExpectations('p1').map((e) => e.fingerprint), ['fp2']);
  assert.equal(store.listExpectations('p2').length, 1);
});

test('secrets put/get/delete', () => {
  const store = openStore(dbIn(tmp()));
  store.putSecret('r', 'blob');
  assert.equal(store.getSecret('r'), 'blob');
  store.deleteSecret('r');
  assert.equal(store.getSecret('r'), null);
});

test('migration encrypts plaintext passwords and removes them from profile json', () => {
  const dir = tmp();
  process.env.QA_VISION_SECRET_KEY = KEY;
  try {
    fs.writeFileSync(path.join(dir, 'profiles.json'), JSON.stringify([
      { id: 'legacy', name: 'L', urlA: 'http://a', urlB: 'http://b', credentialsA: { username: 'u', password: 'plain-pw' } },
      { id: 'clean', name: 'C' },
    ]));
    const store = openStore(dbIn(dir));
    const p = store.getProfile('legacy');
    assert.equal(p.credentialsA.username, 'u');
    assert.equal(p.credentialsA.password, undefined);
    assert.equal(p.credentialsA.secretRef, 'profile:legacy:A');
    assert.ok(!JSON.stringify(store.listProfiles()).includes('plain-pw'));
    assert.equal(S.decryptSecret(store.getSecret('profile:legacy:A'), Buffer.from(KEY, 'base64')), 'plain-pw');
    assert.ok(store.getProfile('clean'));
    assert.ok(!fs.existsSync(path.join(dir, 'profiles.json')));
    assert.ok(fs.existsSync(path.join(dir, 'profiles.json.migrated')));
  } finally {
    delete process.env.QA_VISION_SECRET_KEY;
  }
});

test('migration with a bad key degrades: password dropped, import completes', () => {
  const dir = tmp();
  process.env.QA_VISION_SECRET_KEY = 'AAAA';
  const origErr = console.error;
  console.error = () => {};
  try {
    fs.writeFileSync(path.join(dir, 'profiles.json'), JSON.stringify([
      { id: 'legacy', credentialsA: { username: 'u', password: 'plain-pw' } },
    ]));
    const store = openStore(dbIn(dir));
    assert.ok(!JSON.stringify(store.listProfiles()).includes('plain-pw'));
    assert.equal(store.getProfile('legacy').credentialsA.username, 'u');
    assert.ok(fs.existsSync(path.join(dir, 'profiles.json.migrated')));
  } finally {
    console.error = origErr;
    delete process.env.QA_VISION_SECRET_KEY;
  }
});

test('migration imports secrets.json blobs and renames the file', () => {
  const dir = tmp();
  fs.writeFileSync(path.join(dir, 'secrets.json'), JSON.stringify({ 'profile:x:A': 'v1:blob' }));
  const store = openStore(dbIn(dir));
  assert.equal(store.getSecret('profile:x:A'), 'v1:blob');
  assert.ok(!fs.existsSync(path.join(dir, 'secrets.json')));
  assert.ok(fs.existsSync(path.join(dir, 'secrets.json.migrated')));
});

test('migration skips a malformed profile entry, imports the rest and still renames', () => {
  const dir = tmp();
  const origErr = console.error;
  console.error = () => {};
  try {
    fs.writeFileSync(path.join(dir, 'profiles.json'), JSON.stringify([
      { id: 'bad', credentialsA: 'oops' },
      { id: 'good', name: 'G' },
      null,
    ]));
    const store = openStore(dbIn(dir));
    assert.ok(store.getProfile('good'));
    assert.ok(!fs.existsSync(path.join(dir, 'profiles.json')));
    assert.ok(fs.existsSync(path.join(dir, 'profiles.json.migrated')));
  } finally {
    console.error = origErr;
  }
});

test('corrupt secrets.json is skipped without crashing and renamed', () => {
  const dir = tmp();
  const origErr = console.error;
  console.error = () => {};
  try {
    fs.writeFileSync(path.join(dir, 'secrets.json'), '{not json');
    const store = openStore(dbIn(dir));
    assert.equal(store.getSecret('anything'), null);
    assert.ok(fs.existsSync(path.join(dir, 'secrets.json.migrated')));
  } finally {
    console.error = origErr;
  }
});
