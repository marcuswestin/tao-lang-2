import { Assert, Errors, Json, Switch } from '@shared/core'
import type { StudioFeedBrowserInventory } from '../StudioFeedBrowser'
import type {
  StudioFeedActionRequest,
  StudioFeedBrowseRequest,
  StudioFeedBrowseResult,
  StudioFeedState,
} from '../StudioFeedProtocol'
import type { StudioPreviewManifestV2 } from '../StudioPreviewManifest'
import { type StudioFeedExampleValues, StudioFeedSamples } from './StudioFeedSamples'
import type { StudioFeedPanelInput } from './StudioPanelProjection'

export type StudioFeedDrop =
  & Readonly<{ entity: string; rowId: string }>
  & (
    | Readonly<{ kind: 'entity' }>
    | Readonly<{ kind: 'collection'; path: readonly string[] }>
    | Readonly<{ kind: 'field'; path: readonly string[]; presentation: 'text' | 'image' }>
  )

export const StudioFeedTransfer = {
  mime: 'application/x-tao-studio-feed',
  parse(payload: string): StudioFeedDrop {
    const value: unknown = JSON.parse(payload)
    Assert.input(Json.isRecord(value), 'Studio Feed drag requires an object.')
    Assert.input(
      typeof value['entity'] === 'string' && typeof value['rowId'] === 'string',
      'Studio Feed drag requires an entity and row.',
    )
    const base = { entity: value['entity'], rowId: value['rowId'] }
    if (value['kind'] === 'entity') {
      return { ...base, kind: 'entity' }
    }
    Assert.input(value['kind'] === 'field' || value['kind'] === 'collection', 'Unsupported Studio Feed drag kind.')
    const path = value['path']
    Assert.input(
      Array.isArray(path) && path.length > 0 && path.every(part => typeof part === 'string' && part.length > 0),
      'Studio Feed field drag requires a field path.',
    )
    if (value['kind'] === 'collection') {
      return { ...base, kind: 'collection', path: path as string[] }
    }
    Assert.input(
      value['presentation'] === 'text' || value['presentation'] === 'image',
      'Unsupported Studio Feed field presentation.',
    )
    return { ...base, kind: 'field', path: path as string[], presentation: value['presentation'] }
  },
} as const

type Deps = Readonly<{
  browse: (request: StudioFeedBrowseRequest) => Promise<StudioFeedBrowseResult>
  mutate: (request: (catalogRevision: number) => StudioFeedActionRequest) => Promise<StudioFeedState>
  context: () => Omit<StudioFeedBrowseRequest, 'seed'> & Readonly<{ cellId?: string; sketchId?: string }>
  canMutate: () => boolean
  publish: () => void
  receive: (state: StudioFeedState) => void
  requestId: () => string
}>

const sources = { Fixture: 'fixture', Generated: 'generated', Live: 'live', Library: 'library' } as const

/** Feed browsing is local selection; only explicit sketch targets create server-owned drafts. */
export class StudioFeedController {
  readonly #deps: Deps
  #inventory: StudioFeedBrowserInventory = { entities: [] }
  #state: StudioFeedState | undefined
  #entity = ''
  #source: StudioFeedPanelInput['source'] = 'Fixture'
  #seed = 'studio-feed'
  #selectedRowId: string | undefined
  #loading = false
  #busy = false
  #error = ''
  #notice = ''
  #revision = 0
  #disposed = false
  #liveFingerprint = ''
  #liveDirty = false

  constructor(deps: Deps) {
    this.#deps = deps
  }

  panel(): StudioFeedPanelInput {
    const entity = this.#inventory.entities.find(item => item.name === this.#entity)
    const source = entity?.sources.find(item => item.kind === sources[this.#source])
    return {
      entities: this.#inventory.entities.map(item => item.name),
      entity: this.#entity,
      notice: this.#notice,
      source: this.#source,
      seed: this.#seed,
      selectedRowId: this.#selectedRowId,
      loading: this.#loading,
      pending: this.#busy,
      error: this.#error || source?.issues.join('\n'),
      canKeep: this.#state?.pending === true,
      canDiscard: this.#state?.pending === true,
      canUndo: this.#state?.canUndo === true && this.#state.pending === false,
      rows: (source?.rows ?? []).map(row => ({
        rowId: row.id,
        label: row.label,
        fields: (entity?.fields ?? []).flatMap<StudioFeedPanelInput['rows'][number]['fields'][number]>(field => {
          if (field.type.kind === 'relation' && field.type.inverse) {
            return [{
              path: field.path.split('.'),
              label: `${field.path} (collection)`,
              value: field.type.entity,
              presentation: 'loop',
            }]
          }
          const leaves = field.relation?.fields ?? (field.type.kind === 'relation' ? [] : [field])
          return leaves.flatMap(leaf => {
            const path = leaf.path.split('.')
            const relatedRows = this.#inventory.entities.flatMap(item => item.sources.flatMap(source => source.rows))
              .filter(candidate => candidate.source.fixtureId === row.source.fixtureId)
            const value = StudioFeedSamples.fieldValue(row.fields, path, relatedRows)
            if (value === undefined || value === null) {
              return []
            }
            const text = typeof value === 'string' ? value : JSON.stringify(value)
            const presentations = leaf.type.kind === 'scalar' && leaf.type.scalar === 'text'
              ? ['text', 'image'] as const
              : ['text'] as const
            return presentations.map(presentation => ({
              path,
              label: `${leaf.path}${presentation === 'image' ? ' (image)' : ''}`,
              value: text,
              presentation,
            }))
          })
        }),
      })),
    }
  }

  examples(manifest?: StudioPreviewManifestV2, activeScenarioId?: string): StudioFeedExampleValues {
    return this.#state === undefined
      ? {}
      : StudioFeedSamples.project(this.#state.catalog, this.#inventory, this.#state, manifest, activeScenarioId)
  }

  liveChanged(): void {
    const fingerprint = JSON.stringify(this.#deps.context().liveRows ?? {})
    if (this.#disposed || fingerprint === this.#liveFingerprint) {
      return
    }
    this.#liveFingerprint = fingerprint
    if (this.#source !== 'Live') {
      return
    }
    if (this.#busy) {
      this.#liveDirty = true
      return
    }
    void this.refresh()
  }

  async refresh(): Promise<void> {
    const revision = ++this.#revision
    this.#loading = true
    this.#error = ''
    this.#publish()
    try {
      Assert.input(this.#seed.trim() !== '', 'Enter a Feed seed to generate examples.')
      const { cellId: _cellId, sketchId: _sketchId, ...context } = this.#deps.context()
      const result = await this.#deps.browse({ ...context, seed: this.#seed })
      if (revision !== this.#revision || this.#disposed) {
        return
      }
      this.#inventory = result.inventory
      this.#accept(result)
      if (!this.#inventory.entities.some(item => item.name === this.#entity)) {
        this.#entity = this.#inventory.entities[0]?.name ?? ''
      }
    } catch (error) {
      if (revision === this.#revision) {
        this.#error = Errors.messageOf(error)
      }
    } finally {
      if (revision === this.#revision) {
        this.#loading = false
        this.#publish()
      }
    }
  }

  async execute(payload: string): Promise<void> {
    try {
      const action: unknown = JSON.parse(payload)
      Assert.input(Json.isRecord(action) && typeof action['type'] === 'string', 'Studio Feed requires an action.')
      const kinds = ['select-entity', 'select-source', 'set-seed', 'select-row', 'keep', 'discard', 'undo'] as const
      Assert.input(kinds.some(kind => kind === action['type']), 'Unsupported Studio Feed action.')
      await Switch(action['type'] as (typeof kinds)[number], {
        'select-entity': async () => {
          Assert.input(
            typeof action['entity'] === 'string'
              && this.#inventory.entities.some(item => item.name === action['entity']),
            'Studio Feed entity is no longer available.',
          )
          this.#entity = action['entity']
          this.#selectedRowId = undefined
          this.#publish()
        },
        'select-source': async () => {
          Assert.input(
            typeof action['source'] === 'string' && Object.hasOwn(sources, action['source']),
            'Unknown Studio Feed source.',
          )
          this.#source = action['source'] as StudioFeedPanelInput['source']
          this.#selectedRowId = undefined
          await this.refresh()
        },
        'set-seed': async () => {
          Assert.input(typeof action['seed'] === 'string', 'Studio Feed seed must be text.')
          this.#seed = action['seed']
          await this.refresh()
        },
        'select-row': async () => {
          Assert.input(
            typeof action['rowId'] === 'string' && this.panel().rows.some(row => row.rowId === action['rowId']),
            'Studio Feed row is no longer available.',
          )
          this.#selectedRowId = action['rowId']
          this.#publish()
          const sketchId = this.#deps.context().sketchId
          if (sketchId !== undefined) {
            await this.drop({ kind: 'entity', entity: this.#entity, rowId: action['rowId'] }, sketchId)
          }
        },
        keep: async () => await this.#mutate(() => ({ kind: 'keep' })),
        discard: async () => await this.#mutate(() => ({ kind: 'discard' }), true),
        undo: async () => await this.#mutate(() => ({ kind: 'undo' })),
      })
    } catch (error) {
      this.#error = Errors.messageOf(error)
      this.#publish()
    }
  }

  async drop(payload: StudioFeedDrop, sketchId: string, rectId?: string, cellId?: string): Promise<void> {
    try {
      const entity = this.#inventory.entities.find(item => item.name === payload.entity)
      Assert.input(
        entity?.sources.some(source => source.rows.some(row => row.id === payload.rowId)),
        'Studio Feed row is no longer available. Refresh the Feed.',
      )
      const context = this.#deps.context()
      const targetCellId = cellId ?? (context.sketchId === sketchId ? context.cellId : undefined)
      const cell = targetCellId === undefined ? {} : { cellId: targetCellId }
      await this.#mutate(() => {
        if (payload.kind === 'entity') {
          return { kind: 'select', rowId: payload.rowId, sketchId, ...cell }
        }
        if (payload.kind === 'collection') {
          this.#notice = 'Proposed collection loop with a typed row view. Keep applies it; Discard cancels it.'
          return {
            kind: 'loop',
            rowId: payload.rowId,
            sketchId,
            path: payload.path,
            ...(rectId === undefined ? {} : { rectId }),
            ...cell,
          }
        }
        Assert.input(rectId !== undefined, 'Drop a Feed field on a sketch rectangle.')
        return {
          kind: 'bind',
          rowId: payload.rowId,
          sketchId,
          rectId,
          path: payload.path,
          presentation: payload.presentation,
          ...cell,
        }
      })
    } catch (error) {
      this.#error = Errors.messageOf(error)
      this.#publish()
    }
  }

  dispose(): void {
    this.#disposed = true
    this.#revision++
  }

  async #mutate(
    action: () =>
      | Omit<Extract<StudioFeedActionRequest, { kind: 'select' }>, 'catalogRevision' | 'draftRevision' | 'requestId'>
      | Omit<Extract<StudioFeedActionRequest, { kind: 'bind' }>, 'catalogRevision' | 'draftRevision' | 'requestId'>
      | Omit<Extract<StudioFeedActionRequest, { kind: 'loop' }>, 'catalogRevision' | 'draftRevision' | 'requestId'>
      | { kind: 'keep' | 'discard' | 'undo' },
    discard = false,
  ): Promise<void> {
    Assert.input(
      !this.#busy && (discard || (!this.#loading && this.#deps.canMutate())),
      'Wait for the current edit and save open changes before editing the Feed.',
    )
    if (discard) {
      this.#revision++
      this.#loading = false
    }
    this.#busy = true
    this.#error = ''
    this.#publish()
    try {
      const result = await this.#deps.mutate(catalogRevision => ({
        ...action(),
        catalogRevision,
        draftRevision: this.#state?.draftRevision ?? 0,
        requestId: this.#deps.requestId(),
      }))
      if (!this.#disposed) {
        this.#accept(result)
      }
    } finally {
      this.#busy = false
      this.#publish()
      if (this.#liveDirty && !this.#disposed) {
        this.#liveDirty = false
        await this.refresh()
      }
    }
  }

  #accept(state: StudioFeedState): void {
    if (!state.pending) {
      this.#notice = ''
    }
    this.#state = state
    this.#selectedRowId = state.rowId
    this.#deps.receive(state)
  }
  #publish(): void {
    if (!this.#disposed) {
      this.#deps.publish()
    }
  }
}
