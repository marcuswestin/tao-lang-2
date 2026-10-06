import type { Compiled } from '../codegen-util'

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
