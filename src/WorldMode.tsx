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
import { speak, useCamera, useSpeechInput } from './media'
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
  spokenResponse: string
  importantChange: string | null
  objects: WorldObject[]
}

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

export function WorldMode({
  twins,
  onIntroduce,
}: {
  twins: ObjectTwin[]
  onIntroduce: () => void
}) {
  const camera = useCamera()
  const [active, setActive] = useState(false)
  const [seeingPaused, setSeeingPaused] = useState(false)
  const [listeningPaused, setListeningPaused] = useState(false)
  const [analyzing, setAnalyzing] = useState(false)
  const [scene, setScene] = useState<WorldScene | null>(null)
  const [error, setError] = useState('')
  const [question, setQuestion] = useState('')
  const [lastObservedAt, setLastObservedAt] = useState('')
  const previousFingerprintRef = useRef<number[] | null>(null)
  const analysisInFlightRef = useRef(false)
  const sceneRef = useRef<WorldScene | null>(null)
  const analyzeRef = useRef<(force?: boolean, question?: string) => Promise<void>>(async () => undefined)
  const worldSpeech = useSpeechInput((transcript) => {
    if (listeningPaused) return
    setQuestion(transcript)
    void analyzeRef.current(true, transcript)
  })

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
      if (askedQuestion) {
        speak(payload.spokenResponse)
      } else if (payload.importantChange) {
        speak(`The camera appears to show ${payload.importantChange}`)
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'World Mode could not analyze the room.')
    } finally {
      analysisInFlightRef.current = false
      setAnalyzing(false)
    }
  }, [camera.active, seeingPaused, twins])

  analyzeRef.current = analyze

  async function startWorld() {
    setError('')
    setActive(true)
    await camera.start()
  }

  function stopWorld() {
    setActive(false)
    camera.stop()
    worldSpeech.stop()
    setSeeingPaused(false)
    setListeningPaused(false)
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
          <p>World Mode keeps the camera active only during this visible session. Groq builds a temporary scene of the objects around you, and voice input runs only when you tap Talk.</p>
          <div className="world-principles">
            <span><Eye size={17} /> Visible session only</span>
            <span><ShieldCheck size={17} /> Frames are not stored</span>
            <span><Sparkles size={17} /> Groq visual reasoning</span>
          </div>
          <button className="primary-button large" onClick={() => void startWorld()}>
            <Camera size={20} /> Start World Mode
          </button>
          <small>The browser requests camera permission now and microphone permission when you tap Talk.</small>
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
          <button className="secondary-button" onClick={() => {
            const nextPaused = !listeningPaused
            setListeningPaused(nextPaused)
            if (nextPaused) worldSpeech.stop()
          }}>
            {listeningPaused ? <Mic size={18} /> : <MicOff size={18} />}
            {listeningPaused ? 'Resume voice input' : 'Pause voice input'}
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
            <span className={`voice-state ${worldSpeech.listening ? 'listening' : worldSpeech.processing ? 'speaking' : listeningPaused ? 'muted' : ''}`}>
              <Mic size={14} /> {listeningPaused ? 'voice paused' : worldSpeech.processing ? 'understanding' : worldSpeech.listening ? 'listening' : 'tap to talk'}
            </span>
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
          {worldSpeech.error && <div className="inline-alert"><AlertCircle size={17} /> {worldSpeech.error}</div>}

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
        <div><p className="eyebrow">Ask the room</p><h2>Tap to speak, or type a question</h2></div>
        <div className="composer">
          <button
            className={`secondary-button ${worldSpeech.listening ? 'listening' : ''}`}
            onClick={worldSpeech.listening ? worldSpeech.stop : worldSpeech.start}
            disabled={listeningPaused || worldSpeech.processing}
          >
            <Mic size={18} /> {worldSpeech.processing ? 'Understanding…' : worldSpeech.listening ? 'Listening…' : 'Talk'}
          </button>
          <input value={question} onChange={(event) => setQuestion(event.target.value)} onKeyDown={(event) => event.key === 'Enter' && askWorld()} placeholder="Where are my glasses?" />
          <button className="primary-button" onClick={askWorld}>Ask from this view</button>
        </div>
      </section>
    </div>
  )
}
