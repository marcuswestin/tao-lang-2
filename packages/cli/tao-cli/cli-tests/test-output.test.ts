import { Describe, Expect, Test, withCapturedOutput } from '@shared/test'
import { TestOutput } from '../cli-src/test-output'

Describe('TestOutput.reportFinishedRun', () => {
  Test('finds a Tests: summary line preceded by a bare \\r progress line', async () => {
    const output = 'Running suite...\rTests:       1 passed, 1 total\n'

    const captured = await withCapturedOutput(() => {
      TestOutput.reportFinishedRun({ failed: false, mode: 'quiet', output })
    })

    Expect(captured.stdout).toContain('Tests:       1 passed, 1 total')
  })
})
