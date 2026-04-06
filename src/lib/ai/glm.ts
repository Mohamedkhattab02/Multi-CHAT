interface StreamEvent {
  type: 'text' | 'done';
  text?: string;
  fullText?: string;
}

export async function* streamGLM(options: {
  systemPrompt: string;
  messages: any[];
}): AsyncGenerator<StreamEvent> {
  const res = await fetch('https://open.bigmodel.cn/api/v4/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${process.env.GLM_API_KEY}`,
    },
    body: JSON.stringify({
      model: 'glm-5',
      messages: [
        { role: 'system', content: options.systemPrompt },
        ...options.messages,
      ],
      stream: true,
    }),
  });

  if (!res.ok) {
    throw new Error(`GLM API error: ${res.status}`);
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
    buffer = lines.pop() || '';

    for (const line of lines) {
      if (!line.startsWith('data: ')) continue;
      const data = line.slice(6);
      
      try {
        const json = JSON.parse(data);
        const content = json.choices?.[0]?.delta?.content || '';
        if (content) {
          fullText += content;
          yield { type: 'text', text: content };
        }
        if (json.choices?.[0]?.finish_reason === 'stop') {
          yield { type: 'done', fullText };
          return;
        }
      } catch {}
    }
  }
}