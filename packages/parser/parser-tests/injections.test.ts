import { Describe, Expect, Test } from '@shared/test'
import { AST, Parser } from '../parser-src/parser'
import { testParseCode } from './test-parse'

Describe('Tao injection parser', () => {
  Test('parses top-level injections for later validator checks', async () => {
    const parsed = await testParseCode('inject ```ts\nreturn null\n```')

    Expect(parsed.ast.statements).toHaveLength(1)
  })

  Test('parses render injections', async () => {
    const parsed = await testParseCode('ui Native { render inject ```ts\nreturn null\n``` }')
    const view = parsed.ast.statements[0]

    Expect.Is(view, AST.isUiDeclaration)

    const render = view.block.statements[0]
    Expect.Is(render, AST.isRender)
    Expect(render.injection?.tsCodeBlock).toContain('return null')
  })

  Test('parses inject arguments', async () => {
    const parsed = await testParseCode(`
      alias UserName = "Ro"
      ui Native Value text {
        render inject Value, Name UserName, Count 3, Greeting "Hello" \`\`\`ts
          return null
        \`\`\`
      }
    `)
    const view = parsed.ast.statements[1]

    Expect.Is(view, AST.isUiDeclaration)

    const render = view.block.statements[0]
    Expect.Is(render, AST.isRender)

    const args = render.injection?.argumentList?.arguments ?? []
    Expect(args).toHaveLength(4)

    const [valueArg, nameArg, countArg, greetingArg] = args
    Expect.Is(valueArg, AST.isShorthandInjectionArgument)
    Expect(valueArg.value.target.ref?.name).toBe('Value')

    Expect.Is(nameArg, AST.isNamedInjectionArgument)
    Expect(nameArg.name).toBe('Name')
    Expect.Is(nameArg.value, AST.isValueReference)
    Expect(nameArg.value.target.ref?.name).toBe('UserName')

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
    const parsed = await Parser.parseCode(`
      ui Native {
        render inject Missing, Name OtherMissing \`\`\`ts
          return null
        \`\`\`
      }
    `)

    Expect(parsed.document.parseResult.lexerErrors).toEqual([])
    Expect(parsed.document.parseResult.parserErrors).toEqual([])
    Expect(parsed.diagnostics).toHaveLength(2)
  })
})
