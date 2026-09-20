/** sorted returns a fresh array in comparator order without changing values. */
export function sorted<ValueT>(
  values: readonly ValueT[],
  comparator?: (left: ValueT, right: ValueT) => number,
): ValueT[] {
  return [...values].sort(comparator)
}

/** reversed returns a fresh array in reverse order without changing values. */
export function reversed<ValueT>(values: readonly ValueT[]): ValueT[] {
  return [...values].reverse()
}

/** sortInPlace orders a mutable array and returns that same array. */
export function sortInPlace<ValueT>(
  values: ValueT[],
  comparator?: (left: ValueT, right: ValueT) => number,
): ValueT[] {
  return values.sort(comparator)
}
