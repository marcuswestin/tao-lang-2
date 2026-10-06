import { Errors, HCI, Platform } from '@shared'
import { generateMaintainedNativeBindings, inspectMaintainedNativeBindings } from './maintained-native-bindings'

// The freshness check hashes every input and output in about a second; writing takes several. Setup
// runs this on every checkout, and CI restores the generated tree from a cache, so a tree the check
// proves current is left alone. The check is the same one compiles use, so a stale tree, restored or
// not, is always regenerated.
try {
  HCI.logProcessInfo('native bindings', 'Reading pinned Photos and Files declarations...')
  const inspection = await inspectMaintainedNativeBindings({})
  if (inspection.status === 'fresh') {
    HCI.logProcessInfo('native bindings', `All ${inspection.outputPaths.length} generated files are current.`)
  } else {
    const paths = await generateMaintainedNativeBindings({ mode: 'write' })
    HCI.logProcessInfo('native bindings', `Published ${paths.length} generated files.`)
  }
} catch (error) {
  HCI.writeErrorLine(Errors.formatForUser(error))
  Platform.runtimeProcess.setExitCode(1)
}
