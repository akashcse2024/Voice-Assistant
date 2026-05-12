/**
 * Escalation Service — Detects when a call should be handed off to a human agent.
 * Checks for escalation keywords, abusive language, and repeated failures.
 */

import { ESCALATION_KEYWORDS, ABUSIVE_PATTERNS, FALLBACK_RESPONSES } from '../config/constants';
import { sessionManager } from './session.service';
import { createModuleLogger } from '../utils/logger';

const log = createModuleLogger('escalation-service');

export interface EscalationResult {
  shouldEscalate: boolean;
  reason?: string;
}

/**
 * Check if a customer message triggers escalation
 */
export function checkEscalation(callSid: string, customerMessage: string): EscalationResult {
  const messageLower = customerMessage.toLowerCase();

  // Check for explicit escalation keywords
  for (const keyword of ESCALATION_KEYWORDS) {
    if (messageLower.includes(keyword.toLowerCase())) {
      log.warn({ callSid, keyword }, 'Escalation keyword detected');
      return {
        shouldEscalate: true,
        reason: `Customer used escalation keyword: "${keyword}"`,
      };
    }
  }

  // Check for abusive language patterns
  for (const pattern of ABUSIVE_PATTERNS) {
    if (pattern.test(customerMessage)) {
      log.warn({ callSid }, 'Abusive language detected');
      return {
        shouldEscalate: true,
        reason: 'Customer used abusive or distressed language',
      };
    }
  }

  // Check for claim status queries
  const claimPatterns = [
    /claim\s*(status|update|progress|where|when|track)/i,
    /where\s*is\s*my\s*claim/i,
    /check\s*(my|the)\s*claim/i,
    /pending\s*claim/i,
  ];

  for (const pattern of claimPatterns) {
    if (pattern.test(customerMessage)) {
      log.info({ callSid }, 'Claim status query detected — escalation required');
      return {
        shouldEscalate: true,
        reason: 'Customer asked about existing claim status (live data not accessible)',
      };
    }
  }

  return { shouldEscalate: false };
}

/**
 * Check if low-confidence threshold has been reached
 */
export function checkLowConfidenceEscalation(callSid: string): EscalationResult {
  const session = sessionManager.get(callSid);
  if (!session) return { shouldEscalate: false };

  if (session.consecutiveLowConfidence >= 3) {
    log.warn({ callSid, count: session.consecutiveLowConfidence }, 'Low confidence escalation');
    return {
      shouldEscalate: true,
      reason: `${session.consecutiveLowConfidence} consecutive low-confidence transcriptions`,
    };
  }

  return { shouldEscalate: false };
}

/**
 * Get the appropriate escalation message
 */
export function getEscalationMessage(reason?: string): string {
  return FALLBACK_RESPONSES.ESCALATION;
}

/**
 * Get the low-confidence retry message
 */
export function getLowConfidenceMessage(): string {
  return FALLBACK_RESPONSES.LOW_CONFIDENCE;
}
