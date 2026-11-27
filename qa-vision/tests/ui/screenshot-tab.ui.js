#!/usr/bin/env node
/**
 * Two Screen Comparison tab, end to end in headless Chromium:   npm run test:ui:screenshot
 * Targets a running dashboard (QA_VISION_URL, default http://localhost:3001; start it with `npm run start:real`).
 * The tab is stateless (nothing stored), so running against the real dashboard touches no data.
 * Uses the synthetic images in public/test-screenshots/ (regenerate: node scripts/make-test-screenshots.js) for the
 * pixel checks and the browser-rendered real-text images in public/test-screenshots/data/ for the data-first checks.
 * QA_VISION_SHOTS=<dir> saves page screenshots for manual review.
 */
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const BASE = process.env.QA_VISION_URL || 'http://localhost:3001';
const IMG = path.resolve(__dirname, '..', '..', 'public', 'test-screenshots');
const SHOTS = process.env.QA_VISION_SHOTS || '';
const img = (n) => path.join(IMG, n);
const ALL_SCOPES = ['data_text', 'images_diagrams', 'css_styling', 'alignment_layout', 'form_states'];

let failures = 0;
async function step(name, fn) {
  try {
    await fn();
    console.log(`  ✔ ${name}`);
  } catch (e) {
    failures++;
    console.log(`  ✖ ${name}\n      ${String(e && e.message ? e.message : e).split('\n').slice(0, 4).join('\n      ')}`);
  }
}
function assert(c, msg) {
  if (!c) throw new Error(msg);
}

(async () => {
  if (!fs.existsSync(img('prod-reference.png'))) require('child_process').execFileSync(process.execPath, [path.join(__dirname, '..', '..', 'scripts', 'make-test-screenshots.js')]);
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1500, height: 1000 }, acceptDownloads: true });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  const shot = async (name) => SHOTS && (await page.screenshot({ path: path.join(SHOTS, `${name}.png`), fullPage: true }));

  console.log(`Two Screen Comparison UI tests against ${BASE}`);
  await page.goto(BASE, { waitUntil: 'networkidle' });
  const T = (id) => page.getByTestId(id);
  const K = {}; // finding numbers by kind (numbering follows report priority)

  await step('existing tabs still render; new tab opens', async () => {
    for (const t of ['Profiles', 'Live Comparison', 'Execution Log', 'History', 'Reports']) assert(await page.getByRole('button', { name: t, exact: true }).count(), `tab ${t} missing`);
    await page.getByRole('button', { name: 'Two Screen Comparison', exact: true }).click();
    await T('screenshot-comparison').waitFor();
    assert(await T('privacy-warning').isVisible(), 'privacy warning shown');
    assert(await T('compare').isDisabled(), 'compare disabled with no images');
    assert((await T('panel-dev').textContent()).includes('DEV (New Changes)'), 'DEV label');
    assert((await T('panel-prod').textContent()).includes('PROD (Reference)'), 'PROD label');
  });

  await step('scope: Data & Text checked by default, every other category unchecked', async () => {
    assert(await T('scope-data_text').isChecked(), 'Data & Text checked');
    for (const s of ALL_SCOPES.slice(1)) assert(!(await T('scope-' + s).isChecked()), s + ' unchecked');
  });

  await step('bad image → actionable error, nothing loaded', async () => {
    await T('file-dev').setInputFiles({ name: 'bad.png', mimeType: 'image/png', buffer: Buffer.from('not really a png at all, just text') });
    await T('error').waitFor();
    assert(/Invalid image/.test(await T('error').textContent()), 'invalid image message');
    assert(!(await T('preview-dev').count()), 'no DEV preview');
  });

  await step('paste goes to the focused panel only', async () => {
    const b64 = fs.readFileSync(img('prod-reference.png')).toString('base64');
    await T('panel-prod').click();
    assert((await T('panel-prod').getAttribute('data-active')) === 'true', 'PROD panel active');
    await page.evaluate(async (data) => {
      const bin = Uint8Array.from(atob(data), (c) => c.charCodeAt(0));
      const dt = new DataTransfer();
      dt.items.add(new File([bin], 'clip.png', { type: 'image/png' }));
      document.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true }));
    }, b64);
    await T('preview-prod').waitFor();
    assert(!(await T('preview-dev').count()), 'DEV panel untouched by paste');
  });

  await step('drag-and-drop into DEV panel', async () => {
    const b64 = fs.readFileSync(img('dev-identical.png')).toString('base64');
    const dt = await page.evaluateHandle((data) => {
      const bin = Uint8Array.from(atob(data), (c) => c.charCodeAt(0));
      const d = new DataTransfer();
      d.items.add(new File([bin], 'dropped.png', { type: 'image/png' }));
      return d;
    }, b64);
    await T('panel-dev').dispatchEvent('dragover', { dataTransfer: dt });
    await T('panel-dev').dispatchEvent('drop', { dataTransfer: dt });
    await T('preview-dev').waitFor();
    assert((await T('meta-dev').textContent()).includes('dropped.png'), 'dropped file name');
    assert(await T('compare').isEnabled(), 'compare enabled with two valid images');
  });

  await step('identical images → "No material differences within tolerance"', async () => {
    for (const s of ALL_SCOPES.slice(1)) await T('scope-' + s).check(); // synthetic images: exercise every pixel check
    await T('compare').click();
    await T('no-differences').waitFor({ timeout: 30000 });
    assert(/No material differences within tolerance/.test(await T('no-differences').textContent()), 'celebration text');
    await shot('01-identical');
  });

  await step('several changes → numbered findings with boxes on both images', async () => {
    await T('file-dev').setInputFiles(img('dev-several-changes.png'));
    await page.waitForFunction(() => document.querySelector('[data-testid="meta-dev"]')?.textContent.includes('dev-several-changes'));
    assert(!(await T('results').count()), 'old result cleared when an image changes');
    await T('opt-page').fill('Users list');
    await T('compare').click();
    await T('finding-1').waitFor({ timeout: 30000 });
    const n = await page.locator('[data-testid^="finding-"]').count();
    assert(n === 4, `expected 4 findings, got ${n}`);
    const cards = await page.locator('[data-testid^="finding-"]').evaluateAll((els) => els.map((e) => [Number(e.dataset.testid.slice(8)), e.textContent]));
    const num = (re) => (cards.find(([, t]) => re.test(t)) || [0])[0];
    K.icon = num(/Missing in DEV/);
    K.color = num(/color changed/i);
    K.layout = num(/shifted/);
    assert(K.icon && K.color && K.layout, 'kinds found: ' + JSON.stringify(K));
    const codes = await page.locator('[data-testid^="code-"]').allTextContents();
    assert(codes[0].startsWith('DATA-') && codes.some((c) => c.startsWith('IMG-')) && codes.some((c) => c.startsWith('CSS-')), 'priority order + codes: ' + codes);
    assert(await T('anno-dev-' + K.color).count(), 'DEV annotation for the color change');
    assert(await T('anno-prod-' + K.icon).count(), 'PROD annotation (icon missing in DEV)');
    assert(!(await T('anno-dev-' + K.icon).count()), 'no DEV box for an element only in PROD');
    await shot('02-findings');
  });

  await step('click a finding → selected, zoomed, highlight stays on the box after zoom/pan', async () => {
    await T('finding-' + K.color).click();
    assert((await T('finding-' + K.color).getAttribute('data-selected')) === 'true', 'selected');
    const zoom = await T('zoom-level').textContent();
    assert(zoom !== '100%', `zoomed in (got ${zoom})`);
    // the selected box must be inside the visible pane on both sides
    for (const side of ['dev', 'prod']) {
      const pane = await T(`viewer-${side}`).boundingBox();
      const box = await T(`anno-${side}-${K.color}`).locator('rect').nth(1).boundingBox();
      assert(box && box.x >= pane.x - 1 && box.x + box.width <= pane.x + pane.width + 1 && box.y >= pane.y - 1 && box.y + box.height <= pane.y + pane.height + 1, `${side} box visible in pane`);
    }
    // the box tracks the image: its position relative to the image is the same before and after a pan
    const rel = async () => {
      const im = await T('viewer-dev').locator('img').boundingBox();
      const b = await T('anno-dev-' + K.color).locator('rect').nth(1).boundingBox();
      return [(b.x - im.x) / im.width, (b.y - im.y) / im.height];
    };
    const before = await rel();
    const pane = await T('viewer-dev').boundingBox();
    await page.mouse.move(pane.x + 200, pane.y + 300);
    await page.mouse.down();
    await page.mouse.move(pane.x + 120, pane.y + 260, { steps: 5 });
    await page.mouse.up();
    const after = await rel();
    assert(Math.abs(before[0] - after[0]) < 0.002 && Math.abs(before[1] - after[1]) < 0.002, `annotation drifted ${before} → ${after}`);
    await shot('03-selected');
  });

  await step('click a box on the image → its finding is selected', async () => {
    await page.getByRole('button', { name: 'Fit' }).click();
    await T('anno-dev-' + K.layout).locator('rect').last().click({ force: true });
    assert((await T('finding-' + K.layout).getAttribute('data-selected')) === 'true', 'finding selected from image');
  });

  await step('review status, filters, view modes', async () => {
    await T('review-' + K.color + '-confirmed-defect').click();
    assert((await T('review-' + K.color + '-confirmed-defect').getAttribute('aria-checked')) === 'true', 'review recorded');
    await T('filter-color').click();
    assert((await page.locator('[data-testid^="finding-"]').count()) === 1, 'category filter');
    await T('filter-color').click();
    for (const m of ['overlay', 'slider', 'diff', 'side']) {
      await T(`mode-${m}`).click();
      await T(m === 'side' ? 'viewer-dev' : `viewer-${m}`).waitFor();
    }
    await T('toggle-annotations').click();
    assert(!(await T('anno-dev-1').count()), 'annotations hidden');
    await T('toggle-annotations').click();
  });

  await step('exports: JSON and self-contained HTML keep findings, boxes, originals, reviews', async () => {
    const [dj] = await Promise.all([page.waitForEvent('download'), T('export-json').click()]);
    const json = JSON.parse(fs.readFileSync(await dj.path(), 'utf8'));
    assert(json.findings.filter((f) => f.number > 0).length === 4, 'JSON findings');
    assert(json.findings.some((f) => f.reviewStatus === 'confirmed-defect'), 'JSON review status');
    assert(json.findings[0].devBbox?.coordinateSystem === 'source-pixels-top-left' || json.findings.some((f) => f.devBbox?.sourceWidth === 480), 'JSON bbox with source dims');
    assert(/^data:image\/png;base64,/.test(json.originals.dev.dataUrl) && /^data:image\/png;base64,/.test(json.originals.prod.dataUrl), 'JSON originals');
    assert(json.pageName === 'Users list', 'page name');
    assert(json.spec_findings.length === 4 && json.spec_findings.every((x) => /^(DATA|IMG|CSS|LAY|FORM)-\d{3}$/.test(x.id) && x.category), 'spec schema findings');
    const [dh] = await Promise.all([page.waitForEvent('download'), T('export-html').click()]);
    const html = fs.readFileSync(await dh.path(), 'utf8');
    assert(!/(src|href)="https?:/i.test(html), 'HTML has no external resources');
    assert((html.match(/data:image\/png;base64,/g) || []).length >= 3, 'HTML embeds originals + diff map');
    assert(/<svg viewBox="0 0 480 320"/.test(html) && /Confirmed defect/.test(html), 'HTML annotations + review');
    const [dp] = await Promise.all([page.waitForEvent('download'), T('export-png').click()]);
    assert(fs.statSync(await dp.path()).size > 1000, 'annotated PNG');
  });

  await step('different dimensions → warning, compare blocked until alignment chosen', async () => {
    await T('file-dev').setInputFiles(img('dev-taller.png'));
    await T('alignment-warning').waitFor();
    assert(await T('compare').isDisabled(), 'compare blocked');
    await T('align-top-left').check();
    await T('compare').click();
    await T('finding-1').waitFor({ timeout: 30000 });
    assert(!(await T('no-differences').count()), 'no false clean match');
    assert(/extra height/.test(await T('findings').textContent()), 'extra height reported');
    await shot('04-alignment');
  });

  await step('ignore region over the clock → change excluded and logged', async () => {
    await T('file-dev').setInputFiles(img('dev-clock-changed.png'));
    await page.waitForFunction(() => document.querySelector('[data-testid="meta-dev"]')?.textContent.includes('dev-clock-changed'));
    await T('compare').click();
    await T('finding-1').waitFor({ timeout: 30000 });
    await T('draw-ignore').click();
    await T('preview-dev').scrollIntoViewIfNeeded();
    const im = await T('preview-dev').boundingBox();
    const sx = im.width / 480, sy = im.height / 320; // draw over the header clock (x 400-480, y 0-40)
    await page.mouse.move(im.x + 395 * sx, im.y + 2 * sy);
    await page.mouse.down();
    await page.mouse.move(im.x + 478 * sx, im.y + 38 * sy, { steps: 6 });
    await page.mouse.up();
    await T('ignore-list').waitFor();
    await T('ignore-list').locator('input').first().fill('Clock');
    await T('draw-ignore').click();
    await T('compare').click();
    await T('no-differences').waitFor({ timeout: 30000 });
    assert(/Clock/.test(await T('ignored-log').textContent()), 'ignore rule logged');
    await shot('05-ignored');
  });

  // ---------------------------------------------------------------- data-first (real text)
  const loadPair = async (dev, prod = 'prod.png') => {
    await T('file-prod').setInputFiles(img(path.join('data', prod)));
    await T('file-dev').setInputFiles(img(path.join('data', dev)));
    await page.waitForFunction((n) => document.querySelector('[data-testid="meta-dev"]')?.textContent.includes(n), dev);
  };
  const mismatchCount = async () =>
    (await page.locator('[data-testid^="status-"]').allTextContents()).filter((t) => t === 'Mismatch' || /^(Missing|Extra) in DEV$/.test(t)).length;
  const waitResult = async () => {
    await page.waitForFunction(() => document.querySelector('[data-testid="results"]') || document.querySelector('[data-testid="error"]'), null, { timeout: 60000 });
    assert(!(await T('error').count()), 'error: ' + ((await T('error').count()) ? await T('error').textContent() : ''));
  };

  await step('data-first: Clear restores the default scope (Data & Text only)', async () => {
    await T('reset').click();
    assert(await T('scope-data_text').isChecked(), 'Data & Text checked');
    for (const s of ALL_SCOPES.slice(1)) assert(!(await T('scope-' + s).isChecked()), s + ' unchecked after Clear');
  });

  await step('data-first: wrong number/amount/status/ID/date shown with exact DEV and PROD values', async () => {
    await loadPair('dev-data-changed.png');
    await T('compare').click();
    await waitResult();
    assert((await mismatchCount()) === 5, 'expected 5 data mismatches, got ' + (await mismatchCount()));
    assert((await T('dev-value-1').textContent()) === '1,250' && (await T('prod-value-1').textContent()) === '1,248', 'values of DATA-001');
    assert((await T('code-1').textContent()) === 'DATA-001', 'code');
    assert(/Active Users/.test(await T('finding-1').textContent()), 'field shown');
    assert((await T('anno-dev-1').count()) && (await T('anno-prod-1').count()), 'boxes on both screenshots');
    assert((await T('scope-summary-css_styling').getAttribute('data-checked')) === 'false' && /Not checked/.test(await T('scope-summary-css_styling').textContent()), 'unchecked category says "Not checked", never passed');
    assert(/5 mismatch/.test(await T('scope-summary-data_text').textContent()), 'data summary');
    await shot('06-data-mismatch');
  });

  await step('data-first: report says "Not checked" for unselected categories and carries values', async () => {
    const [dh] = await Promise.all([page.waitForEvent('download'), T('download-report').click()]);
    const html = fs.readFileSync(await dh.path(), 'utf8');
    assert(/Selected checks/.test(html) && /Not checked/.test(html), 'scope table in report');
    assert(html.includes('<b>1,250</b>') && html.includes('<b>1,248</b>'), 'exact values in report');
    const [dj] = await Promise.all([page.waitForEvent('download'), T('export-json').click()]);
    const json = JSON.parse(fs.readFileSync(await dj.path(), 'utf8'));
    const first = json.spec_findings[0];
    assert(first.id === 'DATA-001' && first.category === 'data_text' && first.dev_value === '1,250' && first.prod_value === '1,248' && first.dev_bbox.length === 4, 'spec finding: ' + JSON.stringify(first));
  });

  await step('data-first: same data with new colors/font → no data mismatch; CSS findings only when selected', async () => {
    await loadPair('dev-restyled.png');
    await T('compare').click();
    await waitResult();
    assert((await mismatchCount()) === 0, 'no data mismatch (got ' + (await mismatchCount()) + ')');
    await T('scope-css_styling').check();
    await T('compare').click();
    await waitResult();
    const codes = await page.locator('[data-testid^="code-"]').allTextContents();
    assert(codes.some((c) => c.startsWith('CSS-')), 'CSS findings when selected: ' + codes);
    const statuses = await page.locator('[data-testid^="finding-"]').evaluateAll((els) => els.map((e) => e.textContent));
    assert(!statuses.some((t) => /DATA-\d{3}/.test(t) && /Mismatch/.test(t)), 'still no data mismatch');
    await T('scope-css_styling').uncheck();
    await shot('07-restyled');
  });

  await step('data-first: different resolution → no alignment needed for Data & Text, no data mismatch', async () => {
    await loadPair('dev-2x.png');
    await T('size-info').waitFor();
    assert(!(await T('alignment-warning').count()), 'no alignment demanded for data only');
    assert(await T('compare').isEnabled(), 'compare enabled');
    await T('compare').click();
    await waitResult();
    assert((await mismatchCount()) === 0, 'no data mismatch (got ' + (await mismatchCount()) + ')');
    await T('scope-images_diagrams').check();
    await T('alignment-warning').waitFor();
    assert(await T('compare').isDisabled(), 'a pixel check needs an alignment');
    await T('scope-images_diagrams').uncheck();
  });

  await step('data-first: at least one category required', async () => {
    await T('scope-data_text').uncheck();
    await T('scope-required').waitFor();
    assert(await T('compare').isDisabled(), 'compare disabled with nothing selected');
    await T('scope-data_text').check();
  });

  await step('data-first: ignored field excludes the timestamp and is logged', async () => {
    await loadPair('dev-clock.png');
    await T('compare').click();
    await waitResult();
    assert((await mismatchCount()) === 1 && /Last updated/.test(await T('findings').textContent()), 'timestamp mismatch without the rule');
    await T('opt-ignore-fields').fill('Last updated');
    await T('compare').click();
    await T('no-differences').waitFor({ timeout: 60000 });
    assert(/Last updated/.test(await T('ignored-field').textContent()), 'ignored field logged');
    await T('opt-ignore-fields').fill('');
    await shot('08-ignored-field');
  });

  await step('data-first: missing chart only reported when Images & Diagrams is selected', async () => {
    await loadPair('dev-chart-missing.png');
    await T('compare').click();
    await T('no-differences').waitFor({ timeout: 60000 });
    await T('scope-images_diagrams').check();
    await T('compare').click();
    await waitResult();
    const codes = await page.locator('[data-testid^="code-"]').allTextContents();
    assert(codes.some((c) => c.startsWith('IMG-')), 'IMG finding: ' + codes);
    await T('scope-images_diagrams').uncheck();
  });

  await step('AI unavailable → deterministic note, consent box disabled', async () => {
    const ai = await (await page.request.get(`${BASE}/api/screenshot-compare`)).json();
    if (ai.ai.configured) return console.log('      (AI configured on this server: skipped)');
    assert(await T('ai-consent').isDisabled(), 'consent disabled when AI is not configured');
    assert(/deterministic/i.test(await T('ai-option').textContent()), 'explains deterministic fallback');
  });

  await step('reset clears everything', async () => {
    await T('reset').click();
    assert(!(await T('preview-dev').count()) && !(await T('preview-prod').count()) && !(await T('results').count()), 'cleared');
    assert(await T('compare').isDisabled(), 'compare disabled again');
  });

  await step('live comparison tab still opens', async () => {
    await page.getByRole('button', { name: 'Live Comparison', exact: true }).click();
    await page.waitForTimeout(500);
    assert(!(await T('screenshot-comparison').count()), 'screenshot tab unmounted');
  });

  await step('no page errors', async () => {
    const real = errors.filter((e) => !/favicon|Download the React DevTools|socket|WebSocket|ERR_CONNECTION/i.test(e));
    assert(!real.length, real.join('\n'));
  });

  await browser.close();
  console.log(failures ? `\n${failures} failed` : '\nall passed');
  process.exit(failures ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
