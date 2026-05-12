import { generateGreeting } from './src/services/ai.service';
generateGreeting('test-call').then(console.log).catch(console.error);
