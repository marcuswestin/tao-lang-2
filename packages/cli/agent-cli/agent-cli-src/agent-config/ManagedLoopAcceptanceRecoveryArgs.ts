import { Errors } from '@shared'

export type ManagedLoopAcceptanceRecoveryRequest = { invocation: string }

/** The recorded invocation is the only selector; all host authority comes from its custody. */
export function parseManagedLoopAcceptanceRecoveryArgs(args: readonly string[]): ManagedLoopAcceptanceRecoveryRequest {
  if (
    args.length !== 2 || args[0] !== '--invocation'
    || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu.test(args[1] ?? '')
  ) {
    Errors.throwUserInput('Usage: test-host managed-loop-recover --invocation <uuid>.')
  }
  return { invocation: args[1]!.toLowerCase() }
}
