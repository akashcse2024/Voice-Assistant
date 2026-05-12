/**
 * Session Manager — In-memory session store for active calls.
 * Each call gets an isolated session with conversation history,
 * customer metadata, and collected data points.
 */

import type { CallState } from '@prisma/client';
import type { CallSession, ConversationMessage, CollectedData } from '../types';
import { createModuleLogger } from '../utils/logger';
import { maskPhone } from '../utils/pii-mask';

const log = createModuleLogger('session-manager');

class SessionManager {
  private sessions: Map<string, CallSession> = new Map();

  /**
   * Create a new call session
   */
  create(params: {
    callSid: string;
    customerPhone: string;
    customerName?: string;
    customerId?: string;
    campaignId?: string;
  }): CallSession {
    const session: CallSession = {
      callSid: params.callSid,
      customerId: params.customerId,
      customerPhone: params.customerPhone,
      customerName: params.customerName,
      campaignId: params.campaignId,
      conversationHistory: [],
      collectedData: {
        objections: [],
        intentToBuy: false,
        additionalNotes: [],
      },
      callState: 'GREETING',
      lowConfidenceCount: 0,
      consecutiveLowConfidence: 0,
      startedAt: new Date(),
      lastActivityAt: new Date(),
      isPlayingAudio: false,
    };

    this.sessions.set(params.callSid, session);
    log.info(
      { callSid: params.callSid, phone: maskPhone(params.customerPhone) },
      'Session created'
    );

    return session;
  }

  /**
   * Get an active session by call SID
   */
  get(callSid: string): CallSession | undefined {
    return this.sessions.get(callSid);
  }

  /**
   * Check if a session exists
   */
  has(callSid: string): boolean {
    return this.sessions.has(callSid);
  }

  /**
   * Add a message to the conversation history
   */
  addMessage(callSid: string, message: ConversationMessage): void {
    const session = this.sessions.get(callSid);
    if (!session) {
      log.warn({ callSid }, 'Attempted to add message to non-existent session');
      return;
    }

    session.conversationHistory.push(message);
    session.lastActivityAt = new Date();
  }

  /**
   * Update the call state
   */
  updateState(callSid: string, state: CallState): void {
    const session = this.sessions.get(callSid);
    if (!session) return;

    const previousState = session.callState;
    session.callState = state;
    session.lastActivityAt = new Date();

    log.info({ callSid, previousState, newState: state }, 'Call state changed');
  }

  /**
   * Update collected data from the conversation
   */
  updateCollectedData(callSid: string, data: Partial<CollectedData>): void {
    const session = this.sessions.get(callSid);
    if (!session) return;

    if (data.interestedPolicy) session.collectedData.interestedPolicy = data.interestedPolicy;
    if (data.intentToBuy !== undefined) session.collectedData.intentToBuy = data.intentToBuy;
    if (data.preferredCallbackTime)
      session.collectedData.preferredCallbackTime = data.preferredCallbackTime;
    if (data.objections) session.collectedData.objections.push(...data.objections);
    if (data.additionalNotes) session.collectedData.additionalNotes.push(...data.additionalNotes);

    session.lastActivityAt = new Date();
  }

  /**
   * Set the stream SID for audio streaming
   */
  setStreamSid(callSid: string, streamSid: string): void {
    const session = this.sessions.get(callSid);
    if (!session) return;
    session.streamSid = streamSid;
  }

  /**
   * Track low-confidence STT results
   * Returns true if escalation threshold is reached
   */
  recordLowConfidence(callSid: string): boolean {
    const session = this.sessions.get(callSid);
    if (!session) return false;

    session.lowConfidenceCount++;
    session.consecutiveLowConfidence++;

    const shouldEscalate = session.consecutiveLowConfidence >= 3;
    if (shouldEscalate) {
      log.warn({ callSid }, 'Low confidence escalation threshold reached');
    }

    return shouldEscalate;
  }

  /**
   * Reset consecutive low-confidence counter (called on successful transcription)
   */
  resetLowConfidence(callSid: string): void {
    const session = this.sessions.get(callSid);
    if (!session) return;
    session.consecutiveLowConfidence = 0;
  }

  /**
   * Set audio playback state (for barge-in detection)
   */
  setPlayingAudio(callSid: string, isPlaying: boolean): void {
    const session = this.sessions.get(callSid);
    if (!session) return;
    session.isPlayingAudio = isPlaying;
  }

  /**
   * Delete a session and return its data for persistence
   */
  destroy(callSid: string): CallSession | undefined {
    const session = this.sessions.get(callSid);
    if (session) {
      this.sessions.delete(callSid);
      log.info(
        {
          callSid,
          duration: Date.now() - session.startedAt.getTime(),
          messageCount: session.conversationHistory.length,
        },
        'Session destroyed'
      );
    }
    return session;
  }

  /**
   * Get count of active sessions
   */
  getActiveCount(): number {
    return this.sessions.size;
  }

  /**
   * Get all active call SIDs
   */
  getActiveCalls(): string[] {
    return Array.from(this.sessions.keys());
  }

  /**
   * Build conversation context for the AI model
   */
  getConversationContext(callSid: string): Array<{ role: string; content: string }> {
    const session = this.sessions.get(callSid);
    if (!session) return [];

    return session.conversationHistory.map((msg) => ({
      role: msg.role === 'assistant' ? 'model' : 'user',
      content: msg.content,
    }));
  }
}

// Singleton
export const sessionManager = new SessionManager();
