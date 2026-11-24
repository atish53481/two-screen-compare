// In-page snapshot extraction (uses setContent; no sample apps needed).
process.env.QA_VISION_HEADLESS = process.env.QA_VISION_HEADLESS || '1';
const { chromium } = require('playwright');
const { runSuite } = require('./helpers');
const { extractPageSnapshot, STYLE_PROPS, ATTR_ALLOWLIST, SENSITIVE_FIELD_RE } = require('../../engine-dist/engine/extract.js');

const arg = {
  scopeSelector: 'body',
  maxElements: 400,
  maxRows: 50,
  sensitiveSource: SENSITIVE_FIELD_RE.source,
  styleProps: [...STYLE_PROPS],
  attrAllowlist: [...ATTR_ALLOWLIST],
};

runSuite('Snapshot extraction', async ({ check }) => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    const snap = async (html, a = arg) => {
      await page.setContent(html);
      return page.evaluate(extractPageSnapshot, a);
    };

    let s = await snap('<button data-testid="b" style="color: rgb(255, 0, 0)">Go</button>');
    const b = s.elements.find((e) => e.testId === 'b');
    check(
      'extraction returns styles, box and a11y for a button',
      b && b.key === 'tid:b' && b.styles.color === 'rgb(255, 0, 0)' && b.role === 'button' && b.name === 'Go' && b.box.w > 0 && b.visible && b.enabled,
      JSON.stringify(b && { key: b.key, color: b.styles.color, role: b.role, name: b.name, box: b.box })
    );

    const big = '<div>' + '<span>x</span>'.repeat(5000) + '</div>';
    await page.setContent(big);
    const t0 = Date.now();
    s = await page.evaluate(extractPageSnapshot, arg);
    const ms = Date.now() - t0;
    check('extraction caps elements on a 5,000-node page', s.elements.length <= 400 && s.truncated === true && ms < 3000, `${s.elements.length} elements, ${ms}ms`);

    let threw = false;
    try {
      await page.setContent('<iframe src="https://example.com"></iframe><p>ok</p>');
      s = await page.evaluate(extractPageSnapshot, arg);
    } catch (e) {
      threw = true;
    }
    check('extraction skips cross-origin iframes', !threw && s.elements.some((e) => e.tag === 'iframe'));

    s = await snap('<input type=password value="hunter2" data-testid="pw"><input name="q" value="visible-value" data-testid="q">');
    const pw = s.elements.find((e) => e.testId === 'pw');
    check('password values are redacted', pw && !JSON.stringify(s).includes('hunter2') && pw.text === '[redacted]', pw && pw.text);
    check('non-sensitive field values are kept', s.elements.find((e) => e.testId === 'q').text === 'visible-value');

    s = await snap(
      '<table data-testid="t"><thead><tr><th>Name</th><th>Qty</th></tr></thead><tbody><tr><td>A</td><td>1</td></tr><tr><td>B</td><td>2</td></tr><tr><td>C</td><td>3</td></tr></tbody></table>'
    );
    const t = s.tables[0];
    check(
      'table snapshot',
      t && t.key === 'tid:t' && JSON.stringify(t.headers) === '["Name","Qty"]' && t.rowCount === 3 && t.rows[2][0] === 'C',
      JSON.stringify(t)
    );

    s = await snap('<a href="https://x.test/a/b?token=1#h" id="lnk">Link</a>');
    const a = s.elements.find((e) => e.elementId === 'lnk');
    check('href keeps path only; selector prefers id', a.attrs.href === '/a/b' && a.selector === '#lnk' && a.key === 'id:lnk', JSON.stringify(a.attrs));
  } finally {
    await browser.close().catch(() => {});
  }
});
