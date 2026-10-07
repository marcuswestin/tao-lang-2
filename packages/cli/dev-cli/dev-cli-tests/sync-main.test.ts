import { CLI, FS } from '@shared'
import { Describe, Expect, initGitTestRepository, mkGitTestDir, Test } from '@shared/test'
import { SyncLocalMainCommand } from '../dev-cli-src/git/SyncLocalMain'

/**
 * Real repositories, as `merge-recovery.test.ts` uses: what this command promises is about refs,
 * indexes, and files moving together or not at all, which a scripted runner could only assert it
 * asked for. Each fixture is a bare `origin`, a checkout cloned from it, and a second clone that
 * pushes one commit to `origin/main` the checkout has not seen — what a GitHub merge leaves.
 */

const IDENTITY = ['-c', 'user.name=Tao Test', '-c', 'user.email=tao@example.test']

type Fixture = { checkout: string; fresh: string; parent: string; stale: string }

async function fixture(): Promise<Fixture> {
  const parent = await mkGitTestDir('tao-sync-main-')
  const seed = FS.resolvePath('seed', parent)
  await initGitTestRepository(seed, { commit: { files: { 'README.md': 'seed\n' }, message: 'seed' } })
  const origin = FS.resolvePath('origin.git', parent)
  await git(parent, ['clone', '--quiet', '--bare', seed, origin])
  const checkout = FS.resolvePath('checkout', parent)
  await git(parent, ['clone', '--quiet', origin, checkout])
  const stale = await git(checkout, ['rev-parse', 'HEAD'])
  const other = FS.resolvePath('other', parent)
  await git(parent, ['clone', '--quiet', origin, other])
  await FS.writeText(FS.resolvePath('merged.md', other), 'merged on GitHub\n')
  await git(other, ['add', 'merged.md'])
  await git(other, [...IDENTITY, 'commit', '--quiet', '--no-verify', '-m', 'merged on GitHub'])
  await git(other, ['push', '--quiet', 'origin', 'main'])
  return { checkout, fresh: await git(other, ['rev-parse', 'HEAD']), parent, stale }
}

async function sync(root: string): Promise<{ lines: string[]; outcome: string }> {
  const lines: string[] = []
  const outcome = await SyncLocalMainCommand.run({ repositoryRoot: root }, {
    run: CLI.run,
    writeLine: line => lines.push(line),
  })
  return { lines, outcome }
}

/** A real run in which the git subcommand `subcommand` fails with `exitCode` and says `stderr`. */
async function syncWithFailing(
  root: string,
  subcommand: string,
  exitCode: number,
  stderr: string,
): Promise<{ lines: string[]; outcome: string }> {
  const lines: string[] = []
  const outcome = await SyncLocalMainCommand.run({ repositoryRoot: root }, {
    run: async (command, spec) =>
      spec?.args?.[0] === subcommand
        ? { ...(await CLI.run(command, spec)), exitCode, stderr, stdout: '' }
        : CLI.run(command, spec),
    writeLine: line => lines.push(line),
  })
  return { lines, outcome }
}

async function git(cwd: string, args: readonly string[]): Promise<string> {
  const result = await CLI.run('git', { args, cwd, stdio: 'pipe' })
  Expect(result.exitCode).toBe(0)
  return result.stdout.trim()
}

Describe('sync-main', () => {
  Test('moves main no worktree holds with update-ref, and a clean main mirror with it', async () => {
    const { checkout, fresh, parent, stale } = await fixture()
    await git(checkout, ['switch', '--quiet', '-c', 'feat/work'])
    const mirror = FS.resolvePath('mirror', parent)
    await git(checkout, ['worktree', 'add', '--quiet', '--detach', mirror, 'main'])

    const { lines, outcome } = await sync(checkout)

    Expect(outcome).toBe('moved')
    Expect(await git(checkout, ['rev-parse', 'refs/heads/main'])).toBe(fresh)
    Expect(await git(checkout, ['rev-parse', '--abbrev-ref', 'HEAD'])).toBe('feat/work')
    Expect(await git(checkout, ['rev-parse', 'HEAD'])).toBe(stale)
    Expect(await git(checkout, ['status', '--porcelain'])).toBe('')
    Expect(await git(mirror, ['rev-parse', 'HEAD'])).toBe(fresh)
    Expect(await FS.exists(FS.resolvePath('merged.md', mirror))).toBe(true)
    Expect(lines).toContain(`PASS  Moved local main from ${stale.slice(0, 8)} to ${fresh.slice(0, 8)}.`)

    // Idempotent and quiet once current.
    Expect(await sync(checkout)).toEqual({ lines: [], outcome: 'current' })
  })

  Test('fast-forwards a clean checkout of main, its files with its ref', async () => {
    const { checkout, fresh } = await fixture()

    const { outcome } = await sync(checkout)

    Expect(outcome).toBe('moved')
    Expect(await git(checkout, ['rev-parse', 'HEAD'])).toBe(fresh)
    Expect(await git(checkout, ['status', '--porcelain'])).toBe('')
    Expect(await FS.readText(FS.resolvePath('merged.md', checkout))).toBe('merged on GitHub\n')
  })

  Test('warns and leaves a checkout of main that has uncommitted changes', async () => {
    const { checkout, stale } = await fixture()
    await FS.writeText(FS.resolvePath('README.md', checkout), 'local edit\n')

    const { lines, outcome } = await sync(checkout)

    Expect(outcome).toBe('dirty')
    Expect(await git(checkout, ['rev-parse', 'HEAD'])).toBe(stale)
    Expect(await FS.readText(FS.resolvePath('README.md', checkout))).toBe('local edit\n')
    Expect(lines.some(line => line.startsWith('WARN  main is checked out at') && line.includes('uncommitted'))).toBe(
      true,
    )
  })

  Test('refuses to move a local main that is not an ancestor of origin/main', async () => {
    const { checkout } = await fixture()
    await git(checkout, ['switch', '--quiet', '-c', 'feat/work'])
    const tree = await git(checkout, ['rev-parse', 'refs/heads/main^{tree}'])
    const local = await git(checkout, [...IDENTITY, 'commit-tree', tree, '-p', 'refs/heads/main', '-m', 'local only'])
    await git(checkout, ['update-ref', 'refs/heads/main', local])

    const { lines, outcome } = await sync(checkout)

    Expect(outcome).toBe('diverged')
    Expect(await git(checkout, ['rev-parse', 'refs/heads/main'])).toBe(local)
    Expect(lines.some(line => line.includes('is not an ancestor of origin/main') && line.includes('refusing'))).toBe(
      true,
    )
  })

  Test('reports a failed ancestry check as a git error, not as divergence', async () => {
    const { checkout, stale } = await fixture()

    const { lines, outcome } = await syncWithFailing(checkout, 'merge-base', 128, 'fatal: Not a valid commit name')

    Expect(outcome).toBe('failed')
    Expect(await git(checkout, ['rev-parse', 'refs/heads/main'])).toBe(stale)
    Expect(lines.some(line => line.startsWith('WARN  Could not compare local main') && line.includes('Not a valid')))
      .toBe(
        true,
      )
    Expect(lines.some(line => line.includes('is not an ancestor'))).toBe(false)
  })

  Test('reports a checkout of main whose status cannot be read as unreadable, with the reason', async () => {
    const { checkout, stale } = await fixture()

    const { lines, outcome } = await syncWithFailing(checkout, 'status', 128, 'fatal: index file corrupt')

    Expect(outcome).toBe('unreadable')
    Expect(await git(checkout, ['rev-parse', 'HEAD'])).toBe(stale)
    Expect(
      lines.some(line =>
        line.startsWith('WARN  Could not read the status of main at') && line.includes('index file corrupt')
      ),
    )
      .toBe(true)
    Expect(lines.some(line => line.includes('uncommitted'))).toBe(false)
  })

  Test('compares with the last fetched origin/main when the fetch fails', async () => {
    const { checkout, parent, stale } = await fixture()
    await git(checkout, ['switch', '--quiet', '-c', 'feat/work'])
    await git(checkout, ['remote', 'set-url', 'origin', FS.resolvePath('gone.git', parent)])

    const { lines, outcome } = await sync(checkout)

    Expect(outcome).toBe('current')
    Expect(await git(checkout, ['rev-parse', 'refs/heads/main'])).toBe(stale)
    Expect(lines.some(line => line.startsWith('WARN  Could not fetch origin/main'))).toBe(true)
  })
})
