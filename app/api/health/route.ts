import { NextResponse } from 'next/server';

export async function GET() {
  return NextResponse.json({
    status: 'ok',
    app: 'agrifortress',
    ts: new Date().toISOString(),
  });
}
