import { Packages } from '@ast-utils'
import { AST } from '@parser'
import { FS } from '@shared'
import { Describe, Expect, Test, withTaoFiles } from '@shared/test'
import { Workspace } from '@workspace'
import { testParseCode, testParseSyntax } from './test-parse'

Describe('minimal Tao parser', () => {
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
        workspace view SharedView() {
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
    Expect(labelTextValue.target.ref).not.toBe(fileGreetingAlias)
  })

  Test('parses Tao source strings', async () => {
    const source = `
      app InlineApp { view MainView }
      view MainView() {
        render inject \`\`\`ts
          return null
        \`\`\`
      }
    `
    const parseResult = await testParseCode(source)

    Expect(parseResult.entry.ast.statements).toHaveLength(2)
    Expect.Is(parseResult.entry.ast.statements[0], AST.isAppDeclaration)
  })

  Test('parses use statements and workspace-visible declarations', async () => {
    const parseResult = await testParseSyntax(`
      app MyApp { view MainView }
      use Text, Stack from ./
      workspace let Greeting = "Hello"
      workspace view MainView() {
        render Stack(){
          Text(Greeting)
        }
      }
      workspace view Stack() {
        render inject Content @@content \`\`\`ts
          return <>{Content}</>
        \`\`\`
      }
      workspace view Text(Value text) {
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
    Expect(sharedAlias.visibility).toBe('workspace')
    Expect.Is(mainView, AST.isViewDeclaration)
    Expect(mainView.visibility).toBe('workspace')
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
      workspace view Text(Value text) {
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
      use Text from @bar
      use Label from @bar/forms
    `)

    Expect(parseResult.entry.document.parseResult.lexerErrors).toEqual([])
    Expect(parseResult.entry.document.parseResult.parserErrors).toEqual([])
    const [packageUse, subfolderUse] = parseResult.entry.ast.statements
    Expect.Is(packageUse, AST.isUseStatement)
    Expect.Is(subfolderUse, AST.isUseStatement)
    Expect(packageUse.importPath).toBe('@bar')
    Expect(subfolderUse.importPath).toBe('@bar/forms')
  })

  Test('parses file, package, workspace, and public visibility declarations', async () => {
    const parseResult = await testParseCode(`
      file let FileTitle = "File"
      package let PackageTitle = "Package"
      workspace view ProjectView() { }
      public view PublishedStack() { }
    `)

    const [fileAlias, packageAlias, projectView, publishedView] = parseResult.entry.ast.statements
    Expect.Is(fileAlias, AST.isAliasDeclaration)
    Expect.Is(packageAlias, AST.isAliasDeclaration)
    Expect.Is(projectView, AST.isViewDeclaration)
    Expect.Is(publishedView, AST.isViewDeclaration)
    Expect(fileAlias.visibility).toBe('file')
    Expect(packageAlias.visibility).toBe('package')
    Expect(projectView.visibility).toBe('workspace')
    Expect(publishedView.visibility).toBe('public')
  })

  Test('keeps workspace visibility scoped out of stdlib imports', () => {
    const stdlibResolution: Packages.Resolution = {
      relation: 'stdlib',
      targetPath: '/tao-stdlib/tao/ui',
      candidateMode: 'direct',
      importPath: '@tao/ui',
    }

    Expect(Packages.isVisible('file', stdlibResolution)).toBe(false)
    Expect(Packages.isVisible('workspace', stdlibResolution)).toBe(false)
    Expect(Packages.isVisible('public', stdlibResolution)).toBe(true)
  })

  Test('parses local project metadata', async () => {
    const parseResult = await testParseCode(`
      project {
        name "Package Access"
        remote none
        license MIT
      }
    `)

    const [project] = parseResult.entry.ast.statements
    Expect.Is(project, AST.isProjectDeclaration)
    Expect(AST.blockStatementOf(project, { map: statement => statement.$type })).toEqual([
      AST.ProjectName.$type,
      AST.ProjectRemote.$type,
      AST.ProjectLicense.$type,
    ])
  })
})
