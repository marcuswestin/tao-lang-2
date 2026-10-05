/** Known modeled failures and whether the complete propagated set remains unknown. */
export type FailureContract = Readonly<{ cases: readonly string[]; open: boolean }>

/** The authored first bound and comma-following names define one closed declaration contract. */
export function declaredCallableFailureContract(
  declaration: Readonly<{ failureBound?: string; additionalFailureBounds?: readonly string[] }>,
): FailureContract {
  const bounds = declaration.failureBound === undefined
    ? []
    : [declaration.failureBound, ...declaration.additionalFailureBounds ?? []]
  return {
    cases: uniqueCases(bounds.filter(bound => bound !== 'never')),
    open: bounds.length === 0,
  }
}

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
