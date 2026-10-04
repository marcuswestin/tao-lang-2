import { ASTUtils } from '@ast-utils'
import { AST } from '@parser'
import { Assert } from '@shared'
import { type Compiled, gen } from '../codegen-util'
import { declarationModuleName } from './declaration-identity'

type OutlineNode =
  | { kind: 'collection'; loop: AST.ForStatement; owner: AST.ViewDeclaration }
  | { kind: 'control'; descriptor: ASTUtils.OutlineControlDescriptor; owner: AST.ViewDeclaration; render: AST.Render }
  | { kind: 'region'; descriptor: ASTUtils.OutlineSiblingRegionDescriptor; owner: AST.ViewDeclaration }

/**
 * InteractionOutlineCompiler emits what the runtime's interaction outline knows statically: one
 * table per module of loop and control descriptors, referenced from the loop frame and the render
 * site's Tao props. The table is generated; registering its nodes is the runtime's, so nothing
 * generated is ever attached to `TR`.
 */
export const InteractionOutlineCompiler = {
  /** OutlineTable emits the module's static outline nodes, or nothing when the module has none. */
  OutlineTable(taoFile: AST.TaoFile, statements: readonly AST.Statement[] = taoFile.statements): Compiled {
    const nodes = outlineNodesOf(statements)
    const first = nodes[0]
    if (!first) {
      return gen.noop()
    }
    return gen`const _TaoOutline = TR.Interaction.OutlineTable({
      module: ${gen.jsLiteral(declarationModuleName(first.owner))},
      nodes: {
        ${gen.list(nodes, node => gen`${gen.jsLiteral(outlineNodeKey(node))}: ${compileNode(node)},`)}
      },
    })`
  },

  /** OutlineLoopReference names a loop's table entry for the diagnostics frame `TR.ForEach` takes. */
  OutlineLoopReference(loop: AST.ForStatement): Compiled {
    return gen`_TaoOutline[${gen.jsLiteral(outlineSourceKey(loop))}]`
  },

  /**
   * OutlineRenderInteraction compiles the `interaction` Tao prop of one render site: the control
   * it is, and the loop row whose sole root it renders. A selectable row carries its label on the
   * press surface the runtime wraps around it, so only a non-selectable row marks its root.
   */
  OutlineRenderInteraction(render: AST.Render): Compiled | undefined {
    const control = ASTUtils.outlineControlDescriptor(render)
    const loop = rowRootLoop(render)
    const region = ASTUtils.outlineSiblingRegionForRender(render)
    if (!control && !loop && !region) {
      return undefined
    }
    const fields = [
      ...(control ? [gen`control: _TaoOutline[${gen.jsLiteral(outlineSourceKey(render))}]`] : []),
      ...(loop ? [gen`row: TR.Interaction.RowRoot(${gen.scopeName(loop)})`] : []),
      ...(region
        ? [gen`region: _TaoOutline[${gen.jsLiteral(siblingRegionKey(AST.findOwningView(render)!))}]`]
        : []),
    ]
    return gen`{ ${gen.join(fields, field => field)} }`
  },
} as const

function outlineNodesOf(statements: readonly AST.Statement[]): OutlineNode[] {
  const nodes: OutlineNode[] = []
  for (const owner of statements.filter(AST.isViewDeclaration)) {
    const descriptor = ASTUtils.outlineSiblingRegionDescriptor(owner)
    if (descriptor) {
      nodes.push({ descriptor, kind: 'region', owner })
    }
  }
  for (const node of statements.flatMap(statement => [statement, ...AST.streamAllContents(statement)])) {
    const owner = AST.findOwningView(node)
    if (!owner) {
      continue
    }
    if (AST.isForStatement(node)) {
      nodes.push({ kind: 'collection', loop: node, owner })
    } else if (AST.isRender(node)) {
      const descriptor = ASTUtils.outlineControlDescriptor(node)
      if (descriptor) {
        nodes.push({ descriptor, kind: 'control', owner, render: node })
      }
    }
  }
  return nodes
}

function compileNode(node: OutlineNode): Compiled {
  if (node.kind === 'collection') {
    const descriptor = ASTUtils.outlineLoopDescriptor(node.loop)
    const attachedTag = AST.attachedTag(node.loop)?.tag
    const testTag = attachedTag === undefined ? undefined : attachedTag.slice(1)
    return gen`${
      gen.jsLiteral({
        declaration: node.owner.name,
        kind: 'collection',
        ...descriptor,
        ...(testTag === undefined ? {} : { testTag }),
      })
    }`
  }
  if (node.kind === 'control') {
    return gen`${gen.jsLiteral({ declaration: node.owner.name, kind: 'control', ...node.descriptor })}`
  }
  // Concrete roots are compiler-only; stable member declaration names belong in the runtime table.
  const { roots: _roots, ...descriptor } = node.descriptor
  return gen`${gen.jsLiteral({ declaration: node.owner.name, kind: 'region', role: 'nav-siblings', ...descriptor })}`
}

/** A node's key is its owning view plus its source offset, unique within the module. */
function outlineSourceKey(node: AST.ForStatement | AST.Render): string {
  const owner = AST.findOwningView(node)
  const cst = node.$cstNode
  Assert.defined(owner, 'outline node is written in a view')
  Assert.defined(cst, 'outline node has source coordinates')
  return `${owner.name}#${cst.offset}`
}

function outlineNodeKey(node: OutlineNode): string {
  return node.kind === 'region'
    ? siblingRegionKey(node.owner)
    : outlineSourceKey(node.kind === 'collection' ? node.loop : node.render)
}

function siblingRegionKey(owner: AST.ViewDeclaration): string {
  return `${owner.name}#nav-siblings`
}

/** rowRootLoop returns the non-selectable loop whose sole unconditional row root this render is. */
function rowRootLoop(render: AST.Render): AST.ForStatement | undefined {
  const block = render.$container
  const loop = AST.isBlock(block) && AST.isForStatement(block.$container) ? block.$container : undefined
  if (!loop || AST.loopRowRoot(loop) !== render || AST.loopSelectHandlers(loop).length > 0) {
    return undefined
  }
  return loop
}
