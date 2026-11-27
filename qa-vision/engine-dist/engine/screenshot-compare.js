"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.ScreenshotInputError = void 0;
exports.decodeScreenshot = decodeScreenshot;
exports.cropRaw = cropRaw;
exports.groupRegions = groupRegions;
exports.classifyRegion = classifyRegion;
exports.sanitizeIgnoreRegions = sanitizeIgnoreRegions;
exports.sanitizeScope = sanitizeScope;
exports.sanitizeTextOptions = sanitizeTextOptions;
exports.compareScreenshots = compareScreenshots;
exports.compareRaw = compareRaw;
exports.alignedPair = alignedPair;
exports.cropPng = cropPng;
/**
 * Screenshot-vs-screenshot comparison for the Two Screen Comparison tab. Data first, then images/diagrams, then
 * optional styling/layout/form checks — and ONLY the scopes the user selected are run or reported.
 *
 * Pipeline: validate + decode (sharp, metadata dropped) -> explicit alignment when sizes differ (never a silent
 * stretch; not needed when only Data & Text is selected, since text is matched by content) -> pixelmatch
 * (anti-aliasing excluded) -> ignore masks -> connected changed regions -> per-region classification from sampled
 * pixels -> local OCR of both originals -> data comparison (screenshot-data.ts) -> scope filter + de-duplication
 * (one wrong value is one finding, not five pixel/CSS findings) -> priority order, codes, summary.
 * Nothing is persisted: buffers live only for the request.
 *
 * What pixels cannot tell us is never invented: no DOM selectors, CSS values or font names. Text values come only
 * from OCR with a confidence; low-confidence readings are marked uncertain instead of claimed.
 */
const crypto_1 = __importDefault(require("crypto"));
const sharp_1 = __importDefault(require("sharp"));
const pixelmatch_1 = __importDefault(require("pixelmatch"));
const screenshot_types_1 = require("./screenshot-types");
const screenshot_ocr_1 = require("./screenshot-ocr");
const screenshot_data_1 = require("./screenshot-data");
class ScreenshotInputError extends Error {
    code;
    constructor(code, message) {
        super(message);
        this.code = code;
        this.name = 'ScreenshotInputError';
    }
}
exports.ScreenshotInputError = ScreenshotInputError;
const SENSITIVITY = {
    strict: { threshold: 0.05, minRegion: 4 },
    normal: { threshold: 0.1, minRegion: 12 },
    relaxed: { threshold: 0.2, minRegion: 40 },
};
const CELL = 4; // grid cell for region grouping, px
const LINK_CELLS = 3; // changed cells closer than this (12px) belong to one region
const MAX_REGIONS = 60;
// ---------------------------------------------------------------- decode
async function decodeScreenshot(buf, side) {
    if (!buf || buf.length < 32)
        throw new ScreenshotInputError('empty', `${side} image is empty or missing.`);
    if (buf.length > screenshot_types_1.SHOT_LIMITS.maxBytes)
        throw new ScreenshotInputError('too-large', `${side} image is ${(buf.length / 1048576).toFixed(1)} MB; the limit is ${screenshot_types_1.SHOT_LIMITS.maxBytes / 1048576} MB. Crop it or save it as JPG/WebP.`);
    let meta;
    try {
        meta = await (0, sharp_1.default)(buf).metadata();
    }
    catch {
        throw new ScreenshotInputError('invalid-image', `${side} file is not a readable image (corrupt or not an image). Re-capture it or save it again as PNG, JPG or WebP.`);
    }
    if (!meta.format || !screenshot_types_1.SHOT_LIMITS.formats.includes(meta.format))
        throw new ScreenshotInputError('unsupported-format', `${side} image format "${meta.format || 'unknown'}" is not supported. Use PNG, JPG or WebP.`);
    const w = meta.width || 0;
    const h = meta.height || 0;
    if (w * h > screenshot_types_1.SHOT_LIMITS.maxPixels || w > screenshot_types_1.SHOT_LIMITS.maxEdge || h > screenshot_types_1.SHOT_LIMITS.maxEdge)
        throw new ScreenshotInputError('too-many-pixels', `${side} image is ${w}×${h}; the limit is ${screenshot_types_1.SHOT_LIMITS.maxPixels.toLocaleString()} pixels and ${screenshot_types_1.SHOT_LIMITS.maxEdge}px per side. Crop it to the area you need.`);
    try {
        // rotate() applies EXIF orientation; raw output carries no metadata at all
        const { data, info } = await (0, sharp_1.default)(buf).rotate().ensureAlpha().raw().toBuffer({ resolveWithObject: true });
        return { data, width: info.width, height: info.height };
    }
    catch {
        throw new ScreenshotInputError('invalid-image', `${side} image could not be decoded. Re-save it as PNG and try again.`);
    }
}
// ---------------------------------------------------------------- pixel helpers
function cropRaw(img, r) {
    const out = Buffer.alloc(r.width * r.height * 4);
    for (let y = 0; y < r.height; y++) {
        const src = ((r.y + y) * img.width + r.x) * 4;
        img.data.copy(out, y * r.width * 4, src, src + r.width * 4);
    }
    return { data: out, width: r.width, height: r.height };
}
async function scaleRaw(img, width, height) {
    const data = await (0, sharp_1.default)(img.data, { raw: { width: img.width, height: img.height, channels: 4 } })
        .resize(width, height, { fit: 'fill' })
        .raw()
        .toBuffer();
    return { data, width, height };
}
async function rawToPng(img) {
    return (0, sharp_1.default)(img.data, { raw: { width: img.width, height: img.height, channels: 4 } }).png().toBuffer();
}
const hex = (c) => '#' + c.map((v) => Math.round(v).toString(16).padStart(2, '0')).join('');
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
const luma = (r, g, b) => 0.299 * r + 0.587 * g + 0.114 * b;
function saturation(c) {
    const max = Math.max(c[0], c[1], c[2]);
    const min = Math.min(c[0], c[1], c[2]);
    return max === 0 ? 0 : (max - min) / max;
}
function clampRect(r, w, h) {
    const x = Math.max(0, Math.floor(r.x));
    const y = Math.max(0, Math.floor(r.y));
    const x2 = Math.min(w, Math.ceil(r.x + r.width));
    const y2 = Math.min(h, Math.ceil(r.y + r.height));
    if (x2 <= x || y2 <= y)
        return null;
    return { x, y, width: x2 - x, height: y2 - y };
}
function pad(r, p, w, h) {
    return clampRect({ x: r.x - p, y: r.y - p, width: r.width + 2 * p, height: r.height + 2 * p }, w, h);
}
/** Most common color (4-bit quantized buckets, averaged) on the border of a rect: the local background. */
function backgroundColor(img, r) {
    const buckets = new Map();
    const add = (x, y) => {
        const i = (y * img.width + x) * 4;
        const d = img.data;
        const key = ((d[i] >> 4) << 8) | ((d[i + 1] >> 4) << 4) | (d[i + 2] >> 4);
        const b = buckets.get(key);
        if (b) {
            b.n++;
            b.r += d[i];
            b.g += d[i + 1];
            b.b += d[i + 2];
        }
        else
            buckets.set(key, { n: 1, r: d[i], g: d[i + 1], b: d[i + 2] });
    };
    for (let x = r.x; x < r.x + r.width; x++) {
        add(x, r.y);
        add(x, r.y + r.height - 1);
    }
    for (let y = r.y; y < r.y + r.height; y++) {
        add(r.x, y);
        add(r.x + r.width - 1, y);
    }
    let best = { n: 0, r: 255, g: 255, b: 255 };
    for (const b of buckets.values())
        if (b.n > best.n)
            best = b;
    return best.n ? [best.r / best.n, best.g / best.n, best.b / best.n] : [255, 255, 255];
}
/** "Ink": pixels in rect that clearly differ from the local background. */
function ink(img, r, bg, tol = 48) {
    const mask = new Uint8Array(r.width * r.height);
    let count = 0;
    let minX = Infinity, minY = Infinity, maxX = -1, maxY = -1;
    const sum = [0, 0, 0];
    for (let y = 0; y < r.height; y++) {
        for (let x = 0; x < r.width; x++) {
            const i = ((r.y + y) * img.width + r.x + x) * 4;
            const c = [img.data[i], img.data[i + 1], img.data[i + 2]];
            if (dist(c, bg) > tol) {
                mask[y * r.width + x] = 1;
                count++;
                sum[0] += c[0];
                sum[1] += c[1];
                sum[2] += c[2];
                if (x < minX)
                    minX = x;
                if (y < minY)
                    minY = y;
                if (x > maxX)
                    maxX = x;
                if (y > maxY)
                    maxY = y;
            }
        }
    }
    return {
        frac: count / (r.width * r.height),
        count,
        bbox: count ? { x: r.x + minX, y: r.y + minY, width: maxX - minX + 1, height: maxY - minY + 1 } : null,
        color: count ? sum.map((s) => s / count) : bg,
        mask,
    };
}
function maskIoU(a, b) {
    let inter = 0, uni = 0;
    for (let i = 0; i < a.length; i++) {
        if (a[i] && b[i])
            inter++;
        if (a[i] || b[i])
            uni++;
    }
    return uni ? inter / uni : 1;
}
/** Best integer offset (dx,dy) of PROD content relative to DEV inside `r`, by mean absolute luma difference. */
function findShift(dev, prod, r, maxShift) {
    const step = Math.max(1, Math.ceil(Math.max(r.width, r.height) / 96)); // sample grid keeps this cheap
    const L = (img, x, y) => {
        const i = (y * img.width + x) * 4;
        return luma(img.data[i], img.data[i + 1], img.data[i + 2]);
    };
    const errAt = (dx, dy) => {
        let s = 0, n = 0;
        for (let y = r.y; y < r.y + r.height; y += step) {
            const py = y + dy;
            if (py < 0 || py >= prod.height)
                continue;
            for (let x = r.x; x < r.x + r.width; x += step) {
                const px = x + dx;
                if (px < 0 || px >= prod.width)
                    continue;
                s += Math.abs(L(dev, x, y) - L(prod, px, py));
                n++;
            }
        }
        return n > 0 ? s / n : Infinity;
    };
    const err0 = errAt(0, 0);
    let best = { dx: 0, dy: 0, err: err0 };
    for (let dy = -maxShift; dy <= maxShift; dy += 1) {
        for (let dx = -maxShift; dx <= maxShift; dx += 1) {
            if (!dx && !dy)
                continue;
            const e = errAt(dx, dy);
            if (e < best.err)
                best = { dx, dy, err: e };
        }
    }
    return { ...best, err0 };
}
/** findShift over a larger range: search every 2px, then refine around the best offset. */
function findShiftCoarse(dev, prod, r, maxShift) {
    const coarse = { dx: 0, dy: 0, err: Infinity };
    const fine = (cx, cy, span, stepPx) => {
        let best = { dx: cx, dy: cy, err: Infinity };
        for (let dy = cy - span; dy <= cy + span; dy += stepPx)
            for (let dx = cx - span; dx <= cx + span; dx += stepPx) {
                const e = shiftErr(dev, prod, r, dx, dy);
                if (e < best.err)
                    best = { dx, dy, err: e };
            }
        return best;
    };
    Object.assign(coarse, fine(0, 0, maxShift, 2));
    const best = fine(coarse.dx, coarse.dy, 1, 1);
    return { dx: best.dx, dy: best.dy, err: best.err, err0: shiftErr(dev, prod, r, 0, 0) };
}
function shiftErr(dev, prod, r, dx, dy) {
    const step = Math.max(1, Math.ceil(Math.max(r.width, r.height) / 64));
    let s = 0, n = 0;
    for (let y = r.y; y < r.y + r.height; y += step) {
        const py = y + dy;
        if (py < 0 || py >= prod.height)
            continue;
        for (let x = r.x; x < r.x + r.width; x += step) {
            const px = x + dx;
            if (px < 0 || px >= prod.width)
                continue;
            const i = (y * dev.width + x) * 4, j = (py * prod.width + px) * 4;
            s += Math.abs(luma(dev.data[i], dev.data[i + 1], dev.data[i + 2]) - luma(prod.data[j], prod.data[j + 1], prod.data[j + 2]));
            n++;
        }
    }
    return n > 0 ? s / n : Infinity;
}
// ---------------------------------------------------------------- regions
/** Group changed pixels into regions: 4px cells, cells within 12px are linked, boxes tightened to real pixels. */
function groupRegions(mask, width, height, minPixels) {
    const gw = Math.ceil(width / CELL);
    const gh = Math.ceil(height / CELL);
    const cells = new Uint32Array(gw * gh);
    for (let y = 0; y < height; y++) {
        const row = y * width;
        const cy = ((y / CELL) | 0) * gw;
        for (let x = 0; x < width; x++)
            if (mask[row + x])
                cells[cy + ((x / CELL) | 0)]++;
    }
    const seen = new Uint8Array(gw * gh);
    const out = [];
    const stack = [];
    for (let start = 0; start < cells.length; start++) {
        if (!cells[start] || seen[start])
            continue;
        seen[start] = 1;
        stack.push(start);
        let pixels = 0, minCx = Infinity, minCy = Infinity, maxCx = -1, maxCy = -1;
        while (stack.length) {
            const c = stack.pop();
            const cx = c % gw, cy = (c / gw) | 0;
            pixels += cells[c];
            if (cx < minCx)
                minCx = cx;
            if (cy < minCy)
                minCy = cy;
            if (cx > maxCx)
                maxCx = cx;
            if (cy > maxCy)
                maxCy = cy;
            for (let ny = Math.max(0, cy - LINK_CELLS); ny <= Math.min(gh - 1, cy + LINK_CELLS); ny++) {
                for (let nx = Math.max(0, cx - LINK_CELLS); nx <= Math.min(gw - 1, cx + LINK_CELLS); nx++) {
                    const n = ny * gw + nx;
                    if (cells[n] && !seen[n]) {
                        seen[n] = 1;
                        stack.push(n);
                    }
                }
            }
        }
        if (pixels < minPixels)
            continue;
        // tighten to the actual changed pixels inside the cell box
        const x0 = minCx * CELL, y0 = minCy * CELL;
        const x1 = Math.min(width, (maxCx + 1) * CELL), y1 = Math.min(height, (maxCy + 1) * CELL);
        let tx0 = Infinity, ty0 = Infinity, tx1 = -1, ty1 = -1;
        for (let y = y0; y < y1; y++) {
            for (let x = x0; x < x1; x++) {
                if (mask[y * width + x]) {
                    if (x < tx0)
                        tx0 = x;
                    if (y < ty0)
                        ty0 = y;
                    if (x > tx1)
                        tx1 = x;
                    if (y > ty1)
                        ty1 = y;
                }
            }
        }
        out.push({ rect: { x: tx0, y: ty0, width: tx1 - tx0 + 1, height: ty1 - ty0 + 1 }, pixels });
    }
    // merge boxes that overlap once padded by 4px (an L-shaped change can yield nested boxes)
    let merged = true;
    while (merged) {
        merged = false;
        outer: for (let i = 0; i < out.length; i++) {
            for (let j = i + 1; j < out.length; j++) {
                const a = out[i].rect, b = out[j].rect;
                if (a.x - 4 <= b.x + b.width && b.x - 4 <= a.x + a.width && a.y - 4 <= b.y + b.height && b.y - 4 <= a.y + a.height) {
                    const x = Math.min(a.x, b.x), y = Math.min(a.y, b.y);
                    out[i] = {
                        rect: { x, y, width: Math.max(a.x + a.width, b.x + b.width) - x, height: Math.max(a.y + a.height, b.y + b.height) - y },
                        pixels: out[i].pixels + out[j].pixels,
                    };
                    out.splice(j, 1);
                    merged = true;
                    break outer;
                }
            }
        }
    }
    return out.sort((a, b) => (Math.abs(a.rect.y - b.rect.y) > 8 ? a.rect.y - b.rect.y : a.rect.x - b.rect.x));
}
// ---------------------------------------------------------------- classification
function classifyRegion(dev, prod, rect, pixels) {
    const W = dev.width, H = dev.height;
    const ctx = pad(rect, 6, W, H);
    const bgD = backgroundColor(dev, ctx);
    const bgP = backgroundColor(prod, ctx);
    const inkD = ink(dev, rect, bgD);
    const inkP = ink(prod, rect, bgP);
    const area = W * H;
    const areaPct = (rect.width * rect.height * 100) / area;
    const metrics = {
        changedPixels: pixels,
        devBackground: hex(bgD),
        prodBackground: hex(bgP),
        devInkPercent: +(inkD.frac * 100).toFixed(1),
        prodInkPercent: +(inkP.frac * 100).toFixed(1),
    };
    const base = { rect, pixels, metrics, devRect: rect, prodRect: rect };
    const where = `at (${rect.x}, ${rect.y}), ${rect.width}×${rect.height}px`;
    const textLike = (s, r) => r.height <= 90 && r.width >= r.height * 1.2 && s.frac > 0.03 && s.frac < 0.65;
    // 1. Element present on one side only — unless the same content sits nearby (a move, e.g. a taller header
    //    pushing a chart down), which is a layout change, not a missing element
    const onlyDev = inkD.frac > 0.02 && inkP.frac < Math.max(0.004, inkD.frac * 0.12);
    const onlyProd = inkP.frac > 0.02 && inkD.frac < Math.max(0.004, inkP.frac * 0.12);
    if ((onlyDev || onlyProd) && rect.width * rect.height < 250_000) {
        const wide = pad(rect, 24, W, H);
        const s = findShiftCoarse(dev, prod, wide, 24);
        if ((s.dx || s.dy) && s.err0 > 3 && s.err < s.err0 * 0.35 && s.err < 8) {
            metrics.shiftX = s.dx;
            metrics.shiftY = s.dy;
            return {
                ...base,
                prodRect: clampRect({ ...rect, x: rect.x + s.dx, y: rect.y + s.dy }, W, H) || rect,
                side: 'both',
                category: 'layout',
                title: `Content shifted ${[s.dx ? `${Math.abs(s.dx)}px ${s.dx > 0 ? 'right' : 'left'}` : '', s.dy ? `${Math.abs(s.dy)}px ${s.dy > 0 ? 'down' : 'up'}` : ''].filter(Boolean).join(' and ')} in PROD`,
                devObservation: `Content ${where}`,
                prodObservation: `Same content found offset by (${s.dx}, ${s.dy})px`,
                evidence: `Looked missing at a fixed position, but luma difference drops from ${s.err0.toFixed(1)} to ${s.err.toFixed(1)} when PROD is offset by (${s.dx}, ${s.dy}).`,
                confidence: 0.7,
                severity: Math.hypot(s.dx, s.dy) > 8 ? 'medium' : 'low',
            };
        }
    }
    if (onlyDev || onlyProd) {
        const s = onlyDev ? inkD : inkP;
        const r = s.bbox || rect;
        const isText = textLike(s, r);
        return {
            ...base,
            devRect: onlyDev ? r : rect,
            prodRect: onlyProd ? r : rect,
            side: onlyDev ? 'dev-only' : 'prod-only',
            category: isText ? 'text' : 'visual',
            title: onlyDev
                ? `${isText ? 'Text' : 'Element'} present in DEV, absent in PROD`
                : `${isText ? 'Text' : 'Element'} missing in DEV (present in PROD)`,
            devObservation: onlyDev
                ? `Visible ${isText ? 'text-like content' : 'content'} ${r.width}×${r.height}px at (${r.x}, ${r.y}), color ≈ ${hex(s.color)}`
                : `Only background (≈ ${hex(bgD)}) in this area`,
            prodObservation: onlyProd
                ? `Visible ${isText ? 'text-like content' : 'content'} ${r.width}×${r.height}px at (${r.x}, ${r.y}), color ≈ ${hex(s.color)}`
                : `Only background (≈ ${hex(bgP)}) in this area`,
            evidence: `Pixels differing from the local background: DEV ${(inkD.frac * 100).toFixed(1)}%, PROD ${(inkP.frac * 100).toFixed(1)}% of the region.`,
            confidence: 0.86,
            severity: areaPct > 0.15 ? 'high' : 'medium',
        };
    }
    // 2. Same shape, different color (or a likely state change when saturation collapses)
    const iou = maskIoU(inkD.mask, inkP.mask);
    metrics.shapeOverlap = +iou.toFixed(2);
    const inkShift = dist(inkD.color, inkP.color);
    const bgShift = dist(bgD, bgP);
    if (iou > 0.8 && (inkShift > 24 || bgShift > 24)) {
        // compare the dominant changed fill: whichever moved more (ink on a button label, or the button background)
        const devFill = bgShift >= inkShift ? bgD : inkD.color;
        const prodFill = bgShift >= inkShift ? bgP : inkP.color;
        metrics.devColor = hex(devFill);
        metrics.prodColor = hex(prodFill);
        const sD = saturation(devFill), sP = saturation(prodFill);
        const grey = (s) => s < 0.12;
        if (grey(sD) !== grey(sP) && Math.max(sD, sP) > 0.3) {
            const devGrey = grey(sD);
            return {
                ...base,
                side: 'both',
                category: 'state',
                title: devGrey ? 'Element looks disabled/greyed in DEV' : 'Element looks disabled/greyed in PROD',
                devObservation: `Fill ≈ ${hex(devFill)} (${devGrey ? 'grey, low saturation' : 'colored'}) ${where}`,
                prodObservation: `Fill ≈ ${hex(prodFill)} (${devGrey ? 'colored' : 'grey, low saturation'})`,
                evidence: `Same shape (overlap ${(iou * 100).toFixed(0)}%), saturation ${sD.toFixed(2)} vs ${sP.toFixed(2)}. A greyed look often means disabled; confirm in the app.`,
                confidence: 0.62,
                severity: 'medium',
            };
        }
        return {
            ...base,
            side: 'both',
            category: 'color',
            title: bgShift >= inkShift ? 'Background/fill color changed' : 'Element or text color changed',
            devObservation: `Sampled color ≈ ${hex(devFill)} ${where}`,
            prodObservation: `Sampled color ≈ ${hex(prodFill)}`,
            evidence: `Same shape (overlap ${(iou * 100).toFixed(0)}%), color distance ${Math.round(Math.max(inkShift, bgShift))} (RGB). Colors are sampled pixels, not CSS values.`,
            confidence: 0.82,
            severity: areaPct > 1 ? 'medium' : 'low',
        };
    }
    // 3. Same content moved
    if (rect.width >= 6 && rect.height >= 6) {
        const s = findShift(dev, prod, ctx, Math.min(32, Math.max(8, Math.round(Math.max(rect.width, rect.height) / 2))));
        if ((s.dx || s.dy) && s.err0 > 4 && s.err < s.err0 * 0.3 && s.err < 10) {
            metrics.shiftX = s.dx;
            metrics.shiftY = s.dy;
            const prodRect = clampRect({ ...rect, x: rect.x + s.dx, y: rect.y + s.dy }, W, H) || rect;
            return {
                ...base,
                prodRect,
                side: 'both',
                category: 'layout',
                title: `Content shifted ${Math.abs(s.dx) ? `${Math.abs(s.dx)}px ${s.dx > 0 ? 'right' : 'left'}` : ''}${s.dx && s.dy ? ' and ' : ''}${Math.abs(s.dy) ? `${Math.abs(s.dy)}px ${s.dy > 0 ? 'down' : 'up'}` : ''} in PROD`,
                devObservation: `Content ${where}`,
                prodObservation: `Same content found offset by (${s.dx}, ${s.dy})px`,
                evidence: `Luma difference drops from ${s.err0.toFixed(1)} to ${s.err.toFixed(1)} when PROD is offset by (${s.dx}, ${s.dy}).`,
                confidence: 0.74,
                severity: Math.hypot(s.dx, s.dy) > 8 ? 'medium' : 'low',
            };
        }
    }
    // 4. Text-like: size/weight vs content
    if (textLike(inkD, inkD.bbox || rect) && textLike(inkP, inkP.bbox || rect) && inkD.bbox && inkP.bbox) {
        const hD = inkD.bbox.height, hP = inkP.bbox.height;
        metrics.devInkHeight = hD;
        metrics.prodInkHeight = hP;
        const heightDiff = Math.abs(hD - hP) / Math.max(hD, hP);
        const weightRatio = inkD.count / Math.max(1, inkP.count);
        if (heightDiff >= 0.12 && Math.abs(hD - hP) >= 2) {
            return {
                ...base,
                devRect: inkD.bbox,
                prodRect: inkP.bbox,
                side: 'both',
                category: 'typography',
                title: `Text size appears ${hD > hP ? 'larger' : 'smaller'} in DEV`,
                devObservation: `Text ink height ≈ ${hD}px ${where}`,
                prodObservation: `Text ink height ≈ ${hP}px`,
                evidence: `Glyph block heights differ by ${Math.round(heightDiff * 100)}%. Exact font size/family cannot be measured from pixels.`,
                confidence: 0.6,
                severity: 'low',
            };
        }
        if (iou > 0.55 && heightDiff < 0.08 && (weightRatio > 1.25 || weightRatio < 0.8)) {
            return {
                ...base,
                side: 'both',
                category: 'typography',
                title: `Text weight appears ${weightRatio > 1 ? 'heavier' : 'lighter'} in DEV`,
                devObservation: `${inkD.count} glyph pixels ${where}`,
                prodObservation: `${inkP.count} glyph pixels, same height`,
                evidence: `Same text block size, ${Math.round(Math.abs(weightRatio - 1) * 100)}% ${weightRatio > 1 ? 'more' : 'fewer'} glyph pixels. Font weight is an estimate.`,
                confidence: 0.55,
                severity: 'low',
            };
        }
        return {
            ...base,
            side: 'both',
            category: 'text',
            title: 'Text or value changed',
            devObservation: `Text-like content ${inkD.bbox.width}×${hD}px ${where}`,
            prodObservation: `Text-like content ${inkP.bbox.width}×${hP}px — glyphs differ`,
            evidence: `Glyph shapes differ (overlap ${(iou * 100).toFixed(0)}%). The words/numbers are not read (no OCR): compare the crops to see whether it is copy or a data value.`,
            confidence: 0.66,
            severity: 'medium',
        };
    }
    // 5. Anything else: icon, image, chart, border...
    return {
        ...base,
        side: 'both',
        category: 'visual',
        title: 'Visual content differs',
        devObservation: `Content ${where}, dominant color ≈ ${hex(inkD.color)}`,
        prodObservation: `Content differs, dominant color ≈ ${hex(inkP.color)}`,
        evidence: `${pixels.toLocaleString()} changed pixels; shape overlap ${(iou * 100).toFixed(0)}%. Not a pure color change or move.`,
        confidence: 0.55,
        severity: areaPct > 1 ? 'medium' : 'low',
    };
}
// ---------------------------------------------------------------- main
function stableId(category, r) {
    return 'sc-' + crypto_1.default.createHash('sha1').update(`${category}:${r.x},${r.y},${r.width},${r.height}`).digest('hex').slice(0, 10);
}
function toBBox(r, sx, sy, sw, sh) {
    const x = Math.round(r.x * sx), y = Math.round(r.y * sy);
    return {
        x,
        y,
        width: Math.max(1, Math.min(sw - x, Math.round(r.width * sx))),
        height: Math.max(1, Math.min(sh - y, Math.round(r.height * sy))),
        sourceWidth: sw,
        sourceHeight: sh,
        coordinateSystem: 'source-pixels-top-left',
    };
}
function sanitizeIgnoreRegions(input) {
    if (!Array.isArray(input))
        return [];
    return input
        .slice(0, 50)
        .map((v, i) => {
        const r = (v && typeof v === 'object' ? v : {});
        return {
            label: String(r?.label || `Ignore ${i + 1}`).slice(0, 80),
            x: Number(r?.x),
            y: Number(r?.y),
            width: Number(r?.width),
            height: Number(r?.height),
        };
    })
        .filter((r) => [r.x, r.y, r.width, r.height].every(Number.isFinite) && r.width > 0 && r.height > 0);
}
/** Valid, de-duplicated scopes in priority order. `undefined` -> the default (Data & Text only). */
function sanitizeScope(input) {
    if (input === undefined || input === null)
        return [...screenshot_types_1.DEFAULT_SHOT_SCOPE];
    if (!Array.isArray(input))
        return [];
    return screenshot_types_1.SHOT_SCOPES.filter((s) => input.includes(s));
}
function sanitizeTextOptions(input) {
    const r = (input && typeof input === 'object' ? input : {});
    const num = (v, d, lo, hi) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : d);
    return {
        matching: r.matching === 'strict' ? 'strict' : 'normalized',
        caseSensitive: r.caseSensitive === true,
        numericTolerance: num(r.numericTolerance, screenshot_types_1.DEFAULT_TEXT_OPTIONS.numericTolerance, 0, 1e12),
        minConfidence: num(r.minConfidence, screenshot_types_1.DEFAULT_TEXT_OPTIONS.minConfidence, 0, 100),
        ignoreFields: Array.isArray(r.ignoreFields)
            ? r.ignoreFields.map((s) => String(s).trim().slice(0, 120)).filter(Boolean).slice(0, 50)
            : [],
    };
}
const intersectArea = (a, b) => Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x)) * Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y));
const VALUE_TITLE = {
    number: 'Number mismatch', currency: 'Amount mismatch', percent: 'Percentage mismatch', date: 'Date/time mismatch',
    identifier: 'Identifier mismatch', status: 'Status mismatch', text: 'Text mismatch',
};
async function compareScreenshots(devBuf, prodBuf, opts = {}) {
    const scope = sanitizeScope(opts.scope);
    if (!scope.length)
        throw new ScreenshotInputError('no-scope', 'Select at least one comparison category (Data & Text, Images & Diagrams, CSS & Visual Styling, Alignment & Layout, Form Elements & States).');
    const dev0 = await decodeScreenshot(devBuf, 'DEV');
    const prod0 = await decodeScreenshot(prodBuf, 'PROD');
    return compareRaw(dev0, prod0, opts);
}
async function compareRaw(dev0, prod0, opts = {}) {
    const scope = sanitizeScope(opts.scope);
    if (!scope.length)
        throw new ScreenshotInputError('no-scope', 'Select at least one comparison category.');
    const has = (s) => scope.includes(s);
    const textOpts = sanitizeTextOptions(opts.text);
    const sensitivity = opts.sensitivity && SENSITIVITY[opts.sensitivity] ? opts.sensitivity : 'normal';
    const threshold = typeof opts.pixelThreshold === 'number' && opts.pixelThreshold >= 0 && opts.pixelThreshold <= 1
        ? opts.pixelThreshold
        : SENSITIVITY[sensitivity].threshold;
    const minRegion = SENSITIVITY[sensitivity].minRegion;
    const alignment = opts.alignment || 'none';
    const ignoreRegions = sanitizeIgnoreRegions(opts.ignoreRegions);
    const includeEvidence = opts.includeEvidence !== false;
    const devId = opts.devId || 'dev';
    const prodId = opts.prodId || 'prod';
    const imageIds = { dev: devId, prod: prodId };
    const warnings = [];
    const limitations = [
        'Only what is visible in the screenshots was compared: hidden DOM values, CSS declarations/classes, APIs and database records were not checked.',
    ];
    const ocrSt = (0, screenshot_ocr_1.ocrStatus)();
    const wantOcr = opts.ocr !== false && (has('data_text') || has('css_styling') || has('images_diagrams'));
    const ocrUsable = wantOcr && ocrSt.available;
    const pixelScopes = scope.some((s) => s !== 'data_text');
    const sameSize = dev0.width === prod0.width && dev0.height === prod0.height;
    const emptyByScope = () => Object.fromEntries(screenshot_types_1.SHOT_SCOPES.map((s) => [s, { checked: has(s), findings: 0, mismatches: 0, uncertain: 0 }]));
    const base = {
        sessionId: `shot_${crypto_1.default.randomUUID()}`,
        timestamp: new Date().toISOString(),
        pageName: String(opts.pageName || '').slice(0, 200),
        devLabel: String(opts.devLabel || 'DEV').slice(0, 60),
        prodLabel: String(opts.prodLabel || 'PROD').slice(0, 60),
        expectedNotes: String(opts.expectedNotes || '').slice(0, 4000),
        devImageId: devId,
        prodImageId: prodId,
        devDimensions: { width: dev0.width, height: dev0.height },
        prodDimensions: { width: prod0.width, height: prod0.height },
        scope,
        ai: { requested: false, used: false, provider: null, model: null, note: 'AI not requested — deterministic comparison only.' },
    };
    const settings = { sensitivity, pixelThreshold: threshold, minRegionPixels: minRegion, ignoreRegions, text: textOpts };
    if (!sameSize) {
        const aD = dev0.width / dev0.height, aP = prod0.width / prod0.height;
        warnings.push(`Different dimensions: DEV ${dev0.width}×${dev0.height}, PROD ${prod0.width}×${prod0.height}.`);
        if (Math.abs(aD - aP) / aD > 0.01)
            warnings.push('Different aspect ratios — the pages may differ in viewport, scroll position, zoom or captured area.');
        const ratio = dev0.width / prod0.width;
        if (Math.abs(aD - aP) / aD <= 0.01 && [0.5, 2, 1.5, 1 / 1.5, 1.25, 0.8].some((k) => Math.abs(ratio - k) < 0.02))
            warnings.push(`Same aspect ratio at ${ratio.toFixed(2)}× size — likely a different device pixel ratio/zoom. "Scale PROD to DEV" fits this case.`);
    }
    // Data & Text alone is matched by content, so different sizes need no pixel alignment (when OCR can run).
    const dataOnlyBySize = !sameSize && alignment === 'none' && !pixelScopes && ocrUsable;
    if (!sameSize && alignment === 'none' && !dataOnlyBySize) {
        return {
            ...base,
            status: 'alignment-required',
            canvas: { width: 0, height: 0 },
            alignment: {
                mode: 'none', required: true,
                description: pixelScopes
                    ? 'Choose an alignment: the screenshots have different sizes and a pixel-based check is selected.'
                    : 'Choose an alignment: the screenshots have different sizes and OCR is unavailable, so text can only be compared by pixels.',
                prodScaleX: 1, prodScaleY: 1,
            },
            settings,
            pixelAnalysis: false,
            ocr: { requested: wantOcr, used: false, engine: null, note: ocrUsable ? 'Not run: alignment required first.' : ocrSt.note, devTextItems: 0, prodTextItems: 0, durationMs: 0 },
            warnings,
            findings: [],
            ignoredLog: [],
            ignoredFields: [],
            summary: {
                byScope: emptyByScope(), matchedItems: 0, confirmedMismatches: 0, uncertainItems: 0, ocrNoiseSuppressed: 0,
                totalFindings: 0, matches: 0, mismatchesByCategory: {}, diffPercent: 0, similarityPercent: 0,
                identicalZones: 0, totalZones: 0, subThresholdPixels: 0, limitations,
            },
            evidence: {},
        };
    }
    // ---- alignment (originals are untouched; the client keeps them for display and export)
    let dev = dev0, prod = prod0;
    let prodScaleX = 1, prodScaleY = 1; // canvas -> PROD source
    let alignDesc = 'Same size — compared pixel for pixel.';
    const extraFindings = [];
    if (dataOnlyBySize) {
        prodScaleX = prod0.width / dev0.width;
        prodScaleY = prod0.height / dev0.height;
        alignDesc = 'Different sizes: only Data & Text is selected, so text was matched by content and the pixel diff was skipped.';
    }
    else if (!sameSize && alignment === 'scale') {
        prod = await scaleRaw(prod0, dev0.width, dev0.height);
        prodScaleX = prod0.width / dev0.width;
        prodScaleY = prod0.height / dev0.height;
        alignDesc = `PROD scaled to DEV size (${dev0.width}×${dev0.height}) for comparison; boxes are mapped back to each original.`;
        if (Math.abs(prodScaleX - prodScaleY) / prodScaleX > 0.01)
            warnings.push(`Scaling stretches PROD unevenly (x ${prodScaleX.toFixed(3)}, y ${prodScaleY.toFixed(3)}): expect false differences. Prefer top-left alignment or re-capture at the same viewport.`);
        limitations.push('PROD was resampled to DEV size for the pixel diff; thin lines and text may show resampling noise.');
    }
    else if (!sameSize && alignment === 'top-left') {
        const w = Math.min(dev0.width, prod0.width), h = Math.min(dev0.height, prod0.height);
        dev = cropRaw(dev0, { x: 0, y: 0, width: w, height: h });
        prod = cropRaw(prod0, { x: 0, y: 0, width: w, height: h });
        alignDesc = `Aligned at the top-left corner; the overlapping ${w}×${h} area was compared and the rest reported as size differences.`;
        const strip = (side, r, what) => extraFindings.push({
            rect: r, pixels: r.width * r.height, side, devRect: r, prodRect: r,
            category: 'layout',
            title: `${side === 'dev-only' ? 'DEV' : 'PROD'} has ${what} not present in ${side === 'dev-only' ? 'PROD' : 'DEV'}`,
            devObservation: `DEV ${dev0.width}×${dev0.height}`,
            prodObservation: `PROD ${prod0.width}×${prod0.height}`,
            evidence: `Area ${r.width}×${r.height}px at (${r.x}, ${r.y}) exists in only one screenshot, so it was not pixel-compared.`,
            confidence: 0.95,
            severity: 'medium',
            metrics: { width: r.width, height: r.height },
        });
        if (dev0.height > h)
            strip('dev-only', { x: 0, y: h, width: dev0.width, height: dev0.height - h }, `${dev0.height - h}px of extra height`);
        if (prod0.height > h)
            strip('prod-only', { x: 0, y: h, width: prod0.width, height: prod0.height - h }, `${prod0.height - h}px of extra height`);
        if (dev0.width > w)
            strip('dev-only', { x: w, y: 0, width: dev0.width - w, height: Math.min(h, dev0.height) }, `${dev0.width - w}px of extra width`);
        if (prod0.width > w)
            strip('prod-only', { x: w, y: 0, width: prod0.width - w, height: Math.min(h, prod0.height) }, `${prod0.width - w}px of extra width`);
    }
    // ---- pixel diff
    const pixelAnalysis = !dataOnlyBySize;
    const W = dev.width, H = dev.height;
    const mask = new Uint8Array(pixelAnalysis ? W * H : 0);
    const diffOut = Buffer.alloc(pixelAnalysis ? W * H * 4 : 0);
    let changed = 0;
    const ignoredLog = [];
    let groups = [];
    let classified = [];
    if (pixelAnalysis) {
        (0, pixelmatch_1.default)(dev.data, prod.data, diffOut, W, H, {
            threshold,
            includeAA: false, // anti-aliased edge pixels are not differences
            diffColor: [255, 0, 0],
            diffMask: true,
        });
        for (let i = 0; i < W * H; i++)
            if (diffOut[i * 4 + 3] > 0) {
                mask[i] = 1;
                changed++;
            }
    }
    // ignore regions: drop their pixels, log what was suppressed
    for (const ig of ignoreRegions) {
        const r = pixelAnalysis ? clampRect(ig, W, H) : clampRect(ig, dev0.width, dev0.height);
        if (!r) {
            ignoredLog.push({ label: ig.label, rect: ig, suppressedPixels: 0 });
            continue;
        }
        let n = 0;
        if (pixelAnalysis)
            for (let y = r.y; y < r.y + r.height; y++)
                for (let x = r.x; x < r.x + r.width; x++) {
                    const i = y * W + x;
                    if (mask[i]) {
                        mask[i] = 0;
                        n++;
                    }
                }
        changed -= n;
        ignoredLog.push({ label: ig.label, rect: r, suppressedPixels: n });
    }
    const ratio = pixelAnalysis ? changed / (W * H) : 0;
    if (pixelAnalysis) {
        groups = groupRegions(mask, W, H, minRegion);
        if (ratio > 0.35)
            warnings.push(`${(ratio * 100).toFixed(0)}% of pixels differ — the screenshots may show different pages, scroll positions, zoom levels or loading states.`);
        if (groups.length > MAX_REGIONS)
            warnings.push(`${groups.length} changed regions found; the ${MAX_REGIONS} largest are listed individually.`);
        const kept = groups.length > MAX_REGIONS ? [...groups].sort((a, b) => b.pixels - a.pixels).slice(0, MAX_REGIONS) : groups;
        classified = kept.map((g) => classifyRegion(dev, prod, g.rect, g.pixels));
        if (alignment === 'scale' && !sameSize)
            for (const c of classified)
                c.confidence = +(c.confidence - 0.12).toFixed(2);
    }
    const regionPixels = groups.reduce((s, g) => s + g.pixels, 0);
    // canvas mapping: DEV source == canvas; PROD source = canvas * prodScale
    const devToCanvas = (r) => r;
    const prodToCanvas = (r) => ({ x: r.x / prodScaleX, y: r.y / prodScaleY, width: r.width / prodScaleX, height: r.height / prodScaleY });
    const pixelUnchanged = pixelAnalysis
        ? (d, p) => {
            const rs = [d && devToCanvas(d), p && prodToCanvas(p)].filter((x) => !!x);
            if (!rs.length)
                return false;
            // a box outside the compared canvas (top-left alignment extra area) cannot be vouched for
            if (rs.some((r) => r.x + r.width > W + 1 || r.y + r.height > H + 1))
                return false;
            const x0 = Math.min(...rs.map((r) => r.x)), y0 = Math.min(...rs.map((r) => r.y));
            const u = clampRect({ x: x0 - 2, y: y0 - 2, width: Math.max(...rs.map((r) => r.x + r.width)) - x0 + 4, height: Math.max(...rs.map((r) => r.y + r.height)) - y0 + 4 }, W, H);
            if (!u)
                return false;
            let n = 0;
            for (let y = u.y; y < u.y + u.height; y++)
                for (let x = u.x; x < u.x + u.width; x++)
                    if (mask[y * W + x] || diffOut[(y * W + x) * 4 + 3])
                        n++;
            return n <= Math.max(3, u.width * u.height * 0.002);
        }
        : undefined;
    // ---- OCR + data comparison
    let data = null;
    const ocrInfo = {
        requested: wantOcr, used: false, engine: null,
        note: !wantOcr ? (opts.ocr === false ? 'OCR turned off for this comparison.' : 'OCR not needed for the selected checks.') : ocrSt.note,
        devTextItems: 0, prodTextItems: 0, durationMs: 0,
    };
    if (ocrUsable) {
        try {
            const [od, op] = [await (0, screenshot_ocr_1.ocrImage)(dev0), await (0, screenshot_ocr_1.ocrImage)(prod0)];
            const scaleRect = (r) => ({ x: r.x * prodScaleX, y: r.y * prodScaleY, width: r.width * prodScaleX, height: r.height * prodScaleY });
            if (dataOnlyBySize && ignoreRegions.length && Math.abs(prodScaleX - prodScaleY) / prodScaleX > 0.01)
                warnings.push('Ignore regions were drawn on DEV and mapped proportionally onto PROD; with different aspect ratios they may not cover the same content on PROD.');
            data = (0, screenshot_data_1.diffData)({
                dev: od, prod: op, opts: textOpts,
                ignoreDev: ignoreRegions,
                ignoreProd: ignoreRegions.map(scaleRect),
                pixelUnchanged,
            });
            ignoredLog.forEach((l, i) => { l.suppressedTextItems = data.ignoredByRegion[i] || 0; });
            for (const [side, q, bad] of [['DEV', data.quality.dev, data.quality.devUnreadable], ['PROD', data.quality.prod, data.quality.prodUnreadable]])
                if (bad)
                    warnings.push(`${side} screenshot text is largely unreadable (median OCR confidence ${Math.round(q)}%, ${side === 'DEV' ? data.devItems : data.prodItems} text items vs ${side === 'DEV' ? data.prodItems : data.devItems} on the other side): data items are flagged “Uncertain / needs review” instead of reported as mismatches or missing. Re-capture at full resolution without compression or blur.`);
            ocrInfo.used = true;
            ocrInfo.engine = screenshot_ocr_1.OCR_ENGINE;
            ocrInfo.devTextItems = data.devItems;
            ocrInfo.prodTextItems = data.prodItems;
            ocrInfo.durationMs = od.durationMs + op.durationMs;
            ocrInfo.note = `Visible text read locally by ${screenshot_ocr_1.OCR_ENGINE}: ${data.devItems} DEV and ${data.prodItems} PROD text items, ${data.matched} matched.${data.noiseSuppressed ? ` ${data.noiseSuppressed} differing reading(s) over unchanged pixels treated as OCR noise.` : ''}${data.lowConfFragments ? ` ${data.lowConfFragments} illegible one-sided fragment(s) (<40% confidence) not reported.` : ''}`;
            limitations.push(`Text is read by local OCR (minimum confidence ${textOpts.minConfidence}%). Low-confidence readings are flagged “Uncertain / needs review”; OCR can misread small, stylized, low-contrast or blurry text.`, 'Rows and fields are matched by visible content and layout (row keys, labels, column headers); unusual layouts may pair items differently — check the highlighted boxes.');
        }
        catch (e) {
            ocrInfo.note = `OCR failed (${String(e?.message || e).slice(0, 140)}).`;
        }
    }
    if (has('data_text') && !ocrInfo.used) {
        limitations.push(`Data & Text is INCOMPLETE for this run: ${ocrInfo.note} Text changes are located by pixels and flagged for review, but their values are not extracted.`);
    }
    if (has('images_diagrams'))
        limitations.push('Images & Diagrams: plotted chart values are not read from pixels; only visible labels/legend text and visual changes are compared.');
    if (has('css_styling') || has('form_states'))
        limitations.push('Colors are sampled from pixels; font size/weight and enabled/disabled states are visual estimates, not verified CSS or DOM facts.');
    limitations.push('Pixel identity or matching text does not prove functional correctness.');
    const drafts = [];
    if (has('data_text') && data) {
        for (const it of data.items) {
            const missing = it.kind === 'missing-in-dev', extra = it.kind === 'extra-in-dev', unsure = it.kind === 'uncertain';
            const what = it.record ? `record${it.field ? ` “${it.field}”` : ''}` : it.field ? `“${it.field}”` : it.valueType === 'text' ? 'text' : it.valueType;
            const title = unsure
                ? `Uncertain — needs review: ${it.field ? `“${it.field}”` : it.devValue ?? it.prodValue}`
                : missing ? `Missing in DEV: ${what}`
                    : extra ? `Extra in DEV (not in PROD): ${what}`
                        : `${VALUE_TITLE[it.valueType]}${it.field ? ` — ${it.field}` : ''}`;
            const devBbox = it.devBox ? toBBox(it.devBox, 1, 1, dev0.width, dev0.height) : null;
            const prodBbox = it.prodBox ? toBBox(it.prodBox, 1, 1, prod0.width, prod0.height) : null;
            const high = it.record || ['number', 'currency', 'percent', 'identifier', 'date'].includes(it.valueType);
            drafts.push({
                _rect: it.devBox || prodToCanvas(it.prodBox),
                scope: 'data_text',
                status: it.kind,
                category: it.valueType === 'text' && !it.record ? 'text' : 'data',
                title,
                field: it.field || undefined,
                pageSection: it.section || undefined,
                devValue: it.devValue,
                prodValue: it.prodValue,
                valueType: it.valueType,
                expectedBaseline: 'PROD screenshot',
                devObservation: it.devValue !== null ? `“${it.devValue}”` : 'Not found',
                prodObservation: it.prodValue !== null ? `“${it.prodValue}”` : 'Not found',
                devBbox,
                prodBbox,
                evidence: it.explanation,
                confidence: Math.max(0.05, Math.min(0.99, it.confidence)),
                severitySuggestion: unsure ? 'low' : high ? 'high' : it.valueType === 'status' || missing || extra ? 'medium' : 'medium',
                reviewStatus: 'needs-review',
                reviewNote: unsure
                    ? 'OCR could not read this confidently — compare the highlighted boxes before deciding.'
                    : missing || extra
                        ? 'Confirm whether this item is expected to differ between DEV and PROD.'
                        : 'Confirm whether DEV is expected to contain different test data.',
                ignoredByRule: null,
                imageIds,
            });
        }
    }
    const dataBoxes = drafts.filter((d) => d.scope === 'data_text');
    const segCovers = (segs, b) => !!b && segs.some((s) => intersectArea(s.bbox, b) > 0.2 * s.bbox.width * s.bbox.height);
    /** Share of a pixel region (canvas px) lying inside any data finding's box on either side. */
    const coveredByData = (c, frac) => dataBoxes.some((d) => {
        const boxes = [d.devBbox, d.prodBbox && prodToCanvas(d.prodBbox)].filter((b) => !!b);
        const rects = [c.rect, c.devRect, c.prodRect];
        return rects.some((r) => boxes.some((b) => intersectArea(b, r) / Math.max(1, r.width * r.height) >= frac));
    });
    const textIn = (segs, b) => segs.filter((s) => intersectArea(s.bbox, b) > 0.3 * s.bbox.width * s.bbox.height).map((s) => s.text).join(' | ').slice(0, 200);
    /** Share of a region covered by OCR text boxes (0..1). */
    const textCoverage = (segs, b) => {
        if (!b)
            return 0;
        const area = Math.max(1, b.width * b.height);
        return Math.min(1, segs.reduce((s, x) => s + intersectArea(x.bbox, b), 0) / area);
    };
    const normTxt = (s) => s.toLowerCase().replace(/\s+/g, ' ').trim();
    /** Every text item touching the region (even a few changed glyphs inside a long value). */
    const textAt = (segs, b) => segs.filter((s) => intersectArea(s.bbox, b) > 0).map((s) => s.text).join(' | ');
    for (const c of [...classified, ...extraFindings]) {
        let category = c.category;
        let title = c.title;
        let evidence = c.evidence;
        let status = c.side === 'dev-only' ? 'extra-in-dev' : c.side === 'prod-only' ? 'missing-in-dev' : 'mismatch';
        let confidence = c.confidence;
        const prodSrcRect = { x: c.prodRect.x * prodScaleX, y: c.prodRect.y * prodScaleY, width: c.prodRect.width * prodScaleX, height: c.prodRect.height * prodScaleY };
        if (data) {
            // one wrong value must not also appear as pixel/CSS findings
            if (coveredByData(c, category === 'text' ? 0.05 : 0.5))
                continue;
            // text the user excluded with an ignored-field rule is excluded from every check
            const inIgnored = [...data.ignoredBoxes.dev, ...data.ignoredBoxes.prod.map(prodToCanvas)].some((b) => intersectArea(b, c.rect) >= 0.3 * Math.max(1, Math.min(c.rect.width * c.rect.height, b.width * b.height)));
            if (inIgnored)
                continue;
            const thin = c.rect.height < 6 || c.rect.width < 4;
            const devR = c.side === 'prod-only' ? null : c.devRect, prodR = c.side === 'dev-only' ? null : prodSrcRect;
            const covD = textCoverage(data.devSegs, devR), covP = textCoverage(data.prodSegs, prodR);
            const onText = !thin && Math.max(covD, covP) >= 0.35;
            if (onText && (category === 'text' || category === 'visual' || category === 'typography')) {
                const dt = devR ? normTxt(textAt(data.devSegs, devR)) : '', pt = prodR ? normTxt(textAt(data.prodSegs, prodR)) : '';
                // different text at the same spot (rows added/removed/re-sorted, values changed): the data check owns it
                if (dt !== pt || c.side !== 'both')
                    continue;
                // the same text read on both sides: a rendering/styling difference, never a data change
                category = 'typography';
                if (c.category !== 'typography') {
                    title = 'Text rendering differs (same text read on both sides)';
                    evidence = `${c.evidence} OCR reads the same text (“${dt.slice(0, 80)}”) in DEV and PROD, so this is styling, not data.`;
                }
            }
            else if (category === 'text') {
                if (segCovers(data.devSegs, devR) || segCovers(data.prodSegs, prodR))
                    continue; // partly read; data check owns it
                if (thin) {
                    category = 'layout';
                    title = 'Thin line/edge differs';
                    evidence = `${c.evidence} The changed area is only ${c.rect.width}×${c.rect.height}px — a border, rule or edge, not text.`;
                }
                else {
                    status = 'uncertain';
                    title = `Uncertain — text-like change OCR could not read`;
                    evidence = `${c.evidence} OCR found no readable text here on either side; compare the crops visually.`;
                    confidence = Math.min(confidence, 0.5);
                }
            }
            else if (category === 'visual' && has('images_diagrams')) {
                const dt = c.side === 'prod-only' ? '' : textIn(data.devSegs, c.devRect);
                const pt = c.side === 'dev-only' ? '' : textIn(data.prodSegs, prodSrcRect);
                if (dt || pt)
                    evidence += ` Text inside the region: DEV “${dt || '—'}”, PROD “${pt || '—'}”.`;
            }
        }
        else if (category === 'text') {
            status = 'uncertain';
            evidence = `${c.evidence}${ocrInfo.requested ? ` (${ocrInfo.note})` : ''}`;
        }
        const sc = screenshot_types_1.CATEGORY_SCOPE[category];
        if (!has(sc))
            continue; // unselected categories are neither run nor reported
        drafts.push({
            _rect: c.rect,
            scope: sc,
            status,
            category,
            title,
            devObservation: c.devObservation,
            prodObservation: c.prodObservation,
            devBbox: c.side === 'prod-only' ? null : toBBox(c.devRect, 1, 1, dev0.width, dev0.height),
            prodBbox: c.side === 'dev-only' ? null : toBBox(c.prodRect, prodScaleX, prodScaleY, prod0.width, prod0.height),
            evidence,
            confidence: Math.max(0.05, Math.min(0.99, confidence)),
            severitySuggestion: sc === 'data_text' || sc === 'images_diagrams' ? c.severity : c.severity === 'high' ? 'medium' : c.severity,
            reviewStatus: 'needs-review',
            ignoredByRule: null,
            imageIds,
            metrics: c.metrics,
        });
    }
    // ---- group repetitive optional findings (a font change touches every label; a taller header shifts the whole
    //      page) into one finding listing the locations, so styling noise never floods the report
    {
        const unionBox = (bs) => {
            const v = bs.filter((b) => !!b);
            if (!v.length)
                return null;
            const x = Math.min(...v.map((b) => b.x)), y = Math.min(...v.map((b) => b.y));
            return { ...v[0], x, y, width: Math.max(...v.map((b) => b.x + b.width)) - x, height: Math.max(...v.map((b) => b.y + b.height)) - y };
        };
        const keyOf = (d) => {
            if (d.scope === 'data_text' || d.status === 'uncertain')
                return null;
            if (d.category === 'layout' && d.metrics?.shiftX !== undefined)
                return `layout:${d.metrics.shiftX},${d.metrics.shiftY}`;
            return `${d.scope}:${d.category}`;
        };
        const buckets = new Map();
        for (const d of drafts) {
            const k = keyOf(d);
            if (k)
                buckets.set(k, [...(buckets.get(k) || []), d]);
        }
        for (const [k, ds] of buckets) {
            if (ds.length <= 5)
                continue;
            for (const d of ds)
                drafts.splice(drafts.indexOf(d), 1);
            const f = ds[0];
            const where = ds.slice(0, 12).map((d) => `(${d._rect.x}, ${d._rect.y}) ${d._rect.width}×${d._rect.height}`).join('; ');
            const label = k.startsWith('layout:')
                ? `${ds.length} areas shifted by (${f.metrics.shiftX}, ${f.metrics.shiftY})px in PROD`
                : f.category === 'typography' ? `Text rendering differs in ${ds.length} places (likely a font/size change)`
                    : f.category === 'color' ? `Color differs in ${ds.length} places`
                        : `${ds.length} similar ${f.category} differences`;
            const x = Math.min(...ds.map((d) => d._rect.x)), y = Math.min(...ds.map((d) => d._rect.y));
            drafts.push({
                ...f,
                _rect: { x, y, width: Math.max(...ds.map((d) => d._rect.x + d._rect.width)) - x, height: Math.max(...ds.map((d) => d._rect.y + d._rect.height)) - y },
                title: label,
                devObservation: `${ds.length} regions, e.g. ${f.devObservation}`,
                prodObservation: f.prodObservation,
                devBbox: unionBox(ds.map((d) => d.devBbox)),
                prodBbox: unionBox(ds.map((d) => d.prodBbox)),
                evidence: `Grouped ${ds.length} findings of the same kind. Locations (DEV px): ${where}${ds.length > 12 ? '; …' : ''}. Example: ${f.evidence}`,
                confidence: Math.max(...ds.map((d) => d.confidence)),
                severitySuggestion: ds.some((d) => d.severitySuggestion === 'medium' || d.severitySuggestion === 'high') ? 'medium' : 'low',
                metrics: { ...(f.metrics || {}), groupedFindings: ds.length },
            });
        }
    }
    // ---- priority order: data > images > optional; confirmed before uncertain; then top-to-bottom
    const scopeRank = (d) => screenshot_types_1.SHOT_SCOPES.indexOf(d.scope);
    drafts.sort((a, b) => scopeRank(a) - scopeRank(b) ||
        (a.status === 'uncertain' ? 1 : 0) - (b.status === 'uncertain' ? 1 : 0) ||
        (Math.abs(a._rect.y - b._rect.y) > 8 ? a._rect.y - b._rect.y : a._rect.x - b._rect.x));
    const counters = {};
    const findings = drafts.map(({ _rect, ...d }, i) => {
        const prefix = screenshot_types_1.SHOT_SCOPE_INFO[d.scope].code;
        counters[prefix] = (counters[prefix] || 0) + 1;
        return { id: stableId(`${d.category}:${d.title}`, _rect), number: i + 1, code: `${prefix}-${String(counters[prefix]).padStart(3, '0')}`, ...d };
    });
    if (pixelAnalysis && groups.length > MAX_REGIONS) {
        const rest = groups.length - MAX_REGIONS;
        findings.push({
            id: stableId('visual', { x: -1, y: -1, width: rest, height: 0 }),
            number: 0, code: 'NOTE', scope: null, status: 'uncertain', category: 'visual', title: `${rest} more small changed regions`,
            devObservation: 'Not listed individually', prodObservation: 'See the diff map',
            devBbox: null, prodBbox: null, evidence: 'Region cap reached; the diff map shows every changed pixel.',
            confidence: 0.5, severitySuggestion: 'low', reviewStatus: 'needs-review', ignoredByRule: null, imageIds,
        });
    }
    ignoredLog.forEach((log, i) => {
        findings.push({
            id: stableId('ignored', log.rect),
            number: 0,
            code: `IGN-${String(i + 1).padStart(3, '0')}`,
            scope: null,
            status: 'ignored',
            category: 'match',
            title: `Ignored by rule: ${log.label}`,
            devObservation: `Region (${log.rect.x}, ${log.rect.y}) ${log.rect.width}×${log.rect.height}px excluded`,
            prodObservation: [
                pixelAnalysis ? (log.suppressedPixels ? `${log.suppressedPixels.toLocaleString()} changed pixels suppressed` : 'No pixel changes inside this region') : null,
                log.suppressedTextItems ? `${log.suppressedTextItems} text item(s) excluded from the data comparison` : null,
            ].filter(Boolean).join('; ') || 'Nothing inside this region',
            devBbox: toBBox(log.rect, 1, 1, dev0.width, dev0.height),
            prodBbox: toBBox(log.rect, prodScaleX, prodScaleY, prod0.width, prod0.height),
            evidence: 'User-configured ignore region (e.g. clock, avatar, rotating banner).',
            confidence: 1,
            severitySuggestion: 'low',
            reviewStatus: 'expected',
            ignoredByRule: log.label,
            imageIds,
        });
    });
    const ignoredFields = data?.ignoredFields || textOpts.ignoreFields.map((rule) => ({ rule, devItems: [], prodItems: [] }));
    const realCount = drafts.length;
    const status = realCount === 0 ? 'no-differences' : 'compared';
    if (status === 'no-differences') {
        findings.unshift({
            id: stableId('match', { x: 0, y: 0, width: W, height: H }),
            number: 0,
            code: 'MATCH',
            scope: null,
            status: 'matched',
            category: 'match',
            title: 'No material differences within tolerance',
            devObservation: `Checked: ${scope.map((s) => screenshot_types_1.SHOT_SCOPE_INFO[s].label).join(', ')}`,
            prodObservation: [
                data ? `${data.matched} text item(s) matched` : null,
                pixelAnalysis ? (changed ? `${changed.toLocaleString()} isolated pixels below the region threshold` : 'No differing pixels') : 'Pixel diff skipped (different sizes, data only)',
            ].filter(Boolean).join(' · '),
            devBbox: null,
            prodBbox: null,
            evidence: pixelAnalysis ? `pixelmatch threshold ${threshold}, minimum region ${minRegion}px, anti-aliasing excluded.` : 'Text matched by content.',
            confidence: 0.95,
            severitySuggestion: 'low',
            reviewStatus: 'expected',
            ignoredByRule: null,
            imageIds,
        });
    }
    // ---- matched summary: 4x4 zones with no remaining differences
    const ZX = 4, ZY = 4;
    const zoneHit = new Uint8Array(ZX * ZY);
    if (pixelAnalysis)
        for (let y = 0; y < H; y++)
            for (let x = 0; x < W; x++)
                if (mask[y * W + x])
                    zoneHit[Math.min(ZY - 1, ((y * ZY) / H) | 0) * ZX + Math.min(ZX - 1, ((x * ZX) / W) | 0)] = 1;
    const identicalZones = pixelAnalysis ? zoneHit.reduce((s, v) => s + (v ? 0 : 1), 0) : 0;
    const byCat = {};
    const byScope = emptyByScope();
    for (const f of findings) {
        if (f.number <= 0 || !f.scope)
            continue;
        byCat[f.category] = (byCat[f.category] || 0) + 1;
        const s = byScope[f.scope];
        s.findings++;
        if (f.status === 'uncertain')
            s.uncertain++;
        else
            s.mismatches++;
    }
    // ---- evidence images
    const evidence = {};
    if (includeEvidence && pixelAnalysis) {
        const ov = Buffer.alloc(W * H * 4);
        for (let i = 0; i < W * H; i++) {
            const p = i * 4;
            if (mask[i]) {
                ov[p] = 255;
                ov[p + 1] = 30;
                ov[p + 2] = 30;
            }
            else if (diffOut[p + 3] > 0) {
                // changed but ignored: blue
                ov[p] = 60;
                ov[p + 1] = 130;
                ov[p + 2] = 255;
            }
            else {
                ov[p] = dev.data[p] * 0.45 + 40;
                ov[p + 1] = dev.data[p + 1] * 0.45 + 40;
                ov[p + 2] = dev.data[p + 2] * 0.45 + 40;
            }
            ov[p + 3] = 255;
        }
        for (const log of ignoredLog) {
            const r = clampRect(log.rect, W, H);
            if (!r)
                continue;
            for (let y = r.y; y < r.y + r.height; y++)
                for (let x = r.x; x < r.x + r.width; x++) {
                    const p = (y * W + x) * 4;
                    ov[p + 2] = Math.min(255, ov[p + 2] + 70);
                }
        }
        evidence.diffPngBase64 = (await rawToPng({ data: ov, width: W, height: H })).toString('base64');
        if (!sameSize) {
            evidence.devCanvasPngBase64 = (await rawToPng(dev)).toString('base64');
            evidence.prodCanvasPngBase64 = (await rawToPng(prod)).toString('base64');
        }
    }
    const all = findings.filter((f) => f.number > 0);
    return {
        ...base,
        status,
        canvas: { width: W, height: H },
        alignment: { mode: sameSize || dataOnlyBySize ? 'none' : alignment, required: false, description: alignDesc, prodScaleX, prodScaleY },
        settings,
        pixelAnalysis,
        ocr: ocrInfo,
        warnings,
        findings,
        ignoredLog,
        ignoredFields,
        summary: {
            byScope,
            matchedItems: data ? data.matched : 0,
            confirmedMismatches: all.filter((f) => f.status !== 'uncertain').length,
            uncertainItems: all.filter((f) => f.status === 'uncertain').length,
            ocrNoiseSuppressed: data ? data.noiseSuppressed : 0,
            totalFindings: realCount,
            matches: status === 'no-differences' ? 1 : 0,
            mismatchesByCategory: byCat,
            diffPercent: +(ratio * 100).toFixed(3),
            similarityPercent: pixelAnalysis ? +((1 - ratio) * 100).toFixed(2) : 0,
            identicalZones,
            totalZones: pixelAnalysis ? ZX * ZY : 0,
            subThresholdPixels: Math.max(0, changed - regionPixels),
            limitations,
        },
        evidence,
    };
}
/** Canvas-space images and regions the optional AI step needs (kept out of the JSON result). */
async function alignedPair(devBuf, prodBuf, result) {
    const dev0 = await decodeScreenshot(devBuf, 'DEV');
    const prod0 = await decodeScreenshot(prodBuf, 'PROD');
    const { width, height } = result.canvas;
    if (!result.pixelAnalysis || (dev0.width === prod0.width && dev0.height === prod0.height))
        return { dev: dev0, prod: prod0 };
    if (result.alignment.mode === 'scale')
        return { dev: dev0, prod: await scaleRaw(prod0, width, height) };
    return {
        dev: cropRaw(dev0, { x: 0, y: 0, width, height }),
        prod: cropRaw(prod0, { x: 0, y: 0, width, height }),
    };
}
/** PNG crop of a canvas-space rect with some context, downscaled to at most `maxEdge`. */
async function cropPng(img, r, context = 16, maxEdge = 512) {
    const c = pad(r, context, img.width, img.height);
    const raw = cropRaw(img, c);
    return (0, sharp_1.default)(raw.data, { raw: { width: raw.width, height: raw.height, channels: 4 } })
        .resize(maxEdge, maxEdge, { fit: 'inside', withoutEnlargement: true })
        .png()
        .toBuffer();
}
