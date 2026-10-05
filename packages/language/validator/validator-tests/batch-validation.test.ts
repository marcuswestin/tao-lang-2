import { Packages } from '@ast-utils'
import { Workspace } from '@compiler/workspace'
import { AST, Parser, type ParseResult, URI } from '@parser'
import { Assert, Diagnostics, FS } from '@shared'
import { Describe, Expect, stubView, Test, testOverrideSlot, withTaoFiles } from '@shared/test'
import { Validate } from '../validator-src/Validate'
import { Validation } from '../validator-src/validation'
import Validator, { type ValidationResult } from '../validator-src/validator'
import { AppValidator } from '../validator-src/validators/app-validator'
import { declarationSlotValidationMessages } from '../validator-src/validators/declaration-slots-validator'
import { InteractionValidator } from '../validator-src/validators/interaction-validator'
import { requirementOwnershipMessages } from '../validator-src/validators/requirement-ownership-validator'
import { StateValidator } from '../validator-src/validators/StateValidator'
import { ViewsValidator } from '../validator-src/validators/views-validator'

type Run = { parseResult: ParseResult; context: Validator.Context }

const typesSlot = testOverrideSlot<typeof Validate.Types>({
  read: () => Validate.Types,
  write: Types => Object.assign(Validate, { Types }),
})
const structuralSlot = testOverrideSlot<typeof Validate.TaoFile>({
  read: () => Validate.TaoFile,
  write: TaoFile => Object.assign(Validate, { TaoFile }),
})
const foreignSlot = testOverrideSlot<typeof Validate.ForeignImplementationFiles>({
  read: () => Validate.ForeignImplementationFiles,
  write: ForeignImplementationFiles => Object.assign(Validate, { ForeignImplementationFiles }),
})
const resolverSlot = testOverrideSlot<typeof Packages.createResolver>({
  read: () => Packages.createResolver,
  write: createResolver => {
    Packages.createResolver = createResolver
  },
})
const contextSlot = testOverrideSlot<typeof Validation.createContext>({
  read: () => Validation.createContext,
  write: createContext => {
    Validation.createContext = createContext
  },
})
const appValidationSlot = testOverrideSlot<typeof AppValidator.validate>({
  read: () => AppValidator.validate,
  write: validate => Object.assign(AppValidator, { validate }),
})

Describe('validator: batch-local reuse', () => {
  Test('shares exact-file descendant snapshots across reordered entries and starts cold next batch', async () => {
    await withRuns(
      {
        'One.tao': 'view Root() { state Value is number = "bad" render Missing() }',
        'Two.tao': 'view OtherRoot() { render MissingToo() }',
      },
      ['One.tao', 'Two.tao'],
      async runs => {
        const ordered = [...runs].reverse()
        const file = runs[0]!.context.workspaceFiles.find(candidate =>
          AST.getDocument(candidate).uri.path.endsWith('/One.tao')
        )!
        const view = file.statements.find(AST.isViewDeclaration)
        Expect.Is(view, AST.isViewDeclaration)
        const descriptor = Object.getOwnPropertyDescriptor(view, 'block')
        Assert.defined(descriptor, 'Expected a view block descriptor for the descendant traversal witness.')
        const block = view.block
        let validatingApp = false
        let blockReads = 0
        let targetAppVisits = 0
        const getterSlot = testOverrideSlot<(() => unknown) | undefined>({
          read: () => Object.getOwnPropertyDescriptor(view, 'block')?.get,
          write: getter =>
            Object.defineProperty(
              view,
              'block',
              getter === descriptor.get
                ? descriptor
                : { configurable: true, enumerable: descriptor.enumerable, get: getter },
            ),
        })
        const originalAppValidation = AppValidator.validate
        const restoreGetter = getterSlot.install(() => {
          if (validatingApp) {
            blockReads++
          }
          return block
        })
        const restoreAppValidation = appValidationSlot.install((...args) => {
          if (args[0] === file) {
            targetAppVisits++
          }
          validatingApp = true
          try {
            return originalAppValidation(...args)
          } finally {
            validatingApp = false
          }
        })
        try {
          const cold = await validateSingles(ordered)
          Expect(Diagnostics.messages(cold[0]!.diagnostics)).toContain(
            StateValidator.messages.initialTypeMismatch('Value', 'number', 'text'),
          )
          const coldReads = blockReads
          const coldAppVisits = targetAppVisits
          Expect(coldAppVisits).toBeGreaterThan(1)
          Expect(coldReads).toBe(targetAppVisits)
          blockReads = 0
          targetAppVisits = 0

          const batch = await Validator.validateParseResults(ordered)
          Expect(batch.map(result => result.diagnostics)).toEqual(cold.map(result => result.diagnostics))
          batch.forEach((result, index) => Expect(result.files).toBe(cold[index]!.files))
          Expect(targetAppVisits).toBe(coldAppVisits)
          Expect(blockReads).toBe(1)

          blockReads = 0
          targetAppVisits = 0
          const next = await Validator.validateParseResults(ordered)
          Expect(next.map(result => result.diagnostics)).toEqual(cold.map(result => result.diagnostics))
          next.forEach((result, index) => Expect(result.files).toBe(cold[index]!.files))
          Expect(targetAppVisits).toBe(coldAppVisits)
          Expect(blockReads).toBe(1)
        } finally {
          restoreAppValidation()
          restoreGetter()
        }
      },
    )
  })

  Test('shares app helper work across reordered workspaces and starts cold in the next batch', async () => {
    await withRuns(
      {
        'One.tao': `${stubView('Root')} app First {
          id "shared" version "1.0.0" name "First" view Root
        } let Probe = "plain"`,
        'Two.tao': `${stubView('OtherRoot')} app Second {
          id "shared" version "1.0.0" name "Second" view OtherRoot
        }`,
      },
      ['One.tao', 'Two.tao'],
      async runs => {
        const first = runs[0]!
        const files = first.context.workspaceFiles
        const ordered = [first, {
          ...first,
          context: { ...first.context, workspaceFiles: [...files].reverse() },
        }]
        const target = files.find(file => AST.getDocument(file).uri.path.endsWith('/One.tao'))!
        Expect(AST.appValueDeclarationsInFile(target).map(app => app.name)).toEqual(['First'])
        const probe = target.statements.find(AST.isAliasDeclaration)
        Expect.Is(probe, AST.isAliasDeclaration)
        Expect(probe.name).toBe('Probe')
        const descriptor = Object.getOwnPropertyDescriptor(probe, 'value')
        Assert.defined(descriptor, 'Expected an alias value descriptor for the app classification witness.')
        const value = probe.value
        const getterSlot = testOverrideSlot<(() => unknown) | undefined>({
          read: () => Object.getOwnPropertyDescriptor(probe, 'value')?.get,
          write: getter =>
            Object.defineProperty(
              probe,
              'value',
              getter === descriptor.get
                ? descriptor
                : { configurable: true, enumerable: descriptor.enumerable, get: getter },
            ),
        })
        const originalAppValidation = AppValidator.validate
        const originalContext = Validation.createContext
        let validatingApps = false
        let reads = 0
        let identityComputes = 0
        const restoreGetter = getterSlot.install(() => {
          if (validatingApps) {
            reads++
          }
          return value
        })
        const restoreApps = appValidationSlot.install((...args) => {
          validatingApps = true
          try {
            return originalAppValidation(...args)
          } finally {
            validatingApps = false
          }
        })
        const restoreContext = contextSlot.install((accept, context): ReturnType<typeof Validation.createContext> => {
          const ctx = originalContext(accept, context)
          const memo = ctx.appMemo
          return memo && ctx.packagesContext === first.context.packagesContext
            ? {
              ...ctx,
              appMemo: {
                values: (file, compute) => memo.values(file, compute),
                identities: (packagesContext, workspace, compute) =>
                  memo.identities(packagesContext, workspace, () => {
                    identityComputes++
                    return compute()
                  }),
              },
            }
            : ctx
        })
        try {
          const cold = await validateSingles(ordered)
          Expect(Diagnostics.messages(cold[0]!.diagnostics)).toContain(
            AppValidator.messages.duplicateIdentity('shared', '1.0.0'),
          )
          const coldReads = reads
          Expect(coldReads).toBeGreaterThan(0)
          reads = 0
          const batch = await Validator.validateParseResults(ordered)
          Expect(batch.map(result => result.diagnostics)).toEqual(cold.map(result => result.diagnostics))
          const batchReads = reads
          Expect(batchReads).toBeGreaterThan(0)
          // The batch classifies Probe once and reuses one descendant snapshot per exact file.
          Expect(coldReads - batchReads).toBe(4)
          Expect(identityComputes).toBe(1)
          reads = 0
          identityComputes = 0
          const next = await Validator.validateParseResults(ordered)
          Expect(next.map(result => result.diagnostics)).toEqual(cold.map(result => result.diagnostics))
          Expect(reads).toBe(batchReads)
          Expect(identityComputes).toBe(1)
        } finally {
          restoreContext()
          restoreApps()
          restoreGetter()
        }
      },
    )
  })

  Test('keeps app identity indexes private to package contexts and stable same-path file order', async () => {
    await withRuns(
      { 'One.tao': `${stubView('Root')} app First { id "same" version "1.0.0" name "First" view Root }` },
      ['One.tao'],
      async (runs, root) => {
        const first = runs[0]!
        const file = first.parseResult.entry.ast
        const parser = Parser.createContext({ packages: Packages.createResolver(first.context.packagesContext) })
        const second = await Parser.parse(parser, URI.file(first.parseResult.entry.path), { validation: false })
        Expect(second.entry.ast === file).toBe(false)
        const memo = AppValidator.createBatchMemo()
        const one = new Map([['first', file.statements.find(AST.isAppDeclaration)!]])
        const two = new Map([['second', second.entry.ast.statements.find(AST.isAppDeclaration)!]])
        Expect(one.get('first')?.name).toBe('First')
        Expect(two.get('second')?.name).toBe('First')
        const packages = first.context.packagesContext
        Expect(memo.identities(packages, [file, second.entry.ast], () => one)).toBe(one)
        Expect(memo.identities(packages, [second.entry.ast, file], () => two)).toBe(two)
        Expect(memo.identities(packages, [file, second.entry.ast], () => two)).toBe(one)
        const otherPackages = await Packages.createContext(root)
        Expect(memo.identities(otherPackages, [file, second.entry.ast], () => two)).toBe(two)
        Expect(memo.identities(packages, [file], () => two)).toBe(two)
      },
    )
  })

  Test('reclassifies a retained consumer alias after its provider is relinked between batches', async () => {
    await withTaoFiles('tao-validator-app-relink-', {
      '.tao/.gitkeep': '',
      'Main.tao': 'use Base from ./Library\nlet Consumer = Base',
      'Library.tao': `${stubView('Root')} public app Base {
        id "base" version "1.0.0" name "Base" view Root
      }`,
    }, async (paths, root) => {
      const packagesContext = await Packages.createContext(root)
      const parser = Parser.createContext({ packages: Packages.createResolver(packagesContext) })
      const uri = URI.file(paths['Main.tao']!)
      const run = (parseResult: ParseResult): Run => ({
        parseResult,
        context: Validator.createContext(
          packagesContext,
          parseResult.files.map(file => file.ast),
          parseResult.entry.path,
        ),
      })
      const before = await Parser.parse(parser, uri, { validation: false })
      const consumer = before.entry.ast.statements.find(AST.isAliasDeclaration)
      Expect.Is(consumer, AST.isAliasDeclaration)
      Expect(AST.appValueDeclarationsInFile(before.entry.ast).map(app => app.name)).toEqual(['Consumer'])
      const duplicate = AppValidator.messages.duplicateIdentity('base', '1.0.0')
      const beforeCold = await validateSingles([run(before)])
      Expect(Diagnostics.messages(beforeCold[0]!.diagnostics)).toContain(duplicate)
      const beforeBatch = await Validator.validateParseResults([run(before), run(before)])
      Expect(beforeBatch.map(result => result.diagnostics)).toEqual([
        beforeCold[0]!.diagnostics,
        beforeCold[0]!.diagnostics,
      ])
      await FS.writeText(paths['Library.tao']!, 'public let Base = "plain"')
      const after = await Parser.parse(parser, uri, { validation: false })
      Expect(after.entry.ast).toBe(before.entry.ast)
      Expect(after.entry.ast.statements.find(AST.isAliasDeclaration)).toBe(consumer)
      Expect.Is(consumer.value, AST.isValueReference)
      Expect.Is(consumer.value.target.ref, AST.isAliasDeclaration)
      Expect(consumer.value.target.ref.name).toBe('Base')
      Expect(AST.appValueDeclarationsInFile(after.entry.ast).map(app => app.name)).toEqual([])
      const afterCold = await validateSingles([run(after)])
      Expect(Diagnostics.messages(afterCold[0]!.diagnostics)).not.toContain(duplicate)
      const afterBatch = await Validator.validateParseResults([run(after), run(after)])
      Expect(afterBatch.map(result => result.diagnostics)).toEqual([
        afterCold[0]!.diagnostics,
        afterCold[0]!.diagnostics,
      ])
    })
  })

  Test('reuses linked inference during structural checks and starts cold in the next batch', async () => {
    await withRuns(
      {
        'One.tao': 'type Name is text\nfunction Echo(Value Name?) { return Value }\nlet Original = Name "Ada"',
        'Two.tao': 'let Other = "other"',
      },
      ['One.tao', 'Two.tao'],
      async runs => {
        const file = runs[0]!.context.workspaceFiles.find(file => AST.getDocument(file).uri.path.endsWith('/One.tao'))!
        const definition = file.statements.find(AST.isTypeDeclaration)
        Expect.Is(definition, AST.isTypeDeclaration)
        Expect.Is(definition.type, AST.isPrimitiveTypeReference)
        const reference = definition.type
        const descriptor = Object.getOwnPropertyDescriptor(reference, 'primitive')
        Assert.defined(descriptor, 'Expected a primitive property descriptor for the inference witness.')
        const primitive = reference.primitive
        let structural = false
        let reads = 0
        const getterSlot = testOverrideSlot<(() => unknown) | undefined>({
          read: () => Object.getOwnPropertyDescriptor(reference, 'primitive')?.get,
          write: getter =>
            Object.defineProperty(
              reference,
              'primitive',
              getter === descriptor.get
                ? descriptor
                : { configurable: true, enumerable: descriptor.enumerable, get: getter },
            ),
        })
        const restoreGetter = getterSlot.install(() => {
          if (structural) {
            reads++
          }
          return primitive
        })
        const original = Validate.TaoFile
        const restoreStructural = structuralSlot.install((...args) => {
          structural = true
          try {
            return original(...args)
          } finally {
            structural = false
          }
        })
        try {
          const cold = await validateSingles(runs)
          const coldReads = reads
          Expect(coldReads).toBeGreaterThan(0)
          reads = 0
          const batch = await Validator.validateParseResults(runs)
          const batchReads = reads
          Expect(batch.map(result => result.diagnostics)).toEqual(cold.map(result => result.diagnostics))
          Expect(batchReads).toBeGreaterThan(0)
          Expect(batchReads).toBeLessThan(coldReads)
          reads = 0
          const next = await Validator.validateParseResults(runs)
          Expect(next.map(result => result.diagnostics)).toEqual(cold.map(result => result.diagnostics))
          Expect(reads).toBe(batchReads)
        } finally {
          restoreStructural()
          restoreGetter()
        }
      },
    )
  })

  Test('replays type diagnostics in their original positions and computes shared work once per batch', async () => {
    await withRuns(
      {
        'One.tao': `${stubView('Leaf')} view One() { state Value is number = "bad" render Leaf() }
        view Foreign() from ./Missing.tsx
        use Col, Text from @tao/ui
        use primary from @tao/keys
        action Run() { }
        command Copy() { Title "Copy" Key primary + "c" do Run() }
        view Rows() { render Col() { loop ["One"] / Row { Text(Row) Text(Row) } } }`,
        'Two.tao': 'view Two() { render Missing() }',
      },
      ['One.tao', 'Two.tao'],
      async (runs, root) => {
        const singles = await validateSingles(runs)
        Expect(Diagnostics.messages(singles[0]!.diagnostics)).toContain(
          StateValidator.messages.initialTypeMismatch('Value', 'number', 'text'),
        )
        Expect(Diagnostics.messages(singles[0]!.diagnostics)).toContain(
          ViewsValidator.messages.foreignViewMissing('./Missing.tsx'),
        )
        Expect(Diagnostics.messages(singles[0]!.diagnostics)).toContain(
          InteractionValidator.messages.editingShortcut('Copy', 'primary+c'),
        )
        Expect(Diagnostics.messages(singles[0]!.diagnostics)).toContain(ViewsValidator.messages.loopRowLabel)
        const uniqueFiles = new Set(runs.flatMap(run => run.context.workspaceFiles)).size
        const ordinaryVisits = runs.reduce((count, run) => count + run.context.workspaceFiles.length, 0)
        Expect(ordinaryVisits).toBeGreaterThan(uniqueFiles)
        const coldCounts = await countWork(runs, async () => {
          await validateSingles(runs)
        })
        Expect(coldCounts).toEqual({
          types: ordinaryVisits,
          graphs: 2,
          foreign: ordinaryVisits,
        })
        const counts = await countWork(runs, async () => {
          const batch = await Validator.validateParseResults(runs)
          Expect(batch.map(result => result.diagnostics)).toEqual(singles.map(result => result.diagnostics))
          batch.forEach((result, index) => {
            Expect(result.entry).toBe(runs[index]!.parseResult.entry)
            Expect(result.files).toBe(runs[index]!.parseResult.files)
          })
        })
        Expect(counts).toEqual({ types: uniqueFiles, graphs: 1, foreign: ordinaryVisits })
        const next = await countWork(runs, async () => {
          await Validator.validateParseResults(runs)
        })
        Expect(next).toEqual(counts)

        const workspace = await Workspace.open(root)
        const parsed = await workspace.parseFiles(runs.map(run => run.parseResult.entry.path))
        const integrated = await workspace.validateParsedFiles(parsed)
        Expect(integrated.diagnostics).toEqual(Diagnostics.unique(singles.flatMap(result => result.diagnostics)))
      },
    )
  })

  Test('keeps reversed global shortcut and primitive-contract indexes entry-private', async () => {
    await withRuns(
      {
        'One.tao': `
        primitive scene with { Title text }
        action FirstRun() { }
        command First() { Title "First" Key "g" do FirstRun() }
        ${stubView('Leaf')}
        scene Home() { Title "Home" render Leaf() }
      `,
        'Two.tao': `
        primitive scene with { Title number }
        action SecondRun() { }
        command Second() { Title "Second" Key "g" do SecondRun() }
      `,
      },
      ['One.tao', 'Two.tao'],
      async runs => {
        const first = runs[0]!
        const one = first.context.workspaceFiles.find(file => AST.getDocument(file).uri.path.endsWith('/One.tao'))!
        const two = first.context.workspaceFiles.find(file => AST.getDocument(file).uri.path.endsWith('/Two.tao'))!
        const rest = first.context.workspaceFiles.filter(file => file !== one && file !== two)
        const ordered: Run[] = [
          { ...first, context: { ...first.context, workspaceFiles: [one, two, ...rest] } },
          { ...runs[1]!, context: { ...runs[1]!.context, workspaceFiles: [two, one, ...rest] } },
        ]
        const singles = await validateSingles(ordered)
        Expect(Diagnostics.messages(singles[0]!.diagnostics)).toContain(
          InteractionValidator.messages.duplicateShortcut('Global commands', 'g', 'First', 'Second'),
        )
        Expect(Diagnostics.messages(singles[1]!.diagnostics)).toContain(
          InteractionValidator.messages.duplicateShortcut('Global commands', 'g', 'Second', 'First'),
        )
        const mismatch = declarationSlotValidationMessages.type('Title', 'number', 'text')
        Expect(Diagnostics.messages(singles[0]!.diagnostics)).not.toContain(mismatch)
        Expect(Diagnostics.messages(singles[1]!.diagnostics)).toContain(mismatch)
        const original = Validation.createContext
        let primitiveComputes = 0
        const restore = contextSlot.install((accept, context) => {
          const ctx = original(accept, context)
          return {
            ...ctx,
            memo: (key, compute) =>
              ctx.memo(key, () => {
                if (key === 'workspace-index.primitiveSlots.scene') {
                  primitiveComputes += 1
                }
                return compute()
              }),
          }
        })
        try {
          const batch = await Validator.validateParseResults(ordered)
          Expect(batch.map(result => result.diagnostics)).toEqual(singles.map(result => result.diagnostics))
          Expect(primitiveComputes).toBe(2)
        } finally {
          restore()
        }
      },
    )
  })

  Test('preserves app, variant, publication and test-sidecar requirement ownership', async () => {
    await withRuns(
      {
        'Library/.tao/.gitkeep': '',
        'Foundation/.tao/.gitkeep': '',
        'Foundation/Package.tao': 'package { version 1.0.0 includes @core }',
        'Foundation/@core/Core.tao': 'public let Core = "foundation"',
        'Library/Package.tao': `
        package { name "Widgets" version 1.0.0 includes @ui }
        package { name "Unrelated" version 1.0.0 requires ../Foundation version ^1.0.0 { @core as @foundation } }
      `,
        'Library/@ui/Widget.tao': 'use Core from @foundation public let Widget = Core',
        'Consumer/.tao/.gitkeep': '',
        'Consumer/Main.tao': `
        use Widget from @parts
        package { version 0.1.0 requires "Widgets" from ../Library version ^1.0.0 { @ui as @parts } }
        ${stubView('Display', 'Value text')}
        view Root() { render Display(Widget) }
        app Base { id "base" version "1.0.0" name "Base"
          requires "Widgets" from ../Library version ^1.0.0 { @ui as @parts }
          view Root
        }
        app Derived = Base with { id "derived" name "Derived" }
        app Missing { id "missing" version "1.0.0" name "Missing" view Root }
      `,
        'Consumer/Main.test.tao': `
        use Base from ./Main
        app TestVariant = Base with { id "test" name "Test" }
        test "variant" { test "runs" { run TestVariant } }
      `,
        'Consumer/Other.test.tao': 'use Base from ./Main test "other" { test "runs" { run Base } }',
      },
      ['Consumer/Main.tao', 'Library/Package.tao', 'Consumer/Main.test.tao', 'Consumer/Other.test.tao'],
      async runs => {
        const singles = await validateSingles(runs)
        Expect(Diagnostics.messages(singles[0]!.diagnostics)).toContain(
          requirementOwnershipMessages.app('Missing', '@parts'),
        )
        Expect(Diagnostics.messages(singles[0]!.diagnostics)).toContain(
          requirementOwnershipMessages.publication('Widgets', '@foundation'),
        )
        Expect(Diagnostics.messages(singles[0]!.diagnostics)).not.toContain(
          requirementOwnershipMessages.app('Derived', '@parts'),
        )
        Expect(Diagnostics.hasError(runs.flatMap(run => run.parseResult.diagnostics), 'lexer', 'parser')).toBe(false)
        const counts = await countWork(runs, async () => {
          const batch = await Validator.validateParseResults(runs)
          Expect(batch.map(result => result.diagnostics)).toEqual(singles.map(result => result.diagnostics))
        })
        Expect(counts.graphs).toBe(4)
      },
    )
  })

  Test('does not share graphs across package contexts or distinct ordered effective workspaces', async () => {
    await withRuns(
      {
        'One.tao': 'let One = "one"',
        'Two.tao': 'let Two = "two"',
      },
      ['One.tao', 'Two.tao'],
      async (runs, root) => {
        const first = runs[0]!
        const distinct = {
          ...first,
          context: { ...first.context, packagesContext: await Packages.createContext(root) },
        }
        const counts = await countWork([first, distinct], async () => {
          const singles = await validateSingles([first, distinct])
          const batch = await Validator.validateParseResults([first, distinct])
          Expect(batch.map(result => result.diagnostics)).toEqual(singles.map(result => result.diagnostics))
        })
        // Both the single calls and the two distinct batch contexts compute their own graph and types.
        Expect(counts.graphs).toBe(4)
        Expect(counts.types).toBe(first.context.workspaceFiles.length * 4)

        const files = first.context.workspaceFiles
        for (const file of files) {
          AST.rememberVisibleWorkspaceFiles([file])
        }
        const ordered = [first, { ...first, context: { ...first.context, workspaceFiles: [...files].reverse() } }]
        const singles = await validateSingles(ordered)
        const orderedCounts = await countWork(ordered, async () => {
          const batch = await Validator.validateParseResults(ordered)
          Expect(batch.map(result => result.diagnostics)).toEqual(singles.map(result => result.diagnostics))
        })
        Expect(orderedCounts.graphs).toBe(2)
      },
    )
  })

  Test('checks a recovered foreign implementation again between batch entries', async () => {
    await withRuns(
      { 'One.tao': 'view Foreign() from ./Missing.tsx' },
      ['One.tao'],
      async (runs, root) => {
        const first = runs[0]!
        const before = await Validator.validateParseResult(first.parseResult, first.context)
        const missing = ViewsValidator.messages.foreignViewMissing('./Missing.tsx')
        Expect(Diagnostics.messages(before.diagnostics)).toContain(missing)
        const original = Validate.ForeignImplementationFiles
        let recovered = false
        const restore = foreignSlot.install(async (file, ctx) => {
          await original(file, ctx)
          if (!recovered && AST.getDocument(file).uri.path === first.parseResult.entry.path) {
            await FS.writeText(FS.resolvePath('Missing.tsx', root), 'export default function Foreign() { return null }')
            recovered = true
          }
        })
        try {
          const counts = await countWork([first, first], async () => {
            const batch = await Validator.validateParseResults([first, first])
            const after = await Validator.validateParseResult(first.parseResult, first.context)
            Expect(recovered).toBe(true)
            Expect(Diagnostics.messages(after.diagnostics)).not.toContain(missing)
            Expect(batch.map(result => result.diagnostics)).toEqual([before.diagnostics, after.diagnostics])
          })
          // The final cold comparison adds one ordinary pass to the two-entry batch.
          Expect(counts.foreign).toBe(first.context.workspaceFiles.length * 3)
        } finally {
          restore()
        }
      },
    )
  })

  Test(
    'gates lexer and parser errors separately per entry while retaining linker and structural diagnostics',
    async () => {
      await withRuns(
        {
          'Lexer.test.tao': '$',
          'Parser.test.tao': 'view Broken() { render }',
          'Linker.test.tao': 'view Linked() { state Bad is number = "bad" render Missing() }',
          'Valid.tao': `${stubView('Leaf')} view Valid() { state Value is number = "bad" render Leaf() }`,
        },
        ['Lexer.test.tao', 'Parser.test.tao', 'Linker.test.tao', 'Valid.tao'],
        async runs => {
          const singles = await validateSingles(runs)
          Expect(Diagnostics.hasSource(singles[0]!.diagnostics, 'lexer')).toBe(true)
          Expect(Diagnostics.hasSource(singles[1]!.diagnostics, 'parser')).toBe(true)
          Expect(Diagnostics.hasSource(singles[0]!.diagnostics, 'validator')).toBe(false)
          Expect(Diagnostics.hasSource(singles[1]!.diagnostics, 'validator')).toBe(false)
          Expect(Diagnostics.hasSource(singles[2]!.diagnostics, 'linker')).toBe(true)
          Expect(Diagnostics.hasSource(singles[2]!.diagnostics, 'validator')).toBe(true)
          const batch = await Validator.validateParseResults(runs)
          Expect(batch.map(result => result.diagnostics)).toEqual(singles.map(result => result.diagnostics))
        },
      )
    },
  )
})

async function withRuns(
  files: Record<string, string>,
  entries: readonly string[],
  check: (runs: readonly Run[], root: string) => Promise<void>,
): Promise<void> {
  const fixture: Record<string, string> = { '.tao/.gitkeep': '', ...files }
  await withTaoFiles('tao-validator-batch-', fixture, async (paths, root) => {
    const packagesContext = await Packages.createContext(root)
    const parser = Parser.createContext({ packages: Packages.createResolver(packagesContext) })
    const parsed = await Parser.parseEntries(parser, entries.map(entry => URI.file(paths[entry]!)), {
      validation: false,
    })
    const projectFiles = [...new Set(parsed.flatMap(result => result.files.map(file => file.ast)))]
    await check(
      parsed.map(parseResult => ({
        parseResult,
        context: Validator.createContext(
          packagesContext,
          parseResult.files.map(file => file.ast),
          parseResult.entry.path,
          projectFiles,
        ),
      })),
      root,
    )
  })
}

async function validateSingles(runs: readonly Run[]): Promise<ValidationResult[]> {
  const results: ValidationResult[] = []
  for (const run of runs) {
    results.push(await Validator.validateParseResult(run.parseResult, run.context))
  }
  return results
}

async function countWork(
  runs: readonly Run[],
  check: () => Promise<void>,
): Promise<{ types: number; graphs: number; foreign: number }> {
  const contexts = new Set(runs.map(run => run.context.packagesContext))
  const counts = { types: 0, graphs: 0, foreign: 0 }
  const types = Validate.Types
  const foreign = Validate.ForeignImplementationFiles
  const resolver = Packages.createResolver
  const restoreTypes = typesSlot.install((...args) => {
    if (contexts.has(args[2].packagesContext)) {
      counts.types += 1
    }
    return types(...args)
  })
  const restoreForeign = foreignSlot.install(async (...args) => {
    if (contexts.has(args[1].packagesContext)) {
      counts.foreign += 1
    }
    await foreign(...args)
  })
  const restoreResolver = resolverSlot.install(context => {
    const original = resolver(context)
    return {
      ...original,
      projectGraph: request => {
        if (contexts.has(context)) {
          counts.graphs += 1
        }
        return original.projectGraph(request)
      },
    }
  })
  try {
    await check()
    return counts
  } finally {
    restoreResolver()
    restoreForeign()
    restoreTypes()
  }
}
