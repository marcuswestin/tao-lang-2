import { FS } from '@shared'
import { Describe, Expect, mkTestDir, Test } from '@shared/test'
import { setProjectId } from '../cli-src/project-command'
import { withTaoFixture } from './test-cli-files'

Describe('tao project identity commands', () => {
  Test('adds a missing id and preserves it when repeated', async () => {
    await withTaoFixture(
      { 'App.tao': `project { name "Existing" }\n\napp App { view Main }\nview Main() { }\n` },
      async root => {
        const path = await setProjectId('existing', root)
        const once = await FS.readText(path)
        Expect(once).toContain('project {\n   id "existing"\n   name "Existing"\n}')

        await setProjectId('existing', root)
        Expect(await FS.readText(path)).toBe(once)
      },
    )
  })

  Test('creates checked-in project metadata when a directory has no project block', async () => {
    const root = await mkTestDir('tao-project-id-create-')
    try {
      await FS.writeText(FS.resolvePath('App.tao', root), 'app App { view Main }\nview Main() { }\n')

      const projectPath = await setProjectId('created-project', root)

      Expect(FS.basename(projectPath)).toBe('Project.tao')
      Expect(await FS.readText(projectPath)).toContain('id "created-project"')
      Expect(await FS.readText(projectPath)).toContain(`name "${FS.basename(root)}"`)
      // Shipping requires a version, so metadata written without one describes a project that cannot ship.
      Expect(await FS.readText(projectPath)).toContain('version "0.1.0"')
    } finally {
      await FS.remove(root)
    }
  })

  Test('requires --replace and explains that replacement severs persisted state', async () => {
    await withTaoFixture(
      { 'App.tao': `project { id "original" name "Existing" }\n` },
      async root => {
        await Expect(setProjectId('fork', root)).rejects.toThrow('severs persisted-state compatibility')
        const path = await setProjectId('fork', root, { replace: true })
        Expect(await FS.readText(path)).toContain('id "fork"')
      },
    )
  })

  Test('rejects ambiguous directories containing more than one project declaration', async () => {
    await withTaoFixture(
      {
        'One.tao': `project { name "One" }`,
        'Nested/Two.tao': `project { name "Two" }`,
      },
      async root => {
        await Expect(setProjectId('ambiguous', root)).rejects.toThrow('More than one project metadata block')
      },
    )
  })
})
