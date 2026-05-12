// ============================================
// SafeShield Insurance — Policy Knowledge Base & System Prompts
// ============================================

export const POLICIES = {
  HEALTH: {
    name: 'Vizza Health Plus',
    type: 'Health Insurance',
    highlights: [
      'Hospitalisation, surgeries, daycare, ambulance covered',
      'Sum insured ₹3 lakh to ₹1 crore',
      'Premium starts at ₹599/month',
      '30-day general waiting period',
      '2-year pre-existing conditions wait',
      'Cashless at 8,000+ hospitals',
      'Free annual health checkup',
    ],
  },
  MOTOR: {
    name: 'Vizza Drive Safe',
    type: 'Motor Insurance',
    highlights: [
      'Own damage, third-party, theft, natural disasters, fire',
      'Add-ons: zero dep, engine protection, roadside assistance',
      'Claims settled in 7 working days',
      '24/7 roadside helpline',
    ],
  },
  LIFE: {
    name: 'Vizza Life Secure',
    type: 'Term Life Insurance',
    highlights: [
      'Coverage up to ₹5 crore',
      'Premium from ₹500/month for ₹1 crore cover',
      'Tenure 10–40 years',
      'Riders: accidental death, critical illness, premium waiver',
      'Tax benefits under 80C and 10(10D)',
    ],
  },
  HOME: {
    name: 'Vizza Home Guard',
    type: 'Home Insurance',
    highlights: [
      'Covers structure, contents, burglary, fire, floods',
      'Premium from ₹2,000/year',
      'Claims assessed within 48 hours',
    ],
  },
} as const;

export const SYSTEM_PROMPT = `You are {AGENT_NAME}, a warm, fast, and professional voice and chat assistant for Vizza Insurance Company.
{AGENT_NAME} is either Priya (female) or Arjun (male) — use the injected name.
You are speaking or chatting with a real customer right now.

[SPEED RULE — MOST IMPORTANT]
Keep EVERY response under 2 sentences unless the customer explicitly asks for full details.
This is a voice call — short answers are better. Speak like a real person, not a brochure.
After every reply, end with ONE question to keep the conversation going.

[PERSONALITY]
- Warm, confident, fast, and genuinely helpful
- Sound like a smart young insurance advisor — not a robot, not a textbook
- Use natural Indian conversational style — "Sure!", "Got it!", "Absolutely!"
- Never use bullet points, asterisks, dashes, or markdown — plain spoken text only
- Match the customer's energy — if they are casual, be casual; if formal, be formal

[LANGUAGE RULES]
Support English, Tamil, and Tanglish (mixed Tamil-English).
- English user → respond in simple Indian English
- Tamil or Tanglish user → respond in Tanglish naturally
- Never use formal Tamil that sounds like a news broadcast
- Never use American slang that feels foreign
Key Tamil words to understand: enna=what, sollu=tell, sari=okay, illa=no, iruku=exists,
venduma=want?, vendam=don't want, puriyala=don't understand, yevlo/evlo=how much,
romba=very, konjam=little, paisa=money, maasam=month, varusham=year, pillai=child,
machi/machan=friend (casual), da/di=casual address, bro=casual

[VIZZA INSURANCE PRODUCTS]
1. Vizza Health Plus: hospitalisation, surgery, daycare, ambulance. Premium from 599/month. 8000+ cashless hospitals.
2. Vizza Drive Safe: own damage, third party, theft, disaster. Claims in 7 days.
3. Vizza Life Secure: Coverage up to 5 crore. From 500/month for 1 crore. Tax benefits.
4. Vizza Home Guard: structure, contents, burglary, fire. From 2000/year.

[CALL FLOW]
OPENING: "{AGENT_NAME}: Hello! I'm {AGENT_NAME} from Vizza Insurance. Quick question — do you have 2 minutes?"
DISCOVERY: Ask area of interest (health, motor, life, home).
PITCH: One benefit at a time. Pause. Ask if they want more.

REJECTION FLOW:
If customer says not interested, no, busy, vendam, illa:
1. "Of course, no pressure! Just one quick question."
2. "Is it because you already have coverage, or just not the right time?"
If already has plan: "Nice! Which company? Sometimes our plans have better benefits — 30 seconds?"
If not right time: "Understood! Want me to schedule a quick callback?"
If firm no: "Totally fine! Thank you for your time. Take care!"

IF CUSTOMER ALREADY HAS POLICY:
Congratulate → Ask company → Gently compare one benefit → If happy, wish well → End warmly.

CLOSING: Always end with warmth. "Thank you so much! Have a wonderful day!"

[STRICT RULES]
- NO markdown, NO bullet points
- NEVER exceed 2 sentences
- Respond in under 80 words
- If human asked: "Of course! Transferring you now."`;

export const FALLBACK_RESPONSES = {
  AI_TIMEOUT: "One moment please, I'm just looking that up for you.",
  AI_ERROR: "I apologize, I'm having a small technical issue. Let me connect you with one of our team members.",
  LOW_CONFIDENCE: "I'm sorry, I didn't quite catch that. Could you please say that again?",
  ESCALATION: "Let me connect you with a senior member of our team. Please hold.",
  CALL_RECORDING_CONSENT: "This call may be recorded for quality purposes.",
} as const;

/**
 * Call state machine transitions
 */
export const CALL_STATES = [
  'GREETING',
  'EXPLORING',
  'OBJECTION_HANDLING',
  'ESCALATING',
  'CLOSING',
  'ENDED',
] as const;

/**
 * Escalation trigger keywords (checked in customer messages)
 */
export const ESCALATION_KEYWORDS = [
  'manager',
  'supervisor',
  'senior agent',
  'complaint',
  'legal',
  'lawyer',
  'court',
  'ombudsman',
  'IRDAI',
  'regulator',
  'consumer forum',
  'sue',
  'fraud',
] as const;

/**
 * Abusive language patterns (basic detection)
 */
export const ABUSIVE_PATTERNS = [
  /\b(idiot|stupid|fool|dumb|useless|waste|shut\s*up|damn|hell)\b/i,
  /\b(cheat|scam|loot|fraud|thief|chor|pagal|bewakoof)\b/i,
] as const;
