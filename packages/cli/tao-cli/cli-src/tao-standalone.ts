import { Errors, HCI, Platform } from '@shared'
import { StandaloneResources } from './standalone-resources'
import { ToolchainPin } from './toolchain-pin'

// The entry point `bun build --compile` builds the distributable binary from. The resources are
// unpacked before the CLI is imported rather than inside it, because the CLI's modules resolve their
// resource roots as they load: an import that ran first would name `/$bunfs` for good. Before either,
// the run goes to the release it asks for, which may not be this one.

const [runtime, script, ...args] = Platform.runtimeProcess.argv
let runArgs: string[] = args
try {
  const delegation = await ToolchainPin.delegate(args)
  if ('exitCode' in delegation) {
    Platform.runtimeProcess.exit(delegation.exitCode)
  } else {
    runArgs = delegation.args
  }
  await StandaloneResources.ensureUnpacked()
} catch (error) {
  HCI.writeErrorLine(Errors.formatForUser(error))
  Platform.runtimeProcess.exit(1)
}

const { runTaoCli } = await import('./tao-cli')
await runTaoCli([runtime ?? 'tao', script ?? 'tao', ...runArgs])
