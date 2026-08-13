import { AST } from '@parser'
import { type Compiled, gen } from '../codegen-util'
import { Compile } from '../Compile'

export default {
  /** AliasDeclaration compiles a Tao alias into a generated Tao value binding. */
  AliasDeclaration(alias: AST.AliasDeclaration): Compiled {
    return AST.isConfiguredValue(alias.value)
      ? gen`${gen.scopeName(alias)} = TR.Alias(${Compile.ConfiguredValue(alias.value)})`
      : gen`${gen.scopeName(alias)} = TR.Alias(() => ${Compile.Expression(alias.value)})`
  },
} as const
