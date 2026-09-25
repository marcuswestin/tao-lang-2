import { HCI, Platform } from '@shared'
import { agentHostCommands, hostCommandKind } from '../agent-config/HostCommandPolicy'

const [sourcePath, ...argv] = Platform.runtimeProcess.argv.slice(2)
try {
  if (sourcePath === undefined) {
    throw new TypeError('Missing .rulesync/permissions.jsonc path.')
  }
  const source = Bun.JSONC.parse(await Bun.file(sourcePath).text()) as { agentHostCommands?: unknown }
  const prefixes = agentHostCommands(source)
  const kind = hostCommandKind(argv, prefixes)
  if (kind === undefined) {
    HCI.writeError(
      `FAIL  ${argv.join(' ') || '(empty command)'} is not in agentHostCommands in .rulesync/permissions.jsonc.\n`
        + `Allowed prefixes: ${prefixes.map(prefix => prefix.join(' ')).join(', ')}\n`,
    )
    Platform.runtimeProcess.setExitCode(2)
  } else {
    HCI.write(kind)
  }
} catch (error) {
  HCI.writeError(`FAIL  Could not read agentHostCommands in .rulesync/permissions.jsonc: ${String(error)}\n`)
  Platform.runtimeProcess.setExitCode(2)
}
