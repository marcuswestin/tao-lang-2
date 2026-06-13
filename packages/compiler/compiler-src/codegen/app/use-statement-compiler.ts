import { AST } from '@parser'
import { type Compiled, genComment } from '../codegen-util'

export default {
  /** UseStatement compiles a Tao use statement into a source comment. */
  UseStatement(useStatement: AST.UseStatement): Compiled {
    const importedNames = useStatement.importedDeclarations.map(reference => reference.$refText).join(', ')
    const fromClause = useStatement.importPath ? ` from ${useStatement.importPath}` : ''
    return genComment(`use ${importedNames}${fromClause}`)
  },
} as const
