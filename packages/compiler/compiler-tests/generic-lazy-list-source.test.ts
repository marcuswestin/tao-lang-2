import { Describe, Expect, Test } from '@shared/test'
import { TestCompiler as Compiler } from './test-compile'

const declarations = `
  use LazyList, Occurrence, RenderKey from @tao/ui
  type Entry is text with {
    func Key() fails never -> RenderKey { return RenderKey "{Entry}" }
    func ToText() fails never -> text { return Entry }
    view Render() { render "{Entry}" }
  }
  view RowView(Item Entry, Occurrence) { render "{Item.ToText()}:{Occurrence.Ordinal}" }
  view Main {
    state Entries = [Entry "Alpha", Entry "Beta"]
    render LazyList(Entries) { SLOT }
  }
  app Rows { id "generic.list.source" version "1.0.0" name "Rows" view Main }
`

Describe('compiler: generic LazyList source', () => {
  Test('specializes a named row renderer and forwards the actual typed descriptor into the native list', async () => {
    const compiled = await Compiler.compileCode(declarations.replace('SLOT', '@item: RowView'))
    const library = compiled.files.find(file => file.code.includes('function LazyList'))
    Expect(library).toBeDefined()
    Expect(library!.code).toContain('TR.RenderSlots.select(')
    Expect(library!.code).toContain('"@item"')
    Expect(compiled.code).toContain('_Scope.RowView')
    Expect(compiled.code).toContain('TR.RenderSlots.create<')
  })

  Test('binds inline row names to specialized Item and public Occurrence inputs', async () => {
    const compiled = await Compiler.compileCode(declarations.replace('SLOT', '@item Row, Position -> Row'))
    const code = compiled.code.replace(/\s+/g, ' ')
    Expect(code).toContain('_Scope["Row"] = args["Item"]')
    Expect(code).toContain('_Scope["Position"] = args["Occurrence"]')
    Expect(code).toContain('TR.MountRendered(')
    Expect(code).toContain('TR.Capability.method(')
  })
})
