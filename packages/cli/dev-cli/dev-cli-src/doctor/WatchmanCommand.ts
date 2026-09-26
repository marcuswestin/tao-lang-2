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
    stdio: 'inherit',
  })
  if (result.error !== undefined) {
    HCI.writeErrorLine(`Watchman ${action} failed: ${result.error.message}`)
  }
  return result.exitCode ?? 1
}

export const WatchmanCommand = { run }
