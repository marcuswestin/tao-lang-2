import { CLI, FS, Platform, Repo } from '@shared'
import { Describe, Expect, Test } from '@shared/test'
import { createWorktree, removeWorktree, siblingWorktreeRoot } from '../agent-cli-src/agent-hooks/WorktreePlacement'

const GIT_IDENTITY = ['-c', 'user.name=Test', '-c', 'user.email=test@example.com']

async function git(cwd: string, ...args: string[]): Promise<CLI.CommandResult> {
  return await CLI.run('git', { args: [...GIT_IDENTITY, ...args], cwd })
}

/** withCheckout runs `body` against a fresh repository with one commit, in a directory of its own. */
async function withCheckout(body: (primary: string, parent: string) => Promise<void>): Promise<void> {
  const parent = await FS.realPath(await FS.mkTmpDir('tao-worktree-placement-'))
  const primary = FS.resolvePath('repo', parent)
  try {
    await FS.mkdir(primary)
    await git(primary, 'init', '-q', '-b', 'main')
    await FS.writeText(FS.resolvePath('README.md', primary), 'fixture\n')
    await git(primary, 'add', 'README.md')
    await git(primary, 'commit', '-q', '-m', 'fixture')
    await body(primary, parent)
  } finally {
    await FS.remove(parent)
  }
}

async function branchOf(worktree: string): Promise<string> {
  return (await git(worktree, 'rev-parse', '--abbrev-ref', 'HEAD')).stdout.trim()
}

Describe('worktree placement', () => {
  Test('creates a worktree beside the checkout, on its own branch, and reuses it by name', async () => {
    await withCheckout(async (primary, parent) => {
      const created = await createWorktree({ cwd: primary, name: 'bold-oak-a3f2' })

      Expect(created).toBe(FS.resolvePath('repo.worktrees/bold-oak-a3f2', parent))
      Expect(FS.pathIsWithin(created, primary)).toBe(false)
      Expect(await branchOf(created)).toBe('worktree-bold-oak-a3f2')
      Expect(await createWorktree({ cwd: primary, name: 'bold-oak-a3f2' })).toBe(created)
    })
  })

  Test('places a worktree requested from inside another worktree beside the primary checkout', async () => {
    await withCheckout(async primary => {
      const first = await createWorktree({ cwd: primary, name: 'first' })
      const second = await createWorktree({ cwd: first, name: 'second' })

      Expect(FS.dirname(second)).toBe(siblingWorktreeRoot(primary))
    })
  })

  Test('falls back to the default placement when the sibling cannot be made, and says why', async () => {
    await withCheckout(async primary => {
      // A file where the sibling directory would go makes the sibling placement impossible.
      await FS.writeText(siblingWorktreeRoot(primary), 'in the way\n')
      const logged: string[] = []

      const created = await createWorktree({ cwd: primary, name: 'fallback' }, { log: line => logged.push(line) })

      Expect(created).toBe(FS.resolvePath('.claude/worktrees/fallback', primary))
      Expect(logged.join('\n')).toContain('could not place it beside the checkout')
    })
  })

  Test('refuses a name that is a path', async () => {
    await withCheckout(async primary => {
      await Expect(createWorktree({ cwd: primary, name: '../escape' })).rejects.toThrow('is not a worktree name')
    })
  })

  Test('removes a clean worktree but keeps its branch, and keeps one holding work', async () => {
    await withCheckout(async primary => {
      const clean = await createWorktree({ cwd: primary, name: 'clean' })
      const dirty = await createWorktree({ cwd: primary, name: 'dirty' })
      await FS.writeText(FS.resolvePath('work.txt', dirty), 'unsaved\n')

      await removeWorktree({ cwd: primary, worktreePath: clean })
      await Expect(removeWorktree({ cwd: primary, worktreePath: dirty })).rejects.toThrow('git kept')

      Expect(await FS.exists(clean)).toBe(false)
      Expect((await git(primary, 'rev-parse', '--verify', '--quiet', 'refs/heads/worktree-clean')).exitCode).toBe(0)
      Expect(await FS.exists(FS.resolvePath('work.txt', dirty))).toBe(true)
    })
  })

  Test('leaves a directory that is not one of its worktrees, and accepts one already gone', async () => {
    await withCheckout(async (primary, parent) => {
      const stranger = FS.resolvePath('stranger', parent)
      await FS.mkdir(stranger)

      await Expect(removeWorktree({ cwd: primary, worktreePath: stranger })).rejects.toThrow('leaving it in place')
      await removeWorktree({ cwd: primary, worktreePath: FS.resolvePath('gone', parent) })

      Expect(await FS.exists(stranger)).toBe(true)
    })
  })

  Test('prints only the path from the hook entry, as the harness reads it', async () => {
    await withCheckout(async primary => {
      const entry = FS.resolvePath(
        'packages/cli/agent-cli/agent-cli-src/agent-hooks/WorktreeHookEntry.ts',
        Repo.getRoot(),
      )
      const result = await CLI.run(Platform.runtimeProcess.execPath, {
        args: ['run', entry, 'create'],
        stdin: JSON.stringify({ cwd: primary, hook_event_name: 'WorktreeCreate', name: 'from-hook' }),
      })

      Expect(result.exitCode).toBe(0)
      Expect(result.stdout.trim()).toBe(FS.resolvePath('from-hook', siblingWorktreeRoot(primary)))
    })
  })

  Test('still makes a worktree where the harness would when no bun is available', async () => {
    await withCheckout(async primary => {
      // The wrapper finds the script from the checkout it runs in, so the fixture carries a copy.
      const script = 'packages/cli/agent-cli/agent-cli-src/cli/agent-worktree.zsh'
      await FS.mkdir(FS.dirname(FS.resolvePath(script, primary)))
      await FS.copyFile(FS.resolvePath(script, Repo.getRoot()), FS.resolvePath(script, primary))
      const result = await CLI.run('/bin/zsh', {
        args: [FS.resolvePath(script, primary), 'create'],
        cwd: primary,
        env: { HOME: Platform.runtimeProcess.env['HOME'] ?? '', PATH: '/usr/bin:/bin' },
        stdin: JSON.stringify({ cwd: primary, name: 'no-bun' }),
      })

      Expect(result.exitCode).toBe(0)
      Expect(result.stdout.trim()).toBe(FS.resolvePath('.claude/worktrees/no-bun', primary))
      Expect(await branchOf(result.stdout.trim())).toBe('worktree-no-bun')
    })
  })
})
