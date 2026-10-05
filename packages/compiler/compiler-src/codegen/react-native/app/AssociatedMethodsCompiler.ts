import { ASTUtils, Type } from '@ast-utils'
import { AST } from '@parser'
import { Assert } from '@shared'
import { hasNumericSelfContext } from '../../../numeric-self-context'
import { type Compiled, gen } from '../codegen-util'
import { Compile } from '../Compile'
import { compileAssociatedConverterDeclaration } from './associated-converters'
import { compileArgumentForType } from './capability-projection'
import { quantityFactoryBinding } from './NumericUnitsCompiler'
import { compileRuntimeType } from './runtime-type-compiler'

type AssociatedOwner = ASTUtils.AssociatedCallableDescriptor['owner']
let witnessBindings: ReadonlyMap<AssociatedOwner, string> = new Map()
let operatorKeys: ReadonlyMap<ASTUtils.AssociatedOperatorWitnessDeclaration, string> = new Map()

/** The module planner supplies collision-safe declaration bindings, including imported aliases. */
export function withAssociatedWitnessBindings<T>(
  bindings: ReadonlyMap<AssociatedOwner, string>,
  compile: () => T,
  keys: ReadonlyMap<ASTUtils.AssociatedOperatorWitnessDeclaration, string> = new Map(),
): T {
  const previous = witnessBindings
  const previousKeys = operatorKeys
  witnessBindings = bindings
  operatorKeys = keys
  try {
    return compile()
  } finally {
    witnessBindings = previous
    operatorKeys = previousKeys
  }
}

/** The app graph assigns private keys to actual contracts, never to operator spelling alone. */
export function compileCallableWitnessKey(
  callable: ASTUtils.AssociatedCallableDescriptor | ASTUtils.AssociatedOperatorWitnessDeclaration,
): string {
  const key = ASTUtils.associatedCallableWitnessKey(callable, {
    operatorKey: declaration => operatorKeys.get(declaration),
  })
  Assert.defined(key, 'the selected operator contract has a planned private witness key')
  return key
}

export function associatedWitnessBinding(owner: AssociatedOwner): Compiled {
  const binding = witnessBindings.get(owner)
  Assert(binding, 'Expected a module-planned associated method witness binding.')
  return gen.Name({ name: binding })
}

/** Each owner exports one module-local method witness; there is no runtime nominal registry. */
export function AssociatedMethodsDeclaration(owner: AssociatedOwner): Compiled {
  const type = Type.ofAssociatedOwner(owner)
  if (type.kind === 'capability') {
    Assert(AST.isTypeDeclaration(owner), 'capability requirements have a real type declaration owner')
    return gen`const ${associatedWitnessBinding(owner)} = {
      defaults: {
        ${
      gen.list(ASTUtils.capabilityRequirements(owner), method => {
        const parameters = AST.parametersOf(method).map((parameter, index) => ({ index, parameter }))
        return gen`[${gen.jsLiteral(compileCallableWitnessKey(method))}]: {
            ${
          gen.list(parameters.filter(input => input.parameter.defaultValue !== undefined), input => {
            const preceding = parameters.slice(0, input.index)
            return gen`[${input.index}]: TR.Function((${gen.join(preceding, Compile.FunctionRuntimeParameter)}) =>
                TR.BlockScope(_Scope, _Scope => {
                  ${gen.list(preceding, Compile.FunctionParameterBinding)}
                  return ${compileArgumentForType(input.parameter.defaultValue!, Type.ofParameter(input.parameter))}
                })),`
          })
        }
          },`
      })
    }
      }
    }`
  }
  Assert(type.kind !== 'unresolved', 'Expected a resolved concrete associated owner.')
  const views = ASTUtils.ownAssociatedViews(owner)
  return gen`const ${associatedWitnessBinding(owner)} = {
    "$views": [${
    gen.join(views, (view) => {
      return Compile.AssociatedViewDeclaration(view, {
        component: gen.Name({ name: '_TaoAssociatedView' }),
        propsType: gen`{
        __taoReceiver: ${compileRuntimeType(type)}
        ${gen.list(AST.parametersOf(view), Compile.ParameterDeclaration)}
        __tao?: TR.TaoProps
        __taoHost?: TR.HostReadChannel
        __taoSlots?: Readonly<Record<string, TR.SlotRenderer<any> | null>>
        children?: React.ReactNode
      }`,
        receiverBinding: gen`${receiverScope(owner)} = _ViewProps.__taoReceiver`,
        commandSurface: gen.noop(),
        hostSlots: gen.noop(),
      })
    })
  }],
      "$converters": [${
    gen.join(
      AST.isTypeDeclaration(owner) ? Type.ownAssociatedConverters(owner) : [],
      compileAssociatedConverterDeclaration,
    )
  }],
      "$operators": [${
    gen.join(ASTUtils.ownAssociatedMethods(owner).filter(isAssociatedOperator), Compile.AssociatedFunctionDeclaration)
  }],
      ${
    gen.list(
      ASTUtils.ownAssociatedMethods(owner).filter(method => !isAssociatedOperator(method)),
      method => gen`[${gen.jsLiteral(method.name)}]: ${Compile.AssociatedFunctionDeclaration(method)},`,
    )
  }
    ${
    gen.list(views, (view) => {
      const parameters = AST.parametersOf(view).map((parameter, index) => ({ index, parameter }))
      return gen`[${gen.jsLiteral(view.name)}]: TR.Function((_TaoAssociatedReceiver: ${compileRuntimeType(type)}${
        gen.join(parameters, parameter => gen`, ${Compile.FunctionRuntimeParameter(parameter)}`, { separator: '' })
      }) => TR.RenderView(${associatedViewComponent(owner, views.indexOf(view))}, {
        __taoReceiver: _TaoAssociatedReceiver,
        ${
        gen.list(parameters, parameter =>
          gen`${gen.Name({ name: Type.parameterName(parameter.parameter) })}: ${
            gen.Name({ name: `_TaoFunctionArg${parameter.index}` })
          },`)
      }
      })),`
    })
  }
    }`
}

/** Requirements publish only lexical default thunks; implementation owners publish method witnesses. */
export function hasAssociatedWitnessPublication(owner: AssociatedOwner): boolean {
  return ASTUtils.ownAssociatedMethods(owner).length > 0
    || ASTUtils.ownAssociatedViews(owner).length > 0
    || (AST.isTypeDeclaration(owner) && Type.ownAssociatedConverters(owner).length > 0)
    || (AST.isTypeDeclaration(owner)
      && ASTUtils.capabilityRequirements(owner).some(method =>
        AST.parametersOf(method).some(parameter => parameter.defaultValue !== undefined)
      ))
}

export function compileCapabilityDefault(descriptor: ASTUtils.AssociatedCallableDescriptor, index: number): Compiled {
  return gen`${associatedWitnessBinding(descriptor.owner)}.defaults[${
    gen.jsLiteral(compileCallableWitnessKey(descriptor))
  }][${index}]`
}

/** Receiver binding retains the caller's exact wrapper, including inherited nominal storage. */
export function AssociatedFunctionDeclaration(method: AST.AssociatedFunctionDeclaration): Compiled {
  const owner = AST.associatedFunctionOwner(method)
  Assert(owner, 'Expected an associated implementation to have a named type owner.')
  const parameters = AST.parametersOf(method).map((parameter, index) => ({ index, parameter }))
  return gen`TR.Function((${hasNumericSelfContext(method) ? gen`_TaoSelfFactory: TR.QuantityFactory, ` : gen.noop()}${
    method.static
      ? gen.join(parameters, Compile.FunctionRuntimeParameter)
      : gen`_TaoAssociatedReceiver: ${compileRuntimeType(Type.ofAssociatedOwner(owner))}${
        parameters.length ? gen`, ${gen.join(parameters, Compile.FunctionRuntimeParameter)}` : gen.noop()
      }`
  }) => {
      return TR.BlockScope(_Scope, _Scope => {
        ${method.static ? gen.noop() : gen`${receiverScope(owner)} = _TaoAssociatedReceiver`}
        ${gen.list(parameters, Compile.FunctionParameterBinding)}
        ${Compile.FunctionBlockBody(method.block)}
      })
    })`
}

function receiverScope(owner: AssociatedOwner): Compiled {
  return gen.scopeName({ name: AST.isEntityDataDeclaration(owner) ? owner.singularName : owner.name })
}

function associatedViewComponent(owner: AssociatedOwner, index: number): Compiled {
  return gen`${associatedWitnessBinding(owner)}["$views"][${index}]`
}

/** Witness selection addresses its actual defining declaration through the normal module scope. */
export function compileAssociatedWitness(
  descriptor: ASTUtils.AssociatedCallableDescriptor,
): Compiled {
  if (AST.isAssociatedFunctionDeclaration(descriptor.declaration) && isAssociatedOperator(descriptor.declaration)) {
    const index = ASTUtils.ownAssociatedMethods(descriptor.owner).filter(isAssociatedOperator).indexOf(
      descriptor.declaration,
    )
    Assert(index >= 0, 'the selected operator belongs to its actual publication owner')
    const implementation = gen`${associatedWitnessBinding(descriptor.owner)}["$operators"][${index}]`
    return bindNumericSelfContext(descriptor, implementation)
  }
  return bindNumericSelfContext(
    descriptor,
    gen`${associatedWitnessBinding(descriptor.owner)}[${gen.jsLiteral(descriptor.declaration.name)}]`,
  )
}

function bindNumericSelfContext(descriptor: ASTUtils.AssociatedCallableDescriptor, implementation: Compiled): Compiled {
  if (!AST.isAssociatedFunctionDeclaration(descriptor.declaration) || !hasNumericSelfContext(descriptor.declaration)) {
    return implementation
  }
  const owner = Type.quantityOwner(descriptor.receiver)
  Assert.defined(owner, 'the selected numeric Self contract has a concrete quantity factory')
  return gen`TR.Function((..._TaoSelfArguments: TR.Evaluable[]) =>
    TR.Call(${implementation}, ${quantityFactoryBinding(owner)}, ..._TaoSelfArguments))`
}

function isAssociatedOperator(method: AST.AssociatedFunctionDeclaration): boolean {
  return ['+', '-', '*', '/', '==', '!=', '<', '<=', '>', '>='].includes(method.name)
}
