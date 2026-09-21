import { Errors, HCI, Platform } from '@shared'
import { writeDeveloperEnvironmentLedgerIndexes } from './repo-lint'

async function run(): Promise<void> {
  try {
    await writeDeveloperEnvironmentLedgerIndexes()
  } catch (error) {
    HCI.writeErrorLine(Errors.formatForLog(error))
    Platform.runtimeProcess.setExitCode(1)
  }
}

if (import.meta.main) {
  await run()
}
