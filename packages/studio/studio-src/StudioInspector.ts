import {
  type StudioCanonicalSourceAction,
  type StudioPreviewSourceIdentity,
  type StudioPreviewSourceMessage,
  studioProtocolChannel,
  studioProtocolVersion,
  type StudioSourceActionEnvelope,
  type StudioSourceActionUndoEnvelope,
  studioSourceActionVersion,
  type StudioSourceRange,
} from './StudioProtocol'

export type StudioInspectorSelection = {
  identity: StudioPreviewSourceIdentity
  range: StudioSourceRange
  renderId: string
}

export type StudioPaletteComponent = {
  component: 'Button' | 'Number' | 'Stack' | 'Text'
  label: string
}

export type StudioInspectorLayoutAction = {
  entry: readonly (number | string)[]
  id: string
  label: string
}

export const studioPaletteComponents: readonly StudioPaletteComponent[] = [
  { component: 'Text', label: 'Text' },
  { component: 'Number', label: 'Number' },
  { component: 'Button', label: 'Button' },
  { component: 'Stack', label: 'Stack' },
]

export const studioInspectorLayoutActions: readonly StudioInspectorLayoutAction[] = [
  { entry: ['gap', 8], id: 'gap-8', label: 'Gap 8' },
  { entry: ['gap', 16], id: 'gap-16', label: 'Gap 16' },
  { entry: ['pad', 8], id: 'pad-8', label: 'Pad 8' },
  { entry: ['pad', 16], id: 'pad-16', label: 'Pad 16' },
  { entry: ['margin', 'horizontal', 8], id: 'margin-horizontal-8', label: 'Margin H 8' },
  { entry: ['margin', 'vertical', 8], id: 'margin-vertical-8', label: 'Margin V 8' },
  { entry: ['width', 'fill'], id: 'width-fill', label: 'Width fill' },
  { entry: ['height', 'fill'], id: 'height-fill', label: 'Height fill' },
  { entry: ['aligned', 'center'], id: 'aligned-center', label: 'Align center' },
  { entry: ['hug'], id: 'hug', label: 'Hug' },
  { entry: ['compress'], id: 'compress', label: 'Compress' },
  { entry: ['rigid'], id: 'rigid', label: 'Rigid' },
]

/** StudioInspector derives the browser inspector's canonical source-action DTOs without hidden visual state. */
export const StudioInspector = {
  projectViews,
  selection,
  singleAction,
  undo,
} as const

function selection(message: StudioPreviewSourceMessage): StudioInspectorSelection {
  return {
    identity: message.identity,
    range: message.range,
    renderId: `${message.identity.path}:${message.range.start}:${message.range.end}`,
  }
}

function singleAction(options: {
  action: StudioCanonicalSourceAction
  checkpointId: string
  identity: StudioPreviewSourceIdentity
  requestId: string
}): StudioSourceActionEnvelope {
  return {
    action: options.action,
    channel: studioProtocolChannel,
    checkpoint: { id: options.checkpointId, phase: 'single' },
    identity: options.identity,
    protocolVersion: studioProtocolVersion,
    requestId: options.requestId,
    sourceActionVersion: studioSourceActionVersion,
    type: 'source-action',
  }
}

function undo(options: {
  checkpointId: string
  identity: StudioPreviewSourceIdentity
  requestId: string
}): StudioSourceActionUndoEnvelope {
  return {
    channel: studioProtocolChannel,
    checkpointId: options.checkpointId,
    identity: options.identity,
    protocolVersion: studioProtocolVersion,
    requestId: options.requestId,
    sourceActionVersion: studioSourceActionVersion,
    type: 'source-action-undo',
  }
}

function projectViews(content: string): readonly string[] {
  const names = new Set<string>()
  const declaration = /\bview\s+([A-Z]\w*)\s*\(\s*\)/g
  for (const match of content.matchAll(declaration)) {
    const name = match[1]
    if (name !== undefined) {
      names.add(name)
    }
  }
  return [...names].toSorted()
}
