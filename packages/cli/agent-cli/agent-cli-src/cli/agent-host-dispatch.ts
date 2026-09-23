import { CLI, HCI, Platform } from '@shared'
import { agentHostCommands, hostCommandKind, hostCommandPrefix } from '../agent-config/HostCommandPolicy'
import { hostCommandTarget } from '../agent-config/HostCommandTargets'

const [sourcePath, ...argv] = Platform.runtimeProcess.argv.slice(2)

async function run(): Promise<number> {
  if (sourcePath === undefined) {
    HCI.writeErrorLine('FAIL  Missing .rulesync/permissions.jsonc path.')
    return 2
  }
  const source = Bun.JSONC.parse(await Bun.file(sourcePath).text()) as { agentHostCommands?: unknown }
  const prefixes = agentHostCommands(source)
  const prefix = hostCommandPrefix(argv, prefixes)
  if (prefix === undefined || hostCommandKind(argv, prefixes) !== 'named') {
    HCI.writeErrorLine(`FAIL  ${argv.join(' ') || '(empty command)'} is not a named agentHostCommands entry.`)
    return 2
  }
  const target = hostCommandTarget(prefix)
  if (target === undefined) {
    HCI.writeErrorLine(`FAIL  ${prefix.join(' ')} has no named host implementation.`)
    return 2
  }
  const args = argv.slice(prefix.length)
  if (target.argsPolicy === 'none' && args.length > 0) {
    HCI.writeErrorLine(`Usage: ./agent unsandboxed ${prefix.join(' ')}`)
    return 2
  }
  if (target.argsPolicy === 'pid' && (args.length !== 1 || !/^\d+$/u.test(args[0]!))) {
    HCI.writeErrorLine(`Usage: ./agent unsandboxed ${prefix.join(' ')} <pid>`)
    return 2
  }
  if (prefix.join(' ') === 'simulators run') {
    return await runSimulator(args)
  }
  if (prefix.join(' ') === 'simulators open') {
    if (args.length > 1) {
      HCI.writeErrorLine('Usage: ./agent unsandboxed simulators open [device-udid]')
      return 2
    }
    return await openSimulator(args[0])
  }
  const result = await CLI.run(target.command, {
    args: [...target.fixedArgs, ...args],
    processPolicy: target.server ? 'server' : 'tool',
    stdio: 'inherit',
  })
  if (result.error !== undefined) {
    HCI.writeErrorLine(`FAIL  ${prefix.join(' ')}: ${result.error.message}`)
  }
  return result.exitCode ?? 1
}

/** Boot one selected device and bring its Simulator or Device Hub window forward. */
async function runSimulator(args: readonly string[]): Promise<number> {
  if (args.length !== 1) {
    HCI.writeErrorLine('Usage: ./agent unsandboxed simulators run <device-udid>')
    return 2
  }
  const [udid] = args
  const boot = await CLI.run('xcrun', { args: ['simctl', 'boot', udid!], stdio: 'pipe' })
  if (boot.exitCode !== 0 && !boot.stderr.includes('Unable to boot device in current state: Booted')) {
    HCI.writeErrorLine(boot.stderr.trim() || boot.error?.message || `Could not boot simulator ${udid}.`)
    return boot.exitCode ?? 1
  }
  return await openSimulator(udid)
}

/** Present the selected simulator on either Xcode's Simulator or Device Hub. */
async function openSimulator(udid?: string): Promise<number> {
  const simulatorArgs = ['-a', 'Simulator']
  if (udid !== undefined) {
    simulatorArgs.push('--args', '-CurrentDeviceUDID', udid)
  }
  const attempts = [simulatorArgs]
  if (udid !== undefined) {
    attempts.push([`devices://device/open?id=${encodeURIComponent(udid)}`])
  }
  attempts.push(['-a', 'DeviceHub'])
  for (const openArgs of attempts) {
    const opened = await CLI.run('open', { args: openArgs, stdio: 'pipe' })
    if (opened.exitCode === 0 && opened.error === undefined) {
      return 0
    }
    if (openArgs[0] === '-a' && openArgs[1] === 'DeviceHub') {
      HCI.writeErrorLine(opened.stderr.trim() || opened.error?.message || 'Could not open simulator host.')
      return opened.exitCode ?? 1
    }
  }
  return 1
}

try {
  Platform.runtimeProcess.setExitCode(await run())
} catch (error) {
  HCI.writeErrorLine(`FAIL  Named host command failed: ${String(error)}`)
  Platform.runtimeProcess.setExitCode(2)
}
