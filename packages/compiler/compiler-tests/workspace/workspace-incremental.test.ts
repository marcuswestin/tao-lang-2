import { Type } from '@ast-utils'
import { AST, Parser, type ParseResult, URI } from '@parser'
import { Diagnostics, FS } from '@shared'
import { Describe, Expect, Test, withTaoFiles } from '@shared/test'
import Validator from '@validator'
import { Workspace } from '../../compiler-src/workspace/index'
import { createWorkspaceServices } from '../../compiler-src/workspace/langium-services'
import { createProjectContext, refreshProjectContext } from '../../compiler-src/workspace/workspace-utils'

async function expectCurrentGraph(
  workspace: Workspace,
  entry: string,
  sourceOverrides: Readonly<Record<string, string>> = {},
) {
  const warm = await workspace.validate(entry)
  const cold = await (await Workspace.open(workspace.root, { sourceOverrides })).validate(entry)
  Expect(warm.diagnostics).toEqual(cold.diagnostics)
  const sources = (result: ParseResult) => result.files.map(file => [file.path, file.document.textDocument.getText()])
  Expect(sources(warm)).toEqual(sources(cold))
  return warm
}

Describe('workspace incremental document lifecycle', () => {
  Test('compares current disk topology with its disk baseline and retains physical invalidation', async () => {
    await withTaoFiles('tao-workspace-disk-topology-', {
      '.tao/.gitkeep': '',
      'Main.tao': 'use Shared from @values/linked\nlet Result = Shared',
      '@values/inside/Shared.tao': 'project let Shared = "same"',
      'outside/Shared.tao': 'project let Shared = "same"',
    }, async (paths, root) => {
      const link = FS.resolvePath('@values/linked', root)
      await FS.symlink(FS.dirname(paths['@values/inside/Shared.tao']), link)
      const project = await createProjectContext(root, createWorkspaceServices)
      const parse = () =>
        Parser.parse(
          Parser.createContextFromServices(project.services.packages, project.services),
          URI.file(paths['Main.tao']),
          { validation: false },
        )
      const first = await parse()
      Expect(first.diagnostics).toEqual([])
      await Validator.validateParseResult(
        first,
        Validator.createContext(
          project.packagesContext,
          first.files.map(file => file.ast),
          first.entry.path,
        ),
      )
      Expect(project.packagesContext.index.projectRoots).toContain(project.packagesContext.stdlibRoot)
      Expect(project.packagesContext.physicalPaths.size).toBeGreaterThan(0)
      Expect(await refreshProjectContext(project)).toBe(false)
      await parse()
      Expect(await refreshProjectContext(project)).toBe(false)
      await FS.writeText(FS.resolvePath('@added/Value.tao', root), 'project let Added = "new"')
      Expect(await refreshProjectContext(project)).toBe(true)
      Expect(await refreshProjectContext(project)).toBe(false)
      await parse()
      await FS.remove(link)
      await FS.symlink(FS.dirname(paths['outside/Shared.tao']), link)
      Expect(await refreshProjectContext(project)).toBe(true)
    })
  })

  Test('refreshes inferred consumer types when an imported function changes its return type', async () => {
    for (const namedReturn of [false, true]) {
      const echoSource = (primitive: string, value: string) =>
        namedReturn
          ? `public type Output is ${primitive}\npublic function Echo() returns Output { return ${value} }`
          : `public function Echo() returns ${primitive} { return ${value} }`
      await withTaoFiles('tao-workspace-reuse-return-type-', {
        'Main.tao': `
          use Echo from ./library/Echo
          let Result = Echo()
          view Home() { render inject \`\`\`ts return null \`\`\` }
          app Demo { id "com.tao.returntype" version "1.0.0" name "Return type" view Home }
        `,
        'library/Echo.tao': echoSource('text', '"before"'),
      }, async (paths, root) => {
        const workspace = await Workspace.open(root)
        const resultType = (parsed: ParseResult) => {
          const result = parsed.entry.ast.statements.find(statement =>
            AST.isAliasDeclaration(statement) && statement.name === 'Result'
          )
          Expect.Is(result, AST.isAliasDeclaration)
          Expect.Is(result.value, AST.isFunctionCallExpression)
          const inferred = Type.ofExpression(result.value)
          Expect(inferred.kind).toBe('primitive')
          if (inferred.kind === 'primitive') {
            Expect(inferred.nominal ? Type.definitionName(inferred.nominal) : undefined)
              .toBe(namedReturn ? 'Output' : undefined)
            return inferred.primitive
          }
          return undefined
        }
        const before = await expectCurrentGraph(workspace, paths['Main.tao'])
        Expect(before.diagnostics).toEqual([])
        Expect(resultType(before)).toBe('text')
        const beforeCompile = await workspace.compile(paths['Main.tao'], { studio: true })

        await FS.writeText(paths['library/Echo.tao'], echoSource('number', '7'))
        const warm = await expectCurrentGraph(workspace, paths['Main.tao'])
        Expect(warm.diagnostics).toEqual([])
        Expect(warm.entry.document === before.entry.document).toBe(true)
        Expect(resultType(warm)).toBe('number')
        const coldWorkspace = await Workspace.open(root)
        const cold = await coldWorkspace.validate(paths['Main.tao'])
        Expect(resultType(cold)).toBe('number')
        Expect(warm.diagnostics).toEqual(cold.diagnostics)
        const warmCompile = await workspace.compile(paths['Main.tao'], { studio: true })
        const coldCompile = await coldWorkspace.compile(paths['Main.tao'], { studio: true })
        const emitted = (result: typeof warmCompile) => result.files.map(file => [file.relativePath, file.code])
        Expect(emitted(warmCompile)).toEqual(emitted(coldCompile))
        Expect(emitted(warmCompile)).not.toEqual(emitted(beforeCompile))
        Expect(warmCompile.files.some(file => file.sourcePath === paths['library/Echo.tao'])).toBe(true)
      })
    }
  })

  Test('relinks retained imports after declaration removal and recovery', async () => {
    await withTaoFiles('tao-workspace-reuse-imports-', {
      'Main.tao': 'use Shared from ./library/Shared\nlet Result = Shared',
      'library/Shared.tao': 'public let Shared = "before"',
    }, async (paths, root) => {
      const workspace = await Workspace.open(root)
      const before = await expectCurrentGraph(workspace, paths['Main.tao'])
      Expect(before.diagnostics).toEqual([])
      await FS.writeText(paths['library/Shared.tao'], 'public let Other = "removed"')
      const removed = await expectCurrentGraph(workspace, paths['Main.tao'])
      Expect(removed.entry.document === before.entry.document).toBe(true)
      Expect(Diagnostics.errorMessages(removed.diagnostics).join('\n')).toContain('Shared')
      await FS.writeText(paths['library/Shared.tao'], 'public let Shared = "recovered"')
      const recovered = await expectCurrentGraph(workspace, paths['Main.tao'])
      Expect(recovered.diagnostics).toEqual([])
      Expect(recovered.entry.document === before.entry.document).toBe(true)
    })
  })

  Test('refreshes implicit folder type visibility after sibling addition and deletion', async () => {
    await withTaoFiles('tao-workspace-reuse-folder-', {
      'Main.tao': 'use Entry from ./feature/Entry\nlet Result = Entry("value")',
      'feature/Entry.tao': 'public function Entry(Value Label) returns text { return Value }',
    }, async (paths, root) => {
      const workspace = await Workspace.open(root)
      const before = await expectCurrentGraph(workspace, paths['Main.tao'])
      Expect(Diagnostics.errorMessages(before.diagnostics).join('\n')).toContain('Label')
      const sibling = FS.resolvePath('feature/Label.tao', root)
      await FS.writeText(sibling, 'folder type Label is text')
      const added = await expectCurrentGraph(workspace, paths['Main.tao'])
      Expect(added.diagnostics).toEqual([])
      Expect(added.entry.document === before.entry.document).toBe(true)
      Expect(added.files.map(file => file.path)).toContain(sibling)
      await FS.remove(sibling)
      const deleted = await expectCurrentGraph(workspace, paths['Main.tao'])
      Expect(Diagnostics.errorMessages(deleted.diagnostics).join('\n')).toContain('Label')
      Expect(deleted.files.map(file => file.path)).not.toContain(sibling)
    })
  })

  Test('revalidates unused wildcard collisions after exports change', async () => {
    await withTaoFiles('tao-workspace-reuse-wildcard-', {
      'Main.tao': 'use all from ./library/Library\nlet Added = "local"',
      'library/Library.tao': 'public let Other = "before"',
    }, async (paths, root) => {
      const workspace = await Workspace.open(root)
      const before = await expectCurrentGraph(workspace, paths['Main.tao'])
      Expect(before.diagnostics).toEqual([])
      await FS.writeText(paths['library/Library.tao'], 'public let Added = "collision"')
      const collision = await expectCurrentGraph(workspace, paths['Main.tao'])
      Expect(collision.entry.document === before.entry.document).toBe(true)
      Expect(Diagnostics.errorMessages(collision.diagnostics).join('\n')).toContain('Added')
      await FS.writeText(paths['library/Library.tao'], 'public let Other = "after"')
      Expect((await expectCurrentGraph(workspace, paths['Main.tao'])).diagnostics).toEqual([])
    })
  })

  Test('refreshes packages added or removed after the workspace opens', async () => {
    await withTaoFiles('tao-workspace-reuse-topology-', {
      'Main.tao': 'use Shared from @added\nlet Result = Shared',
    }, async (paths, root) => {
      const workspace = await Workspace.open(root)
      const before = await expectCurrentGraph(workspace, paths['Main.tao'])
      Expect(Diagnostics.errorMessages(before.diagnostics).join('\n')).toContain('Shared')
      const module = FS.resolvePath('@added/Shared.tao', root)
      await FS.writeText(module, 'project let Shared = "added"')
      const added = await expectCurrentGraph(workspace, paths['Main.tao'])
      Expect(added.diagnostics).toEqual([])
      Expect(added.entry.document === before.entry.document).toBe(true)
      await FS.remove(FS.dirname(module))
      const removed = await expectCurrentGraph(workspace, paths['Main.tao'])
      Expect(Diagnostics.errorMessages(removed.diagnostics).join('\n')).toContain('Shared')
      Expect(removed.files.map(file => file.path)).not.toContain(module)
    })
  })

  Test('refreshes requirement bindings and drops a former publication graph', async () => {
    const main = (locator: string) => `
      use Shared from @values
      package { version 1.0.0 license AGPL-3.0-only
        requires "Values" from ${locator} version ^1.0.0 { @data as @values }
      }
      let Result = Shared
    `
    await withTaoFiles('tao-workspace-reuse-requirements-', {
      'Main.tao': main('./First'),
      'First/.tao/.gitkeep': '',
      'First/Publication.tao': 'package { name "Values" version 1.0.0 license AGPL-3.0-only includes @data }',
      'First/@data/Shared.tao': 'public let Shared = "first"',
      'Second/.tao/.gitkeep': '',
      'Second/Publication.tao': 'package { name "Values" version 1.0.0 license AGPL-3.0-only includes @data }',
      'Second/@data/Shared.tao': 'public let Shared = "second"',
    }, async (paths, root) => {
      const workspace = await Workspace.open(root)
      const before = await expectCurrentGraph(workspace, paths['Main.tao'])
      Expect(before.diagnostics).toEqual([])
      Expect(before.files.map(file => file.path)).toContain(paths['First/@data/Shared.tao'])
      await FS.writeText(paths['Main.tao'], main('./Second'))
      const after = await expectCurrentGraph(workspace, paths['Main.tao'])
      Expect(after.diagnostics).toEqual([])
      Expect(after.files.map(file => file.path)).toContain(paths['Second/@data/Shared.tao'])
      Expect(after.files.map(file => file.path)).not.toContain(paths['First/@data/Shared.tao'])
    })
  })

  Test('refreshes physical import boundaries when a symlink changes with identical text', async () => {
    await withTaoFiles('tao-workspace-reuse-physical-', {
      'Main.tao': 'use Shared from @values/linked\nlet Result = Shared',
      '@values/inside/Shared.tao': 'project let Shared = "same"',
      'outside/Shared.tao': 'project let Shared = "same"',
    }, async (paths, root) => {
      const link = FS.resolvePath('@values/linked', root)
      await FS.symlink(FS.dirname(paths['@values/inside/Shared.tao']), link)
      const workspace = await Workspace.open(root)
      const valid = await expectCurrentGraph(workspace, paths['Main.tao'])
      Expect(valid.diagnostics).toEqual([])
      // The outside target cannot become visible merely because its text matches the retained AST.
      await FS.remove(link)
      await FS.symlink(FS.dirname(paths['outside/Shared.tao']), link)
      const escaped = await expectCurrentGraph(workspace, paths['Main.tao'])
      Expect(escaped.entry.document === valid.entry.document).toBe(true)
      Expect(Diagnostics.errorMessages(escaped.diagnostics).join('\n')).toContain('Shared')
      await FS.remove(link)
      await FS.symlink(FS.dirname(paths['@values/inside/Shared.tao']), link)
      Expect((await expectCurrentGraph(workspace, paths['Main.tao'])).diagnostics).toEqual([])
    })
  })

  Test('refreshes project ownership after a nested project marker appears', async () => {
    await withTaoFiles('tao-workspace-reuse-owner-', {
      'Main.tao': 'use Shared from ./feature/Shared\nlet Result = Shared',
      'feature/Shared.tao': 'project let Shared = "same"',
    }, async (paths, root) => {
      const workspace = await Workspace.open(root)
      const before = await expectCurrentGraph(workspace, paths['Main.tao'])
      Expect(before.diagnostics).toEqual([])
      const marker = FS.resolvePath('feature/.tao/.gitkeep', root)
      await FS.writeText(marker, '')
      const separated = await expectCurrentGraph(workspace, paths['Main.tao'])
      Expect(Diagnostics.errorMessages(separated.diagnostics).join('\n')).toContain('Shared')
      Expect(separated.entry.document === before.entry.document).toBe(true)
      await FS.remove(FS.dirname(marker))
      Expect((await expectCurrentGraph(workspace, paths['Main.tao'])).diagnostics).toEqual([])
    })
  })

  Test('replaces immutable virtual snapshots and returns to disk source', async () => {
    await withTaoFiles('tao-workspace-reuse-overlays-', {
      'Main.tao': 'let Result = Shared',
    }, async (paths, root) => {
      const workspace = await Workspace.open(root)
      const virtual = FS.resolvePath('Sibling.tao', root)
      const overrides = { [virtual]: 'folder let Shared = "virtual"' }
      await workspace.setSourceOverrides(overrides)
      overrides[virtual] = 'invalid source'
      const loaded = await expectCurrentGraph(workspace, paths['Main.tao'], {
        [virtual]: 'folder let Shared = "virtual"',
      })
      Expect(loaded.diagnostics).toEqual([])
      const replacement = { [virtual]: 'folder let Shared = "replacement"' }
      await workspace.setSourceOverrides(replacement)
      const replaced = await expectCurrentGraph(workspace, paths['Main.tao'], replacement)
      Expect(replaced.entry.document === loaded.entry.document).toBe(true)
      Expect(replaced.files.find(file => file.path === virtual)?.document.textDocument.getText())
        .toBe('folder let Shared = "replacement"')
      await workspace.setSourceOverrides({})
      const ordinary = await expectCurrentGraph(workspace, paths['Main.tao'])
      Expect(Diagnostics.errorMessages(ordinary.diagnostics).join('\n')).toContain('Shared')
      Expect(ordinary.files.map(file => file.path)).not.toContain(virtual)
      await Expect(workspace.setSourceOverrides({ '../Escape.tao': '' })).rejects.toThrow('inside the workspace root')
      await FS.symlink(FS.dirname(root), FS.resolvePath('escape', root))
      await Expect(workspace.setSourceOverrides({ 'escape/Virtual.tao': '' })).rejects.toThrow('physically inside')
    })
  })

  Test('refreshes implicit mounted design colors without replacing the consumer', async () => {
    await withTaoFiles('tao-workspace-reuse-mounted-design-', {
      'Main.tao': `
        use StackNav from @tao/nav
        use Home from @ui
        app Demo { id "com.tao.incremental" version "1.0.0" name "Demo"
          Navigator StackNav { Initial Home } Design Theme }
        design Theme { colors { paper #fff } }
      `,
      '@ui/Home.tao': `
        public view Home() { render Badge(Tint: paper) }
        view Badge(Tint color) { render inject \`\`\`ts return null \`\`\` }
      `,
    }, async (paths, root) => {
      const workspace = await Workspace.open(root)
      const before = await expectCurrentGraph(workspace, paths['Main.tao'])
      Expect(before.diagnostics).toEqual([])
      const consumer = before.files.find(file => file.path === paths['@ui/Home.tao'])!
      const replacement = (await FS.readText(paths['Main.tao'])).replace('paper #fff', 'other #000')
      await workspace.setSourceOverrides({ [paths['Main.tao']]: replacement })
      const missing = await expectCurrentGraph(workspace, paths['Main.tao'], { [paths['Main.tao']]: replacement })
      Expect(Diagnostics.errorMessages(missing.diagnostics).join('\n')).toContain('paper')
      Expect(missing.files.find(file => file.path === consumer.path)?.document === consumer.document).toBe(true)
      await workspace.setSourceOverrides({})
      const restored = await expectCurrentGraph(workspace, paths['Main.tao'])
      Expect(restored.diagnostics).toEqual([])
      const reference = AST.streamAllContents(restored.files.find(file => file.path === consumer.path)!.ast)
        .filter(AST.isValueReference).find(value => value.target.$refText === 'paper')
      Expect.Is(reference, AST.isValueReference)
      const target = reference.target.ref
      Expect.Is(target, AST.isDesignColorEntry)
      Expect(target.name).toBe('paper')
      Expect.Is(target.value, AST.isDesignColorAtom)
      Expect(target.value.literal).toBe('#fff')
      const warmCompile = await workspace.compile(paths['Main.tao'], { studio: true })
      const coldCompile = await (await Workspace.open(root)).compile(paths['Main.tao'], { studio: true })
      const emitted = (result: typeof warmCompile) => result.files.map(file => [file.relativePath, file.code])
      Expect(emitted(warmCompile)).toEqual(emitted(coldCompile))
      Expect(warmCompile.studioManifest).toEqual(coldCompile.studioManifest)
    })
  })
})
