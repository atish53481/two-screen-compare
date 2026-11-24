import { NextRequest, NextResponse } from 'next/server';
import { openStore } from '@/lib/engine/store';

export const runtime = 'nodejs';

const baseName = (p: unknown) => (typeof p === 'string' && p ? (p.split(/[\\/]/).pop() as string) : p);

/** Reduce every *ScreenshotPath value (at any depth) to its base file name. */
function stripPaths(v: any): any {
  if (Array.isArray(v)) return v.map(stripPaths);
  if (v && typeof v === 'object') {
    return Object.fromEntries(
      Object.entries(v).map(([k, x]) => [k, /ScreenshotPath$/.test(k) ? baseName(x) : stripPaths(x)])
    );
  }
  return v;
}

export async function GET(request: NextRequest) {
  try {
    const store = openStore();
    const id = request.nextUrl.searchParams.get('id');
    if (!id) return NextResponse.json({ success: true, runs: store.listRuns() });

    const run = store.getRun(id);
    if (!run) return NextResponse.json({ success: false, error: 'Run not found' }, { status: 404 });
    // Never expose server file-system paths
    const mismatches = run.mismatches.map(stripPaths);
    return NextResponse.json({ success: true, run: { ...run, mismatches } });
  } catch {
    return NextResponse.json({ success: false, error: 'Failed to load runs' }, { status: 500 });
  }
}
