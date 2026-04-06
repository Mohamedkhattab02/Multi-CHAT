interface StreamEvent {
  type: 'text' | 'done';
  text?: string;
  fullText?: string;
  usage?: { inputTokens: number; outputTokens: number; cost: number };
}

export async function* streamGemini(options: {
  systemPrompt: string;
  messages: any[];
  model: string;
  enableSearch?: boolean;
}): AsyncGenerator<StreamEvent> {
  const apiKey = process.env.GOOGLE_AI_API_KEY;
  const baseUrl = 'https://generativelanguage.googleapis.com/v1beta/models';
  
  const modelId = options.model; // e.g., 'gemini-3.1-pro', 'gemini-3-flash'
  
  const requestBody: any = {
    system_instruction: options.systemPrompt,
    contents: options.messages,
  };

  if (options.enableSearch) {
    requestBody.tools = [{
      "functionDeclarations": [{ "name": "google_search", "description": "Search the web", "parameters": {} }]
    }];
    requestBody.tool_choice = "auto";
  }

  const res = await fetch(`${baseUrl}/${modelId}:streamGenerateContent?alt=sse`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-goog-api-key': apiKey,
    },
    body: JSON.stringify(requestBody),
  });

  if (!res.ok) {
    throw new Error(`Gemini API error: ${res.status}`);
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

    for (const endpoint of lines) {
      if (!endpoint.startsWith('data: ')) continue;
      const data = endpoint.slice(6);
      if (data === '[DONE]') {
        yield { type: 'done', fullText };
        return;
      }

      try {
        const json = JSON.parse(data);
        const parts = json.candidates?.[0]?.content?.parts;
        if (parts) {
          for (const part of parts) {
            if (part.text) {
              fullText += part.text;
              yield { type: 'text', text: part.text };
            }
          }
        }
      } catch {}
    }
  }
}