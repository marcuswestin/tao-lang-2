import { AST } from '@parser'
import { Switch } from '@shared'
import { Type } from './Type'

/** injectionArgumentName returns the TS local name introduced by an inject argument. */
export function injectionArgumentName(argument: AST.InjectionArgument): string {
  return Switch.type(argument, {
    NamedInjectionArgument: named => named.name,
    ShorthandInjectionArgument: shorthand => {
      const target = shorthand.value.target
      return target.ref ? Type.declarationName(target.ref) : target.$refText
    },
  })
}
