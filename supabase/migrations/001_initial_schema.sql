-- ============================================================
-- EXTENSIONS
-- ============================================================
create extension if not exists vector;        -- pgvector for embeddings
create extension if not exists pg_trgm;       -- fuzzy text search
-- NOTE: pgmq and pg_cron REMOVED — replaced by Supabase Database Webhooks + Edge Functions

-- ============================================================
-- TABLES
-- ============================================================

-- 1. USER PROFILES (extends Supabase Auth)
create table public.users (
  id uuid references auth.users(id) on delete cascade primary key,
  email text,
  name text,
  avatar_url text,
  language text default 'auto',
  expertise text default 'general',
  preferred_model text default 'gemini-3.1-pro',
  preferences jsonb default '{}',
  daily_message_limit int default 100,
  messages_today int default 0,
  last_reset_date date default current_date,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- 2. CONVERSATIONS
create table public.conversations (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references public.users(id) on delete cascade not null,
  title text default 'New conversation',
  model text not null default 'GPT 5.1',
  summary text,
  system_prompt text,
  topic text,
  message_count int default 0,
  is_pinned boolean default false,
  share_token text unique,
  is_public boolean default false,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- 3. MESSAGES
create table public.messages (
  id uuid default gen_random_uuid() primary key,
  conversation_id uuid references public.conversations(id) on delete cascade not null,
  role text not null check (role in ('user', 'assistant', 'system')),
  content text not null,
  content_blocks jsonb,
  model text,
  token_count int,
  attachments jsonb default '[]',
  created_at timestamptz default now()
);

-- 4. MEMORIES (extracted facts about user)
create table public.memories (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references public.users(id) on delete cascade not null,
  type text not null check (type in ('fact', 'preference', 'goal', 'skill', 'opinion')),
  content text not null,
  confidence float default 0.8,
  source_conversation_id uuid references public.conversations(id) on delete set null,
  created_at timestamptz default now()
);

-- 5. EMBEDDINGS (vector store for RAG)
create table public.embeddings (
  id bigserial primary key,
  user_id uuid references public.users(id) on delete cascade not null,
  source_type text not null check (source_type in ('message', 'fact', 'document', 'summary')),
  source_id uuid,
  content text not null,
  embedding vector(1024) not null,
  fts tsvector generated always as (
    to_tsvector('english', content)
  ) stored,
  metadata jsonb default '{}',
  created_at timestamptz default now()
);

-- 6. FOLDERS (conversation organization)
create table public.folders (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references public.users(id) on delete cascade not null,
  name text not null,
  icon text default 'folder',
  sort_order int default 0,
  created_at timestamptz default now()
);

-- Add folder reference to conversations
alter table public.conversations add column folder_id uuid references public.folders(id) on delete set null;
create index idx_conversations_folder on conversations (folder_id);

-- 7. USER ENTITIES (lightweight knowledge graph)
create table public.user_entities (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references public.users(id) on delete cascade not null,
  entity_name text not null,
  entity_type text not null,
  properties jsonb default '{}',
  created_at timestamptz default now(),
  unique(user_id, entity_name, entity_type)
);

create table public.user_entity_relations (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references public.users(id) on delete cascade not null,
  from_entity_id uuid references public.user_entities(id) on delete cascade,
  to_entity_id uuid references public.user_entities(id) on delete cascade,
  relation_type text not null,
  created_at timestamptz default now()
);

-- 8. USAGE LOGS
create table public.usage_logs (
  id bigserial primary key,
  user_id uuid references public.users(id) on delete cascade not null,
  model text not null,
  input_tokens int default 0,
  output_tokens int default 0,
  cost_usd numeric(10, 6) default 0,
  endpoint text not null,
  created_at timestamptz default now()
);

-- ============================================================
-- INDEXES
-- ============================================================
create index idx_embeddings_hnsw on embeddings using hnsw (embedding vector_cosine_ops);
create index idx_embeddings_fts on embeddings using gin (fts);
create index idx_embeddings_trgm on embeddings using gin (content gin_trgm_ops);
create index idx_embeddings_user on embeddings (user_id, created_at desc);
create index idx_embeddings_meta on embeddings using gin (metadata);
create index idx_messages_conv on messages (conversation_id, created_at asc);
create index idx_conversations_user on conversations (user_id, updated_at desc);
create index idx_conversations_share on conversations (share_token) where share_token is not null;
create index idx_memories_user on memories (user_id, type);
create index idx_usage_user_date on usage_logs (user_id, created_at desc);

-- ============================================================
-- ROW LEVEL SECURITY
-- ============================================================
alter table public.users enable row level security;
alter table public.conversations enable row level security;
alter table public.messages enable row level security;
alter table public.memories enable row level security;
alter table public.embeddings enable row level security;
alter table public.folders enable row level security;
alter table public.user_entities enable row level security;
alter table public.user_entity_relations enable row level security;
alter table public.usage_logs enable row level security;

create policy "Users read own profile" on users for select using (auth.uid() = id);
create policy "Users update own profile" on users for update using (auth.uid() = id);

create policy "Users read own conversations" on conversations for all using (auth.uid() = user_id);
create policy "Anyone can read shared conversations" on conversations for select using (is_public = true and share_token is not null);

create policy "Users manage own messages" on messages for all using (
  auth.uid() = (select user_id from conversations where id = messages.conversation_id)
);
create policy "Anyone can read shared messages" on messages for select using (
  exists (select 1 from conversations where id = messages.conversation_id and is_public = true)
);

create policy "Users manage own memories" on memories for all using (auth.uid() = user_id);
create policy "Users manage own embeddings" on embeddings for all using (auth.uid() = user_id);
create policy "Users manage own folders" on folders for all using (auth.uid() = user_id);
create policy "Users manage own entities" on user_entities for all using (auth.uid() = user_id);
create policy "Users manage own relations" on user_entity_relations for all using (auth.uid() = user_id);
create policy "Users read own usage" on usage_logs for select using (auth.uid() = user_id);

-- ============================================================
-- AUTO-CREATE USER PROFILE ON SIGNUP
-- ============================================================
create or replace function public.handle_new_user()
returns trigger as $$
begin
  insert into public.users (id, email, name, avatar_url)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'full_name', new.raw_user_meta_data->>'name', split_part(new.email, '@', 1)),
    new.raw_user_meta_data->>'avatar_url'
  );
  return new;
end;
$$ language plpgsql security definer;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- ============================================================
-- HYBRID SEARCH FUNCTION (Vector + FTS + Fuzzy with RRF)
-- ============================================================
create or replace function hybrid_search(
  query_text text,
  query_embedding vector(1024),
  target_user_id uuid,
  match_count int default 5,
  full_text_weight float default 1.0,
  semantic_weight float default 1.0,
  fuzzy_weight float default 0.5,
  rrf_k int default 50
)
returns table (
  id bigint,
  content text,
  source_type text,
  metadata jsonb,
  created_at timestamptz,
  score float
)
language sql stable
as $$
  with full_text as (
    select embeddings.id,
      row_number() over (order by ts_rank_cd(fts, websearch_to_tsquery(query_text)) desc) as rank_ix
    from embeddings
    where user_id = target_user_id
      and fts @@ websearch_to_tsquery(query_text)
    order by rank_ix
    limit least(match_count * 4, 30)
  ),
  semantic as (
    select embeddings.id,
      row_number() over (order by embedding <=> query_embedding) as rank_ix
    from embeddings
    where user_id = target_user_id
    order by rank_ix
    limit least(match_count * 4, 30)
  ),
  fuzzy as (
    select embeddings.id,
      row_number() over (order by similarity(content, query_text) desc) as rank_ix
    from embeddings
    where user_id = target_user_id
      and content % query_text
    limit least(match_count * 2, 15)
  )
  select
    embeddings.id,
    embeddings.content,
    embeddings.source_type,
    embeddings.metadata,
    embeddings.created_at,
    (
      coalesce(1.0 / (rrf_k + full_text.rank_ix), 0.0) * full_text_weight +
      coalesce(1.0 / (rrf_k + semantic.rank_ix), 0.0) * semantic_weight +
      coalesce(1.0 / (rrf_k + fuzzy.rank_ix), 0.0) * fuzzy_weight
    ) as score
  from full_text
  full outer join semantic on full_text.id = semantic.id
  full outer join fuzzy on coalesce(full_text.id, semantic.id) = fuzzy.id
  join embeddings on coalesce(full_text.id, semantic.id, fuzzy.id) = embeddings.id
  order by score desc
  limit match_count;
$$;

-- ============================================================
-- AUTO-UPDATE CONVERSATION ON NEW MESSAGE
-- ============================================================
create or replace function auto_update_conversation()
returns trigger as $$
begin
  update conversations
  set message_count = message_count + 1,
      updated_at = now()
  where id = new.conversation_id;
  return new;
end;
$$ language plpgsql security definer;

create trigger on_message_insert
  after insert on messages
  for each row execute procedure auto_update_conversation();

-- ============================================================
-- DAILY MESSAGE LIMIT RESET
-- ============================================================
create or replace function reset_daily_message_counts()
returns void as $$
begin
  update users
  set messages_today = 0, last_reset_date = current_date
  where last_reset_date < current_date;
end;
$$ language plpgsql security definer;
