import { Describe, Expect, Test, withTaoFiles } from '@shared/test'
import { Workspace } from '@workspace'
import Compiler, { type CompiledFile } from '../compiler-src/compiler'

const tsFence = '```ts'
const fence = '```'

Describe('Tao compiler', () => {
  Test('compiles source strings into a generated app file', async () => {
    const compiled = await Compiler.compileCode(`
      app MyApp { ui MainView }
      ui MainView {
        render Text "Hello"
      }
      ui Text Value text {
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
        app MultiFile { ui MainView }
        use Text from ./
        ui MainView {
          render Text "Hello from imports"
        }
      `,
        'Views.tao': `
        project ui Text Value text {
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
        app IndexedPackage { ui MainView }
        use MainView from @bar/views
      `,
        'lib/nested/@bar/views/Main.tao': `
        project ui MainView {
          render Text "Package import"
        }
        ui Text Value text {
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
        app BarePackageUse { ui MainView }
        use MainView from @foo/forms
      `,
        'feature/@foo/Title.tao': `
        package alias PackageTitle = "Package alias"
      `,
        'feature/@foo/forms/Main.tao': `
        use PackageTitle
        project ui MainView {
          render Text PackageTitle
        }
        ui Text Value text {
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

  Test('compiles circular use imports between sibling Tao files', async () => {
    await withCompiledFiles(
      'Main.tao',
      {
        'Main.tao': `
        app CircularApp { ui MainView }
        use AView from ./
        ui MainView {
          render AView
        }
      `,
        'A.tao': `
        use BView from ./
        project alias SharedTitle = "Cycle"
        project ui AView {
          render BView
        }
      `,
        'B.tao': `
        use SharedTitle from ./
        project ui BView {
          render Leaf SharedTitle
        }
        ui Leaf Value text {
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
      project ui ${name} Value text {
        render inject Value ${tsFence}
          return null
        ${fence}
      }
    `
    await withCompiledFiles(
      'app/Main.tao',
      {
        'app/Main.tao': `
        app CollisionApp { ui MainView }
        use AText from ../liba
        use BText from ../libb
        ui MainView {
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
      ui MainView {
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
