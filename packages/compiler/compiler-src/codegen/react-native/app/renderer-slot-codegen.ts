import { ASTUtils, Type } from '@ast-utils'
import { AST } from '@parser'
import { Assert, Switch } from '@shared'
import { type CodegenOptions, type Compiled, gen } from '../codegen-util'
import { Compile } from '../Compile'
import { compileValueForType } from './capability-projection'
import { compileReactiveArgument } from './reactive-parameters'
import { registerSlotBody } from './render-slot-hoists'

type SlotUse = AST.RenderSlotUse
type SlotContract = AST.RenderSlotContract

/** emitSlotBody creates one stable module component for a source body and reconstructs its captures. */
export function emitSlotBody(
  input: Readonly<{
    anchor: AST.Node
    contract: SlotContract
    body: AST.RenderSlotUse | AST.RenderSlotDeclaration
    options: CodegenOptions
    environment: Compiled
  }>,
): Compiled {
  const occurrence = AST.isRenderSlotUse(input.body) ? input.body : undefined
  const signature = ASTUtils.rendererSlotSignatureOf(input.contract, occurrence)
  const argumentType = slotArgumentType(signature)
  // The hoisted environment transports the declaring view's lexical members and props.
  // Its scope remains dynamically shaped, including captured component names used in JSX.
  const environmentType = gen`Readonly<{
    _Scope: any
    _ViewProps: any
    _TaoActionOwner: any
    _TaoAuthScope: TR.AuthScope | undefined
    _TaoSlotDefaults: Readonly<Record<string, TR.SlotRenderer<any> | null>>
  }>`
  const bodyName = registerSlotBody(input.anchor, input.options, name => {
    const bodyOptions = input.options
    const viewBody = compileSlotBody(input.body, input.contract, bodyOptions)
    return gen`
      function ${name}({ ${
      signature.inputs.length > 0 ? gen`args, ` : gen.noop()
    }environment, taoProps }: TR.SlotBodyProps<${argumentType}, ${environmentType}>) {
        const {
          _Scope,
          _ViewProps: _SlotParentViewProps,
          _TaoActionOwner,
          _TaoAuthScope,
          _TaoSlotDefaults,
        } = environment
        void _TaoActionOwner
        void _TaoAuthScope
        void _TaoSlotDefaults
        const _ViewProps = { ..._SlotParentViewProps, __tao: taoProps ?? _SlotParentViewProps.__tao }
        return TR.BlockScope(_Scope, _Scope => {
          ${
      occurrence?.inputBindings.length
        ? gen.list(occurrence.inputBindings, binding => {
          const domain = ASTUtils.resolveRendererSlotInputBinding(binding)
          Assert.defined(domain, 'validated inline slot name retains its receiving input')
          return slotBodyParameterBinding(domain.parameter, domain.input.labelName, binding.name, domain.input.type)
        })
        : gen.list(signature.inputs, input =>
          slotBodyParameterBinding(input.declaration, input.labelName, input.labelName, input.type))
    }
          ${viewBody}
        })
      }
    `
  })
  return emitSlotDescriptor({
    createRenderer: gen`TR.RenderSlots.create<${argumentType}, ${environmentType}>`,
    body: gen.Name({ name: bodyName }),
    environment: input.environment,
  })
}

/** emitSlotPlacement compiles one typed placement with lazy argument evaluation on explicit null. */
export function compileSlotPlacement(use: SlotUse, options: CodegenOptions): Compiled {
  Assert(!AST.isRenderSlotFill(use), 'filled renderer slots do not emit a placement')
  const contract = use.slot.ref
  Assert.defined(contract, 'validated slot placement resolves its declared contract')
  const binding = ASTUtils.bindRendererSlotArguments(use)
  Assert.defined(binding, 'validated slot placement has a renderer slot signature')
  Assert(binding.diagnostics.length === 0, 'validated slot placement arguments bind without diagnostics')
  const signature = ASTUtils.rendererSlotSignatureOf(contract)
  const argumentType = slotArgumentType(signature)
  const sourceOrderedPairs = AST.argumentsOf(use).flatMap(argument => {
    const pair = binding.pairs.find(candidate => candidate.argument === argument)
    return pair ? [pair] : []
  })
  const name = use.slot.$refText
  const selection = gen`TR.RenderSlots.select(
    _ViewProps.__taoSlots,
    ${gen.jsLiteral(name)},
    _TaoSlotDefaults[${gen.jsLiteral(name)}],
  )`
  const args = compileSlotArguments(signature, sourceOrderedPairs)
  return emitSlotPlacement({
    createElement: gen`React.createElement`,
    frameComponent: gen`TR.RenderSlots.Frame<${argumentType}>`,
    selection,
    selectedLocal: '_TaoSelectedSlot',
    rendererForSelected: gen`_TaoSelectedSlot`,
    argumentsForSelected: args,
    emptyArguments: gen`{} as ${argumentType}`,
    taoProps: Compile.RenderSlotTaoProps(use, options),
    taoPropsLocal: '_TaoSlotTaoProps',
  })
}

/** compileSlotArguments evaluates source expressions first, then binds defaults in contract order. */
function compileSlotArguments(
  signature: ASTUtils.CallableSignature,
  pairs: readonly ASTUtils.RenderInvocationPair[],
): Compiled {
  const parameters = signature.inputs.map(input => input.declaration)
  const inputTypes = new Map(signature.inputs.map(input => [input.declaration, input.type]))
  const sourceNames = new Map<AST.ParameterDeclaration, string>()
  const sourceAssignments = pairs.map((pair, index) => {
    const local = `_TaoSlotSourceArgument${index}`
    sourceNames.set(pair.parameter, local)
    const source = Type.genericRoleConstructor(pair.argument)?.value ?? pair.argument.value
    const expected = inputTypes.get(pair.parameter)
    Assert.defined(expected, 'validated slot argument has an input domain in its callable signature')
    return gen`const ${gen.Name({ name: local })} = ${
      compileValueForType(compileReactiveArgument(source), Type.ofExpression(source), expected)
    }`
  })
  return gen`(() => {
    ${gen.list(sourceAssignments, statement => statement)}
    return TR.BlockScope(_Scope, _Scope => {
      ${
    gen.list(parameters, parameter => {
      const source = sourceNames.get(parameter)
      const value = source
        ? gen`${gen.Name({ name: source })}`
        : parameter.defaultValue
        ? compileValueForType(
          compileReactiveArgument(parameter.defaultValue),
          Type.ofExpression(parameter.defaultValue),
          inputTypes.get(parameter)!,
        )
        : gen`TR.Value(undefined)`
      return gen`_Scope[${gen.jsLiteral(Type.parameterName(parameter))}] = ${value}`
    })
  }
      return {
        ${
    gen.list(parameters, parameter => {
      const name = Type.parameterName(parameter)
      return gen`${gen.jsLiteral(name)}: _Scope[${gen.jsLiteral(name)}],`
    })
  }
      } as ${slotArgumentType(signature)}
    })
  })()`
}

/** compileNamedSlotRenderer renames slot inputs through the semantic signature correspondence. */
function compileNamedSlotRenderer(
  contract: SlotContract,
  renderer: AST.ViewDeclaration,
  args: Compiled,
  taoProps: Compiled,
  occurrence: AST.RenderSlotUse,
): Compiled {
  const comparison = ASTUtils.compareRendererSlotRenderer(contract, renderer, occurrence)
  Assert(comparison.diagnostics.length === 0, 'validated named slot renderer matches the receiving contract')
  return namedRendererElement(renderer, comparison.correspondence, args, taoProps)
}

/** compileDefaultSlotRenderer uses the storage-neutral contract mapping for a declared fallback. */
function compileDefaultSlotRenderer(
  contract: SlotContract,
  renderer: AST.ViewDeclaration,
  args: Compiled,
  taoProps: Compiled,
): Compiled {
  const correspondence = ASTUtils.rendererSlotDefaultParameterCorrespondence(
    contract,
    renderer,
  )
  return namedRendererElement(renderer, correspondence, args, taoProps)
}

function namedRendererElement(
  renderer: AST.ViewDeclaration,
  correspondence: readonly Readonly<
    { required: { declaration: AST.ParameterDeclaration }; supplied: { declaration: AST.ParameterDeclaration } }
  >[],
  args: Compiled,
  taoProps: Compiled,
): Compiled {
  return gen`<${gen.scopeName(renderer)}
    ${
    gen.list(correspondence, pair => {
      const slotName = Type.parameterName(pair.required.declaration)
      const rendererName = Type.parameterName(pair.supplied.declaration)
      return gen`${gen.Name({ name: rendererName })}={${args}[${gen.jsLiteral(slotName)}]}`
    })
  }
    __tao={${taoProps}}
  />`
}

function compileSlotBody(
  body: AST.RenderSlotUse | AST.RenderSlotDeclaration,
  contract: SlotContract,
  options: CodegenOptions,
): Compiled {
  const shape = AST.renderSlotBodyOf(body)
  return Switch.on(shape, 'kind', {
    empty: () => gen`return null`,
    absent: () => gen`return null`,
    named: shape => {
      Assert(AST.isRenderSlotUse(body) || AST.isRenderSlotDeclaration(body), 'named slot body belongs to slot syntax')
      const renderer = shape.renderer.ref
      Assert(AST.isViewDeclaration(renderer), 'validated named slot body resolves a view')
      const args = gen`_Scope`
      const element = AST.isRenderSlotUse(body)
        ? compileNamedSlotRenderer(contract, renderer, args, gen`taoProps`, body)
        : compileDefaultSlotRenderer(contract, renderer, args, gen`taoProps`)
      return gen`return ${element}`
    },
    render: shape => gen`return ${Compile.Render(shape.render, options)}`,
    forwarded: shape => {
      Assert(AST.isRenderSlotUse(body), 'forwarding belongs to a slot fill')
      const comparison = ASTUtils.compareRendererSlotForwarding(body)
      Assert(comparison?.compatible, 'validated forwarding retains its safe input correspondence')
      const argumentType = slotArgumentType(ASTUtils.rendererSlotSignatureOf(shape.slot.ref!))
      return gen`return React.createElement(TR.RenderSlots.Frame<${argumentType}>, {
        renderer: ${compileForwardedSlotSelection(body)},
        args: {
          ${
        gen.list(comparison.correspondence, pair =>
          gen`${gen.jsLiteral(pair.supplied.labelName)}: ${
            compileValueForType(
              gen`_Scope[${gen.jsLiteral(pair.required.labelName)}]`,
              pair.required.type,
              pair.supplied.type,
            )
          },`)
      }
        },
        taoProps,
      })`
    },
    block: shape => Compile.RenderBlockBody(shape.block, options),
  })
}

export function compileForwardedSlotSelection(fill: AST.RenderSlotUse): Compiled {
  const source = fill.forwardedSlot?.ref
  Assert.defined(source, 'validated forwarding resolves the lexical source slot')
  return gen`TR.RenderSlots.select(_ViewProps.__taoSlots, ${gen.jsLiteral(source.name)}, _TaoSlotDefaults[${
    gen.jsLiteral(source.name)
  }])`
}

function slotBodyParameterBinding(
  parameter: AST.ParameterDeclaration,
  argumentName = Type.parameterName(parameter),
  localName = Type.parameterName(parameter),
  type: ASTUtils.TaoType = Type.ofParameter(parameter),
): Compiled {
  const argument = gen`args[${gen.jsLiteral(argumentName)}]`
  const value = ASTUtils.containsCapability(type) ? argument : gen`TR.Capability.concreteSource(${argument})`
  const binding = parameter.copy || ASTUtils.parameterRequiresWritable(parameter)
    ? gen`TR.UseParameterCell(${value}, { copy: ${parameter.copy} })`
    : value
  return gen`_Scope[${gen.jsLiteral(localName)}] = ${binding}`
}

function slotArgumentType(signature: ASTUtils.CallableSignature): Compiled {
  return gen`Readonly<{
    ${gen.list(signature.inputs, input => gen`${gen.jsLiteral(input.labelName)}: ${Compile.RuntimeType(input.type)}`)}
  }>`
}

/** emitSlotDescriptor pairs a stable module component with the enclosing render's current environment. */
export function emitSlotDescriptor(
  input: Readonly<{
    createRenderer: Compiled
    body: Compiled
    environment: Compiled
  }>,
): Compiled {
  return gen`(${input.createRenderer})((${input.body}), (${input.environment}))`
}

/** emitSlotPlacement keeps one frame across normalized empty and selected slot bindings. */
export function emitSlotPlacement(
  input: Readonly<{
    createElement: Compiled
    frameComponent: Compiled
    selection: Compiled
    selectedLocal: string
    rendererForSelected: Compiled
    argumentsForSelected: Compiled
    emptyArguments: Compiled
    taoProps: Compiled
    taoPropsLocal: string
    key?: Compiled
  }>,
): Compiled {
  Assert(input.selectedLocal !== input.taoPropsLocal, 'slot placement locals have distinct names')
  return gen`
    (() => {
      const ${input.selectedLocal} = (${input.selection});
      const ${input.taoPropsLocal} = (${input.taoProps});
      return (${input.createElement})((${input.frameComponent}), {
        renderer: ${input.selectedLocal} === null ? null : (${input.rendererForSelected}),
        args: ${input.selectedLocal} === null ? (${input.emptyArguments}) : (${input.argumentsForSelected}),
        taoProps: ${input.taoPropsLocal},
        ${input.key === undefined ? gen.noop() : gen`key: (${input.key}),`}
      });
    })()
  `
}
