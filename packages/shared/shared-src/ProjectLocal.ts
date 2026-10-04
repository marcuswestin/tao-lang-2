import { Errors, Text } from './core/shared-core'
import * as FS from './FS'
import * as Platform from './Platform'

/** ProjectLocal owns committed, durable local, and regenerable state beside a Tao project. */
export const ProjectLocal = { cacheResolve, localResolve, prepare, root, stagingPath, storeResolve }

const IGNORE_FILE_CONTENT = 'local/\ncache/\n'
const LEGACY_IGNORE_START = '# Tao retained legacy entries (managed)\n'
const LEGACY_IGNORE_END = '# End Tao retained legacy entries\n'
const LEGACY_TYPESCRIPT_CONFIG = '{ "extends": "./.tao/typescript/tsconfig.json" }\n'
const TYPESCRIPT_CONFIG = '{ "extends": "./.tao/cache/typescript/tsconfig.json" }\n'

/** root is the project's `.tao/` folder. */
function root(projectRoot: string): string {
  return FS.resolvePath('.tao', projectRoot)
}

/** storeResolve names project state shared with everyone and committed with the project. */
function storeResolve(relativePath: string, projectRoot: string): string {
  return FS.resolvePath(relativePath, FS.resolvePath('store', root(projectRoot)))
}

/** localResolve names durable state belonging to one developer of this project. */
function localResolve(relativePath: string, projectRoot: string): string {
  return FS.resolvePath(relativePath, FS.resolvePath('local', root(projectRoot)))
}

/** cacheResolve names regenerable state, temporary files, and locks. */
function cacheResolve(relativePath: string, projectRoot: string): string {
  return FS.resolvePath(relativePath, FS.resolvePath('cache', root(projectRoot)))
}

/** Stage a fresh file in the project's cache before publishing it to a committed destination. */
function stagingPath(targetPath: string, projectRoot: string): string {
  return cacheResolve(`tmp/${FS.basename(targetPath)}.${Platform.randomUUID()}.tmp`, projectRoot)
}

/** Move recognized older entries once, without replacing conflicting destinations or unknown files. */
async function prepare(projectRoot: string): Promise<void> {
  const project = await FS.realPath(projectRoot)
  const folder = root(project)
  const lockDirectory = cacheResolve('locks', project)
  await FS.mkdirWithinBoundary(lockDirectory, project)
  await FS.mkdirWithinBoundary(cacheResolve('tmp', project), project)
  await FS.withFileMutationLock(folder, project, async () => {
    const rootIgnorePath = FS.resolvePath('.gitignore', project)
    const nestedIgnorePath = FS.resolvePath('.gitignore', folder)
    for (const path of [rootIgnorePath, nestedIgnorePath]) {
      if (await hasLinkedComponent(project, path) || await FS.isDirectory(path)) {
        Errors.throwHostEnvironment(`Cannot migrate the project ignore file at ${path}.`)
      }
    }
    const rootIgnore = await FS.isFile(rootIgnorePath) ? await FS.readText(rootIgnorePath) : ''
    const nestedIgnore = await FS.isFile(nestedIgnorePath) ? await FS.readText(nestedIgnorePath) : ''
    assertRecognizedNestedIgnore(nestedIgnore, nestedIgnorePath)
    const hadLegacyBlanket = rootIgnore.split(/\r?\n/u).includes('.tao/') || nestedIgnore.split(/\r?\n/u).includes('*')
    await FS.mkdirWithinBoundary(storeResolve('', project), project)
    await FS.mkdirWithinBoundary(localResolve('', project), project)
    await migrateOldTao(folder, project)
    await migrateProjectStore(project)
    await migrateGeneratedTypeScriptRootConfig(project)
    const retained = hadLegacyBlanket && !rootIgnore.includes(LEGACY_IGNORE_START)
      ? await retainedLegacyPaths(project)
      : []
    await removeLegacyRootIgnore(project, retained)
    if (!await FS.isFile(nestedIgnorePath) || await FS.readText(nestedIgnorePath) !== IGNORE_FILE_CONTENT) {
      const stagedPath = stagingPath(nestedIgnorePath, project)
      await FS.writeText(stagedPath, IGNORE_FILE_CONTENT)
      await FS.move(stagedPath, nestedIgnorePath)
    }
    const oldPlaceholder = FS.resolvePath('.gitkeep', folder)
    if (
      !await hasLinkedComponent(project, oldPlaceholder) && await FS.isFile(oldPlaceholder)
      && (await FS.readText(oldPlaceholder)).trim() === ''
    ) {
      await FS.remove(oldPlaceholder)
    }
  }, { lockDirectory })
}

/** Replacing a custom nested rule could expose project data that its owner kept private. */
function assertRecognizedNestedIgnore(content: string, path: string): void {
  for (const [index, rawLine] of content.split(/\r?\n/u).entries()) {
    if (rawLine === '' || rawLine.startsWith('#') || ['*', 'local/', 'cache/'].includes(rawLine)) {
      continue
    }
    Errors.throwHostEnvironment(
      `Cannot migrate ${path}: custom ignore rule on line ${
        index + 1
      }. Move custom rules to the project root .gitignore, then retry.`,
    )
  }
}

/** Remove only the old generated rule that hid the entire committed `.tao/` tree. */
async function removeLegacyRootIgnore(project: string, captured: readonly string[]): Promise<void> {
  const ignorePath = FS.resolvePath('.gitignore', project)
  if (await FS.isSymbolicLink(ignorePath) || await FS.isDirectory(ignorePath)) {
    Errors.throwHostEnvironment(`Cannot migrate the project ignore file at ${ignorePath}.`)
  }
  const current = await FS.isFile(ignorePath) ? await FS.readText(ignorePath) : ''
  const previousStart = current.indexOf(LEGACY_IGNORE_START)
  const previousEnd = previousStart < 0 ? -1 : current.indexOf(LEGACY_IGNORE_END, previousStart)
  if (previousStart >= 0 && previousEnd < 0) {
    Errors.throwHostEnvironment(`Incomplete Tao legacy ignore rules at ${ignorePath}.`)
  }
  const withoutManaged = previousEnd < 0
    ? current
    : current.slice(0, previousStart > 0 && current[previousStart - 1] === '\n' ? previousStart - 1 : previousStart)
      + current.slice(previousEnd + LEGACY_IGNORE_END.length)
  const withoutBlanket = withoutManaged.split('\n').filter(line => line !== '.tao/' && line !== '.tao/\r').join('\n')
  const retained = previousEnd < 0
    ? captured
    : current.slice(previousStart + LEGACY_IGNORE_START.length, previousEnd).split('\n').filter(Boolean)
  const updated = retained.length === 0
    ? withoutBlanket
    : `${withoutBlanket}${withoutBlanket.length > 0 ? '\n' : ''}${LEGACY_IGNORE_START}${
      retained.join('\n')
    }\n${LEGACY_IGNORE_END}`
  if (updated === current) {
    return
  }
  const stagedPath = stagingPath(ignorePath, project)
  await FS.writeText(stagedPath, updated)
  await FS.move(stagedPath, ignorePath)
}

/** Capture only entries the older blanket hid and migration could not move. */
async function retainedLegacyPaths(project: string): Promise<string[]> {
  const folder = root(project)
  const paths: string[] = []
  for (const entry of await FS.listDir(folder)) {
    if (['.gitignore', 'store', 'local', 'cache'].includes(entry)) {
      continue
    }
    const path = FS.resolvePath(entry, folder)
    paths.push(
      gitIgnoreLiteral(FS.relativePath(project, path), !await FS.isSymbolicLink(path) && await FS.isDirectory(path)),
    )
  }
  const storeRoot = storeResolve('', project)
  for await (const path of FS.walk(storeRoot, { includeHidden: true })) {
    const relative = FS.relativePath(storeRoot, path)
    if (
      ['lock.jsonc', 'project.json', 'secrets.jsonc', 'studio/sketches.jsonc'].includes(relative)
      && !await FS.isSymbolicLink(path)
    ) {
      continue
    }
    paths.push(gitIgnoreLiteral(FS.relativePath(project, path), false))
  }
  return [...new Set(paths)].sort()
}

/** Quote a literal project path so Git cannot interpret a filename as a pattern. */
function gitIgnoreLiteral(relativePath: string, directory: boolean): string {
  if (/[\r\n]/u.test(relativePath)) {
    Errors.throwHostEnvironment(`Cannot preserve Git ignore coverage for ${JSON.stringify(relativePath)}.`)
  }
  const escaped = relativePath.replace(/[\\*?\[\]#! ]/gu, '\\$&')
  return `/${escaped}${directory ? '/' : ''}`
}

async function migrateOldTao(folder: string, project: string): Promise<void> {
  await moveIfFree(FS.resolvePath('project.json', folder), storeResolve('project.json', project), project)
  await moveIfFree(FS.resolvePath('lock.jsonc', folder), storeResolve('lock.jsonc', project), project)
  await moveIfFree(FS.resolvePath('typescript', folder), cacheResolve('typescript', project), project)
  await moveIfFree(FS.resolvePath('ts-gen-lock', folder), cacheResolve('locks/ts-gen-lock', project), project)
  await moveIfFree(FS.resolvePath('install', folder), cacheResolve('install', project), project)
  await foldSkillsVersion(folder, project)
  await moveIfFree(
    FS.resolvePath('connect-secrets.json', folder),
    localResolve('connect-secrets.json', project),
    project,
  )
  for (const name of ['firebase-connect', 'appwrite-connect', 'connect-run'] as const) {
    await moveIfFree(FS.resolvePath(name, folder), cacheResolve(name, project), project)
  }
  for (
    const [from, to] of [
      ['sessions', 'sessions'],
      ['builds', 'builds'],
    ] as const
  ) {
    await moveIfFree(FS.resolvePath(from, folder), localResolve(to, project), project)
    await moveIfFree(storeResolve(from, project), localResolve(to, project), project)
  }

  await migrateDevData(FS.resolvePath('dev/data', folder), project)
  await migrateDevData(storeResolve('dev-data', project), project)
  for (const name of ['runtime', 'node_modules', 'expo-home'] as const) {
    await moveIfFree(FS.resolvePath(`dev/${name}`, folder), cacheResolve(`dev/${name}`, project), project)
  }
  await moveIfFree(FS.resolvePath('dev/desktop', folder), cacheResolve('dev/desktop-host', project), project)
  await moveIfFree(cacheResolve('dev/desktop', project), cacheResolve('dev/desktop-host', project), project)
  await moveIfFree(FS.resolvePath('dev/logs', folder), cacheResolve('logs', project), project)
  await moveIfFree(cacheResolve('dev/logs', project), cacheResolve('logs', project), project)
  await moveIfFree(
    FS.resolvePath('bridge-check.tsconfig.json', folder),
    cacheResolve('bridge-check/tsconfig.json', project),
    project,
  )
  await moveIfFree(
    cacheResolve('bridge-check.tsconfig.json', project),
    cacheResolve('bridge-check/tsconfig.json', project),
    project,
  )
  await moveIfFree(FS.resolvePath('browser-acceptance', folder), cacheResolve('browser-acceptance', project), project)
  for (
    const path of [FS.resolvePath('dev/data', folder), FS.resolvePath('dev', folder), storeResolve('dev-data', project)]
  ) {
    if (!await hasLinkedComponent(project, path) && await FS.isDirectory(path)) {
      await FS.removeEmptyDirectory(path)
    }
  }
}

async function migrateDevData(from: string, project: string): Promise<void> {
  if (await hasLinkedComponent(project, from) || !await FS.isDirectory(from)) {
    return
  }
  for (const entry of await FS.listDir(from)) {
    const match = /^(.+)-[0-9a-f]{8}$/.exec(entry)
    if (match === null) {
      continue
    }
    await moveIfFree(FS.resolvePath(entry, from), localResolve(`dev-data/${match[1]}`, project), project)
  }
}

async function migrateProjectStore(project: string): Promise<void> {
  const oldRoot = FS.resolvePath('.tao-project', project)
  await moveIfFree(FS.resolvePath('lock.jsonc', oldRoot), storeResolve('lock.jsonc', project), project)
  await moveIfFree(
    FS.resolvePath('studio/sketches.jsonc', oldRoot),
    storeResolve('studio/sketches.jsonc', project),
    project,
  )
  await moveIfFree(FS.resolvePath('secrets/secrets.jsonc', project), storeResolve('secrets.jsonc', project), project)

  await foldSkillsVersion(oldRoot, project)
  const oldStudio = FS.resolvePath('studio', oldRoot)
  if (!await hasLinkedComponent(project, oldStudio) && await FS.isDirectory(oldStudio)) {
    await FS.removeEmptyDirectory(oldStudio)
  }
  if (!await hasLinkedComponent(project, oldRoot) && await FS.isDirectory(oldRoot)) {
    await FS.removeEmptyDirectory(oldRoot)
  }
}

/** Update only the exact root config generated by the older tooling, leaving authored edits untouched. */
async function migrateGeneratedTypeScriptRootConfig(project: string): Promise<void> {
  const path = FS.resolvePath('tsconfig.json', project)
  if (
    await hasLinkedComponent(project, path) || !await FS.isFile(path)
    || await FS.readText(path) !== LEGACY_TYPESCRIPT_CONFIG
  ) {
    return
  }
  const stagedPath = stagingPath(path, project)
  await FS.writeText(stagedPath, TYPESCRIPT_CONFIG)
  await FS.move(stagedPath, path)
}

async function foldSkillsVersion(oldRoot: string, project: string): Promise<void> {
  const skillsPath = FS.resolvePath('skills.version', oldRoot)
  const lockPath = storeResolve('lock.jsonc', project)
  if (
    await hasLinkedComponent(project, skillsPath) || await hasLinkedComponent(project, lockPath)
    || !await FS.isFile(skillsPath)
  ) {
    return
  }
  const version = (await FS.readText(skillsPath)).trim()
  const lock: unknown = await FS.isFile(lockPath)
    ? JSON.parse(Text.stripJsonc(await FS.readText(lockPath)))
    : { schemaVersion: 1 }
  if (typeof lock !== 'object' || lock === null || Array.isArray(lock)) {
    return
  }
  const fields = lock as Record<string, unknown>
  if (fields['skillsVersion'] !== undefined && fields['skillsVersion'] !== version) {
    return
  }
  if (fields['skillsVersion'] === undefined) {
    const stagedPath = stagingPath(lockPath, project)
    await FS.writeJson(stagedPath, { ...fields, skillsVersion: version })
    await FS.move(stagedPath, lockPath)
  }
  await FS.remove(skillsPath)
}

async function moveIfFree(from: string, to: string, project: string): Promise<void> {
  if (await hasLinkedComponent(project, from) || await hasLinkedComponent(project, to) || !await FS.exists(from)) {
    return
  }
  if (!await FS.exists(to)) {
    await FS.move(from, to)
    return
  }
  if (!await FS.isDirectory(from) || !await FS.isDirectory(to)) {
    return
  }
  for (const entry of await FS.listDir(from)) {
    await moveIfFree(FS.resolvePath(entry, from), FS.resolvePath(entry, to), project)
  }
  await FS.removeEmptyDirectory(from)
}

/** Inspect each lexical path component without following a link into another tree. */
async function hasLinkedComponent(project: string, path: string): Promise<boolean> {
  if (!FS.pathIsWithin(path, project)) {
    Errors.throwHostEnvironment(`Project state path escaped ${project}: ${path}.`)
  }
  let current = project
  for (const component of FS.relativePath(project, path).split('/').filter(Boolean)) {
    current = FS.resolvePath(component, current)
    if (await FS.isSymbolicLink(current)) {
      return true
    }
  }
  return false
}
