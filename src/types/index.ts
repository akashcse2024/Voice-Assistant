/**
 * Shared TypeScript types for the SafeShield Voice Assistant
 */

import type { CallState, PolicyType } from '@prisma/client';

// ============================================
// Session Types
// ============================================

export interface ConversationMessage {
  role: 'assistant' | 'customer';
  content: string;
  timestamp: string;
  confidence?: number;
}

export interface CallSession {
  callSid: string;
  customerId?: string;
  customerPhone: string;
  customerName?: string;
  campaignId?: string;
  conversationHistory: ConversationMessage[];
  collectedData: CollectedData;
  callState: CallState;
  lowConfidenceCount: number;
  consecutiveLowConfidence: number;
  startedAt: Date;
  lastActivityAt: Date;
  streamSid?: string;
  isPlayingAudio: boolean;
}

export interface CollectedData {
  interestedPolicy?: PolicyType;
  objections: string[];
  intentToBuy: boolean;
  preferredCallbackTime?: string;
  additionalNotes: string[];
}

// ============================================
// API Request/Response Types
// ============================================

export interface OutboundCallRequest {
  phone: string;
  name?: string;
  campaignId?: string;
}

export interface BulkOutboundRequest {
  customers: Array<{ phone: string; name?: string }>;
  campaignName?: string;
}

export interface ChatTestRequest {
  message: string;
  sessionId?: string;
  customerName?: string;
}

export interface ChatTestResponse {
  response: string;
  sessionId: string;
  conversationHistory: ConversationMessage[];
}

export interface CallLogResponse {
  id: string;
  callSid: string;
  customerPhone: string;
  customerName?: string;
  status: string;
  duration?: number;
  escalated: boolean;
  createdAt: string;
  summary?: string;
}

export interface AnalyticsResponse {
  totalCalls: number;
  answeredCalls: number;
  answerRate: number;
  averageDuration: number;
  escalationRate: number;
  policyInterest: Record<string, number>;
  callsByStatus: Record<string, number>;
}

export interface CustomerCreateRequest {
  name: string;
  phone: string;
  email?: string;
  preferredCallStart?: string;
  preferredCallEnd?: string;
  timezone?: string;
  doNotCall?: boolean;
}

export interface LeadCreateRequest {
  phone: string;
  name?: string;
  interestedIn?: PolicyType;
  callSid?: string;
  objections?: string;
  status?: string;
  notes?: string;
}

// ============================================
// Twilio Webhook Types
// ============================================

export interface TwilioCallStatusWebhook {
  CallSid: string;
  CallStatus: string;
  CallDuration?: string;
  From: string;
  To: string;
  Direction: string;
}

export interface TwilioMediaStreamMessage {
  event: 'connected' | 'start' | 'media' | 'stop' | 'mark';
  sequenceNumber?: string;
  streamSid?: string;
  start?: {
    streamSid: string;
    accountSid: string;
    callSid: string;
    tracks: string[];
    mediaFormat: {
      encoding: string;
      sampleRate: number;
      channels: number;
    };
  };
  media?: {
    track: string;
    chunk: string;
    timestamp: string;
    payload: string; // base64 encoded audio
  };
  mark?: {
    name: string;
  };
}

// ============================================
// Pipeline Types
// ============================================

export interface STTResult {
  transcript: string;
  confidence: number;
  isFinal: boolean;
  words?: Array<{
    word: string;
    start: number;
    end: number;
    confidence: number;
  }>;
}

export interface TTSResult {
  audioContent: Buffer;
  encoding: string;
  sampleRate: number;
}

export interface PipelineResult {
  aiResponse: string;
  audioChunks: Buffer[];
  processingTimeMs: number;
}

// ============================================
// SSE Types
// ============================================

export interface LiveCallUpdate {
  type: 'call_started' | 'call_ended' | 'utterance' | 'response' | 'escalation' | 'state_change';
  callSid: string;
  data: Record<string, unknown>;
  timestamp: string;
}
