const test = require('node:test');
const assert = require('node:assert/strict');
const { diffDom, pairElements } = require('../../engine-dist/engine/dom-diff.js');

let n = 0;
function el(key, over = {}) {
  return {
    key, selector: `#${key}-${n++}`, path: key, tag: 'div', testId: '', elementId: '', role: '', name: '', text: '',
    visible: true, enabled: true, box: { x: 0, y: 0, w: 1, h: 1 }, styles: {}, attrs: {},
    a11y: { label: '', alt: null, ariaHidden: false, tabIndex: -1, focusable: false }, order: 0, ...over,
  };
}

test('missing interactive element is high', () => {
  const f = diffDom([el('rn:button|Delete', { tag: 'button', name: 'Delete' })], []);
  assert.equal(f.length, 1);
  assert.equal(f[0].type, 'DOM');
  assert.equal(f[0].property, 'presence');
  assert.equal(f[0].severity, 'high');
  assert.equal(f[0].component, 'Delete');
  assert.equal(f[0].prodValue, '(missing on PROD)');
  assert.ok(f[0].devSelector);
});
test('missing non-interactive element is medium; prod-only is medium', () => {
  assert.equal(diffDom([el('a')], [])[0].severity, 'medium');
  const f = diffDom([], [el('a', { tag: 'button' })]);
  assert.equal(f[0].severity, 'medium');
  assert.equal(f[0].devValue, '(missing on DEV)');
  assert.ok(f[0].prodSelector);
});
test('disabled on PROD only is reported', () => {
  const f = diffDom([el('b', { tag: 'button' })], [el('b', { tag: 'button', enabled: false })]);
  assert.equal(f.length, 1);
  assert.equal(f[0].property, 'enabled');
  assert.equal(f[0].devValue, 'enabled');
  assert.equal(f[0].prodValue, 'disabled');
  assert.equal(f[0].severity, 'high');
});
test('required attr removed is high', () => {
  const f = diffDom([el('i', { tag: 'input', attrs: { required: '' } })], [el('i', { tag: 'input' })]);
  assert.equal(f.length, 1);
  assert.equal(f[0].property, 'attr:required');
  assert.equal(f[0].severity, 'high');
});
test('class attribute never compared', () => {
  const f = diffDom([el('i', { attrs: { class: 'a' } })], [el('i', { attrs: { class: 'b' } })]);
  assert.equal(f.length, 0);
});
test('hidden on both sides not reported', () => {
  assert.equal(diffDom([el('h', { visible: false })], [el('h', { visible: false })]).length, 0);
  assert.equal(diffDom([el('h', { visible: false })], []).length, 0);
});
test('visibility and tag differences', () => {
  const f = diffDom([el('v')], [el('v', { visible: false, tag: 'span' })]);
  const byProp = Object.fromEntries(f.map((x) => [x.property, x.severity]));
  assert.deepEqual(byProp, { tag: 'medium', visibility: 'high' });
});
test('order change reported low', () => {
  const dev = ['a', 'b', 'c'].map((k, i) => el(k, { order: i }));
  const prod = ['a', 'c', 'b'].map((k, i) => el(k, { order: i }));
  const f = diffDom(dev, prod);
  assert.equal(f.length, 1);
  assert.equal(f[0].property, 'order');
  assert.equal(f[0].severity, 'low');
});
test('duplicate keys pair by order', () => {
  const dev = [el('k', { order: 0 }), el('k', { order: 1 })];
  const prod = [el('k', { order: 5 })];
  const r = pairElements(dev, prod);
  assert.equal(r.pairs.length, 1);
  assert.equal(r.pairs[0][0], dev[0]);
  assert.equal(r.devOnly[0], dev[1]);
  assert.equal(r.prodOnly.length, 0);
});
