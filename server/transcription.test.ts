import { describe, expect, it } from 'vitest'
import { sanitizeTranscript } from './transcription.js'

describe('sanitizeTranscript', () => {
  it.each(['', 'Thank you.', 'Thanks for watching!', 'Bye.', 'Transcribe only words that were clearly spoken.'])(
    'rejects common silence hallucination %j',
    (value) => expect(sanitizeTranscript(value)).toBeNull(),
  )

  it('keeps a meaningful object answer', () => {
    expect(sanitizeTranscript('It belongs beside the front door.')).toBe(
      'It belongs beside the front door.',
    )
  })
})
