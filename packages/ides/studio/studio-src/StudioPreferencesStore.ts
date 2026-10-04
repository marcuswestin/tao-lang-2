import { FS, Json, Platform, TaoHome } from '@shared'
import { studioPreferenceKeys, type StudioPreferenceValues } from './StudioPreferenceKeys'

const railPanels = ['files', 'components', 'screens', 'tokens', 'data']
const drawerTabs = ['Compile', 'Data', 'Debug', 'Logs', 'Problems', 'Tests']
const lensFacets = ['structure', 'layout', 'behavior', 'data', 'wiring', 'tests', 'comments']

function validPreference(key: string, value: unknown): value is string {
  if (typeof value !== 'string' || value.length > 4096) {
    return false
  }
  try {
    if (key === 'tao-studio:layout-preset:v1') {
      return ['code', 'design', 'draw', 'run'].includes(value)
    }
    if (key === 'tao-studio:rail-panel:v1') {
      return railPanels.includes(value)
    }
    if (key === 'tao-studio:drawer-tab:v1') {
      return drawerTabs.includes(value)
    }
    const parsed: unknown = JSON.parse(value)
    if (!Json.isRecord(parsed)) {
      return false
    }
    if (key === 'tao-studio:pane-sizes:v4') {
      return ['bottom', 'left', 'preview', 'right'].every(name =>
        typeof parsed[name] === 'number' && Number.isFinite(parsed[name]) && parsed[name] >= 0 && parsed[name] <= 10000
      )
    }
    if (key === 'tao-studio.lens') {
      return parsed['version'] === 1 && Array.isArray(parsed['active'])
        && parsed['active'].every((facet: unknown) => typeof facet === 'string' && lensFacets.includes(facet))
    }
    if (key === 'tao-studio:agent-position:v1') {
      return ['left', 'top'].every(name => {
        const coordinate = parsed[name]
        return (typeof coordinate === 'number' && Number.isFinite(coordinate))
          || (typeof coordinate === 'string' && /^-?[0-9]+(?:\.[0-9]+)?px$/u.test(coordinate))
      })
    }
  } catch {
    return false
  }
  return false
}

function validValues(input: unknown): StudioPreferenceValues {
  if (!Json.isRecord(input)) {
    return {}
  }
  const values: StudioPreferenceValues = {}
  for (const key of studioPreferenceKeys) {
    if (validPreference(key, input[key])) {
      values[key] = input[key]
    }
  }
  return values
}

/** A single home file shared by all Studio projects and windows. Each write rereads under a file lock. */
export class StudioPreferencesStore {
  readonly #path: string
  readonly #homeRoot: string
  readonly #lastSequenceByWriter = new Map<string, number>()

  constructor(studioRoot = TaoHome.resolve('studio')) {
    this.#path = FS.resolvePath('prefs.json', studioRoot)
    this.#homeRoot = FS.dirname(studioRoot)
  }

  async read(): Promise<StudioPreferenceValues> {
    try {
      const document: unknown = await FS.readJson(this.#path)
      return Json.isRecord(document) && document['version'] === 1 ? validValues(document['values']) : {}
    } catch {
      return {}
    }
  }

  async save(
    input: unknown,
    importMissing = false,
    writer?: Readonly<{ id: string; sequence: number }>,
  ): Promise<StudioPreferenceValues> {
    const updates = validValues(input)
    await FS.mkdir(FS.dirname(this.#path))
    return await FS.withFileMutationLock(this.#path, this.#homeRoot, async () => {
      const current = await this.read()
      if (writer !== undefined && writer.sequence <= (this.#lastSequenceByWriter.get(writer.id) ?? 0)) {
        return current
      }
      const merged = { ...current }
      for (const key of studioPreferenceKeys) {
        const value = updates[key]
        if (value !== undefined && (!importMissing || current[key] === undefined)) {
          merged[key] = value
        }
      }
      if (Object.keys(merged).length === 0 || JSON.stringify(merged) === JSON.stringify(current)) {
        if (writer !== undefined) {
          this.#lastSequenceByWriter.set(writer.id, writer.sequence)
        }
        return merged
      }
      const temporary = FS.resolvePath(`cache/studio/tmp/${Platform.randomUUID()}.json`, this.#homeRoot)
      try {
        await FS.writeJson(temporary, { version: 1, values: merged })
        await FS.move(temporary, this.#path)
        if (writer !== undefined) {
          this.#lastSequenceByWriter.set(writer.id, writer.sequence)
        }
      } finally {
        await FS.remove(temporary)
      }
      return merged
    }, { lockDirectory: FS.resolvePath('cache/studio/locks', this.#homeRoot) })
  }
}
