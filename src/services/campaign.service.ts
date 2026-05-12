/**
 * Campaign Service — Bulk outbound call orchestration.
 * Manages campaign creation, sequential dialing with delays,
 * retry logic, and DNC/time-window compliance.
 */

import { prisma } from '../db/prisma';
import { env } from '../config/env';
import { sessionManager } from './session.service';
import { isWithinCallingHours } from '../utils/time-window';
import { createModuleLogger } from '../utils/logger';
import { maskPhone } from '../utils/pii-mask';

const log = createModuleLogger('campaign-service');

// Simple in-memory queue for campaigns (can be upgraded to BullMQ with Redis)
const activeCampaigns: Map<string, { paused: boolean; abortController: AbortController }> =
  new Map();

/**
 * Create a new campaign and start dialing
 */
export async function startCampaign(params: {
  name: string;
  customers: Array<{ phone: string; name?: string }>;
}): Promise<{ campaignId: string; totalCustomers: number }> {
  // Create campaign record
  const campaign = await prisma.campaign.create({
    data: {
      name: params.name,
      totalCustomers: params.customers.length,
      status: 'ACTIVE',
    },
  });

  log.info(
    { campaignId: campaign.id, customerCount: params.customers.length },
    'Campaign created'
  );

  // Start async dialing in the background
  const abortController = new AbortController();
  activeCampaigns.set(campaign.id, { paused: false, abortController });

  // Fire and forget — the dialing loop runs in background
  dialCampaignCustomers(campaign.id, params.customers, abortController.signal).catch(
    (err) => {
      log.error({ campaignId: campaign.id, err }, 'Campaign dialing error');
    }
  );

  return { campaignId: campaign.id, totalCustomers: params.customers.length };
}

/**
 * Sequential dialing loop for a campaign
 */
async function dialCampaignCustomers(
  campaignId: string,
  customers: Array<{ phone: string; name?: string }>,
  signal: AbortSignal
): Promise<void> {
  for (let i = 0; i < customers.length; i++) {
    if (signal.aborted) {
      log.info({ campaignId }, 'Campaign aborted');
      break;
    }

    const campaignState = activeCampaigns.get(campaignId);
    if (campaignState?.paused) {
      // Wait while paused
      while (campaignState.paused && !signal.aborted) {
        await delay(5000);
      }
    }

    const customer = customers[i];

    try {
      // Check DNC flag
      const dbCustomer = await prisma.customer.findUnique({
        where: { phone: customer.phone },
      });

      if (dbCustomer?.doNotCall) {
        log.info(
          { phone: maskPhone(customer.phone) },
          'Skipping DNC-flagged customer'
        );
        continue;
      }

      // Check calling hours
      const timezone = dbCustomer?.timezone ?? 'Asia/Kolkata';
      if (
        !isWithinCallingHours(
          timezone,
          dbCustomer?.preferredCallStart,
          dbCustomer?.preferredCallEnd
        )
      ) {
        log.info(
          { phone: maskPhone(customer.phone) },
          'Skipping — outside calling hours'
        );
        continue;
      }

      // Local stub for call creation
      const callSid = `local-${Date.now()}`;

      // Record the call log
      await prisma.callLog.create({
        data: {
          callSid,
          customerPhone: customer.phone,
          customerName: customer.name ?? dbCustomer?.name,
          customerId: dbCustomer?.id,
          campaignId,
          status: 'INITIATED',
        },
      });

      // Update campaign counters
      await prisma.campaign.update({
        where: { id: campaignId },
        data: { callsMade: { increment: 1 } },
      });

      // Enforce 2-second minimum gap between calls
      await delay(env.INTER_CALL_DELAY_MS);
    } catch (error) {
      log.error(
        { campaignId, phone: maskPhone(customer.phone), err: error },
        'Failed to dial customer in campaign'
      );
    }
  }

  // Mark campaign as completed
  await prisma.campaign.update({
    where: { id: campaignId },
    data: { status: 'COMPLETED' },
  });

  activeCampaigns.delete(campaignId);
  log.info({ campaignId }, 'Campaign completed');
}

/**
 * Pause an active campaign
 */
export function pauseCampaign(campaignId: string): boolean {
  const campaign = activeCampaigns.get(campaignId);
  if (!campaign) return false;
  campaign.paused = true;
  log.info({ campaignId }, 'Campaign paused');
  return true;
}

/**
 * Resume a paused campaign
 */
export function resumeCampaign(campaignId: string): boolean {
  const campaign = activeCampaigns.get(campaignId);
  if (!campaign) return false;
  campaign.paused = false;
  log.info({ campaignId }, 'Campaign resumed');
  return true;
}

/**
 * Abort a campaign
 */
export async function abortCampaign(campaignId: string): Promise<boolean> {
  const campaign = activeCampaigns.get(campaignId);
  if (!campaign) return false;

  campaign.abortController.abort();
  activeCampaigns.delete(campaignId);

  await prisma.campaign.update({
    where: { id: campaignId },
    data: { status: 'PAUSED' },
  });

  log.info({ campaignId }, 'Campaign aborted');
  return true;
}

/**
 * Handle call retry logic for unanswered/busy calls
 */
export async function scheduleRetry(callSid: string): Promise<void> {
  const callLog = await prisma.callLog.findUnique({ where: { callSid } });
  if (!callLog) return;

  if (callLog.retryCount >= env.MAX_CALL_RETRY_COUNT) {
    log.info(
      { callSid, retryCount: callLog.retryCount },
      'Max retries reached — marking as failed'
    );
    await prisma.callLog.update({
      where: { callSid },
      data: { status: 'FAILED' },
    });
    return;
  }

  // Schedule retry after configured delay
  const retryDelayMs = env.RETRY_DELAY_MINUTES * 60 * 1000;
  log.info(
    { callSid, retryCount: callLog.retryCount + 1, delayMinutes: env.RETRY_DELAY_MINUTES },
    'Scheduling call retry'
  );

  setTimeout(async () => {
    try {
      const newCallSid = `local-${Date.now()}`;

      await prisma.callLog.create({
        data: {
          callSid: newCallSid,
          customerPhone: callLog.customerPhone,
          customerName: callLog.customerName,
          customerId: callLog.customerId,
          campaignId: callLog.campaignId,
          retryCount: callLog.retryCount + 1,
          status: 'INITIATED',
        },
      });
    } catch (error) {
      log.error({ callSid, err: error }, 'Retry call failed');
    }
  }, retryDelayMs);
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
