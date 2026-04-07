import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import ReactPDF from '@react-pdf/renderer';
import { ChatPdfDocument } from '@/lib/pdf/chat-document';

export async function POST(req: NextRequest) {
  try {
    const { conversationId } = await req.json();
    if (!conversationId) {
      return NextResponse.json({ error: 'Missing conversationId' }, { status: 400 });
    }

    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const [{ data: conversation }, { data: messages }] = await Promise.all([
      supabase
        .from('conversations')
        .select('title, model, created_at')
        .eq('id', conversationId)
        .eq('user_id', user.id)
        .single(),
      supabase
        .from('messages')
        .select('role, content, created_at')
        .eq('conversation_id', conversationId)
        .order('created_at', { ascending: true }),
    ]);

    if (!conversation || !messages) {
      return NextResponse.json({ error: 'Conversation not found' }, { status: 404 });
    }

    const stream = await ReactPDF.renderToStream(
      ChatPdfDocument({
        title: conversation.title,
        model: conversation.model,
        date: conversation.created_at,
        messages: messages.map((m) => ({
          role: m.role,
          content: m.content,
          timestamp: m.created_at,
        })),
      })
    );

    // Convert Node readable stream to web ReadableStream
    const webStream = new ReadableStream({
      start(controller) {
        stream.on('data', (chunk: Buffer) => controller.enqueue(chunk));
        stream.on('end', () => controller.close());
        stream.on('error', (err: Error) => controller.error(err));
      },
    });

    return new NextResponse(webStream, {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="${conversation.title.replace(/[^a-z0-9]/gi, '_').slice(0, 50)}.pdf"`,
      },
    });
  } catch (error) {
    console.error('[ExportPDF] Error:', error);
    return NextResponse.json({ error: 'Failed to generate PDF' }, { status: 500 });
  }
}
