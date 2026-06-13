import { AST } from '@parser'
import { type Compiled, gen } from '../codegen-util'
import { Compile } from '../Compile'

export default {
  /** RenderStatement compiles a Tao render statement into a generated return statement. */
  RenderStatement(render: AST.RenderStatement): Compiled {
    return gen`return ${Compile.RenderStatementBody(render)}`
  },
} as const
