const test = require('node:test');
const assert = require('node:assert/strict');
const { toNetworkPath, schemaOf, diffNetwork, diffRuntime, toNetworkEntry, toRuntimeText, pushCapped } = require('../../engine-dist/engine/runtime-diff.js');

const entry = (o) => ({ method: 'GET', path: '/api/u', status: 200, resourceType: 'fetch', contentType: 'application/json', schema: ['a'], failure: null, ...o });

test('toNetworkPath strips origin, hash and reduces query to sorted keys', () => {
  assert.equal(toNetworkPath('https://x.com/api/u?id=5&token=abc#h'), '/api/u?id&token');
  assert.equal(toNetworkPath('https://x.com/api/u?z=1&b=2'), '/api/u?b&z');
  assert.equal(toNetworkPath('https://x.com/plain'), '/plain');
});

test('schemaOf lists sorted key paths to depth 2', () => {
  assert.deepEqual(schemaOf({ a: 1, b: { c: 2, d: [{ e: 1 }] } }), ['a', 'b', 'b.c', 'b.d']);
});

test('status 200 vs 500 is high; 200 vs 301 is medium', () => {
  const f = diffNetwork([entry({})], [entry({ status: 500 })]);
  assert.equal(f.length, 1);
  assert.equal(f[0].type, 'Network');
  assert.equal(f[0].severity, 'high');
  assert.equal(diffNetwork([entry({})], [entry({ status: 304 })])[0].severity, 'medium');
});

test('schema key missing is medium', () => {
  const f = diffNetwork([entry({ schema: ['a', 'b'] })], [entry({ schema: ['a'] })]);
  assert.equal(f.length, 1);
  assert.equal(f[0].severity, 'medium');
});

test('request only on one side is medium; static resources ignored', () => {
  const f = diffNetwork([entry({}), entry({ path: '/x.png', resourceType: 'image' })], []);
  assert.equal(f.length, 1);
  assert.equal(f[0].severity, 'medium');
});

test('blocked PROD request ignored', () => {
  const blocked = entry({ method: 'POST', status: null, failure: 'net::ERR_BLOCKED_BY_CLIENT' });
  assert.deepEqual(diffNetwork([entry({ method: 'POST' })], [blocked]), []);
});

test('console error only on PROD reported; same error both sides not reported', () => {
  const same = { kind: 'console-error', text: 'Failed 404 for item 12' };
  assert.deepEqual(diffRuntime([same], [{ kind: 'console-error', text: 'Failed 404 for item 99' }]), []);
  const f = diffRuntime([], [{ kind: 'page-error', text: 'boom' }, { kind: 'console-error', text: 'oops' }]);
  assert.equal(f.length, 2);
  assert.equal(f[0].type, 'Console');
  assert.equal(f[0].severity, 'high');
  assert.equal(f[1].severity, 'medium');
});

test('network capture never stores bodies or query values', () => {
  const e = toNetworkEntry({ method: 'GET', url: 'https://x.com/api/login?password=hunter2', status: 200, resourceType: 'fetch', contentType: 'application/json', json: { user: 'bob', secret: 'hunter2' } });
  assert.ok(!JSON.stringify(e).includes('hunter2'));
  assert.deepEqual(e.schema, ['secret', 'user']);
  assert.equal(e.path, '/api/login?password');
});

test('runtime text strips URL queries, redacts sensitive values and truncates', () => {
  const t = toRuntimeText('GET https://x.com/a?token=hunter2 failed password=hunter2');
  assert.ok(!t.includes('hunter2'));
  assert.equal(toRuntimeText('x'.repeat(500)).length, 300);
});

test('pushCapped drops oldest beyond 500', () => {
  const a = [];
  for (let i = 0; i < 505; i++) pushCapped(a, i);
  assert.equal(a.length, 500);
  assert.equal(a[0], 5);
});

test('runtime text redacts JSON-quoted, bearer and header secrets', () => {
  for (const [input, secret] of [
    ['payload {"password":"hunter2"} bad', 'hunter2'],
    ['got "token":"abc123" here', 'abc123'],
    ['Authorization: Bearer xyz789', 'xyz789'],
    ['hdr Basic dXNlcjpwdw== sent', 'dXNlcjpwdw'],
    ['Cookie: sid=s3cr3tcookie', 's3cr3tcookie'],
    ['x-api-key=k1k2k3', 'k1k2k3'],
    ['{"session":"sess-777"}', 'sess-777'],
  ]) assert.ok(!toRuntimeText(input).includes(secret), input + ' -> ' + toRuntimeText(input));
});
