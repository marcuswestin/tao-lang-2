import { Assert, CLI, Errors, FS, HCI, Repo } from '@shared'

/*
 * Disposable checkouts for the admission experiment, and nothing else.
 *
 * Ten lanes need ten checkouts, and this machine routinely carries more than thirty worktrees that
 * belong to other agents and to Ro. So the rule this module exists to enforce is that the experiment
 * creates its own and removes only those: every path is built under one run-scoped root, the paths
 * are remembered as they are created rather than rediscovered afterwards, and removal refuses any
 * path that is not under the root this run made. A cleanup that globs or scans is how somebody
 * else's work gets deleted, and a cleanup session on this machine has done exactly that before.
 *
 * Provisioning is three deterministic steps — `git worktree add --detach`, then `./agent setup`,
 * then the lane runs — measured on 2026-09-21. A fresh worktree needs no `direnv allow` and no
 * separate parser generation: `./agent` reuses the primary checkout's pinned devenv profile, and
 * `setup` brings the rest.
 */

/** The root every path of one run lives under, so removal has a boundary it can check. */
const RUN_ROOT_PREFIX = '/private/tmp/tao-admission'

export type ProvisionedWorktrees = {
  /** The one directory this run created. Nothing outside it is ever removed. */
  runRoot: string
  repositoryRoots: readonly string[]
}

export type WorktreeDependencies = {
  now: () => Date
  /** Removes the run's own root once it is empty, so a run does not leave a directory per attempt. */
  removeDirectory: (path: string) => Promise<void>
  run: (command: string, spec: CLI.CommandSpec) => Promise<CLI.CommandResult>
  sourceRoot: () => string
  writeLine: (line: string) => void
}

/**
 * provisionWorktrees creates `count` detached checkouts of the current HEAD and sets each one up.
 *
 * It cleans up after itself on failure. A half-provisioned run would otherwise leave checkouts that
 * nothing remembers, which is the state this module's whole boundary rule exists to avoid: once the
 * process that made them is gone, no later run can tell them from a worktree somebody is using.
 */
export async function provisionWorktrees(
  count: number,
  dependencies: WorktreeDependencies,
): Promise<ProvisionedWorktrees> {
  Assert.input(count > 0, 'Provisioning needs a positive checkout count.')
  const sourceRoot = dependencies.sourceRoot()
  const stamp = dependencies.now().toISOString().replace(/[:.]/g, '-')
  const runRoot = `${RUN_ROOT_PREFIX}/${stamp}`
  const created: string[] = []

  try {
    for (let index = 1; index <= count; index += 1) {
      const path = `${runRoot}/lane-${index}`
      const added = await dependencies.run('git', {
        args: ['worktree', 'add', '--detach', path, 'HEAD'],
        cwd: sourceRoot,
      })
      if (added.exitCode !== 0) {
        Errors.throwHostEnvironment(`Could not create the experiment checkout at ${path}: ${added.stderr.trim()}`)
      }
      created.push(path)
      dependencies.writeLine(`Provisioned ${path}`)

      const setup = await dependencies.run('./agent', { args: ['setup'], cwd: path })
      if (setup.exitCode !== 0) {
        Errors.throwHostEnvironment(`Setup failed in the experiment checkout at ${path}: ${setup.stderr.trim()}`)
      }
    }
    return { repositoryRoots: created, runRoot }
  } catch (error) {
    await removeWorktrees({ repositoryRoots: created, runRoot }, dependencies)
    throw error
  }
}

/**
 * removeWorktrees removes exactly the checkouts a run created, and reports what it could not remove.
 *
 * A path outside the run's own root is refused rather than skipped quietly: being asked to delete
 * one means the caller has confused two runs, and the next thing it asks for may be somebody's work.
 */
export async function removeWorktrees(
  provisioned: ProvisionedWorktrees,
  dependencies: WorktreeDependencies,
): Promise<readonly string[]> {
  const sourceRoot = dependencies.sourceRoot()
  const left: string[] = []
  for (const path of provisioned.repositoryRoots) {
    Assert(
      path.startsWith(`${provisioned.runRoot}/`),
      `Refusing to remove ${path}: it is not under this run's root ${provisioned.runRoot}.`,
    )
    const removed = await dependencies.run('git', {
      args: ['worktree', 'remove', '--force', path],
      cwd: sourceRoot,
    })
    if (removed.exitCode === 0) {
      dependencies.writeLine(`Removed ${path}`)
    } else {
      left.push(path)
    }
  }
  if (left.length === 0) {
    // `git worktree remove` takes the checkout and leaves the directory that held it, so without
    // this every run leaves one empty stamped directory behind for ever.
    await dependencies.removeDirectory(provisioned.runRoot)
  }
  return left
}

export const defaultWorktreeDependencies: WorktreeDependencies = {
  now: () => new Date(),
  removeDirectory: FS.remove,
  run: CLI.run,
  sourceRoot: () => Repo.getRoot(),
  writeLine: HCI.writeLine,
}
