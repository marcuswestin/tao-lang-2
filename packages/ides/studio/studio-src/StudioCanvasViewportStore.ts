import { Errors, FS, Json, Platform } from '@shared'
import type { StudioCanvasViewport } from './StudioProtocol'

type ViewportStoreIO = Pick<typeof FS, 'move' | 'readJson' | 'realPath' | 'remove' | 'writeJson'>

/** Device-local canvas state, keyed by the canonical project path rather than the server's port. */
export class StudioCanvasViewportStore {
  #pending: Promise<void> = Promise.resolve()

  constructor(readonly root: string, private readonly io: ViewportStoreIO = FS) {}

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
    await this.#pending.catch(() => {})
    try {
      const value = await this.io.readJson(await this.#path(projectRoot))
      if (!Json.isRecord(value) || value['version'] !== 1) {
        return undefined
      }
      return StudioCanvasViewportStore.normalize(value['viewport'])
    } catch {
      // Missing, corrupt, or future-version preferences start with the default viewport.
      return undefined
    }
  }

  save(projectRoot: string, value: StudioCanvasViewport): Promise<void> {
    const viewport = StudioCanvasViewportStore.normalize(value)
    const write = async () => {
      const path = await this.#path(projectRoot)
      const temporaryPath = `${path}.${Platform.randomUUID()}.tmp`
      try {
        await this.io.writeJson(temporaryPath, { version: 1, viewport })
        await this.io.move(temporaryPath, path)
      } finally {
        await this.io.remove(temporaryPath)
      }
    }
    const saving = this.#pending.then(write, write)
    this.#pending = saving
    return saving
  }

  flush(): Promise<void> {
    return this.#pending
  }

  async #path(projectRoot: string): Promise<string> {
    const canonical = await this.io.realPath(projectRoot)
    return FS.resolvePath(`${Platform.sha256Hex(canonical)}.json`, this.root)
  }
}
