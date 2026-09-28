import { CLI, Errors, FS, HCI, Repo, Switch } from '@shared'

/**
 * Storage keeps the `storage` submodule, where development evidence such as QA screenshots is
 * archived, on its own `main`. Runs commit and push there and never bump the commit this repository
 * records for the submodule, so concurrent worktrees never conflict over it; `.gitmodules` sets
 * `ignore = all` to keep the moving checkout out of `git status`. Only `pin` moves that record, and
 * only when someone deliberately asks it to.
 */

const submodulePath = 'storage'
const qaStore = 'qa'
const pushAttempts = 3
const listedNames = 10

const storageActions = ['sync', 'qa', 'push', 'pin'] as const

type StorageAction = (typeof storageActions)[number]
type QaOptions = {
  app?: string[]
  appearance?: string[]
  device?: string[]
  note?: string
  scenario?: string[]
  studio?: boolean
}

/** QaRun is the part of a `qa-run.json` the commit message reads. */
type QaRun = {
  appearances: readonly string[]
  apps: readonly string[]
  devices: readonly string[]
  note?: string
  project?: string
  runId: string
  selection?: readonly string[]
  shots: readonly {
    app?: string
    change?: 'changed' | 'new' | 'unchanged'
    error?: string
    name: string
    status: string
  }[]
  source: { branch: string; commit: string; dirty: boolean; subject: string }
}

function isStorageAction(action: string): action is StorageAction {
  return storageActions.some(candidate => candidate === action)
}

export const Storage = {
  async run(action: string, paths: readonly string[], options: QaOptions): Promise<number> {
    if (!isStorageAction(action)) {
      Errors.throwUserInput(`Unknown storage action ${action}; choose ${storageActions.join(', ')}.`)
    }
    const root = Repo.getRoot()
    return await Switch(action, {
      pin: async () => {
        await pin(root)
        return 0
      },
      push: async () => {
        await push(root)
        return 0
      },
      qa: async () => {
        if (paths.length === 0) {
          Errors.throwUserInput('storage qa requires the Tao project directories to capture.')
        }
        return await qa(root, paths, options)
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

/**
 * qa captures each project as its own run, then archives them together as one commit, so one
 * capture of several projects is one entry in the archive's history.
 */
async function qa(root: string, paths: readonly string[], options: QaOptions): Promise<number> {
  await sync(root)
  const storage = FS.resolvePath(submodulePath, root)
  const pending = await stagedRunIds(storage)
  if (pending.length > 0) {
    HCI.writeErrorLine(`Found ${pending.length} uncommitted runs in ${submodulePath}; commit or remove them first.`)
    return 1
  }
  const repeated = (flag: string, values: readonly string[] | undefined): string[] =>
    (values ?? []).flatMap(value => [flag, value])
  const flags = [
    ...repeated('--app', options.app),
    ...repeated('--scenario', options.scenario),
    ...repeated('--device', options.device),
    ...repeated('--appearance', options.appearance),
    ...(options.note === undefined ? [] : ['--note', options.note]),
  ]
  let exitCode = 0
  for (const [index, path] of paths.entries()) {
    // Studio is one product whatever project it opens, so one project's run carries its shots.
    const studio = options.studio === true && index === 0 ? ['--studio'] : []
    const captured = await tao(root, [
      '_preview',
      'qa',
      path,
      '--screenshot',
      '--dest',
      `${submodulePath}/${qaStore}`,
      ...flags,
      ...studio,
    ])
    exitCode = exitCode === 0 ? captured : exitCode
  }
  const runIds = await stagedRunIds(storage)
  if (runIds.length === 0) {
    HCI.writeErrorLine('The capture recorded nothing to archive.')
    return exitCode === 0 ? 1 : exitCode
  }
  const runs = await Promise.all(
    runIds.map(runId => FS.readJson<QaRun>(FS.resolvePath(`${qaStore}/runs/${runId}/qa-run.json`, storage))),
  )
  await gitOrThrow(storage, ['commit', '--quiet', '-m', qaCommitMessage(runs)])
  HCI.writeLine(
    `Committed ${
      runs.map(run => run.runId).join(', ')
    } in ${submodulePath}; publish with \`./agent unsandboxed storage push\`.`,
  )
  return exitCode
}

/** stagedRunIds stages the store and names the runs it holds that no commit records yet, oldest first. */
async function stagedRunIds(storage: string): Promise<string[]> {
  if (await FS.exists(FS.resolvePath(qaStore, storage))) {
    await gitOrThrow(storage, ['add', '--', qaStore])
  }
  const added = (await gitOrThrow(storage, ['diff', '--cached', '--name-only', '--', `${qaStore}/runs`])).stdout
  return unique(added.split('\n').map(line => line.split('/')[2] ?? '').filter(Boolean)).sort()
}

/**
 * qaCommitMessage summarises the runs of one capture by what changed since each screenshot's previous
 * capture, so the archive's log reads as a history of UI changes rather than of capture sessions.
 */
function qaCommitMessage(runs: readonly QaRun[]): string {
  const shots = runs.flatMap(run => run.shots)
  const named = (change: string): string[] =>
    shots.filter(shot => shot.status === 'captured' && shot.change === change).map(shot => shot.name)
  const changed = named('changed')
  const added = named('new')
  const failed = shots.filter(shot => shot.status !== 'captured')
  const counts = [
    ...(changed.length > 0 ? [`${changed.length} changed`] : []),
    ...(added.length > 0 ? [`${added.length} new`] : []),
    ...(failed.length > 0 ? [`${failed.length} failed`] : []),
  ]
  // A run lists the apps it launched; Studio's own shots name Studio, which no run launches as an app.
  const apps = unique(runs.flatMap(run => [...run.apps, ...run.shots.flatMap(shot => shot.app ?? [])])).join(', ')
  const screenshots = `${shots.length} ${shots.length === 1 ? 'screenshot' : 'screenshots'}`
  const summary = counts.length === 0
    ? `QA ${apps}: no changes across ${screenshots}`
    : `QA ${apps}: ${counts.join(', ')} of ${screenshots}`
  const list = (names: readonly string[]): string =>
    [
      ...names.slice(0, listedNames).map(name => name.replace(/\.png$/u, '')),
      ...(names.length > listedNames ? [`and ${names.length - listedNames} more`] : []),
    ].join(', ')
  const sources = unique(
    runs.map(({ source }) =>
      `- Source: ${source.branch} ${source.commit.slice(0, 8)} ${source.subject}${
        source.dirty ? ' (with uncommitted changes)' : ''
      }`
    ),
  )
  return [
    summary,
    '',
    ...runs.flatMap(run => [
      `- Run: ${run.runId}${run.project === undefined ? '' : ` of ${run.project}`} on ${run.devices.join(', ')} in ${
        run.appearances.join(', ')
      }`,
      ...(run.selection === undefined ? [] : [`- Selection: ${run.selection.join(', ')}`]),
    ]),
    ...sources,
    ...(changed.length > 0 ? [`- Changed: ${list(changed)}`] : []),
    ...(added.length > 0 ? [`- New: ${list(added)}`] : []),
    ...failed.map(shot =>
      `- Failed: ${shot.name.replace(/\.png$/u, '')}${shot.error === undefined ? '' : ` — ${shot.error}`}`
    ),
    ...unique(runs.flatMap(run => run.note ?? [])).map(note => `- Note: ${note}`),
  ].join('\n')
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values)]
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

/**
 * pin records the archive's published head as the commit this repository points `storage` at, in a
 * commit of its own on the current feature branch, and drafts the branch's merge message when it has
 * none, so landing is the one step left. It refuses a head that is not on the archive's `main`,
 * since a pointer to an unpublished commit breaks every fresh checkout's `submodule update`.
 */
async function pin(root: string): Promise<void> {
  const branch = (await git(root, ['symbolic-ref', '--quiet', '--short', 'HEAD'])).stdout.trim()
  if (!branch.startsWith('feat/')) {
    Errors.throwUserInput(
      `Pin from a feat/ branch, not ${branch || 'a detached HEAD'}; run \`./agent start-branch feat/<name>\`.`,
    )
  }
  const staged = (await gitOrThrow(root, ['diff', '--cached', '--name-only'])).stdout.trim()
  if (staged !== '') {
    Errors.throwUserInput(`Commit or unstage what is already staged before pinning ${submodulePath}:\n${staged}`)
  }
  const storage = FS.resolvePath(submodulePath, root)
  if (!await FS.exists(FS.resolvePath('.git', storage))) {
    Errors.throwUserInput(`${submodulePath} is not initialised; run \`./agent unsandboxed storage sync\`.`)
  }
  if ((await gitOrThrow(storage, ['status', '--porcelain'])).stdout.trim() !== '') {
    Errors.throwUserInput(`${submodulePath} has uncommitted changes; commit or remove them first.`)
  }
  const head = (await gitOrThrow(storage, ['rev-parse', 'HEAD'])).stdout.trim()
  const published = await git(storage, ['merge-base', '--is-ancestor', head, 'refs/remotes/origin/main'])
  if (published.exitCode !== 0) {
    Errors.throwUserInput(
      `${submodulePath} ${
        head.slice(0, 8)
      } is not on the archive's main; run \`./agent unsandboxed storage push\` first.`,
    )
  }
  const recorded = (await gitOrThrow(root, ['ls-tree', 'HEAD', submodulePath])).stdout.split(/\s+/u)[2] ?? ''
  if (recorded === head) {
    HCI.writeLine(`${submodulePath} already points at ${head.slice(0, 8)}.`)
    return
  }
  const subject = (await gitOrThrow(storage, ['log', '-1', '--format=%s', head])).stdout.trim()
  const message = pinMessage(head, subject)
  // `ignore = all` makes `git add` skip the submodule, so the pointer is written to the index directly.
  await gitOrThrow(root, ['update-index', '--cacheinfo', `160000,${head},${submodulePath}`])
  await gitOrThrow(root, ['commit', '--quiet', '-m', message])
  const messageFile = FS.resolvePath(`.artifacts/merge/${branch}.msg`, root)
  if (await FS.exists(messageFile)) {
    HCI.writeLine(`Kept ${FS.displayPath(messageFile)}; check it still describes the branch before landing.`)
  } else {
    await FS.writeText(messageFile, `${message}\n`)
  }
  HCI.writeLine(`Pointed ${submodulePath} at ${head.slice(0, 8)}; land with \`./agent unsandboxed land\`.`)
}

/** pinMessage names the archive commit being pointed at by what it recorded. */
function pinMessage(head: string, subject: string): string {
  return [
    `Point the ${submodulePath} submodule at archive commit ${head.slice(0, 8)}`,
    '',
    `- ${subject}`,
  ].join('\n')
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

export const StorageTesting = { pinMessage, qaCommitMessage } as const
