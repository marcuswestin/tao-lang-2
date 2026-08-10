import { ASTUtils } from '@ast-utils'
import { AST } from '@parser'
import { Switch } from '@shared'
import { type Compiled, gen } from '../codegen-util'
import { Compile } from '../Compile'

export const TaoPropsCompiler = {
  /** RenderTaoProps compiles the __tao prop fragment for a render invocation. */
  RenderTaoProps(render: AST.Render): Compiled {
    const layout = createTaoPropsLayout(render.layoutClause)
    const events = createTaoPropsEvents(render.events)
    return Switch.type(render, {
      RenderStatement: renderStatement => compileTaoPropsForRenderStatement(layout, events, renderStatement),
      ViewRender: () => compileTaoPropsForViewRender(layout, events),
    })
  },

  /** EventClause compiles one `on` clause body into a runtime action value. */
  EventClause(event: AST.EventClause): Compiled {
    return Compile.EventAction(event)
  },
} as const

function createTaoPropsLayout(clause: AST.LayoutClause | undefined): Compiled {
  if (!clause) {
    return gen`undefined`
  }
  const entries = clause.entries.map(ASTUtils.layoutEntryValues)
  return gen`TR.Layout.create(${gen.jsLiteral(entries)})`
}

function createTaoPropsEvents(events: readonly AST.EventClause[]): Compiled {
  if (events.length === 0) {
    return gen``
  }
  // Handlers are stored as invokable action values, matching how injected actions arrive.
  return gen`, events: { ${gen.join(events, event => gen`${event.event}: ${Compile.EventAction(event)}.jsValue`)} }`
}

function compileTaoPropsForRenderStatement(
  layout: Compiled,
  events: Compiled,
  render: AST.RenderStatement,
): Compiled {
  const inheritsCallerProps = AST.isBlock(render.$container)
    && AST.isRenderableDeclaration(render.$container.$container)
  const callerProps = inheritsCallerProps ? gen`, _ViewProps.__tao` : gen``
  return gen` __tao={TR.TaoProps({ layout: ${layout}${events} }${callerProps})}`
}

function compileTaoPropsForViewRender(layout: Compiled, events: Compiled): Compiled {
  return gen` __tao={TR.TaoProps({ layout: ${layout}${events} })}`
}
