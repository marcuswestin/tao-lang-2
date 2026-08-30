import { AST } from '@parser'
import { Assert, Switch } from '@shared'
import { type CodegenOptions, type Compiled, gen } from '../codegen-util'
import { Compile } from '../Compile'

export const TaoPropsCompiler = {
  /** RenderTaoProps compiles the __tao prop fragment for a render invocation. */
  RenderTaoProps(render: AST.Render, options: CodegenOptions = {}): Compiled {
    const designSpec = render.layoutClause ? Compile.DesignSpec(render.layoutClause) : gen`undefined`
    // Every view occurrence takes the same defaults; layout comes only from the call site's clauses.
    const layout = gen`undefined`
    const testTag = AST.testTagForRender(render)
    const studio = options.studio === true ? compileStudioRenderOccurrence(render) : undefined
    return Switch.type(render, {
      RenderStatement: renderStatement =>
        compileTaoPropsForRenderStatement(layout, designSpec, testTag, studio, renderStatement),
      ViewRender: () => compileTaoPropsForViewRender(layout, designSpec, testTag, studio),
    })
  },
} as const

function compileTaoPropsForRenderStatement(
  layout: Compiled,
  designSpec: Compiled,
  testTag: string | undefined,
  studio: Compiled | undefined,
  render: AST.RenderStatement,
): Compiled {
  const inheritsCallerProps = AST.isBlock(render.$container)
    && AST.isViewDeclaration(render.$container.$container)
  const callerProps = inheritsCallerProps ? gen`, _ViewProps.__tao` : gen``
  return gen` __tao={TR.TaoProps({ ...TR.TaoContext(_ViewProps.__tao), layout: ${layout}, designSpec: ${designSpec}${
    testTag ? gen`, testTag: ${gen.jsLiteral(testTag)}` : ''
  }${studio ? gen`, studio: ${studio}` : ''} }${callerProps})}`
}

function compileTaoPropsForViewRender(
  layout: Compiled,
  designSpec: Compiled,
  testTag: string | undefined,
  studio: Compiled | undefined,
): Compiled {
  return gen` __tao={TR.TaoProps({ ...TR.TaoContext(_ViewProps.__tao), layout: ${layout}, designSpec: ${designSpec}${
    testTag ? gen`, testTag: ${gen.jsLiteral(testTag)}` : ''
  }${studio ? gen`, studio: ${studio}` : ''} })}`
}

/** compileStudioRenderOccurrence emits one version-bound source locator for a rendered occurrence. */
function compileStudioRenderOccurrence(render: AST.Render): Compiled {
  const cstNode = render.$cstNode
  Assert.defined(cstNode, 'compiled render has source coordinates')
  const owner = AST.findOwningView(render)
  return gen`{
    sourcePath: ${gen.jsLiteral(AST.getDocument(render).uri.fsPath)},
    start: ${cstNode.offset},
    end: ${cstNode.end},
    kind: 'render',
    ${owner ? gen`ownerName: ${gen.nameLiteral(owner)},` : ''}
  }`
}
