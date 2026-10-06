import { LSPWorkspace, Workspace } from '@compiler/workspace'
import { AST, Langium } from '@parser'
import { FS, Repo } from '@shared'
import { Describe, Expect, Test, withTaoFiles } from '@shared/test'
import { TestCompiler as Compiler, withCompiledTestPlan } from './test-compile'

Describe('compiler: bare renders', () => {
  Test('compiles bare roots and children like explicit zero-argument calls', async () => {
    const app = 'app BareApp { id "bareapp" version "1.0.0" name "Bare" view Main }'
    const bare = await Compiler.compileCode(`use Col, Spacer from @tao/ui ${app} view Main { render Col { Spacer } }`)
    const explicit = await Compiler.compileCode(
      `use Col, Spacer from @tao/ui ${app} view Main() { render Col() { Spacer() } }`,
    )
    Expect(bare.code).toBe(explicit.code)
  })

  Test('imports standard Text privately while explicit Text stays lexical and quotations stay reactive', async () => {
    const compiled = await Compiler.compileCode(`
      use Col from @tao/ui
      app QuotedApp { id "quotedapp" version "1.0.0" name "Quoted" view Main }
      view Main {
        state Name is text = "Books"
        render Col { "{Name}" [pad 8] "" Text("") }
      }
      view Text(Value text) { render "Local {Value}" }
    `)
    const code = compiled.code.replace(/\s+/g, ' ')
    Expect(code).toContain('Text as __tao_quoted_Text$')
    Expect(code).toContain('<__tao_quoted_Text$')
    Expect(code).toContain('<_Scope.Text')
    Expect(code).toContain('_Scope.Name')
    Expect(code).toContain('TR.Design.Spec([["pad",8]])')
    Expect(code.match(/<__tao_quoted_Text\$/g)?.length).toBe(3)
    const standard = compiled.files.find(file => file.code.includes('numberOfLines: 1'))!
    Expect(standard.code).toContain("ellipsizeMode: 'tail'")
  })

  Test('compiles a runnable quotation journey through file-backed workspace services', async () => {
    await withCompiledTestPlan('bare-render-journey-', {
      'Main.tao': `
        use Button, Col from @tao/ui
        app QuotedApp { id "quotedjourney" version "1.0.0" name "Quoted" view Main }
        view Main { state Grouped is boolean = false render Col {
          "Library"
          Button("Group") { on press -> { toggle Grouped } }
          when Grouped { true -> "Grouped" otherwise -> "All" }
        } }
      `,
      'Main.test.tao':
        'use QuotedApp from ./Main test "Quotation" { test "toggles" { run QuotedApp expect text "All" press "Group" expect text "Grouped" } }',
    }, plan => {
      Expect(plan.suites.map(suite => suite.name)).toEqual(['Quotation'])
      Expect(plan.suites[0]!.checks[0]!.run.appName).toBe('QuotedApp')
      Expect(plan.suites[0]!.checks[0]!.steps.map(step => step.kind)).toEqual(['expect', 'press', 'expect'])
    })
  })

  Test('keeps standard quotation linking through an editor document update', async () => {
    await withTaoFiles('bare-render-editor-', {
      '.tao/.gitkeep': '',
      'Main.tao': 'view Main { render "Before" } view Text(Value text) { render inject ```ts return null ``` }',
    }, async (paths, root) => {
      const workspace = await LSPWorkspace.open(root)
      const services = workspace.services
      const documents = services.shared.workspace.LangiumDocuments
      const builder = services.shared.workspace.DocumentBuilder
      const document = documents.getDocument(Langium.URI.file(paths['Main.tao']!))!
      await builder.build(Array.from(documents.all), { eagerLinking: true, validation: true })
      const quotationTarget = () => {
        const render = AST.streamAllContents(document.parseResult.value).find(AST.isQuotedRender)!
        return AST.getDocument(render.view!.ref!).uri.path
      }
      Expect(quotationTarget().endsWith('/@tao/ui/Views.tao')).toBe(true)
      await FS.writeText(
        paths['Main.tao']!,
        'view Main { render "After" } view Text(Value text) { render inject ```ts return null ``` }',
      )
      await builder.update([document.uri], [])
      Expect(quotationTarget().endsWith('/@tao/ui/Views.tao')).toBe(true)
      Expect(
        (document.diagnostics ?? []).filter(diagnostic => diagnostic.severity === 1).map(diagnostic =>
          diagnostic.message
        ),
      ).toEqual([])
    })
  })

  Test('loads graduated Syntax2 sources and leaves future targets undiscovered', async () => {
    const workspace = await Workspace.open(Repo.resolvePath('Apps/Syntax2'))
    const parsed = await workspace.parse('Main.tao')
    Expect(parsed.files.some(file => file.path.endsWith('/Apps/Syntax2/Main.tao'))).toBe(true)
    Expect(parsed.files.some(file => file.path.endsWith('.future'))).toBe(false)
    Expect(parsed.files.some(file => file.path.endsWith('/Apps/Syntax2/library/Library.tao'))).toBe(true)
    Expect(parsed.diagnostics.map(diagnostic => diagnostic.message)).toEqual([])
  })

  Test('renames authored Text references without replacing quoted content', async () => {
    const source = 'use Col, Text from @tao/ui view Main { render Col { "Hello" Text("Explicit") } }'
    await withTaoFiles('bare-render-rename-', {
      '.tao/.gitkeep': '',
      'Main.tao': source,
    }, async (paths, root) => {
      const workspace = await LSPWorkspace.open(root)
      const services = workspace.services
      const documents = services.shared.workspace.LangiumDocuments
      await services.shared.workspace.DocumentBuilder.build(Array.from(documents.all), { eagerLinking: true })
      const document = documents.getDocument(Langium.URI.file(paths['Main.tao']!))!
      const quotation = AST.streamAllContents(document.parseResult.value).find(AST.isQuotedRender)!
      const text = quotation.view!.ref!
      const standard = AST.getDocument(text)
      const name = Langium.GrammarUtils.findNodeForProperty(text.$cstNode, 'name')!
      const edit = await services.language.lsp.RenameProvider!.rename(standard, {
        newName: 'Words',
        position: name.range.start,
        textDocument: { uri: standard.uri.toString() },
      })
      const edits = edit!.changes![document.uri.toString()]!
      Expect(edits.map(edit => document.textDocument.getText(edit.range)).sort()).toEqual(['Text', 'Text'])
      let renamed = source
      for (
        const edit of edits.toSorted((a, b) =>
          document.textDocument.offsetAt(b.range.start) - document.textDocument.offsetAt(a.range.start)
        )
      ) {
        const start = document.textDocument.offsetAt(edit.range.start)
        const end = document.textDocument.offsetAt(edit.range.end)
        renamed = renamed.slice(0, start) + edit.newText + renamed.slice(end)
      }
      Expect(renamed).toBe('use Col, Words from @tao/ui view Main { render Col { "Hello" Words("Explicit") } }')
      Expect(quotation.argumentList!.arguments[0]!.value.$cstNode!.text).toBe('"Hello"')
      Expect(standard.uri.path.endsWith('/@tao/ui/Views.tao')).toBe(true)
    })
  })

  Test('preserves guard payload ownership and lowers block-wrapped bare handlers like explicit calls', async () => {
    const source = (handler: string) => `
      app GuardApp { id "guardapp" version "1.0.0" name "Guard" view Main guard { loading -> ${handler} } }
      view Main { render "Main" }
      view Handler { render inject Content @@content \`\`\`ts return Content \`\`\` }
    `
    const wrapped = await Compiler.compileCode(source('{ Handler { "Child" } }'))
    const explicit = await Compiler.compileCode(source('Handler() { "Child" }'))
    const payload = await Compiler.compileCode(source('Context { Handler { "Child" } }'))
    Expect(wrapped.code.replace(/\s+/g, '')).toBe(explicit.code.replace(/\s+/g, ''))
    Expect(payload.code).toContain('_Scope.Context = _TaoCasePayload')
    Expect(wrapped.code).not.toContain('_Scope.Context = _TaoCasePayload')
    Expect(wrapped.code).toContain('<_Scope.Handler')
    Expect(wrapped.code).toContain('<__tao_quoted_Text$')
  })

  Test('keeps the quotation import distinct from a public view named like the old alias', async () => {
    const compiled = await Compiler.compileCode(`
      app Sample { id "sample" name "Sample" version "1.0.0" view Main }
      public view __tao_quoted_Text { render "Inner" }
      view Main { render __tao_quoted_Text }
    `)
    Expect(compiled.code).toContain('Text as __tao_quoted_Text$')
    Expect(compiled.code).toContain('export const __tao_quoted_Text =')
    Expect(compiled.code).toContain('<__tao_quoted_Text$')
    Expect(compiled.code).toContain('<_Scope.__tao_quoted_Text')
  })
})
