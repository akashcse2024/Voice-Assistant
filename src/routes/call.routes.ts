import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import twilio from 'twilio';
import { env } from '../config/env';
import { generateChatResponse, detectLanguage } from '../services/ai.service';
import { startCampaign } from '../services/campaign.service';
import { createModuleLogger } from '../utils/logger';

const log = createModuleLogger('call-routes');
const twilioClient = twilio(env.TWILIO_ACCOUNT_SID, env.TWILIO_AUTH_TOKEN);

/**
 * GLOBAL CALL SESSIONS MAP
 * Stores conversation history per CallSid
 */
const callSessions = new Map<string, any[]>();

// Validation schema for start call
const startCallSchema = z.object({
  customerPhone: z.string().min(10),
  customerName: z.string().optional(),
  agentName: z.enum(['Priya', 'Arjun']).default('Priya'),
});

const campaignSchema = z.object({
  customers: z.array(z.object({
    customerPhone: z.string().min(10),
    customerName: z.string().optional(),
  })),
  agentName: z.enum(['Priya', 'Arjun']).default('Priya'),
  campaignName: z.string().default('Bulk Campaign'),
});

export async function callRoutes(fastify: FastifyInstance): Promise<void> {
  /**
   * POST /api/call/start — Initiate an outbound call
   */
  fastify.post('/start', async (request: FastifyRequest, reply: FastifyReply) => {
    console.log('START ROUTE HIT - body:', JSON.stringify(request.body || {}));
    const body = (request.body || {}) as any;
    
    // Debug logging for received keys (PII masked)
    const receivedKeys = Object.keys(body || {});
    const maskedPhone = body.customerPhone ? 
      (body.customerPhone.substring(0, 3) + '****' + body.customerPhone.substring(body.customerPhone.length - 3)) : 
      (body.phone ? (body.phone.substring(0, 3) + '****' + body.phone.substring(body.phone.length - 3)) : 'missing');
    
    log.info({ receivedKeys, phoneProvided: maskedPhone }, 'RECEIVED START CALL REQUEST');

    // Validation
    const validation = startCallSchema.safeParse(body);
    if (!validation.success) {
      log.warn({ errors: validation.error.format() }, 'Validation failed for /api/call/start');
      return reply.status(400).send({
        error: "customerPhone is required",
        details: validation.error.format(),
        expectedBody: {
          customerPhone: "+91XXXXXXXXXX",
          customerName: "Optional Name",
          agentName: "Priya | Arjun"
        }
      });
    }

    const { customerPhone, customerName, agentName } = validation.data;

    // E.164 Formatting
    let phone = customerPhone.trim();
    if (phone.startsWith('0')) {
      phone = '+91' + phone.substring(1);
    } else if (phone.length === 10 && !phone.startsWith('+')) {
      phone = '+91' + phone;
    } else if (phone.length > 10 && !phone.startsWith('+')) {
      phone = '+' + phone;
    }

    try {
      const callOptions = {
        to: phone,
        from: env.TWILIO_PHONE_NUMBER,
        url: `${env.BASE_URL}/api/call/answer?agentName=${agentName}&customerName=${encodeURIComponent(customerName || 'Customer')}`,
        statusCallback: `${env.BASE_URL}/api/call/status`,
        method: 'POST' as const,
      };

      log.info({ 
        to: phone, 
        from: callOptions.from, 
        twimlUrl: callOptions.url 
      }, 'INITIATING TWILIO CALL');
      
      const call = await twilioClient.calls.create(callOptions);
      log.info({ callSid: call.sid }, 'TWILIO CALL CREATED SUCCESSFULLY');

      // Initialize session history
      callSessions.set(call.sid, []);

      return reply.send({
        success: true,
        callSid: call.sid,
      });
    } catch (error: any) {
      log.error({ err: error }, 'Twilio Call Creation Failed');
      return reply.status(500).send({ success: false, error: error.message });
    }
  });

  /**
   * POST /api/call/campaign — Start a bulk calling campaign
   */
  fastify.post('/campaign', async (request: FastifyRequest, reply: FastifyReply) => {
    const body = request.body as any;
    
    const validation = campaignSchema.safeParse(body);
    if (!validation.success) {
      return reply.status(400).send({
        error: "Invalid campaign data",
        details: validation.error.format(),
        expectedBody: {
          customers: [{ customerPhone: "+91XXXXXXXXXX", customerName: "Optional" }],
          agentName: "Priya | Arjun",
          campaignName: "Optional"
        }
      });
    }

    const { customers, agentName, campaignName } = validation.data;

    try {
      const result = await startCampaign({
        name: campaignName,
        customers: customers
      });

      return reply.send({
        success: true,
        campaignId: result.campaignId,
        total: result.totalCustomers
      });
    } catch (error: any) {
      log.error({ err: error }, 'Campaign Start Failed');
      return reply.status(500).send({ success: false, error: error.message });
    }
  });

  /**
   * POST/GET /api/call/answer — Twilio Answer Webhook (Media Stream)
   */
  const answerHandler = async (request: FastifyRequest, reply: FastifyReply) => {
    const body = (request.body || {}) as any;
    console.log('ANSWER ROUTE HIT - CallSid:', body.CallSid, 'To:', body.To);
    const query = request.query as any;
    const agentName = query.agentName || 'Priya';
    const customerName = query.customerName || 'Customer';

    const twiml = new twilio.twiml.VoiceResponse();
    
    // Derived WebSocket URL from BASE_URL
    const wsUrl = env.BASE_URL.replace('https://', 'wss://').replace('http://', 'ws://');
    const streamUrl = `${wsUrl}/api/calls/media-stream`;

    log.info({ streamUrl, agentName, baseUrl: env.BASE_URL }, 'Returning Media Stream TwiML');

    const connect = twiml.connect();
    const stream = connect.stream({
      url: streamUrl,
    });
    
    // Pass metadata to the stream
    stream.parameter({ name: 'agentName', value: agentName });
    stream.parameter({ name: 'customerName', value: customerName });

    const twimlStr = twiml.toString();
    log.info({ twiml: twimlStr }, 'Generated TwiML');

    return reply.type('text/xml').send(twimlStr);
  };

  fastify.post('/answer', answerHandler);
  fastify.get('/answer', answerHandler);

  /**
   * POST /api/call/respond — Twilio Response Webhook (AI PROCESSING)
   */
  fastify.post('/respond', async (request: FastifyRequest, reply: FastifyReply) => {
    const body = (request.body || {}) as any;
    console.log('RESPOND ROUTE HIT - Speech:', body.SpeechResult, 'CallSid:', body.CallSid);
    const speechResult = body.SpeechResult;
    const callSid = body.CallSid;
    const query = request.query as any;
    const agentName = query.agentName || 'Priya';

    const twiml = new twilio.twiml.VoiceResponse();

    if (!speechResult) {
      twiml.say({ voice: 'Polly.Aditi' as any, language: 'en-IN' }, "I did not catch that, could you repeat please");
      twiml.gather({
        input: ['speech'],
        action: `${env.BASE_URL}/api/call/respond?agentName=${agentName}`,
        method: 'POST',
        language: 'en-IN',
        speechTimeout: '3',
        speechModel: 'phone_call',
      });
      return reply.type('text/xml').send(twiml.toString());
    }

    // Process with Groq and history
    try {
      let history = callSessions.get(callSid) || [];
      history.push({ role: 'user', content: speechResult });

      const language = detectLanguage(speechResult);

      // 8 second timeout logic
      const aiResponsePromise = generateChatResponse(history, agentName, language);
      const timeoutPromise = new Promise<string>((_, reject) => 
        setTimeout(() => reject(new Error('TIMEOUT')), 8000)
      );

      let aiReply: string;
      try {
        aiReply = await Promise.race([aiResponsePromise, timeoutPromise]);
      } catch (err) {
        log.warn({ callSid }, 'Groq Timeout or Error');
        aiReply = "I am having a small technical issue, please repeat your question";
      }

      history.push({ role: 'assistant', content: aiReply });
      callSessions.set(callSid, history);

      twiml.say({ voice: 'Polly.Aditi' as any, language: 'en-IN' }, aiReply);

      twiml.gather({
        input: ['speech'],
        action: `${env.BASE_URL}/api/call/respond?agentName=${agentName}`,
        method: 'POST',
        language: 'en-IN',
        speechTimeout: '3',
        speechModel: 'phone_call',
      });

    } catch (error) {
      log.error({ error }, 'RESPOND ROUTE ERROR');
      twiml.say({ voice: 'Polly.Aditi' as any, language: 'en-IN' }, "I am having a small technical issue, please repeat your question");
      twiml.gather({
        input: ['speech'],
        action: `${env.BASE_URL}/api/call/respond?agentName=${agentName}`,
        method: 'POST',
        language: 'en-IN',
        speechTimeout: '3',
        speechModel: 'phone_call',
      });
    }

    return reply.type('text/xml').send(twiml.toString());
  });

  /**
   * POST /api/call/status — Twilio Status Callback
   */
  fastify.post('/status', async (request: FastifyRequest, reply: FastifyReply) => {
    const body = (request.body || {}) as any;
    console.log('STATUS ROUTE HIT - Status:', body.CallStatus, 'Duration:', body.CallDuration);
    const callSid = body.CallSid;
    const status = body.CallStatus;

    log.info({ callSid, status }, 'CALL STATUS UPDATE');

    if (status === 'completed' || status === 'failed') {
      callSessions.delete(callSid);
      log.info({ callSid }, 'Session cleaned up');
    }

    return reply.send({ success: true });
  });

  /**
   * Diagnostic 9 — Twilio Credentials Verification
   */
  fastify.get('/twilio-test', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const client = twilio(env.TWILIO_ACCOUNT_SID, env.TWILIO_AUTH_TOKEN);
      const account = await client.api.accounts(env.TWILIO_ACCOUNT_SID).fetch();
      return reply.send({
        status: 'credentials valid',
        accountName: account.friendlyName,
        accountStatus: account.status,
        twilioNumber: env.TWILIO_PHONE_NUMBER,
        baseUrl: env.BASE_URL
      });
    } catch (err: any) {
      return reply.send({
        status: 'credentials failed',
        error: err.message
      });
    }
  });

  /**
   * Diagnostic 10 — Manual TwiML Test
   */
  fastify.get('/twiml-test', async (request: FastifyRequest, reply: FastifyReply) => {
    const response = new twilio.twiml.VoiceResponse();
    response.say({
      voice: 'Polly.Aditi' as any,
      language: 'en-IN'
    }, 'This is a test. Priya is speaking. The TwiML is working correctly.');
    response.gather({
      input: ['speech'],
      action: env.BASE_URL + '/api/call/respond',
      method: 'POST',
      language: 'en-IN',
      speechTimeout: '3'
    });
    return reply.type('text/xml').send(response.toString());
  });
}

