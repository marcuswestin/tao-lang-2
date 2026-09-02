import { ASTUtils } from '@ast-utils'
import { AST } from '@parser'
import { Assert } from '@shared'
import { type Compiled, gen } from '../codegen-util'
import { declarationModuleName } from './declaration-identity'

type OutlineNode =
  | { kind: 'collection'; loop: AST.ForStatement; owner: AST.ViewDeclaration }
  | { kind: 'control'; descriptor: ASTUtils.OutlineControlDescriptor; owner: AST.ViewDeclaration; render: AST.Render }

/**
 * InteractionOutlineCompiler emits what the runtime's interaction outline knows statically: one
 * table per module of loop and control descriptors, referenced from the loop frame and the render
 * site's Tao props. The table is generated; registering its nodes is the runtime's, so nothing
 * generated is ever attached to `TR`.
 */
export const InteractionOutlineCompiler = {
  /** OutlineTable emits the module's static outline nodes, or nothing when the module has none. */
  OutlineTable(taoFile: AST.TaoFile): Compiled {
    const nodes = outlineNodesOf(taoFile)
    const first = nodes[0]
    if (!first) {
      return gen.noop()
    }
    return gen`const _TaoOutline = TR.Interaction.OutlineTable({
      module: ${gen.jsLiteral(declarationModuleName(first.owner))},
      nodes: {
        ${gen.list(nodes, node => gen`${gen.jsLiteral(outlineNodeKey(nodeOf(node)))}: ${compileNode(node)},`)}
      },
    })`
  },

  /** OutlineLoopReference names a loop's table entry for the diagnostics frame `TR.ForEach` takes. */
  OutlineLoopReference(loop: AST.ForStatement): Compiled {
    return gen`_TaoOutline[${gen.jsLiteral(outlineNodeKey(loop))}]`
  },

  /**
   * OutlineRenderInteraction compiles the `interaction` Tao prop of one render site: the control
   * it is, and the loop row whose sole root it renders. A selectable row carries its label on the
   * press surface the runtime wraps around it, so only a non-selectable row marks its root.
   */
  OutlineRenderInteraction(render: AST.Render): Compiled | undefined {
    const control = ASTUtils.outlineControlDescriptor(render)
    const loop = rowRootLoop(render)
    if (!control && !loop) {
      return undefined
    }
    const fields = [
      ...(control ? [gen`control: _TaoOutline[${gen.jsLiteral(outlineNodeKey(render))}]`] : []),
      ...(loop ? [gen`row: TR.Interaction.RowRoot(${gen.scopeName(loop)})`] : []),
    ]
    return gen`{ ${gen.join(fields, field => field)} }`
  },
} as const

function outlineNodesOf(taoFile: AST.TaoFile): OutlineNode[] {
  const nodes: OutlineNode[] = []
  for (const node of AST.streamAllContents(taoFile)) {
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

function nodeOf(node: OutlineNode): AST.ForStatement | AST.Render {
  return node.kind === 'collection' ? node.loop : node.render
}

function compileNode(node: OutlineNode): Compiled {
  if (node.kind === 'collection') {
    const descriptor = ASTUtils.outlineLoopDescriptor(node.loop)
    return gen`${gen.jsLiteral({ declaration: node.owner.name, kind: 'collection', ...descriptor })}`
  }
  return gen`${gen.jsLiteral({ declaration: node.owner.name, kind: 'control', ...node.descriptor })}`
}

/** A node's key is its owning view plus its source offset, unique within the module. */
function outlineNodeKey(node: AST.ForStatement | AST.Render): string {
  const owner = AST.findOwningView(node)
  const cst = node.$cstNode
  Assert.defined(owner, 'outline node is written in a view')
  Assert.defined(cst, 'outline node has source coordinates')
  return `${owner.name}#${cst.offset}`
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
