import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

// deliberate fixture difference: DEV returns growth, PROD does not
export async function GET() {
  return NextResponse.json({ users: 1250, revenue: 1248000, growth: 4.2 });
}
