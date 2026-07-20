import 'dotenv/config'
import express from 'express'
import multer from 'multer'
import OpenAI, { toFile } from 'openai'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const app = express()
const port = Number(process.env.PORT ?? 8787)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 12 * 1024 * 1024, files: 1 },
})

app.disable('x-powered-by')
app.use(express.json({ limit: '8mb' }))

function openAIClient() {
  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) return null
  return new OpenAI({ apiKey })
}

app.get('/api/health', (_request, response) => {
  response.json({
    ok: true,
    openaiConfigured: Boolean(process.env.OPENAI_API_KEY),
    realtimeModel: process.env.OPENAI_REALTIME_MODEL ?? 'gpt-realtime-2',
    visionModel: process.env.OPENAI_VISION_MODEL ?? 'gpt-5-mini',
  })
})

app.post('/api/realtime-token', async (_request, response) => {
  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) {
    response.status(503).json({ error: 'OpenAI is not configured on the server.' })
    return
  }

  try {
    const upstream = await fetch('https://api.openai.com/v1/realtime/client_secrets', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        expires_after: { anchor: 'created_at', seconds: 600 },
        session: {
          type: 'realtime',
          model: process.env.OPENAI_REALTIME_MODEL ?? 'gpt-realtime-2',
          output_modalities: ['audio'],
          instructions:
            'You are the voice of Kindred Objects, a calm memory-support companion. Use short, respectful sentences. Never diagnose, make medication decisions, claim hidden observations, or imply consciousness. Clearly distinguish what the camera sees from what a person previously confirmed.',
          audio: {
            input: {
              noise_reduction: { type: 'far_field' },
              turn_detection: {
                type: 'semantic_vad',
                create_response: true,
                interrupt_response: true,
                eagerness: 'medium',
              },
            },
          },
        },
      }),
    })

    const payload = await upstream.json()
    if (!upstream.ok) {
      console.error('Realtime token request failed', upstream.status, payload)
      response.status(502).json({ error: 'Could not start a realtime voice session.' })
      return
    }
    response.json(payload)
  } catch (error) {
    console.error('Realtime token error', error)
    response.status(502).json({ error: 'Could not reach the realtime voice service.' })
  }
})

app.post('/api/transcribe', upload.single('audio'), async (request, response) => {
  const client = openAIClient()
  if (!client) {
    response.status(503).json({ error: 'OpenAI is not configured on the server.' })
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
      model: process.env.OPENAI_TRANSCRIPTION_MODEL ?? 'gpt-4o-mini-transcribe',
      language: 'en',
    })
    response.json({ text: transcript.text.trim() })
  } catch (error) {
    console.error('Transcription error', error)
    response.status(502).json({ error: 'The recording could not be transcribed.' })
  }
})

const worldSceneSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['summary', 'objects', 'importantChange'],
  properties: {
    summary: { type: 'string' },
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

app.post('/api/world/analyze', async (request, response) => {
  const client = openAIClient()
  if (!client) {
    response.status(503).json({ error: 'OpenAI is not configured on the server.' })
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
    const result = await client.responses.create({
      model: process.env.OPENAI_VISION_MODEL ?? 'gpt-5-mini',
      input: [
        {
          role: 'user',
          content: [
            {
              type: 'input_text',
              text: [
                'Analyze this room frame for a memory-support object world.',
                'List distinct visible household objects. Match a known twin only when the description provides convincing evidence; otherwise use null.',
                'Describe only visible state. Do not infer events outside this frame.',
                'Call out at most one important, clearly visible change. Do not make medical or emergency claims.',
                `Known twins: ${JSON.stringify(twins ?? [])}`,
                `Previous scene: ${JSON.stringify(previousScene ?? null)}`,
                question ? `The person asks: ${question}` : '',
              ].filter(Boolean).join('\n'),
            },
            { type: 'input_image', image_url: image, detail: 'low' },
          ],
        },
      ],
      text: {
        format: {
          type: 'json_schema',
          name: 'kindred_world_scene',
          strict: true,
          schema: worldSceneSchema,
        },
      },
    })

    response.json(JSON.parse(result.output_text))
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
