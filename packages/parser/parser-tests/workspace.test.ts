import { Packages, Type } from '@ast-utils'
import { AST } from '@parser'
import { FS, Repo } from '@shared'
import { Describe, Expect, Test, withTaoFiles } from '@shared/test'
import { Workspace } from '@workspace'
import { testParseCode, testParseSyntax } from './test-parse'

const wordFlowerPath = Repo.resolvePath('Apps/WordFlower/1 - Current/WordFlower.tao')
const wordFlowerTestPath = Repo.resolvePath('Apps/WordFlower/1 - Current/WordFlower.test.tao')
const wordFlowerNextPath = Repo.resolvePath('Apps/WordFlower/2 - Next/WordFlower.tao-next')
const wordFlowerNextTestPath = Repo.resolvePath('Apps/WordFlower/2 - Next/WordFlower.test.tao-next')
const wordFlowerOpenTrancheHeader = '// Tranche status: open'
const wordFlowerAbsorbedTrancheHeader = '// Tranche status: absorbed'
const runtimeStdlibTestsPath = Repo.resolvePath('Apps/Test Apps/Runtime Stdlib Tests/Runtime Stdlib Tests.tao')

Describe('minimal Tao parser', () => {
  Test('parses the current WordFlower app', async () => {
    const parseResult = await Workspace.parse(wordFlowerPath)

    Expect(parseResult.diagnostics).toEqual([])

    const useStatement = parseResult.entry.ast.statements.find(
      statement => AST.isUseStatement(statement) && statement.importPath === '@tao/ui',
    )
    const app = parseResult.entry.ast.statements.find(AST.isAppDeclaration)
    const taglineLet = parseResult.entry.ast.statements.find(
      statement => AST.isAliasDeclaration(statement) && statement.name === 'Tagline',
    )
    const wordFlowerNavigator = parseResult.entry.ast.statements.find(
      statement => AST.isAliasDeclaration(statement) && statement.name === 'WordFlowerNavigator',
    )
    const data = parseResult.entry.ast.statements.filter(AST.isEntityDataDeclaration)
    const workspaceList = parseResult.entry.ast.statements.find(
      statement => AST.isUiDeclaration(statement) && statement.name === 'WorkspaceList',
    )
    const wordCountView = parseResult.entry.ast.statements.find(
      statement => AST.isViewDeclaration(statement) && statement.name === 'WordCount',
    )
    Expect.Is(useStatement, AST.isUseStatement)
    Expect.Is(app, AST.isAppDeclaration)
    Expect.Is(taglineLet, AST.isAliasDeclaration)
    Expect(data).toHaveLength(3)
    Expect.Is(workspaceList, AST.isUiDeclaration)
    Expect.Is(wordCountView, AST.isViewDeclaration)
    Expect(useStatement.importedDeclarations.map(reference => reference.$refText)).toEqual([
      'Col',
      'FormButton',
      'Text',
      'TextInput',
    ])
    Expect(useStatement.importPath).toBe('@tao/ui')

    Expect(app.name).toBe('WordFlower')
    const appDatasource = AST.blockStatements(app).find(AST.isAppDatasource)
    const appNavigator = AST.blockStatements(app).find(AST.isAppNavigator)
    Expect.Is(appDatasource, AST.isAppDatasource)
    Expect.Is(appNavigator, AST.isAppNavigator)
    Expect.Is(appNavigator.value, AST.isConfiguredAppPropertyValue)
    Expect(appNavigator.value.target.ref).toBe(wordFlowerNavigator)
    Expect.Is(wordFlowerNavigator, AST.isAliasDeclaration)
    Expect.Is(wordFlowerNavigator.value, AST.isConfigurationConstructor)
    Expect(wordFlowerNavigator.value.type.ref?.name).toBe('SelectionNav')
    const wordFlowerNavigatorBlock = wordFlowerNavigator.value.block
    Expect.Is(wordFlowerNavigatorBlock, AST.isConfigurationBlock)
    const selectionInitial = wordFlowerNavigatorBlock.entries.find(entry => entry.name === 'Initial')?.value
    Expect.Is(selectionInitial, AST.isConfigurationKeyValue)
    Expect(selectionInitial.key).toBe('@home')
    Expect(wordFlowerNavigatorBlock.entries.filter(entry => entry.key).map(entry => entry.key))
      .toEqual(['@home', '@workspace', '@settings'])

    Expect(taglineLet.name).toBe('Tagline')
    Expect.Is(taglineLet.value, AST.isStringLiteral)

    Expect(data.map(entity => [entity.name, entity.singularName])).toEqual([
      ['Workspaces', 'Workspace'],
      ['Documents', 'Document'],
      ['Paragraphs', 'Paragraph'],
    ])
    const documentEntity = data[1]!
    Expect(documentEntity.block.entries.some(entry => AST.isDataIndex(entry) && entry.fieldName === 'CreatedAt'))
      .toBe(true)

    const [workspaceDraftState, workspacesQuery] = workspaceList.block.statements
    Expect.Is(workspaceDraftState, AST.isStateDeclaration)
    Expect(workspaceDraftState.name).toBe('WorkspaceName')
    Expect.Is(workspacesQuery, AST.isEntityQueryDeclaration)
    const taglineRender = AST.streamAllContents(workspaceList)
      .filter(AST.isViewRender)
      .find(render => {
        const argument = AST.argumentsOf(render)[0]?.value
        return AST.isValueReference(argument) && argument.target.$refText === 'Tagline'
      })
    Expect.Is(taglineRender, AST.isViewRender)
    const taglineArg = AST.argumentsOf(taglineRender)[0]?.value
    Expect.Is(taglineArg, AST.isValueReference)
    Expect(taglineArg.target.ref).toBe(taglineLet)

    Expect(wordCountView.name).toBe('WordCount')
    const wordCountParameter = AST.parametersOf(wordCountView)[0]
    Expect.Is(wordCountParameter, AST.isParameterDeclaration)
    Expect(Type.parameterName(wordCountParameter)).toBe('Value')
    Expect.Is(wordCountParameter.inlineType?.type, AST.isPrimitiveTypeReference)
    Expect(wordCountParameter.inlineType.type.primitive).toBe('text')
    const wordCountRender = AST.blockStatementOf(wordCountView, 0)
    Expect.Is(wordCountRender, AST.isRenderStatement)
    Expect(wordCountRender.injection?.tsCodeBlock).toContain('Words:')
    Expect.Is(wordCountRender.injection, AST.isInjection)
    Expect(AST.injectionArgumentsOf(wordCountRender.injection)).toHaveLength(1)
  })

  Test('links imported custom configurable declarations without shipped-name tables', async () => {
    await withTaoFiles(
      'tao-parser-custom-configurable-',
      {
        'Main.tao': `
          use CustomData, CustomNav from @custom

          ui Home { }
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
          public nav CustomNav {
            Initial ui
            implement inject nav \`\`\`ts
              return TR.NavKind.Stack()
            \`\`\`
          }
          public datasource CustomData {
            StorageKey text
            implement inject provider \`\`\`ts
              return TR.DataProvider.Local()
            \`\`\`
          }
        `,
      },
      async (paths, rootDir) => {
        const workspace = await Workspace.open(rootDir)
        const parseResult = await workspace.parse(paths['Main.tao']!)

        Expect(parseResult.diagnostics).toEqual([])
        const packageFile = parseResult.files.find(file => file.path === paths['Packages/@custom/Constructs.tao'])
        const nav = packageFile?.ast.statements.find(AST.isNavDeclaration)
        const datasource = packageFile?.ast.statements.find(AST.isDatasourceDeclaration)
        const main = parseResult.entry.ast.statements.find(
          statement => AST.isAliasDeclaration(statement) && statement.name === 'MainNav',
        )
        const app = parseResult.entry.ast.statements.find(AST.isAppDeclaration)
        Expect.Is(nav, AST.isNavDeclaration)
        Expect.Is(datasource, AST.isDatasourceDeclaration)
        Expect.Is(main, AST.isAliasDeclaration)
        Expect.Is(app, AST.isAppDeclaration)
        Expect.Is(main.value, AST.isConfigurationConstructor)
        Expect(main.value.type.ref).toBe(nav)
        const appDatasource = AST.blockStatements(app).find(AST.isAppDatasource)
        Expect.Is(appDatasource, AST.isAppDatasource)
        Expect(appDatasource.value.target.ref).toBe(datasource)
      },
    )
  })

  Test('parses the WordFlower Tao test sidecar', async () => {
    const parseResult = await Workspace.parse(wordFlowerTestPath)

    Expect(parseResult.diagnostics).toEqual([])
    const [useStatement, test] = parseResult.entry.ast.statements
    Expect.Is(useStatement, AST.isUseStatement)
    Expect(useStatement.importedDeclarations[0]?.ref?.name).toBe('WordFlower')
    Expect.Is(test, AST.isTestDeclaration)
    Expect(test.block.statements.filter(AST.isCheckDeclaration)).toHaveLength(5)
  })

  Test('declares whether the WordFlower Next contract is open or absorbed', async () => {
    const currentSource = await FS.readText(wordFlowerPath)
    const currentTestSource = await FS.readText(wordFlowerTestPath)
    const nextSource = await FS.readText(wordFlowerNextPath)
    const nextTestSource = await FS.readText(wordFlowerNextTestPath)

    expectWordFlowerTrancheStatus(currentSource, wordFlowerAbsorbedTrancheHeader)
    expectWordFlowerTrancheStatus(currentTestSource, wordFlowerAbsorbedTrancheHeader)
    expectWordFlowerTrancheStatus(
      nextSource,
      nextSource === currentSource ? wordFlowerAbsorbedTrancheHeader : wordFlowerOpenTrancheHeader,
    )
    expectWordFlowerTrancheStatus(
      nextTestSource,
      nextTestSource === currentTestSource ? wordFlowerAbsorbedTrancheHeader : wordFlowerOpenTrancheHeader,
    )
  })

  Test('gates the WordFlower Next app independently', async () => {
    const nextSource = await FS.readText(wordFlowerNextPath)
    const currentSource = await FS.readText(wordFlowerPath)
    if (!expectWordFlowerPairState(nextSource, currentSource, nextSource)) {
      return
    }
    const current = await Workspace.parse(wordFlowerPath)

    await withTaoFiles(
      'wordflower-next-app-contract-',
      { 'WordFlower.tao': nextSource },
      async paths => {
        const next = await Workspace.validate(paths['WordFlower.tao']!)

        Expect(next.diagnostics).toEqual([])
        Expect(normalizedAst(next.entry.ast)).toEqual(normalizedAst(current.entry.ast))
      },
    )
  })

  Test('gates the WordFlower Next test sidecar independently', async () => {
    const nextTestSource = await FS.readText(wordFlowerNextTestPath)
    const currentTestSource = await FS.readText(wordFlowerTestPath)
    if (!expectWordFlowerPairState(nextTestSource, currentTestSource, nextTestSource)) {
      return
    }
    const currentTest = await Workspace.parse(wordFlowerTestPath)

    await withTaoFiles(
      'wordflower-next-sidecar-contract-',
      {
        'WordFlower.tao': await FS.readText(wordFlowerPath),
        'WordFlower.test.tao': nextTestSource,
      },
      async paths => {
        const nextTest = await Workspace.validate(paths['WordFlower.test.tao']!)

        Expect(nextTest.diagnostics).toEqual([])
        Expect(normalizedAst(nextTest.entry.ast)).toEqual(normalizedAst(currentTest.entry.ast))
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
        view MainView {
          render SharedView()
        }
      `,
        'Shared.tao': `
        workspace view SharedView {
          render inject \`\`\`ts
            return null
          \`\`\`
        }
      `,
        'Main.test.tao': `
        test "Sidecar" {
          check "intentionally incomplete" {
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

      layout Stack {
        render inject \`\`\`ts
          return <>{_ViewProps.children}</>
        \`\`\`
      }
      view Text Value is text {
        render inject \`\`\`ts
          return null
        \`\`\`
      }
      view MainView Label is text {
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

    const [viewGreetingAlias, labelAlias, render] = mainView.block.statements
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

  Test('parses the Runtime Stdlib Tests app', async () => {
    const parseResult = await Workspace.parse(runtimeStdlibTestsPath)

    Expect(parseResult.diagnostics).toEqual([])
    Expect(parseResult.entry.ast.statements.filter(AST.isUseStatement)).toHaveLength(2)
  })

  Test('parses Tao source strings', async () => {
    const source = `
      app InlineApp { view MainView }
      view MainView {
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
      workspace view MainView {
        render Stack(){
          Text(Greeting)
        }
      }
      workspace layout Stack {
        render inject \`\`\`ts
          return <>{_ViewProps.children}</>
        \`\`\`
      }
      workspace view Text Value is text {
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
      workspace view Text Value is text {
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
      workspace view ProjectView { }
      public layout PublishedStack { }
    `)

    const [fileAlias, packageAlias, projectView, publishedLayout] = parseResult.entry.ast.statements
    Expect.Is(fileAlias, AST.isAliasDeclaration)
    Expect.Is(packageAlias, AST.isAliasDeclaration)
    Expect.Is(projectView, AST.isViewDeclaration)
    Expect.Is(publishedLayout, AST.isLayoutDeclaration)
    Expect(fileAlias.visibility).toBe('file')
    Expect(packageAlias.visibility).toBe('package')
    Expect(projectView.visibility).toBe('workspace')
    Expect(publishedLayout.visibility).toBe('public')
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

function expectWordFlowerPairState(next: string, current: string, nextHeader: string): boolean {
  if (next === current) {
    Expect(next).toBe(current)
    return true
  }
  Expect(next).not.toBe(current)
  expectWordFlowerTrancheStatus(nextHeader, wordFlowerOpenTrancheHeader)
  return false
}

function expectWordFlowerTrancheStatus(source: string, expected: string): void {
  Expect(source.match(/^\/\/ Tranche status: (?:open|absorbed)$/gm) ?? []).toEqual([expected])
}

function normalizedAst(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(normalizedAst)
  }
  if (typeof value !== 'object' || value === null) {
    return value
  }
  if ('$refText' in value) {
    return { $refText: (value as { $refText: string }).$refText }
  }
  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => key === '$type' || !key.startsWith('$'))
      .filter(([key]) => key !== 'error' && key !== 'ref')
      .map(([key, child]) => [key, normalizedAst(child)]),
  )
}
