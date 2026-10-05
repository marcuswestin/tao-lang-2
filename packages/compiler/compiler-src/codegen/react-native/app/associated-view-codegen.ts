import { AST } from '@parser'
import { type CodegenOptions, type Compiled, gen } from '../codegen-util'
import { Compile } from '../Compile'

/** The shared binding plan supplies an allocated component name and existing bound JSX props. */
export type AssociatedViewRenderPlan = Readonly<{
  component: Compiled
  arguments: Compiled
}>

/** The module planner supplies the stable component name and its complete mounted-props contract. */
export type AssociatedViewComponentPlan = Readonly<{
  component: Compiled
  /** Includes the unchanged receiver and standard __tao/__taoHost/__taoSlots/children ABI props. */
  propsType: Compiled
  /** Binds the caller-supplied receiver value unchanged into scope before parameters or body code. */
  receiverBinding: Compiled
  /** Pass gen.noop() when the root planner has no associated command surface. */
  commandSurface: Compiled
  /** Pass gen.noop() when the root planner has no associated host slots. */
  hostSlots: Compiled
}>

/** compileAssociatedViewRender mounts a selected view with the real occurrence's existing props. */
export function compileAssociatedViewRender(
  render: AST.Render,
  plan: AssociatedViewRenderPlan,
  options: CodegenOptions = {},
): Compiled {
  return gen`<${plan.component}${plan.arguments}${Compile.RenderTaoProps(render, options)} />`
}
