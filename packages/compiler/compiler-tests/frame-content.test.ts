import { Describe, Expect, Test } from '@shared/test'
import { TestCompiler as Compiler } from './test-compile'

const tsFence = '```ts'
const fence = '```'

Describe('compiler: frame content and render injection channels', () => {
  Test('separates unnamed content and named frame fills without a native wrapper', async () => {
    const compiled = await Compiler.compileCode(`
      view Card() {
        @actions = empty
        render Col() {
          @actions
          @@content
        }
      }
      view Col() {
        render inject Content @@content, Layout @@layout, Tag @@tag ${tsFence}
          return <RN.View>{Content}</RN.View>
        ${fence}
      }
      view Label() { render inject ${tsFence} return null ${fence} }
      view Button(Press action()) { render inject Press ${tsFence} return null ${fence} }
      view Main() {
        render Card() [claim 2] {
          Label()
          @actions Button() {
            #resetSignedOut
            on press -> { }
          }
        }
      }
      app Demo { view Main }
    `)

    Expect(compiled.code).toContain('__taoSlots?: Readonly<Record<string, React.ReactNode>>')
    Expect(compiled.code).toContain('_ViewProps.__taoSlots?.["@actions"] ?? null')
    Expect(compiled.code).toContain('"@actions": <_Scope.Button')
    Expect(compiled.code).toContain('return <_Scope.Card')
    Expect(compiled.code).toContain('layout: undefined')
    Expect(compiled.code).toContain('designSpec: TR.Design.Spec([["claim",2]])')
    Expect(compiled.code).toContain('{_ViewProps.children}')
    Expect(compiled.code).toContain('testTag: "resetSignedOut"')
  })

  Test('passes only explicitly named Tao and ambient values into render fences', async () => {
    const compiled = await Compiler.compileCode(`
      view Native() {
        render inject Content @@content, Layout @@layout, Tag @@tag ${tsFence}
          return TR.Views.View({ children: Content, layout: Layout, tag: Tag })
        ${fence}
      }
      view Main() { render Native() }
      app Demo { view Main }
    `)

    const boundary = compiled.files.find(file => file.relativePath === 'App.injection-1.tsx')
    Expect(boundary).toBeDefined()
    Expect(boundary?.code).toContain(
      "export default function(Content: import('react').ReactNode, Layout: ReturnType<typeof TR.VisualLayout>, Tag: string | undefined)",
    )
    Expect(boundary?.code).toContain(
      'return TR.Views.View({ children: Content, layout: Layout, tag: Tag })',
    )
    Expect(compiled.code).toContain(
      '[_ViewProps.children, TR.VisualLayout(_ViewProps.__tao), TR.VisualTag(_ViewProps.__tao)]',
    )
    Expect(compiled.code).not.toContain('children: Content')
    Expect(boundary?.code).not.toContain('_ViewProps')
    Expect(boundary?.code).not.toContain('_tao')
    Expect(boundary?.code).not.toContain('_Scope')
    Expect(boundary?.code).not.toContain("from './App'")
  })
})
