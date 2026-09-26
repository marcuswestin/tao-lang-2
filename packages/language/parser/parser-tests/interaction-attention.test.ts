import { AST } from '@parser'
import { Describe, Expect, Test } from '@shared/test'
import { testParseCode } from './test-parse'

Describe('parser: interaction attention', () => {
  Test('parses entity and view command surfacing without stringly-typed command names', async () => {
    const result = await testParseCode(`
      view Leaf() { render inject \`\`\`ts return null \`\`\` }
      action Run() { }
      command Finish(Document) { Title "Finish" do Run() }
      command Duplicate(Document) { Title "Duplicate" do Run() }
      command Delete(Document) { Title "Delete" do Run() }
      data Documents / Document {
        Title text,

        commands { Finish, Duplicate },
        commands hide { Delete }
      }
      view Row(Document) {
        Commands { Finish }
        hide Duplicate, Delete
        render Leaf()
      }
    `)

    const entity = result.entry.ast.statements.find(AST.isEntityDataDeclaration)
    const row = result.entry.ast.statements.find(
      statement => AST.isViewDeclaration(statement) && statement.name === 'Row',
    )
    Expect.Is(entity, AST.isEntityDataDeclaration)
    Expect.Is(row, AST.isViewDeclaration)
    const policies = entity.block.entries.filter(AST.isEntityCommandPolicy)
    Expect(policies.map(policy => ({
      commands: policy.commands.map(command => command.ref?.name),
      hide: policy.hide,
    }))).toEqual([
      { commands: ['Finish', 'Duplicate'], hide: false },
      { commands: ['Delete'], hide: true },
    ])
    const exclusion = row.block?.statements.find(AST.isViewCommandExclusion)
    Expect.Is(exclusion, AST.isViewCommandExclusion)
    Expect(exclusion.commands.map(command => command.ref?.name)).toEqual(['Duplicate', 'Delete'])
  })

  Test('parses bare and named interaction conditions while preserving Scheme conditions', async () => {
    const result = await testParseCode(`
      view Leaf() { render inject \`\`\`ts return null \`\`\` }
      view Conditions() {
        render Leaf() [opacity 80 when pressed, border accent when focused, fg ink when hovered,
          background panel when Sidebar is active, foreground ink when Scheme is Dark]
      }
    `)

    const entries = AST.streamAllContents(result.entry.ast).filter(AST.isLayoutEntry)
    Expect(entries.map(entry => ({
      subject: entry.condition && layoutWordText(entry.condition.subject),
      value: entry.condition?.value && layoutWordText(entry.condition.value),
    }))).toEqual([
      { subject: 'pressed', value: undefined },
      { subject: 'focused', value: undefined },
      { subject: 'hovered', value: undefined },
      { subject: 'Sidebar', value: 'active' },
      { subject: 'Scheme', value: 'Dark' },
    ])
  })

  Test('parses the ID-headed attention journey steps', async () => {
    const result = await testParseCode(`
      app Demo { view Leaf }
      view Leaf() { render inject \`\`\`ts return null \`\`\` }
      test "Attention" {
        test "drives the reducer" {
          run Demo
          press key "primary+p"
          narrow "draft intro"
          expect target "Draft the intro"
          expect focus region "Documents"
          expect verbs "Finish", "Duplicate"
        }
      }
    `)

    const check = AST.streamAllContents(result.entry.ast)
      .filter(AST.isTestDeclaration)
      .find(test => test.block.statements.some(AST.isRunStep))
    Expect.Is(check, AST.isTestDeclaration)
    Expect(check.block.statements.map(statement => statement.$type)).toEqual([
      AST.RunStep.$type,
      AST.PressWordStep.$type,
      AST.InteractionWordStep.$type,
      AST.ExpectInteractionStep.$type,
      AST.ExpectInteractionStep.$type,
      AST.ExpectInteractionStep.$type,
    ])
    const expectations = check.block.statements.filter(AST.isExpectInteractionStep)
    Expect(expectations.map(step => ({ detail: step.detail, subject: step.subject, values: step.values }))).toEqual([
      { detail: undefined, subject: 'target', values: ['Draft the intro'] },
      { detail: 'region', subject: 'focus', values: ['Documents'] },
      { detail: undefined, subject: 'verbs', values: ['Finish', 'Duplicate'] },
    ])
  })
})

/** LayoutWord remains intentionally local to the parser AST; tests read its stable source shape. */
function layoutWordText(word: AST.LayoutWord): string {
  return `${[word.value, ...word.suffixes].join('-')}${
    word.pathSegments.length === 0 ? '' : `.${word.pathSegments.join('.')}`
  }`
}
