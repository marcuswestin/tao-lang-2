import { ASTUtils } from '@ast-utils'
import { AST } from '@parser'
import { Assert } from '@shared'
import { type CodegenOptions, type Compiled, gen } from '../codegen-util'
import { Compile } from '../Compile'
import { AppCompiler } from './AppCompiler'
import { authLibraryExport, withAuthContextFactory } from './auth-context'
import { bridgeBindingName } from './injection-plan'

export const AliasesCompiler = {
  /** AliasDeclaration compiles a Tao alias into a generated Tao value binding. */
  AliasDeclaration(alias: AST.AliasDeclaration, options: CodegenOptions = {}): Compiled {
    if (authLibraryExport(alias) === 'Session') {
      Assert(AST.isFromExpression(alias.value), 'the Session library alias has its scoped native bridge')
      return withAuthContextFactory(
        alias,
        gen`${gen.scopeName(alias)} = ${
          gen.Name({ name: bridgeBindingName(alias.value) })
        }(_TaoAuthScope!, _Scope.SessionState)`,
      )
    }
    if (AST.configuredPrimitiveOfExpression(alias.value) === 'app') {
      return AppCompiler.AppValue(alias, options)
    }
    if (AST.isActionTypeReference(alias.type) && AST.isFromExpression(alias.value)) {
      return gen`${gen.scopeName(alias)} = TR.Alias(TR.BridgedAction(${
        gen.Name({ name: bridgeBindingName(alias.value) })
      }))`
    }
    if (AST.isExpression(alias.value)) {
      const selected = ASTUtils.resolveActionTarget(alias.value)
      if (selected.kind === 'named' && selected.associated) {
        return withAuthContextFactory(
          alias,
          gen`${gen.scopeName(alias)} = TR.Alias(${Compile.Expression(alias.value)})`,
        )
      }
    }
    return withAuthContextFactory(
      alias,
      AST.isConfiguredValue(alias.value)
        ? gen`${gen.scopeName(alias)} = TR.Alias(${Compile.ConfiguredValue(alias.value)})`
        : gen`${gen.scopeName(alias)} = TR.Alias(() => ${Compile.Expression(alias.value)})`,
    )
  },
} as const
