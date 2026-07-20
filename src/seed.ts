import type { ObjectTwin, StateEvent, StoredWorld } from './domain'

function histogram(seed: number): number[] {
  const values: number[] = []
  for (let channel = 0; channel < 3; channel += 1) {
    const channelValues = Array.from({ length: 16 }, (_, index) =>
      Math.max(0.05, Math.abs(Math.sin(seed + channel * 2.4 + index * 0.71))),
    )
    const total = channelValues.reduce((sum, value) => sum + value, 0)
    values.push(...channelValues.map((value) => value / total))
  }
  return values
}

const createdAt = '2026-07-20T16:00:00.000Z'

export const seedTwins: ObjectTwin[] = [
  {
    id: '20985d4d-33d6-42c2-b7a5-0c22f6bd9fd3',
    name: 'Bluebell',
    category: 'sentimental',
    description: 'A small blue ceramic vase with painted white flowers.',
    purpose: 'I hold a few flowers and remind you of the cottage garden.',
    story: 'Anna gave me to you on your fiftieth birthday after your trip to Cornwall.',
    usualLocation: 'on the living room mantel',
    approvedInstructions: 'Hold me with two hands and keep me away from the edge.',
    safetyNotes: 'Ceramic can break. Ask for help if I am chipped or on the floor.',
    isMedicationRelated: false,
    persona: {
      warmth: 'gentle',
      voiceName: 'Default',
      greeting: 'Hello, I’m Bluebell, your little blue vase.',
      prohibitedTopics: ['medical advice', 'financial advice'],
    },
    fingerprints: [{ histogram: histogram(1.2), capturedAt: createdAt }],
    currentState: { condition: 'intact', location: 'usual place', display: 'upright' },
    createdAt,
    updatedAt: createdAt,
  },
  {
    id: '93c876bf-c6fb-485a-8e73-c255162259d7',
    name: 'Morning Kettle',
    category: 'appliance',
    description: 'A brushed steel electric kettle with a black handle.',
    purpose: 'I boil water for your morning tea.',
    story: 'You chose me because my handle is easy to grip.',
    usualLocation: 'on the kitchen counter beside the tea tin',
    approvedInstructions: 'Make sure I contain water, close my lid, and place me on my base.',
    safetyNotes: 'I may be hot. Do not touch steam or use me if my cable looks damaged.',
    isMedicationRelated: false,
    persona: {
      warmth: 'matter-of-fact',
      voiceName: 'Default',
      greeting: 'I’m your kettle.',
      prohibitedTopics: ['medical advice'],
    },
    fingerprints: [{ histogram: histogram(2.8), capturedAt: createdAt }],
    currentState: { power: 'off', closure: 'closed', condition: 'intact' },
    createdAt,
    updatedAt: createdAt,
  },
  {
    id: '70f50dba-2dd1-4fb3-9329-88d40e30defa',
    name: 'Reading Glasses',
    category: 'belonging',
    description: 'Tortoiseshell reading glasses in a soft green case.',
    purpose: 'I help you read letters and your crossword.',
    story: 'These are the comfortable pair you picked with Maya.',
    usualLocation: 'in the green case on the side table',
    approvedInstructions: 'Open both arms gently and clean the lenses with the soft cloth.',
    safetyNotes: 'Ask a caregiver if the frame or lens is damaged.',
    isMedicationRelated: false,
    persona: {
      warmth: 'cheerful',
      voiceName: 'Default',
      greeting: 'Here I am—your reading glasses.',
      prohibitedTopics: ['medical advice'],
    },
    fingerprints: [{ histogram: histogram(4.7), capturedAt: createdAt }],
    currentState: { location: 'usual place', condition: 'intact', completeness: 'complete' },
    createdAt,
    updatedAt: createdAt,
  },
]

export const seedEvents: StateEvent[] = [
  {
    id: '1b154721-36a9-42a3-9305-da17beb7f82b',
    twinId: seedTwins[0].id,
    field: 'location',
    before: 'moved',
    after: 'usual place',
    source: 'caregiver',
    confidence: 1,
    evidenceText: 'Maya returned Bluebell to the mantel.',
    observedAt: '2026-07-20T16:30:00.000Z',
    confirmedBy: 'caregiver',
  },
]

export const seedWorld: StoredWorld = { twins: seedTwins, events: seedEvents }
