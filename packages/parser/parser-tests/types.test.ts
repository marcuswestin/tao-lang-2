import { AST } from '@parser'
import { Describe, Expect, Test } from '@shared/test'
import { testParseCode } from './test-parse'

Describe('parser: types', () => {
  Test('parses type declarations, constructors, lists, and member access', async () => {
    const parseResult = await testParseCode(`
      type Name is text
      type Tags is list
      type Job is {
        Title is text
      }
      type Person is {
        Name
        Tags
        Job
      }

      let DisplayName = Name "Ada"
      let DemoTags = Tags ["types", "items"]
      let DemoJob = Job { Title: "Compiler engineer" }
      let DemoPerson = Person { Name: DisplayName, Tags: DemoTags, Job: DemoJob }

      view Profile Person {
        render Text(Person.Job.Title)
      }
      view Text Value is text { }
    `)

    Expect(parseResult.diagnostics).toEqual([])
    const [nameType, tagsType, jobType, personType] = parseResult.entry.ast.statements.filter(AST.isTypeDeclaration)
    Expect.Is(nameType, AST.isTypeDeclaration)
    Expect.Is(tagsType, AST.isTypeDeclaration)
    Expect.Is(jobType, AST.isTypeDeclaration)
    Expect.Is(personType, AST.isTypeDeclaration)
    Expect(nameType?.name).toBe('Name')
    Expect(tagsType?.name).toBe('Tags')
    Expect.Is(jobType.type, AST.isItemTypeExpression)
    Expect.Is(personType.type, AST.isItemTypeExpression)

    const [displayName, demoTags, demoJob, demoPerson] = parseResult.entry.ast.statements.filter(AST.isAliasDeclaration)
    Expect.Is(displayName, AST.isAliasDeclaration)
    Expect.Is(demoTags, AST.isAliasDeclaration)
    Expect.Is(demoJob, AST.isAliasDeclaration)
    Expect.Is(demoPerson, AST.isAliasDeclaration)
    Expect.Is(displayName.value, AST.isConfigurationConstructor)
    Expect(displayName.value.type.ref).toBe(nameType)
    Expect.Is(displayName.value.value, AST.isStringLiteral)
    Expect.Is(demoTags.value, AST.isConfigurationConstructor)
    Expect(demoTags.value.type.ref).toBe(tagsType)
    Expect.Is(demoTags.value.value, AST.isListLiteral)
    Expect.Is(demoJob.value, AST.isConfigurationConstructor)
    Expect(demoJob.value.type.ref).toBe(jobType)
    Expect(demoJob.value.block?.entries.map(entry => entry.label)).toEqual(['Title'])
    Expect.Is(demoPerson.value, AST.isConfigurationConstructor)
    Expect(demoPerson.value.type.ref).toBe(personType)
    Expect(demoPerson.value.block?.entries.map(entry => entry.label)).toEqual(['Name', 'Tags', 'Job'])

    const profile = parseResult.entry.ast.statements.find(
      statement => AST.isViewDeclaration(statement) && statement.name === 'Profile',
    )
    Expect.Is(profile, AST.isViewDeclaration)
    const render = AST.blockStatementOf(profile, 0)
    Expect.Is(render, AST.isRenderStatement)
    const argument = AST.argumentsOf(render)[0]?.value
    Expect.Is(argument, AST.isMemberAccessExpression)
    Expect(argument.members).toEqual(['Job', 'Title'])
  })

  Test('parses nested item property blocks from their declaration-owned property shape', async () => {
    const parseResult = await testParseCode(`
      type Job is {
        Title is text
      }
      type Profile is {
        Role is Job
      }
      let DemoProfile = Profile { Role { Title "Compiler engineer" } }
      view MainView { }
    `)

    Expect(parseResult.diagnostics).toEqual([])
    const profile = parseResult.entry.ast.statements.find(
      statement => AST.isTypeDeclaration(statement) && statement.name === 'Profile',
    )
    const alias = parseResult.entry.ast.statements.find(
      statement => AST.isAliasDeclaration(statement) && statement.name === 'DemoProfile',
    )
    Expect.Is(profile, AST.isTypeDeclaration)
    Expect.Is(profile.type, AST.isItemTypeExpression)
    Expect.Is(alias, AST.isAliasDeclaration)
    Expect.Is(alias.value, AST.isConfigurationConstructor)
    Expect(alias.value.type.ref).toBe(profile)
    const profileRole = profile.type.properties[0]
    Expect.Is(profileRole?.type, AST.isNamedTypeReference)
    Expect(profileRole.type.root).toBe('Job')
    const role = alias.value.block?.entries[0]
    Expect.Is(role, AST.isConfigurationEntry)
    Expect(role.name).toBe('Role')
    const title = role.block?.entries[0]
    Expect.Is(title, AST.isConfigurationEntry)
    Expect(title.name).toBe('Title')
    Expect.Is(title.value, AST.isStringLiteral)
  })
})
