import { CLI, Errors, FS, Repo } from '@shared'
import { Describe, Expect, mkTestDir, Test } from '@shared/test'
import { installTaoSkills } from '../skills-src/tao-skills'

Describe('Tao skills bundle', () => {
  Test('records the installed version in the committed project lock without losing other fields', async () => {
    const project = await mkTestDir('tao-skills-lock-')
    try {
      const lockPath = FS.resolvePath('.tao/store/lock.jsonc', project)
      await FS.writeText(lockPath, '{"schemaVersion":1,"toolchain":{"version":"0.4.0"}}\n')
      const installed = await installTaoSkills(project)
      Expect(installed.paths).toContain('.tao/store/lock.jsonc')
      Expect(await FS.readJson(lockPath)).toEqual({
        schemaVersion: 1,
        skillsVersion: '1.0.0',
        toolchain: { version: '0.4.0' },
      })
      Expect(await FS.exists(FS.resolvePath('.tao-project/skills.version', project))).toBe(false)
      Expect(await FS.listDir(FS.resolvePath('.tao/store', project))).toEqual(['lock.jsonc'])
    } finally {
      await FS.remove(project)
    }
  })

  Test('exposes the package through the in-repository skill link', async () => {
    Expect(await FS.realPath(Repo.resolvePath('agents/skills/tao-skills'))).toBe(
      Repo.resolvePath('packages/ai/tao-skills/skills'),
    )
  })

  Test('installs embedded Markdown from a relocated Bun bundle', async () => {
    const root = await mkTestDir('tao-skills-bundle-')
    try {
      const bundle = FS.resolvePath('tao-skills-proof.js', root)
      const entry = Repo.resolvePath('packages/ai/tao-skills/skills-tests/compiled-skills-entry.ts')
      const built = await CLI.run('bun', {
        args: ['build', '--target=bun', entry, '--outfile', bundle],
        cwd: Repo.getRoot(),
      })
      if (built.exitCode !== 0) {
        Errors.throwUnexpected(`Could not compile the Tao skills proof: ${built.stdout}${built.stderr}`)
      }

      const project = FS.resolvePath('OutsideProject', root)
      const installed = await CLI.run('bun', { args: [bundle, project], cwd: root })
      if (installed.exitCode !== 0) {
        Errors.throwUnexpected(`Bundled Tao skills could not install: ${installed.stdout}${installed.stderr}`)
      }
      const skill = FS.resolvePath('.agents/skills/tao-project/SKILL.md', project)
      Expect(await FS.readText(skill)).toBe(
        await FS.readText(Repo.resolvePath('packages/ai/tao-skills/skills/tao-project/SKILL.md')),
      )
      Expect(await FS.readText(FS.resolvePath('CLAUDE.md', project))).toBe('@AGENTS.md\n')
    } finally {
      await FS.remove(root)
    }
  })
})
