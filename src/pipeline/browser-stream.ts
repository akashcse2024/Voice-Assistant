/**
 * Browser Stream Handler — Alternative to Twilio for local testing.
 * Accepts raw WebM audio from browser's MediaRecorder and sends back MP3 audio.
 */

import type { WebSocket } from 'ws';
import { createSTTStream, type STTStream } from '../services/stt.service';
import { sessionManager } from '../services/session.service';
import { processUtterance, processGreeting } from './voice-pipeline';
import { createModuleLogger } from '../utils/logger';
import type { STTResult } from '../types';

const log = createModuleLogger('browser-stream');

export function handleBrowserStream(ws: WebSocket): void {
  const callSid = `browser-${Date.now()}`;
  let sttStream: STTStream | undefined;
  let finalTranscript = '';
  let utteranceTimer: NodeJS.Timeout | undefined;
  let isProcessing = false;

  log.info({ callSid }, 'New browser test stream connected');

  // Initialize session
  sessionManager.create({
    callSid,
    customerPhone: 'browser',
  });

  // Initialize Deepgram STT stream (format = 'webm' for browser)
  sttStream = createSTTStream(callSid, 'webm');
  setupSTTHandlers(sttStream, ws, callSid);
  
  sttStream.start().then(() => {
    // Play greeting once STT is ready
    setTimeout(async () => {
      await playGreeting(ws, callSid);
    }, 500);
  }).catch(err => {
    log.error({ err }, 'Failed to start STT stream for browser test');
  });

  ws.on('message', async (data: Buffer | string) => {
    try {
      if (typeof data === 'string') {
        const msg = JSON.parse(data);
        if (msg.event === 'utterance_end' && sttStream?.isActive()) {
          log.debug({ callSid }, 'Received utterance_end from browser');
          
          // processUtterance will emit 'transcript' synchronously if Groq succeeds
          // The 'transcript' listener will set finalTranscript
          await sttStream.processUtterance();
          
          // After processUtterance completes, check if we got a transcript
          if (finalTranscript && !isProcessing) {
            const transcript = finalTranscript;
            finalTranscript = '';
            log.info({ callSid, transcript }, 'Processing user utterance');
            await processAndRespond(ws, callSid, {
              transcript,
              confidence: 1.0,
              isFinal: true,
            });
          }
        }
        return;
      }

      // data is WebM audio from browser microphone
      // data is WebM audio from browser microphone
      if (sttStream?.isActive()) {
        const session = sessionManager.get(callSid);
        
        // ECHO CANCELLATION FIX: 
        // If Priya is speaking, completely ignore the microphone data
        // so she doesn't transcribe her own voice.
        if (session?.isPlayingAudio) {
          return; // <-- This instantly drops the audio chunk
        }
        
        sttStream.sendAudio(data);
      }
    } catch (error) {
      log.error({ callSid, err: error }, 'Error processing browser media');
    }
  });

  ws.on('close', () => {
    log.info({ callSid }, 'Browser stream closed');
    cleanup();
  });

  ws.on('error', (error) => {
    log.error({ callSid, err: error }, 'Browser stream error');
    cleanup();
  });

  function setupSTTHandlers(stt: STTStream, websocket: WebSocket, cSid: string): void {
    // Only capture the transcript text — do NOT trigger processAndRespond here.
    // processAndRespond is triggered from ws.on('message') after processUtterance resolves.
    stt.on('transcript', (result: STTResult) => {
      if (result.isFinal && result.transcript.trim()) {
        finalTranscript = result.transcript.trim();
        log.debug({ callSid: cSid, transcript: finalTranscript }, 'STT transcript captured');

        // Send transcript back to browser UI
        if (websocket.readyState === websocket.OPEN) {
          websocket.send(JSON.stringify({ type: 'transcript', text: finalTranscript }));
        }
      }
    });

    // utteranceEnd is no longer used to trigger the pipeline.
    // Keeping it as a debug log only.
    stt.on('utteranceEnd', () => {
      log.debug({ callSid: cSid }, 'STT utteranceEnd event received (no-op)');
    });

    stt.on('empty_transcript', () => {
      if (websocket.readyState === websocket.OPEN) {
        websocket.send(JSON.stringify({ type: 'status', text: 'Ready to listen...' }));
      }
    });

    stt.on('error', (error: Error) => {
      log.error({ callSid: cSid, err: error }, 'STT stream error');
      if (websocket.readyState === websocket.OPEN) {
        websocket.send(JSON.stringify({ type: 'status', text: 'Microphone glitch, ready to listen...' }));
      }
    });
  }

  async function processAndRespond(websocket: WebSocket, cSid: string, sttResult: STTResult): Promise<void> {
    if (isProcessing) return;
    isProcessing = true;

    try {
      const result = await processUtterance(cSid, sttResult);

      if (result && websocket.readyState === websocket.OPEN) {
        // Send AI transcript text
        websocket.send(JSON.stringify({ type: 'ai_response', text: result.aiResponse }));

        sessionManager.setPlayingAudio(cSid, true);

        let validAudioSent = false;
        for (const chunk of result.audioChunks) {
          if (websocket.readyState !== websocket.OPEN) break;
          const session = sessionManager.get(cSid);
          if (!session?.isPlayingAudio) {
            log.debug({ callSid: cSid }, 'Playback interrupted by barge-in');
            break;
          }
          if (chunk && chunk.length > 0) {
            websocket.send(chunk);
            validAudioSent = true;
          }
        }
        
        if (!validAudioSent) {
          log.warn({ callSid: cSid }, 'TTS failed: No valid audio chunks sent to browser');
          websocket.send(JSON.stringify({ type: 'status', text: 'Ready to listen...' }));
        }
        setTimeout(() => {
          sessionManager.setPlayingAudio(cSid, false);
        }, 100);
      }
    } catch (error) {
      log.error({ callSid: cSid, err: error }, 'Error in processAndRespond');
      if (websocket.readyState === websocket.OPEN) {
        websocket.send(JSON.stringify({ type: 'status', text: 'Error generating response, ready to listen...' }));
      }
    } finally {
      isProcessing = false;
    }
  }

  async function playGreeting(websocket: WebSocket, cSid: string): Promise<void> {
    try {
      const result = await processGreeting(cSid);

      if (websocket.readyState === websocket.OPEN) {
        websocket.send(JSON.stringify({ type: 'ai_response', text: result.aiResponse }));
        sessionManager.setPlayingAudio(cSid, true);

        let validAudioSent = false;
        for (const chunk of result.audioChunks) {
          if (websocket.readyState !== websocket.OPEN) break;
          if (chunk && chunk.length > 0) {
            websocket.send(chunk);
            validAudioSent = true;
          }
        }

        if (!validAudioSent) {
          log.warn({ callSid: cSid }, 'TTS failed: No valid audio chunks sent for greeting');
          websocket.send(JSON.stringify({ type: 'status', text: 'Ready to listen...' }));
        }

        setTimeout(() => {
          sessionManager.setPlayingAudio(cSid, false);
        }, 1000);
      }
    } catch (error) {
      log.error({ callSid: cSid, err: error }, 'Error playing greeting');
    }
  }

  function cleanup(): void {
    if (utteranceTimer) clearTimeout(utteranceTimer);
    if (sttStream) sttStream.close();
  }
}
// trigger reload
