import { useEffect, useMemo, useState } from 'react'
import {
  Camera,
  Check,
  Clock3,
  Download,
  Globe2,
  Heart,
  Home,
  KeyRound,
  LampDesk,
  Library,
  Mic,
  Pause,
  Plus,
  RotateCcw,
  ScanLine,
  ShieldCheck,
  Sparkles,
  Trash2,
  UserRoundCog,
  Volume2,
  X,
} from 'lucide-react'
import {
  categoryDefinitions,
  objectTwinSchema,
  type ObjectCategory,
  type ObjectTwin,
  type ObservationProposal,
  type StateEvent,
  type StoredWorld,
} from './domain'
import { useCamera, useSpeechInput, speak } from './media'
import { seedWorld } from './seed'
import { exportWorld, loadWorld, removeTwin, saveWorld, upsertTwin } from './storage'
import {
  answerAsTwin,
  assessConfirmation,
  commitProposal,
  parseObservationText,
  revertEvent,
} from './twinEngine'
import { fingerprintImage, matchFingerprint, type CapturedFingerprint, type IdentityMatch } from './vision'
import { WorldMode } from './WorldMode'
import './App.css'

type View = 'home' | 'scan' | 'world' | 'library' | 'caregiver' | 'object'
type Message = { id: string; speaker: 'person' | 'object'; text: string; grounding?: string }

const iconByCategory = {
  sentimental: Heart,
  appliance: LampDesk,
  belonging: KeyRound,
}

function formatTime(value: string) {
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(value))
}

function confidenceLabel(confidence: number) {
  if (confidence >= 0.92) return 'strong visual match'
  if (confidence >= 0.82) return 'possible visual match'
  return 'uncertain match'
}

function App() {
  const [world, setWorld] = useState<StoredWorld>(() => loadWorld(seedWorld))
  const [view, setView] = useState<View>('home')
  const [selectedTwinId, setSelectedTwinId] = useState(world.twins[0]?.id ?? '')
  const [consent, setConsent] = useState(() => localStorage.getItem('object-twins.consent') === 'yes')
  const [caregiverMode, setCaregiverMode] = useState(false)
  const [identityMatch, setIdentityMatch] = useState<IdentityMatch | null>(null)
  const [capturedFingerprint, setCapturedFingerprint] = useState<CapturedFingerprint | null>(null)
  const [showEnrollment, setShowEnrollment] = useState(false)
  const [observation, setObservation] = useState('')
  const [pendingProposal, setPendingProposal] = useState<ObservationProposal | null>(null)
  const [question, setQuestion] = useState('')
  const [messages, setMessages] = useState<Message[]>([])
  const [status, setStatus] = useState('')
  const camera = useCamera()

  const selectedTwin = world.twins.find((twin) => twin.id === selectedTwinId)
  const selectedEvents = useMemo(
    () =>
      world.events
        .filter((event) => event.twinId === selectedTwinId)
        .sort((left, right) => right.observedAt.localeCompare(left.observedAt)),
    [world.events, selectedTwinId],
  )

  useEffect(() => saveWorld(world), [world])

  const speech = useSpeechInput((transcript) => {
    if (pendingProposal) {
      const answer = transcript.trim().toLowerCase()
      if (/\b(yes|confirm|correct|right)\b/.test(answer)) {
        applyProposal(pendingProposal, caregiverMode ? 'caregiver' : 'user')
        return
      }
      if (/\b(no|cancel|wrong|incorrect)\b/.test(answer)) {
        setPendingProposal(null)
        setStatus('Nothing changed. The proposed observation was discarded.')
        speak('Okay. I will not remember that change.')
        return
      }
      setStatus('Please say yes to confirm the change, or no to discard it.')
      speak('Please say yes or no.')
      return
    }
    setQuestion(transcript)
    if (selectedTwin) askTwin(transcript)
  })

  useEffect(() => {
    if (!pendingProposal) return
    speak(
      `${pendingProposal.summary} Should I remember that? Say yes or no.`,
      speech.supported ? speech.start : undefined,
    )
  }, [pendingProposal?.summary])

  function acceptConsent() {
    localStorage.setItem('object-twins.consent', 'yes')
    setConsent(true)
  }

  function navigate(nextView: View) {
    if (nextView !== 'scan') camera.stop()
    setView(nextView)
  }

  function introduceObject() {
    setIdentityMatch(null)
    setCapturedFingerprint(null)
    setShowEnrollment(false)
    setStatus('')
    navigate('scan')
  }

  function selectTwin(twin: ObjectTwin) {
    setSelectedTwinId(twin.id)
    setMessages([])
    navigate('object')
    camera.stop()
  }

  function captureAndMatch() {
    if (!camera.videoRef.current || !camera.active) return
    const fingerprint = fingerprintImage(camera.videoRef.current, false)
    const match = matchFingerprint(fingerprint, world.twins)
    navigator.vibrate?.(70)
    camera.stop()
    setCapturedFingerprint(fingerprint)
    setIdentityMatch(match)
    setShowEnrollment(!match)
    setStatus(
      match
        ? 'Picture taken. I found a possible twin. Please confirm it.'
        : 'Picture taken. I do not recognize this object yet.',
    )
  }

  function confirmMatch() {
    if (!identityMatch) return
    const linkedTwin = capturedFingerprint
      ? {
          ...identityMatch.twin,
          fingerprints: [...identityMatch.twin.fingerprints, capturedFingerprint].slice(-5),
          updatedAt: new Date().toISOString(),
        }
      : identityMatch.twin
    setWorld((current) => ({ ...current, twins: upsertTwin(current.twins, linkedTwin) }))
    selectTwin(linkedTwin)
    setIdentityMatch(null)
    setCapturedFingerprint(null)
    setStatus('')
  }

  function askTwin(rawQuestion = question) {
    if (!selectedTwin || !rawQuestion.trim()) return
    const answer = answerAsTwin(selectedTwin, rawQuestion)
    setMessages((current) => [
      ...current,
      { id: crypto.randomUUID(), speaker: 'person', text: rawQuestion.trim() },
      {
        id: crypto.randomUUID(),
        speaker: 'object',
        text: answer.text,
        grounding: answer.grounding,
      },
    ])
    setQuestion('')
    speak(answer.text)
  }

  function proposeObservation() {
    if (!selectedTwin || !observation.trim()) return
    const proposal = parseObservationText(selectedTwin, observation)
    setObservation('')
    if (proposal.deltas.length === 0) {
      setStatus(proposal.summary)
      return
    }
    const decision = assessConfirmation(selectedTwin, proposal)
    if (decision.required) {
      setPendingProposal(proposal)
      setStatus(decision.reasons.join(' '))
    } else {
      applyProposal(proposal, 'system')
    }
  }

  function applyProposal(proposal: ObservationProposal, confirmedBy: StateEvent['confirmedBy']) {
    const twin = world.twins.find((item) => item.id === proposal.twinId)
    if (!twin) return
    const committed = commitProposal(twin, proposal, confirmedBy)
    setWorld((current) => ({
      twins: upsertTwin(current.twins, committed.twin),
      events: [...committed.events, ...current.events],
    }))
    setPendingProposal(null)
    setStatus('The confirmed change is now part of this object’s history.')
    speak(`Thank you. I’ll remember that ${proposal.summary.toLowerCase()}`)
  }

  function handleRevert(event: StateEvent) {
    if (!selectedTwin) return
    const reverted = revertEvent(selectedTwin, event)
    setWorld((current) => ({
      twins: upsertTwin(current.twins, reverted.twin),
      events: [reverted.event, ...current.events],
    }))
    setStatus('The caregiver correction has been recorded.')
  }

  function handleDeleteTwin(twinId: string) {
    setWorld((current) => removeTwin(current, twinId))
    setSelectedTwinId('')
    setView('library')
  }

  function resetLocalData() {
    const empty: StoredWorld = { twins: [], events: [] }
    setWorld(empty)
    setSelectedTwinId('')
    setMessages([])
    setView('home')
    setStatus('All object twins and histories were deleted from this browser.')
  }

  function restoreDemo() {
    setWorld(seedWorld)
    setSelectedTwinId(seedWorld.twins[0].id)
    setStatus('The three demonstration objects are ready.')
  }

  return (
    <div className="app-shell">
      <header className="topbar">
        <button className="brand" onClick={() => navigate('home')} aria-label="Go home">
          <span className="brand-mark"><Sparkles size={18} /></span>
          <span>Kindred Objects</span>
        </button>
        <div className="privacy-chip">
          <span className={`status-dot ${camera.active ? 'live' : ''}`} />
          {view === 'world' ? 'World controls visible' : camera.active ? 'Camera on now' : 'Camera off'}
        </div>
      </header>

      <main>
        {status && (
          <div className="status-banner" role="status">
            <span>{status}</span>
            <button onClick={() => setStatus('')} aria-label="Dismiss message"><X size={16} /></button>
          </div>
        )}

        {view === 'home' && (
          <HomeView
            twins={world.twins}
            events={world.events}
            onScan={introduceObject}
            onWorld={() => navigate('world')}
            onSelect={selectTwin}
            onLibrary={() => setView('library')}
            onRestoreDemo={restoreDemo}
          />
        )}

        {view === 'scan' && (
          <ScanView
            camera={camera}
            status={status}
            match={identityMatch}
            showEnrollment={showEnrollment}
            fingerprint={capturedFingerprint}
            onCapture={captureAndMatch}
            onConfirm={confirmMatch}
            onReject={() => {
              setIdentityMatch(null)
              setShowEnrollment(true)
            }}
            onEnroll={(twin) => {
              setWorld((current) => ({ ...current, twins: upsertTwin(current.twins, twin) }))
              selectTwin(twin)
              setStatus(`${twin.name} now has a private, persistent twin on this device.`)
            }}
            onCancelEnrollment={() => setShowEnrollment(false)}
          />
        )}

        {view === 'world' && (
          <WorldMode twins={world.twins} onIntroduce={introduceObject} />
        )}

        {view === 'library' && (
          <LibraryView twins={world.twins} events={world.events} onSelect={selectTwin} onScan={introduceObject} />
        )}

        {view === 'object' && selectedTwin && (
          <ObjectView
            twin={selectedTwin}
            events={selectedEvents}
            messages={messages}
            question={question}
            observation={observation}
            pendingProposal={pendingProposal}
            caregiverMode={caregiverMode}
            speech={speech}
            onQuestion={setQuestion}
            onAsk={(value) => askTwin(value)}
            onObservation={setObservation}
            onPropose={proposeObservation}
            onConfirmProposal={() => pendingProposal && applyProposal(pendingProposal, caregiverMode ? 'caregiver' : 'user')}
            onRejectProposal={() => {
              setPendingProposal(null)
              setStatus('Nothing changed. The proposed observation was discarded.')
            }}
            onRevert={handleRevert}
            onUpdate={(twin) => setWorld((current) => ({ ...current, twins: upsertTwin(current.twins, twin) }))}
            onDelete={() => handleDeleteTwin(selectedTwin.id)}
          />
        )}

        {view === 'caregiver' && (
          <CaregiverView
            world={world}
            caregiverMode={caregiverMode}
            onToggleMode={() => setCaregiverMode((current) => !current)}
            onExport={() => exportWorld(world)}
            onDeleteAll={resetLocalData}
          />
        )}
      </main>

      <nav className="bottom-nav" aria-label="Primary navigation">
        <NavButton active={view === 'home'} label="Home" icon={Home} onClick={() => navigate('home')} />
        <NavButton active={view === 'scan'} label="Introduce" icon={ScanLine} onClick={introduceObject} />
        <NavButton active={view === 'world'} label="World" icon={Globe2} onClick={() => navigate('world')} />
        <NavButton active={view === 'library' || view === 'object'} label="Objects" icon={Library} onClick={() => navigate('library')} />
        <NavButton active={view === 'caregiver'} label="Caregiver" icon={ShieldCheck} onClick={() => navigate('caregiver')} />
      </nav>

      {!['scan', 'world'].includes(view) && (
        <button className="global-add-button" onClick={introduceObject}>
          <Plus size={19} /> Introduce another object
        </button>
      )}

      {!consent && <ConsentSheet onAccept={acceptConsent} />}
    </div>
  )
}

function HomeView({
  twins,
  events,
  onScan,
  onWorld,
  onSelect,
  onLibrary,
  onRestoreDemo,
}: {
  twins: ObjectTwin[]
  events: StateEvent[]
  onScan: () => void
  onWorld: () => void
  onSelect: (twin: ObjectTwin) => void
  onLibrary: () => void
  onRestoreDemo: () => void
}) {
  const recentEvent = [...events].sort((a, b) => b.observedAt.localeCompare(a.observedAt))[0]
  const recentTwin = twins.find((twin) => twin.id === recentEvent?.twinId)
  return (
    <div className="page home-page">
      <section className="welcome">
        <p className="eyebrow">A gentler kind of memory</p>
        <h1>What would you like to remember?</h1>
        <p>Show an object to the camera. It can tell you what it is, share its story, and remember confirmed changes.</p>
        <div className="hero-actions">
          <button className="primary-button large" onClick={onWorld}>
            <Globe2 size={21} /> Enter World Mode
          </button>
          <button className="secondary-button large" onClick={onScan}>
            <Camera size={21} /> Introduce one object
          </button>
        </div>
        <p className="quiet-note"><ShieldCheck size={14} /> The camera only turns on when you ask.</p>
      </section>

      {twins.length > 0 ? (
        <>
          <section className="section-heading">
            <div>
              <p className="eyebrow">Familiar objects</p>
              <h2>Your little circle</h2>
            </div>
            <button className="text-button" onClick={onLibrary}>See all</button>
          </section>
          <div className="object-row">
            {twins.slice(0, 3).map((twin) => <TwinCard key={twin.id} twin={twin} onClick={() => onSelect(twin)} />)}
          </div>
          {recentEvent && recentTwin && (
            <button className="memory-card" onClick={() => onSelect(recentTwin)}>
              <div className="memory-icon"><Clock3 size={20} /></div>
              <div>
                <span className="card-kicker">Last confirmed memory</span>
                <strong>{recentTwin.name} · {recentEvent.field} is {recentEvent.after}</strong>
                <span>{formatTime(recentEvent.observedAt)} · {recentEvent.confirmedBy}</span>
              </div>
            </button>
          )}
        </>
      ) : (
        <div className="empty-card">
          <Sparkles size={25} />
          <h2>No object twins yet</h2>
          <p>Introduce the first meaningful object, or restore the three safe demonstration objects.</p>
          <button className="secondary-button" onClick={onRestoreDemo}>Restore demo objects</button>
        </div>
      )}
    </div>
  )
}

function ScanView({
  camera,
  match,
  showEnrollment,
  fingerprint,
  onCapture,
  onConfirm,
  onReject,
  onEnroll,
  onCancelEnrollment,
}: {
  camera: ReturnType<typeof useCamera>
  status: string
  match: IdentityMatch | null
  showEnrollment: boolean
  fingerprint: CapturedFingerprint | null
  onCapture: () => void
  onConfirm: () => void
  onReject: () => void
  onEnroll: (twin: ObjectTwin) => void
  onCancelEnrollment: () => void
}) {
  const captured = Boolean(match || (showEnrollment && fingerprint))
  const identitySpeech = useSpeechInput((transcript) => {
    const answer = transcript.trim().toLowerCase()
    if (/\b(yes|correct|right|that is it)\b/.test(answer)) {
      onConfirm()
      return
    }
    if (/\b(no|wrong|new object|not it)\b/.test(answer)) {
      onReject()
      return
    }
    speak('Please say yes if this is the right object, or no if it is a new object.')
  })

  useEffect(() => {
    if (!captured && !camera.active) void camera.start()
  }, [])

  useEffect(() => {
    if (!match || showEnrollment) return
    speak(
      `Picture taken. I think this is ${match.twin.name}. Is that right? Say yes or no.`,
      identitySpeech.supported ? identitySpeech.start : undefined,
    )
  }, [match?.twin.id, showEnrollment])

  return (
    <div className="page scan-page">
      {!captured ? (
        <>
          <div className="page-title">
            <p className="eyebrow">Private, on-demand camera</p>
            <h1>Bring one object into view</h1>
            <p>Hold it steady and fill the guide. We keep a compact visual fingerprint—not the raw camera frame.</p>
          </div>

          <div className={`camera-stage ${camera.active ? 'active' : ''}`}>
            <video ref={camera.videoRef} muted playsInline aria-label="Live camera preview" />
            {!camera.active && (
              <div className="camera-placeholder">
                <Camera size={42} />
                <strong>Camera is off</strong>
                <span>Nothing is being recorded.</span>
              </div>
            )}
            {camera.active && <div className="object-guide"><span>Place one object here</span></div>}
            <div className="live-indicator"><span /> {camera.active ? 'Live on this screen' : 'Private'}</div>
          </div>

          {camera.error && <div className="inline-alert">{camera.error}</div>}

          <div className="camera-actions">
            {!camera.active ? (
              <button className="primary-button large" onClick={camera.start}><Camera size={20} /> Turn camera on</button>
            ) : (
              <>
                <button className="secondary-button" onClick={camera.stop}><Pause size={18} /> Pause camera</button>
                <button className="primary-button" onClick={onCapture}><ScanLine size={19} /> Take picture</button>
              </>
            )}
          </div>
        </>
      ) : (
        <div className="capture-confirmation" role="status">
          <span><Check size={21} /></span>
          <div><p className="eyebrow">Camera is off</p><h1>Picture taken</h1><p>You can put the object down. We’ll continue by voice.</p></div>
        </div>
      )}

      {match && !showEnrollment && (
        <div className="match-card">
          <div className={`object-avatar ${match.twin.category}`}>
            {(() => { const Icon = iconByCategory[match.twin.category]; return <Icon size={28} /> })()}
          </div>
          <div className="match-content">
            <span className="card-kicker">{confidenceLabel(match.confidence)} · {Math.round(match.confidence * 100)}%</span>
            <h2>Is this {match.twin.name}?</h2>
            <p>{match.twin.description}</p>
            {match.ambiguous && <div className="inline-alert">The appearance is similar, but not certain. Please confirm the identity.</div>}
            <div className="button-row">
              <button className="primary-button" onClick={onConfirm}><Check size={18} /> Yes, that’s right</button>
              <button className="secondary-button" onClick={onReject}><X size={18} /> No, a new object</button>
              {identitySpeech.supported && (
                <button className={`secondary-button ${identitySpeech.listening ? 'listening' : ''}`} onClick={identitySpeech.listening ? identitySpeech.stop : identitySpeech.start} disabled={identitySpeech.processing}>
                  <Mic size={18} /> {identitySpeech.processing ? 'Understanding…' : identitySpeech.listening ? 'Listening… tap to stop' : 'Answer by voice'}
                </button>
              )}
            </div>
            {identitySpeech.error && <div className="inline-alert">{identitySpeech.error}</div>}
          </div>
        </div>
      )}

      {showEnrollment && fingerprint && (
        <EnrollmentForm fingerprint={fingerprint} onEnroll={onEnroll} onCancel={onCancelEnrollment} />
      )}
    </div>
  )
}

function EnrollmentForm({
  fingerprint,
  onEnroll,
  onCancel,
}: {
  fingerprint: CapturedFingerprint
  onEnroll: (twin: ObjectTwin) => void
  onCancel: () => void
}) {
  type EnrollmentStep = 'category' | 'name' | 'purpose' | 'location' | 'story' | 'personality' | 'review'
  const steps: EnrollmentStep[] = ['category', 'name', 'purpose', 'location', 'story', 'personality', 'review']
  const [stepIndex, setStepIndex] = useState(0)
  const [category, setCategory] = useState<ObjectCategory>('sentimental')
  const [name, setName] = useState('')
  const [purpose, setPurpose] = useState('')
  const [story, setStory] = useState('')
  const [usualLocation, setUsualLocation] = useState('')
  const [personality, setPersonality] = useState<'gentle' | 'cheerful' | 'matter-of-fact'>('gentle')
  const [fallbackAnswer, setFallbackAnswer] = useState('')
  const [voiceError, setVoiceError] = useState('')
  const [hasAnswered, setHasAnswered] = useState(false)
  const step = steps[stepIndex]

  const promptByStep: Record<EnrollmentStep, string> = {
    category: 'Picture taken. You can put the object down. Is this a sentimental item, a daily-use appliance, or a personal belonging?',
    name: 'What should I call this object?',
    purpose: `What is ${name || 'this object'} used for?`,
    location: `Where does ${name || 'it'} usually belong?`,
    story: 'Does it have a story you would like me to remember? You can also say skip.',
    personality: 'Should it sound gentle, cheerful, or straightforward?',
    review: `I have ${name || 'this object'}, a ${categoryDefinitions[category].label.toLowerCase()} used for ${purpose || 'the purpose you described'}, usually kept ${usualLocation || 'where you described'}. Should I remember this? Say yes or no.`,
  }

  function listenAfterPrompt() {
    window.setTimeout(() => speech.start(), 450)
  }

  function repeatPrompt(prefix = '') {
    setVoiceError('')
    speech.cancel()
    speak(`${prefix}${promptByStep[step]}`, speech.supported ? listenAfterPrompt : undefined)
  }

  function advance() {
    setHasAnswered(true)
    setFallbackAnswer('')
    setVoiceError('')
    setStepIndex((current) => Math.min(current + 1, steps.length - 1))
  }

  function chooseCategory(nextCategory: ObjectCategory) {
    setCategory(nextCategory)
    advance()
  }

  function handleAnswer(rawAnswer: string) {
    const answer = rawAnswer.trim()
    const normalized = answer.toLowerCase()
    const genericNonAnswer = /^(thank you|thanks|ok(?:ay)?|yes|no|sure|uh+|um+)[.!]?$/i
    if (!answer) return

    if (/\b(stop|cancel|quit)\b/.test(normalized)) {
      speak('Okay. I stopped the introduction.')
      onCancel()
      return
    }
    if (/\b(repeat|say that again)\b/.test(normalized)) {
      repeatPrompt()
      return
    }
    if (/\b(go back|previous)\b/.test(normalized)) {
      setStepIndex((current) => Math.max(0, current - 1))
      return
    }
    if (/\b(help|what can i say)\b/.test(normalized)) {
      speak('Answer the question naturally. You can also say repeat, go back, skip, or stop.', speech.start)
      return
    }

    if (step === 'category') {
      if (/\b(sentimental|keepsake|photo|gift|memory)\b/.test(normalized)) chooseCategory('sentimental')
      else if (/\b(appliance|kettle|lamp|tool|machine)\b/.test(normalized)) chooseCategory('appliance')
      else if (/\b(belonging|glasses|keys|bag|personal)\b/.test(normalized)) chooseCategory('belonging')
      else {
        setVoiceError('I did not catch the category.')
        speak('Please say sentimental item, appliance, or personal belonging.', speech.start)
      }
      return
    }

    if (step === 'name') {
      const nextName = answer.replace(/^(call it|it is|this is)\s+/i, '').trim()
      if (genericNonAnswer.test(nextName) || nextName.length < 2 || nextName.length > 60) {
        setVoiceError('That did not sound like an object name.')
        speak('Please say a short name for the object.', listenAfterPrompt)
        return
      }
      setName(nextName)
      advance()
      return
    }
    if (step === 'purpose') {
      if (genericNonAnswer.test(answer) || answer.length > 240) {
        setVoiceError('I did not hear what the object is used for.')
        speak('Please tell me what this object is used for.', listenAfterPrompt)
        return
      }
      setPurpose(answer)
      advance()
      return
    }
    if (step === 'location') {
      if (genericNonAnswer.test(answer) || answer.length > 120) {
        setVoiceError('I did not hear where the object belongs.')
        speak('Please tell me where this object usually belongs.', listenAfterPrompt)
        return
      }
      setUsualLocation(answer)
      advance()
      return
    }
    if (step === 'story') {
      if (/\b(skip|no|no story|not now)\b/.test(normalized)) {
        setStory('')
      } else {
        if (genericNonAnswer.test(answer) || answer.length > 700) {
          setVoiceError('I did not hear a story. You can also say skip.')
          speak('Please share the story, or say skip.', listenAfterPrompt)
          return
        }
        setStory(answer)
      }
      advance()
      return
    }
    if (step === 'personality') {
      if (/\b(cheerful|happy|bright)\b/.test(normalized)) setPersonality('cheerful')
      else if (/\b(straightforward|matter.of.fact|clear|direct)\b/.test(normalized)) setPersonality('matter-of-fact')
      else if (/\b(gentle|calm|reassuring)\b/.test(normalized)) setPersonality('gentle')
      else {
        setVoiceError('I did not catch the personality.')
        speak('Please say gentle, cheerful, or straightforward.', speech.start)
        return
      }
      advance()
      return
    }
    if (step === 'review') {
      if (/\b(yes|confirm|correct|remember)\b/.test(normalized)) submit()
      else if (/\b(no|wrong|start over)\b/.test(normalized)) {
        setStepIndex(1)
        speak('Okay. Let us start again with the name.')
      } else {
        setVoiceError('Please answer yes or no.')
        speak('Please say yes to create this twin, or no to make a correction.', speech.start)
      }
    }
  }

  const speech = useSpeechInput(handleAnswer)

  useEffect(() => {
    const prefix = hasAnswered ? 'Got it. ' : ''
    const timer = window.setTimeout(() => repeatPrompt(prefix), 180)
    return () => window.clearTimeout(timer)
  }, [stepIndex])

  function submit() {
    const now = new Date().toISOString()
    const currentState = Object.fromEntries(
      categoryDefinitions[category].stateFields.map((field) => [field.key, field.values[0]]),
    )
    const twin = objectTwinSchema.parse({
      id: crypto.randomUUID(),
      name,
      category,
      description: categoryDefinitions[category].description,
      purpose,
      story,
      usualLocation,
      approvedInstructions: '',
      safetyNotes: '',
      isMedicationRelated: false,
      persona: {
        warmth: personality,
        voiceName: 'Default',
        greeting: `Hello, I’m ${name}.`,
        prohibitedTopics: ['medical advice', 'financial advice'],
      },
      fingerprints: [fingerprint],
      currentState,
      createdAt: now,
      updatedAt: now,
    })
    onEnroll(twin)
  }

  return (
    <section className="enrollment-card voice-enrollment">
      <div className="section-heading compact">
        <div><p className="eyebrow">Voice introduction · {stepIndex + 1} of {steps.length}</p><h2>You can keep your hands free</h2></div>
        <button className="icon-button" onClick={onCancel} aria-label="Close"><X size={18} /></button>
      </div>
      <div className="voice-progress" aria-hidden="true">
        {steps.map((item, index) => <span key={item} className={index <= stepIndex ? 'complete' : ''} />)}
      </div>

      <div className="voice-question">
        <span className={`voice-orb ${speech.listening ? 'listening' : ''}`}><Mic size={28} /></span>
        <div>
          <span className="card-kicker">{speech.listening ? 'Listening now' : speech.processing ? 'Sending to Groq' : 'Spoken question'}</span>
          <h3>{promptByStep[step]}</h3>
          {speech.microphoneName && (
            <p className="microphone-note">
              Input: {speech.microphoneName}
              {speech.lastSignalLevel !== null && ` · Last signal ${speech.lastSignalLevel.toFixed(4)}`}
            </p>
          )}
          {(voiceError || speech.error) && <p className="voice-error">{voiceError || speech.error}</p>}
        </div>
      </div>

      {step === 'category' && (
        <div className="category-grid">
          {(Object.keys(categoryDefinitions) as ObjectCategory[]).map((item) => {
            const Icon = iconByCategory[item]
            return (
              <button key={item} className={`category-choice ${category === item ? 'selected' : ''}`} onClick={() => chooseCategory(item)}>
                <Icon size={22} /><strong>{categoryDefinitions[item].label}</strong>
              </button>
            )
          })}
        </div>
      )}

      {step === 'review' ? (
        <div className="spoken-review">
          <div><span>Name</span><strong>{name}</strong></div>
          <div><span>Type</span><strong>{categoryDefinitions[category].label}</strong></div>
          <div><span>Purpose</span><strong>{purpose}</strong></div>
          <div><span>Usual place</span><strong>{usualLocation}</strong></div>
          <div><span>Voice</span><strong>{personality}</strong></div>
          <div className="button-row">
            <button className="primary-button" onClick={submit}><Check size={18} /> Yes, remember it</button>
            <button className="secondary-button" onClick={() => setStepIndex(1)}><RotateCcw size={18} /> Make a correction</button>
          </div>
        </div>
      ) : (
        <div className="voice-controls">
          {speech.supported && (
            <button className={`primary-button large ${speech.listening ? 'listening' : ''}`} onClick={speech.listening ? speech.stop : speech.start} disabled={speech.processing}>
              <Mic size={20} /> {speech.processing ? 'Understanding…' : speech.listening ? 'Listening… tap to stop' : 'Answer by voice'}
            </button>
          )}
          <button className="secondary-button" onClick={() => repeatPrompt()}><Volume2 size={18} /> Repeat question</button>
        </div>
      )}

      {step !== 'category' && step !== 'review' && (
        <details className="typing-fallback">
          <summary>Need to type instead?</summary>
          <div className="composer">
            <input value={fallbackAnswer} onChange={(event) => setFallbackAnswer(event.target.value)} onKeyDown={(event) => event.key === 'Enter' && handleAnswer(fallbackAnswer)} placeholder="Optional keyboard answer" />
            <button className="secondary-button" onClick={() => handleAnswer(fallbackAnswer)}>Continue</button>
          </div>
        </details>
      )}

      <div className="enrollment-summary">
        {name && <span><b>Name</b> {name}</span>}
        {purpose && <span><b>Purpose</b> {purpose}</span>}
        {usualLocation && <span><b>Place</b> {usualLocation}</span>}
      </div>
      <div className="privacy-note"><ShieldCheck size={18} /><span>The camera is already off. The raw frame was discarded; only a compact fingerprint remains.</span></div>
    </section>
  )
}

function LibraryView({
  twins,
  events,
  onSelect,
  onScan,
}: {
  twins: ObjectTwin[]
  events: StateEvent[]
  onSelect: (twin: ObjectTwin) => void
  onScan: () => void
}) {
  return (
    <div className="page">
      <div className="section-heading">
        <div><p className="eyebrow">Private collection</p><h1>My objects</h1><p>{twins.length} persistent twins on this device</p></div>
        <button className="primary-button" onClick={onScan}><Plus size={18} /> Add object</button>
      </div>
      <div className="library-grid">
        {twins.map((twin) => {
          const eventCount = events.filter((event) => event.twinId === twin.id).length
          return <TwinCard key={twin.id} twin={twin} subtitle={`${eventCount} confirmed ${eventCount === 1 ? 'change' : 'changes'}`} onClick={() => onSelect(twin)} />
        })}
      </div>
    </div>
  )
}

function ObjectView({
  twin,
  events,
  messages,
  question,
  observation,
  pendingProposal,
  caregiverMode,
  speech,
  onQuestion,
  onAsk,
  onObservation,
  onPropose,
  onConfirmProposal,
  onRejectProposal,
  onRevert,
  onUpdate,
  onDelete,
}: {
  twin: ObjectTwin
  events: StateEvent[]
  messages: Message[]
  question: string
  observation: string
  pendingProposal: ObservationProposal | null
  caregiverMode: boolean
  speech: ReturnType<typeof useSpeechInput>
  onQuestion: (value: string) => void
  onAsk: (value?: string) => void
  onObservation: (value: string) => void
  onPropose: () => void
  onConfirmProposal: () => void
  onRejectProposal: () => void
  onRevert: (event: StateEvent) => void
  onUpdate: (twin: ObjectTwin) => void
  onDelete: () => void
}) {
  const Icon = iconByCategory[twin.category]
  return (
    <div className="page object-page">
      <section className="object-hero">
        <div className={`object-avatar large ${twin.category}`}><Icon size={38} /></div>
        <div>
          <p className="eyebrow">{categoryDefinitions[twin.category].label}</p>
          <h1>{twin.name}</h1>
          <p>{twin.persona.greeting}</p>
          <div className="state-pills">
            {Object.entries(twin.currentState).map(([field, value]) => <span key={field}><b>{field}</b> {value}</span>)}
          </div>
        </div>
        <button className="speak-button" onClick={() => speak(twin.persona.greeting)} aria-label="Hear greeting"><Volume2 size={20} /></button>
      </section>

      <div className="object-layout">
        <section className="conversation-panel">
          <div className="panel-heading"><div><p className="eyebrow">Live conversation</p><h2>Talk with {twin.name}</h2></div><span className="grounded-badge"><ShieldCheck size={14} /> Grounded</span></div>
          <div className="suggestions">
            {['What are you for?', 'Tell me your story', 'Where do you belong?', 'What changed?'].map((item) => (
              <button key={item} onClick={() => onAsk(item)}>{item}</button>
            ))}
          </div>
          <div className="messages" aria-live="polite">
            {messages.length === 0 && <div className="object-message">I’ll only say what was recorded or confirmed. What would you like to know?</div>}
            {messages.map((message) => (
              <div key={message.id} className={`${message.speaker}-message`}>
                {message.text}
                {message.grounding && <span className="source-tag">Source: {message.grounding}</span>}
              </div>
            ))}
          </div>
          <div className="composer">
            <input value={question} onChange={(event) => onQuestion(event.target.value)} onKeyDown={(event) => event.key === 'Enter' && onAsk()} placeholder={`Ask ${twin.name} something…`} />
            {speech.supported && <button className={`icon-button ${speech.listening ? 'listening' : ''}`} onClick={speech.listening ? speech.stop : speech.start} aria-label="Use microphone" disabled={speech.processing}><Mic size={19} /></button>}
            <button className="primary-button" onClick={() => onAsk()}>Ask</button>
          </div>
          {speech.error && <div className="inline-alert">{speech.error}</div>}
        </section>

        <aside className="memory-panel">
          <p className="eyebrow">What you told me</p>
          <h2>My story</h2>
          <blockquote>{twin.story || 'No personal story has been added yet.'}</blockquote>
          <dl>
            <div><dt>Purpose</dt><dd>{twin.purpose}</dd></div>
            <div><dt>Usual place</dt><dd>{twin.usualLocation || 'Not recorded'}</dd></div>
          </dl>
        </aside>
      </div>

      <section className="observation-card">
        <div className="panel-heading"><div><p className="eyebrow">Stateful memory</p><h2>Tell me what changed</h2><p>Try “the lid is open,” “it moved,” or “it is damaged.”</p></div><ScanLine size={25} /></div>
        <div className="composer">
          <input value={observation} onChange={(event) => onObservation(event.target.value)} onKeyDown={(event) => event.key === 'Enter' && onPropose()} placeholder="Describe one visible change…" />
          <button className="primary-button" onClick={onPropose}>Notice change</button>
        </div>
        {pendingProposal && (
          <div className="confirmation-box">
            <div><strong>Should I remember this?</strong><p>{pendingProposal.summary} Consequential or uncertain changes need a person to confirm.</p></div>
            <div className="button-row">
              <button className="primary-button" onClick={onConfirmProposal}><Check size={18} /> Confirm</button>
              <button className="secondary-button" onClick={onRejectProposal}><X size={18} /> Not correct</button>
            </div>
          </div>
        )}
      </section>

      <section className="history-section">
        <div className="section-heading compact"><div><p className="eyebrow">Append-only record</p><h2>Confirmed history</h2></div><Clock3 size={22} /></div>
        {events.length === 0 ? <p className="muted">No confirmed changes yet.</p> : (
          <div className="timeline">
            {events.map((event) => (
              <div className="timeline-item" key={event.id}>
                <span className="timeline-dot" />
                <div><strong>{event.field}: {event.before ?? 'unknown'} → {event.after}</strong><p>{event.evidenceText}</p><span>{formatTime(event.observedAt)} · {event.source} · confirmed by {event.confirmedBy}</span></div>
                {caregiverMode && !event.revertedEventId && <button className="icon-button" onClick={() => onRevert(event)} title="Correct this event"><RotateCcw size={17} /></button>}
              </div>
            ))}
          </div>
        )}
      </section>

      {caregiverMode && (
        <CaregiverEditor twin={twin} onUpdate={onUpdate} onDelete={onDelete} />
      )}
    </div>
  )
}

function CaregiverEditor({ twin, onUpdate, onDelete }: { twin: ObjectTwin; onUpdate: (twin: ObjectTwin) => void; onDelete: () => void }) {
  const [story, setStory] = useState(twin.story)
  const [instructions, setInstructions] = useState(twin.approvedInstructions)
  const [safety, setSafety] = useState(twin.safetyNotes)
  return (
    <section className="caregiver-editor">
      <div className="panel-heading"><div><p className="eyebrow">Caregiver mode</p><h2>Edit grounded knowledge</h2></div><UserRoundCog size={23} /></div>
      <label><span>Personal story</span><textarea value={story} onChange={(event) => setStory(event.target.value)} /></label>
      <label><span>Approved instructions</span><textarea value={instructions} onChange={(event) => setInstructions(event.target.value)} /></label>
      <label><span>Safety note</span><textarea value={safety} onChange={(event) => setSafety(event.target.value)} /></label>
      <div className="button-row">
        <button className="primary-button" onClick={() => onUpdate({ ...twin, story, approvedInstructions: instructions, safetyNotes: safety, updatedAt: new Date().toISOString() })}>Save caregiver changes</button>
        <button className="danger-button" onClick={onDelete}><Trash2 size={17} /> Delete this twin</button>
      </div>
    </section>
  )
}

function CaregiverView({
  world,
  caregiverMode,
  onToggleMode,
  onExport,
  onDeleteAll,
}: {
  world: StoredWorld
  caregiverMode: boolean
  onToggleMode: () => void
  onExport: () => void
  onDeleteAll: () => void
}) {
  return (
    <div className="page caregiver-page">
      <div className="page-title"><p className="eyebrow">Dignity and control</p><h1>Caregiver settings</h1><p>Keep the person in control. Review what the system knows, correct mistakes, and delete everything at any time.</p></div>
      <div className="settings-card prominent">
        <div className="settings-icon"><UserRoundCog size={24} /></div>
        <div><h2>Caregiver editing</h2><p>Allows editing stories and safety notes, correcting history, and deleting twins. This demo uses an acknowledgement rather than account authentication.</p></div>
        <button className={caregiverMode ? 'secondary-button' : 'primary-button'} onClick={onToggleMode}>{caregiverMode ? 'Leave caregiver mode' : 'Enter caregiver mode'}</button>
      </div>
      <div className="settings-grid">
        <div className="settings-card"><Camera size={23} /><h2>Camera privacy</h2><p>Camera is off by default. It runs during an explicit object introduction or World Mode session, with visible pause and exit controls. Raw frames are not saved.</p><span className="safe-label"><Check size={14} /> Privacy-protective default</span></div>
        <div className="settings-card"><ShieldCheck size={23} /><h2>Safety boundary</h2><p>No diagnosis, medication decisions, emergency claims, financial advice, or hidden monitoring.</p><span className="safe-label"><Check size={14} /> Always enforced</span></div>
        <div className="settings-card"><Download size={23} /><h2>Own the data</h2><p>Export every object profile and state event as a readable JSON file.</p><button className="secondary-button" onClick={onExport}><Download size={17} /> Export data</button></div>
        <div className="settings-card danger-zone"><Trash2 size={23} /><h2>Delete local data</h2><p>Immediately removes all twins, fingerprints, stories, and history from this browser.</p><button className="danger-button" onClick={onDeleteAll}><Trash2 size={17} /> Delete everything</button></div>
      </div>
      <div className="scope-card"><strong>Prototype boundary</strong><p>{world.twins.length} twins and {world.events.length} events are stored locally. This experience supports memory and conversation; it does not replace people, supervision, medical care, or emergency services.</p></div>
    </div>
  )
}

function TwinCard({ twin, subtitle, onClick }: { twin: ObjectTwin; subtitle?: string; onClick: () => void }) {
  const Icon = iconByCategory[twin.category]
  return (
    <button className="twin-card" onClick={onClick}>
      <div className={`object-avatar ${twin.category}`}><Icon size={25} /></div>
      <div><span className="card-kicker">{categoryDefinitions[twin.category].label}</span><strong>{twin.name}</strong><span>{subtitle ?? twin.usualLocation}</span></div>
    </button>
  )
}

function NavButton({ active, label, icon: Icon, onClick }: { active: boolean; label: string; icon: typeof Home; onClick: () => void }) {
  return <button className={active ? 'active' : ''} onClick={onClick}><Icon size={20} /><span>{label}</span></button>
}

function ConsentSheet({ onAccept }: { onAccept: () => void }) {
  return (
    <div className="modal-backdrop">
      <section className="consent-sheet" role="dialog" aria-modal="true" aria-labelledby="consent-title">
        <div className="consent-symbol"><ShieldCheck size={28} /></div>
        <p className="eyebrow">Before we begin</p>
        <h1 id="consent-title">Your room stays yours.</h1>
        <p>The camera and microphone stay off until you choose them. Camera frames are processed on demand—or during an explicit World Mode session—and discarded; only compact fingerprints and confirmed memories remain in this browser.</p>
        <ul>
          <li><Check size={17} /> Clear camera and microphone indicators</li>
          <li><Check size={17} /> No hidden or background monitoring</li>
          <li><Check size={17} /> Export or delete your data whenever you want</li>
          <li><Check size={17} /> No medical diagnosis or medication decisions</li>
        </ul>
        <button className="primary-button large" onClick={onAccept}>Continue with these protections</button>
        <span className="modal-note">Consent can be revisited with a caregiver as needs and preferences change.</span>
      </section>
    </div>
  )
}

export default App
