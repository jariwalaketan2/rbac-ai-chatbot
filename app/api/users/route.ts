import { NextResponse } from 'next/server';
import { listDemoUsers } from '@/lib/auth/context';

export const runtime = 'nodejs';

export async function GET() {
  const users = await listDemoUsers();
  return NextResponse.json(users);
}
