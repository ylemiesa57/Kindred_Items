import 'dotenv/config'
import express from 'express'
import OpenAI from 'openai'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { z } from 'zod'

const app = express()
const port = Number(process.env.PORT ?? 8787)
const host = process.env.HOST ?? '0.0.0.0'

const OPENROUTER_BASE_URL = 'https://openrouter.ai/api/v1'
const DEFAULT_MODEL = 'openai/gpt-oss-20b:free'

function reasoningModel() {
  return process.env.OPENROUTER_MODEL ?? DEFAULT_MODEL
}

app.disable('x-powered-by')
app.use(express.json({ limit: '8mb' }))

function openRouterClient() {
  const apiKey = process.env.OPENROUTER_API_KEY
  if (!apiKey) return null
  return new OpenAI({
    apiKey,
    baseURL: OPENROUTER_BASE_URL,
    defaultHeaders: {
      'HTTP-Referer': process.env.OPENROUTER_SITE_URL ?? 'http://localhost:5173',
      'X-Title': process.env.OPENROUTER_APP_NAME ?? 'Kindred Objects',
    },
  })
}

app.get('/api/health', (_request, response) => {
  response.json({
    ok: true,
    provider: 'openrouter',
    openRouterConfigured: Boolean(process.env.OPENROUTER_API_KEY),
    model: reasoningModel(),
  })
})

const worldSceneJsonSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['summary', 'spokenResponse', 'objects', 'importantChange'],
  properties: {
    summary: { type: 'string' },
    spokenResponse: { type: 'string' },
    importantChange: { type: ['string', 'null'] },
    objects: {
      type: 'array',
      maxItems: 20,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['label', 'matchedTwinId', 'description', 'location', 'visibleState', 'confidence'],
        properties: {
          label: { type: 'string' },
          matchedTwinId: { type: ['string', 'null'] },
          description: { type: 'string' },
          location: { type: 'string' },
          visibleState: { type: 'string' },
          confidence: { type: 'number', minimum: 0, maximum: 1 },
        },
      },
    },
  },
} as const

const worldSceneSchema = z.object({
  summary: z.string(),
  spokenResponse: z.string(),
  importantChange: z.string().nullable(),
  objects: z.array(z.object({
    label: z.string(),
    matchedTwinId: z.string().nullable(),
    description: z.string(),
    location: z.string(),
    visibleState: z.string(),
    confidence: z.number().min(0).max(1),
  })).max(20),
})

app.post('/api/world/analyze', async (request, response) => {
  const client = openRouterClient()
  if (!client) {
    response.status(503).json({ error: 'OpenRouter is not configured on the server.' })
    return
  }

  const { twins, previousScene, question } = request.body as {
    twins?: unknown
    previousScene?: unknown
    question?: string
  }

  try {
    const result = await client.chat.completions.create({
      model: reasoningModel(),
      messages: [
        {
          role: 'system',
          content:
            'You are Kindred World Guide, a calm memory-support companion. Return only valid JSON matching the requested schema. You cannot see any camera image; reason only from the known twins and their confirmed state. Never invent objects, diagnose, make medication decisions, claim hidden observations, or imply consciousness.',
        },
        {
          role: 'user',
          content: [
            'Help a person understand the objects they already registered in this memory-support app.',
            'You do not have a camera frame. Build the scene only from the known twins listed below, using their confirmed current state and usual location.',
            'For each known twin include it in objects with matchedTwinId set to its id, description from its details, location from its usual location, and visibleState from its current state. Never fabricate objects that are not in the known twins list.',
            'Set importantChange to at most one notable difference from the previous scene, or null when nothing meaningful changed.',
            'spokenResponse must be one short, respectful sentence. If there is a question, answer it from the known twins and confirmed state, and state uncertainty when the information is missing. Otherwise summarize the known objects.',
            `Known twins: ${JSON.stringify(twins ?? [])}`,
            `Previous scene: ${JSON.stringify(previousScene ?? null)}`,
            question ? `The person asks: ${question}` : '',
            `Required JSON schema: ${JSON.stringify(worldSceneJsonSchema)}`,
          ].filter(Boolean).join('\n'),
        },
      ],
      response_format: { type: 'json_object' },
      temperature: 0.2,
      max_tokens: 2000,
    })

    const content = result.choices[0]?.message.content
    if (!content) throw new Error('OpenRouter returned an empty scene analysis.')
    response.json(worldSceneSchema.parse(JSON.parse(content)))
  } catch (error) {
    console.error('World analysis error', error)
    response.status(502).json({ error: 'The room could not be analyzed right now.' })
  }
})

if (process.env.NODE_ENV === 'production') {
  const currentDirectory = path.dirname(fileURLToPath(import.meta.url))
  const dist = path.resolve(currentDirectory, '../dist')
  app.use(express.static(dist))
  app.get('/{*splat}', (_request, response) => response.sendFile(path.join(dist, 'index.html')))
}

app.listen(port, host, () => {
  console.log(`Kindred Objects server listening at http://${host}:${port}`)
})
