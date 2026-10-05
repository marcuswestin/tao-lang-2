import { ASTUtils, Type } from '@ast-utils'
import { AST } from '@parser'
import { Assert } from '@shared'
import { type Compiled, gen } from '../codegen-util'
import { Compile } from '../Compile'
import { compileArgumentForType } from './capability-projection'
import { compileRuntimeType } from './runtime-type-compiler'

let witnessBindings: ReadonlyMap<AST.TypeDeclaration, string> = new Map()

/** The module planner supplies collision-safe declaration bindings, including imported aliases. */
export function withAssociatedWitnessBindings<T>(
  bindings: ReadonlyMap<AST.TypeDeclaration, string>,
  compile: () => T,
): T {
  const previous = witnessBindings
  witnessBindings = bindings
  try {
    return compile()
  } finally {
    witnessBindings = previous
  }
}

function associatedWitnessBinding(owner: AST.TypeDeclaration): Compiled {
  const binding = witnessBindings.get(owner)
  Assert(binding, 'Expected a module-planned associated method witness binding.')
  return gen.Name({ name: binding })
}

/** Each owner exports one module-local method witness; there is no runtime nominal registry. */
export function AssociatedMethodsDeclaration(owner: AST.TypeDeclaration): Compiled {
  const type = Type.ofDefinition(owner)
  if (type.kind === 'capability') {
    return gen`const ${associatedWitnessBinding(owner)} = {
      defaults: {
        ${
      gen.list(ASTUtils.capabilityRequirements(owner), method => {
        const parameters = AST.parametersOf(method).map((parameter, index) => ({ index, parameter }))
        return gen`[${gen.jsLiteral(method.name)}]: {
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
  return gen`const ${associatedWitnessBinding(owner)} = {
      ${
    gen.list(ASTUtils.ownAssociatedMethods(owner), method =>
      gen`[${gen.jsLiteral(method.name)}]: ${Compile.AssociatedFunctionDeclaration(method)},`)
  }
    }`
}

/** Requirements publish only lexical default thunks; implementation owners publish method witnesses. */
export function hasAssociatedWitnessPublication(owner: AST.TypeDeclaration): boolean {
  return ASTUtils.ownAssociatedMethods(owner).length > 0
    || ASTUtils.capabilityRequirements(owner).some(method =>
      AST.parametersOf(method).some(parameter => parameter.defaultValue !== undefined)
    )
}

export function compileCapabilityDefault(descriptor: ASTUtils.AssociatedCallableDescriptor, index: number): Compiled {
  return gen`${associatedWitnessBinding(descriptor.owner)}.defaults[${
    gen.jsLiteral(descriptor.declaration.name)
  }][${index}]`
}

/** Receiver binding retains the caller's exact wrapper, including inherited nominal storage. */
export function AssociatedFunctionDeclaration(method: AST.AssociatedFunctionDeclaration): Compiled {
  const owner = AST.associatedFunctionOwner(method)
  Assert(owner, 'Expected an associated implementation to have a named type owner.')
  const parameters = AST.parametersOf(method).map((parameter, index) => ({ index, parameter }))
  return gen`TR.Function((_TaoAssociatedReceiver: ${compileRuntimeType(Type.ofDefinition(owner))}${
    parameters.length ? gen`, ${gen.join(parameters, Compile.FunctionRuntimeParameter)}` : gen.noop()
  }) => {
      return TR.BlockScope(_Scope, _Scope => {
        ${gen.scopeName(owner)} = _TaoAssociatedReceiver
        ${gen.list(parameters, Compile.FunctionParameterBinding)}
        ${Compile.FunctionBlockBody(method.block)}
      })
    })`
}

/** Witness selection addresses its actual defining declaration through the normal module scope. */
export function compileAssociatedWitness(
  descriptor: ASTUtils.AssociatedCallableDescriptor,
): Compiled {
  return gen`${associatedWitnessBinding(descriptor.owner)}[${gen.jsLiteral(descriptor.declaration.name)}]`
}
