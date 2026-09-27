import { Assert, CLI, FS, Repo } from '@shared'
import { Describe, Expect, mkTestDir, Test } from '@shared/test'

Describe('developer shell setup ordering', () => {
  Test('offers activation after every setup prerequisite and never after a failed prerequisite', async () => {
    const fixture = await mkTestDir('tao-shell-setup-order-')
    try {
      const justfile = await FS.readText(Repo.resolvePath('Justfile'))
      const setup = justfile.match(/^_setup:.*\n(?:[ \t].*\n)*/m)?.[0]
      Assert.defined(setup, 'The setup recipe exists')
      const prerequisites = ['_deps', '_agent-config', '_git-hooks', '_initial-dev-branch', '_shell-completion']
      const log = FS.resolvePath('steps.log', fixture)
      await FS.writeText(FS.resolvePath('dev', fixture), '#!/bin/sh\nprintf "%s\\n" "$*" >> steps.log\n')
      await FS.chmod(FS.resolvePath('dev', fixture), 0o755)

      for (const failure of [undefined, prerequisites[0], prerequisites.at(-1)]) {
        await FS.writeText(log, '')
        const recipes = prerequisites.map(name =>
          `${name}:\n    @echo ${name} >> steps.log\n${name === failure ? '    @exit 1\n' : ''}`
        )
        await FS.writeText(FS.resolvePath('Justfile', fixture), `${setup}\n${recipes.join('\n')}`)
        const result = await CLI.run(Repo.resolvePath('.devenv/profile/bin/just'), {
          args: ['_setup'],
          cwd: fixture,
        })
        const steps = (await FS.readText(log)).trim().split('\n')
        if (failure === undefined) {
          Expect(result.exitCode).toBe(0)
          Expect(steps).toEqual([...prerequisites, 'shell-setup'])
        } else {
          Expect(result.exitCode).not.toBe(0)
          Expect(steps).not.toContain('shell-setup')
          Expect(steps.at(-1)).toBe(failure)
        }
      }
    } finally {
      await FS.remove(fixture)
    }
  })
})
