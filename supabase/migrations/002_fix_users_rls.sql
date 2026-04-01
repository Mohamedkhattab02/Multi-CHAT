-- ============================================================
-- FIX: Add INSERT policy for users table
-- The handle_new_user() trigger uses security definer and bypasses RLS,
-- but the fallback upsert in callback/route.ts runs as the authenticated user
-- and needs explicit INSERT permission.
-- ============================================================

-- Allow authenticated users to insert their own profile row
-- (used as fallback in OAuth callback if the trigger didn't fire)
do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'users'
      and policyname = 'Users insert own profile'
  ) then
    execute $policy$
      create policy "Users insert own profile"
        on public.users
        for insert
        with check (auth.uid() = id)
    $policy$;
  end if;
end;
$$;

-- Allow usage_logs insert (needed when chat actions log usage)
do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'usage_logs'
      and policyname = 'Users insert own usage'
  ) then
    execute $policy$
      create policy "Users insert own usage"
        on public.usage_logs
        for insert
        with check (auth.uid() = user_id)
    $policy$;
  end if;
end;
$$;
