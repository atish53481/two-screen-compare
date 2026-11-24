const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const sharp = require('sharp');
const { PDFDocument } = require('pdf-lib');
const { buildReportModel, sanitizeUrl } = require('../../engine-dist/engine/reports/model.js');
const { renderHtml } = require('../../engine-dist/engine/reports/html.js');
const { evidenceDirFor, safeEvidencePath, loadEvidenceImages } = require('../../engine-dist/engine/reports/evidence.js');
const { handleReport } = require('../../engine-dist/engine/reports/handler.js');
const { generateComparisonPdf } = require('../../engine-dist/engine/reports/pdf.js');

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'qav-rep-'));
const finding = (o) => ({
  id: 'f1', timestamp: 't', firstSeen: 't', lastSeen: 't', occurrences: 1, page: '/a', fingerprint: 'fp',
  classification: 'POTENTIAL_DEFECT', confidence: 1, type: 'Text', component: 'h1', devValue: 'a', prodValue: 'b',
  severity: 'high', description: 'd', ...o,
});
const snap = (o = {}) => ({ id: 'run1', projectName: 'P', devUrl: 'http://u:pw@dev/x?token=abc#frag', prodUrl: 'http://prod/', startedAt: '2026-01-01T00:00:00Z', logs: [], mismatches: [], ...o });

test('pagesTested counts visited pages from navigation logs, not only findings', () => {
  const m = buildReportModel(snap({
    logs: [
      { timestamp: '1', action: 'Navigated PROD to http://prod/orders', status: 'match', devResult: 'Success', prodResult: 'Success' },
      { timestamp: '2', action: 'Navigated PROD to http://prod/users', status: 'match', devResult: 'Success', prodResult: 'Success' },
    ],
    mismatches: [finding({ page: '/orders' })],
  }));
  assert.equal(m.summary.pagesTested, 2);
});

test('skipped-action logs count, de-duplicated against skipped findings', () => {
  const m = buildReportModel(snap({
    logs: [
      { timestamp: '1', action: 'Skipped on PROD (strict): click "Delete"', status: 'skipped', devResult: 'Executed', prodResult: 'Blocked' },
      { timestamp: '2', action: 'Blocked PROD request (strict): POST /api/x', status: 'skipped', devResult: 'n/a', prodResult: 'Blocked' },
    ],
    mismatches: [finding({ classification: 'SKIPPED_BY_SAFETY_POLICY', component: 'POST /api/x' })],
  }));
  assert.equal(m.summary.skippedUnsafe, 2);
  assert.deepEqual(m.skippedActions, [
    { action: 'Skipped on PROD (strict): click "Delete"' },
    { action: 'Blocked PROD request (strict): POST /api/x', findingId: 'f1' },
  ]);
});

test('a generic skipped finding does not hide an unrelated skipped log', () => {
  const m = buildReportModel(snap({
    logs: [{ timestamp: '1', action: 'Skipped on PROD (strict): click "button" Save', status: 'skipped', devResult: 'Executed', prodResult: 'Blocked' }],
    mismatches: [finding({ classification: 'SKIPPED_BY_SAFETY_POLICY', component: 'button', devValue: 'a', stepIds: [] })],
  }));
  assert.equal(m.skippedActions.length, 1);
  assert.equal(m.skippedActions[0].findingId, undefined);
  assert.equal(m.summary.skippedUnsafe, 2);
});

test('a skipped log and finding sharing a stepId count once', () => {
  const m = buildReportModel(snap({
    logs: [{ timestamp: '1', action: '[step-3] Skipped on PROD: click Delete', status: 'skipped', devResult: 'Executed', prodResult: 'Blocked' }],
    mismatches: [finding({ classification: 'SKIPPED_BY_SAFETY_POLICY', stepIds: ['step-3'] })],
  }));
  assert.equal(m.skippedActions[0].findingId, 'f1');
  assert.equal(m.summary.skippedUnsafe, 1);
});

test('query tokens in log text are redacted from timeline and skipped actions', () => {
  const out = renderJsonText(buildReportModel(snap({
    logs: [{ timestamp: '1', action: 'Blocked PROD request (strict): POST http://p/api?token=SECRET123', status: 'skipped', devResult: 'n/a', prodResult: 'Blocked' }],
  })));
  assert.ok(!out.includes('SECRET123'), out);
});

const renderJsonText = (m) => require('../../engine-dist/engine/reports/json.js').renderJson(m);

test('urls lose userinfo/query/fragment; ai text is redacted', () => {
  assert.equal(sanitizeUrl('http://u:pw@dev/x?token=abc#frag'), 'http://dev/x');
  const m = buildReportModel(snap({
    mismatches: [finding({ ai: { status: 'ok', provider: 'p', model: 'm', explanation: 'see http://a/b?token=zzz and password=hunter2',
      observedFacts: ['Bearer abc.def'], hypotheses: [], suggestedInvestigation: [], additionalTests: [], generatedAt: 'n' } })],
  }));
  const out = JSON.stringify(m);
  assert.ok(!/u:pw|token=|hunter2|abc\.def|frag/.test(out), out);
});

test('html embeds each screenshot once, notes omitted images', () => {
  const m = buildReportModel(snap({ mismatches: [
    finding({ id: 'a', devScreenshotPath: 'dev.png' }), finding({ id: 'b', devScreenshotPath: 'dev.png', prodScreenshotPath: 'gone.png' }),
  ] }));
  const html = renderHtml(m, new Map([['dev.png', 'QUJD']]));
  assert.equal(html.split('data:image/jpeg;base64,QUJD').length - 1, 1);
  assert.ok(html.includes('findings: a, b'));
  assert.ok(html.includes('image omitted'));
});

test('evidence guards: traversal, absolute, drive-relative, missing, symlink', async (t) => {
  const cwd = tmp();
  const dir = path.join(cwd, 'reports', 'evidence', 's1');
  fs.mkdirSync(dir, { recursive: true });
  await sharp({ create: { width: 2000, height: 100, channels: 3, background: '#f00' } }).png().toFile(path.join(dir, 'ok.png'));
  const outside = path.join(cwd, 'secret.png');
  fs.writeFileSync(outside, 'x');
  assert.equal(evidenceDirFor('s1', cwd), dir);
  for (const bad of ['..', '../x', 'a/b', 'C:x', '']) assert.equal(evidenceDirFor(bad, cwd), null, bad);
  assert.equal(safeEvidencePath(dir, 'ok.png'), path.join(dir, 'ok.png'));
  assert.equal(safeEvidencePath(dir, '..'), undefined);
  assert.equal(safeEvidencePath(dir, '../secret.png'), undefined);
  assert.equal(safeEvidencePath(dir, outside), undefined);
  assert.equal(safeEvidencePath(dir, 'C:x'), undefined);
  assert.equal(safeEvidencePath(dir, 'missing.png'), undefined);
  try {
    fs.symlinkSync(outside, path.join(dir, 'link.png'));
    assert.equal(safeEvidencePath(dir, 'link.png'), undefined);
  } catch (e) {
    if (e.code !== 'EPERM' && e.code !== 'EEXIST') throw e;
    t.diagnostic('symlink not creatable; skipped');
  }
  const model = buildReportModel(snap({ mismatches: [finding({ devScreenshotPath: 'ok.png', prodScreenshotPath: 'missing.png' })] }));
  const imgs = await loadEvidenceImages(dir, model);
  assert.deepEqual([...imgs.keys()], ['ok.png']);
  const meta = await sharp(Buffer.from(imgs.get('ok.png'), 'base64')).metadata();
  assert.equal(meta.format, 'jpeg');
  assert.equal(meta.width, 1200);
  assert.equal((await loadEvidenceImages(dir, model, 10)).size, 0, 'budget respected');
});

test('route core: 415, 400, 404, content types, client paths dropped', async () => {
  const cwd = tmp();
  const deps = { cwd, getRun: (id) => (id === 'run1' ? snap({ mismatches: [finding({ ai: { status: 'ok', provider: 'p', model: 'm', explanation: 'e', observedFacts: ['f'], hypotheses: ['h'], suggestedInvestigation: [], additionalTests: [], generatedAt: 'n' } })] }) : null), getLive: () => null };
  assert.equal((await handleReport('text/plain', {}, deps)).status, 415);
  assert.equal((await handleReport('application/json', { format: 'exe' }, deps)).status, 400);
  assert.equal((await handleReport('application/json', { format: 'json', runId: 'nope' }, deps)).status, 404);
  assert.equal((await handleReport('application/json', { format: 'json' }, deps)).status, 404);
  const types = { json: 'application/json', csv: 'text/csv', html: 'text/html', xlsx: 'spreadsheetml.sheet', pdf: 'application/pdf' };
  for (const [f, ct] of Object.entries(types)) {
    const r = await handleReport('application/json', { format: f, runId: 'run1' }, deps);
    assert.equal(r.status, 200, f);
    assert.ok(r.contentType.includes(ct), f);
  }
  const r = await handleReport('application/json', {
    format: 'pdf', runId: 'run1',
    mismatches: [{ id: 'c1', devScreenshotPath: '/etc/passwd', prodScreenshotPath: 'C:\\Windows\\win.ini', ai: { status: 'ok' } }],
  }, deps);
  assert.equal(r.status, 200);
  fs.rmSync(path.join(process.cwd(), 'reports', r.filename.replace('.pdf', '')), { recursive: true, force: true });
  const saved = JSON.stringify(r.extraHeaders);
  assert.ok(saved.includes('"X-Mismatch-Count":"2"'));
});

test('pdf handles a very long AI payload without overflow', async () => {
  const long = 'word '.repeat(400);
  const ai = { status: 'ok', provider: 'p', model: 'm', explanation: long, observedFacts: Array(40).fill(long), hypotheses: Array(40).fill(long), suggestedInvestigation: [], additionalTests: [], generatedAt: 'n' };
  const bytes = await generateComparisonPdf({
    reportId: 'rep-test-long-ai', projectName: 'P', devUrl: 'http://d', prodUrl: 'http://p', generatedAt: new Date().toISOString(), logs: [],
    mismatches: [{ id: 'f', timestamp: 't', component: 'c', type: 'Text', devValue: 'a', prodValue: 'b', severity: 'high', devSelector: long, prodSelector: long + 'x', property: 'color', ai, aiAnalysis: long }],
  });
  fs.rmSync(path.join(process.cwd(), 'reports', 'rep-test-long-ai'), { recursive: true, force: true });
  const doc = await PDFDocument.load(bytes);
  assert.ok(doc.getPageCount() >= 5);
});
