import { useCallback, useEffect, useRef, useState } from 'react'
import type { RealtimeSession } from '@openai/agents/realtime'

export type RealtimeVoiceStatus =
  | 'disconnected'
  | 'connecting'
  | 'listening'
  | 'speaking'
  | 'muted'
  | 'error'

type TokenResponse = {
  value: string
  session?: { model?: string }
  error?: string
}

export function useRealtimeVoice() {
  const sessionRef = useRef<RealtimeSession | null>(null)
  const [status, setStatus] = useState<RealtimeVoiceStatus>('disconnected')
  const [error, setError] = useState('')

  const disconnect = useCallback(() => {
    sessionRef.current?.close()
    sessionRef.current = null
    setStatus('disconnected')
  }, [])

  const connect = useCallback(async (instructions: string) => {
    if (sessionRef.current) return
    setStatus('connecting')
    setError('')

    try {
      const { RealtimeAgent, RealtimeSession } = await import('@openai/agents/realtime')
      const tokenResponse = await fetch('/api/realtime-token', { method: 'POST' })
      const token = await tokenResponse.json() as TokenResponse
      if (!tokenResponse.ok || !token.value) {
        throw new Error(token.error || 'Realtime voice is not configured.')
      }

      const agent = new RealtimeAgent({
        name: 'Kindred World Guide',
        instructions,
      })
      const session = new RealtimeSession(agent, {
        transport: 'webrtc',
        model: token.session?.model ?? 'gpt-realtime-2',
        tracingDisabled: true,
      })
      session.on('audio_start', () => setStatus('speaking'))
      session.on('audio_stopped', () => setStatus(session.muted ? 'muted' : 'listening'))
      session.on('audio_interrupted', () => setStatus(session.muted ? 'muted' : 'listening'))
      session.on('error', (event) => {
        console.error('Realtime voice session error', event.error)
        setError('The live voice session encountered a problem.')
        setStatus('error')
      })

      await session.connect({
        apiKey: token.value,
        model: token.session?.model ?? 'gpt-realtime-2',
      })
      sessionRef.current = session
      setStatus('listening')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Realtime voice could not start.')
      setStatus('error')
    }
  }, [])

  const setMuted = useCallback((muted: boolean) => {
    const session = sessionRef.current
    if (!session) return
    session.mute(muted)
    setStatus(muted ? 'muted' : 'listening')
  }, [])

  const sendContext = useCallback((message: string, image?: string) => {
    const session = sessionRef.current
    if (!session) return
    if (image) session.addImage(image, { triggerResponse: false })
    session.sendMessage(message)
  }, [])

  const updateInstructions = useCallback(async (instructions: string) => {
    const session = sessionRef.current
    if (!session) return
    const { RealtimeAgent } = await import('@openai/agents/realtime')
    await session.updateAgent(new RealtimeAgent({
      name: 'Kindred World Guide',
      instructions,
    }))
  }, [])

  useEffect(() => disconnect, [disconnect])

  return {
    status,
    error,
    connected: Boolean(sessionRef.current),
    connect,
    disconnect,
    setMuted,
    sendContext,
    updateInstructions,
  }
}
