# MultiChat AI — Memory System V4 (Final Blueprint)

> **This document is the single source of truth for the memory system.**
> It replaces MEMORY.md (V1), MEMORY_V3_IMPROVEMENTS.md, and supersedes all prior drafts.
> V4 integrates: document chunking, pre-embedding, working memory, anti-memory, adaptive weights,
> memory temperature, incremental summaries, conversation fingerprinting, preemptive loading,
> token density budgeting, the upgraded classifier, and Gemini 2.5 Flash as the router.

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [What V3 Missed — The 6 Critical Gaps](#2-what-v3-missed)
3. [The V4 Architecture](#3-the-v4-architecture)
4. [Layer 0: Memory Invalidation](#4-layer-0-memory-invalidation)
5. [Layer 1: Classifier (Gemini 2.5 Flash)](#5-layer-1-classifier)
6. [Layer 2: RAG Pipeline (Rewritten)](#6-layer-2-rag-pipeline)
7. [Layer 3: Context Assembler](#7-layer-3-context-assembler)
8. [Layer 4: Generation](#8-layer-4-generation)
9. [Layer 5: Post-Processing](#9-layer-5-post-processing)
10. [New Subsystems](#10-new-subsystems)
11. [Database Schema Changes](#11-database-schema-changes)
12. [File Structure](#12-file-structure)
13. [Implementation Order](#13-implementation-order)
14. [Cost Impact](#14-cost-impact)
15. [What Improves for the User](#15-what-improves-for-the-user)

---

## 1. Executive Summary

### The Core Problem

The memory system has **document amnesia** and **task amnesia**. By message #30 in a conversation, the model has forgotten what was in an uploaded document and what task the user was working on. V3 addressed the first problem partially (document chunking) but missed the second entirely. V4 fixes both.

### What V4 Adds Over V3

| Capability | V3 | V4 |
|-----------|----|----|
| Document chunking | Recursive, blind, LLM-contextualized | Structure-aware, no LLM cost |
| Current message in RAG | Not searchable | Pre-embedded before search |
| Task tracking | None | Working Memory buffer |
| Negative memory | None | Anti-Memory + invalidation |
| Search weights | Static (1.5/1.0/0.5) | Adaptive per query type |
| Memory ranking | Flat score | HOT / WARM / COLD temperature |
| Summary updates | Regenerate from scratch | Incremental patching |
| Cross-conversation search | Linear over all embeddings | Fingerprint-filtered |
| Latency | Wait for Enter | Preemptive loading while typing |
| Token budgeting | Uniform | Density-aware (code > chat) |
| Classifier model | GLM-4-7b | Gemini 2.5 Flash |

### Bottom Line

V4 is **not "V3 plus features"** — it's a rebuild of the memory layer with 9 new subsystems. The recall improvement over V1 is estimated at **+60-80%**, with a **net cost savings of $6-10/month** (removing wasteful LLM calls, activating context caching, cheaper classifier).

---

## 2. What V3 Missed

### Gap 1: Cold Start Blindness (CRITICAL)

**What happens in V3:** User sends message → RAG searches → model answers → *only then* the message gets embedded. The current message is never searchable during its own search turn.

**Why it matters:** The user's current message is the most relevant context to itself. If they say "continue the sorting function we wrote" and RAG misses the old code, the model can't recover — the current message, which explicitly references it, is not in the search index yet.

**V4 solution:** **Pre-embed the user message before RAG runs.** The message gets embedded and stored in a temporary buffer that RAG includes in its search space, then the permanent store is updated post-response.

---

### Gap 2: No Working Memory

**What happens in V3:** Model gets recent messages + RAG + summary. There is no structure that explicitly tracks "what are we doing right now." If the user says "let's build an API" and then asks a small digression, the model loses the API-building context.

**Why it matters:** Tasks in real conversations span dozens of messages with interruptions, clarifications, and digressions. Without explicit task tracking, the model treats each message as standalone.

**V4 solution:** **Working Memory Buffer** — a structured object on the `conversations` table that tracks:
- Current task (what the user is building/doing)
- Phase (planning / implementing / debugging / reviewing)
- Active files/entities mentioned
- Open questions waiting for answer
- Decisions made so far in this task

Updated every 3 messages or on phase shifts. Injected into the stable prefix so Gemini caches it.

---

### Gap 3: No Anti-Memory

**What happens in V3:** User says "I don't like TypeScript" → saved as preference. But if the user says "the previous solution didn't work" or "forget what I said about X" — nothing happens. The system keeps suggesting the same wrong thing.

**V4 solution:** **Anti-Memory subsystem** that detects:
- Corrections: "no, that's wrong", "actually", "I meant the opposite"
- Rejections: "the previous solution didn't work", "this doesn't solve my problem"
- Invalidations: "forget what I said", "ignore that", "never mind"

When detected, the system:
1. Flags the invalidated memory as `is_active = false`
2. Extracts the corrected version and stores it with higher confidence
3. Adds an anti-memory record: "user explicitly rejected X for reason Y"

---

### Gap 4: Static Search Weights

**What happens in V3:** `full_text_weight: 1.0, semantic_weight: 1.5, fuzzy_weight: 0.5` — always. But:
- Code query with exact function name → fuzzy should dominate
- Conceptual query ("explain closures") → semantic should dominate
- Hebrew query about English code → semantic-only (fuzzy doesn't work cross-lingual)

**V4 solution:** **Adaptive Weights** driven by classifier output. The `adaptive-weights.ts` module maps `(intent, language, hasCodeMarkers)` to a weight vector.

---

### Gap 5: Summary Regeneration From Scratch

**What happens in V3:** Every 10 messages, take the previous summary + last 5 messages → generate a fresh summary. Details in the old summary but not in the last 5 messages **silently disappear**.

**V4 solution:** **Incremental Summary Patching** — instead of regenerating, produce a JSON patch:
```json
{
  "add": ["User decided to use PostgreSQL over MongoDB"],
  "update": {"current_task": "building API → added auth endpoints"},
  "remove": ["outdated: considering Firebase"]
}
```

The summary is mutated with the patch. No information is ever silently dropped — only explicitly removed when truly outdated.

---

### Gap 6: Blind Document Chunking

**What V3 proposed:** Recursive chunking at 400 tokens, 15% overlap, with Gemini Flash generating a context prefix per chunk.

**Problems:**
- Cuts through tables, code blocks, numbered lists
- Doesn't preserve document structure (headers, sections)
- LLM-generated context prefix is a cost per chunk ($0.003 × 25 chunks × N documents)

**V4 solution:** **Structure-Aware Chunking** with no LLM:
1. Parse document into structural blocks (headers, paragraphs, code blocks, tables, lists)
2. Build a header breadcrumb trail (H1 > H2 > H3) as the chunk's context prefix
3. Never split mid-block (a code block or table stays whole, even if >400 tokens)
4. Tag each chunk with `section_type` in metadata (`code`, `table`, `list`, `paragraph`, `heading`)

Zero LLM cost, better structural fidelity.

---

## 3. The V4 Architecture

```
User Message + Attachments + [Preloaded Context from client hook]
    │
    ▼
┌──────────────────────────────────────────────────────┐
│  LAYER 0: Memory Invalidation Check (0-5ms)          │
│  "תשכח מזה" / "forget that" → flag related memories   │
│  as is_active=false BEFORE any search runs            │
└──────────────┬───────────────────────────────────────┘
               │
               ▼
┌──────────────────────────────────────────────────────┐
│  LAYER 1: Classifier (Gemini 2.5 Flash, ~150ms)       │
│  Fast path: 3 regex checks (image_gen, vision,        │
│    web_search) bypass LLM for 30% of requests         │
│  Output: intent, complexity, needsRAG, language,      │
│    routeTo, adaptive_weights_hint, window_size_hint   │
└──────────────┬───────────────────────────────────────┘
               │
               │  Has document attachments?
               ▼
┌──────────────────────────────────────────────────────┐
│  Document Processor (structure-aware, NO LLM)         │
│  • Parse into structural blocks                       │
│  • Build header breadcrumbs                           │
│  • Tag by section_type                                │
│  • Embed each chunk → embeddings table                │
│  • Update conversation.document_registry              │
└──────────────┬───────────────────────────────────────┘
               │
               │  needsRAG?
               ▼
┌──────────────────────────────────────────────────────┐
│  LAYER 2: RAG Pipeline (rewritten)                    │
│                                                        │
│  Step 1: PRE-EMBED current user message               │
│  Step 2: Query Expansion (HyDE + 2 multi-query)       │
│  Step 3: Conversation Fingerprint filter              │
│          (256-dim lookup narrows search space)        │
│  Step 4: Hybrid search with ADAPTIVE WEIGHTS          │
│          (code→fuzzy boost, Hebrew→semantic only)     │
│  Step 5: Remove the current message from results      │
│  Step 6: Assign MEMORY TEMPERATURE (HOT/WARM/COLD)    │
│  Step 7: Voyage AI Reranking (rerank-3)               │
│  Step 8: Filter where is_active = true                │
└──────────────┬───────────────────────────────────────┘
               │
               ▼
┌──────────────────────────────────────────────────────┐
│  LAYER 3: Context Assembler                           │
│                                                        │
│  STABLE PREFIX (Gemini implicit cache — 75-90% off):  │
│    • System prompt + user profile                     │
│    • Document registry                                │
│    • Working memory (current task + phase)            │
│    • Macro summary (conversation arc)                 │
│                                                        │
│  VARIABLE SUFFIX:                                     │
│    • HOT memories (always injected, up to 60% budget) │
│    • WARM memories (if budget allows, up to 85%)      │
│    • COLD memories (fill remaining budget)            │
│    • Density-sorted (code before prose before chat)   │
│    • Micro summary (only if recent msgs insufficient) │
│    • Adaptive window (2-8 msgs based on phase)        │
│    • Current user message                             │
└──────────────┬───────────────────────────────────────┘
               │
               ▼
┌──────────────────────────────────────────────────────┐
│  LAYER 4: Generation (Streaming + Caching)            │
│  • Gemini: implicit caching automatic                 │
│  • Gemini: explicit cache for long document convos    │
│  • OpenAI: prefix caching automatic                   │
│  • AbortController + heartbeat + SSE                  │
└──────────────┬───────────────────────────────────────┘
               │
               ▼
┌──────────────────────────────────────────────────────┐
│  LAYER 5: Post-Processing                             │
│  • Commit pre-embed from Layer 0 to permanent store   │
│  • Embed assistant response                           │
│  • Incremental summary patch (add/update/remove)     │
│  • Working memory update (every 3 msgs or phase)      │
│  • Extract memories with semantic dedup check         │
│  • Anti-memory detection (rejection patterns)         │
│  • Message importance scoring → metadata              │
│  • Conversation fingerprint update (every 20 msgs)    │
│  • Periodic cleanup: decay + cap + delete inactive    │
└──────────────────────────────────────────────────────┘
```

---

## 4. Layer 0: Memory Invalidation

**File:** `src/lib/memory/invalidation.ts`

**Purpose:** Catch explicit invalidations before the search runs. If the user says "forget what I said about X," the system should not retrieve X in this turn, and should mark it inactive going forward.

**Detection (regex fast-path, no LLM):**

```typescript
const INVALIDATION_PATTERNS = [
  // English
  /\b(forget|ignore|disregard|nevermind|never mind|scratch that)\b.{0,40}\b(that|what i said|previous|last)\b/i,
  /\b(that'?s wrong|that was wrong|incorrect|not right|actually)\b/i,
  /\b(the (previous|last|earlier) (solution|answer|code) (didn'?t work|was wrong|failed))\b/i,
  // Hebrew
  /\b(תשכח|תתעלם|לא חשוב|עזוב)\b.{0,40}\b(מה שאמרתי|הקודם|זה|את זה)\b/,
  /\b(זה (לא נכון|טעות|לא עובד))\b/,
  /\b(הפתרון הקודם (לא עבד|לא נכון|שגוי))\b/,
  // Arabic
  /\b(انسى|تجاهل|مش مهم)\b/,
];

export async function detectAndHandleInvalidation(
  userId: string,
  conversationId: string,
  message: string
): Promise<{ invalidated: boolean; count: number }> {
  const isInvalidation = INVALIDATION_PATTERNS.some(p => p.test(message));
  if (!isInvalidation) return { invalidated: false, count: 0 };
  
  // Find the target: what did the user reference?
  // Strategy: embed the invalidation message + pull last 3 assistant messages
  // Mark embeddings + memories from that reference window as is_active=false
  const targetEmbedding = await generateEmbedding(message);
  
  const { data: recentAssistant } = await supabase
    .from('messages')
    .select('id, content, created_at')
    .eq('conversation_id', conversationId)
    .eq('role', 'assistant')
    .order('created_at', { ascending: false })
    .limit(3);
  
  if (!recentAssistant?.length) return { invalidated: false, count: 0 };
  
  // Invalidate embeddings linked to those message IDs
  const messageIds = recentAssistant.map(m => m.id);
  const { count } = await supabase
    .from('embeddings')
    .update({ is_active: false, invalidated_at: new Date().toISOString() })
    .in('source_id', messageIds)
    .eq('user_id', userId);
  
  // Also record the invalidation as an anti-memory
  await supabase.from('memories').insert({
    user_id: userId,
    type: 'anti_memory',
    content: `User invalidated: "${message.slice(0, 200)}"`,
    confidence: 1.0,
    source_conversation_id: conversationId,
  });
  
  return { invalidated: true, count: count ?? 0 };
}
```

**Required schema change:**
```sql
ALTER TABLE embeddings 
  ADD COLUMN is_active boolean DEFAULT true,
  ADD COLUMN invalidated_at timestamptz;

CREATE INDEX idx_embeddings_active 
  ON embeddings (user_id, is_active) 
  WHERE is_active = true;
```

The RAG pipeline **always** filters `WHERE is_active = true`.

---

## 5. Layer 1: Classifier

**File:** `src/lib/ai/classifier.ts`
**Model:** Gemini 2.5 Flash (replaces GLM-4-7b from V1)
**Latency:** ~150ms for LLM path, 0ms for fast path

### Responsibilities

The classifier produces the routing decision and all downstream hints. It does **not** answer the question, generate text, or touch memory.

### Output Schema (Zod)

```typescript
const ClassificationSchema = z.object({
  intent: z.enum([
    'question', 'code', 'analysis', 'chitchat',
    'creative', 'command', 'image_gen', 'web_search', 'image_analysis'
  ]),
  complexity: z.enum(['low', 'medium', 'high']),
  needsRAG: z.boolean(),
  language: z.enum(['en', 'he', 'ar', 'mixed']),
  mainTopic: z.string().max(100),
  routeTo: z.enum([
    'gemini-3.1-pro', 'gemini-3-flash',
    'gpt-5.1', 'gpt-5-mini',
    'glm-5',
    'gemini-3.1-flash-image'
  ]),
  reasoning: z.string().max(200),
  // V4 additions — hints for downstream layers
  workingMemoryPhase: z.enum(['planning', 'implementing', 'debugging', 'reviewing', 'none']).optional(),
  hasCodeMarkers: z.boolean().optional(),
  referencesDocument: z.boolean().optional(),
});
```

### Routing Rules

**The user's selected model is a suggestion, not a command.** The classifier decides the actual model by complexity:

| Family | Complexity | Actual Model |
|--------|-----------|--------------|
| gemini | high | `gemini-3.1-pro` |
| gemini | medium/low | `gemini-3-flash` |
| openai | high | `gpt-5.1` |
| openai | medium/low | `gpt-5-mini` |
| glm | any | `glm-5` (no sub-models) |

### Hard Overrides (Fast Path, Zero LLM Cost)

These checks run as regex and bypass the LLM call entirely. They handle ~30% of requests.

1. **Image attached for analysis** → `gemini-3-flash` (vision)
2. **Image generation request** (regex matches `צור תמונה|draw|generate image|etc`) → `gemini-3.1-flash-image`
3. **Real-time data needed** (weather, news, prices, scores, "today", "now") → `gemini-3-flash` (has search grounding)

### Full System Prompt for the Classifier LLM

```
You are a router for a multi-model AI chat platform.
Your ONLY job: analyze the user message and return a single JSON object.
You do NOT answer the question. You ONLY classify and route.

Return EXACTLY this JSON structure (no markdown, no explanation, no extra keys):
{
  "intent": "question|code|analysis|chitchat|creative|command|image_gen|web_search|image_analysis",
  "complexity": "low|medium|high",
  "needsRAG": true|false,
  "language": "en|he|ar|mixed",
  "mainTopic": "one short phrase",
  "routeTo": "gemini-3.1-pro|gemini-3-flash|gpt-5.1|gpt-5-mini|glm-5|gemini-3.1-flash-image",
  "reasoning": "one short sentence explaining the routing choice",
  "workingMemoryPhase": "planning|implementing|debugging|reviewing|none",
  "hasCodeMarkers": true|false,
  "referencesDocument": true|false
}

═══════════════════════════════════════
ROUTING ENGINE — READ THIS AS CODE
═══════════════════════════════════════

Step 1: CHECK HARD OVERRIDES (handled by regex before you are called)

Step 2: DETERMINE COMPLEXITY

  HIGH (expensive model):
  - Multi-step reasoning, proofs, derivations
  - Architecture design, large refactoring, subtle debugging
  - Comparing multiple approaches with tradeoffs
  - Long-form creative (full article, story with plot)
  - Math proofs or formal logic
  - User asks for "deep", "detailed", "thorough", "comprehensive"
  - References previous complex context ("continue the algorithm")

  MEDIUM (cheap model):
  - Single-step explanation or how-to
  - Writing a function or small code snippet
  - Summarizing or paraphrasing
  - Comparing 2-3 options briefly
  - Short creative (paragraph, email, short poem)

  LOW (cheap model):
  - Simple factual question
  - Greeting, thanks, confirmation
  - Simple translation or format conversion
  - Yes/no questions
  - Very short queries (under 5 words) that aren't ambiguous

  DEFAULT when uncertain: "medium" (never guess high — expensive models cost more)

Step 3: MAP COMPLEXITY TO MODEL (using userSelectedFamily)

  gemini + high → gemini-3.1-pro
  gemini + medium/low → gemini-3-flash
  openai + high → gpt-5.1
  openai + medium/low → gpt-5-mini
  glm → glm-5 (always)

Step 4: DETERMINE needsRAG

  TRUE if:
  - complexity is "high"
  - complexity is "medium" AND intent is "code" or "analysis"
  - Query explicitly references past conversation ("what did we discuss",
    "the code from before", "continue", "like I said earlier", 
    "מה שכתבנו קודם", "המשך ממה שעשינו")
  - Query mentions an uploaded document ("in the file", "from the PDF",
    "במסמך", "בקובץ")

  FALSE if:
  - intent is "chitchat", "image_gen", "web_search", "image_analysis"
  - complexity is "low" AND no reference to past context
  - Clearly the first message of a new conversation

Step 5: DETECT LANGUAGE
  Hebrew chars (א-ת) → "he"
  Arabic chars (ا-ي) → "ar"
  Mixed with English → "mixed"
  Only Latin → "en"

Step 6: EXTRACT MAIN TOPIC
  One short phrase (max 5 words). Examples:
  "sorting algorithms", "React hooks", "פוליטיקה ישראלית", "recipe"
  chitchat → "general chat", unclear → "unclear"

Step 7: V4 — DETECT WORKING MEMORY PHASE
  planning — user is designing, brainstorming, choosing approach
  implementing — user is building, writing code, executing steps
  debugging — user has a broken thing and is fixing it
  reviewing — user is checking, testing, asking "is this correct"
  none — chitchat, simple Q&A, image gen, web search

Step 8: V4 — DETECT CODE MARKERS & DOCUMENT REFERENCES
  hasCodeMarkers: true if message contains ```, function names (camelCase/snake_case),
    file extensions (.ts, .py, .sql), or explicit code keywords
  referencesDocument: true if message mentions "file", "document", "PDF", "upload",
    "קובץ", "מסמך", or uses phrases like "in the attachment"
```

### Fallback & Validation

If the LLM call fails or returns invalid JSON:
1. **Validation layer** runs first — ensures `routeTo` matches the selected family; if not, corrects it.
2. **Fallback builder** — for very short/simple messages, returns `chitchat + low`; otherwise returns `question + medium + needsRAG:true` (safe default: search rather than miss).

### Fast Language Detection (No LLM)

```typescript
function detectLanguageFast(text: string): 'en' | 'he' | 'ar' | 'mixed' {
  const hasHebrew = /[\u0590-\u05FF]/.test(text);
  const hasArabic = /[\u0600-\u06FF]/.test(text);
  const hasLatin = /[a-zA-Z]/.test(text);
  if ((hasHebrew || hasArabic) && hasLatin) return 'mixed';
  if (hasHebrew && hasArabic) return 'mixed';
  if (hasHebrew) return 'he';
  if (hasArabic) return 'ar';
  return 'en';
}
```

### Why Gemini 2.5 Flash (not GLM, not Flash Lite)

- Cheapest viable LLM for structured JSON (~$0.0001/classification)
- ~150ms response time
- Strong instruction-following for structured output
- Already in the stack — no new API key
- Supports implicit context caching on the classifier system prompt (stable prefix) for further savings

### Cost Profile of the Classifier

| Path | Frequency | Cost per call | Latency |
|------|-----------|--------------|---------|
| Fast path (regex override) | ~30% | $0 | 0ms |
| LLM path (Gemini 2.5 Flash) | ~70% | ~$0.0001 | ~150ms |
| **Average per request** | — | **~$0.00007** | **~105ms** |

For 1K users × 50 messages/day = 50K classifications/day → **~$3.50/month**.

---

## 6. Layer 2: RAG Pipeline

**File:** `src/lib/memory/rag-pipeline.ts` (rewritten from V1)

This is the most changed layer in V4. It introduces 5 new concepts: pre-embedding, fingerprint filtering, adaptive weights, memory temperature, and active-only filtering.

### The 8-Step Pipeline

```typescript
export async function retrieveMemories(params: {
  userId: string;
  conversationId: string;
  message: string;
  conversationContext: string;  // last 2-3 messages for query expansion
  classification: ClassificationResult;
}): Promise<RetrievedContext> {
  const { userId, conversationId, message, classification } = params;
  
  // ═══ STEP 1: PRE-EMBED current message ═══
  // The user's message is the most relevant context to itself.
  // Store it in a temp buffer so it's searchable DURING this turn.
  const currentMessageEmbedding = await generateEmbedding(message);
  const tempMessageId = await storeTempEmbedding({
    userId, conversationId, content: message, 
    embedding: currentMessageEmbedding,
    metadata: { role: 'user', is_current_turn: true },
  });
  
  // ═══ STEP 2: Query Expansion (HyDE + multi-query) ═══
  const expandedQueries = await expandQuery({
    original: message,
    context: params.conversationContext,
    language: classification.language,
  });
  // Returns: [original, hypothetical_answer, rephrased_1, rephrased_2]
  
  // ═══ STEP 3: Conversation Fingerprint filter ═══
  // Get top-K relevant conversations FIRST, then search only within them.
  // This cuts the search space from ~10M embeddings to ~10K.
  const relevantConversationIds = await findRelevantConversations({
    userId,
    queryEmbedding: currentMessageEmbedding,
    topK: 10,
    currentConversationId: conversationId, // always included
  });
  
  // ═══ STEP 4: Hybrid search with ADAPTIVE WEIGHTS ═══
  const weights = computeAdaptiveWeights({
    intent: classification.intent,
    language: classification.language,
    hasCodeMarkers: classification.hasCodeMarkers ?? false,
  });
  
  const allResults = new Map<string, SearchResult>();
  
  for (const query of expandedQueries) {
    const queryEmbedding = query === message 
      ? currentMessageEmbedding  // reuse
      : await generateEmbedding(query);
    
    const { data } = await supabase.rpc('hybrid_search_v4', {
      query_text: query,
      query_embedding: queryEmbedding,
      target_user_id: userId,
      conversation_ids: relevantConversationIds,
      match_count: 24,
      full_text_weight: weights.fulltext,
      semantic_weight: weights.semantic,
      fuzzy_weight: weights.fuzzy,
    });
    
    data?.forEach(r => {
      const existing = allResults.get(r.id);
      if (!existing || r.score > existing.score) {
        allResults.set(r.id, r);
      }
    });
  }
  
  // ═══ STEP 5: Remove current message from results ═══
  // We pre-embedded it for search expansion, but we don't want to
  // inject the user's own current message back as "context".
  allResults.delete(tempMessageId);
  
  // ═══ STEP 6: Assign MEMORY TEMPERATURE ═══
  const withTemperature = Array.from(allResults.values()).map(r => ({
    ...r,
    temperature: computeMemoryTemperature(r, classification, conversationId),
  }));
  
  // ═══ STEP 7: Voyage AI Reranking (MANDATORY) ═══
  const reranked = await rerankResults(message, withTemperature, 12);
  
  // ═══ STEP 8: Filter active only (defense in depth) ═══
  // The SQL already filters is_active=true, but double-check here in case 
  // an invalidation happened mid-turn.
  const active = reranked.filter(r => r.is_active !== false);
  
  return {
    hot: active.filter(r => r.temperature === 'hot'),
    warm: active.filter(r => r.temperature === 'warm'),
    cold: active.filter(r => r.temperature === 'cold'),
    tempMessageId, // for cleanup in post-processing
  };
}
```

### Updated Hybrid Search SQL

```sql
CREATE OR REPLACE FUNCTION hybrid_search_v4(
  query_text text,
  query_embedding vector(1024),
  target_user_id uuid,
  conversation_ids uuid[],  -- V4: filter by fingerprint pre-selection
  match_count int DEFAULT 24,
  full_text_weight float DEFAULT 1.0,
  semantic_weight float DEFAULT 1.5,
  fuzzy_weight float DEFAULT 0.5,
  rrf_k int DEFAULT 50
)
RETURNS TABLE (
  id bigint,
  content text,
  source_type text,
  metadata jsonb,
  is_active boolean,
  created_at timestamptz,
  score float
)
LANGUAGE sql STABLE
AS $$
  WITH candidates AS (
    SELECT e.* FROM embeddings e
    WHERE e.user_id = target_user_id
      AND e.is_active = true  -- V4: active-only
      AND (
        conversation_ids IS NULL 
        OR (e.metadata->>'conversation_id')::uuid = ANY(conversation_ids)
        OR e.source_type IN ('fact', 'summary')  -- global memories always included
      )
  ),
  full_text AS (
    SELECT id,
      row_number() OVER (ORDER BY ts_rank_cd(fts, websearch_to_tsquery(query_text)) DESC) AS rank_ix
    FROM candidates
    WHERE fts @@ websearch_to_tsquery(query_text)
    ORDER BY rank_ix
    LIMIT LEAST(match_count * 4, 50)
  ),
  semantic AS (
    SELECT id,
      row_number() OVER (ORDER BY embedding <=> query_embedding) AS rank_ix
    FROM candidates
    ORDER BY rank_ix
    LIMIT LEAST(match_count * 4, 50)
  ),
  fuzzy AS (
    SELECT id,
      row_number() OVER (ORDER BY similarity(content, query_text) DESC) AS rank_ix
    FROM candidates
    WHERE content % query_text
    LIMIT LEAST(match_count * 2, 25)
  )
  SELECT
    c.id, c.content, c.source_type, c.metadata, c.is_active, c.created_at,
    (
      COALESCE(1.0 / (rrf_k + full_text.rank_ix), 0.0) * full_text_weight +
      COALESCE(1.0 / (rrf_k + semantic.rank_ix), 0.0) * semantic_weight +
      COALESCE(1.0 / (rrf_k + fuzzy.rank_ix), 0.0) * fuzzy_weight
    ) AS score
  FROM full_text
  FULL OUTER JOIN semantic ON full_text.id = semantic.id
  FULL OUTER JOIN fuzzy ON COALESCE(full_text.id, semantic.id) = fuzzy.id
  JOIN candidates c ON COALESCE(full_text.id, semantic.id, fuzzy.id) = c.id
  ORDER BY score DESC
  LIMIT match_count;
$$;
```

---

## 7. Layer 3: Context Assembler

**File:** `src/lib/memory/context-assembler.ts`

The assembler builds the final prompt with two sharp halves: a **stable prefix** that Gemini can cache, and a **variable suffix** that changes each turn.

### Token Budget Table (Density-Aware)

| Model | System | Stable (cached) | Hot | Warm | Cold | Recent | Output |
|-------|--------|-----------------|-----|------|------|--------|--------|
| gpt-5.1 | 2000 | 3000 | 4000 | 2000 | 1000 | 6000 | 4096 |
| gpt-5-mini | 1500 | 2000 | 2500 | 1500 | 500 | 4000 | 4096 |
| gemini-3.1-pro | 2000 | 4000 | 6000 | 3000 | 2000 | 16000 | 8192 |
| gemini-3-flash | 1500 | 3000 | 4000 | 2000 | 1000 | 8000 | 4096 |
| glm-5 | 2000 | 3000 | 4000 | 2000 | 1000 | 6000 | 4096 |

### Density-Aware Budgeting

Not all tokens carry the same information. The assembler computes a density score per chunk and prefers high-density content when the budget is tight:

```typescript
function computeDensity(content: string): number {
  let score = 0.5;
  if (/```[\s\S]*```/.test(content)) score += 0.3;        // code block
  if (/^#{1,6}\s/m.test(content)) score += 0.1;            // headers
  if (/\|.*\|.*\|/.test(content)) score += 0.2;            // tables
  if (content.length < 100) score -= 0.2;                  // short = low info
  if (/^(hi|hello|thanks|ok|sure)/i.test(content)) score -= 0.3;
  return Math.max(0.1, Math.min(1.0, score));
}
```

When trimming to fit the budget, the assembler sorts by `density × temperature_weight` and drops the lowest-density items first.

### The Stable Prefix (Cached by Gemini)

```
[SYSTEM PROMPT — base instructions]

User Profile:
- Language: {language}
- Expertise: {expertise}
- Preferences: {preferences}

📎 Documents in this conversation:
- "report.pdf" (uploaded 2026-04-01, 12 pages): Q3 financial report covering revenue, expenses, projections
- "code.py" (uploaded 2026-04-01): Python sorting algorithms

🎯 Current task (working memory):
- Task: Building REST API for user authentication
- Phase: implementing
- Active files: auth.ts, users.sql
- Open questions: Should we use JWT or session cookies?
- Decisions so far: PostgreSQL chosen, bcrypt for hashing

📜 Conversation so far (macro summary):
{macro_summary — incremental, never regenerated from scratch}
```

This block is **identical across consecutive turns in the same conversation**. Gemini's implicit cache detects the shared prefix and charges 10% of normal rate for it. This alone saves 40-60% on Gemini costs for document-heavy conversations.

### The Variable Suffix

```
[HOT memories — always injected]
{hot.map(m => `[${m.source_type}, ${ago(m.created_at)}] ${m.content}`).join('\n\n')}

[WARM memories — if budget allows]
{warm.filter(fitsBudget).map(...)}

[COLD memories — fill remainder]
{cold.filter(fitsBudget).map(...)}

[Recent conversation — adaptive window]
{recentMessages}  // 2-8 messages based on phase & density

[Current user message]
{message}
```

### Adaptive Window Size

```typescript
function determineWindowSize(classification: ClassificationResult, ragResultCount: number): number {
  if (classification.intent === 'chitchat') return 2;
  if (classification.workingMemoryPhase === 'debugging') return 8;  // needs error trace
  if (classification.workingMemoryPhase === 'implementing') return 6;
  if (classification.complexity === 'high') return 7;
  if (ragResultCount >= 8) return 3;  // RAG is carrying the weight
  return 5;
}
```

---

## 8. Layer 4: Generation

**File:** `src/app/api/chat/route.ts` (orchestrator)

### Caching Strategy Per Model

| Provider | Caching Mechanism | Setup |
|----------|-------------------|-------|
| Gemini 2.5+ | Implicit (automatic) | Structure stable prefix at start of prompt |
| Gemini (long docs) | Explicit cache | Create cache for large documents, reuse via `cachedContent` |
| OpenAI GPT-5.1 | Prefix caching (automatic) | Same — stable prefix first |
| GLM 5 | Prefix caching (if available) | Same structure |

### Explicit Gemini Cache for Long Documents

When a conversation has a document > 10K tokens, create an explicit cache at upload time:

```typescript
import { GoogleGenAI } from '@google/genai';
const ai = new GoogleGenAI({ apiKey: process.env.GOOGLE_AI_API_KEY });

async function createDocumentCache(document: string, systemPrompt: string, conversationId: string) {
  const cache = await ai.caches.create({
    model: 'gemini-3.1-pro',
    config: {
      contents: [{ role: 'user', parts: [{ text: document }] }],
      systemInstruction: systemPrompt,
      ttl: '3600s',  // 1 hour, refresh on use
      displayName: `convo-${conversationId}`,
    },
  });
  
  await supabase.from('conversations')
    .update({ gemini_cache_name: cache.name })
    .eq('id', conversationId);
  
  return cache.name;
}

// Use in chat route
const cacheName = conversation.gemini_cache_name;
const response = await ai.models.generateContent({
  model: 'gemini-3.1-pro',
  contents: assembledMessages,
  config: cacheName ? { cachedContent: cacheName } : undefined,
});
```

Explicit cache cost: **10% of normal input token price** for cached portion. Breakeven: document used 2+ times within the TTL.

### Streaming Protocol

Unchanged from V1: SSE with heartbeat every 15s, AbortController for cancellation, `data: [DONE]` terminator.

---

## 9. Layer 5: Post-Processing

After the response streams, the following runs (most of it async, not blocking the user):

1. **Commit pre-embed** — move the temp embedding from Layer 2 into permanent `embeddings` table.
2. **Embed assistant response** — same Voyage AI pipeline.
3. **Incremental summary patch** — call Gemini Flash with the patch prompt (see Section 10.5).
4. **Working memory update** — if message count % 3 === 0 OR the classifier detected a phase change, update `conversation.working_memory`.
5. **Memory extraction with dedup** — extract facts, but check semantic similarity against existing memories (threshold 0.92) and update instead of duplicating.
6. **Anti-memory detection** — check for rejection/correction patterns in the user message and the model's acknowledgment.
7. **Message importance scoring** — compute density score and store in `embeddings.metadata.importance`.
8. **Conversation fingerprint update** — every 20 messages, regenerate the 256-dim conversation vector.
9. **Periodic cleanup** — nightly Edge Function runs: decay old memories, cap at 200/user, delete permanently inactive embeddings older than 90 days.

---

## 10. New Subsystems

### 10.1 Working Memory (`src/lib/memory/working-memory.ts`)

**Purpose:** Track what the user is doing right now.

**Schema addition:**
```sql
ALTER TABLE conversations 
ADD COLUMN working_memory jsonb DEFAULT '{
  "task": null,
  "phase": "none",
  "active_files": [],
  "open_questions": [],
  "decisions": []
}';
```

**Update logic:**
```typescript
interface WorkingMemory {
  task: string | null;          // "Building REST API for user auth"
  phase: 'planning' | 'implementing' | 'debugging' | 'reviewing' | 'none';
  active_files: string[];       // ["auth.ts", "users.sql"]
  open_questions: string[];     // ["JWT or session cookies?"]
  decisions: string[];          // ["PostgreSQL chosen", "bcrypt for hashing"]
}

export async function updateWorkingMemory(
  conversationId: string,
  recentMessages: Message[],
  classification: ClassificationResult
): Promise<WorkingMemory> {
  // Use Gemini Flash with structured output
  // Input: current WM + last 5 messages + classification
  // Output: updated WM
  const current = await getWorkingMemory(conversationId);
  
  const prompt = `You are maintaining a working memory buffer for a conversation.
Current state: ${JSON.stringify(current)}
Recent messages: ${JSON.stringify(recentMessages)}
Classification hint: phase=${classification.workingMemoryPhase}

Update the working memory. Return ONLY JSON matching this schema:
{ "task": string|null, "phase": "planning|implementing|debugging|reviewing|none",
  "active_files": string[], "open_questions": string[], "decisions": string[] }

Rules:
- Do NOT reset fields unless the task has clearly changed
- Add to arrays; do not remove unless the item was explicitly resolved
- If phase changed, explain in a new decision entry
- Max 5 items per array (drop oldest if over)`;

  const updated = await callGeminiFlashJSON(prompt);
  
  await supabase.from('conversations')
    .update({ working_memory: updated })
    .eq('id', conversationId);
  
  return updated;
}
```

**Injected into stable prefix** (Section 7) so Gemini caches it.

---

### 10.2 Anti-Memory (`src/lib/memory/anti-memory.ts`)

**Purpose:** Store explicit rejections so the model never suggests the same wrong thing twice.

**Schema addition:**
```sql
ALTER TABLE memories 
  DROP CONSTRAINT memories_type_check;

ALTER TABLE memories 
  ADD CONSTRAINT memories_type_check 
  CHECK (type IN ('fact', 'preference', 'goal', 'skill', 'opinion', 'anti_memory'));
```

**Detection (runs in Layer 5):**
```typescript
const REJECTION_PATTERNS = [
  /(?:didn'?t work|doesn'?t work|not working|failed|wrong|incorrect)/i,
  /(?:לא עבד|לא עובד|נכשל|שגוי|לא נכון)/,
];

export async function detectAntiMemory(
  userMessage: string,
  previousAssistantResponse: string,
  userId: string,
  conversationId: string
) {
  if (!REJECTION_PATTERNS.some(p => p.test(userMessage))) return;
  
  // Extract what was rejected: the previous assistant response was the suggestion
  // Use Gemini Flash to summarize the rejection
  const summary = await callGeminiFlashJSON(`
The user rejected something. Summarize what was rejected and why.
Previous assistant response: "${previousAssistantResponse.slice(0, 1000)}"
User's rejection: "${userMessage}"

Return JSON: { "rejected": "what was rejected", "reason": "why", "avoid_pattern": "what to not do again" }
`);
  
  await supabase.from('memories').insert({
    user_id: userId,
    type: 'anti_memory',
    content: `REJECTED: ${summary.rejected}. Reason: ${summary.reason}. Avoid: ${summary.avoid_pattern}`,
    confidence: 0.95,
    source_conversation_id: conversationId,
  });
}
```

Anti-memories get **highest injection priority** as HOT memories in Layer 3 — the model must see them.

---

### 10.3 Adaptive Weights (`src/lib/memory/adaptive-weights.ts`)

```typescript
interface SearchWeights {
  fulltext: number;
  semantic: number;
  fuzzy: number;
}

export function computeAdaptiveWeights(params: {
  intent: string;
  language: string;
  hasCodeMarkers: boolean;
}): SearchWeights {
  // Cross-lingual: semantic only (fuzzy doesn't work across languages)
  if (params.language === 'he' || params.language === 'ar' || params.language === 'mixed') {
    return { fulltext: 0.3, semantic: 2.0, fuzzy: 0.0 };
  }
  
  // Code with exact symbols: boost fuzzy for function/variable name matches
  if (params.intent === 'code' && params.hasCodeMarkers) {
    return { fulltext: 1.2, semantic: 1.0, fuzzy: 1.5 };
  }
  
  // Conceptual/analytical: semantic dominates
  if (params.intent === 'analysis' || params.intent === 'question') {
    return { fulltext: 0.8, semantic: 2.0, fuzzy: 0.3 };
  }
  
  // Creative: balanced
  if (params.intent === 'creative') {
    return { fulltext: 1.0, semantic: 1.5, fuzzy: 0.5 };
  }
  
  // Default (V1 weights)
  return { fulltext: 1.0, semantic: 1.5, fuzzy: 0.5 };
}
```

---

### 10.4 Memory Temperature (`src/lib/memory/memory-temperature.ts`)

```typescript
type Temperature = 'hot' | 'warm' | 'cold';

export function computeMemoryTemperature(
  result: SearchResult,
  classification: ClassificationResult,
  currentConversationId: string
): Temperature {
  const meta = result.metadata ?? {};
  const ageMs = Date.now() - new Date(result.created_at).getTime();
  const ageHours = ageMs / (1000 * 60 * 60);
  
  // HOT: anti-memories, current conversation recent, document registry matches
  if (result.source_type === 'anti_memory') return 'hot';
  if (meta.conversation_id === currentConversationId && ageHours < 2) return 'hot';
  if (result.source_type === 'document' && classification.referencesDocument) return 'hot';
  if (result.score > 0.85) return 'hot';
  
  // WARM: same conversation older, high-confidence memories, same topic
  if (meta.conversation_id === currentConversationId) return 'warm';
  if (result.source_type === 'fact' && (meta.confidence ?? 0) > 0.8) return 'warm';
  if (result.score > 0.6) return 'warm';
  
  // COLD: everything else that made it through reranking
  return 'cold';
}
```

**Injection policy in Layer 3:**
- HOT: always injected, up to 60% of context budget
- WARM: injected if HOT + WARM together ≤ 85% of budget
- COLD: fills remaining budget, dropped first if over

---

### 10.5 Incremental Summary Patching (`src/lib/memory/rolling-summary.ts`)

**The key shift:** Instead of regenerating the summary from scratch every 10 messages, we produce a JSON patch and apply it.

**Storage format:**
```typescript
interface StructuredSummary {
  decisions: string[];           // Things decided
  technical: string[];           // Code/algorithms/approaches discussed
  documents: Array<{             // Uploaded docs + what they contain
    filename: string;
    summary: string;
    key_sections: string[];
  }>;
  preferences: string[];         // User preferences discovered
  open_threads: string[];        // Unresolved items
  narrative: string;             // 2-3 sentence big picture
}
```

**Patch prompt:**
```
You are maintaining an incremental conversation summary.

Current summary (JSON):
{current}

New messages since last patch:
{recent_messages}

Produce a JSON patch to apply. Schema:
{
  "add": { "decisions": [...], "technical": [...], "documents": [...], 
           "preferences": [...], "open_threads": [...] },
  "update": { "narrative": "new text or null" },
  "remove": { "open_threads": ["items to remove because they were resolved"] }
}

Rules:
- NEVER remove decisions, technical details, or document summaries — only add to them
- open_threads CAN be removed if they were explicitly resolved in the new messages
- Only update narrative if the conversation arc meaningfully shifted
- Return {} if nothing changed
```

**Apply the patch:**
```typescript
function applyPatch(current: StructuredSummary, patch: SummaryPatch): StructuredSummary {
  return {
    decisions: [...current.decisions, ...(patch.add?.decisions ?? [])],
    technical: [...current.technical, ...(patch.add?.technical ?? [])],
    documents: [...current.documents, ...(patch.add?.documents ?? [])],
    preferences: [...current.preferences, ...(patch.add?.preferences ?? [])],
    open_threads: [
      ...current.open_threads.filter(t => !patch.remove?.open_threads?.includes(t)),
      ...(patch.add?.open_threads ?? []),
    ],
    narrative: patch.update?.narrative ?? current.narrative,
  };
}
```

**Why it's better than V3 regeneration:**
- Old details can never silently disappear — removal is explicit only
- Output is smaller (only the patch, not the whole summary) → cheaper LLM call
- Structured format lets the assembler pick what to inject based on the current query

---

### 10.6 Conversation Fingerprinting (`src/lib/memory/conversation-fingerprint.ts`)

**Problem:** Scanning all embeddings across all conversations is wasteful. A user with 100 conversations and 10K messages doesn't need to search all of them — only the 5-10 most relevant.

**Solution:** A 256-dim fingerprint per conversation (truncated from 1024-dim Voyage embeddings).

**Schema addition:**
```sql
ALTER TABLE conversations 
ADD COLUMN fingerprint vector(256);

CREATE INDEX idx_conversations_fingerprint 
  ON conversations USING hnsw (fingerprint vector_cosine_ops);
```

**Generation:**
```typescript
export async function updateConversationFingerprint(conversationId: string) {
  // Take: title + summary.narrative + top 10 most important messages
  const { data: convo } = await supabase
    .from('conversations').select('*').eq('id', conversationId).single();
  
  const fingerprintText = [
    convo.title,
    convo.summary?.narrative ?? '',
    ...convo.summary?.technical?.slice(0, 5) ?? [],
    ...convo.summary?.decisions?.slice(0, 5) ?? [],
  ].join(' | ');
  
  const fullEmbedding = await generateEmbedding(fingerprintText);
  // Truncate to 256 dims — enough for coarse conversation-level filtering
  const fingerprint = fullEmbedding.slice(0, 256);
  
  await supabase.from('conversations')
    .update({ fingerprint })
    .eq('id', conversationId);
}

export async function findRelevantConversations(params: {
  userId: string;
  queryEmbedding: number[];
  topK: number;
  currentConversationId: string;
}): Promise<string[]> {
  const truncated = params.queryEmbedding.slice(0, 256);
  
  const { data } = await supabase.rpc('search_conversations_by_fingerprint', {
    target_user_id: params.userId,
    query_fingerprint: truncated,
    match_count: params.topK,
  });
  
  const ids = data?.map((c: any) => c.id) ?? [];
  if (!ids.includes(params.currentConversationId)) {
    ids.unshift(params.currentConversationId);  // always include current
  }
  return ids;
}
```

**Trigger:** Regenerated every 20 messages in the post-processing layer.

---

### 10.7 Preemptive Loading (`src/hooks/usePreemptiveContext.ts`)

**Problem:** The RAG pipeline takes ~800-1200ms. The user experiences this as latency after they press Enter.

**Solution:** Start computing RAG **while the user is still typing**. Debounced on input, cancelled if the message changes significantly.

```typescript
// Client-side hook
import { useEffect, useRef } from 'react';
import { useDebouncedCallback } from 'use-debounce';

export function usePreemptiveContext(
  conversationId: string,
  draftMessage: string
) {
  const preloadedRef = useRef<{ text: string; context: any } | null>(null);
  
  const preload = useDebouncedCallback(async (text: string) => {
    if (text.length < 15) return;  // not worth it
    
    try {
      const response = await fetch('/api/chat/preload', {
        method: 'POST',
        body: JSON.stringify({ conversationId, message: text }),
      });
      const context = await response.json();
      preloadedRef.current = { text, context };
    } catch {
      // silent fail — the normal flow will compute it anyway
    }
  }, 600);  // 600ms after typing stops
  
  useEffect(() => {
    preload(draftMessage);
  }, [draftMessage, preload]);
  
  return {
    getPreloaded(finalMessage: string) {
      // Only use if the final message closely matches the preloaded one
      if (preloadedRef.current && isSimilar(finalMessage, preloadedRef.current.text)) {
        return preloadedRef.current.context;
      }
      return null;
    },
  };
}
```

**New endpoint:** `src/app/api/chat/preload/route.ts` runs classifier + RAG and returns the context bundle. The main `/api/chat` endpoint checks if the client sent `preloadedContext` in the body and skips those steps if present.

**Savings:** 300-500ms of perceived latency.

**Cost:** Small increase in classifier calls (some preloads get thrown away), offset by Gemini 2.5 Flash pricing being cheap.

---

### 10.8 Token Density Awareness (`src/lib/memory/token-density.ts`)

Already covered in Section 7 (Context Assembler). The density scorer runs on every chunk during assembly, and the assembler sorts by `density × temperature_weight` when trimming to fit the budget.

---

### 10.9 Structure-Aware Document Chunking (`src/lib/memory/document-processor.ts`)

Replaces V3's recursive blind chunker. Uses document structure instead of token counts alone.

**Algorithm:**
```typescript
interface StructuralBlock {
  type: 'heading' | 'paragraph' | 'code' | 'table' | 'list' | 'other';
  level?: number;        // for headings (1-6)
  content: string;
  breadcrumb: string[];  // ["Chapter 1", "Section 1.2", "Subsection"]
}

function parseDocument(text: string, fileType: string): StructuralBlock[] {
  // For markdown: use a markdown parser (unified + remark-parse)
  // For PDF: use pdf-parse to get text, then apply heuristics
  //   - Lines in ALL CAPS or title case on their own line → heading
  //   - Lines starting with numbers/letters + . → list
  //   - Lines enclosed in triple-backticks or indented ≥4 spaces → code
  // For DOCX: use mammoth which preserves heading structure natively
  
  // Return blocks with accurate type tags and breadcrumb trails
}

function chunkStructurally(blocks: StructuralBlock[], maxTokens = 400): Chunk[] {
  const chunks: Chunk[] = [];
  let current: StructuralBlock[] = [];
  let currentTokens = 0;
  
  for (const block of blocks) {
    const blockTokens = estimateTokens(block.content);
    
    // NEVER split atomic blocks (code, tables)
    if (block.type === 'code' || block.type === 'table') {
      if (current.length > 0) {
        chunks.push(finalizeChunk(current));
        current = [];
        currentTokens = 0;
      }
      chunks.push(finalizeChunk([block]));  // standalone chunk, even if >400 tokens
      continue;
    }
    
    // If adding this block would exceed budget, close current chunk
    if (currentTokens + blockTokens > maxTokens && current.length > 0) {
      chunks.push(finalizeChunk(current));
      current = [];
      currentTokens = 0;
    }
    
    current.push(block);
    currentTokens += blockTokens;
  }
  
  if (current.length > 0) chunks.push(finalizeChunk(current));
  return chunks;
}

function finalizeChunk(blocks: StructuralBlock[]): Chunk {
  // Breadcrumb prefix is free context — no LLM call needed
  const breadcrumb = blocks[0].breadcrumb.join(' > ');
  const content = blocks.map(b => b.content).join('\n\n');
  const sectionType = dominantType(blocks);
  
  return {
    content: `[${breadcrumb}]\n${content}`,
    metadata: { section_type: sectionType, breadcrumb },
  };
}
```

**Cost:** $0 LLM. Pure parsing + embedding. Only the embedding call (~$0.001 per chunk) remains.

---

## 11. Database Schema Changes

-- ============================================================
-- MULTICHAT AI — V4 COMPLETE FRESH INSTALL
-- Supabase SQL Editor compatible (fresh/empty database)
-- Run this entire file in one go via Supabase Dashboard > SQL Editor
-- ============================================================


-- ============================================================
-- EXTENSIONS
-- ============================================================
create extension if not exists vector;
create extension if not exists pg_trgm;


-- ============================================================
-- TABLES
-- ============================================================

-- 1. USER PROFILES
create table public.users (
  id uuid references auth.users(id) on delete cascade primary key,
  email text,
  name text,
  avatar_url text,
  language text default 'auto',
  expertise text default 'general',
  preferred_model text default 'gemini-3.1-pro',
  preferences jsonb default '{}'::jsonb,
  daily_message_limit int default 100,
  messages_today int default 0,
  last_reset_date date default current_date,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- 2. FOLDERS (created before conversations so FK can reference it)
create table public.folders (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references public.users(id) on delete cascade not null,
  name text not null,
  icon text default 'folder',
  sort_order int default 0,
  created_at timestamptz default now()
);

-- 3. CONVERSATIONS (V4: working memory, document registry, fingerprint)
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
  folder_id uuid references public.folders(id) on delete set null,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),

  -- V4 columns
  working_memory jsonb default '{
    "current_task": null,
    "sub_tasks": [],
    "active_entities": [],
    "last_decision": null,
    "phase": "idle",
    "updated_at": null
  }'::jsonb,
  document_registry jsonb default '[]'::jsonb,
  fingerprint vector(256),
  structured_summary jsonb,
  gemini_cache_name text,
  key_entities text[] default '{}',
  key_topics text[] default '{}'
);

-- 4. MESSAGES
create table public.messages (
  id uuid default gen_random_uuid() primary key,
  conversation_id uuid references public.conversations(id) on delete cascade not null,
  role text not null check (role in ('user', 'assistant', 'system')),
  content text not null,
  content_blocks jsonb,
  model text,
  token_count int,
  attachments jsonb default '[]'::jsonb,
  created_at timestamptz default now()
);

-- 5. MEMORIES (V4: extended types + invalidation tracking)
create table public.memories (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references public.users(id) on delete cascade not null,
  type text not null check (type in (
    'fact', 'preference', 'goal', 'skill', 'opinion',
    'rejection', 'correction', 'constraint', 'anti_memory'
  )),
  content text not null,
  confidence float default 0.8,
  source_conversation_id uuid references public.conversations(id) on delete set null,
  created_at timestamptz default now(),

  -- V4 columns
  is_active boolean default true,
  valid_until timestamptz,
  invalidated_by uuid references public.memories(id) on delete set null
);

-- 6. EMBEDDINGS (V4: extended source types)
create table public.embeddings (
  id bigserial primary key,
  user_id uuid references public.users(id) on delete cascade not null,
  source_type text not null check (source_type in (
    'message', 'fact', 'document', 'summary', 'anti_memory'
  )),
  source_id uuid,
  content text not null,
  embedding vector(1024) not null,
  fts tsvector generated always as (
    to_tsvector('english', content)
  ) stored,
  metadata jsonb default '{}'::jsonb,
  created_at timestamptz default now()
);

-- 7. USER ENTITIES (knowledge graph — reserved for future)
create table public.user_entities (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references public.users(id) on delete cascade not null,
  entity_name text not null,
  entity_type text not null,
  properties jsonb default '{}'::jsonb,
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

-- Embeddings: core RAG indexes
create index idx_embeddings_hnsw on embeddings
  using hnsw (embedding vector_cosine_ops);
create index idx_embeddings_fts on embeddings
  using gin (fts);
create index idx_embeddings_trgm on embeddings
  using gin (content gin_trgm_ops);
create index idx_embeddings_user on embeddings
  (user_id, created_at desc);
create index idx_embeddings_meta on embeddings
  using gin (metadata);
create index idx_embeddings_source on embeddings
  (source_type, source_id)
  where source_id is not null;

-- Messages
create index idx_messages_conv on messages
  (conversation_id, created_at asc);
create index idx_messages_has_attachments on messages
  (conversation_id, created_at asc)
  where jsonb_array_length(attachments) > 0;

-- Conversations
create index idx_conversations_user on conversations
  (user_id, updated_at desc);
create index idx_conversations_folder on conversations
  (folder_id);
create index idx_conversations_share on conversations
  (share_token)
  where share_token is not null;
create index idx_conversations_fingerprint on conversations
  using hnsw (fingerprint vector_cosine_ops);
create index idx_conversations_topics on conversations
  using gin (key_topics);

-- Memories
create index idx_memories_user on memories
  (user_id, type);
create index idx_memories_active on memories
  (user_id, is_active)
  where is_active = true;
create index idx_memories_user_created on memories
  (user_id, created_at desc);

-- Usage
create index idx_usage_user_date on usage_logs
  (user_id, created_at desc);


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

-- Users
create policy "Users read own profile"
  on users for select
  using (auth.uid() = id);

create policy "Users insert own profile"
  on users for insert
  with check (auth.uid() = id);

create policy "Users update own profile"
  on users for update
  using (auth.uid() = id);

-- Conversations
create policy "Users manage own conversations"
  on conversations for all
  using (auth.uid() = user_id);

create policy "Anyone can read shared conversations"
  on conversations for select
  using (is_public = true and share_token is not null);

-- Messages
create policy "Users manage own messages"
  on messages for all
  using (
    auth.uid() = (
      select user_id from conversations
      where id = messages.conversation_id
    )
  );

create policy "Anyone can read shared messages"
  on messages for select
  using (
    exists (
      select 1 from conversations
      where id = messages.conversation_id
        and is_public = true
    )
  );

-- Memories
create policy "Users manage own memories"
  on memories for all
  using (auth.uid() = user_id);

-- Embeddings
create policy "Users manage own embeddings"
  on embeddings for all
  using (auth.uid() = user_id);

-- Folders
create policy "Users manage own folders"
  on folders for all
  using (auth.uid() = user_id);

-- User entities
create policy "Users manage own entities"
  on user_entities for all
  using (auth.uid() = user_id);

create policy "Users manage own relations"
  on user_entity_relations for all
  using (auth.uid() = user_id);

-- Usage logs
create policy "Users read own usage"
  on usage_logs for select
  using (auth.uid() = user_id);

create policy "Users insert own usage"
  on usage_logs for insert
  with check (auth.uid() = user_id);


-- ============================================================
-- FUNCTIONS
-- ============================================================

-- Auto-create user profile on signup
create or replace function public.handle_new_user()
returns trigger as $$
begin
  insert into public.users (id, email, name, avatar_url)
  values (
    new.id,
    new.email,
    coalesce(
      new.raw_user_meta_data->>'full_name',
      new.raw_user_meta_data->>'name',
      split_part(new.email, '@', 1)
    ),
    new.raw_user_meta_data->>'avatar_url'
  );
  return new;
end;
$$ language plpgsql security definer;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();


-- Increment message count on insert
create or replace function public.auto_update_conversation()
returns trigger as $$
begin
  update conversations
  set message_count = message_count + 1,
      updated_at = now()
  where id = new.conversation_id;
  return new;
end;
$$ language plpgsql security definer;

drop trigger if exists on_message_insert on messages;
create trigger on_message_insert
  after insert on messages
  for each row execute procedure public.auto_update_conversation();


-- Decrement message count on delete
create or replace function public.decrement_conversation_count()
returns trigger as $$
begin
  update public.conversations
  set message_count = greatest(message_count - 1, 0),
      updated_at = now()
  where id = old.conversation_id;
  return old;
end;
$$ language plpgsql security definer;

drop trigger if exists on_message_delete_update_count on messages;
create trigger on_message_delete_update_count
  after delete on messages
  for each row execute procedure public.decrement_conversation_count();


-- Delete orphaned embeddings when a message is deleted
create or replace function public.delete_orphaned_embeddings()
returns trigger
language plpgsql security definer as $$
begin
  delete from public.embeddings
  where source_id = old.id
    and source_type = 'message';
  return old;
end;
$$;

drop trigger if exists on_message_delete_cleanup_embeddings on messages;
create trigger on_message_delete_cleanup_embeddings
  after delete on messages
  for each row execute procedure public.delete_orphaned_embeddings();


-- Delete related data when a conversation is deleted
create or replace function public.delete_conversation_data()
returns trigger
language plpgsql security definer as $$
begin
  -- Delete embeddings linked to this conversation via metadata
  delete from public.embeddings
  where user_id = old.user_id
    and (metadata->>'conversation_id') = old.id::text;

  -- Delete memories sourced from this conversation
  delete from public.memories
  where source_conversation_id = old.id;

  return old;
end;
$$;

drop trigger if exists on_conversation_delete_cleanup on conversations;
create trigger on_conversation_delete_cleanup
  before delete on conversations
  for each row execute procedure public.delete_conversation_data();


-- Daily message limit reset
create or replace function public.reset_daily_message_counts()
returns void as $$
begin
  update users
  set messages_today = 0,
      last_reset_date = current_date
  where last_reset_date < current_date;
end;
$$ language plpgsql security definer;


-- ============================================================
-- V4 RAG FUNCTIONS
-- ============================================================

-- Drop old function signatures first (return type changed from V1)
drop function if exists public.hybrid_search(text, vector, uuid, int, float, float, float, int);
drop function if exists public.hybrid_search_scoped(text, vector, uuid, uuid[], int, float, float, float, int);
drop function if exists public.find_similar_memory(uuid, vector, float);
drop function if exists public.search_similar_conversations(vector, uuid, int);
drop function if exists public.cleanup_memories_v4(uuid);
drop function if exists public.get_user_memory_stats(uuid);
drop function if exists public.get_conversation_embedding_stats(uuid);

-- Core Hybrid Search (V4)
-- Filters: is_active via metadata, excludes current-turn pre-embeds
-- Supports adaptive weights passed from the classifier
create or replace function public.hybrid_search(
  query_text text,
  query_embedding vector(1024),
  target_user_id uuid,
  match_count int default 5,
  full_text_weight float default 1.0,
  semantic_weight float default 1.5,
  fuzzy_weight float default 0.5,
  rrf_k int default 50
)
returns table (
  id bigint,
  content text,
  source_type text,
  source_id uuid,
  metadata jsonb,
  created_at timestamptz,
  score float
)
language sql stable
as $$
  with active_embeddings as (
    select *
    from embeddings e
    where e.user_id = target_user_id
      and coalesce((e.metadata->>'is_active')::boolean, true) = true
      and coalesce((e.metadata->>'is_current_message')::boolean, false) = false
  ),
  full_text as (
    select ae.id,
      row_number() over (
        order by ts_rank_cd(ae.fts, websearch_to_tsquery(query_text)) desc
      ) as rank_ix
    from active_embeddings ae
    where ae.fts @@ websearch_to_tsquery(query_text)
    limit least(match_count * 4, 30)
  ),
  semantic as (
    select ae.id,
      row_number() over (
        order by ae.embedding <=> query_embedding
      ) as rank_ix
    from active_embeddings ae
    order by ae.embedding <=> query_embedding
    limit least(match_count * 4, 30)
  ),
  fuzzy as (
    select ae.id,
      row_number() over (
        order by similarity(ae.content, query_text) desc
      ) as rank_ix
    from active_embeddings ae
    where ae.content % query_text
    limit least(match_count * 2, 15)
  ),
  combined as (
    select
      coalesce(ft.id, sem.id, fz.id) as eid,
      (
        coalesce(1.0 / (rrf_k + ft.rank_ix), 0.0) * full_text_weight +
        coalesce(1.0 / (rrf_k + sem.rank_ix), 0.0) * semantic_weight +
        coalesce(1.0 / (rrf_k + fz.rank_ix), 0.0) * fuzzy_weight
      ) as combined_score
    from full_text ft
    full outer join semantic sem on ft.id = sem.id
    full outer join fuzzy fz on coalesce(ft.id, sem.id) = fz.id
  )
  select
    e.id,
    e.content,
    e.source_type,
    e.source_id,
    e.metadata,
    e.created_at,
    c.combined_score as score
  from combined c
  join embeddings e on c.eid = e.id
  order by c.combined_score desc
  limit match_count;
$$;


-- Conversation-scoped hybrid search (V4)
-- Like hybrid_search but filters to specific conversation IDs
-- Used after fingerprint pre-filtering narrows the search space
create or replace function public.hybrid_search_scoped(
  query_text text,
  query_embedding vector(1024),
  target_user_id uuid,
  conversation_ids uuid[],
  match_count int default 5,
  full_text_weight float default 1.0,
  semantic_weight float default 1.5,
  fuzzy_weight float default 0.5,
  rrf_k int default 50
)
returns table (
  id bigint,
  content text,
  source_type text,
  source_id uuid,
  metadata jsonb,
  created_at timestamptz,
  score float
)
language sql stable
as $$
  with active_embeddings as (
    select *
    from embeddings e
    where e.user_id = target_user_id
      and coalesce((e.metadata->>'is_active')::boolean, true) = true
      and coalesce((e.metadata->>'is_current_message')::boolean, false) = false
      and (
        -- Include if belongs to one of the fingerprint-selected conversations
        (e.metadata->>'conversation_id')::uuid = any(conversation_ids)
        -- Always include global memories (facts, anti_memory) regardless of conversation
        or e.source_type in ('fact', 'summary', 'anti_memory')
      )
  ),
  full_text as (
    select ae.id,
      row_number() over (
        order by ts_rank_cd(ae.fts, websearch_to_tsquery(query_text)) desc
      ) as rank_ix
    from active_embeddings ae
    where ae.fts @@ websearch_to_tsquery(query_text)
    limit least(match_count * 4, 30)
  ),
  semantic as (
    select ae.id,
      row_number() over (
        order by ae.embedding <=> query_embedding
      ) as rank_ix
    from active_embeddings ae
    order by ae.embedding <=> query_embedding
    limit least(match_count * 4, 30)
  ),
  fuzzy as (
    select ae.id,
      row_number() over (
        order by similarity(ae.content, query_text) desc
      ) as rank_ix
    from active_embeddings ae
    where ae.content % query_text
    limit least(match_count * 2, 15)
  ),
  combined as (
    select
      coalesce(ft.id, sem.id, fz.id) as eid,
      (
        coalesce(1.0 / (rrf_k + ft.rank_ix), 0.0) * full_text_weight +
        coalesce(1.0 / (rrf_k + sem.rank_ix), 0.0) * semantic_weight +
        coalesce(1.0 / (rrf_k + fz.rank_ix), 0.0) * fuzzy_weight
      ) as combined_score
    from full_text ft
    full outer join semantic sem on ft.id = sem.id
    full outer join fuzzy fz on coalesce(ft.id, sem.id) = fz.id
  )
  select
    e.id,
    e.content,
    e.source_type,
    e.source_id,
    e.metadata,
    e.created_at,
    c.combined_score as score
  from combined c
  join embeddings e on c.eid = e.id
  order by c.combined_score desc
  limit match_count;
$$;


-- Semantic Duplicate Finder (for memory dedup)
create or replace function public.find_similar_memory(
  target_user_id uuid,
  query_embedding vector(1024),
  similarity_threshold float default 0.92
)
returns table (
  id uuid,
  content text,
  confidence float,
  similarity float
)
language sql stable
as $$
  select
    mem.id,
    mem.content,
    mem.confidence,
    1 - (emb.embedding <=> query_embedding) as similarity
  from public.memories mem
  join public.embeddings emb
    on emb.source_id = mem.id
    and emb.source_type = 'fact'
  where mem.user_id = target_user_id
    and mem.is_active = true
    and 1 - (emb.embedding <=> query_embedding) > similarity_threshold
  order by similarity desc
  limit 3;
$$;


-- Conversation Fingerprint Search
-- Uses 256-dim truncated vectors for fast coarse-grained filtering
create or replace function public.search_similar_conversations(
  query_embedding_256 vector(256),
  target_user_id uuid,
  match_count int default 3
)
returns table (
  id uuid,
  title text,
  topic text,
  similarity float,
  message_count int
)
language sql stable
as $$
  select
    c.id,
    c.title,
    c.topic,
    1 - (c.fingerprint <=> query_embedding_256) as similarity,
    c.message_count
  from public.conversations c
  where c.user_id = target_user_id
    and c.fingerprint is not null
  order by c.fingerprint <=> query_embedding_256
  limit match_count;
$$;


-- Memory Cleanup (V4)
-- Run nightly via Edge Function scheduler or Supabase cron
create or replace function public.cleanup_memories_v4(target_user_id uuid)
returns void as $$
begin
  -- 1. Remove exact text duplicates (keep the newest one)
  delete from public.memories a
  using public.memories b
  where a.user_id = target_user_id
    and b.user_id = target_user_id
    and a.content = b.content
    and a.type = b.type
    and a.created_at < b.created_at;

  -- 2. Decay confidence of old active memories (~10%/month)
  -- Anti-memories and rejections never decay
  update public.memories
  set confidence = greatest(confidence * 0.97, 0.1)
  where user_id = target_user_id
    and created_at < now() - interval '30 days'
    and is_active = true
    and type not in ('anti_memory', 'rejection', 'correction');

  -- 3. Expire memories past their valid_until date
  update public.memories
  set is_active = false
  where user_id = target_user_id
    and valid_until is not null
    and valid_until < now()
    and is_active = true;

  -- 4. Delete inactive low-confidence memories older than 90 days
  delete from public.memories
  where user_id = target_user_id
    and is_active = false
    and confidence < 0.15
    and created_at < now() - interval '90 days';

  -- 5. Delete active but very stale low-confidence memories
  delete from public.memories
  where user_id = target_user_id
    and is_active = true
    and confidence < 0.15
    and created_at < now() - interval '90 days'
    and type not in ('anti_memory', 'rejection', 'correction');

  -- 6. Cap at 200 active memories per user (keep highest confidence)
  with ranked as (
    select id,
      row_number() over (
        order by
          case when type in ('anti_memory', 'rejection', 'correction') then 0 else 1 end,
          confidence desc,
          created_at desc
      ) as rn
    from public.memories
    where user_id = target_user_id
      and is_active = true
  )
  update public.memories
  set is_active = false
  where id in (
    select id from ranked where rn > 200
  );

  -- 7. Clean up orphaned embeddings (fact/anti_memory whose memory was deleted)
  delete from public.embeddings
  where user_id = target_user_id
    and source_type in ('fact', 'anti_memory')
    and source_id is not null
    and not exists (
      select 1 from public.memories
      where memories.id = embeddings.source_id
    );
end;
$$ language plpgsql security definer;


-- Memory Stats Helper (for debugging / monitoring)
create or replace function public.get_user_memory_stats(target_user_id uuid)
returns table (
  active_count bigint,
  inactive_count bigint,
  total_count bigint,
  avg_confidence float
)
language sql stable
as $$
  select
    count(*) filter (where is_active = true),
    count(*) filter (where is_active = false),
    count(*),
    avg(confidence)::float
  from public.memories
  where user_id = target_user_id;
$$;


-- Embedding Stats per Conversation (for debugging)
create or replace function public.get_conversation_embedding_stats(
  target_conversation_id uuid
)
returns table (
  source_type text,
  embedding_count bigint,
  avg_embedding_norm float
)
language sql stable
as $$
  select
    e.source_type,
    count(*),
    avg(vector_norm(e.embedding))::float
  from public.embeddings e
  where (e.metadata->>'conversation_id') = target_conversation_id::text
  group by e.source_type
  order by count(*) desc;
$$;


-- ============================================================
-- REALTIME
-- ============================================================
-- Supabase manages realtime via publication membership only.
-- No custom triggers needed — just add tables to the publication.
-- Supabase Dashboard > Database > Replication will show these.

do $$
begin
  -- Only add if not already a member (prevents errors on re-run)
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'messages'
  ) then
    alter publication supabase_realtime add table public.messages;
  end if;

  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'conversations'
  ) then
    alter publication supabase_realtime add table public.conversations;
  end if;

  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'folders'
  ) then
    alter publication supabase_realtime add table public.folders;
  end if;
end;
$$;


-- ============================================================
-- VERIFICATION
-- Run these after the migration to confirm everything was created
-- ============================================================

-- Check V4 conversations columns
select 'conversations columns' as check_type, column_name, data_type
from information_schema.columns
where table_schema = 'public'
  and table_name = 'conversations'
  and column_name in (
    'working_memory', 'document_registry', 'fingerprint',
    'structured_summary', 'gemini_cache_name',
    'key_entities', 'key_topics'
  );

-- Check V4 memories columns
select 'memories columns' as check_type, column_name, data_type
from information_schema.columns
where table_schema = 'public'
  and table_name = 'memories'
  and column_name in ('is_active', 'valid_until', 'invalidated_by');

-- Check all V4 functions exist
select 'functions' as check_type, routine_name
from information_schema.routines
where routine_schema = 'public'
  and routine_name in (
    'hybrid_search',
    'hybrid_search_scoped',
    'find_similar_memory',
    'search_similar_conversations',
    'cleanup_memories_v4',
    'get_user_memory_stats',
    'get_conversation_embedding_stats',
    'handle_new_user',
    'auto_update_conversation',
    'decrement_conversation_count',
    'delete_orphaned_embeddings',
    'delete_conversation_data',
    'reset_daily_message_counts'
  );

-- Check all triggers
select 'triggers' as check_type, tgname, relname as table_name
from pg_trigger t
join pg_class c on t.tgrelid = c.oid
where tgname in (
  'on_auth_user_created',
  'on_message_insert',
  'on_message_delete_update_count',
  'on_message_delete_cleanup_embeddings',
  'on_conversation_delete_cleanup'
);

-- Check realtime publication
select 'realtime' as check_type, tablename
from pg_publication_tables
where pubname = 'supabase_realtime'
  and schemaname = 'public';

-- Check indexes
select 'indexes' as check_type, indexname
from pg_indexes
where schemaname = 'public'
  and indexname like 'idx_%'
order by indexname;


---

## 12. File Structure

```
src/
├── lib/
│   ├── ai/
│   │   ├── classifier.ts              [REWRITTEN — Gemini 2.5 Flash, V4 hints]
│   │   ├── embeddings.ts              [unchanged]
│   │   ├── reranker.ts                [unchanged]
│   │   ├── openai.ts                  [+ prefix caching]
│   │   ├── gemini.ts                  [+ implicit + explicit caching]
│   │   └── glm.ts                     [unchanged]
│   ├── memory/
│   │   ├── invalidation.ts            [NEW — Layer 0]
│   │   ├── rag-pipeline.ts            [REWRITTEN — 8-step pipeline]
│   │   ├── context-assembler.ts       [REWRITTEN — density + temperature]
│   │   ├── rolling-summary.ts         [REWRITTEN — incremental patching]
│   │   ├── document-processor.ts      [NEW — structure-aware chunking]
│   │   ├── working-memory.ts          [NEW]
│   │   ├── anti-memory.ts             [NEW]
│   │   ├── adaptive-weights.ts        [NEW]
│   │   ├── memory-temperature.ts      [NEW]
│   │   ├── conversation-fingerprint.ts [NEW]
│   │   ├── token-density.ts           [NEW]
│   │   ├── query-expander.ts          [NEW — HyDE + multi-query]
│   │   ├── extract-memories.ts        [UPDATED — dedup + anti-memory]
│   │   └── embed-store.ts             [UPDATED — pre-embed support]
│   └── security/
│       └── [unchanged]
├── hooks/
│   └── usePreemptiveContext.ts        [NEW — client-side preload]
├── app/
│   └── api/
│       └── chat/
│           ├── route.ts               [UPDATED — orchestrates all layers]
│           └── preload/
│               └── route.ts           [NEW — preemptive endpoint]
└── supabase/
    ├── migrations/
    │   ├── 001_initial_schema.sql     [V1 — unchanged]
    │   └── 002_memory_v4.sql          [NEW]
    └── functions/
        ├── extract-memories/          [UPDATED — dedup + anti-memory]
        └── cleanup-memories/          [NEW — nightly scheduler]
```

---

## 13. Implementation Order

### Sprint 1: Foundations (Week 1-2)
1. Run migration `002_memory_v4.sql`
2. Implement `invalidation.ts` (Layer 0)
3. Rewrite `classifier.ts` with Gemini 2.5 Flash + V4 hints
4. Implement `adaptive-weights.ts`
5. Implement `memory-temperature.ts`
6. Update `rag-pipeline.ts` with steps 1-8

### Sprint 2: Documents & Summary (Week 3-4)
7. Implement `document-processor.ts` (structure-aware)
8. Install `pdf-parse` + `mammoth`
9. Rewrite `rolling-summary.ts` with incremental patching
10. Implement `working-memory.ts`
11. Update `context-assembler.ts` (stable prefix + density + temperature)

### Sprint 3: Optimizations (Week 5-6)
12. Implement `conversation-fingerprint.ts`
13. Implement `anti-memory.ts`
14. Implement `query-expander.ts` (HyDE + multi-query)
15. Update `extract-memories` Edge Function (dedup + anti-memory)
16. Deploy `cleanup-memories` Edge Function (nightly)

### Sprint 4: Latency & Polish (Week 7)
17. Implement `usePreemptiveContext.ts` hook
18. Create `/api/chat/preload` endpoint
19. Wire Gemini explicit cache for long-document conversations
20. End-to-end testing + Helicone monitoring setup

---

## 14. Cost Impact

| Component | Before (V1) | After (V4) | Delta |
|-----------|------------|-----------|-------|
| Classifier (GLM → Gemini 2.5 Flash) | $8/mo | $3.50/mo | **-$4.50** |
| Document embedding (chunks) | $0 | $2-5/mo | +$3.50 |
| Query expansion (Gemini Flash) | $0 | $3-8/mo | +$5.50 |
| Working memory updates | $0 | $2-4/mo | +$3 |
| Summary patches (smaller outputs) | $6/mo | $2/mo | **-$4** |
| Gemini implicit caching | $0 savings | -$15-25/mo savings | **-$20** |
| Memory extraction dedup (fewer inserts) | $4/mo | $2.50/mo | **-$1.50** |
| Voyage rerank (same volume) | $8/mo | $8/mo | $0 |
| **NET CHANGE** | — | — | **~ -$6 to -$10/mo** |

**The classifier is cheaper, caching saves more than the new features add, and the system gets dramatically smarter.**

Scale assumption: 1K active users × 50 messages/day.

---

## 15. What Improves for the User

| Scenario | V1 Behavior | V4 Behavior |
|----------|------------|-------------|
| Upload document at msg 1, ask at msg 50 | Model has no idea what's in the document | Document chunks retrieved by RAG, registry in system prompt reminds the model the file exists |
| "Forget what I said about X" | Ignored; model keeps using X | Invalidation fires in Layer 0, X marked inactive, anti-memory recorded |
| "The previous solution didn't work" | Model may re-suggest the same thing | Anti-memory ensures the rejected approach is never suggested again |
| "What were we working on?" | Generic summary recall | Working memory returns exact task, phase, open questions |
| Hebrew query about English code | Fuzzy search adds noise | Adaptive weights go semantic-only, cleaner retrieval |
| Long conversation with 200+ messages | Early messages lost forever | Incremental summary preserves all decisions; fingerprint filters to relevant segments |
| "Continue the function we wrote" | RAG might miss the function | Pre-embedding + query expansion surface the exact code, boosted to HOT temperature |
| Perceived latency | ~1200ms for complex queries | ~700-800ms thanks to preemptive loading + caching |

---

## Appendix: Quick Reference — The 12 V4 Innovations

1. **Pre-embedding** — current message embedded BEFORE search runs
2. **Working Memory** — explicit task/phase tracking on the conversation
3. **Anti-Memory** — rejected approaches stored as negative memory
4. **Memory Invalidation** — Layer 0 regex catches "forget that" before RAG
5. **Adaptive Search Weights** — weights change per query type and language
6. **Memory Temperature** — HOT/WARM/COLD drives injection budget
7. **Incremental Summary Patching** — summary never silently loses info
8. **Structure-Aware Chunking** — no LLM context calls; preserves doc structure
9. **Conversation Fingerprinting** — 256-dim cheap filter narrows search space
10. **Preemptive Context Loading** — compute RAG while user is still typing
11. **Token Density Budgeting** — code > prose > chitchat in context allocation
12. **Gemini 2.5 Flash Classifier** — cheaper, faster, smarter router with V4 hints

---

**End of V4 blueprint.** This document replaces all prior memory system specs. Implementation should follow the Sprint order in Section 13.
