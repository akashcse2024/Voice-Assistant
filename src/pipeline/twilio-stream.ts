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
  let languageMode = 'english';
  
  let sttStream: STTStream | undefined;
  let isProcessing = false;
  let lastAudioTime = Date.now();
  let silenceTimer: NodeJS.Timeout | undefined;
  
  let isSpeaking = false;
  let speakingEndTime = 0;
  let bargedIn = false;
  let recentTranscripts: string[] = [];
  
  let consecutiveHighRMSCount = 0;
  let streamStartTime = 0;
  let echoSuppressUntil = 0;

  log.info('New Twilio Media Stream connection attempt');

  ws.on('message', async (data: string) => {
    try {
      const msg = JSON.parse(data);

      switch (msg.event) {
        case 'connected':
          log.info('Twilio Stream connected');
          break;

        case 'start':
          streamStartTime = Date.now();
          callSid = msg.start.callSid;
          streamSid = msg.start.streamSid;
          agentName = msg.start.customParameters?.agentName || 'Priya';
          customerName = msg.start.customParameters?.customerName || 'Customer';
          languageMode = msg.start.customParameters?.languageMode || 'english';
          
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
          sttStream = createSTTStream(callSid!, 'wav', languageMode === 'tamil' || languageMode === 'tamil-script' || languageMode === 'tanglish' ? 'ta' : 'en');
          setupSTTHandlers(sttStream, ws, callSid!, streamSid!);
          
          await sttStream.start();

          // Play initial greeting
          await playGreeting(ws, callSid!, streamSid!, agentName);
          break;

        case 'media':
          if (!callSid || !streamSid || !sttStream?.isActive()) return;
          
          if (Date.now() < echoSuppressUntil) {
            return; // Drop echo completely during the 800ms window
          }
          
          const audioBuffer = decodeAudioPayload(msg.media.payload);
          const energy = getMulawEnergy(audioBuffer);
          
          if (isSpeaking) {
            if (energy > 3000) {
              consecutiveHighRMSCount++;
            } else {
              consecutiveHighRMSCount = 0;
            }

            if (consecutiveHighRMSCount >= 3 && (Date.now() - streamStartTime > 4000)) {
              log.info({ callSid }, 'Barge-in detected via RMS > 3000');
              isSpeaking = false;
              bargedIn = true;
              
              ws.send(JSON.stringify({
                event: 'clear',
                streamSid: streamSid
              }));
              
              setTimeout(() => {
                sttStream?.sendAudio(audioBuffer);
                lastAudioTime = Date.now();
                resetSilenceTimer();
              }, 300);
            }
            return;
          }
          
          if (energy > 500) {
            // Speech detected
            sttStream.sendAudio(audioBuffer);
            lastAudioTime = Date.now();
            resetSilenceTimer();
          } else if (Date.now() - lastAudioTime < 600) {
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
    }, 600); // 600ms of silence
  }

  function setupSTTHandlers(stt: STTStream, websocket: WebSocket, cSid: string, sSid: string) {
    stt.on('transcript', async (result: STTResult) => {
      if (result.isFinal && result.transcript.trim()) {
        const text = result.transcript.trim();
        
        // Repetition filter (check identical to previous transcript)
        if (recentTranscripts.length > 0 && 
            recentTranscripts[recentTranscripts.length - 1] === text) {
          log.info({ callSid: cSid, text }, 'Repetition filter triggered, ignoring');
          return;
        }
        recentTranscripts.push(text);
        if (recentTranscripts.length > 5) recentTranscripts.shift();
        
        log.info({ callSid: cSid, transcript: text }, 'User Utterance');
        await processAndRespond(websocket, cSid, sSid, result);
      }
    });

    stt.on('error', (err) => {
      log.error({ callSid: cSid, err }, 'STT Error');
    });
  }

  function streamAudioChunks(websocket: WebSocket, cSid: string, sSid: string, fullBuffer: Buffer): Promise<void> {
    return new Promise((resolve) => {
      const startTime = Date.now();
      isSpeaking = true;
      bargedIn = false;
      consecutiveHighRMSCount = 0;
      sessionManager.setPlayingAudio(cSid, true);

      const chunks: Buffer[] = [];
      for (let i = 0; i < fullBuffer.length; i += 160) {
        chunks.push(fullBuffer.subarray(i, i + 160));
      }

      if (chunks.length === 0 || websocket.readyState !== websocket.OPEN) {
        isSpeaking = false;
        sessionManager.setPlayingAudio(cSid, false);
        speakingEndTime = Date.now();
        echoSuppressUntil = Date.now() + 800;
        resolve();
        return;
      }

      let currentIndex = 0;

      // Send the first 10 chunks (200ms) immediately to build a small playback buffer on Twilio's side
      // This absorbs Node.js event loop jitter and prevents intermittent voice breaking.
      const initialBurst = Math.min(10, chunks.length);
      for (let i = 0; i < initialBurst; i++) {
        websocket.send(JSON.stringify({
          event: 'media',
          streamSid: sSid,
          media: { payload: bufferToBase64(chunks[currentIndex]) }
        }));
        currentIndex++;
      }

      // We track the logical start time to compensate for interval drift
      const playStartTime = Date.now();

      const intervalId = setInterval(() => {
        if (bargedIn) {
          clearInterval(intervalId);
          websocket.send(JSON.stringify({
            event: 'clear',
            streamSid: sSid
          }));
          isSpeaking = false;
          sessionManager.setPlayingAudio(cSid, false);
          speakingEndTime = Date.now();
          echoSuppressUntil = Date.now() + 800;
          resolve();
          return;
        }

        if (websocket.readyState !== websocket.OPEN) {
          clearInterval(intervalId);
          isSpeaking = false;
          sessionManager.setPlayingAudio(cSid, false);
          speakingEndTime = Date.now();
          resolve();
          return;
        }

        if (currentIndex >= chunks.length) {
          clearInterval(intervalId);
          isSpeaking = false;
          sessionManager.setPlayingAudio(cSid, false);
          speakingEndTime = Date.now();
          echoSuppressUntil = Date.now() + 800;
          log.info({ callSid: cSid, latency: Date.now() - startTime }, 'Twilio turn completed');
          resolve();
          return;
        }

        // Calculate how many chunks *should* have been sent by now based on real elapsed time
        const elapsedMs = Date.now() - playStartTime;
        const targetIndex = Math.min(chunks.length, initialBurst + Math.floor(elapsedMs / 20));

        // Send chunks to catch up if the timer drifted
        while (currentIndex < targetIndex) {
          websocket.send(JSON.stringify({
            event: 'media',
            streamSid: sSid,
            media: { payload: bufferToBase64(chunks[currentIndex]) }
          }));
          currentIndex++;
        }
      }, 20);
    });
  }

  async function processAndRespond(websocket: WebSocket, cSid: string, sSid: string, sttResult: STTResult) {
    if (isProcessing) return;
    isProcessing = true;

    try {
      const result = await processUtteranceMulaw(cSid, sttResult, agentName, languageMode);
      if (result && websocket.readyState === websocket.OPEN) {
        await streamAudioChunks(websocket, cSid, sSid, result.audioBuffer);
      }
    } catch (error) {
      log.error({ callSid: cSid, err: error }, 'Error in processAndRespond');
    } finally {
      isProcessing = false;
    }
  }

  async function playGreeting(websocket: WebSocket, cSid: string, sSid: string, aName: string) {
    try {
      const result = await processGreetingMulaw(cSid, aName, languageMode);
      if (websocket.readyState === websocket.OPEN) {
        await streamAudioChunks(websocket, cSid, sSid, result.audioBuffer);
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
