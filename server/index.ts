import 'dotenv/config'
import express from 'express'
import multer from 'multer'
import OpenAI, { toFile } from 'openai'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { z } from 'zod'
import { sanitizeTranscript } from './transcription.js'

const app = express()
const port = Number(process.env.PORT ?? 8787)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 12 * 1024 * 1024, files: 1 },
})

app.disable('x-powered-by')
app.use(express.json({ limit: '8mb' }))

function groqClient() {
  const apiKey = process.env.GROQ_API_KEY
  if (!apiKey) return null
  return new OpenAI({
    apiKey,
    baseURL: 'https://api.groq.com/openai/v1',
  })
}

app.get('/api/health', (_request, response) => {
  response.json({
    ok: true,
    provider: 'groq',
    groqConfigured: Boolean(process.env.GROQ_API_KEY),
    transcriptionModel: process.env.GROQ_TRANSCRIPTION_MODEL ?? 'whisper-large-v3-turbo',
    visionModel: process.env.GROQ_VISION_MODEL ?? 'qwen/qwen3.6-27b',
  })
})

app.post('/api/transcribe', upload.single('audio'), async (request, response) => {
  const client = groqClient()
  if (!client) {
    response.status(503).json({ error: 'Groq is not configured on the server.' })
    return
  }
  if (!request.file) {
    response.status(400).json({ error: 'An audio recording is required.' })
    return
  }

  try {
    const file = await toFile(
      request.file.buffer,
      request.file.originalname || 'speech.webm',
      { type: request.file.mimetype || 'audio/webm' },
    )
    const transcript = await client.audio.transcriptions.create({
      file,
      model: process.env.GROQ_TRANSCRIPTION_MODEL ?? 'whisper-large-v3-turbo',
      language: 'en',
      temperature: 0,
    })
    const text = sanitizeTranscript(transcript.text)
    if (!text) {
      response.status(422).json({ error: 'No clear speech was detected. Please answer again.' })
      return
    }
    response.json({ text })
  } catch (error) {
    console.error('Transcription error', error)
    response.status(502).json({ error: 'The recording could not be transcribed.' })
  }
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
  const client = groqClient()
  if (!client) {
    response.status(503).json({ error: 'Groq is not configured on the server.' })
    return
  }

  const { image, twins, previousScene, question } = request.body as {
    image?: string
    twins?: unknown
    previousScene?: unknown
    question?: string
  }
  if (!image?.startsWith('data:image/')) {
    response.status(400).json({ error: 'A camera frame is required.' })
    return
  }

  try {
    const result = await client.chat.completions.create({
      model: process.env.GROQ_VISION_MODEL ?? 'qwen/qwen3.6-27b',
      messages: [
        {
          role: 'system',
          content:
            'You are Kindred World Guide, a calm memory-support companion. Return only valid JSON matching the requested schema. Never diagnose, make medication decisions, claim hidden observations, or imply consciousness.',
        },
        {
          role: 'user',
          content: [
            {
              type: 'text',
              text: [
                'Analyze this room frame for a memory-support object world.',
                'List distinct visible household objects. Match a known twin only when the description provides convincing evidence; otherwise use null.',
                'Describe only visible state. Do not infer events outside this frame.',
                'Call out at most one important, clearly visible change. Do not make medical or emergency claims.',
                'spokenResponse must be one short, respectful sentence. If there is a question, answer it from visible or confirmed information and state uncertainty. Otherwise summarize what the camera appears to show.',
                `Known twins: ${JSON.stringify(twins ?? [])}`,
                `Previous scene: ${JSON.stringify(previousScene ?? null)}`,
                question ? `The person asks: ${question}` : '',
                `Required JSON schema: ${JSON.stringify(worldSceneJsonSchema)}`,
              ].filter(Boolean).join('\n'),
            },
            { type: 'image_url', image_url: { url: image } },
          ],
        },
      ],
      response_format: { type: 'json_object' },
      temperature: 0.2,
      max_completion_tokens: 1800,
    })

    const content = result.choices[0]?.message.content
    if (!content) throw new Error('Groq returned an empty scene analysis.')
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
  app.get('*', (_request, response) => response.sendFile(path.join(dist, 'index.html')))
}

app.listen(port, '127.0.0.1', () => {
  console.log(`Kindred Objects server listening at http://127.0.0.1:${port}`)
})
