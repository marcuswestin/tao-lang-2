import { ASTUtils, Type } from '@ast-utils'
import { AST } from '@parser'
import { Assert } from '@shared'
import { type Compiled, gen } from '../codegen-util'
import { Compile } from '../Compile'
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
  Assert(type.kind === 'primitive' && type.primitive === 'text', 'Expected a supported text associated owner.')
  return gen`const ${associatedWitnessBinding(owner)} = {
      ${
    gen.list(ASTUtils.ownAssociatedMethods(owner), method =>
      gen`${gen.jsLiteral(method.name)}: ${Compile.AssociatedFunctionDeclaration(method)},`)
  }
    }`
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
