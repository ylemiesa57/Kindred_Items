import { describe, expect, it } from 'vitest'
import { seedTwins } from './seed'
import {
  answerAsTwin,
  assessConfirmation,
  commitProposal,
  parseObservationText,
  revertEvent,
} from './twinEngine'
import { cosineSimilarity, matchFingerprint } from './vision'

describe('state proposal policy', () => {
  it('extracts supported changes from plain language', () => {
    const kettle = seedTwins[1]
    const proposal = parseObservationText(kettle, 'The lid is open now')

    expect(proposal.deltas).toEqual([
      expect.objectContaining({ field: 'closure', before: 'closed', after: 'open' }),
    ])
  })

  it('requires confirmation for consequential changes', () => {
    const kettle = seedTwins[1]
    const proposal = parseObservationText(kettle, 'The lid is open now')
    const decision = assessConfirmation(kettle, proposal)

    expect(decision.required).toBe(true)
    expect(decision.reasons).toContain('This change could affect safety or indicate damage.')
  })

  it('requires confirmation when visual identity is uncertain', () => {
    const vase = seedTwins[0]
    const proposal = {
      ...parseObservationText(vase, 'It moved'),
      identityConfidence: 0.8,
    }

    expect(assessConfirmation(vase, proposal).reasons).toContain(
      'I may be looking at a similar object.',
    )
  })

  it('commits and reverses changes through new immutable events', () => {
    const glasses = seedTwins[2]
    const proposal = parseObservationText(glasses, 'The glasses moved')
    const committed = commitProposal(glasses, proposal, 'user')

    expect(committed.twin.currentState.location).toBe('moved')
    expect(committed.events).toHaveLength(1)

    const corrected = revertEvent(committed.twin, committed.events[0])
    expect(corrected.twin.currentState.location).toBe('usual place')
    expect(corrected.event.revertedEventId).toBe(committed.events[0].id)
  })
})

describe('grounded object personality', () => {
  it('attributes personal memories to the person who recorded them', () => {
    const answer = answerAsTwin(seedTwins[0], 'Tell me your story')
    expect(answer.grounding).toBe('profile')
    expect(answer.text).toContain('You told me this')
  })

  it('refuses medication decisions even for an ordinary object', () => {
    const answer = answerAsTwin(seedTwins[0], 'What medication dose should I take?')
    expect(answer.grounding).toBe('safety')
    expect(answer.text).toContain('can’t make medical')
  })
})

describe('visual identity matching', () => {
  it('returns one for identical fingerprints', () => {
    const fingerprint = seedTwins[0].fingerprints[0].histogram
    expect(cosineSimilarity(fingerprint, fingerprint)).toBeCloseTo(1)
  })

  it('retrieves the matching twin without silently resolving ambiguity', () => {
    const match = matchFingerprint(seedTwins[0].fingerprints[0], seedTwins)
    expect(match?.twin.id).toBe(seedTwins[0].id)
    expect(match?.confidence).toBeCloseTo(1)
  })
})
