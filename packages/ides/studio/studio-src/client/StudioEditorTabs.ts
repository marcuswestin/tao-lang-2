import { Assert } from '@shared/core'

export type StudioEditorTabSnapshot = Readonly<{
  activePath?: string
  paths: readonly string[]
}>

type StudioEditorTabEnvelope = Readonly<{
  activePath?: string
  paths: readonly string[]
  version: 1
}>

export type StudioEditorTabStorage = Pick<Storage, 'getItem' | 'setItem'>

const maximumTabs = 20

/** StudioEditorTabs owns validated device-local tab order independently of editor instances. */
export class StudioEditorTabs {
  readonly #available = new Set<string>()
  readonly #key: string
  readonly #storage: StudioEditorTabStorage
  readonly #onChange?: (snapshot: StudioEditorTabSnapshot) => void
  #activePath: string | undefined
  #paths: string[] = []

  constructor(options: {
    appName: string
    availablePaths: readonly string[]
    project: string
    storage: StudioEditorTabStorage
    initial?: StudioEditorTabSnapshot
    onChange?: (snapshot: StudioEditorTabSnapshot) => void
  }) {
    this.#available = new Set(options.availablePaths.filter(validPath))
    this.#key = storageKey(options.project, options.appName)
    this.#storage = options.storage
    this.#onChange = options.onChange
    const restored = options.initial === undefined
      ? read(this.#storage, this.#key, this.#available)
      : normalize(options.initial, this.#available)
    this.#paths = [...restored.paths]
    this.#activePath = restored.activePath
    if (options.initial === undefined && restored.paths.length > 0) {
      this.#onChange?.(restored)
    }
  }

  snapshot(): StudioEditorTabSnapshot {
    return { ...(this.#activePath === undefined ? {} : { activePath: this.#activePath }), paths: [...this.#paths] }
  }

  evictionCandidate(path: string): string | undefined {
    return !this.#paths.includes(path) && this.#paths.length >= maximumTabs
      ? this.#paths.find(candidate => candidate !== this.#activePath)
      : undefined
  }

  open(path: string): StudioEditorTabSnapshot {
    this.#requireAvailable(path)
    if (!this.#paths.includes(path)) {
      this.#paths = [...this.#paths, path].slice(-maximumTabs)
    }
    this.#activePath = path
    return this.#save()
  }

  activate(path: string): StudioEditorTabSnapshot {
    Assert.input(this.#paths.includes(path), `Studio editor tab is not open: ${path}`)
    this.#activePath = path
    return this.#save()
  }

  close(path: string): StudioEditorTabSnapshot {
    const index = this.#paths.indexOf(path)
    if (index < 0) {
      return this.snapshot()
    }
    this.#paths.splice(index, 1)
    if (this.#activePath === path) {
      this.#activePath = this.#paths[Math.min(index, this.#paths.length - 1)]
    }
    return this.#save()
  }

  rename(previousPath: string, nextPath: string): StudioEditorTabSnapshot {
    Assert.input(validPath(nextPath), `Studio editor tab path is not a valid Tao file: ${nextPath}`)
    const index = this.#paths.indexOf(previousPath)
    if (index < 0) {
      return this.snapshot()
    }
    this.#available.delete(previousPath)
    this.#available.add(nextPath)
    const nextIndex = this.#paths.slice(0, index).filter(path => path !== nextPath).length
    this.#paths = this.#paths.filter(path => path !== previousPath && path !== nextPath)
    this.#paths.splice(nextIndex, 0, nextPath)
    if (this.#activePath === previousPath) {
      this.#activePath = nextPath
    }
    return this.#save()
  }

  reconcile(availablePaths: readonly string[]): StudioEditorTabSnapshot {
    this.#available.clear()
    for (const path of availablePaths.filter(validPath)) {
      this.#available.add(path)
    }
    this.#paths = this.#paths.filter(path => this.#available.has(path))
    if (this.#activePath !== undefined && !this.#paths.includes(this.#activePath)) {
      this.#activePath = this.#paths.at(-1)
    }
    return this.#save()
  }

  #requireAvailable(path: string): void {
    Assert.input(
      validPath(path) && this.#available.has(path),
      `Studio editor tab path is not an available Tao file: ${path}`,
    )
  }

  #save(): StudioEditorTabSnapshot {
    const snapshot = this.snapshot()
    if (this.#onChange === undefined) {
      try {
        this.#storage.setItem(this.#key, JSON.stringify({ ...snapshot, version: 1 } satisfies StudioEditorTabEnvelope))
      } catch {
        // Tab history is auxiliary device-local state and cannot block editing.
      }
    }
    this.#onChange?.(snapshot)
    return snapshot
  }
}

function read(
  storage: StudioEditorTabStorage,
  key: string,
  available: ReadonlySet<string>,
): StudioEditorTabSnapshot {
  try {
    const value = JSON.parse(storage.getItem(key) ?? 'null') as Partial<StudioEditorTabEnvelope> | null
    if (value === null || value.version !== 1 || !Array.isArray(value.paths)) {
      return { paths: [] }
    }
    return normalize(value as StudioEditorTabSnapshot, available)
  } catch {
    return { paths: [] }
  }
}

function normalize(value: StudioEditorTabSnapshot, available: ReadonlySet<string>): StudioEditorTabSnapshot {
  const paths = [
    ...new Set(value.paths.filter(path => typeof path === 'string' && validPath(path) && available.has(path))),
  ]
    .slice(-maximumTabs)
  const activePath = typeof value.activePath === 'string' && paths.includes(value.activePath)
    ? value.activePath
    : paths.at(-1)
  return { ...(activePath === undefined ? {} : { activePath }), paths }
}

function storageKey(project: string, appName: string): string {
  return `tao-studio:editor-tabs:v1:${encodeURIComponent(project)}:${encodeURIComponent(appName)}`
}

function validPath(path: string): boolean {
  return path.length > 0
    && path.length <= 1_024
    && path.endsWith('.tao')
    && !path.startsWith('/')
    && !path.split('/').some(segment => segment === '' || segment === '.' || segment === '..')
}
