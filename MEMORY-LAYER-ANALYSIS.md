# MultiChat AI - Memory Layer: Full Technical Analysis

## Table of Contents

1. [Architecture Overview](#architecture-overview)
2. [Complete Data Flow: Input to Output](#complete-data-flow-input-to-output)
3. [Attachment Processing (Pre-Layer)](#attachment-processing-pre-layer)
4. [Layer 0: Memory Invalidation](#layer-0-memory-invalidation)
5. [Layer 1: Classification & Routing](#layer-1-classification--routing)
6. [Layer 2: RAG Pipeline (9 Steps)](#layer-2-rag-pipeline-9-steps)
7. [Layer 3: Context Assembly](#layer-3-context-assembly)
8. [Layer 4: Generation (Streaming)](#layer-4-generation-streaming)
9. [Layer 5: Post-Processing](#layer-5-post-processing)
10. [Supporting Services](#supporting-services)
11. [Database Schema](#database-schema)
12. [Scenarios](#scenarios)
13. [Error Handling & Resilience](#error-handling--resilience-summary)
14. [Gaps, Edge Cases & Missing Features](#gaps-edge-cases--missing-features)

---

## Architecture Overview

```
USER INPUT (+ attachments)
    │
    ▼
┌──────────────────────────────────────────────────────────────┐
│  Pre-Layer: Attachment Processing                            │
│  PDF → Gemini Vision (vision-extract.ts) + pdf-parse fallback│
│  DOCX → mammoth | XLSX → SheetJS | PPTX → JSZip             │
│  Images → inlineData for Gemini                              │
│  All files → Supabase Storage upload                         │
└──────────────────────────────────────────────────────────────┘
    │
    ▼
┌──────────────────────────────────────────────────────────────┐
│  Layer 0: Memory Invalidation (fire & forget)                │
│  invalidation.ts — "forget that" / "that's wrong"            │
└──────────────────────────────────────────────────────────────┘
    │
    ▼
┌──────────────────────────────────────────────────────────────┐
│  Layer 1: Classification & Routing                           │
│  classifier.ts → intent, language, complexity, RAG needs     │
└──────────────────────────────────────────────────────────────┘
    │
    ▼
┌──────────────────────────────────────────────────────────────┐
│  Layer 2: RAG Pipeline (rag-pipeline.ts) — 9 Steps           │
│  ┌─────────┐ ┌──────────┐ ┌────────────┐ ┌──────────────┐   │
│  │Pre-embed│→│Query     │→│Fingerprint │→│Hybrid Search │   │
│  │ Step 1  │ │Expand S2 │ │Filter S3   │ │  Step 4      │   │
│  └─────────┘ └──────────┘ └────────────┘ └──────────────┘   │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────────┐   │
│  │Remove   │→│Temp      │→│Rerank    │→│Filter Active │   │
│  │Self S5  │ │Assign S6 │ │  Step 7  │ │  Step 8      │   │
│  └──────────┘ └──────────┘ └──────────┘ └──────────────┘   │
│  ┌──────────────────┐                                        │
│  │Document Chunks S9│                                        │
│  └──────────────────┘                                        │
└──────────────────────────────────────────────────────────────┘
    │
    ▼
┌──────────────────────────────────────────────────────────────┐
│  Layer 3: Context Assembly (context-assembler.ts)             │
│  Stable Prefix (system + profile + WM + summary)             │
│  Variable Suffix (HOT/WARM/COLD + recent msgs + current)     │
└──────────────────────────────────────────────────────────────┘
    │
    ▼
┌──────────────────────────────────────────────────────────────┐
│  Layer 4: Generation — Stream response (SSE)                 │
└──────────────────────────────────────────────────────────────┘
    │
    ▼
┌──────────────────────────────────────────────────────────────┐
│  Layer 5: Post-Processing (fire & forget, 10 tasks)          │
│  embed, summary, working memory, extract, anti-memory, etc.  │
└──────────────────────────────────────────────────────────────┘
    │
    ▼
OUTPUT (SSE stream to client)
```

### Files in the Memory Layer

| File | Role | LLM Used |
|------|------|----------|
| `rag-pipeline.ts` | Core 9-step RAG pipeline | - |
| `context-assembler.ts` | Builds final prompt with token budgets | - |
| `query-expander.ts` | HyDE + multi-query expansion | Gemini 2.5 Flash |
| `adaptive-weights.ts` | Adjusts search weights per query type | - |
| `memory-temperature.ts` | HOT/WARM/COLD classification | - |
| `conversation-fingerprint.ts` | 256-dim fast pre-filtering | - |
| `extract-memories.ts` | Extracts user facts from conversation | Gemini 2.5 Flash |
| `rolling-summary.ts` | Incremental summary patching | Gemini 2.5 Flash |
| `working-memory.ts` | Tracks current task/phase | Gemini 2.5 Flash |
| `anti-memory.ts` | Stores rejected suggestions | Gemini 2.5 Flash |
| `invalidation.ts` | Catches "forget that" commands | - |
| `embed-store.ts` | Stores embeddings in Supabase | - |
| `document-processor.ts` | Structure-aware document chunking | - |
| `token-density.ts` | Scores content density for prioritization | - |
| `vision-extract.ts` | Vision-based PDF/image content extraction | Gemini 2.5 Flash |

### External Services

| Service | Purpose | Model |
|---------|---------|-------|
| **Voyage AI** | Embedding generation (primary) | `voyage-4-large` (1024 dims) |
| **OpenAI** | Embedding generation (fallback) | `text-embedding-3-large` (1024 dims) |
| **Voyage AI** | Reranking search results | `rerank-2.5` |
| **Gemini** | Query expansion, memory extraction, summaries, working memory, anti-memory | `gemini-2.5-flash` |
| **Gemini** | Vision-based document extraction (PDFs, images) | `gemini-2.5-flash` |
| **Supabase** | Vector DB, PostgreSQL RPC functions, storage | pgvector + HNSW |

---

## Complete Data Flow: Input to Output

### What Happens When User Sends a Message

```
User types: "תזכיר לי מה החלטנו על ארכיטקטורת הAPI"
(Remind me what we decided about the API architecture)
```

**1. API Route receives POST request** (`/api/chat/route.ts`)
- Validate input with Zod schema
- Check daily message limit
- Process attachments (PDF → Vision-first extraction, DOCX/XLSX/PPTX → text)
- Upload files to Supabase Storage

**2. Layer 0 — Invalidation Check** (fire & forget)
- Regex check: does the message match "forget that" / "שגוי" / "غلط"?
- If yes → mark related embeddings as `is_active: false`
- If no → skip (this message doesn't match)

**3. Layer 1 — Classification**
- Fast paths: detect language (Hebrew via `\u0590-\u05FF`), code markers, doc references
- Gemini Flash classification → `{ intent: "question", language: "he", complexity: "medium", needsRAG: true }`

**4. Layer 2 — RAG Pipeline** (if `needsRAG: true`)
- 9-step retrieval pipeline (detailed below)
- Returns: `{ hot: [...], warm: [...], cold: [...], documentChunks: [...], documentRegistry: [...] }`

**5. Layer 3 — Context Assembly**
- Build system prompt with user profile, working memory, summary
- Inject HOT/WARM/COLD memories by priority
- Trim recent messages to token budget
- Returns: `{ systemPrompt, messages[] }`

**6. Layer 4 — Generation**
- Send assembled context to model (GPT-5.1 / Gemini 3.1 Pro / GLM-4.7)
- Stream response via SSE to client
- Heartbeat every 15s to keep connection alive

**7. Layer 5 — Post-Processing** (fire & forget, doesn't block response)
- Save message to DB
- Promote temp embedding
- Embed assistant response
- Update rolling summary (every 8 messages)
- Update working memory (every 3 messages)
- Extract memories (every 5 messages)
- Detect anti-memories
- Update fingerprint (every 20 messages)

---

## Attachment Processing (Pre-Layer)

**Files:** `route.ts` (lines 220-420) + `vision-extract.ts` (NEW)

### Supported File Types & Extraction Methods

| File Type | Primary Method | Fallback | What It Extracts |
|-----------|---------------|----------|------------------|
| PDF (`.pdf`) | **Gemini Vision** (`vision-extract.ts`) | `pdf-parse-new` (if Vision < 50 chars) | Text + images + diagrams + tables + handwriting |
| DOCX (`.docx`) | `mammoth` | - | Raw text only (no images) |
| XLSX/XLS (`.xlsx`) | `xlsx` (SheetJS) | - | Cell data as CSV (up to 5 sheets) |
| CSV (`.csv`) | Native `Buffer` | - | Raw UTF-8 text |
| PPTX (`.pptx`) | `JSZip` | - | Text from `<a:t>` XML tags only (no images/shapes) |
| Text/JSON/XML | Native `Buffer` | - | Raw UTF-8 text |
| Images (`.png/.jpg`) | Passed as `inlineData` to Gemini | - | Gemini sees it visually (NOT embedded for RAG) |
| Unknown binary | Heuristic check | - | If <10% non-printable chars → treat as text |

### Vision-Based Document Extraction (NEW)

**File:** `vision-extract.ts`
**Model:** Gemini 2.5 Flash (multimodal)
**Max output:** 16,384 tokens

```
PDF attachment (base64)
        │
        ▼
┌──────────────────────────────────────────────────┐
│  PRIMARY: Gemini Vision (extractWithVision)       │
│                                                    │
│  Sends raw PDF bytes as inlineData to Gemini.      │
│  Gemini "sees" every page visually and extracts:   │
│  - All text (preserving formatting)                │
│  - Images/diagrams → [IMAGE: description]          │
│  - Tables → markdown tables                        │
│  - Handwriting → [HANDWRITTEN: transcription]      │
│  - Equations → LaTeX notation                      │
│  - Page separators (--- Page X ---)                │
│  - Supports Hebrew, Arabic, etc. natively          │
│                                                    │
│  Config: temperature=0, maxOutputTokens=16384      │
└────────────────┬─────────────────────────────────┘
                 │
                 ▼
         Vision returned < 50 chars?
         ├── No ──► Use Vision text ──► processDocument() → chunk → embed
         │
         └── Yes ──► FALLBACK: pdf-parse-new (traditional text extraction)
                     └── Use whichever is longer ──► processDocument() → chunk → embed
```

**Supported MIME types for Vision:**
- `application/pdf`
- `image/png`
- `image/jpeg`
- `image/webp`
- `image/gif`

**What Vision captures that text extraction misses:**
- Scanned PDF pages (image-only) → now fully readable
- Diagrams and charts → described in `[IMAGE: ...]` tags
- Handwritten notes → transcribed in `[HANDWRITTEN: ...]` tags
- Tables with complex formatting → reproduced as markdown
- Mixed text + image pages → both extracted in reading order

### Processing Pipeline

```
Attachment received (base64)
        │
        ├── Upload to Supabase Storage → get public URL
        │
        ├── Is it an image? ──Yes──► Pass as inlineData to Gemini Vision
        │                            (NOT processed through document-processor)
        │                            (NOT embedded or stored in vector DB)
        │
        ├── Is it a PDF? ──Yes──► Vision-first extraction (Gemini 2.5 Flash)
        │                         ├── If Vision < 50 chars → fallback to pdf-parse-new
        │                         └── processDocument() → chunk → embed
        │
        ├── Is it DOCX? ──Yes──► mammoth.extractRawText()
        │                        └── processDocument() → chunk → embed
        │
        ├── Is it XLSX/CSV? ──Yes──► XLSX.utils.sheet_to_csv()
        │                            └── processDocument() → chunk → embed
        │
        ├── Is it PPTX? ──Yes──► JSZip → extract <a:t> tags
        │                         └── processDocument() → chunk → embed
        │
        └── Unknown ──► Try UTF-8, check if text-like
                        └── processDocument() → chunk → embed
```

### Remaining Gaps

| Scenario | Status | Notes |
|----------|--------|-------|
| PDF with scanned pages | **SOLVED** | Gemini Vision reads them visually |
| PDF with mixed text + images | **SOLVED** | Vision extracts both in reading order |
| PDF with diagrams/charts | **SOLVED** | Vision describes them in `[IMAGE: ...]` tags |
| DOCX with embedded images | **Still a gap** | `mammoth.extractRawText()` skips images — no Vision fallback for DOCX |
| PPTX with images/diagrams | **Still a gap** | Only `<a:t>` text tags extracted — no Vision fallback for PPTX |
| XLSX with chart images | **Still a gap** | Only cell data extracted as CSV |
| Standalone image files (.png/.jpg) | **Partial** | Gemini sees it in current message via `inlineData`, but NOT embedded for future RAG retrieval |

---

## Layer 0: Memory Invalidation

**File:** `invalidation.ts`
**When:** BEFORE any search runs
**Tools:** Regex patterns + Supabase

### How It Works

```
User says: "forget what I said about React"
                │
                ▼
     ┌─────────────────────┐
     │ Regex pattern match  │ ← EN/HE/AR patterns
     │ "forget|תשכח|انسى"   │
     └─────────┬───────────┘
               │ Match found
               ▼
     ┌─────────────────────┐
     │ Find last 3 assistant│
     │ messages in this     │
     │ conversation         │
     └─────────┬───────────┘
               │
               ▼
     ┌─────────────────────┐
     │ Mark their embeddings│
     │ is_active: false     │
     └─────────┬───────────┘
               │
               ▼
     ┌─────────────────────┐
     │ Create anti-memory   │
     │ + embed it for RAG   │
     └─────────────────────┘
```

**Patterns detected (3 languages):**
- English: `forget that`, `that's wrong`, `scratch that`, `nevermind`
- Hebrew: `תשכח`, `תתעלם`, `זה לא נכון`, `הפתרון הקודם לא עבד`
- Arabic: `انسى`, `تجاهل`, `مش مهم`

---

## Layer 2: RAG Pipeline (9 Steps)

**File:** `rag-pipeline.ts`
**Function:** `retrieveMemories()`

### Step 1: Pre-Embed Current Message

```typescript
// Generate embedding IMMEDIATELY for the user's message
const currentMessageEmbedding = await generateEmbedding(message);

// Store as temporary (will be filtered out in Step 5)
await supabase.from('embeddings').insert({
  source_type: 'message',
  content: message.slice(0, 8000),
  embedding: currentMessageEmbedding,
  metadata: { is_current_message: true },
});
```

**Why pre-embed?** The embedding is needed for:
- Fingerprint search (Step 3)
- Hybrid search (Step 4)
- Document chunk retrieval (Step 9)

By generating it once and reusing, we avoid duplicate API calls.

**Tool:** Voyage AI `voyage-4-large` → 1024-dim vector
**Fallback:** OpenAI `text-embedding-3-large` → 1024-dim vector
**Last resort:** Zero vector (1024 zeros)

---

### Step 2: Query Expansion (HyDE + Multi-Query)

**File:** `query-expander.ts`

```
Original: "what did we decide about the API?"
                    │
                    ▼ Gemini 2.5 Flash
    ┌───────────────────────────────────┐
    │ Generate 3 alternative queries:   │
    │ 1. HyDE: "We decided to use REST  │
    │    with versioned endpoints..."   │
    │ 2. Rephrase: "API architecture    │
    │    decisions and choices"         │
    │ 3. Broader: "system design and    │
    │    technical decisions"           │
    └───────────────────────────────────┘
                    │
                    ▼
    Result: [original, hyde, rephrase, broader]
            = 4 queries total
```

**Skip condition:** Messages < 20 characters skip expansion (just use original)

**Language support:** Gemini is instructed to expand in the same language as the query

**Why?** A single query might miss semantically related content. HyDE is especially powerful — by generating what the *answer* might look like, we can find documents that contain the answer even if they use completely different words.

---

### Step 3: Conversation Fingerprint Filter

**File:** `conversation-fingerprint.ts`

```
Query embedding (1024 dims)
        │
        ▼ Truncate to 256 dims
        │
        ▼ search_similar_conversations() RPC
        │
        ▼ Cosine similarity on 256-dim vectors
        │
    ┌───────────────────────────────────┐
    │ Return top 10 conversation IDs    │
    │ + always include current convo    │
    └───────────────────────────────────┘
```

**Why 256 dims?** Full 1024-dim search on every conversation is expensive. 256-dim truncated vectors give us fast coarse filtering — we narrow from potentially hundreds of conversations to ~10, then do the expensive hybrid search only within those.

**Fallback:** If fingerprint search fails → search ALL conversations (no filtering)

---

### Step 4: Hybrid Search with Adaptive Weights

**File:** `adaptive-weights.ts`

Three search methods combined via **Reciprocal Rank Fusion (RRF)**:

```
┌──────────────────────────────────────────────────────────┐
│                    HYBRID SEARCH                          │
│                                                           │
│  ┌────────────┐  ┌────────────┐  ┌────────────┐         │
│  │ Full-Text   │  │ Semantic   │  │   Fuzzy    │         │
│  │ Search      │  │ (Vector)   │  │ (Trigram)  │         │
│  │ tsvector    │  │ pgvector   │  │ pg_trgm    │         │
│  │ GIN index   │  │ HNSW index │  │ GIN index  │         │
│  └──────┬─────┘  └──────┬─────┘  └──────┬─────┘         │
│         │               │               │                │
│         ▼               ▼               ▼                │
│  ┌─────────────────────────────────────────────┐         │
│  │         Reciprocal Rank Fusion (RRF)        │         │
│  │   score = Σ (weight / (60 + rank_i))        │         │
│  └─────────────────────────────────────────────┘         │
└──────────────────────────────────────────────────────────┘
```

**Adaptive weights by context:**

| Context | Full-Text | Semantic | Fuzzy |
|---------|-----------|----------|-------|
| Hebrew/Arabic/Mixed | 0.3 | **2.0** | 0.0 |
| Code with markers | 1.2 | 1.0 | **1.5** |
| Question/Analysis | 0.8 | **2.0** | 0.3 |
| Creative | 1.0 | 1.5 | 0.5 |
| Default | 1.0 | 1.5 | 0.5 |

**Why Hebrew/Arabic disable fuzzy?** Trigram fuzzy matching doesn't work across scripts. Hebrew "ארכיטקטורה" won't fuzzy-match "architecture" — semantic search handles cross-lingual matching instead.

**Scoped vs. Global search:**
- If fingerprint filter returned conversation IDs → use `hybrid_search_scoped()` (search within those convos + global facts/anti_memories)
- If fingerprint failed → use `hybrid_search()` (search all user's data)

**For each of the 4 expanded queries:**
- Generate embedding (reuse pre-embed for original query)
- Run hybrid search
- Keep best score per result ID (Map dedup)
- Candidate pool: `topK × 3` (default: 36 candidates)

---

### Step 5: Remove Current Message

```typescript
if (tempMessageId) {
  allResults.delete(tempMessageId);
}
```

**Why?** Step 1 pre-embedded the current message. Without this filter, the system would return "the user just asked X" as a search result — circular and useless.

---

### Step 6: Assign Memory Temperature

**File:** `memory-temperature.ts`

```
                     Search Result
                          │
              ┌───────────┼───────────────┐
              ▼           ▼               ▼
           ┌─────┐    ┌──────┐       ┌──────┐
           │ HOT │    │ WARM │       │ COLD │
           │ 3.0x│    │ 1.5x │       │ 1.0x │
           └─────┘    └──────┘       └──────┘
```

**HOT (priority 3.0x):**
- Anti-memories (ALWAYS hot — prevent repeating mistakes)
- Current conversation, < 2 hours old
- Document matches when user references documents
- Score > 0.85

**WARM (priority 1.5x):**
- Current conversation, > 2 hours old
- High-confidence facts (confidence > 0.8)
- Score > 0.6

**COLD (priority 1.0x):**
- Everything else that survived search

---

### Step 7: Voyage AI Reranking (MANDATORY)

**File:** `reranker.ts`

```
36 candidates → Voyage rerank-2.5 → top 12
```

**What it does:** Takes the query + all candidate documents, and uses a cross-encoder model to compute a more accurate relevance score than vector similarity alone.

**Why mandatory?** Improves accuracy by 30-40%. The hybrid search is fast but imprecise. Reranking is slower but much more accurate.

**Rate limit handling:** Exponential backoff (1s → 2s → 4s) for 429 errors

**Fallback:** If reranking fails → return original order, sliced to topK

---

### Step 8: Filter Active Only

```typescript
const active = reranked.filter(r => {
  const meta = r.metadata ?? {};
  return meta.is_active !== false;
});
```

**Defense in depth.** The hybrid search should already exclude inactive embeddings, but this is a safety net. Invalidated memories (from Layer 0) have `is_active: false`.

---

### Step 9: Document Chunk Retrieval

```
┌───────────────────────────────────────────┐
│ search_document_chunks() RPC              │
│ PostgreSQL computes vector similarity     │
│ (no embedding transfer to JS)             │
│ Min similarity: 0.2                       │
│ Max results: 8                            │
└───────────────────┬───────────────────────┘
                    │
                    ▼
┌───────────────────────────────────────────┐
│ Fetch neighbor chunks (chunk_index ± 1)   │
│ For reading context continuity            │
└───────────────────┬───────────────────────┘
                    │
                    ▼
┌───────────────────────────────────────────┐
│ Sort by file_name + chunk_index           │
│ (reading order, not relevance order)      │
└───────────────────────────────────────────┘
```

**Triggered when:**
- Document registry has files
- Classification says user references a document
- Any search result has `source_type: 'document'`

**Why separate from main search?** Documents need special handling:
1. They need neighbor chunks for context (±1 chunk)
2. They should be sorted in reading order, not relevance order
3. They get their own section in the context (not mixed with facts/memories)

---

## Layer 3: Context Assembly

**File:** `context-assembler.ts`

### Two-Part Structure

```
┌─────────────────────────────────────────────┐
│         STABLE PREFIX (Cacheable)            │
│  ┌─────────────────────────────────────┐    │
│  │ System prompt (MultiChat AI intro)  │    │
│  │ User profile (name, language, etc.) │    │
│  │ Document registry                   │    │
│  │ Working memory (task, phase)        │    │
│  │ Structured summary (narrative)      │    │
│  └─────────────────────────────────────┘    │
├─────────────────────────────────────────────┤
│         VARIABLE SUFFIX                      │
│  ┌─────────────────────────────────────┐    │
│  │ Document chunks (highest priority)  │    │
│  │ RAG memories (HOT → WARM → COLD)   │    │
│  │ Recent messages (adaptive window)   │    │
│  └─────────────────────────────────────┘    │
└─────────────────────────────────────────────┘
```

### Token Budgets by Model

| Model | System | Stable | HOT | WARM | COLD | Recent | Output |
|-------|--------|--------|-----|------|------|--------|--------|
| gpt-5.1 | 2000 | 3000 | 4000 | 2000 | 1000 | 6000 | 4096 |
| gpt-5-mini | 1500 | 2000 | 2500 | 1500 | 500 | 4000 | 4096 |
| gemini-3.1-pro | 2000 | 4000 | 6000 | 3000 | 2000 | 16000 | 8192 |
| gemini-3-flash | 1500 | 3000 | 4000 | 2000 | 1000 | 8000 | 4096 |
| glm-4.7 | 2000 | 3000 | 4000 | 2000 | 1000 | 6000 | 4096 |
| glm-4.6 | 1500 | 2000 | 2500 | 1500 | 500 | 4000 | 4096 |
| gemini-3.1-flash-image | 1000 | 1500 | 2000 | 1000 | 500 | 4000 | 2000 |

### Density-Aware Prioritization

Within each temperature tier, memories are sorted by:
```
priority = computeDensity(content) × temperatureWeight(temperature) × score
```

Where density scoring is:
- Base: 0.5
- Code blocks (` ``` `): +0.3
- Headers (`#`): +0.1
- Tables (`|...|`): +0.2
- Short messages (<100 chars): -0.2
- Greetings/chitchat: -0.3
- Range: [0.1, 1.0]

### Adaptive Window Size

The number of recent messages included depends on context:

| Condition | Window Size |
|-----------|-------------|
| Chitchat | 2 messages |
| Debugging phase | 8 messages |
| Implementing phase | 6 messages |
| High complexity | 7 messages |
| RAG returned 8+ results | 3 messages |
| Default | 5 messages |

---

## Layer 5: Post-Processing

All tasks run as **fire & forget** (wrapped in `.catch()`) — they don't block the response stream.

| Task | Frequency | Tool | What It Does |
|------|-----------|------|-------------|
| Save message | Every message | Supabase | Insert assistant message to `messages` table |
| Promote temp embed | Every message | Supabase | Set `is_current_message: false` on pre-embed from Step 1 |
| Embed response | Every message | Voyage AI | Generate & store embedding for assistant response |
| Log usage | Every message | Supabase | Record token count + cost |
| Rolling summary | Message 6, then every 8 | Gemini Flash | Incremental JSON patch to structured summary |
| Working memory | Every 3 messages | Gemini Flash | Update task/phase/entities |
| Extract memories | Every 5 messages | Gemini Flash | Pull user facts with semantic dedup (0.92 threshold) |
| Anti-memory | Every message | Gemini Flash | Detect rejection patterns, store what was rejected |
| Fingerprint | Every 20 messages | Voyage AI | Update 256-dim conversation fingerprint |
| Title generation | First message only | Gemini Flash | Auto-generate 3-6 word title |

---

## Supporting Services

### Embedding Generation (`embeddings.ts`)

```
User text (max 8000 chars)
        │
        ▼
┌──────────────────┐     ┌──────────────────┐     ┌──────────┐
│  Voyage AI       │────►│  OpenAI          │────►│  Zero    │
│  voyage-4-large  │fail │  text-embedding- │fail │  Vector  │
│  1024 dims       │     │  3-large (1024)  │     │  1024×0  │
└──────────────────┘     └──────────────────┘     └──────────┘
```

**Rate limiting:**
- Sequential queue: only one request at a time
- 250ms gap between requests
- Exponential backoff: 1s → 2s → 4s for 429/500/502/503

**Batch mode:** Voyage supports 128 texts per request. Used by document processor to avoid N sequential calls.

### Document Processing (`document-processor.ts`)

```
Raw document text
        │
        ▼
┌──────────────────┐
│ Structure-Aware  │
│ Parsing          │
│ ─────────────    │
│ Headings         │
│ Paragraphs       │
│ Code blocks ←── atomic (no split)
│ Tables ←──────── atomic (no split)
│ Lists            │
└────────┬─────────┘
         │
         ▼
┌──────────────────┐
│ Chunking         │
│ max 400 tokens   │
│ + breadcrumbs    │
│ "[Section > Sub] │
│  content..."     │
└────────┬─────────┘
         │
         ▼
┌──────────────────┐
│ Batch Embed      │
│ Voyage AI batch  │
│ (128 per call)   │
└────────┬─────────┘
         │
         ▼
┌──────────────────┐
│ RPC Insert       │
│ insert_document_ │
│ embeddings()     │
│ 40 rows/batch    │
└────────┬─────────┘
         │
         ▼
┌──────────────────┐
│ Update           │
│ document_registry│
│ in conversation  │
└──────────────────┘
```

### Vision-Based Document Extraction (`vision-extract.ts`) — NEW

```
PDF/Image (base64)
        │
        ▼
┌───────────────────────────────────────┐
│  Gemini 2.5 Flash (multimodal)        │
│  Model: gemini-2.5-flash              │
│  maxOutputTokens: 16384               │
│  temperature: 0                       │
│                                        │
│  Input: raw file as inlineData        │
│  Output: markdown with:               │
│  - All text (original language)       │
│  - [IMAGE: description] tags          │
│  - [HANDWRITTEN: transcription] tags  │
│  - Markdown tables                    │
│  - --- Page X --- separators          │
└───────────────────────────────────────┘
```

**Supported formats:** PDF, PNG, JPEG, WebP, GIF
**Fallback for PDFs:** If Vision returns < 50 chars → pdf-parse-new text extraction
**Function:** `extractWithVision(base64Data, mimeType, fileName)`
**Returns:** `{ text: string, pageCount: number }`

### Anti-Memory System (`anti-memory.ts`)

```
User: "that didn't work"
         │
         ▼
  Regex match? ──── No ──→ Skip
         │
        Yes
         │
         ▼
  Gemini Flash: summarize
  { rejected: "...", reason: "...", avoid: "..." }
         │
         ▼
  Store as anti_memory in memories table
         │
         ▼
  Embed for RAG retrieval (always HOT temperature)
```

---

## Database Schema

### embeddings (Vector Store)

```sql
CREATE TABLE embeddings (
  id            BIGSERIAL PRIMARY KEY,
  user_id       UUID REFERENCES profiles(id),
  source_type   TEXT, -- 'message' | 'fact' | 'document' | 'summary' | 'anti_memory'
  source_id     UUID,
  content       TEXT, -- max 8000 chars
  embedding     VECTOR(1024), -- Voyage AI / OpenAI
  fts           TSVECTOR, -- full-text search (auto-generated)
  metadata      JSONB, -- { conversation_id, role, is_active, importance, ... }
  created_at    TIMESTAMPTZ
);

-- Indexes:
-- HNSW on embedding (fast approximate nearest neighbor)
-- GIN on fts (full-text search)
-- GIN on content with pg_trgm (fuzzy/trigram search)
-- B-tree on (user_id, created_at)
```

### memories (Extracted Facts)

```sql
CREATE TABLE memories (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                 UUID REFERENCES profiles(id),
  type                    TEXT, -- fact|preference|goal|skill|opinion|rejection|correction|constraint|anti_memory
  content                 TEXT,
  confidence              FLOAT, -- 0.0 to 1.0
  source_conversation_id  UUID,
  is_active               BOOLEAN DEFAULT true,
  valid_until             TIMESTAMPTZ,
  invalidated_by          UUID, -- self-referential FK
  created_at              TIMESTAMPTZ
);
```

### conversations (V4 Columns)

```sql
-- V4-specific columns added to conversations:
ALTER TABLE conversations ADD COLUMN
  working_memory     JSONB,           -- { current_task, phase, entities, ... }
  document_registry  JSONB[],         -- [{ filename, summary, chunk_count, ... }]
  structured_summary JSONB,           -- { decisions, technical, documents, ... }
  fingerprint        VECTOR(256),     -- truncated conversation embedding
  key_entities       TEXT[],
  key_topics         TEXT[];

-- HNSW index on fingerprint for fast conversation-level search
-- GIN index on key_topics
```

### PostgreSQL RPC Functions

| Function | Purpose |
|----------|---------|
| `hybrid_search` | 3-method search (FTS + semantic + fuzzy) via RRF, all user data |
| `hybrid_search_scoped` | Same but filtered to specific conversation_ids |
| `search_document_chunks` | Vector similarity for document type only |
| `insert_document_embeddings` | Batch insert with vector cast (bypass PostgREST) |
| `find_similar_memory` | Cosine similarity > threshold for dedup |
| `search_similar_conversations` | 256-dim fingerprint cosine similarity |
| `cleanup_memories_v4` | Dedup + confidence decay + expiration |

---

## Scenarios

### Scenario 1: Simple Hebrew Question (First Message in Conversation)

**Input:** `"מה זה React?"`

**Timeline:**

| Step | What Happens | Time | Tool |
|------|-------------|------|------|
| Classification | Fast path: Hebrew detected (`\u0590-\u05FF`), intent: question, needsRAG: true | ~50ms | Regex |
| Layer 0 | No invalidation pattern → skip | ~1ms | Regex |
| Step 1: Pre-embed | Generate 1024-dim vector for "מה זה React?" | ~300ms | Voyage AI |
| Step 2: Query expand | Message < 20 chars → skip, use original only | ~1ms | - |
| Step 3: Fingerprint | First message, no history → returns [current_conv_id] | ~100ms | Supabase RPC |
| Step 4: Hybrid search | Adaptive weights: Hebrew → semantic=2.0, fuzzy=0.0. Search 1 query | ~200ms | Supabase RPC |
| Step 5: Remove self | Filter out temp message | ~1ms | - |
| Step 6: Temperature | Assign HOT/WARM/COLD to results | ~1ms | - |
| Step 7: Rerank | If results > topK → Voyage rerank. Likely few results | ~300ms | Voyage AI |
| Step 8: Filter active | Remove is_active: false | ~1ms | - |
| Step 9: Doc chunks | No documents in conversation → skip | ~1ms | - |
| Context assembly | System prompt + minimal RAG (if any) + current message | ~5ms | - |
| Generation | Stream response in Hebrew | ~2-5s | Gemini/GPT |
| Post-processing | Save message, embed response, no summary yet (message 1) | ~500ms | Background |

**Total RAG time:** ~900ms
**Total time to first token:** ~1.5-2s
**Post-processing:** ~500ms (doesn't block response)

---

### Scenario 2: Code Debugging with Document (Message 15)

**Input:** `"the bug in auth.ts line 42 didn't work with your last fix"`

**Timeline:**

| Step | What Happens | Time | Tool |
|------|-------------|------|------|
| Classification | Code markers detected, intent: code, references document, language: en | ~200ms | Gemini Flash |
| Layer 0 | "didn't work" matches invalidation pattern → mark last 3 assistant embeddings as inactive, create anti-memory | ~400ms | Supabase + Voyage AI |
| Step 1: Pre-embed | Generate embedding for the message | ~300ms | Voyage AI |
| Step 2: Query expand | 3 alternatives generated: HyDE ("The auth.ts bug at line 42 was caused by..."), rephrase, broader | ~500ms | Gemini Flash |
| Step 3: Fingerprint | Find relevant conversations (maybe found prior auth discussion) → 5 conversation IDs | ~150ms | Supabase RPC |
| Step 4: Hybrid search | Weights: code → fuzzy=1.5, fulltext=1.2, semantic=1.0. Run 4 queries × scoped search | ~800ms | Supabase RPC × 4 + Voyage AI × 3 |
| Step 5: Remove self | Filter out temp message | ~1ms | - |
| Step 6: Temperature | Anti-memory → HOT, recent convo results → HOT/WARM, old results → COLD | ~1ms | - |
| Step 7: Rerank | 36 candidates → top 12 | ~400ms | Voyage AI |
| Step 8: Filter active | Remove invalidated embeddings from Layer 0 | ~1ms | - |
| Step 9: Doc chunks | auth.ts referenced → search_document_chunks RPC + neighbor chunks | ~300ms | Supabase RPC × 2 |
| Context assembly | System + working memory (debugging phase) + HOT anti-memory + doc chunks + 8 recent messages | ~10ms | - |
| Generation | Stream response with code fix, aware of what was rejected | ~3-8s | GPT-5.1 |
| Post-processing (msg 15) | Save, embed, working memory update (every 3), extract memories (every 5 = yes), rolling summary (6+every 8 = msg 14, so no) | ~1.5s | Background |

**Total RAG time:** ~2.4s
**Total time to first token:** ~3s
**Post-processing:** ~1.5s (background)

---

### Scenario 3: Long Conversation with Documents (Message 40)

**Input:** `"based on the design document and our earlier decisions, summarize the final architecture"`

**Timeline:**

| Step | What Happens | Time | Tool |
|------|-------------|------|------|
| Classification | intent: analysis, complexity: high, referencesDocument: true, needsRAG: true | ~200ms | Gemini Flash |
| Layer 0 | No invalidation → skip | ~1ms | - |
| Step 1: Pre-embed | Generate embedding | ~300ms | Voyage AI |
| Step 2: Query expand | 3 alternatives: HyDE (hypothetical architecture summary), rephrase, broader | ~500ms | Gemini Flash |
| Step 3: Fingerprint | Well-established fingerprint → find 8 related conversations | ~150ms | Supabase RPC |
| Step 4: Hybrid search | Weights: analysis → semantic=2.0. 4 queries × scoped search | ~1s | Supabase × 4 + Voyage × 3 |
| Step 5-6: Filter + Temp | Remove self, assign temperatures | ~2ms | - |
| Step 7: Rerank | ~48 candidates → top 12 | ~400ms | Voyage AI |
| Step 8: Filter active | Remove inactive | ~1ms | - |
| Step 9: Doc chunks | Document registry has files → search_document_chunks + neighbors | ~400ms | Supabase × 2 |
| Context assembly | Full stable prefix with structured summary (40 messages of context), document chunks, HOT/WARM/COLD, 7 recent messages (high complexity) | ~15ms | - |
| Generation | Long analytical response | ~5-10s | Gemini 3.1 Pro |
| Post-processing (msg 40) | Save, embed, working memory (40%3=yes), extract memories (40%5=yes), rolling summary (msg 6+8n: 6,14,22,30,38,46 → no at 40), fingerprint (40%20=yes!) | ~2s | Background |

**Total RAG time:** ~2.8s
**Total time to first token:** ~3.5s
**Post-processing:** ~2s (background, includes fingerprint update)

---

### Scenario 4: Arabic Chitchat (Message 2)

**Input:** `"شكراً، كيف حالك؟"`

**Timeline:**

| Step | What Happens | Time | Tool |
|------|-------------|------|------|
| Classification | Fast path: Arabic detected, chitchat pattern matched, intent: chitchat, needsRAG: false | ~50ms | Regex |
| Layer 0 | No invalidation → skip | ~1ms | - |
| RAG | **SKIPPED** — `needsRAG: false` for chitchat | 0ms | - |
| Context assembly | System prompt (respond in Arabic) + 2 recent messages (chitchat window) | ~5ms | - |
| Generation | Short conversational response in Arabic | ~1-2s | Gemini Flash |
| Post-processing (msg 2) | Save, embed response only. No summary/WM/extract at msg 2 | ~400ms | Background |

**Total RAG time:** 0ms (skipped)
**Total time to first token:** ~100ms
**Post-processing:** ~400ms (background)

---

### Scenario 5: Document Upload + Question (Message 8)

**Input:** User uploads `architecture.pdf` (30 pages) + asks `"summarize the key decisions in this document"`

**Timeline:**

| Step | What Happens | Time | Tool |
|------|-------------|------|------|
| Pre-processing | PDF → **Gemini Vision extraction** (sees text + images + diagrams), upload to Supabase Storage. If Vision returns < 50 chars → fallback to pdf-parse-new | ~3-6s | Gemini 2.5 Flash Vision + Supabase Storage |
| Document processing | Parse → structural blocks → chunks (max 400 tokens each) → batch embed → RPC insert → update document_registry | ~3-5s | Voyage AI batch + Supabase RPC |
| Classification | referencesDocument: true, intent: analysis, needsRAG: true | ~200ms | Gemini Flash |
| Layer 0 | No invalidation → skip | ~1ms | - |
| Step 1: Pre-embed | Generate embedding | ~300ms | Voyage AI |
| Step 2: Query expand | 3 alternatives about document summarization | ~500ms | Gemini Flash |
| Step 3: Fingerprint | Current convo only (new topic) | ~100ms | Supabase RPC |
| Step 4: Hybrid search | Search for prior discussions about architecture | ~400ms | Supabase RPC |
| Step 5-8: Filter, Temp, Rerank, Active | Standard processing | ~500ms | Voyage AI |
| Step 9: Doc chunks | **Key step** — document just uploaded, registry populated. search_document_chunks finds relevant chunks + neighbors | ~400ms | Supabase RPC × 2 |
| Context assembly | Document chunks in dedicated section + document registry in system prompt + RAG memories + 5 recent messages | ~15ms | - |
| Generation | Comprehensive summary citing document sections | ~5-10s | Gemini 3.1 Pro |
| Post-processing (msg 8) | Save, embed, rolling summary (6+8×0=6, 6+8×1=14 → no at 8, but first at 6 already ran) | ~800ms | Background |

**Total Vision extraction time:** ~3-6s (Gemini Vision on 30-page PDF)
**Total document processing time:** ~3-5s (chunking + embedding, runs before RAG)
**Total RAG time:** ~2.2s
**Total time to first token:** ~8-13s (Vision + document processing + RAG)
**Post-processing:** ~800ms (background)

**Note:** If the user asks a follow-up question about the document (e.g., message 9: "what does section 3 say about authentication?"), the RAG pipeline is much faster (~1.5s) because:
1. Document chunks are already embedded and indexed
2. Step 9 finds the relevant chunks instantly
3. No document processing needed

---

## Error Handling & Resilience Summary

```
┌─────────────────────────────────────────────────────┐
│                  FALLBACK CHAIN                      │
│                                                      │
│  Gemini Vision PDF ───fail──► pdf-parse-new (text)   │
│                       ──fail──► "could not extract"  │
│                                                      │
│  Voyage AI embedding ──fail──► OpenAI embedding      │
│                       ──fail──► Zero vector (1024×0) │
│                                                      │
│  Voyage AI batch ─────fail──► OpenAI sequential      │
│                       ──fail──► Zero vectors          │
│                                                      │
│  Fingerprint filter ──fail──► Search ALL convos      │
│                                                      │
│  Reranking ───────────fail──► Return original order  │
│                                                      │
│  Query expansion ─────fail──► Use original only      │
│                                                      │
│  Document retrieval ──fail──► Continue without docs  │
│                                                      │
│  Post-processing ─────fail──► Logged to Sentry,     │
│                                never blocks response │
└─────────────────────────────────────────────────────┘
```

Every layer has a fallback. The system degrades gracefully — even if every external service fails, the user still gets a response (just without memory/context).

---

## Gaps, Edge Cases & Missing Features

### 1. PDF Images/Scans — SOLVED with Gemini Vision

**Impact:** ~~HIGH~~ → **RESOLVED**
**Status:** Solved in current code via `vision-extract.ts`

PDFs now use **Vision-first extraction**: Gemini 2.5 Flash receives the raw PDF bytes as `inlineData` and visually reads every page. This captures:
- Scanned pages (image-only PDFs) → fully readable now
- Diagrams and charts → described in `[IMAGE: ...]` tags
- Handwritten text → transcribed in `[HANDWRITTEN: ...]` tags
- Tables with complex formatting → markdown tables
- Mixed text + image pages → both extracted in reading order

**Fallback:** If Vision returns < 50 characters → falls back to `pdf-parse-new` traditional text extraction, uses whichever output is longer.

### 2. DOCX/PPTX Images — Still No Vision

**Impact:** MEDIUM
**Status:** No solution for images inside DOCX and PPTX

- **DOCX**: `mammoth.extractRawText()` extracts text only, skips all embedded images
- **PPTX**: `JSZip` extracts only `<a:t>` text tags, skips all images/diagrams/shapes

Unlike PDFs, these formats don't have Vision-first extraction. Gemini Vision does support these MIME types natively (they could be sent as `inlineData`), but the code doesn't use this path.

**What's needed:**
- Apply the same Vision-first pattern from PDF extraction to DOCX and PPTX
- Or: extract embedded images from the ZIP structure and send each to Vision

### 3. Standalone Image Files — No RAG Memory

**Impact:** MEDIUM

Images uploaded directly (.png, .jpg) are sent to Gemini as `inlineData` for the current response. But:
- No embedding is generated for the image content
- No entry in `document_registry`
- If the user asks "what was in that image I sent earlier?" — the system has no memory
- The image URL is saved in message `attachments` but its content isn't searchable

**What's needed:**
- After Gemini describes the image, embed that description as a document chunk
- Add image descriptions to `document_registry`

### 4. Vision Output Token Limit vs Large Documents

**Impact:** MEDIUM

Gemini Vision is configured with `maxOutputTokens: 16384`. For very large PDFs (100+ pages), this may not be enough to extract all content. The Vision model will silently stop generating after hitting the limit — later pages may be truncated or omitted entirely.

Additionally, the old `pdf-parse-new` fallback still truncates at 8000 chars. For DOCX/XLSX/PPTX (which don't use Vision), the 8000-char limit remains:
```typescript
return result.value.slice(0, 8000); // DOCX
return parts.join('\n\n').slice(0, 8000); // PPTX, XLSX
```

The `processDocument()` call receives whatever text was extracted, so for non-PDF formats, chunks beyond ~4-5 pages are never created.

### 5. Embedding Dimension Mismatch Risk

**Impact:** LOW (mitigated by design, but worth noting)

Primary (Voyage AI) and fallback (OpenAI) both produce 1024-dim vectors. But if one message is embedded with Voyage and another with OpenAI, cosine similarity may be slightly degraded because the vector spaces aren't identical. The system doesn't track which provider generated which embedding.

### 6. Anti-Memory Regex Coverage

**Impact:** LOW

The invalidation and anti-memory patterns are regex-based. Sophisticated/subtle rejections may not be caught:
- "I'd rather not go that route" — not caught
- "Let's try something completely different" — not caught
- "That approach has too many downsides" — not caught

The Gemini Flash classification partially mitigates this, but the regex gate runs first.

### 7. Working Memory JSON Truncation

**Impact:** LOW (mitigated with `safeJsonParse`)

Gemini Flash has a 1024-token output limit for working memory updates. For complex tasks with many sub-tasks and entities, the JSON may be truncated. The `safeJsonParse` function attempts to repair truncated JSON by closing brackets, which is clever but may produce semantically incomplete data.

### 8. Summary Frequency Gaps

**Impact:** LOW

Rolling summary runs at message 6, then every 8 messages (6, 14, 22, 30...). For conversations between message 1-5, there's no summary at all. Working memory (every 3 messages) partially covers this gap, but complex early conversations may lose context.

### 9. Image Attachments — Guard Logic

**Impact:** LOW (correctly handled)

The code has a specific guard in `route.ts` (lines 438-453) that prevents PDFs from being routed to the image model:
```typescript
if (!hasImageAttachment) {
  intent.hasImageInput = false;
  if (intent.routeOverride === 'gemini-3.1-flash-image') {
    intent.routeOverride = 'none';
  }
}
```

This was a V4 fix — earlier versions would sometimes route PDF-containing messages to the image model because the classifier detected "image" keywords in the document content.
