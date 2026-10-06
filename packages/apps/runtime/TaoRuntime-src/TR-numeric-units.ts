import { TaoActionFailure } from './TR-errors'
import { QuantityFailureCases } from './TR-quantity-values'

/** checkedNumericBacking admits finite binary64 storage without allocating a quantity or unit. */
export function checkedNumericBacking(input: unknown, domain = 'numeric'): number {
  // Match checked quantity ingress; plain numeric storage uses the same modeled backing failures.
  if (typeof input !== 'number') {
    throw new TaoActionFailure(QuantityFailureCases.BadShape, `A '${domain}' value needs numeric backing.`)
  }
  if (!Number.isFinite(input)) {
    throw new TaoActionFailure(QuantityFailureCases.NonFinite, `A '${domain}' value needs finite backing.`)
  }
  return input
}
