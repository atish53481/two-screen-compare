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

test('assertReadOnlySql rejects digit-tag dollar-quote bypass and transaction control', () => {
  const bad = [
    "select $a1$'$a1$; commit; drop table x; select $a1$'$a1$",
    'select 1 where true commit', 'rollback', 'select 1 where exists (select 1) abort', 'savepoint x', 'select 1 release',
    'prepare p as select 1', 'deallocate p', 'listen c', 'notify c', 'discard all', 'reset all', 'load \'x\'', 'checkpoint',
    'select "set_config"(1)', 'select "dblink_exec" (1)', 'select U&"\0070g_sleep"(1)', "select U&'x'",
    'select pg_try_advisory_lock(1)', 'select pg_advisory_lock_shared(1)', 'select pg_advisory_xact_lock(1)', 'select pg_reload_conf()',
    'select pg_rotate_logfile()', 'select query_to_xml(1)', 'select lo_unlink(1)', 'select dblink(1)', 'select pg_terminate_backend(1)', 'select pg_cancel_backend(1)',
  ];
  for (const s of bad) assert.throws(() => assertReadOnlySql(s), undefined, s);
  assert.doesNotThrow(() => assertReadOnlySql('select "col" from "my table" where a = $1'));
});

function fakeClient(log, opts = {}) {
  return class {
    async connect() { log.push('connect'); if (opts.failConnect) throw new Error('postgres://u:pw@h/db refused'); }
    async query(q) { log.push(typeof q === 'string' ? q : q.text); return { rows: [{ a: 1 }] }; }
    async end() { log.push('end'); }
  };
}
const secret = () => 'postgres://u:pw@h/db';

test('runDbCheck sequence and wrapper with fake client', async () => {
  for (const [sql, inner] of [
    ['select 1 -- x', 'select 1'],
    ['select 1; /* c */', 'select 1'],
    ['select * from t limit 5;', 'select * from t limit 5'],
  ]) {
    const log = [];
    const f = await runDbCheck({ name: 'n', devConnRef: 'd', prodConnRef: 'p', sql }, secret, fakeClient(log));
    assert.deepEqual(f, []);
    const text = `select * from (\n${inner}\n) q limit 500`;
    const devLog = log.filter((l) => l !== 'connect');
    assert.ok(devLog.includes(text), JSON.stringify(devLog));
    // per-connection order (two connections interleave; check relative order of each step)
    const idx = (s) => devLog.indexOf(s);
    assert.ok(idx('BEGIN READ ONLY') < idx('SET LOCAL statement_timeout = 5000'));
    assert.ok(idx('SET LOCAL statement_timeout = 5000') < idx(text));
    assert.ok(idx(text) < idx('ROLLBACK'));
    assert.equal(log.filter((l) => l === 'end').length, 2);
  }
});

test('runDbCheck sequence is exact for a single connection', async () => {
  const log = [];
  const C = fakeClient(log);
  const sameRun = await runDbCheck({ name: 'n', devConnRef: 'd', prodConnRef: 'p', sql: 'select 1' }, secret, C);
  assert.deepEqual(sameRun, []);
  assert.deepEqual(log.slice(0, 2), ['connect', 'connect']);
});

test('runDbCheck calls end() and leaks no secret when connect fails', async () => {
  const log = [];
  const f = await runDbCheck({ name: 'n', devConnRef: 'd', prodConnRef: 'p', sql: 'select 1' }, secret, fakeClient(log, { failConnect: true }));
  assert.equal(log.filter((l) => l === 'end').length, 2);
  assert.equal(f.length, 1);
  assert.doesNotMatch(JSON.stringify(f), /pw@|postgres:\/\//);
});

test('runDbCheck rejects the bypass string before connecting', async () => {
  const log = [];
  const f = await runDbCheck({ name: 'n', devConnRef: 'd', prodConnRef: 'p', sql: "select $a1$'$a1$; commit; drop table x; select $a1$'$a1$" }, secret, fakeClient(log));
  assert.equal(f[0].severity, 'high');
  assert.deepEqual(log, []);
});
