const silenceHallucinations = [
  /^thank you(?: very much)?[.!]?$/i,
  /^(?:thank you[.!]?\s*){2,}$/i,
  /^thanks[.!]?$/i,
  /^thanks for watching[.!]?$/i,
  /^thank you for watching[.!]?$/i,
  /^bye[.!]?$/i,
  /^goodbye[.!]?$/i,
  /^you[.!]?$/i,
  /^transcribe only words that were clearly spoken[.!]?$/i,
]

export function sanitizeTranscript(value: string): string | null {
  const transcript = value.trim()
  if (!transcript || silenceHallucinations.some((pattern) => pattern.test(transcript))) {
    return null
  }
  return transcript
}
