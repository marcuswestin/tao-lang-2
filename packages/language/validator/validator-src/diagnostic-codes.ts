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
  duplicateMember: 'design-check-duplicate-member',
  duplicateStyleProperty: 'design-check-duplicate-style-property',
  exploration: 'design-check-exploration',
  flatCatalog: 'design-check-flat-catalog',
  legacyVisualHead: 'design-check-legacy-visual-head',
  placeholderShipping: 'design-check-placeholder-shipping',
  reservedBundle: 'design-check-reserved-bundle',
} as const
