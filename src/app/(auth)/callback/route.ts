import { createServerClient } from '@supabase/ssr';
import { createServiceClient } from '@/lib/supabase/server';
import { NextRequest, NextResponse } from 'next/server';
import type { Database } from '@/lib/supabase/types';

export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);

  console.log('[callback] full url:', request.url);

  const code = searchParams.get('code');
  const nextParam = searchParams.get('next') ?? '/chat';
  const next = nextParam.startsWith('/') ? nextParam : '/chat';

  const oauthError = searchParams.get('error');
  if (oauthError) {
    const desc = searchParams.get('error_description') ?? oauthError;
    console.error('[callback] OAuth provider error:', desc);
    return NextResponse.redirect(`${origin}/login?error=${encodeURIComponent(desc)}`);
  }

  if (!code) {
    console.error('[callback] Missing code');
    return NextResponse.redirect(`${origin}/login?error=missing_code`);
  }

  const response = NextResponse.redirect(`${origin}${next}`);

  const supabase = createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value, options }) => {
            response.cookies.set(name, value, options);
          });
        },
      },
    }
  );

  const { data: sessionData, error } = await supabase.auth.exchangeCodeForSession(code);

  console.log('[callback] exchange result user:', sessionData?.user?.id ?? null);
  console.log('[callback] exchange result error:', error?.message ?? null);

  if (error || !sessionData.user) {
    return NextResponse.redirect(`${origin}/login?error=auth_failed`);
  }

  const user = sessionData.user;

  const serviceClient = createServiceClient();

  const { error: upsertError } = await serviceClient.from('users').upsert(
    {
      id: user.id,
      email: user.email ?? '',
      name:
        user.user_metadata?.full_name ??
        user.user_metadata?.name ??
        user.email?.split('@')[0] ??
        'User',
      avatar_url: user.user_metadata?.avatar_url ?? user.user_metadata?.picture ?? null,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'id' }
  );

  console.log('[callback] users upsert error:', upsertError?.message ?? null);

  if (upsertError) {
    return NextResponse.redirect(`${origin}/login?error=profile_sync_failed`);
  }

  return response;
}