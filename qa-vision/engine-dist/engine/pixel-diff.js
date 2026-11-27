"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.diffPixels = diffPixels;
const pixelmatch_1 = __importDefault(require("pixelmatch"));
const pngjs_1 = require("pngjs");
/**
 * Decode both PNG screenshots, pixel-diff them and encode the evidence overlay. CPU-heavy (linear in pixels, a
 * long full page is tens of millions of bytes), so the engine runs it on a worker thread (see pixel-worker.ts).
 */
function diffPixels(buf1, buf2, pixelThreshold = 0.1) {
    const img1 = pngjs_1.PNG.sync.read(buf1);
    const img2 = pngjs_1.PNG.sync.read(buf2);
    if (img1.width !== img2.width || img1.height !== img2.height)
        return { sizeMismatch: true, ratio: 1 };
    const diff = new pngjs_1.PNG({ width: img1.width, height: img1.height });
    const numDiffPixels = (0, pixelmatch_1.default)(img1.data, img2.data, diff.data, img1.width, img1.height, {
        threshold: pixelThreshold,
        includeAA: true,
        diffColor: [255, 0, 0],
        // Only differing pixels are drawn (on a transparent background): without the mask pixelmatch paints every
        // pixel, and the overlay below turned the whole page red
        diffMask: true,
    });
    // Overlay red diff on top of a faded DEV screenshot for clearer evidence
    const overlay = new pngjs_1.PNG({ width: img1.width, height: img1.height });
    const src = img1.data;
    const d = diff.data;
    const out = overlay.data;
    for (let i = 0; i < src.length; i += 4) {
        if (d[i + 3] > 0) {
            out[i] = 255;
            out[i + 1] = 40;
            out[i + 2] = 40;
        }
        else {
            out[i] = Math.floor(src[i] * 0.55);
            out[i + 1] = Math.floor(src[i + 1] * 0.55);
            out[i + 2] = Math.floor(src[i + 2] * 0.55);
        }
        out[i + 3] = 255;
    }
    return {
        sizeMismatch: false,
        ratio: numDiffPixels / (img1.width * img1.height),
        overlayPng: pngjs_1.PNG.sync.write(overlay),
    };
}
