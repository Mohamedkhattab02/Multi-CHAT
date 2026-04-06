interface StreamEvent {
  type: 'text' | 'done';
  text?: string;
  fullText?: string;
  usage?: { inputTokens: number; outputTokens: number; cost: number };
}

export async function* streamGPT(options: {
  systemPrompt: string;
  messages: any[];
  model: string;
}): AsyncGenerator<StreamEvent> {
  const apiKey = process.env.OPENAI_API_KEY;
  
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'api/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: 'system', content: options.systemPrompt },
        ...options.messages,
      ],
      stream: true,
    }),
  });

  if (!res.ok) {
    throw new Error(`OpenAI API error: ${res.status}`);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let fullText = '';
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    
    const lines = buffer.split('\n');
    buffer = lines.pop() || ''; // Keep incomplete line in buffer

    for (const line of lines) {
      if (!line.startsWith('data: ')) continue;
      const data = line.slice(6);
      if (data === '[DONE]') {
        yield { type: 'done', fullText };
        return;
      }
      
      try {
        const json = JSON.parse(data);
        const content = json.choices?.[0]?.delta?.content || '';
        if (content) {
          fullText += content;
          yield { type: 'text', text: content };
        }
      } catch {}
    }
  }
}