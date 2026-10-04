import { Assert, CLI, FS, Repo } from '@shared'
import { Describe, Expect, mkTestDir, Test } from '@shared/test'

Describe('developer shell setup ordering', () => {
  Test('offers activation after the declared setup prerequisites', async () => {
    const fixture = await mkTestDir('tao-shell-setup-order-')
    try {
      const justfile = await FS.readText(Repo.resolvePath('Justfile'))
      const setup = justfile.match(/^_setup:.*\n(?:[ \t].*\n)*/m)?.[0]
      Assert.defined(setup, 'The setup recipe exists')
      const prerequisites = [
        '_deps',
        '_tao-project-deps',
        '_agent-config',
        '_git-hooks',
        '_initial-dev-branch',
        '_shell-completion',
      ]
      const log = FS.resolvePath('steps.log', fixture)
      await FS.writeText(FS.resolvePath('dev', fixture), '#!/bin/sh\nprintf "%s\\n" "$*" >> steps.log\n')
      await FS.chmod(FS.resolvePath('dev', fixture), 0o755)

      const recipes = prerequisites.map(name => `${name}:\n    @echo ${name} >> steps.log\n`)
      await FS.writeText(FS.resolvePath('Justfile', fixture), `${setup}\n${recipes.join('\n')}`)
      const result = await CLI.run(Repo.resolvePath('.devenv/profile/bin/just'), {
        args: ['_setup'],
        cwd: fixture,
      })
      Expect(result.exitCode).toBe(0)
      Expect((await FS.readText(log)).trim().split('\n')).toEqual([...prerequisites, 'shell-setup --prepare'])
    } finally {
      await FS.remove(fixture)
    }
  })
})
