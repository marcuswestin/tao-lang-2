import TR from '@runtime/TR'
import { Assert, Errors } from '@shared/core'
import { ConvexClient } from 'convex/browser'
import { makeFunctionReference } from 'convex/server'
import type { RowOperation } from './backend'

type Client = Pick<ConvexClient, 'close' | 'mutation' | 'onUpdate' | 'query' | 'setAuth'>
type Rows = Record<string, Record<string, unknown>[]>
const ensureAccountFunction = makeFunctionReference<'mutation', {}, string>('tao:ensureAccount')
const listFunction = makeFunctionReference<'query', {}, Rows>('tao:list')
const writeFunction = makeFunctionReference<'mutation', { operations: RowOperation[] }, void>('tao:write')

function address(configuration: Readonly<Record<string, unknown>>): string {
  const value = configuration['DeploymentURL']
  Assert.input(
    typeof value === 'string' && value.trim().length > 0,
    "Convex datasource configuration 'DeploymentURL' expects non-empty text.",
  )
  const url = URL.parse(value.trim())
  Assert.input(
    url !== null && ['http:', 'https:'].includes(url.protocol),
    'Convex DeploymentURL must be an HTTP or HTTPS URL.',
  )
  return url.href.replace(/\/$/, '')
}

function failed(operation: string, cause: unknown): Error {
  return Errors.isTaoError(cause) ? cause : new Errors.HostEnvironmentError(`Convex ${operation} failed.`, { cause })
}

function snapshot(
  schema: TR.DataSchemaDefinition,
  rows: Record<string, Record<string, unknown>[]>,
  previous?: string,
): string {
  const prior = previous === undefined ? undefined : JSON.parse(previous) as { nextId?: number }
  const nextId = Object.values(rows).flat().reduce((next, row) => {
    const match = /-(\d+)$/.exec(String(row['Id']))
    return Math.max(next, match === null ? 1 : Number(match[1]) + 1)
  }, prior?.nextId ?? 1)
  return JSON.stringify({ formatVersion: 1, nextId, rows, schemaVersion: schema.schemaVersion ?? 1 })
}

/** A per-connection Convex client reads authorized rows and writes one row operation batch per save. */
export function ConvexProvider(createClient: (url: string) => Client = url => new ConvexClient(url)): TR.DataProvider {
  return {
    testNetwork: 'remote',
    authenticate: async context => {
      Assert.input(context.provider === 'Clerk', 'Convex accepts IdentityToken proofs from Clerk.')
      Assert.input(
        context.schema.entities['Account'] !== undefined,
        'Convex signs in to an Account; declare it in this datasource.',
      )
      const client = createClient(address(context.configuration))
      try {
        client.setAuth(async () => (await context.proof('IdentityToken', context.signal)).token)
        const accountId = await client.mutation(ensureAccountFunction, {})
        return {
          accountId,
          credential: async signal => (await context.proof('IdentityToken', signal)).token,
          release: async () => {
            await client.close()
          },
        }
      } catch (error) {
        await client.close()
        throw failed('account resolution', error)
      }
    },
    connect: context => {
      const client = createClient(address(context.configuration))
      if (context.auth !== undefined) {
        client.setAuth(async () => context.auth!.signal.aborted ? null : context.auth!.credential(context.auth!.signal))
      }
      let closed = false
      let stop: (() => void) | undefined
      let current: string | undefined
      const ensureActive = (): void => {
        Assert.input(
          !closed && context.auth?.signal.aborted !== true,
          'This Convex data connection is no longer active.',
        )
      }
      return {
        close: () => {
          if (closed) {
            return
          }
          closed = true
          stop?.()
          stop = undefined
          void client.close().catch(() => undefined)
        },
        load: async () => {
          ensureActive()
          try {
            const rows = await client.query(listFunction, {})
            ensureActive()
            current = snapshot(context.schema, rows, current)
            return current
          } catch (error) {
            throw failed('load', error)
          }
        },
        save: async (next, intents = [], writeContext) => {
          ensureActive()
          const operations = TR.DataRows.rowOperations(
            context.schema,
            writeContext?.previousSnapshot ?? current,
            next,
            intents,
          ) as RowOperation[]
          if (operations.length === 0) {
            current = next
            return
          }
          try {
            await client.mutation(writeFunction, { operations })
            ensureActive()
            current = next
          } catch (error) {
            throw failed('save', error)
          }
        },
        subscribe: observer => {
          ensureActive()
          stop?.()
          stop = client.onUpdate(listFunction, {}, value => {
            if (closed) {
              return
            }
            try {
              const next = snapshot(context.schema, value, current)
              if (next !== current) {
                current = next
                observer.snapshot(next)
              }
            } catch (error) {
              observer.error(failed('subscription', error))
            }
          }, error => observer.error(failed('subscription', error)))
          return () => {
            stop?.()
            stop = undefined
          }
        },
      }
    },
  }
}
