import type { AST } from '@parser'
import type { ValidationContext } from '../validation'

/** LayoutConflictMessages declares diagnostic text for layout conflict validation. */
type LayoutConflictMessages = {
  conflictingEntries(left: string, right: string): string
  duplicateEntry(key: string): string
}

/** LayoutConflictItem declares one source node and the semantic conflict slots it claims. */
export type LayoutConflictItem<KeyT extends string = string> = {
  readonly keys: readonly KeyT[]
  readonly label: string
  readonly node: AST.Node
}

/** LayoutConflictValidator diagnoses duplicate and competing layout semantic slots. */
export const LayoutConflictValidator = {
  validate,
} as const

function validate<KeyT extends string>(
  items: readonly LayoutConflictItem<KeyT>[],
  ctx: ValidationContext,
  messages: LayoutConflictMessages,
): void {
  const seen = new Map<KeyT, LayoutConflictItem<KeyT>>()
  items:
  for (const item of items) {
    for (const key of item.keys) {
      const existing = seen.get(key)
      if (existing) {
        ctx.error(
          existing.label === item.label
            ? messages.duplicateEntry(item.label)
            : messages.conflictingEntries(existing.label, item.label),
          item.node,
        )
        continue items
      }
    }
    for (const key of item.keys) {
      seen.set(key, item)
    }
  }
}
