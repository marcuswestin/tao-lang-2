import type { StudioRenderInspection } from '@source-actions'
import type { StudioCanonicalSourceAction } from './StudioProtocol'

/**
 * What can be done to one selected render as a whole, each lowering to one source action. The
 * inspector's Actions list and the selection toolbar's actions menu offer this same list.
 */
export const studioRenderActionIds = [
  'move-up',
  'move-down',
  'wrap-row',
  'wrap-col',
  'wrap-stack',
  'make-view',
  'remove-element',
] as const

export type StudioRenderActionId = (typeof studioRenderActionIds)[number]

const definitions: Readonly<
  Record<StudioRenderActionId, Readonly<{ action: StudioCanonicalSourceAction; label: string }>>
> = {
  'make-view': { action: { kind: 'extract-view' }, label: 'Make view' },
  'move-down': { action: { kind: 'move-render' }, label: 'Move down' },
  'move-up': { action: { kind: 'move-render' }, label: 'Move up' },
  'remove-element': { action: { kind: 'remove-render' }, label: 'Remove element' },
  'wrap-col': { action: { kind: 'wrap-render', wrapper: 'Col' }, label: 'Wrap in Col' },
  'wrap-row': { action: { kind: 'wrap-render', wrapper: 'Row' }, label: 'Wrap in Row' },
  'wrap-stack': { action: { kind: 'wrap-render', wrapper: 'Stack' }, label: 'Wrap in Stack' },
}

/** Move up and Move down step among the element's siblings, as the companion's menu does. */
const moves: Readonly<Partial<Record<StudioRenderActionId, 'down' | 'up'>>> = { 'move-down': 'down', 'move-up': 'up' }

function known(actionId: string): actionId is StudioRenderActionId {
  return Object.hasOwn(definitions, actionId)
}

export const StudioRenderActions = {
  isMove(actionId: string): boolean {
    return known(actionId) && moves[actionId] !== undefined
  },
  label(actionId: string): string {
    return known(actionId) ? definitions[actionId].label : actionId
  },
  /**
   * The source action for the inspected render, or nothing where the action does not apply: an
   * unknown id, or a move toward an end the element already sits at.
   */
  action(inspection: StudioRenderInspection, actionId: string): StudioCanonicalSourceAction | undefined {
    if (!known(actionId)) {
      return undefined
    }
    const definition = definitions[actionId].action
    const direction = moves[actionId]
    if (direction !== undefined) {
      const move = inspection.moves[direction]
      return move === undefined || move.draggedId !== inspection.renderId ? undefined : { ...definition, ...move }
    }
    // Selection-wide actions take a list of renders; one selection offers them for itself.
    return definition['kind'] === 'extract-view'
      ? { ...definition, renderIds: [inspection.renderId] }
      : { ...definition, renderId: inspection.renderId }
  },
} as const
