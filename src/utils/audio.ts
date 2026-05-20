/**
 * Audio format conversion utilities for the voice pipeline.
 * Twilio Media Streams send/receive audio as base64-encoded mulaw at 8kHz mono.
 */

/**
 * Convert a base64-encoded mulaw audio chunk to a raw Buffer
 */
export function base64ToBuffer(base64Audio: string): Buffer {
  return Buffer.from(base64Audio, 'base64');
}

/**
 * Decode base64 and return the buffer
 */
export function decodeAudioPayload(payload: string): Buffer {
  return Buffer.from(payload, 'base64');
}

/**
 * Convert a raw audio Buffer to base64 string
 */
export function bufferToBase64(buffer: Buffer): string {
  return buffer.toString('base64');
}

/**
 * Convert linear PCM 16-bit samples to mulaw encoding
 * Used when TTS output is in PCM and needs to be sent to Twilio
 */
export function pcmToMulaw(pcmBuffer: Buffer): Buffer {
  const mulawBuffer = Buffer.alloc(pcmBuffer.length / 2);

  for (let i = 0; i < pcmBuffer.length; i += 2) {
    const sample = pcmBuffer.readInt16LE(i);
    mulawBuffer[i / 2] = linearToMulaw(sample);
  }

  return mulawBuffer;
}

/**
 * Convert a single linear PCM sample to mulaw
 */
function linearToMulaw(sample: number): number {
  const MULAW_MAX = 0x1fff;
  const MULAW_BIAS = 33;
  const sign = sample < 0 ? 0x80 : 0;

  if (sample < 0) sample = -sample;
  if (sample > MULAW_MAX) sample = MULAW_MAX;

  sample += MULAW_BIAS;

  let exponent = 7;
  const exponentMask = 0x4000;

  for (
    let expMask = exponentMask;
    exponent > 0 && (sample & expMask) === 0;
    exponent--, expMask >>= 1
  ) {
    // find position of highest bit
  }

  const mantissa = (sample >> (exponent + 3)) & 0x0f;
  const mulawByte = ~(sign | (exponent << 4) | mantissa) & 0xff;

  return mulawByte;
}

/**
 * Generate silence in mulaw format (0xFF bytes)
 * @param durationMs Duration of silence in milliseconds
 * @param sampleRate Sample rate (default 8000 Hz for telephony)
 */
export function generateSilence(durationMs: number, sampleRate = 8000): Buffer {
  const numSamples = Math.floor((sampleRate * durationMs) / 1000);
  const buffer = Buffer.alloc(numSamples, 0xff); // 0xFF is silence in mulaw
  return buffer;
}

/**
 * Split an audio buffer into chunks of a given size for streaming
 * @param buffer Full audio buffer
 * @param chunkSize Size of each chunk in bytes (default 640 = 80ms at 8kHz mulaw)
 */
export function splitIntoChunks(buffer: Buffer, chunkSize = 640): Buffer[] {
  const chunks: Buffer[] = [];
  for (let offset = 0; offset < buffer.length; offset += chunkSize) {
    chunks.push(buffer.subarray(offset, Math.min(offset + chunkSize, buffer.length)));
  }
  return chunks;
}
/**
 * Add a WAV header to raw mulaw audio so Groq Whisper can read it
 */
export function wrapMulawInWav(mulawBuffer: Buffer, sampleRate = 8000): Buffer {
  const header = Buffer.alloc(44);
  
  // RIFF header
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + mulawBuffer.length, 4);
  header.write('WAVE', 8);
  
  // fmt subchunk
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16); // Subchunk1Size (16 for PCM, but we use 7 for mulaw)
  header.writeUInt16LE(7, 20);  // AudioFormat (7 = mu-law)
  header.writeUInt16LE(1, 22);  // NumChannels (1 = mono)
  header.writeUInt32LE(sampleRate, 24); // SampleRate
  header.writeUInt32LE(sampleRate, 28); // ByteRate (SampleRate * NumChannels * BitsPerSample/8)
  header.writeUInt16LE(1, 32);  // BlockAlign (NumChannels * BitsPerSample/8)
  header.writeUInt16LE(8, 34);  // BitsPerSample (8 bits for mulaw)
  
  // data subchunk
  header.write('data', 36);
  header.writeUInt32LE(mulawBuffer.length, 40);
  
  return Buffer.concat([header, mulawBuffer]);
}

/**
 * Calculate the RMS energy of a mulaw audio buffer for Voice Activity Detection
 */
export function getMulawEnergy(buffer: Buffer): number {
  let sumSquares = 0;
  for (let i = 0; i < buffer.length; i++) {
    // Basic mulaw to linear conversion for energy calculation
    let mulawByte = ~buffer[i];
    const sign = (mulawByte & 0x80) ? -1 : 1;
    const exponent = (mulawByte & 0x70) >> 4;
    const mantissa = mulawByte & 0x0f;
    let sample = (mantissa << 3) + 132;
    sample <<= exponent;
    sample -= 33; // MULAW_BIAS
    
    sumSquares += (sample * sign) ** 2;
  }
  return Math.sqrt(sumSquares / buffer.length);
}
