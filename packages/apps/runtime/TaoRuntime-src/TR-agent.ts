import React from 'react'
import { settleActionRoots, type TaoActionReceipt } from './TR-action-transactions'
import { RuntimeAssert } from './TR-assert'
import { AuthControls, type RuntimeAuthScope } from './TR-auth'
import type { TaoDataSchema } from './TR-data'
import { errorDetail } from './TR-errors'
import type { RuntimeCommand } from './TR-interaction'
import { runtimeInteractionValue } from './TR-interaction-attention'
import { commandCatalog, type TaoCommandTableEntry } from './TR-interaction-catalog'

type ScalarType = 'text' | 'number' | 'boolean'
type CommandParameter = Readonly<{ name: string; type: ScalarType; required: boolean }>
type AgentCommand = Readonly<{
  id: string
  name: string
  title: string
  description?: string
  enabled?: boolean
  parameters: readonly CommandParameter[]
}>
type RegisteredCommand = Readonly<{
  command: RuntimeCommand
  entry: TaoCommandTableEntry
  parameters: readonly CommandParameter[]
}>
type Configuration = Readonly<{
  commands: readonly RuntimeCommand[]
  stores: readonly TaoDataSchema[]
  scope?: RuntimeAuthScope
  registered: ReadonlyMap<string, RegisteredCommand>
}>
type PersistenceError = Readonly<{ store: string; message: string }>
type AgentResult =
  & TaoActionReceipt
  & Readonly<{
    commandId: string
    persistenceErrors?: readonly PersistenceError[]
  }>

let configuration: Configuration | undefined
let runs: Promise<void> = Promise.resolve()

/** The installed app exposes only its source-selected commands, in its existing mounted runtime. */
export const AgentControls = {
  configure,
  useCommands,
  commands,
  ready,
  run,
  /** Admission belongs to the host, so a timed-out drain never permanently disables this runtime. */
  async drain(): Promise<void> {
    let pending: Promise<void>
    do {
      pending = runs
      await pending
      await settleActionRoots()
    } while (pending !== runs)
    if (configuration) {
      await settleStores(configuration.stores)
    }
  },
} as const

function configure(
  commands: readonly RuntimeCommand[],
  stores: readonly TaoDataSchema[] = [],
  scope?: RuntimeAuthScope,
): () => void {
  const registered = new Map<string, RegisteredCommand>()
  for (const command of commands) {
    const entry = commandCatalog.entryForCommand(command)
    RuntimeAssert.input(entry?.scope.kind === 'module', `Exposed command '${command.name}' must be a module command.`)
    const parameters = entry.slots.filter(slot => command.unfilledSlots().includes(slot.name)).map(slot => {
      const type = slot.scalarType
      RuntimeAssert.input(
        !slot.entity && type !== undefined,
        `Exposed command '${command.name}' has an unsupported parameter '${slot.name}'.`,
      )
      return Object.freeze({ name: slot.name, required: slot.required, type })
    })
    RuntimeAssert.input(!registered.has(entry.identity), `Command '${entry.identity}' is exposed more than once.`)
    registered.set(entry.identity, { command, entry, parameters })
  }
  const selected: Configuration = { commands: [...commands], registered, stores: [...new Set(stores)], scope }
  configuration = selected
  const host = globalThis as typeof globalThis & { document?: unknown; __TAO_AGENT__?: typeof AgentControls }
  if (host.document !== undefined) {
    host.__TAO_AGENT__ = AgentControls
  }
  return () => {
    if (configuration !== selected) {
      return
    }
    configuration = undefined
    if (host.document !== undefined) {
      delete host.__TAO_AGENT__
    }
  }
}

/** Keep rerenders on the same registration; mount after the selected app's provider binding hooks. */
function useCommands(
  commands: readonly RuntimeCommand[],
  stores: readonly TaoDataSchema[],
  scope?: RuntimeAuthScope,
): void {
  const current = React.useRef({ commands, stores, scope })
  if (
    !sameItems(commands, current.current.commands) || !sameItems(stores, current.current.stores)
    || scope !== current.current.scope
  ) {
    current.current = { commands, stores, scope }
  }
  const selected = current.current
  React.useLayoutEffect(() => {
    const boundCommands = selected.scope
      ? selected.commands.map(command => command.with({ __taoAuth: runtimeInteractionValue(selected.scope) }))
      : selected.commands
    const boundStores = selected.stores.map(store => AuthControls.Store(selected.scope, store))
    return configure(boundCommands, boundStores, selected.scope)
  }, [selected])
}

function sameItems<T>(left: readonly T[], right: readonly T[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index])
}

function selectedConfiguration(): Configuration {
  RuntimeAssert.input(configuration !== undefined, 'The app command runtime is not ready.')
  return configuration
}

function commands(): readonly AgentCommand[] {
  return [...selectedConfiguration().registered].map(([id, { command, entry, parameters }]) => ({
    id,
    name: entry.name,
    title: entry.static.title ?? entry.name,
    ...(entry.static.description ? { description: entry.static.description } : {}),
    ...(!parameters.some(parameter => parameter.required) ? { enabled: command.read().enabled } : {}),
    parameters,
  }))
}

async function settleStores(stores: readonly TaoDataSchema[]): Promise<void> {
  await Promise.all(stores.map(store => store.settleForCommand()))
}

async function ready(): Promise<void> {
  const selected = selectedConfiguration()
  await settleStores(selected.stores)
  RuntimeAssert.input(configuration === selected, 'The selected app changed while its command runtime was starting.')
}

function run(commandId: string, arguments_: unknown = {}): Promise<AgentResult> {
  const selected = selectedConfiguration()
  const generation = selected.scope?.generation
  const assertCurrent = () => {
    RuntimeAssert.input(configuration === selected, 'The selected app changed before the command ran.')
    RuntimeAssert.input(
      selected.scope?.generation === generation,
      'The signed-in account changed before the command ran.',
    )
  }
  const result = runs.then(async () => {
    assertCurrent()
    await settleStores(selected.stores)
    await settleActionRoots()
    assertCurrent()
    const registered = selected.registered.get(commandId)
    RuntimeAssert.input(registered !== undefined, `Command '${commandId}' is not exposed by this app.`)
    RuntimeAssert.input(
      typeof arguments_ === 'object' && arguments_ !== null && !Array.isArray(arguments_)
        && (Object.getPrototypeOf(arguments_) === Object.prototype || Object.getPrototypeOf(arguments_) === null),
      'Command arguments must be a JSON object.',
    )
    const values = arguments_ as Record<string, unknown>
    const names = new Set(registered.parameters.map(parameter => parameter.name))
    for (const name of Object.keys(values)) {
      RuntimeAssert.input(names.has(name), `Command '${commandId}' has no parameter '${name}'.`)
    }
    const fills: Record<string, ReturnType<typeof runtimeInteractionValue>> = Object.create(null)
    for (const parameter of registered.parameters) {
      if (!Object.hasOwn(values, parameter.name)) {
        RuntimeAssert.input(!parameter.required, `Command '${commandId}' requires parameter '${parameter.name}'.`)
        continue
      }
      const value = values[parameter.name]
      const valid = parameter.type === 'text'
        ? typeof value === 'string'
        : parameter.type === 'boolean'
        ? typeof value === 'boolean'
        : typeof value === 'number' && Number.isFinite(value)
      RuntimeAssert.input(valid, `Parameter '${parameter.name}' must be ${parameter.type}.`)
      fills[parameter.name] = runtimeInteractionValue(value)
    }
    const command = registered.command.with(fills)
    RuntimeAssert.input(command.read().enabled, `Command '${commandId}' is disabled.`)
    const receipt = await command.invokeReceipt()
    const persistenceErrors: PersistenceError[] = []
    await Promise.all(selected.stores.map(async store => {
      try {
        await store.settleForCommand()
      } catch (error) {
        persistenceErrors.push({ store: store.name, message: errorDetail(error) ?? 'Could not persist command data.' })
      }
    }))
    return {
      ...receipt,
      commandId,
      ...(persistenceErrors.length > 0 ? { outcome: 'failed' as const, persistenceErrors } : {}),
    }
  })
  runs = result.then(() => {}, () => {})
  return result
}
