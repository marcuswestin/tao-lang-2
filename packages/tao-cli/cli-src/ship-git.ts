import { CLI, Errors, FS } from '@shared'
import { shipContentHash } from './ship-model'

export type ShipGitState = {
  commit: string
  dirty: boolean
  dirtyFingerprint?: string
  root?: string
}

export type InspectShipGitOptions = {
  excludePaths?: readonly string[]
}

type GitRunner = typeof CLI.run

/** inspectShipGit records an immutable commit plus an exact content identity for dirty provenance. */
export async function inspectShipGit(
  path: string,
  options: InspectShipGitOptions = {},
  runner: GitRunner = CLI.run,
): Promise<ShipGitState> {
  const rootResult = await runner('git', { args: ['--no-optional-locks', '-C', path, 'rev-parse', '--show-toplevel'] })
  if (rootResult.exitCode !== 0) {
    return { commit: 'unversioned', dirty: false }
  }
  const root = rootResult.stdout.trim()
  const exclusions = await Promise.all(
    options.excludePaths?.map(async item => FS.relativePath(root, await canonicalPotentialPath(item))) ?? [],
  )
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const commitBefore = await gitHead(root, runner)
    const first = await dirtySnapshot(root, exclusions, runner)
    const second = await dirtySnapshot(root, exclusions, runner)
    const commitAfter = await gitHead(root, runner)
    if (commitBefore === commitAfter && first === second) {
      return {
        commit: commitAfter,
        dirty: first !== undefined,
        ...(first === undefined ? {} : { dirtyFingerprint: first }),
        root,
      }
    }
  }
  Errors.throwHostEnvironment(
    'The Git working tree kept changing while tao ship recorded its provenance. Try again once writes settle.',
  )
}

async function gitHead(root: string, runner: GitRunner): Promise<string> {
  const result = await runner('git', { args: ['--no-optional-locks', '-C', root, 'rev-parse', 'HEAD'] })
  if (result.exitCode !== 0) {
    Errors.throwHostEnvironment(`Git could not inspect ${root}.`)
  }
  return result.stdout.trim()
}

async function canonicalPotentialPath(inputPath: string): Promise<string> {
  let existing = FS.resolvePath(inputPath)
  const missingParts: string[] = []
  while (!await FS.exists(existing)) {
    const parent = FS.dirname(existing)
    if (parent === existing) {
      return FS.resolvePath(inputPath)
    }
    missingParts.unshift(FS.basename(existing))
    existing = parent
  }
  return FS.resolvePath(missingParts.join('/'), await FS.realPath(existing))
}

export async function shipNotesSince(
  state: ShipGitState,
  previousCommit?: string,
  runner: GitRunner = CLI.run,
): Promise<string> {
  if (!state.root) {
    return 'New Tao app build.'
  }
  const range = previousCommit ? `${previousCommit}..HEAD` : 'HEAD'
  const result = await runner('git', {
    args: ['-C', state.root, 'log', range, '--format=%s', '--no-merges'],
  })
  return result.exitCode === 0 && result.stdout.trim().length > 0
    ? result.stdout.trim()
    : 'New Tao app build.'
}

/** shipSourceMatchesBuild compares the commit and exact dirty bytes recorded for the built artifact. */
export function shipSourceMatchesBuild(state: ShipGitState, built: ShipGitState): boolean {
  return state.root !== undefined
    && state.commit === built.commit
    && state.dirty === built.dirty
    && state.dirtyFingerprint === built.dirtyFingerprint
}

async function dirtySnapshot(
  root: string,
  exclusions: readonly string[],
  runner: GitRunner,
): Promise<string | undefined> {
  const pathspec = ['--', '.', ...exclusions.map(path => `:(exclude)${path}`)]
  const [status, diff, untracked] = await Promise.all([
    runner('git', {
      args: ['--no-optional-locks', '-C', root, 'status', '--porcelain=v1', '-z', '--untracked-files=all', ...pathspec],
    }),
    runner('git', {
      args: [
        '--no-optional-locks',
        '-C',
        root,
        'diff',
        'HEAD',
        '--binary',
        '--full-index',
        '--no-ext-diff',
        ...pathspec,
      ],
    }),
    runner('git', {
      args: ['--no-optional-locks', '-C', root, 'ls-files', '--others', '--exclude-standard', '-z', ...pathspec],
    }),
  ])
  const failed = [status, diff, untracked].find(result => result.exitCode !== 0)
  if (failed !== undefined) {
    Errors.throwHostEnvironment(
      `Git could not inspect the working tree at ${root}: ${failed.stderr.trim() || failed.stdout.trim()}`,
    )
  }
  if (status.stdout.length === 0) {
    return undefined
  }
  const parts: Array<string | Uint8Array> = ['status\0', status.stdout, '\0diff\0', diff.stdout]
  const untrackedPaths = untracked.stdout.split('\0').filter(Boolean).toSorted()
  for (const relativePath of untrackedPaths) {
    const path = FS.resolvePath(relativePath, root)
    const link = await runner('/usr/bin/readlink', { args: [path] })
    if (link.exitCode === 0) {
      parts.push('\0untracked-symlink\0', relativePath, '\0', link.stdout)
    } else {
      parts.push(
        '\0untracked-file\0',
        relativePath,
        '\0mode\0',
        (await FS.fileMode(path)).toString(8),
        '\0',
        await FS.readFile(path),
      )
    }
  }
  return shipContentHash(parts)
}
