import { ASTUtils, Packages, Type } from '@ast-utils'
import { AST } from '@parser'
import { FS, Repo } from '@shared'
import { Describe, Expect, Test, withTaoFiles } from '@shared/test'
import { Workspace } from '@workspace'
import { testParseCode, testParseSyntax } from './test-parse'

const kitchenSinkPath = Repo.resolvePath('Apps/Kitchen Sink/Kitchen Sink.tao')
const kitchenSinkTestPath = Repo.resolvePath('Apps/Kitchen Sink/Kitchen Sink.test.tao')
const typeSystemTestsPath = Repo.resolvePath('Apps/Test Apps/Type System Tests/Type System Tests.tao')
const runtimeStdlibTestsPath = Repo.resolvePath('Apps/Test Apps/Runtime Stdlib Tests/Runtime Stdlib Tests.tao')

Describe('minimal Tao parser', () => {
  Test('parses the current Kitchen Sink app', async () => {
    const parseResult = await Workspace.parse(kitchenSinkPath)

    Expect(parseResult.diagnostics).toEqual([])

    const useStatement = parseResult.entry.ast.statements.find(AST.isUseStatement)
    const app = parseResult.entry.ast.statements.find(AST.isAppDeclaration)
    const greetingAlias = parseResult.entry.ast.statements.find(
      statement => AST.isAliasDeclaration(statement) && statement.name === 'Greeting',
    )
    const launchCountAlias = parseResult.entry.ast.statements.find(
      statement => AST.isAliasDeclaration(statement) && statement.name === 'LaunchCount',
    )
    const mainView = parseResult.entry.ast.statements.find(
      statement => AST.isViewDeclaration(statement) && statement.name === 'MainView',
    )
    const countTextView = parseResult.entry.ast.statements.find(
      statement => AST.isViewDeclaration(statement) && statement.name === 'CountText',
    )
    Expect.Is(useStatement, AST.isUseStatement)
    Expect.Is(app, AST.isAppDeclaration)
    Expect.Is(greetingAlias, AST.isAliasDeclaration)
    Expect.Is(launchCountAlias, AST.isAliasDeclaration)
    Expect.Is(mainView, AST.isViewDeclaration)
    Expect.Is(countTextView, AST.isViewDeclaration)
    Expect(useStatement.importedDeclarations.map(reference => reference.$refText)).toEqual([
      'Button',
      'Number',
      'Stack',
      'Text',
    ])
    Expect(useStatement.importPath).toBe('@tao/ui')

    Expect(app.name).toBe('KitchenSink')
    const appRoot = AST.blockStatementOf(app, 0)
    Expect.Is(appRoot, AST.isAppView)
    Expect(appRoot.view.ref?.name).toBe('MainView')

    Expect(greetingAlias.name).toBe('Greeting')
    Expect.Is(greetingAlias.value, AST.isStringLiteral)
    Expect(launchCountAlias.name).toBe('LaunchCount')
    Expect.Is(launchCountAlias.value, AST.isNumberLiteral)

    Expect(mainView.name).toBe('MainView')
    const [kitchenCountState, localTextAlias, outerGreetingAlias, mainRender] = mainView.block.statements
    Expect.Is(kitchenCountState, AST.isStateDeclaration)
    Expect.Is(localTextAlias, AST.isAliasDeclaration)
    Expect.Is(outerGreetingAlias, AST.isAliasDeclaration)
    Expect.Is(mainRender, AST.isRenderStatement)
    Expect(mainRender.view?.ref?.name).toBe('Stack')
    Expect(kitchenCountState.name).toBe('KitchenCount')
    Expect.Is(kitchenCountState.value, AST.isNumberLiteral)
    Expect(localTextAlias.name).toBe('LocalText')
    Expect(outerGreetingAlias.name).toBe('OuterGreeting')
    Expect.Is(outerGreetingAlias.value, AST.isValueReference)
    Expect(valueDeclarationName(outerGreetingAlias.value.target.ref)).toBe('Greeting')

    const [blockGreetingAlias] = AST.statementsOf(mainRender.block)
    Expect.Is(blockGreetingAlias, AST.isAliasDeclaration)
    Expect(blockGreetingAlias.name).toBe('Greeting')
    const childInvocations = AST.statementsOf(mainRender.block).filter(AST.isViewRender)
    Expect(childInvocations).toHaveLength(11)
    const [
      outerText,
      shadowedText,
      nestedText,
      literalText,
      claimedText,
      countText,
      fixedNameText,
      profileNameText,
      tagText,
      kitchenNumber,
      kitchenButton,
    ] = childInvocations
    Expect.Is(outerText, AST.isViewRender)
    Expect.Is(shadowedText, AST.isViewRender)
    Expect.Is(nestedText, AST.isViewRender)
    Expect.Is(literalText, AST.isViewRender)
    Expect.Is(claimedText, AST.isViewRender)
    Expect.Is(countText, AST.isViewRender)
    Expect.Is(fixedNameText, AST.isViewRender)
    Expect.Is(profileNameText, AST.isViewRender)
    Expect.Is(tagText, AST.isViewRender)
    Expect.Is(kitchenNumber, AST.isViewRender)
    Expect.Is(kitchenButton, AST.isViewRender)
    Expect(outerText.view.ref?.name).toBe('Text')
    Expect(shadowedText.view.ref?.name).toBe('Text')
    Expect(nestedText.view.ref?.name).toBe('Text')
    Expect(literalText.view.ref?.name).toBe('Text')
    Expect(claimedText.view.ref?.name).toBe('Text')
    Expect(countText.view.ref?.name).toBe('CountText')
    Expect(fixedNameText.view.ref?.name).toBe('Text')
    Expect(profileNameText.view.ref?.name).toBe('Text')
    Expect(tagText.view.ref?.name).toBe('TagText')
    Expect(kitchenNumber.view.ref?.name).toBe('Number')
    Expect(kitchenButton.view.ref?.name).toBe('Button')

    const [
      greetingArg,
      shadowArg,
      nestedArg,
      literalArg,
      claimedArg,
      countArg,
      fixedNameArg,
      profileNameArg,
      tagArg,
      kitchenCountArg,
      kitchenButtonAction,
    ] = [
      AST.argumentsOf(outerText)[0]?.value,
      AST.argumentsOf(shadowedText)[0]?.value,
      AST.argumentsOf(nestedText)[0]?.value,
      AST.argumentsOf(literalText)[0]?.value,
      AST.argumentsOf(claimedText)[0]?.value,
      AST.argumentsOf(countText)[0]?.value,
      AST.argumentsOf(fixedNameText)[0]?.value,
      AST.argumentsOf(profileNameText)[0]?.value,
      AST.argumentsOf(tagText)[0]?.value,
      AST.argumentsOf(kitchenNumber)[0]?.value,
      AST.argumentsOf(kitchenButton)[1]?.value,
    ]
    Expect.Is(greetingArg, AST.isValueReference)
    Expect.Is(shadowArg, AST.isValueReference)
    Expect.Is(nestedArg, AST.isValueReference)
    Expect.Is(literalArg, AST.isStringLiteral)
    Expect.Is(claimedArg, AST.isStringLiteral)
    Expect.Is(countArg, AST.isValueReference)
    Expect.Is(fixedNameArg, AST.isValueReference)
    Expect.Is(profileNameArg, AST.isMemberAccessExpression)
    Expect.Is(tagArg, AST.isMemberAccessExpression)
    Expect.Is(kitchenCountArg, AST.isValueReference)
    Expect.Is(kitchenButtonAction, AST.isActionExpression)
    Expect(valueDeclarationName(greetingArg.target.ref)).toBe('OuterGreeting')
    Expect(valueDeclarationName(shadowArg.target.ref)).toBe('LocalText')
    Expect(valueDeclarationName(nestedArg.target.ref)).toBe('Greeting')
    Expect(literalArg.value).toBe('Hello World')
    Expect(claimedArg.value).toBe('Claimed space')
    Expect(AST.layoutEntriesOf(claimedText.layoutClause).map(layoutEntryTerms)).toEqual([
      ['claim', 2],
    ])
    Expect(valueDeclarationName(countArg.target.ref)).toBe('LaunchCount')
    Expect(valueDeclarationName(fixedNameArg.target.ref)).toBe('FixedSinkName')
    Expect(valueDeclarationName(profileNameArg.target.ref)).toBe('SinkProfileValue')
    Expect(profileNameArg.members).toEqual(['SinkName'])
    Expect(valueDeclarationName(tagArg.target.ref)).toBe('SinkProfileValue')
    Expect(tagArg.members).toEqual(['SinkTags'])
    Expect(kitchenCountArg.target.ref).toBe(kitchenCountState)

    Expect(countTextView.name).toBe('CountText')
    const countParameter = AST.parametersOf(countTextView)[0]
    Expect.Is(countParameter, AST.isParameterDeclaration)
    Expect(Type.parameterName(countParameter)).toBe('Count')
    Expect.Is(countParameter.inlineType?.type, AST.isPrimitiveTypeReference)
    Expect(countParameter.inlineType.type.primitive).toBe('number')
    const countRender = AST.blockStatementOf(countTextView, 0)
    Expect.Is(countRender, AST.isRenderStatement)
    Expect(countRender.injection?.tsCodeBlock).toContain('Launch count:')
    Expect.Is(countRender.injection, AST.isInjection)
    Expect(AST.injectionArgumentsOf(countRender.injection)).toHaveLength(1)
  })

  Test('parses inject render declarations', async () => {
    const parseResult = await testParseCode('view Native { render inject ```ts\nreturn null\n``` }')
    const view = parseResult.entry.ast.statements[0]

    Expect.Is(view, AST.isViewDeclaration)

    const render = AST.blockStatementOf(view, 0)
    Expect.Is(render, AST.isRenderStatement)
    Expect(render.injection?.tsCodeBlock).toContain('return null')
  })

  Test('parses layout declarations and child view invocations', async () => {
    const parseResult = await testParseCode(`
      app MyApp { view MainView }
      view MainView {
        render Stack() {
          let Local = "Inside"
          Text(Local) { }
          Text("Literal")
        }
      }
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
    `)
    const layout = parseResult.entry.ast.statements.find(AST.isLayoutDeclaration)
    Expect.Is(layout, AST.isLayoutDeclaration)
    const mainView = parseResult.entry.ast.statements.find(statement =>
      AST.isViewDeclaration(statement) && statement.name === 'MainView'
    )
    Expect.Is(mainView, AST.isViewDeclaration)
    const render = AST.blockStatementOf(mainView, 0)
    Expect.Is(render, AST.isRenderStatement)
    const [_localAlias, firstChild, secondChild] = AST.statementsOf(render.block)
    Expect.Is(firstChild, AST.isViewRender)
    Expect.Is(secondChild, AST.isViewRender)
    Expect(firstChild.view.ref?.name).toBe('Text')
    Expect(secondChild.view.ref?.name).toBe('Text')
  })

  Test('parses layout clauses on render sites', async () => {
    const parseResult = await testParseCode(`
      app MyApp { view MainView }
      view MainView {
        render Col() [claim 2, content top spread-inset, gap 12, pad 16, margin horizontal 4, width fill] {
          Text("Label") [width fill, height fill]
        }
      }
      layout Col {
        render inject \`\`\`ts
          return null
        \`\`\`
      }
      view Text Value is text {
        render inject \`\`\`ts
          return null
        \`\`\`
      }
    `)
    const mainView = parseResult.entry.ast.statements.find(statement =>
      AST.isViewDeclaration(statement) && statement.name === 'MainView'
    )
    Expect.Is(mainView, AST.isViewDeclaration)
    const render = AST.blockStatementOf(mainView, 0)
    Expect.Is(render, AST.isRenderStatement)
    Expect(AST.argumentsOf(render)).toHaveLength(0)
    const entries = AST.layoutEntriesOf(render.layoutClause)
    Expect(entries).toHaveLength(6)
    Expect(layoutEntryTerms(entries[0]!)).toEqual(['claim', 2])
    Expect(layoutEntryTerms(entries[1]!)).toEqual(['content', 'top', 'spread-inset'])
    Expect(layoutEntryTerms(entries[2]!)).toEqual(['gap', 12])
    Expect(layoutEntryTerms(entries[3]!)).toEqual(['pad', 16])
    Expect(layoutEntryTerms(entries[4]!)).toEqual(['margin', 'horizontal', 4])
    Expect(layoutEntryTerms(entries[5]!)).toEqual(['width', 'fill'])

    const child = AST.statementsOf(render.block).find(AST.isViewRender)
    Expect.Is(child, AST.isViewRender)
    Expect(AST.argumentsOf(child)).toHaveLength(1)
    Expect.Is(AST.argumentsOf(child)[0]?.value, AST.isStringLiteral)
    Expect(AST.layoutEntriesOf(child.layoutClause).map(layoutEntryTerms)).toEqual([
      ['width', 'fill'],
      ['height', 'fill'],
    ])
  })

  Test('parses empty brackets after a render target as an empty layout clause', async () => {
    const parseResult = await testParseCode(`
      app MyApp { view MainView }
      view MainView {
        render Col() []
      }
      layout Col {
        render inject \`\`\`ts
          return null
        \`\`\`
      }
    `)

    const mainView = parseResult.entry.ast.statements.find(statement =>
      AST.isViewDeclaration(statement) && statement.name === 'MainView'
    )
    Expect.Is(mainView, AST.isViewDeclaration)
    const render = AST.blockStatementOf(mainView, 0)
    Expect.Is(render, AST.isRenderStatement)
    Expect(AST.argumentsOf(render)).toHaveLength(0)
    Expect(AST.layoutEntriesOf(render.layoutClause)).toHaveLength(0)
  })

  Test('parses operators with standard precedence and when expressions', async () => {
    const parseResult = await testParseCode(`
      let Total = 1 + 2 * 3
      let Grouped = (1 + 2) * 3
      let Decimal = 1.5
      let Negated = -2
      let Gate = true and not false
      let Label = when
        Gate -> "on"
        otherwise -> "off"
    `)

    Expect(parseResult.diagnostics).toEqual([])
    const [total, grouped, decimal, negated, gate, label] = parseResult.entry.ast.statements
    Expect.Is(total, AST.isAliasDeclaration)
    Expect.Is(grouped, AST.isAliasDeclaration)
    Expect.Is(decimal, AST.isAliasDeclaration)
    Expect.Is(negated, AST.isAliasDeclaration)
    Expect.Is(gate, AST.isAliasDeclaration)
    Expect.Is(label, AST.isAliasDeclaration)

    // `*` binds tighter than `+`, so the sum owns the product.
    Expect.Is(total.value, AST.isBinaryExpression)
    Expect(total.value.operator).toBe('+')
    Expect.Is(total.value.right, AST.isBinaryExpression)
    Expect(total.value.right.operator).toBe('*')

    Expect.Is(grouped.value, AST.isBinaryExpression)
    Expect(grouped.value.operator).toBe('*')
    Expect.Is(grouped.value.left, AST.isParenthesizedExpression)

    Expect.Is(decimal.value, AST.isNumberLiteral)
    Expect(decimal.value.value).toBe(1.5)

    Expect.Is(negated.value, AST.isUnaryOperation)
    Expect(negated.value.operator).toBe('-')

    Expect.Is(gate.value, AST.isBinaryExpression)
    Expect(gate.value.operator).toBe('and')
    Expect.Is(gate.value.left, AST.isBooleanLiteral)
    Expect(gate.value.left.value).toBe('true')
    Expect.Is(gate.value.right, AST.isUnaryOperation)

    Expect.Is(label.value, AST.isWhenExpression)
    Expect(label.value.branches).toHaveLength(1)
    Expect.Is(label.value.otherwise, AST.isStringLiteral)
  })

  Test('parses parenthesized invocations and marks paren-less ones for the validator', async () => {
    const parseResult = await testParseCode(`
      view Text Value is text { }
      layout Stack { }
      view MainView {
        action Noop { }
        action Run {
          do Noop()
          do Noop
        }
        render Stack() [gap 8] {
          Text("hi")
          Text
        }
      }
    `)

    Expect(parseResult.diagnostics).toEqual([])
    const mainView = parseResult.entry.ast.statements.find(
      statement => AST.isViewDeclaration(statement) && statement.name === 'MainView',
    )
    Expect.Is(mainView, AST.isViewDeclaration)
    const [_noop, run, render] = mainView.block.statements
    Expect.Is(run, AST.isActionDeclaration)
    Expect.Is(render, AST.isRenderStatement)

    const [parenthesizedDo, bareDo] = run.block.statements
    Expect.Is(parenthesizedDo, AST.isDoStatement)
    Expect.Is(bareDo, AST.isDoStatement)
    Expect(parenthesizedDo.parenthesized).toBe(true)
    Expect(bareDo.parenthesized).toBe(false)

    Expect(render.parenthesized).toBe(true)
    Expect(render.layoutClause?.entries).toHaveLength(1)
    const [parenthesizedChild, bareChild] = render.block!.statements
    Expect.Is(parenthesizedChild, AST.isViewRender)
    Expect.Is(bareChild, AST.isViewRender)
    Expect(parenthesizedChild.parenthesized).toBe(true)
    Expect(AST.argumentsOf(parenthesizedChild)).toHaveLength(1)
    Expect(bareChild.parenthesized).toBe(false)
  })

  Test('parses aliases, literals is number, and value references', async () => {
    const parseResult = await testParseCode(`
      let Greeting = "Hello"
      let LaunchCount = 3

      view Text Value is text { }
      view StatTile Label is text, Count is number { }
      view MainView Label is text {
        let LocalLabel = Label
        render Text(LocalLabel) { }
        render StatTile(Greeting, LaunchCount) { }
      }
    `)

    const [greetingAlias, launchCountAlias, _textView, _statTileView, mainView] = parseResult.entry.ast.statements

    Expect.Is(greetingAlias, AST.isAliasDeclaration)
    Expect.Is(launchCountAlias, AST.isAliasDeclaration)
    Expect.Is(mainView, AST.isViewDeclaration)

    Expect.Is(greetingAlias.value, AST.isStringLiteral)
    Expect.Is(launchCountAlias.value, AST.isNumberLiteral)
    Expect(launchCountAlias.value.value).toBe(3)
    const mainViewParameter = AST.parametersOf(mainView)[0]
    Expect.Is(mainViewParameter, AST.isParameterDeclaration)
    Expect.Is(mainViewParameter.inlineType?.type, AST.isPrimitiveTypeReference)
    Expect(mainViewParameter.inlineType.type.primitive).toBe('text')

    const [localAlias, textRender, statRender] = mainView.block.statements
    Expect.Is(localAlias, AST.isAliasDeclaration)
    Expect.Is(textRender, AST.isRenderStatement)
    Expect.Is(statRender, AST.isRenderStatement)

    Expect.Is(localAlias.value, AST.isValueReference)
    Expect(valueDeclarationName(localAlias.value.target.ref)).toBe('Label')

    const textArg = AST.argumentsOf(textRender)[0]?.value
    Expect.Is(textArg, AST.isValueReference)
    Expect(valueDeclarationName(textArg.target.ref)).toBe('LocalLabel')

    const statArgs = AST.argumentsOf(statRender).map(argument => argument.value)
    Expect(statArgs.map(AST.isValueReference)).toEqual([true, true])
    const [labelArg, countArg] = statArgs
    Expect.Is(labelArg, AST.isValueReference)
    Expect.Is(countArg, AST.isValueReference)
    Expect(valueDeclarationName(labelArg.target.ref)).toBe('Greeting')
    Expect(valueDeclarationName(countArg.target.ref)).toBe('LaunchCount')
  })

  Test('parses state declarations and action values', async () => {
    const parseResult = await testParseCode(`
      app CounterApp { view MainView }

      view Button Title is text, Action is action { }

      view MainView {
        state Count = 0

        action AddStep Step is number {
          set Count += Step
        }

        action AddFive {
          do AddStep(5)
        }

        render Button("Add five", action {
          set Count = 0
        })
        render Button("Inline", -> {
          set Count *= 2
        })
      }
    `)

    const mainView = parseResult.entry.ast.statements.find(statement =>
      AST.isViewDeclaration(statement) && statement.name === 'MainView'
    )
    Expect.Is(mainView, AST.isViewDeclaration)

    const [countState, addStep, addFive, resetRender, inlineRender] = mainView.block.statements
    Expect.Is(countState, AST.isStateDeclaration)
    Expect.Is(addStep, AST.isActionDeclaration)
    Expect.Is(addFive, AST.isActionDeclaration)
    Expect.Is(resetRender, AST.isRenderStatement)
    Expect.Is(inlineRender, AST.isRenderStatement)

    const [setStep] = addStep.block.statements
    Expect.Is(setStep, AST.isSetStatement)
    Expect(setStep.target.ref).toBe(countState)
    Expect(setStep.operator).toBe('+=')
    Expect.Is(setStep.value, AST.isValueReference)
    Expect(setStep.value.target.ref).toBe(AST.parametersOf(addStep)[0])

    const [doAddStep] = addFive.block.statements
    Expect.Is(doAddStep, AST.isDoStatement)
    Expect.Is(doAddStep.action, AST.isValueReference)
    Expect(doAddStep.action.target.ref).toBe(addStep)
    Expect.Is(AST.argumentsOf(doAddStep)[0]?.value, AST.isNumberLiteral)

    Expect.Is(AST.argumentsOf(resetRender)[1]?.value, AST.isActionExpression)
    Expect.Is(AST.argumentsOf(inlineRender)[1]?.value, AST.isActionExpression)
  })

  Test('parses v0 Tao test declarations', async () => {
    const parseResult = await testParseCode(`
      app MyApp { view MainView }
      view MainView {
        render inject \`\`\`ts
          return null
        \`\`\`
      }

      test "Smoke" {
        check "renders text" {
          run MyApp

          expect text "Hello"
          press text "Add"
          expect missing text "Loading"
        }
      }
    `)

    const test = parseResult.entry.ast.statements.find(AST.isTestDeclaration)
    Expect.Is(test, AST.isTestDeclaration)
    Expect(test.name).toBe('Smoke')
    const [check] = test.block.statements
    Expect.Is(check, AST.isCheckDeclaration)
    Expect(check.name).toBe('renders text')
    const [run, expectedText, pressText, missingText] = check.block.statements
    Expect.Is(run, AST.isRunStep)
    Expect(run.app.ref?.name).toBe('MyApp')
    Expect.Is(expectedText, AST.isExpectTextStep)
    Expect(expectedText.selector).toBe('text')
    Expect(expectedText.text).toBe('Hello')
    Expect(expectedText.missing).toBe(false)
    Expect.Is(pressText, AST.isPressTextStep)
    Expect(pressText.selector).toBe('text')
    Expect(pressText.text).toBe('Add')
    Expect.Is(missingText, AST.isExpectTextStep)
    Expect(missingText.selector).toBe('text')
    Expect(missingText.text).toBe('Loading')
    Expect(missingText.missing).toBe(true)
  })

  Test('parses the Kitchen Sink v0 Tao test sidecar', async () => {
    const parseResult = await Workspace.parse(kitchenSinkTestPath)

    Expect(parseResult.diagnostics).toEqual([])
    const [useStatement, test] = parseResult.entry.ast.statements
    Expect.Is(useStatement, AST.isUseStatement)
    Expect(useStatement.importedDeclarations[0]?.ref?.name).toBe('KitchenSink')
    Expect.Is(test, AST.isTestDeclaration)
    Expect(test.block.statements.filter(AST.isCheckDeclaration)).toHaveLength(4)
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
        project view SharedView {
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
        render Stack() {
          let Greeting = "Block"
          Text(Greeting)
          Stack() {
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

  Test('parses the Type System Tests app', async () => {
    const parseResult = await Workspace.parse(typeSystemTestsPath)

    Expect(parseResult.diagnostics).toEqual([])
    Expect(parseResult.entry.ast.statements.filter(AST.isTypeDeclaration).map(type => type.name)).toEqual([
      'Name',
      'Age',
      'Count',
      'Tags',
      'Job',
      'Person',
    ])
    Expect(parseResult.entry.ast.statements.filter(AST.isAliasDeclaration)).toHaveLength(11)
  })

  Test('parses type declarations, constructors, lists, and member access', async () => {
    const parseResult = await testParseCode(`
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

      let DisplayName = Name "Ada"
      let DemoTags = Tags ["types" "items"]
      let DemoJob = Job { Title "Compiler engineer" }
      let DemoPerson = Person { DisplayName DemoTags DemoJob }

      view Profile Person {
        render Text(Person.Job.Title)
      }
      view Text Value is text { }
    `)

    Expect(parseResult.diagnostics).toEqual([])
    const [nameType, tagsType, jobType, personType] = parseResult.entry.ast.statements.filter(AST.isTypeDeclaration)
    Expect.Is(nameType, AST.isTypeDeclaration)
    Expect.Is(tagsType, AST.isTypeDeclaration)
    Expect.Is(jobType, AST.isTypeDeclaration)
    Expect.Is(personType, AST.isTypeDeclaration)
    Expect(nameType?.name).toBe('Name')
    Expect(tagsType?.name).toBe('Tags')
    Expect.Is(jobType.type, AST.isItemTypeExpression)
    Expect.Is(personType.type, AST.isItemTypeExpression)

    const [displayName, demoTags, demoJob, demoPerson] = parseResult.entry.ast.statements.filter(AST.isAliasDeclaration)
    Expect.Is(displayName, AST.isAliasDeclaration)
    Expect.Is(demoTags, AST.isAliasDeclaration)
    Expect.Is(demoJob, AST.isAliasDeclaration)
    Expect.Is(demoPerson, AST.isAliasDeclaration)
    Expect.Is(displayName.value, AST.isTypedConstructor)
    Expect.Is(demoTags.value, AST.isTypedConstructor)
    Expect.Is(demoTags.value.value, AST.isListLiteral)
    Expect.Is(demoJob.value, AST.isTypedConstructor)
    Expect.Is(demoJob.value.value, AST.isItemLiteral)
    Expect.Is(demoPerson.value, AST.isTypedConstructor)

    const profile = parseResult.entry.ast.statements.find(
      statement => AST.isViewDeclaration(statement) && statement.name === 'Profile',
    )
    Expect.Is(profile, AST.isViewDeclaration)
    const render = AST.blockStatementOf(profile, 0)
    Expect.Is(render, AST.isRenderStatement)
    const argument = AST.argumentsOf(render)[0]?.value
    Expect.Is(argument, AST.isMemberAccessExpression)
    Expect(argument.members).toEqual(['Job', 'Title'])
  })

  Test('resolves nested item property constructor types', async () => {
    const parseResult = await testParseCode(`
      type Job is {
        Title is text
      }
      type Profile is {
        Role is Job
      }
      let DemoProfile = Profile { Role { Title "Compiler engineer" } }
      view MainView { }
    `)

    Expect(parseResult.diagnostics).toEqual([])
    const profile = parseResult.entry.ast.statements.find(
      statement => AST.isTypeDeclaration(statement) && statement.name === 'Profile',
    )
    const alias = parseResult.entry.ast.statements.find(
      statement => AST.isAliasDeclaration(statement) && statement.name === 'DemoProfile',
    )
    Expect.Is(profile, AST.isTypeDeclaration)
    Expect.Is(profile.type, AST.isItemTypeExpression)
    Expect.Is(alias, AST.isAliasDeclaration)
    Expect.Is(alias.value, AST.isTypedConstructor)
    Expect.Is(alias.value.value, AST.isItemLiteral)
    const role = alias.value.value.properties[0]?.value
    Expect.Is(role, AST.isTypedConstructor)
    Expect.Is(role.type, AST.isNamedTypeReference)
    Expect(role.type.root).toBe('Role')
  })

  Test('parses the Runtime Stdlib Tests app', async () => {
    const parseResult = await Workspace.parse(runtimeStdlibTestsPath)

    Expect(parseResult.diagnostics).toEqual([])
    Expect(parseResult.entry.ast.statements.filter(AST.isUseStatement)).toHaveLength(1)
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

  Test('parses use statements and project-visible declarations', async () => {
    const parseResult = await testParseSyntax(`
      app MyApp { view MainView }
      use Text, Stack from ./
      project let Greeting = "Hello"
      project view MainView {
        render Stack() {
          Text(Greeting)
        }
      }
      project layout Stack {
        render inject \`\`\`ts
          return <>{_ViewProps.children}</>
        \`\`\`
      }
      project view Text Value is text {
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
      project view Text Value is text {
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
      package let PackageTitle = "Package"
      project view ProjectView { }
      publish layout PublishedStack { }
    `)

    const [packageAlias, projectView, publishedLayout] = parseResult.entry.ast.statements
    Expect.Is(packageAlias, AST.isAliasDeclaration)
    Expect.Is(projectView, AST.isViewDeclaration)
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
    Expect(AST.blockStatementOf(project, { map: statement => statement.$type })).toEqual([
      AST.ProjectName.$type,
      AST.ProjectRemote.$type,
      AST.ProjectLicense.$type,
    ])
  })
})

function layoutEntryTerms(entry: AST.LayoutEntry): Array<string | number> {
  return ASTUtils.layoutEntryValues(entry)
}

function valueDeclarationName(declaration: AST.ValueDeclaration | undefined): string | undefined {
  if (!declaration) {
    return undefined
  }
  return AST.isParameterDeclaration(declaration) ? Type.parameterName(declaration) : declaration.name
}
