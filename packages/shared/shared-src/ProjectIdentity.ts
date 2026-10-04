import { Errors } from './core/shared-core'
import * as FS from './FS'
import { randomUUID } from './Platform'

const MARKER = '.tao/project.json'
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

/** A checked-in identity belongs to a Tao project, independent of its directory or app ID. */
export function read(root: string): string | undefined {
  const path = FS.resolvePath(MARKER, root)
  if (!FS.existsSync(path)) {
    return undefined
  }
  let value: unknown
  try {
    value = JSON.parse(FS.readTextSync(path))
  } catch {
    Errors.throwUserInput(`Invalid Tao project identity in ${path}: expected JSON with a UUID id.`)
  }
  if (
    typeof value !== 'object' || value === null || Array.isArray(value)
    || Object.keys(value).length !== 1 || !('id' in value)
    || typeof value.id !== 'string' || !UUID.test(value.id)
  ) {
    Errors.throwUserInput(`Invalid Tao project identity in ${path}: expected JSON with a UUID id.`)
  }
  return value.id
}

/** Assign a missing identity once; concurrent refreshes observe the same checked-in value. */
export async function ensure(root: string): Promise<string> {
  const projectRoot = FS.resolvePath(root)
  const markerDirectory = FS.resolvePath('.tao', projectRoot)
  if (!await FS.isDirectory(markerDirectory)) {
    Errors.throwUserInput(`No Tao project marker (.tao directory) was found for ${projectRoot}.`)
  }
  const path = FS.resolvePath(MARKER, projectRoot)
  return await FS.withFileMutationLock(path, projectRoot, async () => {
    const existing = read(projectRoot)
    if (existing !== undefined) {
      return existing
    }
    const id = randomUUID()
    await FS.writeJson(path, { id })
    return id
  })
}
