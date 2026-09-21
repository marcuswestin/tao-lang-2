import { Platform } from '@shared'
import { Describe, Expect, Test } from '@shared/test'
import { runTaoCliForTest } from './test-cli-files'

Describe('tao review command', () => {
  Test('routes review requests through the lazily loaded Studio implementation', async () => {
    try {
      const result = await runTaoCliForTest(['review', '/definitely/missing/tao-review-project'])

      Expect(result.stderr).toContain('No Tao project directory found at /definitely/missing/tao-review-project.')
    } finally {
      Platform.runtimeProcess.setExitCode(0)
    }
  })
})
