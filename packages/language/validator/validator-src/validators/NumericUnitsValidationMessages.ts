/** NumericUnitsValidationMessages owns source diagnostics for operation-free numeric storage. */
export const NumericUnitsValidationMessages = {
  blockPlacement: 'A units block belongs directly inside a numeric-derived type declaration with-body.',
  multipleBlocks: 'A numeric type must own exactly one units block.',
  emptyBlock: 'A units block must declare at least one unit.',
  duplicateUnit: (name: string) => `Unit '${name}' is declared more than once in this units block.`,
  scale: (name: string) => `Unit '${name}' must have a positive finite scale.`,
  defaultUnit: 'A units block must mark exactly one unit as default.',
  constructionShape: 'Unit construction requires a number literal, a signed number literal, or a grouped expression.',
  constructionInput: 'Unit construction requires a number input.',
  invalidTable: 'Unit construction requires a valid directly owned units block.',
  operator: (operator: string) => `Operator '${operator}' is not defined for numeric values.`,
} as const
