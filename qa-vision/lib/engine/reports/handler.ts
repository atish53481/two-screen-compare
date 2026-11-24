// Framework-free core of POST /api/report so it can be unit-tested without Next or server-only.
import { isJsonContentType } from '../content-type';
import type { SessionSnapshot } from '../../playwright';
import { buildReportModel, sanitizeUrl } from './model';
import { renderHtml } from './html';
import { renderJson } from './json';
import { renderXlsx } from './xlsx';
import { renderCsv } from './csv';
import { evidenceDirFor, safeEvidencePath, loadEvidenceImages } from './evidence';
import { generateComparisonPdf, type ReportInput, type ReportLog, type ReportMismatch } from './pdf';

export const FORMATS = {
  pdf: { type: 'application/pdf', ext: 'pdf' },
  html: { type: 'text/html; charset=utf-8', ext: 'html' },
  json: { type: 'application/json; charset=utf-8', ext: 'json' },
  xlsx: { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', ext: 'xlsx' },
  csv: { type: 'text/csv; charset=utf-8', ext: 'csv' },
} as const;
export type Format = keyof typeof FORMATS;

export interface ReportDeps {
  getRun(id: string): SessionSnapshot | null;
  getLive(sessionId: string | null): SessionSnapshot | null;
  cwd?: string;
}

export type ReportResult =
  | { status: number; json: Record<string, unknown> }
  | { status: number; contentType: string; filename: string; body: string | Uint8Array; extraHeaders?: Record<string, string> };

const fail = (status: number, error: string): ReportResult => ({ status, json: { success: false, error } });

export async function handleReport(contentType: string | null, rawBody: unknown, deps: ReportDeps): Promise<ReportResult> {
  if (!isJsonContentType(contentType)) return fail(415, 'Content-Type must be application/json');
  const body: any = rawBody && typeof rawBody === 'object' ? rawBody : {};
  const format = (body.format ?? 'pdf') as Format;
  if (!Object.prototype.hasOwnProperty.call(FORMATS, format)) return fail(400, 'format must be one of pdf, html, json, xlsx, csv');

  const { runId, sessionId, projectName, devUrl, prodUrl, logs: clientLogs, mismatches: clientMismatches } = body;
  const hasRunId = typeof runId === 'string' && runId.length > 0;
  const source = hasRunId ? deps.getRun(runId) : deps.getLive(typeof sessionId === 'string' ? sessionId : null);
  if (hasRunId && !source) return fail(404, 'Run not found');

  const evidenceDir = source ? evidenceDirFor(String(source.id), deps.cwd) : null;

  if (format !== 'pdf') {
    if (!source) return fail(404, 'No session or run to report on');
    const model = buildReportModel(source);
    const stem = `qa-vision-report-${String(source.id).replace(/[^\w.-]/g, '_')}`;
    let payload: string | Uint8Array;
    if (format === 'html') payload = renderHtml(model, evidenceDir ? await loadEvidenceImages(evidenceDir, model) : new Map());
    else if (format === 'json') payload = renderJson(model);
    else if (format === 'csv') payload = renderCsv(model);
    else payload = new Uint8Array(await renderXlsx(model));
    return { status: 200, contentType: FORMATS[format].type, filename: `${stem}.${FORMATS[format].ext}`, body: payload };
  }

  // PDF. The server holds the complete run; the dashboard only keeps a truncated live view.
  const serverLogs: any[] = source?.logs || [];
  const serverLogIds = new Set(serverLogs.map((l: any) => l.id));
  const extraClientLogs = (Array.isArray(clientLogs) ? clientLogs : []).filter((l: any) => !l?.id || !serverLogIds.has(l.id));
  const logs: ReportLog[] = (serverLogs.length ? [...serverLogs, ...extraClientLogs] : extraClientLogs).map((l: any) => ({
    id: l.id,
    timestamp: l.timestamp || new Date().toISOString(),
    action: l.action || '',
    devResult: l.devResult || '',
    prodResult: l.prodResult || '',
    status: l.status || 'match',
  }));

  // Server findings come through the report model (AI text redacted, screenshot refs reduced to file names), then
  // each reference is re-resolved inside the evidence directory. Client-supplied findings never carry file paths.
  const serverMismatches: ReportMismatch[] = (source ? buildReportModel(source).findings : []).map((m: any) => ({
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
    devScreenshotPath: safeEvidencePath(evidenceDir, m.devScreenshotPath),
    prodScreenshotPath: safeEvidencePath(evidenceDir, m.prodScreenshotPath),
    diffScreenshotPath: safeEvidencePath(evidenceDir, m.diffScreenshotPath),
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

  const clientOnly: ReportMismatch[] = (Array.isArray(clientMismatches) ? clientMismatches : [])
    .filter((cm: any) => !serverMismatches.some((sm) => sm.id && cm.id && sm.id === cm.id))
    .map((m: any) => ({
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
  const input: ReportInput = {
    reportId,
    projectName: projectName || source?.projectName || 'QA Vision Comparison',
    devUrl: sanitizeUrl(source?.devUrl || devUrl || '(not recorded)'),
    prodUrl: sanitizeUrl(source?.prodUrl || prodUrl || '(not recorded)'),
    generatedAt: new Date().toISOString(),
    sessionId: source?.id || sessionId || null,
    logs,
    mismatches,
  };
  const pdfBytes = await generateComparisonPdf(input);
  return {
    status: 200,
    contentType: FORMATS.pdf.type,
    filename: `${reportId}.pdf`,
    body: pdfBytes,
    extraHeaders: { 'X-Report-Id': reportId, 'X-Mismatch-Count': String(mismatches.length), 'X-Log-Count': String(logs.length) },
  };
}
