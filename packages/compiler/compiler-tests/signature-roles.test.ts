import { Workspace } from '@compiler/workspace'
import { Assert } from '@shared'
import { Describe, Expect, Test, withTaoFiles } from '@shared/test'
import { TestCompiler as Compiler } from './test-compile'

Describe('compiler: signature role constructors', () => {
  Test('emits type-bound arguments in parameter order for distinct inline roles', async () => {
    const compiled = await Compiler.compileCode(`
      func Subtract(Left number, Right number) -> number { return Left - Right }
      let Result = Subtract(Right 2, Left 5)
      app Demo { id "com.tao.test.signatureroles" version "1.0.0" name "Demo" view Main }
      view Main() { render Native(Result) }
      view Native(Value number) { render inject \`\`\`ts return null \`\`\` }
    `)
    Expect(compiled.code).toContain('TR.Call(_Scope.Subtract, TR.Value(5), TR.Value(2))')
  })

  Test('emits contextual inline primitive and item role constructors', async () => {
    const compiled = await Compiler.compileCode(`
      func Subtract(Left number, Right number) -> number { return Left - Right }
      let Result = Subtract(.Right 2, .Left 5)
      app Demo { id "com.tao.test.signatureconstructors" version "1.0.0" name "Demo" view Main }
      view Main() { render Reader(.Value { Count: 3 }) }
      view Reader(Value { Count number }) { render Native(Value.Count) }
      view Native(Value number) { render inject \`\`\`ts return null \`\`\` }
    `)
    Expect(compiled.code).toContain('["Count"]: TR.Value(3).jsValue')
    Expect(compiled.code).toContain('TR.Call(_Scope.Subtract, TR.Value(5), TR.Value(2))')
  })

  Test('compiles descendant types projected from a private cross-file signature role', async () => {
    await withTaoFiles('tao-compiled-signature-role-', {
      'Names.tao': `
        file type GivenName is text
        file type Surname is text
        public func PersonName(GivenName, Surname) -> text { return "{GivenName}{Surname}" }
      `,
      'Main.tao': `
        use PersonName from ./Names
        type ProfileName is PersonName.GivenName
        let Result = PersonName(PersonName.Surname "Lovelace", ProfileName "Ada")
        app Demo { id "com.tao.test.signatureprojection" version "1.0.0" name "Demo" view Main }
        view Main() { render Native(Result) }
        view Native(Value text) { render inject \`\`\`ts return null \`\`\` }
      `,
    }, async (paths, root) => {
      const compiled = await (await Workspace.open(root)).compile(paths['Main.tao'])
      const main = compiled.files.find(file =>
        file.sourcePath === paths['Main.tao'] && file.relativePath.endsWith('.tsx')
      )
      Assert.defined(main, 'the signature role consumer is emitted')
      Expect(main.code).toContain('TR.Call(_Scope.PersonName, TR.Value("Ada"), TR.Value("Lovelace"))')
    })
  })
})
