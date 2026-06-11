import { AST } from '@parser'
import { type Compiled, gen, genScopeName } from '../codegen-util'
import { Compile } from '../Compile'

export default {
  /** AliasDeclaration compiles a Tao alias into a generated Tao value binding. */
  AliasDeclaration(alias: AST.AliasDeclaration): Compiled {
    return gen`${genScopeName(alias)} = TR.Alias(() => ${Compile.Expression(alias.value)})`
  },
} as const
