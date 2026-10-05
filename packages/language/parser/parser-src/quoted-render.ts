import { Langium } from './langium-exports'
import * as AST from './parserASTExport'

const quotations = new WeakSet<AST.Render>()

/** isQuotedRender identifies a quoted occurrence lowered to an ordinary Text invocation. */
export function isQuotedRender(node: AST.Node): node is AST.Render {
  return AST.isRender(node) && quotations.has(node)
}

/** quotedTextImport selects the standard Text declaration by its package origin. */
export function quotedTextImport(): AST.UseStatement {
  return {
    $type: 'UseStatement',
    $container: { $type: 'TaoFile', statements: [] },
    importPath: '@tao/ui',
    all: false,
    importedDeclarations: [],
  }
}

/** createQuotedRenderParser preserves source CST while lowering quotations before any linking. */
export function createQuotedRenderParser(services: Langium.LangiumCoreServices) {
  const parser = Langium.createLangiumParser(services)
  const parse = parser.parse.bind(parser)
  parser.parse = <T extends Langium.AstNode>(source: string, options?: Parameters<typeof parser.parse>[1]) => {
    const result = parse<T>(source, options)
    for (const node of Langium.AstUtils.streamAst(result.value)) {
      if (!AST.isRender(node) || !node.quotation) {
        continue
      }
      const value = node.quotation
      const list: AST.ArgumentList = {
        $type: 'ArgumentList',
        $container: node,
        arguments: [],
        $cstNode: value.$cstNode,
      }
      const argument: AST.Argument = { $type: 'Argument', $container: list, value, $cstNode: value.$cstNode }
      list.arguments.push(argument)
      node.argumentList = list
      node.view = services.references.Linker.buildReference(node, 'view', undefined, 'Text') as Langium.Reference<
        AST.RenderTarget
      >
      delete node.quotation
      quotations.add(node)
      Langium.AstUtils.linkContentToContainer(node)
      Langium.AstUtils.linkContentToContainer(list)
      Langium.AstUtils.linkContentToContainer(argument)
    }
    return result
  }
  return parser
}
