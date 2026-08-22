import { ASTUtils } from '@ast-utils'
import { AST } from '@parser'
import { Describe, Expect, Test } from '@shared/test'
import { testParseCode } from './test-parse'

Describe('parser: minimal design declarations', () => {
  Test('parses flat colors, named combined bundles, app selection, and render use', async () => {
    const parsed = await testParseCode(`
      workspace design WordFlowerDesign {
        short #abc
        alpha #abcd
        ink #121826
        overlayColor #121826cc
        screen [fill, content top stretch, pad 16, bg ink]
        constrained [screen, claim 2, width max 720, centered]
      }

      app Demo {
        view Main
        Design WordFlowerDesign
      }

      view Main() {
        render Col() [constrained]
      }
      layout Col() { }
    `)

    const design = parsed.entry.ast.statements.find(AST.isDesignDeclaration)
    Expect(design?.visibility).toBe('workspace')
    Expect(design?.members.filter(AST.isDesignToken).map(token => token.value)).toEqual([
      '#abc',
      '#abcd',
      '#121826',
      '#121826cc',
    ])
    Expect(design?.members.filter(AST.isDesignBundle).map(bundle => bundle.name)).toEqual([
      'screen',
      'constrained',
    ])
    const app = parsed.entry.ast.statements.find(AST.isAppDeclaration)
    const selected = app?.block?.statements.find(AST.isAppProperty)
    Expect(selected?.value && AST.isValueReference(selected.value) ? selected.value.target.ref : undefined).toBe(design)
  })

  Test('keeps digit-leading contextual tokens parseable in tag syntax for semantic validation', async () => {
    const parsed = await testParseCode(`
      test "tag shape" {
        test "digit tag" {
          press #123abc
        }
      }
    `)

    const tagPress = AST.streamAllContents(parsed.entry.ast).find(AST.isTagPressStep)
    Expect(tagPress?.tag).toBe('#123abc')
  })

  Test('preserves repeated combined clauses in authored left-to-right order', async () => {
    const parsed = await testParseCode(`
      design Theme {
        compact [gap 8, gap 12, width 960, width max 720]
      }
    `)

    const bundle = AST.streamAllContents(parsed.entry.ast).find(AST.isDesignBundle)
    Expect(bundle?.spec.entries.map(ASTUtils.layoutEntryValues)).toEqual([
      ['gap', 8],
      ['gap', 12],
      ['width', 960],
      ['width', 'max', 720],
    ])
  })
})
