// Quick test script for RAG pipeline layers
// Run with: npx tsx scripts/test-rag.ts

import { config } from 'dotenv';
import { resolve } from 'path';

config({ path: resolve(process.cwd(), '.env.local') });

const VOYAGE_KEY = process.env.VOYAGE_AI_API_KEY;
const GOOGLE_KEY = process.env.GOOGLE_AI_API_KEY;
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

function log(label: string, ok: boolean, detail?: string) {
  const icon = ok ? '✅' : '❌';
  console.log(`${icon} ${label}${detail ? ` — ${detail}` : ''}`);
}

async function testVoyageEmbedding() {
  try {
    const res = await fetch('https://api.voyageai.com/v1/embeddings', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${VOYAGE_KEY}`,
      },
      body: JSON.stringify({
        model: 'voyage-3-large',
        input: 'test embedding',
        input_type: 'document',
      }),
    });
    if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
    const data = await res.json();
    const dims = data.data[0].embedding.length;
    log('Voyage AI Embedding', true, `${dims} dimensions`);
  } catch (e: any) {
    log('Voyage AI Embedding', false, e.message);
  }
}

async function testVoyageReranker() {
  try {
    const res = await fetch('https://api.voyageai.com/v1/rerank', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${VOYAGE_KEY}`,
      },
      body: JSON.stringify({
        model: 'rerank-2',
        query: 'what is javascript',
        documents: [
          'JavaScript is a programming language',
          'The weather is nice today',
          'JS runs in the browser',
        ],
        top_k: 2,
      }),
    });
    if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
    const data = await res.json();
    log('Voyage AI Reranker', true, `returned ${data.data.length} results`);
  } catch (e: any) {
    log('Voyage AI Reranker', false, e.message);
  }
}

async function testClassifier() {
  try {
    const { GoogleGenerativeAI } = require('@google/generative-ai');
    const genAI = new GoogleGenerativeAI(GOOGLE_KEY!);
    const model = genAI.getGenerativeModel({
      model: 'gemini-2.5-flash',
      generationConfig: { maxOutputTokens: 300, temperature: 0 },
    });

    // Test with simple Hebrew message
    const result = await model.generateContent({
      contents: [
        {
          role: 'user',
          parts: [{ text: 'Classify this message complexity (low/medium/high). Return JSON only: {"complexity":"..."}\n\nMessage: שלום מה שלומך' }],
        },
      ],
    });
    const text = result.response.text();
    const json = JSON.parse(text.match(/\{[\s\S]*\}/)![0]);
    log('Classifier (Hebrew "שלום מה שלומך")', json.complexity === 'low', `complexity: ${json.complexity}`);

    // Test with English complex message
    const result2 = await model.generateContent({
      contents: [
        {
          role: 'user',
          parts: [{ text: 'Classify this message complexity (low/medium/high). Return JSON only: {"complexity":"..."}\n\nMessage: Write a recursive function to solve the N-queens problem with backtracking' }],
        },
      ],
    });
    const text2 = result2.response.text();
    const match2 = text2.match(/\{[\s\S]*\}/);
    if (!match2) {
      log('Classifier (complex code question)', false, `raw response: ${text2.slice(0, 100)}`);
    } else {
      const json2 = JSON.parse(match2[0]);
      log('Classifier (complex code question)', json2.complexity === 'high', `complexity: ${json2.complexity}`);
    }
  } catch (e: any) {
    log('Classifier (Gemini 2.5 Flash)', false, e.message);
  }
}

async function testSupabaseRPC() {
  try {
    const { createClient } = require('@supabase/supabase-js');
    const supabase = createClient(SUPABASE_URL!, SUPABASE_KEY!);

    // Just test that the RPC function exists (will return empty if no data)
    const fakeEmbedding = new Array(1024).fill(0);
    const { error } = await supabase.rpc('hybrid_search', {
      query_text: 'test',
      query_embedding: fakeEmbedding,
      target_user_id: '00000000-0000-0000-0000-000000000000',
      match_count: 5,
      full_text_weight: 1.0,
      semantic_weight: 1.5,
      fuzzy_weight: 0.5,
    });

    if (error) throw new Error(error.message);
    log('Supabase hybrid_search RPC', true, 'function exists and callable');
  } catch (e: any) {
    log('Supabase hybrid_search RPC', false, e.message);
  }
}

async function main() {
  console.log('\n🔍 Testing RAG Pipeline Components\n');
  console.log('--- API Keys ---');
  log('VOYAGE_AI_API_KEY', !!VOYAGE_KEY, VOYAGE_KEY ? `${VOYAGE_KEY.slice(0, 8)}...` : 'MISSING');
  log('GOOGLE_AI_API_KEY', !!GOOGLE_KEY, GOOGLE_KEY ? `${GOOGLE_KEY.slice(0, 8)}...` : 'MISSING');
  log('SUPABASE_URL', !!SUPABASE_URL, SUPABASE_URL || 'MISSING');
  log('SUPABASE_SERVICE_ROLE_KEY', !!SUPABASE_KEY, SUPABASE_KEY ? `${SUPABASE_KEY.slice(0, 8)}...` : 'MISSING');

  console.log('\n--- Services ---');
  await testVoyageEmbedding();
  await testVoyageReranker();
  await testClassifier();
  await testSupabaseRPC();
  console.log('\nDone!\n');
}

main().catch(console.error);
