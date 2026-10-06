import { AST, Parser } from '@parser'
import { Diagnostics } from '@shared'
import { Describe, Expect, Test } from '@shared/test'
import { NodeValidation } from '../validator-src/node-validation'
import { Validation } from '../validator-src/validation'
import { numericUnitReadingsValidationChecks } from '../validator-src/validators/numeric-unit-readings-validator'
import { NumericUnitReadingsValidationMessages as messages } from '../validator-src/validators/NumericUnitReadingsValidationMessages'

const span = 'type Span is numeric with { units { seconds 1 (default), minutes 60 } }'

async function validateReadings(source: string) {
  const parsed = await Parser.parseCode(source, { validation: false })
  Expect(parsed.entry.document.parseResult.lexerErrors).toEqual([])
  Expect(parsed.entry.document.parseResult.parserErrors).toEqual([])
  const file = parsed.entry.ast
  const collected = Validation.collectDiagnostics()
  const ctx = Validation.createContext(collected.accept, {
    entryFilePath: parsed.entry.path,
    workspaceFiles: [file],
    packagesContext: {
      index: { projectRoot: '/__fixture__', projectRoots: [], packages: new Map() },
      stdlibRoot: '/__fixture__',
      physicalPaths: new Map(),
      requirementAliases: new Map(),
    },
  })
  NodeValidation.validate(
    [file, ...AST.streamAllContents(file)],
    file,
    ctx,
    NodeValidation.compile([numericUnitReadingsValidationChecks]),
  )
  return collected.diagnostics
}

Describe('validator: numeric unit readings', () => {
  Test('accepts inherited readings and leaves ordinary lowercase methods alone', async () => {
    Expect(Diagnostics.errorMessages(
      await validateReadings(`${span}
      type Child is Span
      type Label is text with { func seconds() -> text { return "label" } }
      func Read(Value Child) -> Child { return Value.minutes() }
      func Ordinary(Value Label) -> text { return Value.seconds() }
    `),
    )).toEqual([])
  })

  Test('reports arguments at the actual invocation', async () => {
    for (const argument of ['1', 'Value: 1']) {
      const diagnostics = await validateReadings(`${span}
        func Read(Value Span) -> Span { return Value.seconds(${argument}) }
      `)
      Expect(Diagnostics.errorMessages(diagnostics)).toEqual([messages.arguments('seconds')])
      Expect(diagnostics[0]?.nodeType).toBe(AST.MethodCallExpression.$type)
    }
  })

  Test('reports authored collisions and attempted calls through inherited tables', async () => {
    const diagnostics = await validateReadings(`${span}
      type Child is Span with { func seconds() -> Child { return Child } }
      type Grandchild is Child
      func Read(Value Grandchild) -> Grandchild { return Value.seconds() }
    `)
    Expect(Diagnostics.errorMessages(diagnostics)).toEqual([
      messages.collision('seconds'),
      messages.collision('seconds'),
    ])
    Expect(diagnostics.map(diagnostic => diagnostic.nodeType)).toEqual([
      AST.AssociatedFunctionDeclaration.$type,
      AST.MethodCallExpression.$type,
    ])
  })

  Test('rejects replacing or extending a fixed ancestor table but allows the first table', async () => {
    for (const units of ['seconds 2 (default)', 'seconds 1 (default), hours 3600']) {
      Expect(Diagnostics.errorMessages(
        await validateReadings(`${span}
        type Child is Span with { units { ${units} } }
      `),
      )).toEqual([messages.inheritedTable])
    }
    Expect(Diagnostics.errorMessages(
      await validateReadings(`
      type Storage is numeric
      type Quantity is Storage with { units { items 1 (default) } }
    `),
    )).toEqual([])
  })
})
