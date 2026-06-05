/**
 * SafeShield Voice Assistant — Server Entry Point
 *
 * AI-Powered Outbound Insurance Voice Assistant
 * Starts in development mode even without all third-party services configured.
 */

import Fastify from 'fastify';
import cors from '@fastify/cors';
import multipart from '@fastify/multipart';
import websocket from '@fastify/websocket';
import fastifyStatic from '@fastify/static';
import formbody from '@fastify/formbody';
import path from 'path';
import { env, isConfigured } from './config/env';
import { connectDatabase, disconnectDatabase } from './db/prisma';
import { errorHandler } from './middleware/error-handler';
import { callRoutes } from './routes/call.routes';
import { customerRoutes } from './routes/customer.routes';
import { leadRoutes } from './routes/lead.routes';
import { dashboardRoutes } from './routes/dashboard.routes';
import { testRoutes } from './routes/test.routes';
import { ttsRoutes } from './routes/tts.routes';
import { handleBrowserStream } from './pipeline/browser-stream';
import { handleTwilioStream } from './pipeline/twilio-stream';
import { preloadGreeting } from './pipeline/voice-pipeline';
import { preloadTTSVoices } from './services/tts.service';
import { logger } from './utils/logger';

async function main() {
  const fastify = Fastify({
    logger: false,
    bodyLimit: 10 * 1024 * 1024,
  });

  // ========== Plugins ==========
  await fastify.register(cors, { origin: true, credentials: true });
  await fastify.register(multipart, { limits: { fileSize: 10 * 1024 * 1024 } });
  await fastify.register(websocket);
  await fastify.register(formbody);

  // ========== Error Handler ==========
  fastify.setErrorHandler(errorHandler);

  // ========== Health Check ==========
  fastify.get('/health', async () => ({
    status: 'ok',
    service: 'Vizza Insure AI',
    version: '1.0.0',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    services: {
      database: isConfigured.database() ? 'configured' : 'not configured',
      twilio: isConfigured.twilio() ? 'configured' : 'not configured',
      deepgram: isConfigured.deepgram() ? 'configured' : 'not configured',
      groq: isConfigured.groq() ? 'configured' : 'not configured',
    },
  }));

  // ========== Static Files ==========
  await fastify.register(fastifyStatic, {
    root: path.join(__dirname, '../public'),
    prefix: '/',
    decorateReply: true,
  });

  // ========== Routes ==========
  await fastify.register(callRoutes, { prefix: '/api/call' });
  await fastify.register(customerRoutes, { prefix: '/customers' });
  await fastify.register(leadRoutes, { prefix: '/leads' });
  await fastify.register(dashboardRoutes, { prefix: '/dashboard' });
  await fastify.register(testRoutes, { prefix: '/test' });
  await fastify.register(ttsRoutes, { prefix: '/api' });

  // ========== WebSocket ==========
  fastify.register(async function (app) {
    app.get('/browser-stream', { websocket: true }, (socket: any) => {
      handleBrowserStream(socket);
    });

    app.get('/api/calls/media-stream', { websocket: true }, (socket: any) => {
      handleTwilioStream(socket);
    });
  });

  // ========== Database (optional) ==========
  await connectDatabase();

  // ========== Start Server ==========
  try {
    await preloadTTSVoices();
    await preloadGreeting('Priya');
    logger.info('Preloaded greeting audio.');
    const address = await fastify.listen({ port: env.PORT, host: env.HOST });

    const check = (ok: boolean) => (ok ? '✅' : '❌');

    logger.info(`
╔═══════════════════════════════════════════════════════════╗
║             Vizza Insure AI API Server             ║
╠═══════════════════════════════════════════════════════════╣
║  URL:        ${address.padEnd(44)}║
║  Mode:       ${env.NODE_ENV.padEnd(44)}║
╠═══════════════════════════════════════════════════════════╣
║  Services:                                                 ║
║    ${check(isConfigured.database())} Database (PostgreSQL)                           ║
║    ${check(isConfigured.groq())} Groq AI (conversation engine)                      ║
║    ${check(isConfigured.twilio())} Twilio (telephony)                               ║
║    ${check(isConfigured.deepgram())} Deepgram (speech-to-text)                        ║
╠═══════════════════════════════════════════════════════════╣
║  Endpoints ready:                                          ║
║    GET  /public/browser-call.html — Web Voice Test (Mic)   ║
║    POST /test/chat      — AI chat (works without telephony)║
║    GET  /health         — Health check                     ║
║    GET  /dashboard/*    — Dashboard APIs                   ║
║    POST /call/outbound  — Outbound calls (needs Twilio)    ║
╚═══════════════════════════════════════════════════════════╝
    `);

    if (!isConfigured.groq()) {
      logger.warn('⚠️  GROQ_API_KEY not set — AI features will fail. Get a key at https://console.groq.com');
    }
    if (!isConfigured.database()) {
      logger.warn('⚠️  DATABASE_URL not set — API endpoints that need the database will fail. Set up Supabase (free) at https://supabase.com');
    }
  } catch (err) {
    logger.error(err, 'Failed to start server');
    process.exit(1);
  }

  // ========== Graceful Shutdown ==========
  const shutdown = async (signal: string) => {
    logger.info(`${signal} received — shutting down`);
    await fastify.close();
    await disconnectDatabase();
    process.exit(0);
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

main().catch((err) => {
  logger.error(err, 'Fatal startup error');
  process.exit(1);
});
