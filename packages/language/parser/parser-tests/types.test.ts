import { AST } from '@parser'
import { Describe, Expect, Test } from '@shared/test'
import { testParseCode } from './test-parse'

Describe('parser: types', () => {
  Test('parses projected input types and typed copies', async () => {
    const parseResult = await testParseCode(`
      data Documents / Document { Title text, Body text, Owner text, CreatedAt time }
      type DocumentInput is Document { Title, Body }
      type Editable is Document without { Owner, CreatedAt }
      view Editor(Document) {
        state Input = copy Document as DocumentInput
      }
    `)

    const [input, editable] = parseResult.entry.ast.statements.filter(AST.isTypeDeclaration)
    Expect.Is(input, AST.isTypeDeclaration)
    Expect.Is(editable, AST.isTypeDeclaration)
    Expect.Is(input.type, AST.isProjectedItemTypeExpression)
    Expect.Is(editable.type, AST.isProjectedItemTypeExpression)
    Expect(input.type.fields).toEqual(['Title', 'Body'])
    Expect(editable.type.excludedFields).toEqual(['Owner', 'CreatedAt'])
    const editor = parseResult.entry.ast.statements.find(AST.isViewDeclaration)
    Expect.Is(editor, AST.isViewDeclaration)
    const state = AST.blockStatementOf(editor, 0)
    Expect.Is(state, AST.isStateDeclaration)
    Expect.Is(state.value, AST.isCopyExpression)
    Expect.Is(state.value.type, AST.isNamedTypeReference)
    Expect(state.value.type.root).toBe('DocumentInput')
  })

  Test('parses type declarations, constructors, lists, and member access', async () => {
    const parseResult = await testParseCode(`
      type Name is text
      type Tags is list of text
      type Job is {
        Title text,
      }
      type Person is {
        Name,
        Tags,
        Job,
      }

      let DisplayName = Name "Ada"
      let DemoTags = Tags ["types", "items"]
      let DemoJob = Job { Title: "Compiler engineer" }
      let DemoPerson = Person { Name: DisplayName, Tags: DemoTags, Job: DemoJob }

      view Profile(Person) {
        render Text(Person.Job.Title)
      }
      view Text(Value text) { }
    `)

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
        Title text,
      }
      type Profile is {
        Role Job,
      }
      let DemoProfile = Profile { Role { Title "Compiler engineer" } }
      view MainView() { }
    `)

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

  Test('parses space-separated slots, shorthand names, defaults, and fills', async () => {
    const parseResult = await testParseCode(`
      type Age is number
      type Profile is {
        Name text,
        Age,
        Header view is none,
        implement is "./Profile.ts",
      }
      view MainView() { }
    `)

    const profile = parseResult.entry.ast.statements.find(
      statement => AST.isTypeDeclaration(statement) && statement.name === 'Profile',
    )
    Expect.Is(profile, AST.isTypeDeclaration)
    Expect.Is(profile.type, AST.isItemTypeExpression)
    const [name, age, header, implementation] = profile.type.properties
    Expect(name?.name).toBe('Name')
    Expect.Is(name?.type, AST.isPrimitiveTypeReference)
    Expect(age?.name).toBe('Age')
    Expect(age?.type).toBeUndefined()
    Expect.Is(header?.type, AST.isPrimitiveTypeReference)
    Expect.Is(header?.value, AST.isNoneLiteral)
    Expect(implementation?.type).toBeUndefined()
    Expect.Is(implementation?.value, AST.isStringLiteral)
  })

  Test('parses derived slot types, inferred bare blocks, and generic value patches', async () => {
    const parseResult = await testParseCode(`
      type Person is { Name text, Role text }
      type Admin is Person with { Role is "admin", Access number }
      let Admin = { Name "the Developer", Access 3 }
      let Renamed = Admin with { Name "Grace" }
      view MainView() { }
    `)

    const adminType = parseResult.entry.ast.statements.find(
      statement => AST.isTypeDeclaration(statement) && statement.name === 'Admin',
    )
    const aliases = parseResult.entry.ast.statements.filter(AST.isAliasDeclaration)
    Expect.Is(adminType, AST.isTypeDeclaration)
    Expect.Is(adminType.type, AST.isDerivedTypeExpression)
    Expect.Is(adminType.type.base, AST.isNamedTypeReference)
    Expect(adminType.type.base.root).toBe('Person')
    Expect(adminType.type.slots.properties.map(property => property.name)).toEqual(['Role', 'Access'])
    Expect.Is(aliases[0]?.value, AST.isInferredConfigurationConstructor)
    const renamedValue = aliases[1]?.value
    Expect.Is(renamedValue, AST.isRefinementExpression)
    Expect(renamedValue.target.ref).toBe(aliases[0])
  })
})
