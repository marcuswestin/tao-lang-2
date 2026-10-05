import { CLI, FS, HCI, Repo } from '@shared'
import { readWatchmanFacts } from '@verification/WatchmanHealth'

const ACTIONS = {
  start: ['--no-local', 'version'],
  status: ['--no-spawn', '--no-local', 'watch-list'],
  stop: ['--no-spawn', '--no-local', 'shutdown-server'],
} as const

/** Use the primary checkout's pinned client so launchd survives linked-worktree cleanup. */
async function run(
  action: string,
  options: {
    readFacts?: typeof readWatchmanFacts
    repositoryRoot?: string
    run?: typeof CLI.run
    stdio?: 'inherit' | 'pipe'
  } = {},
): Promise<number> {
  if (!Object.hasOwn(ACTIONS, action)) {
    HCI.writeErrorLine('Usage: ./agent unsandboxed watchman start|status|stop')
    return 2
  }
  const facts = await (options.readFacts ?? readWatchmanFacts)(options.repositoryRoot ?? Repo.getRoot())
  if (facts.stableClient === undefined) {
    HCI.writeErrorLine('Cannot locate the primary checkout; refusing to manage Watchman from a disposable worktree.')
    return 1
  }
  if (!await FS.isFile(facts.stableClient)) {
    HCI.writeErrorLine(
      `Pinned Watchman is missing: ${facts.stableClient}. Materialize the primary checkout's Nix environment.`,
    )
    return 1
  }
  if (action === 'stop') {
    HCI.writeErrorLine('Stopping the shared Watchman daemon for this user; all worktree subscriptions will disconnect.')
  }
  const result = await (options.run ?? CLI.run)(facts.stableClient, {
    args: [...ACTIONS[action as keyof typeof ACTIONS]],
    stdio: options.stdio ?? 'inherit',
  })
  if (result.error !== undefined) {
    HCI.writeErrorLine(`Watchman ${action} failed: ${result.error.message}`)
  }
  return result.exitCode ?? 1
}

/**
 * startBeforeLoweringPriority starts the shared daemon at this process's priority when a lane needs
 * it off macOS, and reports the start's exit code; it returns undefined when there is nothing to do.
 * Only macOS has launchd start Watchman. Elsewhere the first client forks the daemon, which inherits
 * that client's priority, and Watchman refuses to start below normal priority. A lane must call this
 * before lowering its own priority, or its Studio gates' clients would fork a daemon that refuses.
 */
async function startBeforeLoweringPriority(
  needsWatchman: boolean,
  options: Parameters<typeof run>[1] & { hostPlatform: string },
): Promise<number | undefined> {
  if (!needsWatchman || options.hostPlatform === 'darwin') {
    return undefined
  }
  return await run('start', { ...options, stdio: 'pipe' })
}

export const WatchmanCommand = { run, startBeforeLoweringPriority }
