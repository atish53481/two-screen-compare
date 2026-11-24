import { NextRequest, NextResponse } from 'next/server';
import comparisonEngine from '@/lib/playwright';
import { requireJson } from '@/lib/http-guards';

export async function POST(request: NextRequest) {
  try {
    const rejected = requireJson(request);
    if (rejected) return rejected;
    const { action, sessionId, runId, findingId, note } = await request.json();

    if (action === 'analyze') {
      // Wired in Task 14
      return NextResponse.json({ error: 'AI analysis not configured' }, { status: 501 });
    }
    if (!['mark-expected', 'unmark-expected', 'highlight'].includes(action)) {
      return NextResponse.json({ success: false, error: 'Unknown action' }, { status: 400 });
    }
    if (typeof findingId !== 'string' || !findingId) {
      return NextResponse.json({ success: false, error: 'findingId required' }, { status: 400 });
    }

    if (action === 'highlight') {
      if (typeof sessionId !== 'string' || !sessionId) {
        return NextResponse.json({ success: false, error: 'sessionId required' }, { status: 400 });
      }
      const result = await comparisonEngine.highlightFinding(sessionId, findingId);
      return NextResponse.json({ success: true, ...result });
    }

    if (!sessionId && !runId) {
      return NextResponse.json({ success: false, error: 'sessionId or runId required' }, { status: 400 });
    }
    const result = await comparisonEngine.markExpected(
      { sessionId, runId },
      findingId,
      action === 'mark-expected',
      typeof note === 'string' ? note.slice(0, 500) : ''
    );
    return NextResponse.json({ success: result.ok, ...result }, { status: result.ok ? 200 : 404 });
  } catch (error: any) {
    console.error('Findings API error:', error);
    return NextResponse.json({ success: false, error: error?.message || 'Internal server error' }, { status: 500 });
  }
}
