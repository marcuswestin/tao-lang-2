import { HCI, Platform } from '@shared'
import { readModelDriftWarnings } from '../delegation/ModelDrift'

const root = Platform.runtimeProcess.argv[2]
if (root !== undefined) {
  const warnings = await readModelDriftWarnings(root).catch(() => [])
  for (const warning of warnings) {
    HCI.writeLine(`WARN  agent model drift: ${warning}`)
  }
}
