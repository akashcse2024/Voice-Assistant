/**
 * Dashboard Routes — Call logs, transcripts, and analytics.
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { prisma } from '../db/prisma';
import { authMiddleware } from '../middleware/auth.middleware';
import { sessionManager } from '../services/session.service';
import type { AnalyticsResponse } from '../types';

export async function dashboardRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.addHook('preHandler', authMiddleware);

  /** GET /dashboard/calls — Paginated call logs */
  fastify.get('/calls', async (request: FastifyRequest, reply: FastifyReply) => {
    const q = request.query as { page?: string; limit?: string; status?: string; campaignId?: string };
    const page = parseInt(q.page ?? '1');
    const limit = Math.min(parseInt(q.limit ?? '50'), 100);
    const where: any = { isDeleted: false };
    if (q.status) where.status = q.status;
    if (q.campaignId) where.campaignId = q.campaignId;

    const [calls, total] = await Promise.all([
      prisma.callLog.findMany({ where, skip: (page - 1) * limit, take: limit, orderBy: { createdAt: 'desc' },
        select: { id: true, callSid: true, customerPhone: true, customerName: true, status: true, duration: true, escalated: true, callState: true, createdAt: true, campaign: { select: { name: true } } },
      }),
      prisma.callLog.count({ where }),
    ]);
    return reply.send({ data: calls, pagination: { page, limit, total, totalPages: Math.ceil(total / limit) } });
  });

  /** GET /dashboard/calls/:callId — Full transcript */
  fastify.get('/calls/:callId', async (request: FastifyRequest, reply: FastifyReply) => {
    const { callId } = request.params as { callId: string };
    const callLog = await prisma.callLog.findFirst({
      where: { OR: [{ id: callId }, { callSid: callId }], isDeleted: false },
      include: { events: { orderBy: { createdAt: 'asc' } }, leads: true, campaign: { select: { name: true } } },
    });
    if (!callLog) return reply.status(404).send({ error: 'Not Found' });
    return reply.send(callLog);
  });

  /** GET /dashboard/analytics — Aggregated stats */
  fastify.get('/analytics', async (request: FastifyRequest, reply: FastifyReply) => {
    const where = { isDeleted: false };
    const [totalCalls, callsByStatus, escalatedCalls, avgDuration, policyInterest] = await Promise.all([
      prisma.callLog.count({ where }),
      prisma.callLog.groupBy({ by: ['status'], where, _count: { _all: true } }),
      prisma.callLog.count({ where: { ...where, escalated: true } }),
      prisma.callLog.aggregate({ where: { ...where, duration: { not: null } }, _avg: { duration: true } }),
      prisma.lead.groupBy({ by: ['interestedIn'], where: { isDeleted: false, interestedIn: { not: null } }, _count: { _all: true } }),
    ]);

    const statusMap: Record<string, number> = {};
    callsByStatus.forEach((s) => { statusMap[s.status] = s._count._all; });
    const answeredCalls = (statusMap['COMPLETED'] ?? 0) + (statusMap['IN_PROGRESS'] ?? 0);
    const policyMap: Record<string, number> = {};
    policyInterest.forEach((p) => { if (p.interestedIn) policyMap[p.interestedIn] = p._count._all; });

    const analytics: AnalyticsResponse = {
      totalCalls, answeredCalls,
      answerRate: totalCalls > 0 ? Math.round((answeredCalls / totalCalls) * 100) / 100 : 0,
      averageDuration: Math.round(avgDuration._avg.duration ?? 0),
      escalationRate: totalCalls > 0 ? Math.round((escalatedCalls / totalCalls) * 100) / 100 : 0,
      policyInterest: policyMap, callsByStatus: statusMap,
    };
    return reply.send({ ...analytics, live: { activeCalls: sessionManager.getActiveCount() } });
  });

  /** GET /dashboard/live — SSE for live updates */
  fastify.get('/live', async (request: FastifyRequest, reply: FastifyReply) => {
    reply.raw.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
    reply.raw.write(`data: ${JSON.stringify({ type: 'initial', activeCalls: sessionManager.getActiveCalls() })}\n\n`);
    const hb = setInterval(() => {
      reply.raw.write(`data: ${JSON.stringify({ type: 'heartbeat', activeCalls: sessionManager.getActiveCount(), ts: new Date().toISOString() })}\n\n`);
    }, 10000);
    request.raw.on('close', () => clearInterval(hb));
  });
}
