import { Packages } from '@ast-utils'
import { Workspace } from '@compiler/workspace'
import { Describe, Expect, Test, withTaoFiles } from '@shared/test'
import { TestCompiler as Compiler } from './test-compile'

Describe('compiler: render witness imports', () => {
  Test('collects concrete role witnesses through specialized generic function arguments', async () => {
    await withTaoFiles('generic-function-witness-imports-', {
      'Provider.tao': `
        public type Title is text with {
          func ToText() fails never -> text { return "converted" }
        }
      `,
      'Consumer.tao': `
        public can Display { ToText() fails never -> text }
        public func Choose where type T is Display (Left T, Right T) {
          return Left.ToText()
        }
      `,
      'Main.tao': `
        use Title from ./Provider
        use Choose from ./Consumer
        app Imported { id "generic.function.witness.imports" version "1.0.0" name "Imported" view Main }
        view Main {
          let Caption = Title "raw"
          let Result = Choose(.Right Caption, .Left Caption)
          render Result
        }
      `,
    }, async (paths, root) => {
      const validation = await Workspace.validate(paths['Main.tao'])
      const compiled = Compiler.compileValidated(
        validation,
        Compiler.createContext(await Packages.createContext(root), root),
      )
      Expect(compiled.code).toContain('TR.Capability.attach(')
      Expect(compiled.code).toMatch(/__tao_associated_[^\s]+.*from ['"]\.\/modules\/Provider\.tao['"]/)
    })
  })

  Test('imports the actual defining witness for a bare structural ui render', async () => {
    await withTaoFiles('bare-ui-witness-imports-', {
      'Provider.tao': `
        public type Title is text with {
          func Title.ToText() fails never -> text { return "converted" }
          view Title.Render() { render "converted" }
        }
      `,
      'Main.tao': `
        use Title from ./Provider
        app Imported { id "bare.ui.witness.imports" version "1.0.0" name "Imported" view Main }
        view Main { state Caption = Title "raw" render Caption }
      `,
    }, async (paths, root) => {
      const validation = await Workspace.validate(paths['Main.tao'])
      const compiled = Compiler.compileValidated(
        validation,
        Compiler.createContext(await Packages.createContext(root), root),
      )
      Expect(compiled.code).toContain('TR.MountRendered(TR.Call<TR.Rendered>(')
      Expect(compiled.code).toMatch(/__tao_associated_[^\s]+.*from ['"]\.\/modules\/Provider\.tao['"]/)
    })
  })

  Test('imports the defining witness for a concrete value passed into a generic view', async () => {
    await withTaoFiles('render-witness-imports-', {
      'Provider.tao': `
        public type Title is text with {
          func Title.ToText() fails never -> text { return "converted" }
        }
      `,
      'Consumer.tao': `
        public can Display { ToText() fails never -> text }
        public view Caption where type T is Display (Value T) { render Value.ToText() }
      `,
      'Main.tao': `
        use Title from ./Provider
        use Caption from ./Consumer
        app Imported { id "render.witness.imports" version "1.0.0" name "Imported" view Main }
        view Main { state Title = Title "raw" render Caption(.Value Title) }
      `,
    }, async (paths, root) => {
      const validation = await Workspace.validate(paths['Main.tao'])
      const compiled = Compiler.compileValidated(
        validation,
        Compiler.createContext(await Packages.createContext(root), root),
      )
      Expect(compiled.code).toContain('TR.Capability.attach(')
      Expect(compiled.code).toMatch(/__tao_associated_[^\s]+.*from ['"]\.\/modules\/Provider\.tao['"]/)
    })
  })
})
