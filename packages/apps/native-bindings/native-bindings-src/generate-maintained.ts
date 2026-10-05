import { Errors, HCI, Platform } from '@shared'
import { generateMaintainedNativeBindings } from './maintained-native-bindings'

try {
  HCI.logProcessInfo('native bindings', 'Reading pinned Photos and Files declarations...')
  const paths = await generateMaintainedNativeBindings({ mode: 'write' })
  HCI.logProcessInfo('native bindings', `Published ${paths.length} generated files.`)
} catch (error) {
  HCI.writeErrorLine(Errors.formatForUser(error))
  Platform.runtimeProcess.setExitCode(1)
}
