import { Describe, Expect, Test, withTaoFiles } from '@shared/test'
import { Workspace } from '@workspace'
import Compiler, { type CompiledFile } from '../compiler-src/compiler'

const tsFence = '```ts'
const fence = '```'

Describe('Tao compiler', () => {
  Test('compiles source strings into a generated app file', async () => {
    const compiled = await Compiler.compileCode(`
      app MyApp { view MainView }
      view MainView {
        render Text("Hello")
      }
      view Text Value is text {
        render inject Value ${tsFence}
          return null
        ${fence}
      }
    `)

    Expect(compiled.files).toHaveLength(1)
    Expect(compiled.files[0]?.relativePath).toBe('App.tsx')
    Expect(compiled.validation.diagnostics).toEqual([])
  })

  Test('compiles copied nav and datasource declarations through exported identity bindings', async () => {
    await withCompiledFiles(
      'Main.tao',
      {
        'Main.tao': `
          use CustomStack, SnapshotStore from @custom
          let MainNav = CustomStack { Initial Home }
          app Demo {
            Name "Demo"
            Navigator MainNav
            Datasource SnapshotStore { StorageKey "demo" }
          }
          ui Home { render inject ${tsFence} return null ${fence} }
        `,
        'Packages/@custom/Constructs.tao': `
          public nav CustomStack {
            Initial ui
            implement inject nav ${tsFence}
              return TR.NavKind.Stack()
            ${fence}
          }
          public datasource SnapshotStore {
            StorageKey text
            implement inject provider ${tsFence}
              return TR.DataProvider.Local()
            ${fence}
          }
        `,
      },
      async compiled => {
        const packageCode = compiled['Packages/@custom/Constructs.tao'].code
        const appCode = compiled['Main.tao'].code

        Expect(packageCode).toContain('_Scope.CustomStack = TR.Navigation.Declaration(')
        Expect(packageCode).toContain('return TR.NavKind.Stack()')
        Expect(packageCode).toContain('_Scope.SnapshotStore = TR.Data.Declaration(')
        Expect(packageCode).toContain('return TR.DataProvider.Local()')
        Expect(packageCode).toContain('export const CustomStack = _Scope.CustomStack')
        Expect(packageCode).toContain('export const SnapshotStore = _Scope.SnapshotStore')
        Expect(appCode).toContain('TR.Navigation.Configure(_Scope.CustomStack, {')
        Expect(appCode).toContain('TR.Data.Configure(_Scope.SnapshotStore, {')
      },
    )
  })

  Test('compiles sibling Tao file dependencies', async () => {
    await withCompiledFiles(
      'Main.tao',
      {
        'Main.tao': `
        app MultiFile { view MainView }
        use Text from ./
        view MainView {
          render Text("Hello from imports")
        }
      `,
        'Views.tao': `
        workspace view Text Value is text {
          render inject Value ${tsFence}
            return <RN.Text>{Value}</RN.Text>
          ${fence}
        }
      `,
      },
      compiled => {
        Expect(compiled['Main.tao'].relativePath).toBe('App.tsx')
        Expect(compiled['Views.tao'].relativePath).toBe('modules/Views.tao.tsx')
      },
    )
  })

  Test('compiles imported pure functions as module-owned runtime values', async () => {
    await withCompiledFiles(
      'Main.tao',
      {
        'Main.tao': `
        use DocumentLabel from ./Labels.tao
        app MultiFile { view MainView }
        view MainView {
          render Text(DocumentLabel("Draft"))
        }
        view Text Value is text {
          render inject Value ${tsFence}
            return <RN.Text>{Value}</RN.Text>
          ${fence}
        }
      `,
        'Labels.tao': `
        workspace function DocumentLabel Title is text returns text = "Document: { Title }"
      `,
      },
      compiled => {
        Expect(compiled['Main.tao'].code).toContain("import { DocumentLabel } from './modules/Labels.tao'")
        Expect(compiled['Main.tao'].code).toContain("TR.Use(_Scope, 'DocumentLabel', () => DocumentLabel)")
        Expect(compiled['Main.tao'].code).toContain('TR.Call(_Scope.DocumentLabel, TR.Value("Draft"))')
        Expect(compiled['Labels.tao'].code).toContain('_Scope.DocumentLabel = TR.Function(')
        Expect(compiled['Labels.tao'].code).toContain('export const DocumentLabel = _Scope.DocumentLabel')
      },
    )
  })

  Test('does not compile sidecar test files from app directory imports', async () => {
    await withTaoFiles(
      'tao-compiler-sidecar-',
      {
        'Main.tao': `
        app MyApp { view MainView }
        use Text from ./
        view MainView {
          render Text("Hello")
        }
      `,
        'Views.tao': `
        workspace view Text Value is text {
          render inject Value ${tsFence}
            return <RN.Text>{Value}</RN.Text>
          ${fence}
        }
      `,
        'Main.test.tao': `
        test "Sidecar" {
          check "intentionally incomplete" {
            expect text "This file should not compile"
          }
        }
      `,
      },
      async paths => {
        const compiled = await Workspace.compile(paths['Main.tao']!)
        const sourcePaths = compiled.files.map(file => file.sourcePath)

        Expect(sourcePaths).toContain(paths['Main.tao'])
        Expect(sourcePaths).toContain(paths['Views.tao'])
        Expect(sourcePaths).not.toContain(paths['Main.test.tao'])
      },
    )
  })

  Test('compiles indexed local package modules', async () => {
    await withCompiledFiles(
      'Main.tao',
      {
        'Main.tao': `
        app IndexedPackage { view MainView }
        use MainView from @bar/views
      `,
        'lib/nested/@bar/views/Main.tao': `
        workspace view MainView {
          render Text("Package import")
        }
        view Text Value is text {
          render inject Value ${tsFence}
            return <RN.Text>{Value}</RN.Text>
          ${fence}
        }
      `,
      },
      compiled => {
        Expect(compiled['Main.tao'].relativePath).toBe('App.tsx')
        Expect(compiled['lib/nested/@bar/views/Main.tao'].relativePath).toBe(
          'modules/lib/nested/@bar/views/Main.tao.tsx',
        )
      },
    )
  })

  Test('compiles bare package dependencies', async () => {
    await withCompiledFiles(
      'Main.tao',
      {
        'Main.tao': `
        app BarePackageUse { view MainView }
        use MainView from @foo/forms
      `,
        'feature/@foo/Title.tao': `
        package let PackageTitle = "Package alias"
      `,
        'feature/@foo/forms/Main.tao': `
        use PackageTitle
        workspace view MainView {
          render Text(PackageTitle)
        }
        view Text Value is text {
          render inject Value ${tsFence}
            return <RN.Text>{Value}</RN.Text>
          ${fence}
        }
      `,
      },
      compiled => {
        Expect(compiled['Main.tao'].relativePath).toBe('App.tsx')
        Expect(compiled['feature/@foo/forms/Main.tao'].relativePath).toBe(
          'modules/feature/@foo/forms/Main.tao.tsx',
        )
        Expect(compiled['feature/@foo/Title.tao'].relativePath).toBe('modules/feature/@foo/Title.tao.tsx')
      },
    )
  })

  Test('compiles type-only imports without requiring runtime type bindings', async () => {
    await withCompiledFiles(
      'Main.tao',
      {
        'Main.tao': `
        app TypeImportApp { view MainView }
        use Name from ./Types.tao
        let Name = Name "Ada"
        view MainView {
          render TextValue(Name)
        }
        view TextValue Value is text {
          render inject Value ${tsFence}
            return <RN.Text>{Value}</RN.Text>
          ${fence}
        }
      `,
        'Types.tao': `
        workspace type Name is text
      `,
      },
      compiled => {
        Expect(compiled['Main.tao'].relativePath).toBe('App.tsx')
        Expect(compiled['Types.tao'].relativePath).toBe('modules/Types.tao.tsx')
      },
    )
  })

  Test('compiles circular use imports between sibling Tao files', async () => {
    await withCompiledFiles(
      'Main.tao',
      {
        'Main.tao': `
        app CircularApp { view MainView }
        use AView from ./
        view MainView {
          render AView()
        }
      `,
        'A.tao': `
        use BView from ./
        workspace let SharedTitle = "Cycle"
        workspace view AView {
          render BView()
        }
      `,
        'B.tao': `
        use SharedTitle from ./
        workspace view BView {
          render Leaf(SharedTitle)
        }
        view Leaf Value is text {
          render inject Value ${tsFence}
            return null
          ${fence}
        }
      `,
      },
      compiled => {
        Expect(compiled['Main.tao'].relativePath).toBe('App.tsx')
        Expect(compiled['A.tao'].relativePath).toBe('modules/A.tao.tsx')
        Expect(compiled['B.tao'].relativePath).toBe('modules/B.tao.tsx')
      },
    )
  })

  Test('keeps generated module output paths unique for same-named external files', async () => {
    const sharedViewSource = (name: string) => `
      workspace view ${name} Value is text {
        render inject Value ${tsFence}
          return null
        ${fence}
      }
    `
    await withCompiledFiles(
      'app/Main.tao',
      {
        'app/Main.tao': `
        app CollisionApp { view MainView }
        use AText from ../liba
        use BText from ../libb
        view MainView {
          render AText("Hello")
        }
      `,
        'liba/Views.tao': sharedViewSource('AText'),
        'libb/Views.tao': sharedViewSource('BText'),
      },
      compiled => {
        const files = Object.values(compiled)
        const relativePaths = files.map(file => file.relativePath)

        Expect(files).toHaveLength(3)
        Expect(new Set(relativePaths).size).toBe(relativePaths.length)
        Expect(relativePaths).toContain('modules/external/Views.tao.tsx')
        Expect(relativePaths).toContain('modules/external/Views.tao-2.tsx')
      },
    )
  })

  Test('rejects entry files without an app declaration', async () => {
    await Expect(Compiler.compileCode(`
      view MainView {
        render inject ${tsFence}
          return null
        ${fence}
      }
    `)).rejects.toThrow('entry file must declare at least one app')
  })

  Test('requires explicit multi-app selection and emits a named registry', async () => {
    const source = `
      app First { view MainView }
      app Second { view MainView }
      view MainView { render inject ${tsFence} return null ${fence} }
    `
    await Expect(Compiler.compileCode(source)).rejects.toThrow('multiple apps without a selection')

    const compiled = await Compiler.compileCode(source, { appName: 'Second' })
    Expect(compiled.appNames).toEqual(['First', 'Second'])
    Expect(compiled.code).toContain('export const TaoApps = {')
    Expect(compiled.code).toContain('"First": TaoApp_First')
    Expect(compiled.code).toContain('"Second": TaoApp_Second')
    Expect(compiled.code).toContain('export default TaoApps["Second"]')
  })

  Test('strips test declarations from generated app code', async () => {
    const compiled = await Compiler.compileCode(`
      app MyApp { view MainView }
      view MainView {
        render Text("Hello")
      }
      view Text Value is text {
        render inject Value ${tsFence}
          return null
        ${fence}
      }

      test "Smoke" {
        check "renders" {
          run MyApp
          expect text "Should not compile"
        }
      }
    `)

    Expect(compiled.code).not.toContain('Smoke')
    Expect(compiled.code).not.toContain('Should not compile')
  })
})

type CompiledFiles<Files extends Record<string, string>> = { [Path in keyof Files]: CompiledFile }

async function withCompiledFiles<
  const Files extends Record<string, string>,
  EntryFile extends keyof Files & string,
>(
  entryFile: EntryFile,
  files: Files,
  testFunction: (compiled: CompiledFiles<Files>) => Promise<void> | void,
): Promise<void> {
  await withTaoFiles('tao-compiler-', files, async paths => {
    const result = await Workspace.compile(paths[entryFile])
    const compiled = {} as CompiledFiles<Files>
    for (const relativePath of Object.keys(paths) as Array<keyof Files & string>) {
      compiled[relativePath] = requireCompiledFile(result.files, paths[relativePath])
    }

    await testFunction(compiled)
  })
}

function requireCompiledFile(files: readonly CompiledFile[], sourcePath: string): CompiledFile {
  const file = files.find(compiledFile => compiledFile.sourcePath === sourcePath)
  Expect(file).toBeDefined()
  return file!
}
