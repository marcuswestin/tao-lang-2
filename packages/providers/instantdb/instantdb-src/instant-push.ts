import { Errors } from '@shared/core'
import type { InstantRules } from './instant-rules'
import type { InstantSchemaJSON } from './instant-schema'

/**
 * Pushes a generated schema and its rules to one InstantDB app over HTTP.
 *
 * Only additive changes are applied. The app's current schema is read first, through the same plan
 * endpoint that would apply the change, and the push stops before changing anything when the plan
 * would do more than add attributes, links, or indexes — or when the app holds attributes the Tao
 * schema no longer declares, which is how a rename or removal looks from here. Those need a
 * person's decision about the stored data, so the refusal names each one and says why.
 */

/** InstantPushTarget names the app, the API that serves it, and the token that may change it. */
export type InstantPushTarget = Readonly<{
  apiURI: string
  appId: string
  fetch?: typeof fetch
  token: string
  /** tokenLabel describes the token in the report, which never carries the token itself. */
  tokenLabel?: string
}>

/** InstantPushStep is one request the push made, as the report shows it. */
export type InstantPushStep = Readonly<{
  authorization: string
  endpoint: string
  method: 'POST'
  purpose: 'apply rules' | 'apply schema' | 'plan schema'
}>

/** InstantPushReport lists the requests made and the additive changes the schema step applied. */
export type InstantPushReport = Readonly<{
  changes: readonly string[]
  steps: readonly InstantPushStep[]
}>

type PlanAttribute = Readonly<{
  catalog?: string
  'forward-identity'?: readonly [string, string, string]
}>

type PlanStep = readonly [string, Readonly<{ 'forward-identity'?: readonly [string, string, string] }>?]

type Plan = Readonly<{
  'current-attrs'?: readonly PlanAttribute[]
  steps?: readonly PlanStep[]
}>

// `add-attr` creates an attribute or link, and `index` indexes one; both leave stored data alone.
const additiveSteps = new Set(['add-attr', 'index'])

/** pushInstantSchema plans, checks, and applies a schema, then applies its rules. */
export async function pushInstantSchema(
  target: InstantPushTarget,
  generated: Readonly<{ rules: InstantRules; schema: InstantSchemaJSON }>,
): Promise<InstantPushReport> {
  const base = target.apiURI.replace(/\/+$/, '')
  const app = encodeURIComponent(target.appId)
  const steps: InstantPushStep[] = []
  const body = { check_types: true, schema: generated.schema, supports_background_updates: true }
  const request = async (purpose: InstantPushStep['purpose'], path: string, payload: unknown): Promise<unknown> => {
    const endpoint = `${base}${path}`
    steps.push({
      authorization: `Bearer ${target.tokenLabel ?? 'app admin token'}`,
      endpoint,
      method: 'POST',
      purpose,
    })
    const send = () =>
      (target.fetch ?? fetch)(endpoint, {
        body: JSON.stringify(payload),
        headers: { authorization: `Bearer ${target.token}`, 'content-type': 'application/json' },
        method: 'POST',
      })
    let response: Response
    try {
      // Every request here is idempotent, so a connection the server dropped before answering (a
      // pooled keep-alive socket it had already closed) is retried once.
      response = await send().catch(() => send())
    } catch (error) {
      return Errors.throwHostEnvironment(`InstantDB ${purpose} could not reach ${endpoint}.`, { cause: error })
    }
    const text = await response.text()
    const parsed = parseJSON(text)
    if (!response.ok) {
      return Errors.throwHostEnvironment(
        `InstantDB ${purpose} at ${endpoint} failed with HTTP ${response.status}${serverMessage(parsed)}.`,
      )
    }
    return parsed
  }

  const plan = await request('plan schema', `/superadmin/apps/${app}/schema/push/plan`, body) as Plan
  const changes = checkAdditive(plan, generated.schema)
  if (changes.length > 0) {
    await request('apply schema', `/superadmin/apps/${app}/schema/push/apply`, body)
  }
  await request('apply rules', `/superadmin/apps/${app}/perms`, { code: generated.rules })
  return { changes, steps }
}

function checkAdditive(plan: Plan, schema: InstantSchemaJSON): string[] {
  const declared = new Set<string>()
  for (const [namespace, entity] of Object.entries(schema.entities)) {
    declared.add(`${namespace}.id`)
    for (const label of Object.keys(entity.attrs)) {
      declared.add(`${namespace}.${label}`)
    }
  }
  for (const link of Object.values(schema.links)) {
    declared.add(`${link.forward.on}.${link.forward.label}`)
  }
  const undeclared = (plan['current-attrs'] ?? []).flatMap(attribute => {
    const identity = attribute['forward-identity']
    if (attribute.catalog !== 'user' || identity === undefined || identity[1].startsWith('$')) {
      return []
    }
    const name = `${identity[1]}.${identity[2]}`
    return declared.has(name) ? [] : [name]
  })
  const changes: string[] = []
  const refused: string[] = []
  for (const [kind, detail] of plan.steps ?? []) {
    const identity = detail?.['forward-identity']
    const name = identity === undefined ? kind : `${kind} ${identity[1]}.${identity[2]}`
    ;(additiveSteps.has(kind) ? changes : refused).push(name)
  }
  if (undeclared.length > 0 || refused.length > 0) {
    Errors.throwUserInput(
      [
        'InstantDB schema push refused: only additive changes are pushed, and applying this schema needs more.',
        ...undeclared.map(name =>
          `- The app stores '${name}', which the Tao schema no longer declares. A renamed or removed field `
          + 'keeps its data on the server; move or delete it in the InstantDB dashboard first.'
        ),
        ...refused.map(name =>
          `- The plan would '${name}', which changes existing attributes or data rather than adding to them.`
        ),
      ].join('\n'),
    )
  }
  return changes
}

function parseJSON(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    return undefined
  }
}

function serverMessage(value: unknown): string {
  const message = typeof value === 'object' && value !== null ? (value as { message?: unknown }).message : undefined
  return typeof message === 'string' && message.trim().length > 0 ? `: ${message.trim().slice(0, 300)}` : ''
}
