import { AST } from '@parser'
import { Switch } from '@shared'

type TaoLayoutTermValue = string | number

const accessibilityHeads = ['id', 'label', 'role'] as const

/** accessibilityEntryHead returns the accessibility head for a parsed clause entry when present. */
export function accessibilityEntryHead(entry: AST.LayoutEntry): AccessibilityEntryHead | undefined {
  const head = layoutTermValue(entry.head)
  return typeof head === 'string' && accessibilityHeads.includes(head as AccessibilityEntryHead)
    ? head as AccessibilityEntryHead
    : undefined
}

/** isAccessibilityEntry returns true when a bracket clause entry declares native accessibility metadata. */
export function isAccessibilityEntry(entry: AST.LayoutEntry): boolean {
  return accessibilityEntryHead(entry) !== undefined
}

/** layoutEntryValues returns compact runtime values for one parsed layout entry. */
export function layoutEntryValues(entry: AST.LayoutEntry): TaoLayoutTermValue[] {
  return [entry.head, ...entry.terms].map(layoutTermValue)
}

/** layoutTermValue returns a compact runtime value for one parsed layout term. */
export function layoutTermValue(term: AST.LayoutTerm): TaoLayoutTermValue {
  return Switch.type(term, {
    LayoutNumberLiteral: numberLiteral => numberLiteral.value,
    LayoutStringLiteral: stringLiteral => stringLiteral.value,
    LayoutWord: word => [word.value, ...word.suffixes].join('-'),
  })
}

/** AccessibilityEntryHead declares bracket clause heads consumed as native accessibility metadata. */
export type AccessibilityEntryHead = typeof accessibilityHeads[number]

/** LayoutTermValue declares compact runtime values from parsed layout terms. */
export type LayoutTermValue = ReturnType<typeof layoutTermValue>
