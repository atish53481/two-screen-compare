const test = require('node:test');
const assert = require('node:assert/strict');
const ExcelJS = require('exceljs');
const { buildReportModel } = require('../../engine-dist/engine/reports/model.js');
const { renderHtml } = require('../../engine-dist/engine/reports/html.js');
const { renderJson } = require('../../engine-dist/engine/reports/json.js');
const { renderXlsx } = require('../../engine-dist/engine/reports/xlsx.js');
const { renderCsv } = require('../../engine-dist/engine/reports/csv.js');

const finding = (o) => ({
  id: 'f1', timestamp: '2026-01-01T00:00:00Z', firstSeen: '2026-01-01T00:00:00Z', lastSeen: '2026-01-01T00:00:00Z',
  occurrences: 1, page: '/home', fingerprint: 'fp1', classification: 'POTENTIAL_DEFECT', confidence: 0.9,
  type: 'Text', component: 'h1', devValue: 'a', prodValue: 'b', severity: 'high', description: 'differs',
  stepIds: ['step-1'], ...o,
});

const snap = () => ({
  id: 'run1', projectName: 'Proj', devUrl: 'http://dev', prodUrl: 'http://prod',
  startedAt: '2026-01-01T00:00:00Z', endedAt: '2026-01-01T00:05:00Z',
  logs: [
    { id: 'l3', timestamp: '2026-01-01T00:00:03Z', action: 'Compared after step-1: 2 new', devResult: 'Captured', prodResult: 'Differences', status: 'info' },
    { id: 'l2', timestamp: '2026-01-01T00:00:02Z', action: '[step-1] Replicating click: Save', devResult: 'Captured', prodResult: 'Replaying', status: 'info' },
    { id: 'l1', timestamp: '2026-01-01T00:00:01Z', action: 'Skipped on PROD (strict): click "Delete"', devResult: 'Executed', prodResult: 'Blocked', status: 'skipped' },
  ],
  mismatches: [
    finding({ id: 'f1' }),
    finding({ id: 'f2', type: 'Visual', severity: 'low', classification: 'EXPECTED_DIFFERENCE', devScreenshotPath: 'C:\\secret\\evidence\\dev-1.png' }),
    finding({ id: 'f3', type: 'Text', severity: 'high', classification: 'REPLAY_FAILURE', component: '<script>alert(1)</script>' }),
    finding({ id: 'f4', classification: 'SKIPPED_BY_SAFETY_POLICY', severity: 'medium', component: '=HYPERLINK("x")',
      ai: { status: 'ok', provider: 'p', model: 'm', explanation: 'e', observedFacts: ['FACT-X'], hypotheses: ['HYP-Y'], suggestedInvestigation: [], additionalTests: [], generatedAt: 'now' } }),
  ],
});

test('summary counts by severity, type and classification', () => {
  const m = buildReportModel(snap());
  assert.equal(m.summary.totalFindings, 4);
  assert.deepEqual(m.summary.bySeverity, { high: 2, low: 1, medium: 1 });
  assert.deepEqual(m.summary.byType, { Text: 3, Visual: 1 });
  assert.equal(m.summary.byClassification.POTENTIAL_DEFECT, 1);
  assert.equal(m.summary.expected, 1);
  assert.equal(m.summary.replayIssues, 1);
  assert.equal(m.summary.skippedUnsafe, 2); // 1 finding + 1 uncovered skipped log
  assert.equal(m.summary.interactions, 1);
  assert.equal(m.summary.comparisons, 1);
  assert.equal(m.timeline[0].action, 'Skipped on PROD (strict): click "Delete"');
  assert.deepEqual(m.timeline.find((t) => t.stepId === 'step-1').findingIds.sort(), ['f1', 'f2', 'f3', 'f4']);
});

test('html escapes finding text', () => {
  const html = renderHtml(buildReportModel(snap()), new Map());
  assert.ok(html.includes('&lt;script&gt;alert(1)&lt;/script&gt;'));
  assert.ok(!html.includes('<script>alert'));
});

test('html contains every section heading', () => {
  const html = renderHtml(buildReportModel(snap()), new Map([['dev-1.png', 'AAAA']]));
  for (const h of ['Executive summary', 'Severity breakdown', 'Differences by type', 'Expected differences', 'Replay issues',
    'Skipped unsafe actions', 'Timeline', 'AI analysis', 'Evidence', 'Observed facts', 'Hypotheses']) {
    assert.ok(html.includes(h), h);
  }
  assert.ok(html.includes('data:image/jpeg;base64,AAAA'));
  assert.ok(html.includes('FACT-X') && html.includes('HYP-Y'));
});

test('json report has no absolute paths', () => {
  const out = renderJson(buildReportModel(snap()));
  assert.ok(!/[A-Za-z]:\\|\/Users\/|secret/.test(out), out);
  assert.ok(out.includes('dev-1.png'));
  assert.equal(JSON.parse(out).findings.length, 4);
});

test('xlsx has 4 sheets and N finding rows', async () => {
  const buf = await renderXlsx(buildReportModel(snap()));
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf);
  assert.deepEqual(wb.worksheets.map((w) => w.name), ['Summary', 'Findings', 'Timeline', 'Expected']);
  assert.equal(wb.getWorksheet('Findings').rowCount, 1 + 4);
  assert.equal(wb.getWorksheet('Expected').rowCount, 1 + 1);
});

test('csv guards formula injection', () => {
  const csv = renderCsv(buildReportModel(snap()));
  const lines = csv.split('\r\n');
  assert.equal(lines.length, 1 + 4 + 1);
  assert.ok(csv.includes('\'=HYPERLINK(""x"")'));
  assert.ok(!/(^|,)"?=/m.test(csv));
});
