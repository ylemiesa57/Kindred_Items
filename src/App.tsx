import { useEffect, useMemo, useState } from 'react'
import {
  Camera,
  Check,
  Clock3,
  Download,
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
import './App.css'

type View = 'home' | 'scan' | 'library' | 'caregiver' | 'object'
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
    setQuestion(transcript)
    if (selectedTwin) askTwin(transcript)
  })

  function acceptConsent() {
    localStorage.setItem('object-twins.consent', 'yes')
    setConsent(true)
  }

  function selectTwin(twin: ObjectTwin) {
    setSelectedTwinId(twin.id)
    setMessages([])
    setView('object')
    camera.stop()
  }

  function captureAndMatch() {
    if (!camera.videoRef.current || !camera.active) return
    const fingerprint = fingerprintImage(camera.videoRef.current, false)
    const match = matchFingerprint(fingerprint, world.twins)
    setCapturedFingerprint(fingerprint)
    setIdentityMatch(match)
    setShowEnrollment(!match)
    setStatus(match ? 'I found a possible twin. Please confirm it.' : 'I do not recognize this object yet.')
  }

  function confirmMatch() {
    if (!identityMatch) return
    selectTwin(identityMatch.twin)
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
        <button className="brand" onClick={() => setView('home')} aria-label="Go home">
          <span className="brand-mark"><Sparkles size={18} /></span>
          <span>Kindred Objects</span>
        </button>
        <div className="privacy-chip">
          <span className={`status-dot ${camera.active ? 'live' : ''}`} />
          {camera.active ? 'Camera on now' : 'Camera off'}
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
            onScan={() => setView('scan')}
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

        {view === 'library' && (
          <LibraryView twins={world.twins} events={world.events} onSelect={selectTwin} onScan={() => setView('scan')} />
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
        <NavButton active={view === 'home'} label="Home" icon={Home} onClick={() => setView('home')} />
        <NavButton active={view === 'scan'} label="Show object" icon={ScanLine} onClick={() => setView('scan')} />
        <NavButton active={view === 'library' || view === 'object'} label="My objects" icon={Library} onClick={() => setView('library')} />
        <NavButton active={view === 'caregiver'} label="Caregiver" icon={ShieldCheck} onClick={() => setView('caregiver')} />
      </nav>

      {!consent && <ConsentSheet onAccept={acceptConsent} />}
    </div>
  )
}

function HomeView({
  twins,
  events,
  onScan,
  onSelect,
  onLibrary,
  onRestoreDemo,
}: {
  twins: ObjectTwin[]
  events: StateEvent[]
  onScan: () => void
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
        <button className="primary-button large" onClick={onScan}>
          <Camera size={21} /> Show me an object
        </button>
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
  return (
    <div className="page scan-page">
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
            <button className="primary-button" onClick={onCapture}><ScanLine size={19} /> Look at this object</button>
          </>
        )}
      </div>

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
            </div>
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
  const [category, setCategory] = useState<ObjectCategory>('sentimental')
  const [name, setName] = useState('')
  const [purpose, setPurpose] = useState('')
  const [story, setStory] = useState('')
  const [usualLocation, setUsualLocation] = useState('')
  const [personality, setPersonality] = useState<'gentle' | 'cheerful' | 'matter-of-fact'>('gentle')

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
    <section className="enrollment-card">
      <div className="section-heading compact">
        <div><p className="eyebrow">New twin</p><h2>Introduce this object</h2></div>
        <button className="icon-button" onClick={onCancel} aria-label="Close"><X size={18} /></button>
      </div>
      <div className="category-grid">
        {(Object.keys(categoryDefinitions) as ObjectCategory[]).map((item) => {
          const Icon = iconByCategory[item]
          return (
            <button key={item} className={`category-choice ${category === item ? 'selected' : ''}`} onClick={() => setCategory(item)}>
              <Icon size={22} /><strong>{categoryDefinitions[item].label}</strong>
            </button>
          )
        })}
      </div>
      <div className="form-grid">
        <label><span>What should we call it?</span><input value={name} onChange={(event) => setName(event.target.value)} placeholder="Bluebell" /></label>
        <label><span>Where does it usually belong?</span><input value={usualLocation} onChange={(event) => setUsualLocation(event.target.value)} placeholder="On the living room mantel" /></label>
        <label className="wide"><span>What is it for?</span><input value={purpose} onChange={(event) => setPurpose(event.target.value)} placeholder="I hold flowers and brighten the room." /></label>
        <label className="wide"><span>What story should it remember?</span><textarea value={story} onChange={(event) => setStory(event.target.value)} placeholder="Anna gave this to me after our trip…" /></label>
        <label><span>How should it sound?</span>
          <select value={personality} onChange={(event) => setPersonality(event.target.value as typeof personality)}>
            <option value="gentle">Gentle and reassuring</option>
            <option value="cheerful">Warm and cheerful</option>
            <option value="matter-of-fact">Clear and matter-of-fact</option>
          </select>
        </label>
      </div>
      <div className="privacy-note"><ShieldCheck size={18} /><span>The raw camera frame is discarded. This twin stores only a small color fingerprint for future matching.</span></div>
      <button className="primary-button" disabled={!name.trim() || !purpose.trim()} onClick={submit}><Plus size={18} /> Create this twin</button>
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
            {speech.supported && <button className={`icon-button ${speech.listening ? 'listening' : ''}`} onClick={speech.listening ? speech.stop : speech.start} aria-label="Use microphone"><Mic size={19} /></button>}
            <button className="primary-button" onClick={() => onAsk()}>Ask</button>
          </div>
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
        <div className="settings-card"><Camera size={23} /><h2>Camera privacy</h2><p>Camera is off by default and only active on the “Show object” screen. Raw frames are not saved.</p><span className="safe-label"><Check size={14} /> Privacy-protective default</span></div>
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
        <p>The camera and microphone stay off until you choose them. Camera frames are processed on demand and discarded; only compact fingerprints and confirmed memories remain in this browser.</p>
        <ul>
          <li><Check size={17} /> Clear camera and microphone indicators</li>
          <li><Check size={17} /> No continuous or hidden monitoring</li>
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
