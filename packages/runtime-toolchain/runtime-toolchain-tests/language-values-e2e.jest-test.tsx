import { Repo } from '@shared'
import { Describe, Expect, Test } from '@shared/test'
import { fireEvent } from '@testing-library/react-native'
import {
  compileAndRenderApp,
  ExpectScreen,
  registerRuntimeE2ELifecycle,
  testCompileApp,
  testCompileFiles,
} from './test-compile-app'

registerRuntimeE2ELifecycle()

Describe('Expo runtime', () => {
  Test('compiles and renders runtime stdlib imports', async () => {
    const runtimeStdlibTestsPath = Repo.resolvePath('Apps/Test Apps/Runtime Stdlib Tests/Runtime Stdlib Tests.tao')
    const screen = await compileAndRenderApp(runtimeStdlibTestsPath)

    ExpectScreen(screen).toHaveText('Runtime stdlib smoke')
    ExpectScreen(screen).toHaveText('3')
    ExpectScreen(screen).toHaveText('Tap me')
    ExpectScreen(screen).toHaveText('Label')
    ExpectScreen(screen).toHaveText('Wrapped')

    Expect(screen.getByText('Runtime stdlib smoke').props).toMatchObject({
      ellipsizeMode: 'tail',
      numberOfLines: 1,
    })
    Expect(screen.getByText('3').props).toMatchObject({
      ellipsizeMode: 'tail',
      numberOfLines: 1,
    })
    Expect(screen.getByText('Label').props).toMatchObject({
      ellipsizeMode: 'clip',
      numberOfLines: 1,
    })
    Expect(screen.getByText('Wrapped').props.ellipsizeMode).toBeUndefined()
    Expect(screen.getByText('Wrapped').props.numberOfLines).toBeUndefined()
    Expect(ancestorProp(screen.getByText('Tap me'), 'accessibilityRole')).toBe('button')
  })

  Test('passes action values through render inject arguments', async () => {
    await testCompileApp(
      `
        app InjectedActionApp {
          view MainView
        }

        view MainView() {
          state Count = 0
          action AddOne() {
            set Count += 1
          }
          render Stack(){
            NativeButton("Native add", AddOne)
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
      screen => {
        ExpectScreen(screen).toHaveText('0')

        fireEvent.press(screen.getByText('Native add'))
        ExpectScreen(screen).toHaveText('1')
      },
    )
  })

  Test('applies typed defaults for functions, views, and actions', async () => {
    await testCompileApp(
      `
        app DefaultsApp {
          view MainView
        }

        function Greeting(Name text default "world") returns text {
          return "Hello, { Name }"
        }

        view MainView() {
          state Result = ""
          action Save(Message text default "Saved") {
            set Result = Message
          }
          render Stack(){
            Text(Greeting())
            GreetingView()
            NativeButton("Save", Save)
            Text(Result)
          }
        }

        view GreetingView(Title text default "Welcome") {
          render Text(Title)
        }

        view Stack(Gap number default 8) {
          render inject Gap, Content @@content, Layout @@layout, Tag @@tag \`\`\`ts
            return TR.Views.View({
              children: <><RN.Text>{\`Gap \${Gap}\`}</RN.Text>{Content}</>,
              layout: Layout,
              tag: Tag,
            })
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

        view Text(Value text) {
          render inject Value \`\`\`ts
            return <RN.Text>{Value}</RN.Text>
          \`\`\`
        }
      `,
      screen => {
        ExpectScreen(screen).toHaveText('Hello, world')
        ExpectScreen(screen).toHaveText('Welcome')
        ExpectScreen(screen).toHaveText('Gap 8')

        fireEvent.press(screen.getByText('Save'))
        ExpectScreen(screen).toHaveText('Saved')
      },
    )
  })

  Test('renders an all-defaulted initial destination', async () => {
    await testCompileApp(
      `
        use StackNav from @tao/nav

        app DefaultsNavigationApp {
          Name "Defaults"
          Navigator StackNav { Initial Home }
        }

        workspace view Home(Title text default "Welcome home") {
          Title Title
          render Text(Title)
        }

        view Text(Value text) {
          render inject Value \`\`\`ts
            return <RN.Text>{Value}</RN.Text>
          \`\`\`
        }
      `,
      screen => {
        Expect(screen.getAllByText('Welcome home')).toHaveLength(2)
        Expect(screen.getByRole('header').props.children).toBe('Welcome home')
      },
    )
  })

  Test('invokes action parameters in declaration order after type-based binding', async () => {
    await testCompileApp(
      `
        app ReorderedActionApp {
          view MainView
        }

        view MainView() {
          state Count = 0
          action AddTagged(Step number, Label text) {
            set Count += Step
          }
          action RunAddTagged() {
            do AddTagged("tag", 3)
          }
          render Stack(){
            NativeButton("Run reordered action", RunAddTagged)
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
      screen => {
        ExpectScreen(screen).toHaveText('0')

        fireEvent.press(screen.getByText('Run reordered action'))
        ExpectScreen(screen).toHaveText('3')
      },
    )
  })

  Test('renders imported project actions as runtime values', async () => {
    await testCompileFiles(
      'Main.tao',
      {
        'Main.tao': `
          app ImportedActionApp {
            view MainView
          }

          use Save from ./Actions.tao

          view MainView() {
            render Button("Imported action", Save)
          }

          view Button(Title text, Action action()) {
            render inject Title, Action \`\`\`ts
              return <RN.Text>{Title}</RN.Text>
            \`\`\`
          }
        `,
        'Actions.tao': `
          workspace action Save() { }
        `,
      },
      screen => {
        ExpectScreen(screen).toHaveText('Imported action')
      },
    )
  })

  Test('emits item constructor fields in declaration order after type-based binding', async () => {
    await testCompileApp(
      `
        app ItemOrderApp {
          view MainView
        }

        type Name is text
        type Age is number
        type Person is {
          Name,
          Age,
        }

        let Ada = Person { Age: 40, Name: "Ada" }

        view MainView() {
          render Keys(Ada)
        }

        view Keys(Person) {
          render inject Person \`\`\`ts
            return <RN.Text>{Object.keys(Person).join(",")}</RN.Text>
          \`\`\`
        }
      `,
      screen => {
        ExpectScreen(screen).toHaveText('Name,Age')
      },
    )
  })

  Test('mounts a reusable app value and renders absence from an omitted optional item member', async () => {
    await testCompileApp(
      `
        use StackNav from @tao/nav

        public type ReusableApp is app with {
          Name text is "Reusable optional values"
        }

        let Product = ReusableApp {
          Navigator StackNav { Initial Home }
        }

        type Profile is {
          Name text,
          Subtitle text?,
        }

        let Basic = Profile { Name: "Ada" }

        view Home() {
          Title "Home"
          render Stack() {
            Text("Mounted reusable app")
            when (Basic.Subtitle == none) {
              true -> { Text("No subtitle") }
              otherwise -> { Text("Unexpected subtitle") }
            }
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
      screen => {
        ExpectScreen(screen).toHaveText('Mounted reusable app')
        ExpectScreen(screen).toHaveText('No subtitle')
      },
    )
  })

  Test('rerenders state-backed item member access after state updates', async () => {
    await testCompileApp(
      `
        app StatefulItemMemberApp {
          view MainView
        }

        type Name is text
        type Person is {
          Name,
        }

        view MainView() {
          state Current = Person { Name: "Ada" }
          action Rename() {
            set Current = Person { Name: "Grace" }
          }
          render Stack(){
            Button("Rename", Rename)
            Text(Current.Name)
          }
        }

        view Stack() {
          render inject Content @@content, Layout @@layout, Tag @@tag \`\`\`ts
            return TR.Views.View({ children: Content, layout: Layout, tag: Tag })
          \`\`\`
        }

        view Button(Title text, Action action()) {
          render inject Title, Action \`\`\`ts
            return (
              <RN.Pressable accessibilityRole="button" onPress={() => Action.invoke()}>
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
      screen => {
        ExpectScreen(screen).toHaveText('Ada')

        fireEvent.press(screen.getByText('Rename'))
        ExpectScreen(screen).toHaveText('Grace')
      },
    )
  })

  Test('runs actions whose parameters shadow generated runtime names', async () => {
    await testCompileApp(
      `
        app ShadowedActionParameterApp {
          view MainView
        }

        view MainView() {
          state Count = 0
          action AddStep(_Scope number) {
            set Count += _Scope
          }
          action AddOne() {
            do AddStep(1)
          }
          render Stack(){
            NativeButton("Add with shadowed parameter", AddOne)
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
      screen => {
        ExpectScreen(screen).toHaveText('0')

        fireEvent.press(screen.getByText('Add with shadowed parameter'))
        ExpectScreen(screen).toHaveText('1')
      },
    )
  })

  Test('renders imported alias references through circular module imports', async () => {
    await testCompileFiles(
      'Main.tao',
      {
        'Main.tao': `
          app CircularAliasApp {
              view MainView
          }

          use AView from ./

          view MainView() {
              render AView()
          }
        `,
        'A.tao': `
          use BView from ./

          workspace let SharedTitle = "Circular alias"

          workspace view AView() {
              render BView()
          }
        `,
        'B.tao': `
          use SharedTitle from ./

          let ImportedTitle = SharedTitle

          workspace view BView() {
              render Text(ImportedTitle)
          }

          view Text(Value text) {
              render inject Value \`\`\`ts
                  return <RN.Text>{Value}</RN.Text>
              \`\`\`
          }
        `,
      },
      screen => {
        ExpectScreen(screen).toHaveText('Circular alias')
      },
    )
  })

  Test('renders alias references to earlier aliases', async () => {
    await testCompileApp(
      `
        app OrderedAlias {
            view MainView
        }

        let Message = "Ordered output"
        let Greeting = Message

        view MainView() {
            render Text(Greeting) { }
        }

        view Text(Value text) {
            render inject Value \`\`\`ts
                return <RN.Text>{Value}</RN.Text>
            \`\`\`
        }
      `,
      screen => {
        ExpectScreen(screen).toHaveText('Ordered output')
      },
    )
  })

  Test('renders block-local aliases that shadow file-level aliases', async () => {
    await testCompileApp(
      `
        app ScopedAlias {
            view MainView
        }

        let Greeting = "Outer"

        view MainView() {
            let OuterGreeting = Greeting
            render Stack(){
                let Greeting = "Inner"
                Text(Greeting)
                Text(OuterGreeting)
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
      screen => {
        ExpectScreen(screen).toHaveText('Inner')
        ExpectScreen(screen).toHaveText('Outer')
      },
    )
  })
})

function ancestorProp(node: { parent?: any }, prop: string): unknown {
  let current = node.parent
  while (current) {
    if (current.props?.[prop] !== undefined) {
      return current.props[prop]
    }
    current = current.parent
  }
  return undefined
}
