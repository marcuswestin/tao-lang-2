import { Describe, Expect, Test } from '@shared/test'
import { TestCompiler as Compiler } from './test-compile'

Describe('compiler: interaction attention', () => {
  Test('emits richer command metadata plus entity and view surface policy', async () => {
    const compiled = await Compiler.compileCode(`
      use Text from @tao/ui
      app Demo { view Home }
      view Home() { render Text("Home") }
      action Run() { }
      data Documents / Document {
        Title text,
        commands { Finish },
        commands hide { Archive }
      }
      command Finish(Document) {
        Title "Finish"
        Description "Finish this document"
        Summary "Finish selection"
        Label "Finish"
        Icon "checkmark"
        Key "f"
        do Run()
      }
      command Archive(Document) { Title "Archive" Key "a" do Run() }
      view Row(Document) {
        command Inspect() { Title "Inspect" Key "i" do Run() }
        Commands { Finish, Inspect }
        hide Archive
        render Text(Document.Title)
      }
    `)

    const code = compiled.code.replace(/\s+/g, ' ')
    Expect(code).toContain('commandPolicy: { surfaced: [TR.Navigation.Identity([')
    Expect(code).toContain('"CommandDeclaration","Finish"]).canonical], hidden: [TR.Navigation.Identity([')
    Expect(code).toContain('"CommandDeclaration","Archive"]).canonical]')
    Expect(code).toContain("scope: { kind: 'module' }")
    Expect(code).toContain(
      'scope: { kind: \'view\', declaration: TR.Navigation.Identity(["tao.declaration",1,"tao-compiler-test","@workspace","source","view","Row"]).canonical }',
    )
    Expect(code).toContain(
      'static: { title: "Finish", description: "Finish this document", summary: "Finish selection", label: "Finish", icon: "checkmark", key: "f", }',
    )
    Expect(code).toContain('name: "Document", type: "Document", entity: true, required: true,')
    Expect(code).toContain('TR.Interaction.UseCommandSurface({ identity: TR.Navigation.Identity([')
    Expect(code).toContain(
      'commands: [TR.Interaction.Bind(_Scope.Finish, { "Document": _Scope.Document, }), _Scope.Inspect]',
    )
    Expect(code).toContain('hidden: [TR.Navigation.Identity([')
    Expect(code).not.toContain('"Commands": () =>')
  })

  Test('emits one wrapper-free descriptor for the non-nav sibling subtree', async () => {
    const compiled = await Compiler.compileCode(`
      use StackNav from @tao/nav
      use Col, Text from @tao/ui
      app Demo { Name "Demo" Navigator StackNav { Initial Home } }
      scene Home() { Title "Home" render Text("Home") }
      view Shell(Navigator nav) {
        render Col() {
          Navigator()
          FocusBar()
          if true { StatusBar() }
        }
      }
      view FocusBar() {
        render Text("Focus session") [fill when focused, hug when FocusBar is active,
          compress when Scheme is Dark]
      }
      view StatusBar() { render Text("Focus session") }
    `)

    const code = compiled.code.replace(/\s+/g, ' ')
    Expect(code).toContain(
      '"Shell#nav-siblings": {"declaration":"Shell","kind":"region","role":"nav-siblings","label":"Focus session","members":["FocusBar","StatusBar"],"nav":"Navigator"}',
    )
    Expect(code).toContain('interaction: { region: _TaoOutline["Shell#nav-siblings"] }')
    Expect(code.match(/region: _TaoOutline\["Shell#nav-siblings"\]/g)).toHaveLength(2)
    Expect(code).not.toContain('"members":["Focus session"]')
    Expect(code).not.toContain('"members":["Shell"]')
    Expect(code).toContain(
      'designSpec: TR.Design.Spec([["fill","when","focused"],["hug","when","FocusBar","is","active"],["compress","when","Scheme","is","Dark"]])',
    )
    Expect(code).not.toContain('OutlineRegionScope')
  })
})
