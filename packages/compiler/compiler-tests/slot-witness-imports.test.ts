import { Packages } from '@ast-utils'
import { Workspace } from '@compiler/workspace'
import { Describe, Expect, fence, Test, tsFence, withTaoFiles } from '@shared/test'
import { TestCompiler as Compiler } from './test-compile'

Describe('compiler: slot witness imports', () => {
  Test('imports the defining witness for a concrete value placed into a capability slot', async () => {
    await withTaoFiles('slot-witness-imports-', {
      'Provider.tao': `
        public type Title is text with {
          func Title.ToText() fails never -> text { return "converted" }
        }
      `,
      'Main.tao': `
        use Title from ./Provider
        can Display { ToText() fails never -> text }
        view Body(Value Display) { render Value.ToText() }
        view Frame() { render inject Content @@content ${tsFence} return Content ${fence} }
        view Owner() {
          @item(Value Display): Body
          state Provided = Title "before"
          render Frame { @item(Provided) }
        }
        app Slots { id "slot.witness.imports" version "1.0.0" name "Slots" view Owner }
      `,
    }, async (paths, root) => {
      const validation = await Workspace.validate(paths['Main.tao'])
      const compiled = await Compiler.compileValidated(
        validation,
        Compiler.createContext(await Packages.createContext(root), root),
      )
      Expect(compiled.code).toContain('_TaoSlotSourceArgument0 = TR.Capability.attach(')
      Expect(compiled.code).toMatch(
        /import \{ __tao_associated_witness_[^}]+ \} from ['"]\.\/modules\/Provider\.tao['"]/,
      )
    })
  })
})
