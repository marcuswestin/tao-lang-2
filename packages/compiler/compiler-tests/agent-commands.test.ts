import { Workspace } from '@compiler/workspace'
import { Describe, Expect, stubView, Test, withTaoFiles } from '@shared/test'
import { TestCompiler as Compiler } from './test-compile'

Describe('compiler: explicit app agent commands', () => {
  Test('passes an inherited authenticated app scope to the mounted command hook', async () => {
    await withTaoFiles('tao-agent-auth-commands-', {
      'Main.tao': `
        use Base from ./Base
        app Inherited = Base with { id "com.tao.test.inherited",  name "Inherited" }
      `,
      'Base.tao': `
        use Account from @tao/auth
        use TestAuth from @tao/auth/testing
        use Memory from @tao/data/providers/memory
        data Accounts / Account { DisplayName text, Notes }
        data Notes / Note { Owner Account, Body text }
        let Me = Account
        action AppendNote(Body text) { create Note { Owner: Me, Body } }
        command Append(Body text) { Title "Append" do AppendNote(Body) }
        project app Base { id "com.tao.test.base" version "1.0.0" name "Base"  Auth TestAuth {} Datasource Memory {} AgentCommands [Append] view Home() }
        ${stubView('Home')}
      `,
    }, async paths => {
      const result = await Workspace.compile(paths['Main.tao'], { appName: 'Inherited' })
      Expect(result.validation.diagnostics).toEqual([])
      const code = result.files.find(file => file.relativePath === 'App.tsx')?.code.replace(/\s+/g, ' ') ?? ''
      Expect(code).toContain('agentCommands: () => _TaoBaseBinding.agentCommands()')
      Expect(code).toContain(
        'useTaoGeneratedAgentCommands(_TaoAppDefinition_Inherited.definition.agentCommands?.() ?? [], [ ...(_TaoAppDefinition_Inherited.definition.datasources?.() ?? []).map(binding => binding.store), ], _TaoAuthScope)',
      )
      Expect(code).toContain('const useTaoGeneratedAgentCommands = TR.Agent.useCommands')
    })
  })

  Test('inherits imported app commands and replaces an imported allowlist', async () => {
    await withTaoFiles('tao-agent-commands-', {
      'Package.tao': 'package { version "1.0.0" license AGPL-3.0-only }',
      'Main.tao': `
        use Base from ./Base
        use Public from ./Commands
        app Inherited = Base with { id "com.tao.test.inherited",  name "Inherited" }
        app Replaced = Base with { id "com.tao.test.replaced",  AgentCommands [Public] }
        app Closed = Base with { id "com.tao.test.closed",  AgentCommands [] }
      `,
      'Base.tao': `
        ${stubView('Home')}
        action Run() {}
        command Secret() { Title "Secret" do Run() }
        project app Base { id "com.tao.test.base" version "1.0.0" name "Base"  AgentCommands [Secret] view Home() }
      `,
      'Commands.tao': 'action Run() {} project command Public() { Title "Public" do Run() }',
    }, async paths => {
      const result = await Workspace.compile(paths['Main.tao'], { appName: 'Replaced' })
      const code = result.files.find(file => file.relativePath === 'App.tsx')?.code ?? ''
      Expect(code).toContain('agentCommands: () => _TaoBaseBinding.agentCommands()')
      Expect(code).toContain('agentCommands: () => [_Scope.Public]')
      Expect(code).toContain('agentCommands: () => []')
      Expect(code).not.toContain('_Scope.Secret')
    })
  })
  Test('emits per-app replacement allowlists only when mounted', async () => {
    const compiled = await Compiler.compileCode(
      `
      ${stubView('Home')}
      action Run() {}
      command Safe(Value text) { Title "Safe" do Run() }
      command Private() { Title "Private" do Run() }
      app Main { id "com.tao.test.main" version "1.0.0" name "Main"  AgentCommands [Safe] view Home() }
      app Restricted = Main with { id "com.tao.test.restricted"  AgentCommands [] }
    `,
      { appName: 'Restricted' },
    )
    Expect(compiled.code).toContain('agentCommands: () => [_Scope.Safe]')
    Expect(compiled.code).toContain('scalarType: "text"')
    Expect(compiled.code).toContain('agentCommands: () => []')
    Expect(compiled.code).not.toContain('agentCommands: () => [_Scope.Private]')
    // Nested member hook calls force a Fast Refresh remount. Keep the hook in module scope.
    Expect(compiled.code).toContain('const useTaoGeneratedAgentCommands = TR.Agent.useCommands')
    Expect(compiled.code).not.toContain('TR.Agent.useCommands(')
    Expect(compiled.code).toContain(
      'useTaoGeneratedAgentCommands(_TaoAppDefinition_Restricted.definition.agentCommands?.() ?? [], [',
    )
    Expect(compiled.code).toContain(
      '...(_TaoAppDefinition_Restricted.definition.datasources?.() ?? []).map(binding => binding.store)',
    )
  })
})
