import { CLI, FS, HCI, Platform } from '@shared'
import { agentHostCommands, hostCommandKind, hostCommandPrefix } from '../agent-config/HostCommandPolicy'
import { hostCommandTarget } from '../agent-config/HostCommandTargets'
import { isNotificationText, NOTIFICATION_SOUNDS } from '../attention/NotifyDeveloper'
import { runAgentCommand } from '../runner/AgentRunner'

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
  if (target.argsPolicy === 'notify' && !validNotifyArgs(args)) {
    HCI.writeErrorLine(
      'Usage: ./agent unsandboxed notify-developer [--sound <name>] [--message <text>] [--context <text>] [--flash-screen] [--stop] | --help',
    )
    return 2
  }
  if (
    (target.argsPolicy === 'studio-list' || target.argsPolicy === 'studio-stop')
    && !validStudioArgs(args, target.argsPolicy === 'studio-stop')
  ) {
    const selector = target.argsPolicy === 'studio-stop' ? ' [--launch <id> | --all]' : ''
    HCI.writeErrorLine(`Usage: ./agent unsandboxed ${prefix.join(' ')}${selector} [--json] | --help`)
    return 2
  }
  if (target.argsPolicy === 'none' && args.length > 0) {
    HCI.writeErrorLine(`Usage: ./agent unsandboxed ${prefix.join(' ')}`)
    return 2
  }
  if (target.argsPolicy === 'pid' && (args.length !== 1 || !/^\d+$/u.test(args[0]!))) {
    HCI.writeErrorLine(`Usage: ./agent unsandboxed ${prefix.join(' ')} <pid>`)
    return 2
  }
  if (
    target.argsPolicy === 'standalone-vm' && args.length !== 0 && (
      args.length !== 2 || !(
        (['--diagnose', '--stop', '--collect', '--recover-lease', '--audit-results'].includes(args[0]!)
          && /^tao-acceptance-[0-9]+-[0-9]+$/u.test(args[1]!))
        || (['--prepare-base', '--base'].includes(args[0]!) && ['vanilla', 'xcode'].includes(args[1]!))
      )
    )
  ) {
    HCI.writeErrorLine(
      'Usage: ./agent unsandboxed standalone-cli-clean-machine'
        + ' [--prepare-base|--base <vanilla|xcode> | --diagnose|--stop|--collect|--recover-lease|--audit-results <owned-vm>]',
    )
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
  // The attention loop must end when its tool session is cancelled. The workflow runner forwards
  // parent signals to the owned process tree; a raw server-policy CLI.run would leave it sounding.
  if (target.argsPolicy === 'notify') {
    return await runAgentCommand({
      args: [],
      command: 'notify-developer',
      spawnArgs: [...target.fixedArgs, ...args],
      spawnCommand: target.command,
    })
  }
  let cwd: string | undefined
  let forwardedArgs = args
  if (prefix.join(' ') === 'pods install') {
    if (args.length === 0 || args[0]!.startsWith('-')) {
      HCI.writeErrorLine('Usage: ./agent unsandboxed pods install <ios-directory> [pod-options...]')
      return 2
    }
    cwd = FS.resolvePath(args[0]!, Platform.runtimeProcess.cwd())
    if (!FS.pathIsWithin(cwd, Platform.runtimeProcess.cwd()) || !await FS.isFile(FS.resolvePath('Podfile', cwd))) {
      HCI.writeErrorLine(`FAIL  ${args[0]} must be a worktree directory containing a Podfile.`)
      return 2
    }
    forwardedArgs = args.slice(1)
  }
  const result = await CLI.run(target.command, {
    args: [...target.fixedArgs, ...forwardedArgs],
    cwd,
    ...(target.env === undefined ? {} : { env: target.env }),
    processPolicy: target.server ? 'server' : 'tool',
    stdio: 'inherit',
  })
  if (result.error !== undefined) {
    HCI.writeErrorLine(`FAIL  ${prefix.join(' ')}: ${result.error.message}`)
  }
  return result.exitCode ?? 1
}

/** Attention alerts accept only bounded display text and supported effects. */
function validNotifyArgs(args: readonly string[]): boolean {
  if (args.length === 1 && ['--help', '-h'].includes(args[0]!)) {
    return true
  }
  let stop = false
  let sound = false
  let flash = false
  const textOptions = new Set<string>()
  for (let index = 0; index < args.length; index++) {
    const arg = args[index]
    if (arg === '--stop' && !stop) {
      stop = true
    } else if (arg === '--sound' && !sound) {
      const name = args[++index]
      if (!NOTIFICATION_SOUNDS.some(candidate => candidate.toLowerCase() === name?.toLowerCase())) {
        return false
      }
      sound = true
    } else if (arg === '--flash-screen' && !flash) {
      flash = true
    } else if ((arg === '--message' || arg === '--context') && !textOptions.has(arg)) {
      if (!isNotificationText(args[++index], arg === '--message' ? 2_000 : 256)) {
        return false
      }
      textOptions.add(arg)
    } else {
      return false
    }
  }
  return true
}

/** Lifecycle commands select recorded launches, never arbitrary processes or roots. */
function validStudioArgs(args: readonly string[], stop: boolean): boolean {
  if (args.length === 1 && ['--help', '-h'].includes(args[0]!)) {
    return true
  }
  let json = false
  let selected = false
  for (let index = 0; index < args.length; index++) {
    const arg = args[index]
    if (arg === '--json' && !json) {
      json = true
    } else if (stop && arg === '--all' && !selected) {
      selected = true
    } else if (stop && arg === '--launch' && !selected) {
      const id = args[++index]
      if (id === undefined || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/u.test(id)) {
        return false
      }
      selected = true
    } else {
      return false
    }
  }
  return true
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
