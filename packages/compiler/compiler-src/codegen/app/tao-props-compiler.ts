import { AST } from '@parser'
import { Switch } from '@shared'
import { type Compiled, gen } from '../codegen-util'
import { Compile } from '../Compile'

export const TaoPropsCompiler = {
  /** RenderTaoProps compiles the __tao prop fragment for a render invocation. */
  RenderTaoProps(render: AST.Render): Compiled {
    const designSpec = render.layoutClause ? Compile.DesignSpec(render.layoutClause) : gen`undefined`
    // Every view occurrence takes the same defaults; layout comes only from the call site's clauses.
    const layout = gen`undefined`
    const testTag = AST.testTagForRender(render)
    return Switch.type(render, {
      RenderStatement: renderStatement =>
        compileTaoPropsForRenderStatement(layout, designSpec, testTag, renderStatement),
      ViewRender: () => compileTaoPropsForViewRender(layout, designSpec, testTag),
    })
  },
} as const

function compileTaoPropsForRenderStatement(
  layout: Compiled,
  designSpec: Compiled,
  testTag: string | undefined,
  render: AST.RenderStatement,
): Compiled {
  const inheritsCallerProps = AST.isBlock(render.$container)
    && AST.isViewDeclaration(render.$container.$container)
  const callerProps = inheritsCallerProps ? gen`, _ViewProps.__tao` : gen``
  return gen` __tao={TR.TaoProps({ ...TR.TaoContext(_ViewProps.__tao), layout: ${layout}, designSpec: ${designSpec}${
    testTag ? gen`, testTag: ${gen.jsLiteral(testTag)}` : ''
  } }${callerProps})}`
}

function compileTaoPropsForViewRender(layout: Compiled, designSpec: Compiled, testTag: string | undefined): Compiled {
  return gen` __tao={TR.TaoProps({ ...TR.TaoContext(_ViewProps.__tao), layout: ${layout}, designSpec: ${designSpec}${
    testTag ? gen`, testTag: ${gen.jsLiteral(testTag)}` : ''
  } })}`
}
