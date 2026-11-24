import ExcelJS from 'exceljs';
import type { ReportModel } from './model';
import { CSV_COLUMNS, guardCell } from './csv';

export async function renderXlsx(model: ReportModel): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const header = (ws: ExcelJS.Worksheet) => {
    ws.getRow(1).font = { bold: true };
    ws.views = [{ state: 'frozen', ySplit: 1 }];
  };
  const cell = (f: any, c: string) => guardCell(Array.isArray(f[c]) ? f[c].join(';') : f[c]);

  const sum = wb.addWorksheet('Summary');
  sum.columns = [{ header: 'Metric', key: 'k', width: 32 }, { header: 'Value', key: 'v', width: 50 }];
  const rows: Array<[string, unknown]> = [
    ['Project', model.meta.projectName], ['DEV URL', model.meta.devUrl], ['PROD URL', model.meta.prodUrl],
    ['Run ID', model.meta.runId], ['Started', model.meta.startedAt], ['Ended', model.meta.endedAt],
    ['Generated', model.meta.generatedAt], ['Pages tested', model.summary.pagesTested],
    ['Interactions', model.summary.interactions], ['Comparisons', model.summary.comparisons],
    ['Total findings', model.summary.totalFindings], ['Expected differences', model.summary.expected],
    ['Replay issues', model.summary.replayIssues], ['Skipped unsafe actions', model.summary.skippedUnsafe],
    ...Object.entries(model.summary.bySeverity).map(([k, v]): [string, unknown] => [`Severity: ${k}`, v]),
    ...Object.entries(model.summary.byType).map(([k, v]): [string, unknown] => [`Type: ${k}`, v]),
    ...Object.entries(model.summary.byClassification).map(([k, v]): [string, unknown] => [`Classification: ${k}`, v]),
  ];
  for (const [k, v] of rows) sum.addRow({ k, v: typeof v === 'number' ? v : guardCell(v) });
  header(sum);

  const findings = wb.addWorksheet('Findings');
  findings.columns = CSV_COLUMNS.map((c) => ({ header: c, key: c, width: 22 }));
  for (const f of model.findings) findings.addRow(Object.fromEntries(CSV_COLUMNS.map((c) => [c, cell(f, c)])));
  header(findings);

  const tl = wb.addWorksheet('Timeline');
  const tlCols = ['stepId', 'action', 'devResult', 'prodResult', 'status', 'findingIds'];
  tl.columns = tlCols.map((k) => ({ header: k, key: k, width: 24 }));
  for (const t of model.timeline) tl.addRow(Object.fromEntries(tlCols.map((c) => [c, cell(t, c)])));
  header(tl);

  const exp = wb.addWorksheet('Expected');
  const expCols = ['id', 'page', 'type', 'component', 'devValue', 'prodValue', 'ruleApplied', 'description'];
  exp.columns = expCols.map((k) => ({ header: k, key: k, width: 24 }));
  for (const f of model.findings.filter((x) => x.classification === 'EXPECTED_DIFFERENCE'))
    exp.addRow(Object.fromEntries(expCols.map((c) => [c, cell(f, c)])));
  header(exp);

  return Buffer.from(await wb.xlsx.writeBuffer());
}
