import { Describe, Expect, Test } from '@shared/test'
import { TestCompiler as Compiler } from './test-compile'

const tsFence = '```ts'
const fence = '```'

/** A data catalog and app around one view body, with the stdlib text and container views linked. */
function outlineApp(body: string, extra = ''): string {
  return `
    use Col, FormButton, Image, Text, TextInput, TextMultiline from @tao/ui
    data Documents / Document {
      Title text (title),
      Body text (default ""),
      Workspace
    }
    data Workspaces / Workspace {
      Name text (title),
      Documents (owned)
    }
    app OutlineApp { id "com.tao.test.outlineapp" version "1.0.0" name "OutlineApp"  view Main }
    view Main() {
      query Documents = Documents with { }
      query Workspaces = Workspaces with { }
      state Draft = ""
      render Col() {
        ${body}
      }
    }
    function DocumentLabel(Title text) returns text {
      return "Document: { Title }"
    }
    ${extra}
  `
}

/** loopTexts returns the emitted `texts` ranking of the one loop in the compiled module. */
function loopNode(code: string): { root: string; selectable: boolean; texts: string[][] } {
  const match = code.match(/"kind":"collection".*?"root":"(\w+)","selectable":(true|false),"texts":(\[.*?\])\}/)
  Expect(match).not.toBeNull()
  return { root: match![1]!, selectable: match![2] === 'true', texts: JSON.parse(match![3]!) as string[][] }
}

Describe('compiler: interaction outline', () => {
  Test('ranks the first row-bound text and emits the loop descriptor into the module table', async () => {
    const compiled = await Compiler.compileCode(outlineApp(`
      loop Documents / Document {
        Col() {
          Text(Document.Body)
          Text(Document.Title)
        }
      }
    `))

    Expect(compiled.code).toContain('const _TaoOutline = TR.Interaction.OutlineTable({')
    Expect(compiled.code).toContain('"entity":"Document"')
    Expect(compiled.code).toContain('"collection":"Documents"')
    Expect(compiled.code).toContain('interaction: _TaoOutline["Main#')
    Expect(compiled.code).toContain('interaction: { row: TR.Interaction.RowRoot(_Scope.Document) }')
    // The rendered `(title)` field outranks the body the row happens to render first.
    Expect(loopNode(compiled.code)).toEqual({ root: 'single', selectable: false, texts: [['Title'], ['Body']] })
  })

  Test('keeps source order when the title field is not rendered', async () => {
    const compiled = await Compiler.compileCode(outlineApp(`
      loop Documents / Document {
        Col() {
          Text(Document.Body)
          Text(Document.Workspace.Name)
        }
      }
    `))

    Expect(loopNode(compiled.code).texts).toEqual([['Body'], ['Workspace', 'Name']])
  })

  Test('treats a function-wrapped value and an interpolation as opaque', async () => {
    const compiled = await Compiler.compileCode(outlineApp(`
      loop Documents / Document {
        Col() {
          Text(DocumentLabel(Document.Title))
          Text("{ Document.Title } — draft")
          TextMultiline(Document.Body)
        }
      }
    `))

    Expect(loopNode(compiled.code).texts).toEqual([['Body']])
  })

  Test('skips conditional branches, nested loops, and an image-only row', async () => {
    const compiled = await Compiler.compileCode(outlineApp(`
      loop Workspaces / Workspace {
        Col() {
          Image("./cover.png", Decorative: true)
          when Workspace.Name {
            empty -> { Text("Untitled") }
            otherwise -> { Text(Workspace.Name) }
          }
          loop Workspace.Documents / Document {
            Text(Document.Title)
          }
        }
      }
    `))

    Expect(loopNode(compiled.code).texts).toEqual([])
    Expect(compiled.code).toContain('"entity":"Workspace"')
  })

  Test('descends one level into a rendered row view and reads through its bound parameter', async () => {
    const compiled = await Compiler.compileCode(
      outlineApp(
        `
          loop Workspaces / Workspace {
            WorkspaceRow(Workspace)
          }
        `,
        `
          view WorkspaceRow(Workspace) {
            render Col() {
              Text("Workspace")
              Text(Workspace.Name)
              Deeper(Workspace)
            }
          }
          view Deeper(Workspace) {
            render Text(Workspace.Name)
          }
        `,
      ),
    )

    // One level only: the text inside Deeper is not read, and the literal eyebrow is not a path.
    Expect(loopNode(compiled.code).texts).toEqual([['Name']])
  })

  Test('marks a selectable row and a multi-root row, which carry no row-root label', async () => {
    const compiled = await Compiler.compileCode(outlineApp(`
      #stories
      loop Workspaces / Workspace {
        Text(Workspace.Name)
        on select -> { set Draft = Workspace.Name }
      }
      loop Documents / Document {
        Text(Document.Title)
        Text(Document.Body)
      }
    `))

    const nodes = [...compiled.code.matchAll(/"root":"(\w+)","selectable":(true|false)/g)]
    Expect(nodes.map(node => [node[1], node[2]])).toEqual([['single', 'true'], ['multiple', 'false']])
    Expect(compiled.code).not.toContain('TR.Interaction.RowRoot(')
  })

  Test('classifies controls from their wiring and names them from a literal title or label', async () => {
    const compiled = await Compiler.compileCode(outlineApp(`
      TextInput(Value: Draft, Label: "Draft title") {
        on submit -> { }
      }
      FormButton("Save draft") {
        on press -> { set Draft = "" }
      }
      Text("Quiet")
    `))

    Expect(compiled.code).toContain(
      '"kind":"control","label":"Draft title","nameStatus":"known","role":"input","view":"TextInput"',
    )
    Expect(compiled.code).toContain(
      '"kind":"control","label":"Save draft","nameStatus":"known","role":"action","view":"FormButton"',
    )
    Expect(compiled.code.match(/"kind":"control"/g)).toHaveLength(2)
    Expect(compiled.code).toContain('TR.Interaction.UseOccurrence(_ViewProps.__tao)')
  })

  Test('classifies controls whose action parameters are supplied as ordinary arguments', async () => {
    const compiled = await Compiler.compileCode(
      outlineApp(
        `
          FormButton("Save draft", SaveDraft)
          TextInput(Value: Draft, Change: ChangeDraft, Submit: SubmitDraft, Label: "Draft title")
          SubmitControl(Label: "Send draft", Submit: SubmitDraft)
        `,
        `
          action SaveDraft() { }
          action ChangeDraft(Value text) { }
          action SubmitDraft() { }
          view SubmitControl(Label text, Submit action()) {
            render Text(Label)
          }
        `,
      ),
    )

    Expect(compiled.code).toContain(
      '"kind":"control","label":"Save draft","nameStatus":"known","role":"action","view":"FormButton"',
    )
    Expect(compiled.code).toContain(
      '"kind":"control","label":"Draft title","nameStatus":"known","role":"input","view":"TextInput"',
    )
    Expect(compiled.code).toContain(
      '"kind":"control","label":"Send draft","nameStatus":"known","role":"action","view":"SubmitControl"',
    )
    Expect(compiled.code.match(/"kind":"control"/g)).toHaveLength(3)
  })

  Test('derives visible control text and keeps Description separate from its name', async () => {
    const compiled = await Compiler.compileCode(outlineApp(
      `
      VisibleAction() { on press -> { } }
      DescribedAction(Title: "Save", Description: "Writes this draft") { on press -> { } }
    `,
      `
      view VisibleAction(Press action()) { render Col() { Text("Launch") } }
      view DescribedAction(Title text, Description text, Press action()) { render Text(Title) }
    `,
    ))

    Expect(compiled.code).toContain(
      '"kind":"control","label":"Launch","nameStatus":"known","role":"action","view":"VisibleAction"',
    )
    Expect(compiled.code).toContain(
      '"kind":"control","label":"Save","description":"Writes this draft","nameStatus":"known","role":"action","view":"DescribedAction"',
    )
  })

  Test('emits no table for a module without outline nodes', async () => {
    const compiled = await Compiler.compileCode(`
      app QuietApp { id "com.tao.test.quietapp" version "1.0.0" name "QuietApp"  view Main }
      view Main() { render Empty() }
      view Empty() { render inject ${tsFence} return null ${fence} }
    `)

    Expect(compiled.code).not.toContain('_TaoOutline')
    Expect(compiled.code).toContain('TR.Interaction.UseOccurrence(_ViewProps.__tao)')
  })
})
