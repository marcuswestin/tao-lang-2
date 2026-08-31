import type TR from '@runtime/TR'

const serverEntity = {
  Checkpoint: 'Checkpoints',
  File: 'Files',
  Scenario: 'Scenarios',
  Screen: 'Screens',
  View: 'Views',
} as const

const fields = {
  Checkpoint: ['AfterVersion', 'BeforeVersion', 'Path', 'Status'],
  File: ['DiagnosticCount', 'Dirty', 'Folder', 'Name', 'ParentPath', 'Path', 'Version'],
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
        throw new Error("StudioServer configuration 'ServerOrigin' expects text.")
      }
      let snapshot: string | undefined
      return {
        async fill(fillRequest, ops) {
          const entity = fillRequest.descriptor.entity as StudioEntity
          const remote = serverEntity[entity]
          if (remote === undefined) {
            throw new Error(`StudioServer has no entity '${fillRequest.descriptor.entity}'.`)
          }
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
            if (message?.type === 'data-invalidated') {
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
  const entries = await Promise.all(
    Object.entries(serverEntity).map(async ([entity, remote]) => {
      const result = await post<StudioFillResult>(request, endpoint(origin, '/api/data/fill'), { entity: remote })
      return [entity as StudioEntity, result.rows] as const
    }),
  )
  const remoteRows = Object.fromEntries(entries) as Record<StudioEntity, readonly Readonly<Record<string, unknown>>[]>
  const rows: Record<string, Readonly<Record<string, unknown>>[]> = {}
  for (const entity of Object.keys(schema.entities)) {
    if (entity === 'Diagnostic') {
      rows[entity] = remoteRows.File.flatMap(file =>
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
    if (source === undefined) {
      throw new Error(`StudioServer snapshot cannot populate entity '${entity}'.`)
    }
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
  if (typeof id !== 'string') {
    throw new Error(`StudioServer ${entity} row has no stable text Id.`)
  }
  return `${entity}:${id}`
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
    throw new Error(message ?? `Studio datasource failed (${response.status}).`)
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

function parseMessage(value: unknown): { type?: string } | undefined {
  try {
    const parsed = JSON.parse(String(value)) as unknown
    return typeof parsed === 'object' && parsed !== null ? parsed as { type?: string } : undefined
  } catch {
    return undefined
  }
}
