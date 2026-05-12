/**
 * AI Conversation Service — Groq API integration.
 * Manages conversation generation using llama3-8b-8192.
 */

import Groq from 'groq-sdk';
import { env } from '../config/env';
import { FALLBACK_RESPONSES } from '../config/constants';
import { createModuleLogger } from '../utils/logger';

const log = createModuleLogger('ai-service');

const groq = new Groq({ apiKey: env.GROQ_API_KEY });

/**
 * Shared System Prompt Builder
 */
export function buildSystemPrompt(agentName: string, languageMode: 'english' | 'tamil' = 'english') {
  const tamilInstruction = languageMode === 'tamil'
    ? `The user has selected Tamil mode. ALWAYS respond in Tanglish — 
       natural Tamil and English mixed together in every sentence. 
       Use words like nalla, romba, konjam, sari, illa, enna, sollu, 
       yevlo, puriyuthu, venduma, iruku naturally within English sentences. 
       Never respond in formal Tamil. Never respond in pure English when Tamil mode is on.
       Example: "Namba Health Plus plan romba nalla iruku! 
       Coverage 3 lakh from start aagum. Unga age enna?"`
    : `Always respond in simple, warm Indian English.`;

  return `You are ${agentName}, a warm and fast voice and chat assistant 
for Vizza Insurance Company. You speak with real customers right now.

[SPEED RULE — MOST IMPORTANT]
Keep EVERY response under 2 sentences unless customer asks for full details.
After every reply end with ONE short question. Never monologue.

[PERSONALITY]
Warm, confident, fast, genuinely helpful. Sound like a smart young advisor.
Natural Indian conversational style. Use: Sure! Got it! Absolutely!
NEVER use bullet points, asterisks, dashes, numbered lists, or markdown.
Plain spoken words only — your text is read aloud by a voice engine.

[LANGUAGE]
${tamilInstruction}

[VIZZA INSURANCE PRODUCTS]
Product 1 — Vizza Health Plus: hospitalisation, 3L-1Cr sum insured, premium from 599/month, 8000+ hospitals.
Product 2 — Vizza Drive Safe: Motor insurance, claims in 7 days, 24h roadside.
Product 3 — Vizza Life Secure: Term life up to 5Cr, premium from 500/month.
Product 4 — Vizza Home Guard: Home insurance, from 2000/year.

[CALL FLOW]
DISCOVERY — ask which area interests them.
PITCH — share one benefit, ask if they want more detail.
REJECTION FLOW — if no, ask if already covered or not right time. End warmly.

[STRICT RULES]
NEVER invent details. Max 2 sentences. No markdown.`;
}

/**
 * Text chat for the /test/chat endpoint
 */
export async function generateChatResponse(
  messages: any[],
  agentName: string = 'Priya',
  language: 'english' | 'tamil' = 'english'
): Promise<string> {
  try {
    const systemPrompt = buildSystemPrompt(agentName, language);

    const completion = await groq.chat.completions.create({
      model: env.GROQ_MODEL,
      messages: [
        { role: 'system', content: systemPrompt },
        ...messages
      ],
      max_tokens: 120,
      temperature: 0.7,
    });

    return completion.choices[0]?.message?.content?.trim() || '';
  } catch (error) {
    log.error({ err: error }, 'Groq Chat AI error');
    throw error;
  }
}

/**
 * Legacy support for voice pipeline if needed
 */
export async function generateGreeting(callSid: string): Promise<string> {
  return "Hello! I'm Priya from Vizza Insurance. Do you have 2 minutes?";
}
