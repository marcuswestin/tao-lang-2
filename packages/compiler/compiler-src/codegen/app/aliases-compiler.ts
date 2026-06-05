import { AST } from '@parser'
import { type Compiled, gen, genName } from '../codegen-util'
import { Compile } from './Compile'

export default {
  /** CompileAliasDeclaration compiles a Tao alias into a generated Tao value binding. */
  CompileAliasDeclaration(alias: AST.AliasDeclaration): Compiled {
    return gen`const ${genName(alias)} = TR.Alias(${Compile.Expression(alias.value)})`
  },
} as const
