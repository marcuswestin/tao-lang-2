import { AST } from '@parser'

/** nativeEventControlsValidationMessages declares author-facing native event policy diagnostics. */
export const nativeEventControlsValidationMessages = {
  unknownControl: (name: string) =>
    `Unknown native event control '${name}'; use preventDefault, stopPropagation, or stopImmediatePropagation.`,
  duplicateControl: (name: string) => `Native event control '${name}' is provided more than once.`,
  unsupportedControl: (name: string, event: AST.EventName) =>
    `Native event control '${name}' is unavailable on '${event}'; use preventDefault or stopPropagation.`,
  unsupportedEvent: (event: AST.EventName) =>
    `'on ${event}' delivers a scalar value and cannot apply native event controls.`,
} as const
