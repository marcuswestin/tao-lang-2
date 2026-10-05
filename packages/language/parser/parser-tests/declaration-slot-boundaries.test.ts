import { AST, Parser } from '@parser'
import { Assert, FS, Repo } from '@shared'
import { Describe, Expect, Test } from '@shared/test'
import { rejectsParser, testParseCode } from './test-parse'

const declarations = `
  data Documents / Document { Title text }
  action FinishAction() { }
  command Finish() { Title "Finish" do FinishAction() }
  command Export() { Title "Export" do FinishAction() }
`

function sceneOf(file: AST.TaoFile): AST.ViewDeclaration {
  const scene = file.statements.find(statement =>
    AST.isViewDeclaration(statement) && statement.name === 'DocumentScreen'
  )
  Expect.Is(scene, AST.isViewDeclaration)
  return scene
}

Describe('parser: declaration slot expression boundaries', () => {
  for (const separator of [' ', '\n']) {
    Test(
      `keeps a member-valued fill separate from an adjacent reference block (${JSON.stringify(separator)})`,
      async () => {
        const parsed = await testParseCode(`${declarations}
        scene DocumentScreen(Document) { Title Document.Title${separator}Toolbar { Finish, Export } }
      `)
        const scene = sceneOf(parsed.entry.ast)
        const fills = AST.declarationSlotFillsOf(scene)
        Expect(fills.map(fill => fill.name)).toEqual(['Title', 'Toolbar'])
        const title = fills[0]?.value
        Expect.Is(title, AST.isMemberAccessExpression)
        Expect(title.target.ref).toBe(AST.parametersOf(scene)[0])
        Expect(title.members).toEqual(['Title'])
        const toolbar = fills[1]?.block
        Expect.Is(toolbar, AST.isDeclarationSlotReferenceBlock)
        Expect(toolbar.references.map(reference => reference.ref?.name)).toEqual(['Finish', 'Export'])
      },
    )
  }

  Test('keeps a bare value fill separate from an adjacent reference block', async () => {
    const parsed = await testParseCode(`${declarations}
      scene DocumentScreen(Document, Current text) { Title Current Toolbar { Finish } }
    `)
    const scene = sceneOf(parsed.entry.ast)
    const fills = AST.declarationSlotFillsOf(scene)
    Expect(fills.map(fill => fill.name)).toEqual(['Title', 'Toolbar'])
    Expect.Is(fills[0]?.value, AST.isValueReference)
    Expect(fills[0].value.target.ref).toBe(AST.parametersOf(scene)[1])
  })

  Test('preserves prefix constructors with member, reference, literal and block inputs', async () => {
    const parsed = await testParseCode(`${declarations}
      type Caption is text
      type Settings is { Label text }
      scene DocumentScreen(Document, Current text) {
        Member Caption Document.Title
        Reference Caption Current
        Literal Caption "literal"
        Configured Settings { Label: Current }
        Toolbar { Finish }
      }
    `)
    const fills = AST.declarationSlotFillsOf(sceneOf(parsed.entry.ast))
    Expect(fills.map(fill => fill.name)).toEqual(['Member', 'Reference', 'Literal', 'Configured', 'Toolbar'])
    for (const fill of fills.slice(0, 4)) {
      Expect.Is(fill.value, AST.isConfigurationConstructor)
    }
    const constructors = fills.map(fill => fill.value).filter(AST.isConfigurationConstructor)
    Expect.Is(constructors[0]?.value, AST.isMemberAccessExpression)
    Expect.Is(constructors[1]?.value, AST.isValueReference)
    Expect.Is(constructors[2]?.value, AST.isStringLiteral)
    Expect.Is(constructors[3]?.block, AST.isConfigurationBlock)
  })

  Test('retains lowercase quantity suffixes before adjacent command reference blocks', async () => {
    const parsed = await testParseCode(`${declarations}
      type Duration is numeric with { units { seconds 1 (default) } }
      scene DocumentScreen(Document) { Delay 2 Duration.seconds Toolbar { Finish } }
    `)
    const fills = AST.declarationSlotFillsOf(sceneOf(parsed.entry.ast))
    Expect(fills.map(fill => fill.name)).toEqual(['Delay', 'Toolbar'])
    Expect.Is(fills[0]?.value, AST.isNumericUnitConstruction)
    Expect(fills[0].value.unit.ref?.name).toBe('seconds')
  })

  Test('retains reference and member constructor inputs directly before a reference block', async () => {
    const parsed = await testParseCode(`${declarations}
      type Caption is text
      scene DocumentScreen(Document, Current text) {
        Title Caption Current Toolbar { Finish }
        Heading Caption Document.Title Commands { Export }
      }
    `)
    const fills = AST.declarationSlotFillsOf(sceneOf(parsed.entry.ast))
    Expect(fills.map(fill => fill.name)).toEqual(['Title', 'Toolbar', 'Heading', 'Commands'])
    Expect.Is(fills[0]?.value, AST.isConfigurationConstructor)
    Expect.Is(fills[0].value.value, AST.isValueReference)
    Expect.Is(fills[2]?.value, AST.isConfigurationConstructor)
    Expect.Is(fills[2].value.value, AST.isMemberAccessExpression)
  })

  Test('preserves prefix construction inside an ordinary supplied-slot call argument', async () => {
    const parsed = await testParseCode(`${declarations}
      type Caption is text
      func Echo(Value text) fails never -> text { return Value }
      scene DocumentScreen(Document) { Title Echo(Caption Document.Title) Toolbar { Finish } }
    `)
    const value = AST.declarationSlotFillsOf(sceneOf(parsed.entry.ast))[0]?.value
    Expect.Is(value, AST.isFunctionCallExpression)
    const argument = value.argumentList?.arguments[0]?.value
    Expect.Is(argument, AST.isConfigurationConstructor)
    Expect(argument.type.ref?.name).toBe('Caption')
    Expect.Is(argument.value, AST.isMemberAccessExpression)
  })

  Test(
    'does not admit a declaration reference block inside an unterminated call argument',
    rejectsParser(`
    ${declarations}
    func Echo(Value text) fails never -> text { return Value }
    scene DocumentScreen(Document) { Title Echo(Document.Title Toolbar { Finish }) }
  `),
  )

  Test('preserves a constructor condition before an action callback body', async () => {
    const parsed = await testParseCode(`
      type Flag is boolean
      scene DocumentScreen(Current boolean) { Callback -> { if Flag Current { } } }
    `)
    const condition = [...AST.streamAllContents(parsed.entry.ast)].find(AST.isIfActionStatement)?.condition
    Expect.Is(condition, AST.isConfigurationConstructor)
    Expect(condition.type.ref?.name).toBe('Flag')
    Expect.Is(condition.value, AST.isValueReference)
    Expect(condition.value.target.ref).toBe(AST.parametersOf(sceneOf(parsed.entry.ast))[0])
  })

  Test('parses the actual WordFlower document scene with separate host slot fills', async () => {
    const source = await FS.readText(Repo.resolvePath('Apps/WordFlower/1 - Current/@ui/Documents.tao'))
    const original = sceneOf(Parser.parseSyntax(source).ast)
    const sceneSource = original.$cstNode?.text
    Assert.defined(sceneSource, 'the actual WordFlower document scene has source text')
    const parsed = Parser.parseSyntax(sceneSource)
    Expect(parsed.errors).toBe(0)
    const fills = AST.declarationSlotFillsOf(sceneOf(parsed.ast))
    Expect(fills.map(fill => fill.name)).toEqual(['Title', 'Toolbar'])
    Expect.Is(fills[0]?.value, AST.isMemberAccessExpression)
    Expect.Is(fills[1]?.block, AST.isDeclarationSlotReferenceBlock)
  })

  Test('separates generic supplied slot names after a binary member expression', async () => {
    const parsed = await testParseCode(`${declarations}
      scene DocumentScreen(Document) { Heading "Document: " + Document.Title Commands { Finish } }
    `)
    const fills = AST.declarationSlotFillsOf(sceneOf(parsed.entry.ast))
    Expect(fills.map(fill => fill.name)).toEqual(['Heading', 'Commands'])
    Expect.Is(fills[0]?.value, AST.isBinaryExpression)
    Expect.Is(fills[0].value.right, AST.isMemberAccessExpression)
    Expect.Is(fills[1]?.block, AST.isDeclarationSlotReferenceBlock)
  })

  Test('retains named presentation arguments containing anonymous action callbacks', async () => {
    const parsed = await testParseCode(`
      scene SavedToast(Revert action()) { }
      action Save() {
        present SavedToast(Revert: -> { }) as toast (Key: "document-saved", Duration: 3)
      }
    `)
    const presentation = [...AST.streamAllContents(parsed.entry.ast)].find(AST.isContextualPresentStatement)
    Expect.Is(presentation, AST.isContextualPresentStatement)
    Expect(presentation.argumentList?.arguments[0]?.label).toBe('Revert')
    Expect.Is(presentation.argumentList?.arguments[0]?.value, AST.isActionExpression)
  })
})
