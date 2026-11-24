const test = require('node:test');
const assert = require('node:assert/strict');
const { assertReadOnlySql, runApiCheck, runDbCheck } = require('../../engine-dist/engine/data-sources.js');

const ctx = (data) => ({ get: async () => ({ ok: () => true, status: () => 200, json: async () => data }) });

test('assertReadOnlySql accepts SELECT/WITH incl. mixed case and trailing semicolon', () => {
  for (const s of ['select 1', 'SELECT * from t;', 'SeLeCt a from t', 'with x as (select 1) select * from x', "select 'set; drop' as s", 'select 1 /* ; drop */', 'select 1 -- drop table x']) {
    assert.doesNotThrow(() => assertReadOnlySql(s), s);
  }
});

test('assertReadOnlySql rejects writes and tricks', () => {
  for (const s of [
    'select 1; drop table x', 'update t set a=1', 'UpDaTe t set a=1', 'with x as (delete from t returning *) select * from x',
    'select * into t2 from t', "select '--'; drop table x", 'select $$;$$; drop table x', "select E'\\'; drop table x'",
    'select pg_sleep(10)', 'select 1 /* x */; select 2', '', 'explain select 1',
  ]) {
    assert.throws(() => assertReadOnlySql(s), undefined, s);
  }
});

test('runApiCheck compares fields', async () => {
  const f = await runApiCheck({ name: 'stats', path: '/api/s', fields: ['data.total', 'data.gone'] }, ctx({ data: { total: 5 } }), ctx({ data: { total: 6 } }), 'http://d', 'http://p');
  const total = f.find((x) => x.component === 'api:stats.data.total');
  assert.equal(total.type, 'Data');
  assert.equal(total.devValue, '5');
  assert.equal(total.prodValue, '6');
  const gone = f.find((x) => x.component === 'api:stats.data.gone');
  assert.equal(gone.severity, 'high');
});

test('runApiCheck refuses non-GET', async () => {
  const resp = { ok: () => true, status: () => 200, json: async () => ({ a: 1 }) };
  const strict = new Proxy({}, { get: (_, p) => { if (p === 'get') return async () => resp; throw new Error('non-GET used: ' + String(p)); } });
  assert.deepEqual(await runApiCheck({ name: 'n', path: '/p', fields: ['a'] }, strict, strict, 'http://d', 'http://p'), []);
  const post = { get: async () => resp, post: async () => { throw new Error('POST called'); } };
  await runApiCheck({ name: 'n', path: '/p', fields: ['a'] }, post, post, 'http://d', 'http://p');
});

test('runDbCheck integration', { skip: process.env.QA_TEST_PG_URL ? false : 'QA_TEST_PG_URL not set' }, async () => {
  const url = process.env.QA_TEST_PG_URL;
  const f = await runDbCheck({ name: 'one', devConnRef: 'd', prodConnRef: 'p', sql: 'select 1 as a' }, () => url);
  assert.deepEqual(f, []);
});
