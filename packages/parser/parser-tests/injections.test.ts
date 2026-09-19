import { Type } from '@ast-utils'
import { Diagnostics } from '@shared'
import { Describe, Expect, Test } from '@shared/test'
import { AST } from '../parser-src/parser'
import { parseCodeWithErrors, testParseCode } from './test-parse'

Describe('parser: injections', () => {
  Test('parses top-level injections for later validator checks', async () => {
    const parseResult = await testParseCode('inject ```ts\nreturn null\n```')

    Expect(parseResult.entry.ast.statements).toHaveLength(1)
  })

  Test('parses render injections', async () => {
    const parseResult = await testParseCode('view Native() { render inject ```ts\nreturn null\n``` }')
    const view = parseResult.entry.ast.statements[0]

    Expect.Is(view, AST.isViewDeclaration)
    const render = AST.blockStatementOf(view, 0)
    Expect.Is(render, AST.isRenderStatement)
    Expect(render.injection?.tsCodeBlock).toContain('return null')
  })

  Test('parses inject arguments', async () => {
    const parseResult = await testParseCode(`
      let UserName = "Ro"
      view Native(Value text) {
        render inject Value, Name UserName, Count 3, Greeting "Hello" \`\`\`ts
          return null
        \`\`\`
      }
    `)
    const view = parseResult.entry.ast.statements[1]

    Expect.Is(view, AST.isViewDeclaration)
    const render = AST.blockStatementOf(view, 0)
    Expect.Is(render, AST.isRenderStatement)
    Expect.Is(render.injection, AST.isInjection)
    const args = AST.injectionArgumentsOf(render.injection)

    Expect(args).toHaveLength(4)

    const [valueArg, nameArg, countArg, greetingArg] = args
    Expect.Is(valueArg, AST.isShorthandInjectionArgument)
    Expect(valueDeclarationName(valueArg.value.target.ref)).toBe('Value')

    Expect.Is(nameArg, AST.isNamedInjectionArgument)
    Expect(nameArg.name).toBe('Name')
    Expect.Is(nameArg.value, AST.isValueReference)
    Expect(valueDeclarationName(nameArg.value.target.ref)).toBe('UserName')

    Expect.Is(countArg, AST.isNamedInjectionArgument)
    Expect(countArg.name).toBe('Count')
    Expect.Is(countArg.value, AST.isNumberLiteral)
    Expect(countArg.value.value).toBe(3)

    Expect.Is(greetingArg, AST.isNamedInjectionArgument)
    Expect(greetingArg.name).toBe('Greeting')
    Expect.Is(greetingArg.value, AST.isStringLiteral)
    Expect(greetingArg.value.value).toBe('Hello')
  })

  Test('reports linker diagnostics for unresolved inject arguments', async () => {
    const parseResult = await parseCodeWithErrors(`
      view Native() {
        render inject Missing, Name OtherMissing \`\`\`ts
          return null
        \`\`\`
      }
    `)

    Expect(parseResult.entry.document.parseResult.lexerErrors).toEqual([])
    Expect(parseResult.entry.document.parseResult.parserErrors).toEqual([])
    Expect(parseResult.diagnostics).toHaveLength(2)
    Expect(Diagnostics.allFromSource(parseResult.diagnostics, 'linker')).toBe(true)
    Expect(Diagnostics.allWithSeverity(parseResult.diagnostics, 'error')).toBe(true)
    Expect(Diagnostics.allMessagesContain(parseResult.diagnostics, ' is in scope.')).toBe(true)
  })
})

function valueDeclarationName(declaration: AST.ValueDeclaration | undefined): string | undefined {
  if (!declaration) {
    return undefined
  }
  return AST.isParameterDeclaration(declaration) ? Type.parameterName(declaration) : declaration.name
}
