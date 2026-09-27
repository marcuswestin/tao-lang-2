import { CLI, Errors, FS, HCI, Repo, Switch } from '@shared'

/**
 * UiArchive keeps the UI screenshot archive, the `storage` submodule, on its own `main`. Captures
 * commit and push there and never bump the commit this repository records for the submodule, so
 * concurrent worktrees never conflict over it; `.gitmodules` sets `ignore = all` to keep the moving
 * checkout out of `git status`.
 */

const submodulePath = 'storage'
const storePath = `${submodulePath}/ui-screenshots`
const pushAttempts = 3

const uiArchiveActions = ['sync', 'capture', 'push'] as const

type UiArchiveAction = (typeof uiArchiveActions)[number]
type CaptureOptions = { app?: string; appearances?: string; devices?: string; note?: string }

function isUiArchiveAction(action: string): action is UiArchiveAction {
  return uiArchiveActions.some(candidate => candidate === action)
}

export const UiArchive = {
  async run(action: string, path: string | undefined, options: CaptureOptions): Promise<number> {
    if (!isUiArchiveAction(action)) {
      Errors.throwUserInput(`Unknown ui-archive action ${action}; choose ${uiArchiveActions.join(', ')}.`)
    }
    const root = Repo.getRoot()
    return await Switch(action, {
      capture: async () => {
        if (path === undefined) {
          Errors.throwUserInput('ui-archive capture requires the Tao project directory to capture.')
        }
        return await capture(root, path, options)
      },
      push: async () => {
        await push(root)
        return 0
      },
      sync: async () => {
        await sync(root)
        return await timeline(root)
      },
    })
  },
} as const

/**
 * sync initialises the submodule as a blobless partial clone, whose commits and trees arrive whole
 * while each screenshot downloads only when checked out, then puts it on `main` at `origin/main`.
 */
async function sync(root: string): Promise<void> {
  const declared = await git(root, ['config', '--file', '.gitmodules', '--get', `submodule.${submodulePath}.path`])
  if (declared.exitCode !== 0) {
    Errors.throwHostEnvironment(`.gitmodules declares no ${submodulePath} submodule.`)
  }
  const storage = FS.resolvePath(submodulePath, root)
  // `submodule update` checks out the recorded commit, which would move an initialised archive off
  // `main`, so it only runs to create the clone.
  if (!await FS.exists(FS.resolvePath('.git', storage))) {
    await gitOrThrow(root, ['submodule', 'update', '--init', '--filter=blob:none', submodulePath])
  }
  await gitOrThrow(storage, ['fetch', 'origin', 'main'])
  const hasMain = await git(storage, ['rev-parse', '--verify', '--quiet', 'refs/heads/main'])
  await gitOrThrow(storage, hasMain.exitCode === 0 ? ['switch', 'main'] : ['switch', '-c', 'main', 'origin/main'])
  await gitOrThrow(storage, ['branch', '--set-upstream-to=origin/main', 'main'])
  await gitOrThrow(storage, ['rebase', 'origin/main'])
  HCI.writeLine(
    `${submodulePath} is on main at ${(await gitOrThrow(storage, ['rev-parse', '--short', 'HEAD'])).stdout.trim()}.`,
  )
}

async function timeline(root: string): Promise<number> {
  if (!await FS.exists(FS.resolvePath(`${storePath}/runs`, root))) {
    return 0
  }
  return await tao(root, ['_preview', 'qa', '--timeline', '--dest', storePath])
}

async function capture(root: string, path: string, options: CaptureOptions): Promise<number> {
  await sync(root)
  const flags = [
    ...(options.app === undefined ? [] : ['--app', options.app]),
    ...(options.devices === undefined ? [] : ['--devices', options.devices]),
    ...(options.appearances === undefined ? [] : ['--appearances', options.appearances]),
    ...(options.note === undefined ? [] : ['--note', options.note]),
  ]
  const exitCode = await tao(root, ['_preview', 'qa', path, '--screenshot', '--dest', storePath, ...flags])
  const storage = FS.resolvePath(submodulePath, root)
  const store = storePath.slice(submodulePath.length + 1)
  if (await FS.exists(FS.resolvePath(store, storage))) {
    await gitOrThrow(storage, ['add', '--', store])
  }
  const staged = await git(storage, ['diff', '--cached', '--quiet'])
  if (staged.exitCode === 0) {
    HCI.writeErrorLine('The capture added nothing to the archive.')
    return exitCode === 0 ? 1 : exitCode
  }
  const commit = (await gitOrThrow(root, ['rev-parse', '--short', 'HEAD'])).stdout.trim()
  const subject = (await gitOrThrow(root, ['log', '-1', '--format=%s'])).stdout.trim()
  await gitOrThrow(storage, [
    'commit',
    '--quiet',
    '-m',
    `Capture ${path} at tao-lang-2 ${commit}`,
    '-m',
    [`- Source: ${subject}`, ...(options.note === undefined ? [] : [`- Note: ${options.note}`])].join('\n'),
  ])
  HCI.writeLine(`Committed the capture in ${submodulePath}; publish it with \`./agent unsandboxed ui-archive push\`.`)
  return exitCode
}

/** push publishes the archive's local commits, rebasing over captures other worktrees pushed first. */
async function push(root: string): Promise<void> {
  const storage = FS.resolvePath(submodulePath, root)
  const branch = (await gitOrThrow(storage, ['symbolic-ref', '--quiet', '--short', 'HEAD'])).stdout.trim()
  if (branch !== 'main') {
    Errors.throwUserInput(`${submodulePath} is on ${branch}, not main; run \`./agent unsandboxed ui-archive sync\`.`)
  }
  for (let attempt = 1; attempt <= pushAttempts; attempt += 1) {
    await gitOrThrow(storage, ['fetch', 'origin', 'main'])
    await gitOrThrow(storage, ['rebase', 'origin/main'])
    const pushed = await git(storage, ['push', 'origin', 'HEAD:main'])
    if (pushed.exitCode === 0) {
      HCI.writeLine(`Pushed ${submodulePath} main.`)
      return
    }
    HCI.writeErrorLine(`Push attempt ${attempt} was rejected: ${pushed.stderr.trim()}`)
  }
  Errors.throwHostEnvironment(`${submodulePath} could not push after ${pushAttempts} attempts.`)
}

async function tao(root: string, args: readonly string[]): Promise<number> {
  const result = await CLI.run('./tao', { args, cwd: root, stdio: 'inherit' })
  if (result.error !== undefined) {
    Errors.throwHostEnvironment(result.error.message)
  }
  return result.exitCode ?? 1
}

async function git(cwd: string, args: readonly string[]): Promise<CLI.CommandResult> {
  return await CLI.run('git', { args, cwd })
}

async function gitOrThrow(cwd: string, args: readonly string[]): Promise<CLI.CommandResult> {
  const result = await git(cwd, args)
  if (result.error !== undefined || result.exitCode !== 0) {
    Errors.throwHostEnvironment(result.stderr.trim() || result.error?.message || `git ${args.join(' ')} failed.`)
  }
  return result
}
