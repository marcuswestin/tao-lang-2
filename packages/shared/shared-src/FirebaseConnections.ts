import { Errors } from './core/shared-core'
import * as FS from './FS'

/** Public Firebase client settings stored in a project's ignored local connection file. */
export type FirebaseConnection = {
  apiKey: string
  projectId: string
  appId: string
  authDomain?: string
  storageBucket?: string
  messagingSenderId?: string
}

const requiredKeys = ['apiKey', 'projectId', 'appId'] as const
const optionalKeys = ['authDomain', 'storageBucket', 'messagingSenderId'] as const
const allowedKeys = new Set<string>([...requiredKeys, ...optionalKeys])

/** readFirebaseConnections reads only the canonical project-local public configuration. */
export async function readFirebaseConnections(projectRoot: string): Promise<FirebaseConnection | undefined> {
  const taoDirectory = FS.resolvePath('.tao', projectRoot)
  const localDirectory = FS.resolvePath('local', taoDirectory)
  const path = FS.resolvePath('connections.json', localDirectory)
  for (const directory of [taoDirectory, localDirectory]) {
    const kind = await connectionEntryKind(directory)
    if (kind === undefined) {
      return undefined
    }
    if (kind === 'symlink') {
      Errors.throwUserInput(`Firebase connection path ${FS.displayPath(directory)} must not be a symlink.`)
    }
    if (kind !== 'directory') {
      Errors.throwUserInput(`Firebase connection path ${FS.displayPath(directory)} must be a directory.`)
    }
  }
  const kind = await connectionEntryKind(path)
  if (kind === undefined) {
    return undefined
  }
  if (kind === 'symlink') {
    Errors.throwUserInput(`Firebase connection path ${FS.displayPath(path)} must not be a symlink.`)
  }
  if (kind !== 'file') {
    Errors.throwUserInput(`Firebase connection file ${FS.displayPath(path)} must be a JSON file.`)
  }
  let contents: string
  try {
    contents = await FS.readText(path)
  } catch {
    Errors.throwUserInput(`Firebase connection file ${FS.displayPath(path)} could not be read. Check its permissions.`)
  }
  let value: unknown
  try {
    value = JSON.parse(contents)
  } catch {
    Errors.throwUserInput(`Firebase connection file ${FS.displayPath(path)} must contain valid JSON.`)
  }
  if (!isRecord(value)) {
    Errors.throwUserInput(`Firebase connection file ${FS.displayPath(path)} must contain a JSON object.`)
  }
  const firebase = value['firebase']
  if (firebase === undefined) {
    return undefined
  }
  if (!isRecord(firebase)) {
    Errors.throwUserInput(`Firebase settings in ${FS.displayPath(path)} must be a JSON object.`)
  }
  for (const key of Object.keys(firebase)) {
    if (!allowedKeys.has(key)) {
      Errors.throwUserInput(`Firebase settings in ${FS.displayPath(path)} contain an unsupported field.`)
    }
  }
  for (const key of requiredKeys) {
    if (!validString(firebase[key])) {
      Errors.throwUserInput(`Firebase settings in ${FS.displayPath(path)} need a non-empty ${key} string.`)
    }
  }
  for (const key of optionalKeys) {
    if (firebase[key] !== undefined && !validString(firebase[key])) {
      Errors.throwUserInput(`Firebase setting ${key} in ${FS.displayPath(path)} must be a non-empty string.`)
    }
  }
  return firebase as FirebaseConnection
}

async function connectionEntryKind(path: string): Promise<'directory' | 'file' | 'other' | 'symlink' | undefined> {
  try {
    return (await FS.entryMetadata(path)).kind
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return undefined
    }
    Errors.throwUserInput(
      `Firebase connection path ${FS.displayPath(path)} could not be inspected. Check its permissions.`,
    )
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function validString(value: unknown): value is string {
  return typeof value === 'string' && value.trim() !== '' && !/[\u0000-\u001f\u007f]/u.test(value)
}
