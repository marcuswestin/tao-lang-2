import { AST } from '@parser'
import { type Compiled, gen } from '../codegen-util'

export default {
  /** UseStatement compiles a Tao use statement into a source comment. */
  UseStatement(useStatement: AST.UseStatement): Compiled {
    const importedNames = useStatement.importedDeclarations.map(reference => reference.$refText).join(', ')
    const fromClause = useStatement.importPath ? ` from ${useStatement.importPath}` : ''
    return gen.comment(`use ${importedNames}${fromClause}`)
  },
} as const
