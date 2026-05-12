/**
 * Test Routes — Text-based chat proxy for Groq.
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { generateChatResponse } from '../services/ai.service';

const chatSchema = z.object({
  messages: z.array(z.object({
    role: z.enum(['user', 'assistant']),
    content: z.string()
  })),
  agentName: z.string().default('Priya'),
  language: z.enum(['english', 'tamil']).default('english'),
});

export async function testRoutes(fastify: FastifyInstance): Promise<void> {
  /**
   * POST /test/chat — Proxy for Groq AI
   * Solves CORS issues by calling Groq from the backend.
   */
  fastify.post(
    '/chat',
    async (request: FastifyRequest, reply: FastifyReply) => {
      try {
        const body = chatSchema.parse(request.body);

        const replyText = await generateChatResponse(
          body.messages,
          body.agentName,
          body.language as 'english' | 'tamil'
        );

        return reply.send({ reply: replyText });
      } catch (err: any) {
        request.log.error(err);
        return reply.status(500).send({ error: err.message });
      }
    }
  );
}
