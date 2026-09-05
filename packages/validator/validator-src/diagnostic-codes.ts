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

/** designValidationCodes declares stable warnings reported by the ordinary design validator. */
export const designValidationCodes = {
  exploration: 'design-check-exploration',
  placeholderShipping: 'design-check-placeholder-shipping',
} as const
