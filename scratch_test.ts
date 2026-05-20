const MULAW_BIAS = 33;
function mulawToLinear(mulawByte: number): number {
  mulawByte = ~mulawByte;
  const sign = (mulawByte & 0x80) ? -1 : 1;
  const exponent = (mulawByte & 0x70) >> 4;
  const mantissa = mulawByte & 0x0f;
  let sample = (mantissa << 3) + 132;
  sample <<= exponent;
  sample -= MULAW_BIAS;
  return sign * sample;
}

function getMulawEnergy(buffer: Buffer): number {
  let sumSquares = 0;
  for (let i = 0; i < buffer.length; i++) {
    const sample = mulawToLinear(buffer[i]);
    sumSquares += sample * sample;
  }
  return Math.sqrt(sumSquares / buffer.length);
}

// Generate silence buffer (0xFF)
const silenceBuf = Buffer.alloc(160, 0xff);
console.log('Silence RMS:', getMulawEnergy(silenceBuf));

// Generate max volume buffer (0x00 and 0x80)
const loudBuf = Buffer.alloc(160);
for (let i = 0; i < 160; i++) loudBuf[i] = i % 2 === 0 ? 0x00 : 0x80;
console.log('Loud RMS:', getMulawEnergy(loudBuf));
