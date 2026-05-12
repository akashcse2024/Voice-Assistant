/**
 * Call Routes — Outbound call initiation and Twilio webhooks.
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { prisma } from '../db/prisma';
import { authMiddleware } from '../middleware/auth.middleware';
import { sessionManager } from '../services/session.service';
import { startCampaign, scheduleRetry } from '../services/campaign.service';
import { isWithinCallingHours } from '../utils/time-window';
import { createModuleLogger } from '../utils/logger';
import { maskPhone } from '../utils/pii-mask';
import type { OutboundCallRequest, BulkOutboundRequest } from '../types';

const log = createModuleLogger('call-routes');

// Validation schemas
const outboundCallSchema = z.object({
  phone: z.string().min(10, 'Phone number required'),
  name: z.string().optional(),
  campaignId: z.string().optional(),
});

const bulkOutboundSchema = z.object({
  customers: z.array(
    z.object({
      phone: z.string().min(10),
      name: z.string().optional(),
    })
  ).min(1, 'At least one customer required'),
  campaignName: z.string().optional(),
});

export async function callRoutes(fastify: FastifyInstance): Promise<void> {
  /**
   * POST /call/outbound — Initiate a single outbound call
   */
  fastify.post(
    '/call/outbound',
    { preHandler: [authMiddleware] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const body = outboundCallSchema.parse(request.body);

      // Check DNC
      const customer = await prisma.customer.findUnique({
        where: { phone: body.phone },
      });

      if (customer?.doNotCall) {
        return reply.status(403).send({
          error: 'Do Not Call',
          message: 'This customer is on the Do-Not-Call list',
        });
      }

      // Check calling hours
      const timezone = customer?.timezone ?? 'Asia/Kolkata';
      if (!isWithinCallingHours(timezone, customer?.preferredCallStart, customer?.preferredCallEnd)) {
        return reply.status(400).send({
          error: 'Outside calling hours',
          message: 'Current time is outside the allowed calling window for this customer',
        });
      }

      // Call generation stub (replaced Twilio with local log)
      const callSid = `local-${Date.now()}`;
      const status = 'queued';

      // Create call log record
      await prisma.callLog.create({
        data: {
          callSid,
          customerPhone: body.phone,
          customerName: body.name ?? customer?.name,
          customerId: customer?.id,
          campaignId: body.campaignId,
          status: 'INITIATED',
        },
      });

      // Update customer's lastCalledAt
      if (customer) {
        await prisma.customer.update({
          where: { id: customer.id },
          data: { lastCalledAt: new Date() },
        });
      }

      log.info({ callSid, phone: maskPhone(body.phone) }, 'Outbound call initiated via API');

      return reply.status(201).send({
        callId: callSid,
        status,
        message: 'Outbound call initiated',
      });
    }
  );

  /**
   * POST /call/bulk-outbound — Start a bulk campaign
   */
  fastify.post(
    '/call/bulk-outbound',
    { preHandler: [authMiddleware] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const body = bulkOutboundSchema.parse(request.body);

      const campaignName =
        body.campaignName ?? `Campaign ${new Date().toISOString().split('T')[0]}`;

      const { campaignId, totalCustomers } = await startCampaign({
        name: campaignName,
        customers: body.customers,
      });

      log.info({ campaignId, totalCustomers }, 'Bulk campaign started');

      return reply.status(201).send({
        campaignId,
        totalCustomers,
        message: 'Bulk campaign started. Calls will be made sequentially.',
      });
    }
  );

  // Twilio Webhooks removed. Telephony is now handled entirely via the /browser-stream WebSocket.
}
