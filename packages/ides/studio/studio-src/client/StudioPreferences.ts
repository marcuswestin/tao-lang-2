import { type StudioPreferenceKey, studioPreferenceKeys, type StudioPreferenceValues } from '../StudioPreferenceKeys'
import { StudioRoutes } from '../StudioRoutes'

let values: StudioPreferenceValues = {}
let loaded: Promise<void> | undefined
let pending: StudioPreferenceValues = {}
let inFlight: StudioPreferenceValues = {}
let saving: Promise<void> | undefined
let unloadFlushInstalled = false
const writerId = crypto.randomUUID()
let sequence = 0
const listeners = new Set<() => void>()

function endpoint(): string {
  return StudioRoutes.manager.studioPreferences.path
}

function notify(): void {
  for (const listener of listeners) {
    listener()
  }
}

async function post(update: StudioPreferenceValues, importMissing = false): Promise<StudioPreferenceValues> {
  const response = await fetch(endpoint(), {
    body: JSON.stringify({ importMissing, sequence: ++sequence, values: update, writerId }),
    headers: { 'content-type': 'application/json' },
    keepalive: true,
    method: 'POST',
  })
  if (!response.ok) {
    throw new TypeError('Could not save Studio preferences.')
  }
  const body = await response.json() as { values: StudioPreferenceValues }
  return body.values
}

/** Load the shared home snapshot before the shell mounts, importing browser values only into absent fields. */
async function load(): Promise<void> {
  loaded ??= (async () => {
    const response = await fetch(endpoint(), { cache: 'no-store' })
    if (!response.ok) {
      throw new TypeError('Could not load Studio preferences.')
    }
    const body = await response.json() as { values: StudioPreferenceValues }
    values = { ...body.values, ...pending }
    const legacy: StudioPreferenceValues = {}
    try {
      for (const key of studioPreferenceKeys) {
        if (values[key] === undefined) {
          const old = window.localStorage.getItem(key)
          if (old !== null) {
            legacy[key] = old
          }
        }
      }
    } catch {
      // Disabled browser storage contributes no migration values.
    }
    if (Object.keys(legacy).length > 0) {
      values = { ...await post(legacy, true), ...pending }
    }
    try {
      for (const key of studioPreferenceKeys) {
        window.localStorage.removeItem(key)
      }
    } catch {
      // A disabled browser store does not affect the new home file.
    }
    notify()
  })().catch(() => {
    // Studio remains usable with defaults when its preference file cannot be read.
    notify()
  })
  await loaded
}

/** Serialize saves from this window; the server locks and rereads for saves from other windows. */
function scheduleSave(): void {
  if (saving !== undefined) {
    return
  }
  saving = (async () => {
    await load()
    while (Object.keys(pending).length > 0) {
      const update = pending
      pending = {}
      inFlight = update
      try {
        await post(update)
      } catch {
        // Keep the current UI responsive; the next change retries the latest values.
        pending = { ...update, ...pending }
        break
      } finally {
        inFlight = {}
      }
    }
  })().finally(() => {
    saving = undefined
  })
}

/** A final keepalive write carries both the request in flight and the latest unsent values. */
function flushOnPageHide(): void {
  const update = { ...inFlight, ...pending }
  if (Object.keys(update).length > 0) {
    void post(update).catch(() => {})
  }
}

/** Storage-compatible read/write surface for the existing shell and lens preference helpers. */
export const StudioPreferences = {
  load,
  storage: {
    getItem(key: string): string | null {
      return studioPreferenceKeys.includes(key as StudioPreferenceKey)
        ? values[key as StudioPreferenceKey] ?? null
        : null
    },
    setItem(key: string, value: string): void {
      if (!studioPreferenceKeys.includes(key as StudioPreferenceKey)) {
        return
      }
      const known = key as StudioPreferenceKey
      values[known] = value
      pending[known] = value
      notify()
      if (!unloadFlushInstalled) {
        window.addEventListener('pagehide', flushOnPageHide)
        unloadFlushInstalled = true
      }
      scheduleSave()
    },
  },
  subscribe(listener: () => void): () => void {
    listeners.add(listener)
    return () => listeners.delete(listener)
  },
} as const
