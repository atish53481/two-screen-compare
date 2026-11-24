import { NextRequest, NextResponse } from 'next/server';

/**
 * Rejects non-JSON requests (e.g. cross-site text/plain form posts that request.json() would still parse).
 * Returns a 415 response to send, or null when the request is acceptable.
 */
export function requireJson(request: NextRequest): NextResponse | null {
  const type = (request.headers.get('content-type') || '').toLowerCase();
  if (type.startsWith('application/json')) return null;
  return NextResponse.json({ success: false, error: 'Content-Type must be application/json' }, { status: 415 });
}
