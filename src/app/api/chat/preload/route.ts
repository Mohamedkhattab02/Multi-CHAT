// ============================================================
// Preemptive Context Loading Endpoint — V4
// Runs classifier + RAG pipeline and returns the context bundle
// Called by usePreemptiveContext hook while user is still typing
// ============================================================

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { classifyIntent } from '@/lib/ai/classifier';
import { retrieveMemories } from '@/lib/memory/rag-pipeline';

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  try {
    const { conversationId, message } = await req.json();

    if (!conversationId || !message || message.length < 15) {
      return NextResponse.json({ error: 'Invalid input' }, { status: 400 });
    }

    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    // Run classifier
    const classification = await classifyIntent(message);

    // Skip RAG if not needed
    if (!classification.needsRAG) {
      return NextResponse.json({
        classification,
        ragContext: null,
        preloaded: true,
      });
    }

    // Get recent messages for context
    const { data: msgs } = await supabase
      .from('messages')
      .select('role, content')
      .eq('conversation_id', conversationId)
      .order('created_at', { ascending: false })
      .limit(3);

    const conversationContext = (msgs || [])
      .reverse()
      .map(m => `${m.role}: ${m.content.slice(0, 200)}`)
      .join('\n');

    // Run RAG pipeline
    const ragContext = await retrieveMemories({
      userId: user.id,
      conversationId,
      message,
      conversationContext,
      classification,
    });

    return NextResponse.json({
      classification,
      ragContext: {
        hot: ragContext.hot,
        warm: ragContext.warm,
        cold: ragContext.cold,
      },
      preloaded: true,
    });
  } catch (error) {
    console.error('[Preload] Failed:', error);
    return NextResponse.json({ error: 'Preload failed' }, { status: 500 });
  }
}
