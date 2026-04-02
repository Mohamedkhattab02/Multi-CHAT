# CLAUDE CODE — FULL BUILD PROMPT
# Multi-Model AI Chat Platform

## PROJECT OVERVIEW

Build a production-ready multi-model AI chat platform called **"MultiChat AI"**.
The platform allows users to chat with 3 different AI models (GPT 5.1, Gemini 3.1 Pro, GLM 5), 
כל מודל מוחלק כאילו בפנים לשניים אחד חזק ומסתתר מאחורי את המודל החלש ממנו
כמו שילב

GPT 5.1    
gpt-5-mini  
שני המודלים כאן משולבים לפי רמת הקושי של השאלה ...

Gemini 3.1 Pro,  
Gemini 3 Flash Preview

GLM 5 יחיד
with an advanced 7-layer memory system, file/image upload support, voice input, shared conversations, and a modern responsive UI inspired by Claude's design.

**Special routing rules:**
- If user query needs internet access → route to **Gemini 3 Flash**
- If user input contains an image for analysis → route to **Gemini 3 Flash**
- If user requests image generation → route to **Gemini 3.1 Flash Image Preview** (1K resolution)

---

## TECH STACK

| Tool | Purpose |
|------|---------|
| **Next.js 16** (App Router) | Full-stack React framework |
| **TypeScript** | Type safety everywhere |
| **Supabase** | Database + Auth + Storage + Realtime + Edge Functions + Vector search |
| **Tailwind CSS 4** | Utility-first styling |
| **shadcn/ui** | Component library (Radix UI based) |
| **Vercel** | Hosting + deployment |
| **OpenAI SDK** | GPT 5.1 / gpt-5-mini API |
| **Google Generative AI SDK** | Gemini 3.1 Pro / Gemini 3 Flash / Gemini 3.1 Flash Image Preview |
| **Voyage AI** | Primary Embeddings (voyage-4-large) + Reranking (rerank-3) |
| **OpenAI Embeddings** | Fallback embeddings (text-embedding-3-large, 1024 dims) |
| **Zod** | Runtime input validation & schema enforcement |
| **Arcjet** | Rate limiting + bot protection |
| **DOMPurify** | XSS sanitization for markdown rendering |
| **Sentry** | Error tracking + performance monitoring |
| **Helicone** | AI API observability (cost, latency, errors) |
| **@tanstack/react-query** | Server state management + caching |
| **@tanstack/react-virtual** | Virtual scrolling for long conversations |
| **Framer Motion** | Animations (sidebar, messages, transitions) |
| **Tiptap** | Rich text editor (markdown shortcuts, slash commands) |
| **cmdk** | Command palette (Ctrl+K) |
| **Sonner** | Toast notifications |
| **react-markdown + remark-gfm** | Markdown rendering |
| **shiki** | Code syntax highlighting |
| **katex** | LaTeX math rendering |
| **@react-pdf/renderer** | PDF export (replaces html2pdf.js — full RTL + Unicode support) |
| **next-themes** | Dark/light mode |
| **lucide-react** | Icons |
| **zustand** | Client state management |
| **Web Speech API** | Voice input (browser-native, free) |

---

## PROJECT STRUCTURE
@PROJECT_STRUCTURE.md

## SUPABASE DATABASE SCHEMA

Create this as `supabase/migrations/001_initial_schema.sql`:

```sql
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
  summary text,                           -- rolling summary for GPT/Gemini
  system_prompt text,                     -- custom system prompt per conversation
  topic text,
  message_count int default 0,
  is_pinned boolean default false,
  share_token text unique,                -- for shared conversations
  is_public boolean default false,        -- shared conversation flag
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- 3. MESSAGES
create table public.messages (
  id uuid default gen_random_uuid() primary key,
  conversation_id uuid references public.conversations(id) on delete cascade not null,
  role text not null check (role in ('user', 'assistant', 'system')),
  content text not null,
  content_blocks jsonb,                    -- stores compaction blocks (CRITICAL)
  model text,                              -- which model generated this
  token_count int,
  attachments jsonb default '[]',          -- [{url, type, name, size}]
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
  embedding vector(1024) not null,         -- Voyage AI voyage-4-large (primary) / OpenAI fallback
  fts tsvector generated always as (
    to_tsvector('english', content)
  ) stored,
  metadata jsonb default '{}',             -- {topic, timestamp, conversation_id, ...}
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
  entity_type text not null,               -- 'tool', 'language', 'project', 'person', 'company'
  properties jsonb default '{}',
  created_at timestamptz default now(),
  unique(user_id, entity_name, entity_type)
);

create table public.user_entity_relations (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references public.users(id) on delete cascade not null,
  from_entity_id uuid references public.user_entities(id) on delete cascade,
  to_entity_id uuid references public.user_entities(id) on delete cascade,
  relation_type text not null,             -- 'uses', 'works_at', 'builds', 'knows'
  created_at timestamptz default now()
);

-- 8. USAGE LOGS (cost tracking per user — for Helicone + internal tracking)
create table public.usage_logs (
  id bigserial primary key,
  user_id uuid references public.users(id) on delete cascade not null,
  model text not null,
  input_tokens int default 0,
  output_tokens int default 0,
  cost_usd numeric(10, 6) default 0,
  endpoint text not null,                   -- 'chat', 'classify', 'embed', 'extract', 'rerank', 'image_gen'
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
-- ROW LEVEL SECURITY (CRITICAL — every table)
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

-- Users can only access their own data
create policy "Users read own profile" on users for select using (auth.uid() = id);
create policy "Users update own profile" on users for update using (auth.uid() = id);

create policy "Users read own conversations" on conversations for all using (auth.uid() = user_id);
-- Public shared conversations are readable by anyone
create policy "Anyone can read shared conversations" on conversations for select using (is_public = true and share_token is not null);

create policy "Users manage own messages" on messages for all using (
  auth.uid() = (select user_id from conversations where id = messages.conversation_id)
);
-- Public shared conversation messages are readable
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
-- EMBEDDING PIPELINE (Database Webhooks → Edge Function)
-- pgmq REMOVED — using Supabase Database Webhooks instead
-- ============================================================
-- Configure in Supabase Dashboard:
-- Database → Webhooks → Create webhook:
--   Table: messages
--   Events: INSERT
--   Type: Supabase Edge Function
--   Function: embed
--   Filter: role in ('user', 'assistant') 
-- This replaces pgmq + pg_cron with a simpler, officially supported approach.

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
```

---

## 7-LAYER MEMORY SYSTEM — IMPLEMENTATION DETAILS

### LAYER 1: Input Processing + Smart Routing (lib/ai/classifier.ts)

```typescript
// Smart classifier with special routing:
// 1. If query needs internet → Gemini 3 Flash (has search grounding)
// 2. If input has image for analysis → Gemini 3 Flash (vision)
// 3. If user requests image generation → Gemini 3.1 Flash Image Preview (1K)
// 4. Otherwise → route based on complexity + user's selected model
//
// Uses GLM 4.7 for classification (cheapest)
// All inputs validated with Zod

import { z } from 'zod';

const ClassificationSchema = z.object({
  intent: z.enum(['question', 'code', 'analysis', 'chitchat', 'creative', 'command', 'image_gen', 'web_search', 'image_analysis']),
  complexity: z.enum(['low', 'medium', 'high']), // זיהוי הסבר תהיה HIGH
  needsRAG: z.boolean(), // הבחירה תהיה לפי רמת הקושי . ועבור פעולות הסבר . קושי ברמה בינוני ו גדול יהיה עם RAG
  needsInternet: z.boolean(),
  hasImageInput: z.boolean(),
  needsImageGeneration: z.boolean(),
  routeOverride: z.enum(['gemini-3-flash', 'gemini-3.1-flash-image', 'none']),
  suggestedModel: z.string(),
  language: z.string(),
  mainTopic: z.string(),
});

export type ClassificationResult = z.infer<typeof ClassificationSchema>;

export async function classifyIntent(
  message: string,
  hasImageAttachment: boolean = false
): Promise<ClassificationResult> {
  // Fast path: if image is attached, route to Gemini 3 Flash for vision
  if (hasImageAttachment) {
    return {
      intent: 'image_analysis',
      complexity: 'medium',
      needsRAG: false,
      needsInternet: false,
      hasImageInput: true,
      needsImageGeneration: false,
      routeOverride: 'gemini-3-flash',
      suggestedModel: 'gemini-3-flash',
      language: 'auto',
      mainTopic: 'image analysis',
    };
  }

  // Quick regex checks before calling LLM
  const imageGenPatterns = /\b(צור תמונה|generate image|create image|draw|paint|illustrate|ציור|תמונה של)\b/i;
  const webSearchPatterns = /\b(מזג אוויר|weather|today|latest|current|news|חדשות|score|price|מחיר|שער|stock|search|חפש)\b/i;

  if (imageGenPatterns.test(message)) {
    return {
      intent: 'image_gen',
      complexity: 'medium',
      needsRAG: false,
      needsInternet: false,
      hasImageInput: false,
      needsImageGeneration: true,
      routeOverride: 'gemini-3.1-flash-image',
      suggestedModel: 'gemini-3.1-flash-image',
      language: 'auto',
      mainTopic: 'image generation',
    };
  }

  if (webSearchPatterns.test(message)) {
    return {
      intent: 'web_search',
      complexity: 'medium',
      needsRAG: false,
      needsInternet: true,
      hasImageInput: false,
      needsImageGeneration: false,
      routeOverride: 'gemini-3-flash',
      suggestedModel: 'gemini-3-flash',
      language: 'auto',
      mainTopic: 'web search',
    };
  }


  // Full LLM classification for complex queries
  try {
    const response = await fetch('https://open.bigmodel.cn/api/v4/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.GLM_API_KEY}`,
      },
      body: JSON.stringify({
        model: 'glm-4-7b',
        max_tokens: 300,
        messages: [{
          role: 'system',
          content: `Classify the user message. Return ONLY valid JSON:
{"intent":"question|code|analysis|chitchat|creative|command|image_gen|web_search",
"complexity":"low|medium|high",
"needsRAG":true|false,
"needsInternet":true|false,
"hasImageInput":false,
"needsImageGeneration":true|false,
"routeOverride":"gemini-3-flash|gemini-3.1-flash-image|none",
"suggestedModel":"auto",
"language":"en|he|ar|auto",
"mainTopic":"brief topic"}

ROUTING RULES:
- If query needs real-time data, current info, or internet → routeOverride:"gemini-3-flash", needsInternet:true
- If query asks to generate/create/draw an image → routeOverride:"gemini-3.1-flash-image", needsImageGeneration:true
- chitchat/greetings → needsRAG:false, complexity:low
- Code/analysis → needsRAG:true, complexity:high`
        }, {
          role: 'user',
          content: message
        }]
      })
    });

    const data = await response.json();
    const text = data.choices?.[0]?.message?.content || '';
    const parsed = JSON.parse(text);
    return ClassificationSchema.parse(parsed);
  } catch (error) {
    // Fallback: safe defaults — Sentry will capture the error
    console.error('[Classifier] Failed, using fallback:', error);
    return {
      intent: 'question',
      complexity: 'medium',
      needsRAG: true,
      needsInternet: false,
      hasImageInput: false,
      needsImageGeneration: false,
      routeOverride: 'none',
      suggestedModel: 'auto',
      language: 'auto',
      mainTopic: 'unknown',
    };
  }
}
```

### LAYER 2: RAG Pipeline (lib/memory/rag-pipeline.ts)

```typescript
// Hybrid search: pgvector + tsvector + pg_trgm via Supabase RPC
// Then MANDATORY Voyage AI Reranking for +30-40% accuracy

import { createClient } from '@supabase/supabase-js';
import { generateEmbedding } from '@/lib/ai/embeddings';
import { rerankResults } from '@/lib/ai/reranker';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function retrieveMemories(
  userId: string,
  message: string,
  topK: number = 5
): Promise<string> {
  // 1. Generate embedding for the query (Voyage AI primary, OpenAI fallback)
  const embedding = await generateEmbedding(message);

  // 2. Hybrid search via Supabase RPC function — fetch more candidates for reranking
  const { data: results, error } = await supabase.rpc('hybrid_search', {
    query_text: message,
    query_embedding: embedding,
    target_user_id: userId,
    match_count: topK * 3,  // fetch 3x more for reranking
    full_text_weight: 1.0,
    semantic_weight: 1.5,
    fuzzy_weight: 0.5,
  });

  if (error || !results?.length) return '';

  // 3. MANDATORY Voyage AI Reranking — improves accuracy by 30-40%
  const reranked = await rerankResults(message, results, topK);

  // 4. Format results for context injection
  return reranked.map((r: any, i: number) =>
    `[Memory ${i + 1}] (${r.source_type}, ${formatTimeAgo(r.created_at)}): ${r.content}`
  ).join('\n\n');
}
```

### Embeddings with Fallback (lib/ai/embeddings.ts)

```typescript
// Primary: Voyage AI voyage-4-large (1024 dims)
// Fallback: OpenAI text-embedding-3-large (truncated to 1024 dims)
// Automatic failover if Voyage AI is down

import * as Sentry from '@sentry/nextjs';

export async function generateEmbedding(text: string): Promise<number[]> {
  try {
    // Primary: Voyage AI
    return await generateVoyageEmbedding(text);
  } catch (error) {
    Sentry.captureException(error, { tags: { service: 'voyage-ai', action: 'embedding' } });
    console.warn('[Embeddings] Voyage AI failed, falling back to OpenAI:', error);

    // Fallback: OpenAI
    return await generateOpenAIEmbedding(text);
  }
}

async function generateVoyageEmbedding(text: string): Promise<number[]> {
  const response = await fetch('https://api.voyageai.com/v1/embeddings', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${process.env.VOYAGE_AI_API_KEY}`,
    },
    body: JSON.stringify({
      model: 'voyage-4-large',
      input: text.slice(0, 8000),
      input_type: 'document',
    }),
  });

  if (!response.ok) throw new Error(`Voyage AI error: ${response.status}`);
  const data = await response.json();
  return data.data[0].embedding; // 1024 dimensions
}

async function generateOpenAIEmbedding(text: string): Promise<number[]> {
  const response = await fetch('https://api.openai.com/v1/embeddings', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
    },
    body: JSON.stringify({
      model: 'text-embedding-3-large',
      input: text.slice(0, 8000),
      dimensions: 1024,  // truncate to match Voyage AI dimensions
    }),
  });

  if (!response.ok) throw new Error(`OpenAI embeddings error: ${response.status}`);
  const data = await response.json();
  return data.data[0].embedding; // 1024 dimensions (truncated)
}
```

### Voyage AI Reranker (lib/ai/reranker.ts)

```typescript
// MANDATORY reranking — Voyage AI rerank-3
// Applied after hybrid search, before context injection
// Improves RAG accuracy by 30-40%

import * as Sentry from '@sentry/nextjs';

export async function rerankResults(
  query: string,
  documents: Array<{ content: string; [key: string]: any }>,
  topK: number = 5
): Promise<Array<{ content: string; [key: string]: any }>> {
  if (documents.length <= topK) return documents;

  try {
    const response = await fetch('https://api.voyageai.com/v1/rerank', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.VOYAGE_AI_API_KEY}`,
      },
      body: JSON.stringify({
        model: 'rerank-3',
        query,
        documents: documents.map(d => d.content),
        top_k: topK,
      }),
    });

    if (!response.ok) throw new Error(`Voyage Rerank error: ${response.status}`);
    const data = await response.json();

    // Return documents in reranked order
    return data.data.map((r: any) => documents[r.index]);
  } catch (error) {
    Sentry.captureException(error, { tags: { service: 'voyage-ai', action: 'rerank' } });
    console.warn('[Reranker] Failed, returning original order:', error);
    // Graceful fallback: return top-K in original score order
    return documents.slice(0, topK);
  }
}
```

### LAYER 3: Context Assembly (lib/memory/context-assembler.ts)

```typescript
// Build the final messages array with strict token budgets
// Different assembly per model

import { z } from 'zod';

interface TokenBudget {
  system: number;
  rag: number;
  history: number;
  output: number;
  thinking: number;
}

const BUDGETS: Record<string, TokenBudget> = {
  'gpt-5.1':              { system: 5000, rag: 5000, history: 30000, output: 4096, thinking: 0 },
  'gpt-5-mini':           { system: 3000, rag: 3000, history: 20000, output: 4096, thinking: 0 },
  'gemini-3.1-pro':       { system: 5000, rag: 5000, history: 50000, output: 8192, thinking: 0 },
  'gemini-3-flash':       { system: 3000, rag: 3000, history: 30000, output: 4096, thinking: 0 },
  'glm-5':                { system: 5000, rag: 5000, history: 30000, output: 4096, thinking: 0 },
};

export function assembleContext(params: {
  model: string;
  userProfile: any;
  ragContext: string;
  messages: any[];
  rollingSummary?: string;
  language: string;
}) {
  const budget = BUDGETS[params.model] || BUDGETS['gemini-3.1-pro'];

  const systemPrompt = buildSystemPrompt(params.userProfile, params.ragContext, params.language);

  let assembledMessages = [];

  // Inject rolling summary as pseudo-message for models without compaction
  if (params.rollingSummary) {
    assembledMessages.push(
      { role: 'user', content: `[Previous conversation context]: ${params.rollingSummary}` },
      { role: 'assistant', content: 'I have the context from our earlier conversation. Let\'s continue.' }
    );
  }

  // Add recent messages (respecting token budget)
  const recentMessages = trimToTokenBudget(params.messages, budget.history);
  assembledMessages.push(...recentMessages);

  return { systemPrompt, messages: assembledMessages };
}
```

### LAYER 4: Model Handlers   //router gemeni flash/pro gpt 5.1/5 mini

**Gemini 3.1 Flash Image Preview — Image Generation (lib/ai/gemini-image.ts)**:

```typescript
// Gemini 3.1 Flash Image Preview — generates images at 1K resolution
// Triggered when classifier detects image generation intent

import { GoogleGenerativeAI } from '@google/generative-ai';
import * as Sentry from '@sentry/nextjs';

const genAI = new GoogleGenerativeAI(process.env.GOOGLE_AI_API_KEY!);

export async function generateImage(prompt: string): Promise<{
  imageBase64: string;
  mimeType: string;
  revisedPrompt: string;
}> {
  try {
    const model = genAI.getGenerativeModel({
      model: 'gemini-3.1-flash-image-preview',
      generationConfig: {
        responseModalities: ['image', 'text'],
        // 1K resolution output
      },
    });

    const result = await model.generateContent(prompt);
    const response = result.response;

    // Extract image from response
    const imagePart = response.candidates?.[0]?.content?.parts?.find(
      (p: any) => p.inlineData
    );

    if (!imagePart?.inlineData) {
      throw new Error('No image generated');
    }

    return {
      imageBase64: imagePart.inlineData.data,
      mimeType: imagePart.inlineData.mimeType || 'image/png',
      revisedPrompt: response.candidates?.[0]?.content?.parts?.find(
        (p: any) => p.text
      )?.text || prompt,
    };
  } catch (error) {
    Sentry.captureException(error, { tags: { model: 'gemini-flash-image' } });
    throw error;
  }
}
```

### LAYER 5: Post-Processing (supabase/functions/extract-memories/index.ts)

```typescript
// Supabase Edge Function — triggered by Database Webhook (replaces pgmq)
// Runs async after each response
// Extracts facts/preferences/goals and stores in memories table
// Now with Zod validation + Sentry error capture

import { serve } from 'https://deno.land/std/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js';

serve(async (req) => {
  const { userId, message, response, embedding } = await req.json();

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  );

  try {
    // Use GLM for extraction (cheapest option)
    const extractionResponse = await fetch('https://open.bigmodel.cn/api/v4/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${Deno.env.get('GLM_API_KEY')}`,
      },
      body: JSON.stringify({
        model: 'glm-4-7b',
        max_tokens: 500,
        messages: [{
          role: 'system',
          content: `Extract facts about the user. Return ONLY JSON array:
[{"type":"fact|preference|goal|skill","content":"...","confidence":0.0-1.0}]
Only extract clearly stated info. Return [] if none.`
        }, {
          role: 'user',
          content: `User: "${message.slice(0, 1000)}"\nAssistant: "${response.slice(0, 500)}"`
        }]
      })
    });

    const data = await extractionResponse.json();
    const text = data.choices?.[0]?.message?.content || '[]';

    // Validate with try-catch instead of raw JSON.parse
    let memories;
    try {
      memories = JSON.parse(text);
      if (!Array.isArray(memories)) memories = [];
    } catch {
      memories = [];
    }

    // Store validated memories
    if (memories.length > 0) {
      await supabase.from('memories').insert(
        memories.map((m: any) => ({
          user_id: userId,
          type: ['fact', 'preference', 'goal', 'skill', 'opinion'].includes(m.type) ? m.type : 'fact',
          content: String(m.content).slice(0, 500),
          confidence: Math.min(Math.max(Number(m.confidence) || 0.5, 0), 1),
        }))
      );
    }

    return new Response(JSON.stringify({ extracted: memories.length }), {
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (error) {
    console.error('[extract-memories] Error:', error);
    return new Response(JSON.stringify({ error: String(error) }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
});
```

### LAYER 6: Realtime Delivery (app/api/chat/route.ts)

```typescript
// Main SSE streaming endpoint — orchestrates all 7 layers
// NOW WITH: Arcjet rate limiting, Zod validation, AbortController,
// error boundaries, retry logic, Sentry capture, usage logging

import { NextRequest } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { classifyIntent } from '@/lib/ai/classifier';
import { retrieveMemories } from '@/lib/memory/rag-pipeline';
import { assembleContext } from '@/lib/memory/context-assembler';
import { streamGPT } from '@/lib/ai/openai';
import { streamGemini } from '@/lib/ai/gemini';
import { streamGLM } from '@/lib/ai/glm';
import { generateImage } from '@/lib/ai/gemini-image';
import { generateRollingSummary } from '@/lib/memory/rolling-summary';
import { chatRequestSchema } from '@/lib/security/validate';
import { checkRateLimit } from '@/lib/security/rate-limit';
import * as Sentry from '@sentry/nextjs';
import { z } from 'zod';

export async function POST(req: NextRequest) {
  // ═══ SECURITY: Rate Limiting (Arcjet) ═══
  const rateLimitResult = await checkRateLimit(req);
  if (!rateLimitResult.allowed) {
    return new Response('Rate limit exceeded', { status: 429 });
  }

  // ═══ SECURITY: Input Validation (Zod) ═══
  let body;
  try {
    const raw = await req.json();
    body = chatRequestSchema.parse(raw);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return new Response(JSON.stringify({ error: 'Invalid input', details: error.errors }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    return new Response('Bad request', { status: 400 });
  }

  const { message, conversationId, model, attachments } = body;
  const supabase = await createServerClient();

  // Get authenticated user
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return new Response('Unauthorized', { status: 401 });

  // ═══ SECURITY: Daily message limit ═══
  const { data: userProfile } = await supabase
    .from('users').select('*').eq('id', user.id).single();

  if (userProfile && userProfile.messages_today >= userProfile.daily_message_limit) {
    return new Response(JSON.stringify({ error: 'Daily message limit reached' }), {
      status: 429,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Increment message count
  await supabase.from('users').update({
    messages_today: (userProfile?.messages_today || 0) + 1,
    last_reset_date: new Date().toISOString().split('T')[0],
  }).eq('id', user.id);

  // ═══ LAYER 1: INPUT PROCESSING + SMART ROUTING ═══
  const hasImageAttachment = attachments?.some((a: any) => a.type?.startsWith('image/'));
  const intent = await classifyIntent(message, hasImageAttachment);

  // ═══ SPECIAL ROUTE: Image Generation ═══
  if (intent.needsImageGeneration) {
    try {
      const imageResult = await generateImage(message);
      // Save message + image to DB, return image response
      await supabase.from('messages').insert({
        conversation_id: conversationId,
        role: 'user', content: message, model: 'gemini-3.1-flash-image'
      });
      await supabase.from('messages').insert({
        conversation_id: conversationId,
        role: 'assistant',
        content: imageResult.revisedPrompt,
        model: 'gemini-3.1-flash-image',
        attachments: [{
          type: imageResult.mimeType,
          data: imageResult.imageBase64,
          name: 'generated-image.png'
        }]
      });
      return new Response(JSON.stringify({
        type: 'image',
        image: imageResult.imageBase64,
        mimeType: imageResult.mimeType,
        text: imageResult.revisedPrompt,
      }), { headers: { 'Content-Type': 'application/json' } });
    } catch (error) {
      Sentry.captureException(error, { tags: { action: 'image_generation' } });
      return new Response(JSON.stringify({ error: 'Image generation failed' }), { status: 500 });
    }
  }

  // Determine actual model to use (with routing overrides)
  const actualModel = intent.routeOverride !== 'none'
    ? intent.routeOverride
    : model;

  // ═══ LAYER 2: MEMORY RETRIEVAL (RAG) + Reranking ═══
  const ragContext = intent.needsRAG
    ? await retrieveMemories(user.id, message)
    : '';

  // ═══ LAYER 3: CONTEXT ASSEMBLY ═══
  const { data: conversation } = await supabase
    .from('conversations').select('*').eq('id', conversationId).single();

  const { data: history } = await supabase
    .from('messages')
    .select('role, content, content_blocks')
    .eq('conversation_id', conversationId)
    .order('created_at', { ascending: true });

  // Save user message to DB
  await supabase.from('messages').insert({
    conversation_id: conversationId,
    role: 'user',
    content: message,
    model: actualModel,
    attachments: attachments || []
  });

  const { systemPrompt, messages: assembledMessages } = assembleContext({
    model: actualModel,
    userProfile,
    ragContext,
    messages: [...(history || []), { role: 'user', content: message }],
    rollingSummary: conversation?.summary,
    language: intent.language,
  });

  // ═══ LAYER 4: GENERATION (STREAMING) with AbortController ═══
  const encoder = new TextEncoder();
  const abortController = new AbortController();

  // Clean up on client disconnect
  req.signal.addEventListener('abort', () => abortController.abort());

  const stream = new ReadableStream({
    async start(controller) {
      try {
        let generator;
        switch (actualModel) {
          case 'gpt-5.1':
          case 'gpt-5-mini':
            generator = streamGPT({ systemPrompt, messages: assembledMessages, model: actualModel });
            break;
          case 'gemini-3.1-pro':
          case 'gemini-3-flash':
            generator = streamGemini({
              systemPrompt,
              messages: assembledMessages,
              model: actualModel,
              enableSearch: intent.needsInternet,  // Gemini search grounding
            });
            break;
          case 'glm-5':
            generator = streamGLM({ systemPrompt, messages: assembledMessages });
            break;
          default:
            throw new Error(`Unknown model: ${actualModel}`);
        }

        // Heartbeat to prevent timeout
        const heartbeatInterval = setInterval(() => {
          if (!abortController.signal.aborted) {
            controller.enqueue(encoder.encode(': heartbeat\n\n'));
          }
        }, 15000);

        for await (const event of generator) {
          if (abortController.signal.aborted) break;

          if (event.type === 'text') {
            controller.enqueue(
              encoder.encode(`data: ${JSON.stringify({ text: event.text })}\n\n`)
            );
          } else if (event.type === 'done') {
            clearInterval(heartbeatInterval);

            // ═══ LAYER 5: POST-PROCESSING ═══
            await supabase.from('messages').insert({
              conversation_id: conversationId,
              role: 'assistant',
              content: event.fullText,
              content_blocks: event.contentBlocks,
              model: actualModel,
            });

            // Usage logging (for Helicone tracking)
            await supabase.from('usage_logs').insert({
              user_id: user.id,
              model: actualModel,
              input_tokens: event.usage?.inputTokens || 0,
              output_tokens: event.usage?.outputTokens || 0,
              cost_usd: event.usage?.cost || 0,
              endpoint: 'chat',
            }).catch(() => {}); // non-critical

            // Generate rolling summary (every 10 messages)
            const messageCount = (history?.length || 0) + 2;
            if (messageCount > 12 && messageCount % 10 === 0) {
              const summary = await generateRollingSummary(
                conversation?.summary,
                history?.slice(-10) || [],
                message,
                event.fullText
              );
              await supabase.from('conversations')
                .update({ summary })
                .eq('id', conversationId);
            }

            // Auto-generate title for new conversations
            if ((history?.length || 0) === 0) {
              const title = await generateTitle(message, event.fullText);
              await supabase.from('conversations')
                .update({ title, topic: intent.mainTopic })
                .eq('id', conversationId);
            }

            // Trigger memory extraction (async — Edge Function via webhook)
            // Memory extraction runs every 5 messages to save costs
            if (messageCount % 5 === 0) {
              supabase.functions.invoke('extract-memories', {
                body: { userId: user.id, message, response: event.fullText }
              }).catch((err) => Sentry.captureException(err));
            }

            controller.enqueue(encoder.encode('data: [DONE]\n\n'));
          }
        }

        clearInterval(heartbeatInterval);
      } catch (error) {
        Sentry.captureException(error, {
          tags: { model: actualModel, action: 'stream' },
          extra: { conversationId, messageLength: message.length },
        });
        controller.enqueue(
          encoder.encode(`data: ${JSON.stringify({ error: 'An error occurred. Please try again.' })}\n\n`)
        );
      }
      controller.close();
    }
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    }
  });
}
```

### LAYER 7: Storage — handled by the schema above

---

## SECURITY LAYER — NEW

### Arcjet Rate Limiting (lib/security/rate-limit.ts)

```typescript
// Rate limiting per user and per IP
// Protects AI API spend from abuse

import arcjet, { tokenBucket, detectBot } from '@arcjet/next';

const aj = arcjet({
  key: process.env.ARCJET_KEY!,
  rules: [
    tokenBucket({
      mode: 'LIVE',
      refillRate: 10,    // 10 messages per minute
      interval: 60,
      capacity: 30,      // burst capacity
    }),
    detectBot({
      mode: 'LIVE',
      allow: [],         // block all bots
    }),
  ],
});

export async function checkRateLimit(req: Request) {
  const decision = await aj.protect(req);
  return { allowed: decision.isAllowed() };
}
```

### Zod Validation Schemas (lib/security/validate.ts)

```typescript
// All API input schemas — validated before processing

import { z } from 'zod';

export const chatRequestSchema = z.object({
  message: z.string().min(1).max(32000),
  conversationId: z.string().uuid(),
  model: z.string().min(1),
  attachments: z.array(z.object({
    url: z.string().url().optional(),
    type: z.string(),
    name: z.string(),
    size: z.number().max(10 * 1024 * 1024), // 10MB max
    data: z.string().optional(), // base64 for images
  })).optional().default([]),
});

export const conversationCreateSchema = z.object({
  title: z.string().max(200).optional(),
  model: z.string().min(1),
  system_prompt: z.string().max(4000).optional(),
});

export const shareConversationSchema = z.object({
  conversationId: z.string().uuid(),
  action: z.enum(['create', 'revoke']),
});
```

### DOMPurify Sanitization (lib/security/sanitize.ts)

```typescript
// Sanitize all markdown output before rendering
// Prevents XSS from user-generated content

import DOMPurify from 'dompurify';

export function sanitizeHtml(html: string): string {
  return DOMPurify.sanitize(html, {
    ALLOWED_TAGS: [
      'p', 'br', 'strong', 'em', 'code', 'pre', 'blockquote',
      'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
      'ul', 'ol', 'li', 'a', 'img', 'table', 'thead', 'tbody',
      'tr', 'th', 'td', 'span', 'div', 'del', 'input',
    ],
    ALLOWED_ATTR: [
      'href', 'src', 'alt', 'class', 'id', 'target', 'rel',
      'type', 'checked', 'disabled', 'dir',
    ],
    ALLOW_DATA_ATTR: false,
  });
}
```

---

## MONITORING LAYER — NEW

### Helicone AI Proxy (lib/monitoring/helicone.ts)

```typescript
// Proxy all AI API calls through Helicone for observability
// Tracks: latency, cost, token usage, error rates per model
// Setup: Replace base URLs in AI handlers

// For OpenAI:
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
  baseURL: 'https://oai.helicone.ai/v1',
  defaultHeaders: {
    'Helicone-Auth': `Bearer ${process.env.HELICONE_API_KEY}`,
    'Helicone-User-Id': userId, // per-user tracking
  },
});

// For Google AI (Gemini) — custom header injection
// Helicone provides a gateway for Google AI too

// Dashboard: https://helicone.ai/dashboard
// Free tier: 100K requests/month
```

### Sentry Configuration

```typescript
// sentry.client.config.ts
import * as Sentry from '@sentry/nextjs';

Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  tracesSampleRate: 0.2,       // 20% of transactions
  replaysSessionSampleRate: 0.1, // 10% session replays
  replaysOnErrorSampleRate: 1.0, // 100% replay on error
  environment: process.env.NODE_ENV,
});
```

---

## VOICE INPUT — Web Speech API (components/chat/VoiceInput.tsx)

```typescript
// Browser-native speech-to-text — FREE, no API key needed
// Supports: English, Hebrew, Arabic
// Falls back gracefully if browser doesn't support it

'use client';

import { useState, useRef, useCallback } from 'react';
import { Mic, MicOff } from 'lucide-react';

interface VoiceInputProps {
  onTranscript: (text: string) => void;
  language?: string; // 'en-US' | 'he-IL' | 'ar-SA' | auto
}

export function VoiceInput({ onTranscript, language = 'auto' }: VoiceInputProps) {
  const [isListening, setIsListening] = useState(false);
  const recognitionRef = useRef<SpeechRecognition | null>(null);

  const isSupported = typeof window !== 'undefined' &&
    ('SpeechRecognition' in window || 'webkitSpeechRecognition' in window);

  const startListening = useCallback(() => {
    if (!isSupported) return;

    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    const recognition = new SpeechRecognition();

    recognition.continuous = true;
    recognition.interimResults = true;

    // Language mapping
    const langMap: Record<string, string> = {
      'auto': 'en-US',
      'en': 'en-US',
      'he': 'he-IL',
      'ar': 'ar-SA',
    };
    recognition.lang = langMap[language] || 'en-US';

    recognition.onresult = (event) => {
      const transcript = Array.from(event.results)
        .map((result) => result[0].transcript)
        .join('');

      if (event.results[event.results.length - 1].isFinal) {
        onTranscript(transcript);
      }
    };

    recognition.onerror = (event) => {
      console.error('[VoiceInput] Error:', event.error);
      setIsListening(false);
    };

    recognition.onend = () => setIsListening(false);

    recognition.start();
    recognitionRef.current = recognition;
    setIsListening(true);
  }, [isSupported, language, onTranscript]);

  const stopListening = useCallback(() => {
    recognitionRef.current?.stop();
    setIsListening(false);
  }, []);

  if (!isSupported) return null; // Hide button if not supported

  return (
    <button
      type="button"
      onClick={isListening ? stopListening : startListening}
      className={`p-2 rounded-full transition-colors ${
        isListening
          ? 'bg-red-100 text-red-600 animate-pulse'
          : 'text-gray-400 hover:text-gray-600'
      }`}
      title={isListening ? 'Stop recording' : 'Voice input'}
    >
      {isListening ? <MicOff size={20} /> : <Mic size={20} />}
    </button>
  );
}
```

---

## UI/UX SPECIFICATIONS

### Design System
- **Inspired by Claude's UI**: Clean, minimal, generous whitespace, warm neutral tones
- **Font**: Inter (or system font stack), monospace for code (JetBrains Mono / Fira Code)
- **Colors**: Warm neutral grays (#F5F5F0 light bg, #1A1A1A dark bg), accent blue/purple for interactive elements
- **Dark mode + Light mode**: System preference + manual toggle via next-themes. Both modes MUST be fully tested. Use CSS variables for all colors.
- **Fully responsive**: Mobile-first design. Breakpoints: sm(640px), md(768px), lg(1024px), xl(1280px)
- **RTL support**: dir="auto" on all message content for Hebrew/Arabic auto-detection
- **Animations**: Framer Motion for sidebar toggle, message enter/exit, page transitions. AnimatePresence for smooth mount/unmount. Gesture support for swipe-to-delete on mobile.

### Layout (Sidebar like Claude — left panel)
- **Desktop (lg+)**: Fixed sidebar (280px) on LEFT + main chat area. Sidebar always visible by default with toggle button to collapse. Framer Motion layout animation on toggle.
- **Tablet (md)**: Collapsible sidebar, starts collapsed. Toggle button in header.
- **Mobile (sm)**: Sidebar as full-screen overlay with backdrop. Hamburger menu in header to open. Swipe right to open.
- **Sidebar content**: Logo + "New chat" button (top) → Search bar → Folder/category filter → Conversation list (grouped by date, virtualized with @tanstack/react-virtual) → User menu (bottom)
- **Chat area**: Message list (virtualized, flex-grow, scroll to bottom on new message) + sticky input bar (bottom)
- **Input bar**: Tiptap rich text editor (markdown shortcuts, slash commands) + attach file button (left) + voice input button (left) + model selector dropdown (left of send) + send button (right). Shift+Enter for newline, Enter to send.

### Message Rendering
- **User messages**: Left-aligned with user avatar (initials circle), light background card
- **Assistant messages**: Left-aligned with model-specific icon (different icon per model: GLM=purple, GPT=green, Gemini=blue), no background
- **Generated images**: Inline preview with "Generated by Gemini" label, click to expand
- **Markdown**: Full GFM support via react-markdown + remark-gfm. **ALL HTML output sanitized with DOMPurify** before rendering.
- **Code blocks**: Syntax highlighted via shiki with language label (top-right), copy button (top-right), line numbers for blocks > 5 lines. Support 50+ languages. Dark theme for code blocks in both light/dark mode.
- **Inline code**: Monospace with subtle background
- **LaTeX math**: KaTeX rendering. $inline math$ and $$display math$$ blocks. Import remark-math + rehype-katex.
- **Images**: Inline preview (max-width 400px, click to expand in lightbox)
- **Files**: File card with icon (based on type) + name + size + download link
- **Streaming**: Token-by-token append with subtle blinking cursor (CSS animation). Smooth scroll-to-bottom during streaming.
- **Timestamps**: Show on hover (relative time using native `Intl.RelativeTimeFormat` — no date-fns)
- **Message actions** (on hover): Copy message, Regenerate (assistant only), Delete

### Model Selector
- Dropdown in the input bar (left side, before textarea)
- Shows: model icon + short name ("GLM 5" / "GPT 5.1" / "Gemini 3.1 PRO")
- Persists choice per conversation (saved in conversations.model)
- Can be changed mid-conversation (new messages use new model, old messages keep their model icon)
- Each model has a distinct color: GLM = purple (#7C3AED), GPT = emerald (#10B981), Gemini = blue (#3B82F6)
- Special routing note: When classifier detects internet/image needs, routing override is shown as a subtle badge "🔍 via Gemini Flash" or "🎨 via Gemini Image"

### Command Palette (cmdk)
- `Ctrl/Cmd + K` opens global command palette
- Search across: conversations, commands, models, settings
- Commands: New chat, Switch model, Toggle theme, Toggle sidebar, Export, Share
- Fuzzy search with highlighted matches
- Recent commands section

### Shared Conversations
- Share button in chat header → generates unique share link
- Shared conversations are read-only for visitors (no auth required)
- Shareable link: `multichatai.com/shared/[shareToken]`
- Owner can revoke share link at any time
- Shared view shows: messages, model icons, timestamps, but NO edit/delete actions

### Conversations Sidebar (Claude-style left panel)
- **"New chat" button**: Prominent at top, creates new conversation with default model
- **Search bar**: Below button, searches across all conversation titles and message content
- **Folders/Categories**: Optional folder system. Default folders: "All", "Starred". Users can create custom folders. Drag conversation into folder.
- **Conversation list**: Grouped by: Today, Yesterday, Previous 7 days, Previous 30 days, Older. **Virtualized** with @tanstack/react-virtual for performance.
- **Each conversation item**: Model icon (colored dot) + title (truncated to 1 line) + relative time + unread indicator
- **Hover actions**: Rename (pencil icon), Delete (trash icon), Star/Pin (star icon), Share (link icon)
- **Right-click context menu**: Rename, Move to folder, Share, Export, Delete
- **Active conversation**: Highlighted with accent color background

### Export Feature
- Export current chat as **Markdown** (.md file download)
- Export current chat as **PDF** (via `@react-pdf/renderer` server-side — full RTL + Unicode support)
- Export button in chat header area (top-right)
- Exported markdown includes: title, model used, timestamps, full message content with formatting

### Keyboard Shortcuts
- `Ctrl/Cmd + K`: Command palette (cmdk — search + commands)
- `Ctrl/Cmd + N`: New conversation
- `Ctrl/Cmd + Shift + S`: Toggle sidebar
- `Ctrl/Cmd + Shift + L`: Toggle dark/light mode
- `Escape`: Close sidebar on mobile, close command palette, cancel current action

---

## ENVIRONMENT VARIABLES (.env.local)

```bash
# Supabase
NEXT_PUBLIC_SUPABASE_URL=your_supabase_url
NEXT_PUBLIC_SUPABASE_ANON_KEY=your_anon_key
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key

# AI Models
OPENAI_API_KEY=your_openai_key
GOOGLE_AI_API_KEY=your_google_ai_key
GLM_API_KEY=your_glm_key

# Embeddings & Reranking
VOYAGE_AI_API_KEY=your_voyage_key
# OpenAI embeddings use OPENAI_API_KEY above (fallback)

# Security
ARCJET_KEY=your_arcjet_key

# Monitoring
NEXT_PUBLIC_SENTRY_DSN=your_sentry_dsn
SENTRY_AUTH_TOKEN=your_sentry_auth_token
HELICONE_API_KEY=your_helicone_key

# App
NEXT_PUBLIC_APP_URL=http://localhost:3000
```

---

## BUILD ORDER (execute in this sequence)

### Phase 0: Security & Monitoring Foundation (FIRST)
1. Install security packages: `zod`, `arcjet`, `dompurify`, `@types/dompurify`
2. Install monitoring: `@sentry/nextjs`, configure `sentry.client.config.ts` + `sentry.server.config.ts`
3. Set up Helicone proxy (change AI base URLs)
4. Create Zod validation schemas for all API routes (`lib/security/validate.ts`)
5. Configure Arcjet rate limiting in middleware.ts
6. Create DOMPurify sanitize wrapper
7. Set up ErrorBoundary component with Sentry

### Phase 1: Foundation
8. `npx create-next-app@latest multichatai --typescript --tailwind --app --src-dir=true`
9. Install all dependencies
10. Set up Supabase project + run migrations (includes usage_logs, share_token, system_prompt)
11. Configure Supabase Auth (Google OAuth)
12. Configure Supabase Database Webhooks (messages INSERT → embed Edge Function)
13. Set up middleware.ts for auth protection + Arcjet
14. Create basic layout with sidebar shell

### Phase 2: Core Chat
15. Build ChatInput component with Tiptap editor + model selector + voice input
16. Build MessageBubble with markdown rendering (DOMPurify sanitized)
17. Build MessageList with @tanstack/react-virtual (virtual scrolling)
18. Create /api/chat/route.ts with SSE streaming + AbortController + heartbeat
19. Implement GPT 5.1 / gpt-5-mini handler
20. Implement Gemini 3.1 Pro / Gemini 3 Flash handler (with search grounding)
21. Implement Gemini 3.1 Flash Image Preview handler (image generation at 1K)
22. Implement GLM 5 handler
23. Test streaming with all models + test routing overrides

### Phase 3: Memory System
24. Create Voyage AI embedding function (with OpenAI fallback)
25. Create Voyage AI Reranker function (mandatory)
26. Deploy Supabase Edge Function for auto-embedding (webhook-triggered)
27. Implement hybrid_search RPC function
28. Build intent classifier (with Gemini Flash routing for internet/image)
29. Build context assembler with token budgeting
30. Build RAG pipeline (hybrid search → Voyage reranking → format)
31. Build rolling summary for GPT/Gemini
32. Deploy extract-memories Edge Function (runs every 5 messages)
33. Test full 7-layer pipeline

### Phase 4: UI Polish + Features
34. Install and configure @tanstack/react-query (QueryProvider)
35. Build sidebar with Framer Motion animations
36. Build conversation list grouped by date (virtualized)
37. Add conversation CRUD (create, rename, delete via context menu)
38. Add conversation star/pin functionality
39. Add folder system (create, rename, delete folders, drag conversations into folders)
40. Add cmdk command palette (Ctrl+K: search + commands)
41. Add conversation search (search titles + message content via Supabase FTS)
42. Add file upload (images, PDFs, docs → Supabase Storage)
43. Add voice input button (Web Speech API)
44. Add shared conversations (generate link, public read-only view, revoke)
45. Add dark/light mode toggle with next-themes (system preference + manual)
46. Add mobile responsive layout (overlay sidebar, hamburger menu)
47. Add code block with shiki syntax highlighting + copy button + language label
48. Add LaTeX math rendering (KaTeX via remark-math + rehype-katex)
49. Add export chat as markdown (.md file download)
50. Add export chat as PDF (@react-pdf/renderer server-side)
51. Add keyboard shortcuts (via cmdk)
52. Add message actions on hover (copy, regenerate, delete)
53. Add Sonner toast notifications
54. Performance optimization (React.memo, virtual scrolling, lazy loading)

### Phase 5: Deploy
55. Deploy to Vercel
56. Configure custom domain (if applicable)
57. Set environment variables in Vercel dashboard (including Arcjet, Sentry, Helicone keys)
58. Deploy Supabase Edge Functions to production
59. Configure Supabase Database Webhooks in production
60. Verify Sentry error tracking + Helicone AI monitoring dashboards
61. Test with real users across desktop, tablet, and mobile
62. Monitor Supabase usage dashboard + Vercel analytics + Helicone costs

---

## PACKAGE.JSON DEPENDENCIES


---

## CRITICAL IMPLEMENTATION NOTES

### Rolling Summary for Gemini/GPT
Since GPT 5.1 and Gemini 3.1 Pro don't have server-side compaction, implement manual rolling summary:
- Every 10 messages, call gemeni 2.5-flash to summarize the conversation so far
- Store summary in `conversations.summary`
- Inject summary as first pseudo-message pair in the messages array
- Keep only last 12 raw messages + summary



### File Uploads
- Upload to Supabase Storage bucket "attachments"
- Store file URL + metadata in messages.attachments jsonb
- For images: include base64 in the API call content (GLM/GPT/Gemini all support vision)
- For image analysis: route to **Gemini 3 Flash** (best vision model)
- For documents: extract text and include as context
- Max file size: 10MB

### Streaming Protocol
Use Server-Sent Events (SSE):
- Each chunk: `data: {"text": "token"}\n\n`
- Heartbeat: `: heartbeat\n\n` (every 15 seconds to prevent timeout)
- End signal: `data: [DONE]\n\n`
- Error: `data: {"error": "message"}\n\n`
- Client uses fetch with ReadableStream reader + AbortController for cancellation
- On client disconnect: AbortController.abort() cleans up resources

### Error Handling Strategy
- **React ErrorBoundary** wrapping ChatArea, Sidebar, and layout sections
- **Sentry.captureException** on all caught errors with tags (model, action, userId)
- **Retry logic**: exponential backoff (1s, 2s, 4s) for AI API calls — max 3 retries
- **Graceful degradation**: if RAG fails → continue without context, if reranker fails → use original order
- **User-facing errors**: friendly messages in user's language (he/ar/en)

### Date Formatting (Native Intl — no date-fns)
```typescript
// lib/utils/format.ts — zero dependencies
export function formatRelativeTime(date: Date): string {
  const rtf = new Intl.RelativeTimeFormat('auto', { numeric: 'auto' });
  const diff = Date.now() - date.getTime();
  const seconds = Math.floor(diff / 1000);

  if (seconds < 60) return rtf.format(-seconds, 'second');
  if (seconds < 3600) return rtf.format(-Math.floor(seconds / 60), 'minute');
  if (seconds < 86400) return rtf.format(-Math.floor(seconds / 3600), 'hour');
  if (seconds < 2592000) return rtf.format(-Math.floor(seconds / 86400), 'day');
  return new Intl.DateTimeFormat('auto').format(date);
}
```

---

## COMPLETE TOOL TABLE

| # | Tool | Layer | Purpose | Cost (1K users/mo) |
|---|------|-------|---------|-------------------|
| 1 | **Supabase (Pro)** | 2,5,6,7 | DB + vectors + FTS + auth + storage + realtime + edge functions + webhooks | $25-75 |
| 2 | **Vercel** | 6 | Next.js hosting + CDN + edge runtime | $0-20 |
| 3 | **OpenAI API (GPT 5.1 / gpt-5-mini)** | 4 | Main LLM model + fallback embeddings | $40-120 |
| 4 | **Google AI API (Gemini 3.1 Pro / 3 Flash / 3.1 Flash Image)** | 4 | LLM + internet search + image analysis + image generation | $30-100 |
| 5 | **GLM API (GLM 5 / GLM 4.7)** | 1,4,5 | LLM + classifier + memory extractor (cheapest) | $10-30 |
| 6 | **Voyage AI (voyage-4-large + rerank-3)** | 1,2,5 | Primary embeddings + MANDATORY reranking | $15-40 |
| 7 | **OpenAI Embeddings (text-embedding-3-large)** | 2 | Fallback embeddings (if Voyage AI is down) | $0-5 (fallback only) |
| 8 | **pgvector (HNSW)** | 2 | Vector similarity search (semantic) — inside Supabase | $0 |
| 9 | **tsvector + GIN** | 2 | Full-text keyword search — inside Supabase | $0 |
| 10 | **pg_trgm** | 2 | Fuzzy trigram search (typo tolerance) — inside Supabase | $0 |
| 11 | **RRF hybrid_search()** | 2 | Reciprocal Rank Fusion combining all 3 search methods | $0 |
| 12 | **Supabase Database Webhooks** | 5 | Trigger embedding + extraction on message INSERT (replaces pgmq) | $0 |
| 13 | **Supabase Edge Functions** | 1,5 | Serverless compute: auto-embed + memory extraction | $0 (500K/mo free) |
| 14 | **Supabase Auth** | 6 | Google OAuth + JWT sessions | $0 (50K MAUs free) |
| 15 | **Supabase Storage** | 6 | File uploads: images, PDFs, documents in chat | $0 (100GB on Pro) |
| 16 | **Supabase Realtime** | 6 | WebSocket for live message updates + typing indicators | $0 |
| 17 | **Supabase RLS** | 7 | Row-level security on ALL tables | $0 |
| 18 | **Arcjet** | 7 | Rate limiting + bot protection (protects API spend) | $0 (free tier) |
| 19 | **Zod** | 7 | Runtime input validation — prevents crashes from bad data | $0 |
| 20 | **DOMPurify** | 7 | XSS sanitization for markdown rendering | $0 |
| 21 | **Sentry** | 7 | Error tracking + performance monitoring + session replay | $0 (5K errors/mo) |
| 22 | **Helicone** | 7 | AI API observability — cost, latency, errors per model | $0 (100K req/mo) |
| 23 | **Next.js 16** | 6 | App Router, SSR, API routes, middleware | $0 |
| 24 | **Tailwind CSS 4** | 6 | Utility-first responsive styling | $0 |
| 25 | **shadcn/ui** | 6 | Accessible UI components (dialog, dropdown, etc.) | $0 |
| 26 | **next-themes** | 6 | Dark/light mode with system detection | $0 |
| 27 | **react-markdown + remark-gfm** | 6 | Full markdown rendering in messages | $0 |
| 28 | **shiki** | 6 | Code syntax highlighting (50+ languages) | $0 |
| 29 | **KaTeX (remark-math + rehype-katex)** | 6 | LaTeX math rendering ($inline$ and $$block$$) | $0 |
| 30 | **@react-pdf/renderer** | 6 | Export conversation as PDF (full RTL + Unicode) | $0 |
| 31 | **@tanstack/react-query** | 6 | Server state management + caching + optimistic updates | $0 |
| 32 | **@tanstack/react-virtual** | 6 | Virtual scrolling for long conversations + sidebar lists | $0 |
| 33 | **Framer Motion** | 6 | Animations (sidebar, messages, transitions, gestures) | $0 |
| 34 | **Tiptap** | 6 | Rich text editor (markdown shortcuts, slash commands) | $0 |
| 35 | **cmdk** | 6 | Command palette (Ctrl+K: search + commands) | $0 |
| 36 | **Sonner** | 6 | Toast notifications (promise toast, undo, actions) | $0 |
| 37 | **zustand** | 6 | Client state management (sidebar, streaming, UI) | $0 |
| 38 | **lucide-react** | 6 | Icon library (consistent, tree-shakeable) | $0 |
| 39 | **Web Speech API** | 6 | Voice input — browser-native speech-to-text (free) | $0 |
| — | **TOTAL** | — | **39 tools, 8 tables, 7 memory layers** | **$120-390/mo** |
