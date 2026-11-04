import type { NextRequest } from 'next/server';
import { handleAccount } from '@/lib/auth/server';

export const dynamic = 'force-dynamic';
export function GET(request: NextRequest) { return handleAccount(request); }
