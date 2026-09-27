import { EditorView } from 'codemirror'
import type { StudioInspectorSelection } from '../../StudioInspector'
import type {
  StudioCanonicalSourceAction,
  StudioPreviewLayoutMeasurement,
  StudioPreviewLayoutMeasurementsMessage,
} from '../../StudioProtocol'
import { projectRelativePath, type StudioSourceEditor } from '../StudioEditor'
import type { StudioPreviewConnection } from '../StudioMatrixView'

type Rect = Readonly<{ height: number; width: number; x: number; y: number }>

/**
 * An edit to one element in place, remembered so the element stays selected once the preview
 * recompiles: render ids name source offsets, which the edit shifts, so the successor is found by
 * where it starts and where it sits on screen.
 */
export type StudioSelectionCarry = Readonly<{
  compileRevision: number
  elementNames: readonly string[]
  expires: number
  path: string
  previewInstanceId: string
  rect: Rect
  selection: StudioInspectorSelection
}>

/** The edits that change an element without moving, removing, or multiplying it. */
const carriedKinds: ReadonlySet<string> = new Set([
  'bind-text',
  'set-layout-entry',
  'set-style-entry',
  'set-text-content',
  'toggle-flow-direction',
])

const carryLifetime = 15_000

export function studioSelectionCarry(
  selection: StudioInspectorSelection,
  action: StudioCanonicalSourceAction,
  layout: StudioPreviewLayoutMeasurementsMessage | undefined,
  now: number,
): StudioSelectionCarry | undefined {
  const measured = layout?.measurements.find(item => item.renderId === selection.renderId)
  const compileRevision = layout?.identity.compileRevision
  if (
    layout === undefined || measured === undefined || compileRevision === undefined
    || !carriedKinds.has(action.kind) || action['renderId'] !== selection.renderId
  ) {
    return undefined
  }
  return {
    compileRevision,
    elementNames: action.kind === 'toggle-flow-direction' ? ['Col', 'Row'] : [measured.elementName],
    expires: now + carryLifetime,
    path: selection.identity.path,
    previewInstanceId: layout.identity.previewInstanceId,
    rect: measured.rect,
    selection,
  }
}

/**
 * The element a carried selection became in a newer layout: the same kind of element starting where
 * the old one started, or failing that the one covering most of the same place.
 */
export function studioCarriedMeasurement(
  carry: StudioSelectionCarry,
  layout: StudioPreviewLayoutMeasurementsMessage,
): StudioPreviewLayoutMeasurement | undefined {
  if (
    layout.identity.previewInstanceId !== carry.previewInstanceId
    || (layout.identity.compileRevision ?? carry.compileRevision) <= carry.compileRevision
  ) {
    return undefined
  }
  const candidates = layout.measurements.filter(item =>
    carry.elementNames.includes(item.elementName) && renderRange(item.renderId)?.path === carry.path
  )
  const sameStart = candidates.find(item => renderRange(item.renderId)?.start === carry.selection.range.start)
  if (sameStart !== undefined) {
    return sameStart
  }
  const scored = candidates
    .map(item => ({ item, overlap: overlapRatio(item.rect, carry.rect) }))
    .sort((left, right) => right.overlap - left.overlap)[0]
  return scored !== undefined && scored.overlap >= 0.5 ? scored.item : undefined
}

export function renderRange(renderId: string): Readonly<{ end: number; path: string; start: number }> | undefined {
  const endAt = renderId.lastIndexOf(':')
  const startAt = renderId.lastIndexOf(':', endAt - 1)
  const start = Number(renderId.slice(startAt + 1, endAt))
  const end = Number(renderId.slice(endAt + 1))
  return startAt <= 0 || !Number.isInteger(start) || !Number.isInteger(end)
    ? undefined
    : { end, path: renderId.slice(0, startAt), start }
}

function overlapRatio(left: Rect, right: Rect): number {
  const width = Math.min(left.x + left.width, right.x + right.width) - Math.max(left.x, right.x)
  const height = Math.min(left.y + left.height, right.y + right.height) - Math.max(left.y, right.y)
  const shared = Math.max(0, width) * Math.max(0, height)
  const union = left.width * left.height + right.width * right.height - shared
  return union <= 0 ? 0 : shared / union
}

export type StudioSelectionCarryDeps = Readonly<{
  /** The person is typing in the code editor, where a carried selection must never move their cursor. */
  editorTyping: () => boolean
  openFile: (path: string) => Promise<StudioSourceEditor | undefined>
  previews: readonly StudioPreviewConnection[]
  project: string
  select: (selection: StudioInspectorSelection) => void
}>

export type StudioSelectionCarryControls = Readonly<{
  forget: () => void
  restore: () => Promise<void>
  track: (
    selection: StudioInspectorSelection,
    action: StudioCanonicalSourceAction,
    applied: Promise<boolean>,
  ) => Promise<void>
}>

/**
 * Keeps an edited element selected across its recompile, so the HUD and inspector stay on it while
 * its gap, padding or direction is tuned one step at a time. Any other selection supersedes it.
 */
export function createStudioSelectionCarry(deps: StudioSelectionCarryDeps): StudioSelectionCarryControls {
  let pending: StudioSelectionCarry | undefined
  /** Bumped by every track and forget, so an edit that lands after being superseded carries nothing. */
  let generation = 0
  const forget = (): void => {
    generation += 1
    pending = undefined
  }
  const restore = async (): Promise<void> => {
    const carry = pending
    if (carry === undefined) {
      return
    }
    if (Date.now() > carry.expires || deps.editorTyping()) {
      pending = undefined
      return
    }
    const preview = deps.previews.find(item => item.previewInstanceId === carry.previewInstanceId)
    const layout = preview?.layoutMeasurements
    const successor = layout === undefined ? undefined : studioCarriedMeasurement(carry, layout)
    const range = successor === undefined ? undefined : renderRange(successor.renderId)
    if (layout === undefined || successor === undefined || range === undefined) {
      return
    }
    pending = undefined
    const restoring = generation
    const opened = await deps.openFile(projectRelativePath(deps.project, carry.path) ?? carry.path)
    if (
      opened === undefined || range.end > opened.editor.state.doc.length || restoring !== generation
      || deps.editorTyping()
    ) {
      return
    }
    // The editor follows without taking focus, so ⌘Z and the HUD keep working on the canvas.
    opened.editor.dispatch({
      effects: EditorView.scrollIntoView(range.start, { y: 'center' }),
      selection: { anchor: range.start, head: range.end },
    })
    deps.select({
      identity: {
        ...carry.selection.identity,
        ...layout.identity,
        path: carry.path,
        sourceVersion: opened.file.sourceVersion,
      },
      range: { end: range.end, start: range.start },
      renderId: successor.renderId,
    })
  }
  return {
    forget,
    restore,
    /**
     * Measures the element before its edit is sent, then carries the selection only if the edit lands:
     * a refused or failed edit, or anything that supersedes it meanwhile, leaves nothing to restore.
     */
    async track(selection, action, applied) {
      forget()
      const tracking = generation
      const preview = deps.previews.find(item => item.previewInstanceId === selection.identity.previewInstanceId)
      const carry = studioSelectionCarry(selection, action, preview?.layoutMeasurements, Date.now())
      const landed = await applied.then(ok => ok, () => false)
      if (!landed || carry === undefined || tracking !== generation) {
        return
      }
      pending = carry
      // The recompiled layout may already have arrived while the edit was answered.
      await restore()
    },
  }
}
