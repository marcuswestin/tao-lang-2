import { Assert, Errors } from '@shared/core'
import type { StudioJsonObject } from '../../StudioProtocol'

export type StudioScenarioPanelCommand =
  | Readonly<{
    arguments: StudioJsonObject
    cellId: string
    cellRevision: number
    kind: 'scenario-apply-arguments'
  }>
  | Readonly<{
    appearance: 'dark' | 'light'
    arguments: StudioJsonObject
    cellId: string
    cellRevision: number
    kind: 'scenario-save-arguments'
  }>
  | Readonly<{
    cellId: string
    cellRevision: number
    fixtureName: string
    kind: 'scenario-capture-fixture'
  }>
  | Readonly<{
    cellId: string
    cellRevision: number
    kind: 'scenario-replay-failure'
  }>
  | Readonly<{
    capture: unknown
    cellId: string
    cellRevision: number
    kind: 'scenario-replay-capture'
  }>
  | Readonly<{
    captureSensitiveText: boolean
    cellId: string
    cellRevision: number
    kind: 'scenario-start-journey'
  }>
  | Readonly<{
    cellId: string
    cellRevision: number
    kind: 'scenario-stop-journey'
  }>
  | Readonly<{
    cellId: string
    cellRevision: number
    kind: 'scenario-discard-journey'
  }>
  | Readonly<{
    cellId: string
    cellRevision: number
    kind: 'scenario-save-journey'
  }>

export function parseScenarioPanelCommand(name: string, payload: string): StudioScenarioPanelCommand {
  let value: unknown
  try {
    value = JSON.parse(payload) as unknown
  } catch {
    Errors.throwUserInput('Tao Studio scenario actions require a valid object payload.')
  }
  Assert.input(
    value !== null && typeof value === 'object',
    'Tao Studio scenario actions require an object payload.',
  )
  const input = value as Record<string, unknown>
  if (
    typeof input['cellId'] !== 'string'
    || input['cellId'].trim() === ''
    || !Number.isInteger(input['cellRevision'])
    || (input['cellRevision'] as number) < 0
  ) {
    Errors.throwUserInput('Tao Studio scenario actions require the active cell identity and revision.')
  }
  const identity = { cellId: input['cellId'], cellRevision: input['cellRevision'] as number }
  if (name === 'scenario-apply-arguments' || name === 'scenario-save-arguments') {
    if (!studioJsonObject(input['arguments'])) {
      Errors.throwUserInput('Tao Studio scenario arguments require a JSON object payload.')
    }
    const appearance = input['appearance']
    if (name === 'scenario-save-arguments' && appearance !== 'dark' && appearance !== 'light') {
      Errors.throwUserInput('Tao Studio scenario saves require a resolved light or dark appearance.')
    }
    return {
      ...identity,
      ...(name === 'scenario-save-arguments' ? { appearance } : {}),
      arguments: input['arguments'],
      kind: name,
    } as StudioScenarioPanelCommand
  }
  if (name === 'scenario-capture-fixture') {
    if (typeof input['fixtureName'] !== 'string') {
      Errors.throwUserInput('Tao Studio fixture capture requires a fixture name.')
    }
    return { ...identity, fixtureName: input['fixtureName'], kind: name }
  }
  if (name === 'scenario-replay-failure') {
    return { ...identity, kind: name }
  }
  if (name === 'scenario-replay-capture') {
    return { ...identity, capture: input['capture'], kind: name }
  }
  if (name === 'scenario-start-journey') {
    if (typeof input['captureSensitiveText'] !== 'boolean') {
      Errors.throwUserInput('Tao Studio journey recording requires an explicit sensitive-text choice.')
    }
    return { ...identity, captureSensitiveText: input['captureSensitiveText'], kind: name }
  }
  if (
    name === 'scenario-stop-journey'
    || name === 'scenario-discard-journey'
    || name === 'scenario-save-journey'
  ) {
    return { ...identity, kind: name }
  }
  Errors.throwUserInput(`Unsupported Tao Studio scenario action: ${name}`)
}

function studioJsonObject(value: unknown): value is StudioJsonObject {
  return value !== null
    && typeof value === 'object'
    && !Array.isArray(value)
    && Object.values(value).every(studioJsonValue)
}

function studioJsonValue(value: unknown): value is StudioJsonObject[keyof StudioJsonObject] {
  return value === null
    || typeof value === 'boolean'
    || typeof value === 'number' && Number.isFinite(value)
    || typeof value === 'string'
    || Array.isArray(value) && value.every(studioJsonValue)
    || studioJsonObject(value)
}
