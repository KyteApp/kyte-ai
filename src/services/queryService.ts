import { Pinecone } from '@pinecone-database/pinecone';
import { OpenAIEmbeddings } from '@langchain/openai';
import OpenAI from 'openai';
import dotenv from 'dotenv';
import NodeCache from 'node-cache';
import { MemoryVariables } from '@langchain/core/memory';
import { getDb } from '../config/mongodb.js';
import { ConversationManager } from './ConversationManager.js';

dotenv.config();

interface QueryVectorStoreOptions {
  topK?: number;
}

interface QueryEmbeddingsOptions extends QueryVectorStoreOptions {
  enableAPIQuery?: boolean;
  context?: any;
  language?: string;
  userId?: string;
}

interface QueryEmbeddingsResponse {
  matches: {
    text: any;
    language: any;
    source: any;
    score: any;
  }[];
  apiResults: any[];
  answer: string;
}

const pinecone = new Pinecone({ apiKey: process.env.PINECONE_API_KEY });
const index = pinecone.index(process.env.PINECONE_INDEX_NAME);
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const cache = new NodeCache({ stdTTL: 3600, maxKeys: 1000 });
const embeddings = new OpenAIEmbeddings({
  openAIApiKey: process.env.OPENAI_API_KEY,
  modelName: 'text-embedding-ada-002', // model that generates 1536 dimensions
});
const conversationManager = new ConversationManager();

async function retry<T>(fn: () => Promise<T>, maxRetries = 3): Promise<T> {
  for (let i = 0; i < maxRetries; i++) {
    try {
      return await fn();
    } catch (error) {
      if (i === maxRetries - 1) throw error;
      await new Promise((res) => setTimeout(res, 1000 * Math.pow(2, i)));
    }
  }
}

/**
 * Chama determinada vector store com base em contexto.
 * Placeholder para caso desejem implementar mais funcionalidades.
 */
async function queryVectorStore({
  storeName,
  queryVector,
  options = {},
}: {
  storeName: string;
  queryVector: number[];
  options: QueryVectorStoreOptions;
}) {
  if (storeName === 'pinecone') {
    return retry(() =>
      index.query({
        topK: options.topK || 5,
        vector: queryVector,
        includeMetadata: true,
      }),
    );
  }
  if (storeName === 'mongodb') {
    const db = getDb();
    const collection = db.collection('collectionDemo');

    const results = await collection
      .aggregate([
        {
          $search: {
            index: 'vectorIndex',
            knnBeta: {
              vector: queryVector,
              path: 'embedding',
              k: options.topK || 5,
            },
          },
        },
        {
          $project: {
            text: 1,
            metadata: 1,
            score: { $meta: 'searchScore' },
            _id: 0,
          },
        },
      ])
      .toArray();

    console.log('MongoDB results:', results);

    return {
      matches: results.map((doc) => ({
        metadata: {
          text: doc.text,
          ...doc.metadata,
        },
        score: doc.score,
      })),
    };
  }
  // Placeholder para incluir bases de conhecimento (vectore stores) diferentes.
  throw new Error(`Vector store "${storeName}" is not implemented.`);
}

/**
 *  Aqui está um placeholder para ilustrar como podemos utilizar
 *  o langchain para fazer chamadas de api com base em contexto.
 */
async function queryExternalAPI(apiName: string, payload: any) {
  // Implement API call logic here
  console.log(`Calling API: ${apiName} with payload:`, payload);
  return [{ data: 'Mock API response' }];
}

function formatChatHistory(chatHistory: MemoryVariables): string {
  if (!chatHistory.chat_history || !chatHistory.chat_history.length) {
    return 'No previous conversation';
  }

  return chatHistory.chat_history.map((msg: any) => `${msg.type}: ${msg.content}`).join('\n');
}

function formatContexts(contexts: any[]): string {
  return contexts.map((c) => c.text).join('\n\n');
}

export async function queryEmbeddings(
  query: string,
  options: QueryEmbeddingsOptions = {},
): Promise<QueryEmbeddingsResponse | any> {
  console.log(`Query: "${query}"`);

  const cacheKey = `${query}:${JSON.stringify(options)}`;
  const cachedResult = cache.get(cacheKey);
  if (cachedResult) {
    console.log('Using cached result');
    return cachedResult as QueryEmbeddingsResponse;
  }

  const queryVector = await retry(() => embeddings.embedQuery(query));

  // Retorna o contexto da vector store (base de conhecimento) primária (mongodb)
  const vectorResults = await queryVectorStore({
    storeName: 'mongodb',
    queryVector,
    options,
  });

  const contexts = vectorResults.matches.map((match: any) => ({
    text: match.metadata.text,
    language: match.metadata.language,
    source: match.metadata.source,
    score: match.score,
  }));

  const systemPrompt = process.env.SYSTEM_PROMPT;

  let apiResults = [];
  if (options.enableAPIQuery) {
    apiResults = await queryExternalAPI('mockAPI', { query, contexts });
  }

  const memory = await conversationManager.getMemory(options.userId);
  const chatHistory = await memory.loadMemoryVariables({});

  const content = [
    `Query: "${query}"`,
    '',
    'Chat History:',
    formatChatHistory(chatHistory),
    '',
    'Contexts:',
    formatContexts(contexts),
  ].join('\n');

  console.log('System Prompt:', content);

  const completion = await retry(() =>
    openai.chat.completions.create({
      model: 'gpt-4',
      messages: [
        { role: 'system', content: systemPrompt },
        {
          role: 'user',
          content,
        },
      ],
      temperature: 0.3,
    }),
  );

  // Save the interaction to memory
  await memory.saveContext({ input: query }, { output: completion.choices[0].message.content });

  const result: QueryEmbeddingsResponse = {
    matches: contexts,
    apiResults,
    answer: completion.choices[0].message.content,
  };

  cache.set(cacheKey, result);

  return result;
}

export function getLastConversation(userId: string) {
  return cache.get(`lastConversation:${userId}`);
}

export function setLastConversation(userId: string, conversation: any) {
  cache.set(`lastConversation:${userId}`, conversation, 86400);
}
