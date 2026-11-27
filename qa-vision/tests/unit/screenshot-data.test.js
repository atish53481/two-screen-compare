/**
 * Data-first comparison logic (lib/engine/screenshot-data.ts) on synthetic OCR words: normalization, row matching
 * by content, missing records, uncertainty, ignore rules. Fast and deterministic (no OCR, no images).
 * Run after `npm run build:engine`.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { diffData, parseNumber, parseValue, valuesEqual, buildRows } = require('../../engine-dist/engine/screenshot-data.js');

const OPTS = { matching: 'normalized', caseSensitive: false, numericTolerance: 0, minConfidence: 60, ignoreFields: [] };

/** One visual line: cells [x, text, conf?]; words get ~8px per char, 12px height. Scale multiplies geometry. */
function line(y, cells, scale = 1) {
  const words = [];
  for (const [x0, text, conf = 95] of cells) {
    let x = x0;
    for (const w of text.split(' ')) {
      words.push({ text: w, conf, bbox: { x: x * scale, y: y * scale, width: w.length * 8 * scale, height: 12 * scale } });
      x += w.length * 8 + 4;
    }
  }
  return { words };
}

const TABLE = [
  ['INV-101', 'Acme Corp', 'Approved', '$4,200.00'],
  ['INV-102', 'Globex', 'Approved', '$1,150.50'],
  ['INV-103', 'Initech', 'Pending', '$980.00'],
];
function screen({ users = '1,248', rows = TABLE, conf = 95, scale = 1, extra = [] } = {}) {
  const lines = [
    line(20, [[20, 'Active Users'], [300, 'Revenue']], scale),
    line(40, [[20, users, conf], [300, '$12,500.00', conf]], scale),
    line(100, [[20, 'Invoice'], [140, 'Customer'], [300, 'Status'], [440, 'Amount']], scale),
    ...rows.map((r, i) => line(130 + i * 30, [[20, r[0], conf], [140, r[1], conf], [300, r[2], conf], [440, r[3], conf]], scale)),
    ...extra.map((e) => line(e[0], e[1], scale)),
  ];
  return { lines, width: 800 * scale, height: 400 * scale };
}
const run = (dev, prod, opts = {}, extra = {}) => diffData({ dev, prod, opts: { ...OPTS, ...opts }, ...extra });

// ---------------------------------------------------------------- normalization

test('numbers: thousands/decimal separators, negatives, parentheses', () => {
  assert.equal(parseNumber('1,250'), 1250);
  assert.equal(parseNumber('1.250,50'), 1250.5);
  assert.equal(parseNumber('(1,250)'), -1250);
  assert.equal(parseNumber('-12.5'), -12.5);
  assert.equal(parseNumber('abc'), null);
});

test('value types: currency, percent, date, identifier, number', () => {
  assert.deepEqual(parseValue('$1,250.00'), { type: 'currency', num: 1250, unit: 'USD' });
  assert.equal(parseValue('₹12,500.00').unit, 'INR');
  assert.equal(parseValue('12.5%').type, 'percent');
  assert.equal(parseValue('Nov 3, 2026').iso, '2026-11-03');
  assert.equal(parseValue('2026-11-03').iso, '2026-11-03');
  assert.equal(parseValue('INV-101').type, 'identifier');
  assert.equal(parseValue('1,248').type, 'number');
  assert.equal(parseValue('Approved').type, 'text');
});

test('normalized vs strict matching, tolerance, currency codes, case', () => {
  assert.ok(valuesEqual('1,250', '1250', OPTS));
  assert.ok(valuesEqual('$1,250.00', '$1250', OPTS));
  assert.ok(valuesEqual('$1,250.00', 'USD 1,250.00', OPTS));
  assert.ok(!valuesEqual('$1,250', '€1,250', OPTS), 'different currency');
  assert.ok(!valuesEqual('12', '12%', OPTS), 'percent vs number');
  assert.ok(valuesEqual('Nov 3, 2026', '2026-11-03', OPTS));
  assert.ok(valuesEqual('APPROVED', 'approved', OPTS));
  assert.ok(!valuesEqual('APPROVED', 'approved', { ...OPTS, caseSensitive: true }));
  assert.ok(!valuesEqual('1,250', '1250', { ...OPTS, matching: 'strict' }));
  assert.ok(!valuesEqual('100', '100.4', OPTS));
  assert.ok(valuesEqual('100', '100.4', { ...OPTS, numericTolerance: 0.5 }));
  assert.ok(!valuesEqual('1,248', '1,250', OPTS));
});

test('rows: cells split at wide gaps, "Label: value" split, header becomes the field', () => {
  const rows = buildRows([line(10, [[20, 'Status: Approved'], [300, 'Total: $40']]), ...screen().lines]);
  assert.equal(rows[0].segs[0].label, 'Status');
  assert.equal(rows[0].segs[0].value, 'Approved');
  const valueRow = rows.find((r) => r.segs.some((s) => s.text === '1,248'));
  assert.equal(valueRow.segs.find((s) => s.text === '1,248').field, 'Active Users');
  const inv = rows.find((r) => r.key === 'INV-102');
  assert.equal(inv.segs.find((s) => s.text === 'Approved').field, 'Status');
});

// ---------------------------------------------------------------- diff

test('identical screens: no items, everything matched', () => {
  const r = run(screen(), screen());
  assert.equal(r.items.length, 0);
  assert.ok(r.matched >= 20);
});

test('changed number: one mismatch with exact visible values and the field name', () => {
  const r = run(screen({ users: '1,250' }), screen());
  assert.equal(r.items.length, 1);
  const it = r.items[0];
  assert.equal(it.kind, 'mismatch');
  assert.equal(it.valueType, 'number');
  assert.equal(it.devValue, '1,250');
  assert.equal(it.prodValue, '1,248');
  assert.equal(it.field, 'Active Users');
  assert.ok(it.devBox && it.prodBox);
});

test('changed status and identifier inside table rows', () => {
  const rows = TABLE.map((r) => (r[0] === 'INV-102' ? [r[0], r[1], 'Pending', r[3]] : r[0] === 'INV-103' ? ['INV-109', r[1], r[2], r[3]] : r));
  const r = run(screen({ rows }), screen());
  const status = r.items.find((i) => i.valueType === 'status');
  assert.ok(status, JSON.stringify(r.items));
  assert.equal(status.devValue, 'Pending');
  assert.equal(status.prodValue, 'Approved');
  assert.equal(status.field, 'Status');
  assert.match(status.section, /INV-102/);
  const id = r.items.find((i) => i.valueType === 'identifier');
  assert.equal(id.devValue, 'INV-109');
  assert.equal(id.prodValue, 'INV-103');
  assert.equal(r.items.length, 2);
});

test('different table sort order: rows matched by content, no mismatches', () => {
  const r = run(screen({ rows: [...TABLE].reverse() }), screen());
  assert.equal(r.items.length, 0, JSON.stringify(r.items));
});

test('missing record: one record-level "missing in DEV" with the row key', () => {
  const r = run(screen({ rows: TABLE.filter((x) => x[0] !== 'INV-102') }), screen());
  assert.equal(r.items.length, 1, JSON.stringify(r.items));
  assert.equal(r.items[0].kind, 'missing-in-dev');
  assert.equal(r.items[0].record, true);
  assert.equal(r.items[0].field, 'INV-102');
  assert.equal(r.items[0].devBox, null);
});

test('extra record in DEV', () => {
  const r = run(screen({ rows: [...TABLE, ['INV-200', 'Hooli', 'Approved', '$10.00']] }), screen());
  assert.equal(r.items.length, 1);
  assert.equal(r.items[0].kind, 'extra-in-dev');
});

test('low OCR confidence: uncertain, not a mismatch', () => {
  const r = run(screen({ users: '1,250' }), screen(), {}, {});
  assert.equal(r.items[0].kind, 'mismatch');
  const low = screen({ users: '1,250' });
  low.lines[1].words[0].conf = 40;
  const u = run(low, screen());
  assert.equal(u.items[0].kind, 'uncertain');
  assert.match(u.items[0].explanation, /Low OCR confidence/);
});

test('unreadable side: "missing" is not claimed, it is uncertain', () => {
  const blurry = screen();
  blurry.lines = blurry.lines.slice(0, 3); // most text not read at all...
  blurry.lines.forEach((l) => l.words.forEach((w) => { w.conf = 35; })); // ...and the rest barely
  const r = run(blurry, screen());
  assert.ok(r.quality.devUnreadable);
  assert.ok(r.items.length > 0);
  assert.ok(r.items.every((i) => i.kind === 'uncertain'), JSON.stringify(r.items.map((i) => i.kind)));
});

test('number read as letters on one side: uncertain (probably unreadable), not a mismatch', () => {
  const r = run(screen({ users: 'te' }), screen());
  assert.equal(r.items.length, 1);
  assert.equal(r.items[0].kind, 'uncertain');
});

test('ignored fields: excluded and logged with the excluded text', () => {
  const extra = [[300, [[20, 'Last updated: 10:42 AM']]]];
  const extraDev = [[300, [[20, 'Last updated: 11:05 AM']]]];
  const before = run(screen({ extra: extraDev }), screen({ extra }));
  assert.equal(before.items.length, 1);
  const r = run(screen({ extra: extraDev }), screen({ extra }), { ignoreFields: ['Last updated'] });
  assert.equal(r.items.length, 0);
  assert.equal(r.ignoredFields[0].rule, 'Last updated');
  assert.deepEqual(r.ignoredFields[0].devItems, ['Last updated: 11:05 AM']);
  assert.deepEqual(r.ignoredFields[0].prodItems, ['Last updated: 10:42 AM']);
});

test('ignored field as /regex/', () => {
  const r = run(screen({ users: '1,250' }), screen(), { ignoreFields: ['/^Active/'] });
  assert.equal(r.items.length, 0);
});

test('ignore region: words inside are dropped and counted', () => {
  const region = { x: 0, y: 35, width: 200, height: 25 };
  const r = run(screen({ users: '1,250' }), screen(), {}, { ignoreDev: [region], ignoreProd: [region] });
  assert.equal(r.items.length, 0);
  assert.equal(r.ignoredByRegion[0], 2);
});

test('different resolution (2x DEV): matched by content, no items', () => {
  const r = run(screen({ scale: 2 }), screen());
  assert.equal(r.items.length, 0, JSON.stringify(r.items));
});

test('differing readings over unchanged pixels are OCR noise, not findings', () => {
  const dev = screen();
  dev.lines[1].words[0].text = '1,24B';
  const r = run(dev, screen(), {}, { pixelUnchanged: () => true });
  assert.equal(r.items.length, 0);
  assert.equal(r.noiseSuppressed, 1);
});
