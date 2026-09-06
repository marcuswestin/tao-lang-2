import { AST } from '@parser'
import { type Compiled, gen } from '../codegen-util'
import { Compile } from '../Compile'
import { AppCompiler } from './AppCompiler'
import { bridgeBindingName } from './injection-plan'

export const AliasesCompiler = {
  /** AliasDeclaration compiles a Tao alias into a generated Tao value binding. */
  AliasDeclaration(alias: AST.AliasDeclaration): Compiled {
    if (AST.configuredPrimitiveOfExpression(alias.value) === 'app') {
      return AppCompiler.AppValue(alias)
    }
    if (AST.isActionTypeReference(alias.type) && AST.isFromExpression(alias.value)) {
      return gen`${gen.scopeName(alias)} = TR.Alias(TR.BridgedAction(${
        gen.Name({ name: bridgeBindingName(alias.value) })
      }))`
    }
    return AST.isConfiguredValue(alias.value)
      ? gen`${gen.scopeName(alias)} = TR.Alias(${Compile.ConfiguredValue(alias.value)})`
      : gen`${gen.scopeName(alias)} = TR.Alias(() => ${Compile.Expression(alias.value)})`
  },
} as const
