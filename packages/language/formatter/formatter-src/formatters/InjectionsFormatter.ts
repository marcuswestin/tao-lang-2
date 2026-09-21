import type { FormatHandlers } from '../formatting'

export const InjectionsFormatter = {
  /** Injection formats `inject arguments` spacing up to the TS fence. */
  Injection(f) {
    f.oneSpaceAfter('inject')
    f.oneSpaceBeforeProperty('tsCodeBlock')
  },

  /** InjectionArgumentList formats comma-separated injection arguments. */
  InjectionArgumentList(f) {
    f.commaSpacedList()
  },

  /** NamedInjectionArgument formats `Name value` spacing. */
  NamedInjectionArgument(f) {
    f.oneSpaceBeforeProperty('value', 'ambient')
  },

  /** RenderAmbientChannel is an atomic `@@content`, `@@layout`, or `@@tag` token. */
  RenderAmbientChannel() {},

  /** ShorthandInjectionArgument is a single value reference; spacing is owned by InjectionArgumentList commas. */
  ShorthandInjectionArgument() {},
} satisfies Partial<FormatHandlers>
