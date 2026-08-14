import { ASTUtils } from '@ast-utils'
import { AST } from '@parser'
import { Switch } from '@shared'
import { type Compiled, gen } from '../codegen-util'

export const TaoPropsCompiler = {
  /** RenderTaoProps compiles the __tao prop fragment for a render invocation. */
  RenderTaoProps(render: AST.Render): Compiled {
    const layout = createTaoPropsLayout(render.layoutClause)
    const testTag = AST.testTagForRender(render)
    return Switch.type(render, {
      RenderStatement: renderStatement => compileTaoPropsForRenderStatement(layout, testTag, renderStatement),
      ViewRender: () => compileTaoPropsForViewRender(layout, testTag),
    })
  },
} as const

function createTaoPropsLayout(clause: AST.LayoutClause | undefined): Compiled {
  if (!clause) {
    return gen`undefined`
  }
  const entries = clause.entries.map(ASTUtils.layoutEntryValues)
  return gen`TR.Layout.create(${gen.jsLiteral(entries)})`
}

function compileTaoPropsForRenderStatement(
  layout: Compiled,
  testTag: string | undefined,
  render: AST.RenderStatement,
): Compiled {
  const inheritsCallerProps = AST.isBlock(render.$container)
    && AST.isRenderableDeclaration(render.$container.$container)
  const callerProps = inheritsCallerProps ? gen`, _ViewProps.__tao` : gen``
  return gen` __tao={TR.TaoProps({ layout: ${layout}${
    testTag ? gen`, testTag: ${gen.jsLiteral(testTag)}` : ''
  } }${callerProps})}`
}

function compileTaoPropsForViewRender(layout: Compiled, testTag: string | undefined): Compiled {
  return gen` __tao={TR.TaoProps({ layout: ${layout}${testTag ? gen`, testTag: ${gen.jsLiteral(testTag)}` : ''} })}`
}
