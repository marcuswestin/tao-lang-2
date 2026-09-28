import { AST } from '@parser'
import { type Compiled, gen } from '../codegen-util'

export const UseStatementCompiler = {
  /** UsePackageStatement compiles to a source comment; its imports come from the aliases using it. */
  UsePackageStatement(statement: AST.UsePackageStatement): Compiled {
    const asClause = statement.name ? ` as ${statement.name}` : ''
    return gen.comment(`use package ${statement.importPath}${asClause}`)
  },

  /** UseStatement compiles a Tao use statement into a source comment. */
  UseStatement(useStatement: AST.UseStatement): Compiled {
    const importedNames = useStatement.importedDeclarations.map(reference => reference.$refText).join(', ')
    const fromClause = useStatement.importPath ? ` from ${useStatement.importPath}` : ''
    return gen.comment(`use ${importedNames}${fromClause}`)
  },
} as const
