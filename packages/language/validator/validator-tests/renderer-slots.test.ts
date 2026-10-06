import { Packages } from '@ast-utils'
import { AST, codeProjectRoot, Parser } from '@parser'
import { Diagnostics } from '@shared'
import { Describe, Expect, Test } from '@shared/test'
import { NodeValidation } from '../validator-src/node-validation'
import { Validation } from '../validator-src/validation'
import { rendererSlotsValidationChecks } from '../validator-src/validators/renderer-slots-validator'
import { RendererSlotsValidationMessages as messages } from '../validator-src/validators/RendererSlotsValidationMessages'
import {
  stubContainer,
  testValidateCode,
  testValidateCodeWithErrors,
  validationErrorMessages,
  withValidatedFiles,
} from './test-validate'

Describe('validator: renderer slots', () => {
  Test('accepts repeated placements and a readonly named replacement for a typed default', async () => {
    const source = `
      view Default(Value text?, Caption text default "caption") { render "default" }
      view Replacement(Value text?, Caption text default "caption") { render "replacement" }
      ${stubContainer('Host')}
      view Owner() {
        @item(Value text?, Caption text default "caption"): Default
        render Host() {
          @item(Caption: "first", Value: "one")
          @item(Value: "two")
        }
      }
      view Main() {
        render Owner() {
          @item: Replacement
        }
      }
    `
    await testValidateCode(source)
    Expect((await validateRendererSlots(source)).map(diagnostic => diagnostic.message)).toEqual([])
  })

  Test('reports placement binder failures on their real argument and parameter nodes', async () => {
    const diagnostics = await validateRendererSlots(`
      view Host() { render "host" }
      view Owner() {
        @item(Value text, Caption text): empty
        @typedEmpty(Value number, Value text): empty
        render Host() { @item(Value: "first", Value: "second", Extra: "unknown") }
      }
      view Native() accepts slots @native(Value text, Value number) from ./Native.tsx
      view Missing() {
        @item(Value text): empty
        render Host() { @item() }
      }
    `)
    const found = diagnostics.map(diagnostic => diagnostic.message)
    Expect(found).toContain(messages.argumentDuplicateName('Value'))
    Expect(found).toContain(messages.argumentUnknownName('Extra'))
    Expect(found).toContain(messages.argumentMissing('Value'))
    Expect(found.filter(message => message === messages.duplicateParameter('Value'))).toHaveLength(2)
    const argumentDiagnostics = diagnostics.filter(diagnostic =>
      [messages.argumentDuplicateName('Value'), messages.argumentUnknownName('Extra')].includes(diagnostic.message)
    )
    Expect(argumentDiagnostics.map(diagnostic => diagnostic.nodeType)).toEqual(['Argument', 'Argument'])
    const missing = diagnostics.find(diagnostic => diagnostic.message === messages.argumentMissing('Value'))
    Expect(missing?.nodeType).toBe('ParameterDeclaration')
    const duplicates = diagnostics.filter(diagnostic => diagnostic.message === messages.duplicateParameter('Value'))
    Expect(duplicates.map(diagnostic => diagnostic.nodeType)).toEqual([
      'ParameterDeclaration',
      'ParameterDeclaration',
    ])
    Expect(duplicates.every(diagnostic => diagnostic.range !== undefined)).toBe(true)
  })

  Test('checks default type compatibility and replacement role and omission compatibility', async () => {
    const found = (await validateRendererSlots(`
      type Base is text
      type Leaf is Base
      view BadType(Value Leaf) { render "narrow" }
      view BadRole(Other Base) { render "wrong role" }
      view Required(Caption text) { render "required" }
      view Host() { render "host" }
      view TypeOwner() {
        @type(Value Base): BadType
        render Host() { @type(Value: "ok") }
      }
      view RoleOwner() {
        @role(Value Base): BadRole
        render Host() { @role(Value: "ok") }
      }
      view OptionalOwner() {
        @optional(Caption text default "caption"): Required
        render Host() { @optional() }
      }
    `)).map(diagnostic => diagnostic.message)
    Expect(found).toContain(messages.rendererInputDomain('Value'))
    Expect(found).toContain(messages.rendererUnknownRole('Value'))
    Expect(found).toContain(messages.rendererOmission('Caption'))
  })

  Test('accepts a readonly renderer for writable input and rejects unsafe writable replacements', async () => {
    const diagnostics = await validateRendererSlots(`
      type Base is text
      type Leaf is Base
      view Readonly(Value Base) { render "readonly" }
      view Mutable(mutable Value Base) { render "mutable" }
      view LeafReadonly(Value Leaf) { render "leaf" }
      view BroadWriter(mutable Value Base) { render "broad writer" }
      view Host() { render "host" }
      view WritableOwner() {
        @mutable(mutable Value Base): Readonly
        render Host() { @mutable(Value: "value") }
      }
      view StorageOwner() {
        @readonly(Value Base): Readonly
        render Host() { @readonly(Value: "value") }
      }
      view DomainOwner() {
        @leaf(mutable Value Leaf): LeafReadonly
        render Host() { @leaf(Value: "value") }
      }
      view Main() {
        render StorageOwner() { @readonly: Mutable }
      }
      view DomainMain() {
        render DomainOwner() { @leaf: BroadWriter }
      }
    `)
    const diagnosticMessages = diagnostics.map(diagnostic => diagnostic.message)
    Expect(diagnosticMessages.filter(message =>
      message === messages.rendererStorage('Value')
      || message === messages.rendererWriteDomain('Value')
    )).toHaveLength(2)
    Expect(diagnosticMessages).toContain(messages.rendererStorage('Value'))
    Expect(diagnosticMessages).toContain(messages.rendererWriteDomain('Value'))
    const accepted = await validateRendererSlots(`
      type Base is text
      view Readonly(Value Base) { render "readonly" }
      view Host() { render "host" }
      view Owner() {
        @mutable(mutable Value Base): Readonly
        render Host() { @mutable(Value: "value") }
      }
    `)
    Expect(accepted).toEqual([])
  })

  Test('keeps named and empty fills distinct and rejects repeated fills by resolved slot identity', async () => {
    const result = await testValidateCodeWithErrors(`
      view Renderer(Value text) { render "renderer" }
      view Host() { render "host" }
      view Owner() {
        @item(Value text): Renderer
        @emptySlot: empty
        render Host() { }
      }
      view Main() {
        render Owner() {
          @item: Renderer
          @item: empty
          @emptySlot: empty
          @emptySlot: empty
        }
      }
    `)
    const found = validationErrorMessages(result)
    Expect(found).toContain(messages.duplicateFill('@item'))
    Expect(found).toContain(messages.duplicateFill('@emptySlot'))
  })

  Test('resolves alias fills against the receiving slot declaration and terminates alias cycles', async () => {
    await withValidatedFiles('Main.tao', {
      'Main.tao': `
        use package @components
        view LocalRenderer = components.Renderer
        view LocalOwner = components.SecondAlias
        view Main() { render LocalOwner("main") { @item: LocalRenderer } }
      `,
      '@components/Components.tao': `
        use package @components
        public view Renderer(Value text) { render "renderer" }
        public ${stubContainer('Host')}
        public view Owner(Value text) {
          @item(Value text): Renderer
          render Host() { @item(Value: Value) @item(Value: Value) }
        }
        public view FirstAlias = components.Owner
        public view SecondAlias = components.FirstAlias
        public view CycleA = components.CycleB
        public view CycleB = components.CycleA
      `,
    }, result => {
      Expect(Diagnostics.errorMessages(result.diagnostics, 'parser')).toEqual([])
      Expect(Diagnostics.errorMessages(result.diagnostics, 'linker')).toEqual([])
      const allNodes = result.files.flatMap(file => [...AST.streamAllContents(file.ast)])
      const owner = findView(allNodes, 'Owner')
      const cycleA = findView(allNodes, 'CycleA')
      const cycleB = findView(allNodes, 'CycleB')
      const ownerSlot = AST.renderSlotDeclarationsOf(owner)[0]
      Expect.Is(ownerSlot, AST.isRenderSlotDeclaration)
      const secondAlias = findView(allNodes, 'SecondAlias')
      Expect(AST.renderSlotDeclarationsOf(secondAlias)[0] === ownerSlot).toBe(true)
      const fill = [...AST.streamAllContents(result.entry.ast)].find(node =>
        AST.isRenderSlotUse(node) && AST.isRenderSlotFill(node)
      )
      Expect.Is(fill, AST.isRenderSlotUse)
      Expect(fill.slot.ref === ownerSlot).toBe(true)
      Expect(AST.renderSlotDeclarationsOf(cycleA)).toEqual([])
      Expect(AST.renderSlotDeclarationsOf(cycleA)).toEqual([])
      Expect(AST.renderSlotDeclarationsOf(cycleB)).toEqual([])
      Expect(AST.renderSlotDeclarationsOf(cycleB)).toEqual([])
    })
  })

  Test('checks explicit inline names against the receiving input list', async () => {
    const source = `
      view Owner() {
        @item(Value text, Count number): empty
        render "owner"
      }
      view Main() {
        render Owner() { @item Row, Position -> "{Row}:{Position}" }
        render Owner() { @item Row, Row -> "{Row}" }
        render Owner() { @item Row, Position, Extra -> "row" }
      }
    `
    const diagnostics = await validateRendererSlots(source)
    Expect(diagnostics.map(diagnostic => diagnostic.message)).toEqual([
      messages.duplicateInlineInput('Row'),
      messages.inlineInputCount('@item', 2),
    ])
    Expect(diagnostics.find(diagnostic => diagnostic.message === messages.duplicateInlineInput('Row'))?.nodeType).toBe(
      'RenderSlotInputBinding',
    )
  })

  Test('checks forwarded renderer domains and writable storage using actual slot inputs', async () => {
    const diagnostics = await validateRendererSlots(`
      type Base is text
      type Leaf is Base
      view Receiver() {
        @item(Value Base): empty
        render "receiver"
      }
      view Safe() {
        @row(Value Base): empty
        render Receiver() { @item: @row }
      }
      view Narrow() {
        @row(Value Leaf): empty
        render Receiver() { @item: @row }
      }
      view Writer() {
        @row(mutable Value Base): empty
        render Receiver() { @item: @row }
      }
    `)
    Expect(diagnostics.map(diagnostic => diagnostic.message)).toEqual([
      messages.rendererInputDomain('Value'),
      messages.rendererStorage('Value'),
    ])
    Expect(diagnostics.map(diagnostic => diagnostic.nodeType)).toEqual([
      'ParameterDeclaration',
      'ParameterDeclaration',
    ])
  })

  Test('rejects absent and typed inline replacement bodies while preserving empty suppression', async () => {
    const found = (await validateRendererSlots(`
      view Host() { render "host" }
      view Owner() {
        @item(Value text): empty
        @zero: empty
        @unfinished:
        render Host() { }
      }
      view Main() {
        render Owner() {
          @item:
        }
        render Owner() {
          @item: { render "replacement" }
          @zero: empty
        }
      }
    `)).map(diagnostic => diagnostic.message)
    Expect(found).toContain(messages.absentBody('@item'))
    Expect(found).toContain(messages.absentBody('@unfinished'))
    Expect(found).toContain(messages.inlineInputs('@item'))
    Expect(found).not.toContain(messages.inlineInputs('@zero'))
  })
})

function findView(nodes: readonly AST.Node[], name: string): AST.ViewDeclaration {
  const view = nodes.find(node => AST.isViewDeclaration(node) && node.name === name)
  Expect.Is(view, AST.isViewDeclaration)
  return view
}

async function validateRendererSlots(source: string) {
  const packagesContext = await Packages.createContext(codeProjectRoot)
  const parserContext = Parser.createContext({ packages: Packages.createResolver(packagesContext) })
  const parsed = await Parser.parseSource(parserContext, source)
  const parserErrors = Diagnostics.errorMessages(parsed.diagnostics, 'parser')
  Expect(parserErrors).toEqual([])
  Expect(Diagnostics.errorMessages(parsed.diagnostics, 'linker')).toEqual([])
  const file = parsed.entry.ast
  const collected = Validation.collectDiagnostics()
  const context = Validation.createContext(collected.accept, {
    entryFilePath: parsed.entry.path,
    workspaceFiles: parsed.files.map(parsedFile => parsedFile.ast),
    projectFiles: parsed.files.map(parsedFile => parsedFile.ast),
    packagesContext,
  })
  NodeValidation.validate(
    [...AST.streamAllContents(file)],
    file,
    context,
    NodeValidation.compile([rendererSlotsValidationChecks]),
  )
  return collected.diagnostics
}
