import { CLI, Errors, FS } from '@shared'

export type ShipGitState = {
  commit: string
  dirty: boolean
  root?: string
}

type GitRunner = typeof CLI.run

export async function inspectShipGit(path: string, runner: GitRunner = CLI.run): Promise<ShipGitState> {
  const rootResult = await runner('git', { args: ['-C', path, 'rev-parse', '--show-toplevel'] })
  if (rootResult.exitCode !== 0) {
    return { commit: 'unversioned', dirty: false }
  }
  const root = rootResult.stdout.trim()
  const [commitResult, statusResult] = await Promise.all([
    runner('git', { args: ['-C', root, 'rev-parse', 'HEAD'] }),
    runner('git', { args: ['-C', root, 'status', '--porcelain=v1'] }),
  ])
  if (commitResult.exitCode !== 0 || statusResult.exitCode !== 0) {
    Errors.throwHostEnvironment(`Git could not inspect ${root}.`)
  }
  return { commit: commitResult.stdout.trim(), dirty: statusResult.stdout.trim().length > 0, root }
}

/** commitShipVersion records only Tao's version and lock writes. */
export async function commitShipVersion(
  state: ShipGitState,
  paths: readonly string[],
  version: string,
  runner: GitRunner = CLI.run,
): Promise<string> {
  if (!state.root) {
    return state.commit
  }
  const relativePaths = await Promise.all(
    paths.map(async path => FS.relativePath(state.root!, await FS.realPath(path))),
  )
  await mustGit(runner, state.root, ['add', '--', ...relativePaths])
  await mustGit(runner, state.root, [
    'commit',
    '-m',
    `Bump app version to ${version}`,
    '-m',
    `- Update the authored Tao project version\n- Record accepted ship metadata and build state`,
  ])
  const result = await mustGit(runner, state.root, ['rev-parse', 'HEAD'])
  return result.stdout.trim()
}

/** commitShipState records Tao-owned accepted metadata or a completed checkpoint. */
export async function commitShipState(
  state: ShipGitState,
  path: string,
  message: string,
  runner: GitRunner = CLI.run,
): Promise<string> {
  if (!state.root) {
    return state.commit
  }
  const relativePath = FS.relativePath(state.root, await FS.realPath(path))
  await mustGit(runner, state.root, ['add', '--', relativePath])
  const staged = await runner('git', { args: ['-C', state.root, 'diff', '--cached', '--quiet', '--exit-code'] })
  if (staged.exitCode === 0) {
    return (await mustGit(runner, state.root, ['rev-parse', 'HEAD'])).stdout.trim()
  }
  if (staged.exitCode !== 1) {
    Errors.throwHostEnvironment(`Git could not inspect the staged ship metadata: ${staged.stderr.trim()}`)
  }
  await mustGit(runner, state.root, ['commit', '-m', message])
  return (await mustGit(runner, state.root, ['rev-parse', 'HEAD'])).stdout.trim()
}

export async function tagShipVersion(
  state: ShipGitState,
  version: string,
  runner: GitRunner = CLI.run,
): Promise<void> {
  if (!state.root) {
    return
  }
  const tag = `v${version}`
  const existing = await runner('git', { args: ['-C', state.root, 'rev-parse', '-q', '--verify', `refs/tags/${tag}`] })
  if (existing.exitCode === 0) {
    const head = await mustGit(runner, state.root, ['rev-parse', 'HEAD'])
    if (existing.stdout.trim() === head.stdout.trim()) {
      return
    }
    Errors.throwUserInput(`Git tag ${tag} already exists at another commit. Choose a new project version.`)
  }
  await mustGit(runner, state.root, ['tag', tag])
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

/** shipSourceMatchesBuild ignores only Tao's post-upload lock checkpoints when considering build reuse. */
export async function shipSourceMatchesBuild(
  state: ShipGitState,
  sourceCommit: string,
  lockPath: string,
  runner: GitRunner = CLI.run,
): Promise<boolean> {
  if (state.dirty) {
    return false
  }
  if (state.commit === sourceCommit) {
    return true
  }
  if (!state.root) {
    return false
  }
  const relativeLockPath = FS.relativePath(state.root, await FS.realPath(lockPath))
  const result = await runner('git', {
    args: [
      '-C',
      state.root,
      'diff',
      '--quiet',
      `${sourceCommit}..HEAD`,
      '--',
      '.',
      `:(exclude)${relativeLockPath}`,
    ],
  })
  return result.exitCode === 0
}

async function mustGit(runner: GitRunner, root: string, args: string[]) {
  const result = await runner('git', { args: ['-C', root, ...args] })
  if (result.error || result.exitCode !== 0) {
    Errors.throwHostEnvironment(`Git failed: ${result.stderr.trim() || result.stdout.trim() || args.join(' ')}`)
  }
  return result
}
