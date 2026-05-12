import { processGreeting } from './src/pipeline/voice-pipeline.ts';
processGreeting('test-call').then(console.log).catch(console.error);
