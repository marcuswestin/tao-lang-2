import { Workspace } from '@compiler/workspace'
import { AST, Parser } from '@parser'
import { Describe, Expect, Test, withTaoFiles } from '@shared/test'

Describe('parser: declared constructor expression values', () => {
  Test('links shorthand parameters through nested constructor blocks', async () => {
    const parsed = await Parser.parseCode(`
      type RowKey is text
      type HeaderLabel is text
      type GroupHeader is { HeaderLabel }
      type GroupedRow is { RowKey, Content GroupHeader }
      type RowFactory is { } with {
        func Header(RowKey, HeaderLabel) fails never {
          return GroupedRow { RowKey, Content: GroupHeader { HeaderLabel } }
        }
      }
    `, { validation: false })

    Expect(parsed.diagnostics).toEqual([])
    const method = [...AST.streamAllContents(parsed.entry.ast)].find(AST.isAssociatedFunctionDeclaration)
    Expect.Is(method, AST.isAssociatedFunctionDeclaration)
    const parameters = method.parameterList.parameters
    const entries = [...AST.streamAllContents(method)].filter(AST.isConfigurationEntry)
    const key = entries.find(entry => entry.reference?.$refText === 'RowKey')
    const label = entries.find(entry => entry.reference?.$refText === 'HeaderLabel')
    Expect(key?.reference?.ref).toBe(parameters[0])
    Expect(label?.reference?.ref).toBe(parameters[1])
  })

  Test('links the imported grouped-row Header builder to its actual parameters', async () => {
    await withTaoFiles('tao-grouped-row-header-links-', {
      'Main.tao': `
        use Book from ./Library
        use RenderKey, ui from @tao/ui
        public type RowKey is RenderKey
        public type HeaderLabel is text
        public type GroupHeader is { HeaderLabel } with {
          view Render() { render "{GroupHeader.HeaderLabel}" [caption] }
        }
        public type GroupedRow is { RowKey, Content ui } with {
          func Key() fails never -> RenderKey { return GroupedRow.RowKey }
          view Render() { render GroupedRow.Content }
        }
        can RowBuilders {
          Header(RowKey, HeaderLabel) fails never -> GroupedRow
          BookRow(RowKey, Book) fails never -> GroupedRow
        }
        type RowFactory is { } with {
          func Header(RowKey, HeaderLabel) fails never {
            return GroupedRow { RowKey, Content: GroupHeader { HeaderLabel } }
          }
          func BookRow(RowKey, Book) fails never {
            return GroupedRow { RowKey, Content: Book }
          }
        }
        public func GroupedRows(Items list of Book) fails never -> list of GroupedRow {
          return BuildRows(Items, RowFactory { })
        }
        func BuildRows(Items list of Book, Builders RowBuilders) fails never -> list of GroupedRow {
          return GroupedRows(Items, Builders) from ./GroupedRows.ts
        }
      `,
      'Library.tao': `
        public data People / Person { Name text }
        public data Books / Book {
          Title text,
          Author Person?,
          view Book.Render() { render BookCard(Book.Title) }
        }
        view BookCard(Title text) from ./BookCard.tsx
      `,
      'BookCard.tsx': 'export function BookCard() { return null }',
      'GroupedRows.ts': 'export default function GroupedRows() { return [] }',
    }, async paths => {
      const parsed = await Workspace.parse(paths['Main.tao']!)
      Expect(parsed.diagnostics).toEqual([])
      const factory = parsed.entry.ast.statements.find(statement =>
        AST.isTypeDeclaration(statement) && statement.name === 'RowFactory'
      )
      Expect.Is(factory, AST.isTypeDeclaration)
      const header = factory.associated?.methods.find(method => method.name === 'Header')
      Expect.Is(header, AST.isAssociatedFunctionDeclaration)
      Expect(AST.associatedFunctionOwner(header)).toBe(factory)
      const shorthand = [...AST.streamAllContents(header)].filter(AST.isConfigurationEntry)
        .find(entry => entry.reference?.$refText === 'HeaderLabel')
      Expect.Is(shorthand, AST.isConfigurationEntry)
      Expect(shorthand.reference?.ref).toBe(header.parameterList.parameters[1])
      Expect(shorthand.reference?.error).toBeUndefined()
    })
  })

  Test(
    'links value, member, interpolation and grouped-expression payloads without consuming call delimiters',
    async () => {
      const parsed = await Parser.parseCode(
        `
        type Person is text
        type Subtitle is text
        type Title is text
        type Right is number
        type IsReturned is boolean
        let Person = "Ada"
        let Cool = 4
        let Book = { Returned: true }
        let Arg = "arg"
        let Value = "value"
        func Banner(Top text, Heading text) -> text { return "" }
        func Earlier(Value number) -> number { return Value }
        func Identity(Input text) -> text { return Input }
        let BannerValues = Banner(Subtitle Person, Title "Library")
        let BannerInterpolated = Banner(Subtitle "{Person}", Title "Library")
        let BannerGrouped = Banner(.Subtitle (Person + Person), .Title "Library")
        let BannerUnwrapped = Banner(Subtitle Person + Person, Title "Library")
        let EarlierValue = Earlier(.Right Cool)
        let ReturnedValue = IsReturned Book.Returned
        let IdentityValue = Identity(Value)
        let MethodValue = Value.Method(Arg)
        can Ordered { Compare(Other type) -> number }
      `,
        { validation: false },
      )

      Expect(parsed.entry.document.parseResult.lexerErrors).toEqual([])
      Expect(parsed.entry.document.parseResult.parserErrors).toEqual([])
      const ast = parsed.entry.ast
      const alias = (name: string): AST.AliasDeclaration => {
        const declaration = ast.statements.find(statement =>
          AST.isAliasDeclaration(statement) && statement.name === name
        )
        Expect.Is(declaration, AST.isAliasDeclaration)
        return declaration
      }

      const bannerValues = alias('BannerValues').value
      Expect.Is(bannerValues, AST.isFunctionCallExpression)
      Expect(bannerValues.function.ref?.name).toBe('Banner')
      const firstBannerArgument = bannerValues.argumentList?.arguments[0]?.value
      Expect.Is(firstBannerArgument, AST.isConfigurationConstructor)
      Expect(firstBannerArgument.type.ref?.name).toBe('Subtitle')
      Expect.Is(firstBannerArgument.value, AST.isValueReference)
      const personTarget = firstBannerArgument.value.target.ref
      Expect.Is(personTarget, AST.isAliasDeclaration)
      Expect(personTarget.name).toBe('Person')
      const secondBannerArgument = bannerValues.argumentList?.arguments[1]?.value
      Expect.Is(secondBannerArgument, AST.isConfigurationConstructor)
      Expect(secondBannerArgument.type.ref?.name).toBe('Title')
      Expect.Is(secondBannerArgument.value, AST.isStringLiteral)

      const interpolated = alias('BannerInterpolated').value
      Expect.Is(interpolated, AST.isFunctionCallExpression)
      const interpolationArgument = interpolated.argumentList?.arguments[0]?.value
      Expect.Is(interpolationArgument, AST.isConfigurationConstructor)
      Expect.Is(interpolationArgument.value, AST.isInterpolatedString)

      const grouped = alias('BannerGrouped').value
      Expect.Is(grouped, AST.isFunctionCallExpression)
      const groupedArgument = grouped.argumentList?.arguments[0]?.value
      Expect.Is(groupedArgument, AST.isConfigurationConstructor)
      Expect(groupedArgument.relative).toBe(true)
      Expect(groupedArgument.type.$refText).toBe('Subtitle')
      Expect.Is(groupedArgument.value, AST.isBinaryExpression)
      Expect.Is(groupedArgument.value.left, AST.isValueReference)
      const groupedPersonTarget = groupedArgument.value.left.target.ref
      Expect.Is(groupedPersonTarget, AST.isAliasDeclaration)
      Expect(groupedPersonTarget.name).toBe('Person')

      const unwrapped = alias('BannerUnwrapped').value
      Expect.Is(unwrapped, AST.isFunctionCallExpression)
      const unwrappedArgument = unwrapped.argumentList?.arguments[0]?.value
      Expect.Is(unwrappedArgument, AST.isBinaryExpression)
      Expect.Is(unwrappedArgument.left, AST.isConfigurationConstructor)
      Expect.Is(unwrappedArgument.left.value, AST.isValueReference)
      const unwrappedPersonTarget = unwrappedArgument.left.value.target.ref
      Expect.Is(unwrappedPersonTarget, AST.isAliasDeclaration)
      Expect(unwrappedPersonTarget.name).toBe('Person')
      Expect(unwrapped.argumentList?.arguments).toHaveLength(2)

      const earlier = alias('EarlierValue').value
      Expect.Is(earlier, AST.isFunctionCallExpression)
      Expect(earlier.function.ref?.name).toBe('Earlier')
      const relativeConstructor = earlier.argumentList?.arguments[0]?.value
      Expect.Is(relativeConstructor, AST.isConfigurationConstructor)
      Expect(relativeConstructor.relative).toBe(true)
      Expect(relativeConstructor.type.$refText).toBe('Right')
      Expect.Is(relativeConstructor.value, AST.isValueReference)
      const coolTarget = relativeConstructor.value.target.ref
      Expect.Is(coolTarget, AST.isAliasDeclaration)
      Expect(coolTarget.name).toBe('Cool')

      const returned = alias('ReturnedValue').value
      Expect.Is(returned, AST.isConfigurationConstructor)
      Expect(returned.type.ref?.name).toBe('IsReturned')
      Expect.Is(returned.value, AST.isMemberAccessExpression)
      const bookTarget = returned.value.target.ref
      Expect.Is(bookTarget, AST.isAliasDeclaration)
      Expect(bookTarget.name).toBe('Book')
      Expect(returned.value.members).toEqual(['Returned'])

      const identity = alias('IdentityValue').value
      Expect.Is(identity, AST.isFunctionCallExpression)
      Expect(identity.function.ref?.name).toBe('Identity')
      const method = alias('MethodValue').value
      Expect.Is(method, AST.isMethodCallExpression)
      Expect.Is(method.callee, AST.isMemberAccessExpression)
      const methodTarget = method.callee.target.ref
      Expect.Is(methodTarget, AST.isAliasDeclaration)
      Expect(methodTarget.name).toBe('Value')
      Expect(method.argumentList?.arguments).toHaveLength(1)

      const ordered = ast.statements.find(statement => AST.isTypeDeclaration(statement) && statement.name === 'Ordered')
      Expect.Is(ordered, AST.isTypeDeclaration)
      Expect.Is(ordered.type, AST.isCapabilityTypeExpression)
      const contextualType = ordered.type.methods[0]?.parameterList.parameters[0]?.inlineType?.type
      Expect.Is(contextualType, AST.isNamedTypeReference)
      Expect(contextualType.root).toBe('type')
    },
  )
})
