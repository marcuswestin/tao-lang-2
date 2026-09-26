import { Switch } from '@shared'
import type { AccountProtocol } from 'tao-shared/auth'
import { type AccountPolicy, canAccess, rejectAccountRequest, validateAccountRows } from './AccountPolicy'

/** Apply and authorize the complete proposed state identically for each persistence backend. */
export function proposeAccountRows(
  policy: AccountPolicy,
  before: readonly AccountProtocol.Row[],
  operations: readonly AccountProtocol.Operation[],
  accountId: string,
): AccountProtocol.Row[] {
  const proposed = structuredClone([...before])
  const touched = new Set<string>()
  for (const operation of operations) {
    const key = JSON.stringify([operation.entity, operation.id])
    if (touched.has(key)) {
      rejectAccountRequest('invalid', 'Each row may appear once per transaction.')
    }
    touched.add(key)
    const index = proposed.findIndex(row => row.entity === operation.entity && row.id === operation.id)
    Switch.kind(operation, {
      create: value => {
        if (index >= 0) {
          rejectAccountRequest('conflict', 'Row already exists.')
        }
        if (value.entity === policy.accountEntity) {
          rejectAccountRequest('forbidden', 'Accounts require trusted provisioning.')
        }
        proposed.push({ entity: value.entity, id: value.id, fields: value.fields })
      },
      delete: () => {
        if (index < 0) {
          rejectAccountRequest('forbidden', 'Write is not authorized.')
        }
        proposed.splice(index, 1)
      },
      update: value => {
        if (index < 0) {
          rejectAccountRequest('forbidden', 'Write is not authorized.')
        }
        proposed[index] = { ...proposed[index]!, fields: { ...proposed[index]!.fields, ...value.fields } }
      },
    })
  }
  for (const operation of operations) {
    const source = operation.kind === 'delete' ? before : proposed
    const row = source.find(candidate => candidate.entity === operation.entity && candidate.id === operation.id)!
    const changed = operation.kind === 'update' ? Object.keys(operation.fields) : []
    if (
      !canAccess(
        policy,
        operation.kind === 'delete' ? before : proposed,
        row,
        accountId,
        operation.kind,
        changed,
      )
    ) {
      rejectAccountRequest('forbidden', 'Write is not authorized.')
    }
  }
  validateAccountRows(policy, proposed)
  return proposed
}

/** Object field order is transport trivia, while operation and array order remain meaningful. */
export function canonicalJSON(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJSON).join(',')}]`
  }
  if (value !== null && typeof value === 'object') {
    const record = value as Record<string, unknown>
    return `{${
      Object.keys(record).sort().map(key => `${JSON.stringify(key)}:${canonicalJSON(record[key])}`).join(',')
    }}`
  }
  return JSON.stringify(value)
}
