const test = require('node:test');
const assert = require('node:assert/strict');
const { diffCss } = require('../../engine-dist/engine/css-diff.js');

let n = 0;
function el(key, over = {}) {
  return {
    key, selector: `#${key}-${n++}`, path: key, tag: 'div', testId: '', elementId: '', role: '', name: '', text: '',
    visible: true, enabled: true, box: { x: 0, y: 0, w: 120, h: 40 }, styles: {}, attrs: {},
    a11y: { label: '', alt: null, ariaHidden: false, tabIndex: -1, focusable: false }, order: 0, ...over,
  };
}
const opts = { layoutTolerancePx: 2 };

test('background color difference is medium', () => {
  const d = el('b', { name: 'Save', styles: { 'background-color': 'rgb(16, 185, 129)' } });
  const p = el('b', { name: 'Save', styles: { 'background-color': 'rgb(37, 99, 235)' } });
  const f = diffCss([[d, p]], opts);
  assert.equal(f.length, 1);
  assert.equal(f[0].type, 'CSS');
  assert.equal(f[0].property, 'background-color');
  assert.equal(f[0].severity, 'medium');
  assert.equal(f[0].component, 'Save');
  assert.equal(f[0].devValue, 'rgb(16, 185, 129)');
  assert.equal(f[0].devSelector, d.selector);
  assert.equal(f[0].prodSelector, p.selector);
});

test('low severity for other props; whitespace normalized', () => {
  const d = el('b', { styles: { gap: '4px  8px', 'border-radius': '4px' } });
  const p = el('b', { styles: { gap: '4px 8px', 'border-radius': '8px' } });
  const f = diffCss([[d, p]], opts);
  assert.equal(f.length, 1);
  assert.equal(f[0].property, 'border-radius');
  assert.equal(f[0].severity, 'low');
  assert.equal(f[0].component, 'b');
});

test('rgba alpha 1 equals rgb', () => {
  const d = el('b', { styles: { color: 'rgba(1, 2, 3, 1)' } });
  const p = el('b', { styles: { color: 'rgb(1, 2, 3)' } });
  assert.deepEqual(diffCss([[d, p]], opts), []);
  const q = el('b', { styles: { color: 'rgba(1, 2, 3, 0.5)' } });
  assert.equal(diffCss([[d, q]], opts).length, 1);
});

test('width delta within tolerance ignored, beyond reported', () => {
  assert.deepEqual(diffCss([[el('b'), el('b', { box: { x: 0, y: 0, w: 121, h: 40 } })]], opts), []);
  const f = diffCss([[el('b'), el('b', { box: { x: 0, y: 0, w: 150, h: 40 } })]], opts);
  assert.equal(f.length, 1);
  assert.equal(f[0].type, 'Layout');
  assert.equal(f[0].property, 'box.w');
  assert.equal(f[0].severity, 'medium');
  assert.equal(f[0].devValue, '120px');
  assert.equal(f[0].prodValue, '150px');
  const g = diffCss([[el('b'), el('b', { box: { x: 10, y: 0, w: 120, h: 40 } })]], opts);
  assert.equal(g[0].property, 'box.x');
  assert.equal(g[0].severity, 'low');
});

test('css diff ignores unpaired and invisible elements', () => {
  assert.deepEqual(diffCss([], opts), []);
  const d = el('b', { visible: false, styles: { color: 'red' } });
  const p = el('b', { styles: { color: 'blue' }, box: { x: 0, y: 0, w: 500, h: 40 } });
  assert.deepEqual(diffCss([[d, p]], opts), []);
});

test('per-element cap', () => {
  const ds = {}, ps = {};
  for (const k of ['font-family', 'font-size', 'font-weight', 'line-height', 'letter-spacing', 'text-align', 'color', 'background-color', 'opacity', 'display']) {
    ds[k] = 'a'; ps[k] = 'b';
  }
  const f = diffCss([[el('b', { styles: ds, box: { x: 0, y: 0, w: 1, h: 1 } }), el('b', { styles: ps, box: { x: 50, y: 50, w: 50, h: 50 } })]], opts);
  assert.equal(f.filter((x) => x.type === 'CSS').length, 8);
  assert.equal(f.filter((x) => x.type === 'Layout').length, 4);
});
