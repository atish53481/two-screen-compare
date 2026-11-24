"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.renderXlsx = renderXlsx;
const exceljs_1 = __importDefault(require("exceljs"));
const csv_1 = require("./csv");
async function renderXlsx(model) {
    const wb = new exceljs_1.default.Workbook();
    const header = (ws) => {
        ws.getRow(1).font = { bold: true };
        ws.views = [{ state: 'frozen', ySplit: 1 }];
    };
    const cell = (f, c) => (0, csv_1.guardCell)(Array.isArray(f[c]) ? f[c].join(';') : f[c]);
    const sum = wb.addWorksheet('Summary');
    sum.columns = [{ header: 'Metric', key: 'k', width: 32 }, { header: 'Value', key: 'v', width: 50 }];
    const rows = [
        ['Project', model.meta.projectName], ['DEV URL', model.meta.devUrl], ['PROD URL', model.meta.prodUrl],
        ['Run ID', model.meta.runId], ['Started', model.meta.startedAt], ['Ended', model.meta.endedAt],
        ['Generated', model.meta.generatedAt], ['Pages tested', model.summary.pagesTested],
        ['Interactions', model.summary.interactions], ['Comparisons', model.summary.comparisons],
        ['Total findings', model.summary.totalFindings], ['Expected differences', model.summary.expected],
        ['Replay issues', model.summary.replayIssues], ['Skipped unsafe actions', model.summary.skippedUnsafe],
        ...Object.entries(model.summary.bySeverity).map(([k, v]) => [`Severity: ${k}`, v]),
        ...Object.entries(model.summary.byType).map(([k, v]) => [`Type: ${k}`, v]),
        ...Object.entries(model.summary.byClassification).map(([k, v]) => [`Classification: ${k}`, v]),
    ];
    for (const [k, v] of rows)
        sum.addRow({ k, v: typeof v === 'number' ? v : (0, csv_1.guardCell)(v) });
    header(sum);
    const findings = wb.addWorksheet('Findings');
    findings.columns = csv_1.CSV_COLUMNS.map((c) => ({ header: c, key: c, width: 22 }));
    for (const f of model.findings)
        findings.addRow(Object.fromEntries(csv_1.CSV_COLUMNS.map((c) => [c, cell(f, c)])));
    header(findings);
    const tl = wb.addWorksheet('Timeline');
    const tlCols = ['stepId', 'action', 'devResult', 'prodResult', 'status', 'findingIds'];
    tl.columns = tlCols.map((k) => ({ header: k, key: k, width: 24 }));
    for (const t of model.timeline)
        tl.addRow(Object.fromEntries(tlCols.map((c) => [c, cell(t, c)])));
    header(tl);
    const exp = wb.addWorksheet('Expected');
    const expCols = ['id', 'page', 'type', 'component', 'devValue', 'prodValue', 'ruleApplied', 'description'];
    exp.columns = expCols.map((k) => ({ header: k, key: k, width: 24 }));
    for (const f of model.findings.filter((x) => x.classification === 'EXPECTED_DIFFERENCE'))
        exp.addRow(Object.fromEntries(expCols.map((c) => [c, cell(f, c)])));
    header(exp);
    return Buffer.from(await wb.xlsx.writeBuffer());
}
