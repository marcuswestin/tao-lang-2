import { AST } from '@parser'
import { Switch } from '@shared'

type TaoLayoutTermValue = string | number

/** layoutEntryValues returns compact runtime values for one parsed layout entry. */
export function layoutEntryValues(entry: AST.LayoutEntry): TaoLayoutTermValue[] {
  return [
    ...[entry.head, ...entry.terms].map(layoutTermValue),
    ...(entry.condition === undefined
      ? []
      : [
        'when',
        layoutTermValue(entry.condition.subject),
        ...(entry.condition.value === undefined ? [] : ['is', layoutTermValue(entry.condition.value)]),
      ]),
  ]
}

/** layoutTermValue returns a compact runtime value for one parsed layout term. */
export function layoutTermValue(term: AST.LayoutTerm): TaoLayoutTermValue {
  return Switch.type(term, {
    LayoutColorLiteral: color => color.value,
    LayoutNumberLiteral: numberLiteral => numberLiteral.value,
    LayoutWord: word =>
      `${[word.value, ...word.suffixes].join('-')}${
        word.pathSegments.length === 0 ? '' : `.${word.pathSegments.join('.')}`
      }`,
  })
}

/** LayoutTermValue declares compact runtime values from parsed layout terms. */
export type LayoutTermValue = ReturnType<typeof layoutTermValue>
