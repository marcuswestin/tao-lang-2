import type { StudioFeedBrowserInventory } from './StudioFeedBrowser'
import type { StudioFeedInventoryRow } from './StudioFeedInventory'
import type { StudioProjectFileContent } from './StudioProtocol'
import type { StudioSketchCatalogSnapshot } from './StudioSketchCatalog'

export type StudioFeedBrowseRequest = Readonly<{
  activeScenarioId?: string
  liveRows?: Readonly<Record<string, readonly StudioFeedInventoryRow[]>>
  seed: string
}>

/** Feed mutations name server-issued rows and the exact draft/catalog the gesture observed. */
export type StudioFeedActionRequest =
  & Readonly<{
    catalogRevision: number
    draftRevision: number
    requestId: string
  }>
  & (
    | Readonly<{ kind: 'select'; rowId: string; sketchId: string; cellId?: string }>
    | Readonly<{
      kind: 'bind'
      cellId?: string
      path: readonly string[]
      presentation: 'image' | 'text'
      rectId: string
      rowId: string
      sketchId: string
    }>
    | Readonly<{
      kind: 'loop'
      cellId?: string
      path: readonly string[]
      rectId?: string
      rowId: string
      sketchId: string
    }>
    | Readonly<{ kind: 'discard' | 'keep' | 'undo' }>
  )

export type StudioFeedState = Readonly<{
  catalog: StudioSketchCatalogSnapshot
  canUndo: boolean
  draftRevision: number
  files?: readonly StudioProjectFileContent[]
  pending: boolean
  rowId?: string
  sketchId?: string
}>

export type StudioFeedBrowseResult =
  & StudioFeedState
  & Readonly<{
    inventory: StudioFeedBrowserInventory
  }>
