/** useValidationCodes declares quick-fixable diagnostic codes for Tao use statements. */
export const useValidationCodes = {
  duplicateImport: 'tao-duplicate-import',
  repeatedImport: 'tao-repeated-import',
  unusedImport: 'tao-unused-import',
  useOutOfSection: 'tao-use-out-of-section',
} as const

/** viewValidationCodes declares quick-fixable diagnostic codes for Tao view bodies. */
export const viewValidationCodes = {
  renderNotLast: 'tao-render-not-last',
} as const

/** aliasValidationCodes declares compatibility diagnostics for legacy bindings. */
export const aliasValidationCodes = {
  deprecatedAlias: 'tao-deprecated-alias',
} as const
