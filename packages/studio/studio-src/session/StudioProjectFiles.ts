import { Assert, FS, Repo, TaoFiles } from '@shared'
import SourceActions from '@source-actions'
import type { StudioCompileDiagnostic, StudioSourceChange } from '../StudioCompileCoordinator'
import type { StudioProjectFile, StudioProjectFileContent } from '../StudioProtocol'

export type StudioFileDraftState = {
  diagnostics: readonly string[]
  dirty: boolean
}

/** StudioProjectFilesIO is the disk seam behind the listing; tests substitute it to count scans and reads. */
export type StudioProjectFilesIO = {
  /** listTaoFiles returns every discoverable `.tao` file under the project root, absolute. */
  listTaoFiles: (projectRoot: string) => Promise<readonly string[]>
  readText: (path: string) => Promise<string>
}

const defaultIO: StudioProjectFilesIO = {
  listTaoFiles: projectRoot =>
    Repo.filesUnder(projectRoot, {
      excludeDirectoryNames: TaoFiles.discoveryExcludeDirectoryNames,
      extensions: ['.tao'],
    }),
  readText: path => FS.readText(path),
}

/**
 * StudioProjectFiles is the session's view of the project's Tao files: which exist, at which source
 * version, and which carry an unsaved draft. The listing is scanned once when the session opens and then
 * kept current by every write the session makes and every change the watcher reports, so `list()` never
 * walks the tree or re-hashes a file. It also owns the path contract: every path a request names is
 * resolved through it before touching disk.
 */
export class StudioProjectFiles {
  readonly #drafts = new Map<string, StudioFileDraftState>()
  /** Project-relative path → source version, for every tracked file. */
  readonly #versions = new Map<string, string>()

  private constructor(
    readonly projectRoot: string,
    private readonly compileDiagnostics: () => readonly StudioCompileDiagnostic[],
    private readonly io: StudioProjectFilesIO,
  ) {}

  static async open(
    projectRoot: string,
    compileDiagnostics: () => readonly StudioCompileDiagnostic[],
    io: StudioProjectFilesIO = defaultIO,
  ): Promise<StudioProjectFiles> {
    const files = new StudioProjectFiles(projectRoot, compileDiagnostics, io)
    await files.rescan()
    return files
  }

  /** rescan rebuilds the listing from disk; open uses it once and nothing else needs to. */
  async rescan(): Promise<void> {
    const next = await this.#scan()
    this.#versions.clear()
    for (const [path, sourceVersion] of next) {
      this.#versions.set(path, sourceVersion)
    }
  }

  /**
   * changesOnDisk reconciles the cached listing with a fresh scan without mutating it. The caller feeds
   * the returned changes through the same compile/write-acknowledgement lane as watcher events, so a
   * missed OS event cannot leave the file tree or compiler permanently stale.
   */
  async changesOnDisk(): Promise<StudioSourceChange[]> {
    const next = await this.#scan()
    const changes: StudioSourceChange[] = []
    for (const [path, sourceVersion] of next) {
      if (this.#versions.get(path) !== sourceVersion) {
        changes.push({ path: FS.resolvePath(path, this.projectRoot), sourceVersion })
      }
    }
    for (const path of this.#versions.keys()) {
      if (!next.has(path)) {
        changes.push({ path: FS.resolvePath(path, this.projectRoot) })
      }
    }
    return changes.toSorted((left, right) => left.path.localeCompare(right.path))
  }

  async #scan(): Promise<Map<string, string>> {
    const paths = await this.io.listTaoFiles(this.projectRoot)
    const entries = await Promise.all(paths.map(async path => {
      try {
        return [FS.relativePath(this.projectRoot, path), await this.#hash(path)] as const
      } catch (error) {
        // A watcher may remove a file after discovery but before this scan reads it.
        if (!await FS.isFile(path)) {
          return undefined
        }
        throw error
      }
    }))
    const versions = new Map<string, string>()
    for (const entry of entries) {
      if (entry !== undefined) {
        versions.set(entry[0], entry[1])
      }
    }
    return versions
  }

  /** list describes every tracked file with its current draft and diagnostic state, in path order. */
  list(): StudioProjectFile[] {
    return [...this.#versions.keys()]
      .sort()
      .map(path => this.projectFile(path, this.#versions.get(path)!))
  }

  /** absolutePaths lists the tracked files for callers that read them directly, such as app discovery. */
  absolutePaths(): string[] {
    return [...this.#versions.keys()].sort().map(path => FS.resolvePath(path, this.projectRoot))
  }

  /** note records a file the session wrote (or created) at the version it wrote. */
  note(path: string, sourceVersion: string): void {
    this.#versions.set(this.#relative(path), sourceVersion)
  }

  /** forget drops a file the session deleted or moved away. */
  forget(path: string): void {
    this.#versions.delete(this.#relative(path))
  }

  /**
   * noteChange folds one watcher change in. The watcher reports the version it hashed; a change without one
   * is a deletion unless the file is still there, in which case it is hashed once here.
   */
  async noteChange(change: StudioSourceChange): Promise<void> {
    if (change.sourceVersion !== undefined) {
      this.note(change.path, change.sourceVersion)
      return
    }
    if (await FS.isFile(change.path)) {
      this.note(change.path, await this.#hash(change.path))
    } else {
      this.forget(change.path)
    }
  }

  /** readFile reads one project file from disk and keeps the listing's version in step with what it read. */
  async readFile(path: string): Promise<StudioProjectFileContent> {
    const resolved = await this.resolveTaoFile(path)
    const content = await FS.readText(resolved)
    const sourceVersion = SourceActions.studioSourceVersion(content)
    const relativePath = FS.relativePath(this.projectRoot, resolved)
    this.#versions.set(relativePath, sourceVersion)
    return { content, ...this.projectFile(relativePath, sourceVersion) }
  }

  projectFile(path: string, sourceVersion: string): StudioProjectFile {
    const draft = this.draftState(path)
    const diagnosticCount = draft.diagnostics.length + this.compileDiagnostics().filter(diagnostic => {
      if (diagnostic.filePath === undefined) {
        return false
      }
      const diagnosticPath = FS.resolvePath(diagnostic.filePath, this.projectRoot)
      return FS.pathIsWithin(diagnosticPath, this.projectRoot)
        && FS.relativePath(this.projectRoot, diagnosticPath) === path
    }).length
    return { diagnosticCount, dirty: draft.dirty, kind: 'file', path, sourceVersion }
  }

  draftState(path: string): StudioFileDraftState {
    return this.#drafts.get(path) ?? { diagnostics: [], dirty: false }
  }

  setDraft(path: string, diagnostics: readonly string[]): void {
    this.#drafts.set(path, { diagnostics, dirty: true })
  }

  clearDraft(path: string): void {
    this.#drafts.delete(path)
  }

  requireMutationAllowed(path: string): void {
    Assert.input(
      !this.draftState(path).dirty,
      `Save or discard the unsaved Studio draft before changing ${path}.`,
    )
  }

  /** resolveTaoFile admits an existing Tao file inside the project and returns its absolute path. */
  async resolveTaoFile(path: string): Promise<string> {
    const resolved = FS.resolvePath(path, this.projectRoot)
    Assert.input(
      FS.pathIsWithin(resolved, this.projectRoot) && FS.extname(resolved) === '.tao' && await FS.isFile(resolved),
      `Studio path is not a Tao file in the project: ${path}`,
    )
    const realPath = await FS.realPath(resolved)
    Assert.input(
      FS.pathIsWithin(realPath, this.projectRoot),
      `Studio path resolves outside the project: ${path}`,
    )
    return resolved
  }

  /** resolveNewTaoFile admits a Tao path that does not exist yet, under folders that stay inside the project. */
  async resolveNewTaoFile(path: string): Promise<string> {
    const resolved = FS.resolvePath(path, this.projectRoot)
    Assert.input(
      FS.pathIsWithin(resolved, this.projectRoot) && FS.extname(resolved) === '.tao',
      `Studio path is not a Tao file in the project: ${path}`,
    )
    Assert.input(
      !await FS.exists(resolved),
      `Studio file already exists: ${FS.relativePath(this.projectRoot, resolved)}`,
    )
    const missingParts = [FS.basename(resolved)]
    let ancestor = FS.dirname(resolved)
    while (!await FS.isDirectory(ancestor)) {
      Assert.input(!await FS.exists(ancestor), `Studio file parent is not a folder: ${path}`)
      const parent = FS.dirname(ancestor)
      Assert.input(parent !== ancestor, `Studio path is not a Tao file in the project: ${path}`)
      missingParts.unshift(FS.basename(ancestor))
      ancestor = parent
    }
    const canonical = FS.resolvePath(missingParts.join('/'), await FS.realPath(ancestor))
    Assert.input(
      FS.pathIsWithin(canonical, this.projectRoot),
      `Studio path resolves outside the project: ${path}`,
    )
    return resolved
  }

  /** resolveTaoWatchPath canonicalizes a watcher path, which may name a file that no longer exists. */
  async resolveTaoWatchPath(path: string): Promise<string> {
    const resolved = FS.resolvePath(path, this.projectRoot)
    Assert.input(FS.extname(resolved) === '.tao', `Studio path is not a Tao file in the project: ${path}`)
    const missingParts = [FS.basename(resolved)]
    let ancestor = FS.dirname(resolved)
    while (!await FS.isDirectory(ancestor)) {
      const parent = FS.dirname(ancestor)
      Assert.input(parent !== ancestor, `Studio path is not a Tao file in the project: ${path}`)
      missingParts.unshift(FS.basename(ancestor))
      ancestor = parent
    }
    const canonical = FS.resolvePath(missingParts.join('/'), await FS.realPath(ancestor))
    Assert.input(
      FS.pathIsWithin(canonical, this.projectRoot),
      `Studio path is not a Tao file in the project: ${path}`,
    )
    if (await FS.isFile(canonical)) {
      const realPath = await FS.realPath(canonical)
      Assert.input(
        FS.pathIsWithin(realPath, this.projectRoot),
        `Studio path resolves outside the project: ${path}`,
      )
    }
    return canonical
  }

  async #hash(path: string): Promise<string> {
    return SourceActions.studioSourceVersion(await this.io.readText(path))
  }

  /** Accepts a project-relative or absolute path; the listing keys on the project-relative form. */
  #relative(path: string): string {
    return FS.relativePath(this.projectRoot, FS.resolvePath(path, this.projectRoot))
  }
}
