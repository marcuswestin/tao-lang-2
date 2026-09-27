import type { StudioInspectorSelection } from '../../StudioInspector'
import type { StudioCanonicalSourceAction, StudioCanvasShortcutCommand } from '../../StudioProtocol'

type Bounds = Readonly<{ left: number; top: number; right: number; bottom: number }>

/** The canvas commands that act on the selection rather than the viewport. */
export type StudioSelectionCommand = Extract<StudioCanvasShortcutCommand, 'group' | 'make-view'>

export function isStudioSelectionCommand(command: StudioCanvasShortcutCommand): command is StudioSelectionCommand {
  return command === 'group' || command === 'make-view'
}

/** ⌘G makes a view of the selection and ⌥⌘G groups it in place, matching the preview's own keys. */
export function studioSelectionShortcut(
  event: Pick<KeyboardEvent, 'altKey' | 'code' | 'ctrlKey' | 'isComposing' | 'metaKey' | 'shiftKey'>,
): StudioSelectionCommand | undefined {
  if (event.isComposing || event.shiftKey || !(event.metaKey || event.ctrlKey) || event.code !== 'KeyG') {
    return undefined
  }
  return event.altKey ? 'group' : 'make-view'
}

/**
 * Grouping wraps the selection in the container that keeps it where it already sits: a Row when the
 * elements spread further across than down, a Col otherwise, and a Col when nothing was measured.
 */
export function inferGroupWrapper(bounds: readonly (Bounds | undefined)[]): 'Col' | 'Row' {
  const measured = bounds.filter(item => item !== undefined)
  if (measured.length < 2) {
    return 'Col'
  }
  const xs = measured.map(item => (item.left + item.right) / 2)
  const ys = measured.map(item => (item.top + item.bottom) / 2)
  const spread = (values: readonly number[]) => Math.max(...values) - Math.min(...values)
  return spread(xs) > spread(ys) ? 'Row' : 'Col'
}

/** The source action a selection command asks for; the server checks the elements are adjacent siblings. */
export function studioSelectionAction(
  command: StudioSelectionCommand,
  group: readonly StudioInspectorSelection[],
  bounds: (selection: StudioInspectorSelection) => Bounds | undefined,
): StudioCanonicalSourceAction {
  const renderIds = group.map(selection => selection.renderId)
  return command === 'make-view'
    ? { kind: 'extract-view', renderIds }
    : { kind: 'group-renders', renderIds, wrapper: inferGroupWrapper(group.map(bounds)) }
}
