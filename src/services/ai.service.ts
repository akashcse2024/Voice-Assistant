/**
 * AI Conversation Service — Groq API integration.
 * Manages conversation generation using llama3-8b-8192.
 */

import Groq from 'groq-sdk';
import { env } from '../config/env';
import { FALLBACK_RESPONSES } from '../config/constants';
import { createModuleLogger } from '../utils/logger';
import { sessionManager } from './session.service';

const log = createModuleLogger('ai-service');

const groq = new Groq({ apiKey: env.GROQ_API_KEY });

/**
 * Automatic Language Detection
 */
/**
 * Automatic Language Detection — Returns 'english' or 'tamil' only.
 */
export function detectLanguage(text: string): 'english' | 'tamil' {
  // Check for Tamil Unicode characters OR Tanglish keywords
  const hasTamilScript = /[\u0B80-\u0BFF]/.test(text);

  const tanglishWords = [
    'enna', 'sollu', 'sari', 'illa', 'iruku', 'romba', 'nalla',
    'konjam', 'yevlo', 'evlo', 'venduma', 'vendam', 'epdi',
    'namba', 'machi', 'vanakkam', 'naan', 'unga'
  ];
  const lowercaseText = text.toLowerCase();
  const isTanglish = tanglishWords.some(word =>
    new RegExp(`\\b${word}\\b`).test(lowercaseText)
  );

  if (hasTamilScript || isTanglish) return 'tamil';

  return 'english';
}

/**
 * Shared System Prompt Builder — Tri-modal Support
 */
export function buildSystemPrompt(
  agentName: string,
  languageMode: 'english' | 'tamil',
  currentUserMessage: string = ''
) {
  let subMode = 'english';
  if (languageMode === 'tamil') {
    const hasTamilScript = /[\u0B80-\u0BFF]/.test(currentUserMessage);
    subMode = hasTamilScript ? 'tamil-script' : 'tanglish';
  }

  console.log(`Building prompt — mode: ${languageMode} | sub-mode: ${subMode}`);

  let languageInstruction = '';

  if (subMode === 'tamil-script') {
    languageInstruction = `
[PURE TAMIL MODE]
- User writes in Tamil script. You MUST reply entirely in Tamil script.
- Write your full answer in Tamil.
- Use natural conversational Tamil, not formal written Tamil.
- Insurance terms like premium, policy, cover, claim can stay in English but write everything else in Tamil script.
- Example:
  User: "ஹெல்த் இன்சுரன்ஸ் பத்தி சொல்லு"
  Agent: "ஹெல்த் பிளஸ் பிளானில் மருத்துவமனை சேர்க்கை, அறுவை சிகிச்சை, மருந்துகள் எல்லாம் cover ஆகும். உங்கள் குடும்பத்திற்கு plan தேவையா?"
- Example:
  User: "காப்பீடு எவ்வளவு ஆகும்"
  Agent: "உங்கள் வயது மற்றும் family size பொறுத்து cost மாறும். தோராயமாக மாதம் 599 ரூபாய் முதல் தொடங்கும். உங்கள் வயது என்ன?"
`;
  } else if (subMode === 'tanglish') {
    languageInstruction = `
[TANGLISH MODE]
- User speaks in Tanglish. Respond in Tanglish (Tamil words written in English letters).
- STRICT RULE: NEVER use Tamil script characters.
- Example:
  User: "enna cover iruku health plan la"
  Agent: "Health Plus la hospitalisation, surgery, medicines ellame cover aagum. Unga family ku plan venum-a?"
`;
  } else {
    languageInstruction = `
[ENGLISH MODE]
- Respond in simple, warm Indian English.
- Example: 
  User: "what does health insurance cover"
  Agent: "Health Plus covers hospitalisation, surgery, daycare procedures and ambulance charges. Would you like to know about the premium?"
`;
  }

  return `You are ${agentName}, a warm and fast voice assistant for Vizza Insurance.
Your CRITICAL rule is to match the user's language mode EXACTLY.

${languageInstruction}

[VIZZA INSURANCE PRODUCTS]
- Vizza Health Plus: hospitalisation, 3L-1Cr, from 599/month.
- Vizza Drive Safe: Motor insurance, claims in 7 days.
- Vizza Life Secure: Term life up to 5Cr, from 500/month.
- Vizza Home Guard: Home insurance, from 2000/year.

[STRICT RULES]
- Max ${languageMode === 'tamil' ? '4' : '3'} sentences per response.
- End with a short question.
- Match the user's detected mode exactly. Never mix modes.
- Plain text only (no markdown, no bold, no lists).`;
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
    const lastUserMessage = messages.filter(m => m.role === 'user').pop()?.content || '';
    const systemPrompt = buildSystemPrompt(agentName, language, lastUserMessage);

    const completion = await groq.chat.completions.create({
      model: env.GROQ_MODEL,
      messages: [
        { role: 'system', content: systemPrompt },
        ...messages
      ],
      max_tokens: 80,
      temperature: 0.7,
      stop: [".", "?", "!", "।"]
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
/**
 * Generate a response for an active call session
 */
export async function generateCallResponse(
  callSid: string,
  transcript: string
): Promise<string> {
  const session = sessionManager.get(callSid);
  if (!session) return FALLBACK_RESPONSES.AI_ERROR;

  const messages = sessionManager.getConversationContext(callSid);
  const language = detectLanguage(transcript);
  
  return await generateChatResponse(messages, 'Priya', language);
}

/**
 * Analyze user intent (non-blocking)
 */
export async function analyzeIntent(text: string): Promise<any> {
  // Mock intent analysis for now
  return {
    interestedPolicy: text.toLowerCase().includes('health') ? 'health' : null,
    wantsToBuy: text.toLowerCase().includes('buy') || text.toLowerCase().includes('interested'),
  };
}
