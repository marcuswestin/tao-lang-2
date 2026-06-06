import { AST } from '@parser'
import { Switch } from '@shared'

/** injectionArgumentName returns the TS local name introduced by an inject argument. */
export function injectionArgumentName(argument: AST.InjectionArgument): string {
  return Switch.type(argument, {
    NamedInjectionArgument: named => named.name,
    ShorthandInjectionArgument: shorthand => shorthand.value.target.ref?.name ?? shorthand.value.target.$refText,
  })
}
