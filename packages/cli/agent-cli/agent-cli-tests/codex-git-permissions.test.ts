import { FS, Platform, Repo } from '@shared'
import * as CLI from '@shared/CLI'
import { Describe, Expect, initGitTestRepository, mkGitTestDir, mkTestDir, Test } from '@shared/test'
import { CodexGitPermissions } from '../agent-cli-src/agent-config/CodexGitPermissions'

async function fixture(): Promise<{ codexHome: string; root: string }> {
  const base = await mkGitTestDir('tao-local-git-root-')
  const root = FS.resolvePath('primary', base)
  await initGitTestRepository(root, { commit: { files: { 'README.md': 'fixture\n' } } })
  const codexHome = FS.resolvePath('.codex', await mkTestDir('tao-local-git-home-'))
  await FS.mkdir(codexHome)
  return { codexHome, root }
}

function filesystems(source: string): Record<string, string> {
  const config = Platform.parseToml(source) as any
  return config.permissions['tao-workspace'].filesystem
}

Describe('CodexGitPermissions', () => {
  Test('preserves existing TOML bytes, comments, unrelated settings, and file mode at two homes', async () => {
    const initial = '# personal settings\nmodel = "local"\n\n[features]\nexperimental = true\n'
    for (const _ of [1, 2]) {
      const { codexHome, root } = await fixture()
      const path = FS.resolvePath('config.toml', codexHome)
      await FS.writeText(path, initial, { mode: 0o640 })
      await CodexGitPermissions.install({ root, codexHome })
      const source = await FS.readText(path)
      Expect(source.startsWith(initial)).toBe(true)
      Expect((Platform.parseToml(source) as any).features.experimental).toBe(true)
      Expect(filesystems(source)[FS.resolvePath('.git', root)]).toBe('write')
      Expect(Object.keys(filesystems(source))).toHaveLength(1)
      Expect(await FS.fileMode(path)).toBe(0o640)
    }
  })

  Test('keeps the existing file mode when the setup process has a restrictive umask', async () => {
    const { codexHome, root } = await fixture()
    const path = FS.resolvePath('config.toml', codexHome)
    await FS.writeText(path, 'model = "personal"\n')
    await FS.chmod(path, 0o640)
    const modulePath = Repo.resolvePath(
      'packages/cli/agent-cli/agent-cli-src/agent-config/CodexGitPermissions.ts',
    )
    const script = `import { CodexGitPermissions } from ${JSON.stringify(modulePath)};`
      + ` await CodexGitPermissions.install(${JSON.stringify({ root, codexHome })});`
    const result = await CLI.run('/bin/sh', {
      args: ['-c', 'umask 077; exec "$1" -e "$2"', 'sh', Platform.runtimeProcess.execPath, script],
      cwd: Repo.getRoot(),
    })
    Expect(result.exitCode).toBe(0)
    Expect(await FS.fileMode(path)).toBe(0o640)
    Expect(filesystems(await FS.readText(path))[FS.resolvePath('.git', root)]).toBe('write')
  })

  Test('adds exact common and linked worktree Git directories, then leaves an installed file untouched', async () => {
    const { codexHome, root } = await fixture()
    const linked = FS.resolvePath('linked', FS.dirname(root))
    const added = await CLI.run('git', { args: ['worktree', 'add', '--quiet', '--detach', linked], cwd: root })
    Expect(added.exitCode).toBe(0)
    try {
      const path = FS.resolvePath('config.toml', codexHome)
      await CodexGitPermissions.install({ root, codexHome })
      const primary = filesystems(await FS.readText(path))
      Expect(Object.keys(primary)).toEqual([FS.resolvePath('.git', root)])

      await CodexGitPermissions.install({ root: linked, codexHome })
      const source = await FS.readText(path)
      const common = (await CLI.run('git', {
        args: ['rev-parse', '--path-format=absolute', '--git-common-dir'],
        cwd: linked,
      })).stdout.trim()
      const own = (await CLI.run('git', { args: ['rev-parse', '--absolute-git-dir'], cwd: linked })).stdout.trim()
      Expect(Object.keys(filesystems(source)).sort()).toEqual([common, own].sort())
      Expect(Object.values(filesystems(source))).toEqual(['write', 'write'])

      const mtime = await FS.modifiedTimeMs(path)
      await CodexGitPermissions.install({ root: linked, codexHome })
      Expect(await FS.readText(path)).toBe(source)
      Expect(await FS.modifiedTimeMs(path)).toBe(mtime)
    } finally {
      await CLI.run('git', { args: ['worktree', 'remove', '--force', linked], cwd: root })
    }
  })

  Test('retains both grants when two checkout setups install concurrently', async () => {
    const first = await fixture()
    const second = await fixture()
    await Promise.all([
      CodexGitPermissions.install({ root: first.root, codexHome: first.codexHome }),
      CodexGitPermissions.install({ root: second.root, codexHome: first.codexHome }),
    ])
    const actual = filesystems(await FS.readText(FS.resolvePath('config.toml', first.codexHome)))
    Expect(Object.keys(actual).sort()).toEqual([
      FS.resolvePath('.git', first.root),
      FS.resolvePath('.git', second.root),
    ].sort())
  })

  Test('skips an absent harness home without creating it', async () => {
    const { root } = await fixture()
    const absent = FS.resolvePath('missing', await mkTestDir('tao-no-codex-home-'))
    await CodexGitPermissions.install({ root, codexHome: absent })
    Expect(await FS.exists(absent)).toBe(false)
  })

  Test('rejects conflicting grants and malformed TOML without changing user bytes', async () => {
    const { codexHome, root } = await fixture()
    const path = FS.resolvePath('config.toml', codexHome)
    for (
      const initial of [
        `[permissions.tao-workspace.filesystem]\n${JSON.stringify(FS.resolvePath('.git', root))} = "read"\n`,
        'model = [\n',
      ]
    ) {
      await FS.writeText(path, initial)
      await Expect(CodexGitPermissions.install({ root, codexHome })).rejects.toThrow()
      Expect(await FS.readText(path)).toBe(initial)
    }
  })

  Test('rejects a home-relative restriction on the same Git directory and an ancestor deny', async () => {
    const { codexHome, root } = await fixture()
    const path = FS.resolvePath('config.toml', codexHome)
    const common = (await CLI.run('git', {
      args: ['rev-parse', '--path-format=absolute', '--git-common-dir'],
      cwd: Repo.getRoot(),
    })).stdout.trim()
    const homeRelative = `~/${FS.relativePath(FS.homeDir(), common)}`
    const cases = [
      { checkout: Repo.getRoot(), rule: homeRelative, action: 'read' },
      { checkout: root, rule: `${FS.dirname(root)}/**`, action: 'deny' },
      { checkout: root, rule: `${FS.resolvePath('.git/objects', root)}/**`, action: 'deny' },
      { checkout: root, rule: FS.resolvePath('.git/objects', root), action: 'read' },
    ]
    for (const item of cases) {
      const initial = `[permissions.tao-workspace.filesystem]\n${JSON.stringify(item.rule)} = "${item.action}"\n`
      await FS.writeText(path, initial)
      await Expect(CodexGitPermissions.install({ root: item.checkout, codexHome })).rejects.toThrow('conflicting')
      Expect(await FS.readText(path)).toBe(initial)
    }
  })

  Test('rejects an existing inline filesystem table without corrupting it', async () => {
    const { codexHome, root } = await fixture()
    const path = FS.resolvePath('config.toml', codexHome)
    const initial = '[permissions.tao-workspace]\nfilesystem = { "/existing" = "read" } # keep\n'
    await FS.writeText(path, initial)
    await Expect(CodexGitPermissions.install({ root, codexHome })).rejects.toThrow('unsupported layout')
    Expect(await FS.readText(path)).toBe(initial)
  })

  Test('preserves a filesystem child table and comments while adding a path', async () => {
    const { codexHome, root } = await fixture()
    const path = FS.resolvePath('config.toml', codexHome)
    const initial = '[permissions.tao-workspace.filesystem]\n# personal restriction\n"/other" = "read"\n\n'
      + '[permissions.tao-workspace.filesystem.":workspace_roots"]\n"scratch" = "write" # keep\n'
    await FS.writeText(path, initial)
    await CodexGitPermissions.install({ root, codexHome })
    const source = await FS.readText(path)
    Expect(source).toContain('# personal restriction')
    Expect(source).toContain('"scratch" = "write" # keep')
    Expect(filesystems(source)[FS.resolvePath('.git', root)]).toBe('write')
    Expect(filesystems(source)[':workspace_roots']).toEqual({ scratch: 'write' })
  })

  Test('refuses unverified restrictive workspace-root globs without changing user policy', async () => {
    const { codexHome, root } = await fixture()
    const path = FS.resolvePath('config.toml', codexHome)
    for (const pattern of ['**/.git/objects/**', '**/.env']) {
      const initial = `[permissions.tao-workspace.filesystem.":workspace_roots"]\n${JSON.stringify(pattern)} = "deny"\n`
      await FS.writeText(path, initial)
      await Expect(CodexGitPermissions.install({ root, codexHome })).rejects.toThrow('restrictive :workspace_roots')
      Expect(await FS.readText(path)).toBe(initial)
    }
  })

  Test('refuses a symbolic-link config or home', async () => {
    const { codexHome, root } = await fixture()
    const target = FS.resolvePath('target.toml', codexHome)
    await FS.writeText(target, 'model = "personal"\n')
    const link = FS.resolvePath('config.toml', codexHome)
    await FS.symlink(target, link)
    await Expect(CodexGitPermissions.install({ root, codexHome })).rejects.toThrow('regular file')
    Expect(await FS.readText(target)).toBe('model = "personal"\n')

    const homeLink = FS.resolvePath('linked-home', await mkTestDir('tao-home-link-'))
    await FS.symlink(codexHome, homeLink)
    await Expect(CodexGitPermissions.install({ root, codexHome: homeLink })).rejects.toThrow('real directory')
  })
})
