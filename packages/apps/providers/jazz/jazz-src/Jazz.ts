import TR from '@runtime/TR'
import { warnContainedFailure } from '@runtime/TR-errors'
import { Assert, Errors, Switch } from '@shared/core'
import { jazzApp, jazzMapping } from './jazz-deployment'

type SDK = Pick<typeof import('jazz-tools/expo'), 'createJazzSession'>
type Session = Awaited<ReturnType<SDK['createJazzSession']>>
type Db = NonNullable<ReturnType<Session['getSnapshot']>['client']>['db']
type Row = Readonly<Record<string, unknown> & { id: string }>
type Definition = TR.DataSchemaDefinition

const cloudURL = 'https://v2.sync.jazz.tools/'

function address(configuration: Readonly<Record<string, unknown>>): Readonly<{ appId: string; serverUrl: string }> {
  const appId = configuration['AppId']
  const serverUrl = configuration['ServerURL'] ?? cloudURL
  Assert.input(
    typeof appId === 'string' && appId.trim().length > 0,
    'Jazz datasource configuration AppId expects non-empty text.',
  )
  Assert.input(
    typeof serverUrl === 'string' && /^https?:\/\//.test(serverUrl),
    'Jazz datasource configuration ServerURL expects an HTTP URL.',
  )
  return { appId: appId.trim(), serverUrl }
}

function accountId(db: Db): string {
  const id = db.getAuthState().session?.user.account
  Assert.input(typeof id === 'string' && id.length > 0, 'Jazz did not resolve a signed-in account.')
  return id
}

function failure(operation: string, error: unknown): Error {
  if (Errors.isTaoError(error)) {
    return error
  }
  return new Errors.HostEnvironmentError(`Jazz ${operation} failed.`, { cause: error })
}

function project(definition: Definition, tables: Readonly<Record<string, readonly Row[]>>): string {
  const mapping = jazzMapping(definition)
  const rows: Record<string, Record<string, unknown>[]> = {}
  for (const [entity, declaration] of Object.entries(definition.entities)) {
    rows[entity] = (tables[entity] ?? []).map(source => {
      const row: Record<string, unknown> = { Id: source.id }
      for (const [field, shape] of Object.entries(declaration.fields)) {
        const value = source[mapping[entity]!.fields[field]!]
        const zero: Record<string, unknown> = {
          boolean: false,
          number: 0,
          text: '',
          time: 0,
          relation: null,
        }
        row[field] = value ?? shape.defaultValue ?? (shape.optional ? null : zero[shape.kind])
      }
      return row
    })
  }
  return JSON.stringify({ formatVersion: 1, nextId: 1, rows, schemaVersion: definition.schemaVersion ?? 1 })
}

function mappedFields(
  definition: Definition,
  entity: string,
  fields: Readonly<Record<string, unknown>>,
): Record<string, unknown> {
  const map = jazzMapping(definition)[entity]!
  return Object.fromEntries(Object.entries(fields).map(([field, value]) => [map.fields[field]!, value]))
}

/** JazzProvider binds Clerk's verified identity to Jazz Cloud and persists Tao rows individually. */
export function JazzProvider(loadSDK: () => Promise<SDK> = () => import('jazz-tools/expo')): TR.DataProvider {
  return {
    testNetwork: 'remote',
    authenticate: async context => {
      Assert.input(context.provider === 'Clerk', 'Jazz accepts IdentityToken proofs from Clerk.')
      const config = address(context.configuration)
      const proof = await context.proof('IdentityToken', context.signal)
      const sdk = await loadSDK()
      const session = await sdk.createJazzSession(config)
      try {
        await session.loginOrRegisterJWT({
          getToken: async () => {
            const fresh = await context.proof('IdentityToken', context.signal)
            Assert.input(
              fresh.issuer === proof.issuer && fresh.subject === proof.subject,
              'The signed-in identity changed; sign in again to access Jazz data.',
            )
            return fresh.token
          },
        })
        const db = session.getSnapshot().client?.db
        Assert.input(db !== undefined, 'Jazz could not open the signed-in account.')
        const id = accountId(db)
        const identity = db.getAuthState().session?.user.identity
        Assert.input(
          identity?.issuer === proof.issuer && identity.subject === proof.subject,
          'Jazz resolved a different identity; check the Clerk JWT issuer and subject.',
        )
        const table = jazzApp(context.schema)[jazzMapping(context.schema)['Account']!.table]!
        await db.upsert(table, id, {}).wait({ tier: 'global' })
        return {
          accountId: id,
          credential: async signal => (await context.proof('IdentityToken', signal)).token,
          release: async () => {
            await session.close()
          },
        }
      } catch (error) {
        await session.close().catch(cleanup => warnContainedFailure('Jazz authentication cleanup failed.', cleanup))
        throw failure('authentication', error)
      }
    },
    connect: context => {
      Assert.input(context.auth !== undefined, 'Jazz requires a Clerk signed-in account.')
      const auth = context.auth
      const config = address(context.configuration)
      const app = jazzApp(context.schema)
      const mapping = jazzMapping(context.schema)
      let session: Session | undefined
      let db: Db | undefined
      let closed = false
      let observer: TR.DataConnectionObserver | undefined
      let latest: string | undefined
      const stops: (() => void)[] = []
      const tables: Record<string, readonly Row[]> = {}
      let pendingLoad: Promise<string> | undefined

      const start = (): Promise<string> => {
        if (pendingLoad !== undefined) {
          return pendingLoad
        }
        pendingLoad = (async () => {
          const sdk = await loadSDK()
          session = await sdk.createJazzSession(config)
          await session.loginOrRegisterJWT({ getToken: () => auth.credential(auth.signal) })
          db = session.getSnapshot().client?.db
          Assert.input(
            db !== undefined && accountId(db) === auth.accountId,
            'Jazz opened a different account; sign in again.',
          )
          if (closed) {
            Errors.throwHostEnvironment('Jazz connection closed during load.')
          }
          const entities = Object.keys(context.schema.entities)
          return await new Promise<string>((resolve, reject) => {
            const publish = (): void => {
              if (Object.keys(tables).length !== entities.length) {
                return
              }
              latest = project(context.schema, tables)
              resolve(latest)
              observer?.snapshot(latest)
            }
            for (const entity of entities) {
              const table = app[mapping[entity]!.table]!
              stops.push(db!.subscribe(table as any, {
                onUpdate: rows => {
                  tables[entity] = rows as Row[]
                  publish()
                },
                onError: error => {
                  reject(failure('subscription', error))
                  observer?.error(failure('subscription', error))
                },
              }, { tier: 'remote' }))
            }
          })
        })().catch(error => {
          throw failure('load', error)
        })
        return pendingLoad
      }

      return {
        load: start,
        save: async (snapshot, intents = [], writeContext) => {
          await start()
          Assert.input(db !== undefined, 'Jazz connection did not open.')
          const previous = writeContext?.previousSnapshot ?? latest
          const operations = TR.DataRows.rowOperations(context.schema, previous, snapshot, intents)
          if (operations.length === 0) {
            return
          }
          const old = previous === undefined ? {} : JSON.parse(previous).rows as Record<string, Row[]>
          try {
            const write = await db.transaction(tx => {
              const insertedLinks = new Set<number>()
              operations.forEach((operation, index) => {
                const table = app[mapping[operation.entity]!.table]!
                Switch.on(operation, 'kind', {
                  update: update => {
                    const fields = mappedFields(context.schema, update.entity, update.fields)
                    const existing = (old[update.entity] ?? []).some(row => (row as any).Id === update.id)
                    if (existing) {
                      tx.update(table, update.id, fields)
                    } else {
                      operations.forEach((candidate, linkIndex) => {
                        if (
                          candidate.kind !== 'link' || candidate.entity !== update.entity || candidate.id !== update.id
                        ) {
                          return
                        }
                        fields[mapping[candidate.entity]!.fields[candidate.field]!] = candidate.target
                        insertedLinks.add(linkIndex)
                      })
                      tx.upsert(table, update.id, fields)
                    }
                  },
                  delete: deleted => {
                    tx.delete(table, deleted.id)
                  },
                  link: linked => {
                    if (!insertedLinks.has(index)) {
                      tx.update(table, linked.id, { [mapping[linked.entity]!.fields[linked.field]!]: linked.target })
                    }
                  },
                  unlink: unlinked => {
                    tx.update(table, unlinked.id, { [mapping[unlinked.entity]!.fields[unlinked.field]!]: null })
                  },
                })
              })
            })
            await write.wait({ tier: 'global' })
            latest = snapshot
          } catch (error) {
            throw failure('save', error)
          }
        },
        subscribe: current => {
          observer = current
          return () => {
            if (observer === current) {
              observer = undefined
            }
          }
        },
        close: () => {
          closed = true
          observer = undefined
          for (const stop of stops.splice(0)) {
            stop()
          }
          if (session !== undefined) {
            void session.close().catch(error => warnContainedFailure('Jazz connection cleanup failed.', error))
          }
        },
      }
    },
  }
}
