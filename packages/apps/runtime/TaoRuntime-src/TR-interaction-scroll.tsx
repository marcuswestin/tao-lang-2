import React from 'react'

type Bounds = Readonly<{ x: number; y: number; width: number; height: number }>
export type Measurable = {
  measureInWindow?(callback: (x: number, y: number, width: number, height: number) => void): void
  getBoundingClientRect?(): Bounds
  scrollIntoView?(options?: { block: 'nearest'; inline: 'nearest' }): void
}

/** The closest mounted ScrollView owns revealing a selected descendant. */
export const InteractionScrollContext = React.createContext<((target: Measurable | null) => void) | undefined>(
  undefined,
)

/** Web rows can be inside unconstrained ScrollViews whose actual scroller is an outer DOM ancestor. */
export function revealMountedTarget(target: Measurable | null, reveal?: (target: Measurable | null) => void): void {
  if (target?.scrollIntoView) {
    target.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  } else {
    reveal?.(target)
  }
}

export function measuredBounds(node: Measurable | null, receive: (bounds: Bounds) => void): void {
  if (node?.measureInWindow) {
    node.measureInWindow((x, y, width, height) => receive({ x, y, width, height }))
  } else if (node?.getBoundingClientRect) {
    receive(node.getBoundingClientRect())
  }
}

export function revealMountedRow(
  viewport: Bounds,
  row: Bounds,
  offset: Readonly<{ x: number; y: number }>,
): Readonly<{ x: number; y: number }> | undefined {
  const x = row.x < viewport.x
    ? row.x - viewport.x
    : row.x + row.width > viewport.x + viewport.width
    ? row.x + row.width - viewport.x - viewport.width
    : 0
  const y = row.y < viewport.y
    ? row.y - viewport.y
    : row.y + row.height > viewport.y + viewport.height
    ? row.y + row.height - viewport.y - viewport.height
    : 0
  return x === 0 && y === 0 ? undefined : {
    x: Math.max(0, offset.x + x),
    y: Math.max(0, offset.y + y),
  }
}
