import { Type } from '@ast-utils'
import { AST } from '@parser'
import { Describe, Expect, stubContainer, stubView, Test } from '@shared/test'
import { rejectsParser, testParseCode } from './test-parse'

Describe('parser: auth data syntax', () => {
  Test('preserves field boundaries, named value types and singular/plural targets', async () => {
    const result = await testParseCode(`
      type Role is one of Admin, Member
      type DisplayName is text
      data Accounts / Account { DisplayName, Notes, }
      data Notes / Note { Owner Account, Role, State Role?, Body text (default ""), }
    `)
    const entities = result.entry.ast.statements.filter(AST.isEntityDataDeclaration)
    const accountFields = Type.dataFields(entities[0]!)
    const noteFields = Type.dataFields(entities[1]!)
    Expect(accountFields.map(field => field.name)).toEqual(['DisplayName', 'Notes'])
    Expect(noteFields.map(field => field.name)).toEqual(['Owner', 'Role', 'State', 'Body'])
    Expect(noteFields[0]?.typeName).toBe('Account')
    Expect(Type.dataFieldRelationEntity(noteFields[0]!)?.singularName).toBe('Account')
    Expect(Type.dataFieldType(accountFields[1]!).kind).toBe('list')
    Expect(Type.dataFieldType(accountFields[0]!).kind).toBe('primitive')
    Expect(Type.dataFieldType(noteFields[1]!).kind).toBe('enum')
    Expect(noteFields[2]?.optional).toBe(true)
  })

  Test('parses composite uniqueness, assigned queries, actor paths and update fields', async () => {
    const result = await testParseCode(`
      data Accounts / Account { DisplayName text, Notes, }
      data Notes / Note { Owner Account, Body text, Flag boolean, unique Owner + Body, }
      access Account { Account can read Account can update DisplayName }
      access Note { Owner can read, create, delete; Owner can update Body, Flag }
      view Home(Me Account) { query Mine = Me.Notes with { order by Body } query All = Notes }
    `)
    const note = result.entry.ast.statements.filter(AST.isEntityDataDeclaration)[1]!
    Expect(note.block.entries.find(AST.isDataUnique)?.fieldNames).toEqual(['Owner', 'Body'])
    const rules = result.entry.ast.statements.filter(AST.isAccessDeclaration)[1]!.rules
    Expect(rules[0]!.actorPath).toEqual(['Owner'])
    Expect(rules[0]!.grants.map(grant => grant.operation)).toEqual(['read', 'create', 'delete'])
    Expect(rules[1]!.grants[0]!.fields).toEqual(['Body', 'Flag'])
    const view = result.entry.ast.statements.find(AST.isViewDeclaration)!
    const query = view.block!.statements.find(AST.isEntityQueryDeclaration)!
    Expect(query.source?.members).toEqual(['Notes'])
  })

  Test('parses terminal value, predicate, render and effect matches with nested arms', async () => {
    const result = await testParseCode(`
      ${stubContainer('Col')}
      ${stubView('Text', 'Value text')}
      let Enabled = true
      let Label = when Enabled | yes -> when Enabled | no -> "Nested" | otherwise -> "On" | otherwise -> "Off"
      let Predicate = when | Enabled -> "On" | otherwise -> "Off"
      action Save() { }
      action Run() {
        when do Save()
          | saved -> when do Save() | saved -> do Save() | otherwise -> { }
          | error -> Message { do Save() }
          | otherwise -> { }
      }
      view Home() {
        render Col() {
          when Enabled
            | yes -> when Enabled | yes -> Text("On") | otherwise -> Text("Inner")
            | otherwise -> Text("Outer")
          when | Enabled -> Text("Predicate") | otherwise -> { Text("Other") Text("Body") }
        }
      }
    `)
    const matches = AST.streamAllContents(result.entry.ast).filter(AST.isWhenRenderStatement)
    Expect(matches).toHaveLength(3)
    Expect(matches[0]!.branches[0]!.block.statements[0]!.$type).toBe('WhenRenderStatement')
    Expect(matches[2]!.subject).toBeUndefined()
    Expect(matches[2]!.branches[0]!.condition?.$type).toBe('ValueReference')
    const predicateWhen = matches[2]
    Expect.Is(predicateWhen, AST.isWhenRenderStatement)
    Expect.Is(predicateWhen.otherwise, AST.isWhenRenderOtherwise)
    Expect(predicateWhen.otherwise.block.statements).toHaveLength(2)
    const effect = AST.streamAllContents(result.entry.ast).find(AST.isWhenDoStatement)!
    Expect(effect.outcomes.map(outcome => outcome.case)).toEqual(['saved', 'error'])
    Expect(effect.outcomes[0]!.block.statements[0]!.$type).toBe('WhenDoStatement')
    Expect(effect.outcomes[1]!.payload?.name).toBe('Message')
    Expect(effect.otherwise?.block.statements).toEqual([])
  })

  Test('resolves signed-in fixture defaults and anonymous create actors independently', async () => {
    const result = await testParseCode(`
      data Accounts / Account { DisplayName text, }
      data Notes / Note { Owner Account, Body text, }
      fixture Preview {
        account Alice { DisplayName: "Alice" }
        account Bob { DisplayName: "Bob" }
        signed in as Alice
        create Note { Owner: Alice, Body: "Mine" }
        Other = create Note { Owner: Bob, Body: "Theirs" } for Bob
      }
    `)
    const fixture = result.entry.ast.statements.find(AST.isFixtureDeclaration)!
    const actor = fixture.block.entries.find(AST.isFixtureSignedInClause)!
    const anonymous = fixture.block.entries.find(AST.isFixtureCreateStatement)!
    const named = fixture.block.entries.find(AST.isFixtureCreateBinding)!
    Expect(actor.account.ref?.name).toBe('Alice')
    Expect(anonymous.entity.ref?.singularName).toBe('Note')
    Expect(anonymous.account).toBeUndefined()
    Expect(named.account?.ref?.name).toBe('Bob')
  })

  // REMOVAL CANDIDATE: This semantic alias-type check could move to validator coverage; retain until that proof exists.
  Test('resolves positive and negative row completeness aliases as boolean values', async () => {
    const result = await testParseCode(`
      data Accounts / Account { DisplayName text (required "Enter your name"), }
      view Profile(Me Account) {
        let Ready = Me.IsComplete
        let Missing = Me.IsIncomplete
        let Legacy = Me.Incomplete
      }
    `)
    const view = result.entry.ast.statements.find(AST.isViewDeclaration)!
    const reads = view.block!.statements.filter(AST.isAliasDeclaration)
    Expect(reads.map(read => Type.displayName(Type.ofExpression(read.value))))
      .toEqual(['boolean', 'boolean', 'boolean'])
  })

  Test(
    'rejects implicit multi-statement render arms',
    rejectsParser(`
    view Home() { render Col() { when true | yes -> Text("One") Text("Two") | otherwise -> Text("Other") } }
  `),
  )

  Test('requires a terminal fallback for a bar match', rejectsParser('let Choice = when true | yes -> 1'))

  Test('rejects missing commas on one line', rejectsParser('data Notes / Note { Body text Title text }'))
  Test('rejects undelimited command lists', rejectsParser('data Notes / Note { commands Save, Share }'))
})
