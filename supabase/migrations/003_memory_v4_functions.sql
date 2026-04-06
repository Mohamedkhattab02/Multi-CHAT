-- ============================================================
-- V4 Migration: Add missing columns, RPC functions, and indexes
-- Required for document processing and RAG pipeline
-- ============================================================

-- ============================================================
-- 1. ADD V4 COLUMNS TO CONVERSATIONS (if missing)
-- ============================================================
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'conversations' AND column_name = 'working_memory'
  ) THEN
    ALTER TABLE public.conversations ADD COLUMN working_memory jsonb DEFAULT '{
      "current_task": null,
      "sub_tasks": [],
      "active_entities": [],
      "last_decision": null,
      "phase": "idle",
      "updated_at": null
    }'::jsonb;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'conversations' AND column_name = 'document_registry'
  ) THEN
    ALTER TABLE public.conversations ADD COLUMN document_registry jsonb DEFAULT '[]'::jsonb;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'conversations' AND column_name = 'structured_summary'
  ) THEN
    ALTER TABLE public.conversations ADD COLUMN structured_summary jsonb;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'conversations' AND column_name = 'gemini_cache_name'
  ) THEN
    ALTER TABLE public.conversations ADD COLUMN gemini_cache_name text;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'conversations' AND column_name = 'key_entities'
  ) THEN
    ALTER TABLE public.conversations ADD COLUMN key_entities text[] DEFAULT '{}';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'conversations' AND column_name = 'key_topics'
  ) THEN
    ALTER TABLE public.conversations ADD COLUMN key_topics text[] DEFAULT '{}';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'conversations' AND column_name = 'fingerprint'
  ) THEN
    ALTER TABLE public.conversations ADD COLUMN fingerprint vector(256);
  END IF;
END;
$$;

-- ============================================================
-- 2. ADD V4 COLUMNS TO MEMORIES (if missing)
-- ============================================================
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'memories' AND column_name = 'is_active'
  ) THEN
    ALTER TABLE public.memories ADD COLUMN is_active boolean DEFAULT true;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'memories' AND column_name = 'valid_until'
  ) THEN
    ALTER TABLE public.memories ADD COLUMN valid_until timestamptz;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'memories' AND column_name = 'invalidated_by'
  ) THEN
    ALTER TABLE public.memories ADD COLUMN invalidated_by uuid REFERENCES public.memories(id) ON DELETE SET NULL;
  END IF;
END;
$$;

-- Extend memories type CHECK to include V4 types (drop old, add new)
DO $$
BEGIN
  -- Drop old constraint if it exists
  ALTER TABLE public.memories DROP CONSTRAINT IF EXISTS memories_type_check;
  -- Add new constraint with V4 types
  ALTER TABLE public.memories ADD CONSTRAINT memories_type_check
    CHECK (type IN ('fact', 'preference', 'goal', 'skill', 'opinion', 'rejection', 'correction', 'constraint', 'anti_memory'));
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'Could not update memories type constraint: %', SQLERRM;
END;
$$;

-- Extend embeddings source_type CHECK to include V4 types
DO $$
BEGIN
  ALTER TABLE public.embeddings DROP CONSTRAINT IF EXISTS embeddings_source_type_check;
  ALTER TABLE public.embeddings ADD CONSTRAINT embeddings_source_type_check
    CHECK (source_type IN ('message', 'fact', 'document', 'summary', 'anti_memory'));
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'Could not update embeddings source_type constraint: %', SQLERRM;
END;
$$;

-- ============================================================
-- 3. ADD MISSING INDEXES
-- ============================================================
CREATE INDEX IF NOT EXISTS idx_embeddings_source
  ON embeddings (source_type, source_id)
  WHERE source_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_memories_active
  ON memories (user_id, is_active)
  WHERE is_active = true;

CREATE INDEX IF NOT EXISTS idx_memories_user_created
  ON memories (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_conversations_fingerprint
  ON conversations USING hnsw (fingerprint vector_cosine_ops);

CREATE INDEX IF NOT EXISTS idx_conversations_topics
  ON conversations USING gin (key_topics);


-- ============================================================
-- 4. INSERT DOCUMENT EMBEDDINGS RPC (batch insert bypassing PostgREST vector issues)
-- ============================================================
CREATE OR REPLACE FUNCTION public.insert_document_embeddings(
  batch_rows jsonb
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
AS $$
DECLARE
  row_data jsonb;
  inserted_count int := 0;
  failed_count int := 0;
  total_count int;
BEGIN
  total_count := jsonb_array_length(batch_rows);

  FOR i IN 0..total_count - 1 LOOP
    row_data := batch_rows->i;
    BEGIN
      INSERT INTO public.embeddings (
        user_id,
        source_type,
        source_id,
        content,
        embedding,
        metadata
      ) VALUES (
        (row_data->>'user_id')::uuid,
        row_data->>'source_type',
        CASE WHEN row_data->>'source_id' = '' THEN NULL ELSE (row_data->>'source_id')::uuid END,
        row_data->>'content',
        (
          SELECT array_agg(elem::float)::vector(1024)
          FROM jsonb_array_elements_text(row_data->'embedding') AS elem
        ),
        COALESCE(row_data->'metadata', '{}'::jsonb)
      );
      inserted_count := inserted_count + 1;
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'insert_document_embeddings: row % failed: %', i, SQLERRM;
      failed_count := failed_count + 1;
    END;
  END LOOP;

  RETURN jsonb_build_object('success', inserted_count, 'failed', failed_count);
END;
$$;


-- ============================================================
-- 5. SEARCH DOCUMENT CHUNKS RPC (vector similarity in PostgreSQL)
-- ============================================================
CREATE OR REPLACE FUNCTION public.search_document_chunks(
  target_user_id uuid,
  target_conversation_id uuid,
  query_embedding vector(1024),
  match_count int DEFAULT 8,
  min_similarity float DEFAULT 0.2
)
RETURNS TABLE (
  id bigint,
  content text,
  source_type text,
  source_id uuid,
  metadata jsonb,
  created_at timestamptz,
  score float
)
LANGUAGE sql STABLE
AS $$
  SELECT
    e.id,
    e.content,
    e.source_type,
    e.source_id,
    e.metadata,
    e.created_at,
    (1 - (e.embedding <=> query_embedding))::float AS score
  FROM public.embeddings e
  WHERE e.user_id = target_user_id
    AND e.source_type = 'document'
    AND (e.metadata->>'conversation_id') = target_conversation_id::text
    AND COALESCE((e.metadata->>'is_active')::boolean, true) = true
    AND (1 - (e.embedding <=> query_embedding)) >= min_similarity
  ORDER BY e.embedding <=> query_embedding
  LIMIT match_count;
$$;


-- ============================================================
-- 6. V4 HYBRID SEARCH (updated: filters is_active and current_message)
-- ============================================================
DROP FUNCTION IF EXISTS public.hybrid_search(text, vector, uuid, int, float, float, float, int);

CREATE OR REPLACE FUNCTION public.hybrid_search(
  query_text text,
  query_embedding vector(1024),
  target_user_id uuid,
  match_count int DEFAULT 5,
  full_text_weight float DEFAULT 1.0,
  semantic_weight float DEFAULT 1.5,
  fuzzy_weight float DEFAULT 0.5,
  rrf_k int DEFAULT 50
)
RETURNS TABLE (
  id bigint,
  content text,
  source_type text,
  source_id uuid,
  metadata jsonb,
  created_at timestamptz,
  score float
)
LANGUAGE sql STABLE
AS $$
  WITH active_embeddings AS (
    SELECT *
    FROM embeddings e
    WHERE e.user_id = target_user_id
      AND COALESCE((e.metadata->>'is_active')::boolean, true) = true
      AND COALESCE((e.metadata->>'is_current_message')::boolean, false) = false
  ),
  full_text AS (
    SELECT ae.id,
      row_number() OVER (
        ORDER BY ts_rank_cd(ae.fts, websearch_to_tsquery(query_text)) DESC
      ) AS rank_ix
    FROM active_embeddings ae
    WHERE ae.fts @@ websearch_to_tsquery(query_text)
    LIMIT least(match_count * 4, 30)
  ),
  semantic AS (
    SELECT ae.id,
      row_number() OVER (
        ORDER BY ae.embedding <=> query_embedding
      ) AS rank_ix
    FROM active_embeddings ae
    ORDER BY ae.embedding <=> query_embedding
    LIMIT least(match_count * 4, 30)
  ),
  fuzzy AS (
    SELECT ae.id,
      row_number() OVER (
        ORDER BY similarity(ae.content, query_text) DESC
      ) AS rank_ix
    FROM active_embeddings ae
    WHERE ae.content % query_text
    LIMIT least(match_count * 2, 15)
  ),
  combined AS (
    SELECT
      coalesce(ft.id, sem.id, fz.id) AS eid,
      (
        coalesce(1.0 / (rrf_k + ft.rank_ix), 0.0) * full_text_weight +
        coalesce(1.0 / (rrf_k + sem.rank_ix), 0.0) * semantic_weight +
        coalesce(1.0 / (rrf_k + fz.rank_ix), 0.0) * fuzzy_weight
      ) AS combined_score
    FROM full_text ft
    FULL OUTER JOIN semantic sem ON ft.id = sem.id
    FULL OUTER JOIN fuzzy fz ON coalesce(ft.id, sem.id) = fz.id
  )
  SELECT
    e.id,
    e.content,
    e.source_type,
    e.source_id,
    e.metadata,
    e.created_at,
    c.combined_score AS score
  FROM combined c
  JOIN embeddings e ON c.eid = e.id
  ORDER BY c.combined_score DESC
  LIMIT match_count;
$$;


-- ============================================================
-- 7. V4 HYBRID SEARCH SCOPED (conversation-filtered)
-- ============================================================
DROP FUNCTION IF EXISTS public.hybrid_search_scoped(text, vector, uuid, uuid[], int, float, float, float, int);

CREATE OR REPLACE FUNCTION public.hybrid_search_scoped(
  query_text text,
  query_embedding vector(1024),
  target_user_id uuid,
  conversation_ids uuid[],
  match_count int DEFAULT 5,
  full_text_weight float DEFAULT 1.0,
  semantic_weight float DEFAULT 1.5,
  fuzzy_weight float DEFAULT 0.5,
  rrf_k int DEFAULT 50
)
RETURNS TABLE (
  id bigint,
  content text,
  source_type text,
  source_id uuid,
  metadata jsonb,
  created_at timestamptz,
  score float
)
LANGUAGE sql STABLE
AS $$
  WITH active_embeddings AS (
    SELECT *
    FROM embeddings e
    WHERE e.user_id = target_user_id
      AND COALESCE((e.metadata->>'is_active')::boolean, true) = true
      AND COALESCE((e.metadata->>'is_current_message')::boolean, false) = false
      AND (
        (e.metadata->>'conversation_id')::uuid = ANY(conversation_ids)
        OR e.source_type IN ('fact', 'summary', 'anti_memory')
      )
  ),
  full_text AS (
    SELECT ae.id,
      row_number() OVER (
        ORDER BY ts_rank_cd(ae.fts, websearch_to_tsquery(query_text)) DESC
      ) AS rank_ix
    FROM active_embeddings ae
    WHERE ae.fts @@ websearch_to_tsquery(query_text)
    LIMIT least(match_count * 4, 30)
  ),
  semantic AS (
    SELECT ae.id,
      row_number() OVER (
        ORDER BY ae.embedding <=> query_embedding
      ) AS rank_ix
    FROM active_embeddings ae
    ORDER BY ae.embedding <=> query_embedding
    LIMIT least(match_count * 4, 30)
  ),
  fuzzy AS (
    SELECT ae.id,
      row_number() OVER (
        ORDER BY similarity(ae.content, query_text) DESC
      ) AS rank_ix
    FROM active_embeddings ae
    WHERE ae.content % query_text
    LIMIT least(match_count * 2, 15)
  ),
  combined AS (
    SELECT
      coalesce(ft.id, sem.id, fz.id) AS eid,
      (
        coalesce(1.0 / (rrf_k + ft.rank_ix), 0.0) * full_text_weight +
        coalesce(1.0 / (rrf_k + sem.rank_ix), 0.0) * semantic_weight +
        coalesce(1.0 / (rrf_k + fz.rank_ix), 0.0) * fuzzy_weight
      ) AS combined_score
    FROM full_text ft
    FULL OUTER JOIN semantic sem ON ft.id = sem.id
    FULL OUTER JOIN fuzzy fz ON coalesce(ft.id, sem.id) = fz.id
  )
  SELECT
    e.id,
    e.content,
    e.source_type,
    e.source_id,
    e.metadata,
    e.created_at,
    c.combined_score AS score
  FROM combined c
  JOIN embeddings e ON c.eid = e.id
  ORDER BY c.combined_score DESC
  LIMIT match_count;
$$;


-- ============================================================
-- 8. ADDITIONAL V4 RPC FUNCTIONS
-- ============================================================

-- Semantic Duplicate Finder (for memory dedup)
CREATE OR REPLACE FUNCTION public.find_similar_memory(
  target_user_id uuid,
  query_embedding vector(1024),
  similarity_threshold float DEFAULT 0.92
)
RETURNS TABLE (
  id uuid,
  content text,
  confidence float,
  similarity float
)
LANGUAGE sql STABLE
AS $$
  SELECT
    mem.id,
    mem.content,
    mem.confidence,
    (1 - (emb.embedding <=> query_embedding))::float AS similarity
  FROM public.memories mem
  JOIN public.embeddings emb
    ON emb.source_id = mem.id
    AND emb.source_type = 'fact'
  WHERE mem.user_id = target_user_id
    AND mem.is_active = true
    AND (1 - (emb.embedding <=> query_embedding)) > similarity_threshold
  ORDER BY similarity DESC
  LIMIT 3;
$$;


-- Conversation Fingerprint Search
CREATE OR REPLACE FUNCTION public.search_similar_conversations(
  query_embedding_256 vector(256),
  target_user_id uuid,
  match_count int DEFAULT 3
)
RETURNS TABLE (
  id uuid,
  title text,
  topic text,
  similarity float,
  message_count int
)
LANGUAGE sql STABLE
AS $$
  SELECT
    c.id,
    c.title,
    c.topic,
    (1 - (c.fingerprint <=> query_embedding_256))::float AS similarity,
    c.message_count
  FROM public.conversations c
  WHERE c.user_id = target_user_id
    AND c.fingerprint IS NOT NULL
  ORDER BY c.fingerprint <=> query_embedding_256
  LIMIT match_count;
$$;


-- Memory Cleanup V4
CREATE OR REPLACE FUNCTION public.cleanup_memories_v4(target_user_id uuid)
RETURNS void AS $$
BEGIN
  -- 1. Remove exact text duplicates (keep newest)
  DELETE FROM public.memories a
  USING public.memories b
  WHERE a.user_id = target_user_id
    AND b.user_id = target_user_id
    AND a.content = b.content
    AND a.type = b.type
    AND a.created_at < b.created_at;

  -- 2. Decay confidence of old active memories
  UPDATE public.memories
  SET confidence = greatest(confidence * 0.97, 0.1)
  WHERE user_id = target_user_id
    AND created_at < now() - interval '30 days'
    AND is_active = true
    AND type NOT IN ('anti_memory', 'rejection', 'correction');

  -- 3. Expire memories past valid_until
  UPDATE public.memories
  SET is_active = false
  WHERE user_id = target_user_id
    AND valid_until IS NOT NULL
    AND valid_until < now()
    AND is_active = true;

  -- 4. Delete inactive low-confidence old memories
  DELETE FROM public.memories
  WHERE user_id = target_user_id
    AND is_active = false
    AND confidence < 0.15
    AND created_at < now() - interval '90 days';

  -- 5. Delete stale low-confidence active memories
  DELETE FROM public.memories
  WHERE user_id = target_user_id
    AND is_active = true
    AND confidence < 0.15
    AND created_at < now() - interval '90 days'
    AND type NOT IN ('anti_memory', 'rejection', 'correction');

  -- 6. Cap at 200 active memories per user
  WITH ranked AS (
    SELECT id,
      row_number() OVER (
        ORDER BY
          CASE WHEN type IN ('anti_memory', 'rejection', 'correction') THEN 0 ELSE 1 END,
          confidence DESC,
          created_at DESC
      ) AS rn
    FROM public.memories
    WHERE user_id = target_user_id
      AND is_active = true
  )
  UPDATE public.memories
  SET is_active = false
  WHERE id IN (SELECT id FROM ranked WHERE rn > 200);

  -- 7. Clean up orphaned embeddings
  DELETE FROM public.embeddings
  WHERE user_id = target_user_id
    AND source_type IN ('fact', 'anti_memory')
    AND source_id IS NOT NULL
    AND NOT EXISTS (
      SELECT 1 FROM public.memories WHERE memories.id = embeddings.source_id
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;


-- Memory Stats Helper
CREATE OR REPLACE FUNCTION public.get_user_memory_stats(target_user_id uuid)
RETURNS TABLE (
  active_count bigint,
  inactive_count bigint,
  total_count bigint,
  avg_confidence float
)
LANGUAGE sql STABLE
AS $$
  SELECT
    count(*) FILTER (WHERE is_active = true),
    count(*) FILTER (WHERE is_active = false),
    count(*),
    avg(confidence)::float
  FROM public.memories
  WHERE user_id = target_user_id;
$$;


-- Embedding Stats per Conversation
CREATE OR REPLACE FUNCTION public.get_conversation_embedding_stats(
  target_conversation_id uuid
)
RETURNS TABLE (
  source_type text,
  embedding_count bigint,
  avg_embedding_norm float
)
LANGUAGE sql STABLE
AS $$
  SELECT
    e.source_type,
    count(*),
    avg(vector_norm(e.embedding))::float
  FROM public.embeddings e
  WHERE (e.metadata->>'conversation_id') = target_conversation_id::text
  GROUP BY e.source_type
  ORDER BY count(*) DESC;
$$;


-- Conversation cleanup trigger
CREATE OR REPLACE FUNCTION public.delete_conversation_data()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  DELETE FROM public.embeddings
  WHERE user_id = old.user_id
    AND (metadata->>'conversation_id') = old.id::text;

  DELETE FROM public.memories
  WHERE source_conversation_id = old.id;

  RETURN old;
END;
$$;

DROP TRIGGER IF EXISTS on_conversation_delete_cleanup ON conversations;
CREATE TRIGGER on_conversation_delete_cleanup
  BEFORE DELETE ON conversations
  FOR EACH ROW EXECUTE PROCEDURE public.delete_conversation_data();


-- Message delete triggers
CREATE OR REPLACE FUNCTION public.decrement_conversation_count()
RETURNS trigger AS $$
BEGIN
  UPDATE public.conversations
  SET message_count = greatest(message_count - 1, 0),
      updated_at = now()
  WHERE id = old.conversation_id;
  RETURN old;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS on_message_delete_update_count ON messages;
CREATE TRIGGER on_message_delete_update_count
  AFTER DELETE ON messages
  FOR EACH ROW EXECUTE PROCEDURE public.decrement_conversation_count();

CREATE OR REPLACE FUNCTION public.delete_orphaned_embeddings()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  DELETE FROM public.embeddings
  WHERE source_id = old.id
    AND source_type = 'message';
  RETURN old;
END;
$$;

DROP TRIGGER IF EXISTS on_message_delete_cleanup_embeddings ON messages;
CREATE TRIGGER on_message_delete_cleanup_embeddings
  AFTER DELETE ON messages
  FOR EACH ROW EXECUTE PROCEDURE public.delete_orphaned_embeddings();
