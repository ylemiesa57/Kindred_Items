import {
  categoryDefinitions,
  type ConfirmationDecision,
  type ObjectTwin,
  type ObservationProposal,
  type StateDelta,
  type StateEvent,
} from './domain'

const HIGH_CONFIDENCE = 0.88
const IDENTITY_CONFIDENCE = 0.92

export function assessConfirmation(
  twin: ObjectTwin,
  proposal: ObservationProposal,
): ConfirmationDecision {
  const reasons: string[] = []
  const fields = categoryDefinitions[twin.category].stateFields

  if (proposal.identityConfidence < IDENTITY_CONFIDENCE) {
    reasons.push('I may be looking at a similar object.')
  }
  if (proposal.deltas.some((delta) => delta.confidence < HIGH_CONFIDENCE)) {
    reasons.push('Part of this observation is uncertain.')
  }
  if (
    proposal.deltas.some((delta) => fields.find((field) => field.key === delta.field)?.consequential)
  ) {
    reasons.push('This change could affect safety or indicate damage.')
  }
  if (twin.isMedicationRelated) {
    reasons.push('Medication-related objects always require a caregiver confirmation.')
  }

  return { required: reasons.length > 0, reasons }
}

export function parseObservationText(
  twin: ObjectTwin,
  text: string,
  identityConfidence = 1,
): ObservationProposal {
  const normalized = text.toLowerCase()
  const definitions = categoryDefinitions[twin.category].stateFields
  const deltas: StateDelta[] = []

  for (const field of definitions) {
    const matchingValue = field.values.find((value) => {
      const terms = value.split(' ')
      return terms.every((term) => normalized.includes(term))
    })
    if (matchingValue && twin.currentState[field.key] !== matchingValue) {
      deltas.push({
        field: field.key,
        before: twin.currentState[field.key],
        after: matchingValue,
        confidence: 0.94,
        evidenceText: `You said: “${text.trim()}”`,
      })
    }
  }

  return {
    twinId: twin.id,
    identityConfidence,
    source: 'user',
    deltas,
    summary: deltas.length
      ? `I noticed ${deltas.map((delta) => `${delta.field} may be ${delta.after}`).join(' and ')}.`
      : 'I heard you, but I did not infer a supported state change.',
  }
}

function summarizeDeltas(deltas: StateDelta[]) {
  return `I noticed ${deltas.map((delta) => `${delta.field} may be ${delta.after}`).join(' and ')}.`
}

export async function inferObservation(
  twin: ObjectTwin,
  text: string,
  identityConfidence = 1,
): Promise<ObservationProposal> {
  const stateFields = categoryDefinitions[twin.category].stateFields
  const allowed = new Map(stateFields.map((field) => [field.key, field.values]))

  try {
    const response = await fetch('/api/observe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text,
        name: twin.name,
        fields: stateFields.map((field) => ({
          key: field.key,
          label: field.label,
          values: field.values,
          current: twin.currentState[field.key] ?? 'unknown',
        })),
      }),
    })
    if (!response.ok) throw new Error('Observation inference failed.')
    const payload = await response.json() as {
      deltas?: { field: string; after: string; confidence?: number }[]
      summary?: string
    }

    const deltas: StateDelta[] = (payload.deltas ?? [])
      .filter((delta) =>
        allowed.get(delta.field)?.includes(delta.after) && twin.currentState[delta.field] !== delta.after,
      )
      .map((delta) => ({
        field: delta.field,
        before: twin.currentState[delta.field],
        after: delta.after,
        confidence: typeof delta.confidence === 'number' ? Math.max(0, Math.min(1, delta.confidence)) : 0.8,
        evidenceText: `You said: “${text.trim()}”`,
      }))

    return {
      twinId: twin.id,
      identityConfidence,
      source: 'user',
      deltas,
      summary: deltas.length
        ? summarizeDeltas(deltas)
        : (payload.summary || 'I heard you, but I did not infer a supported state change.'),
    }
  } catch {
    // Fall back to the deterministic local parser when the model is unavailable.
    return parseObservationText(twin, text, identityConfidence)
  }
}

export function commitProposal(
  twin: ObjectTwin,
  proposal: ObservationProposal,
  confirmedBy: StateEvent['confirmedBy'],
): { twin: ObjectTwin; events: StateEvent[] } {
  const observedAt = new Date().toISOString()
  const events = proposal.deltas.map<StateEvent>((delta) => ({
    id: crypto.randomUUID(),
    twinId: twin.id,
    field: delta.field,
    before: delta.before,
    after: delta.after,
    source: proposal.source,
    confidence: delta.confidence,
    evidenceText: delta.evidenceText,
    observedAt,
    confirmedBy,
  }))

  return {
    twin: {
      ...twin,
      currentState: {
        ...twin.currentState,
        ...Object.fromEntries(proposal.deltas.map((delta) => [delta.field, delta.after])),
      },
      updatedAt: observedAt,
    },
    events,
  }
}

export function revertEvent(twin: ObjectTwin, event: StateEvent): { twin: ObjectTwin; event: StateEvent } {
  const observedAt = new Date().toISOString()
  const revertedValue = event.before ?? 'unknown'
  return {
    twin: {
      ...twin,
      currentState: { ...twin.currentState, [event.field]: revertedValue },
      updatedAt: observedAt,
    },
    event: {
      id: crypto.randomUUID(),
      twinId: twin.id,
      field: event.field,
      before: event.after,
      after: revertedValue,
      source: 'caregiver',
      confidence: 1,
      evidenceText: 'A caregiver corrected the previous observation.',
      observedAt,
      confirmedBy: 'caregiver',
      revertedEventId: event.id,
    },
  }
}

export type GroundedAnswer = {
  text: string
  grounding: 'profile' | 'state' | 'safety' | 'uncertain'
}

export function answerAsTwin(twin: ObjectTwin, question: string): GroundedAnswer {
  const normalized = question.toLowerCase()

  if (
    twin.isMedicationRelated ||
    ['medicine', 'medication', 'dose', 'dosage', 'emergency', 'diagnose'].some((term) =>
      normalized.includes(term),
    )
  ) {
    return {
      text: `I can help you remember what I am, but I can’t make medical or emergency decisions. Please check with your caregiver or clinician.`,
      grounding: 'safety',
    }
  }

  if (['where', 'location', 'moved'].some((term) => normalized.includes(term))) {
    const location = twin.currentState.location ?? twin.usualLocation
    return {
      text: location
        ? `The last confirmed note says I’m ${location}. My usual place is ${twin.usualLocation || 'not recorded yet'}.`
        : `I don’t have a confirmed location yet. You can tell me where I am.`,
      grounding: location ? 'state' : 'uncertain',
    }
  }

  if (['story', 'remember', 'mean', 'who'].some((term) => normalized.includes(term))) {
    return {
      text: twin.story
        ? `You told me this: ${twin.story}`
        : `I don’t have a personal story recorded yet. A caregiver can add one for me.`,
      grounding: twin.story ? 'profile' : 'uncertain',
    }
  }

  if (['use', 'purpose', 'what are you', 'what is this'].some((term) => normalized.includes(term))) {
    return {
      text: `${twin.persona.greeting} ${twin.purpose || twin.description}`.trim(),
      grounding: 'profile',
    }
  }

  if (['state', 'changed', 'condition', 'open', 'closed', 'on', 'off'].some((term) => normalized.includes(term))) {
    const state = Object.entries(twin.currentState)
      .map(([field, value]) => `${field} is ${value}`)
      .join(', ')
    return {
      text: state
        ? `The last confirmed observation says my ${state}.`
        : `I don’t have a confirmed state yet. Show me clearly and tell me what changed.`,
      grounding: state ? 'state' : 'uncertain',
    }
  }

  return {
    text: `I’m ${twin.name}. I only know what you or your caregiver recorded and what the camera has confirmed. Ask what I’m for, where I belong, or what has changed.`,
    grounding: 'profile',
  }
}
