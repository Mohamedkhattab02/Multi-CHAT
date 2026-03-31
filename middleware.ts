import { NextRequest, NextResponse } from 'next/server';
import { updateSession } from '@/lib/supabase/middleware';

// Protected routes that require authentication
const PROTECTED_ROUTES = ['/chat', '/api/chat', '/api/conversations', '/api/upload', '/api/export-pdf', '/api/share', '/api/memories'];
const AUTH_ROUTES = ['/login', '/signup'];

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Update Supabase session
  const { supabaseResponse, user } = await updateSession(request);

  // Redirect authenticated users away from auth pages
  if (user && AUTH_ROUTES.some((route) => pathname.startsWith(route))) {
    return NextResponse.redirect(new URL('/chat', request.url));
  }

  // Redirect unauthenticated users to login
  const isProtected = PROTECTED_ROUTES.some((route) => pathname.startsWith(route));
  if (!user && isProtected) {
    // Allow API routes to return 401 instead of redirect
    if (pathname.startsWith('/api/')) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    return NextResponse.redirect(new URL('/login', request.url));
  }

  return supabaseResponse;
}

export const config = {
  matcher: [
    // Skip static files and Next.js internals
    '/((?!_next/static|_next/image|favicon.ico|public|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
};
