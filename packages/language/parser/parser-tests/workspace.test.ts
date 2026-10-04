import { Packages } from '@ast-utils'
import { Workspace } from '@compiler/workspace'
import { AST } from '@parser'
import { FS } from '@shared'
import { Describe, Expect, Test, withTaoFiles } from '@shared/test'
import { testParseCode, testParseSyntax } from './test-parse'

Describe('minimal Tao parser', () => {
  Test('links an explicitly imported fixture and its row handles from a scenario file', async () => {
    await withTaoFiles(
      'tao-parser-imported-fixture-',
      {
        'Main.tao': `
          use Sketches from ./Sketches
          use Playlist from ./Data

          view PlaylistRow(Playlist) { }
          scenarios PlaylistRow "sketch" {
            fixture Sketches
            scenario "draft" { render (Playlist: ChillVibes) }
          }
        `,
        'Data.tao': `public data Playlists / Playlist { Title text }`,
        'Sketches.tao': `
          use Playlist from ./Data
          public fixture Sketches {
            ChillVibes = create Playlist { Title: "Chill Vibes" }
          }
        `,
      },
      async (paths, rootDir) => {
        const workspace = await Workspace.open(rootDir)
        const result = await workspace.parse(paths['Main.tao']!)

        Expect(result.diagnostics).toEqual([])
        const fixtureFile = result.files.find(file => file.path === paths['Sketches.tao'])
        const fixture = fixtureFile?.ast.statements.find(AST.isFixtureDeclaration)
        const group = result.entry.ast.statements.find(AST.isScenarioGroupDeclaration)
        const scenario = group?.block.entries.find(AST.isScenarioDeclaration)
        Expect.Is(fixture, AST.isFixtureDeclaration)
        Expect.Is(group, AST.isScenarioGroupDeclaration)
        Expect.Is(scenario, AST.isScenarioDeclaration)
        Expect(group.block.entries.find(AST.isScenarioFixtureClause)?.fixture.ref).toBe(fixture)
        const render = scenario.block.entries.find(AST.isScenarioRenderClause)
        const value = render?.argumentList?.arguments[0]?.value
        Expect.Is(value, AST.isFixtureValueReference)
        Expect(value.target.ref?.name).toBe('ChillVibes')
      },
    )
  })

  Test('links imported custom configurable declarations without shipped-name tables', async () => {
    await withTaoFiles(
      'tao-parser-custom-configurable-',
      {
        'Main.tao': `
          use CustomData, CustomNav from @custom

          view Home() { }
          let MainNav = CustomNav {
            Initial Home
          }
          app Demo {
            Name "Demo"
            Navigator MainNav
            Datasource CustomData {
              StorageKey "demo"
            }
          }
        `,
        'Packages/@custom/Constructs.tao': `
          public type CustomNav is nav with {
            Initial view
            nav TestNavKind from ./TestNav.ts
          }
          public type CustomData is datasource with {
            StorageKey text
            provider TestProvider from ./TestProvider.ts
          }
        `,
      },
      async (paths, rootDir) => {
        const workspace = await Workspace.open(rootDir)
        const parseResult = await workspace.parse(paths['Main.tao']!)

        Expect(parseResult.diagnostics).toEqual([])
        const packageFile = parseResult.files.find(file => file.path === paths['Packages/@custom/Constructs.tao'])
        const nav = packageFile?.ast.statements.find(statement =>
          AST.isTypeDeclaration(statement) && statement.name === 'CustomNav'
        )
        const datasource = packageFile?.ast.statements.find(statement =>
          AST.isTypeDeclaration(statement) && statement.name === 'CustomData'
        )
        const main = parseResult.entry.ast.statements.find(
          statement => AST.isAliasDeclaration(statement) && statement.name === 'MainNav',
        )
        const app = parseResult.entry.ast.statements.find(AST.isAppDeclaration)
        Expect.Is(nav, AST.isTypeDeclaration)
        Expect.Is(datasource, AST.isTypeDeclaration)
        Expect.Is(main, AST.isAliasDeclaration)
        Expect.Is(app, AST.isAppDeclaration)
        Expect.Is(main.value, AST.isConfigurationConstructor)
        Expect(main.value.type.ref).toBe(nav)
        const appDatasource = AST.blockStatements(app).find(statement =>
          AST.isAppProperty(statement) && statement.name === 'Datasource'
        )
        Expect.Is(appDatasource, AST.isAppProperty)
        Expect.Is(appDatasource.value, AST.isConfigurationConstructor)
        Expect(appDatasource.value.type.ref).toBe(datasource)
      },
    )
  })

  Test('does not discover test sidecars from app directory imports', async () => {
    await withTaoFiles(
      'tao-parser-sidecar-',
      {
        'Main.tao': `
        app MyApp { view MainView }
        use SharedView from ./
        view MainView() {
          render SharedView()
        }
      `,
        'Shared.tao': `
        project view SharedView() {
          render inject \`\`\`ts
            return null
          \`\`\`
        }
      `,
        'Main.test.tao': `
        test "Sidecar" {
          test "intentionally incomplete" {
            expect text "This file should not load"
          }
        }
      `,
      },
      async paths => {
        const parseResult = await Workspace.parse(paths['Main.tao']!)
        const parsedFiles = parseResult.files.map(file => FS.basename(file.path))

        Expect(parsedFiles).toContain('Main.tao')
        Expect(parsedFiles).toContain('Shared.tao')
        Expect(parsedFiles).not.toContain('Main.test.tao')
      },
    )
  })

  Test('forgets a deleted folder declaration when the same workspace parses again', async () => {
    await withTaoFiles(
      'tao-parser-folder-refresh-',
      {
        'Main.tao': `
          use StackNav from @tao/nav
          app Reader {
            Name "Reader"
            Navigator StackNav { Initial Main }
            Datasource { Personal with { StorageKey "prod" } }
          }
          let Selected = Personal
          view Main() { }
        `,
        'Sources.tao': `
          use Local from @tao/data/providers/local
          folder datasource Personal = Local { StorageKey "personal" }
        `,
      },
      async (paths, rootDir) => {
        const workspace = await Workspace.open(rootDir)
        const first = await workspace.parse(paths['Main.tao']!)
        const firstApp = first.entry.ast.statements.find(AST.isAppValueDeclaration)
        Expect.Is(firstApp, AST.isAppValueDeclaration)
        Expect(AST.visibleValueDeclarations(firstApp, AST.isDatasourceDeclaration).map(item => item.name))
          .toContain('Personal')
        const firstAlias = first.entry.ast.statements.find(statement =>
          AST.isAliasDeclaration(statement) && statement.name === 'Selected'
        )
        Expect.Is(firstAlias, AST.isAliasDeclaration)
        Expect.Is(firstAlias.value, AST.isValueReference)
        Expect.Is(firstAlias.value.target.ref, AST.isDatasourceDeclaration)

        await FS.remove(paths['Sources.tao']!)
        const second = await workspace.parse(paths['Main.tao']!)
        const secondApp = second.entry.ast.statements.find(AST.isAppValueDeclaration)
        Expect.Is(secondApp, AST.isAppValueDeclaration)

        Expect(second.files.map(file => file.path)).not.toContain(paths['Sources.tao']!)
        Expect(AST.visibleValueDeclarations(secondApp, AST.isDatasourceDeclaration).map(item => item.name))
          .not.toContain('Personal')
        const secondAlias = second.entry.ast.statements.find(statement =>
          AST.isAliasDeclaration(statement) && statement.name === 'Selected'
        )
        Expect.Is(secondAlias, AST.isAliasDeclaration)
        Expect.Is(secondAlias.value, AST.isValueReference)
        Expect(secondAlias.value.target.ref).toBeUndefined()
      },
    )
  })

  Test('uses ordinary folder precedence without letting a same-name type mask a datasource', async () => {
    await withTaoFiles(
      'tao-parser-folder-precedence-',
      {
        'Main.tao': `
          use Memory from @tao/data/providers/memory
          datasource Personal = Memory { StorageKey "local" }
          let Selected = Personal
        `,
        'Sources.tao': `
          use Local from @tao/data/providers/local
          folder type Personal is text
          folder datasource Personal = Local { StorageKey "folder" }
        `,
      },
      async paths => {
        const parsed = await Workspace.parse(paths['Main.tao']!)
        const alias = parsed.entry.ast.statements.find(statement =>
          AST.isAliasDeclaration(statement) && statement.name === 'Selected'
        )
        Expect.Is(alias, AST.isAliasDeclaration)
        Expect.Is(alias.value, AST.isValueReference)
        const ordinaryTarget = alias.value.target.ref
        Expect.Is(ordinaryTarget, AST.isDatasourceDeclaration)

        const datasourceTarget = AST.visibleValueDeclarations(alias, AST.isDatasourceDeclaration)
          .find(declaration => declaration.name === 'Personal')
        Expect(datasourceTarget).toBe(ordinaryTarget)
        Expect(FS.basename(AST.getDocument(datasourceTarget!).uri.path)).toBe('Sources.tao')
      },
    )
  })

  Test('resolves value references through nested scope shadowing', async () => {
    const parseResult = await testParseCode(`
      let Greeting = "File"

      view Stack() {
        render inject Content @@content \`\`\`ts
          return <>{Content}</>
        \`\`\`
      }
      view Text(Value text) {
        render inject \`\`\`ts
          return null
        \`\`\`
      }
      view MainView(Label text) {
        let Greeting = "View"
        let LabelAlias = Label
        render Stack(){
          let Greeting = "Block"
          Text(Greeting)
          Stack(){
            let Greeting = "Nested"
            Text(Greeting)
          }
          Text(LabelAlias)
        }
      }
    `)

    const [fileGreetingAlias, _stackView, _textView, mainView] = parseResult.entry.ast.statements
    Expect.Is(fileGreetingAlias, AST.isAliasDeclaration)
    Expect.Is(mainView, AST.isViewDeclaration)

    const labelParameter = AST.parametersOf(mainView)[0]
    Expect.Is(labelParameter, AST.isParameterDeclaration)

    const [viewGreetingAlias, labelAlias, render] = mainView.block!.statements
    Expect.Is(viewGreetingAlias, AST.isAliasDeclaration)
    Expect.Is(labelAlias, AST.isAliasDeclaration)
    Expect.Is(render, AST.isRenderStatement)
    Expect.Is(labelAlias.value, AST.isValueReference)
    Expect(labelAlias.value.target.ref).toBe(labelParameter)

    const [blockGreetingAlias, blockText, nestedStack, labelText] = AST.statementsOf(render.block)
    Expect.Is(blockGreetingAlias, AST.isAliasDeclaration)
    Expect.Is(blockText, AST.isViewRender)
    Expect.Is(nestedStack, AST.isViewRender)
    Expect.Is(labelText, AST.isViewRender)

    const blockTextValue = AST.argumentsOf(blockText)[0]?.value
    Expect.Is(blockTextValue, AST.isValueReference)
    Expect(blockTextValue.target.ref).toBe(blockGreetingAlias)

    const [nestedGreetingAlias, nestedText] = AST.statementsOf(nestedStack.block)
    Expect.Is(nestedGreetingAlias, AST.isAliasDeclaration)
    Expect.Is(nestedText, AST.isViewRender)

    const nestedTextValue = AST.argumentsOf(nestedText)[0]?.value
    Expect.Is(nestedTextValue, AST.isValueReference)
    Expect(nestedTextValue.target.ref).toBe(nestedGreetingAlias)

    const labelTextValue = AST.argumentsOf(labelText)[0]?.value
    Expect.Is(labelTextValue, AST.isValueReference)
    Expect(labelTextValue.target.ref).toBe(labelAlias)
  })

  Test('parses use statements and project-visible declarations', async () => {
    const parseResult = await testParseSyntax(`
      app MyApp { view MainView }
      use Text, Stack from ./
      project let Greeting = "Hello"
      project view MainView() {
        render Stack(){
          Text(Greeting)
        }
      }
      project view Stack() {
        render inject Content @@content \`\`\`ts
          return <>{Content}</>
        \`\`\`
      }
      project view Text(Value text) {
        render inject Value \`\`\`ts
          return <RN.Text>{Value}</RN.Text>
        \`\`\`
      }
    `)

    const [, useStatement, sharedAlias, mainView] = parseResult.entry.ast.statements
    Expect.Is(useStatement, AST.isUseStatement)
    Expect(useStatement.importedDeclarations.map(reference => reference.$refText)).toEqual(['Text', 'Stack'])
    Expect(useStatement.importPath).toBe('./')
    Expect.Is(sharedAlias, AST.isAliasDeclaration)
    Expect(sharedAlias.visibility).toBe('project')
    Expect.Is(mainView, AST.isViewDeclaration)
    Expect(mainView.visibility).toBe('project')
  })

  Test('parses parent-directory imports with trailing slashes', async () => {
    const parseResult = await testParseSyntax(`
      use Text from ../
    `)

    const [useStatement] = parseResult.entry.ast.statements
    Expect.Is(useStatement, AST.isUseStatement)
    Expect(useStatement.importPath).toBe('../')
  })

  Test('parses bare use statements', async () => {
    const parseResult = await testParseSyntax(`
      use Text
      project view Text(Value text) {
        render inject Value \`\`\`ts
          return null
        \`\`\`
      }
    `)

    const [useStatement] = parseResult.entry.ast.statements
    Expect.Is(useStatement, AST.isUseStatement)
    Expect(useStatement.importedDeclarations.map(reference => reference.$refText)).toEqual(['Text'])
    Expect(useStatement.importPath).toBeUndefined()
  })

  Test('parses local package import paths', async () => {
    const parseResult = await testParseSyntax(`
      use RootView from @
      use GeneratedView from @/studio
      use Text from @bar
      use Label from @bar/forms
    `)

    const [rootUse, generatedUse, packageUse, subfolderUse] = parseResult.entry.ast.statements
    Expect.Is(rootUse, AST.isUseStatement)
    Expect.Is(generatedUse, AST.isUseStatement)
    Expect.Is(packageUse, AST.isUseStatement)
    Expect.Is(subfolderUse, AST.isUseStatement)
    Expect(rootUse.importPath).toBe('@')
    Expect(generatedUse.importPath).toBe('@/studio')
    Expect(packageUse.importPath).toBe('@bar')
    Expect(subfolderUse.importPath).toBe('@bar/forms')
  })

  Test('parses file, package, project, and public visibility declarations', async () => {
    const parseResult = await testParseCode(`
      file let FileTitle = "File"
      package let PackageTitle = "Package"
      project view ProjectView() { }
      public view PublishedStack() { }
    `)

    const [fileAlias, packageAlias, projectView, publishedView] = parseResult.entry.ast.statements
    Expect.Is(fileAlias, AST.isAliasDeclaration)
    Expect.Is(packageAlias, AST.isAliasDeclaration)
    Expect.Is(projectView, AST.isViewDeclaration)
    Expect.Is(publishedView, AST.isViewDeclaration)
    Expect(fileAlias.visibility).toBe('file')
    Expect(packageAlias.visibility).toBe('package')
    Expect(projectView.visibility).toBe('project')
    Expect(publishedView.visibility).toBe('public')
  })

  // REMOVAL CANDIDATE: This is AST package visibility policy rather than parser behavior; remove if owning-layer coverage survives.
  Test('keeps project visibility scoped out of stdlib imports', () => {
    const stdlibResolution: Packages.Resolution = {
      relation: 'stdlib',
      targetPath: '/tao-stdlib/tao/ui',
      candidateMode: 'direct',
      importPath: '@tao/ui',
    }

    Expect(Packages.isVisible('file', stdlibResolution)).toBe(false)
    Expect(Packages.isVisible('project', stdlibResolution)).toBe(false)
    Expect(Packages.isVisible('public', stdlibResolution)).toBe(true)
  })

  Test('parses root package publication metadata', async () => {
    const parseResult = await testParseCode(`
      package {
        name "Package Access"
        version 1.2.3
        license AGPL-3.0-only
        includes @ui @icons
      }
    `)

    const [publication] = parseResult.entry.ast.statements
    Expect.Is(publication, AST.isPackageDeclaration)
    Expect(AST.blockStatementOf(publication, { map: statement => statement.$type })).toEqual([
      AST.PackageName.$type,
      AST.PackageVersion.$type,
      AST.PackageLicense.$type,
      AST.PackageIncludes.$type,
    ])
    Expect(AST.blockStatementOf(publication, { filter: AST.isPackageIncludes })[0]?.modules).toEqual([
      '@ui',
      '@icons',
    ])
  })

  Test('keeps DefaultApp available as an ordinary declaration name', async () => {
    const parseResult = await testParseCode(`
      package { version 1.0.0 includes @ui }
      app DefaultApp { id "default-app" version "1.0.0" name "Default app" view DefaultApp }
      view DefaultApp() { }
    `)

    const declarations = parseResult.entry.ast.statements.filter(AST.isDeclaration)
    Expect(declarations.map(declaration => declaration.name)).toEqual(['DefaultApp', 'DefaultApp'])
  })
})
