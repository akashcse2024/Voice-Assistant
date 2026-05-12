import { PrismaClient } from '@prisma/client';
import { env, isConfigured } from '../config/env';
import { logger } from '../utils/logger';

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

/** Prisma client — may be null if DATABASE_URL is not configured */
export const prisma: PrismaClient = globalForPrisma.prisma ?? new PrismaClient({
  log: env.NODE_ENV === 'development' ? ['error', 'warn'] : ['error'],
  datasourceUrl: isConfigured.database() ? env.DATABASE_URL : undefined,
});

if (env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma;
}

/** Whether the database is available */
let dbConnected = false;

/**
 * Test database connectivity — skips if DATABASE_URL is not set
 */
export async function connectDatabase(): Promise<void> {
  if (!isConfigured.database()) {
    logger.warn('⚠️  DATABASE_URL not configured — running without database. Data will NOT be persisted.');
    return;
  }

  try {
    await prisma.$connect();
    dbConnected = true;
    logger.info('✅ Database connected successfully');
  } catch (error) {
    logger.error({ err: error }, '❌ Database connection failed — running without database');
  }
}

/**
 * Check if database is connected
 */
export function isDatabaseConnected(): boolean {
  return dbConnected;
}

/**
 * Graceful disconnect
 */
export async function disconnectDatabase(): Promise<void> {
  if (dbConnected) {
    await prisma.$disconnect();
    logger.info('Database disconnected');
  }
}
