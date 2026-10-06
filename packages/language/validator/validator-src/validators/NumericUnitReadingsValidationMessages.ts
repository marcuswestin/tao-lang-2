/** NumericUnitReadingsValidationMessages owns diagnostics for generated quantity unit views. */
export const NumericUnitReadingsValidationMessages = {
  arguments: (unit: string) => `Unit reading '${unit}' takes no arguments.`,
  collision: (unit: string) => `Associated method '${unit}' conflicts with a generated unit reading.`,
  inheritedTable: 'A numeric descendant inherits its unit table and cannot extend or replace it.',
} as const
