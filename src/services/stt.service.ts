/**
 * Speech-to-Text Service — Groq Whisper REST Integration (100% Free Tier)
 * Uses Groq's insanely fast Whisper API.
 * Receives complete WebM utterances and returns the transcript.
 */

import Groq, { toFile } from 'groq-sdk';
import { env, isConfigured } from '../config/env';
import { createModuleLogger } from '../utils/logger';
import { EventEmitter } from 'events';
import { wrapMulawInWav } from '../utils/audio';

const log = createModuleLogger('stt-service');

let groqClient: Groq | null = null;

function getGroq() {
  if (!groqClient) {
    if (!isConfigured.groq()) {
      throw new Error('Groq API key not configured. Set GROQ_API_KEY in .env');
    }
    groqClient = new Groq({
      apiKey: env.GROQ_API_KEY,
    });
  }
  return groqClient;
}

export class STTStream extends EventEmitter {
  private callSid: string;
  private isOpen = true;
  private audioChunks: Buffer[] = [];
  private format: 'webm' | 'wav' = 'webm';

  constructor(callSid: string, format: 'webm' | 'wav' = 'webm') {
    super();
    this.callSid = callSid;
    this.format = format;
  }

  async start(): Promise<void> {
    // Groq doesn't use WebSockets, so we just emit open immediately
    setTimeout(() => this.emit('open'), 10);
  }

  /**
   * Accumulate audio chunks in memory
   */
  sendAudio(audioBuffer: Buffer): void {
    if (!this.isOpen) return;
    this.audioChunks.push(audioBuffer);
  }

  /**
   * Process the accumulated audio using Groq Whisper.
   * Call this when the browser sends utterance_end.
   */
  async processUtterance(): Promise<void> {
    if (!this.isOpen || this.audioChunks.length === 0) {
      this.emit('empty_transcript');
      return;
    }

    let fullBuffer = Buffer.concat(this.audioChunks);
    this.audioChunks = []; // Reset for next utterance

    if (this.format === 'wav') {
      fullBuffer = wrapMulawInWav(fullBuffer) as any;
    }

    if (fullBuffer.length < 500) {
      log.debug('Audio buffer too small, ignoring');
      this.emit('empty_transcript');
      return;
    }

    // Use Groq's toFile helper to send buffer directly
    try {
      const fileName = `audio.${this.format}`;
      const fileType = `audio/${this.format}`;
      const file = await toFile(fullBuffer, fileName, { type: fileType });
      const groq = getGroq();
      log.debug({ callSid: this.callSid, bytes: fullBuffer.length }, 'Sending to Groq Whisper...');
      
      const startTime = Date.now();
      const transcription = await groq.audio.transcriptions.create({
        file,
        model: 'whisper-large-v3-turbo',
        language: 'en',
        response_format: 'json',
      }, { timeout: 5000, maxRetries: 0 });
      const latencyMs = Date.now() - startTime;

      const text = transcription.text?.trim();

      if (text) {
        log.info({ callSid: this.callSid, text, latencyMs }, 'Groq STT Result');
        this.emit('transcript', {
          transcript: text,
          confidence: 1.0,
          isFinal: true,
        });
        
        // Immediately emit utteranceEnd since we processed the full utterance
        this.emit('utteranceEnd');
      } else {
        log.info({ callSid: this.callSid }, 'Groq STT returned empty transcript');
        this.emit('empty_transcript');
      }
    } catch (error: any) {
      log.error({ callSid: this.callSid, message: error?.message }, 'Groq STT failed');
      this.emit('error', error);
    }
  }

  close(): void {
    this.isOpen = false;
    this.audioChunks = [];
    this.removeAllListeners();
  }

  isActive(): boolean {
    return this.isOpen;
  }
}

export function createSTTStream(callSid: string, format: 'webm' | 'wav' = 'webm'): STTStream {
  return new STTStream(callSid, format);
}
