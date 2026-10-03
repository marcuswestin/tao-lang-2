import { Workspace } from '@compiler/workspace'
import { Describe, Expect, fence, Test, tsFence, withTaoFiles } from '@shared/test'
import { TestCompiler as Compiler } from './test-compile'

Describe('compiler: functional core', () => {
  Test('compiles pure functions and total control flow through validated Tao', async () => {
    const compiled = await Compiler.compileCode(`
      app FunctionalApp { view Main }
      function HasCount(Count number) returns boolean {
        return Count > 0
      }
      function Label(Count number) returns text {
        return when (Count > 0) {
          true -> "Count: { Count }"
          otherwise -> "Empty"
        }
      }
      function GoalFraction(Count number) {
        if Count == 0 { return 0 }
        return Count / 10
      }
      view Main() {
        state Ready = false
        action Flip() {
          guard Ready true -> { toggle Ready }
          toggle Ready
        }
        action Confirm() {
          check Ready
          toggle Ready
        }
        action Nothing() { }
        render Stack(){
          when HasCount(2) {
            true -> {
            Text(Label(2))
            }
            otherwise -> {
            Text("Empty")
            }
          }
          loop ["Inbox", "Today"] / Name {
            Text(Name)
          }
        }
      }
      view Stack() { render inject Content @@content \`\`\`ts\nreturn Content\n\`\`\` }
      view Text(Value text) { render inject Value \`\`\`ts\nreturn null\n\`\`\` }
    `)

    Expect(compiled.files.filter(file => !file.relativePath.startsWith('modules/'))).toHaveLength(3)
    Expect(compiled.files[0]?.code).toContain('TR.WhenCase(')
    Expect(compiled.files[0]?.code).toContain('TR.WhenCaseRender(')
    Expect(compiled.files[0]?.code).toContain('if (await TR.GuardAction(')
    Expect(compiled.files[0]?.code).toContain('if (TR.Check(')
    // An empty action body still reads the continuation its callback declares.
    Expect(compiled.files[0]?.code).toContain('void _TaoActionContinuation')
    Expect(compiled.files[0]?.code).toContain('TR.Toggle(')
    Expect(compiled.files[0]?.code).toContain('if (TR.Binary(')
  })

  Test('lowers typed defaults in view, action, and function callee scopes', async () => {
    const compiled = await Compiler.compileCode(`
      app DefaultsApp { view Main }
      function Label(Value text default "Save") returns text { return Value }
      view Main() {
        action Submit(Message text default "Saved") { }
        render Card(){ Greeting() }
      }
      view Card(Gap number default 8) { render inject Content @@content \`\`\`ts\nreturn Content\n\`\`\` }
      view Greeting(Title text default "Welcome") { render inject \`\`\`ts\nreturn null\n\`\`\` }
    `)

    const code = compiled.files[0]?.code ?? ''
    Expect(code).toContain('_ViewProps.Title ?? TR.Readonly(TR.Alias(() => TR.Value("Welcome")))')
    Expect(code).toContain('_ViewProps.Gap ?? TR.Readonly(TR.Alias(() => TR.Value(8)))')
    Expect(code).toContain('_TaoActionArg0 ?? TR.Readonly(TR.Alias(() => TR.Value("Saved")))')
    Expect(code).toContain('_TaoFunctionArg0 ?? TR.Value("Save")')
  })

  Test('lowers enum identity case tests and one-sided action and render if', async () => {
    const compiled = await Compiler.compileCode(`
      app CaseApp { view Main }
      type ConfirmResult is one of Confirmed, Cancelled
      data Documents / Document { Final yes / Draft no }
      view Main() {
        state Result = Confirmed
        state Ready = true
        query Documents = Documents with { }
        action Close() {
          if Result is Confirmed { toggle Ready }
        }
        render Stack() {
          if Result is Confirmed { Text("Confirmed") }
          loop Documents / Document {
            guard Document {
              loading -> { Text("Loading") }
              missing -> { Text("Missing") }
              unauthorized -> { Text("Unauthorized") }
              error -> Context { Text(Context.Message) }
            }
            if Document.Final is Final { Text("Final") }
            if Document.Final is Draft { Text("Draft") }
          }
        }
      }
      view Stack() { render inject Content @@content \`\`\`ts\nreturn Content\n\`\`\` }
      view Text(Value text) { render inject Value \`\`\`ts\nreturn null\n\`\`\` }
    `)

    const code = compiled.files[0]?.code ?? ''
    Expect(code).toContain('_Scope.ConfirmResult = TR.Enum(TR.Navigation.Identity(')
    Expect(code).toContain('["Confirmed", "Cancelled"])')
    Expect(code).toContain('TR.IsCase(_Scope.Result.evaluate(), _Scope.ConfirmResult.Confirmed)')
    Expect(code).toContain('TR.IsCase(TR.Member(_Scope.Document.evaluate(), ["Final"]), TR.Value(true))')
    Expect(code).toContain('TR.IsCase(TR.Member(_Scope.Document.evaluate(), ["Final"]), TR.Value(false))')
    Expect(code).toContain('TR.GuardRender(_Scope.Document.evaluate(), [')
    Expect(code).toContain('["missing", _TaoCasePayload =>')
    Expect(code).toContain('["unauthorized", _TaoCasePayload =>')
    Expect(code).toMatch(/<_Scope\.Text\s+Value=\{[^}]*_Scope\.Context[^}]*\["Message"\]/)
    Expect(code.match(/TR\.If\(/g)).toHaveLength(4)
  })

  Test('hands unnamed exceptional cases to the read net the app carries', async () => {
    const compiled = await Compiler.compileCode(`
      app NetApp { view Main guard {
        loading -> Text("Opening…")
        error -> Context { Text(Context.Message) }
      } }
      data Documents / Document { Title text }
      view Main() {
        query Documents = Documents with { }
        render Stack() {
          guard Documents
          Text("Ready")
        }
      }
      view Stack() { render inject Content @@content \`\`\`ts\nreturn Content\n\`\`\` }
      view Text(Value text) { render inject Value \`\`\`ts\nreturn null\n\`\`\` }
    `)

    const code = compiled.files[0]?.code ?? ''
    Expect(code).toContain('readNet: () => TR.MergeReadNet(undefined, TR.ReadNet({')
    Expect(code).toContain('"loading": (_ViewProps, _TaoCasePayload) =>')
    Expect(code).toContain('_Scope.Context = _TaoCasePayload')
    Expect(code).toMatch(/<_Scope\.Text\s+Value=\{[^}]*_Scope\.Context[^}]*\["Message"\]/)
    Expect(code).toMatch(
      /TR\.GuardRender\(_Scope\.Documents\.evaluate\(\), \[\s*\], \(\) => <>[\s\S]*<\/>, _ViewProps\.__tao, \{"readKind":"query"\}\)/,
    )
  })

  Test('compiles entity when error binders through the text-compatible read path', async () => {
    const compiled = await Compiler.compileCode(`
      app NetApp { view Shell }
      data Documents / Document { Title text }
      view Shell() { render Text("Ready") }
      view Main(Document) {
        render Stack() {
          when Document {
            error -> Message { Text(Message) }
            otherwise -> { Text("Ready") }
          }
        }
      }
      view Stack() { render inject Content @@content \`\`\`ts\nreturn Content\n\`\`\` }
      view Text(Value text) { render inject Value \`\`\`ts\nreturn null\n\`\`\` }
    `)
    const code = compiled.files[0]?.code ?? ''
    Expect(code).toContain('TR.WhenReadRender(_Scope.Document.evaluate(), [')
    Expect(code).toContain('_Scope.Message = _TaoCasePayload')
  })

  Test('inherits and patches app read net cases across modules', async () => {
    await withTaoFiles(
      'tao-compiler-read-net-',
      {
        'Project.tao': `project { id "compiler-read-net" name "Compiler read net" }`,
        'Main.tao': `
          use Base from ./Net
          app NetApp = Base with { guard { error -> Context { Text(Context.Message) } } }
          view Text(Value text) { render inject ${tsFence} return null ${fence} }
        `,
        'Net.tao': `
          workspace app Base { view Home guard { missing -> { Gone() } } }
          workspace view Gone() { render inject ${tsFence} return null ${fence} }
          workspace view Home() { render inject ${tsFence} return null ${fence} }
        `,
      },
      async paths => {
        const compiled = await Workspace.compile(paths['Main.tao'])
        const app = compiled.files.find(file => file.relativePath === 'App.tsx')?.code ?? ''
        const net = compiled.files.find(file => file.relativePath === 'modules/Net.tao.tsx')?.code ?? ''

        Expect(app).toContain('TR.MergeReadNet(')
        Expect(app).toContain('.definition.readNet?.(), TR.ReadNet({')
        Expect(app).toContain('"error": (_ViewProps, _TaoCasePayload) =>')
        Expect(net).toContain('"missing": (_ViewProps, _TaoCasePayload) =>')
      },
    )
  })

  Test('keeps a matched guard inside its action block while caller execution continues', async () => {
    const compiled = await Compiler.compileCode(`
      app GuardApp { view Main }
      view Main() {
        state Stop = true
        state Count = 0
        action Callee() {
          guard Stop true -> { set Count = 1 }
          set Count = 2
        }
        action Caller() {
          do Callee()
          set Count = 3
        }
        render Text("Ready")
      }
      view Text(Value text) { render inject Value \`\`\`ts\nreturn null\n\`\`\` }
    `)

    const code = compiled.files[0]?.code ?? ''
    const guard = code.indexOf('if (await TR.GuardAction(')
    const calleeTail = code.indexOf('TR.Set(_Scope.Count, () => TR.Value(2))')
    const caller = code.indexOf('await TR.Do(_Scope.Callee.evaluate())')
    const callerTail = code.indexOf('TR.Set(_Scope.Count, () => TR.Value(3))')
    Expect(guard).toBeGreaterThan(-1)
    Expect(calleeTail).toBeGreaterThan(guard)
    Expect(caller).toBeGreaterThan(calleeTail)
    Expect(callerTail).toBeGreaterThan(caller)
    Expect(code.slice(caller, callerTail)).not.toContain('return')
  })
})
