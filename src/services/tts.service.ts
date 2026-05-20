/**
 * Text-to-Speech Service — Edge TTS Integration (100% Free)
 * Converts AI response text to natural-sounding Indian English female voice audio.
 * Outputs MP3 format for easy browser playback.
 */

import { EdgeTTS, SynthesisOptions, Constants } from '@andresaya/edge-tts';
import { MsEdgeTTS, OUTPUT_FORMAT } from 'msedge-tts';
import ffmpeg from 'fluent-ffmpeg';
import ffmpegInstaller from '@ffmpeg-installer/ffmpeg';
import { PassThrough } from 'stream';
import { createModuleLogger } from '../utils/logger';
import type { TTSResult } from '../types';

ffmpeg.setFfmpegPath(ffmpegInstaller.path);

const log = createModuleLogger('tts-service');

const tts = new EdgeTTS();

const options: SynthesisOptions = {
  rate: '0%',
  volume: '+0%',
  pitch: '+0Hz',
  // Use a high-quality MP3 format suitable for the browser
  outputFormat: Constants.OUTPUT_FORMAT.AUDIO_24KHZ_96KBITRATE_MONO_MP3,
};

/**
 * Convert text to speech audio in MP3 format
 */
export async function synthesizeSpeech(text: string): Promise<TTSResult> {
  const startTime = Date.now();

  try {
    // English (India) Female Voice
    await tts.synthesize(text, 'en-IN-NeerjaNeural', options);
    
    const audioBuffer = tts.toBuffer();

    const latencyMs = Date.now() - startTime;
    log.info(
      {
        textLength: text.length,
        audioBytes: audioBuffer.length,
        latencyMs,
      },
      'TTS synthesis completed (Edge-TTS)'
    );

    return {
      audioContent: audioBuffer,
      encoding: 'mp3',
      sampleRate: 24000,
    };
  } catch (error) {
    log.error({ err: error, textLength: text.length }, 'TTS synthesis failed, falling back to empty audio');
    return {
      audioContent: Buffer.from([]),
      encoding: 'mp3',
      sampleRate: 24000,
    };
  }
}

/**
 * Synthesize speech for Hindi/Hinglish text
 */
export async function synthesizeSpeechHindi(text: string): Promise<TTSResult> {
  const startTime = Date.now();

  try {
    // Hindi (India) Female Voice
    await tts.synthesize(text, 'hi-IN-SwaraNeural', options);
    
    const audioBuffer = tts.toBuffer();

    const latencyMs = Date.now() - startTime;
    log.info({ textLength: text.length, latencyMs }, 'Hindi TTS synthesis completed (Edge-TTS)');

    return {
      audioContent: audioBuffer,
      encoding: 'mp3',
      sampleRate: 24000,
    };
  } catch (error) {
    log.error({ err: error }, 'Hindi TTS synthesis failed, falling back to empty audio');
    return {
      audioContent: Buffer.from([]),
      encoding: 'mp3',
      sampleRate: 24000,
    };
  }
}

/**
 * Detect if text is primarily Hindi (Devanagari script)
 */
export function isHindiText(text: string): boolean {
  const devanagariPattern = /[\u0900-\u097F]/;
  const devanagariChars = (text.match(/[\u0900-\u097F]/g) || []).length;
  const totalAlpha = (text.match(/[a-zA-Z\u0900-\u097F]/g) || []).length;

  return totalAlpha > 0 && devanagariChars / totalAlpha > 0.4;
}
/**
 * Synthesize speech directly to 8kHz mulaw for Twilio Media Streams
 */
export async function synthesizeSpeechMulaw(text: string, agentName = 'Priya'): Promise<Buffer> {
  const startTime = Date.now();
  const voice = agentName === 'Arjun' ? 'en-IN-PrabhatNeural' : 'en-IN-NeerjaNeural';
  
  try {
    const tts = new MsEdgeTTS();
    // Edge API limits raw mulaw, so we generate MP3 and transcode to Mulaw via FFmpeg
    await tts.setMetadata(voice, OUTPUT_FORMAT.AUDIO_24KHZ_96KBITRATE_MONO_MP3);
    
    const { audioStream } = tts.toStream(text);
    
    const audioBuffer = await new Promise<Buffer>((resolve, reject) => {
      const outStream = new PassThrough();
      const chunks: Buffer[] = [];
      outStream.on('data', (chunk) => chunks.push(chunk));
      outStream.on('end', () => resolve(Buffer.concat(chunks)));
      outStream.on('error', (err) => reject(err));

      ffmpeg(audioStream)
        .inputFormat('mp3')
        .audioCodec('pcm_mulaw')
        .audioFrequency(8000)
        .audioChannels(1)
        .format('mulaw')
        .on('error', (err: any) => {
          log.error({ err }, 'FFmpeg transcoding to Mulaw failed');
          reject(err);
        })
        .pipe(outStream);
    });

    log.info(
      { textLength: text.length, audioBytes: audioBuffer.length, latencyMs: Date.now() - startTime },
      'TTS Mulaw synthesis completed'
    );
    
    return audioBuffer;
  } catch (error) {
    log.error({ err: error }, 'TTS Mulaw synthesis failed');
    return Buffer.from([]);
  }
}
