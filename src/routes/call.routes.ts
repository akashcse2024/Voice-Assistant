import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import twilio from 'twilio';
import { prisma } from '../db/prisma';
import { env } from '../config/env';
import { sessionManager } from '../services/session.service';
import { generateChatResponse, detectLanguage } from '../services/ai.service';
import { createModuleLogger } from '../utils/logger';
import { maskPhone } from '../utils/pii-mask';

const log = createModuleLogger('call-routes');
const twilioClient = twilio(env.TWILIO_ACCOUNT_SID, env.TWILIO_AUTH_TOKEN);

// Validation schemas
const startCallSchema = z.object({
  phone: z.string().min(10, 'Phone number required'),
  name: z.string().optional(),
  agent: z.enum(['Priya', 'Arjun']).default('Priya'),
});

const campaignSchema = z.object({
  customers: z.array(
    z.object({
      phone: z.string().min(10),
      name: z.string().optional(),
    })
  ),
  agent: z.enum(['Priya', 'Arjun']).default('Priya'),
});

export async function callRoutes(fastify: FastifyInstance): Promise<void> {
  /**
   * POST /api/call/start — Initiate an outbound call
   */
  fastify.post('/start', async (request: FastifyRequest, reply: FastifyReply) => {
    const { phone, name, agent } = startCallSchema.parse(request.body);

    try {
      const call = await twilioClient.calls.create({
        to: phone,
        from: env.TWILIO_PHONE_NUMBER,
        url: `${env.BASE_URL}/api/call/answer?agent=${agent}&name=${encodeURIComponent(name || 'Customer')}`,
        statusCallback: `${env.BASE_URL}/api/call/status`,
        statusCallbackEvent: ['initiated', 'ringing', 'answered', 'completed'],
      });

      // Initialize session
      sessionManager.create({
        callSid: call.sid,
        customerPhone: phone,
        customerName: name,
      });

      log.info({ callSid: call.sid, phone: maskPhone(phone) }, 'Outbound call initiated');

      return reply.send({
        success: true,
        callSid: call.sid,
        message: 'Call initiated successfully',
      });
    } catch (error: any) {
      log.error({ err: error, phone }, 'Failed to initiate Twilio call');
      return reply.status(500).send({
        success: false,
        error: error.message,
      });
    }
  });

  /**
   * POST /api/call/answer — Twilio Answer Webhook
   */
  fastify.post('/answer', async (request: FastifyRequest, reply: FastifyReply) => {
    const body = request.body as any;
    const callSid = body?.CallSid;
    console.log(`TWILIO WEBHOOK HIT - CALL ANSWER — CallSid: ${callSid}`);

    const query = request.query as any;
    const agent = query.agent || 'Priya';
    const name = query.name || 'Customer';
    const voice = agent === 'Priya' ? 'Polly.Aditi' : 'Polly.Raveena';

    const twiml = new twilio.twiml.VoiceResponse();
    const greeting = `Hello ${name}! I am ${agent} from Vizza Insurance. I'm calling to discuss your insurance needs. Do you have a moment to talk?`;

    twiml.say({ voice: voice as any, language: 'en-IN' }, greeting);
    
    // Initial Gather
    twiml.gather({
      input: ['speech'],
      action: `${env.BASE_URL}/api/call/respond?agent=${agent}`,
      language: 'en-IN',
      speechTimeout: 'auto',
      speechModel: 'phone_call',
      enhanced: true as any,
    });

    // Fallback if no speech detected
    twiml.say({ voice: voice as any, language: 'en-IN' }, "I did not hear anything. Please call us back later. Goodbye.");
    twiml.hangup();

    // Add to history
    if (callSid) {
      sessionManager.addMessage(callSid, { role: 'assistant', content: greeting });
    }

    return reply.type('text/xml').send(twiml.toString());
  });

  /**
   * POST /api/call/respond — Twilio Response Webhook
   */
  fastify.post('/respond', async (request: FastifyRequest, reply: FastifyReply) => {
    const body = request.body as any;
    const speechResult = body?.SpeechResult;
    const callSid = body?.CallSid;
    
    console.log(`TWILIO WEBHOOK HIT - CALL RESPOND — SpeechResult: "${speechResult}" — CallSid: ${callSid}`);

    const query = request.query as any;
    const agent = query.agent || 'Priya';
    const voice = agent === 'Priya' ? 'Polly.Aditi' : 'Polly.Raveena';

    const twiml = new twilio.twiml.VoiceResponse();

    if (!speechResult) {
      twiml.say({ voice: voice as any, language: 'en-IN' }, "I'm sorry, I didn't catch that. Could you please repeat?");
      twiml.gather({
        input: ['speech'],
        action: `${env.BASE_URL}/api/call/respond?agent=${agent}`,
        language: 'en-IN',
        speechTimeout: 'auto',
        speechModel: 'phone_call',
        enhanced: true as any,
      });
      
      // Fallback if no speech detected after retry
      twiml.say({ voice: voice as any, language: 'en-IN' }, "Still nothing. I'll let you go for now. Goodbye.");
      twiml.hangup();

      return reply.type('text/xml').send(twiml.toString());
    }

    // Process with AI
    try {
      sessionManager.addMessage(callSid, { role: 'user', content: speechResult });
      
      const history = sessionManager.getConversationContext(callSid);
      const language = detectLanguage(speechResult);
      
      const aiReply = await generateChatResponse(history, agent, language);
      sessionManager.addMessage(callSid, { role: 'assistant', content: aiReply });

      // Check for escalation
      const escalationKeywords = ['complaint', 'manager', 'human', 'supervisor', 'talk to someone'];
      const needsEscalation = escalationKeywords.some(kw => speechResult.toLowerCase().includes(kw));

      if (needsEscalation && env.HUMAN_AGENT_NUMBER) {
        twiml.say({ voice: voice as any, language: 'en-IN' }, "I understand. Let me transfer you to a human agent right away. Please hold on.");
        twiml.dial(env.HUMAN_AGENT_NUMBER);
      } else {
        twiml.say({ voice: voice as any, language: 'en-IN' }, aiReply);
        twiml.gather({
          input: ['speech'],
          action: `${env.BASE_URL}/api/call/respond?agent=${agent}`,
          language: 'en-IN',
          speechTimeout: 'auto',
          speechModel: 'phone_call',
          enhanced: true as any,
        });

        // Fallback
        twiml.say({ voice: voice as any, language: 'en-IN' }, "I'm waiting for your response. If you're still there, please speak up, or we can talk later. Goodbye.");
        twiml.hangup();
      }
    } catch (error) {
      log.error({ err: error, callSid }, 'AI processing error in call');
      twiml.say({ voice: voice as any, language: 'en-IN' }, "I'm having a bit of trouble connecting to my system. Can we speak again in a few minutes?");
      twiml.hangup();
    }

    return reply.type('text/xml').send(twiml.toString());
  });

  /**
   * POST /api/call/status — Twilio Status Callback
   */
  fastify.post('/status', async (request: FastifyRequest, reply: FastifyReply) => {
    const body = request.body as any;
    const callSid = body.CallSid;
    const status = body.CallStatus;
    const duration = body.CallDuration;

    log.info({ callSid, status, duration }, 'Call status update');

    if (['completed', 'failed', 'busy', 'no-answer'].includes(status)) {
      const session = sessionManager.get(callSid);
      if (session) {
        // Log to database if prisma is available
        try {
          await prisma.callLog.create({
            data: {
              callSid,
              customerPhone: session.customerPhone,
              customerName: session.customerName,
              status: status.toUpperCase(),
              duration: duration ? parseInt(duration) : 0,
              transcript: JSON.stringify(session.conversationHistory),
            },
          });
        } catch (dbError) {
          log.warn({ dbError }, 'Failed to save call log to database');
        }
        sessionManager.destroy(callSid);
      }
    }

    return reply.send({ success: true });
  });

  /**
   * POST /api/call/campaign — Sequential Campaign
   */
  fastify.post('/campaign', async (request: FastifyRequest, reply: FastifyReply) => {
    const { customers, agent } = campaignSchema.parse(request.body);
    
    log.info({ count: customers.length }, 'Starting sequential campaign');

    // Start in background
    (async () => {
      for (const customer of customers) {
        try {
          await twilioClient.calls.create({
            to: customer.phone,
            from: env.TWILIO_PHONE_NUMBER,
            url: `${env.BASE_URL}/api/call/answer?agent=${agent}&name=${encodeURIComponent(customer.name || 'Customer')}`,
          });
          log.info({ phone: customer.phone }, 'Campaign call initiated');
        } catch (err) {
          log.error({ err, phone: customer.phone }, 'Failed to initiate campaign call');
        }
        // Wait 5 seconds between calls as requested
        await new Promise(resolve => setTimeout(resolve, 5000));
      }
    })();

    return reply.send({
      success: true,
      message: `Campaign started for ${customers.length} customers`,
    });
  });
}

