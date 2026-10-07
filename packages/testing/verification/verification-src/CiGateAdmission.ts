import { Errors } from '@shared'
import { GateCatalog } from './GateCatalog'
import { VerifyComplement } from './VerifyComplement'

/*
 * The hosted macOS lane is the mirror image of the local complement. The workflow's `CI_HOST_GATES`
 * names the host gates a hosted macOS runner has been admitted to run; the complement runs every
 * other host gate locally. Both read the same key, so a gate is proved in exactly one place: admit
 * it here and it leaves the local list. The portable readers are hosted `Verify`'s and never run
 * on macOS, so the lane is the admitted host gates plus the prepare nodes they read, and every
 * host gate still pending is reported as skipped with the reason, never silently absent.
 */

/** PENDING_REASON is the skip reason a host gate carries until the workflow admits it. */
export const PENDING_REASON = 'Pending CI host admission'

/** Admission is what the lane runs, and the host gates it did not, as `--skipped` entries. */
export type Admission = {
  /** The admitted host gates, in the lane's order. */
  admitted: string[]
  /** Every gate the lane runs: the admitted host gates and the prepare nodes they read, in lane order. */
  gates: string[]
  /** `name=reason` entries for the host gates still pending admission. */
  skipped: string[]
}

/** select narrows the full lane to the admitted host gates and their prepare closure. */
function select(gates: readonly string[], admittedHostGates: string): Admission {
  const admitted = parseAdmission(admittedHostGates, gates)
  const included = new Set<string>()
  const include = (name: string): void => {
    if (included.has(name)) {
      return
    }
    for (const need of GateCatalog.dependenciesOf(name)) {
      include(need)
    }
    included.add(name)
  }
  for (const name of admitted) {
    include(name)
  }
  return {
    admitted,
    gates: gates.filter(name => included.has(name)),
    skipped: gates
      .filter(name => VerifyComplement.isHostGate(name) && !included.has(name))
      .map(name => `${name}=${PENDING_REASON}`),
  }
}

/** parseAdmission reads the comma-separated list the workflow carries; empty admits none. */
function parseAdmission(admittedHostGates: string, gates: readonly string[]): string[] {
  if (admittedHostGates.trim() === '') {
    return []
  }
  const admitted = new Set<string>()
  for (const rawName of admittedHostGates.split(',')) {
    const name = rawName.trim()
    if (name === '') {
      Errors.throwUserInput('CI host gate names must be a comma-separated list without empty entries.')
    }
    if (admitted.has(name)) {
      Errors.throwUserInput(`CI host gate '${name}' was listed more than once.`)
    }
    if (!gates.includes(name)) {
      Errors.throwUserInput(`CI host gate '${name}' is not in this lane's gate list.`)
    }
    if (!VerifyComplement.isHostGate(name)) {
      Errors.throwUserInput(
        GateCatalog.metadata(name).runsOnHostedLinux === true
          ? `CI host gate '${name}' runs in hosted Verify's Linux partitions; CI macOS has nothing to admit.`
          : `CI host gate '${name}' is a portable gate; hosted Verify already runs it.`,
      )
    }
    admitted.add(name)
  }
  return gates.filter(name => admitted.has(name))
}

export const CiGateAdmission = { PENDING_REASON, select } as const
