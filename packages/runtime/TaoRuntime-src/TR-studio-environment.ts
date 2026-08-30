import React from 'react'
import type { TaoDataProvider, TaoDataSchema, TaoFillOps, TaoFillRequest } from './TR-data'
import { Clock } from './TR-units'

export const studioEnvironmentVersion = 1 as const
export const studioStateSeedVersion = 1 as const

/** TaoStudioSchemeConfig is an explicit no-op until reactive Scheme and Appearance exist. */
export type TaoStudioSchemeConfig = Readonly<{
  capability: 'inert'
  reason: string
  requested: 'dark' | 'light' | 'system'
}>

/** TaoStudioFillFailure injects one declared failure at the configured matching fill occurrence. */
export type TaoStudioFillFailure = Readonly<{
  entity?: string
  message: string
  occurrence?: number
}>

/** TaoStudioNetworkEnvironment controls only the remote fill half of the current provider protocol. */
export type TaoStudioNetworkEnvironment = Readonly<{
  failures?: readonly TaoStudioFillFailure[]
  latencyMs?: number
  mode: 'offline' | 'online'
}>

/** TaoStudioEnvironment is the versioned runtime environment understood by an isolated preview cell. */
export type TaoStudioEnvironment = Readonly<{
  network: TaoStudioNetworkEnvironment
  scheme: TaoStudioSchemeConfig
  version: typeof studioEnvironmentVersion
}>

/** TaoStudioStateSeed carries exact full-snapshot envelopes by their provider storage key. */
export type TaoStudioStateSeed = Readonly<{
  snapshots: Readonly<Record<string, string>>
  version: typeof studioStateSeedVersion
}>

/** TaoStudioStateCapture is the cell's current exact full-snapshot state. */
export type TaoStudioStateCapture = TaoStudioStateSeed

export type TaoStudioProviderOverlay =
  & TaoDataProvider
  & Readonly<{
    capture(): TaoStudioStateCapture
  }>

export type TaoStudioProviderOverlayOptions = Readonly<{
  environment: TaoStudioEnvironment
  seed?: TaoStudioStateSeed
}>

export type TaoStudioFixtureValue =
  | boolean
  | number
  | string
  | Readonly<{ kind: 'now' }>
  | Readonly<{ handle: string; kind: 'fixture-reference' }>

type TaoStudioArgumentValue = Readonly<{
  evaluate(): TaoStudioArgumentValue
  jsValue: unknown
}>

export type TaoStudioFixturePlan = Readonly<{
  accounts: readonly Readonly<{ fields: Readonly<Record<string, TaoStudioFixtureValue>>; name: string }>[]
  creates: readonly Readonly<{
    entity: string
    fields: Readonly<Record<string, TaoStudioFixtureValue>>
    name: string
    through?: unknown
  }>[]
}>

export type TaoStudioScenarioRuntime = Readonly<{
  arguments?: Readonly<Record<string, TaoStudioFixtureValue>>
  kind: 'app' | 'view'
  prepare: readonly Readonly<{ fields: Readonly<Record<string, TaoStudioFixtureValue>>; target: string }>[]
  subjectId: string
}>

export type TaoStudioCellRuntime = Readonly<{
  environment: TaoStudioEnvironment
  fixture: TaoStudioFixturePlan
  scenario: TaoStudioScenarioRuntime
  seed?: TaoStudioStateSeed
}>

type StudioHostContextValue = Readonly<{
  captureFixture(): Promise<TaoStudioFixturePlan>
  cell: TaoStudioCellRuntime
  providerFor(base: TaoDataProvider): TaoStudioProviderOverlay
  registerSchema(schema: TaoDataSchema): void
}>

const StudioHostContext = React.createContext<StudioHostContextValue | undefined>(undefined)

/** TaoStudioOfflineError distinguishes an intentional cell network outage from an adapter failure. */
export class TaoStudioOfflineError extends Error {
  constructor(readonly entity: string) {
    super(`Tao Studio network is offline while filling '${entity}'.`)
    this.name = 'TaoStudioOfflineError'
  }
}

/** TaoStudioDeclaredFillError reports one scenario-declared provider failure. */
export class TaoStudioDeclaredFillError extends Error {
  constructor(readonly entity: string, message: string) {
    super(message)
    this.name = 'TaoStudioDeclaredFillError'
  }
}

type OverlayState = {
  failureMatches: number[]
  snapshots: Map<string, string>
}

/** StudioEnvironmentControls owns parser-independent, per-cell environment behavior. */
export const StudioEnvironmentControls = {
  /** Host installs one cell-local runtime contract above the selected generated Tao app. */
  Host({ cell, children }: { cell: TaoStudioCellRuntime; children: React.ReactNode }): React.JSX.Element {
    validateEnvironment(cell.environment)
    const overlays = React.useMemo(() => new WeakMap<TaoDataProvider, TaoStudioProviderOverlay>(), [cell])
    const overlaySet = React.useMemo(() => new Set<TaoStudioProviderOverlay>(), [cell])
    const schemas = React.useMemo(() => new Set<TaoDataSchema>(), [cell])
    const value = React.useMemo<StudioHostContextValue>(() => ({
      async captureFixture() {
        for (const schema of schemas) {
          await schema.settle()
        }
        return capturedFixture([...overlaySet], [...schemas])
      },
      cell,
      providerFor(base) {
        const existing = overlays.get(base)
        if (existing !== undefined) {
          return existing
        }
        const overlay = StudioEnvironmentControls.Provider(base, {
          environment: cell.environment,
          ...(cell.seed === undefined ? {} : { seed: cell.seed }),
        })
        overlays.set(base, overlay)
        overlaySet.add(overlay)
        return overlay
      },
      registerSchema(schema) {
        schemas.add(schema)
      },
    }), [cell, overlaySet, overlays, schemas])
    return React.createElement(StudioHostContext.Provider, { value }, children)
  },

  /** useProvider selects the current cell overlay while leaving production apps untouched. */
  useProvider(base: TaoDataProvider): TaoDataProvider {
    const host = React.useContext(StudioHostContext)
    return host?.providerFor(base) ?? base
  },

  /** useScenario exposes the generated host selection without making Studio durable runtime state. */
  useScenario(): TaoStudioScenarioRuntime | undefined {
    return React.useContext(StudioHostContext)?.cell.scenario
  },

  /** useCapture exposes the current cell's provider-data-to-fixture proposal. */
  useCapture(): (() => Promise<TaoStudioFixturePlan>) | undefined {
    return React.useContext(StudioHostContext)?.captureFixture
  },

  /** useFixture applies fixture creates and ordered prepare updates after datasource binding. */
  useFixture(
    schema: TaoDataSchema | undefined,
  ): Readonly<{ handles: Readonly<Record<string, unknown>>; ready: boolean }> {
    const host = React.useContext(StudioHostContext)
    const applied = React.useRef(false)
    const [handles, setHandles] = React.useState<Readonly<Record<string, unknown>>>({})
    const [ready, setReady] = React.useState(host === undefined || schema === undefined)
    React.useLayoutEffect(() => {
      if (host === undefined || schema === undefined || applied.current) {
        return
      }
      host.registerSchema(schema)
      applied.current = true
      const resolved: Record<string, unknown> = {}
      for (const account of host.cell.fixture.accounts) {
        resolved[account.name] = resolveObject(account.fields, resolved)
      }
      for (const create of host.cell.fixture.creates) {
        if (create.through !== undefined) {
          throw new Error(
            `Tao Studio fixture '${create.name}' uses through-action setup that this runtime cannot execute yet.`,
          )
        }
        resolved[create.name] = schema.create(create.entity, resolveObject(create.fields, resolved))
      }
      for (const update of host.cell.scenario.prepare) {
        const target = resolved[update.target]
        if (target === undefined) {
          throw new Error(`Tao Studio prepare target '${update.target}' was not created.`)
        }
        schema.update(target as never, resolveObject(update.fields, resolved))
      }
      setHandles(Object.freeze({ ...resolved }))
      setReady(true)
    }, [host, schema])
    return { handles, ready }
  },

  /** Argument resolves fixture handles and wraps plain values for generated Tao view props. */
  Argument(
    value: TaoStudioFixtureValue,
    handles: Readonly<Record<string, unknown>>,
  ): TaoStudioArgumentValue {
    const argument: TaoStudioArgumentValue = {
      evaluate: () => argument,
      jsValue: resolveValue(value, handles),
    }
    return argument
  },

  /**
   * Provider overlays a configured provider with isolated seeded persistence and controlled fills.
   * The durable provider's load/persist are never called; only its fill capability is delegated.
   */
  Provider(base: TaoDataProvider, options: TaoStudioProviderOverlayOptions): TaoStudioProviderOverlay {
    validateEnvironment(options.environment)
    const seed = options.seed ?? { snapshots: {}, version: studioStateSeedVersion }
    validateSeed(seed)
    return providerOverlay(base, options.environment, {
      failureMatches: (options.environment.network.failures ?? []).map(() => 0),
      snapshots: new Map(Object.entries(seed.snapshots)),
    })
  },

  /** Scheme is deliberately an identity no-op while the capability is declared inert. */
  Scheme(config: TaoStudioSchemeConfig): TaoStudioSchemeConfig {
    validateScheme(config)
    return config
  },
} as const

function resolveObject(
  fields: Readonly<Record<string, TaoStudioFixtureValue>>,
  handles: Readonly<Record<string, unknown>>,
): Record<string, unknown> {
  return Object.fromEntries(Object.entries(fields).map(([name, value]) => [name, resolveValue(value, handles)]))
}

function resolveValue(value: TaoStudioFixtureValue, handles: Readonly<Record<string, unknown>>): unknown {
  if (typeof value !== 'object') {
    return value
  }
  if (value.kind === 'now') {
    return Clock.now()
  }
  const resolved = handles[value.handle]
  if (resolved === undefined) {
    throw new Error(`Tao Studio fixture reference '${value.handle}' is not available yet.`)
  }
  return resolved
}

function providerOverlay(
  base: TaoDataProvider,
  environment: TaoStudioEnvironment,
  state: OverlayState,
): TaoStudioProviderOverlay {
  const overlay: TaoStudioProviderOverlay = {
    capture: () =>
      Object.freeze({
        snapshots: Object.freeze(
          Object.fromEntries([...state.snapshots.entries()].toSorted(([left], [right]) => left.localeCompare(right))),
        ),
        version: studioStateSeedVersion,
      }),
    load: storageKey => state.snapshots.get(storageKey),
    persist: (storageKey, snapshot) => {
      state.snapshots.set(storageKey, snapshot)
    },
    ...(base.fill === undefined
      ? {}
      : {
        fill: async (request: TaoFillRequest, ops: TaoFillOps): Promise<void> => {
          await controlledFill(base, environment.network, state, request, ops)
        },
      }),
    ...(base.fillCacheMs === undefined ? {} : { fillCacheMs: base.fillCacheMs }),
    ...(base.withConfiguration === undefined
      ? {}
      : {
        withConfiguration: (config: Readonly<Record<string, unknown>>) =>
          providerOverlay(base.withConfiguration!(config), environment, state),
      }),
  }
  return overlay
}

/** capturedFixture converts exact provider snapshots into a reviewable, ordered Tao fixture plan. */
export function capturedFixture(
  overlays: readonly TaoStudioProviderOverlay[],
  schemas: readonly TaoDataSchema[],
): TaoStudioFixturePlan {
  const snapshots: Record<string, string> = {}
  for (const overlay of overlays) {
    for (const [storageKey, snapshot] of Object.entries(overlay.capture().snapshots)) {
      const existing = snapshots[storageKey]
      if (existing !== undefined && existing !== snapshot) {
        throw new Error(`Tao Studio captured conflicting snapshots for storage key '${storageKey}'.`)
      }
      snapshots[storageKey] = snapshot
    }
  }
  const rows: CapturedRow[] = []
  for (const serialized of Object.values(snapshots)) {
    const envelope = JSON.parse(serialized) as { rows?: Record<string, Array<Record<string, unknown>>> }
    if (envelope.rows === undefined || typeof envelope.rows !== 'object') {
      throw new Error('Tao Studio cannot capture an invalid provider snapshot as a fixture.')
    }
    const entityNames = Object.keys(envelope.rows).toSorted().join('\0')
    const schema = schemas.find(candidate =>
      Object.keys(candidate.definition.entities).toSorted().join('\0') === entityNames
    )
    if (schema === undefined) {
      throw new Error('Tao Studio cannot match a provider snapshot to its data schema.')
    }
    for (const [entity, entityRows] of Object.entries(envelope.rows)) {
      const definition = schema.definition.entities[entity]
      if (definition === undefined || !Array.isArray(entityRows)) {
        throw new Error('Tao Studio captured an unknown entity.')
      }
      for (const row of entityRows) {
        if (typeof row['Id'] !== 'string') {
          throw new Error('Tao Studio captured a row without an Id.')
        }
        rows.push({
          entity,
          fields: Object.fromEntries(Object.entries(row).filter(([name]) => name !== 'Id')),
          id: row['Id'],
          relationFields: Object.fromEntries(
            Object.entries(definition.fields).flatMap(([name, field]) =>
              field.kind === 'relation' && field.relation !== undefined ? [[name, field.relation]] : []
            ),
          ),
        })
      }
    }
  }
  return fixtureFromRows(rows)
}

type CapturedRow = {
  entity: string
  fields: Record<string, unknown>
  id: string
  relationFields: Readonly<Record<string, string>>
}

function fixtureFromRows(rows: readonly CapturedRow[]): TaoStudioFixturePlan {
  const nameById = new Map<string, string>()
  const countByEntity = new Map<string, number>()
  for (const row of rows) {
    const count = (countByEntity.get(row.entity) ?? 0) + 1
    countByEntity.set(row.entity, count)
    nameById.set(capturedRowKey(row.entity, row.id), `${identifier(row.entity)}${count}`)
  }
  const pending = new Map(rows.map(row => [capturedRowKey(row.entity, row.id), row]))
  const creates: Array<TaoStudioFixturePlan['creates'][number]> = []
  const visiting = new Set<string>()
  const emit = (key: string): void => {
    if (!pending.has(key)) {
      return
    }
    if (visiting.has(key)) {
      throw new Error('Tao Studio cannot capture cyclic row relations as an ordered fixture.')
    }
    visiting.add(key)
    const row = pending.get(key)!
    for (const [field, relatedEntity] of Object.entries(row.relationFields)) {
      const relatedId = row.fields[field]
      if (typeof relatedId !== 'string') {
        throw new Error(`Tao Studio captured invalid relation '${row.entity}.${field}'.`)
      }
      emit(capturedRowKey(relatedEntity, relatedId))
    }
    const fields = Object.fromEntries(
      Object.entries(row.fields).map(([field, raw]) => {
        const relatedEntity = row.relationFields[field]
        if (relatedEntity !== undefined) {
          const handle = nameById.get(capturedRowKey(relatedEntity, String(raw)))
          if (handle === undefined) {
            throw new Error(`Tao Studio captured a missing relation '${row.entity}.${field}'.`)
          }
          return [field, { handle, kind: 'fixture-reference' as const }]
        }
        if (typeof raw !== 'boolean' && typeof raw !== 'number' && typeof raw !== 'string') {
          throw new Error(`Tao Studio cannot capture non-scalar field '${row.entity}.${field}'.`)
        }
        return [field, raw]
      }),
    )
    creates.push({ entity: row.entity, fields, name: nameById.get(key)! })
    pending.delete(key)
    visiting.delete(key)
  }
  for (const key of [...pending.keys()]) {
    emit(key)
  }
  return Object.freeze({ accounts: [], creates: Object.freeze(creates) })
}

function capturedRowKey(entity: string, id: string): string {
  return `${entity}\0${id}`
}

function identifier(value: string): string {
  const normalized = value.replace(/[^A-Za-z0-9_]/g, '_')
  return /^[A-Za-z_]/.test(normalized) ? normalized : `Captured_${normalized}`
}

async function controlledFill(
  base: TaoDataProvider,
  network: TaoStudioNetworkEnvironment,
  state: OverlayState,
  request: TaoFillRequest,
  ops: TaoFillOps,
): Promise<void> {
  const latencyMs = network.latencyMs ?? 0
  if (latencyMs > 0) {
    await clockDelay(latencyMs)
  }
  const entity = request.descriptor.entity
  if (network.mode === 'offline') {
    throw new TaoStudioOfflineError(entity)
  }
  const failure = matchingFailure(network.failures ?? [], state.failureMatches, entity)
  if (failure !== undefined) {
    throw new TaoStudioDeclaredFillError(entity, failure.message)
  }
  await base.fill!(request, ops)
}

function matchingFailure(
  failures: readonly TaoStudioFillFailure[],
  matches: number[],
  entity: string,
): TaoStudioFillFailure | undefined {
  for (let index = 0; index < failures.length; index += 1) {
    const failure = failures[index]!
    if (failure.entity !== undefined && failure.entity !== entity) {
      continue
    }
    const occurrence = (matches[index] ?? 0) + 1
    matches[index] = occurrence
    if (failure.occurrence === undefined || failure.occurrence === occurrence) {
      return failure
    }
  }
  return undefined
}

function clockDelay(milliseconds: number): Promise<void> {
  return new Promise(resolve => {
    Clock.after(milliseconds, resolve)
  })
}

function validateEnvironment(environment: TaoStudioEnvironment): void {
  if (environment.version !== studioEnvironmentVersion) {
    throw new Error(`Unsupported Tao Studio environment version '${String(environment.version)}'.`)
  }
  validateScheme(environment.scheme)
  if (environment.network.mode !== 'offline' && environment.network.mode !== 'online') {
    throw new Error(`Unsupported Tao Studio network mode '${String(environment.network.mode)}'.`)
  }
  const latency = environment.network.latencyMs ?? 0
  if (!Number.isSafeInteger(latency) || latency < 0) {
    throw new Error('Tao Studio network latency must be a non-negative safe integer in milliseconds.')
  }
  for (const failure of environment.network.failures ?? []) {
    if (failure.entity !== undefined && failure.entity.trim().length === 0) {
      throw new Error('A Tao Studio declared fill failure entity cannot be empty.')
    }
    if (failure.message.trim().length === 0) {
      throw new Error('A Tao Studio declared fill failure must have a message.')
    }
    if (
      failure.occurrence !== undefined
      && (!Number.isSafeInteger(failure.occurrence) || failure.occurrence < 1)
    ) {
      throw new Error('A Tao Studio declared fill failure occurrence must be a positive safe integer.')
    }
  }
}

function validateScheme(config: TaoStudioSchemeConfig): void {
  if (
    config.capability !== 'inert'
    || config.reason.trim().length === 0
    || !['dark', 'light', 'system'].includes(config.requested)
  ) {
    throw new Error('Tao Studio Scheme must remain explicitly inert with a visible reason.')
  }
}

function validateSeed(seed: TaoStudioStateSeed): void {
  if (seed.version !== studioStateSeedVersion) {
    throw new Error(`Unsupported Tao Studio state seed version '${String(seed.version)}'.`)
  }
  for (const [storageKey, snapshot] of Object.entries(seed.snapshots)) {
    if (storageKey.trim().length === 0 || typeof snapshot !== 'string') {
      throw new Error('Tao Studio state seeds require non-empty storage keys and string snapshots.')
    }
  }
}
