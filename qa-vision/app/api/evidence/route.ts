import fs from 'fs';
import { NextRequest, NextResponse } from 'next/server';
import { evidenceDirFor, safeEvidencePath } from '@/lib/engine/reports/evidence';

export const runtime = 'nodejs';

const bad = (error: string, status = 400) => NextResponse.json({ success: false, error }, { status });

/**
 * GET /api/evidence?session=<id>&file=<name>.png — serves one screenshot from reports/evidence/<session>/ only.
 * `..`, absolute paths and separators are rejected (400); only .png is served.
 */
export async function GET(request: NextRequest) {
  const session = request.nextUrl.searchParams.get('session') || '';
  const file = request.nextUrl.searchParams.get('file') || '';
  if (!session || !file) return bad('session and file required');
  if (/(^|[\/])\.\.([\/]|$)/.test(file) || /[\/]/.test(file) || /^[a-zA-Z]:/.test(file) || file.includes('\0')) {
    return bad('Invalid file');
  }
  if (!/\.png$/i.test(file)) return bad('Only .png evidence is served');
  const dir = evidenceDirFor(session);
  if (!dir) return bad('Invalid session');
  const full = safeEvidencePath(dir, file);
  if (!full) return bad('Evidence not found', 404);
  const bytes = fs.readFileSync(full);
  return new NextResponse(new Uint8Array(bytes), {
    headers: {
      'Content-Type': 'image/png',
      'Cache-Control': 'private, max-age=60',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}
