import { ASTUtils } from '@ast-utils'
import { AST } from '@parser'
import { Switch } from '@shared'
import { type Compiled, gen } from '../codegen-util'

export const TaoPropsCompiler = {
  /** RenderTaoProps compiles the __tao prop fragment for a render invocation. */
  RenderTaoProps(render: AST.Render): Compiled {
    const layout = createTaoPropsLayout(render.layoutClause)
    const accessibility = createTaoPropsAccessibility(render.layoutClause)
    return Switch.type(render, {
      RenderStatement: renderStatement => compileTaoPropsForRenderStatement(layout, accessibility, renderStatement),
      ViewRender: () => compileTaoPropsForViewRender(layout, accessibility),
    })
  },
} as const

function createTaoPropsLayout(clause: AST.LayoutClause | undefined): Compiled {
  if (!clause) {
    return gen`undefined`
  }
  const entries = clause.entries
    .filter(entry => !ASTUtils.isAccessibilityEntry(entry))
    .map(ASTUtils.layoutEntryValues)
  return gen`TR.Layout.create(${gen.jsLiteral(entries)})`
}

function createTaoPropsAccessibility(clause: AST.LayoutClause | undefined): Compiled {
  if (!clause) {
    return gen`undefined`
  }
  const entries = clause.entries
    .filter(ASTUtils.isAccessibilityEntry)
    .map(ASTUtils.layoutEntryValues)
  return gen`TR.Accessibility.create(${gen.jsLiteral(entries)})`
}

function compileTaoPropsForRenderStatement(
  layout: Compiled,
  accessibility: Compiled,
  render: AST.RenderStatement,
): Compiled {
  const inheritsCallerProps = AST.isBlock(render.$container)
    && AST.isRenderableDeclaration(render.$container.$container)
  const callerProps = inheritsCallerProps ? gen`, _ViewProps.__tao` : gen``
  return gen` __tao={TR.TaoProps({ accessibility: ${accessibility}, layout: ${layout} }${callerProps})}`
}

function compileTaoPropsForViewRender(layout: Compiled, accessibility: Compiled): Compiled {
  return gen` __tao={TR.TaoProps({ accessibility: ${accessibility}, layout: ${layout} })}`
}
