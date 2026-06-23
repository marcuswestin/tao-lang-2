import { AST } from '@parser'
import { Switch } from '@shared'
import { type Compiled, gen } from '../codegen-util'

export default {
  /** ProjectDeclaration compiles a Tao project block into a source comment. */
  ProjectDeclaration(project: AST.ProjectDeclaration): Compiled {
    const body = AST.blockStatementOf(project, { map: formatProjectStatement }).join(' ')
    return gen.comment(`project { ${body} }`)
  },
} as const

function formatProjectStatement(statement: AST.ProjectStatement): string {
  return Switch.type(statement, {
    ProjectLicense: projectLicense => `license ${projectLicense.value}`,
    ProjectName: projectName => `name ${JSON.stringify(projectName.value)}`,
    ProjectRemote: () => 'remote none',
    ProjectRequires: projectRequires => `requires ${projectRequires.value}`,
  })
}
