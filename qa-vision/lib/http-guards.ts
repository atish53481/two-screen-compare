import { NextRequest, NextResponse } from 'next/server';
import { isJsonContentType } from './engine/content-type';

/**
 * Rejects non-JSON requests (e.g. cross-site text/plain form posts that request.json() would still parse).
 * Returns a 415 response to send, or null when the request is acceptable.
 */
export function requireJson(request: NextRequest): NextResponse | null {
  if (isJsonContentType(request.headers.get('content-type'))) return null;
  return NextResponse.json({ success: false, error: 'Content-Type must be application/json' }, { status: 415 });
}
