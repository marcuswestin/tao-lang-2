import { Errors } from '@shared'

export type DevLoopRequest =
  | { kind: 'start'; args: readonly string[]; json: boolean }
  | { kind: 'status'; session?: string; json: boolean }
  | { kind: 'logs'; session: string; json: boolean; lines: number; follow: boolean }
  | { kind: 'stop'; session: string; json: boolean }
  | { kind: 'restart'; session: string; json: boolean }
  | { kind: 'reload'; session: string; json: boolean }
  | { kind: 'help'; json: false }

export const DEV_LOOP_HELP = `Usage: ./agent unsandboxed dev-loop <command> [options]
  start [path] [--app <name>] [--web] [--ios] [--android]
        [--simulator <udid>] [--emulator <serial>]
        [--show-browser] [--show-simulator] [--show-emulator] [--json]
  status [--session <id>] [--json]
  logs --session <id> [--lines <n>] [--follow] [--json]
  stop|restart|reload --session <id> [--json]

Start returns a recorded background session; status distinguishes startup from readiness.
Loops have no default runtime timer. Stop waits for owned cleanup. Restart preserves
configuration; reload requests app reload without restarting services. JSON is one object;
logs --follow streams text and cannot be combined with --json.`

/** The same grammar guards host dispatch and the implementation; private workers are never public verbs. */
export function parseDevLoopArgs(argv: readonly string[]): DevLoopRequest {
  if (argv.length === 0 || (argv.length === 1 && ['--help', '-h', 'help'].includes(argv[0]!))) {
    return { kind: 'help', json: false }
  }
  const [kind, ...args] = argv
  if (!['start', 'status', 'logs', 'stop', 'restart', 'reload'].includes(kind!)) {
    return invalid('Expected start, status, logs, stop, restart, or reload.')
  }
  if (args.length === 1 && ['--help', '-h'].includes(args[0]!)) {
    return { kind: 'help', json: false }
  }
  const seen = new Set<string>()
  let json = false
  let session: string | undefined
  let lines = 200
  let follow = false
  const forwarded: string[] = []
  let pathSeen = false
  let startPath: string | undefined
  for (let index = 0; index < args.length; index++) {
    const arg = args[index]!
    if (!arg.startsWith('-')) {
      if (kind !== 'start' || pathSeen) {
        return invalid(`Unexpected argument '${arg}'.`)
      }
      pathSeen = true
      startPath = arg
      continue
    }
    if (seen.has(arg)) {
      return invalid(`Duplicate option '${arg}'.`)
    }
    seen.add(arg)
    if (arg === '--json') {
      json = true
      continue
    }
    if (arg === '--session' && kind !== 'start') {
      session = requiredValue(args, ++index, arg)
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu.test(session)) {
        return invalid('--session must name a recorded UUID.')
      }
      continue
    }
    if (kind === 'logs' && arg === '--lines') {
      const value = requiredValue(args, ++index, arg)
      if (!/^[1-9][0-9]*$/u.test(value) || !Number.isSafeInteger(Number(value))) {
        return invalid('--lines must be a positive integer.')
      }
      lines = Number(value)
      continue
    }
    if (kind === 'logs' && arg === '--follow') {
      follow = true
      continue
    }
    if (kind === 'start' && ['--app', '--simulator', '--emulator'].includes(arg)) {
      const value = requiredValue(args, ++index, arg)
      if (arg === '--emulator' && !/^emulator-[0-9]+$/u.test(value)) {
        return invalid('--emulator must name an emulator serial.')
      }
      if (arg === '--simulator' && !/^[0-9a-f-]{36}$/iu.test(value)) {
        return invalid('--simulator must name a device UUID.')
      }
      forwarded.push(arg, value)
      continue
    }
    if (
      kind === 'start'
      && ['--web', '--ios', '--android', '--show-browser', '--show-simulator', '--show-emulator'].includes(arg)
    ) {
      forwarded.push(arg)
      continue
    }
    return invalid(`Unsupported option '${arg}'.`)
  }
  if (kind === 'start') {
    for (
      const [target, options] of [
        ['--web', ['--show-browser']],
        ['--ios', ['--simulator', '--show-simulator']],
        ['--android', ['--emulator', '--show-emulator']],
      ] as const
    ) {
      if (!seen.has(target) && options.some(option => seen.has(option))) {
        return invalid(`${options.join(' and ')} require ${target}.`)
      }
    }
    return { kind, args: startPath === undefined ? forwarded : [startPath, ...forwarded], json }
  }
  if (kind === 'status') {
    return { kind, ...(session === undefined ? {} : { session }), json }
  }
  if (session === undefined) {
    return invalid(`${kind} requires --session <id>.`)
  }
  if (kind === 'logs') {
    if (json && follow) {
      return invalid('logs --follow streams text and cannot be combined with --json.')
    }
    return { kind, session, lines, follow, json }
  }
  return { kind: kind as 'stop' | 'restart' | 'reload', session, json }
}

function requiredValue(args: readonly string[], index: number, option: string): string {
  const value = args[index]
  return value !== undefined && value !== '' && !value.startsWith('-')
    ? value
    : invalid(`${option} requires a value.`)
}

function invalid(reason: string): never {
  return Errors.throwUserInput(`${reason}\n${DEV_LOOP_HELP}`)
}
