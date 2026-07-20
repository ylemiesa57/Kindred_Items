import {
  objectTwinSchema,
  stateEventSchema,
  type ObjectTwin,
  type StateEvent,
  type StoredWorld,
} from './domain'

const STORAGE_KEY = 'conversational-object-twins.world.v1'

export function loadWorld(fallback: StoredWorld): StoredWorld {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return fallback
    const value = JSON.parse(raw) as { twins?: unknown[]; events?: unknown[] }
    return {
      twins: (value.twins ?? []).map((twin) => objectTwinSchema.parse(twin)),
      events: (value.events ?? []).map((event) => stateEventSchema.parse(event)),
    }
  } catch {
    return fallback
  }
}

export function saveWorld(world: StoredWorld): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(world))
}

export function upsertTwin(twins: ObjectTwin[], next: ObjectTwin): ObjectTwin[] {
  const index = twins.findIndex((twin) => twin.id === next.id)
  if (index === -1) return [next, ...twins]
  return twins.map((twin) => (twin.id === next.id ? next : twin))
}

export function removeTwin(
  world: StoredWorld,
  twinId: string,
): { twins: ObjectTwin[]; events: StateEvent[] } {
  return {
    twins: world.twins.filter((twin) => twin.id !== twinId),
    events: world.events.filter((event) => event.twinId !== twinId),
  }
}

export function exportWorld(world: StoredWorld): void {
  const blob = new Blob([JSON.stringify(world, null, 2)], { type: 'application/json' })
  const href = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = href
  anchor.download = `object-twins-${new Date().toISOString().slice(0, 10)}.json`
  anchor.click()
  URL.revokeObjectURL(href)
}
