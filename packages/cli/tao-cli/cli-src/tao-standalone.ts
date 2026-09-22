import { Errors, HCI, Platform } from '@shared'
import { StandaloneResources } from './standalone-resources'

// The entry point `bun build --compile` builds the distributable binary from. The resources are
// unpacked before the CLI is imported rather than inside it, because the CLI's modules resolve their
// resource roots as they load: an import that ran first would name `/$bunfs` for good.

try {
  await StandaloneResources.ensureUnpacked()
} catch (error) {
  HCI.writeErrorLine(Errors.formatForUser(error))
  Platform.runtimeProcess.exit(1)
}

const { runTaoCli } = await import('./tao-cli')
await runTaoCli()
