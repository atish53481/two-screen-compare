/**
 * Two Screen Comparison, data-first acceptance cases with REAL text: browser-rendered screenshots in
 * public/test-screenshots/data/ (regenerate with `node scripts/make-data-screenshots.js`) through the full engine
 * with local OCR. Run after `npm run build:engine`.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { compareScreenshots } = require('../../engine-dist/engine/screenshot-compare.js');
const { ocrStatus, shutdownOcr } = require('../../engine-dist/engine/screenshot-ocr.js');

const DIR = path.join(__dirname, '..', '..', 'public', 'test-screenshots', 'data');
const img = (n) => fs.readFileSync(path.join(DIR, n));
const PROD = img('prod.png');
const ALL = ['data_text', 'images_diagrams', 'css_styling', 'alignment_layout', 'form_states'];
const real = (r) => r.findings.filter((f) => f.number > 0);
const confirmed = (r, scope = 'data_text') => real(r).filter((f) => f.scope === scope && f.status !== 'uncertain');
const cmp = (dev, opts = {}) => compareScreenshots(img(dev), PROD, { includeEvidence: false, ...opts });

const skip = !ocrStatus().available && 'OCR model not installed';
test.after(() => shutdownOcr());

test('matching screenshots: no material differences, text matched', { skip }, async () => {
  const r = await cmp('dev-identical.png');
  assert.equal(r.status, 'no-differences');
  assert.ok(r.ocr.used);
  assert.ok(r.summary.matchedItems >= 30, `matched ${r.summary.matchedItems}`);
  assert.equal(r.summary.byScope.data_text.checked, true);
  assert.equal(r.summary.byScope.css_styling.checked, false);
});

test('mismatched data: wrong number, amount, status, identifier and date with exact DEV/PROD values', { skip }, async () => {
  const r = await cmp('dev-data-changed.png');
  const got = confirmed(r).map((f) => `${f.devValue}|${f.prodValue}`).sort();
  assert.deepEqual(got, ['$1,250.00|$12,500.00', '1,250|1,248', '2026-11-22|2026-11-21', 'INV-106|INV-104', 'Pending|Approved'].sort(), JSON.stringify(real(r).map((f) => f.title)));
  const users = confirmed(r).find((f) => f.devValue === '1,250');
  assert.equal(users.field, 'Active Users');
  assert.equal(users.valueType, 'number');
  assert.equal(users.status, 'mismatch');
  assert.equal(users.code, 'DATA-001');
  assert.equal(users.expectedBaseline, 'PROD screenshot');
  // the boxes sit on the value in both screenshots (card at left, below the header)
  for (const b of [users.devBbox, users.prodBbox]) {
    assert.ok(b.x >= 30 && b.x <= 70 && b.y >= 90 && b.y <= 135 && b.width < 120, JSON.stringify(b));
    assert.equal(b.coordinateSystem, 'source-pixels-top-left');
  }
  const amount = confirmed(r).find((f) => f.valueType === 'currency');
  assert.equal(amount.severitySuggestion, 'high');
  const status = confirmed(r).find((f) => f.valueType === 'status');
  assert.match(status.pageSection, /INV-102/);
});

test('one wrong value is one finding: no duplicate pixel/CSS findings for the same values with every check on', { skip }, async () => {
  const r = await cmp('dev-data-changed.png', { scope: ALL });
  assert.equal(confirmed(r).length, 5);
  const others = real(r).filter((f) => f.scope !== 'data_text');
  for (const d of confirmed(r))
    for (const o of others) {
      const b = o.devBbox, v = d.devBbox;
      const overlap = b && v && Math.max(0, Math.min(b.x + b.width, v.x + v.width) - Math.max(b.x, v.x)) * Math.max(0, Math.min(b.y + b.height, v.y + v.height) - Math.max(b.y, v.y));
      assert.ok(!overlap || overlap < 0.5 * b.width * b.height, `${o.code} duplicates ${d.code}`);
    }
});

test('missing record: reported once as missing in DEV with its key', { skip }, async () => {
  const r = await cmp('dev-missing-row.png');
  const miss = confirmed(r);
  assert.equal(miss.length, 1, JSON.stringify(real(r).map((f) => f.title)));
  assert.equal(miss[0].status, 'missing-in-dev');
  assert.equal(miss[0].field, 'INV-103');
  assert.equal(miss[0].devBbox, null);
  assert.ok(miss[0].prodBbox);
});

test('different table sort order: no data mismatches', { skip }, async () => {
  const r = await cmp('dev-sorted.png');
  assert.equal(confirmed(r).length, 0, JSON.stringify(real(r).map((f) => f.title)));
});

test('same data, different colors and font: no data mismatch; styling only when CSS is selected', { skip }, async () => {
  const d = await cmp('dev-restyled.png');
  assert.equal(confirmed(d).length, 0, JSON.stringify(real(d).map((f) => `${f.title} ${f.devValue}/${f.prodValue}`)));
  assert.ok(real(d).every((f) => f.scope === 'data_text'), 'nothing outside the selected scope');
  const c = await cmp('dev-restyled.png', { scope: ['data_text', 'css_styling'] });
  assert.equal(confirmed(c).length, 0);
  assert.ok(real(c).some((f) => f.scope === 'css_styling'), 'CSS findings when selected');
});

test('different resolution (2x): compared by content without alignment, no data mismatches', { skip }, async () => {
  const r = await cmp('dev-2x.png');
  assert.notEqual(r.status, 'alignment-required');
  assert.equal(r.pixelAnalysis, false);
  assert.equal(confirmed(r).length, 0, JSON.stringify(real(r).map((f) => `${f.title} ${f.devValue}/${f.prodValue}`)));
  // a visual check needs pixels, so alignment becomes required
  const v = await cmp('dev-2x.png', { scope: ['data_text', 'css_styling'] });
  assert.equal(v.status, 'alignment-required');
});

test('low-quality screenshot: unreadable items flagged for review, no invented mismatches', { skip }, async () => {
  const r = await cmp('dev-lowquality.jpg');
  assert.equal(confirmed(r).length, 0, JSON.stringify(confirmed(r).map((f) => `${f.title} ${f.devValue}/${f.prodValue}`)));
  assert.ok(real(r).some((f) => f.status === 'uncertain'));
  assert.ok(r.warnings.some((w) => /unreadable/.test(w)));
});

test('intentionally ignored field and region: timestamp excluded and logged', { skip }, async () => {
  const before = await cmp('dev-clock.png');
  const ts = confirmed(before);
  assert.equal(ts.length, 1, JSON.stringify(real(before).map((f) => f.title)));
  assert.equal(ts[0].devValue, '11:05 AM');
  assert.equal(ts[0].prodValue, '10:42 AM');

  const byField = await cmp('dev-clock.png', { text: { ignoreFields: ['Last updated'] } });
  assert.equal(byField.status, 'no-differences');
  assert.equal(byField.ignoredFields[0].rule, 'Last updated');
  assert.ok(byField.ignoredFields[0].devItems.some((t) => /11:05/.test(t)));

  const region = { label: 'Clock', x: ts[0].devBbox.x - 4, y: ts[0].devBbox.y - 4, width: ts[0].devBbox.width + 8, height: ts[0].devBbox.height + 8 };
  const byRegion = await cmp('dev-clock.png', { ignoreRegions: [region] });
  assert.equal(confirmed(byRegion).length, 0);
  assert.ok(byRegion.ignoredLog[0].suppressedTextItems > 0);
  assert.ok(byRegion.findings.some((f) => f.ignoredByRule === 'Clock'));
});

test('missing chart: silent by default, detected when Images & Diagrams is selected', { skip }, async () => {
  const d = await cmp('dev-chart-missing.png');
  assert.equal(real(d).filter((f) => f.scope !== 'data_text').length, 0);
  const i = await cmp('dev-chart-missing.png', { scope: ['data_text', 'images_diagrams'] });
  const img = real(i).filter((f) => f.scope === 'images_diagrams');
  assert.equal(img.length, 1);
  assert.equal(img[0].status, 'missing-in-dev');
  assert.ok(img[0].prodBbox.y > 380 && img[0].prodBbox.width > 200, JSON.stringify(img[0].prodBbox));
});

test('form states: checkbox/button state only reported when Form Elements & States is selected', { skip }, async () => {
  const d = await cmp('dev-form-state.png');
  assert.equal(confirmed(d).length, 0, JSON.stringify(real(d).map((f) => `${f.title} ${f.devValue}/${f.prodValue}`)));
  const f = await cmp('dev-form-state.png', { scope: ['form_states', 'images_diagrams'] });
  assert.ok(real(f).length >= 1);
  assert.ok(real(f).every((x) => x.scope === 'form_states' || x.scope === 'images_diagrams'));
});
