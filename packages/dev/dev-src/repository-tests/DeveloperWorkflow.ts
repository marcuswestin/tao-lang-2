import { CLI, Errors, HCI, Platform, Repo } from '@shared'

const MAIN_BRANCH = 'main'
const REMOTE = 'origin'
const DEV_PREFIX = 'dev/'

/** DeveloperWorkflowDependencies isolates process and terminal effects so the decisions can be proved. */
export type DeveloperWorkflowDependencies = {
  repositoryRoot?: string
  run: (command: string, spec: CLI.CommandSpec) => Promise<CLI.CommandResult>
  writeLine: (line: string) => void
}

/** DeveloperWorkflowResult is the command's terminal output and whether the developer must act. */
export type DeveloperWorkflowResult = {
  conflicted: boolean
  lines: string[]
}

const defaultDependencies: DeveloperWorkflowDependencies = {
  run: CLI.run,
  writeLine: HCI.writeLine,
}

/**
 * These are the human's half of the same rules the landing enforces for agents: work on a branch of
 * your own, never on `main`, and keep `main` a ref that only a landing moves. `dev/<name>` is the
 * human counterpart of `feat/<name>`; both land the same way.
 */
export const DeveloperBranchCommand = {
  /** Switch this checkout to the developer's own branch, creating it from `main` the first time. */
  async run(
    name = '',
    dependencies: DeveloperWorkflowDependencies = defaultDependencies,
  ): Promise<DeveloperWorkflowResult> {
    const root = dependencies.repositoryRoot ?? Repo.getRoot()
    const branch = await developerBranchName(name, root, dependencies)
    const lines: string[] = []
    const current = await currentBranch(root, dependencies)
    if (current === branch) {
      lines.push(`PASS  Already on '${branch}'.`)
      writeAll(dependencies, lines)
      return { conflicted: false, lines }
    }
    const elsewhere = (await worktreesOn(branch, root, dependencies)).filter(path => path !== root)
    if (elsewhere.length > 0) {
      Errors.throwUserInput(
        `'${branch}' is checked out in ${elsewhere.join(', ')}; a branch lives in one worktree at a time.`,
      )
    }
    const exists = (await run(dependencies, root, ['rev-parse', '--verify', '--quiet', `refs/heads/${branch}`]))
      .exitCode === 0
    // Uncommitted work comes along, which is what a person switching branches expects. Git refuses
    // rather than overwriting when it cannot carry it, and that refusal is the right answer.
    const switched = await run(
      dependencies,
      root,
      exists ? ['switch', branch] : ['switch', '--create', branch, MAIN_BRANCH],
    )
    if (switched.exitCode !== 0) {
      throw new Errors.CommandExecutionError(switched)
    }
    lines.push(
      exists ? `PASS  Switched to '${branch}'.` : `PASS  Created '${branch}' from ${MAIN_BRANCH} and switched to it.`,
    )
    if (await status(root, dependencies) !== '') {
      lines.push(`NOTE  Uncommitted changes came with you onto '${branch}'.`)
    }
    writeAll(dependencies, lines)
    return { conflicted: false, lines }
  },
} as const

/**
 * SyncMainCommand brings `main` up to date and merges it into the branch in hand.
 *
 * `main` is never checked out, so catching it up is a ref move rather than a pull, and the mirrors
 * that show what main holds are moved with it. A conflict is left in the working tree exactly as
 * `git merge` leaves it, because finishing it is the developer's call — or `just my-resolve`'s.
 */
export const SyncMainCommand = {
  async run(dependencies: DeveloperWorkflowDependencies = defaultDependencies): Promise<DeveloperWorkflowResult> {
    const root = dependencies.repositoryRoot ?? Repo.getRoot()
    const branch = await currentBranch(root, dependencies)
    if (branch === MAIN_BRANCH) {
      Errors.throwUserInput(
        `This checkout is on '${MAIN_BRANCH}', which nothing may hold: switch to your own branch first `
          + 'with `just my-branch`.',
      )
    }
    if (branch === '') {
      Errors.throwUserInput(
        'This checkout is on a detached HEAD; switch to your own branch first with `just my-branch`.',
      )
    }
    const lines: string[] = []
    await runChecked(dependencies, root, ['fetch', '--prune', REMOTE])
    const mainBefore = await readRef(root, `refs/heads/${MAIN_BRANCH}`, dependencies)
    const remoteMain = await readRef(root, `refs/remotes/${REMOTE}/${MAIN_BRANCH}`, dependencies)
    if (mainBefore === '') {
      Errors.throwUserInput(`This checkout has no local '${MAIN_BRANCH}' to sync.`)
    }
    if (remoteMain !== '' && remoteMain !== mainBefore) {
      const behind = await run(dependencies, root, ['merge-base', '--is-ancestor', mainBefore, remoteMain])
      if (behind.exitCode !== 0) {
        Errors.throwUserInput(
          `Local ${MAIN_BRANCH} (${short(mainBefore)}) holds commits ${REMOTE}/${MAIN_BRANCH} `
            + `(${short(remoteMain)}) does not. Reconcile them deliberately; this command only fast-forwards.`,
        )
      }
      await runChecked(dependencies, root, [
        'update-ref',
        '-m',
        'sync-main: fast-forward to origin',
        `refs/heads/${MAIN_BRANCH}`,
        remoteMain,
        mainBefore,
      ])
      lines.push(`PASS  Moved ${MAIN_BRANCH} to ${short(remoteMain)}.`)
    } else {
      lines.push(`PASS  ${MAIN_BRANCH} is current at ${short(mainBefore)}.`)
    }
    lines.push(...await refreshMirrors(root, dependencies))

    const mainHead = await readRef(root, `refs/heads/${MAIN_BRANCH}`, dependencies)
    const contained = await run(dependencies, root, ['merge-base', '--is-ancestor', mainHead, 'HEAD'])
    if (contained.exitCode === 0) {
      lines.push(`PASS  '${branch}' already contains ${MAIN_BRANCH}.`)
      writeAll(dependencies, lines)
      return { conflicted: false, lines }
    }
    const merged = await run(dependencies, root, ['merge', '--no-edit', MAIN_BRANCH], 'inherit')
    if (merged.exitCode === 0) {
      lines.push(`PASS  Merged ${MAIN_BRANCH} into '${branch}'.`)
      writeAll(dependencies, lines)
      return { conflicted: false, lines }
    }
    const conflicts = await conflictedPaths(root, dependencies)
    if (conflicts.length === 0) {
      throw new Errors.CommandExecutionError(merged)
    }
    lines.push(
      `FAIL  ${MAIN_BRANCH} conflicts with '${branch}' in ${conflicts.length} file(s):`,
      ...conflicts.map(path => `      ${path}`),
      'NEXT  Resolve them yourself and `git commit`, or run `just my-resolve` to hand the merge to an agent.',
    )
    writeAll(dependencies, lines)
    return { conflicted: true, lines }
  },
} as const

/** A mirror is detached, clean, and behind main: a checkout that exists to show what main holds. */
async function refreshMirrors(root: string, dependencies: DeveloperWorkflowDependencies): Promise<string[]> {
  const mainHead = await readRef(root, `refs/heads/${MAIN_BRANCH}`, dependencies)
  const lines: string[] = []
  for (
    const worktree of parseDetachedWorktrees(
      (await run(dependencies, root, ['worktree', 'list', '--porcelain'])).stdout,
    )
  ) {
    if (worktree.head === mainHead) {
      continue
    }
    const behind = await run(dependencies, root, ['merge-base', '--is-ancestor', worktree.head, mainHead])
    if (behind.exitCode !== 0 || await status(worktree.path, dependencies) !== '') {
      continue
    }
    const moved = await run(dependencies, worktree.path, ['checkout', '--detach', mainHead])
    lines.push(
      moved.exitCode === 0
        ? `PASS  Moved the ${MAIN_BRANCH} mirror at ${worktree.path} to ${short(mainHead)}.`
        : `WARN  Could not move the ${MAIN_BRANCH} mirror at ${worktree.path}.`,
    )
  }
  return lines
}

/** parseDetachedWorktrees reads the porcelain listing for worktrees holding no branch. */
export function parseDetachedWorktrees(source: string): Array<{ head: string; path: string }> {
  return source.trim().split(/\n\n+/u).filter(Boolean).flatMap(block => {
    const fields = new Map(
      block.split('\n').map(line => {
        const separator = line.indexOf(' ')
        return separator < 0 ? [line, ''] : [line.slice(0, separator), line.slice(separator + 1)]
      }),
    )
    const path = fields.get('worktree')
    const head = fields.get('HEAD')
    return path === undefined || head === undefined || fields.has('branch') || fields.has('prunable')
      ? []
      : [{ head, path }]
  })
}

/**
 * The branch name, in the order a person would expect to be obeyed: what they typed, then this
 * shell's `TAO_DEV_BRANCH`, then `tao.devBranch` in Git config — the durable way to say it once per
 * machine, `git config --local tao.devBranch dev/<name>` — then their Git identity, then `dev/local`.
 */
async function developerBranchName(
  name: string,
  root: string,
  dependencies: DeveloperWorkflowDependencies,
): Promise<string> {
  const asked = name.trim()
  if (asked !== '') {
    return devBranch(asked)
  }
  const fromEnvironment = (Platform.runtimeProcess.env['TAO_DEV_BRANCH'] ?? '').trim()
  if (fromEnvironment !== '') {
    return devBranch(fromEnvironment)
  }
  const configured = (await run(dependencies, root, ['config', 'tao.devBranch'])).stdout.trim()
  if (configured !== '') {
    return devBranch(configured)
  }
  const identity = (await run(dependencies, root, ['config', 'user.name'])).stdout.trim()
  const fromIdentity = slug(identity.split(/\s+/u)[0] ?? '')
  return `${DEV_PREFIX}${fromIdentity === '' ? 'local' : fromIdentity}`
}

/** A name already under `dev/` is taken as written; anything else becomes `dev/<slug>`. */
function devBranch(name: string): string {
  return name.startsWith(DEV_PREFIX) ? name : `${DEV_PREFIX}${slug(name)}`
}

function slug(value: string): string {
  return value.toLowerCase().replaceAll(/[^a-z0-9._-]+/gu, '-').replace(/^-+|-+$/gu, '')
}

async function currentBranch(root: string, dependencies: DeveloperWorkflowDependencies): Promise<string> {
  const result = await run(dependencies, root, ['symbolic-ref', '--quiet', '--short', 'HEAD'])
  return result.exitCode === 0 ? result.stdout.trim() : ''
}

async function worktreesOn(
  branch: string,
  root: string,
  dependencies: DeveloperWorkflowDependencies,
): Promise<string[]> {
  const listing = (await run(dependencies, root, ['worktree', 'list', '--porcelain'])).stdout
  // Match the branch line exactly: a block's last line has no trailing newline once it is split off,
  // and `refs/heads/dev/ro` is a prefix of `refs/heads/dev/ro-spike`.
  return listing.trim().split(/\n\n+/u).flatMap(block => {
    const lines = block.split('\n').map(line => line.trim())
    const path = lines[0]?.startsWith('worktree ') === true ? lines[0].slice('worktree '.length) : undefined
    return path !== undefined && lines.includes(`branch refs/heads/${branch}`) ? [path] : []
  })
}

async function conflictedPaths(root: string, dependencies: DeveloperWorkflowDependencies): Promise<string[]> {
  const listing = await run(dependencies, root, ['diff', '--name-only', '--diff-filter=U'])
  return listing.stdout.split('\n').map(line => line.trim()).filter(Boolean)
}

async function readRef(
  root: string,
  ref: string,
  dependencies: DeveloperWorkflowDependencies,
): Promise<string> {
  const result = await run(dependencies, root, ['rev-parse', '--verify', '--quiet', ref])
  return result.exitCode === 0 ? result.stdout.trim() : ''
}

async function status(root: string, dependencies: DeveloperWorkflowDependencies): Promise<string> {
  return (await run(dependencies, root, ['status', '--porcelain=v1', '--untracked-files=all'])).stdout.trim()
}

async function run(
  dependencies: DeveloperWorkflowDependencies,
  cwd: string,
  args: readonly string[],
  stdio: CLI.CommandStdio = 'pipe',
): Promise<CLI.CommandResult> {
  return await dependencies.run('git', { args: [...args], cwd, stdio })
}

async function runChecked(
  dependencies: DeveloperWorkflowDependencies,
  cwd: string,
  args: readonly string[],
): Promise<CLI.CommandResult> {
  const result = await run(dependencies, cwd, args)
  if (result.exitCode !== 0 || result.error !== undefined || result.signal !== null) {
    throw new Errors.CommandExecutionError(result)
  }
  return result
}

function writeAll(dependencies: DeveloperWorkflowDependencies, lines: readonly string[]): void {
  for (const line of lines) {
    dependencies.writeLine(line)
  }
}

function short(sha: string): string {
  return sha.slice(0, 12)
}
