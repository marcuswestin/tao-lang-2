import { Assert, CLI, Errors, FS, Json, Platform, Time } from '@shared'

export const studioSketchCatalogFormatVersion = 1 as const
export const studioSketchCatalogRelativePath = '.tao-project/studio/sketches.jsonc'

type StudioSketchFieldBinding = Readonly<{
  parameter: string
  path: string
  presentation: Readonly<{
    kind: 'image' | 'text'
    label?: Readonly<{
      path: string
      prefix?: string
      suffix?: string
    }>
  }>
}>

export type StudioSketchRect = Readonly<{
  content?: string
  height: number
  id: string
  fieldBinding?: StudioSketchFieldBinding
  kind: string
  width: number
  x: number
  y: number
}>

export type StudioSketchRenderTarget = Readonly<{
  elementName: string
  path: string
  renderId: string
  sourceVersion: string
  studioRectId: string
  view: string
}>

export type StudioSnappedRect = Readonly<{
  rect: StudioSketchRect
  target: StudioSketchRenderTarget
}>

export type StudioSketch = Readonly<{
  height: number
  id: string
  name: string
  project: string
  rectOrder: readonly string[]
  rects: readonly StudioSketchRect[]
  snapped: readonly StudioSnappedRect[]
  view: string
  width: number
  x: number
  y: number
}>

export type StudioSketchCatalogSnapshot = Readonly<{
  formatVersion: typeof studioSketchCatalogFormatVersion
  nextViewNumber: number
  revision: number
  sketches: readonly StudioSketch[]
}>

export type StudioSketchCatalogAction =
  | Readonly<{
    binding: StudioSketchFieldBinding
    kind: 'bind-rect'
    rectId: string
    sketchId: string
  }>
  | Readonly<{
    height: number
    id: string
    kind: 'create-sketch'
    project: string
    rects: readonly StudioSketchRect[]
    width: number
    x?: number
    y?: number
  }>
  | Readonly<{ id: string; kind: 'delete-sketch' }>
  | Readonly<{
    afterRectId?: string
    kind: 'add-rect'
    rect: StudioSketchRect
    sketchId: string
  }>
  | Readonly<{
    kind: 'update-rect'
    rect: StudioSketchRect
    rectId: string
    sketchId: string
  }>
  | Readonly<{
    id: string
    kind: 'duplicate-rect'
    rectId: string
    sketchId: string
    x: number
    y: number
  }>
  | Readonly<{ kind: 'delete-rect'; rectId: string; sketchId: string }>
  | Readonly<{
    kind: 'snap-rects'
    sketchId: string
    targets: readonly StudioSketchRenderTarget[]
  }>
  | Readonly<{
    kind: 'unsnap-rects'
    rectIds: readonly string[]
    sketchId: string
    targets: readonly StudioSketchRenderTarget[]
  }>
  | Readonly<{
    kind: 'refresh-snap-targets'
    sketchId: string
    targets: readonly StudioSketchRenderTarget[]
  }>

export type StudioSketchCatalogRequest = Readonly<{
  action: StudioSketchCatalogAction
  expectedRevision: number
  requestId: string
}>

export type StudioSketchCatalogResult = Readonly<{
  catalog: StudioSketchCatalogSnapshot
  createdSketch?: StudioSketch
  requestId: string
}>

export type StudioSketchCatalogIO = Readonly<{
  move?: (temporaryPath: string, catalogPath: string) => Promise<void>
  writeTemporary?: (temporaryPath: string, content: string) => Promise<void>
}>

export type StudioSketchCatalogTransaction = Readonly<{
  apply(request: StudioSketchCatalogRequest): Promise<StudioSketchCatalogResult>
  read(): Promise<StudioSketchCatalogSnapshot>
  restore(snapshot: StudioSketchCatalogSnapshot, expectedCurrentRevision: number): Promise<void>
}>

type CachedResult = Readonly<{ fingerprint: string; result: StudioSketchCatalogResult }>

const catalogLockPollMs = 10
const catalogLockTimeoutMs = 10_000
let beforeStaleUnlinkForTesting: (() => Promise<void>) | undefined
let afterStaleUnlinkForTesting: ((lockPath: string) => Promise<void>) | undefined

/** A stale catalog proposal is retryable after the client refreshes its snapshot. */
export class StudioSketchCatalogConflictError extends Errors.UserInputError {
  readonly code = 'stale-sketch-catalog'

  constructor(readonly expectedRevision: number, readonly actualRevision: number) {
    super('The Studio sketch catalog changed before this edit was applied.', {
      actualRevision,
      code: 'stale-sketch-catalog',
      expectedRevision,
    })
  }
}

/** StudioSketchCatalog is the sole validating and atomic persistence boundary for free geometry. */
export class StudioSketchCatalog {
  readonly #catalogPath: string
  readonly #io: StudioSketchCatalogIO
  readonly #results = new Map<string, CachedResult>()
  #mutationLane: Promise<void> = Promise.resolve()

  constructor(readonly projectRoot: string, io: StudioSketchCatalogIO = {}) {
    this.#catalogPath = FS.resolvePath(studioSketchCatalogRelativePath, projectRoot)
    this.#io = io
  }

  path(): string {
    return this.#catalogPath
  }

  async read(): Promise<StudioSketchCatalogSnapshot> {
    return this.#mutate(() => this.#withCatalogLock(() => this.#read()))
  }

  transaction<Result>(work: (transaction: StudioSketchCatalogTransaction) => Promise<Result>): Promise<Result> {
    return this.#mutate(() =>
      this.#withCatalogLock(() =>
        work({
          apply: request => this.#apply(request),
          read: () => this.#read(),
          restore: (snapshot, expectedCurrentRevision) => this.#restore(snapshot, expectedCurrentRevision),
        })
      )
    )
  }

  async #read(): Promise<StudioSketchCatalogSnapshot> {
    if (!await FS.exists(this.#catalogPath)) {
      return emptyCatalog()
    }
    Assert.input(
      await FS.isFile(this.#catalogPath),
      `Studio sketch catalog must be a file: ${studioSketchCatalogRelativePath}`,
    )
    return hydrateCatalogTargets(parseCatalog(await FS.readText(this.#catalogPath)), this.projectRoot)
  }

  apply(request: StudioSketchCatalogRequest): Promise<StudioSketchCatalogResult> {
    return this.#mutate(() => this.#withCatalogLock(() => this.#apply(request)))
  }

  async #apply(request: StudioSketchCatalogRequest): Promise<StudioSketchCatalogResult> {
    validateRequest(request)
    const fingerprint = JSON.stringify(request)
    const current = await this.#read()
    const cached = this.#results.get(request.requestId)
    if (cached !== undefined) {
      Assert.input(cached.fingerprint === fingerprint, `Studio sketch request id was reused: ${request.requestId}`)
      if (cached.result.catalog.revision === current.revision) {
        return cached.result
      }
      this.#results.delete(request.requestId)
    }
    if (request.expectedRevision !== current.revision) {
      throw new StudioSketchCatalogConflictError(request.expectedRevision, current.revision)
    }
    const allocationCatalog = request.action.kind === 'create-sketch'
      ? { ...current, nextViewNumber: await nextAvailableViewNumber(this.projectRoot, current) }
      : current
    const changed = applyAction(allocationCatalog, request.action)
    const catalog = validateCatalog({ ...changed.catalog, revision: current.revision + 1 })
    await this.#write(catalog)
    const result: StudioSketchCatalogResult = {
      catalog,
      ...(changed.createdSketch === undefined ? {} : { createdSketch: changed.createdSketch }),
      requestId: request.requestId,
    }
    this.#results.set(request.requestId, { fingerprint, result })
    while (this.#results.size > 100) {
      const oldest = this.#results.keys().next()
      if (oldest.done) {
        break
      }
      this.#results.delete(oldest.value)
    }
    return result
  }

  /**
   * Restores a snapshot only while the transaction revision it replaces is still current.
   *
   * The snapshot keeps its own revision, so rolling a transaction back returns the revision to what
   * it was. That is deliberate: a transaction that ultimately did nothing must not conflict every
   * other client holding the revision it started from. The consequence is that `revision` is an
   * optimistic-concurrency token and not a monotonic version — the same number can later describe
   * different contents — so a reader must never treat a higher revision as the signal that
   * something changed, and must compare the contents it actually cares about.
   */
  restore(snapshot: StudioSketchCatalogSnapshot, expectedCurrentRevision: number): Promise<void> {
    return this.#mutate(() => this.#withCatalogLock(() => this.#restore(snapshot, expectedCurrentRevision)))
  }

  async #restore(snapshot: StudioSketchCatalogSnapshot, expectedCurrentRevision: number): Promise<void> {
    const catalog = validateCatalog(snapshot)
    const current = await this.#read()
    if (current.revision !== expectedCurrentRevision) {
      this.#results.clear()
      throw new StudioSketchCatalogConflictError(expectedCurrentRevision, current.revision)
    }
    await this.#write(catalog)
    // Cached successes describe state that this rollback deliberately removed. A retry must
    // execute against the restored revision rather than replaying a result that is no longer true.
    this.#results.clear()
  }

  async #write(catalog: StudioSketchCatalogSnapshot): Promise<void> {
    const temporaryPath = `${this.#catalogPath}.${crypto.randomUUID()}.tmp`
    try {
      await (this.#io.writeTemporary ?? FS.writeText)(
        temporaryPath,
        serializeCatalog(portableCatalogTargets(catalog, this.projectRoot)),
      )
      await (this.#io.move ?? FS.move)(temporaryPath, this.#catalogPath)
    } finally {
      if (await FS.exists(temporaryPath)) {
        await FS.remove(temporaryPath)
      }
    }
  }

  #mutate<Result>(mutation: () => Promise<Result>): Promise<Result> {
    const result = this.#mutationLane.then(mutation, mutation)
    this.#mutationLane = result.then(() => undefined, () => undefined)
    return result
  }

  #withCatalogLock<Result>(work: () => Promise<Result>): Promise<Result> {
    return withCatalogLock(`${this.#catalogPath}.lock`, work)
  }
}

async function nextAvailableViewNumber(
  projectRoot: string,
  catalog: StudioSketchCatalogSnapshot,
): Promise<number> {
  let next = catalog.nextViewNumber
  const allocated = new Set(catalog.sketches.map(sketch => sketch.view))
  while (
    allocated.has(`View${next}`)
    || await FS.isFile(FS.resolvePath(`@/studio/View${next}.tao`, projectRoot))
  ) {
    next += 1
  }
  return next
}

/**
 * Catalog writes are shared by every Studio process for a project. The symlink is the atomic claim;
 * its owner file makes a crashed writer reclaimable without ever deleting a replacement owner's lock.
 */
async function withCatalogLock<Result>(lockPath: string, work: () => Promise<Result>): Promise<Result> {
  const ownerFile = `${lockPath}.owner-${Platform.randomUUID()}`
  await FS.writeJson(ownerFile, { pid: Platform.runtimeProcess.pid }, { mode: 0o600 })
  const ownerPath = await FS.realPath(ownerFile)
  const deadline = Time.nowMs() + catalogLockTimeoutMs
  try {
    while (true) {
      try {
        await FS.symlink(ownerPath, lockPath)
        break
      } catch (error) {
        if (errorCode(error) !== 'EEXIST') {
          throw error
        }
        const target = await catalogLockTarget(lockPath)
        if (target !== undefined && !await liveCatalogLockOwner(target)) {
          await reclaimStaleCatalogLock(lockPath, target)
        }
        if (Time.nowMs() >= deadline) {
          Errors.throwHostEnvironment('Timed out waiting for another Tao Studio process to update sketches.')
        }
        await Time.sleep(catalogLockPollMs)
      }
    }
    return await work()
  } finally {
    if (await catalogLockTarget(lockPath) === ownerPath) {
      await FS.remove(lockPath)
    }
    await FS.remove(ownerFile)
  }
}

/** Elect exactly one waiter before removing a dead owner so another reclaimer cannot delete its replacement. */
async function reclaimStaleCatalogLock(lockPath: string, staleOwnerPath: string): Promise<void> {
  const staleOwnerKey = FS.basename(staleOwnerPath).replaceAll(/[^A-Za-z0-9_.-]/g, '_')
  const claimPrefix = `${lockPath}.reclaim-${staleOwnerKey}-`
  const claimOwnerFile = `${lockPath}.claim-owner-${Platform.randomUUID()}`
  await FS.writeJson(claimOwnerFile, { pid: Platform.runtimeProcess.pid }, { mode: 0o600 })
  const claimOwnerPath = await FS.realPath(claimOwnerFile)
  let claimPath: string | undefined
  while (claimPath === undefined) {
    const prefixName = FS.basename(claimPrefix)
    const sequences = (await FS.listDir(FS.dirname(lockPath))).flatMap(entry => {
      if (!entry.startsWith(prefixName)) {
        return []
      }
      const sequence = Number(entry.slice(prefixName.length))
      return Number.isSafeInteger(sequence) && sequence >= 0 ? [sequence] : []
    })
    const candidate = `${claimPrefix}${String(Math.max(-1, ...sequences) + 1).padStart(16, '0')}`
    try {
      await FS.symlink(claimOwnerPath, candidate)
      claimPath = candidate
    } catch (error) {
      if (errorCode(error) !== 'EEXIST') {
        throw error
      }
    }
  }
  try {
    // Give simultaneous waiters one poll interval to publish monotonically ordered atomic claims.
    await Time.sleep(catalogLockPollMs)
    const claims = (await FS.listDir(FS.dirname(lockPath)))
      .filter(name => name.startsWith(FS.basename(claimPrefix)))
      .map(name => FS.resolvePath(name, FS.dirname(lockPath)))
      .toSorted()
    const liveClaims: string[] = []
    for (const candidate of claims) {
      const ownerPath = await catalogLockTarget(candidate)
      if (ownerPath !== undefined && await liveCatalogLockOwner(ownerPath)) {
        liveClaims.push(candidate)
      } else {
        await FS.remove(candidate).catch(() => {})
      }
    }
    if (liveClaims[0] === claimPath && await catalogLockTarget(lockPath) === staleOwnerPath) {
      await beforeStaleUnlinkForTesting?.()
      await FS.remove(lockPath)
      await afterStaleUnlinkForTesting?.(lockPath)
      await FS.remove(staleOwnerPath).catch(() => {})
    }
  } finally {
    await FS.remove(claimPath).catch(() => {})
    await FS.remove(claimOwnerFile).catch(() => {})
  }
}

async function liveCatalogLockOwner(ownerPath: string): Promise<boolean> {
  if (!await FS.isFile(ownerPath)) {
    return false
  }
  const owner = await FS.readJson<{ pid?: unknown }>(ownerPath).catch(() => undefined)
  return owner !== undefined && typeof owner.pid === 'number' && Platform.processIsAlive(owner.pid)
}

async function catalogLockTarget(lockPath: string): Promise<string | undefined> {
  const result = await CLI.run('/usr/bin/readlink', { args: [lockPath], stdio: 'pipe' })
  const target = result.stdout.trim()
  return result.error === undefined && result.exitCode === 0 && target !== ''
    ? FS.resolvePath(target, FS.dirname(lockPath))
    : undefined
}

function errorCode(error: unknown): string | undefined {
  return typeof error === 'object' && error !== null && 'code' in error
    ? String((error as { code?: unknown }).code)
    : undefined
}

/** Narrow deterministic seams for stale-owner replacement-race tests. */
export const StudioSketchCatalogTesting = {
  setAfterStaleUnlink(hook: ((lockPath: string) => Promise<void>) | undefined): void {
    afterStaleUnlinkForTesting = hook
  },
  setBeforeStaleUnlink(hook: (() => Promise<void>) | undefined): void {
    beforeStaleUnlinkForTesting = hook
  },
}

function emptyCatalog(): StudioSketchCatalogSnapshot {
  return { formatVersion: studioSketchCatalogFormatVersion, nextViewNumber: 1, revision: 0, sketches: [] }
}

function applyAction(
  catalog: StudioSketchCatalogSnapshot,
  action: StudioSketchCatalogAction,
): Readonly<{ catalog: StudioSketchCatalogSnapshot; createdSketch?: StudioSketch }> {
  if (action.kind === 'create-sketch') {
    const name = `View${catalog.nextViewNumber}`
    const createdSketch: StudioSketch = {
      height: action.height,
      id: action.id,
      name,
      project: projectIdentity(action.project),
      rectOrder: action.rects.map(rect => rect.id),
      rects: action.rects,
      snapped: [],
      view: name,
      width: action.width,
      x: action.x ?? 0,
      y: action.y ?? 0,
    }
    return {
      catalog: {
        ...catalog,
        nextViewNumber: catalog.nextViewNumber + 1,
        sketches: [...catalog.sketches, createdSketch],
      },
      createdSketch,
    }
  }
  if (action.kind === 'delete-sketch') {
    requireSketch(catalog, action.id)
    return { catalog: { ...catalog, sketches: catalog.sketches.filter(sketch => sketch.id !== action.id) } }
  }
  const sketch = requireSketch(catalog, action.sketchId)
  if (action.kind === 'snap-rects') {
    const ids = action.targets.map(target => target.studioRectId)
    requireUnique(ids, 'snap rectangle id')
    const previouslySnapped = new Map(sketch.snapped.map(item => [item.rect.id, item.rect]))
    const newlySnapped = ids.filter(id => !previouslySnapped.has(id))
    Assert.input(newlySnapped.length > 0, 'Studio Snap must include at least one free rectangle.')
    Assert.input(
      sketch.snapped.every(item => ids.includes(item.rect.id)),
      'Studio Snap targets must cover every surviving snapped rectangle exactly once.',
    )
    const newlySnappedIds = new Set(newlySnapped)
    const snapped = action.targets.map(target => {
      const rect = previouslySnapped.get(target.studioRectId)
        ?? sketch.rects[requireRectIndex(sketch, target.studioRectId)]!
      Assert.input(
        target.view === sketch.view,
        `Studio snapped rectangle ${rect.id} must target its sketch view ${sketch.view}.`,
      )
      return { rect, target }
    })
    return {
      catalog: replaceSketch(catalog, {
        ...sketch,
        rects: sketch.rects.filter(rect => !newlySnappedIds.has(rect.id)),
        snapped,
      }),
    }
  }
  if (action.kind === 'unsnap-rects') {
    requireUnique(action.rectIds, 'unsnap rectangle id')
    const selected = new Set(action.rectIds)
    const restored = action.rectIds.map(id => sketch.snapped[requireSnappedRectIndex(sketch, id)]!.rect)
    const targets = action.targets.map(target => [target.studioRectId, target] as const)
    requireUnique(targets.map(([id]) => id), 'unsnap target rectangle id')
    const surviving = sketch.snapped.filter(item => !selected.has(item.rect.id))
    Assert.input(
      targets.length === surviving.length && surviving.every(item => targets.some(([id]) => id === item.rect.id)),
      'Studio Unsnap targets must cover every surviving snapped rectangle exactly once.',
    )
    const survivingRects = new Map(surviving.map(item => [item.rect.id, item.rect]))
    const order = new Map(sketch.rectOrder.map((id, index) => [id, index]))
    const rects = [...sketch.rects, ...restored].toSorted((left, right) => order.get(left.id)! - order.get(right.id)!)
    const snapped = targets.map(([id, target]) => {
      Assert.input(
        target.view === sketch.view,
        `Studio refreshed rectangle ${id} must target its sketch view ${sketch.view}.`,
      )
      return { rect: survivingRects.get(id)!, target }
    })
    return {
      catalog: replaceSketch(catalog, {
        ...sketch,
        rects,
        snapped,
      }),
    }
  }
  if (action.kind === 'refresh-snap-targets') {
    const ids = action.targets.map(target => target.studioRectId)
    requireUnique(ids, 'refreshed snap target rectangle id')
    const expected = sketch.snapped.map(item => item.rect.id)
    Assert.input(
      ids.length === expected.length && expected.every(id => ids.includes(id)),
      'Studio refreshed snap targets must cover every surviving snapped rectangle exactly once.',
    )
    const targets = new Map(action.targets.map(target => [target.studioRectId, target]))
    return {
      catalog: replaceSketch(catalog, {
        ...sketch,
        snapped: sketch.snapped.map(item => {
          const target = targets.get(item.rect.id)!
          Assert.input(
            target.view === sketch.view && target.studioRectId === item.rect.id,
            `Studio refreshed rectangle ${item.rect.id} must target its sketch view ${sketch.view}.`,
          )
          return { ...item, target }
        }),
      }),
    }
  }
  if (action.kind === 'add-rect') {
    const insertion = action.afterRectId === undefined
      ? sketch.rects.length
      : requireRectIndex(sketch, action.afterRectId) + 1
    const rects = [...sketch.rects]
    rects.splice(insertion, 0, action.rect)
    const orderInsertion = action.afterRectId === undefined
      ? sketch.rectOrder.length
      : sketch.rectOrder.indexOf(action.afterRectId) + 1
    const rectOrder = [...sketch.rectOrder]
    rectOrder.splice(orderInsertion, 0, action.rect.id)
    return { catalog: replaceSketch(catalog, { ...sketch, rectOrder, rects }) }
  }
  if (action.kind === 'update-rect') {
    const index = requireRectIndex(sketch, action.rectId)
    Assert.input(action.rect.id === action.rectId, 'A Studio rectangle update cannot change its id.')
    const rects = [...sketch.rects]
    rects[index] = action.rect
    return { catalog: replaceSketch(catalog, { ...sketch, rects }) }
  }
  if (action.kind === 'bind-rect') {
    const freeIndex = sketch.rects.findIndex(rect => rect.id === action.rectId)
    if (freeIndex >= 0) {
      const rects = [...sketch.rects]
      rects[freeIndex] = { ...rects[freeIndex]!, fieldBinding: action.binding }
      return { catalog: replaceSketch(catalog, { ...sketch, rects }) }
    }
    const snappedIndex = requireSnappedRectIndex(sketch, action.rectId)
    const snapped = [...sketch.snapped]
    const item = snapped[snappedIndex]!
    snapped[snappedIndex] = { ...item, rect: { ...item.rect, fieldBinding: action.binding } }
    return { catalog: replaceSketch(catalog, { ...sketch, snapped }) }
  }
  if (action.kind === 'duplicate-rect') {
    const index = requireRectIndex(sketch, action.rectId)
    const source = sketch.rects[index]!
    const rects = [...sketch.rects]
    rects.splice(index + 1, 0, { ...source, id: action.id, x: action.x, y: action.y })
    const rectOrder = [...sketch.rectOrder]
    rectOrder.splice(sketch.rectOrder.indexOf(action.rectId) + 1, 0, action.id)
    return { catalog: replaceSketch(catalog, { ...sketch, rectOrder, rects }) }
  }
  const index = requireRectIndex(sketch, action.rectId)
  const rects = [...sketch.rects]
  rects.splice(index, 1)
  return {
    catalog: replaceSketch(catalog, {
      ...sketch,
      rectOrder: sketch.rectOrder.filter(id => id !== action.rectId),
      rects,
    }),
  }
}

function replaceSketch(catalog: StudioSketchCatalogSnapshot, replacement: StudioSketch): StudioSketchCatalogSnapshot {
  return {
    ...catalog,
    sketches: catalog.sketches.map(sketch => sketch.id === replacement.id ? replacement : sketch),
  }
}

function requireSketch(catalog: StudioSketchCatalogSnapshot, id: string): StudioSketch {
  const sketch = catalog.sketches.find(candidate => candidate.id === id)
  Assert.input(sketch, `Studio sketch does not exist: ${id}`)
  return sketch
}

function requireRectIndex(sketch: StudioSketch, id: string): number {
  const index = sketch.rects.findIndex(rect => rect.id === id)
  Assert.input(index >= 0, `Studio rectangle does not exist: ${id}`)
  return index
}

function requireSnappedRectIndex(sketch: StudioSketch, id: string): number {
  const index = sketch.snapped.findIndex(snapped => snapped.rect.id === id)
  Assert.input(index >= 0, `Studio snapped rectangle does not exist: ${id}`)
  return index
}

function validateRequest(request: StudioSketchCatalogRequest): void {
  Assert.input(Json.isRecord(request), 'Studio sketch request must be an object.')
  requireOnlyKeys(request, ['action', 'expectedRevision', 'requestId'], 'request')
  requireNonEmptyString(request.requestId, 'requestId')
  requireNonNegativeInteger(request.expectedRevision, 'expectedRevision')
  Assert.input(Json.isRecord(request.action), 'Studio sketch action must be an object.')
  validateAction(request.action)
}

function validateAction(action: Record<string, unknown>): void {
  if (action['kind'] === 'create-sketch') {
    requireOnlyKeys(action, ['height', 'id', 'kind', 'project', 'rects', 'width', 'x', 'y'], 'create-sketch action')
    requireNonEmptyString(action['id'], 'create-sketch.id')
    requireNonEmptyString(action['project'], 'create-sketch.project')
    requirePositiveFinite(action['width'], 'create-sketch.width')
    requirePositiveFinite(action['height'], 'create-sketch.height')
    if (action['x'] !== undefined) {
      requireNonNegativeFinite(action['x'], 'create-sketch.x')
    }
    if (action['y'] !== undefined) {
      requireNonNegativeFinite(action['y'], 'create-sketch.y')
    }
    Assert.input(Array.isArray(action['rects']), 'Studio sketch create-sketch.rects must be an array.')
    action['rects'].forEach((rect, index) => validateRect(rect, `create-sketch.rects[${index}]`))
    return
  }
  if (action['kind'] === 'delete-sketch') {
    requireOnlyKeys(action, ['id', 'kind'], 'delete-sketch action')
    requireNonEmptyString(action['id'], 'delete-sketch.id')
    return
  }
  if (action['kind'] === 'add-rect') {
    requireOnlyKeys(action, ['afterRectId', 'kind', 'rect', 'sketchId'], 'add-rect action')
    requireNonEmptyString(action['sketchId'], 'add-rect.sketchId')
    if (action['afterRectId'] !== undefined) {
      requireNonEmptyString(action['afterRectId'], 'add-rect.afterRectId')
    }
    validateRect(action['rect'], 'add-rect.rect')
    return
  }
  if (action['kind'] === 'update-rect') {
    requireOnlyKeys(action, ['kind', 'rect', 'rectId', 'sketchId'], 'update-rect action')
    requireNonEmptyString(action['sketchId'], 'update-rect.sketchId')
    requireNonEmptyString(action['rectId'], 'update-rect.rectId')
    validateRect(action['rect'], 'update-rect.rect')
    return
  }
  if (action['kind'] === 'bind-rect') {
    requireOnlyKeys(action, ['binding', 'kind', 'rectId', 'sketchId'], 'bind-rect action')
    requireNonEmptyString(action['sketchId'], 'bind-rect.sketchId')
    requireNonEmptyString(action['rectId'], 'bind-rect.rectId')
    validateFieldBinding(action['binding'], 'bind-rect.binding')
    return
  }
  if (action['kind'] === 'duplicate-rect') {
    requireOnlyKeys(action, ['id', 'kind', 'rectId', 'sketchId', 'x', 'y'], 'duplicate-rect action')
    requireNonEmptyString(action['sketchId'], 'duplicate-rect.sketchId')
    requireNonEmptyString(action['rectId'], 'duplicate-rect.rectId')
    requireNonEmptyString(action['id'], 'duplicate-rect.id')
    requireNonNegativeFinite(action['x'], 'duplicate-rect.x')
    requireNonNegativeFinite(action['y'], 'duplicate-rect.y')
    return
  }
  if (action['kind'] === 'delete-rect') {
    requireOnlyKeys(action, ['kind', 'rectId', 'sketchId'], 'delete-rect action')
    requireNonEmptyString(action['sketchId'], 'delete-rect.sketchId')
    requireNonEmptyString(action['rectId'], 'delete-rect.rectId')
    return
  }
  if (action['kind'] === 'snap-rects') {
    requireOnlyKeys(action, ['kind', 'sketchId', 'targets'], 'snap-rects action')
    requireNonEmptyString(action['sketchId'], 'snap-rects.sketchId')
    Assert.input(Array.isArray(action['targets']), 'Studio sketch snap-rects.targets must be an array.')
    Assert.input(action['targets'].length > 0, 'Studio sketch snap-rects.targets must not be empty.')
    action['targets'].forEach((target, index) => validateRenderTarget(target, `snap-rects.targets[${index}]`))
    return
  }
  if (action['kind'] === 'unsnap-rects') {
    requireOnlyKeys(action, ['kind', 'rectIds', 'sketchId', 'targets'], 'unsnap-rects action')
    requireNonEmptyString(action['sketchId'], 'unsnap-rects.sketchId')
    Assert.input(Array.isArray(action['rectIds']), 'Studio sketch unsnap-rects.rectIds must be an array.')
    Assert.input(action['rectIds'].length > 0, 'Studio sketch unsnap-rects.rectIds must not be empty.')
    action['rectIds'].forEach((id, index) => requireNonEmptyString(id, `unsnap-rects.rectIds[${index}]`))
    Assert.input(Array.isArray(action['targets']), 'Studio sketch unsnap-rects.targets must be an array.')
    action['targets'].forEach((target, index) => validateRenderTarget(target, `unsnap-rects.targets[${index}]`))
    return
  }
  if (action['kind'] === 'refresh-snap-targets') {
    requireOnlyKeys(action, ['kind', 'sketchId', 'targets'], 'refresh-snap-targets action')
    requireNonEmptyString(action['sketchId'], 'refresh-snap-targets.sketchId')
    Assert.input(Array.isArray(action['targets']), 'Studio sketch refresh-snap-targets.targets must be an array.')
    action['targets'].forEach((target, index) => validateRenderTarget(target, `refresh-snap-targets.targets[${index}]`))
    return
  }
  Errors.throwUserInput(`Unsupported Studio sketch action: ${String(action['kind'])}`)
}

function parseCatalog(content: string): StudioSketchCatalogSnapshot {
  let parsed: unknown
  try {
    parsed = JSON.parse(stripJsonCommentsAndTrailingCommas(content))
  } catch {
    Errors.throwUserInput(`Studio sketch catalog is malformed JSONC: ${studioSketchCatalogRelativePath}`)
  }
  Assert.input(Json.isRecord(parsed), 'Studio sketch catalog must contain an object.')
  return validateCatalog(parsed)
}

/** Runtime callers use absolute render locators; the committed catalog uses project-relative ones. */
function hydrateCatalogTargets(
  catalog: StudioSketchCatalogSnapshot,
  projectRoot: string,
): StudioSketchCatalogSnapshot {
  return mapCatalogTargets(catalog, target => {
    const parsed = renderIdParts(target.renderId)
    if (parsed === undefined || parsed.path.startsWith('/')) {
      return target
    }
    return { ...target, renderId: `${FS.resolvePath(parsed.path, projectRoot)}:${parsed.start}:${parsed.end}` }
  })
}

function portableCatalogTargets(
  catalog: StudioSketchCatalogSnapshot,
  projectRoot: string,
): StudioSketchCatalogSnapshot {
  return mapCatalogTargets(catalog, target => {
    const path = portableTargetPath(target.path, projectRoot)
    const parsed = renderIdParts(target.renderId)
    return {
      ...target,
      path,
      ...(parsed === undefined ? {} : { renderId: `${path}:${parsed.start}:${parsed.end}` }),
    }
  })
}

function mapCatalogTargets(
  catalog: StudioSketchCatalogSnapshot,
  map: (target: StudioSketchRenderTarget) => StudioSketchRenderTarget,
): StudioSketchCatalogSnapshot {
  return {
    ...catalog,
    sketches: catalog.sketches.map(sketch => ({
      ...sketch,
      snapped: sketch.snapped.map(item => ({ ...item, target: map(item.target) })),
    })),
  }
}

function portableTargetPath(path: string, projectRoot: string): string {
  if (!path.startsWith('/')) {
    return path
  }
  if (FS.pathIsWithin(path, projectRoot)) {
    return FS.relativePath(projectRoot, path)
  }
  for (const marker of ['/@/', '/.tao-project/']) {
    const index = path.lastIndexOf(marker)
    if (index >= 0) {
      return path.slice(index + 1)
    }
  }
  return FS.basename(path)
}

function renderIdParts(renderId: string): Readonly<{ end: number; path: string; start: number }> | undefined {
  const endSeparator = renderId.lastIndexOf(':')
  const startSeparator = renderId.lastIndexOf(':', endSeparator - 1)
  const start = Number(renderId.slice(startSeparator + 1, endSeparator))
  const end = Number(renderId.slice(endSeparator + 1))
  const path = renderId.slice(0, startSeparator)
  return path !== '' && Number.isInteger(start) && Number.isInteger(end) && start >= 0 && end >= start
    ? { end, path, start }
    : undefined
}

function validateCatalog(value: unknown): StudioSketchCatalogSnapshot {
  Assert.input(Json.isRecord(value), 'Studio sketch catalog must contain an object.')
  requireOnlyKeys(value, ['formatVersion', 'nextViewNumber', 'revision', 'sketches'], 'catalog')
  Assert.input(
    value['formatVersion'] === studioSketchCatalogFormatVersion,
    `Studio sketch catalog formatVersion must be ${studioSketchCatalogFormatVersion}.`,
  )
  const nextViewNumber = requirePositiveInteger(value['nextViewNumber'], 'nextViewNumber')
  const revision = requireNonNegativeInteger(value['revision'], 'revision')
  Assert.input(Array.isArray(value['sketches']), 'Studio sketch catalog sketches must be an array.')
  const sketches = value['sketches'].map((sketch, index) => validateSketch(sketch, index))
  requireUnique(sketches.map(sketch => sketch.id), 'sketch id')
  requireUnique(sketches.map(sketch => sketch.name), 'sketch name')
  requireUnique(sketches.map(sketch => sketch.view), 'sketch view')
  requireUnique(
    sketches.flatMap(sketch => [...sketch.rects.map(rect => rect.id), ...sketch.snapped.map(item => item.rect.id)]),
    'rectangle id',
  )
  const allocatedNumbers = sketches.map(sketch => Number(sketch.view.slice('View'.length)))
  const highestAllocated = Math.max(0, ...allocatedNumbers)
  Assert.input(
    nextViewNumber > highestAllocated,
    'Studio sketch catalog nextViewNumber must be greater than every allocated View number.',
  )
  return { formatVersion: studioSketchCatalogFormatVersion, nextViewNumber, revision, sketches }
}

function validateSketch(value: unknown, index: number): StudioSketch {
  Assert.input(Json.isRecord(value), `Studio sketch at index ${index} must be an object.`)
  requireOnlyKeys(
    value,
    ['height', 'id', 'name', 'project', 'rectOrder', 'rects', 'snapped', 'view', 'width', 'x', 'y'],
    `sketch at index ${index}`,
  )
  const fields = validateSketchFields(value, index)
  Assert.input(Array.isArray(value['rectOrder']), `Studio sketch ${fields.id} rectOrder must be an array.`)
  const rectOrder = value['rectOrder'].map((id, orderIndex) =>
    requireNonEmptyString(id, `${fields.id}.rectOrder[${orderIndex}]`)
  )
  requireUnique(rectOrder, `rectangle order in ${fields.id}`)
  Assert.input(Array.isArray(value['snapped']), `Studio sketch ${fields.id} snapped must be an array.`)
  const snapped = value['snapped'].map((item, itemIndex) =>
    validateSnappedRect(item, `${fields.id}.snapped[${itemIndex}]`)
  )
  const memberIds = [...fields.rects.map(rect => rect.id), ...snapped.map(item => item.rect.id)]
  Assert.input(
    rectOrder.length === memberIds.length && memberIds.every(id => rectOrder.includes(id)),
    `Studio sketch ${fields.id} rectOrder must contain every free and snapped rectangle exactly once.`,
  )
  return {
    height: fields.height,
    id: fields.id,
    name: fields.name,
    project: fields.project,
    rectOrder,
    rects: fields.rects,
    snapped,
    view: fields.view,
    width: fields.width,
    x: fields.x,
    y: fields.y,
  }
}

function validateSketchFields(
  value: Record<string, unknown>,
  index: number,
): Omit<StudioSketch, 'rectOrder' | 'snapped'> {
  const id = requireNonEmptyString(value['id'], `sketches[${index}].id`)
  const name = requireNonEmptyString(value['name'], `sketches[${index}].name`)
  const project = projectIdentity(requireNonEmptyString(value['project'], `sketches[${index}].project`))
  const view = requireGeneratedViewName(value['view'], `sketches[${index}].view`)
  const width = requirePositiveFinite(value['width'], `sketches[${index}].width`)
  const height = requirePositiveFinite(value['height'], `sketches[${index}].height`)
  const x = value['x'] === undefined ? 0 : requireNonNegativeFinite(value['x'], `sketches[${index}].x`)
  const y = value['y'] === undefined ? 0 : requireNonNegativeFinite(value['y'], `sketches[${index}].y`)
  Assert.input(Array.isArray(value['rects']), `Studio sketch ${id} rects must be an array.`)
  const rects = value['rects'].map((rect, rectIndex) => validateRect(rect, `${id}.rects[${rectIndex}]`))
  return { height, id, name, project, rects, view, width, x, y }
}

/**
 * projectIdentity keeps the catalog portable. The file already lives inside the project it describes,
 * so the only thing worth recording is which project that is -- and an absolute host path is not it:
 * committed, it names one developer's machine and matches nowhere else the repository is checked out.
 */
function projectIdentity(project: string): string {
  const trimmed = project.replace(/[/\\]+$/u, '')
  const separator = Math.max(trimmed.lastIndexOf('/'), trimmed.lastIndexOf('\\'))
  const name = trimmed.slice(separator + 1)
  return name === '' ? trimmed : name
}

function validateSnappedRect(value: unknown, field: string): StudioSnappedRect {
  Assert.input(Json.isRecord(value), `Studio snapped rectangle ${field} must be an object.`)
  requireOnlyKeys(value, ['rect', 'target'], field)
  const rect = validateRect(value['rect'], `${field}.rect`)
  const target = validateRenderTarget(value['target'], `${field}.target`)
  Assert.input(
    target.studioRectId === rect.id,
    `Studio snapped rectangle ${field}.target.studioRectId must match its rectangle id.`,
  )
  return { rect, target }
}

function validateRenderTarget(value: unknown, field: string): StudioSketchRenderTarget {
  Assert.input(Json.isRecord(value), `Studio sketch render target ${field} must be an object.`)
  requireOnlyKeys(
    value,
    ['elementName', 'path', 'renderId', 'sourceVersion', 'studioRectId', 'view'],
    field,
  )
  return {
    elementName: requireTaoElementName(value['elementName'], `${field}.elementName`),
    path: requireNonEmptyString(value['path'], `${field}.path`),
    renderId: requireNonEmptyString(value['renderId'], `${field}.renderId`),
    sourceVersion: requireNonEmptyString(value['sourceVersion'], `${field}.sourceVersion`),
    studioRectId: requireNonEmptyString(value['studioRectId'], `${field}.studioRectId`),
    view: requireGeneratedViewName(value['view'], `${field}.view`),
  }
}

function validateRect(value: unknown, field: string): StudioSketchRect {
  Assert.input(Json.isRecord(value), `Studio rectangle ${field} must be an object.`)
  requireOnlyKeys(value, ['content', 'fieldBinding', 'height', 'id', 'kind', 'width', 'x', 'y'], field)
  const id = requireNonEmptyString(value['id'], `${field}.id`)
  const x = requireNonNegativeFinite(value['x'], `${field}.x`)
  const y = requireNonNegativeFinite(value['y'], `${field}.y`)
  const width = requirePositiveFinite(value['width'], `${field}.width`)
  const height = requirePositiveFinite(value['height'], `${field}.height`)
  const kind = requireTaoElementName(value['kind'], `${field}.kind`)
  const content = optionalString(value, 'content', field)
  const fieldBinding = value['fieldBinding'] === undefined
    ? undefined
    : validateFieldBinding(value['fieldBinding'], `${field}.fieldBinding`)
  return {
    ...(fieldBinding === undefined ? {} : { fieldBinding }),
    ...(content === undefined ? {} : { content }),
    height,
    id,
    kind,
    width,
    x,
    y,
  }
}

function validateFieldBinding(value: unknown, field: string): StudioSketchFieldBinding {
  Assert.input(Json.isRecord(value), `Studio sketch ${field} must be an object.`)
  requireOnlyKeys(value, ['parameter', 'path', 'presentation'], field)
  const parameter = requireIdentifier(value['parameter'], `${field}.parameter`)
  const path = requirePath(value['path'], `${field}.path`)
  const presentationValue = value['presentation']
  Assert.input(Json.isRecord(presentationValue), `Studio sketch ${field}.presentation must be an object.`)
  requireOnlyKeys(presentationValue, ['kind', 'label'], `${field}.presentation`)
  Assert.input(
    presentationValue['kind'] === 'text' || presentationValue['kind'] === 'image',
    `Studio sketch ${field}.presentation.kind must be text or image.`,
  )
  const labelValue = presentationValue['label']
  let label: StudioSketchFieldBinding['presentation']['label']
  if (labelValue !== undefined) {
    Assert.input(Json.isRecord(labelValue), `Studio sketch ${field}.presentation.label must be an object.`)
    requireOnlyKeys(labelValue, ['path', 'prefix', 'suffix'], `${field}.presentation.label`)
    label = {
      path: requirePath(labelValue['path'], `${field}.presentation.label.path`),
      ...(labelValue['prefix'] === undefined
        ? {}
        : { prefix: requireNonEmptyString(labelValue['prefix'], `${field}.presentation.label.prefix`) }),
      ...(labelValue['suffix'] === undefined
        ? {}
        : { suffix: requireNonEmptyString(labelValue['suffix'], `${field}.presentation.label.suffix`) }),
    }
  }
  return {
    parameter,
    path,
    presentation: {
      kind: presentationValue['kind'],
      ...(label === undefined ? {} : { label }),
    },
  }
}

function requireIdentifier(value: unknown, field: string): string {
  const identifier = requireNonEmptyString(value, field)
  Assert.input(/^[A-Za-z_][A-Za-z0-9_]*$/.test(identifier), `Studio sketch ${field} must be an identifier.`)
  return identifier
}

function requirePath(value: unknown, field: string): string {
  const path = requireNonEmptyString(value, field)
  Assert.input(
    path.split('.').every(segment => /^[A-Za-z_][A-Za-z0-9_]*$/.test(segment)),
    `Studio sketch ${field} must be a nonempty identifier path.`,
  )
  return path
}

function serializeCatalog(catalog: StudioSketchCatalogSnapshot): string {
  return `${JSON.stringify(catalog, null, 2)}\n`
}

function requireOnlyKeys(value: Record<string, unknown>, allowed: readonly string[], label: string): void {
  const unexpected = Object.keys(value).filter(key => !allowed.includes(key))
  Assert.input(unexpected.length === 0, `Studio sketch ${label} has unsupported fields: ${unexpected.join(', ')}`)
}

function requireUnique(values: readonly string[], label: string): void {
  const seen = new Set<string>()
  for (const value of values) {
    Assert.input(!seen.has(value), `Studio sketch catalog has duplicate ${label}: ${value}`)
    seen.add(value)
  }
}

function optionalString(value: Record<string, unknown>, key: string, field: string): string | undefined {
  const candidate = value[key]
  Assert.input(
    candidate === undefined || typeof candidate === 'string',
    `Studio rectangle ${field}.${key} must be a string.`,
  )
  return candidate
}

function requireNonEmptyString(value: unknown, field: string): string {
  Assert.input(typeof value === 'string' && value.trim() !== '', `Studio sketch ${field} must be a nonempty string.`)
  return value
}

function requireTaoElementName(value: unknown, field: string): string {
  Assert.input(
    typeof value === 'string' && /^[A-Z][A-Za-z0-9_]*$/.test(value),
    `Studio sketch ${field} must be a Tao element name.`,
  )
  return value
}

function requireGeneratedViewName(value: unknown, field: string): string {
  Assert.input(
    typeof value === 'string' && /^View[1-9][0-9]*$/.test(value),
    `Studio sketch ${field} must be a generated View number.`,
  )
  return value
}

function requireNonNegativeInteger(value: unknown, field: string): number {
  Assert.input(
    Number.isSafeInteger(value) && Number(value) >= 0,
    `Studio sketch ${field} must be a nonnegative integer.`,
  )
  return Number(value)
}

function requirePositiveInteger(value: unknown, field: string): number {
  Assert.input(Number.isSafeInteger(value) && Number(value) > 0, `Studio sketch ${field} must be a positive integer.`)
  return Number(value)
}

function requireNonNegativeFinite(value: unknown, field: string): number {
  Assert.input(
    typeof value === 'number' && Number.isFinite(value) && value >= 0,
    `Studio sketch ${field} must be nonnegative.`,
  )
  return value
}

function requirePositiveFinite(value: unknown, field: string): number {
  Assert.input(
    typeof value === 'number' && Number.isFinite(value) && value > 0,
    `Studio sketch ${field} must be positive.`,
  )
  return value
}

/** Removes JSONC comments and commas immediately before a closing object or array token. */
function stripJsonCommentsAndTrailingCommas(content: string): string {
  let stripped = ''
  let inString = false
  let escaped = false
  let index = 0
  while (index < content.length) {
    const character = content[index]!
    const next = content[index + 1]
    if (inString) {
      stripped += character
      if (escaped) {
        escaped = false
      } else if (character === '\\') {
        escaped = true
      } else if (character === '"') {
        inString = false
      }
      index += 1
      continue
    }
    if (character === '"') {
      inString = true
      stripped += character
      index += 1
      continue
    }
    if (character === '/' && next === '/') {
      index += 2
      while (index < content.length && content[index] !== '\n') {
        stripped += ' '
        index += 1
      }
      continue
    }
    if (character === '/' && next === '*') {
      index += 2
      let closed = false
      while (index < content.length) {
        if (content[index] === '*' && content[index + 1] === '/') {
          index += 2
          closed = true
          break
        }
        stripped += content[index] === '\n' ? '\n' : ' '
        index += 1
      }
      Assert.input(closed, `Studio sketch catalog is malformed JSONC: ${studioSketchCatalogRelativePath}`)
      continue
    }
    stripped += character
    index += 1
  }

  let normalized = ''
  inString = false
  escaped = false
  for (let cursor = 0; cursor < stripped.length; cursor += 1) {
    const character = stripped[cursor]!
    if (inString) {
      normalized += character
      if (escaped) {
        escaped = false
      } else if (character === '\\') {
        escaped = true
      } else if (character === '"') {
        inString = false
      }
      continue
    }
    if (character === '"') {
      inString = true
      normalized += character
      continue
    }
    if (character === ',') {
      let lookahead = cursor + 1
      while (lookahead < stripped.length && /\s/.test(stripped[lookahead]!)) {
        lookahead += 1
      }
      if (stripped[lookahead] === '}' || stripped[lookahead] === ']') {
        continue
      }
    }
    normalized += character
  }
  return normalized
}
