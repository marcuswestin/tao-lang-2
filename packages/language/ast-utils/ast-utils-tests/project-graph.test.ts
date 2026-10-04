import { Packages } from '@ast-utils'
import { AST, Parser, type ProjectPublication, URI } from '@parser'
import { FS } from '@shared'
import { Describe, Expect, mkTestDir, stubView, Test } from '@shared/test'

Describe('project publication graph', () => {
  Test('includes only the selected test app in project requirements', async () => {
    const root = await mkTestDir('tao-selected-test-graph-')
    try {
      await FS.writeText(FS.resolvePath('.tao/.gitkeep', root), '')
      const basePath = FS.resolvePath('Main.tao', root)
      const selectedPath = FS.resolvePath('@ui/Main.test.tao', root)
      const otherPath = FS.resolvePath('Other.test.tao', root)
      await FS.writeText(
        basePath,
        `
        package { name "P" version 1.0.0 includes @ui }
        project app Base {
          id "com.tao.base" version "1.0.0" name "Base" view Home
          requires ts npm:date-fns version 4.1.0 as util
        }
        view Home() { render inject \`\`\`ts return null \`\`\` }
      `,
      )
      await FS.writeText(
        selectedPath,
        `
        use Base from ../Main
        public let TestOnly = "not published"
        app Selected = Base
      `,
      )
      await FS.writeText(otherPath, 'app Unrelated { id "com.tao.other" version "1.0.0" name "Other" view Home }')
      const resolver = Packages.createResolver(await Packages.createContext(root))
      const parserContext = Parser.createContext({ packages: resolver })
      const parsed = await Parser.parse(parserContext, URI.file(selectedPath))
      Expect(parsed.entry.document.parseResult.parserErrors).toEqual([])
      const selectedApp = parsed.entry.ast.statements.find(statement =>
        AST.isAppValueDeclaration(statement) && statement.name === 'Selected'
      )
      Expect.Is(selectedApp, AST.isAppDeclaration)
      Expect.Is(selectedApp.value, AST.isValueReference)
      const baseApp = selectedApp.value.target.ref
      Expect.Is(baseApp, AST.isAppDeclaration)
      Expect(baseApp.name).toBe('Base')
      const other = await Parser.parse(parserContext, URI.file(otherPath))
      const graph = resolver.projectGraph({
        fromFilePath: selectedPath,
        workspaceFiles: [...parsed.files.map(file => file.ast), other.entry.ast],
      })
      Expect([...new Set(graph.projectFiles.map(file => AST.getDocument(file).uri.path))].toSorted())
        .toEqual([basePath, selectedPath].toSorted())
      Expect([...new Set(graph.appRequirements.map(item => item.app.name))].toSorted()).toEqual(['Base', 'Selected'])
      Expect(
        graph.appRequirements.find(item => item.app.name === 'Selected')?.requirements.map(item =>
          item.declaration.npm
        ),
      )
        .toEqual(['npm:date-fns'])
      Expect(graph.publications.some(item => item.name === 'P')).toBe(true)
      Expect(
        graph.publications.every(item => item.publicDeclarations.length === 0 && item.sourceDeclarations.length === 0),
      )
        .toBe(true)
    } finally {
      await FS.remove(root)
    }
  })

  Test('selects the named publication and preserves aliases and private helper reachability', async () => {
    const root = await mkTestDir('tao-project-graph-')
    try {
      const library = FS.resolvePath('Library', root)
      const consumer = FS.resolvePath('Consumer', root)
      const foundation = FS.resolvePath('Foundation', root)
      await FS.writeText(FS.resolvePath('.tao/.gitkeep', library), '')
      await FS.writeText(FS.resolvePath('.tao/.gitkeep', consumer), '')
      await FS.writeText(FS.resolvePath('.tao/.gitkeep', foundation), '')
      await FS.writeText(FS.resolvePath('Private.tao', foundation), 'project let PrivateCore = "foundation helper"')
      await FS.writeText(
        FS.resolvePath('@core/Core.tao', foundation),
        `
        use PrivateCore from ../Private
        public let Core = PrivateCore
      `,
      )
      await FS.writeText(
        FS.resolvePath('Package.tao', foundation),
        `
        package {
          version 3.0.0
          includes @core
          requires "Widget Package Foo" from ../Library version ^2.0.0 { @icons as @loop }
        }
      `,
      )
      await FS.writeText(FS.resolvePath('Helper.tao', library), 'project let RootHelper = "private"')
      await FS.writeText(
        FS.resolvePath('@ui/Widget.tao', library),
        `
        use RootHelper from ../Helper
        public let Widget = RootHelper
      `,
      )
      await FS.writeText(
        FS.resolvePath('@icons/Icon.tao', library),
        `
        use Core from @foundation
        public let Icon = Core
      `,
      )
      await FS.writeText(FS.resolvePath('@ui/Unused.tao', library), 'project let Unused = "unused"')
      await FS.writeText(FS.resolvePath('@ui/@inner/Hidden.tao', library), 'public let Hidden = "nested module"')
      await FS.writeText(
        FS.resolvePath('Publications.tao', library),
        `
        package {
          name "Widget Package Foo"
          version 2.0.0
          includes @ui @icons
          requires ../Foundation version ^3.0.0 { @core as @foundation }
        }
        package { version 1.0.0 includes @ui }
      `,
      )
      const entry = FS.resolvePath('Main.tao', consumer)
      await FS.writeText(
        FS.resolvePath('Views.tao', consumer),
        `
        project let Local = "source helper"
        ${stubView('Display', 'Value text').replace('view ', 'project view ')}
        project view Root() { render Display(Local) }
      `,
      )
      await FS.writeText(
        entry,
        `
        package {
          version 0.1.0
          includes @app
          requires "Widget Package Foo" from ../Library version ^2.0.0 {
            @ui as @widgets
            @icons as @widget-icons
          }
          requires ../Library version ^1.0.0 { @ui as @default-ui }
        }
        use Root from ./Views
        use Widget from @widgets
        app Base {
          requires "Widget Package Foo" from ../Library version ^2.0.0 { @ui as @app-ui }
          view Root
        }
        app Derived = Base with {
          requires ../Library version ^1.0.0 { @ui as @app-default }
        }
        app Sibling { }
      `,
      )

      const context = await Packages.createContext(consumer)
      const resolver = Packages.createResolver(context)
      const result = await Parser.parse(Parser.createContext({ packages: resolver }), URI.file(entry))
      Expect(result.entry.document.parseResult.parserErrors).toEqual([])
      Expect(AST.workspaceFilesFor(result.entry.ast).map(file => AST.getDocument(file).uri.path).toSorted())
        .toEqual(result.files.map(file => file.path).toSorted())
      // Validation callers may retain only the requested entry, then construct a fresh resolver.
      const graphResolver = Packages.createResolver(await Packages.createContext(consumer))
      const graph = graphResolver.projectGraph({
        fromFilePath: entry,
        workspaceFiles: [result.entry.ast],
      })
      const requirement = graph.requirements[0]
      Expect(requirement?.selectedPublication?.name).toBe('Widget Package Foo')
      Expect(requirement?.selectedPublication?.version).toBe('2.0.0')
      const foundationRequirement = requirement?.selectedPublication?.requirements[0]
      Expect(foundationRequirement?.targetProjectRoot).toBe(foundation)
      Expect(foundationRequirement?.bindings[0]?.origin.modulePath).toBe(FS.resolvePath('@core', foundation))
      Expect(
        foundationRequirement?.selectedPublication?.sourceFiles.map(file => FS.basename(AST.getDocument(file).uri.path))
          .toSorted(),
      ).toEqual(['Core.tao', 'Private.tao'])
      Expect(foundationRequirement?.selectedPublication?.requirements[0]?.selectedPublication)
        .toBe(requirement?.selectedPublication)
      const visited = new Set<AST.PackageDeclaration>()
      const visit = (publication: ProjectPublication): void => {
        if (visited.has(publication.declaration)) {
          return
        }
        visited.add(publication.declaration)
        for (const dependency of publication.requirements) {
          if (dependency.selectedPublication) {
            visit(dependency.selectedPublication)
          }
        }
      }
      visit(requirement!.selectedPublication!)
      Expect(visited.size).toBe(2)
      Expect(graph.requirements[1]?.selectedPublication?.name).toBeUndefined()
      Expect(graph.requirements[1]?.selectedPublication?.version).toBe('1.0.0')
      Expect(graph.requirements[1]?.bindings[0]?.origin.packageName).toBeUndefined()
      Expect(
        graph.appRequirements.find(entry => entry.app.name === 'Base')?.requirements.map(entry =>
          entry.bindings[0]?.localName
        ),
      ).toEqual(['@app-ui'])
      Expect(
        graph.appRequirements.find(entry => entry.app.name === 'Derived')?.requirements.map(entry =>
          entry.bindings[0]?.localName
        ),
      ).toEqual(['@app-ui', '@app-default'])
      Expect(
        graph.appRequirements.find(entry => entry.app.name === 'Derived')?.sourceDeclarations.map(entry => entry.name)
          .toSorted(),
      ).toEqual(['Base', 'Derived', 'Display', 'Local', 'Root'])
      Expect(
        graph.appRequirements.find(entry => entry.app.name === 'Derived')?.sourceFiles.map(file =>
          FS.basename(AST.getDocument(file).uri.path)
        ).toSorted(),
      ).toEqual(['Main.tao', 'Views.tao'])
      Expect(
        requirement?.bindings.map(binding => [
          binding.localName,
          binding.origin.modulePath,
        ]),
      ).toEqual([
        ['@widgets', FS.resolvePath('@ui', library)],
        ['@widget-icons', FS.resolvePath('@icons', library)],
      ])
      Expect(requirement?.selectedPublication?.publicDeclarations.map(declaration => declaration.name).toSorted())
        .toEqual(['Icon', 'Widget'])
      Expect(
        requirement?.selectedPublication?.sourceFiles.map(file => FS.basename(AST.getDocument(file).uri.path))
          .toSorted(),
      )
        .toEqual(['Helper.tao', 'Icon.tao', 'Widget.tao'])
      const use = result.entry.ast.statements.filter(AST.isUseStatement)
        .find(statement => statement.importPath === '@widgets')
      Expect(use?.importedDeclarations[0]?.ref?.name).toBe('Widget')

      await FS.writeText(
        FS.resolvePath('Publications.tao', library),
        `
        package { version 1.0.0 includes @ui }
        package {
          name "Widget Package Foo"
          version 2.0.0
          includes @ui @icons
          requires ../Foundation version ^3.0.0 { @core as @foundation }
        }
      `,
      )
      const reversedContext = await Packages.createContext(consumer)
      const reversedResolver = Packages.createResolver(reversedContext)
      const reversed = await Parser.parse(Parser.createContext({ packages: reversedResolver }), URI.file(entry))
      const reversedGraph = reversedResolver.projectGraph({
        fromFilePath: entry,
        workspaceFiles: reversed.files.map(file => file.ast),
      })
      Expect(reversedGraph.requirements[0]?.selectedPublication?.name).toBe('Widget Package Foo')
      Expect(reversedGraph.requirements[1]?.selectedPublication?.name).toBeUndefined()
    } finally {
      await FS.remove(root)
    }
  })

  Test('selects declarations within one included file and follows named data edges', async () => {
    const root = await mkTestDir('tao-publication-declarations-')
    try {
      await FS.writeText(FS.resolvePath('.tao/.gitkeep', root), '')
      await FS.writeText(FS.resolvePath('Package.tao', root), 'package { name "Widgets" version 1.0.0 includes @ui }')
      const source = FS.resolvePath('@ui/Widget.tao', root)
      await FS.writeText(
        source,
        `
        public view Widget() { query Notes render Label(Helper) }
        view Label(Value text) { render inject \`\`\`ts return null \`\`\` }
        let Helper = Secondary
        let Secondary = Helper
        data Notes / Note { Author Author }
        data Authors / Author { Name text }
        data Claimed / Claim { Name text }
        public datasource Feed = Memory { Data { Claimed } }
        data Secrets / Secret { Name text }
        view Unused() from ./Unused.tsx
      `,
      )
      const resolver = Packages.createResolver(await Packages.createContext(root))
      const parsed = await Parser.parse(Parser.createContext({ packages: resolver }), URI.file(source))
      Expect(parsed.entry.document.parseResult.parserErrors).toEqual([])
      const graph = resolver.projectGraph({ fromFilePath: source, workspaceFiles: parsed.files.map(file => file.ast) })
      const publication = graph.publications.find(item => item.name === 'Widgets')
      Expect(publication?.sourceDeclarations.map(item => item.name).toSorted())
        .toEqual(['Authors', 'Claimed', 'Feed', 'Helper', 'Label', 'Notes', 'Secondary', 'Widget'])
      Expect(publication?.sourceFiles.map(file => AST.getDocument(file).uri.path)).toEqual([source])
    } finally {
      await FS.remove(root)
    }
  })
})
