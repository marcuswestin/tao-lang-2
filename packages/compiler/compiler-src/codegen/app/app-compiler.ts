import { AST } from '@parser'
import { type Compiled, gen, genList, genName, resolveRef } from '../codegen-util'
import { Compile } from './Compile'

export default {
  /** CompileApp compiles a Tao app declaration into the generated default app component. */
  CompileApp(app: AST.AppDeclaration): Compiled {
    return gen`
      export default function TaoApp() {
        ${genList(app.block.statements, Compile.Statement)}
      }
    `
  },

  /** CompileAppUi compiles an app ui statement into the generated app root return. */
  CompileAppUi(appUi: AST.AppUi): Compiled {
    const view = resolveRef(appUi.ui, 'app ui')
    return gen`return TR.Render(${genName(view)}, TR.RenderProps({}))`
  },
} as const
