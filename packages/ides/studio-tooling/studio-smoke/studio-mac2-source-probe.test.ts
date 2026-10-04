import { Test } from '@shared/test'
import { runStudioMac2Fixture } from './StudioMac2Fixture'

Test('Studio Mac2 records only its owned native fixture source without input', async () => {
  await runStudioMac2Fixture('source-probe')
}, 300_000)
