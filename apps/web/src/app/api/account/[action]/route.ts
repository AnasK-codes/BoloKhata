import type { NextRequest } from 'next/server';
import { handleAccount } from '@/lib/auth/server';

export const dynamic = 'force-dynamic';
export async function POST(request: NextRequest, { params }: { params: Promise<{ action: string }> }) {
  return handleAccount(request, (await params).action);
}
