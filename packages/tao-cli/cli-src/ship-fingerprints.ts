import { AST, Parser } from '@parser'
import { CLI, Errors, FS, Repo } from '@shared'
import { shipInputHash } from './ship-model'

type CommandRunner = typeof CLI.run

/** runtimeFingerprint asks Expo to hash the iOS native closure, excluding copy-only Tao output. */
export async function runtimeFingerprint(runtimeRoot: string, runner: CommandRunner = CLI.run): Promise<string> {
  // ship.json contains the current build number, commit, and marketing version. Those values do not
  // change native compatibility and must not make a later copy-only update look incompatible.
  await FS.remove(FS.resolvePath('_gen_tao-app/ship.json', runtimeRoot))
  const command = FS.resolvePath('node_modules/.bin/fingerprint', runtimeRoot)
  const result = await runner(command, {
    args: ['fingerprint:generate', '--platform', 'ios'],
    cwd: runtimeRoot,
  })
  if (result.error || result.exitCode !== 0) {
    Errors.throwHostEnvironment(`Expo could not compute the iOS runtime fingerprint: ${result.stderr.trim()}`)
  }
  let body: unknown
  try {
    body = JSON.parse(result.stdout)
  } catch (error) {
    Errors.throwHostEnvironment('Expo returned an invalid runtime fingerprint response.', { cause: error })
  }
  if (!isObject(body) || typeof body['hash'] !== 'string' || body['hash'].length === 0) {
    Errors.throwHostEnvironment('Expo returned a runtime fingerprint response without a hash.')
  }
  return body['hash']
}

/** dataSchemaFingerprint hashes only authored entity-data declarations in canonical path order. */
export async function dataSchemaFingerprint(projectRoot: string): Promise<string> {
  const schemas: Array<{ path: string; source: string }> = []
  for (const path of await Repo.filesUnder(projectRoot, { extensions: ['.tao'] })) {
    if (path.endsWith('.test.tao')) {
      continue
    }
    const source = await FS.readText(path)
    const parsed = await Parser.parseCode(source, { validation: false })
    for (const entity of parsed.entry.ast.statements.filter(AST.isEntityDataDeclaration)) {
      const cst = entity.$cstNode
      if (!cst) {
        Errors.throwUnexpected(`Entity data declaration in ${path} has no source location.`)
      }
      schemas.push({ path: FS.relativePath(projectRoot, path), source: source.slice(cst.offset, cst.end) })
    }
  }
  return shipInputHash(schemas.toSorted((left, right) => {
    const byPath = left.path.localeCompare(right.path)
    return byPath === 0 ? left.source.localeCompare(right.source) : byPath
  }))
}

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}
