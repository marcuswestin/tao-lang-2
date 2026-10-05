import { Errors, FS, Json, Platform, ProjectLocal } from '@shared'
import type { StudioCanvasViewport, StudioSessionAppState } from './StudioProtocol'

type SessionStoreIO = Pick<typeof FS, 'move' | 'readJson' | 'realPath' | 'remove' | 'writeJson'>

type SessionFile = Readonly<{
  apps: Readonly<Record<string, StudioSessionAppState>>
  canvasViewport?: StudioCanvasViewport
  version: 1
}>

const emptySession: SessionFile = { apps: {}, version: 1 }

/** The project's device-local Studio session. Every field update reads and preserves its peers. */
export class StudioCanvasViewportStore {
  #pending: Promise<void> = Promise.resolve()

  /** root is the former viewport directory, used only to migrate a saved viewport once. */
  constructor(readonly root: string, private readonly io: SessionStoreIO = FS) {}

  static normalize(value: unknown): StudioCanvasViewport {
    if (
      !Json.isRecord(value)
      || typeof value['x'] !== 'number' || !Number.isFinite(value['x'])
      || typeof value['y'] !== 'number' || !Number.isFinite(value['y'])
      || typeof value['z'] !== 'number' || !Number.isFinite(value['z'])
    ) {
      Errors.throwUserInput('Expected finite canvas viewport coordinates and zoom.')
    }
    return { x: value['x'], y: value['y'], z: Math.max(0.1, Math.min(4, value['z'])) }
  }

  async load(projectRoot: string): Promise<StudioCanvasViewport | undefined> {
    return (await this.#read(projectRoot)).canvasViewport
  }

  async loadApp(projectRoot: string, appName: string): Promise<StudioSessionAppState> {
    return (await this.#read(projectRoot)).apps[appName] ?? { activatedCellIds: [] }
  }

  save(projectRoot: string, value: StudioCanvasViewport): Promise<void> {
    const viewport = StudioCanvasViewportStore.normalize(value)
    return this.#update(projectRoot, session => ({ ...session, canvasViewport: viewport }))
  }

  saveApp(projectRoot: string, appName: string, patch: Partial<StudioSessionAppState>): Promise<void> {
    return this.#update(projectRoot, session => ({
      ...session,
      apps: {
        ...session.apps,
        [appName]: { activatedCellIds: [], ...session.apps[appName], ...patch },
      },
    }))
  }

  flush(): Promise<void> {
    return this.#pending
  }

  #update(projectRoot: string, change: (current: SessionFile) => SessionFile): Promise<void> {
    const write = async () => {
      const session = change(await this.#readFile(projectRoot))
      await ProjectLocal.prepare(projectRoot)
      const directory = ProjectLocal.localResolve('studio', projectRoot)
      const temporaryDirectory = ProjectLocal.cacheResolve('studio/tmp', projectRoot)
      await FS.mkdir(directory)
      await FS.mkdir(temporaryDirectory)
      const path = ProjectLocal.localResolve('studio/session.json', projectRoot)
      const temporaryPath = FS.resolvePath(`session-${Platform.randomUUID()}.tmp`, temporaryDirectory)
      try {
        await this.io.writeJson(temporaryPath, session)
        await this.io.move(temporaryPath, path)
      } finally {
        await this.io.remove(temporaryPath)
      }
    }
    const saving = this.#pending.then(write, write)
    this.#pending = saving
    return saving
  }

  async #read(projectRoot: string): Promise<SessionFile> {
    await this.#pending.catch(() => {})
    return await this.#readFile(projectRoot)
  }

  async #readFile(projectRoot: string): Promise<SessionFile> {
    try {
      const value = await this.io.readJson(ProjectLocal.localResolve('studio/session.json', projectRoot))
      if (Json.isRecord(value) && value['version'] === 1 && Json.isRecord(value['apps'])) {
        const apps: Record<string, StudioSessionAppState> = {}
        for (const [name, app] of Object.entries(value['apps'])) {
          if (!Json.isRecord(app)) {
            continue
          }
          apps[name] = {
            activatedCellIds: Array.isArray(app['activatedCellIds'])
              ? app['activatedCellIds'].filter((id): id is string => typeof id === 'string')
              : [],
            ...(typeof app['focusedCellId'] === 'string' ? { focusedCellId: app['focusedCellId'] } : {}),
            ...(Json.isRecord(app['editorTabs'])
              ? { editorTabs: app['editorTabs'] as StudioSessionAppState['editorTabs'] }
              : {}),
          }
        }
        const viewport = value['canvasViewport'] === undefined
          ? undefined
          : StudioCanvasViewportStore.normalize(value['canvasViewport'])
        return { apps, ...(viewport === undefined ? {} : { canvasViewport: viewport }), version: 1 }
      }
    } catch {
      // Missing or damaged session state starts with an empty session.
    }
    try {
      const canonical = await this.io.realPath(projectRoot)
      const legacy = await this.io.readJson(FS.resolvePath(`${Platform.sha256Hex(canonical)}.json`, this.root))
      if (Json.isRecord(legacy) && legacy['version'] === 1) {
        return { ...emptySession, canvasViewport: StudioCanvasViewportStore.normalize(legacy['viewport']) }
      }
    } catch {
      // A missing former viewport is normal for a fresh project.
    }
    return emptySession
  }
}
