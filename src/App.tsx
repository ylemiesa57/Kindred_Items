import { useEffect, useRef, useState } from 'react'
import { Heart, RotateCcw, Sparkles, Volume2, VolumeX, X } from 'lucide-react'
import './App.css'

type ConfettiPiece = {
  id: number
  left: number
  delay: number
  duration: number
  color: string
  shape: 'circle' | 'square' | 'heart'
}

const confettiColors = ['#ff5c8a', '#ffd166', '#a78bfa', '#65d6ce', '#ff8fab', '#ffffff']
const memories = [
  { src: '/photos/favorite.jpg', caption: 'my favorite place is next to you' },
  { src: '/photos/emma-lisbon.jpg', caption: 'pretty girl, pretty places' },
  { src: '/photos/yaphet-sunset.jpg', caption: 'sunsets & us' },
  { src: '/photos/dinner.jpg', caption: 'date night energy' },
  { src: '/photos/summer-adventure.jpg', caption: 'little adventures' },
  { src: '/photos/casino-night.jpg', caption: 'always a good time' },
  { src: '/photos/night-out.jpg', caption: 'all dressed up' },
  { src: '/photos/emma-sunlight.jpg', caption: 'my sunshine' },
]

function createConfetti(amount = 90): ConfettiPiece[] {
  return Array.from({ length: amount }, (_, id) => ({
    id,
    left: Math.random() * 100,
    delay: Math.random() * 0.7,
    duration: 2.8 + Math.random() * 2.5,
    color: confettiColors[Math.floor(Math.random() * confettiColors.length)],
    shape: (['circle', 'square', 'heart'] as const)[Math.floor(Math.random() * 3)],
  }))
}

function playChime() {
  const AudioContextClass = window.AudioContext
  if (!AudioContextClass) return

  const context = new AudioContextClass()
  const notes = [523.25, 659.25, 783.99, 1046.5]
  notes.forEach((frequency, index) => {
    const oscillator = context.createOscillator()
    const gain = context.createGain()
    const startsAt = context.currentTime + index * 0.12
    oscillator.type = 'sine'
    oscillator.frequency.value = frequency
    gain.gain.setValueAtTime(0, startsAt)
    gain.gain.linearRampToValueAtTime(0.12, startsAt + 0.03)
    gain.gain.exponentialRampToValueAtTime(0.001, startsAt + 0.65)
    oscillator.connect(gain)
    gain.connect(context.destination)
    oscillator.start(startsAt)
    oscillator.stop(startsAt + 0.7)
  })
  window.setTimeout(() => void context.close(), 1400)
}

function App() {
  const [celebrating, setCelebrating] = useState(true)
  const [soundOn, setSoundOn] = useState(true)
  const [confetti, setConfetti] = useState<ConfettiPiece[]>(() => createConfetti())
  const [selectedMemory, setSelectedMemory] = useState<(typeof memories)[number] | null>(null)
  const resetTimer = useRef<number | undefined>(undefined)

  useEffect(() => {
    return () => window.clearTimeout(resetTimer.current)
  }, [])

  function celebrate() {
    window.clearTimeout(resetTimer.current)
    setCelebrating(false)
    setConfetti(createConfetti(120))
    requestAnimationFrame(() => setCelebrating(true))
    if (soundOn) playChime()
    resetTimer.current = window.setTimeout(() => setCelebrating(false), 5200)
  }

  return (
    <main className={`anniversary ${celebrating ? 'is-celebrating' : ''}`}>
      <div className="aurora aurora-one" />
      <div className="aurora aurora-two" />
      <div className="noise" />

      <div className="stars" aria-hidden="true">
        {Array.from({ length: 34 }, (_, index) => (
          <i
            key={index}
            style={{
              '--x': `${(index * 37) % 100}%`,
              '--y': `${(index * 61) % 96}%`,
              '--delay': `${(index % 9) * 0.24}s`,
              '--size': `${2 + (index % 3)}px`,
            } as React.CSSProperties}
          />
        ))}
      </div>

      <div className="floating-hearts" aria-hidden="true">
        {Array.from({ length: 12 }, (_, index) => (
          <Heart
            key={index}
            style={{
              '--heart-x': `${5 + ((index * 29) % 90)}%`,
              '--heart-delay': `${(index % 7) * -1.4}s`,
              '--heart-duration': `${8 + (index % 5)}s`,
              '--heart-size': `${12 + (index % 4) * 5}px`,
            } as React.CSSProperties}
          />
        ))}
      </div>

      {celebrating && (
        <div className="confetti" aria-hidden="true">
          {confetti.map((piece) => (
            <i
              key={piece.id}
              className={piece.shape}
              style={{
                '--left': `${piece.left}%`,
                '--delay': `${piece.delay}s`,
                '--duration': `${piece.duration}s`,
                '--color': piece.color,
              } as React.CSSProperties}
            >
              {piece.shape === 'heart' ? '♥' : ''}
            </i>
          ))}
        </div>
      )}

      <button
        className="sound-toggle"
        onClick={() => setSoundOn((current) => !current)}
        aria-label={soundOn ? 'Turn celebration sound off' : 'Turn celebration sound on'}
      >
        {soundOn ? <Volume2 size={18} /> : <VolumeX size={18} />}
      </button>

      <div className="page-content">
        <section className="love-card">
          <div className="card-glow" />
          <div className="orbit orbit-one"><span /></div>
          <div className="orbit orbit-two"><span /></div>

          <p className="eyebrow"><Sparkles size={15} /> Our little milestone <Sparkles size={15} /></p>

          <button className="hero-photo" onClick={() => setSelectedMemory(memories[0])} aria-label="Open our favorite photo">
            <img src={memories[0].src} alt="Emma and Yaphet smiling together" />
            <span className="hero-heart" aria-hidden="true">
              <Heart fill="currentColor" strokeWidth={1.5} />
              <b>2.5</b>
            </span>
          </button>

          <h1>
            Happy <em>2.5 Year</em>
            <span>Anniversary!</span>
          </h1>

          <p className="message">
            Two and a half years of laughter, late-night talks, tiny adventures,
            and choosing each other—again and again.
          </p>

          <div className="milestones" aria-label="Our milestone in numbers">
            <div><strong>30</strong><span>months</span></div>
            <i />
            <div><strong>2.5</strong><span>years</span></div>
            <i />
            <div><strong>∞</strong><span>more memories</span></div>
          </div>

          <button className="celebrate-button" onClick={celebrate}>
            {celebrating ? <Sparkles size={19} /> : <RotateCcw size={18} />}
            {celebrating ? 'Celebrating us!' : 'Celebrate again'}
          </button>

          <p className="signature">Here’s to every chapter still to come <Heart size={14} fill="currentColor" /></p>
        </section>

        <section className="memory-section">
          <p className="eyebrow"><Sparkles size={14} /> Moments I keep replaying</p>
          <h2>Our story, in snapshots</h2>
          <div className="photo-grid">
            {memories.slice(1).map((memory, index) => (
              <button
                className="polaroid"
                key={memory.src}
                onClick={() => setSelectedMemory(memory)}
                style={{ '--tilt': `${[-2.8, 2, -1.2, 2.8, -2, 1.4, -1.6][index]}deg` } as React.CSSProperties}
              >
                <img src={memory.src} alt={memory.caption} loading="lazy" />
                <span>{memory.caption}</span>
              </button>
            ))}
          </div>
        </section>

        <p className="footer-note">made with a whole lot of love</p>
      </div>

      {selectedMemory && (
        <div className="lightbox" role="dialog" aria-modal="true" aria-label="Photo memory" onClick={() => setSelectedMemory(null)}>
          <button className="lightbox-close" onClick={() => setSelectedMemory(null)} aria-label="Close photo"><X /></button>
          <figure onClick={(event) => event.stopPropagation()}>
            <img src={selectedMemory.src} alt={selectedMemory.caption} />
            <figcaption>{selectedMemory.caption} <Heart size={15} fill="currentColor" /></figcaption>
          </figure>
        </div>
      )}
    </main>
  )
}

export default App
