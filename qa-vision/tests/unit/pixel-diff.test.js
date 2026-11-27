// Screenshot pixel diff (engine-dist/engine/pixel-diff.js) and its worker thread.   npm run test:unit
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { Worker } = require('worker_threads');
const { PNG } = require('pngjs');
const { diffPixels } = require('../../engine-dist/engine/pixel-diff.js');

/** Solid-colour PNG; `paint` may recolour a w x h block at the top-left. */
function png(width, height, rgb, paint) {
  const img = new PNG({ width, height });
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const c = paint && x < paint.w && y < paint.h ? paint.rgb : rgb;
      img.data[i] = c[0];
      img.data[i + 1] = c[1];
      img.data[i + 2] = c[2];
      img.data[i + 3] = 255;
    }
  }
  return PNG.sync.write(img);
}

test('identical screenshots: ratio 0 and a decodable overlay', () => {
  const a = png(40, 30, [200, 200, 200]);
  const r = diffPixels(a, a);
  assert.equal(r.sizeMismatch, false);
  assert.equal(r.ratio, 0);
  const o = PNG.sync.read(r.overlayPng);
  assert.equal(o.width, 40);
  assert.equal(o.height, 30);
});

test('a changed block: ratio is its share of the pixels and it is red in the overlay', () => {
  const a = png(40, 30, [255, 255, 255]);
  const b = png(40, 30, [255, 255, 255], { w: 10, h: 6, rgb: [0, 0, 0] });
  const r = diffPixels(a, b);
  assert.equal(r.ratio, (10 * 6) / (40 * 30));
  const o = PNG.sync.read(r.overlayPng);
  assert.deepEqual([...o.data.subarray(0, 4)], [255, 40, 40, 255]); // inside the block
  const far = (29 * 40 + 39) * 4;
  assert.deepEqual([...o.data.subarray(far, far + 4)], [140, 140, 140, 255]); // dimmed white outside
});

test('different sizes: nothing diffed, ratio 1', () => {
  const r = diffPixels(png(40, 30, [0, 0, 0]), png(40, 31, [0, 0, 0]));
  assert.deepEqual(r, { sizeMismatch: true, ratio: 1 });
});

test('worker thread returns the same result as the main thread', async () => {
  const a = png(64, 48, [255, 255, 255]);
  const b = png(64, 48, [255, 255, 255], { w: 8, h: 8, rgb: [0, 0, 255] });
  const w = new Worker(path.join(__dirname, '..', '..', 'engine-dist', 'engine', 'pixel-worker.js'));
  try {
    const msg = await new Promise((resolve, reject) => {
      w.once('message', resolve);
      w.once('error', reject);
      w.postMessage({ id: 7, a, b, threshold: 0.1 });
    });
    assert.equal(msg.id, 7);
    assert.equal(msg.error, undefined);
    const local = diffPixels(a, b, 0.1);
    assert.equal(msg.result.ratio, local.ratio);
    assert.ok(Buffer.from(msg.result.overlayPng).equals(local.overlayPng));
  } finally {
    await w.terminate();
  }
});
