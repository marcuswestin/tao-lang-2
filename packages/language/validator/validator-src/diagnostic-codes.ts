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

/** designValidationCodes declares stable diagnostics reported by the ordinary design validator. */
export const designValidationCodes = {
  capitalizedDesignName: 'design-check-capitalized-design-name',
  clauseValueNeedsHead: 'design-check-clause-value-needs-head',
  clauseValueType: 'design-check-clause-value-type',
  duplicateMember: 'design-check-duplicate-member',
  duplicateStyleProperty: 'design-check-duplicate-style-property',
  elementDefaultReference: 'design-check-element-default-reference',
  exploration: 'design-check-exploration',
  flatCatalog: 'design-check-flat-catalog',
  legacyVisualHead: 'design-check-legacy-visual-head',
  placeholderShipping: 'design-check-placeholder-shipping',
  reservedBundle: 'design-check-reserved-bundle',
  unknownClauseValue: 'design-check-unknown-clause-value',
} as const
