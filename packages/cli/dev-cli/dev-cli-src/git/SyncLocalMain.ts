import { CLI, Errors, FS, HCI, Repo } from '@shared'
import { parseWorktrees } from '@verification/MergeWithMain'

/*
 * `sync-main` brings local `main` up to fetched `origin/main`, and only ever forward. A landing
 * through GitHub moves `main` on the remote alone, so local `main` fell behind by every merge — 47
 * commits on 2026-10-05 — and everything that reads it (`git log main`, a branch started from it, a
 * merge base) read a stale history. `open-pr`, `merge-pr`, and `land-fix` call this once their
 * change is on `main`; it is also its own command. It moves `main` and nothing else: the person's
 * `just my-sync` (`DeveloperWorkflow`) also merges `main` into the branch in hand, which a landing
 * that has just merged that branch must not do.
 *
 * How the ref moves follows `git-workflow`'s rule for moving a branch ref. When no worktree has
 * `main` checked out, `update-ref` moves the ref alone, guarded by the value it read so a concurrent
 * landing is never overwritten. When one does, the move is `git merge --ff-only` inside it, so its
 * index and files move with the ref, and only when it is clean; a dirty checkout is someone's work
 * and is left where it is. A local `main` that is not an ancestor of `origin/main` is never moved:
 * that is a decision for a person, not a fast-forward. Detached mirrors sitting clean at the old tip
 * are moved forward the way a local landing moves them. Nothing here forces anything, and an
 * up-to-date `main` prints nothing.
 */

const REMOTE = 'origin'
const MAIN = 'main'

/** SyncLocalMainDependencies isolates process and output effects for testing. */
export type SyncLocalMainDependencies = {
  run: (command: string, spec: CLI.CommandSpec) => Promise<CLI.CommandResult>
  writeLine: (line: string) => void
}

const defaultDependencies: SyncLocalMainDependencies = { run: CLI.run, writeLine: HCI.writeLine }

/**
 * SyncLocalMainOutcome is what happened to local `main`: already `current`, `moved` forward, left behind
 * because its checkout is `dirty` or the move `failed`, refused as `diverged`, or `unknown` when
 * there is no `main` or `origin/main` to compare.
 */
export type SyncLocalMainOutcome = 'current' | 'diverged' | 'dirty' | 'failed' | 'moved' | 'unknown'

/** SyncLocalMainCommand is the CLI wiring surface consumed by `dev.ts` and the landing commands. */
export const SyncLocalMainCommand = {
  async run(
    options: { repositoryRoot?: string } = {},
    dependencies: SyncLocalMainDependencies = defaultDependencies,
  ): Promise<SyncLocalMainOutcome> {
    const root = FS.resolvePath(options.repositoryRoot ?? Repo.getRoot())
    const git = (args: readonly string[], cwd = root) => dependencies.run('git', { args, cwd, stdio: 'pipe' })
    const warn = (line: string) => dependencies.writeLine(`WARN  ${line}`)

    const fetched = await git(['fetch', '--quiet', REMOTE, MAIN])
    if (fetched.exitCode !== 0) {
      warn(`Could not fetch ${REMOTE}/${MAIN} (${said(fetched)}); comparing with the last fetched ${REMOTE}/${MAIN}.`)
    }
    const remote = await resolve(git, `refs/remotes/${REMOTE}/${MAIN}`)
    const local = await resolve(git, `refs/heads/${MAIN}`)
    if (remote === undefined || local === undefined) {
      warn(`No ${remote === undefined ? `${REMOTE}/${MAIN}` : `local ${MAIN}`} to compare; left ${MAIN} alone.`)
      return 'unknown'
    }
    if (local === remote) {
      return 'current'
    }
    if ((await git(['merge-base', '--is-ancestor', local, remote])).exitCode !== 0) {
      warn(
        `Local ${MAIN} at ${short(local)} is not an ancestor of ${REMOTE}/${MAIN} at ${short(remote)};`
          + ` refusing to move it. Reconcile it by hand.`,
      )
      return 'diverged'
    }

    const worktrees = parseWorktrees((await git(['worktree', 'list', '--porcelain'])).stdout)
    const checkout = worktrees.find(worktree => worktree.branch === MAIN)
    const outcome = checkout === undefined
      ? await moveRef(git, local, remote, warn)
      : await fastForwardCheckout(git, checkout.path, remote, warn)
    if (outcome !== 'moved') {
      return outcome
    }
    dependencies.writeLine(`PASS  Moved local ${MAIN} from ${short(local)} to ${short(remote)}.`)
    // Mirrors are the detached, clean checkouts at main's old tip that exist to show what main holds.
    for (const mirror of worktrees.filter(worktree => worktree.branch === undefined && worktree.head === local)) {
      if (await status(git, mirror.path) !== '') {
        continue
      }
      const moved = await git(['checkout', '--quiet', '--detach', remote], mirror.path)
      if (moved.exitCode === 0) {
        dependencies.writeLine(`PASS  Moved the ${MAIN} mirror at ${mirror.path} to ${short(remote)}.`)
      } else {
        warn(
          `Could not move the ${MAIN} mirror at ${mirror.path}; refresh it with git -C ${mirror.path} checkout --detach ${MAIN}.`,
        )
      }
    }
    return 'moved'
  },
} as const

/**
 * syncAfterLanding brings local `main` forward once a landing's change is on `origin/main`. The
 * landing has already happened by then, so a sync that throws is reported and never fails it.
 */
export async function syncAfterLanding(sync: () => Promise<unknown>, report: (line: string) => void): Promise<void> {
  report(`Bringing local ${MAIN} up to ${REMOTE}/${MAIN}...`)
  try {
    await sync()
  } catch (error) {
    report(`WARN  Could not bring local ${MAIN} up to date (${Errors.messageOf(error)}); run sync-main.`)
  }
}

type Git = (args: readonly string[], cwd?: string) => Promise<CLI.CommandResult>

/** moveRef moves `main` no worktree holds, refusing if anything moved it since it was read. */
async function moveRef(
  git: Git,
  local: string,
  remote: string,
  warn: (line: string) => void,
): Promise<SyncLocalMainOutcome> {
  const moved = await git([
    'update-ref',
    '-m',
    `sync-main: fast-forward to ${REMOTE}/${MAIN}`,
    `refs/heads/${MAIN}`,
    remote,
    local,
  ])
  if (moved.exitCode !== 0) {
    warn(`Could not move local ${MAIN} (${said(moved)}); left it at ${short(local)}.`)
    return 'failed'
  }
  return 'moved'
}

/** fastForwardCheckout moves `main` where a worktree has it checked out, files and all, if that worktree is clean. */
async function fastForwardCheckout(
  git: Git,
  path: string,
  remote: string,
  warn: (line: string) => void,
): Promise<SyncLocalMainOutcome> {
  if (await status(git, path) !== '') {
    warn(
      `${MAIN} is checked out at ${path} with uncommitted changes; left it behind ${REMOTE}/${MAIN}.`
        + ` Once it is clean: git -C ${path} merge --ff-only ${REMOTE}/${MAIN}`,
    )
    return 'dirty'
  }
  const merged = await git(['merge', '--ff-only', '--quiet', remote], path)
  if (merged.exitCode !== 0) {
    warn(`Could not fast-forward ${MAIN} at ${path} (${said(merged)}).`)
    return 'failed'
  }
  return 'moved'
}

async function resolve(git: Git, ref: string): Promise<string | undefined> {
  const result = await git(['rev-parse', '--verify', '--quiet', ref])
  const sha = result.stdout.trim()
  return result.exitCode === 0 && sha !== '' ? sha : undefined
}

async function status(git: Git, path: string): Promise<string> {
  const result = await git(['status', '--porcelain=v1', '--untracked-files=all'], path)
  // A checkout git cannot read is treated as busy, never as clean.
  return result.exitCode === 0 ? result.stdout : 'unreadable'
}

function said(result: CLI.CommandResult): string {
  return (result.stderr || result.stdout).trim() || `exit ${result.exitCode}`
}

function short(sha: string): string {
  return sha.slice(0, 8)
}
