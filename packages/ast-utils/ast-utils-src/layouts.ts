import { AST } from '@parser'
import { Switch } from '@shared'

type TaoLayoutTermValue = string | number

function layoutEntryValues(entry: AST.LayoutEntry): TaoLayoutTermValue[] {
  return [entry.head, ...entry.terms].map(layoutTermValue)
}

function layoutTermValue(term: AST.LayoutTerm): TaoLayoutTermValue {
  return Switch.type(term, {
    LayoutNumberLiteral: numberLiteral => numberLiteral.value,
    LayoutWord: word => [word.value, ...word.suffixes].join('-'),
  })
}

/** LayoutUtils exposes semantic helpers for parsed layout clauses. */
export const LayoutUtils = {
  entryValues: layoutEntryValues,
  termValue: layoutTermValue,
}

/** LayoutTermValue declares compact runtime values from parsed layout terms. */
export type LayoutTermValue = ReturnType<typeof LayoutUtils.termValue>
