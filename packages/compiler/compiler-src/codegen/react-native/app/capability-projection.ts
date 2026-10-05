import { type ASTUtils, Type } from '@ast-utils'
import { AST } from '@parser'
import { Assert } from '@shared'
import { type Compiled, gen } from '../codegen-util'
import { Compile } from '../Compile'
import { compileAssociatedWitness, compileCapabilityDefault } from './AssociatedMethodsCompiler'
import { compileFunctionParameterBinding } from './FunctionalCoreCompiler'
import { compileReactiveArgument } from './reactive-parameters'

/** Structural arguments carry only the witnesses proved by final semantic admission. */
export function compileArgumentForType(expression: AST.Expression, expected: ASTUtils.TaoType): Compiled {
  if (expected.kind !== 'capability') {
    return Compile.Expression(expression)
  }
  const actual = Type.ofExpression(expression)
  const source = compileReactiveArgument(expression)
  return compileValueForType(source, actual, expected)
}

/** Adapt already-bound wrappers without manufacturing expressions or repeating the originating call. */
function compileValueForType(source: Compiled, actual: ASTUtils.TaoType, expected: ASTUtils.TaoType): Compiled {
  if (expected.kind !== 'capability') {
    return source
  }
  if (actual.kind === 'capability' && actual.declaration === expected.declaration) {
    return source
  }
  const witnesses = Type.capabilityWitnesses(actual, expected)
  Assert.defined(witnesses, 'Expected validated capability argument witnesses.')
  if (actual.kind === 'capability') {
    return gen`TR.Alias(() => TR.Capability.reproject(${source}.evaluate(), {
      ${
      gen.list(witnesses, witness =>
        gen`[${gen.jsLiteral(witness.required.declaration.name)}]: ${
          gen.jsLiteral(witness.supplied.declaration.name)
        },`)
    }
    }, {
      ${
      gen.list(witnesses, witness =>
        gen`[${gen.jsLiteral(witness.required.declaration.name)}]: (_TaoSelectedWitness: TR.Function) => ${
          adaptWitness(witness, gen`_TaoSelectedWitness`)
        },`)
    }
    }))`
  }
  return gen`TR.Capability.attach(${source}, {
    ${
    gen.list(witnesses, witness =>
      gen`[${gen.jsLiteral(witness.required.declaration.name)}]: ${
        adaptWitness(witness, compileAssociatedWitness(witness.supplied))
      },`)
  }
  })`
}

/** Private module dependencies follow the same sealed correspondence used by transport emission. */
export function capabilityTransportOwners(
  actual: ASTUtils.TaoType,
  expected: ASTUtils.TaoType,
): ReadonlySet<AST.TypeDeclaration> {
  const owners = new Set<AST.TypeDeclaration>()
  const collect = (actual: ASTUtils.TaoType, expected: ASTUtils.TaoType) => {
    if (
      expected.kind !== 'capability'
      || (actual.kind === 'capability' && actual.declaration === expected.declaration)
    ) {
      return
    }
    const witnesses = Type.capabilityWitnesses(actual, expected)
    Assert.defined(witnesses, 'Expected validated capability transport dependencies.')
    for (const witness of witnesses) {
      if (AST.isAssociatedFunctionDeclaration(witness.supplied.declaration)) {
        owners.add(witness.supplied.owner)
      }
      if (witness.required.signature.inputs.some(input => input.declaration.defaultValue !== undefined)) {
        owners.add(witness.required.owner)
      }
      for (const pair of witness.correspondence) {
        collect(pair.required.type, pair.supplied.type)
      }
      collect(witness.supplied.result, witness.required.result)
    }
  }
  collect(actual, expected)
  return owners
}

/** Required input order and implementation input order are independent; defaults retain raw holes. */
function adaptWitness(witness: ASTUtils.AssociatedCapabilityWitness, implementation: Compiled): Compiled {
  const required = witness.required.signature.inputs
  const supplied = witness.supplied.signature.inputs
  const parameters = required.map((input, index) => ({ index, parameter: input.declaration }))
  const correspondence = new Map(
    witness.correspondence.map(pair => [pair.supplied.declaration, pair.required.declaration]),
  )
  return gen`TR.Function((_TaoCapabilityReceiver: TR.Evaluable${
    gen.join(parameters, parameter => gen`, ${Compile.FunctionRuntimeParameter(parameter)}`, {
      separator: '',
    })
  }) =>
    TR.BlockScope(_Scope, _Scope => {
      ${
    gen.list(parameters, parameter => {
      const fallback = parameter.parameter.defaultValue === undefined
        ? undefined
        : gen`TR.Call(${compileCapabilityDefault(witness.required, parameter.index)}${
          gen.join(parameters.slice(0, parameter.index), preceding =>
            gen`, ${gen.scopeName({ name: Type.parameterName(preceding.parameter) })}`, { separator: '' })
        })`
      return compileFunctionParameterBinding(parameter, fallback)
    })
  }
      const _TaoCapabilityResult = TR.Call(${implementation}, _TaoCapabilityReceiver${
    gen.join(supplied, input => {
      const requiredDeclaration = correspondence.get(input.declaration)
      if (!requiredDeclaration) {
        Assert(input.omissible, 'Expected unmatched implementation inputs to have defaults.')
        return gen`, undefined`
      }
      const index = required.findIndex(candidate => candidate.declaration === requiredDeclaration)
      Assert(index >= 0, 'Expected correspondence to name an actual required input.')
      return gen`, ${
        compileValueForType(
          gen.scopeName({ name: Type.parameterName(requiredDeclaration) }),
          required[index]!.type,
          input.type,
        )
      }`
    }, { separator: '' })
  })
      return ${compileValueForType(gen`_TaoCapabilityResult`, witness.supplied.result, witness.required.result)}
    })
  )`
}
