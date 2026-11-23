const test = require('node:test');
const assert = require('node:assert/strict');
const { diffA11y } = require('../../engine-dist/engine/a11y-diff.js');

let n = 0;
function el(key, over = {}) {
  const { a11y, ...rest } = over;
  return {
    key, selector: `#${key}-${n++}`, path: key, tag: 'div', testId: '', elementId: '', role: '', name: '', text: '',
    visible: true, enabled: true, box: { x: 0, y: 0, w: 1, h: 1 }, styles: {}, attrs: {}, order: 0,
    a11y: { label: '', alt: null, ariaHidden: false, tabIndex: -1, focusable: false, ...(a11y || {}) },
    ...rest,
  };
}

test('img alt missing on DEV only is high', () => {
  const f = diffA11y([[el('i', { tag: 'img', a11y: { alt: null } }), el('i', { tag: 'img', a11y: { alt: 'Logo' } })]]);
  assert.equal(f.length, 1);
  assert.equal(f[0].type, 'Accessibility');
  assert.equal(f[0].property, 'alt');
  assert.equal(f[0].severity, 'high');
  assert.equal(f[0].devValue, '(no alt)');
  assert.equal(f[0].prodValue, 'Logo');
  assert.ok(f[0].devSelector && f[0].prodSelector);
});
test('input label lost is high', () => {
  const f = diffA11y([[el('e', { tag: 'input', a11y: { label: 'Email' } }), el('e', { tag: 'input', a11y: { label: '' } })]]);
  assert.equal(f.length, 1);
  assert.equal(f[0].property, 'label');
  assert.equal(f[0].severity, 'high');
  assert.equal(f[0].devValue, 'Email');
});
test('label text change on form field is medium', () => {
  const f = diffA11y([[el('e', { tag: 'input', a11y: { label: 'Email' } }), el('e', { tag: 'input', a11y: { label: 'E-mail' } })]]);
  assert.equal(f[0].severity, 'medium');
});
test('focusable change reported', () => {
  const f = diffA11y([[el('b', { tag: 'button', a11y: { focusable: true } }), el('b', { tag: 'button', a11y: { focusable: false } })]]);
  assert.equal(f.length, 1);
  assert.equal(f[0].property, 'focusable');
  assert.equal(f[0].severity, 'medium');
});
test('role, name, aria-hidden and tabindex sign change', () => {
  const f = diffA11y([[
    el('x', { role: 'button', name: 'Go', a11y: { ariaHidden: false, tabIndex: 0 } }),
    el('x', { role: 'link', name: 'Proceed', a11y: { ariaHidden: true, tabIndex: -1 } }),
  ]]);
  const by = Object.fromEntries(f.map((d) => [d.property, d.severity]));
  assert.deepEqual(by, { role: 'medium', name: 'medium', 'aria-hidden': 'medium', tabindex: 'low' });
});
test('tabindex change without sign change is ignored', () => {
  assert.equal(diffA11y([[el('x', { a11y: { tabIndex: 1 } }), el('x', { a11y: { tabIndex: 3 } })]]).length, 0);
});
test('identical a11y gives no findings', () => {
  const a = el('s', { tag: 'img', role: 'img', name: 'x', a11y: { alt: 'x', label: 'y' } });
  const b = el('s', { tag: 'img', role: 'img', name: 'x', a11y: { alt: 'x', label: 'y' } });
  assert.deepEqual(diffA11y([[a, b]]), []);
});
