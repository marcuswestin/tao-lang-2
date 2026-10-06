import { Describe, stubView, Test } from '@shared/test'
import { agentCommandsValidationMessages as messages } from '../validator-src/validators/agent-commands-validator'
import { accepts, acceptsFiles, rejects } from './test-validate'

const base = `
  ${stubView('Home')}
  action Run() {}
  command Safe(Value text, Count number, Enabled boolean) { Title "Safe" do Run() }
  command Plain() { Title "Plain" do Run() }
`

Describe('validator: explicit app agent commands', () => {
  Test(
    'accepts scalar commands and replacement variants',
    accepts(`
    ${base}
    app Main { id "main" version "1.0.0" name "Main" AgentCommands [Safe, Plain] view Home() }
    app Restricted = Main with { id "restricted", AgentCommands [] }
  `),
  )
  Test(
    'accepts primitive constructor app values',
    accepts(`
    ${base}
    use StackNav from @tao/nav
    nav Navigation = StackNav { Initial Home }
    let Main = app { id "main", version "1.0.0", name "Main", Navigator Navigation, AgentCommands [Safe, Plain] }
  `),
  )
  Test(
    'accepts imported commands',
    acceptsFiles({
      'Main.tao': `${
        stubView('Home')
      } use Safe from ./Commands app Main { id "main" version "1.0.0" name "Main" AgentCommands [Safe] view Home() }`,
      'Commands.tao': 'action Run() {} project command Safe(Value text) { Title "Safe" do Run() }',
    }),
  )
  Test(
    'rejects view-local commands',
    rejects(
      `
    action Run() {}
    view Home() {
      command Hidden() { Title "Hidden" do Run() }
      render inject \`\`\`tsx return null \`\`\`
    }
    app Main { id "main" version "1.0.0" name "Main" AgentCommands [Hidden] view Home() }
  `,
      messages.command,
    ),
  )
  Test(
    'rejects computed allowlists',
    rejects(
      `
    ${base}
    let Allowed = [Safe]
    app Main { id "main" version "1.0.0" name "Main" AgentCommands Allowed view Home() }
  `,
      messages.literal,
    ),
  )
  Test(
    'rejects noncommands',
    rejects(
      `
    ${base}
    app Main { id "main" version "1.0.0" name "Main" AgentCommands [Run] view Home() }
  `,
      messages.command,
    ),
  )
  Test(
    'rejects bound commands',
    rejects(
      `
    ${base}
    let Bound = Safe with { Value "x", Count 1, Enabled true }
    app Main { id "main" version "1.0.0" name "Main" AgentCommands [Bound] view Home() }
  `,
      messages.command,
    ),
  )
  Test(
    'rejects unsupported command slots',
    rejects(
      `
    ${base}
    command Many(Values list of text) { Title "Many" do Run() }
    app Main { id "main" version "1.0.0" name "Main" AgentCommands [Many] view Home() }
  `,
      messages.slot('Many', 'Values'),
    ),
  )
  Test(
    'rejects record and entity inputs',
    rejects(
      `
    ${base}
    type Payload is { Value text }
    data Records / Record { Value text }
    command RecordInput(Item Record) { Title "Record input" do Run() }
    command PayloadInput(Item Payload) { Title "Payload input" do Run() }
    app Main { id "main" version "1.0.0" name "Main" AgentCommands [RecordInput, PayloadInput] view Home() }
  `,
      messages.slot('RecordInput', 'Item'),
      messages.slot('PayloadInput', 'Item'),
    ),
  )
  Test(
    'rejects list patches',
    rejects(
      `
    ${base}
    app Main { id "main" version "1.0.0" name "Main" AgentCommands [Safe] view Home() }
    app Patched = Main with { id "patched", AgentCommands with { Value "x" } }
  `,
      messages.literal,
    ),
  )
})
