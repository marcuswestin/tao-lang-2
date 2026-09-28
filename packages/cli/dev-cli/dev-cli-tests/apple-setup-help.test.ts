import { CLI, Repo } from '@shared'
import { Describe, Expect, Test } from '@shared/test'

Describe('Apple setup command help', () => {
  Test('exposes headset and optional simulator choices through the real command parser', async () => {
    const result = await CLI.run('./dev', { args: ['setup-visionos', '--help'], cwd: Repo.getRoot() })
    Expect(result.exitCode).toBe(0)
    Expect(result.stdout).toContain('setup-visionos')
    Expect(result.stdout).toContain('--simulator')
    Expect(result.stdout).toContain('--runtime-version')
    Expect(result.stdout).toContain('--device')
    Expect(result.stdout).toContain('--team')
    Expect(result.stdout).toContain('--bundle-id')
    Expect(result.stdout).toContain('--apply')
  })

  Test('retains explicit iOS Xcode and runtime options', async () => {
    const result = await CLI.run('./dev', { args: ['setup-ios', '--help'], cwd: Repo.getRoot() })
    Expect(result.exitCode).toBe(0)
    Expect(result.stdout).toContain('--xcode-version')
    Expect(result.stdout).toContain('--runtime-version')
    Expect(result.stdout).toContain('--archive')
  })

  Test('rejects an omitted Xcode version before loading either installer', async () => {
    for (const command of ['setup-ios', 'setup-visionos']) {
      const result = await CLI.run('./dev', { args: [command], cwd: Repo.getRoot() })
      Expect(result.exitCode).toBe(1)
      Expect(result.stderr).toContain('--xcode-version')
    }
  })
})
