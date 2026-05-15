import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { MsEdgeTTS } from 'msedge-tts';
import { createModuleLogger } from '../utils/logger';

const log = createModuleLogger('tts-routes');

const ttsSchema = z.object({
  text: z.string().min(1),
  voice: z.string().optional(),
  agentName: z.string().optional().default('Priya'),
  languageMode: z.string().optional().default('english'),
  rate: z.string().optional().default('100%'),
});

function selectVoiceForContent(text: string, agentName: string, languageMode: string) {
  // Check if text contains any Tamil script characters
  const hasTamilScript = /[\u0B80-\u0BFF]/.test(text);

  if (hasTamilScript) {
    // Pure Tamil script — use Tamil neural voice
    return agentName === 'Arjun' ? 'ta-IN-ValluvarNeural' : 'ta-IN-PallaviNeural';
  }

  // English or Tanglish — use Indian English voice
  return agentName === 'Arjun' ? 'en-IN-PrabhatNeural' : 'en-IN-NeerjaNeural';
}

function cleanTextForTTS(text: string) {
  let cleaned = text;

  // Remove markdown formatting
  cleaned = cleaned.replace(/\*\*/g, '').replace(/\*/g, '').replace(/\_/g, '').replace(/\#/g, '').replace(/\`/g, '');
  // Remove bracketed content like [listening...] or [DEBUG...]
  cleaned = cleaned.replace(/\[.*?\]/g, '');
  // Remove multiple spaces
  cleaned = cleaned.replace(/\s+/g, ' ').trim();

  return cleaned;
}

export async function ttsRoutes(fastify: FastifyInstance): Promise<void> {
  /**
   * POST /api/tts — High-quality Neural TTS via msedge-tts (Node.js)
   */
  fastify.post('/tts', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { text, agentName, languageMode } = ttsSchema.parse(request.body);

      // Auto-select best voice for the content
      const selectedVoice = selectVoiceForContent(text, agentName || 'Priya', languageMode || 'english');
      const cleanedText = cleanTextForTTS(text);

      log.info({ voice: selectedVoice, text: cleanedText.substring(0, 50) }, 'TTS Request Processing');

      const tts = new MsEdgeTTS();
      await tts.setMetadata(selectedVoice, "audio-24khz-48kbitrate-mono-mp3");
      
      const { audioStream } = tts.toStream(cleanedText);
      
      const audioBuffer = await new Promise<Buffer>((resolve, reject) => {
        const chunks: Buffer[] = [];
        audioStream.on('data', (chunk) => chunks.push(chunk));
        audioStream.on('end', () => resolve(Buffer.concat(chunks)));
        audioStream.on('error', (err) => reject(err));
      });

      log.info({ size: audioBuffer.length }, 'TTS Success — Sending audio');

      return reply
        .header('Content-Type', 'audio/mpeg')
        .header('Content-Length', audioBuffer.length)
        .send(audioBuffer);

    } catch (err: any) {
      log.error({ err: err.message }, 'TTS backend error');
      
      // Send fallback signal to frontend with 500 status
      return reply.status(500).send({ 
        useBrowserFallback: true, 
        error: err.message 
      });
    }
  });
}
