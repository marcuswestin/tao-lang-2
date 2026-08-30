import { RuntimeTesting } from '@runtime-toolchain/testing/runtime-testing'
import { Describe, Expect, Test, withTaoFiles } from '@shared/test'
import { registerRuntimeE2ELifecycle, testCompileApp } from './test-compile-app'

registerRuntimeE2ELifecycle()

Describe('Expo runtime', () => {
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
        app DuplicateTextApp { view MainView }
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

  Test('runs Tao press text steps before later expectations', async () => {
    await withTaoFiles(
      'tao-runtime-test-plan-',
      {
        'Main.test.tao': `
        use PressTextApp from ./

        test "Press text" {
          test "updates rendered state" {
            run PressTextApp
            expect text "0"
            press text "Add"
            expect text "1"
          }
        }
      `,
        'Main.tao': `
        app PressTextApp { view MainView }
        view MainView() {
          state Count = 0
          action AddOne() {
            set Count += 1
          }
          render Stack(){
            NativeButton("Add", AddOne)
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
        app AsyncActionApp { view MainView }
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

        app AskTestApp {
          Name "Ask test"
          Navigator StackNav { Initial Home }
        }

        view Home() {
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
        app MissingPressApp { view MainView }

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

          app ToolbarApp {
            Name "Toolbar"
            Navigator StackNav { Initial Home }
          }

          view Home() {
            state CanSave = false
            Title "Home"
            action SaveDocument() { Title "Save" }
            command Save = SaveDocument() with { Enabled CanSave }
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
        app InputApp { view MainView }
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
        use Memory from @tao/data
        use StackNav from @tao/nav

        data Items / Item { Name text }

        app TaggedApp {
          Name "Tagged"
          Navigator StackNav { Initial Main }
          Datasource Memory { }
        }

        view Main() {
          Title "Main"
          state Draft = ""
          state Status = "Waiting"
          state Selection = "Nothing selected"
          query Items { }
          render Col() {
            guard Items {
              loading -> { Text("Loading") }
              error -> Message { Text(Message) }
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

  Test('tagged loops preserve the same native row hierarchy as untagged loops', async () => {
    await testCompileApp(
      `
        use Col, Text from @tao/ui
        app LoopHierarchyApp { view Main }
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
        Expect(taggedRow.type).toBe(untaggedRow?.type)
        Expect(taggedRow.children.map((child: any) => typeof child === 'string' ? 'string' : child.type))
          .toEqual(untaggedRow?.children.map((child: any) => typeof child === 'string' ? 'string' : child.type))
        Expect(taggedRow.props.testID).toBe('taggedRows')
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

        app NavigationApp {
          Name "Navigation"
          Navigator StackNav { Initial Home }
        }

        workspace view Home() {
          Title "Home"
          action Open() { present Detail() }
          render Stack(){
            Text("Home")
            Button("Open") { on press Open }
          }
        }

        workspace view Detail() {
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
        app BrokenTextApp { view MainView }
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
        app BrokenTextApp { view MainView }
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
        app FirstApp { view MainView }
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
        app SecondApp { view MainView }
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
