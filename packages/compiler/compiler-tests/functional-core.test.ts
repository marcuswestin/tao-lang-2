import { Describe, Expect, Test } from '@shared/test'
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

    Expect(compiled.files).toHaveLength(3)
    Expect(compiled.files[0]?.code).toContain('TR.WhenCase(')
    Expect(compiled.files[0]?.code).toContain('TR.WhenCaseRender(')
    Expect(compiled.files[0]?.code).toContain('if (await TR.GuardAction(')
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
        query Documents { }
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
              error -> Message { Text(Message) }
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
    Expect(code.match(/TR\.If\(/g)).toHaveLength(4)
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
