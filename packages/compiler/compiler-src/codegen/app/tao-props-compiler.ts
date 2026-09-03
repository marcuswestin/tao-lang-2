import { ASTUtils } from '@ast-utils'
import { AST } from '@parser'
import { Assert, Switch } from '@shared'
import { studioRenderIdentity } from '../../studio-render-identity'
import { type CodegenOptions, type Compiled, gen } from '../codegen-util'
import { Compile } from '../Compile'

export const TaoPropsCompiler = {
  /** RenderTaoProps compiles the __tao prop fragment for a render invocation. */
  RenderTaoProps(render: AST.Render, options: CodegenOptions = {}): Compiled {
    const designSpec = render.layoutClause ? Compile.DesignSpec(render.layoutClause) : gen`undefined`
    const designSource = options.studio === true && render.layoutClause
      ? Compile.DesignSpecSource(render.layoutClause)
      : undefined
    const elementName = ASTUtils.standardDesignElementName(render)
    const designDefault = elementName === undefined ? undefined : gen`${gen.jsLiteral(elementName)}`
    // Every view occurrence takes the same defaults; layout comes only from the call site's clauses.
    const layout = gen`undefined`
    const testTag = AST.testTagForRender(render)
    const studio = options.studio === true ? compileStudioRenderOccurrence(render, options.projectRoot) : undefined
    return Switch.type(render, {
      RenderStatement: renderStatement =>
        compileTaoPropsForRenderStatement(
          layout,
          designSpec,
          designSource,
          designDefault,
          testTag,
          studio,
          renderStatement,
        ),
      ViewRender: () => compileTaoPropsForViewRender(layout, designSpec, designSource, designDefault, testTag, studio),
    })
  },
} as const

function compileTaoPropsForRenderStatement(
  layout: Compiled,
  designSpec: Compiled,
  designSource: Compiled | undefined,
  designDefault: Compiled | undefined,
  testTag: string | undefined,
  studio: Compiled | undefined,
  render: AST.RenderStatement,
): Compiled {
  const inheritsCallerProps = AST.isBlock(render.$container)
    && AST.isViewDeclaration(render.$container.$container)
  // Nested `render` statements must still advance the generated-view depth. They intentionally
  // omit the full caller-props chain, matching ViewRender, because only a view's root inherits it.
  const callerProps = gen`, _ViewProps.__tao${inheritsCallerProps ? gen`` : gen`, false`}`
  return gen` __tao={TR.ViewTaoProps({ ...TR.TaoContext(_ViewProps.__tao), layout: ${layout}, designSpec: ${designSpec}${
    designSource ? gen`, designSource: ${designSource}` : ''
  }${designDefault ? gen`, designDefault: ${designDefault}` : ''}${
    testTag ? gen`, testTag: ${gen.jsLiteral(testTag)}` : ''
  }${studio ? gen`, studio: ${studio}` : ''} }${callerProps})}`
}

function compileTaoPropsForViewRender(
  layout: Compiled,
  designSpec: Compiled,
  designSource: Compiled | undefined,
  designDefault: Compiled | undefined,
  testTag: string | undefined,
  studio: Compiled | undefined,
): Compiled {
  return gen` __tao={TR.ViewTaoProps({ ...TR.TaoContext(_ViewProps.__tao), layout: ${layout}, designSpec: ${designSpec}${
    designSource ? gen`, designSource: ${designSource}` : ''
  }${designDefault ? gen`, designDefault: ${designDefault}` : ''}${
    testTag ? gen`, testTag: ${gen.jsLiteral(testTag)}` : ''
  }${studio ? gen`, studio: ${studio}` : ''} }, _ViewProps.__tao, false)}`
}

/** compileStudioRenderOccurrence emits one version-bound source locator for a rendered occurrence. */
function compileStudioRenderOccurrence(render: AST.Render, projectRoot: string | undefined): Compiled {
  const cstNode = render.$cstNode
  Assert.defined(cstNode, 'compiled render has source coordinates')
  Assert.defined(projectRoot, 'Studio render compilation has an exact project root')
  const owner = AST.findOwningView(render)
  const identity = studioRenderIdentity(render, projectRoot)
  return gen`{
    sourcePath: ${gen.jsLiteral(AST.getDocument(render).uri.fsPath)},
    start: ${cstNode.offset},
    end: ${cstNode.end},
    kind: 'render',
    ${identity ? gen`elementName: ${gen.jsLiteral(identity.elementName)},` : ''}
    ${identity?.studioRectId ? gen`studioRectId: ${gen.jsLiteral(identity.studioRectId)},` : ''}
    ${owner ? gen`ownerName: ${gen.nameLiteral(owner)},` : ''}
  }`
}
