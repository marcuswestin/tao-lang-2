import { AST } from '@parser'
import { type CodegenOptions, type Compiled, gen } from '../codegen-util'
import { Compile } from '../Compile'

/** The shared binding plan supplies an allocated component name and existing bound JSX props. */
export type AssociatedViewRenderPlan = Readonly<{
  component: Compiled
  arguments: Compiled
}>

/** compileAssociatedViewRender mounts a selected view with the real occurrence's existing props. */
export function compileAssociatedViewRender(
  render: AST.Render,
  plan: AssociatedViewRenderPlan,
  options: CodegenOptions = {},
): Compiled {
  return gen`<${plan.component}${plan.arguments}${Compile.RenderTaoProps(render, options)} />`
}
