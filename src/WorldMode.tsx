import { useCallback, useEffect, useRef, useState } from 'react'
import {
  AlertCircle,
  Camera,
  Eye,
  EyeOff,
  Globe2,
  Mic,
  MicOff,
  Plus,
  RefreshCw,
  ScanSearch,
  ShieldCheck,
  Sparkles,
} from 'lucide-react'
import type { ObjectTwin } from './domain'
import { useCamera } from './media'
import { useRealtimeVoice } from './realtime'
import { cosineSimilarity, fingerprintImage } from './vision'

type WorldObject = {
  label: string
  matchedTwinId: string | null
  description: string
  location: string
  visibleState: string
  confidence: number
}

type WorldScene = {
  summary: string
  importantChange: string | null
  objects: WorldObject[]
}

const baseInstructions = `
You are Kindred World Guide, a calm voice companion for memory support.
Speak in short, respectful sentences and wait for the person to finish.
Use only the current structured scene and confirmed object twin information in your instructions.
Say "the camera appears to show" for visual observations and "you previously confirmed" for stored memories.
Never diagnose, make medication decisions, claim consciousness, imply hidden surveillance, or invent events outside the current camera session.
If identity or state is uncertain, say so and ask a simple yes-or-no question.
`

function captureFrame(video: HTMLVideoElement): string {
  const canvas = document.createElement('canvas')
  const width = Math.min(960, video.videoWidth || 960)
  const ratio = (video.videoHeight || 720) / (video.videoWidth || 960)
  canvas.width = width
  canvas.height = Math.round(width * ratio)
  const context = canvas.getContext('2d')
  if (!context) throw new Error('The camera frame could not be prepared.')
  context.drawImage(video, 0, 0, canvas.width, canvas.height)
  return canvas.toDataURL('image/jpeg', 0.68)
}

function instructionsForScene(scene: WorldScene | null, twins: ObjectTwin[]): string {
  const twinContext = twins.map((twin) => ({
    id: twin.id,
    name: twin.name,
    purpose: twin.purpose,
    usualLocation: twin.usualLocation,
    currentState: twin.currentState,
  }))
  return `${baseInstructions}
Known twins: ${JSON.stringify(twinContext)}
Current visible scene: ${JSON.stringify(scene)}
`
}

export function WorldMode({
  twins,
  onIntroduce,
}: {
  twins: ObjectTwin[]
  onIntroduce: () => void
}) {
  const camera = useCamera()
  const voice = useRealtimeVoice()
  const [active, setActive] = useState(false)
  const [seeingPaused, setSeeingPaused] = useState(false)
  const [analyzing, setAnalyzing] = useState(false)
  const [scene, setScene] = useState<WorldScene | null>(null)
  const [error, setError] = useState('')
  const [question, setQuestion] = useState('')
  const [lastObservedAt, setLastObservedAt] = useState('')
  const previousFingerprintRef = useRef<number[] | null>(null)
  const analysisInFlightRef = useRef(false)
  const sceneRef = useRef<WorldScene | null>(null)

  const analyze = useCallback(async (force = false, askedQuestion = '') => {
    const video = camera.videoRef.current
    if (!video || !camera.active || seeingPaused || analysisInFlightRef.current) return

    const fingerprint = fingerprintImage(video, false)
    const previousFingerprint = previousFingerprintRef.current
    const similarity = previousFingerprint
      ? cosineSimilarity(previousFingerprint, fingerprint.histogram)
      : 0
    if (!force && previousFingerprint && similarity > 0.992) return

    analysisInFlightRef.current = true
    setAnalyzing(true)
    setError('')
    try {
      const image = captureFrame(video)
      const twinContext = twins.map((twin) => ({
        id: twin.id,
        name: twin.name,
        description: twin.description,
        usualLocation: twin.usualLocation,
        currentState: twin.currentState,
      }))
      const response = await fetch('/api/world/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          image,
          twins: twinContext,
          previousScene: sceneRef.current,
          question: askedQuestion || undefined,
        }),
      })
      const payload = await response.json() as WorldScene & { error?: string }
      if (!response.ok || payload.error) throw new Error(payload.error || 'World analysis failed.')
      previousFingerprintRef.current = fingerprint.histogram
      sceneRef.current = payload
      setScene(payload)
      setLastObservedAt(new Date().toISOString())
      await voice.updateInstructions(instructionsForScene(payload, twins))
      if (payload.importantChange) {
        voice.sendContext(
          `The latest scene has one potentially important visible change: ${payload.importantChange}. Briefly tell the person what the camera appears to show, include uncertainty, and ask whether they want to confirm it.`,
        )
      }
      if (askedQuestion) {
        voice.sendContext(
          `The person asks: ${askedQuestion}. Answer using this current scene: ${JSON.stringify(payload)}.`,
        )
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'World Mode could not analyze the room.')
    } finally {
      analysisInFlightRef.current = false
      setAnalyzing(false)
    }
  }, [camera.active, seeingPaused, twins, voice.sendContext, voice.updateInstructions])

  async function startWorld() {
    setError('')
    setActive(true)
    await camera.start()
    await voice.connect(instructionsForScene(null, twins))
  }

  function stopWorld() {
    setActive(false)
    camera.stop()
    voice.disconnect()
    setSeeingPaused(false)
    setScene(null)
    sceneRef.current = null
    previousFingerprintRef.current = null
  }

  useEffect(() => {
    if (!active || !camera.active || seeingPaused) return
    const first = window.setTimeout(() => void analyze(true), 900)
    const interval = window.setInterval(() => void analyze(false), 8000)
    return () => {
      window.clearTimeout(first)
      window.clearInterval(interval)
    }
  }, [active, camera.active, seeingPaused, analyze])

  useEffect(() => stopWorld, [])

  function askWorld() {
    if (!question.trim()) return
    const nextQuestion = question.trim()
    setQuestion('')
    void analyze(true, nextQuestion)
  }

  if (!active) {
    return (
      <div className="page world-page">
        <section className="world-intro">
          <span className="world-symbol"><Globe2 size={34} /></span>
          <p className="eyebrow">V3 experience</p>
          <h1>Enter your object world</h1>
          <p>World Mode keeps the camera and realtime voice active only during this visible session. It builds a temporary scene of the objects around you and reasons from that scene.</p>
          <div className="world-principles">
            <span><Eye size={17} /> Visible session only</span>
            <span><ShieldCheck size={17} /> Frames are not stored</span>
            <span><Sparkles size={17} /> OpenAI visual reasoning</span>
          </div>
          <button className="primary-button large" onClick={() => void startWorld()}>
            <Camera size={20} /> Start World Mode
          </button>
          <small>The browser will request camera and microphone permission.</small>
        </section>
      </div>
    )
  }

  return (
    <div className="page world-page">
      <section className="world-toolbar">
        <div>
          <span className="world-live"><i /> World Mode active</span>
          <h1>Your object world</h1>
        </div>
        <div className="button-row">
          <button className="secondary-button" onClick={() => {
            const nextPaused = !seeingPaused
            setSeeingPaused(nextPaused)
            if (nextPaused) camera.stop()
            else void camera.start()
          }}>
            {seeingPaused ? <Eye size={18} /> : <EyeOff size={18} />}
            {seeingPaused ? 'Resume seeing' : 'Pause seeing'}
          </button>
          <button className="secondary-button" onClick={() => voice.setMuted(voice.status !== 'muted')}>
            {voice.status === 'muted' ? <Mic size={18} /> : <MicOff size={18} />}
            {voice.status === 'muted' ? 'Resume listening' : 'Pause listening'}
          </button>
          <button className="danger-button" onClick={stopWorld}>Exit World Mode</button>
        </div>
      </section>

      <div className="world-layout">
        <section className={`world-camera ${camera.active ? 'active' : ''}`}>
          <video ref={camera.videoRef} muted playsInline aria-label="World Mode live camera" />
          {!camera.active && <div className="world-camera-paused"><EyeOff size={38} /><strong>Seeing is paused</strong></div>}
          <div className="world-camera-status">
            <span><i /> {camera.active ? 'Camera live' : 'Camera off'}</span>
            <span className={`voice-state ${voice.status}`}><Mic size={14} /> {voice.status}</span>
          </div>
          {analyzing && <div className="world-analyzing"><ScanSearch size={23} /> Understanding this scene…</div>}
        </section>

        <aside className="world-scene">
          <div className="panel-heading">
            <div><p className="eyebrow">Live scene graph</p><h2>Objects in view</h2></div>
            <button className="icon-button" onClick={() => void analyze(true)} disabled={analyzing} aria-label="Analyze now"><RefreshCw size={18} /></button>
          </div>

          {error && <div className="inline-alert"><AlertCircle size={17} /> {error}</div>}
          {camera.error && <div className="inline-alert"><AlertCircle size={17} /> {camera.error}</div>}
          {voice.error && <div className="inline-alert"><AlertCircle size={17} /> {voice.error}</div>}

          {!scene && !analyzing ? (
            <div className="world-empty"><ScanSearch size={27} /><p>Point the camera around the room, then analyze the scene.</p></div>
          ) : (
            <>
              {scene?.summary && <p className="world-summary">{scene.summary}</p>}
              <div className="detected-list">
                {scene?.objects.map((object, index) => {
                  const twin = twins.find((item) => item.id === object.matchedTwinId)
                  return (
                    <article className="detected-object" key={`${object.label}-${index}`}>
                      <div>
                        <span className={`identity-dot ${twin ? 'known' : 'unknown'}`} />
                        <strong>{twin?.name ?? object.label}</strong>
                      </div>
                      <p>{object.visibleState} · {object.location}</p>
                      <span>{twin ? 'Known twin' : 'Unknown object'} · {Math.round(object.confidence * 100)}% confidence</span>
                      {!twin && <button className="text-button" onClick={onIntroduce}><Plus size={15} /> Introduce this</button>}
                    </article>
                  )
                })}
              </div>
            </>
          )}
          {lastObservedAt && <small>Last scene update {new Date(lastObservedAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</small>}
        </aside>
      </div>

      <section className="world-question">
        <div><p className="eyebrow">Ask the room</p><h2>Speak naturally, or type a fallback question</h2></div>
        <div className="composer">
          <input value={question} onChange={(event) => setQuestion(event.target.value)} onKeyDown={(event) => event.key === 'Enter' && askWorld()} placeholder="Where are my glasses?" />
          <button className="primary-button" onClick={askWorld}>Ask from this view</button>
        </div>
      </section>
    </div>
  )
}
