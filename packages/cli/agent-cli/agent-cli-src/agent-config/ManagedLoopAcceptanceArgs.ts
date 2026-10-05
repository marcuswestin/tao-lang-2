import { Errors } from '@shared'

const MANAGED_LOOP_ACCEPTANCE_CASES = [
  'commands',
  'lifecycle',
  'lifecycle-faults',
  'combined-lifecycle',
  'combined-target-failure',
  'foreground-compatibility',
  'chrome',
  'chrome-visible',
  'mobile-interaction',
  'mobile-interaction-faults',
  'android-lifecycle',
  'android-visible',
  'android-escalation',
  'android-abrupt-exit',
  'android-quarantine',
  'android-recovery',
  'android-parallel',
  'ios-lifecycle',
  'ios-cleanup',
  'ios-visible',
  'ios-parallel',
  'ios-recovery',
] as const

export type ManagedLoopAcceptanceRequest = {
  case: typeof MANAGED_LOOP_ACCEPTANCE_CASES[number]
  session?: string
  target?: 'ios' | 'android'
}

/** Finite proofs never accept arbitrary processes, executables, URLs or user-supplied faults. */
export function parseManagedLoopAcceptanceArgs(args: readonly string[]): ManagedLoopAcceptanceRequest {
  const values = new Map<string, string>()
  for (let index = 0; index < args.length; index += 2) {
    const name = args[index]!
    const value = args[index + 1]
    if (
      !['--case', '--session', '--target'].includes(name) || values.has(name)
      || value === undefined || value.length === 0 || value.startsWith('-')
    ) {
      Errors.throwUserInput('Usage: test-host managed-loop --case <case> [--session <uuid>] [--target ios|android].')
    }
    values.set(name, value)
  }
  const selected = values.get('--case')
  if (!MANAGED_LOOP_ACCEPTANCE_CASES.some(value => value === selected)) {
    Errors.throwUserInput(`Choose one managed-loop case: ${MANAGED_LOOP_ACCEPTANCE_CASES.join(', ')}.`)
  }
  const session = values.get('--session')
  const target = values.get('--target')
  if (session !== undefined && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu.test(session)) {
    Errors.throwUserInput('--session must name a recorded UUID.')
  }
  if (session !== undefined && selected !== 'chrome' && selected !== 'mobile-interaction') {
    Errors.throwUserInput(
      'Only Chrome or mobile interaction accepts an existing session; fault cases own their sessions.',
    )
  }
  if (target !== undefined && (selected !== 'mobile-interaction' || !['ios', 'android'].includes(target))) {
    Errors.throwUserInput('--target ios|android is only supported for mobile-interaction.')
  }
  if (selected === 'mobile-interaction' && (session === undefined || target === undefined)) {
    Errors.throwUserInput('mobile-interaction requires --session <uuid> and --target ios|android.')
  }
  return {
    case: selected as ManagedLoopAcceptanceRequest['case'],
    session,
    target: target as ManagedLoopAcceptanceRequest['target'],
  }
}
