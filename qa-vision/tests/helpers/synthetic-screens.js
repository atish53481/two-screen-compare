/**
 * Draws small synthetic "UI screenshots" (header, clock, title, button, icon, table rows) as PNGs, so screenshot
 * comparison tests and the sample images in public/test-screenshots/ need no binary fixtures in git.
 * Every option changes exactly one visible thing, which lets tests assert one localized finding per change.
 */
const { PNG } = require('pngjs');

const DEFAULTS = {
  width: 480,
  height: 320,
  buttonColor: [37, 99, 235], // blue
  buttonDisabled: false,
  clockSeed: 1,
  iconPresent: true,
  titleSeed: 7,
  titleShiftX: 0,
  valueSeed: 3, // a number in the table
  textHeight: 12,
  background: [255, 255, 255],
};

function canvas(w, h, bg) {
  const png = new PNG({ width: w, height: h });
  for (let i = 0; i < w * h; i++) {
    png.data[i * 4] = bg[0];
    png.data[i * 4 + 1] = bg[1];
    png.data[i * 4 + 2] = bg[2];
    png.data[i * 4 + 3] = 255;
  }
  return png;
}

function rect(png, x, y, w, h, c) {
  for (let yy = Math.max(0, y); yy < Math.min(png.height, y + h); yy++)
    for (let xx = Math.max(0, x); xx < Math.min(png.width, x + w); xx++) {
      const i = (yy * png.width + xx) * 4;
      png.data[i] = c[0];
      png.data[i + 1] = c[1];
      png.data[i + 2] = c[2];
      png.data[i + 3] = 255;
    }
}

/** Text-like strokes: "glyphs" 2-3px wide with gaps, heights from a seeded pattern. */
function text(png, x, y, chars, h, c, seed) {
  let s = seed * 9301 + 49297;
  const rnd = () => ((s = (s * 9301 + 49297) % 233280) / 233280);
  let cx = x;
  for (let i = 0; i < chars; i++) {
    const gw = 2 + Math.floor(rnd() * 2);
    const gh = Math.max(3, Math.round(h * (0.55 + rnd() * 0.45)));
    rect(png, cx, y + (h - gh), gw, gh, c);
    if (rnd() > 0.5) rect(png, cx + gw, y + (h - gh), 2, 2, c); // a serif-ish bump
    cx += gw + 3;
    if (rnd() > 0.85) cx += 4; // word gap
  }
}

/** Returns a PNG buffer. */
function drawScreen(opts = {}) {
  const o = { ...DEFAULTS, ...opts };
  const png = canvas(o.width, o.height, o.background);
  // header
  rect(png, 0, 0, o.width, 40, [24, 24, 27]);
  text(png, 16, 14, 10, 12, [240, 240, 240], 11); // app name
  text(png, o.width - 70, 14, 5, 12, [240, 240, 240], o.clockSeed); // clock (top-right)
  // page title
  text(png, 24 + o.titleShiftX, 64, 16, o.textHeight + 6, [17, 17, 17], o.titleSeed);
  // primary button
  const btn = o.buttonDisabled ? [160, 160, 160] : o.buttonColor;
  rect(png, 24, 110, 120, 36, btn);
  text(png, 44, 122, 10, 12, [255, 255, 255], 5);
  // icon (top-right of content)
  if (o.iconPresent) {
    rect(png, o.width - 64, 104, 32, 32, [220, 38, 38]);
    rect(png, o.width - 56, 112, 16, 16, [255, 255, 255]);
  }
  // table rows
  for (let r = 0; r < 4; r++) {
    const y = 180 + r * 30;
    rect(png, 24, y + 24, o.width - 48, 1, [228, 228, 231]);
    text(png, 32, y + 6, 8, o.textHeight, [63, 63, 70], 20 + r);
    text(png, o.width - 120, y + 6, 4, o.textHeight, [63, 63, 70], r === 1 ? o.valueSeed : 30 + r); // numeric column
  }
  return PNG.sync.write(png);
}

module.exports = { drawScreen, DEFAULTS };
