import { CLI, Errors, FS } from '@shared'

/**
 * Where an agent harness's worktrees for this repository live: beside the primary checkout, in
 * `<checkout>.worktrees/<name>`, never inside it.
 *
 * A worktree inside the primary checkout is inside every tool's view of that checkout. Watchman is
 * the sharp case: it answers any path under an existing watch with that watch, deliberately, so once
 * anything watches the primary checkout every nested worktree's Metro queries one watch of all of
 * them, and ignoring the worktrees directory there hands those queries an empty file list instead.
 * Keeping worktrees out of the tree is the one arrangement every such tool gets right.
 *
 * The WorktreeCreate hook replaces the harness's own `git worktree add`, so a failure here would
 * stop a session from getting a worktree at all. Anything that prevents the sibling placement falls
 * back to the harness's default placement under `.claude/worktrees/`, which is where worktrees went
 * before, and says why on stderr.
 */

/** The branch a new worktree starts on, as the harness names it by default. */
const BRANCH_PREFIX = 'worktree-'

/** Where the harness puts worktrees by default, used only when the sibling placement fails. */
const FALLBACK_DIRECTORY = '.claude/worktrees'

/** A worktree name the harness hands over: a slug, never a path. */
const NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/

type Git = (args: readonly string[], cwd: string) => Promise<CLI.CommandResult>

const runGit: Git = (args, cwd) => CLI.run('git', { args: [...args], cwd })

/** siblingWorktreeRoot is the directory beside the primary checkout that holds its worktrees. */
export function siblingWorktreeRoot(primaryCheckout: string): string {
  return FS.resolvePath(`${FS.basename(primaryCheckout)}.worktrees`, FS.dirname(primaryCheckout))
}

/** primaryCheckout is the checkout whose `.git` every worktree of `cwd`'s repository shares. */
async function primaryCheckout(cwd: string, git: Git): Promise<string> {
  const common = await git(['rev-parse', '--path-format=absolute', '--git-common-dir'], cwd)
  const commonDir = common.stdout.trim()
  if (common.exitCode !== 0 || FS.basename(commonDir) !== '.git') {
    Errors.throwHostEnvironment(`cannot find the primary checkout from ${cwd}: ${common.stderr.trim() || commonDir}`)
  }
  return await FS.realPath(FS.dirname(commonDir))
}

/** baseRef is what a new worktree branches from: the remote's default branch, as the harness does. */
async function baseRef(primary: string, git: Git): Promise<string> {
  const remoteHead = await git(['symbolic-ref', '--quiet', '--short', 'refs/remotes/origin/HEAD'], primary)
  return remoteHead.exitCode === 0 && remoteHead.stdout.trim() !== '' ? remoteHead.stdout.trim() : 'HEAD'
}

/** registeredWorktrees lists every linked worktree git knows for this repository, symlinks resolved. */
async function registeredWorktrees(primary: string, git: Git): Promise<string[]> {
  const list = await git(['worktree', 'list', '--porcelain'], primary)
  const paths = list.stdout.split('\n').filter(line => line.startsWith('worktree ')).map(line => line.slice(9))
  return await Promise.all(paths.slice(1).map(path => FS.realPath(path).catch(() => path)))
}

/** addWorktree creates `name` under `directory`, or returns the worktree already there. */
async function addWorktree(primary: string, directory: string, name: string, git: Git): Promise<string> {
  const target = FS.resolvePath(name, directory)
  if (await FS.exists(target)) {
    const real = await FS.realPath(target)
    if ((await registeredWorktrees(primary, git)).includes(real)) {
      return real
    }
    Errors.throwHostEnvironment(`${target} exists and is not a worktree of ${primary}`)
  }
  await FS.mkdir(directory)
  const branch = `${BRANCH_PREFIX}${name}`
  const exists = await git(['rev-parse', '--verify', '--quiet', `refs/heads/${branch}`], primary)
  const added = await git(
    exists.exitCode === 0
      ? ['worktree', 'add', target, branch]
      : ['worktree', 'add', '-b', branch, target, await baseRef(primary, git)],
    primary,
  )
  if (added.exitCode !== 0) {
    Errors.throwHostEnvironment(`git worktree add ${target} failed: ${added.stderr.trim()}`)
  }
  return await FS.realPath(target)
}

/**
 * createWorktree places a new worktree for `name` beside the primary checkout and returns its path,
 * falling back to the harness's default placement when the sibling cannot be made.
 */
export async function createWorktree(
  input: { cwd: string; name: string },
  options: { git?: Git; log?: (line: string) => void } = {},
): Promise<string> {
  const git = options.git ?? runGit
  if (!NAME_PATTERN.test(input.name)) {
    Errors.throwUserInput(`'${input.name}' is not a worktree name: expected a slug such as bold-oak-a3f2`)
  }
  const primary = await primaryCheckout(input.cwd, git)
  try {
    return await addWorktree(primary, siblingWorktreeRoot(primary), input.name, git)
  } catch (error) {
    options.log?.(
      `worktree ${input.name}: could not place it beside the checkout (${Errors.asError(error).message}); `
        + `using ${FALLBACK_DIRECTORY}/ instead`,
    )
    return await addWorktree(primary, FS.resolvePath(FALLBACK_DIRECTORY, primary), input.name, git)
  }
}

/**
 * removeWorktree removes a worktree this repository registered, and only when git can do so without
 * losing work: a worktree with changes or untracked files stays, and its branch always does.
 */
export async function removeWorktree(
  input: { cwd: string; worktreePath: string },
  options: { git?: Git } = {},
): Promise<void> {
  const git = options.git ?? runGit
  if (!await FS.exists(input.worktreePath)) {
    return
  }
  // The worktree names its own repository; the hook's cwd is only a fallback for a broken one.
  const primary = await primaryCheckout(input.worktreePath, git).catch(() => primaryCheckout(input.cwd, git))
  const real = await FS.realPath(input.worktreePath)
  if (!(await registeredWorktrees(primary, git)).includes(real)) {
    Errors.throwHostEnvironment(`${input.worktreePath} is not a linked worktree of ${primary}; leaving it in place`)
  }
  const removed = await git(['worktree', 'remove', real], primary)
  if (removed.exitCode !== 0) {
    Errors.throwHostEnvironment(`git kept ${real}: ${removed.stderr.trim()}`)
  }
}
