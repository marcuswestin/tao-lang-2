import { AST } from '@parser'
import { Describe, Expect, Test } from '@shared/test'
import { testParseSyntax } from './test-parse'

Describe('parser: scenes', () => {
  Test('parses a scene as a view declaration carrying the scene keyword', async () => {
    const parsed = await testParseSyntax(`
       scene Home() {
          Title "Home"
          render Text("Hello")
       }

       view Row() {
          render Text("Hello")
       }
    `)
    const declarations = parsed.entry.ast.statements.filter(AST.isViewDeclaration)
    Expect(declarations.map(declaration => declaration.name)).toEqual(['Home', 'Row'])
    // A scene is a view declaration, exactly as `scene is view` says. Only the flag differs, which
    // is what lets every cross-reference to a view keep resolving one.
    Expect(declarations.map(declaration => declaration.scene === true)).toEqual([true, false])
  })

  Test('parses a scene with parameters, a response, and a visibility marker', async () => {
    const parsed = await testParseSyntax(`
       type Answer is one of Confirmed

       workspace
       scene Editor(Title text) responds Answer {
          render Text(Title)
       }
    `)
    const scene = parsed.entry.ast.statements.filter(AST.isViewDeclaration)[0]
    Expect(scene?.scene).toBe(true)
    Expect(scene?.visibility).toBe('workspace')
    Expect(scene?.response?.$refText).toBe('Answer')
    Expect(scene?.parameterList?.parameters.length).toBe(1)
  })
})
