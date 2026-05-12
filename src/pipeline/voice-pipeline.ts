/**
 * Voice Pipeline — Orchestrates the STT → AI → TTS flow.
 * Manages the complete lifecycle of a single voice interaction turn.
 */

import { env } from '../config/env';
import { sessionManager } from '../services/session.service';
import { generateCallResponse, generateGreeting, analyzeIntent } from '../services/ai.service';
import { synthesizeSpeech, synthesizeSpeechHindi, isHindiText } from '../services/tts.service';
import {
  checkEscalation,
  checkLowConfidenceEscalation,
  getEscalationMessage,
  getLowConfidenceMessage,
} from '../services/escalation.service';
import { createModuleLogger } from '../utils/logger';
import { bufferToBase64, splitIntoChunks } from '../utils/audio';
import { prisma } from '../db/prisma';
import type { ConversationMessage, PipelineResult, STTResult } from '../types';
import type { PolicyType } from '@prisma/client';

const log = createModuleLogger('voice-pipeline');

/**
 * Process a customer's speech and return AI audio response
 */
export async function processUtterance(
  callSid: string,
  sttResult: STTResult
): Promise<PipelineResult | null> {
  const startTime = Date.now();
  const session = sessionManager.get(callSid);

  if (!session) {
    log.warn({ callSid }, 'No session found for utterance processing');
    return null;
  }

  const { transcript, confidence } = sttResult;

  // ========== Low Confidence Check ==========
  if (confidence < env.STT_CONFIDENCE_THRESHOLD) {
    const shouldEscalate = sessionManager.recordLowConfidence(callSid);

    if (shouldEscalate) {
      // Escalate after 3 consecutive low-confidence
      return await buildEscalationResponse(callSid, 'Repeated low-confidence transcription');
    }

    // Ask customer to repeat
    const retryMessage = getLowConfidenceMessage();
    const audioResult = await synthesizeSpeech(retryMessage);
    const chunks = splitIntoChunks(audioResult.audioContent);

    return {
      aiResponse: retryMessage,
      audioChunks: chunks,
      processingTimeMs: Date.now() - startTime,
    };
  }

  // Reset low-confidence counter on successful transcription
  sessionManager.resetLowConfidence(callSid);

  // ========== Log customer message ==========
  const customerMessage: ConversationMessage = {
    role: 'customer',
    content: transcript,
    timestamp: new Date().toISOString(),
    confidence,
  };
  sessionManager.addMessage(callSid, customerMessage);

  // Log call event
  await logCallEvent(callSid, 'utterance_received', {
    transcript,
    confidence,
  });

  // ========== Escalation Check ==========
  const escalationCheck = checkEscalation(callSid, transcript);
  if (escalationCheck.shouldEscalate) {
    return await buildEscalationResponse(callSid, escalationCheck.reason!);
  }

  // ========== Generate AI Response ==========
  const aiResponse = await generateCallResponse(callSid, transcript);

  // Log assistant message
  const assistantMessage: ConversationMessage = {
    role: 'assistant',
    content: aiResponse,
    timestamp: new Date().toISOString(),
  };
  sessionManager.addMessage(callSid, assistantMessage);

  // Log AI response event
  await logCallEvent(callSid, 'ai_response_sent', {
    response: aiResponse,
  });

  // ========== Analyze intent (async, non-blocking) ==========
  analyzeIntent(transcript)
    .then((intent) => {
      if (intent.interestedPolicy) {
        const policyMap: Record<string, PolicyType> = {
          health: 'HEALTH',
          motor: 'MOTOR',
          life: 'LIFE',
          home: 'HOME',
        };
        const policyType = policyMap[intent.interestedPolicy];
        if (policyType) {
          sessionManager.updateCollectedData(callSid, {
            interestedPolicy: policyType,
          });
        }
      }
      if (intent.wantsToBuy) {
        sessionManager.updateCollectedData(callSid, { intentToBuy: true });
      }
      if (intent.hasObjection) {
        sessionManager.updateCollectedData(callSid, {
          objections: [transcript],
        });
        sessionManager.updateState(callSid, 'OBJECTION_HANDLING');
      }
      if (intent.wantsCallback) {
        sessionManager.updateCollectedData(callSid, {
          additionalNotes: ['Customer requested callback'],
        });
      }
    })
    .catch((err) => {
      log.debug({ callSid, err }, 'Intent analysis failed (non-critical)');
    });

  // ========== Text-to-Speech ==========
  const ttsFunction = isHindiText(aiResponse) ? synthesizeSpeechHindi : synthesizeSpeech;
  const audioResult = await ttsFunction(aiResponse);
  const chunks = [audioResult.audioContent];

  const processingTimeMs = Date.now() - startTime;

  log.info(
    {
      callSid,
      processingTimeMs,
      transcriptLength: transcript.length,
      responseLength: aiResponse.length,
      audioChunks: chunks.length,
    },
    'Voice pipeline turn completed'
  );

  return {
    aiResponse,
    audioChunks: chunks,
    processingTimeMs,
  };
}

/**
 * Generate the opening greeting audio
 */
export async function processGreeting(
  callSid: string
): Promise<PipelineResult> {
  const startTime = Date.now();

  const greeting = await generateGreeting(callSid);

  const assistantMessage: ConversationMessage = {
    role: 'assistant',
    content: greeting,
    timestamp: new Date().toISOString(),
  };
  sessionManager.addMessage(callSid, assistantMessage);

  await logCallEvent(callSid, 'greeting_played', { greeting });

  const audioResult = await synthesizeSpeech(greeting);

  return {
    aiResponse: greeting,
    audioChunks: [audioResult.audioContent],
    processingTimeMs: Date.now() - startTime,
  };
}

/**
 * Build escalation response with TTS audio
 */
async function buildEscalationResponse(
  callSid: string,
  reason: string
): Promise<PipelineResult> {
  const startTime = Date.now();
  const message = getEscalationMessage(reason);

  sessionManager.updateState(callSid, 'ESCALATING');

  const assistantMessage: ConversationMessage = {
    role: 'assistant',
    content: message,
    timestamp: new Date().toISOString(),
  };
  sessionManager.addMessage(callSid, assistantMessage);

  await logCallEvent(callSid, 'escalation_triggered', { reason });

  const audioResult = await synthesizeSpeech(message);

  log.info({ callSid, reason }, 'Escalation triggered');

  return {
    aiResponse: message,
    audioChunks: [audioResult.audioContent],
    processingTimeMs: Date.now() - startTime,
  };
}

/**
 * Log a call event to the database
 */
async function logCallEvent(
  callSid: string,
  eventType: string,
  payload: Record<string, unknown>
): Promise<void> {
  try {
    await prisma.callEvent.create({
      data: {
        callSid,
        eventType,
        payload: payload as any,
      },
    });
  } catch (error) {
    // Non-critical — don't let event logging break the pipeline
    log.debug({ callSid, eventType, err: error }, 'Failed to log call event');
  }
}
