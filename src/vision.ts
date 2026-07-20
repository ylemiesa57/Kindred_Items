import type { ObjectTwin } from './domain'

export type CapturedFingerprint = ObjectTwin['fingerprints'][number]

const BINS_PER_CHANNEL = 16

export function fingerprintImage(
  source: HTMLVideoElement | HTMLImageElement | HTMLCanvasElement,
  includeThumbnail = true,
): CapturedFingerprint {
  const canvas = document.createElement('canvas')
  const size = 96
  canvas.width = size
  canvas.height = size
  const context = canvas.getContext('2d', { willReadFrequently: true })
  if (!context) throw new Error('Camera analysis is not available in this browser.')

  context.drawImage(source, 0, 0, size, size)
  const { data } = context.getImageData(0, 0, size, size)
  const histogram = new Array(BINS_PER_CHANNEL * 3).fill(0) as number[]
  const pixels = data.length / 4

  for (let index = 0; index < data.length; index += 4) {
    histogram[Math.floor(data[index] / 16)] += 1
    histogram[BINS_PER_CHANNEL + Math.floor(data[index + 1] / 16)] += 1
    histogram[BINS_PER_CHANNEL * 2 + Math.floor(data[index + 2] / 16)] += 1
  }

  return {
    histogram: histogram.map((value) => value / pixels),
    capturedAt: new Date().toISOString(),
    thumbnail: includeThumbnail ? canvas.toDataURL('image/jpeg', 0.72) : undefined,
  }
}

export function cosineSimilarity(left: number[], right: number[]): number {
  if (left.length !== right.length || left.length === 0) return 0
  let dot = 0
  let leftNorm = 0
  let rightNorm = 0
  for (let index = 0; index < left.length; index += 1) {
    dot += left[index] * right[index]
    leftNorm += left[index] ** 2
    rightNorm += right[index] ** 2
  }
  if (leftNorm === 0 || rightNorm === 0) return 0
  return dot / (Math.sqrt(leftNorm) * Math.sqrt(rightNorm))
}

export type IdentityMatch = {
  twin: ObjectTwin
  confidence: number
  ambiguous: boolean
}

export function matchFingerprint(
  fingerprint: CapturedFingerprint,
  twins: ObjectTwin[],
): IdentityMatch | null {
  const ranked = twins
    .map((twin) => ({
      twin,
      confidence: Math.max(
        ...twin.fingerprints.map((known) => cosineSimilarity(fingerprint.histogram, known.histogram)),
      ),
    }))
    .sort((left, right) => right.confidence - left.confidence)

  const best = ranked[0]
  if (!best || best.confidence < 0.72) return null
  const runnerUp = ranked[1]
  return {
    ...best,
    ambiguous: best.confidence < 0.9 || Boolean(runnerUp && best.confidence - runnerUp.confidence < 0.04),
  }
}
