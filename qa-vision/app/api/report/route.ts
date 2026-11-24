import { NextRequest, NextResponse } from 'next/server';
import comparisonEngine from '@/lib/playwright';
import path from 'path';
import fs from 'fs';
import { requireJson } from '@/lib/http-guards';
import { openStore } from '@/lib/engine/store';
import { getDataDir } from '@/lib/engine/secrets';
import { buildReportModel } from '@/lib/engine/reports/model';
import { renderHtml, loadEvidenceImages } from '@/lib/engine/reports/html';
import { renderJson } from '@/lib/engine/reports/json';
import { renderXlsx } from '@/lib/engine/reports/xlsx';
import { renderCsv } from '@/lib/engine/reports/csv';
import { generateComparisonPdf, type ReportInput, type ReportLog, type ReportMismatch } from '@/lib/report-generator';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const {
      sessionId,
      projectName,
      devUrl,
      prodUrl,
      logs: clientLogs,
      mismatches: clientMismatches,
    } = body || {};

    const serverSource = comparisonEngine.getReportSource(sessionId || null);

    // The server holds the complete run; the dashboard only keeps a truncated live view.
    // Use server logs, and append only client-side entries the server does not have.
    const serverLogs: any[] = serverSource?.logs || [];
    const serverLogIds = new Set(serverLogs.map((l: any) => l.id));
    const extraClientLogs = (Array.isArray(clientLogs) ? clientLogs : []).filter(
      (l: any) => !l?.id || !serverLogIds.has(l.id)
    );
    const logs: ReportLog[] = (serverLogs.length ? [...serverLogs, ...extraClientLogs] : extraClientLogs).map((l: any) => ({
      id: l.id,
      timestamp: l.timestamp || new Date().toISOString(),
      action: l.action || '',
      devResult: l.devResult || '',
      prodResult: l.prodResult || '',
      status: l.status || 'match',
    }));

    // Prefer server mismatches (they include screenshot paths). Merge unique client ones.
    const serverMismatches: ReportMismatch[] = (serverSource?.mismatches || []).map((m: any) => ({
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
      devScreenshotPath: m.devScreenshotPath,
      prodScreenshotPath: m.prodScreenshotPath,
      diffScreenshotPath: m.diffScreenshotPath,
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
      projectName: projectName || serverSource?.projectName || 'QA Vision Comparison',
      devUrl: serverSource?.devUrl || devUrl || '(not recorded)',
      prodUrl: serverSource?.prodUrl || prodUrl || '(not recorded)',
      generatedAt: new Date().toISOString(),
      sessionId: serverSource?.id || sessionId || null,
      logs,
      mismatches,
    };

    const pdfBytes = await generateComparisonPdf(input);

    return new NextResponse(Buffer.from(pdfBytes), {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="${reportId}.pdf"`,
        'Cache-Control': 'no-store',
        'X-Report-Id': reportId,
        'X-Mismatch-Count': String(mismatches.length),
        'X-Log-Count': String(logs.length),
      },
    });
  } catch (error: any) {
    console.error('Report API error:', error);
    return NextResponse.json(
      {
        success: false,
        error: error?.message || 'Failed to generate PDF report',
      },
      { status: 500 }
    );
  }
}

export async function GET() {
  return NextResponse.json({
    status: 'QA Vision Report API',
    usage: 'POST JSON {format: pdf|html|json|xlsx|csv, sessionId?, runId?} (PDF also accepts projectName, devUrl, prodUrl, logs, mismatches)',
    output: 'application/pdf attachment with actual differences and evidence images',
  });
}
