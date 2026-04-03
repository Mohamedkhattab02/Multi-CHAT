# Phase 2: Core Chat — Summary

## What was built

### AI Model Handlers (4 files)
- **`src/lib/ai/openai.ts`** — GPT 5.1 / gpt-5-mini streaming handler via OpenAI SDK, proxied through Helicone for observability. Async generator yielding `text` / `done` / `error` events with token usage tracking.
- **`src/lib/ai/gemini.ts`** — Gemini 3.1 Pro / Gemini 3 Flash streaming handler via Google Generative AI SDK. Supports search grounding (`googleSearch` tool) for real-time data queries. Converts message history to Gemini's user/model format.
- **`src/lib/ai/gemini-image.ts`** — Gemini 3.1 Flash Image Preview handler for image generation at 1K resolution. Returns base64 image + revised prompt.
- **`src/lib/ai/glm.ts`** — GLM 5 (ZhipuAI) streaming handler using OpenAI-compatible SSE format via raw fetch. Manual SSE parsing from response body.

### AI Intelligence Layer (3 files)
- **`src/lib/ai/classifier.ts`** — Smart intent classifier (Layer 1 of 7-layer memory system). Fast regex paths for image gen, web search, and image analysis. Falls back to GLM 4.7 LLM classification for complex queries. Returns routing overrides, complexity, RAG needs.
- **`src/lib/ai/embeddings.ts`** — Embedding generation with automatic failover. Primary: Voyage AI `voyage-4-large` (1024 dims). Fallback: OpenAI `text-embedding-3-large` (truncated to 1024 dims).
- **`src/lib/ai/reranker.ts`** — Voyage AI `rerank-3` for mandatory post-retrieval reranking. Improves RAG accuracy by 30-40%. Graceful fallback to original order on failure.

### Memory System (3 files)
- **`src/lib/memory/rag-pipeline.ts`** — Layer 2: Hybrid search via Supabase RPC (`hybrid_search` function — pgvector + tsvector + pg_trgm). Fetches 3x candidates, then reranks with Voyage AI to top-K.
- **`src/lib/memory/context-assembler.ts`** — Layer 3: Builds final messages array with strict token budgets per model. Injects system prompt with user profile + RAG context. Trims history from oldest first.
- **`src/lib/memory/rolling-summary.ts`** — Layer 6: Generates compressed conversation summaries using GLM (cheapest). Also generates auto-titles for new conversations.

### SSE Chat API Route (1 file)
- **`src/app/api/chat/route.ts`** — Main POST endpoint orchestrating all 7 layers:
  1. Zod input validation
  2. Auth + daily message limit check
  3. Smart routing via classifier (image gen, web search, vision overrides)
  4. RAG memory retrieval + reranking
  5. Context assembly with token budgets
  6. SSE streaming with heartbeat (15s) + AbortController
  7. Post-processing: save messages, usage logging, rolling summary (every 10 msgs), auto-title generation

### Server Actions (1 file)
- **`src/actions/messages.ts`** — `getMessages()` and `deleteMessage()` with ownership verification.

### UI Components (8 files)
- **`src/components/chat/CodeBlock.tsx`** — Syntax-highlighted code blocks via Shiki (async loaded). Copy button, language label, line numbers for blocks > 5 lines.
- **`src/components/chat/MarkdownRenderer.tsx`** — Full GFM markdown rendering via `react-markdown` + `remark-gfm` + `remark-math` + `rehype-katex`. All output sanitized with DOMPurify. Custom styled components for tables, blockquotes, headings, code, links, images.
- **`src/components/chat/MessageBubble.tsx`** — User messages (right-aligned, primary bg) and assistant messages (left-aligned with model avatar). Hover actions: copy, regenerate, delete. Relative timestamps on hover. Generated image preview support.
- **`src/components/chat/StreamingMessage.tsx`** — Shows streaming response with blinking cursor animation, thinking dots, stop button, and route override badge ("via Gemini Flash").
- **`src/components/chat/MessageList.tsx`** — Virtualized message list using `@tanstack/react-virtual`. Auto-scrolls to bottom on new content. Disables auto-scroll when user scrolls up. Handles streaming row as last virtual item.
- **`src/components/chat/ModelSelector.tsx`** — Dropdown selector for GPT 5.1 / Gemini 3.1 Pro / GLM 5. Shows model color dot, name, provider. Opens upward from input bar.
- **`src/components/chat/VoiceInput.tsx`** — Browser-native speech-to-text via Web Speech API. Supports English, Hebrew, Arabic. Pulse animation when recording. Hidden if browser doesn't support it.
- **`src/components/chat/ChatInput.tsx`** — Tiptap rich text editor with: file attachments (images, PDFs), voice input, model selector, send button. Enter to send, Shift+Enter for newline. Attachment previews with remove button.

### Hooks (2 files)
- **`src/lib/hooks/use-streaming.ts`** — SSE streaming hook. Connects to `/api/chat`, parses SSE events, handles image generation responses, creates optimistic messages, supports abort.
- **`src/lib/hooks/use-messages.ts`** — React Query hook for messages. Optimistic add/delete, query invalidation, stale time management.

### ChatArea Integration
- **`src/components/chat/ChatArea.tsx`** — Fully rewired to integrate: MessageList (virtual), ChatInput (Tiptap), streaming, model selection, regenerate, delete. Uses react-query for message sync.

## Post-Phase 2 Fixes

### Route Fix: `(chat)` → `chat`
- **Problem:** `src/app/(chat)/` was a route group (parentheses = no URL segment). Root `page.tsx` redirected to `/chat` which didn't exist → **404**.
- **Fix:** Renamed `(chat)` to `chat` so it becomes a real `/chat` URL segment.
- Routes now: `/chat` (new chat), `/chat/[conversationId]` (existing conversation).

### New Chat Page — Full Wiring
- **`src/app/chat/page.tsx`** — Rewired as a proper "new chat" page: EmptyState + ChatInput + StreamingMessage. On first message: creates conversation via Supabase → streams response → navigates to `/chat/[id]`. Suggestions are clickable.
- **`src/components/chat/EmptyState.tsx`** — Added `onSuggestionClick` prop so suggestion buttons trigger message send.

### Gemini Model IDs Fix
- **`src/lib/ai/gemini.ts`** — Fixed MODEL_MAP: `gemini-3.1-pro` → `gemini-3.1-pro-preview`, `gemini-3-flash` → `gemini-3-flash-preview` (actual API model names).

### Classifier — Full Rewrite (Layer 1)
- **`src/lib/ai/classifier.ts`** — Complete rewrite:
  - Switched from `gemini-3-flash-preview` to `gemini-2.5-flash` (stable JSON mode support).
  - Fixed API key: `GEMINI_API_KEY` → `GOOGLE_AI_API_KEY`.
  - Added `responseMimeType: "application/json"` + `responseSchema` for guaranteed structured JSON output.
  - Added `systemInstruction` with routing rules instead of inline prompt.
  - `gemini-3-flash-preview` was a thinking model that used all tokens for thinking and failed on JSON. `gemini-2.5-flash` works reliably.

### VoiceInput Hydration Fix
- **`src/components/chat/VoiceInput.tsx`** — Moved `typeof window` check into `useEffect` to avoid server/client hydration mismatch.

### Rolling Summary → Gemini 2.5 Flash
- **`src/lib/memory/rolling-summary.ts`** — Switched from GLM (`glm-4-7b`) to Gemini 2.5 Flash for both `generateRollingSummary` and `generateTitle`. Uses REST API with `systemInstruction`.

### UserMenu Hydration Fix
- **`src/components/sidebar/UserMenu.tsx`** — Added `mounted` state to prevent hydration mismatch from `useTheme()` returning `undefined` on server.

### Zod Schema Fix
- **`src/lib/security/validate.ts`** — `ChatMessageSchema` attachments now accept MIME types (`image/jpeg` etc.) and optional `data` (base64). Previously required `url` (never sent by client) and enum types (`image|pdf|document`) which didn't match client format.

### DB Schema & Route Fixes
- **`supabase/migrations/001_initial_schema.sql`** — Fixed `conversations.model` default from `'GPT 5.1'` (display name) to `'gemini-3.1-pro'` (model ID). Applied to live DB.
- **`src/app/api/chat/route.ts`** — Auto-title generation now also updates `conversation.model` to `actualModel` so DB tracks which model actually responded.

## File Count
- **22 new/modified files** total (+ 10 fixed post-phase)
- **0 TypeScript errors** (verified with `next build`)

## Architecture Diagram

```
User Input → ChatInput (Tiptap)
    ↓
useStreaming hook → POST /api/chat
    ↓
[Layer 1] Classifier → routing override?
    ↓
[Layer 2] RAG Pipeline → hybrid search + rerank
    ↓
[Layer 3] Context Assembler → token budgets
    ↓
[Layer 4] Model Handler (GPT/Gemini/GLM) → SSE stream
    ↓
[Layer 5] Post-processing → save, usage log, summary
    ↓
[Layer 6] Rolling Summary (every 10 msgs)
    ↓
[Layer 7] Storage (Supabase)
    ↓
SSE events → useStreaming → MessageList (virtual) → MessageBubble (markdown)
```


## phase 3
משימה 2: בדיקת Phase 3 (Memory System)
הנה הסטטוס לפי כל שלב:

#	שלב	סטטוס	הערות
24	Voyage AI embedding (+ OpenAI fallback)	קיים	embeddings.ts — Voyage primary, OpenAI fallback, 1024 dims
25	Voyage AI Reranker	קיים	reranker.ts — rerank-3, graceful fallback
26	Supabase Edge Function (auto-embedding webhook)	חסר	אין תיקיית supabase/functions/. ה-embed-store קיים כקוד server-side ב-embed-store.ts אבל לא כ-Edge Function שמופעל ע"י Database Webhook
27	hybrid_search RPC	קיים ב-SQL	ב-001_initial_schema.sql — הפונקציה מוגדרת עם RRF scoring
28	Intent classifier	קיים (תוקן עכשיו)	classifier.ts — עם JSON mode
29	Context assembler + token budgeting	קיים	context-assembler.ts — עם TOKEN_BUDGETS per model
30	RAG pipeline (search → rerank → format)	קיים	rag-pipeline.ts — hybrid search → Voyage rerank → format
31	Rolling summary	קיים	rolling-summary.ts — עם Gemini 2.0 Flash
32	extract-memories Edge Function	חסר	לא נוצר. הספק דורש supabase/functions/extract-memories/index.ts (Deno Edge Function)
33	Test full pipeline	לא נבדק	—
מה חסר ב-Phase 3:
supabase/functions/extract-memories/index.ts — Edge Function שמחלץ facts/preferences מהשיחה ושומר בטבלת memories. לפי הספק, צריך להיקרא כל 5 הודעות.

supabase/functions/embed/index.ts — Edge Function שנקרא ע"י Database Webhook כשנוצרת הודעה חדשה. נכון לעכשיו, ה-embedding נעשה ב-server-side (embed-store.ts) שזה עובד, אבל הארכיטקטורה המקורית רצתה webhook-triggered Edge Function.

רוצה שאצור את ה-Edge Functions החסרים?