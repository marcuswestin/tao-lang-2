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
        render Text "Hello"
      }
      view Text text as Value {
        render inject Value ${tsFence}
          return null
        ${fence}
      }
    `)

    Expect(compiled.files).toHaveLength(1)
    Expect(compiled.files[0]?.relativePath).toBe('App.tsx')
    Expect(compiled.validation.diagnostics).toEqual([])
  })

  Test('compiles sibling Tao file dependencies', async () => {
    await withCompiledFiles(
      'Main.tao',
      {
        'Main.tao': `
        app MultiFile { view MainView }
        use Text from ./
        view MainView {
          render Text "Hello from imports"
        }
      `,
        'Views.tao': `
        project view Text text as Value {
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

  Test('compiles indexed local package modules', async () => {
    await withCompiledFiles(
      'Main.tao',
      {
        'Main.tao': `
        app IndexedPackage { view MainView }
        use MainView from @bar/views
      `,
        'lib/nested/@bar/views/Main.tao': `
        project view MainView {
          render Text "Package import"
        }
        view Text text as Value {
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
        package alias PackageTitle = "Package alias"
      `,
        'feature/@foo/forms/Main.tao': `
        use PackageTitle
        project view MainView {
          render Text PackageTitle
        }
        view Text text as Value {
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

  Test('compiles custom types, list and item constructors, casts, and member access', async () => {
    const compiled = await Compiler.compileCode(`
      app TypeApp { view MainView }
      type Name is text
      type Tags is list
      type Job is {
        Title is text
      }
      type Person is {
        Name
        Tags
        Job
      }
      type InlineJob is {
        Role is text
      }
      type CurrentJob is InlineJob
      alias DisplayName = text."Ada" as Name
      alias DemoPerson = Person.{
        DisplayName
        Tags.["compiler" "runtime"]
        Job.{ Title."Engineer" }
      }
      alias DemoCurrentJob = CurrentJob.{ Role."Engineer" }
      view MainView {
        render Stack {
          TextValue DemoPerson.Name
          ListValue DemoPerson.Tags
        }
      }
      layout Stack {
        render inject ${tsFence}
          return <>{_ViewProps.children}</>
        ${fence}
      }
      view TextValue text as Value {
        render inject Value ${tsFence}
          return <RN.Text>{Value}</RN.Text>
        ${fence}
      }
      view ListValue list as Values {
        render inject Values ${tsFence}
          return <RN.Text>{Values.join(", ")}</RN.Text>
        ${fence}
      }
    `)

    Expect(compiled.files).toHaveLength(1)
    Expect(compiled.validation.diagnostics).toEqual([])
  })

  Test('compiles type-only imports without requiring runtime type bindings', async () => {
    await withCompiledFiles(
      'Main.tao',
      {
        'Main.tao': `
        app TypeImportApp { view MainView }
        use Name from ./Types.tao
        alias Name = Name."Ada"
        view MainView {
          render TextValue Name
        }
        view TextValue text as Value {
          render inject Value ${tsFence}
            return <RN.Text>{Value}</RN.Text>
          ${fence}
        }
      `,
        'Types.tao': `
        project type Name is text
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
          render AView
        }
      `,
        'A.tao': `
        use BView from ./
        project alias SharedTitle = "Cycle"
        project view AView {
          render BView
        }
      `,
        'B.tao': `
        use SharedTitle from ./
        project view BView {
          render Leaf SharedTitle
        }
        view Leaf text as Value {
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
      project view ${name} text as Value {
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
          render AText "Hello"
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
    `)).rejects.toThrow('entry file must declare exactly one app')
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
