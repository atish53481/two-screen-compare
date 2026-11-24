"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.FORMATS = void 0;
exports.handleReport = handleReport;
// Framework-free core of POST /api/report so it can be unit-tested without Next or server-only.
const content_type_1 = require("../content-type");
const model_1 = require("./model");
const html_1 = require("./html");
const json_1 = require("./json");
const xlsx_1 = require("./xlsx");
const csv_1 = require("./csv");
const evidence_1 = require("./evidence");
const pdf_1 = require("./pdf");
exports.FORMATS = {
    pdf: { type: 'application/pdf', ext: 'pdf' },
    html: { type: 'text/html; charset=utf-8', ext: 'html' },
    json: { type: 'application/json; charset=utf-8', ext: 'json' },
    xlsx: { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', ext: 'xlsx' },
    csv: { type: 'text/csv; charset=utf-8', ext: 'csv' },
};
const fail = (status, error) => ({ status, json: { success: false, error } });
async function handleReport(contentType, rawBody, deps) {
    if (!(0, content_type_1.isJsonContentType)(contentType))
        return fail(415, 'Content-Type must be application/json');
    const body = rawBody && typeof rawBody === 'object' ? rawBody : {};
    const format = (body.format ?? 'pdf');
    if (!Object.prototype.hasOwnProperty.call(exports.FORMATS, format))
        return fail(400, 'format must be one of pdf, html, json, xlsx, csv');
    const { runId, sessionId, projectName, devUrl, prodUrl, logs: clientLogs, mismatches: clientMismatches } = body;
    const hasRunId = typeof runId === 'string' && runId.length > 0;
    const source = hasRunId ? deps.getRun(runId) : deps.getLive(typeof sessionId === 'string' ? sessionId : null);
    if (hasRunId && !source)
        return fail(404, 'Run not found');
    const evidenceDir = source ? (0, evidence_1.evidenceDirFor)(String(source.id), deps.cwd) : null;
    if (format !== 'pdf') {
        if (!source)
            return fail(404, 'No session or run to report on');
        const model = (0, model_1.buildReportModel)(source);
        const stem = `qa-vision-report-${String(source.id).replace(/[^\w.-]/g, '_')}`;
        let payload;
        if (format === 'html')
            payload = (0, html_1.renderHtml)(model, evidenceDir ? await (0, evidence_1.loadEvidenceImages)(evidenceDir, model) : new Map());
        else if (format === 'json')
            payload = (0, json_1.renderJson)(model);
        else if (format === 'csv')
            payload = (0, csv_1.renderCsv)(model);
        else
            payload = new Uint8Array(await (0, xlsx_1.renderXlsx)(model));
        return { status: 200, contentType: exports.FORMATS[format].type, filename: `${stem}.${exports.FORMATS[format].ext}`, body: payload };
    }
    // PDF. The server holds the complete run; the dashboard only keeps a truncated live view.
    const serverLogs = source?.logs || [];
    const serverLogIds = new Set(serverLogs.map((l) => l.id));
    const extraClientLogs = (Array.isArray(clientLogs) ? clientLogs : []).filter((l) => !l?.id || !serverLogIds.has(l.id));
    const logs = (serverLogs.length ? [...serverLogs, ...extraClientLogs] : extraClientLogs).map((l) => ({
        id: l.id,
        timestamp: l.timestamp || new Date().toISOString(),
        action: l.action || '',
        devResult: l.devResult || '',
        prodResult: l.prodResult || '',
        status: l.status || 'match',
    }));
    // Server findings come through the report model (AI text redacted, screenshot refs reduced to file names), then
    // each reference is re-resolved inside the evidence directory. Client-supplied findings never carry file paths.
    const serverMismatches = (source ? (0, model_1.buildReportModel)(source).findings : []).map((m) => ({
        id: m.id,
        timestamp: m.timestamp || new Date().toISOString(),
        page: m.page,
        component: m.component || 'Unknown',
        type: m.type || 'Difference',
        devValue: String(m.devValue ?? ''),
        prodValue: String(m.prodValue ?? ''),
        severity: m.severity || 'medium',
        description: m.description,
        aiAnalysis: m.aiAnalysis,
        devScreenshotPath: (0, evidence_1.safeEvidencePath)(evidenceDir, m.devScreenshotPath),
        prodScreenshotPath: (0, evidence_1.safeEvidencePath)(evidenceDir, m.prodScreenshotPath),
        diffScreenshotPath: (0, evidence_1.safeEvidencePath)(evidenceDir, m.diffScreenshotPath),
        property: m.property,
        devSelector: m.devSelector,
        prodSelector: m.prodSelector,
        ruleApplied: m.ruleApplied,
        ai: m.ai,
        diffPercent: m.diffPercent,
        classification: m.classification,
        occurrences: m.occurrences,
        stepIds: Array.isArray(m.stepIds) ? m.stepIds : undefined,
    }));
    const clientOnly = (Array.isArray(clientMismatches) ? clientMismatches : [])
        .filter((cm) => !serverMismatches.some((sm) => sm.id && cm.id && sm.id === cm.id))
        .map((m) => ({
        id: m.id,
        timestamp: m.timestamp || new Date().toISOString(),
        page: m.page,
        component: m.component || 'Unknown',
        type: m.type || 'Difference',
        devValue: String(m.devValue ?? ''),
        prodValue: String(m.prodValue ?? ''),
        severity: m.severity || 'medium',
        description: m.description,
        aiAnalysis: m.aiAnalysis,
    }));
    const mismatches = [...serverMismatches, ...clientOnly];
    const reportId = `qa-vision-report-${Date.now()}`;
    const input = {
        reportId,
        projectName: projectName || source?.projectName || 'QA Vision Comparison',
        devUrl: (0, model_1.sanitizeUrl)(source?.devUrl || devUrl || '(not recorded)'),
        prodUrl: (0, model_1.sanitizeUrl)(source?.prodUrl || prodUrl || '(not recorded)'),
        generatedAt: new Date().toISOString(),
        sessionId: source?.id || sessionId || null,
        logs,
        mismatches,
    };
    const pdfBytes = await (0, pdf_1.generateComparisonPdf)(input);
    return {
        status: 200,
        contentType: exports.FORMATS.pdf.type,
        filename: `${reportId}.pdf`,
        body: pdfBytes,
        extraHeaders: { 'X-Report-Id': reportId, 'X-Mismatch-Count': String(mismatches.length), 'X-Log-Count': String(logs.length) },
    };
}
