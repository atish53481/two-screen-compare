import { NextRequest, NextResponse } from 'next/server';
import comparisonEngine from '@/lib/playwright';
import { requireJson } from '@/lib/http-guards';
import { openStore } from '@/lib/engine/store';
import { handleReport } from '@/lib/engine/reports/handler';
import '@/lib/report-generator'; // keeps the server-only guard on the PDF module in the Next bundle

export const runtime = 'nodejs';

export async function POST(request: NextRequest) {
  let format = 'pdf';
  try {
    const bad = requireJson(request);
    if (bad) return bad;
    const body = await request.json().catch(() => ({}));
    if (typeof body?.format === 'string') format = body.format;
    const result = await handleReport(request.headers.get('content-type'), body, {
      getRun: (id) => openStore().getRun(id),
      getLive: (sessionId) => comparisonEngine.getReportSource(sessionId),
    });
    if ('json' in result) return NextResponse.json(result.json, { status: result.status });
    return new NextResponse(typeof result.body === 'string' ? result.body : Buffer.from(result.body), {
      status: result.status,
      headers: {
        'Content-Type': result.contentType,
        'Content-Disposition': `attachment; filename="${result.filename}"`,
        'Cache-Control': 'no-store',
        ...result.extraHeaders,
      },
    });
  } catch (error: any) {
    console.error('Report API error:', error);
    return NextResponse.json(
      { success: false, error: error?.message || `Failed to generate ${format} report` },
      { status: 500 }
    );
  }
}

export async function GET() {
  return NextResponse.json({
    status: 'QA Vision Report API',
    usage: 'POST JSON {format: pdf|html|json|xlsx|csv, sessionId?, runId?} (PDF also accepts projectName, devUrl, prodUrl, logs, mismatches)',
    output: 'attachment in the requested format (default pdf)',
  });
}
