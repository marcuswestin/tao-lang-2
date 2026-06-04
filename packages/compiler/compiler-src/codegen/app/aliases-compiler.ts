import { AST } from '@parser'
import { type Compiled, gen } from '../codegen-util'
import { compileExpression } from './expressions-compiler'

/** compileAliasDeclaration compiles a Tao alias into a generated Tao value binding. */
export function compileAliasDeclaration(alias: AST.AliasDeclaration): Compiled {
  return gen`const ${alias.name} = ${compileExpression(alias.value)}`
}
