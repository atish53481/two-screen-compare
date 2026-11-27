const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeCaptureSettings } = require('../../engine-dist/engine/findings.js');

const DEFAULTS = {
  viewport: { width: 1280, height: 800 },
  pixelThreshold: 0.1,
  visualDiffRatio: 0.02,
  fullPage: false,
  maskSelectors: [],
  scopeSelector: '',
  settleMs: 150, // default lowered from 350 in lib/engine/findings.ts (faster settle; waitForSettled caps per compare mode)
  layoutTolerancePx: 2,
};

test('undefined yields documented defaults', () => {
  assert.deepEqual(normalizeCaptureSettings(undefined), DEFAULTS);
});
test('clamps viewport and thresholds', () => {
  const r = normalizeCaptureSettings({ viewport: { width: 10, height: 99999 }, pixelThreshold: 5 });
  assert.deepEqual(r.viewport, { width: 320, height: 2160 });
  assert.equal(r.pixelThreshold, 1);
});
test('clamps settleMs, tolerance, ratio and drops empty selectors', () => {
  const r = normalizeCaptureSettings({ settleMs: 99999, layoutTolerancePx: -4, visualDiffRatio: -1, maskSelectors: ['', '  ', '.a'], scopeSelector: '  #x ' });
  assert.equal(r.settleMs, 10000);
  assert.equal(r.layoutTolerancePx, 0);
  assert.equal(r.visualDiffRatio, 0);
  assert.deepEqual(r.maskSelectors, ['.a']);
  assert.equal(r.scopeSelector, '#x');
});
test('non-numeric values fall back to defaults', () => {
  const r = normalizeCaptureSettings({ pixelThreshold: NaN, settleMs: 'x' });
  assert.equal(r.pixelThreshold, 0.1);
  assert.equal(r.settleMs, 150);
});
