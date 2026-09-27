import { Workspace } from '@compiler/workspace'
import type { EntityGenerationDeclaration } from '@generation'
import { Assert, Errors, FS, Json, Switch } from '@shared'
import SourceActions from '@source-actions'
import type { StudioProjectFiles } from './session/StudioProjectFiles'
import type { StudioCompileCompletion, StudioWrite } from './StudioCompileCoordinator'
import { StudioFeedBrowser } from './StudioFeedBrowser'
import { StudioFeedDraft } from './StudioFeedDraft'
import { StudioFeedLoopSource } from './StudioFeedLoopSource'
import type {
  StudioFeedActionRequest,
  StudioFeedBrowseRequest,
  StudioFeedBrowseResult,
  StudioFeedState,
} from './StudioFeedProtocol'
import {
  studioGeneratedSourceHeader,
  StudioGeneratedSources,
  type StudioGeneratedSourceWriter,
} from './StudioGeneratedSources'
import type { StudioPreviewManifestV2 } from './StudioPreviewManifest'
import type { StudioSketchCatalog, StudioSketchCatalogSnapshot } from './StudioSketchCatalog'
import { StudioSketchProjection } from './StudioSketchProjection'
import { StudioSketchSnap } from './StudioSketchSnap'

type WritePostimage = { before: string | undefined; content: string | undefined; complete: boolean }

type Sources = Readonly<Record<string, string | undefined>>
type Draft = Readonly<{
  base: Sources
  catalog: StudioSketchCatalogSnapshot
  originalCatalog: StudioSketchCatalogSnapshot
  rowId: string
  sketchId: string
  sources: Readonly<Record<string, string>>
  versions: Readonly<Record<string, string>>
}>
type Host = Readonly<{
  catalog: StudioSketchCatalog
  compile: (writes: readonly StudioWrite[]) => Promise<StudioCompileCompletion>
  entryPath: string
  files: StudioProjectFiles
  manifest: () => StudioPreviewManifestV2 | undefined
  publish: (catalog: StudioSketchCatalogSnapshot) => void
  projectRoot: string
  writeSource?: StudioGeneratedSourceWriter
}>

/** Session-local examples have no disk representation until the whole Keep transaction succeeds. */
export class StudioFeedSession {
  #browser: ReturnType<typeof StudioFeedBrowser.build> | undefined
  #browseManifest: StudioPreviewManifestV2 | undefined
  #draft: Draft | undefined
  #revision = 0
  #undo:
    | Readonly<
      {
        before: Sources
        after: Sources
        beforeCatalog: StudioSketchCatalogSnapshot
        afterCatalog: StudioSketchCatalogSnapshot
      }
    >
    | undefined
  readonly #results = new Map<string, Readonly<{ fingerprint: string; result: StudioFeedState }>>()

  constructor(private readonly host: Host) {}

  sourceOverrides(): Readonly<Record<string, string>> | undefined {
    return this.#draft?.sources
  }

  catalog(): StudioSketchCatalogSnapshot | undefined {
    return this.#draft?.catalog
  }

  requireNoDraft(): void {
    Assert.input(
      this.#draft === undefined,
      'Keep or discard the Feed example before editing other Studio source or geometry.',
    )
  }

  async browse(input: unknown): Promise<StudioFeedBrowseResult> {
    Assert.input(Json.isRecord(input), 'Expected a Studio Feed browse request.')
    Assert.input(
      typeof input['seed'] === 'string' && input['seed'].length > 0 && input['seed'].length <= 200,
      'Feed requires a seed of 1–200 characters.',
    )
    Assert.input(
      input['activeScenarioId'] === undefined || typeof input['activeScenarioId'] === 'string',
      'Invalid Feed scenario.',
    )
    if (input['liveRows'] !== undefined) {
      Assert.input(Json.isRecord(input['liveRows']), 'Invalid Feed live rows.')
      for (const rows of Object.values(input['liveRows'])) {
        Assert.input(Array.isArray(rows) && rows.length <= 250, 'Feed live capture is limited to 250 rows per entity.')
        Assert.input(rows.every(row => Json.isRecord(row) && Json.isRecord(row['fields'])), 'Invalid Feed live row.')
      }
    }
    const manifest = this.host.manifest()
    Assert.input(manifest !== undefined, 'Feed needs a compiled Studio preview.')
    this.#browser = StudioFeedBrowser.build(manifest, input as StudioFeedBrowseRequest)
    this.#browseManifest = manifest
    return { ...await this.#state(), inventory: this.#browser.inventory }
  }

  async action(input: unknown): Promise<StudioFeedState> {
    const request = actionRequest(input)
    const fingerprint = JSON.stringify(request)
    const cached = this.#results.get(request.requestId)
    if (cached !== undefined) {
      Assert.input(cached.fingerprint === fingerprint, 'Feed request id was already used for a different action.')
      Assert.input(
        cached.result.draftRevision === this.#revision,
        'The Feed draft changed since this request completed. Refresh it before retrying.',
      )
      if (request.kind === 'discard') {
        return await this.#state()
      }
      Assert.input(
        (await this.host.catalog.read()).revision === cached.result.catalog.revision,
        'The Studio sketch catalog changed since this Feed request completed.',
      )
      if (this.#draft !== undefined) {
        await this.#requireSources(this.#draft.base)
        await this.#requireVersions(this.#draft.versions)
      }
      return cached.result
    }
    Assert.input(
      request.draftRevision === this.#revision,
      'The Feed draft changed. Refresh it before applying this gesture.',
    )
    const catalog = await this.host.catalog.read()
    Assert.input(
      request.kind === 'discard' || request.catalogRevision === catalog.revision,
      'The Studio sketch catalog changed before the Feed gesture.',
    )
    await Switch.kind(request, {
      select: value => this.#select(value, catalog),
      bind: value => this.#select(value, catalog),
      loop: value => this.#select(value, catalog),
      discard: () => this.#discard(),
      keep: () => this.#keep(request.requestId),
      undo: () => this.#undoKeep(request.requestId),
    })
    this.#revision += 1
    const result = await this.#state()
    this.#results.set(request.requestId, { fingerprint, result })
    if (this.#results.size > 100) {
      this.#results.delete(this.#results.keys().next().value!)
    }
    this.host.publish(result.catalog)
    return result
  }

  async #select(
    request: Extract<StudioFeedActionRequest, { kind: 'select' | 'bind' | 'loop' }>,
    catalog: StudioSketchCatalogSnapshot,
  ): Promise<void> {
    Assert.input(
      this.#browser !== undefined && this.#browseManifest !== undefined,
      'Browse Feed rows before dropping an example.',
    )
    if (this.#draft !== undefined) {
      Assert.input(
        this.#draft.sketchId === request.sketchId,
        'Keep or discard the current Feed example before feeding another sketch.',
      )
      await this.#requireSources(this.#draft.base)
    }
    const previous = this.#draft
    const versions = previous?.versions ?? Object.freeze({ ...this.#browseManifest.sourceVersions })
    await this.#requireVersions(versions)
    const base: Record<string, string | undefined> = { ...previous?.base }
    const readSource = async (path: string): Promise<string | undefined> => {
      if (!(path in base)) {
        if (await FS.exists(path)) {
          const generated = new StudioGeneratedSources(this.host.projectRoot)
          base[path] = (await generated.readView(FS.basename(path).slice(0, -4))).content
        } else {
          base[path] = undefined
        }
      }
      return previous?.sources[path] ?? base[path]
    }
    const manifest = this.#browseManifest
    const cell = request.cellId !== undefined
      ? manifest.cells.find(candidate => candidate.cellId === request.cellId)
      : undefined
    Assert.input(request.cellId === undefined || cell !== undefined, 'Feed preview cell no longer exists.')
    const scenario = cell === undefined
      ? undefined
      : manifest.scenarios.find(candidate => candidate.scenarioId === cell.scenarioId)
    const sketch = (previous?.catalog ?? catalog).sketches.find(candidate => candidate.id === request.sketchId)
    Assert.input(sketch !== undefined, 'Feed sketch no longer exists.')
    const viewPath = FS.resolvePath(`@/studio/${sketch.view}.tao`, this.host.projectRoot)
    if (cell !== undefined) {
      const subject = manifest.subjects.find(candidate => candidate.subjectId === scenario?.subjectId)
      Assert.input(
        subject?.kind === 'view' && subject.viewName === sketch.view
          && FS.resolvePath(subject.source.path, this.host.projectRoot) === viewPath,
        'Feed preview cell does not belong to the selected sketch.',
      )
    }
    const scenarioName = scenario?.label
    if (request.kind === 'loop') {
      const entity = this.#browser.inventory.entities.find(candidate =>
        candidate.sources.some(source => source.rows.some(row => row.id === request.rowId))
      )
      Assert.input(entity !== undefined, 'Feed row is no longer available; browse again.')
      this.#requireCollection(manifest, entity.name, request.path)
    }
    const draftRequest = request.kind === 'loop' ? { ...request, kind: 'select' as const } : request
    const prepared = await StudioFeedDraft.prepare({
      browser: this.#browser,
      catalog: previous?.catalog ?? catalog,
      entryPath: this.host.entryPath,
      manifest,
      projectRoot: this.host.projectRoot,
      readSource,
      request: draftRequest,
      ...(scenarioName === undefined ? {} : { scenarioName }),
    })
    let sources = { ...previous?.sources, ...prepared.sources }
    let preparedCatalog = prepared.catalog
    if (request.kind === 'loop') {
      const free = request.rectId === undefined ? undefined : sketch.rects.find(rect => rect.id === request.rectId)
      if (free !== undefined) {
        const projection = StudioSketchProjection.project({ height: sketch.height, width: sketch.width, rects: [free] })
        const snap = StudioSketchSnap.prepare({
          expectedCatalogRevision: catalog.revision,
          mergeDirection: 'Col',
          projection,
          rects: [free],
          sketchId: sketch.id,
          viewName: sketch.view,
        })
        const parsed = await (await Workspace.open(this.host.projectRoot, { sourceOverrides: sources })).parse(viewPath)
        sources[viewPath] = (await SourceActions.applyStudioPatch(parsed.entry.document, snap.action, {
          files: parsed.files.map(file => file.ast),
        })).content
        preparedCatalog = {
          ...preparedCatalog,
          sketches: preparedCatalog.sketches.map(candidate =>
            candidate.id !== sketch.id ? candidate : {
              ...candidate,
              rects: candidate.rects.filter(rect => rect.id !== free.id),
              snapped: [...candidate.snapped, {
                rect: free,
                target: {
                  elementName: 'Placeholder',
                  path: FS.relativePath(this.host.projectRoot, viewPath),
                  renderId: '',
                  sourceVersion: '',
                  studioRectId: free.id,
                  view: sketch.view,
                },
              }],
            }
          ),
        }
      }
      const loop = await StudioFeedLoopSource.prepare({
        entryPath: this.host.entryPath,
        fieldPath: request.path,
        parameterName: prepared.entity,
        projectRoot: this.host.projectRoot,
        sourceOverrides: sources,
        viewName: sketch.view,
        ...(request.rectId === undefined ? {} : { rectId: request.rectId }),
      })
      sources = { ...sources, ...loop.sources }
    }
    for (const path of Object.keys(sources)) {
      await readSource(path)
    }
    const draft: Draft = {
      base: Object.freeze({ ...base }),
      catalog: preparedCatalog,
      originalCatalog: previous?.originalCatalog ?? catalog,
      rowId: request.rowId,
      sketchId: request.sketchId,
      sources: Object.freeze(sources),
      versions,
    }
    this.#draft = draft
    try {
      await this.#compile({}, `feed-preview:${request.requestId}`)
      this.#draft = { ...draft, catalog: this.#refreshTargets(draft) }
    } catch (error) {
      this.#draft = previous
      await this.#compile({}, `feed-preview-rollback:${request.requestId}`)
      throw error
    }
  }

  #requireCollection(manifest: StudioPreviewManifestV2, entityName: string, path: readonly string[]): void {
    const declarations = manifest.generationDeclarations.filter((item): item is EntityGenerationDeclaration =>
      item.kind === 'entity'
    )
    let entity = declarations.find(item => item.name === entityName)
    for (const [index, name] of path.entries()) {
      const field = entity?.fields.find(item => item.name === name)
      Assert.input(
        field !== undefined && !field.secret && !field.optional && field.type.kind === 'relation',
        'Feed collection path is private, optional, or unavailable.',
      )
      Assert.input(
        field.type.inverse === (index === path.length - 1),
        'Feed collection path must end in a collection and traverse single relations.',
      )
      const targetEntity = field.type.entity
      entity = declarations.find(item => item.name === targetEntity)
      Assert.input(entity !== undefined, 'Feed collection entity is unavailable.')
    }
  }

  #refreshTargets(draft: Draft): StudioSketchCatalogSnapshot {
    const manifest = this.host.manifest()
    return {
      ...draft.catalog,
      sketches: draft.catalog.sketches.map(sketch => {
        if (sketch.id !== draft.sketchId) {
          return sketch
        }
        const path = FS.resolvePath(`@/studio/${sketch.view}.tao`, this.host.projectRoot)
        return {
          ...sketch,
          snapped: sketch.snapped.map(item => {
            const renders = manifest?.renders?.filter(render =>
              render.studioRectId === item.rect.id
              && FS.resolvePath(render.source.path, this.host.projectRoot) === path
            ) ?? []
            Assert.input(renders.length === 1, `Feed preview lost rectangle association: ${item.rect.id}`)
            const render = renders[0]!
            const sourceVersion = manifest?.sourceVersions[path]
              ?? manifest?.sourceVersions[FS.relativePath(this.host.projectRoot, path)]
            Assert.input(
              sourceVersion === SourceActions.studioSourceVersion(draft.sources[path]!),
              'Feed rectangle publication has stale source.',
            )
            return {
              rect: { ...item.rect, kind: render.elementName },
              target: {
                ...item.target,
                elementName: render.elementName,
                path: FS.relativePath(this.host.projectRoot, path),
                renderId: render.renderId,
                sourceVersion,
                view: sketch.view,
              },
            }
          }),
        }
      }),
    }
  }

  async #discard(): Promise<void> {
    if (this.#draft === undefined) {
      return
    }
    this.#draft = undefined
    // The coordinator publishes authoritative-source diagnostics even when compilation fails.
    // Abandoning a transient example must not depend on that source being valid.
    await this.host.compile([])
  }

  async #keep(requestId: string): Promise<void> {
    const draft = this.#draft
    Assert.input(draft !== undefined, 'Feed has no pending example to keep.')
    await this.host.catalog.transaction(async transaction => {
      const current = await transaction.read()
      Assert.input(
        current.revision === draft.originalCatalog.revision,
        'The sketch changed before Keep. Discard and try again.',
      )
      await this.#requireSources(draft.base)
      await this.#requireVersions(draft.versions)
      this.#draft = undefined
      const postimages = new Map<string, WritePostimage>()
      try {
        await this.#write(draft.sources, postimages)
        await this.#compile(draft.sources, requestId)
        await this.#requireSources(draft.sources)
        await this.#requireVersions(draft.versions, draft.sources)
        const next = { ...this.#refreshTargets(draft), revision: current.revision + 1 }
        await transaction.restore(next, current.revision)
        this.#undo = { after: draft.sources, afterCatalog: next, before: draft.base, beforeCatalog: current }
      } catch (error) {
        this.#draft = draft
        await this.#rollback(draft.base, postimages, `feed-keep-rollback:${requestId}`, error)
        throw error
      }
    })
  }

  async #undoKeep(requestId: string): Promise<void> {
    this.requireNoDraft()
    const undo = this.#undo
    Assert.input(undo !== undefined, 'There is no Feed Keep to undo.')
    await this.host.catalog.transaction(async transaction => {
      const current = await transaction.read()
      Assert.input(
        current.revision === undo.afterCatalog.revision,
        'The sketch changed after Keep; Feed cannot undo over newer edits.',
      )
      await this.#requireSources(undo.after)
      const postimages = new Map<string, WritePostimage>()
      try {
        await this.#write(undo.before, postimages)
        await this.#compile(undo.before, requestId)
        await this.#requireSources(undo.before)
        await transaction.restore({ ...undo.beforeCatalog, revision: current.revision + 1 }, current.revision)
        this.#undo = undefined
      } catch (error) {
        await this.#rollback(undo.after, postimages, `feed-undo-rollback:${requestId}`, error)
        throw error
      }
    })
  }

  async #requireVersions(versions: Readonly<Record<string, string>>, written: Sources = {}): Promise<void> {
    for (const [path, expected] of Object.entries(versions)) {
      const absolutePath = FS.resolvePath(path, this.host.projectRoot)
      if (absolutePath in written) {
        continue
      }
      this.host.files.requireMutationAllowed(FS.relativePath(this.host.projectRoot, absolutePath))
      const actual = await FS.isFile(absolutePath)
        ? SourceActions.studioSourceVersion(await FS.readText(absolutePath))
        : undefined
      Assert.input(
        actual === expected,
        `Feed dependency changed on disk: ${
          FS.relativePath(this.host.projectRoot, absolutePath)
        }. Discard the example and try again.`,
      )
    }
  }

  async #requireSources(sources: Sources): Promise<void> {
    for (const [path, expected] of Object.entries(sources)) {
      this.host.files.requireMutationAllowed(FS.relativePath(this.host.projectRoot, path))
      const actual = await FS.isFile(path) ? await FS.readText(path) : undefined
      Assert.input(
        actual === expected,
        `Feed source changed on disk: ${
          FS.relativePath(this.host.projectRoot, path)
        }. Discard the example and try again.`,
      )
    }
  }

  async #write(sources: Sources, postimages?: Map<string, WritePostimage>): Promise<void> {
    const generated = new StudioGeneratedSources(this.host.projectRoot)
    const writeSource = this.host.writeSource ?? FS.writeText
    for (const [path, content] of Object.entries(sources)) {
      const name = FS.basename(path).slice(0, -4)
      Assert.input(
        FS.resolvePath(`@/studio/${name}.tao`, this.host.projectRoot) === path,
        'Feed writes only owned Studio sources.',
      )
      const before = postimages === undefined ? undefined : await FS.isFile(path) ? await FS.readText(path) : undefined
      let complete = false
      try {
        if (content === undefined) {
          if (await FS.isFile(path)) {
            await generated.removeView(name)
          }
          this.host.files.forget(path)
        } else {
          Assert.input(
            content.startsWith(`${studioGeneratedSourceHeader}\n`),
            'Feed source is missing Studio ownership.',
          )
          if (await FS.isFile(path)) {
            await generated.rewrite(path, content, writeSource)
          } else {
            // A failed writer may have left another writer's bytes. Delay rethrowing until the
            // generated-source helper has finished, so its create cleanup cannot delete them.
            const failures: unknown[] = []
            await generated.createView(name, content.slice(studioGeneratedSourceHeader.length), async target => {
              try {
                await writeSource(target, content)
              } catch (error) {
                failures.push(error)
              }
            })
            if (failures.length > 0) {
              throw failures[0]
            }
          }
          this.host.files.note(path, SourceActions.studioSourceVersion(content))
        }
        complete = true
      } finally {
        if (postimages !== undefined) {
          postimages.set(path, { before, content, complete })
        }
      }
    }
  }

  async #rollback(
    before: Sources,
    postimages: ReadonlyMap<string, WritePostimage>,
    writeId: string,
    original: unknown,
  ): Promise<void> {
    const restored: Record<string, string | undefined> = {}
    const issues: string[] = []
    for (const [path, owned] of postimages) {
      try {
        const actual = await FS.isFile(path) ? await FS.readText(path) : undefined
        if (!owned.complete && actual === owned.before) {
          if (actual === undefined) {
            this.host.files.forget(path)
          } else {
            this.host.files.note(path, SourceActions.studioSourceVersion(actual))
          }
          restored[path] = before[path]
          continue
        }
        if (!owned.complete || actual !== owned.content) {
          if (actual === undefined) {
            this.host.files.forget(path)
          } else {
            this.host.files.note(path, SourceActions.studioSourceVersion(actual))
          }
          issues.push(
            `${owned.complete ? 'Preserved newer source edit' : 'Preserved uncertain partial write'}: ${
              FS.relativePath(this.host.projectRoot, path)
            }`,
          )
          continue
        }
        await this.#write({ [path]: before[path] })
        restored[path] = before[path]
      } catch (error) {
        issues.push(`Could not restore ${FS.relativePath(this.host.projectRoot, path)}: ${Errors.messageOf(error)}`)
      }
    }
    try {
      await this.#compile(restored, writeId)
    } catch (error) {
      issues.push(`Restored preview could not compile: ${Errors.messageOf(error)}`)
    }
    if (issues.length > 0) {
      Errors.throwUserInput(
        `Feed rollback incomplete. ${issues.join('; ')}. Original failure: ${Errors.messageOf(original)}`,
      )
    }
  }

  async #compile(sources: Sources, writeId: string): Promise<void> {
    const completion = await this.host.compile(
      Object.entries(sources).map(([path, content]) => ({
        path,
        ...(content === undefined ? {} : { sourceVersion: SourceActions.studioSourceVersion(content) }),
        writeId,
      })),
    )
    if (completion.status === 'error') {
      Errors.throwUserInput(`Feed could not compile this example: ${completion.message}`)
    }
  }

  async #state(): Promise<StudioFeedState> {
    return {
      catalog: this.#draft?.catalog ?? await this.host.catalog.read(),
      canUndo: this.#undo !== undefined,
      draftRevision: this.#revision,
      pending: this.#draft !== undefined,
      ...(this.#draft === undefined ? {} : { rowId: this.#draft.rowId, sketchId: this.#draft.sketchId }),
    }
  }
}

function actionRequest(input: unknown): StudioFeedActionRequest {
  Assert.input(Json.isRecord(input), 'Expected a Studio Feed action.')
  Assert.input(
    typeof input['requestId'] === 'string' && input['requestId'].length > 0 && input['requestId'].length <= 200,
    'Invalid Feed request id.',
  )
  Assert.input(
    Number.isSafeInteger(input['catalogRevision']) && Number(input['catalogRevision']) >= 0
      && Number.isSafeInteger(input['draftRevision']) && Number(input['draftRevision']) >= 0,
    'Invalid Feed revision.',
  )
  Assert.input(
    ['select', 'bind', 'loop', 'keep', 'discard', 'undo'].includes(String(input['kind'])),
    'Unknown Feed action.',
  )
  if (input['kind'] === 'select' || input['kind'] === 'bind' || input['kind'] === 'loop') {
    Assert.input(
      typeof input['sketchId'] === 'string' && typeof input['rowId'] === 'string',
      'Feed requires a sketch and a server-issued row.',
    )
    Assert.input(input['cellId'] === undefined || typeof input['cellId'] === 'string', 'Invalid Feed cell.')
  }
  if (input['kind'] === 'loop') {
    Assert.input(
      Array.isArray(input['path']) && input['path'].length > 0 && input['path'].length <= 2
        && input['path'].every(part => typeof part === 'string' && part.length > 0),
      'Invalid Feed collection path.',
    )
    Assert.input(input['rectId'] === undefined || typeof input['rectId'] === 'string', 'Invalid Feed loop rectangle.')
  }
  if (input['kind'] === 'bind') {
    Assert.input(
      typeof input['rectId'] === 'string' && Array.isArray(input['path']) && input['path'].length > 0
        && input['path'].every(part => typeof part === 'string'),
      'Invalid Feed field binding.',
    )
    Assert.input(input['presentation'] === 'image' || input['presentation'] === 'text', 'Invalid Feed presentation.')
  }
  return input as StudioFeedActionRequest
}
