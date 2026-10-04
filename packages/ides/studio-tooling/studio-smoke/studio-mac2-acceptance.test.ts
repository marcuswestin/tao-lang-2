import { Test } from '@shared/test'
import { runStudioMac2Fixture } from './StudioMac2Fixture'

Test('Studio Mac2 acceptance clicks and types into the launched native application', async () => {
  await runStudioMac2Fixture('acceptance')
}, 300_000)
