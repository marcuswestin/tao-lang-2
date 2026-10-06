import { Errors } from '@shared'
import { GateCatalog } from './GateCatalog'

const PENDING_HOST_ADMISSION_REASON = 'Pending CI host admission'

/** CiGateAdmission selects which unsandboxed host gates a CI run may admit. */
function select(gates: readonly string[], admittedHostGates?: string): { gates: string[]; skipped: string[] } {
  const admitted = admittedHostGates === undefined ? undefined : parseAdmission(admittedHostGates, gates)
  const selected: string[] = []
  const skipped: string[] = []

  for (const gate of gates) {
    if (GateCatalog.metadata(gate).requiresUnsandboxed !== true) {
      selected.push(gate)
    } else if (admitted === undefined || admitted.has(gate)) {
      selected.push(gate)
    } else {
      skipped.push(`${gate}=${PENDING_HOST_ADMISSION_REASON}`)
    }
  }

  return { gates: selected, skipped }
}

function parseAdmission(admittedHostGates: string, gates: readonly string[]): Set<string> {
  if (admittedHostGates === '') {
    return new Set()
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
      Errors.throwUserInput(`CI host gate '${name}' is not in this lane's canonical gate list.`)
    }
    if (GateCatalog.metadata(name).requiresUnsandboxed !== true) {
      Errors.throwUserInput(`CI host gate '${name}' does not require unsandboxed execution.`)
    }
    admitted.add(name)
  }
  return admitted
}

export const CiGateAdmission = { select } as const
