import { Packages, Type } from '@ast-utils'
import { Workspace } from '@compiler/workspace'
import { AST, Parser, URI } from '@parser'
import { Diagnostics, Errors, FS, ReleaseCapabilities } from '@shared'
import { Describe, Expect, Test, testOverrideSlot, withTaoFiles } from '@shared/test'
import { Validate } from '../validator-src/Validate'
import Validator from '../validator-src/validator'
import { AliasesValidator } from '../validator-src/validators/aliases-validator'
import { AppValidator } from '../validator-src/validators/app-validator'
import { FunctionalCoreValidator } from '../validator-src/validators/FunctionalCoreValidator'
import { StateValidator } from '../validator-src/validators/StateValidator'
import { ViewsValidator } from '../validator-src/validators/views-validator'

const typesSlot = testOverrideSlot<typeof Validate.Types>({
  read: () => Validate.Types,
  write: Types => Object.assign(Validate, { Types }),
})
const inferenceSlot = testOverrideSlot<typeof Type.ofExpression>({
  read: () => Type.ofExpression,
  write: ofExpression => {
    Type.ofExpression = ofExpression
  },
})
const appSlot = testOverrideSlot<typeof AppValidator.validate>({
  read: () => AppValidator.validate,
  write: validate => Object.assign(AppValidator, { validate }),
})
const foreignSlot = testOverrideSlot<typeof Validate.ForeignImplementationFiles>({
  read: () => Validate.ForeignImplementationFiles,
  write: ForeignImplementationFiles => Object.assign(Validate, { ForeignImplementationFiles }),
})
const dependenciesSlot = testOverrideSlot<typeof Parser.validationDependencies>({
  read: () => Parser.validationDependencies,
  write: validationDependencies => Object.assign(Parser, { validationDependencies }),
})

Describe('validator: workspace-owned document report reuse', () => {
  Test('replays ordered reports across six entry contexts while global and foreign checks run fresh', async () => {
    await withTaoFiles('tao-document-reports-entries-', {
      '.tao/.gitkeep': '',
      'One.tao': `let Wrong is number = "bad"
        let Calculation = true + 2
        view LocalView() { state Count is number = "wrong" render inject \`\`\`ts return null \`\`\` }`,
      'Two.tao': 'let Two = "two"',
      'Three.tao': 'let Three = "three"',
      'Four.tao': 'let Four = "four"',
      'Five.tao': 'let Five = "five"',
      'Six.tao': 'let Six = "six"',
    }, async (_paths, root) => {
      const workspace = await Workspace.open(root)
      const entries = ['One', 'Two', 'Three', 'Four', 'Five', 'Six'].map(name => FS.resolvePath(`${name}.tao`, root))
      const parsed = await workspace.parseFiles(entries)
      Expect(parsed.flatMap(result => result.diagnostics)).toEqual([])
      const file = parsed[0]!.entry.ast
      const binary = AST.streamAllContents(file).find(AST.isBinaryExpression)
      Expect.Is(binary, AST.isBinaryExpression)
      Expect(Parser.validationDependencies(file)).toBeDefined()
      const dependencies = Parser.validationDependencies(file)!
      const counts = { types: 0, local: 0, global: 0, foreign: 0 }
      const types = Validate.Types
      const inference = Type.ofExpression
      const app = AppValidator.validate
      const foreign = Validate.ForeignImplementationFiles
      const restores = [
        typesSlot.install((...args) => {
          if (args[0] === file) {
            counts.types++
          }
          return types(...args)
        }),
        inferenceSlot.install((...args) => {
          if (args[0] === binary.left) {
            counts.local++
          }
          return inference(...args)
        }),
        appSlot.install((...args) => {
          if (args[0] === file) {
            counts.global++
          }
          return app(...args)
        }),
        foreignSlot.install(async (...args) => {
          if (args[0] === file) {
            counts.foreign++
          }
          await foreign(...args)
        }),
      ]
      try {
        const first = await workspace.validateParsedFiles(parsed)
        Expect(Diagnostics.messages(first.diagnostics)).toContain(
          AliasesValidator.messages.ascriptionType('Wrong', 'number', 'text'),
        )
        Expect(Diagnostics.messages(first.diagnostics)).toContain(FunctionalCoreValidator.messages.binaryNumeric('+'))
        Expect(Diagnostics.messages(first.diagnostics)).toContain(
          StateValidator.messages.initialTypeMismatch('Count', 'number', 'text'),
        )
        Expect(counts.local).toBeGreaterThan(0)
        Expect(counts.types).toBe(1)
        counts.types =
          counts.local =
          counts.global =
          counts.foreign =
            0
        const refreshed = await workspace.parseFiles(entries)
        Expect(refreshed[0]!.entry.ast).toBe(file)
        Expect(refreshed.map(result => result.files.map(file => file.path)))
          .toEqual(parsed.map(result => result.files.map(file => file.path)))
        const currentDependencies = Parser.validationDependencies(file)!
        Expect(currentDependencies.signature).toBe(dependencies.signature)
        Expect(currentDependencies.files.length).toBe(dependencies.files.length)
        currentDependencies.files.forEach((dependency, index) => Expect(dependency).toBe(dependencies.files[index]))
        Expect(currentDependencies.targets.length).toBe(dependencies.targets.length)
        currentDependencies.targets.forEach((target, index) => Expect(target).toBe(dependencies.targets[index]))
        const second = await workspace.validateParsedFiles(refreshed)
        Expect(second.diagnostics).toEqual(first.diagnostics)
        Expect(counts).toEqual({ types: 0, local: 0, global: 6, foreign: 6 })
        // Returned diagnostics are private to their invocation, including when replaying reports.
        Expect(second.diagnostics).not.toBe(first.diagnostics)
        const cold = await (await Workspace.open(root)).validateFiles(entries)
        Expect(second.diagnostics).toEqual(cold.diagnostics)
        const reverse = await workspace.validateFiles([...entries].reverse())
        const reverseCold = await (await Workspace.open(root)).validateFiles([...entries].reverse())
        Expect(reverse.diagnostics).toEqual(reverseCold.diagnostics)
      } finally {
        restores.reverse().forEach(restore => restore())
      }
    })
  })

  Test('invalidates imported and transitive body/type changes without replacing the consumer AST', async () => {
    await withTaoFiles('tao-document-reports-imports-', {
      '.tao/.gitkeep': '',
      'Main.tao': 'use Echo from ./library/Echo\nlet Result is number = Echo()',
      'library/Echo.tao': 'use Base from ./nested/Base\npublic func Echo() { return Base() }',
      'library/nested/Base.tao': 'public func Base() { return 7 }',
    }, async (paths, root) => {
      const workspace = await Workspace.open(root)
      const before = await workspace.validate(paths['Main.tao']!)
      Expect(before.diagnostics).toEqual([])
      await workspace.validate(paths['Main.tao']!)
      for (
        const source of [
          'public func Base() { return "changed" }',
          'public func Base() -> number { return 9 }',
        ]
      ) {
        await FS.writeText(paths['library/nested/Base.tao']!, source)
        const warm = await workspace.validate(paths['Main.tao']!)
        const cold = await (await Workspace.open(root)).validate(paths['Main.tao']!)
        Expect(warm.entry.ast).toBe(before.entry.ast)
        Expect(warm.diagnostics).toEqual(cold.diagnostics)
        Expect(
          Diagnostics.messages(warm.diagnostics).includes(
            AliasesValidator.messages.ascriptionType('Result', 'number', 'text'),
          ),
        )
          .toBe(source.includes('"changed"'))
      }
      await FS.writeText(paths['library/Echo.tao']!, 'public func Echo() { return "direct" }')
      const direct = await workspace.validate(paths['Main.tao']!)
      Expect(Diagnostics.messages(direct.diagnostics)).toContain(
        AliasesValidator.messages.ascriptionType('Result', 'number', 'text'),
      )
      Expect(direct.diagnostics).toEqual((await (await Workspace.open(root)).validate(paths['Main.tao']!)).diagnostics)
    })
  })

  Test('keeps source overlays, syntax/link errors and recovered dependency membership current', async () => {
    await withTaoFiles('tao-document-reports-overlay-', {
      '.tao/.gitkeep': '',
      'Main.tao': 'use Value from ./library/Value\nlet Result is number = Value',
      'library/Value.tao': 'public let Value = 1',
    }, async (paths, root) => {
      const workspace = await Workspace.open(root)
      const entry = paths['Main.tao']!
      const library = paths['library/Value.tao']!
      Expect((await workspace.validate(entry)).diagnostics).toEqual([])
      Expect((await workspace.validate(entry)).diagnostics).toEqual([])
      for (const source of ['public let Value = "overlay"', '$', 'public let Other = 3', 'public let Value = 4']) {
        const overrides = { [library]: source }
        await workspace.setSourceOverrides(overrides)
        const warm = await workspace.validate(entry)
        const cold = await (await Workspace.open(root, { sourceOverrides: overrides })).validate(entry)
        Expect(warm.diagnostics).toEqual(cold.diagnostics)
        if (source === '$') {
          Expect(Diagnostics.hasSource(warm.diagnostics, 'lexer')).toBe(true)
        }
        if (source.includes('Other')) {
          Expect(Diagnostics.hasSource(warm.diagnostics, 'linker')).toBe(true)
        }
        if (source.includes('overlay')) {
          Expect(Diagnostics.messages(warm.diagnostics)).toContain(
            AliasesValidator.messages.ascriptionType('Result', 'number', 'text'),
          )
        }
      }
      await workspace.setSourceOverrides({})
      Expect((await workspace.validate(entry)).diagnostics).toEqual([])
    })
  })

  Test('rechecks foreign files after create, content change and deletion despite unchanged Tao ASTs', async () => {
    await withTaoFiles('tao-document-reports-foreign-', {
      '.tao/.gitkeep': '',
      'Main.tao': 'view Foreign() from ./Foreign.tsx\nlet Local = 2 + 3',
    }, async (paths, root) => {
      const workspace = await Workspace.open(root)
      const entry = paths['Main.tao']!
      const implementation = FS.resolvePath('Foreign.tsx', root)
      const first = await workspace.validate(entry)
      const missing = ViewsValidator.messages.foreignViewMissing('./Foreign.tsx')
      Expect(Diagnostics.messages(first.diagnostics)).toContain(missing)
      await workspace.validate(entry)
      const original = Validate.ForeignImplementationFiles
      const contents: (string | undefined)[] = []
      const restore = foreignSlot.install(async (file, ctx) => {
        if (AST.getDocument(file).uri.path === entry) {
          contents.push(await FS.exists(implementation) ? await FS.readText(implementation) : undefined)
        }
        await original(file, ctx)
      })
      try {
        for (
          const source of [
            'export default function Foreign() { return null }',
            'export default function Foreign() { return "changed" }',
            undefined,
          ]
        ) {
          if (source === undefined) {
            await FS.remove(implementation)
          } else {
            await FS.writeText(implementation, source)
          }
          const warm = await workspace.validate(entry)
          Expect(warm.entry.ast).toBe(first.entry.ast)
          Expect(Diagnostics.messages(warm.diagnostics).includes(missing)).toBe(source === undefined)
          Expect(warm.diagnostics).toEqual((await (await Workspace.open(root)).validate(entry)).diagnostics)
        }
        Expect(contents).toEqual([
          'export default function Foreign() { return null }',
          'export default function Foreign() { return null }',
          'export default function Foreign() { return "changed" }',
          'export default function Foreign() { return "changed" }',
          undefined,
          undefined,
        ])
      } finally {
        restore()
      }
    })
  })

  Test('keeps contexts private and discards staged reports after incomplete validation', async () => {
    await withTaoFiles('tao-document-reports-contexts-', {
      '.tao/.gitkeep': '',
      'Main.tao': 'let Value = 2 + 3',
    }, async (paths, root) => {
      const packages = await Packages.createContext(root)
      const parser = Parser.createContext({ packages: Packages.createResolver(packages) })
      const parsed = await Parser.parse(parser, URI.file(paths['Main.tao']!), { validation: false })
      const context = Validator.createContext(packages, parsed.files.map(file => file.ast), parsed.entry.path)
      const reuse = Validator.createDocumentReuse()
      const original = Validate.Types
      let calls = 0
      const restore = typesSlot.install((...args) => {
        if (args[0] === parsed.entry.ast) {
          calls++
        }
        return original(...args)
      })
      const run = (ctx = context) => Validator.validateParseResults([{ parseResult: parsed, context: ctx }], reuse)
      try {
        await run()
        Expect(calls).toBe(1)
        await run()
        Expect(calls).toBe(1)
        const otherContext = { ...context, packagesContext: await Packages.createContext(root) }
        await run(otherContext)
        Expect(calls).toBe(2)
        await run({ ...context, workspaceFiles: [...context.workspaceFiles].reverse() })
        Expect(calls).toBe(3)
        const release = ReleaseCapabilities.profile(1)
        await run({ ...context, releaseProfile: release })
        Expect(calls).toBe(4)
        const originalForeign = Validate.ForeignImplementationFiles
        const restoreFailure = foreignSlot.install(async () =>
          Errors.throwUnexpected('incomplete document validation fixture')
        )
        try {
          await Expect(run()).rejects.toThrow('incomplete document validation fixture')
        } finally {
          restoreFailure()
        }
        Expect(Validate.ForeignImplementationFiles).toBe(originalForeign)
        const afterFailure = calls
        await run()
        Expect(calls).toBe(afterFailure + 1)
        reuse.clear()
        await run()
        Expect(calls).toBe(afterFailure + 2)
        const restoreUnknown = dependenciesSlot.install(() => undefined)
        try {
          await run()
          await run()
          Expect(calls).toBe(afterFailure + 4)
        } finally {
          restoreUnknown()
        }
      } finally {
        restore()
      }
    })
  })
})
