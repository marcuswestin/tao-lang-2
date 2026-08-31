import { Errors } from '@shared'
import type { StudioProjectSession } from './StudioProjectSession'
import type { StudioTestRunner } from './StudioTestRunner'

export type StudioProjectOpenRequest = {
  appName?: string
  entryPath?: string
  projectPath: string
}

export type StudioSessionResource = {
  close?: () => Promise<void> | void
  previewUrl?: string
  session: StudioProjectSession
  tests?: StudioTestRunner
}

export type StudioCurrentSession = {
  appName: string
  openedAt: string
  project: string
  sessionId: string
  status: 'closing' | 'open'
}

export type StudioRecentProject = {
  appName: string
  lastOpenedAt: string
  project: string
}

export type StudioSessionListing = {
  current: readonly StudioCurrentSession[]
  recent: readonly StudioRecentProject[]
}

export type StudioSessionManagerEvent = {
  sessionId: string
  type: 'closed' | 'opened'
}

export type StudioSessionManagerOptions = {
  createSessionId?: () => string
  now?: () => Date
  onRecentProjectsChanged?: (recent: readonly StudioRecentProject[]) => void
  openProject?: (request: StudioProjectOpenRequest) => Promise<StudioSessionResource>
  recentProjects?: readonly StudioRecentProject[]
  recentLimit?: number
}

type ManagedSession = {
  closeAttempt?: Promise<boolean>
  openedAt: string
  resource: StudioSessionResource
  sessionId: string
  status: StudioCurrentSession['status']
}

/** Owns the project resources behind Studio windows without exposing filesystem paths as session identity. */
export class StudioSessionManager {
  readonly #createSessionId: () => string
  readonly #current = new Map<string, ManagedSession>()
  readonly #now: () => Date
  readonly #onRecentProjectsChanged?: StudioSessionManagerOptions['onRecentProjectsChanged']
  readonly #openProject?: StudioSessionManagerOptions['openProject']
  readonly #listeners = new Set<(event: StudioSessionManagerEvent) => void>()
  readonly #recent: StudioRecentProject[] = []
  readonly #recentLimit: number

  constructor(options: StudioSessionManagerOptions = {}) {
    this.#createSessionId = options.createSessionId ?? (() => crypto.randomUUID())
    this.#now = options.now ?? (() => new Date())
    this.#onRecentProjectsChanged = options.onRecentProjectsChanged
    this.#openProject = options.openProject
    this.#recentLimit = options.recentLimit ?? 12
    this.#recent.push(...(options.recentProjects ?? []).slice(0, this.#recentLimit))
  }

  add(resource: StudioSessionResource): StudioCurrentSession {
    const sessionId = this.#newSessionId()
    const openedAt = this.#now().toISOString()
    const managed: ManagedSession = { openedAt, resource, sessionId, status: 'open' }
    this.#current.set(sessionId, managed)
    this.#remember(managed)
    this.#emit({ sessionId, type: 'opened' })
    return summary(managed)
  }

  async open(request: StudioProjectOpenRequest): Promise<StudioCurrentSession> {
    if (this.#openProject === undefined) {
      throw new Errors.UserInputError('Opening projects is not available from this Studio server.')
    }
    validateOpenRequest(request)
    return this.add(await this.#openProject(request))
  }

  /** replace opens the new app resource before closing the old one, then rolls back on close failure. */
  async replace(sessionId: string, request: StudioProjectOpenRequest): Promise<StudioCurrentSession> {
    this.require(sessionId)
    const opened = await this.open(request)
    try {
      await this.close(sessionId)
      return opened
    } catch (error) {
      try {
        await this.close(opened.sessionId)
      } catch {
        // Both resources remain manager-owned if cleanup itself fails; closeAll can retry them.
      }
      throw error
    }
  }

  get(sessionId: string): StudioSessionResource | undefined {
    return validSessionId(sessionId) ? this.#current.get(sessionId)?.resource : undefined
  }

  require(sessionId: string): StudioSessionResource {
    const resource = this.get(sessionId)
    if (resource === undefined) {
      throw new Errors.UserInputError('Studio session is not open.')
    }
    return resource
  }

  list(): StudioSessionListing {
    return {
      current: [...this.#current.values()].map(summary),
      recent: [...this.#recent],
    }
  }

  subscribe(listener: (event: StudioSessionManagerEvent) => void): () => void {
    this.#listeners.add(listener)
    return () => this.#listeners.delete(listener)
  }

  async close(sessionId: string): Promise<boolean> {
    const managed = validSessionId(sessionId) ? this.#current.get(sessionId) : undefined
    if (managed === undefined) {
      return false
    }
    if (managed.closeAttempt !== undefined) {
      return await managed.closeAttempt
    }
    managed.status = 'closing'
    const closeAttempt = this.#closeManaged(managed)
    managed.closeAttempt = closeAttempt
    return await closeAttempt
  }

  async #closeManaged(managed: ManagedSession): Promise<boolean> {
    try {
      await managed.resource.close?.()
    } catch (error) {
      managed.status = 'open'
      managed.closeAttempt = undefined
      throw error
    }
    if (this.#current.get(managed.sessionId) === managed) {
      this.#current.delete(managed.sessionId)
      this.#emit({ sessionId: managed.sessionId, type: 'closed' })
    }
    return true
  }

  async closeAll(): Promise<void> {
    const ids = [...this.#current.keys()]
    await Promise.all(ids.map(async sessionId => await this.close(sessionId)))
  }

  #newSessionId(): string {
    for (let attempt = 0; attempt < 100; attempt += 1) {
      const sessionId = this.#createSessionId()
      if (!validSessionId(sessionId)) {
        throw new Error('Studio session ID factories must return a non-empty opaque identifier.')
      }
      if (!this.#current.has(sessionId)) {
        return sessionId
      }
    }
    throw new Error('Could not allocate a unique Studio session ID.')
  }

  #remember(managed: ManagedSession): void {
    const recent: StudioRecentProject = {
      appName: managed.resource.session.appName,
      lastOpenedAt: this.#now().toISOString(),
      project: managed.resource.session.projectRoot,
    }
    const existing = this.#recent.findIndex(item => item.project === recent.project && item.appName === recent.appName)
    if (existing >= 0) {
      this.#recent.splice(existing, 1)
    }
    this.#recent.unshift(recent)
    this.#recent.splice(this.#recentLimit)
    try {
      this.#onRecentProjectsChanged?.([...this.#recent])
    } catch {
      // Recent-project persistence is auxiliary and must not strand a closed resource.
    }
  }

  #emit(event: StudioSessionManagerEvent): void {
    for (const listener of this.#listeners) {
      try {
        listener(event)
      } catch {
        // A shell observer must not interrupt project resource ownership.
      }
    }
  }
}

function summary(managed: ManagedSession): StudioCurrentSession {
  return {
    appName: managed.resource.session.appName,
    openedAt: managed.openedAt,
    project: managed.resource.session.projectRoot,
    sessionId: managed.sessionId,
    status: managed.status,
  }
}

function validSessionId(value: string): boolean {
  return /^[A-Za-z0-9_-]{1,128}$/.test(value)
}

function validateOpenRequest(request: StudioProjectOpenRequest): void {
  if (
    typeof request.projectPath !== 'string'
    || request.projectPath.trim().length === 0
    || (request.appName !== undefined && (typeof request.appName !== 'string' || request.appName.trim().length === 0))
    || (request.entryPath !== undefined
      && (typeof request.entryPath !== 'string' || request.entryPath.trim().length === 0))
  ) {
    throw new Errors.UserInputError('Expected a project path and optional app name and entry path.')
  }
}
