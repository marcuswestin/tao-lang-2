import { RuntimeTesting } from '@expo-host/testing/runtime-testing'
import { FS, HCI, Platform, Time } from '@shared'
import { AfterEach, Describe, Expect, mkTestDir, Test, withTaoFiles } from '@shared/test'
import { registerRuntimeE2ELifecycle, testCompileApp } from './test-compile-app'

registerRuntimeE2ELifecycle()

Describe('Expo runtime', () => {
  let journeyProgress: { completed: boolean; phase: string; started: number } | undefined

  // An outer Jest timeout does not reject the test's awaited promise, so report from teardown
  // and detach this progress object before a late continuation or the next test can run.
  AfterEach(() => {
    const progress = journeyProgress
    journeyProgress = undefined
    if (progress !== undefined && !progress.completed) {
      HCI.logProcessError(
        'journey-observation',
        `Unfinished during ${progress.phase} after ${Math.round(Time.nowMs() - progress.started)}ms.`,
      )
    }
  })

  Test('records only render occurrences mounted by one executed Tao journey', async () => {
    const progress = { completed: false, phase: 'fixture creation', started: Time.nowMs() }
    journeyProgress = progress
    await withTaoFiles(
      'tao-runtime-journey-observations-',
      {
        'Main.test.tao': `
          use RenderApp from ./
          test "Render observations" {
            test "mounts the greeting" {
              run RenderApp
              expect text "Hello from a journey"
            }
          }
        `,
        'Main.tao': `
          use Text from @tao/ui
          app RenderApp { id "renderapp" version "1.0.0" name "RenderApp" view Main }
          view Main() { render Text("Hello from a journey") }
        `,
      },
      async paths => {
        progress.phase = 'observation directory creation'
        const directory = await mkTestDir('tao-journey-observations-')
        const previous = Platform.runtimeProcess.env[RuntimeTesting.JourneyObservations.ENV]
        Platform.runtimeProcess.env[RuntimeTesting.JourneyObservations.ENV] = directory
        try {
          progress.phase = 'compile response'
          const file = await RuntimeTesting.TestCompiler.Worker.compileTestPlan(paths['Main.test.tao']!)
          progress.phase = 'compiled check assertions'
          const check = file.suites[0]?.checks[0]
          Expect(check).toBeDefined()
          progress.phase = 'journey execution'
          const observation = await RuntimeTesting.runTestCheck('Render observations', check!)
          progress.phase = 'render observation assertions'

          Expect(observation.status).toBe('passed')
          Expect(observation.renders).toHaveLength(1)
          const render = observation.renders[0]
          Expect(render?.renderId).toContain(`${paths['Main.tao']}:`)
          Expect(render?.sourcePath).toBe(paths['Main.tao'])
          Expect(render?.sourceVersion).toMatch(/^text-v1:/)
          progress.phase = 'artifact read'
          const artifact = await RuntimeTesting.JourneyObservations.read(directory)
          progress.phase = 'artifact assertions'
          Expect(artifact.format).toBe('tao-journey-observations')
          Expect(artifact.version).toBe(1)
          Expect(artifact.checks).toHaveLength(1)
          Expect(artifact.checks[0]?.renders).toEqual(observation.renders)
          progress.phase = 'observation directory cleanup'
        } finally {
          if (previous === undefined) {
            delete Platform.runtimeProcess.env[RuntimeTesting.JourneyObservations.ENV]
          } else {
            Platform.runtimeProcess.env[RuntimeTesting.JourneyObservations.ENV] = previous
          }
          await FS.remove(directory)
        }
        progress.phase = 'fixture cleanup'
      },
    )
    progress.completed = true
  })

  Test('runs keyboard attention steps directly through the reducer', async () => {
    await withTaoFiles(
      'tao-runtime-attention-test-plan-',
      {
        'Main.test.tao': `
          use AttentionApp from ./
          test "Attention" {
            test "targets and opens verbs" {
              run AttentionApp
              narrow "draft"
              expect focus region "Home"
              expect target "Draft document"
              press key "."
              expect verbs "Save"
            }
          }
        `,
        'Main.tao': `
          use StackNav from @tao/nav
          use Col, FormButton from @tao/ui
          app AttentionApp { id "attentionapp" version "1.0.0" name "Attention" Navigator StackNav { Initial Home } }
          scene Home() {
            Title "Home"
            action DoNothing() { }
            command Save() { Title "Save" do DoNothing() }
            Commands { Save }
            render Col() {
              FormButton("Draft document") { on press DoNothing }
            }
          }
        `,
      },
      async paths => {
        await RuntimeTesting.runTaoTestPlan(paths['Main.test.tao']!)
      },
    )
  })

  Test('reports exact keyboard attention assertion failures', async () => {
    await withTaoFiles(
      'tao-runtime-attention-errors-',
      {
        'Focus.test.tao': `
          use AttentionApp from ./Main
          test "Attention" { test "focus mismatch" {
            run AttentionApp
            expect focus region "Elsewhere"
          } }
        `,
        'Main.tao': `
          use StackNav from @tao/nav
          use Col, FormButton from @tao/ui
          app AttentionApp { id "attentionapp" version "1.0.0" name "Attention" Navigator StackNav { Initial Home } }
          scene Home() {
            Title "Home"
            action DoNothing() { }
            command Save() { Title "Save" do DoNothing() }
            Commands { Save }
            render Col() { FormButton("Draft document") { on press DoNothing } }
          }
        `,
        'Target.test.tao': `
          use AttentionApp from ./Main
          test "Attention" { test "target mismatch" {
            run AttentionApp
            narrow "draft"
            expect target "Other document"
          } }
        `,
        'Verbs.test.tao': `
          use AttentionApp from ./Main
          test "Attention" { test "verbs mismatch" {
            run AttentionApp
            narrow "draft"
            press key "."
            expect verbs "Archive"
          } }
        `,
      },
      async paths => {
        await Expect(RuntimeTesting.runTaoTestPlan(paths['Focus.test.tao']!)).rejects.toThrow(
          /expect focus region "Elsewhere" expected interaction focus region "Elsewhere", got "Home"/,
        )
        await Expect(RuntimeTesting.runTaoTestPlan(paths['Target.test.tao']!)).rejects.toThrow(
          /expect target "Other document" expected interaction target "Other document", got "Draft document"/,
        )
        await Expect(RuntimeTesting.runTaoTestPlan(paths['Verbs.test.tao']!)).rejects.toThrow(
          /expect verbs "Archive" expected interaction verbs \["Archive"\], got \["Save"\]/,
        )
      },
    )
  })

  Test('runs Tao text expectations with duplicate rendered text', async () => {
    await withTaoFiles(
      'tao-runtime-test-plan-',
      {
        'Main.test.tao': `
        use DuplicateTextApp from ./

        test "Duplicate text" {
          test "matches at least one text node" {
            run DuplicateTextApp
            expect text "Repeated"
          }
        }
      `,
        'Main.tao': `
        app DuplicateTextApp { id "duplicatetextapp" version "1.0.0" name "DuplicateTextApp" view MainView }
        view MainView() {
          render Stack(){
            Text("Repeated")
            Text("Repeated")
          }
        }
        view Stack() {
          render inject Content @@content, Layout @@layout, Tag @@tag \`\`\`ts
            return TR.Views.View({ children: Content, layout: Layout, tag: Tag })
          \`\`\`
        }
        view Text(Value text) {
          render inject Value \`\`\`ts
            return <RN.Text>{Value}</RN.Text>
          \`\`\`
        }
      `,
      },
      async paths => {
        await RuntimeTesting.runTaoTestPlan(paths['Main.test.tao']!)
      },
    )
  })

  Test('delivers press phases, hover, and focus without collapsing them into a press', async () => {
    await withTaoFiles(
      'tao-runtime-pointer-phase-test-plan-',
      {
        'Main.test.tao': `
        use PointerPhaseApp from ./

        test "Pointer phases" {
          test "delivers each phase" {
            run PointerPhaseApp
            expect text "idle"
            press down #target
            expect text "down"
            advance 600.ms
            expect text "down"
            press up #target
            expect text "up"
            hover #target
            expect text "hover"
            focus #target
            expect text "focus"
            press #target
            expect text "pressed"
          }
        }
      `,
        'Main.tao': `
        app PointerPhaseApp { id "pointerphaseapp" version "1.0.0" name "PointerPhaseApp" view MainView }
        view MainView() {
          state Phase = "idle"
          action SetPhase(Value text) { set Phase = Value }
          render Stack() {
            #target
            PointerTarget(SetPhase)
            Text(Phase)
          }
        }
        view Stack() {
          render inject Content @@content, Layout @@layout, Tag @@tag \`\`\`ts
            return TR.Views.View({ children: Content, layout: Layout, tag: Tag })
          \`\`\`
        }
        view PointerTarget(Change action(text)) {
          render inject Change, Layout @@layout, Tag @@tag \`\`\`ts
            return (
              <RN.Pressable
                {...TR.VisualNativeProps(Layout, Tag)}
                onFocus={() => Change.invoke(TR.Value("focus"))}
                onHoverIn={() => Change.invoke(TR.Value("hover"))}
                onPress={() => Change.invoke(TR.Value("pressed"))}
                onPressIn={() => Change.invoke(TR.Value("down"))}
                onPressOut={() => Change.invoke(TR.Value("up"))}
              >
                <RN.Text>Target</RN.Text>
              </RN.Pressable>
            )
          \`\`\`
        }
        view Text(Value text) {
          render inject Value \`\`\`ts
            return <RN.Text>{Value}</RN.Text>
          \`\`\`
        }
      `,
      },
      async paths => {
        await RuntimeTesting.runTaoTestPlan(paths['Main.test.tao']!)
      },
    )
  })

  Test('waits for guard fallthrough before running the next Tao test step', async () => {
    await withTaoFiles(
      'tao-runtime-async-action-test-plan-',
      {
        'Main.test.tao': `
        use AsyncActionApp from ./

        test "Async action" {
          test "observes state after guard fallthrough" {
            run AsyncActionApp
            expect text "0"
            press text "Advance"
            expect text "1"
          }
        }
      `,
        'Main.tao': `
        app AsyncActionApp { id "asyncactionapp" version "1.0.0" name "AsyncActionApp" view MainView }
        view MainView() {
          state Ready = false
          state Count = 0
          action Advance() {
            guard Ready true -> {
              set Count = 10
            }
            set Count = 1
          }
          render Stack(){
            NativeButton("Advance", Advance)
            Number(Count)
          }
        }
        view Stack() {
          render inject Content @@content, Layout @@layout, Tag @@tag \`\`\`ts
            return TR.Views.View({ children: Content, layout: Layout, tag: Tag })
          \`\`\`
        }
        view NativeButton(Title text, Action action()) {
          render inject Title, Action \`\`\`ts
            return (
              <RN.Pressable accessibilityRole="button" onPress={() => Action.invoke()}>
                <RN.Text>{Title}</RN.Text>
              </RN.Pressable>
            )
          \`\`\`
        }
        view Number(Value number) {
          render inject Value \`\`\`ts
            return <RN.Text>{Value}</RN.Text>
          \`\`\`
        }
      `,
      },
      async paths => {
        await RuntimeTesting.runTaoTestPlan(paths['Main.test.tao']!)
      },
    )
  })

  Test('lets Tao test steps answer an action suspended by ask', async () => {
    await withTaoFiles(
      'tao-runtime-ask-test-plan-',
      {
        'Main.test.tao': `
        use AskTestApp from ./

        test "Ask" {
          test "answers a suspended ask" {
            run AskTestApp
            press text "Ask"
            expect text "Question"
            press text "Confirm"
            expect text "Confirmed"
          }
        }
      `,
        'Main.tao': `
        use StackNav from @tao/nav
        use Button, Col, Text from @tao/ui

        type ConfirmResult is one of Confirmed

        app AskTestApp { id "asktestapp" version "1.0.0" name "Ask test"
          Navigator StackNav { Initial Home }
        }

        scene Home() {
          Title "Home"
          state Status = "Ready"
          action AskForConfirmation() {
            let Result = ask Confirm()
            if Result is Confirmed { set Status = "Confirmed" }
          }
          render Col() {
            Text(Status)
            Button("Ask") { on press AskForConfirmation }
          }
        }

        view Confirm() responds ConfirmResult {
          action ConfirmIt() { respond Confirmed }
          render Col() {
            Text("Question")
            Button("Confirm") { on press ConfirmIt }
          }
        }
      `,
      },
      async paths => {
        await RuntimeTesting.runTaoTestPlan(paths['Main.test.tao']!)
      },
    )
  })

  Test('reports selector-neutral Tao press failures', async () => {
    await withTaoFiles(
      'tao-runtime-press-failure-test-plan-',
      {
        'Main.test.tao': `
        use MissingPressApp from ./

        test "Press failure" {
          test "reports the selector" {
            run MissingPressApp
            press text "Missing button"
          }
        }
      `,
        'Main.tao': `
        app MissingPressApp { id "missingpressapp" version "1.0.0" name "MissingPressApp" view MainView }

        view MainView() {
          render Text("Ready")
        }

        view Text(Value text) {
          render inject Value \`\`\`ts
            return <RN.Text>{Value}</RN.Text>
          \`\`\`
        }
      `,
      },
      async paths => {
        await Expect(RuntimeTesting.runTaoTestPlan(paths['Main.test.tao']!)).rejects.toThrow(
          /press text "Missing button" expected one pressable but found 0 matches/,
        )
      },
    )
  })

  Test('rejects a tag without a row index when it matches more than one element', async () => {
    await withTaoFiles(
      'tao-runtime-ambiguous-tag-',
      {
        'Main.test.tao': `
          use RepeatedTagApp from ./

          test "Repeated tag" {
            test "presses a tag every row repeats" {
              run RepeatedTagApp
              press #item
            }
          }
        `,
        'Main.tao': `
          use Col, Text from @tao/ui

          let Items = ["One", "Two"]

          app RepeatedTagApp { id "test.repeated-tags" version "1.0.0" name "Repeated tags" view Main }

          view Main() {
            render Col() {
              #rows
              loop Items / Item {
                Col() {
                  #item
                  Text(Item)
                }
              }
            }
          }
        `,
      },
      async paths => {
        await Expect(RuntimeTesting.runTaoTestPlan(paths['Main.test.tao']!)).rejects.toThrow(
          /press tag "item" expected one pressable but found 2 matches/,
        )
      },
    )
  })

  Test('rejects pressing a disabled toolbar command', async () => {
    await withTaoFiles(
      'tao-runtime-disabled-toolbar-test-plan-',
      {
        'Main.test.tao': `
          use ToolbarApp from ./

          test "Toolbar" {
            test "disabled command cannot be pressed" {
              run ToolbarApp
              expect toolbar command "Save" disabled
              press toolbar command "Save"
            }
          }
        `,
        'Main.tao': `
          use StackNav from @tao/nav
          use Text from @tao/ui

          app ToolbarApp { id "toolbarapp" version "1.0.0" name "Toolbar"
            Navigator StackNav { Initial Home }
          }

          scene Home() {
            state CanSave = false
            Title "Home"
            action SaveDocument() { }
            command Save() {
              Title "Save"
              Enabled CanSave
              do SaveDocument()
            }
            Toolbar { Save }
            render Text("Home")
          }
        `,
      },
      async paths => {
        await Expect(RuntimeTesting.runTaoTestPlan(paths['Main.test.tao']!)).rejects.toThrow(
          /cannot press a disabled toolbar command/,
        )
      },
    )
  })

  Test('runs Tao enter and submit steps through label and placeholder selectors', async () => {
    await withTaoFiles(
      'tao-runtime-input-test-plan-',
      {
        'Main.test.tao': `
        use InputApp from ./

        test "Input" {
          test "changes and submits" {
            run InputApp
            enter "Plan launch" into placeholder "Task title"
            expect text "Plan launch"
            expect input placeholder "Task title" value "Plan launch"
            submit label "Task title"
            expect text "Saved"
          }
        }
      `,
        'Main.tao': `
        app InputApp { id "inputapp" version "1.0.0" name "InputApp" view MainView }
        view MainView() {
          state Draft = ""
          state Status = "Waiting"
          action ChangeDraft(Value text) {
            set Draft = Value
          }
          action Submit() {
            set Status = "Saved"
          }
          render Stack(){
            NativeInput(Value: Draft, Change: ChangeDraft, Submit: Submit, Label: "Task title")
            Text(Draft)
            Text(Status)
          }
        }
        view Stack() {
          render inject Content @@content, Layout @@layout, Tag @@tag \`\`\`ts
            return TR.Views.View({ children: Content, layout: Layout, tag: Tag })
          \`\`\`
        }
        view NativeInput(Value text, Change action(text), Submit action(), Label text) {
          render inject Value, Change, Submit, Label \`\`\`ts
            return (
              <RN.TextInput
                accessibilityLabel={Label}
                placeholder="Task title"
                value={Value}
                onChangeText={value => Change.invoke(TR.Value(value))}
                onSubmitEditing={() => Submit.invoke()}
              />
            )
          \`\`\`
        }
        view Text(Value text) {
          render inject Value \`\`\`ts
            return <RN.Text>{Value}</RN.Text>
          \`\`\`
        }
      `,
      },
      async paths => {
        await RuntimeTesting.runTaoTestPlan(paths['Main.test.tao']!)
      },
    )
  })

  Test('runs grouped and tag-scoped expectations, interactions, selected rows', async () => {
    await withTaoFiles(
      'tao-runtime-structured-test-plan-',
      {
        'Main.test.tao': `
        use TaggedApp from ./

        test "Structured selectors" {
          test "scopes every operation" {
            run TaggedApp
            expect {
              text "First"
              text "Second"
              missing text "Selected Second"
            }
            expect #field {
              placeholder "Name"
              input value ""
            }
            enter "Draft" into #field
            expect #field input value "Draft"
            submit #field
            expect text "Submitted"
            select #rows[2] {
              expect text "Second"
              press #choose
            }
            expect text "Selected Second"
            expect text "First"
          }
        }
      `,
        'Main.tao': `
        use Col, FormButton, Text, TextInput from @tao/ui
        use Memory from @tao/data/providers/memory
        use StackNav from @tao/nav

        data Items / Item { Name text }

        app TaggedApp { id "taggedapp" version "1.0.0" name "Tagged"
          Navigator StackNav { Initial Main }
          Datasource Memory { }
        }

        scene Main() {
          Title "Main"
          state Draft = ""
          state Status = "Waiting"
          state Selection = "Nothing selected"
          query Items = Items with { }
          render Col() {
            guard Items {
              loading -> { Text("Loading") }
              error -> Context { Text(Context.Message) }
            }
            #field
            TextInput(Value: Draft, Label: "Name", Placeholder: "Name") {
              on submit -> { set Status = "Submitted" }
            }
            Text(Status)
            Text(Selection)
            #rows
            loop ["First", "Second"] / Row {
              Col() {
                Text(Row)
                #choose
                FormButton("Choose") {
                  on press -> { set Selection = "Selected { Row }" }
                }
              }
            }
          }
        }
      `,
      },
      async paths => {
        await RuntimeTesting.runTaoTestPlan(paths['Main.test.tao']!)
      },
    )
  })

  Test('resolves a selected non-selectable row by its loop tag rather than its collection label', async () => {
    await withTaoFiles(
      'tao-runtime-tagged-row-outline-',
      {
        'Main.test.tao': `
          use TaggedRowsApp from ./

          test "Tagged row labels" {
            test "reads the selected row outline label" {
              run TaggedRowsApp
              select #rows[2] {
                expect label "Chapter two"
              }
            }
          }
        `,
        'Main.tao': `
          use Col, Text from @tao/ui

          let Workspaces = ["Chapter one", "Chapter two"]

          app TaggedRowsApp { id "taggedrowsapp" version "1.0.0" name "TaggedRowsApp" view Main }

          view Main() {
            render Col() {
              #rows
              loop Workspaces / Workspace {
                Col() { Text(Workspace) }
              }
            }
          }
        `,
      },
      async paths => {
        await RuntimeTesting.runTaoTestPlan(paths['Main.test.tao']!)
      },
    )
  })

  Test('tagged loops preserve the same native row hierarchy as untagged loops', async () => {
    await testCompileApp(
      `
        use Col, Text from @tao/ui
        app LoopHierarchyApp { id "loophierarchyapp" version "1.0.0" name "LoopHierarchyApp" view Main }
        view Main() {
          render Col() {
            #taggedRows
            loop ["Tagged"] / Row {
              Col() { Text(Row) }
            }
            loop ["Untagged"] / Row {
              Col() { Text(Row) }
            }
          }
        }
      `,
      screen => {
        const taggedRow = screen.getByTestId('taggedRows')
        let untaggedRow = screen.getByText('Untagged').parent
        while (untaggedRow && untaggedRow.type !== taggedRow.type) {
          untaggedRow = untaggedRow.parent
        }
        Expect(untaggedRow).not.toBeNull()
        Expect(taggedRow.children.map((child: any) => typeof child === 'string' ? 'string' : child.type))
          .toEqual(untaggedRow?.children.map((child: any) => typeof child === 'string' ? 'string' : child.type))
        Expect(untaggedRow?.props.testID).toBeUndefined()
      },
    )
  })

  Test('runs standalone Tao back through the active navigation host', async () => {
    await withTaoFiles(
      'tao-runtime-navigation-test-plan-',
      {
        'Main.test.tao': `
        use NavigationApp from ./

        test "Navigation" {
          test "returns to the active stack root" {
            run NavigationApp
            expect text "Home"
            press text "Open"
            expect text "Detail"
            back
            expect text "Home"
            expect missing text "Detail"
          }
        }
      `,
        'Main.tao': `
        use StackNav from @tao/nav

        app NavigationApp { id "navigationapp" version "1.0.0" name "Navigation"
          Navigator StackNav { Initial Home }
        }

        project scene Home() {
          Title "Home"
          action Open() { present Detail() }
          render Stack(){
            Text("Home")
            Button("Open") { on press Open }
          }
        }

        project scene Detail() {
          Title "Detail"
          render Text("Detail")
        }

        view Stack() {
          render inject Content @@content, Layout @@layout, Tag @@tag \`\`\`ts
            return TR.Views.View({ children: Content, layout: Layout, tag: Tag })
          \`\`\`
        }

        view Button(Title text, Press action()) {
          render inject Title, Press \`\`\`ts
            return (
              <RN.Pressable accessibilityRole="button" onPress={() => Press.invoke()}>
                <RN.Text>{Title}</RN.Text>
              </RN.Pressable>
            )
          \`\`\`
        }

        view Text(Value text) {
          render inject Value \`\`\`ts
            return <RN.Text>{Value}</RN.Text>
          \`\`\`
        }
      `,
      },
      async paths => {
        await RuntimeTesting.runTaoTestPlan(paths['Main.test.tao']!)
      },
    )
  })

  Test('reports Tao suite and check context for failed text expectations', async () => {
    await withTaoFiles(
      'tao-runtime-test-plan-',
      {
        'Main.test.tao': `
        use BrokenTextApp from ./

        test "Broken text" {
          test "misses expected text" {
            run BrokenTextApp
            expect text "Expected"
          }
        }
      `,
        'Main.tao': `
        app BrokenTextApp { id "brokentextapp" version "1.0.0" name "BrokenTextApp" view MainView }
        view MainView() {
          render Text("Actual")
        }
        view Text(Value text) {
          render inject Value \`\`\`ts
            return <RN.Text>{Value}</RN.Text>
          \`\`\`
        }
      `,
      },
      async paths => {
        await Expect(RuntimeTesting.runTaoTestPlan(paths['Main.test.tao']!)).rejects.toThrow(
          /Tao check failed: Broken text > misses expected text[\s\S]*expect text "Expected"[\s\S]*Main\.test\.tao:/,
        )
      },
    )
  })

  Test('reports Tao suite and check context for failed missing text expectations', async () => {
    await withTaoFiles(
      'tao-runtime-test-plan-',
      {
        'Main.test.tao': `
        use BrokenTextApp from ./

        test "Broken missing text" {
          test "still renders unexpected text" {
            run BrokenTextApp
            expect missing text "Actual"
          }
        }
      `,
        'Main.tao': `
        app BrokenTextApp { id "brokentextapp" version "1.0.0" name "BrokenTextApp" view MainView }
        view MainView() {
          render Text("Actual")
        }
        view Text(Value text) {
          render inject Value \`\`\`ts
            return <RN.Text>{Value}</RN.Text>
          \`\`\`
        }
      `,
      },
      async paths => {
        await Expect(RuntimeTesting.runTaoTestPlan(paths['Main.test.tao']!)).rejects.toThrow(
          /Tao check failed: Broken missing text > still renders unexpected text[\s\S]*expect missing text "Actual"[\s\S]*Main\.test\.tao:/,
        )
      },
    )
  })

  Test('runs multiple Tao suites and cleans up rendered apps between Tao checks', async () => {
    await withTaoFiles(
      'tao-runtime-test-plan-',
      {
        'Main.test.tao': `
        use FirstApp, SecondApp from ./

        test "First isolated suite" {
          test "first app" {
            run FirstApp
            expect text "First"
          }
        }

        test "Second isolated suite" {
          test "second app" {
            run SecondApp
            expect missing text "First"
            expect text "Second"
          }
        }
      `,
        'First.tao': `
        app FirstApp { id "firstapp" version "1.0.0" name "FirstApp" view MainView }
        view MainView() {
          render Text("First")
        }
        view Text(Value text) {
          render inject Value \`\`\`ts
            return <RN.Text>{Value}</RN.Text>
          \`\`\`
        }
      `,
        'Second.tao': `
        app SecondApp { id "secondapp" version "1.0.0" name "SecondApp" view MainView }
        view MainView() {
          render Text("Second")
        }
        view Text(Value text) {
          render inject Value \`\`\`ts
            return <RN.Text>{Value}</RN.Text>
          \`\`\`
        }
      `,
      },
      async paths => {
        await RuntimeTesting.runTaoTestPlan(paths['Main.test.tao']!)
      },
    )
  })
})
