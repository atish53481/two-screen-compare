/**
 * Local OCR for the Two Screen Comparison tab (Data & Text scope).
 *
 * Tesseract (tesseract.js, WASM) runs inside this server process with the English model shipped in
 * node_modules/@tesseract.js-data/eng — no network, no third party. Screenshots are preprocessed for UI text:
 * grayscale, 2x upscale for small UI fonts, local inversion of dark areas (headers, buttons, dark mode), removal
 * of thin table rules/borders (which otherwise make Tesseract drop whole table rows), Sauvola binarization, plus a
 * second pass on the fully inverted image for light text on mid-tone backgrounds. Word boxes are returned in the
 * ORIGINAL image's pixels.
 *
 * Disable with QA_VISION_OCR=off. Override the model folder with QA_VISION_TESSDATA.
 */
import fs from 'fs';
import path from 'path';
import sharp from 'sharp';
import { createWorker, type Worker } from 'tesseract.js';
import type { ShotRect } from './screenshot-types';

export interface OcrWord {
  text: string;
  /** 0-100 */
  conf: number;
  bbox: ShotRect;
}
export interface OcrLine {
  words: OcrWord[];
}
export interface OcrResult {
  lines: OcrLine[];
  width: number;
  height: number;
  durationMs: number;
}
export interface OcrImage {
  data: Buffer; // RGBA
  width: number;
  height: number;
}

export const OCR_ENGINE = 'Tesseract (tesseract.js, local, eng)';
const IDLE_MS = 60_000;
const JOB_TIMEOUT_MS = 45_000;

export class OcrUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'OcrUnavailableError';
  }
}

function langDir(): string | null {
  const rel = path.join('node_modules', '@tesseract.js-data', 'eng', '4.0.0_best_int');
  const candidates = [
    process.env.QA_VISION_TESSDATA,
    path.join(process.cwd(), rel),
    path.join(process.cwd(), 'qa-vision', rel),
    path.resolve(__dirname, '..', '..', rel), // engine-dist/engine -> qa-vision
    path.resolve(__dirname, '..', '..', '..', rel),
  ].filter((c): c is string => !!c);
  for (const c of candidates) {
    try {
      if (fs.existsSync(path.join(c, 'eng.traineddata.gz')) || fs.existsSync(path.join(c, 'eng.traineddata'))) return c;
    } catch {
      /* try next */
    }
  }
  return null;
}

/** Whether OCR can run on this server (no side effects). */
export function ocrStatus(): { available: boolean; engine: string | null; note: string } {
  if ((process.env.QA_VISION_OCR || '').toLowerCase() === 'off')
    return { available: false, engine: null, note: 'OCR disabled by QA_VISION_OCR=off.' };
  if (!langDir())
    return { available: false, engine: null, note: 'OCR model not found (npm install @tesseract.js-data/eng, or set QA_VISION_TESSDATA).' };
  return { available: true, engine: OCR_ENGINE, note: 'Local OCR available; screenshots never leave this server.' };
}

let workerP: Promise<Worker> | null = null;
let idleTimer: NodeJS.Timeout | null = null;
let chain: Promise<unknown> = Promise.resolve();

async function getWorker(): Promise<Worker> {
  if (!workerP) {
    const dir = langDir();
    if (!dir) throw new OcrUnavailableError(ocrStatus().note);
    const gz = fs.existsSync(path.join(dir, 'eng.traineddata.gz'));
    workerP = (async () => {
      const w = await createWorker('eng', 1, {
        langPath: dir,
        gzip: gz,
        cacheMethod: 'none', // never write model caches into the working directory
        logger: () => {},
        errorHandler: () => {},
      });
      await w.setParameters({ tessedit_pageseg_mode: '3' as never, preserve_interword_spaces: '1' });
      return w;
    })();
    workerP.catch(() => {
      workerP = null;
    });
  }
  return workerP;
}

/** Terminate the OCR worker (tests, shutdown). Safe to call when none is running. */
export async function shutdownOcr(): Promise<void> {
  if (idleTimer) clearTimeout(idleTimer);
  idleTimer = null;
  const p = workerP;
  workerP = null;
  if (p) {
    try {
      await (await p).terminate();
    } catch {
      /* already gone */
    }
  }
}

function touchIdle() {
  if (idleTimer) clearTimeout(idleTimer);
  idleTimer = setTimeout(() => void shutdownOcr(), IDLE_MS);
  idleTimer.unref();
}

/**
 * Whiten thin horizontal/vertical rules (table grid lines, card borders). A dark run longer than ~4% of the image
 * that is at most `thick` px thick is a rule, not a glyph; filled areas (buttons, badges) are kept because their
 * pixels a few px above/below are also dark.
 */
export function removeRules(g: Buffer, W: number, H: number, scale: number): void {
  const dark = (i: number) => g[i] < 215;
  const thick = 3 * scale + 1;
  const minH = Math.max(40 * scale, W * 0.04);
  const minV = Math.max(30 * scale, H * 0.04);
  const kill: number[] = [];
  for (let y = 0; y < H; y++) {
    let s = -1;
    for (let x = 0; x <= W; x++) {
      const d = x < W && dark(y * W + x);
      if (d && s < 0) s = x;
      if (!d && s >= 0) {
        if (x - s >= minH)
          for (let k = s; k < x; k++) {
            const up = y - thick >= 0 && dark((y - thick) * W + k);
            const down = y + thick < H && dark((y + thick) * W + k);
            if (!(up && down)) kill.push(y * W + k);
          }
        s = -1;
      }
    }
  }
  for (let x = 0; x < W; x++) {
    let s = -1;
    for (let y = 0; y <= H; y++) {
      const d = y < H && dark(y * W + x);
      if (d && s < 0) s = y;
      if (!d && s >= 0) {
        if (y - s >= minV)
          for (let k = s; k < y; k++) {
            const left = x - thick >= 0 && dark(k * W + x - thick);
            const right = x + thick < W && dark(k * W + x + thick);
            if (!(left && right)) kill.push(k * W + x);
          }
        s = -1;
      }
    }
  }
  for (const i of kill) g[i] = 255;
}

/**
 * Light text on dark/colored areas (headers, buttons, badges) -> dark on light, which Tesseract reads far better.
 * A pixel is inverted when most pixels in the (2r+1)^2 window around it are dark (window counts via an integral
 * image, O(pixels)).
 */
export function invertDarkAreas(g: Buffer, W: number, H: number, r: number): void {
  const I = new Uint32Array((W + 1) * (H + 1));
  for (let y = 0; y < H; y++) {
    let row = 0;
    for (let x = 0; x < W; x++) {
      row += g[y * W + x] < 128 ? 1 : 0;
      I[(y + 1) * (W + 1) + x + 1] = I[y * (W + 1) + x + 1] + row;
    }
  }
  const frac = (x: number, y: number, rr: number) => {
    const y0 = Math.max(0, y - rr), y1 = Math.min(H, y + rr + 1), x0 = Math.max(0, x - rr), x1 = Math.min(W, x + rr + 1);
    return (I[y1 * (W + 1) + x1] - I[y0 * (W + 1) + x1] - I[y1 * (W + 1) + x0] + I[y0 * (W + 1) + x0]) / ((x1 - x0) * (y1 - y0));
  };
  // two scales: the small window catches buttons/badges, the large one keeps big bold glyphs inside a dark header
  // from being split (their thick strokes make a small window look "light")
  const big = r * 3;
  const flip = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (frac(x, y, r) > 0.6 || frac(x, y, big) > 0.55) flip[y * W + x] = 1;
  for (let i = 0; i < W * H; i++) if (flip[i]) g[i] = 255 - g[i];
}

/**
 * Sauvola local binarization: text black, any background (white, grey header, tinted card) white. Global
 * thresholds lose mid-grey areas; this keeps them readable.
 */
export function binarize(g: Buffer, W: number, H: number, r: number, k = 0.2): void {
  const S = new Float64Array((W + 1) * (H + 1));
  const Q = new Float64Array((W + 1) * (H + 1));
  for (let y = 0; y < H; y++) {
    let rs = 0, rq = 0;
    for (let x = 0; x < W; x++) {
      const v = g[y * W + x];
      rs += v;
      rq += v * v;
      S[(y + 1) * (W + 1) + x + 1] = S[y * (W + 1) + x + 1] + rs;
      Q[(y + 1) * (W + 1) + x + 1] = Q[y * (W + 1) + x + 1] + rq;
    }
  }
  const out = Buffer.alloc(W * H);
  for (let y = 0; y < H; y++) {
    const y0 = Math.max(0, y - r), y1 = Math.min(H, y + r + 1);
    for (let x = 0; x < W; x++) {
      const x0 = Math.max(0, x - r), x1 = Math.min(W, x + r + 1);
      const n = (x1 - x0) * (y1 - y0);
      const a = y1 * (W + 1) + x1, b = y0 * (W + 1) + x1, c = y1 * (W + 1) + x0, d = y0 * (W + 1) + x0;
      const m = (S[a] - S[b] - S[c] + S[d]) / n;
      const sd = Math.sqrt(Math.max(0, (Q[a] - Q[b] - Q[c] + Q[d]) / n - m * m));
      const t = m * (1 + k * (sd / 128 - 1));
      out[y * W + x] = g[y * W + x] < t ? 0 : 255;
    }
  }
  out.copy(g);
}

/** Checkbox/radio outlines and table bars that OCR reads as "[J", "[]", "(J", "|": not text. */
function isGlyphNoise(text: string, conf: number): boolean {
  if (/^[\[\](){}|]+[A-Za-z0-9]?$|^[A-Za-z0-9]?[\[\](){}|]+$/.test(text)) return true;
  if (conf < 10) return true; // Tesseract's "I saw something" placeholder readings
  return text.length <= 2 && conf < 60;
}

/**
 * Two binarized renderings: (1) the main pass with dark areas locally inverted (reads dark headers, colored buttons
 * and dark mode), and (2) the fully inverted image, which catches light text on mid-tone backgrounds such as a
 * greyed-out button. Each pass removes thin rules and applies Sauvola binarization.
 */
async function preprocess(img: OcrImage): Promise<{ normal: Buffer; inverted: Buffer; scale: number }> {
  const scale = img.width < 1600 && img.width * img.height * 4 <= 16_777_216 ? 2 : 1;
  const W = img.width * scale, H = img.height * scale;
  const { data, info } = await sharp(img.data, { raw: { width: img.width, height: img.height, channels: 4 } })
    .removeAlpha()
    .toColourspace('b-w')
    .resize(W, H, { kernel: 'lanczos3' })
    .raw()
    .toBuffer({ resolveWithObject: true });
  let g: Buffer = data;
  if (info.channels !== 1) {
    g = Buffer.alloc(W * H);
    for (let i = 0; i < W * H; i++) g[i] = data[i * info.channels];
  }
  const inv = Buffer.alloc(g.length);
  for (let i = 0; i < g.length; i++) inv[i] = 255 - g[i];
  const finish = async (b: Buffer) => {
    removeRules(b, W, H, scale);
    binarize(b, W, H, 15 * scale);
    return sharp(b, { raw: { width: W, height: H, channels: 1 } }).png().toBuffer();
  };
  const normal = Buffer.from(g);
  invertDarkAreas(normal, W, H, 10 * scale); // dark headers/buttons/dark mode -> dark text on light
  return { normal: await finish(normal), inverted: await finish(inv), scale };
}

const iou = (a: ShotRect, b: ShotRect) => {
  const ix = Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x));
  const iy = Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y));
  const i = ix * iy;
  return i / Math.max(1, a.width * a.height + b.width * b.height - i);
};

/** Intersection over the smaller box. */
const contain = (a: ShotRect, b: ShotRect) => {
  const ix = Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x));
  const iy = Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y));
  return (ix * iy) / Math.max(1, Math.min(a.width * a.height, b.width * b.height));
};

/** Merge the two passes: per overlapping word keep the more confident reading; the inverted pass only adds
 *  confidently read words (it sees white page areas as dark blocks and can hallucinate in them). */
export function mergePasses(normal: OcrLine[], inverted: OcrLine[], minAddConf = 75): OcrLine[] {
  const all = normal.flatMap((l) => l.words);
  const out: OcrLine[] = normal.map((l) => ({ words: [...l.words] }));
  for (const l of inverted) {
    const add: OcrWord[] = [];
    for (const w of l.words) {
      // overlap measured as containment, so one garbled word spanning two real words still clashes with both
      const clash = all.filter((n) => iou(n.bbox, w.bbox) > 0.2 || contain(n.bbox, w.bbox) > 0.5);
      if (!clash.length) {
        if (w.conf >= minAddConf) add.push(w);
        continue;
      }
      if (clash.every((n) => w.conf > n.conf + 5)) {
        for (const line of out) line.words = line.words.filter((n) => !clash.includes(n));
        add.push(w);
      }
    }
    if (add.length) {
      out.push({ words: add });
      all.push(...add);
    }
  }
  return out.filter((l) => l.words.length);
}

interface TessWord { text: string; confidence: number; bbox: { x0: number; y0: number; x1: number; y1: number } }
interface TessBlock { paragraphs: Array<{ lines: Array<{ words: TessWord[] }> }> }

/** Read visible text with word boxes (original-image pixels). Throws OcrUnavailableError or a timeout error. */
export async function ocrImage(img: OcrImage): Promise<OcrResult> {
  const st = ocrStatus();
  if (!st.available) throw new OcrUnavailableError(st.note);
  const run = async (): Promise<OcrResult> => {
    const t0 = Date.now();
    const { normal, inverted, scale } = await preprocess(img);
    const worker = await getWorker();
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(`OCR timed out after ${JOB_TIMEOUT_MS / 1000}s`)), JOB_TIMEOUT_MS);
    });
    type Data = { blocks?: TessBlock[] | null };
    let dn: Data, di: Data;
    try {
      const both = (async () => {
        const a = (await worker.recognize(normal, {}, { blocks: true })).data as unknown as Data;
        const b = (await worker.recognize(inverted, {}, { blocks: true })).data as unknown as Data;
        return [a, b] as const;
      })();
      [dn, di] = await Promise.race([both, timeout]);
    } catch (e) {
      await shutdownOcr(); // a stuck worker is replaced on the next call
      throw e;
    } finally {
      if (timer) clearTimeout(timer);
      touchIdle();
    }
    const lines = mergePasses(toLines(dn, scale), toLines(di, scale));
    return { lines, width: img.width, height: img.height, durationMs: Date.now() - t0 };
  };
  // one job at a time on the shared worker
  const p = chain.then(run, run);
  chain = p.catch(() => undefined);
  return p;
}

function toLines(data: { blocks?: TessBlock[] | null }, scale: number): OcrLine[] {
    const lines: OcrLine[] = [];
    for (const b of data.blocks || [])
      for (const p of b.paragraphs || [])
        for (const l of p.lines || []) {
          const words: OcrWord[] = [];
          const ws = l.words || [];
          for (let k = 0; k < ws.length; k++) {
            const w = ws[k];
            let text = String(w.text || '').trim();
            // a button/badge edge read as an unbalanced bracket: "(Add" -> "Add" (balanced "(1,250)" is kept)
            if (/^[(\[{]/.test(text) && !/[)\]}]/.test(text)) text = text.slice(1);
            if (/[)\]}]$/.test(text) && !/[(\[{]/.test(text)) text = text.slice(0, -1);
            if (!text || !/[\p{L}\p{N}]/u.test(text)) continue; // table bars, bullets, stray punctuation
            if (isGlyphNoise(text, w.confidence)) continue;
            // an empty checkbox/radio read as "O"/"0"/"o" right before a label
            const bw = w.bbox.x1 - w.bbox.x0, bh = w.bbox.y1 - w.bbox.y0;
            if (k === 0 && ws.length > 1 && /^[OoQ0D]$/.test(text) && bw / Math.max(1, bh) > 0.75 && bw / Math.max(1, bh) < 1.35) continue;
            const x = Math.max(0, Math.floor(w.bbox.x0 / scale)), y = Math.max(0, Math.floor(w.bbox.y0 / scale));
            words.push({
              text,
              conf: Math.max(0, Math.min(100, Math.round(w.confidence))),
              bbox: { x, y, width: Math.max(1, Math.ceil(w.bbox.x1 / scale) - x), height: Math.max(1, Math.ceil(w.bbox.y1 / scale) - y) },
            });
          }
          if (words.length) lines.push({ words });
        }
    return lines;
}
