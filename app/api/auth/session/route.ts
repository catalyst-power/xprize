import { NextResponse } from 'next/server';
import { getSession } from '@/src/lib/auth';

export async function GET() {
  const user = await getSession();
  return NextResponse.json(user ?? null);
}
