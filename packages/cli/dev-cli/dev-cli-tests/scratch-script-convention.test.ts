import { CLI, Repo } from '@shared'
import { Expect, Test } from '@shared/test'

Test('ignores disposable package-local TypeScript diagnostics', async () => {
  const result = await CLI.run('git', {
    args: ['check-ignore', '--quiet', '--no-index', 'packages/compiler/.scratch/diagnostic.ts'],
    cwd: Repo.getRoot(),
    stdio: 'pipe',
  })

  Expect(result.exitCode).toBe(0)
})
