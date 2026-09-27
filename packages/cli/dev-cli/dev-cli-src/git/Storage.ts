import { CLI, Errors, FS, HCI, Repo, Switch } from '@shared'

/**
 * Storage keeps the `storage` submodule, where development evidence such as QA screenshots is
 * archived, on its own `main`. Runs commit and push there and never bump the commit this repository
 * records for the submodule, so concurrent worktrees never conflict over it; `.gitmodules` sets
 * `ignore = all` to keep the moving checkout out of `git status`.
 */

const submodulePath = 'storage'
const qaStore = 'qa'
const pushAttempts = 3
const listedNames = 10

const storageActions = ['sync', 'qa', 'push'] as const

type StorageAction = (typeof storageActions)[number]
type QaOptions = { app?: string[]; appearance?: string[]; device?: string[]; note?: string; scenario?: string[] }

/** QaRun is the part of a `qa-run.json` the commit message reads. */
type QaRun = {
  appearances: readonly string[]
  apps: readonly string[]
  devices: readonly string[]
  note?: string
  runId: string
  selection?: readonly string[]
  shots: readonly { change?: 'changed' | 'new' | 'unchanged'; error?: string; name: string; status: string }[]
  source: { branch: string; commit: string; dirty: boolean; subject: string }
}

function isStorageAction(action: string): action is StorageAction {
  return storageActions.some(candidate => candidate === action)
}

export const Storage = {
  async run(action: string, path: string | undefined, options: QaOptions): Promise<number> {
    if (!isStorageAction(action)) {
      Errors.throwUserInput(`Unknown storage action ${action}; choose ${storageActions.join(', ')}.`)
    }
    const root = Repo.getRoot()
    return await Switch(action, {
      push: async () => {
        await push(root)
        return 0
      },
      qa: async () => {
        if (path === undefined) {
          Errors.throwUserInput('storage qa requires the Tao project directory to capture.')
        }
        return await qa(root, path, options)
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
 * while each file downloads only when checked out, then puts it on `main` at `origin/main`.
 */
async function sync(root: string): Promise<void> {
  const declared = await git(root, ['config', '--file', '.gitmodules', '--get', `submodule.${submodulePath}.path`])
  if (declared.exitCode !== 0) {
    Errors.throwHostEnvironment(`.gitmodules declares no ${submodulePath} submodule.`)
  }
  const storage = FS.resolvePath(submodulePath, root)
  // `submodule update` checks out the recorded commit, which would move an initialised checkout off
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
  if (!await FS.exists(FS.resolvePath(`${submodulePath}/${qaStore}/runs`, root))) {
    return 0
  }
  return await tao(root, ['_preview', 'qa', '--timeline', '--dest', `${submodulePath}/${qaStore}`])
}

async function qa(root: string, path: string, options: QaOptions): Promise<number> {
  await sync(root)
  const repeated = (flag: string, values: readonly string[] | undefined): string[] =>
    (values ?? []).flatMap(value => [flag, value])
  const flags = [
    ...repeated('--app', options.app),
    ...repeated('--scenario', options.scenario),
    ...repeated('--device', options.device),
    ...repeated('--appearance', options.appearance),
    ...(options.note === undefined ? [] : ['--note', options.note]),
  ]
  const exitCode = await tao(root, [
    '_preview',
    'qa',
    path,
    '--screenshot',
    '--dest',
    `${submodulePath}/${qaStore}`,
    ...flags,
  ])
  const storage = FS.resolvePath(submodulePath, root)
  if (await FS.exists(FS.resolvePath(qaStore, storage))) {
    await gitOrThrow(storage, ['add', '--', qaStore])
  }
  const added = (await gitOrThrow(storage, ['diff', '--cached', '--name-only', '--', `${qaStore}/runs`])).stdout
  const runIds = [...new Set(added.split('\n').map(line => line.split('/')[2]).filter(Boolean))]
  if (runIds.length !== 1) {
    HCI.writeErrorLine(
      runIds.length === 0
        ? 'The run recorded nothing to archive.'
        : `Found ${runIds.length} uncommitted runs in ${submodulePath}; commit or remove all but one.`,
    )
    return exitCode === 0 ? 1 : exitCode
  }
  const run = await FS.readJson<QaRun>(FS.resolvePath(`${qaStore}/runs/${runIds[0]}/qa-run.json`, storage))
  await gitOrThrow(storage, ['commit', '--quiet', '-m', qaCommitMessage(run)])
  HCI.writeLine(`Committed run ${run.runId} in ${submodulePath}; publish it with \`./agent unsandboxed storage push\`.`)
  return exitCode
}

/**
 * qaCommitMessage summarises a run by what changed since each screenshot's previous capture, so the
 * archive's log reads as a history of UI changes rather than of capture sessions.
 */
function qaCommitMessage(run: QaRun): string {
  const named = (change: string): string[] =>
    run.shots.filter(shot => shot.status === 'captured' && shot.change === change).map(shot => shot.name)
  const changed = named('changed')
  const added = named('new')
  const failed = run.shots.filter(shot => shot.status !== 'captured')
  const counts = [
    ...(changed.length > 0 ? [`${changed.length} changed`] : []),
    ...(added.length > 0 ? [`${added.length} new`] : []),
    ...(failed.length > 0 ? [`${failed.length} failed`] : []),
  ]
  const apps = run.apps.join(', ')
  const screenshots = `${run.shots.length} ${run.shots.length === 1 ? 'screenshot' : 'screenshots'}`
  const summary = counts.length === 0
    ? `QA ${apps}: no changes across ${screenshots}`
    : `QA ${apps}: ${counts.join(', ')} of ${screenshots}`
  const list = (names: readonly string[]): string =>
    [
      ...names.slice(0, listedNames).map(name => name.replace(/\.png$/u, '')),
      ...(names.length > listedNames ? [`and ${names.length - listedNames} more`] : []),
    ].join(', ')
  const source = run.source
  return [
    summary,
    '',
    `- Run: ${run.runId} on ${run.devices.join(', ')} in ${run.appearances.join(', ')}`,
    ...(run.selection === undefined ? [] : [`- Selection: ${run.selection.join(', ')}`]),
    `- Source: ${source.branch} ${source.commit.slice(0, 8)} ${source.subject}${
      source.dirty ? ' (with uncommitted changes)' : ''
    }`,
    ...(changed.length > 0 ? [`- Changed: ${list(changed)}`] : []),
    ...(added.length > 0 ? [`- New: ${list(added)}`] : []),
    ...failed.map(shot =>
      `- Failed: ${shot.name.replace(/\.png$/u, '')}${shot.error === undefined ? '' : ` — ${shot.error}`}`
    ),
    ...(run.note === undefined ? [] : [`- Note: ${run.note}`]),
  ].join('\n')
}

/** push publishes the submodule's local commits, rebasing over runs other worktrees pushed first. */
async function push(root: string): Promise<void> {
  const storage = FS.resolvePath(submodulePath, root)
  const branch = (await gitOrThrow(storage, ['symbolic-ref', '--quiet', '--short', 'HEAD'])).stdout.trim()
  if (branch !== 'main') {
    Errors.throwUserInput(`${submodulePath} is on ${branch}, not main; run \`./agent unsandboxed storage sync\`.`)
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

export const StorageTesting = { qaCommitMessage } as const
