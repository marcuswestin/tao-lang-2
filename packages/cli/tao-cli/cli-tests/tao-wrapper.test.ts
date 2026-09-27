import { CLI, FS, Platform, Repo } from '@shared'
import { Describe, Expect, mkTestDir, Test } from '@shared/test'

Describe('repository tao wrapper', () => {
  Test('uses the checkout Bun despite a different Bun on PATH, and fails without its profile', async () => {
    const root = await mkTestDir('tao-wrapper-bun-')
    try {
      const wrapper = FS.resolvePath('tao', root)
      const helper = FS.resolvePath('packages/cli/dev-cli/dev-cli-src/cli/agent-worktree-profile.zsh', root)
      const profileBun = FS.resolvePath('.devenv/profile/bin/bun', root)
      const profileNode = FS.resolvePath('.devenv/profile/bin/node', root)
      const hostBun = FS.resolvePath('host-bin/bun', root)
      await Promise.all([
        FS.copyFile(Repo.resolvePath('tao'), wrapper),
        FS.copyFile(Repo.resolvePath('packages/cli/dev-cli/dev-cli-src/cli/agent-worktree-profile.zsh'), helper),
        FS.writeText(profileBun, '#!/usr/bin/env zsh\nprint -r -- checkout\nprintf "%s\\n" "$@"\n'),
        FS.writeText(profileNode, '#!/usr/bin/env zsh\nprint -r -- node\n'),
        FS.writeText(hostBun, '#!/usr/bin/env zsh\nprint -r -- host\n'),
      ])
      await Promise.all([FS.chmod(profileBun, 0o755), FS.chmod(profileNode, 0o755), FS.chmod(hostBun, 0o755)])

      const env = { PATH: `${FS.resolvePath('host-bin', root)}:${Platform.runtimeProcess.env['PATH'] ?? ''}` }
      const selected = await CLI.run('zsh', { args: [wrapper, 'check', 'two words'], cwd: root, env })
      Expect(selected.exitCode).toBe(0)
      Expect(selected.stdout.trim().split('\n')).toEqual([
        'checkout',
        FS.resolvePath('packages/cli/tao-cli/cli-src/tao-cli.ts', root),
        'check',
        'two words',
      ])

      await FS.remove(profileBun)
      const missing = await CLI.run('zsh', { args: [wrapper, 'check'], cwd: root, env })
      Expect(missing.exitCode).toBe(1)
      Expect(missing.stdout).toBe('')
      Expect(missing.stderr).toContain("Tao's pinned devenv profile is unavailable.")
    } finally {
      await FS.remove(root)
    }
  })
})
