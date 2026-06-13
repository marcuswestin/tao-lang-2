import { Packages } from '@ast-utils'
import { FS } from '@shared'
import { Describe, Expect, Test } from '@shared/test'
import { Workspace } from '@workspace'
import { AST } from '../parser-src/parser'
import { testParseCode, testParseSyntax } from './test-parse'

const kitchenSinkPath = FS.repoPath('Apps/Kitchen Sink/Kitchen Sink.tao')
const targetKitchenSinkPath = FS.repoPath('Apps/Kitchen Sink - Target/Kitchen Sink - Target.tao')
const typeSystemTestsPath = FS.repoPath('Apps/Test Apps/Type System Tests/Type System Tests.tao')
const runtimeStdlibTestsPath = FS.repoPath('Apps/Test Apps/Runtime Stdlib Tests/Runtime Stdlib Tests.tao')

Describe('minimal Tao parser', () => {
  Test('parses the current Kitchen Sink app', async () => {
    const parseResult = await Workspace.parse(kitchenSinkPath)

    Expect(parseResult.diagnostics).toEqual([])

    const [useStatement, app, greetingAlias, launchCountAlias, mainView, countTextView] =
      parseResult.entry.ast.statements
    Expect.Is(useStatement, AST.isUseStatement)
    Expect.Is(app, AST.isAppDeclaration)
    Expect.Is(greetingAlias, AST.isAliasDeclaration)
    Expect.Is(launchCountAlias, AST.isAliasDeclaration)
    Expect.Is(mainView, AST.isUiDeclaration)
    Expect.Is(countTextView, AST.isUiDeclaration)
    Expect(useStatement.importedDeclarations.map(reference => reference.$refText)).toEqual(['Stack', 'Text'])
    Expect(useStatement.importPath).toBe('@tao/ui')

    Expect(app.name).toBe('KitchenSink')
    const appRoot = app.block.statements[0]
    Expect.Is(appRoot, AST.isAppUi)
    Expect(appRoot.ui.ref?.name).toBe('MainView')

    Expect(greetingAlias.name).toBe('Greeting')
    Expect.Is(greetingAlias.value, AST.isStringLiteral)
    Expect(launchCountAlias.name).toBe('LaunchCount')
    Expect.Is(launchCountAlias.value, AST.isNumberLiteral)

    Expect(mainView.name).toBe('MainView')
    const [localTextAlias, outerGreetingAlias, mainRender] = mainView.block.statements
    Expect.Is(localTextAlias, AST.isAliasDeclaration)
    Expect.Is(outerGreetingAlias, AST.isAliasDeclaration)
    Expect.Is(mainRender, AST.isRenderStatement)
    Expect(mainRender.view?.ref?.name).toBe('Stack')
    Expect(localTextAlias.name).toBe('LocalText')
    Expect(outerGreetingAlias.name).toBe('OuterGreeting')
    Expect.Is(outerGreetingAlias.value, AST.isValueReference)
    Expect(outerGreetingAlias.value.target.ref?.name).toBe('Greeting')

    const [blockGreetingAlias] = mainRender.block?.statements ?? []
    Expect.Is(blockGreetingAlias, AST.isAliasDeclaration)
    Expect(blockGreetingAlias.name).toBe('Greeting')
    const childInvocations = mainRender.block?.statements.filter(AST.isViewRender) ?? []
    Expect(childInvocations).toHaveLength(5)
    const [outerText, shadowedText, nestedText, literalText, countText] = childInvocations
    Expect.Is(outerText, AST.isViewRender)
    Expect.Is(shadowedText, AST.isViewRender)
    Expect.Is(nestedText, AST.isViewRender)
    Expect.Is(literalText, AST.isViewRender)
    Expect.Is(countText, AST.isViewRender)
    Expect(outerText.view.ref?.name).toBe('Text')
    Expect(shadowedText.view.ref?.name).toBe('Text')
    Expect(nestedText.view.ref?.name).toBe('Text')
    Expect(literalText.view.ref?.name).toBe('Text')
    Expect(countText.view.ref?.name).toBe('CountText')

    const [greetingArg, shadowArg, nestedArg, literalArg, countArg] = [
      outerText.argumentList?.arguments[0]?.value,
      shadowedText.argumentList?.arguments[0]?.value,
      nestedText.argumentList?.arguments[0]?.value,
      literalText.argumentList?.arguments[0]?.value,
      countText.argumentList?.arguments[0]?.value,
    ]
    Expect.Is(greetingArg, AST.isValueReference)
    Expect.Is(shadowArg, AST.isValueReference)
    Expect.Is(nestedArg, AST.isValueReference)
    Expect.Is(literalArg, AST.isStringLiteral)
    Expect.Is(countArg, AST.isValueReference)
    Expect(greetingArg.target.ref?.name).toBe('OuterGreeting')
    Expect(shadowArg.target.ref?.name).toBe('LocalText')
    Expect(nestedArg.target.ref?.name).toBe('Greeting')
    Expect(literalArg.value).toBe('Hello World')
    Expect(countArg.target.ref?.name).toBe('LaunchCount')

    Expect(countTextView.name).toBe('CountText')
    Expect(countTextView.parameterList?.parameters[0]?.name).toBe('Count')
    Expect(countTextView.parameterList?.parameters[0]?.type).toBe('number')
    const countRender = countTextView.block.statements[0]
    Expect.Is(countRender, AST.isRenderStatement)
    Expect(countRender.injection?.tsCodeBlock).toContain('Launch count:')
    Expect(countRender.injection?.argumentList?.arguments).toHaveLength(1)
  })

  Test('parses inject render declarations', async () => {
    const parseResult = await testParseCode('ui Native { render inject ```ts\nreturn null\n``` }')
    const view = parseResult.entry.ast.statements[0]

    Expect.Is(view, AST.isUiDeclaration)

    const render = view.block.statements[0]
    Expect.Is(render, AST.isRenderStatement)
    Expect(render.injection?.tsCodeBlock).toContain('return null')
  })

  Test('parses layout declarations and child view invocations', async () => {
    const parseResult = await testParseCode(`
      app MyApp { ui MainView }
      ui MainView {
        render Stack {
          alias Local = "Inside"
          Text Local { }
          Text "Literal"
        }
      }
      layout Stack {
        render inject \`\`\`ts
          return <>{_ViewProps.children}</>
        \`\`\`
      }
      ui Text Value text {
        render inject \`\`\`ts
          return null
        \`\`\`
      }
    `)
    const layout = parseResult.entry.ast.statements.find(AST.isLayoutDeclaration)
    Expect.Is(layout, AST.isLayoutDeclaration)
    const mainView = parseResult.entry.ast.statements.find(statement =>
      AST.isUiDeclaration(statement) && statement.name === 'MainView'
    )
    Expect.Is(mainView, AST.isUiDeclaration)
    const render = mainView.block.statements[0]
    Expect.Is(render, AST.isRenderStatement)
    const [_localAlias, firstChild, secondChild] = render.block?.statements ?? []
    Expect.Is(firstChild, AST.isViewRender)
    Expect.Is(secondChild, AST.isViewRender)
    Expect(firstChild.view.ref?.name).toBe('Text')
    Expect(secondChild.view.ref?.name).toBe('Text')
  })

  Test('parses aliases, number literals, and value references', async () => {
    const parseResult = await testParseCode(`
      alias Greeting = "Hello"
      alias LaunchCount = 3

      ui Text Value text { }
      ui StatTile Label text, Count number { }
      ui MainView Label text {
        alias LocalLabel = Label
        render Text LocalLabel { }
        render StatTile Greeting, LaunchCount { }
      }
    `)

    const [greetingAlias, launchCountAlias, _textView, _statTileView, mainView] = parseResult.entry.ast.statements

    Expect.Is(greetingAlias, AST.isAliasDeclaration)
    Expect.Is(launchCountAlias, AST.isAliasDeclaration)
    Expect.Is(mainView, AST.isUiDeclaration)

    Expect.Is(greetingAlias.value, AST.isStringLiteral)
    Expect.Is(launchCountAlias.value, AST.isNumberLiteral)
    Expect(launchCountAlias.value.value).toBe(3)
    Expect(mainView.parameterList?.parameters[0]?.type).toBe('text')

    const [localAlias, textRender, statRender] = mainView.block.statements
    Expect.Is(localAlias, AST.isAliasDeclaration)
    Expect.Is(textRender, AST.isRenderStatement)
    Expect.Is(statRender, AST.isRenderStatement)

    Expect.Is(localAlias.value, AST.isValueReference)
    Expect(localAlias.value.target.ref?.name).toBe('Label')

    const textArg = textRender.argumentList?.arguments[0]?.value
    Expect.Is(textArg, AST.isValueReference)
    Expect(textArg.target.ref?.name).toBe('LocalLabel')

    const statArgs = statRender.argumentList?.arguments.map(argument => argument.value)
    Expect(statArgs?.map(AST.isValueReference)).toEqual([true, true])
    const [labelArg, countArg] = statArgs ?? []
    Expect.Is(labelArg, AST.isValueReference)
    Expect.Is(countArg, AST.isValueReference)
    Expect(labelArg.target.ref?.name).toBe('Greeting')
    Expect(countArg.target.ref?.name).toBe('LaunchCount')
  })

  Test('resolves value references through nested scope shadowing', async () => {
    const parseResult = await testParseCode(`
      alias Greeting = "File"

      layout Stack {
        render inject \`\`\`ts
          return <>{_ViewProps.children}</>
        \`\`\`
      }
      ui Text Value text {
        render inject \`\`\`ts
          return null
        \`\`\`
      }
      ui MainView Label text {
        alias Greeting = "View"
        alias LabelAlias = Label
        render Stack {
          alias Greeting = "Block"
          Text Greeting
          Stack {
            alias Greeting = "Nested"
            Text Greeting
          }
          Text LabelAlias
        }
      }
    `)

    const [fileGreetingAlias, _stackView, _textView, mainView] = parseResult.entry.ast.statements
    Expect.Is(fileGreetingAlias, AST.isAliasDeclaration)
    Expect.Is(mainView, AST.isUiDeclaration)

    const labelParameter = mainView.parameterList?.parameters[0]
    Expect.Is(labelParameter, AST.isParameterDeclaration)

    const [viewGreetingAlias, labelAlias, render] = mainView.block.statements
    Expect.Is(viewGreetingAlias, AST.isAliasDeclaration)
    Expect.Is(labelAlias, AST.isAliasDeclaration)
    Expect.Is(render, AST.isRenderStatement)
    Expect.Is(labelAlias.value, AST.isValueReference)
    Expect(labelAlias.value.target.ref).toBe(labelParameter)

    const [blockGreetingAlias, blockText, nestedStack, labelText] = render.block?.statements ?? []
    Expect.Is(blockGreetingAlias, AST.isAliasDeclaration)
    Expect.Is(blockText, AST.isViewRender)
    Expect.Is(nestedStack, AST.isViewRender)
    Expect.Is(labelText, AST.isViewRender)

    const blockTextValue = blockText.argumentList?.arguments[0]?.value
    Expect.Is(blockTextValue, AST.isValueReference)
    Expect(blockTextValue.target.ref).toBe(blockGreetingAlias)

    const [nestedGreetingAlias, nestedText] = nestedStack.block?.statements ?? []
    Expect.Is(nestedGreetingAlias, AST.isAliasDeclaration)
    Expect.Is(nestedText, AST.isViewRender)

    const nestedTextValue = nestedText.argumentList?.arguments[0]?.value
    Expect.Is(nestedTextValue, AST.isValueReference)
    Expect(nestedTextValue.target.ref).toBe(nestedGreetingAlias)

    const labelTextValue = labelText.argumentList?.arguments[0]?.value
    Expect.Is(labelTextValue, AST.isValueReference)
    Expect(labelTextValue.target.ref).toBe(labelAlias)
    Expect(labelTextValue.target.ref).not.toBe(fileGreetingAlias)
  })

  Test('parses the target Kitchen Sink app', async () => {
    const parseResult = await Workspace.parse(targetKitchenSinkPath)

    Expect(parseResult.diagnostics).toEqual([])
    Expect(parseResult.entry.ast.statements.filter(AST.isAliasDeclaration).map(alias => alias.name)).toEqual([
      'Greeting',
      'LaunchCount',
    ])
  })

  Test('parses the Type System Tests app', async () => {
    const parseResult = await Workspace.parse(typeSystemTestsPath)

    Expect(parseResult.diagnostics).toEqual([])
    Expect(parseResult.entry.ast.statements.filter(AST.isAliasDeclaration)).toHaveLength(4)
  })

  Test('parses the Runtime Stdlib Tests app', async () => {
    const parseResult = await Workspace.parse(runtimeStdlibTestsPath)

    Expect(parseResult.diagnostics).toEqual([])
    Expect(parseResult.entry.ast.statements.filter(AST.isUseStatement)).toHaveLength(1)
  })

  Test('parses Tao source strings', async () => {
    const source = `
      app InlineApp { ui MainView }
      ui MainView {
        render inject \`\`\`ts
          return null
        \`\`\`
      }
    `
    const parseResult = await testParseCode(source)

    Expect(parseResult.entry.ast.statements).toHaveLength(2)
    Expect.Is(parseResult.entry.ast.statements[0], AST.isAppDeclaration)
  })

  Test('parses use statements and project-visible declarations', async () => {
    const parseResult = await testParseSyntax(`
      app MyApp { ui MainView }
      use Text, Stack from ./
      project alias Greeting = "Hello"
      project ui MainView {
        render Stack {
          Text Greeting
        }
      }
      project layout Stack {
        render inject \`\`\`ts
          return <>{_ViewProps.children}</>
        \`\`\`
      }
      project ui Text Value text {
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
    Expect.Is(mainView, AST.isUiDeclaration)
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
      project ui Text Value text {
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

  Test('parses project package visibility declarations', async () => {
    const parseResult = await testParseCode(`
      package alias PackageTitle = "Package"
      project ui ProjectView { }
      publish layout PublishedStack { }
    `)

    const [packageAlias, projectView, publishedLayout] = parseResult.entry.ast.statements
    Expect.Is(packageAlias, AST.isAliasDeclaration)
    Expect.Is(projectView, AST.isUiDeclaration)
    Expect.Is(publishedLayout, AST.isLayoutDeclaration)
    Expect(packageAlias.visibility).toBe('package')
    Expect(projectView.visibility).toBe('project')
    Expect(publishedLayout.visibility).toBe('publish')
  })

  Test('keeps project visibility scoped out of stdlib imports', () => {
    const stdlibResolution: Packages.Resolution = {
      relation: 'stdlib',
      targetPath: '/tao-stdlib/tao/ui',
      candidateMode: 'direct',
      importPath: '@tao/ui',
    }

    Expect(Packages.isVisible('project', stdlibResolution)).toBe(false)
    Expect(Packages.isVisible('publish', stdlibResolution)).toBe(true)
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
    Expect(project.block.statements.map(statement => statement.$type)).toEqual([
      AST.ProjectName.$type,
      AST.ProjectRemote.$type,
      AST.ProjectLicense.$type,
    ])
  })
})
