import { ASTUtils, NumericUnits, Packages } from '@ast-utils'
import { AST, Parser, URI } from '@parser'
import { Describe, Expect, Test, withTaoFiles } from '@shared/test'

const duration = 'public type Duration is numeric with { units { seconds 1 (default), minutes 60 } }'

Describe('numeric unit import references', () => {
  for (
    const example of [
      {
        name: 'keeps the imported owner used only by a shorthand suffix',
        source: 'use Duration from ./library/Measures\nlet Delay = 2 seconds',
        library: duration,
        used: ['Duration'],
        unused: [],
      },
      {
        name: 'keeps the imported owner used only by a named suffix route',
        source: 'use Duration from ./library/Measures\nlet Delay = 2 Duration.seconds',
        library: duration,
        used: ['Duration'],
        unused: [],
      },
      {
        name: 'keeps ratio imports used only by their numeric suffix',
        source: 'use Ratio from ./library/Measures\nlet Portion = 25 percent',
        library: 'public type Ratio is numeric with { units { percent 0.01 (default) } }',
        used: ['Ratio'],
        unused: [],
      },
      {
        name: 'leaves a parallel named import unused when the namespace route is selected',
        source: `
          use Duration from ./library/Measures
          use package ./library as library
          let Delay = 2 library.Duration.seconds
        `,
        library: duration,
        used: [],
        unused: ['Duration'],
      },
      {
        name: 'does not keep a same-spelled import for a local unit owner',
        source: `
          use Duration from ./library/Measures
          type Duration is numeric with { units { seconds 1 (default) } }
          let Delay = 2 Duration.seconds
        `,
        library: 'public type Duration is numeric with { units { milliseconds 0.001 (default) } }',
        used: [],
        unused: ['Duration'],
      },
      {
        name: 'keeps an imported transparent alias by its selected route',
        source: 'use Duration, Elapsed from ./library/Measures\nlet Delay = 2 Elapsed.seconds',
        library: `
          use package ./canonical as canonical
          public type Duration = canonical.Duration
          public type Elapsed = canonical.Duration
        `,
        canonical: duration,
        used: ['Elapsed'],
        unused: ['Duration'],
      },
      {
        name: 'keeps the imported transparent alias exposing a shorthand suffix',
        source: 'use Elapsed from ./library/Measures\nlet Delay = 2 seconds',
        library: `
          use package ./canonical as canonical
          public type Elapsed = canonical.Duration
        `,
        canonical: duration,
        used: ['Elapsed'],
        unused: ['Duration'],
      },
    ]
  ) {
    Test(example.name, async () => {
      await withTaoFiles('tao-numeric-unit-reference-', {
        'Main.tao': example.source,
        'library/Measures.tao': example.library,
        ...('canonical' in example && example.canonical
          ? { 'library/canonical/Duration.tao': example.canonical }
          : {}),
      }, async (paths, root) => {
        const context = Parser.createContext({ packages: Packages.createResolver(await Packages.createContext(root)) })
        const parsed = await Parser.parse(context, URI.file(paths['Main.tao']), { validation: false })
        Expect(parsed.diagnostics).toEqual([])
        const file = parsed.entry.ast
        const imports = file.statements.filter(AST.isUseStatement).flatMap(AST.resolvedImportedDeclarations)
        Expect(imports.length).toBeGreaterThan(0)
        const construction = AST.streamAllContents(file).find(AST.isNumericUnitConstruction)
        Expect.Is(construction, AST.isNumericUnitConstruction)
        Expect(NumericUnits.resolveSuffix(construction)).toBeDefined()
        const names = ASTUtils.referencedNames(file)
        for (const name of example.used) {
          Expect(imports.some(declaration => declaration.name === name)).toBe(true)
          Expect(names.has(name)).toBe(true)
        }
        for (const name of example.unused) {
          Expect(names.has(name)).toBe(false)
        }
      })
    })
  }
})
