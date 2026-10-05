import { ASTUtils } from '@ast-utils'
import { AST } from '@parser'
import { Assert, Switch } from '@shared'
import { renderSourceIdentity, studioRectMarkerPrefix, studioRenderIdentity } from '../../../studio-render-identity'
import { type CodegenOptions, type Compiled, gen } from '../codegen-util'
import { Compile } from '../Compile'

export const TaoPropsCompiler = {
  /** StudioRenderIdentity emits the preview-only occurrence identity shared by native inspection and Lens profiling. */
  StudioRenderIdentity(render: AST.Render, projectRoot: string | undefined): Compiled {
    return compileStudioRenderOccurrence(render, projectRoot)
  },

  /** RenderTaoProps compiles the __tao prop fragment for a render invocation. */
  RenderTaoProps(render: AST.Render, options: CodegenOptions = {}): Compiled {
    return gen` __tao={${TaoPropsCompiler.RenderTaoPropsValue(render, options)}}`
  },

  /** RenderTaoPropsValue shares occurrence metadata with mounts that consume a props object. */
  RenderTaoPropsValue(render: AST.Render, options: CodegenOptions = {}): Compiled {
    const designSpec = render.layoutClause ? Compile.DesignSpec(render.layoutClause) : gen`undefined`
    const designSource = options.studio === true && render.layoutClause
      ? Compile.DesignSpecSource(render.layoutClause)
      : undefined
    const elementName = ASTUtils.design.standardElementName(render)
    const designDefault = elementName === undefined ? undefined : gen`${gen.jsLiteral(elementName)}`
    // Every view occurrence takes the same defaults; layout comes only from the call site's clauses.
    const layout = gen`undefined`
    const testTag = publicTestTagForRender(render)
    const label = AST.renderPrefixCluster(render).find(AST.isRenderAccessibilityStatement)
    const accessibilityLabel = label ? gen`${Compile.Expression(label.value)}.evaluate().jsValue` : undefined
    const studio = options.studio === true
      ? TaoPropsCompiler.StudioRenderIdentity(render, options.projectRoot)
      : undefined
    const journeyObservation = options.journeyObservations === true ? compileJourneyRenderOccurrence(render) : undefined
    const fields: TaoPropsFields = {
      accessibilityLabel,
      designDefault,
      designSource,
      designSpec,
      interaction: Compile.OutlineRenderInteraction(render),
      journeyObservation,
      layout,
      studio,
      testTag,
    }
    return Switch.type(render, {
      RenderStatement: renderStatement => compileTaoPropsForRenderStatement(fields, renderStatement),
      ViewRender: () => compileTaoPropsForViewRender(fields),
    })
  },

  /** RenderSlotTaoProps compiles occurrence metadata from the actual placement, as an expression. */
  RenderSlotTaoProps(use: AST.RenderSlotUse, options: CodegenOptions = {}): Compiled {
    const label = AST.renderPrefixCluster(use).find(AST.isRenderAccessibilityStatement)
    const tag = AST.attachedTag(use)?.tag.slice(1)
    const fields: TaoPropsFields = {
      accessibilityLabel: label ? gen`${Compile.Expression(label.value)}.evaluate().jsValue` : undefined,
      designDefault: undefined,
      designSource: undefined,
      designSpec: gen`undefined`,
      interaction: undefined,
      journeyObservation: options.journeyObservations ? compileJourneyRenderOccurrence(use) : undefined,
      layout: gen`undefined`,
      studio: options.studio ? compileStudioRenderOccurrence(use, options.projectRoot) : undefined,
      testTag: tag?.startsWith(studioRectMarkerPrefix) ? undefined : tag,
    }
    return gen`TR.ViewTaoProps(${compileTaoPropsObject(fields)}, _ViewProps.__tao, false)`
  },
} as const

type TaoPropsFields = {
  accessibilityLabel: Compiled | undefined
  designDefault: Compiled | undefined
  designSource: Compiled | undefined
  designSpec: Compiled
  /** interaction is the occurrence's outline metadata: the control it is, the row root it renders. */
  interaction: Compiled | undefined
  journeyObservation: Compiled | undefined
  layout: Compiled
  studio: Compiled | undefined
  testTag: string | undefined
}

function compileTaoPropsForRenderStatement(fields: TaoPropsFields, render: AST.RenderStatement): Compiled {
  const owningBlock = render.$container
  const owningView = AST.isBlock(owningBlock) && AST.isViewDeclaration(owningBlock.$container)
    ? owningBlock.$container
    : undefined
  const inheritsCallerProps = owningView !== undefined
  // A declaration header resolves into the root render's caller chain ahead of the caller's own
  // clause (Decisions §R9); a nested `render` statement never reaches its enclosing view's header
  // because it is never the root (`owningView` is undefined there).
  const callerChain = owningView?.layoutClause ? gen`_DeclarationProps` : gen`_ViewProps.__tao`
  // Nested `render` statements must still advance the generated-view depth. They intentionally
  // omit the full caller-props chain, matching ViewRender, because only a view's root inherits it.
  const callerProps = gen`, ${callerChain}${inheritsCallerProps ? gen`` : gen`, false`}`
  return gen`TR.ViewTaoProps(${compileTaoPropsObject(fields)}${callerProps})`
}

function compileTaoPropsForViewRender(fields: TaoPropsFields): Compiled {
  return gen`TR.ViewTaoProps(${compileTaoPropsObject(fields)}, _ViewProps.__tao, false)`
}

function compileTaoPropsObject(fields: TaoPropsFields): Compiled {
  return gen`{ ...TR.TaoContext(_ViewProps.__tao), layout: ${fields.layout}, designSpec: ${fields.designSpec}${
    fields.designSource ? gen`, designSource: ${fields.designSource}` : ''
  }${fields.designDefault ? gen`, designDefault: ${fields.designDefault}` : ''}${
    fields.testTag ? gen`, testTag: ${gen.jsLiteral(fields.testTag)}` : ''
  }${fields.studio ? gen`, studio: ${fields.studio}` : ''}${
    fields.journeyObservation ? gen`, journeyObservation: ${fields.journeyObservation}` : ''
  }${fields.interaction ? gen`, interaction: ${fields.interaction}` : ''}${
    fields.accessibilityLabel ? gen`, accessibilityLabel: ${fields.accessibilityLabel}` : ''
  } }`
}

/** compileJourneyRenderOccurrence carries source identity through test props without Studio runtime instrumentation. */
function compileJourneyRenderOccurrence(render: AST.Render | AST.RenderSlotUse): Compiled {
  const identity = renderSourceIdentity(render)
  Assert.defined(identity, 'compiled render has source coordinates')
  return gen`{
    renderId: ${gen.jsLiteral(identity.renderId)},
    sourcePath: ${gen.jsLiteral(identity.sourcePath)},
    sourceVersion: ${gen.jsLiteral(identity.sourceVersion)},
    start: ${identity.start},
    end: ${identity.end},
  }`
}

/**
 * publicTestTagForRender drops Snap's private `#studio_rect_…` marker from the shipped test tag.
 * The marker names a Studio rectangle, not a testable element, and every build — release included —
 * emits `testTag` as the element's public testID, so only `studioRectId` may carry the marker.
 */
function publicTestTagForRender(render: AST.Render): string | undefined {
  const tags = AST.testTagForRender(render)?.split(' ').filter(tag => !tag.startsWith(studioRectMarkerPrefix)) ?? []
  return tags.length > 0 ? tags.join(' ') : undefined
}

/** compileStudioRenderOccurrence emits one version-bound source locator for a rendered occurrence. */
function compileStudioRenderOccurrence(
  render: AST.Render | AST.RenderSlotUse,
  projectRoot: string | undefined,
): Compiled {
  const cstNode = render.$cstNode
  Assert.defined(cstNode, 'compiled render has source coordinates')
  Assert.defined(projectRoot, 'Studio render compilation has an exact project root')
  const owner = AST.findOwningView(render)
  const identity = AST.isRenderSlotUse(render) ? undefined : studioRenderIdentity(render, projectRoot)
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
