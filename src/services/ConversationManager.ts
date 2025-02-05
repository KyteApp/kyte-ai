import { BufferMemory } from 'langchain/memory';
import { MongoDBChatMessageHistory } from '@langchain/mongodb';
import { getDb } from '../config/mongodb.js';
import fastify from 'fastify';
import mongodb from '../config/mongodb.js';

export class ConversationManager {
  private memories: Map<string, BufferMemory>;
  private collection: any;
  private initialized: boolean = false;

  constructor() {
    this.memories = new Map();
  }

  async initialize() {
    if (!this.initialized) {
      try {
        const app = fastify({ logger: true });
        await app.register(mongodb);

        const db = getDb();
        this.collection = db.collection('chat-history');
        this.initialized = true;
      } catch (error) {
        console.error('Failed to initialize MongoDB connection:', error);
        throw error;
      }
    }
  }

  async getMemory(userId: string): Promise<BufferMemory> {
    if (!this.initialized) {
      await this.initialize();
    }

    if (!this.memories.has(userId)) {
      const chatHistory = new MongoDBChatMessageHistory({
        collection: this.collection,
        sessionId: userId,
      });

      const memory = new BufferMemory({
        chatHistory,
        returnMessages: true,
        memoryKey: 'chat_history',
        inputKey: 'input',
        outputKey: 'output',
      });

      this.memories.set(userId, memory);
    }
    return this.memories.get(userId)!;
  }
}
