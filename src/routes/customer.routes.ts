/**
 * Customer Routes — CRUD operations and CSV bulk upload.
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { parse } from 'csv-parse';
import { prisma } from '../db/prisma';
import { authMiddleware } from '../middleware/auth.middleware';
import { createModuleLogger } from '../utils/logger';
import type { CustomerCreateRequest } from '../types';

const log = createModuleLogger('customer-routes');

const customerCreateSchema = z.object({
  name: z.string().min(1, 'Name is required'),
  phone: z.string().min(10, 'Valid phone number required'),
  email: z.string().email().optional(),
  preferredCallStart: z.string().regex(/^\d{2}:\d{2}$/).optional(),
  preferredCallEnd: z.string().regex(/^\d{2}:\d{2}$/).optional(),
  timezone: z.string().optional(),
  doNotCall: z.boolean().optional(),
});

export async function customerRoutes(fastify: FastifyInstance): Promise<void> {
  // Apply auth to all customer routes
  fastify.addHook('preHandler', authMiddleware);

  /**
   * POST /customers — Add a single customer
   */
  fastify.post(
    '/',
    async (request: FastifyRequest, reply: FastifyReply) => {
      const body = customerCreateSchema.parse(request.body);

      // Check if phone already exists
      const existing = await prisma.customer.findUnique({
        where: { phone: body.phone },
      });

      if (existing && !existing.isDeleted) {
        return reply.status(409).send({
          error: 'Conflict',
          message: 'A customer with this phone number already exists',
        });
      }

      const customer = existing
        ? await prisma.customer.update({
            where: { phone: body.phone },
            data: { ...body, isDeleted: false },
          })
        : await prisma.customer.create({ data: body });

      log.info({ customerId: customer.id }, 'Customer created');

      return reply.status(201).send(customer);
    }
  );

  /**
   * POST /customers/upload — Bulk upload via CSV
   * CSV format: name,phone,email,preferredCallStart,preferredCallEnd
   */
  fastify.post(
    '/upload',
    async (request: FastifyRequest, reply: FastifyReply) => {
      const data = await request.file();

      if (!data) {
        return reply.status(400).send({
          error: 'Bad Request',
          message: 'No file uploaded. Send a CSV file.',
        });
      }

      const csvBuffer = await data.toBuffer();
      const csvString = csvBuffer.toString('utf-8');

      return new Promise<void>((resolve) => {
        const records: CustomerCreateRequest[] = [];
        const errors: string[] = [];

        const parser = parse(csvString, {
          columns: true,
          skip_empty_lines: true,
          trim: true,
        });

        parser.on('readable', () => {
          let record;
          while ((record = parser.read()) !== null) {
            try {
              const validated = customerCreateSchema.parse(record);
              records.push(validated);
            } catch (err) {
              errors.push(`Row error: ${JSON.stringify(record)} — ${(err as Error).message}`);
            }
          }
        });

        parser.on('end', async () => {
          let created = 0;
          let skipped = 0;

          for (const record of records) {
            try {
              await prisma.customer.upsert({
                where: { phone: record.phone },
                update: { ...record, isDeleted: false },
                create: record,
              });
              created++;
            } catch (err) {
              skipped++;
              errors.push(`Failed to insert ${record.phone}: ${(err as Error).message}`);
            }
          }

          log.info({ created, skipped, errors: errors.length }, 'CSV upload completed');

          reply.status(200).send({
            message: 'CSV upload completed',
            created,
            skipped,
            totalRows: records.length,
            errors: errors.length > 0 ? errors.slice(0, 10) : undefined,
          });
          resolve();
        });

        parser.on('error', (err) => {
          reply.status(400).send({
            error: 'CSV Parse Error',
            message: err.message,
          });
          resolve();
        });
      });
    }
  );

  /**
   * GET /customers — List all customers
   */
  fastify.get(
    '/',
    async (request: FastifyRequest, reply: FastifyReply) => {
      const query = request.query as {
        page?: string;
        limit?: string;
        doNotCall?: string;
        search?: string;
      };

      const page = parseInt(query.page ?? '1');
      const limit = Math.min(parseInt(query.limit ?? '50'), 100);
      const skip = (page - 1) * limit;

      const where: any = { isDeleted: false };

      if (query.doNotCall !== undefined) {
        where.doNotCall = query.doNotCall === 'true';
      }

      if (query.search) {
        where.OR = [
          { name: { contains: query.search, mode: 'insensitive' } },
          { phone: { contains: query.search } },
          { email: { contains: query.search, mode: 'insensitive' } },
        ];
      }

      const [customers, total] = await Promise.all([
        prisma.customer.findMany({
          where,
          skip,
          take: limit,
          orderBy: { createdAt: 'desc' },
        }),
        prisma.customer.count({ where }),
      ]);

      return reply.send({
        data: customers,
        pagination: {
          page,
          limit,
          total,
          totalPages: Math.ceil(total / limit),
        },
      });
    }
  );
}
