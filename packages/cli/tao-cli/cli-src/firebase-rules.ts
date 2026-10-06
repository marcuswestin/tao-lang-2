import { Platform } from '@shared'

// Audited Hosted CRUD rules: the notes path is disjoint from generated /stores paths.
const PILOT_RULES_SHA256 = '9661e9bb5c211d6a007f2e73918aa68cb22a702b5d8e36fbc3bcd99ceec604f4'

/** Preserve only this exact audited policy, adding a generated sibling inside documents. */
export function composeFirebasePilotRules(
  source: string,
  documentMatch: string,
  recorded?: string,
): string | undefined {
  const normalized = source.replaceAll('\r\n', '\n')
  const closing = '  }\n}\n'
  if (Platform.sha256Hex(normalized) === PILOT_RULES_SHA256) {
    return normalized.slice(0, -closing.length) + documentMatch + '\n' + closing
  }
  // A successfully recorded composition retains the exact pilot prefix. Recover that prefix,
  // verify its original fingerprint, then replace only the generated store sibling.
  const storeStart = normalized.indexOf('    match /users/{userId}/stores/{storageKey} {')
  if (source !== recorded || storeStart === -1) {
    return undefined
  }
  const pilot = normalized.slice(0, storeStart) + closing
  if (Platform.sha256Hex(pilot) !== PILOT_RULES_SHA256) {
    return undefined
  }
  return normalized.slice(0, storeStart) + documentMatch + '\n' + closing
}
