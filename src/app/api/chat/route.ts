import { NextRequest } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { classifyIntent } from '@/lib/ai/classifier';
import { retrieveMemories } from '@/lib/memory/rag-pipeline';
import { assembleContext } from '@/lib/memory/context-assembler';
import { processUploadedDocument } from '@/lib/memory/document-processor';
import { updateRollingSummary } from '@/lib/memory/rolling-summary';
import { updateWorkingMemory } from '@/lib/memory/working-memory';
import { updateFingerprint } from '@/lib/memory/conversation-fingerprint';
import { checkAndInvalidateMemories } from '@/lib/memory/invalidation';
import { detectAntiMemory } from '@/lib/memory/anti-memory';
import { extractMemories } from '@/lib/memory/extract-memories';
import { generateEmbedding } from '@/lib/ai/embeddings';
import { streamGPT, streamGemini, streamGLM } from '@/lib/ai/model-streamers';
import { generateImage } from '@/lib/ai/gemini-image';
import { checkRateLimit } from '@/lib/security/rate-limit';
import * as Sentry from '@sentry/nextjs';

export async function POST(req: NextRequest) {
  // Rate limit check
  const rateLimit = await checkRateLimit(req);
  if (!rateLimit.allowed) return new Response('Rate limit exceeded', { status: 429 });

  const { message, conversationId, model, attachments } = await req.json();
  if (!message || !conversationId) return new Response('Missing fields', { status: 400 });

  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return new Response('Unauthorized', { status: 401 });

  // Daily message limit
  const { data: profile } = await supabase.from('users').select('*').eq('id', user.id).single();
  if (profile?.messages_today >= profile?.daily_message_limit) {
    return new Response('Daily limit reached', { status: 429 });
  }
  await supabase.from('users').update({ messages_today: (profile?.messages_today || 0) + 1 }).eq('id', user.id);

  // ═══ LAYER 0: INVALIDATION ═══
  // Uses dedicated module — checks for "forget/ignore" patterns and deactivates related memories
  await checkAndInvalidateMemories(user.id, message, conversationId);

  // ═══ LAYER 1: CLASSIFY ═══
  const hasImage = attachments?.some((a: any) => a.type?.startsWith('image/'));
  const classification = await classifyIntent(message, model, hasImage);

  // IMAGE GENERATION OVERRIDE
  if (classification.routeTo === 'gemini-3.1-flash-image') {
    const img = await generateImage(message);
    await supabase.from('messages').insert({
      conversation_id: conversationId, role: 'user', content: message, model: classification.routeTo,
    });
    await supabase.from('messages').insert({
      conversation_id: conversationId, role: 'assistant', content: img.revisedPrompt,
      model: classification.routeTo,
      attachments: [{ type: img.mimeType, data: img.imageBase64, name: 'image.png' }],
    });
    return new Response(JSON.stringify({ type: 'image', ...img }), {
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Actual model to use (classifier decides based on complexity)
  const actualModel = classification.routeTo;

  // ═══ DOCUMENT PROCESSING ═══
  const docTypes = [
    'application/pdf',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'text/plain',
    'text/markdown',
  ];
  const docsToProcess = attachments?.filter((a: any) => docTypes.includes(a.type));
  if (docsToProcess?.length > 0) {
    for (const doc of docsToProcess) {
      await processUploadedDocument(user.id, conversationId, doc, supabase);
    }
  }

  // ═══ LAYER 2: RAG (includes pre-embedding) ═══
  const ragResult = classification.needsRAG
    ? await retrieveMemories(user.id, message, conversationId, classification)
    : { context: '', temperaturedResults: [], preEmbeddedId: undefined };

  // ═══ LAYER 3: ASSEMBLE CONTEXT ═══
  const { data: conversation } = await supabase
    .from('conversations')
    .select('*')
    .eq('id', conversationId)
    .single();

  const { data: history } = await supabase
    .from('messages')
    .select('role, content, attachments')
    .eq('conversation_id', conversationId)
    .order('created_at');

  // Save user message
  const { data: userMsg } = await supabase
    .from('messages')
    .insert({
      conversation_id: conversationId,
      role: 'user',
      content: message,
      model: actualModel,
      attachments: attachments || [],
    })
    .select('id')
    .single();

  const { systemPrompt, messages: assembledMessages } = assembleContext({
    model: actualModel,
    userProfile: profile,
    ragContext: ragResult.context,
    temperaturedResults: ragResult.temperaturedResults,
    messages: [...(history || []), { role: 'user', content: message }],
    workingMemory: conversation?.working_memory,
    documentRegistry: conversation?.document_registry,
    structuredSummary: conversation?.structured_summary,
    classification,
    language: classification.language,
  });

  // ═══ LAYER 4: STREAM ═══
  const stream = new ReadableStream({
    async start(controller) {
      let fullText = '';
      try {
        const enableSearch = classification.intent === 'web_search';
        let gen: any;
        if (['gpt-5.1', 'gpt-5-mini'].includes(actualModel)) {
          gen = streamGPT({ systemPrompt, messages: assembledMessages, model: actualModel });
        } else if (actualModel.includes('gemini')) {
          gen = streamGemini({ systemPrompt, messages: assembledMessages, model: actualModel, enableSearch });
        } else {
          gen = streamGLM({ systemPrompt, messages: assembledMessages });
        }

        for await (const event of gen) {
          if (event.type === 'text') {
            fullText += event.text;
            controller.enqueue(
              new TextEncoder().encode(`data: ${JSON.stringify({ text: event.text })}\n\n`)
            );
          }

          if (event.type === 'done') {
            controller.enqueue(new TextEncoder().encode('data: [DONE]\n\n'));

            // ═══ LAYER 5: POST-PROCESSING (async, non-blocking) ═══

            // 5.1: Save assistant message
            const { data: asstMsg } = await supabase
              .from('messages')
              .insert({
                conversation_id: conversationId,
                role: 'assistant',
                content: fullText,
                model: actualModel,
              })
              .select('id')
              .single();

            // 5.2: Commit pre-embed — update temp embedding to point to the user message
            if (ragResult.preEmbeddedId && userMsg?.id) {
              await supabase
                .from('embeddings')
                .update({
                  source_id: userMsg.id,
                  metadata: {
                    conversation_id: conversationId,
                    is_current_message: false,
                    is_active: true,
                    role: 'user',
                    importance: 0.5,
                  },
                })
                .eq('id', ragResult.preEmbeddedId);
            }

            // 5.3: Embed assistant response
            if (asstMsg?.id) {
              const emb = await generateEmbedding(fullText);
              await supabase.from('embeddings').insert({
                user_id: user.id,
                source_type: 'message',
                source_id: asstMsg.id,
                content: fullText.slice(0, 8000),
                embedding: emb,
                metadata: {
                  conversation_id: conversationId,
                  is_active: true,
                  role: 'assistant',
                  importance: 0.5,
                },
              });
            }

            // Async fire-and-forget post-processing
            const msgCount = (history?.length || 0) + 2;

            // 5.4: Working memory update (every 3 messages, or for code/analysis)
            if (msgCount % 3 === 0 || classification.intent === 'code' || classification.intent === 'analysis') {
              updateWorkingMemory(conversationId, message, fullText, classification.intent).catch(
                (err) => console.error('[Post] Working memory failed:', err)
              );
            }

            // 5.5: Incremental summary (every 10 messages after 12)
            if (msgCount > 12 && msgCount % 10 === 0) {
              const recentForSummary = [
                ...((history || []).slice(-10)),
                { role: 'user', content: message },
                { role: 'assistant', content: fullText },
              ];
              updateRollingSummary(
                conversationId,
                conversation?.structured_summary,
                recentForSummary,
                supabase
              ).catch((err) => console.error('[Post] Summary failed:', err));
            }

            // 5.6: Anti-memory detection (check for rejections/corrections)
            detectAntiMemory(user.id, conversationId, message, fullText).catch(
              (err) => console.error('[Post] Anti-memory failed:', err)
            );

            // 5.7: Extract memories (every 5 messages)
            if (msgCount % 5 === 0) {
              extractMemories(user.id, message, fullText).catch(
                (err) => console.error('[Post] Extract memories failed:', err)
              );
            }

            // 5.8: Conversation fingerprint (every 20 messages)
            if (msgCount % 20 === 0) {
              updateFingerprint(conversationId, user.id).catch(
                (err) => console.error('[Post] Fingerprint failed:', err)
              );
            }

            // 5.9: Auto-title on first exchange
            if (msgCount === 2) {
              const title = fullText.slice(0, 50).replace(/\n/g, ' ');
              await supabase
                .from('conversations')
                .update({ title, topic: classification.mainTopic })
                .eq('id', conversationId);
            }
          }
        }
      } catch (err) {
        Sentry.captureException(err);
        controller.enqueue(
          new TextEncoder().encode(`data: ${JSON.stringify({ error: 'Generation failed' })}\n\n`)
        );
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    },
  });
}
