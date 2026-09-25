import { ASTUtils, Type } from '@ast-utils'
import { AST } from '@parser'
import { Describe, Expect, Test } from '@shared/test'
import { testParseCode, testParseSyntax } from './test-parse'

Describe('parser: core language syntax', () => {
  Test('parses app declarations with ordinary visibility markers', async () => {
    const parseResult = await testParseCode(`
      file app Private { }
      folder app Sibling { }
      package app PackageApp { }
      workspace app WorkspaceApp { }
      public app PublicApp { }
    `)

    Expect(parseResult.diagnostics).toEqual([])
    Expect(parseResult.entry.ast.statements.filter(AST.isAppDeclaration).map(app => app.visibility)).toEqual([
      'file',
      'folder',
      'package',
      'workspace',
      'public',
    ])
  })

  Test('links live app state and actions into a bound configured root view', async () => {
    const result = await testParseCode(`
      public type StackNav is nav with {
        Initial view
        nav StackNavImpl from ./StackNavImpl.ts
      }
      app BoundApp {
        Name "Bound"
        state Expanded is list of text = [] (persist)
        action ChangeExpanded(Value list of text) { set Expanded = Value }
        Navigator StackNav {
          Initial Root(Expanded: Expanded, ChangeExpanded: ChangeExpanded)
        }
      }
      scene Root(Expanded list of text, ChangeExpanded action(list of text)) {
        Title "Root"
        render Empty()
      }
      view Empty() { render Empty() }
    `)

    Expect(result.diagnostics).toEqual([])
    const binding = result.entry.ast.statements
      .flatMap(statement => AST.streamAllContents(statement))
      .find(AST.isViewBinding)
    Expect.Is(binding, AST.isViewBinding)
    Expect(binding.view.ref?.name).toBe('Root')
    const [stateArgument, actionArgument] = binding.argumentList?.arguments ?? []
    Expect.Is(stateArgument?.value, AST.isValueReference)
    Expect.Is(actionArgument?.value, AST.isValueReference)
    Expect.Is(stateArgument.value.target.ref, AST.isStateDeclaration)
    Expect.Is(actionArgument.value.target.ref, AST.isActionDeclaration)
    Expect(stateArgument.value.target.ref.name).toBe('Expanded')
    Expect(actionArgument.value.target.ref.name).toBe('ChangeExpanded')
  })

  Test('parses namespace imports and pass-through view aliases', async () => {
    // The namespace targets are unresolved in a standalone parse; only the syntax is under test.
    const result = await testParseSyntax(`
      use package @widgets
      use package @tao/nav as navs
      public view Button = widgets.Button
    `)
    const [derived, renamed] = result.entry.ast.statements.filter(AST.isUsePackageStatement)
    Expect.Is(derived, AST.isUsePackageStatement)
    Expect(derived.importPath).toBe('@widgets')
    Expect(derived.name).toBeUndefined()
    Expect(AST.packageNamespaceName(derived)).toBe('widgets')
    Expect.Is(renamed, AST.isUsePackageStatement)
    Expect(renamed.name).toBe('navs')
    Expect(AST.packageNamespaceName(renamed)).toBe('navs')
    const alias = result.entry.ast.statements.find(AST.isViewDeclaration)
    Expect.Is(alias, AST.isViewDeclaration)
    Expect(alias.parameterList).toBeUndefined()
    Expect.Is(alias.aliasTarget, AST.isPackageMemberReference)
    Expect(alias.aliasTarget.namespace.$refText).toBe('widgets')
    Expect(alias.aliasTarget.member.$refText).toBe('Button')
  })

  Test('parses content-accepting view declarations and child view invocations', async () => {
    const parseResult = await testParseCode(`
      folder
      app MyApp { view MainView }
      view MainView() {
        render Stack(){
          let Local = "Inside"
          Text(Local) { }
          Text("Literal")
        }
      }
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
    `)
    const stack = parseResult.entry.ast.statements.find(statement =>
      AST.isViewDeclaration(statement) && statement.name === 'Stack'
    )
    Expect.Is(stack, AST.isViewDeclaration)
    Expect(AST.viewPlacesCallerContent(stack)).toBe(true)
    const app = parseResult.entry.ast.statements.find(AST.isAppDeclaration)
    Expect.Is(app, AST.isAppDeclaration)
    Expect(app.visibility).toBe('folder')
    const mainView = parseResult.entry.ast.statements.find(statement =>
      AST.isViewDeclaration(statement) && statement.name === 'MainView'
    )
    Expect.Is(mainView, AST.isViewDeclaration)
    const render = AST.blockStatementOf(mainView, 0)
    Expect.Is(render, AST.isRenderStatement)
    const [_localAlias, firstChild, secondChild] = AST.statementsOf(render.block)
    Expect.Is(firstChild, AST.isViewRender)
    Expect.Is(secondChild, AST.isViewRender)
    Expect(firstChild.view.$refText).toBe('Text')
    Expect(secondChild.view.$refText).toBe('Text')
  })

  Test('parses named and inline control events with a scoped change payload', async () => {
    const parseResult = await testParseCode(`
      app EventsApp { view MainView }
      view MainView() {
        state Draft = ""
        action Submit() { }
        render Input(Value: Draft) {
          on change -> Entered { set Draft = Entered }
          on submit Submit
        }
      }
      view Input(Value text, Change action(text), Submit action()) {
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
      view MainView() {
        render Col()[claim 2, content top spread-inset, gap 12, pad 16, margin horizontal 4, width fill] {
          Text("Label") [width fill, height fill, aligned center, centered]
        }
      }
      view Col() {
        render inject Content @@content \`\`\`ts
          return Content
        \`\`\`
      }
      view Text(Value text) {
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
      ['aligned', 'center'],
      ['centered'],
    ])
  })

  Test('parses empty brackets after a render target as an empty layout clause', async () => {
    const parseResult = await testParseCode(`
      app MyApp { view MainView }
      view MainView() {
        render Col()[]
      }
      view Col() {
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

      view Text(Value text) { }
      view StatTile(Label text, Count number) { }
      view MainView(Label text) {
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

    const [localAlias, textRender, statRender] = mainView.block!.statements
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

      view Button(Title text, Action action) { }

      view MainView() {
        state Count = 0

        action AddStep(Step number) {
          set Count += Step
        }

        action AddFive() {
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

    const [countState, addStep, addFive, resetRender, inlineRender] = mainView.block!.statements
    Expect.Is(countState, AST.isStateDeclaration)
    Expect.Is(addStep, AST.isActionDeclaration)
    Expect.Is(addFive, AST.isActionDeclaration)
    Expect.Is(resetRender, AST.isRenderStatement)
    Expect.Is(inlineRender, AST.isRenderStatement)

    const [setStep] = addStep.block!.statements
    Expect.Is(setStep, AST.isSetStatement)
    Expect(setStep.target.ref).toBe(countState)
    Expect(setStep.operator).toBe('+=')
    Expect.Is(setStep.value, AST.isValueReference)
    Expect(setStep.value.target.ref).toBe(AST.parametersOf(addStep)[0])

    const [doAddStep] = addFive.block!.statements
    Expect.Is(doAddStep, AST.isDoStatement)
    Expect.Is(doAddStep.action, AST.isValueReference)
    Expect(doAddStep.action.target.ref).toBe(addStep)
    Expect.Is(AST.argumentsOf(doAddStep)[0]?.value, AST.isNumberLiteral)

    Expect.Is(AST.argumentsOf(resetRender)[1]?.value, AST.isActionExpression)
    Expect.Is(AST.argumentsOf(inlineRender)[1]?.value, AST.isActionExpression)
  })

  Test('parses explicit positional action callback signatures', async () => {
    const parseResult = await testParseCode(`
      view Field(Change action(text), Submit action()) { }
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
      view MainView() {
        render inject \`\`\`ts
          return null
        \`\`\`
      }

      test "Smoke" {
        test "renders text" {
          run MyApp

          expect text "Hello"
          press "Add"
          enter "Draft" into label "Title"
          submit placeholder "Title"
          expect missing text "Loading"
          expect input placeholder "Title" value "Draft"
          back
          relaunch
          relaunch fresh
        }
      }
    `)

    const test = parseResult.entry.ast.statements.find(AST.isTestDeclaration)
    Expect.Is(test, AST.isTestDeclaration)
    Expect(test.name).toBe('Smoke')
    const [check] = test.block.statements
    Expect.Is(check, AST.isTestDeclaration)
    Expect(check.name).toBe('renders text')
    const [
      run,
      expectedText,
      pressText,
      enterText,
      submitInput,
      missingText,
      inputValue,
      back,
      relaunch,
      freshRelaunch,
    ] = check.block.statements
    Expect.Is(run, AST.isRunStep)
    Expect(run.app.ref?.name).toBe('MyApp')
    Expect.Is(expectedText, AST.isExpectTextStep)
    Expect(expectedText.selector).toBe('text')
    Expect(expectedText.text).toBe('Hello')
    Expect(expectedText.missing).toBe(false)
    Expect.Is(pressText, AST.isPressTextStep)
    Expect(pressText.selector).toBeUndefined()
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
    Expect.Is(relaunch, AST.isRelaunchStep)
    Expect(relaunch.fresh).toBe(false)
    Expect.Is(freshRelaunch, AST.isRelaunchStep)
    Expect(freshRelaunch.fresh).toBe(true)
  })

  Test(
    'parses tagged renders, tagged loops, scoped selection, grouped expectations, and bare data status',
    async () => {
      const parseResult = await testParseCode(`
      app TaggedApp { view MainView }
      view MainView() {
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
      view Col() { render inject Content @@content \`\`\`ts return Content \`\`\` }
      view Input() { render inject \`\`\`ts return null \`\`\` }
      view Button() { render inject \`\`\`ts return null \`\`\` }
      view Text(Value text) { render inject \`\`\`ts return null \`\`\` }

      test "Tagged interactions" {
        test "uses structured selectors" {
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
      Expect(AST.testTagForRender(AST.loopRowRoot(loop)!)).toBe('rows')

      const check = AST.streamAllContents(parseResult.entry.ast)
        .filter(AST.isTestDeclaration)
        .find(candidate => candidate.block.statements.some(AST.isSelectStep))
      Expect.Is(check, AST.isTestDeclaration)
      Expect(check.block.statements.some(AST.isExpectGroupStep)).toBe(true)
      Expect(check.block.statements.some(AST.isExpectScopeStep)).toBe(true)
      const select = check.block.statements.find(AST.isSelectStep)
      Expect.Is(select, AST.isSelectStep)
      Expect(select.tag).toBe('#rows')
      Expect(select.index).toBe(2)
      Expect(select.block.statements.some(AST.isTagPressStep)).toBe(true)
    },
  )

  Test('parses named invocation arguments', async () => {
    const parseResult = await testParseCode(`
      view Field(Value text, Change action, Disabled boolean) { }
      view MainView(Draft text, ChangeDraft action) {
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
        Documents (owned)
        index CreatedAt
        order by CreatedAt desc
      }
      data Documents / Document {
        Title text
        Final yes / Draft no
        Public yes / Private no (default Public)
        Workspace
        Paragraphs (owned)
      }
      data Paragraphs / Paragraph {
        Text text
        Ordering number
        Document
        order by Ordering
      }
      view Detail(Workspace) {
        action Add() { create Document { Title: "Draft", Workspace } }
        render inject \`\`\`ts return null \`\`\`
      }
      view Queries(Workspace) {
        query Workspaces as AllWorkspaces { }
        render Col() {
          query Drafts from Workspace.Documents { where is Draft }
          loop Drafts / Draft { Text(Draft.Title) }
        }
      }
      view Col() { render inject Content @@content \`\`\`ts return Content \`\`\` }
      view Text(Value text) { render inject \`\`\`ts return null \`\`\` }
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
    Expect((workspaceFields[3]?.traits?.traits ?? []).some(trait => trait.owned)).toBe(true)
    Expect(
      entities[0]?.block.entries.filter(AST.isDataIndex).map(index => index.fieldName),
    ).toEqual(['CreatedAt'])
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

  Test('parses local only and keeps a module query only as a diagnostic-recovery statement', async () => {
    const parseResult = await testParseSyntax(`
      data Notes / Note {
        Title text

        order by Title
      }
      data FocusSessions / FocusSession {
        Label text

        index Label
        local only
      }
      query FocusSessions as CurrentSession {
        limit 1
      }
      view Board() {
        query Notes { }
        render Text(Notes.Count)
      }
      view Text(Value number) { render inject \`\`\`ts return null \`\`\` }
    `)

    Expect(parseResult.diagnostics).toEqual([])
    const entities = parseResult.entry.ast.statements.filter(AST.isEntityDataDeclaration)
    Expect(entities.map(entity => entity.block.entries.some(AST.isDataLocalOnly))).toEqual([false, true])
    const moduleQuery = parseResult.entry.ast.statements.find(AST.isEntityQueryDeclaration)
    Expect.Is(moduleQuery, AST.isEntityQueryDeclaration)
    Expect(moduleQuery.name).toBe('CurrentSession')
    Expect(Type.queryEntity(moduleQuery)?.singularName).toBe('FocusSession')
    Expect(AST.isDeclaration(moduleQuery)).toBe(false)
    Expect(AST.isTopLevelStatement(moduleQuery)).toBe(false)
    Expect(AST.isExportableDeclaration(moduleQuery)).toBe(false)
    Expect(AST.isEmittingRuntimeBinding(moduleQuery)).toBe(false)
    Expect(AST.isImportableValueDeclaration(moduleQuery)).toBe(false)
  })

  Test('parses a query search clause alongside its entity (search) fields', async () => {
    const parseResult = await testParseCode(`
      data Documents / Document {
        Title text (search, title)
        Body text (default "", search)
      }
      view Board() {
        state Find = ""
        query Documents as Found {
          search Find
          order by Title
        }
        render Text(Found.Count)
      }
      view Text(Value number) { render inject \`\`\`ts return null \`\`\` }
    `)

    Expect(parseResult.diagnostics).toEqual([])
    const query = AST.streamAllContents(parseResult.entry.ast).find(AST.isEntityQueryDeclaration)
    Expect.Is(query, AST.isEntityQueryDeclaration)
    const search = query.block?.clauses.find(AST.isSearchClause)
    Expect.Is(search, AST.isSearchClause)
    Expect.Is(search.term, AST.isValueReference)
    Expect.Is(search.term.target.ref, AST.isStateDeclaration)
    Expect(search.term.target.ref.name).toBe('Find')
    const entity = Type.queryEntity(query)
    Expect.Is(entity, AST.isEntityDataDeclaration)
    const searchFields = Type.dataFields(entity)
      .filter(field => (field.traits?.traits ?? []).some(trait => trait.search))
    Expect(searchFields.map(field => field.name)).toEqual(['Title', 'Body'])
  })

  Test('parses configured apps, view declarations, and contextual presentation', async () => {
    const parseResult = await testParseCode(`
      public type StackNav is nav with {
        Initial view
        nav TestNavKind from ./TestNav.ts
      }
      public type Local is datasource with {
        StorageKey text
        provider TestProvider from ./TestProvider.ts
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
      view Home() {
        action Open() { present Detail() as overlay }
        action Toast() { present Detail() as toast (Key: "saved", Duration: 3.s) }
        action Activate() { present Notes@home }
        render inject \`\`\`ts return null \`\`\`
      }
      view Detail() {
        action Close() { dismiss }
        render inject \`\`\`ts return null \`\`\`
      }
    `)
    const app = parseResult.entry.ast.statements.find(AST.isAppDeclaration)
    const home = parseResult.entry.ast.statements.find(statement =>
      AST.isViewDeclaration(statement) && statement.name === 'Home'
    )
    Expect.Is(app, AST.isAppDeclaration)
    Expect.Is(home, AST.isViewDeclaration)
    Expect(AST.blockStatements(app).some(statement => AST.isAppProperty(statement) && statement.name === 'Navigator'))
      .toBe(true)
    const presentations = AST.streamAllContents(home).filter(AST.isContextualPresentStatement)
    const [overlay, toast] = presentations
    Expect.Is(overlay, AST.isContextualPresentStatement)
    Expect(overlay.mode?.kind).toBe('overlay')
    Expect.Is(toast, AST.isContextualPresentStatement)
    Expect(toast.mode?.kind).toBe('toast')
    Expect.Is(toast.mode?.toast?.key, AST.isStringLiteral)
    Expect(toast.mode.toast.key.value).toBe('saved')
    Expect.Is(toast.mode.toast.duration, AST.isPostfixMemberAccess)
    Expect(toast.mode.toast.duration.member).toBe('s')
    Expect.Is(toast.mode.toast.duration.receiver, AST.isNumberLiteral)
    Expect(toast.mode.toast.duration.receiver.value).toBe(3)
    const activation = AST.streamAllContents(home).find(AST.isSelectionActivateStatement)
    Expect.Is(activation, AST.isSelectionActivateStatement)
    Expect(activation.app?.ref).toBe(app)
    Expect(activation.key).toBe('@home')
  })

  Test('parses an app auxiliary navigator as one app statement before a following declaration', async () => {
    const parseResult = await testParseCode(`
      public type StackNav is nav with {
        Initial view
        nav TestNavKind from ./TestNav.ts
      }
      public type SlotNav is nav with {
        Initial view
        nav TestNavKind from ./TestNav.ts
      }
      app SharedGeneratedApp {
        Name "Shared"
        Navigator StackNav { Initial Home }
        @window SlotNav { Initial WindowRoot }
      }
      let AfterApp = "after"
      view Home() { }
      view WindowRoot() { }
    `)

    const app = parseResult.entry.ast.statements.find(AST.isAppDeclaration)
    Expect.Is(app, AST.isAppDeclaration)
    const statements = AST.blockStatements(app)
    Expect(statements.filter(AST.isAppProperty)).toHaveLength(2)
    const auxiliary = statements.find(AST.isAppAuxiliaryNavigator)
    Expect.Is(auxiliary, AST.isAppAuxiliaryNavigator)
    Expect(auxiliary.name).toBe('@window')
    Expect(auxiliary.value.type.ref?.name).toBe('SlotNav')
    Expect(auxiliary.value.block?.entries[0]?.name).toBe('Initial')
    Expect(statements.some(AST.isRenderSlotUse)).toBe(false)
    Expect(parseResult.entry.ast.statements.some(statement =>
      AST.isAliasDeclaration(statement)
      && statement.name === 'AfterApp'
    )).toBe(true)
  })

  Test('keeps keyword-led invalid app statements parseable for semantic diagnostics', async () => {
    const parseResult = await testParseCode(`
      app Broken {
        render inject \`\`\`ts return null \`\`\`
      }
    `)

    const app = parseResult.entry.ast.statements[0]
    Expect.Is(app, AST.isAppDeclaration)
    Expect.Is(AST.blockStatements(app)[0], AST.isRenderStatement)
  })

  Test('parses direct primitive nav and datasource value declarations', async () => {
    const parseResult = await testParseCode(`
      nav EmptyNavigation { }
      datasource EmptyDatasource { }
    `)

    const [navigation, datasource] = parseResult.entry.ast.statements
    Expect.Is(navigation, AST.isNavDeclaration)
    Expect.Is(datasource, AST.isDatasourceDeclaration)
    Expect(navigation.name).toBe('EmptyNavigation')
    Expect(datasource.name).toBe('EmptyDatasource')
    Expect(navigation.block?.entries).toEqual([])
    Expect(datasource.block?.entries).toEqual([])
  })

  Test('parses bare app slot blocks as inferred property values', async () => {
    const parseResult = await testParseCode(`
      app Notes {
        Name "Notes"
        Navigator { Initial Home }
        Datasource { StorageKey "NotesData" }
      }
      view Home() { }
    `)

    Expect(parseResult.diagnostics).toEqual([])
    const app = parseResult.entry.ast.statements.find(AST.isAppDeclaration)
    Expect.Is(app, AST.isAppDeclaration)
    const navigator = AST.blockStatements(app).find(statement =>
      AST.isAppProperty(statement) && statement.name === 'Navigator'
    )
    const datasource = AST.blockStatements(app).find(statement =>
      AST.isAppProperty(statement) && statement.name === 'Datasource'
    )
    Expect.Is(navigator, AST.isAppProperty)
    Expect.Is(datasource, AST.isAppProperty)
    Expect.Is(navigator.value, AST.isInferredConfigurationConstructor)
    Expect.Is(datasource.value, AST.isInferredConfigurationConstructor)
    Expect(navigator.value.block.entries[0]?.name).toBe('Initial')
    Expect(datasource.value.block.entries[0]?.name).toBe('StorageKey')
  })

  Test('parses arbitrary declaration-owned nav and datasource contracts by identity', async () => {
    const parseResult = await testParseCode(`
      public type CustomNav is nav with {
        Initial key
        Display text
        @key {
          Label text
          Content view
        }
        nav TestNavKind from ./TestNav.ts
      }
      public type CustomData is datasource with {
        StorageKey text
        provider CustomData from ./CustomData.ts
      }
      view Home() { }
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
    Expect.Is(nav, AST.isTypeDeclaration)
    Expect.Is(datasource, AST.isTypeDeclaration)
    Expect.Is(home, AST.isViewDeclaration)
    Expect.Is(main, AST.isAliasDeclaration)
    Expect.Is(store, AST.isAliasDeclaration)
    Expect(nav.visibility).toBe('public')
    Expect(datasource.visibility).toBe('public')
    Expect.Is(nav.type, AST.isDerivedTypeExpression)
    Expect.Is(datasource.type, AST.isDerivedTypeExpression)
    const [initial, display] = nav.type.slots.properties
    const [keyed] = nav.type.slots.keys
    const [navImplementation] = nav.type.slots.implementations
    Expect.Is(initial, AST.isTypeProperty)
    Expect.Is(display, AST.isTypeProperty)
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
    Expect(navImplementation.exportName).toBe('TestNavKind')
    const [storageKey] = datasource.type.slots.properties
    const [providerImplementation] = datasource.type.slots.implementations
    Expect.Is(storageKey, AST.isTypeProperty)
    Expect.Is(providerImplementation, AST.isConfigurationImplementation)
    Expect(storageKey.name).toBe('StorageKey')
    Expect(providerImplementation.protocol).toBe('provider')
    Expect(providerImplementation.path).toBe('./CustomData.ts')

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
      type PromptTags is list of text
      type PromptCard is {
        Label text,
      }
      type WritingPrompt is {
        Title text,
        Minutes number,
        PromptTags,
        Card PromptCard,
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

  Test('parses view asks and explicit or absent responses as occurrence-owned action statements', async () => {
    const parseResult = await testParseSyntax(`
      type ConfirmResult is one of Confirmed
      view Editor() {
        action Close() {
          let Result = ask ConfirmClose("Draft")
          if Result is Confirmed { dismiss }
        }
        render inject \`\`\`ts return null \`\`\`
      }
      view ConfirmClose(Title text) responds ConfirmResult {
        action Confirm() { respond Confirmed }
        action Cancel() { respond }
        render inject \`\`\`ts return null \`\`\`
      }
    `)

    const confirmClose = parseResult.entry.ast.statements.find(statement =>
      AST.isViewDeclaration(statement) && statement.name === 'ConfirmClose'
    )
    const ask = AST.streamAllContents(parseResult.entry.ast).find(AST.isAskStatement)
    const responses = AST.streamAllContents(parseResult.entry.ast).filter(AST.isRespondStatement)
    Expect.Is(confirmClose, AST.isViewDeclaration)
    Expect.Is(ask, AST.isAskStatement)
    Expect(confirmClose.response?.ref?.name).toBe('ConfirmResult')
    Expect(ask.name).toBe('Result')
    Expect(ask.view.ref).toBe(confirmClose)
    Expect(AST.argumentsOf(ask)).toHaveLength(1)
    Expect(responses).toHaveLength(2)
    Expect(responses[0]?.case?.ref?.name).toBe('Confirmed')
    Expect(responses[1]?.case).toBeUndefined()
  })

  Test('parses typed app-level persisted state and a direct configuration binding', async () => {
    const result = await testParseSyntax(`
      app Workspace {
        state PaneWidth is number = 320 (persist)
        Navigator SplitNav { @pane { Content Pane Width PaneWidth Resizable true } }
      }
    `)
    const app = result.entry.ast.statements.find(AST.isAppDeclaration)
    Expect.Is(app, AST.isAppDeclaration)
    const state = app.block?.statements.find(AST.isStateDeclaration)
    Expect.Is(state, AST.isStateDeclaration)
    Expect(state.name).toBe('PaneWidth')
    Expect(state.persist).toBe(true)
    Expect.Is(state.type, AST.isPrimitiveTypeReference)
    Expect(state.type.primitive).toBe('number')
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
