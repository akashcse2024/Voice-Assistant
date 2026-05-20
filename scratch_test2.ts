import { MsEdgeTTS, OUTPUT_FORMAT } from 'msedge-tts';
import ffmpeg from 'fluent-ffmpeg';
import ffmpegInstaller from '@ffmpeg-installer/ffmpeg';
import { Readable, PassThrough } from 'stream';

ffmpeg.setFfmpegPath(ffmpegInstaller.path);

async function synthesizeSpeechMulawWithFfmpeg(text: string, voice = 'en-IN-NeerjaNeural'): Promise<Buffer> {
  const tts = new MsEdgeTTS();
  await tts.setMetadata(voice, OUTPUT_FORMAT.AUDIO_24KHZ_96KBITRATE_MONO_MP3);
  
  const { audioStream } = tts.toStream(text);
  
  return new Promise((resolve, reject) => {
    const outStream = new PassThrough();
    const chunks: Buffer[] = [];
    outStream.on('data', chunk => chunks.push(chunk));
    outStream.on('end', () => resolve(Buffer.concat(chunks)));
    outStream.on('error', reject);

    ffmpeg(audioStream)
      .inputFormat('mp3')
      .audioCodec('pcm_mulaw')
      .audioFrequency(8000)
      .audioChannels(1)
      .format('mulaw')
      .on('error', err => {
        console.error('ffmpeg error:', err);
        reject(err);
      })
      .pipe(outStream);
  });
}

async function test() {
  const buffer = await synthesizeSpeechMulawWithFfmpeg('Hello, this is Priya. I am speaking through Twilio Media Stream using FFmpeg to transcode MP3 to Mulaw.');
  console.log(`Successfully generated Mulaw buffer of length: ${buffer.length}`);
}

test().catch(console.error);
