import { ASTUtils, Type } from '@ast-utils'
import { AST, Parser } from '@parser'
import { Assert, Diagnostics } from '@shared'
import { Describe, Expect, Test } from '@shared/test'
import { Validate } from '../validator-src/Validate'
import { Validation } from '../validator-src/validation'
import { AssociatedMethodsValidationMessages as messages } from '../validator-src/validators/AssociatedMethodsValidationMessages'
import { accepts, rejects } from './test-validate'

Describe('validator: associated declaration boundaries', () => {
  Test('reports incomplete purity and a violated declared bound from the supplied sealed analyses', async () => {
    const parsed = await Parser.parseCode(`
      type Token is text with { func ToText() fails never -> text { return "token" } }
    `)
    Expect(parsed.diagnostics).toEqual([])
    const file = parsed.entry.ast
    const owner = file.statements.find(AST.isTypeDeclaration)
    Assert(owner, 'Expected a named fixture owner.')
    const method = ASTUtils.ownAssociatedMethods(owner)[0]!
    const contract = Type.associatedCallable(method, owner)
    Assert(contract.kind === 'ready', 'Expected a ready fixture method.')
    const descriptors = new Map([[method, contract.descriptor]])
    for (
      const [analyses, expected] of [
        [new Map(), [messages.purity('ToText')]],
        [
          new Map([[method, {
            effects: { purity: { open: false, violations: [] }, failures: { open: true, cases: [] } },
            findings: [],
          }]]),
          [messages.failures('ToText')],
        ],
        [
          new Map([[method, {
            effects: { purity: { open: false, violations: [] }, failures: { open: false, cases: [] } },
            findings: [],
          }]]),
          [],
        ],
      ] satisfies [ASTUtils.AssociatedEffectsContext['analyses'], string[]][]
    ) {
      const collected = Validation.collectDiagnostics()
      const context = Validation.createContext(collected.accept, {
        entryFilePath: parsed.entry.path,
        workspaceFiles: [file],
        packagesContext: {
          index: { projectRoot: '/__tao__', projectRoots: [], packages: new Map() },
          stdlibRoot: '/__tao__',
          physicalPaths: new Map(),
          requirementAliases: new Map(),
        },
      })
      Validate.TaoFile(file, context, { descriptors, analyses })
      Expect(Diagnostics.errorMessages(collected.diagnostics)).toEqual(expected)
    }
  })

  Test(
    'reports an unknown associated method on the actual receiver',
    rejects(
      `
      type Token is text with { func ToText() -> text { return "token" } }
      func Show(Value Token) -> text { return Value.Missing() }
    `,
      messages.unknown('Missing'),
    ),
  )

  Test(
    'reports a missing required method argument through the ordinary callable binder',
    rejects(
      `
      type Token is text with { func Format(Count number) -> text { return "token" } }
      func Show(Value Token) -> text { return Value.Format() }
    `,
      "Function 'Token.Format' is missing argument for parameter 'Count'.",
    ),
  )

  Test(
    'reports a labeled method argument type mismatch through the ordinary callable binder',
    rejects(
      `
      type Token is text with { func Format(Count number) -> text { return "token" } }
      func Show(Value Token) -> text { return Value.Format(Count: "wrong") }
    `,
      "Labeled argument 'Count:' of function 'Token.Format' expects number, got text.",
    ),
  )

  Test(
    'accepts a method default without positional rebinding',
    accepts(`
      type Token is text with {
        func Format(Count number, Prefix text default "token") -> text { return Prefix }
      }
      func Show(Value Token) -> text { return Value.Format(Count: 2) }
    `),
  )

  Test(
    'rejects mutable native capability inputs before a payload adapter can discard their witness',
    rejects(
      `
      can Display { ToText() -> text }
      view Native(mutable Value Display) {
        render inject Value \`\`\`ts
          return null
        \`\`\`
      }
    `,
      messages.nativeMutable,
    ),
  )

  Test(
    'rejects block-local method owners before module witness publication',
    rejects(
      `
      view Local() {
        type Token is text with { func ToText() -> text { return "token" } }
      }
    `,
      messages.placement,
    ),
  )

  Test(
    'accepts independent text owners and a descendant inheriting their methods',
    accepts(`
    type Token is text with { func ToText() -> text { return "token:{Token}" } }
    type Label is text with { func ToText() -> text { return "label:{Label}" } }
    type Child is Token
    can Display { ToText() -> text }
    func Relay(Value Display) -> Display { return Value }
  `),
  )

  Test(
    'rejects unsupported owner families before replacing an existing runtime surface',
    rejects(
      `
    type Count is number with { func ToText() -> text { return "count" } }
  `,
      messages.family,
    ),
  )

  Test(
    'keeps a declared failure bound separate and rejects unsupported bound spellings',
    rejects(
      `
    can Display { ToText() fails Maybe -> text }
  `,
      messages.failureBound,
    ),
  )

  Test(
    'rejects duplicate structural requirement names',
    rejects(
      `
    can Display { ToText() -> text ToText() -> text }
  `,
      messages.duplicateRequirement('ToText'),
    ),
  )
})
