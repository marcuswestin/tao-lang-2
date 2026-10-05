import { Describe, Expect, Test } from '@shared/test'
import { AST, Parser } from '../parser-src/parser'

function slice(source: string, range: AST.SyntaxRange | undefined): string | undefined {
  return range === undefined ? undefined : source.slice(range.from, range.to)
}

Describe('parser: syntax parse', () => {
  Test('parses source without loading imports and reports comments in document order', () => {
    const source = 'use Text from @tao/ui\n// leading\nview Main() {\n   render Text("hi") [title] /* inline */\n}\n'

    const parsed = Parser.parseSyntax(source)

    Expect(parsed.errors).toBe(0)
    Expect(parsed.ast.statements.map(statement => statement.$type)).toEqual(['UseStatement', 'ViewDeclaration'])
    Expect(parsed.comments.map(comment => source.slice(comment.from, comment.to))).toEqual([
      '// leading',
      '/* inline */',
    ])
  })

  Test('reports syntax errors without loading or linking a workspace', async () => {
    const parsed = Parser.parseSyntax('view Main( {\n')
    const full = await Parser.parseCode('view Main( {\n')

    Expect(parsed.errors).toBeGreaterThan(0)
    Expect(parsed.diagnostics.map(diagnostic => diagnostic.message)).toEqual(
      full.diagnostics.filter(diagnostic => diagnostic.source === 'lexer' || diagnostic.source === 'parser')
        .map(diagnostic => diagnostic.message),
    )
    Expect(parsed.ast.$type).toBe('TaoFile')
  })

  Test('locates a node, one of its keywords, and one of its properties by source range', () => {
    const source = 'view Main() {\n   Button("Go") {\n      on press -> { }\n   }\n}\n'
    const parsed = Parser.parseSyntax(source)
    const handler = AST.streamAllContents(parsed.ast).find(AST.isEventHandler)
    const view = parsed.ast.statements.find(AST.isViewDeclaration)

    Expect(handler).toBeDefined()
    Expect(slice(source, AST.nodeRange(handler!))).toBe('on press -> { }')
    Expect(slice(source, AST.keywordRange(handler!, '->'))).toBe('->')
    Expect(slice(source, AST.propertyRange(handler!, 'block'))).toBe('{ }')
    Expect(AST.keywordRange(handler!, '=')).toBeUndefined()
    Expect(slice(source, AST.propertyRange(view!, 'block'))).toBe(
      source.slice(source.indexOf('{'), source.lastIndexOf('}') + 1),
    )
  })

  Test('keeps comments out of the node range they precede', () => {
    const source = 'view Main() {\n   // note\n   Text("hi")\n}\n'
    const parsed = Parser.parseSyntax(source)
    const render = AST.streamAllContents(parsed.ast).find(AST.isViewRender)

    Expect(slice(source, AST.nodeRange(render!))).toBe('Text("hi")')
  })
})
