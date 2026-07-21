import { useCallback, useEffect, useRef, useState } from 'react'

type SpeechRecognitionEventLike = Event & {
  results: {
    [index: number]: {
      [index: number]: { transcript: string }
    }
    length: number
  }
}

type RecognitionInstance = {
  continuous: boolean
  interimResults: boolean
  lang: string
  onresult: ((event: SpeechRecognitionEventLike) => void) | null
  onerror: (() => void) | null
  onend: (() => void) | null
  start: () => void
  stop: () => void
}

type RecognitionConstructor = new () => RecognitionInstance

declare global {
  interface Window {
    SpeechRecognition?: RecognitionConstructor
    webkitSpeechRecognition?: RecognitionConstructor
  }
}

export function useCamera() {
  const videoRef = useRef<HTMLVideoElement>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const [active, setActive] = useState(false)
  const [error, setError] = useState('')

  const stop = useCallback(() => {
    streamRef.current?.getTracks().forEach((track) => track.stop())
    streamRef.current = null
    if (videoRef.current) videoRef.current.srcObject = null
    setActive(false)
  }, [])

  const start = useCallback(async () => {
    setError('')
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 } },
        audio: false,
      })
      streamRef.current = stream
      if (videoRef.current) {
        videoRef.current.srcObject = stream
        await videoRef.current.play()
      }
      setActive(true)
    } catch {
      setError('Camera access was not granted. You can still explore the saved demo objects.')
    }
  }, [])

  useEffect(() => stop, [stop])

  return { videoRef, active, error, start, stop }
}

export function useSpeechInput(onTranscript: (transcript: string) => void) {
  const recognitionRef = useRef<RecognitionInstance | null>(null)
  const recorderRef = useRef<MediaRecorder | null>(null)
  const audioStreamRef = useRef<MediaStream | null>(null)
  const audioContextRef = useRef<AudioContext | null>(null)
  const silenceFrameRef = useRef<number | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const heardSpeechRef = useRef(false)
  const discardRecordingRef = useRef(false)
  const [listening, setListening] = useState(false)
  const [processing, setProcessing] = useState(false)
  const [error, setError] = useState('')
  const recorderSupported = Boolean(navigator.mediaDevices?.getUserMedia && window.MediaRecorder)
  const browserRecognitionSupported = Boolean(window.SpeechRecognition || window.webkitSpeechRecognition)
  const supported = recorderSupported || browserRecognitionSupported

  const cleanUpAudio = useCallback(() => {
    if (silenceFrameRef.current !== null) cancelAnimationFrame(silenceFrameRef.current)
    silenceFrameRef.current = null
    void audioContextRef.current?.close()
    audioContextRef.current = null
    audioStreamRef.current?.getTracks().forEach((track) => track.stop())
    audioStreamRef.current = null
    recorderRef.current = null
  }, [])

  const transcribeRecording = useCallback(async (blob: Blob) => {
    setProcessing(true)
    setError('')
    try {
      const form = new FormData()
      const extension = blob.type.includes('ogg') ? 'ogg' : blob.type.includes('mp4') ? 'm4a' : 'webm'
      form.append('audio', blob, `speech.${extension}`)
      const response = await fetch('/api/transcribe', { method: 'POST', body: form })
      const payload = await response.json() as { text?: string; error?: string }
      if (!response.ok || !payload.text) {
        throw new Error(payload.error || 'The recording could not be transcribed.')
      }
      onTranscript(payload.text)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Voice input is unavailable.')
    } finally {
      setProcessing(false)
    }
  }, [onTranscript])

  const stop = useCallback(() => {
    if (recorderRef.current?.state === 'recording') {
      recorderRef.current.stop()
    }
    recognitionRef.current?.stop()
    setListening(false)
  }, [])

  const startBrowserRecognition = useCallback(() => {
    const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition
    if (!Recognition) return
    const recognition = new Recognition()
    recognition.continuous = false
    recognition.interimResults = false
    recognition.lang = 'en-US'
    recognition.onresult = (event) => {
      const transcript = event.results[event.results.length - 1][0].transcript
      onTranscript(transcript)
    }
    recognition.onerror = () => setListening(false)
    recognition.onend = () => setListening(false)
    recognitionRef.current = recognition
    recognition.start()
    setListening(true)
  }, [onTranscript])

  const start = useCallback(async () => {
    if (listening || processing) return
    setError('')

    if (!recorderSupported) {
      startBrowserRecognition()
      return
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      })
      audioStreamRef.current = stream
      const preferredType = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4'].find((type) =>
        MediaRecorder.isTypeSupported(type),
      )
      const recorder = new MediaRecorder(stream, preferredType ? { mimeType: preferredType } : undefined)
      chunksRef.current = []
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) chunksRef.current.push(event.data)
      }
      recorder.onerror = () => {
        discardRecordingRef.current = true
        setError('The microphone recording failed. Please try again.')
        cleanUpAudio()
        setListening(false)
      }
      recorder.onstop = () => {
        const heardSpeech = heardSpeechRef.current
        const shouldDiscard = discardRecordingRef.current
        const blob = new Blob(chunksRef.current, { type: recorder.mimeType || 'audio/webm' })
        cleanUpAudio()
        if (shouldDiscard) return
        if (!heardSpeech) {
          setError('I did not hear an answer. Please try again when you are ready.')
          return
        }
        if (blob.size > 0) void transcribeRecording(blob)
      }
      recorderRef.current = recorder
      heardSpeechRef.current = false
      discardRecordingRef.current = false
      recorder.start()
      setListening(true)

      const audioContext = new AudioContext()
      const analyser = audioContext.createAnalyser()
      analyser.fftSize = 1024
      audioContext.createMediaStreamSource(stream).connect(analyser)
      audioContextRef.current = audioContext
      const levels = new Uint8Array(analyser.fftSize)
      const startedAt = performance.now()
      let heardSpeech = false
      let lastSpeechAt = startedAt
      let speechFrames = 0
      const watchSilence = () => {
        if (recorder.state !== 'recording') return
        analyser.getByteTimeDomainData(levels)
        let energy = 0
        for (const level of levels) {
          const normalized = (level - 128) / 128
          energy += normalized * normalized
        }
        const rms = Math.sqrt(energy / levels.length)
        const now = performance.now()
        if (rms > 0.025) {
          speechFrames += 1
          if (speechFrames >= 4) {
            heardSpeech = true
            heardSpeechRef.current = true
            lastSpeechAt = now
          }
        } else {
          speechFrames = Math.max(0, speechFrames - 1)
        }
        if ((heardSpeech && now - lastSpeechAt > 1300) || now - startedAt > 15000) {
          recorder.stop()
          setListening(false)
          return
        }
        silenceFrameRef.current = requestAnimationFrame(watchSilence)
      }
      silenceFrameRef.current = requestAnimationFrame(watchSilence)
    } catch {
      setError('Microphone access was not granted. Check the browser permission and try again.')
      cleanUpAudio()
      setListening(false)
    }
  }, [cleanUpAudio, listening, processing, recorderSupported, startBrowserRecognition, transcribeRecording])

  useEffect(() => () => {
    if (recorderRef.current?.state === 'recording') {
      discardRecordingRef.current = true
      recorderRef.current.stop()
    }
    recognitionRef.current?.stop()
    cleanUpAudio()
  }, [cleanUpAudio])

  return { listening, processing, error, supported, start, stop }
}

export function speak(text: string, onEnd?: () => void): void {
  if (!('speechSynthesis' in window)) {
    onEnd?.()
    return
  }
  window.speechSynthesis.cancel()
  const utterance = new SpeechSynthesisUtterance(text)
  utterance.rate = 0.92
  utterance.pitch = 1
  utterance.onend = () => onEnd?.()
  utterance.onerror = () => onEnd?.()
  window.speechSynthesis.speak(utterance)
}
