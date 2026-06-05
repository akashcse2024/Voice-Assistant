import { MsEdgeTTS, OUTPUT_FORMAT } from 'msedge-tts';
import { execFileSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { createModuleLogger } from '../utils/logger';
import { mulaw } from 'alawmulaw';

const log = createModuleLogger('tts-service');

export function cleanTextForTTS(text: string): string {
  return text.replace(/[#*`_~]/g, '');
}

// FIX 3: FIX THE MSEDGETSS INSTANCE CREATION OVERHEAD
const ttsInstances = new Map<string, MsEdgeTTS>();

// Restore legacy EdgeTTS for browser streams if needed (using msedge-tts since edge-tts was removed, or just use msedge-tts)
export async function synthesizeSpeech(text: string): Promise<{ audioContent: Buffer, encoding: string, sampleRate: number }> {
  const tts = await getTTSInstance('en-IN-NeerjaNeural');
  const { audioStream } = tts.toStream(text);
  const audioBuffer = await new Promise<Buffer>((resolve, reject) => {
    const chunks: Buffer[] = [];
    audioStream.on('data', (chunk) => chunks.push(chunk));
    audioStream.on('end', () => resolve(Buffer.concat(chunks)));
    audioStream.on('error', reject);
  });
  return { audioContent: audioBuffer, encoding: 'mp3', sampleRate: 24000 };
}

export async function synthesizeSpeechHindi(text: string): Promise<{ audioContent: Buffer, encoding: string, sampleRate: number }> {
  const tts = await getTTSInstance('hi-IN-SwaraNeural');
  const { audioStream } = tts.toStream(text);
  const audioBuffer = await new Promise<Buffer>((resolve, reject) => {
    const chunks: Buffer[] = [];
    audioStream.on('data', (chunk) => chunks.push(chunk));
    audioStream.on('end', () => resolve(Buffer.concat(chunks)));
    audioStream.on('error', reject);
  });
  return { audioContent: audioBuffer, encoding: 'mp3', sampleRate: 24000 };
}

export function isHindiText(text: string): boolean {
  const devanagariPattern = /[\u0900-\u097F]/;
  const devanagariChars = (text.match(/[\u0900-\u097F]/g) || []).length;
  const totalAlpha = (text.match(/[a-zA-Z\u0900-\u097F]/g) || []).length;

  return totalAlpha > 0 && devanagariChars / totalAlpha > 0.4;
}

export async function preloadTTSVoices() {
  const voices = [
    'en-IN-NeerjaNeural',
    'en-IN-PrabhatNeural',
    'ta-IN-PallaviNeural',
    'ta-IN-ValluvarNeural'
  ];
  for (const voice of voices) {
    try {
      const tts = new MsEdgeTTS();
      await tts.setMetadata(voice, OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3);
      ttsInstances.set(voice, tts);
      log.info(`Preloaded TTS instance for voice ${voice}`);
    } catch (err) {
      log.error({ err, voice }, `Failed to preload TTS instance for voice`);
    }
  }
}

async function getTTSInstance(voice: string): Promise<MsEdgeTTS> {
  if (ttsInstances.has(voice)) {
    return ttsInstances.get(voice)!;
  }
  const tts = new MsEdgeTTS();
  await tts.setMetadata(voice, OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3);
  ttsInstances.set(voice, tts);
  return tts;
}

// FIX 2: CONFIGURE THE CORRECT VOICES FOR VIZZA
export function getVoiceForAgent(agentName: string, languageMode: string): string {
  const isTamil = languageMode === 'tamil' || languageMode === 'tamil-script' || languageMode === 'tanglish';
  if (agentName.toLowerCase() === 'arjun') {
    return isTamil ? 'ta-IN-ValluvarNeural' : 'en-IN-PrabhatNeural';
  } else {
    // Default to Priya
    return isTamil ? 'ta-IN-PallaviNeural' : 'en-IN-NeerjaNeural';
  }
}

export async function synthesizeSpeechMulaw(text: string, voice: string): Promise<Buffer> {
  const startTime = Date.now();
  const cleanedText = cleanTextForTTS(text);
  
  try {
    const tts = await getTTSInstance(voice);
    
    // Step 1: Generate MP3 buffer
    const mp3Buffer = await new Promise<Buffer>((resolve, reject) => {
      const { audioStream } = tts.toStream(cleanedText);
      const chunks: Buffer[] = [];
      audioStream.on('data', (c) => chunks.push(c));
      audioStream.on('end', () => resolve(Buffer.concat(chunks)));
      audioStream.on('error', reject);
    });

    // Step 2: Write MP3 to temp file and run execFileSync
    const tmpDir = path.join(process.cwd(), 'tmp');
    if (!fs.existsSync(tmpDir)) {
      fs.mkdirSync(tmpDir, { recursive: true });
    }
    const id = crypto.randomUUID();
    const mp3Path = path.join(tmpDir, `${id}.mp3`);
    const rawPath = path.join(tmpDir, `${id}.raw`);
    
    fs.writeFileSync(mp3Path, mp3Buffer);

    const ffmpegPath = path.join(process.cwd(), 'ffmpeg.exe');
    execFileSync(ffmpegPath, [
      '-i', mp3Path,
      '-ar', '8000',
      '-ac', '1',
      '-f', 's16le',
      rawPath
    ], { stdio: 'ignore' });

    // Read the raw PCM buffer
    const rawPcmBuffer = fs.readFileSync(rawPath);

    // Delete temp files
    try { fs.unlinkSync(mp3Path); } catch (e) {}
    try { fs.unlinkSync(rawPath); } catch (e) {}

    // Step 3: Convert raw PCM buffer to Mulaw using alawmulaw
    // Use Int16Array taking care of byte alignment
    const pcm16 = new Int16Array(
      rawPcmBuffer.buffer, 
      rawPcmBuffer.byteOffset, 
      rawPcmBuffer.length / 2
    );
    const mulawArray = mulaw.encode(pcm16);
    const mulawBuffer = Buffer.from(mulawArray);

    log.info({ textLength: text.length, audioBytes: mulawBuffer.length, latencyMs: Date.now() - startTime }, 'TTS Mulaw synthesis completed');

    return mulawBuffer;
  } catch (error: any) {
    // If instance fails, recreate it next time
    if (ttsInstances.has(voice)) {
      ttsInstances.delete(voice);
    }
    log.error({ err: error }, 'TTS Mulaw synthesis failed');
    return Buffer.from([]);
  }
}
