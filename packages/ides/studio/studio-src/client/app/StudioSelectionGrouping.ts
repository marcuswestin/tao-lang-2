import type { StudioInspectorSelection } from '../../StudioInspector'
import type { StudioCanonicalSourceAction, StudioCanvasShortcutCommand } from '../../StudioProtocol'
import { StudioDialog } from '../StudioDialog'
import { studioShortcutLetter } from '../StudioEditor'
import { isStudioVisualUndoShortcut } from './StudioEditLog'

type Bounds = Readonly<{ left: number; top: number; right: number; bottom: number }>

/** The canvas commands that act on the selection rather than the viewport. */
export type StudioSelectionCommand = Extract<StudioCanvasShortcutCommand, 'group' | 'make-view'>

export function isStudioSelectionCommand(command: StudioCanvasShortcutCommand): command is StudioSelectionCommand {
  return command === 'group' || command === 'make-view'
}

/** ⌘G makes a view of the selection and ⌥⌘G groups it in place, matching the preview's own keys. */
export function studioSelectionShortcut(
  event: Pick<KeyboardEvent, 'altKey' | 'code' | 'ctrlKey' | 'isComposing' | 'key' | 'metaKey' | 'shiftKey'>,
): StudioSelectionCommand | undefined {
  if (event.isComposing || event.shiftKey || !(event.metaKey || event.ctrlKey) || studioShortcutLetter(event) !== 'g') {
    return undefined
  }
  return event.altKey ? 'group' : 'make-view'
}

type StudioCanvasKeyCommand = 'undo' | StudioSelectionCommand

/**
 * Where a canvas command may act. Grouping needs the preview cells on screen, which only Design shows
 * (Draw hides them, so a selection left there is invisible); the edit log floats in Design and Draw.
 */
export function studioCanvasCommandAllowed(command: StudioCanvasKeyCommand, preset: string | undefined): boolean {
  return command === 'undo' ? preset === 'design' || preset === 'draw' : preset === 'design'
}

/**
 * The canvas command a Studio keydown asks for, if any. Typing targets (the code editor, text fields)
 * keep their own keys, including their own ⌘Z; ⌘Z elsewhere walks back the edit log, and ⌘G or ⌥⌘G
 * act on the preview selection.
 */
export function studioCanvasKeyCommand(
  event: Pick<KeyboardEvent, 'altKey' | 'code' | 'ctrlKey' | 'isComposing' | 'key' | 'metaKey' | 'shiftKey'>,
  context: Readonly<{ canUndo: boolean; hasSelection: boolean; preset: string | undefined; typing: boolean }>,
): StudioCanvasKeyCommand | undefined {
  if (context.typing) {
    return undefined
  }
  if (isStudioVisualUndoShortcut(event)) {
    return context.canUndo && studioCanvasCommandAllowed('undo', context.preset) ? 'undo' : undefined
  }
  const command = studioSelectionShortcut(event)
  return command !== undefined && context.hasSelection && studioCanvasCommandAllowed(command, context.preset)
    ? command
    : undefined
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

/**
 * The name a Make view answer asks for: a typed name is the new view's, an empty answer lets the
 * server number it View1, View2, …, and a cancelled prompt makes no view at all.
 */
export function studioViewNameAnswer(answer: string | undefined): Readonly<{ name?: string }> | undefined {
  if (answer === undefined) {
    return undefined
  }
  const name = answer.trim()
  return name === '' ? {} : { name }
}

/** studioNameNewView asks what to call the view Make view is about to write, with OK and Cancel. */
export async function studioNameNewView(elementCount: number): Promise<Readonly<{ name?: string }> | undefined> {
  return studioViewNameAnswer(
    await StudioDialog.prompt({
      cancelLabel: 'Cancel',
      confirmLabel: 'OK',
      detail: elementCount > 1
        ? `The ${elementCount} selected elements become one new view. Leave the name empty to number it.`
        : 'The selected element becomes a new view. Leave the name empty to number it.',
      placeholder: 'ViewName',
      title: 'Make view',
    }),
  )
}
