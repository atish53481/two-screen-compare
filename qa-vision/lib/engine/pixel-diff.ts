import pixelmatch from 'pixelmatch';
import { PNG } from 'pngjs';

export interface PixelDiffResult {
  /** The screenshots differ in size: nothing was diffed (ratio counts as 1). */
  sizeMismatch: boolean;
  /** Differing pixels / all pixels (1 on a size mismatch). */
  ratio: number;
  /** Evidence overlay: differing pixels red over a dimmed DEV screenshot (PNG). Absent on a size mismatch. */
  overlayPng?: Buffer;
}

/**
 * Decode both PNG screenshots, pixel-diff them and encode the evidence overlay. CPU-heavy (linear in pixels, a
 * long full page is tens of millions of bytes), so the engine runs it on a worker thread (see pixel-worker.ts).
 */
export function diffPixels(buf1: Buffer, buf2: Buffer, pixelThreshold = 0.1): PixelDiffResult {
  const img1 = PNG.sync.read(buf1);
  const img2 = PNG.sync.read(buf2);
  if (img1.width !== img2.width || img1.height !== img2.height) return { sizeMismatch: true, ratio: 1 };

  const diff = new PNG({ width: img1.width, height: img1.height });
  const numDiffPixels = pixelmatch(img1.data, img2.data, diff.data, img1.width, img1.height, {
    threshold: pixelThreshold,
    includeAA: true,
    diffColor: [255, 0, 0],
    // Only differing pixels are drawn (on a transparent background): without the mask pixelmatch paints every
    // pixel, and the overlay below turned the whole page red
    diffMask: true,
  });

  // Overlay red diff on top of a faded DEV screenshot for clearer evidence
  const overlay = new PNG({ width: img1.width, height: img1.height });
  const src = img1.data;
  const d = diff.data;
  const out = overlay.data;
  for (let i = 0; i < src.length; i += 4) {
    if (d[i + 3] > 0) {
      out[i] = 255;
      out[i + 1] = 40;
      out[i + 2] = 40;
    } else {
      out[i] = Math.floor(src[i] * 0.55);
      out[i + 1] = Math.floor(src[i + 1] * 0.55);
      out[i + 2] = Math.floor(src[i + 2] * 0.55);
    }
    out[i + 3] = 255;
  }

  return {
    sizeMismatch: false,
    ratio: numDiffPixels / (img1.width * img1.height),
    overlayPng: PNG.sync.write(overlay),
  };
}
