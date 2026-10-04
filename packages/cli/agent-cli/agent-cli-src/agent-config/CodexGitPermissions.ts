import { Errors, FS, Platform } from '@shared'
import * as CLI from '@shared/CLI'

type InstallOptions = { root: string; codexHome?: string }
type TomlTable = Record<string, unknown>

const filesystemHeader = '[permissions.tao-workspace.filesystem]'
const permissionPath = ['permissions', 'tao-workspace', 'filesystem'] as const

function table(value: unknown): TomlTable | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as TomlTable
    : undefined
}

function filesystem(config: TomlTable): TomlTable | undefined {
  const permissions = table(config[permissionPath[0]])
  const profile = table(permissions?.[permissionPath[1]])
  return table(profile?.[permissionPath[2]])
}

function parseConfig(source: string, path: string): TomlTable {
  try {
    const parsed = table(Platform.parseToml(source))
    if (parsed !== undefined) {
      return parsed
    }
  } catch {
    // Keep the author-facing error independent of parser internals.
  }
  Errors.throwUserInput(
    `Cannot install Tao Git permissions: ${path} is not valid TOML. Fix it and rerun ./agent setup.`,
  )
}

function plainObject(value: unknown): value is Record<PropertyKey, unknown> {
  if (value === null || typeof value !== 'object') {
    return false
  }
  const prototype: unknown = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

/** Compare parsed TOML values without treating object key insertion order as a setting change. */
function equalToml(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) {
    return true
  }
  if (left instanceof Date && right instanceof Date) {
    return Object.is(left.getTime(), right.getTime())
  }
  if (Array.isArray(left) && Array.isArray(right)) {
    return left.length === right.length && left.every((value, index) => equalToml(value, right[index]))
  }
  if (!plainObject(left) || !plainObject(right)) {
    return false
  }
  const keys = Reflect.ownKeys(left)
  return keys.length === Reflect.ownKeys(right).length
    && keys.every(key => Object.hasOwn(right, key) && equalToml(left[key], right[key]))
}

async function gitDirectory(root: string, args: string[]): Promise<string> {
  const result = await CLI.run('git', { args: ['rev-parse', ...args], cwd: root })
  const path = result.stdout.trim()
  if (result.exitCode !== 0 || !FS.isAbsolute(path) || path.includes('\n')) {
    Errors.throwHostEnvironment(
      `Cannot resolve Git metadata for ${root}: git rev-parse ${args.join(' ')} failed. ${result.stderr.trim()}`,
    )
  }
  try {
    return await FS.realPath(path)
  } catch {
    Errors.throwHostEnvironment(
      `Cannot resolve the real Git metadata directory ${path}. Check this checkout and rerun ./agent setup.`,
    )
  }
}

async function metadata(path: string): Promise<Awaited<ReturnType<typeof FS.entryMetadata>> | undefined> {
  try {
    return await FS.entryMetadata(path)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return undefined
    }
    throw error
  }
}

function nextConfig(source: string, original: TomlTable, paths: string[], path: string): string {
  const current = filesystem(original)
  // Workspace-root globs can restrict any future Git ref or object name. Do not claim that an
  // absolute parent grant preserves a restrictive glob without implementing Codex's matcher.
  const workspaceRestrictions = table(current?.[':workspace_roots'])
  if (Object.values(workspaceRestrictions ?? {}).some(action => action === 'read' || action === 'deny')) {
    Errors.throwUserInput(
      `Cannot install Tao Git permissions: ${path} has restrictive :workspace_roots rules. Resolve their overlap with Git metadata before rerunning ./agent setup.`,
    )
  }
  for (const gitPath of paths) {
    const access = current?.[gitPath]
    if (access !== undefined && access !== 'write') {
      Errors.throwUserInput(
        `Cannot install Tao Git permissions: ${path} already grants ${JSON.stringify(gitPath)} ${
          JSON.stringify(access)
        }. Resolve that rule and rerun ./agent setup.`,
      )
    }
    for (const [rule, action] of Object.entries(current ?? {})) {
      if (action !== 'read' && action !== 'deny') {
        continue
      }
      const base = rule.endsWith('/**') ? rule.slice(0, -3) : rule
      const expanded = base === '~'
        ? FS.homeDir()
        : base.startsWith('~/')
        ? FS.resolvePath(base.slice(2), FS.homeDir())
        : FS.isAbsolute(base)
        ? base
        : undefined
      if (expanded === undefined) {
        continue
      }
      const resolved = FS.existsSync(expanded) ? FS.realPathSync(expanded) : FS.resolvePath(expanded)
      const restrictedDescendant = FS.pathIsWithin(resolved, gitPath)
      const denyingAncestor = action === 'deny' && FS.pathIsWithin(gitPath, resolved)
      if (restrictedDescendant || denyingAncestor) {
        Errors.throwUserInput(
          `Cannot install Tao Git permissions: ${path} already has a conflicting ${JSON.stringify(rule)} = ${
            JSON.stringify(action)
          } rule for ${gitPath}. Resolve it and rerun ./agent setup.`,
        )
      }
    }
  }
  const missing = paths.filter(gitPath => current?.[gitPath] !== 'write')
  if (missing.length === 0) {
    return source
  }

  const lines = source.split(/(?<=\n)/)
  const headerLines = lines.flatMap((line, index) => line.trim() === filesystemHeader ? [index] : [])
  if (headerLines.length > 1 || (current !== undefined && headerLines.length === 0)) {
    Errors.throwUserInput(
      `Cannot install Tao Git permissions: ${path} uses an unsupported layout for ${filesystemHeader}. Use a separate table and rerun ./agent setup.`,
    )
  }
  const additions = missing.map(gitPath => `${JSON.stringify(gitPath)} = "write"\n`).join('')
  let next: string
  if (headerLines.length === 1) {
    const start = headerLines[0]! + 1
    let end = start
    while (end < lines.length && !/^\s*\[/.test(lines[end]!)) {
      end++
    }
    const offset = lines.slice(0, end).join('').length
    const separator = offset > 0 && source[offset - 1] !== '\n' ? '\n' : ''
    next = source.slice(0, offset) + separator + additions + source.slice(offset)
  } else {
    next = source + (source.length > 0 && !source.endsWith('\n') ? '\n' : '')
      + `${filesystemHeader}\n${additions}`
  }

  const parsed = parseConfig(next, path)
  const expected = structuredClone(original)
  const permissions = table(expected['permissions']) ?? (expected['permissions'] = {}) as TomlTable
  const profile = table(permissions['tao-workspace']) ?? (permissions['tao-workspace'] = {}) as TomlTable
  const expectedFilesystem = table(profile['filesystem']) ?? (profile['filesystem'] = {}) as TomlTable
  for (const gitPath of missing) {
    expectedFilesystem[gitPath] = 'write'
  }
  if (!equalToml(parsed, expected)) {
    Errors.throwUserInput(
      `Cannot install Tao Git permissions: the layout in ${path} cannot be safely updated. Use a separate ${filesystemHeader} table and rerun ./agent setup.`,
    )
  }
  return next
}

async function install(options: InstallOptions): Promise<void> {
  const codexHome = options.codexHome ?? Platform.runtimeProcess.env['CODEX_HOME']
    ?? FS.resolvePath('.codex', FS.homeDir())
  if (!FS.isAbsolute(codexHome)) {
    Errors.throwUserInput(`CODEX_HOME must be an absolute directory: ${codexHome}.`)
  }
  const path = FS.resolvePath('config.toml', codexHome)
  try {
    const homeEntry = await metadata(codexHome)
    if (homeEntry === undefined) {
      return // A machine without this harness needs no local grant.
    }
    if (homeEntry.kind !== 'directory') {
      Errors.throwUserInput(
        `Cannot install Tao Git permissions: ${codexHome} must be a real directory, not a symlink or file.`,
      )
    }
    const common = await gitDirectory(options.root, ['--path-format=absolute', '--git-common-dir'])
    const worktree = await gitDirectory(options.root, ['--absolute-git-dir'])
    const paths = [...new Set([common, worktree])]
    const readState = async () => {
      const before = await metadata(path)
      if (before !== undefined && before.kind !== 'file') {
        Errors.throwUserInput(`Cannot install Tao Git permissions: ${path} must be a regular file, not a symlink.`)
      }
      const source = before === undefined ? '' : await FS.readText(path)
      return { before, source, next: nextConfig(source, parseConfig(source, path), paths, path) }
    }
    const initial = await readState()
    if (initial.next === initial.source) {
      return
    }

    await FS.withFileMutationLock(path, codexHome, async () => {
      const { before, source, next } = await readState()
      if (next === source) {
        return
      }
      const stage = await FS.mkTmpDir(FS.resolvePath('.tao-git-permissions-', codexHome))
      try {
        const staged = FS.resolvePath('config.toml', stage)
        const mode = before === undefined ? 0o600 : before.mode & 0o777
        await FS.writeText(staged, next, { mode })
        await FS.chmod(staged, mode)
        const currentHome = await metadata(codexHome)
        const current = await metadata(path)
        if (
          currentHome?.kind !== 'directory' || currentHome.device !== homeEntry.device
          || currentHome.uid !== homeEntry.uid || current?.kind === 'symlink'
          || JSON.stringify(current) !== JSON.stringify(before)
          || (current !== undefined && await FS.readText(path) !== source)
        ) {
          Errors.throwHostEnvironment(
            `Codex config changed while installing Git permissions at ${path}. Rerun ./agent setup.`,
          )
        }
        await FS.move(staged, path)
      } finally {
        await FS.remove(stage)
      }
    })
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    if (code === 'EACCES' || code === 'EPERM') {
      Errors.throwHostEnvironment(
        `Cannot write ${path}. Run ./agent setup on the host, then start a fresh session so the Git permissions take effect.`,
      )
    }
    throw error
  }
}

/** Install exact, machine-local Git metadata grants without changing tracked harness configuration. */
export const CodexGitPermissions = { install }
