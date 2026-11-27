/**
 * Two Screen Comparison engine (lib/engine/screenshot-compare.ts): pixel classification and scope selection, on
 * synthetic screens without real text (OCR off). Data/OCR cases with real text: screenshot-data-ocr.test.js.
 * Run after `npm run build:engine`.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { compareScreenshots, decodeScreenshot, ScreenshotInputError } = require('../../engine-dist/engine/screenshot-compare.js');
const { explainWithAi } = require('../../engine-dist/engine/screenshot-ai.js');
const { drawScreen } = require('../helpers/synthetic-screens');

// every pixel-based check selected, OCR off: these tests exercise the pixel classifier
const ALL = ['data_text', 'images_diagrams', 'css_styling', 'alignment_layout', 'form_states'];
const opts = { includeEvidence: false, scope: ALL, ocr: false };
const real = (r) => r.findings.filter((f) => f.number > 0);
const inside = (b, x, y) => b && x >= b.x && x <= b.x + b.width && y >= b.y && y <= b.y + b.height;

test('identical screenshots: no material differences, one match finding', async () => {
  const a = drawScreen();
  const r = await compareScreenshots(a, Buffer.from(a), opts);
  assert.equal(r.status, 'no-differences');
  assert.equal(real(r).length, 0);
  assert.equal(r.findings[0].title, 'No material differences within tolerance');
  assert.equal(r.summary.diffPercent, 0);
  assert.equal(r.summary.identicalZones, 16);
});

test('button color change: exactly one color finding, boxed on the button on both sides', async () => {
  const r = await compareScreenshots(drawScreen({ buttonColor: [16, 185, 129] }), drawScreen(), opts);
  const f = real(r);
  assert.equal(f.length, 1, JSON.stringify(f.map((x) => x.title)));
  assert.equal(f[0].category, 'color');
  assert.ok(inside(f[0].devBbox, 80, 128) && inside(f[0].prodBbox, 80, 128), 'box covers the button');
  assert.ok(f[0].devBbox.width <= 130 && f[0].devBbox.height <= 46, 'box is tight to the button');
  assert.equal(f[0].devBbox.coordinateSystem, 'source-pixels-top-left');
  assert.equal(f[0].devBbox.sourceWidth, 480);
  assert.match(String(f[0].metrics.devColor), /^#/);
});

test('disabled-looking button: state finding', async () => {
  const r = await compareScreenshots(drawScreen({ buttonDisabled: true }), drawScreen(), opts);
  const f = real(r);
  assert.equal(f.length, 1);
  assert.equal(f[0].category, 'state');
  assert.match(f[0].title, /disabled/i);
});

test('missing icon in DEV: prod-only bbox on the icon, no DEV bbox', async () => {
  const r = await compareScreenshots(drawScreen({ iconPresent: false }), drawScreen(), opts);
  const f = real(r);
  assert.equal(f.length, 1);
  assert.equal(f[0].devBbox, null);
  assert.ok(inside(f[0].prodBbox, 480 - 48, 120), 'PROD box on the icon');
  assert.match(f[0].title, /missing in DEV/);
});

test('extra icon in DEV: dev-only bbox', async () => {
  const r = await compareScreenshots(drawScreen(), drawScreen({ iconPresent: false }), opts);
  const f = real(r);
  assert.equal(f.length, 1);
  assert.equal(f[0].prodBbox, null);
  assert.ok(inside(f[0].devBbox, 480 - 48, 120));
});

test('changed number in a table cell: one text finding localized to that cell', async () => {
  const r = await compareScreenshots(drawScreen({ valueSeed: 99 }), drawScreen(), opts);
  const f = real(r);
  assert.equal(f.length, 1, JSON.stringify(f.map((x) => x.title)));
  assert.ok(['text', 'typography'].includes(f[0].category), f[0].category);
  assert.ok(inside(f[0].devBbox, 480 - 110, 222), 'box on row 2 numeric cell');
});

test('moved title: layout shift finding', async () => {
  const r = await compareScreenshots(drawScreen({ titleShiftX: 6 }), drawScreen(), opts);
  const f = real(r);
  assert.equal(f.length, 1, JSON.stringify(f.map((x) => x.title)));
  assert.equal(f[0].category, 'layout');
  assert.equal(f[0].metrics.shiftX, -6);
});

test('larger text: typography finding', async () => {
  const r = await compareScreenshots(drawScreen({ titleSeed: 7, textHeight: 16 }), drawScreen({ textHeight: 12 }), opts);
  assert.ok(real(r).some((f) => f.category === 'typography'), JSON.stringify(real(r).map((x) => [x.category, x.title])));
});

test('different dimensions without alignment: alignment-required, never a clean match', async () => {
  const r = await compareScreenshots(drawScreen(), drawScreen({ width: 560, height: 360 }), opts);
  assert.equal(r.status, 'alignment-required');
  assert.equal(r.alignment.required, true);
  assert.ok(r.warnings.some((w) => /Different dimensions/.test(w)));
  assert.ok(!r.findings.some((f) => f.category === 'match'));
});

test('different dimensions, top-left alignment: extra area reported per side', async () => {
  const r = await compareScreenshots(drawScreen({ height: 400 }), drawScreen(), { ...opts, alignment: 'top-left' });
  assert.equal(r.status, 'compared');
  const strip = real(r).find((f) => /extra height/.test(f.title));
  assert.ok(strip, 'extra height finding');
  assert.equal(strip.prodBbox, null);
  assert.equal(strip.devBbox.y, 320);
});

test('2x screenshot, scale alignment: DPR warning and boxes mapped to each original', async () => {
  const dev = drawScreen({ buttonColor: [16, 185, 129] });
  const sharp = require('sharp');
  const prod2x = await sharp(drawScreen()).resize(960, 640, { kernel: 'nearest' }).png().toBuffer();
  const r = await compareScreenshots(dev, prod2x, { ...opts, alignment: 'scale' });
  assert.ok(r.warnings.some((w) => /device pixel ratio/.test(w)));
  const btn = real(r).find((f) => f.category === 'color');
  assert.ok(btn, JSON.stringify(real(r).map((x) => x.title)));
  assert.equal(btn.prodBbox.sourceWidth, 960);
  assert.ok(inside(btn.prodBbox, 160, 256), 'PROD box in 2x coordinates');
});

test('ignore region over the clock: change excluded and logged', async () => {
  const dev = drawScreen({ clockSeed: 42 });
  const prod = drawScreen();
  const before = await compareScreenshots(dev, prod, opts);
  assert.equal(real(before).length, 1, 'clock differs without the rule');
  const r = await compareScreenshots(dev, prod, { ...opts, ignoreRegions: [{ label: 'Clock', x: 400, y: 0, width: 80, height: 40 }] });
  assert.equal(r.status, 'no-differences');
  assert.equal(r.ignoredLog[0].label, 'Clock');
  assert.ok(r.ignoredLog[0].suppressedPixels > 0);
  const ig = r.findings.find((f) => f.ignoredByRule === 'Clock');
  assert.ok(ig && ig.reviewStatus === 'expected');
});

test('several changes: each localized once, numbered top-to-bottom, stable ids', async () => {
  const dev = drawScreen({ buttonColor: [16, 185, 129], iconPresent: false, valueSeed: 99 });
  const r1 = await compareScreenshots(dev, drawScreen(), opts);
  const r2 = await compareScreenshots(dev, drawScreen(), opts);
  const f = real(r1);
  assert.equal(f.length, 3, JSON.stringify(f.map((x) => x.title)));
  assert.deepEqual(f.map((x) => x.number), [1, 2, 3]);
  assert.deepEqual(f.map((x) => x.id), real(r2).map((x) => x.id));
  assert.equal(new Set(f.map((x) => x.id)).size, 3);
});

test('bad input: actionable errors', async () => {
  await assert.rejects(decodeScreenshot(Buffer.from('this is not an image, just text padding padding'), 'DEV'), (e) => e instanceof ScreenshotInputError && e.code === 'invalid-image' && /PNG, JPG or WebP/.test(e.message));
  await assert.rejects(decodeScreenshot(Buffer.alloc(0), 'PROD'), (e) => e.code === 'empty');
  const gif = Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64');
  await assert.rejects(decodeScreenshot(Buffer.concat([gif, Buffer.alloc(40)]), 'DEV'), (e) => e.code === 'unsupported-format');
});

test('evidence images are produced when requested', async () => {
  const r = await compareScreenshots(drawScreen({ buttonColor: [16, 185, 129] }), drawScreen(), { scope: ALL, ocr: false });
  assert.ok(r.evidence.diffPngBase64.length > 100);
  assert.equal(r.evidence.devCanvasPngBase64, undefined, 'same size: no canvas copies');
});

test('AI unavailable: deterministic fallback with a clear note', async () => {
  const saved = process.env.QA_VISION_AI_PROVIDER;
  delete process.env.QA_VISION_AI_PROVIDER;
  try {
    const r = await compareScreenshots(drawScreen({ buttonColor: [16, 185, 129] }), drawScreen(), opts);
    const before = JSON.stringify(r.findings);
    await explainWithAi(r, null, null);
    assert.equal(r.ai.requested, true);
    assert.equal(r.ai.used, false);
    assert.match(r.ai.note, /deterministic/i);
    assert.equal(JSON.stringify(r.findings), before, 'findings untouched');
  } finally {
    if (saved !== undefined) process.env.QA_VISION_AI_PROVIDER = saved;
  }
});

// ---------------------------------------------------------------- scope selection

test('default scope is Data & Text only; a pure color change produces no finding and no pass claim for CSS', async () => {
  const r = await compareScreenshots(drawScreen({ buttonColor: [16, 185, 129] }), drawScreen(), { includeEvidence: false, ocr: false });
  assert.deepEqual(r.scope, ['data_text']);
  assert.equal(real(r).length, 0, JSON.stringify(real(r).map((x) => x.title)));
  assert.equal(r.summary.byScope.css_styling.checked, false, 'CSS reported as not checked, not passed');
  assert.equal(r.summary.byScope.data_text.checked, true);
});

test('only the selected scope reports: CSS alone shows the color change; Images alone does not', async () => {
  const dev = drawScreen({ buttonColor: [16, 185, 129] });
  const css = await compareScreenshots(dev, drawScreen(), { includeEvidence: false, ocr: false, scope: ['css_styling'] });
  assert.equal(real(css).length, 1);
  assert.equal(real(css)[0].scope, 'css_styling');
  assert.match(real(css)[0].code, /^CSS-001$/);
  const img = await compareScreenshots(dev, drawScreen(), { includeEvidence: false, ocr: false, scope: ['images_diagrams'] });
  assert.equal(real(img).length, 0);
});

test('images only: a missing icon is reported under Images & Diagrams with the right side', async () => {
  const r = await compareScreenshots(drawScreen({ iconPresent: false }), drawScreen(), { includeEvidence: false, ocr: false, scope: ['images_diagrams'] });
  const f = real(r);
  assert.equal(f.length, 1);
  assert.equal(f[0].scope, 'images_diagrams');
  assert.equal(f[0].status, 'missing-in-dev');
  assert.equal(f[0].devBbox, null);
});

test('form states only: the greyed button is reported, nothing else', async () => {
  const r = await compareScreenshots(drawScreen({ buttonDisabled: true }), drawScreen(), { includeEvidence: false, ocr: false, scope: ['form_states'] });
  assert.deepEqual(real(r).map((f) => f.scope), ['form_states']);
});

test('empty scope is rejected with an actionable error', async () => {
  await assert.rejects(compareScreenshots(drawScreen(), drawScreen(), { scope: [] }), (e) => e instanceof ScreenshotInputError && e.code === 'no-scope');
});

test('findings are ordered data > images > optional, with per-scope codes', async () => {
  const dev = drawScreen({ buttonColor: [16, 185, 129], iconPresent: false, valueSeed: 99 });
  const r = await compareScreenshots(dev, drawScreen(), opts);
  const scopes = real(r).map((f) => f.scope);
  const rank = (s) => ALL.indexOf(s);
  assert.deepEqual(scopes, [...scopes].sort((a, b) => rank(a) - rank(b)), JSON.stringify(scopes));
  assert.ok(real(r).every((f) => /^(DATA|IMG|CSS|LAY|FORM)-\d{3}$/.test(f.code)));
});

test('without OCR, Data & Text text changes are flagged uncertain (values not read), never claimed', async () => {
  const r = await compareScreenshots(drawScreen({ valueSeed: 99 }), drawScreen(), { includeEvidence: false, ocr: false });
  const f = real(r);
  assert.equal(f.length, 1);
  assert.equal(f[0].status, 'uncertain');
  assert.ok(r.summary.limitations.some((l) => /INCOMPLETE/.test(l)));
});
