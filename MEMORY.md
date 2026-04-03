# MultiChat AI — 7-Layer Memory System

## Architecture Overview

```
User Message
    │
    ▼
┌─────────────────────────────────────────────┐
│  Layer 1: Intent Classifier (classifier.ts) │
│  • Analyzes: complexity, language, intent    │
│  • Decides: needsRAG? needsInternet?        │
│  • Routes: to correct model variant          │
└──────────────┬──────────────────────────────┘
               │
               │  needsRAG = true?
               ▼
┌─────────────────────────────────────────────┐
│  Layer 2: RAG Pipeline (rag-pipeline.ts)    │
│  • Generates embedding via Voyage AI        │
│  • Hybrid search: vector + FTS + fuzzy      │
│  • Voyage AI Reranking (MANDATORY)          │
│  • Returns: formatted relevant context       │
└──────────────┬──────────────────────────────┘
               │
               ▼
┌─────────────────────────────────────────────┐
│  Layer 3: Context Assembler                 │
│            (context-assembler.ts)           │
│  • System prompt + user profile             │
│  • Rolling summary (Layer 6)                │
│  • RAG context (Layer 2)                    │
│  • Last 5 messages ONLY (direct history)    │
│  • Token budget enforcement                 │
└──────────────┬──────────────────────────────┘
               │
               ▼
┌─────────────────────────────────────────────┐
│  Layer 4: Generation (Streaming)            │
│  • GPT 5.1 / gpt-5-mini (OpenAI)           │
│  • Gemini 3.1 Pro / 3 Flash (Google)        │
│  • GLM 4.7 / 4.6 (Zhipu)                   │
│  • SSE streaming with heartbeat             │
└──────────────┬──────────────────────────────┘
               │
               ▼
┌─────────────────────────────────────────────┐
│  Layer 5: Post-Processing                   │
│  • Save assistant message to DB             │
│  • Embed assistant message (embed-store.ts) │
│  • Extract memories every 5 msgs            │
│            (extract-memories.ts)            │
│  • Usage logging                            │
│  • Auto-generate title (first message)      │
└──────────────┬──────────────────────────────┘
               │
               ▼
┌─────────────────────────────────────────────┐
│  Layer 6: Rolling Summary                   │
│            (rolling-summary.ts)             │
│  • Generated every 10 messages              │
│  • Compressed conversation overview          │
│  • Injected as pseudo-message in context    │
└─────────────────────────────────────────────┘
               │
               ▼
┌─────────────────────────────────────────────┐
│  Layer 7: Storage (Supabase)                │
│  • messages table — full conversation       │
│  • embeddings table — vector + FTS index    │
│  • memories table — extracted user facts    │
│  • conversations table — summary, metadata  │
└─────────────────────────────────────────────┘
```

---

## How Each Layer Works

### Layer 1 — Intent Classifier (`src/lib/ai/classifier.ts`)

**What it does:** Classifies the user's message before any processing begins.

**How it works:**
1. Fast-path checks (regex) for: image generation, web search, greetings
2. If not fast-path → calls Gemini 2.5 Flash with structured JSON output
3. Returns: `intent`, `complexity`, `needsRAG`, `needsInternet`, `routeOverride`, `language`

**Key decision — `needsRAG`:**
- `true` for: explanations, complex code, analysis, follow-up questions referencing past context
- `false` for: greetings, simple factual, image gen, web search

**Complexity routing:**
- `low` → downgrade model (e.g., GPT 5.1 → gpt-5-mini) — saves cost
- `high` → upgrade model (e.g., gpt-5-mini → GPT 5.1) — better quality
- `medium` → keep user's selected model

---

### Layer 2 — RAG Pipeline (`src/lib/memory/rag-pipeline.ts`)

**What it does:** Retrieves relevant past context when the classifier says `needsRAG = true`.

**Why it matters:** Since we only send the last 5 messages as direct context, RAG is the **primary way** to access older conversation history. Without RAG, message #100 wouldn't know about message #5.

**How it works (step by step):**

```
User query: "מה הקוד שכתבנו קודם לפונקציית המיון?"
                    │
                    ▼
    ┌───────────────────────────────┐
    │ 1. Generate Embedding         │
    │    Voyage AI voyage-4-large   │
    │    → 1024-dim vector          │
    │    (fallback: OpenAI)         │
    └───────────┬───────────────────┘
                │
                ▼
    ┌───────────────────────────────┐
    │ 2. Hybrid Search (Supabase)   │
    │    RPC: hybrid_search()       │
    │                               │
    │  ┌─ pgvector (semantic)       │
    │  │  cosine similarity         │
    │  │  weight: 1.5x              │
    │  │                            │
    │  ├─ tsvector (full-text)      │
    │  │  keyword matching          │
    │  │  weight: 1.0x              │
    │  │                            │
    │  └─ pg_trgm (fuzzy)          │
    │     trigram similarity         │
    │     weight: 0.5x              │
    │                               │
    │  Combined via RRF (Reciprocal │
    │  Rank Fusion) → top 24        │
    └───────────┬───────────────────┘
                │
                ▼
    ┌───────────────────────────────┐
    │ 3. Conversation Boost         │
    │    Same-conversation results   │
    │    get "[Current conversation]"│
    │    prefix → reranker sees     │
    │    them as more relevant      │
    └───────────┬───────────────────┘
                │
                ▼
    ┌───────────────────────────────┐
    │ 4. Voyage AI Reranking        │
    │    Model: rerank-2.5          │
    │    24 candidates → top 8      │
    │    Cross-encoder accuracy     │
    │    +30-40% relevance boost    │
    └───────────┬───────────────────┘
                │
                ▼
    ┌───────────────────────────────┐
    │ 5. Format & Group             │
    │                               │
    │  📌 Earlier in this convo:    │
    │     [2h ago] sorting code...  │
    │                               │
    │  🧠 Known facts about user:   │
    │     • Senior dev, knows Python│
    │                               │
    │  📚 From past conversations:  │
    │     [3d ago] similar sort...  │
    └───────────────────────────────┘
```

---

### Layer 3 — Context Assembler (`src/lib/memory/context-assembler.ts`)

**What it does:** Builds the final prompt from 3 sources:

| Source | Purpose | Token Budget |
|--------|---------|-------------|
| Rolling Summary (Layer 6) | High-level conversation overview | Part of history budget |
| RAG Context (Layer 2) | Relevant older messages + facts | `rag` budget (2K-8K) |
| Last 5 Messages | Immediate conversation flow | `history` budget (4K-16K) |

**Token budgets by model:**
| Model | System | RAG | History | Output |
|-------|--------|-----|---------|--------|
| GPT 5.1 | 2000 | 4000 | 6000 | 4000 |
| Gemini 3.1 Pro | 2000 | 8000 | 16000 | 8000 |
| GLM 4.7 | 2000 | 4000 | 8000 | 4000 |

---

### Layer 4 — Generation (Streaming)

**What it does:** Sends the assembled context to the selected AI model and streams the response via SSE.

**Models available:**
- **OpenAI:** GPT 5.1 (strong) / gpt-5-mini (fast)
- **Google:** Gemini 3.1 Pro (strong) / Gemini 3 Flash (fast, also handles vision + web search)
- **Zhipu:** GLM 4.7 (strong) / GLM 4.6 (fast)

---

### Layer 5 — Post-Processing (`src/lib/memory/extract-memories.ts`, `embed-store.ts`)

**What it does (after each response):**
1. **Save message** to `messages` table
2. **Embed message** → `embeddings` table (enables future RAG retrieval)
3. **Extract memories** (every 5 messages) → `memories` table
   - Uses Gemini 2.0 Flash to extract: facts, preferences, goals, skills, opinions
4. **Log usage** → `usage_logs` table

**Embedding flow:**
```
Message text → Voyage AI voyage-4-large → 1024-dim vector → embeddings table
                (fallback: OpenAI text-embedding-3-large)
```

---

### Layer 6 — Rolling Summary (`src/lib/memory/rolling-summary.ts`)

**What it does:** Creates a compressed summary of the conversation every 10 messages.

**How it works:**
1. Takes the previous summary + last 5 messages + latest exchange
2. Calls Gemini 2.0 Flash to generate updated summary (< 500 words)
3. Stored in `conversations.summary`
4. Injected by Context Assembler as a pseudo-message pair at the start

**Why it matters:** Provides high-level continuity that RAG can't — RAG finds specific relevant fragments, but the rolling summary gives the overall narrative arc.

---

### Layer 7 — Storage (Supabase)

**Tables:**
| Table | Purpose |
|-------|---------|
| `messages` | Full conversation history (all messages ever sent) |
| `embeddings` | Vector embeddings for RAG search (1024-dim, pgvector) |
| `memories` | Extracted user facts/preferences/goals |
| `conversations` | Metadata: title, summary, model, topic |
| `users` | User profile, preferences, limits |
| `user_entities` | Knowledge graph (entities + relations) |

**Search indexes on `embeddings`:**
- `embedding` column → pgvector index (cosine similarity)
- `fts` column → tsvector index (full-text search)
- `content` column → pg_trgm index (fuzzy matching)

---

## End-to-End Flow: From Embedding to Answer

```
   ┌─ User sends message #100 ─────────────────────────────┐
   │                                                         │
   │  Direct context: messages #96-#100 (last 5 only!)       │
   │                                                         │
   │  But user asks: "remember the sorting function           │
   │  we discussed earlier?"                                  │
   │                                                         │
   │  ┌─ Layer 1: Classifier ─────────────────────┐          │
   │  │  needsRAG = true (references past context) │          │
   │  └────────────────────────────────────────────┘          │
   │                                                         │
   │  ┌─ Layer 2: RAG Pipeline ───────────────────┐          │
   │  │  1. Embed "sorting function we discussed"  │          │
   │  │  2. Hybrid search finds message #23 where  │          │
   │  │     user discussed sorting algorithms       │          │
   │  │  3. Also finds memory: "user prefers        │          │
   │  │     quicksort over mergesort"               │          │
   │  │  4. Reranker picks the best 8 results       │          │
   │  └────────────────────────────────────────────┘          │
   │                                                         │
   │  ┌─ Layer 3: Context Assembly ───────────────┐          │
   │  │  System prompt:                            │          │
   │  │    + User profile                          │          │
   │  │    + RAG: message #23 + sorting memory     │          │
   │  │  Messages:                                 │          │
   │  │    + Rolling summary (conversation arc)    │          │
   │  │    + Messages #96-#100 (recent context)    │          │
   │  │    + Message #100 (current question)       │          │
   │  └────────────────────────────────────────────┘          │
   │                                                         │
   │  ┌─ Layer 4: AI generates response ──────────┐          │
   │  │  "Yes! Earlier we wrote a quicksort        │          │
   │  │   function in Python. Here's the code..."  │          │
   │  └────────────────────────────────────────────┘          │
   │                                                         │
   │  ┌─ Layer 5: Post-Processing ────────────────┐          │
   │  │  • Save response as message #101           │          │
   │  │  • Embed both #100 and #101 for future RAG │          │
   │  │  • Extract memories if milestone reached   │          │
   │  └────────────────────────────────────────────┘          │
   │                                                         │
   │  Result: AI accurately recalls message #23              │
   │  despite only having messages #96-#100 in context!      │
   └─────────────────────────────────────────────────────────┘
```

## Cost Efficiency

**Before (all messages as context):**
- Message #100 sends ~100 messages → ~50K tokens input per request
- RAG is redundant (context already has everything)
- Cost grows linearly with conversation length

**After (5-message window + RAG):**
- Message #100 sends 5 messages + RAG results → ~3K-5K tokens input
- RAG only activates when needed (classifier decides)
- Cost stays flat regardless of conversation length
- Embedding cost: ~$0.001 per message (one-time)
- Reranking cost: ~$0.002 per RAG query
