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
  const discardRecordingRef = useRef(false)
  const listeningRef = useRef(false)
  const processingRef = useRef(false)
  const [listening, setListening] = useState(false)
  const [processing, setProcessing] = useState(false)
  const [error, setError] = useState('')
  const recorderSupported = Boolean(navigator.mediaDevices?.getUserMedia && window.MediaRecorder)
  const browserRecognitionSupported = Boolean(window.SpeechRecognition || window.webkitSpeechRecognition)
  const supported = recorderSupported || browserRecognitionSupported

  const setListeningState = useCallback((value: boolean) => {
    listeningRef.current = value
    setListening(value)
  }, [])

  const setProcessingState = useCallback((value: boolean) => {
    processingRef.current = value
    setProcessing(value)
  }, [])

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
    setProcessingState(true)
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
      setProcessingState(false)
    }
  }, [onTranscript, setProcessingState])

  const stop = useCallback(() => {
    if (recorderRef.current?.state === 'recording') {
      recorderRef.current.stop()
    }
    recognitionRef.current?.stop()
    setListeningState(false)
  }, [setListeningState])

  const cancel = useCallback(() => {
    if (recorderRef.current?.state === 'recording') {
      discardRecordingRef.current = true
      recorderRef.current.stop()
    }
    recognitionRef.current?.stop()
    setListeningState(false)
  }, [setListeningState])

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
    recognition.onerror = () => setListeningState(false)
    recognition.onend = () => setListeningState(false)
    recognitionRef.current = recognition
    recognition.start()
    setListeningState(true)
  }, [onTranscript, setListeningState])

  const start = useCallback(async () => {
    if (listeningRef.current || processingRef.current) return
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
        setListeningState(false)
      }
      recorder.onstop = () => {
        const shouldDiscard = discardRecordingRef.current
        const blob = new Blob(chunksRef.current, { type: recorder.mimeType || 'audio/webm' })
        cleanUpAudio()
        if (shouldDiscard) return
        if (blob.size > 0) void transcribeRecording(blob)
      }
      recorderRef.current = recorder
      discardRecordingRef.current = false
      recorder.start()
      setListeningState(true)

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
      let noiseFloor = 0.004
      let calibrationFrames = 0
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
        if (now - startedAt < 450) {
          noiseFloor = (noiseFloor * calibrationFrames + rms) / (calibrationFrames + 1)
          calibrationFrames += 1
        }
        const speechThreshold = Math.max(0.006, noiseFloor * 2.2)
        if (now - startedAt >= 450 && rms > speechThreshold) {
          speechFrames += 1
          if (speechFrames >= 4) {
            heardSpeech = true
            lastSpeechAt = now
          }
        } else {
          speechFrames = Math.max(0, speechFrames - 1)
        }
        if ((heardSpeech && now - lastSpeechAt > 1300) || now - startedAt > 10000) {
          recorder.stop()
          setListeningState(false)
          return
        }
        silenceFrameRef.current = requestAnimationFrame(watchSilence)
      }
      silenceFrameRef.current = requestAnimationFrame(watchSilence)
    } catch {
      setError('Microphone access was not granted. Check the browser permission and try again.')
      cleanUpAudio()
      setListeningState(false)
    }
  }, [cleanUpAudio, recorderSupported, setListeningState, startBrowserRecognition, transcribeRecording])

  useEffect(() => () => {
    if (recorderRef.current?.state === 'recording') {
      discardRecordingRef.current = true
      recorderRef.current.stop()
    }
    recognitionRef.current?.stop()
    cleanUpAudio()
  }, [cleanUpAudio])

  return { listening, processing, error, supported, start, stop, cancel }
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
