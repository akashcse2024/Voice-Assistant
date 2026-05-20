import type { WebSocket } from 'ws';
import { createSTTStream, type STTStream } from '../services/stt.service';
import { sessionManager } from '../services/session.service';
import { processUtteranceMulaw, processGreetingMulaw } from './voice-pipeline';
import { createModuleLogger } from '../utils/logger';
import { decodeAudioPayload, wrapMulawInWav, bufferToBase64, getMulawEnergy } from '../utils/audio';
import type { STTResult } from '../types';

const log = createModuleLogger('twilio-stream');

export function handleTwilioStream(ws: WebSocket): void {
  let callSid: string | undefined;
  let streamSid: string | undefined;
  let agentName = 'Priya';
  let customerName = 'Customer';
  
  let sttStream: STTStream | undefined;
  let isProcessing = false;
  let lastAudioTime = Date.now();
  let silenceTimer: NodeJS.Timeout | undefined;

  log.info('New Twilio Media Stream connection attempt');

  ws.on('message', async (data: string) => {
    try {
      const msg = JSON.parse(data);

      switch (msg.event) {
        case 'connected':
          log.info('Twilio Stream connected');
          break;

        case 'start':
          callSid = msg.start.callSid;
          streamSid = msg.start.streamSid;
          agentName = msg.start.customParameters?.agentName || 'Priya';
          customerName = msg.start.customParameters?.customerName || 'Customer';
          
          log.info({ callSid, streamSid, agentName }, 'Twilio Stream starting');

          // Initialize session if not exists (outbound start might have created it)
          if (!sessionManager.has(callSid!)) {
            sessionManager.create({
              callSid: callSid!,
              customerPhone: 'unknown', // Twilio doesn't send 'to' in the stream start
              customerName: customerName,
            });
          }
          
          sessionManager.setStreamSid(callSid!, streamSid!);

          // Initialize STT (wav format for mulaw-in-wav)
          sttStream = createSTTStream(callSid!, 'wav');
          setupSTTHandlers(sttStream, ws, callSid!, streamSid!);
          
          await sttStream.start();

          // Play initial greeting
          await playGreeting(ws, callSid!, streamSid!, agentName);
          break;

        case 'media':
          if (!callSid || !streamSid || !sttStream?.isActive()) return;
          
          const session = sessionManager.get(callSid);
          if (session?.isPlayingAudio) return; // Drop audio while assistant is speaking

          const audioBuffer = decodeAudioPayload(msg.media.payload);
          const energy = getMulawEnergy(audioBuffer);
          
          if (energy > 500) {
            // Speech detected
            sttStream.sendAudio(audioBuffer);
            lastAudioTime = Date.now();
            resetSilenceTimer();
          } else if (Date.now() - lastAudioTime < 1500) {
            // Still within silence grace period, keep accumulating audio for natural gaps
            sttStream.sendAudio(audioBuffer);
          }
          break;

        case 'stop':
          log.info({ callSid }, 'Twilio Stream stopped');
          cleanup();
          break;
      }
    } catch (error) {
      log.error({ err: error }, 'Error in Twilio Stream handler');
    }
  });

  ws.on('close', () => {
    log.info({ callSid }, 'Twilio Stream WebSocket closed');
    cleanup();
  });

  function resetSilenceTimer() {
    if (silenceTimer) clearTimeout(silenceTimer);
    silenceTimer = setTimeout(async () => {
      if (sttStream?.isActive() && !isProcessing) {
        log.debug({ callSid }, 'Silence detected, processing utterance');
        await sttStream.processUtterance();
      }
    }, 1500); // 1.5 seconds of silence
  }

  function setupSTTHandlers(stt: STTStream, websocket: WebSocket, cSid: string, sSid: string) {
    stt.on('transcript', async (result: STTResult) => {
      if (result.isFinal && result.transcript.trim()) {
        log.info({ callSid: cSid, transcript: result.transcript }, 'User Utterance');
        await processAndRespond(websocket, cSid, sSid, result);
      }
    });

    stt.on('error', (err) => {
      log.error({ callSid: cSid, err }, 'STT Error');
    });
  }

  async function processAndRespond(websocket: WebSocket, cSid: string, sSid: string, sttResult: STTResult) {
    if (isProcessing) return;
    isProcessing = true;

    try {
      const result = await processUtteranceMulaw(cSid, sttResult, agentName);
      if (result && websocket.readyState === websocket.OPEN) {
        sessionManager.setPlayingAudio(cSid, true);
        
        for (const chunk of result.audioChunks) {
          if (websocket.readyState !== websocket.OPEN) break;
          const session = sessionManager.get(cSid);
          if (!session?.isPlayingAudio) break; // Barge-in

          websocket.send(JSON.stringify({
            event: 'media',
            streamSid: sSid,
            media: {
              payload: bufferToBase64(chunk)
            }
          }));
        }

        sessionManager.setPlayingAudio(cSid, false);
      }
    } catch (error) {
      log.error({ callSid: cSid, err: error }, 'Error in processAndRespond');
    } finally {
      isProcessing = false;
    }
  }

  async function playGreeting(websocket: WebSocket, cSid: string, sSid: string, aName: string) {
    try {
      const result = await processGreetingMulaw(cSid, aName);
      if (websocket.readyState === websocket.OPEN) {
        sessionManager.setPlayingAudio(cSid, true);
        
        for (const chunk of result.audioChunks) {
          if (websocket.readyState !== websocket.OPEN) break;
          websocket.send(JSON.stringify({
            event: 'media',
            streamSid: sSid,
            media: {
              payload: bufferToBase64(chunk)
            }
          }));
        }

        sessionManager.setPlayingAudio(cSid, false);
      }
    } catch (error) {
      log.error({ callSid: cSid, err: error }, 'Error playing greeting');
    }
  }

  function cleanup() {
    if (silenceTimer) clearTimeout(silenceTimer);
    if (sttStream) sttStream.close();
  }
}
