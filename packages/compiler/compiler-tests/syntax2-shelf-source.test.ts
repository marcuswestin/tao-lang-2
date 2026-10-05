import { ASTUtils } from '@ast-utils'
import { AST } from '@parser'
import { Assert, Diagnostics, FS, Repo } from '@shared'
import { Describe, Expect, Test, withTaoFiles } from '@shared/test'
import { Workspace } from '../compiler-src/workspace/workspace'

Describe('actual Syntax2 Shelf source composition', () => {
  Test('validates actual Shelf and GroupedShelf composition while retaining concrete Book inputs', async () => {
    const appRoot = Repo.resolvePath('Apps/Syntax2')
    const sources: Record<string, string> = {}
    for await (
      const path of FS.walk(appRoot, {
        extensions: ['.tao', '.ts', '.tsx'],
        excludeDirectory: name => name.startsWith('_gen') || name === 'node_modules',
      })
    ) {
      if (!path.endsWith('.test.tao')) {
        sources[FS.relativePath(appRoot, path)] = await FS.readText(path)
      }
    }
    sources['Composition.tao'] = `
      use Col from @tao/ui
      use Shelf, GroupedShelf, NumberedBook from ./Shelves
      use Book from ./library/Library
      view Composition(Items list of Book) {
        render Col {
          Shelf(Items) { @item Book, Occurrence -> NumberedBook(Occurrence, Book) }
          GroupedShelf(Items)
        }
      }
    `
    await withTaoFiles('tao-syntax2-shelf-source-', sources, async paths => {
      const validated = await Workspace.validate(paths['Composition.tao']!)
      Expect(Diagnostics.errorMessages(validated.diagnostics)).toEqual([])
      const shelves = validated.files.find(file => file.path.endsWith('/Shelves.tao'))
      Expect(shelves).toBeDefined()
      const shelf = shelves!.ast.statements.find(node => AST.isViewDeclaration(node) && node.name === 'Shelf')
      Expect.Is(shelf, AST.isViewDeclaration)
      const forwarding = [...AST.streamAllContents(shelf)].find(node =>
        AST.isRenderSlotUse(node) && node.forwardedSlot !== undefined
      )
      Expect.Is(forwarding, AST.isRenderSlotUse)
      Assert.defined(validated.associatedEffects, 'validation retains the actual Book Key witness publication')
      ASTUtils.withAssociatedEffects(validated.associatedEffects, () => {
        const comparison = ASTUtils.compareRendererSlotForwarding(forwarding)!
        Expect(comparison.diagnostics.map(diagnostic => diagnostic.kind)).toEqual([])
        const pair = comparison.correspondence.find(pair => pair.required.labelName === 'Item')!
        Expect(pair.required.declaration).toBe(AST.renderSlotParametersOf(forwarding.slot.ref!)[0])
        Expect(pair.supplied.declaration).toBe(AST.renderSlotParametersOf(forwarding.forwardedSlot!.ref!)[0])
        Expect(pair.required.role).toBe('Item')
        Expect(pair.required.type.kind).toBe('entity')
        Expect(pair.supplied.type.kind).toBe('entity')
        if (pair.required.type.kind === 'entity' && pair.supplied.type.kind === 'entity') {
          Expect(pair.required.type.entity).toBe(pair.supplied.type.entity)
          Expect(pair.required.type.entity.singularName).toBe('Book')
        }
      })
    })
  })
})
