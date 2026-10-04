import { Describe, Expect, Test } from '@shared/test'
import { ReleaseWorkflow } from '../dev-cli-src/release/ReleaseWorkflow'

Describe('Public release preparation', () => {
  Test('rejects development profiles before invoking packaging or account commands', async () => {
    await Expect(ReleaseWorkflow.prepareIde('development')).rejects.toThrow(
      'Public releases require a numbered release phase.',
    )
    await Expect(ReleaseWorkflow.prepareStudio('invalid', 'invalid', 'development')).rejects.toThrow(
      'Public releases require a numbered release phase.',
    )
    await Expect(ReleaseWorkflow.prepareStudio('invalid', 'invalid', 1)).rejects.toThrow(
      'Studio is unavailable in Tao release phase 1.',
    )
  })
})
