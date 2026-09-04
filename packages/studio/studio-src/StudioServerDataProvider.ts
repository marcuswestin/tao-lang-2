import type TR from '@runtime/TR'
import { Assert, Errors } from '@shared/core'

const serverEntity = {
  Checkpoint: 'Checkpoints',
  DesignToken: 'DesignTokens',
  File: 'Files',
  Problem: 'Problems',
  Scenario: 'Scenarios',
  Screen: 'Screens',
  View: 'Views',
} as const

const fields = {
  Checkpoint: ['AfterVersion', 'BeforeVersion', 'Path', 'Status'],
  DesignToken: ['DesignName', 'End', 'Kind', 'Name', 'SourcePath', 'SourceVersion', 'Start', 'Value'],
  File: ['DiagnosticCount', 'Dirty', 'Folder', 'Name', 'ParentPath', 'Path', 'Version'],
  Problem: [
    'EndCharacter',
    'EndLine',
    'Message',
    'ProjectFile',
    'Source',
    'SourcePath',
    'SourceVersion',
    'StartCharacter',
    'StartLine',
  ],
  Scenario: ['Group', 'Name', 'SourcePath', 'SubjectId'],
  Screen: ['Name', 'SourcePath'],
  View: ['Name', 'SourcePath'],
} as const

type StudioEntity = keyof typeof serverEntity
type StudioFillResult = { rows: readonly Readonly<Record<string, unknown>>[] }
type StudioFetch = typeof fetch
type StudioSocket = Pick<WebSocket, 'addEventListener' | 'close'>

export type StudioServerProviderOptions = {
  fetch?: StudioFetch
  openSocket?: (url: string) => StudioSocket
}

/** Connects Tao fills and provider pushes to the live, session-scoped StudioServer boundary. */
export function StudioServerProvider(options: StudioServerProviderOptions = {}): TR.DataProvider {
  const request = options.fetch ?? fetch
  const openSocket = options.openSocket ?? (url => new WebSocket(url))
  return {
    fills: true,
    connect: context => {
      const configuredOrigin = context.configuration['ServerOrigin']
      if (typeof configuredOrigin !== 'string') {
        Errors.throwUserInput("StudioServer configuration 'ServerOrigin' expects text.")
      }
      let snapshot: string | undefined
      return {
        async fill(fillRequest, ops) {
          const entity = fillRequest.descriptor.entity as StudioEntity
          const remote = serverEntity[entity]
          Assert.input(remote, `StudioServer has no entity '${fillRequest.descriptor.entity}'.`)
          const result = await post<StudioFillResult>(request, endpoint(configuredOrigin, '/api/data/fill'), {
            entity: remote,
            where: scalarWhere(fillRequest.descriptor.where),
          })
          ops.upsert(entity, result.rows.map(row => taoRow(entity, row)))
        },
        load: () => snapshot,
        save: value => {
          snapshot = value
        },
        subscribe(observer) {
          let completed = 0
          let lastInvalidationRevision = 0
          let requested = 0
          let running: Promise<void> | undefined
          const refresh = (): void => {
            requested += 1
            running ??= drain()
          }
          const drain = async (): Promise<void> => {
            try {
              while (completed < requested) {
                const revision = requested
                try {
                  snapshot = await completeSnapshot(request, configuredOrigin, context.schema)
                  observer.snapshot(snapshot)
                } catch (error) {
                  observer.error(error)
                }
                completed = revision
              }
            } finally {
              running = undefined
            }
          }
          const socket = openSocket(webSocketEndpoint(configuredOrigin, '/events'))
          socket.addEventListener('message', event => {
            const message = parseMessage(event.data)
            if (
              message?.type === 'data-invalidated'
              && message.revision !== undefined
              // A lower revision identifies a newly created server-side datasource generation.
              // WebSocket delivery is ordered within one generation, so only an equal revision is a duplicate.
              && message.revision !== lastInvalidationRevision
            ) {
              lastInvalidationRevision = message.revision
              refresh()
            }
          })
          socket.addEventListener('error', () => observer.error(new Error('StudioServer event stream disconnected.')))
          return () => socket.close()
        },
      }
    },
  }
}

function taoRow(entity: StudioEntity, row: Readonly<Record<string, unknown>>): Record<string, unknown> {
  return Object.fromEntries([
    ['StableId', row['Id']],
    ...fields[entity].map(field => [field, row[field]] as const),
  ])
}

async function completeSnapshot(
  request: StudioFetch,
  origin: string,
  schema: TR.DataProviderContext['schema'],
): Promise<string> {
  const requestedEntities = new Set<StudioEntity>()
  for (const entity of Object.keys(schema.entities)) {
    if (entity === 'Diagnostic') {
      requestedEntities.add('File')
      continue
    }
    if (entity in serverEntity) {
      requestedEntities.add(entity as StudioEntity)
    }
  }
  const entries = await Promise.all(
    [...requestedEntities].map(async entity => {
      const remote = serverEntity[entity]
      const result = await post<StudioFillResult>(request, endpoint(origin, '/api/data/fill'), { entity: remote })
      return [entity, result.rows] as const
    }),
  )
  const remoteRows = Object.fromEntries(entries) as Partial<
    Record<StudioEntity, readonly Readonly<Record<string, unknown>>[]>
  >
  const rows: Record<string, Readonly<Record<string, unknown>>[]> = {}
  for (const entity of Object.keys(schema.entities)) {
    if (entity === 'Diagnostic') {
      rows[entity] = (remoteRows.File ?? []).flatMap(file =>
        ((file['Diagnostics'] as readonly Readonly<Record<string, unknown>>[] | undefined) ?? []).map(diagnostic => ({
          File: storedId('File', file['Id']),
          Id: storedId('Diagnostic', diagnostic['Id']),
          Message: diagnostic['Message'],
          Source: diagnostic['Source'],
        }))
      )
      continue
    }
    const typed = entity as StudioEntity
    const source = remoteRows[typed]
    Assert.defined(source, `a StudioServer snapshot row set for entity '${entity}'`)
    rows[entity] = source.map(row => ({ Id: storedId(entity, row['Id']), ...taoRow(typed, row) }))
  }
  return JSON.stringify({
    formatVersion: 1,
    nextId: 1,
    rows,
    schemaVersion: schema.schemaVersion ?? 1,
  })
}

function storedId(entity: string, id: unknown): string {
  Assert.is(id, isString, `a stable text Id on every StudioServer ${entity} row`)
  return `${entity}:${id}`
}

function isString(value: unknown): value is string {
  return typeof value === 'string'
}

function scalarWhere(
  where: Readonly<Record<string, boolean | number | string | Readonly<Record<string, unknown>>>>,
): Readonly<Record<string, boolean | number | string>> | undefined {
  const scalar = Object.entries(where).filter((entry): entry is [string, boolean | number | string] =>
    ['boolean', 'number', 'string'].includes(typeof entry[1])
  )
  return scalar.length === 0 ? undefined : Object.fromEntries(scalar)
}

async function post<Result>(request: StudioFetch, path: string, body: unknown): Promise<Result> {
  const response = await request(path, {
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json' },
    method: 'POST',
  })
  const value = await response.json() as Result | { error?: string }
  if (!response.ok) {
    const message = typeof value === 'object' && value !== null && 'error' in value ? value.error : undefined
    Errors.throwHostEnvironment(message ?? `Studio datasource failed (${response.status}).`)
  }
  return value as Result
}

function endpoint(origin: string, path: string): string {
  return origin === '' ? studioSessionPath(path) : `${origin.replace(/\/$/, '')}${path}`
}

function webSocketEndpoint(origin: string, path: string): string {
  const base = origin === ''
    ? ((globalThis as { location?: { href?: string } }).location?.href ?? 'http://127.0.0.1')
    : `${origin.replace(/\/$/, '')}/`
  const url = new URL(endpoint(origin, path), base)
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'
  return url.toString()
}

function studioSessionPath(path: string): string {
  const pathname = (globalThis as { location?: { pathname?: string } }).location?.pathname ?? ''
  const matched = pathname.match(/^\/sessions\/([A-Za-z0-9_-]{1,128})(?:\/|$)/)
  return matched === null ? path : `/sessions/${matched[1]}${path}`
}

function parseMessage(value: unknown): { revision?: number; type?: string } | undefined {
  try {
    const parsed = JSON.parse(String(value)) as unknown
    if (typeof parsed !== 'object' || parsed === null) {
      return undefined
    }
    const record = parsed as Readonly<Record<string, unknown>>
    return {
      ...(typeof record['revision'] === 'number' && Number.isSafeInteger(record['revision'])
        ? { revision: record['revision'] }
        : {}),
      ...(typeof record['type'] === 'string' ? { type: record['type'] } : {}),
    }
  } catch {
    return undefined
  }
}
