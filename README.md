# SafeShield Voice Assistant

AI-Powered Outbound Insurance Voice Assistant for SafeShield Insurance.

An automated voice assistant ("Priya") that proactively calls insurance customers, delivers policy information conversationally, handles real-time questions, and routes complex queries to human agents.

## Tech Stack

| Component | Technology |
|-----------|-----------|
| Runtime | Node.js 20+ (TypeScript) |
| API Framework | Fastify 5 |
| Database | PostgreSQL + Prisma ORM |
| Telephony | Twilio Voice + Media Streams |
| Speech-to-Text | Deepgram Nova-2 (streaming) |
| AI/LLM | Google Gemini 2.0 Flash |
| Text-to-Speech | Google Cloud TTS (Neural2) |
| Queue | BullMQ + Redis |

## Quick Start

### 1. Prerequisites
- Node.js 20+
- PostgreSQL database
- Redis (for campaign queue)
- Twilio account with a verified phone number
- Deepgram API key
- Google Cloud account (TTS + Gemini API)

### 2. Install Dependencies
```bash
npm install
```

### 3. Configure Environment
```bash
cp .env.example .env
# Edit .env with your credentials
```

### 4. Set Up Database
```bash
npx prisma migrate dev --name init
npx prisma generate
npm run db:seed   # optional: load sample data
```

### 5. Run Development Server
```bash
npm run dev
```

### 6. Expose for Twilio Webhooks (development)
```bash
ngrok http 3000
# Update TWILIO_WEBHOOK_BASE_URL in .env with the ngrok URL
```

## API Endpoints

### Call Management
| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/call/outbound` | Initiate single outbound call |
| POST | `/call/bulk-outbound` | Start bulk campaign |
| POST | `/call/answer` | Twilio webhook — customer answered |
| POST | `/call/status` | Twilio webhook — call status change |

### Dashboard
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/dashboard/calls` | Paginated call logs |
| GET | `/dashboard/calls/:callId` | Full conversation transcript |
| GET | `/dashboard/analytics` | Aggregated statistics |
| GET | `/dashboard/live` | SSE live call updates |

### Leads
| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/leads` | Create a lead |
| GET | `/leads` | List leads (with filters) |
| PATCH | `/leads/:id` | Update a lead |

### Customers
| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/customers` | Add a customer |
| POST | `/customers/upload` | Bulk CSV upload |
| GET | `/customers` | List all customers |

### Testing
| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/test/chat` | Text chat with AI (no voice) |
| DELETE | `/test/chat/:sessionId` | End chat session |

### Health
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/health` | Server health check |

## Authentication

All API endpoints (except Twilio webhooks) require the `x-api-key` header:
```
x-api-key: your-secret-api-key
```

Twilio webhook endpoints verify the `X-Twilio-Signature` header.

## Voice Pipeline

```
Customer speaks → Twilio Media Stream → Deepgram STT → Gemini AI → Google TTS → Twilio playback
```

- End-to-end latency target: < 2 seconds
- Barge-in: customer speech interrupts AI playback immediately
- Low confidence (< 0.5): asks customer to repeat; escalates after 3 failures
- Escalation: detects keywords, abuse, claim queries → transfers to human agent

## Project Structure

```
src/
├── index.ts              # Server entry point
├── config/
│   ├── env.ts            # Zod-validated environment config
│   └── constants.ts      # Policy knowledge base & system prompt
├── db/
│   └── prisma.ts         # Database client
├── routes/
│   ├── call.routes.ts    # Call initiation & webhooks
│   ├── customer.routes.ts
│   ├── lead.routes.ts
│   ├── dashboard.routes.ts
│   └── test.routes.ts
├── services/
│   ├── ai.service.ts     # Gemini conversation engine
│   ├── stt.service.ts    # Deepgram streaming STT
│   ├── tts.service.ts    # Google Cloud TTS
│   ├── telephony.service.ts
│   ├── session.service.ts
│   ├── campaign.service.ts
│   └── escalation.service.ts
├── pipeline/
│   ├── voice-pipeline.ts # STT → AI → TTS orchestrator
│   └── media-stream.ts   # Twilio WebSocket handler
├── middleware/
│   ├── auth.middleware.ts
│   ├── twilio-verify.middleware.ts
│   └── error-handler.ts
├── utils/
│   ├── logger.ts
│   ├── pii-mask.ts
│   ├── audio.ts
│   └── time-window.ts
└── types/
    └── index.ts
```
