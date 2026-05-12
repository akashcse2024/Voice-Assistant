/**
 * Lead Routes — CRUD operations with filtering.
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { prisma } from '../db/prisma';
import { authMiddleware } from '../middleware/auth.middleware';
import { createModuleLogger } from '../utils/logger';

const log = createModuleLogger('lead-routes');

const leadCreateSchema = z.object({
  phone: z.string().min(10),
  name: z.string().optional(),
  interestedIn: z.enum(['HEALTH', 'MOTOR', 'LIFE', 'HOME']).optional(),
  callSid: z.string().optional(),
  objections: z.string().optional(),
  status: z.enum(['NEW', 'CONTACTED', 'FOLLOW_UP', 'CONVERTED', 'LOST']).optional(),
  notes: z.string().optional(),
});

const leadUpdateSchema = leadCreateSchema.partial();

export async function leadRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.addHook('preHandler', authMiddleware);

  /**
   * POST /leads — Create or update a lead
   */
  fastify.post(
    '/',
    async (request: FastifyRequest, reply: FastifyReply) => {
      const body = leadCreateSchema.parse(request.body);

      // Link to call log if callSid provided
      let callLogId: string | undefined;
      let customerId: string | undefined;

      if (body.callSid) {
        const callLog = await prisma.callLog.findUnique({
          where: { callSid: body.callSid },
        });
        callLogId = callLog?.id;
        customerId = callLog?.customerId ?? undefined;
      }

      // Check if customer exists
      if (!customerId) {
        const customer = await prisma.customer.findUnique({
          where: { phone: body.phone },
        });
        customerId = customer?.id;
      }

      const lead = await prisma.lead.create({
        data: {
          phone: body.phone,
          name: body.name,
          interestedIn: body.interestedIn as any,
          callLogId,
          customerId,
          objections: body.objections,
          status: (body.status as any) ?? 'NEW',
          notes: body.notes,
        },
      });

      log.info({ leadId: lead.id, phone: body.phone }, 'Lead created');

      return reply.status(201).send(lead);
    }
  );

  /**
   * GET /leads — List leads with filters
   */
  fastify.get(
    '/',
    async (request: FastifyRequest, reply: FastifyReply) => {
      const query = request.query as {
        page?: string;
        limit?: string;
        status?: string;
        interestedIn?: string;
        dateFrom?: string;
        dateTo?: string;
        search?: string;
      };

      const page = parseInt(query.page ?? '1');
      const limit = Math.min(parseInt(query.limit ?? '50'), 100);
      const skip = (page - 1) * limit;

      const where: any = { isDeleted: false };

      if (query.status) {
        where.status = query.status;
      }

      if (query.interestedIn) {
        where.interestedIn = query.interestedIn;
      }

      if (query.dateFrom || query.dateTo) {
        where.createdAt = {};
        if (query.dateFrom) where.createdAt.gte = new Date(query.dateFrom);
        if (query.dateTo) where.createdAt.lte = new Date(query.dateTo);
      }

      if (query.search) {
        where.OR = [
          { name: { contains: query.search, mode: 'insensitive' } },
          { phone: { contains: query.search } },
        ];
      }

      const [leads, total] = await Promise.all([
        prisma.lead.findMany({
          where,
          skip,
          take: limit,
          orderBy: { createdAt: 'desc' },
          include: {
            callLog: {
              select: { callSid: true, status: true, createdAt: true },
            },
          },
        }),
        prisma.lead.count({ where }),
      ]);

      return reply.send({
        data: leads,
        pagination: {
          page,
          limit,
          total,
          totalPages: Math.ceil(total / limit),
        },
      });
    }
  );

  /**
   * PATCH /leads/:id — Update a lead
   */
  fastify.patch(
    '/:id',
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = request.params as { id: string };
      const body = leadUpdateSchema.parse(request.body);

      const lead = await prisma.lead.update({
        where: { id },
        data: body as any,
      });

      return reply.send(lead);
    }
  );
}
