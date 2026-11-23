const test = require('node:test');
const assert = require('node:assert/strict');
const { parseNumber, compareValues, diffData } = require('../../engine-dist/engine/data-rules.js');

const rule = (mode, extra = {}) => ({ target: 't', mode, ...extra });
const el = (key, text) => ({ key, selector: `#${key}`, name: key, text });

test('parseNumber handles currency, suffixes, parens, percent', () => {
  assert.equal(parseNumber('$1,250.50'), 1250.5);
  assert.equal(parseNumber('1.2M'), 1200000);
  assert.equal(parseNumber('3k'), 3000);
  assert.equal(parseNumber('(42)'), -42);
  assert.equal(parseNumber('12%'), 12);
  assert.equal(parseNumber('abc'), null);
  assert.equal(parseNumber(''), null);
});

test('exact and numeric modes', () => {
  assert.equal(compareValues('a', 'a', rule('exact')).match, true);
  assert.equal(compareValues('a', 'b', rule('exact')).match, false);
  assert.equal(compareValues('$1,000', '1000', rule('numeric')).match, true);
  assert.equal(compareValues('x', '1', rule('numeric')).match, false);
});

test('tolerance', () => {
  assert.equal(compareValues('1250', '1248', rule('tolerance', { tolerance: 5 })).match, true);
  const r = compareValues('1250', '1248', rule('tolerance', { tolerance: 1 }));
  assert.equal(r.match, false);
  assert.equal(r.detail, 'Δ 2 > 1');
});

test('percent', () => {
  assert.equal(compareValues('100', '103', rule('percent', { tolerance: 5 })).match, true);
  assert.equal(compareValues('100', '110', rule('percent', { tolerance: 5 })).match, false);
});

test('case-insensitive', () => {
  assert.equal(compareValues('Active', 'ACTIVE', rule('case-insensitive')).match, true);
  assert.equal(compareValues('Active', 'Inactive', rule('case-insensitive')).match, false);
});

test('null-equals-empty', () => {
  const r = rule('null-equals-empty');
  assert.equal(compareValues('', 'null', r).match, true);
  assert.equal(compareValues('—', '', r).match, true);
  assert.equal(compareValues('x', '', r).match, false);
});

test('date compares by calendar day', () => {
  assert.equal(compareValues('2026-11-23', 'Nov 23, 2026', rule('date')).match, true);
  assert.equal(compareValues('2026-11-23', 'Nov 24, 2026', rule('date')).match, false);
});

test('expect different inverts', () => {
  assert.equal(compareValues('a', 'b', rule('exact', { expect: 'different' })).match, true);
  assert.equal(compareValues('a', 'a', rule('exact', { expect: 'different' })).match, false);
});

test('element rule produces Data finding; unruled and ignore produce nothing', () => {
  const pairs = [[el('tid:a', '10'), el('tid:a', '99')], [el('tid:b', 'x'), el('tid:b', 'y')]];
  const out = diffData(pairs, [], [], [{ target: 'tid:a', mode: 'exact' }]);
  assert.equal(out.length, 1);
  assert.equal(out[0].type, 'Data');
  assert.equal(out[0].ruleApplied, 'tid:a/exact');
  assert.equal(out[0].component, 'tid:a');
  assert.deepEqual(diffData(pairs, [], [], [{ target: 'tid:a', mode: 'ignore' }]), []);
});

const tbl = (key, headers, rows) => ({ key, selector: `#${key}`, headers, rows, rowCount: rows.length });

test('table row count difference is high', () => {
  const d = tbl('tid:orders', ['Id', 'Total'], [['1', '5'], ['2', '6']]);
  const p = tbl('tid:orders', ['Id', 'Total'], [['1', '5']]);
  const out = diffData([], [d], [p], [{ target: 'table:tid:orders:*', mode: 'exact' }]);
  const high = out.filter((f) => f.severity === 'high');
  assert.equal(high.length, 1);
  assert.equal(high[0].type, 'Data');
});

test('table cells use per-header rule, locate column by header, cap at 20', () => {
  const d = tbl('tid:t', ['Id', 'Total'], [['1', '100'], ['2', '200']]);
  const p = tbl('tid:t', ['Total', 'Id'], [['101', '1'], ['999', '2']]);
  const rules = [
    { target: 'table:tid:t:Total', mode: 'tolerance', tolerance: 5 },
    { target: 'table:tid:t:Id', mode: 'ignore' },
  ];
  const out = diffData([], [d], [p], rules);
  assert.equal(out.length, 1);
  assert.equal(out[0].ruleApplied, 'table:tid:t:Total/tolerance');
  const many = Array.from({ length: 30 }, (_, i) => [String(i)]);
  const manyP = many.map(([v]) => [v + 'x']);
  const capped = diffData([], [tbl('k', ['A'], many)], [tbl('k', ['A'], manyP)], [{ target: 'table:k:*', mode: 'exact' }]);
  assert.equal(capped.length, 20);
});
