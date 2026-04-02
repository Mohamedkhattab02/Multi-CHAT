# PROJECT STRUCTURE

```
multichat-ai/
├── src/
│   │
│   │  ══════════════════════════════════════════════════════
│   │  SERVER SIDE — actions, API routes, server utilities
│   │  ══════════════════════════════════════════════════════
│   │
│   ├── actions/                              # Server Actions ("use server") — צד שרת בלבד
│   │   ├── auth.ts                           # login, signup, logout, getSession, refreshToken
│   │   ├── conversations.ts                  # createConversation, updateConversation, deleteConversation, getConversation, listConversations
│   │   ├── messages.ts                       # sendMessage, deleteMessage, regenerateMessage, getMessages
│   │   ├── chat.ts                           # streamChat (orchestrates classify → RAG → assemble → stream)
│   │   ├── folders.ts                        # createFolder, renameFolder, deleteFolder, moveConversationToFolder
│   │   ├── memories.ts                       # getMemories, deleteMemory, extractMemories
│   │   ├── embeddings.ts                     # generateAndStoreEmbedding, searchEmbeddings
│   │   ├── share.ts                          # createShareLink, revokeShareLink, getSharedConversation
│   │   ├── upload.ts                         # uploadFile, deleteFile, getSignedUrl
│   │   ├── export.ts                         # exportMarkdown, exportPDF
│   │   ├── user.ts                           # getProfile, updateProfile, updatePreferences, resetDailyLimit
│   │   └── usage.ts                          # getUsageStats, logUsage, checkDailyLimit
│   │
│   ├── app/
│   │   ├── layout.tsx                        # Root layout (providers, fonts, metadata)
│   │   ├── page.tsx                          # Landing/redirect to /chat
│   │   ├── globals.css                       # Tailwind + custom CSS variables
│   │   │
│   │   │  ── Pages (Client renders) ──
│   │   │
│   │   ├── (auth)/
│   │   │   ├── login/page.tsx                # Login page (Google OAuth)
│   │   │   ├── signup/page.tsx               # Signup page
│   │   │   └── callback/route.ts             # OAuth callback handler (server route)
│   │   │
│   │   ├── (chat)/
│   │   │   ├── layout.tsx                    # Chat layout (sidebar + main area)
│   │   │   ├── page.tsx                      # New chat page (empty state)
│   │   │   └── [conversationId]/
│   │   │       └── page.tsx                  # Conversation view
│   │   │
│   │   ├── shared/
│   │   │   └── [shareToken]/page.tsx         # Public shared conversation (read-only, no auth)
│   │   │
│   │   │  ── API Routes (Server endpoints for SSE + webhooks) ──
│   │   │
│   │   └── api/
│   │       ├── chat/
│   │       │   └── route.ts                  # SSE streaming endpoint (needs ReadableStream — can't be Server Action)
│   │       ├── upload/
│   │       │   └── route.ts                  # File upload (multipart/form-data — can't be Server Action)
│   │       └── export-pdf/
│   │           └── route.ts                  # PDF generation + binary download
│   │
│   │  ══════════════════════════════════════════════════════
│   │  CLIENT SIDE — components, hooks, stores
│   │  ══════════════════════════════════════════════════════
│   │
│   ├── components/
│   │   │
│   │   ├── chat/                             # Chat area components ("use client")
│   │   │   ├── ChatArea.tsx                  # Main chat container — orchestrates MessageList + ChatInput
│   │   │   ├── MessageList.tsx               # Virtual scrolling message list (@tanstack/react-virtual)
│   │   │   ├── MessageBubble.tsx             # Single message (user/assistant) with actions
│   │   │   ├── ChatInput.tsx                 # Tiptap rich text editor + file attach + model selector + voice
│   │   │   ├── ModelSelector.tsx             # Dropdown/bottom-sheet to pick GPT/Gemini/GLM
│   │   │   ├── StreamingMessage.tsx          # Live streaming text display with cursor animation
│   │   │   ├── FilePreview.tsx               # Preview attached files (image thumbnail, file card)
│   │   │   ├── ImagePreview.tsx              # Generated image preview (from Gemini Image)
│   │   │   ├── CodeBlock.tsx                 # Syntax-highlighted code block (shiki + copy + lang label)
│   │   │   ├── MarkdownRenderer.tsx          # Markdown + math + code rendering (DOMPurify sanitized)
│   │   │   ├── VoiceInput.tsx                # Web Speech API voice input button (he/ar/en)
│   │   │   └── EmptyState.tsx                # "Start a new conversation" screen
│   │   │
│   │   ├── sidebar/                          # Sidebar components ("use client")
│   │   │   ├── Sidebar.tsx                   # Fixed left panel with Framer Motion animation
│   │   │   ├── ConversationList.tsx          # Grouped by date (Today, Yesterday...) — virtualized
│   │   │   ├── ConversationItem.tsx          # Single row + context menu (rename, delete, share, move)
│   │   │   ├── FolderList.tsx                # Folder navigation tree
│   │   │   ├── FolderItem.tsx                # Single folder with drag-drop target
│   │   │   ├── SearchBar.tsx                 # Full-text search across conversations + messages
│   │   │   ├── NewChatButton.tsx             # "New chat" button (top of sidebar)
│   │   │   └── UserMenu.tsx                  # Profile + settings + logout (bottom of sidebar)
│   │   │
│   │   ├── layout/                           # Layout & global UI components
│   │   │   ├── Header.tsx                    # Top bar: title + share + export + sidebar toggle (mobile)
│   │   │   ├── ThemeToggle.tsx               # Dark/light switch (sun/moon icon)
│   │   │   ├── ExportMenu.tsx                # Export dropdown: Markdown / PDF
│   │   │   ├── ShareDialog.tsx               # Share conversation dialog (generate/copy/revoke link)
│   │   │   ├── CommandPalette.tsx            # cmdk (Ctrl+K): search + quick commands
│   │   │   └── ErrorBoundary.tsx             # React error boundary → Sentry capture
│   │   │
│   │   └── ui/                               # shadcn/ui primitives (auto-generated, don't edit)
│   │       ├── button.tsx
│   │       ├── dialog.tsx
│   │       ├── dropdown-menu.tsx
│   │       ├── input.tsx
│   │       ├── scroll-area.tsx
│   │       ├── skeleton.tsx
│   │       └── tooltip.tsx
│   │
│   ├── hooks/                                # Custom React hooks ("use client")
│   │   ├── useConversations.ts               # react-query: CRUD conversations (calls actions/conversations.ts)
│   │   ├── useMessages.ts                    # react-query: load/send/delete messages (calls actions/messages.ts)
│   │   ├── useStreaming.ts                   # SSE streaming hook — fetch /api/chat + parse chunks
│   │   ├── useAuth.ts                        # Auth state hook (calls actions/auth.ts)
│   │   ├── useModels.ts                      # Model selection + routing override display
│   │   ├── useFolders.ts                     # react-query: CRUD folders (calls actions/folders.ts)
│   │   ├── useSearch.ts                      # Debounced search across conversations + messages
│   │   ├── useVoiceInput.ts                  # Web Speech API hook (start/stop/transcript)
│   │   ├── useKeyboardShortcuts.ts           # Global keyboard shortcut registration
│   │   └── useMediaQuery.ts                  # Responsive breakpoint detection (mobile/tablet/desktop)
│   │
│   │  ══════════════════════════════════════════════════════
│   │  SHARED — lib, stores, providers (used by both sides)
│   │  ══════════════════════════════════════════════════════
│   │
│   ├── lib/
│   │   │
│   │   ├── supabase/                         # Supabase clients + types
│   │   │   ├── client.ts                     # Browser Supabase client (client-side)
│   │   │   ├── server.ts                     # Server Supabase client with service key (server-side only)
│   │   │   ├── middleware.ts                 # Auth middleware helper
│   │   │   └── types.ts                      # Generated DB types (npx supabase gen types)
│   │   │
│   │   ├── ai/                               # AI logic (server-side only)
│   │   │   ├── router.ts                     # Model routing: complexity-based + special routing overrides
│   │   │   ├── openai.ts                     # GPT 5.1 / gpt-5-mini streaming handler
│   │   │   ├── gemini.ts                     # Gemini 3.1 Pro / 3 Flash handler (with search grounding)
│   │   │   ├── gemini-image.ts               # Gemini 3.1 Flash Image Preview — image gen (1K res)
│   │   │   ├── glm.ts                        # GLM 5 streaming handler
│   │   │   ├── embeddings.ts                 # Voyage AI primary + OpenAI fallback embeddings
│   │   │   ├── reranker.ts                   # Voyage AI rerank-3 (mandatory post-search)
│   │   │   ├── classifier.ts                 # Intent classification (GLM 4.7) + smart routing
│   │   │   └── memory-extractor.ts           # Extract facts/preferences/goals from conversations
│   │   │
│   │   ├── memory/                           # Memory system (server-side only)
│   │   │   ├── rag-pipeline.ts               # Hybrid search → Voyage reranking → format
│   │   │   ├── context-assembler.ts          # Token budgeting + prompt assembly per model
│   │   │   ├── rolling-summary.ts            # Rolling summary generator (Gemini 2.5 Flash)
│   │   │   └── chunker.ts                    # Semantic chunking for long documents
│   │   │
│   │   ├── security/                         # Security utilities (server-side only)
│   │   │   ├── rate-limit.ts                 # Arcjet rate limiting config
│   │   │   ├── validate.ts                   # Zod schemas: chatRequest, conversation, share, upload
│   │   │   ├── sanitize.ts                   # DOMPurify wrapper (used in MarkdownRenderer)
│   │   │   └── csrf.ts                       # CSRF token generation + validation
│   │   │
│   │   ├── monitoring/                       # Observability (server-side init, client-side capture)
│   │   │   ├── sentry.ts                     # Sentry helpers: captureError, setUser, addBreadcrumb
│   │   │   └── helicone.ts                   # Helicone proxy base URLs for AI APIs
│   │   │
│   │   └── utils/                            # Pure utility functions (shared)
│   │       ├── tokens.ts                     # Token estimation (1 token ≈ 4 chars EN, 2 chars HE/AR)
│   │       ├── format.ts                     # Date formatting (native Intl — no date-fns)
│   │       ├── export.ts                     # Export chat as markdown string
│   │       ├── export-pdf.ts                 # PDF document builder (@react-pdf/renderer)
│   │       ├── keyboard.ts                   # Keyboard shortcut definitions map
│   │       └── constants.ts                  # Model configs, token limits, pricing, colors
│   │
│   ├── store/                                # Zustand stores (client-side state)
│   │   ├── chat-store.ts                     # Active conversation, messages, streaming state
│   │   ├── sidebar-store.ts                  # Sidebar open/closed, folders, search query
│   │   └── ui-store.ts                       # Theme, mobile detection, modals, command palette
│   │
│   ├── providers/                            # React context providers (wrap app in layout.tsx)
│   │   ├── QueryProvider.tsx                 # @tanstack/react-query — cache, background sync
│   │   ├── SentryProvider.tsx                # Sentry error boundary — catches unhandled errors
│   │   └── ToastProvider.tsx                 # Sonner toast container
│   │
│   └── types/                                # Global TypeScript types (shared)
│       ├── database.ts                       # Supabase generated types (re-export from lib/supabase/types)
│       ├── models.ts                         # AI model types, configs, routing overrides
│       ├── messages.ts                       # Message, Attachment, StreamEvent types
│       ├── conversations.ts                  # Conversation, Folder, ShareToken types
│       └── api.ts                            # API request/response types, Zod inferred types
│
│  ══════════════════════════════════════════════════════
│  INFRASTRUCTURE — Supabase, config, env
│  ══════════════════════════════════════════════════════
│
├── supabase/
│   ├── migrations/
│   │   └── 001_initial_schema.sql            # Complete DB schema (8 tables + RLS + functions)
│   ├── functions/
│   │   ├── embed/index.ts                    # Auto-embedding Edge Function (webhook-triggered)
│   │   ├── extract-memories/index.ts         # Memory extraction Edge Function
│   │   └── send-notification/index.ts        # Future: push notification Edge Function
│   └── seed.sql                              # Initial data: default folders, templates
│
├── public/
│   ├── logo.svg
│   └── og-image.png
│
├── middleware.ts                              # Next.js middleware: auth guard + CSRF + Arcjet rate limit
├── sentry.client.config.ts                   # Sentry client-side initialization
├── sentry.server.config.ts                   # Sentry server-side initialization
├── tailwind.config.ts
├── next.config.ts
├── tsconfig.json
├── package.json
└── .env.local.example
```

---

## Server / Client Separation Guide

### `src/actions/` — Server Actions (צד שרת בלבד)

כל הקבצים בתיקיה הזו מסומנים `"use server"` — הם רצים **רק על השרת**, ולא נחשפים ללקוח.
Components ו-hooks קוראים להם ישירות דרך Server Actions API של Next.js.

| קובץ | פעולות | קורא מ- |
|------|--------|---------|
| `auth.ts` | login, signup, logout, getSession, refreshToken | hooks/useAuth, pages |
| `conversations.ts` | create, update, delete, get, list, pin, search | hooks/useConversations |
| `messages.ts` | send, delete, regenerate, getByConversation | hooks/useMessages |
| `chat.ts` | streamChat (orchestrator: classify→RAG→assemble→generate) | api/chat/route.ts |
| `folders.ts` | create, rename, delete, moveConversation | hooks/useFolders |
| `memories.ts` | get, delete, extract | lib/memory/rag-pipeline |
| `embeddings.ts` | generate, store, search | supabase/functions/embed |
| `share.ts` | createLink, revokeLink, getSharedConversation | components/ShareDialog |
| `upload.ts` | uploadFile, deleteFile, getSignedUrl | api/upload/route.ts |
| `export.ts` | exportMarkdown, exportPDF | components/ExportMenu |
| `user.ts` | getProfile, updateProfile, updatePreferences | components/UserMenu |
| `usage.ts` | getStats, logUsage, checkDailyLimit | actions/chat.ts |

### `src/app/api/` — API Routes (רק מה שחייב)

API routes נשמרים **רק** למקרים שבהם Server Actions לא מתאים:

| Route | למה API Route ולא Server Action |
|-------|--------------------------------|
| `/api/chat/route.ts` | **SSE Streaming** — צריך ReadableStream + text/event-stream headers |
| `/api/upload/route.ts` | **File Upload** — multipart/form-data parsing |
| `/api/export-pdf/route.ts` | **Binary Download** — PDF buffer response |

### `src/components/` — Client Components (צד לקוח)

כל הקומפוננטים מסומנים `"use client"`. הם:
- קוראים ל-Server Actions דרך hooks
- מנהלים UI state דרך Zustand stores
- לא מכילים לוגיקה של DB או AI ישירות

### `src/hooks/` — Custom Hooks (צד לקוח)

Hooks עוטפים את הקריאות ל-Server Actions עם `@tanstack/react-query`:
- **Caching** — conversation שנטענה פעם לא נטענת שוב
- **Optimistic updates** — הודעה מופיעה מיד לפני שהשרת אישר
- **Background sync** — data מתעדכן ברקע
- **Error handling** — retry + error state + Sentry capture

### `src/lib/` — Shared Logic

| תיקיה | צד | תיאור |
|--------|-----|-------|
| `lib/supabase/` | שניהם | client.ts = לקוח, server.ts = שרת |
| `lib/ai/` | שרת בלבד | כל הלוגיקה של AI models, embeddings, classifier |
| `lib/memory/` | שרת בלבד | RAG pipeline, context assembly, summaries |
| `lib/security/` | שרת בלבד | rate limiting, validation, sanitization, CSRF |
| `lib/monitoring/` | שניהם | Sentry init on both sides, Helicone server only |
| `lib/utils/` | שניהם | Pure functions — tokens, format, constants |
