/** Known modeled failures and whether the complete propagated set remains unknown. */
export type FailureContract = Readonly<{ cases: readonly string[]; open: boolean }>

/** Union retains every known case in source order and never loses an open remainder. */
export function unionFailureContracts(contracts: readonly FailureContract[]): FailureContract {
  return {
    cases: uniqueCases(contracts.flatMap(contract => contract.cases)),
    open: contracts.some(contract => contract.open),
  }
}

/** An unknown actual contract cannot satisfy a closed failure bound. */
export function failureContractSatisfiesBound(actual: FailureContract, bound: FailureContract): boolean {
  return bound.open || (!actual.open && actual.cases.every(failureCase => bound.cases.includes(failureCase)))
}

function uniqueCases(cases: readonly string[]): string[] {
  return [...new Set(cases)]
}
