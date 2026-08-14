import { ASTUtils, Type } from '@ast-utils'
import { AST } from '@parser'
import { Describe, Expect, Test } from '@shared/test'
import { testParseCode, testParseSyntax } from './test-parse'

Describe('parser: core language syntax', () => {
  Test('parses layout declarations and child view invocations', async () => {
    const parseResult = await testParseCode(`
      app MyApp { view MainView }
      view MainView {
        render Stack(){
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

  Test('parses named and inline control events with a scoped change payload', async () => {
    const parseResult = await testParseCode(`
      app EventsApp { view MainView }
      view MainView {
        state Draft = ""
        action Submit { }
        render Input(Value: Draft) {
          on change -> Entered { set Draft = Entered }
          on submit Submit
        }
      }
      view Input Value is text, Change is action(text), Submit is action() {
        render inject \`\`\`ts return null \`\`\`
      }
    `)
    Expect(parseResult.diagnostics).toEqual([])
    const handlers = parseResult.entry.ast.statements
      .flatMap(statement => AST.streamAllContents(statement))
      .filter(AST.isEventHandler)
    Expect(handlers.map(handler => handler.event)).toEqual(['change', 'submit'])

    const [change, submit] = handlers
    Expect.Is(change, AST.isEventHandler)
    Expect.Is(change.payload, AST.isCasePayload)
    Expect(change.payload.name).toBe('Entered')
    const payloadReference = AST.streamAllContents(change).find(AST.isValueReference)
    Expect.Is(payloadReference, AST.isValueReference)
    Expect(payloadReference.target.ref).toBe(change.payload)

    Expect.Is(submit, AST.isEventHandler)
    Expect(submit.action?.target.$refText).toBe('Submit')
    Expect(submit.action?.target.ref).toBeDefined()
  })

  Test('parses layout clauses on render sites', async () => {
    const parseResult = await testParseCode(`
      app MyApp { view MainView }
      view MainView {
        render Col()[claim 2, content top spread-inset, gap 12, pad 16, margin horizontal 4, width fill] {
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
        render Col()[]
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

  Test('parses canonical immutable bindings on AliasDeclaration', async () => {
    const parseResult = await testParseCode(`
      let Current = "current"
    `)

    const [current] = parseResult.entry.ast.statements
    Expect.Is(current, AST.isAliasDeclaration)
    Expect(current.keyword).toBe('let')
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

  Test('parses explicit positional action callback signatures', async () => {
    const parseResult = await testParseCode(`
      view Field Change is action(text), Submit is action() { }
    `)

    const field = parseResult.entry.ast.statements[0]
    Expect.Is(field, AST.isViewDeclaration)
    const [change, submit] = AST.parametersOf(field)
    const changeType = change?.inlineType?.type
    const submitType = submit?.inlineType?.type
    Expect.Is(changeType, AST.isActionTypeReference)
    Expect.Is(submitType, AST.isActionTypeReference)
    Expect(changeType.parameterTypes).toHaveLength(1)
    Expect.Is(changeType.parameterTypes[0], AST.isPrimitiveTypeReference)
    Expect(changeType.parameterTypes[0].primitive).toBe('text')
    Expect(submitType.parameterTypes).toEqual([])
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
          enter "Draft" into label "Title"
          submit placeholder "Title"
          expect missing text "Loading"
          expect input placeholder "Title" value "Draft"
          back
        }
      }
    `)

    const test = parseResult.entry.ast.statements.find(AST.isTestDeclaration)
    Expect.Is(test, AST.isTestDeclaration)
    Expect(test.name).toBe('Smoke')
    const [check] = test.block.statements
    Expect.Is(check, AST.isCheckDeclaration)
    Expect(check.name).toBe('renders text')
    const [run, expectedText, pressText, enterText, submitInput, missingText, inputValue, back] = check.block.statements
    Expect.Is(run, AST.isRunStep)
    Expect(run.app.ref?.name).toBe('MyApp')
    Expect.Is(expectedText, AST.isExpectTextStep)
    Expect(expectedText.selector).toBe('text')
    Expect(expectedText.text).toBe('Hello')
    Expect(expectedText.missing).toBe(false)
    Expect.Is(pressText, AST.isPressTextStep)
    Expect(pressText.selector).toBe('text')
    Expect(pressText.text).toBe('Add')
    Expect.Is(enterText, AST.isEnterTextStep)
    Expect(enterText.value).toBe('Draft')
    Expect(enterText.selector).toBe('label')
    Expect(enterText.target).toBe('Title')
    Expect.Is(submitInput, AST.isSubmitInputStep)
    Expect(submitInput.selector).toBe('placeholder')
    Expect(submitInput.target).toBe('Title')
    Expect.Is(missingText, AST.isExpectTextStep)
    Expect(missingText.selector).toBe('text')
    Expect(missingText.text).toBe('Loading')
    Expect(missingText.missing).toBe(true)
    Expect.Is(inputValue, AST.isExpectInputValueStep)
    Expect(inputValue.selector).toBe('placeholder')
    Expect(inputValue.target).toBe('Title')
    Expect(inputValue.value).toBe('Draft')
    Expect.Is(back, AST.isBackTestStep)
  })

  Test(
    'parses tagged renders, tagged loops, scoped selection, grouped expectations, and bare data status',
    async () => {
      const parseResult = await testParseCode(`
      app TaggedApp { view MainView }
      view MainView {
        render Col() {
          #field
          Input()
          #rows
          loop ["First", "Second"] / Row {
            Col() {
              Text(Row)
              #choose
              Button()
            }
          }
        }
      }
      layout Col { render inject \`\`\`ts return null \`\`\` }
      view Input { render inject \`\`\`ts return null \`\`\` }
      view Button { render inject \`\`\`ts return null \`\`\` }
      view Text Value is text { render inject \`\`\`ts return null \`\`\` }

      test "Tagged interactions" {
        check "uses structured selectors" {
          run TaggedApp
          expect {
            text "First"
            missing label "Unavailable"
          }
          expect #field {
            placeholder "Name"
            input value ""
          }
          enter "Draft" into #field
          submit #field
          press #field
          select #rows[2] {
            expect text "Second"
            press #choose
          }
          data loading
          data error "Offline"
          data ready
        }
      }
    `)

      Expect(parseResult.diagnostics).toEqual([])
      const tags = AST.streamAllContents(parseResult.entry.ast).filter(AST.isTagStatement)
      Expect(tags.map(tag => tag.tag)).toEqual(['#field', '#rows', '#choose'])
      const loop = AST.streamAllContents(parseResult.entry.ast).find(AST.isForStatement)
      Expect.Is(loop, AST.isForStatement)
      Expect(loop.name).toBe('Row')
      Expect(AST.attachedTag(loop)?.tag).toBe('#rows')
      Expect(AST.testTagForRender(AST.taggedLoopRowRoot(loop)!)).toBe('rows')

      const check = AST.streamAllContents(parseResult.entry.ast).find(AST.isCheckDeclaration)
      Expect.Is(check, AST.isCheckDeclaration)
      Expect(check.block.statements.some(AST.isExpectGroupStep)).toBe(true)
      Expect(check.block.statements.some(AST.isExpectScopeStep)).toBe(true)
      const select = check.block.statements.find(AST.isSelectStep)
      Expect.Is(select, AST.isSelectStep)
      Expect(select.tag).toBe('#rows')
      Expect(select.index).toBe(2)
      Expect(select.block.statements.some(AST.isTagPressStep)).toBe(true)
      const statuses = check.block.statements.filter(AST.isDataStatusStep)
      Expect(statuses).toHaveLength(3)
      Expect(statuses.map(status => status.status ?? 'error')).toEqual(['loading', 'error', 'ready'])
    },
  )

  Test('parses named invocation arguments', async () => {
    const parseResult = await testParseCode(`
      view Field Value is text, Change is action, Disabled is boolean { }
      view MainView Draft is text, ChangeDraft is action {
        render Field(Disabled: false, Change: ChangeDraft, Value: Draft)
      }
    `)

    const mainView = parseResult.entry.ast.statements.find(
      statement => AST.isViewDeclaration(statement) && statement.name === 'MainView',
    )
    Expect.Is(mainView, AST.isViewDeclaration)
    const render = AST.blockStatementOf(mainView, 0)
    Expect.Is(render, AST.isRenderStatement)
    Expect(AST.argumentsOf(render).map(argument => argument.label)).toEqual([
      'Disabled',
      'Change',
      'Value',
    ])
  })

  Test('parses top-level plural/singular data declarations and inferred fields', async () => {
    const parseResult = await testParseCode(`
      data Workspaces / Workspace {
        Name text
        CreatedAt time (default now)
        Pinned yes / no
        Documents (relation Documents, auto-delete)
        index CreatedAt
        order by CreatedAt desc
      }
      data Documents / Document {
        Title text
        Final yes / no Draft
        Public yes / no Private (default Public)
        Workspace (relation Workspace)
        Paragraphs (auto-delete)
      }
      data Paragraphs / Paragraph {
        Text text
        Ordering number
        Document
        order by Ordering
      }
      view Detail Workspace {
        action Add { create Document { Title: "Draft", Workspace } }
        render inject \`\`\`ts return null \`\`\`
      }
      view Queries Workspace {
        query Workspaces as AllWorkspaces { }
        render Col() {
          query Drafts from Workspace.Documents { where is Draft }
          loop Drafts / Draft { Text(Draft.Title) }
        }
      }
      layout Col { render inject \`\`\`ts return null \`\`\` }
      view Text Value is text { render inject \`\`\`ts return null \`\`\` }
    `)

    Expect(parseResult.diagnostics).toEqual([])
    const entities = parseResult.entry.ast.statements.filter(AST.isEntityDataDeclaration)
    Expect(entities.map(entity => [entity.name, entity.singularName])).toEqual([
      ['Workspaces', 'Workspace'],
      ['Documents', 'Document'],
      ['Paragraphs', 'Paragraph'],
    ])
    const workspaceFields = entities[0]?.block.entries.filter(AST.isEntityDataField) ?? []
    Expect(workspaceFields.map(field => field.name)).toEqual(['Name', 'CreatedAt', 'Pinned', 'Documents'])
    Expect(workspaceFields[2]?.boolean).toBe(true)
    Expect(workspaceFields[2]?.negativeName).toBeUndefined()
    Expect(workspaceFields[3]?.modifiers.map(modifier => modifier.relationName ?? modifier.autoDelete))
      .toEqual(['Documents', true])
    Expect(entities[0]?.block.entries.some(AST.isDataIndex)).toBe(true)
    Expect(entities[0]?.block.entries.some(AST.isDataDefaultOrder)).toBe(true)
    const workspaceParameter = AST.parametersOf(
      parseResult.entry.ast.statements.find(AST.isViewDeclaration)!,
    )[0]
    Expect.Is(workspaceParameter, AST.isParameterDeclaration)
    Expect(Type.ofParameter(workspaceParameter).kind).toBe('entity')
    const queries = AST.streamAllContents(parseResult.entry.ast).filter(AST.isEntityQueryDeclaration)
    Expect(queries.map(query => query.name)).toEqual(['AllWorkspaces', 'Drafts'])
    Expect(Type.queryEntity(queries[0]!)?.singularName).toBe('Workspace')
    Expect(Type.queryEntity(queries[1]!)?.singularName).toBe('Document')
    const booleanWhere = AST.streamAllContents(queries[1]!).find(AST.isBooleanWhereClause)
    Expect.Is(booleanWhere, AST.isBooleanWhereClause)
    Expect(booleanWhere.case.ref?.name).toBe('Final')
    const loop = AST.streamAllContents(parseResult.entry.ast).find(AST.isForStatement)
    Expect.Is(loop, AST.isForStatement)
    Expect(loop.name).toBe('Draft')
    Expect(Type.ofValueDeclaration(loop).kind).toBe('entity')
  })

  Test('parses configured apps, ui declarations, and contextual presentation', async () => {
    const parseResult = await testParseCode(`
      public nav StackNav {
        Initial ui
        implement inject nav \`\`\`ts return TR.NavKind.Stack() \`\`\`
      }
      public datasource Local {
        StorageKey text
        implement inject provider \`\`\`ts return TR.DataProvider.Local() \`\`\`
      }
      app Notes {
        Name "Notes"
        Navigator StackNav {
          Initial Home
        }
        Datasource Local {
          StorageKey "NotesData"
        }
      }
      ui Home {
        action Open { present Detail() as overlay }
        action Toast { present Detail() as toast (Key: "saved", Duration: 3) }
        action Activate { present Notes@home }
        render inject \`\`\`ts return null \`\`\`
      }
      ui Detail {
        action Close { dismiss }
        render inject \`\`\`ts return null \`\`\`
      }
    `)
    const app = parseResult.entry.ast.statements.find(AST.isAppDeclaration)
    const home = parseResult.entry.ast.statements.find(statement =>
      AST.isUiDeclaration(statement) && statement.name === 'Home'
    )
    Expect.Is(app, AST.isAppDeclaration)
    Expect.Is(home, AST.isUiDeclaration)
    Expect(AST.blockStatements(app).some(AST.isAppNavigator)).toBe(true)
    const presentations = AST.streamAllContents(home).filter(AST.isContextualPresentStatement)
    const [overlay, toast] = presentations
    Expect.Is(overlay, AST.isContextualPresentStatement)
    Expect(overlay.mode?.kind).toBe('overlay')
    Expect.Is(toast, AST.isContextualPresentStatement)
    Expect(toast.mode?.kind).toBe('toast')
    Expect.Is(toast.mode?.toast?.key, AST.isStringLiteral)
    Expect(toast.mode.toast.key.value).toBe('saved')
    Expect.Is(toast.mode.toast.duration, AST.isNumberLiteral)
    Expect(toast.mode.toast.duration.value).toBe(3)
    const activation = AST.streamAllContents(home).find(AST.isSelectionActivateStatement)
    Expect.Is(activation, AST.isSelectionActivateStatement)
    Expect(activation.app.ref).toBe(app)
    Expect(activation.key).toBe('@home')
  })

  Test('parses arbitrary declaration-owned nav and datasource contracts by identity', async () => {
    const parseResult = await testParseCode(`
      public nav CustomNav {
        Initial key
        Display text
        @key {
          Label text
          Content ui
        }
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
      ui Home { }
      let Main = CustomNav {
        Initial @home
        Display "tabs"
        @home {
          Label "Home"
          Content Home
        }
      }
      let Store = CustomData {
        StorageKey "main"
      }
    `)

    Expect(parseResult.diagnostics).toEqual([])
    const [nav, datasource, home, main, store] = parseResult.entry.ast.statements
    Expect.Is(nav, AST.isNavDeclaration)
    Expect.Is(datasource, AST.isDatasourceDeclaration)
    Expect.Is(home, AST.isUiDeclaration)
    Expect.Is(main, AST.isAliasDeclaration)
    Expect.Is(store, AST.isAliasDeclaration)
    Expect(nav.visibility).toBe('public')
    Expect(datasource.visibility).toBe('public')
    Expect(nav.block.entries.map(entry => entry.$type)).toEqual([
      AST.ConfigurationPropertyDeclaration.$type,
      AST.ConfigurationPropertyDeclaration.$type,
      AST.ConfigurationKeyDeclaration.$type,
      AST.ConfigurationImplementation.$type,
    ])
    const [initial, display, keyed, navImplementation] = nav.block.entries
    Expect.Is(initial, AST.isConfigurationPropertyDeclaration)
    Expect.Is(display, AST.isConfigurationPropertyDeclaration)
    Expect.Is(keyed, AST.isConfigurationKeyDeclaration)
    Expect.Is(navImplementation, AST.isConfigurationImplementation)
    Expect(initial.name).toBe('Initial')
    Expect.Is(initial.type, AST.isNamedTypeReference)
    Expect(initial.type.root).toBe('key')
    Expect(display.name).toBe('Display')
    Expect.Is(display.type, AST.isPrimitiveTypeReference)
    Expect(display.type.primitive).toBe('text')
    Expect(keyed.name).toBe('@key')
    Expect(keyed.block.properties.map(property => property.name)).toEqual(['Label', 'Content'])
    Expect(navImplementation.protocol).toBe('nav')
    Expect(navImplementation.tsCodeBlock).toContain('TR.NavKind.Stack()')
    const [storageKey, providerImplementation] = datasource.block.entries
    Expect.Is(storageKey, AST.isConfigurationPropertyDeclaration)
    Expect.Is(providerImplementation, AST.isConfigurationImplementation)
    Expect(storageKey.name).toBe('StorageKey')
    Expect(providerImplementation.protocol).toBe('provider')
    Expect(providerImplementation.tsCodeBlock).toContain('TR.DataProvider.Local()')

    Expect.Is(main.value, AST.isConfigurationConstructor)
    Expect.Is(store.value, AST.isConfigurationConstructor)
    Expect(main.value.type.ref).toBe(nav)
    Expect(store.value.type.ref).toBe(datasource)
    const initialValue = main.value.block?.entries.find(entry => entry.name === 'Initial')?.value
    Expect.Is(initialValue, AST.isConfigurationKeyValue)
    Expect(initialValue.key).toBe('@home')
    const keyedEntry = main.value.block?.entries.find(entry => entry.key === '@home')
    Expect.Is(keyedEntry, AST.isConfigurationEntry)
    Expect(keyedEntry.block?.entries.map(entry => entry.name)).toEqual(['Label', 'Content'])
  })

  Test('parses labeled, unlabeled, nested, and comma-separated declaration constructor entries', async () => {
    const parseResult = await testParseCode(`
      type PromptTags is list
      type PromptCard is {
        Label is text
      }
      type WritingPrompt is {
        Title is text
        Minutes is number
        PromptTags
        Card is PromptCard
      }
      let StarterTags = PromptTags ["daily", "warmup"]
      let StarterPrompt = WritingPrompt {
        Title: "Morning pages",
        Minutes: 10
        StarterTags,
        Card {
          Label "Nested"
        }
      }
    `)

    Expect(parseResult.diagnostics).toEqual([])
    const starterTags = parseResult.entry.ast.statements.find(
      statement => AST.isAliasDeclaration(statement) && statement.name === 'StarterTags',
    )
    const starterPrompt = parseResult.entry.ast.statements.find(
      statement => AST.isAliasDeclaration(statement) && statement.name === 'StarterPrompt',
    )
    Expect.Is(starterTags, AST.isAliasDeclaration)
    Expect.Is(starterPrompt, AST.isAliasDeclaration)
    Expect.Is(starterPrompt.value, AST.isConfigurationConstructor)
    const [title, minutes, tags, card] = starterPrompt.value.block?.entries ?? []
    Expect.Is(title, AST.isConfigurationEntry)
    Expect.Is(minutes, AST.isConfigurationEntry)
    Expect.Is(tags, AST.isConfigurationEntry)
    Expect.Is(card, AST.isConfigurationEntry)
    Expect(title.label).toBe('Title')
    Expect.Is(title.expression, AST.isStringLiteral)
    Expect(minutes.label).toBe('Minutes')
    Expect.Is(minutes.expression, AST.isNumberLiteral)
    Expect(tags.reference?.ref).toBe(starterTags)
    Expect(card.name).toBe('Card')
    Expect(card.block?.entries[0]?.name).toBe('Label')
    Expect.Is(card.block?.entries[0]?.value, AST.isStringLiteral)
  })

  Test('parses dialogue asks and explicit or absent responses as occurrence-owned action statements', async () => {
    const parseResult = await testParseSyntax(`
      enum ConfirmResult {
        Confirmed
      }
      view Editor {
        action Close {
          let Result = ask ConfirmClose("Draft")
          if Result is Confirmed { dismiss }
        }
        render inject \`\`\`ts return null \`\`\`
      }
      dialogue ConfirmClose Title is text responds ConfirmResult {
        action Confirm { respond Confirmed }
        action Cancel { respond }
        render inject \`\`\`ts return null \`\`\`
      }
    `)

    const dialogue = parseResult.entry.ast.statements.find(AST.isDialogueDeclaration)
    const ask = AST.streamAllContents(parseResult.entry.ast).find(AST.isAskStatement)
    const responses = AST.streamAllContents(parseResult.entry.ast).filter(AST.isRespondStatement)
    Expect.Is(dialogue, AST.isDialogueDeclaration)
    Expect.Is(ask, AST.isAskStatement)
    Expect(dialogue.response.ref?.name).toBe('ConfirmResult')
    Expect(ask.name).toBe('Result')
    Expect(ask.dialogue.ref).toBe(dialogue)
    Expect(AST.argumentsOf(ask)).toHaveLength(1)
    Expect(responses).toHaveLength(2)
    Expect(responses[0]?.case?.ref?.name).toBe('Confirmed')
    Expect(responses[1]?.case).toBeUndefined()
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
