import express from 'express'
import OpenAI from 'openai'
import { z } from 'zod'

const OPENROUTER_BASE_URL = 'https://openrouter.ai/api/v1'
const DEFAULT_MODEL = 'openai/gpt-oss-20b:free'
const DEFAULT_VISION_MODEL = 'nvidia/nemotron-nano-12b-v2-vl:free'

function reasoningModel() {
  return process.env.OPENROUTER_MODEL ?? DEFAULT_MODEL
}

function visionModel() {
  return process.env.OPENROUTER_VISION_MODEL ?? DEFAULT_VISION_MODEL
}

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

const app = express()

app.disable('x-powered-by')
app.use(express.json({ limit: '8mb' }))

app.get('/api/health', (_request, response) => {
  response.json({
    ok: true,
    provider: 'openrouter',
    openRouterConfigured: Boolean(process.env.OPENROUTER_API_KEY),
    model: reasoningModel(),
    visionModel: visionModel(),
  })
})

app.post('/api/world/analyze', async (request, response) => {
  const client = openRouterClient()
  if (!client) {
    response.status(503).json({ error: 'OpenRouter is not configured on the server.' })
    return
  }

  const { image, twins, previousScene, question } = request.body as {
    image?: string
    twins?: unknown
    previousScene?: unknown
    question?: string
  }
  const hasFrame = typeof image === 'string' && image.startsWith('data:image/')

  const instructions = [
    'You are helping a person in a memory-support app understand the objects around them.',
    hasFrame
      ? 'Analyze the attached camera frame. List the distinct household objects you can actually see. Match a listed known twin only when the frame gives convincing evidence; otherwise set matchedTwinId to null. Describe only the visible state; do not infer events outside this frame.'
      : 'You do not have a camera frame. Build the scene only from the known twins listed below, using their confirmed current state and usual location, and never invent objects that are not listed.',
    'Set importantChange to at most one clearly notable difference from the previous scene, or null when nothing meaningful changed. Never make medical or emergency claims.',
    'spokenResponse must be one short, respectful sentence. If there is a question, answer it from what is visible or from confirmed information and state uncertainty when unsure. Otherwise summarize the scene.',
    `Known twins: ${JSON.stringify(twins ?? [])}`,
    `Previous scene: ${JSON.stringify(previousScene ?? null)}`,
    question ? `The person asks: ${question}` : '',
    `Required JSON schema: ${JSON.stringify(worldSceneJsonSchema)}`,
  ].filter(Boolean).join('\n')

  const userContent = hasFrame
    ? [
        { type: 'text' as const, text: instructions },
        { type: 'image_url' as const, image_url: { url: image } },
      ]
    : instructions

  try {
    const result = await client.chat.completions.create({
      model: hasFrame ? visionModel() : reasoningModel(),
      messages: [
        {
          role: 'system',
          content:
            'You are Kindred World Guide, a calm memory-support companion. Return only valid JSON matching the requested schema. Never diagnose, make medication decisions, claim hidden observations, or imply consciousness.',
        },
        { role: 'user', content: userContent },
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

const observeInputSchema = z.object({
  text: z.string().min(1).max(2000),
  name: z.string().max(120).optional(),
  fields: z.array(z.object({
    key: z.string(),
    label: z.string().optional(),
    values: z.array(z.string()).min(1),
    current: z.string().optional(),
  })).min(1).max(12),
})

const observeOutputSchema = z.object({
  deltas: z.array(z.object({
    field: z.string(),
    after: z.string(),
    confidence: z.number().min(0).max(1),
  })).max(6),
  summary: z.string(),
})

const observeJsonSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['deltas', 'summary'],
  properties: {
    summary: { type: 'string' },
    deltas: {
      type: 'array',
      maxItems: 6,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['field', 'after', 'confidence'],
        properties: {
          field: { type: 'string' },
          after: { type: 'string' },
          confidence: { type: 'number', minimum: 0, maximum: 1 },
        },
      },
    },
  },
} as const

app.post('/api/observe', async (request, response) => {
  const client = openRouterClient()
  if (!client) {
    response.status(503).json({ error: 'OpenRouter is not configured on the server.' })
    return
  }

  const parsed = observeInputSchema.safeParse(request.body)
  if (!parsed.success) {
    response.status(400).json({ error: 'A text observation and state fields are required.' })
    return
  }
  const { text, name, fields } = parsed.data

  try {
    const result = await client.chat.completions.create({
      model: reasoningModel(),
      messages: [
        {
          role: 'system',
          content:
            'You interpret one short spoken or typed observation about a household object in a memory-support app and map it to structured state changes. Return only valid JSON matching the schema. Use ONLY the provided field keys and their exact allowed values. Include a field in deltas ONLY when the observation clearly implies that field changed to a DIFFERENT allowed value than its current value; infer meaning from natural language (e.g. "someone cracked it" implies damaged, "I put it back" implies its usual place). If nothing changed, or it is ambiguous, or no allowed value fits, return an empty deltas array. Set confidence 0-1 for each delta. Never invent fields or values, never give medical or emergency advice.',
        },
        {
          role: 'user',
          content: [
            name ? `Object: ${name}` : '',
            `Observation: "${text}"`,
            'State fields (key, allowed values, current value):',
            JSON.stringify(fields),
            `Required JSON schema: ${JSON.stringify(observeJsonSchema)}`,
          ].filter(Boolean).join('\n'),
        },
      ],
      response_format: { type: 'json_object' },
      temperature: 0.1,
      max_tokens: 1500,
    })

    const content = result.choices[0]?.message.content
    if (!content) throw new Error('OpenRouter returned an empty observation analysis.')
    const output = observeOutputSchema.parse(JSON.parse(content))

    const byKey = new Map(fields.map((field) => [field.key, field]))
    const deltas = output.deltas.filter((delta) => {
      const field = byKey.get(delta.field)
      return Boolean(field && field.values.includes(delta.after) && delta.after !== field.current)
    })

    response.json({ deltas, summary: output.summary })
  } catch (error) {
    console.error('Observation inference error', error)
    response.status(502).json({ error: 'The observation could not be interpreted right now.' })
  }
})

export default app
