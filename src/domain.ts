import { z } from 'zod'

export const objectCategories = ['sentimental', 'appliance', 'belonging'] as const
export type ObjectCategory = (typeof objectCategories)[number]

export const evidenceSources = ['vision', 'user', 'caregiver', 'sensor'] as const
export type EvidenceSource = (typeof evidenceSources)[number]

export type StateFieldDefinition = {
  key: string
  label: string
  values: readonly string[]
  consequential?: boolean
}

export type CategoryDefinition = {
  label: string
  description: string
  icon: string
  stateFields: readonly StateFieldDefinition[]
}

export const categoryDefinitions: Record<ObjectCategory, CategoryDefinition> = {
  sentimental: {
    label: 'Sentimental item',
    description: 'Photos, keepsakes, gifts, and objects connected to a personal story.',
    icon: 'heart',
    stateFields: [
      { key: 'condition', label: 'Condition', values: ['intact', 'worn', 'damaged'], consequential: true },
      { key: 'location', label: 'Location', values: ['usual place', 'moved', 'unknown'] },
      { key: 'display', label: 'Display', values: ['upright', 'face down', 'stored'] },
    ],
  },
  appliance: {
    label: 'Daily-use appliance',
    description: 'Familiar household tools with simple, visible operating states.',
    icon: 'lamp',
    stateFields: [
      { key: 'power', label: 'Power', values: ['off', 'on', 'unknown'], consequential: true },
      { key: 'closure', label: 'Closure', values: ['closed', 'open', 'unknown'], consequential: true },
      { key: 'condition', label: 'Condition', values: ['intact', 'damaged', 'unknown'], consequential: true },
    ],
  },
  belonging: {
    label: 'Personal belonging',
    description: 'Everyday belongings such as glasses, keys, bags, and notebooks.',
    icon: 'key',
    stateFields: [
      { key: 'location', label: 'Location', values: ['usual place', 'moved', 'with me', 'unknown'] },
      { key: 'condition', label: 'Condition', values: ['intact', 'damaged', 'unknown'], consequential: true },
      { key: 'completeness', label: 'Completeness', values: ['complete', 'part missing', 'unknown'], consequential: true },
    ],
  },
}

export const personaSchema = z.object({
  warmth: z.enum(['gentle', 'cheerful', 'matter-of-fact']),
  voiceName: z.string().min(1),
  greeting: z.string().min(1).max(180),
  prohibitedTopics: z.array(z.string()).default([]),
})

export const fingerprintSchema = z.object({
  histogram: z.array(z.number().min(0).max(1)).length(48),
  capturedAt: z.string(),
  thumbnail: z.string().optional(),
})

export const objectTwinSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1).max(60),
  category: z.enum(objectCategories),
  description: z.string().max(240),
  purpose: z.string().max(240),
  story: z.string().max(700),
  usualLocation: z.string().max(120),
  approvedInstructions: z.string().max(700),
  safetyNotes: z.string().max(400),
  isMedicationRelated: z.boolean().default(false),
  persona: personaSchema,
  fingerprints: z.array(fingerprintSchema).min(1),
  currentState: z.record(z.string(), z.string()),
  createdAt: z.string(),
  updatedAt: z.string(),
})

export type ObjectTwin = z.infer<typeof objectTwinSchema>

export const stateEventSchema = z.object({
  id: z.string().uuid(),
  twinId: z.string().uuid(),
  field: z.string(),
  before: z.string().optional(),
  after: z.string(),
  source: z.enum(evidenceSources),
  confidence: z.number().min(0).max(1),
  evidenceText: z.string(),
  observedAt: z.string(),
  confirmedBy: z.enum(['system', 'user', 'caregiver']),
  revertedEventId: z.string().uuid().optional(),
})

export type StateEvent = z.infer<typeof stateEventSchema>

export type StateDelta = {
  field: string
  before?: string
  after: string
  confidence: number
  evidenceText: string
}

export type ObservationProposal = {
  twinId: string
  identityConfidence: number
  source: EvidenceSource
  deltas: StateDelta[]
  summary: string
}

export type ConfirmationDecision = {
  required: boolean
  reasons: string[]
}

export type StoredWorld = {
  twins: ObjectTwin[]
  events: StateEvent[]
}
