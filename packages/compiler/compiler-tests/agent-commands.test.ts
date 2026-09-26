import { Workspace } from '@compiler/workspace'
import { Describe, Expect, stubView, Test, withTaoFiles } from '@shared/test'
import { TestCompiler as Compiler } from './test-compile'

Describe('compiler: explicit app agent commands', () => {
  Test('inherits imported app commands and replaces an imported allowlist', async () => {
    await withTaoFiles('tao-agent-commands-', {
      'Project.tao': 'project { id "agent-commands" name "Agent commands" }',
      'Main.tao': `
        use Base from ./Base
        use Public from ./Commands
        app Inherited = Base with { Name "Inherited" }
        app Replaced = Base with { AgentCommands [Public] }
        app Closed = Base with { AgentCommands [] }
      `,
      'Base.tao': `
        ${stubView('Home')}
        action Run() {}
        command Secret() { Title "Secret" do Run() }
        workspace app Base { AgentCommands [Secret] view Home() }
      `,
      'Commands.tao': 'action Run() {} workspace command Public() { Title "Public" do Run() }',
    }, async paths => {
      const result = await Workspace.compile(paths['Main.tao'], { appName: 'Replaced' })
      const code = result.files.find(file => file.relativePath === 'App.tsx')?.code ?? ''
      Expect(code).toContain('agentCommands: () => _Scope.Base.definition.agentCommands?.() ?? []')
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
      app Main { AgentCommands [Safe] view Home() }
      app Restricted = Main with { AgentCommands [] }
    `,
      { appName: 'Restricted' },
    )
    Expect(compiled.code).toContain('agentCommands: () => [_Scope.Safe]')
    Expect(compiled.code).toContain('scalarType: "text"')
    Expect(compiled.code).toContain('agentCommands: () => []')
    Expect(compiled.code).not.toContain('agentCommands: () => [_Scope.Private]')
    Expect(compiled.code).toContain(
      'TR.Agent.useCommands(_TaoAppDefinition_Restricted.definition.agentCommands?.() ?? [], [',
    )
    Expect(compiled.code).toContain(
      '...(_TaoAppDefinition_Restricted.definition.datasources?.() ?? []).map(binding => binding.store)',
    )
  })
})
