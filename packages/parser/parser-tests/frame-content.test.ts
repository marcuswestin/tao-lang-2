import { Diagnostics } from '@shared'
import { Describe, Expect, Test } from '@shared/test'
import { AST } from '../parser-src/parser'
import { parseCodeWithErrors, testParseCode } from './test-parse'

Describe('parser: frame content and render injection channels', () => {
  Test('parses and links frame slots at declaration and call sites', async () => {
    const parsed = await testParseCode(`
      frame Card() {
        @actions = empty
        render Col() {
          @actions
          @@content
        }
      }
      layout Col() {
        render inject Content @@content \`\`\`ts return Content \`\`\`
      }
      view Button() {
        render inject \`\`\`ts return null \`\`\`
      }
      view Main() {
        render Card() {
          Button()
          @actions Button() {
            #resetSignedOut
            on press -> { }
          }
        }
      }
    `)

    const frame = parsed.entry.ast.statements[0]
    Expect.Is(frame, AST.isFrameDeclaration)
    const declaration = AST.blockStatementOf(frame, 0)
    Expect.Is(declaration, AST.isRenderSlotDeclaration)
    Expect(declaration.name).toBe('@actions')

    const root = AST.blockStatementOf(frame, 1)
    Expect.Is(root, AST.isRenderStatement)
    const placement = root.block?.statements[0]
    Expect.Is(placement, AST.isRenderSlotUse)
    Expect(placement.render).toBeUndefined()
    Expect(placement.slot.ref).toBe(declaration)

    const main = parsed.entry.ast.statements[3]
    Expect.Is(main, AST.isViewDeclaration)
    const card = AST.blockStatementOf(main, 0)
    Expect.Is(card, AST.isRenderStatement)
    const fill = card.block?.statements[1]
    Expect.Is(fill, AST.isRenderSlotUse)
    Expect.Is(fill.render, AST.isViewRender)
    Expect(fill.slot.ref).toBe(declaration)
    Expect(AST.testTagForRender(fill.render)).toBe('resetSignedOut')
  })

  Test('parses explicit content, layout, and tag injection channels', async () => {
    const parsed = await testParseCode(`
      layout Native() {
        render inject Content @@content, Layout @@layout, Tag @@tag \`\`\`ts
          return null
        \`\`\`
      }
    `)
    const layout = parsed.entry.ast.statements[0]
    Expect.Is(layout, AST.isLayoutDeclaration)
    const render = AST.blockStatementOf(layout, 0)
    Expect.Is(render, AST.isRenderStatement)
    Expect.Is(render.injection, AST.isInjection)
    const channels = AST.injectionArgumentsOf(render.injection)
      .filter(AST.isNamedInjectionArgument)
      .map(argument => argument.ambient?.channel)
    Expect(channels).toEqual(['@@content', '@@layout', '@@tag'])
  })

  Test('reports an unresolved fill against the invoked frame slot scope', async () => {
    const parsed = await parseCodeWithErrors(`
      frame Card() {
        @actions = empty
        render Col() { @actions @@content }
      }
      layout Col() { render inject Content @@content \`\`\`ts return Content \`\`\` }
      view Button() { render inject \`\`\`ts return null \`\`\` }
      view Main() { render Card() { @missing Button() } }
    `)

    Expect(Diagnostics.errorMessages(parsed.diagnostics)).toContain(
      "Could not resolve reference to RenderSlotDeclaration named '@missing'.",
    )
  })
})
