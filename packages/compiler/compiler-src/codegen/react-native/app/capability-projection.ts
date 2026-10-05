import { ASTUtils, Type } from '@ast-utils'
import { AST } from '@parser'
import { Assert, Switch } from '@shared'
import { type Compiled, gen } from '../codegen-util'
import { Compile } from '../Compile'
import {
  compileAssociatedWitness,
  compileCallableWitnessKey,
  compileCapabilityDefault,
} from './AssociatedMethodsCompiler'
import { compileFunctionParameterBinding } from './FunctionalCoreCompiler'
import { compileReactiveArgument } from './reactive-parameters'

/** Source admission, nested correspondence and union selection share one sealed semantic plan. */
export function compileArgumentForType(expression: AST.Expression, expected: ASTUtils.TaoType): Compiled {
  if (!ASTUtils.containsCapability(expected)) {
    return Compile.Expression(expression)
  }
  const plan = validatedPlan(Type.ofExpression(expression), expected)
  return compileTransport(compileReactiveArgument(expression), plan)
}

/** Prepared contextual constructors retain their real payload domain through the same proof. */
export function compileValueForType(source: Compiled, actual: ASTUtils.TaoType, expected: ASTUtils.TaoType): Compiled {
  return ASTUtils.containsCapability(expected) ? compileTransport(source, validatedPlan(actual, expected)) : source
}

function validatedPlan(actual: ASTUtils.TaoType, expected: ASTUtils.TaoType): ASTUtils.CapabilityTransportPlan {
  const result = ASTUtils.planCapabilityTransport(actual, expected)
  Assert(result.kind === 'ready', 'Expected validated capability transport proof.')
  return result.plan
}

/** Adapt bound wrappers without rediscovering admission or repeating the originating call. */
function compileTransport(
  source: Compiled,
  plan: ASTUtils.CapabilityTransportPlan,
  evaluated?: Compiled,
): Compiled {
  return Switch.kind(plan, {
    identity: () => source,
    list: list =>
      gen`(() => {
      const _TaoListSource = ${source};
      return TR.Alias(() => TR.Capability.listElements<any>(_TaoListSource,
        _TaoListElement => ${compileTransport(gen`_TaoListElement`, list.element)}));
    })()`,
    optional: optional =>
      gen`(() => {
      const _TaoOptionalSource = ${source};
      return TR.Alias(() => {
        const _TaoOptionalValue = _TaoOptionalSource.evaluate();
        return _TaoOptionalValue.jsValue == null
          ? _TaoOptionalValue
          : ${compileTransport(gen`_TaoOptionalSource`, optional.present, gen`_TaoOptionalValue`)}.evaluate();
      });
    })()`,
    attach: attach =>
      gen`TR.Capability.attach(${source}, {
      ${
        gen.list(attach.methods, method =>
          gen`[${gen.jsLiteral(compileCallableWitnessKey(method.required))}]: ${
            adaptWitness(method, compileAssociatedWitness(method.supplied))
          },`)
      }
    })`,
    reproject: reproject =>
      gen`TR.Alias(() => TR.Capability.reproject(${evaluated ?? gen`${source}.evaluate()`}, {
      ${
        gen.list(
          reproject.methods,
          method =>
            gen`[${gen.jsLiteral(compileCallableWitnessKey(method.required))}]: ${
              gen.jsLiteral(compileCallableWitnessKey(method.supplied))
            },`,
        )
      }
    }, {
      ${
        gen.list(reproject.methods, method =>
          gen`[${gen.jsLiteral(compileCallableWitnessKey(method.required))}]:
        (_TaoSelectedWitness: TR.Function) => ${adaptWitness(method, gen`_TaoSelectedWitness`)},`)
      }
    }))`,
  })
}

/** Private dependencies traverse exactly the same plan used by runtime adapter emission. */
export function capabilityTransportOwners(
  actual: ASTUtils.TaoType,
  expected: ASTUtils.TaoType,
): ReadonlySet<ASTUtils.AssociatedCallableDescriptor['owner']> {
  const owners = new Set<ASTUtils.AssociatedCallableDescriptor['owner']>()
  if (!ASTUtils.containsCapability(expected)) {
    return owners
  }
  const collect = (plan: ASTUtils.CapabilityTransportPlan): void => {
    const methods = (methods: readonly ASTUtils.CapabilityTransportMethod[]) => {
      for (const method of methods) {
        if (
          AST.isAssociatedFunctionDeclaration(method.supplied.declaration)
          || AST.isAssociatedViewDeclaration(method.supplied.declaration)
        ) {
          owners.add(method.supplied.owner)
        }
        if (method.required.signature.inputs.some(input => input.declaration.defaultValue !== undefined)) {
          owners.add(method.required.owner)
        }
        method.inputs.forEach(input => collect(input.plan))
        collect(method.receiver)
        collect(method.result)
      }
    }
    Switch.kind(plan, {
      identity: Switch.nothing,
      list: list => collect(list.element),
      optional: optional => collect(optional.present),
      attach: attach => methods(attach.methods),
      reproject: reproject => methods(reproject.methods),
    })
  }
  collect(validatedPlan(actual, expected))
  return owners
}

/** Required input order and implementation input order are independent; defaults retain raw holes. */
function adaptWitness(witness: ASTUtils.CapabilityTransportMethod, implementation: Compiled): Compiled {
  const required = witness.required.signature.inputs
  const supplied = witness.supplied.signature.inputs
  const parameters = required.map((input, index) => ({ index, parameter: input.declaration }))
  const inputs = new Map(witness.inputs.map(input => [input.supplied.declaration, input]))
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
      const _TaoCapabilityResult = TR.Call(${implementation}${
    witness.receiverPlacement.kind === 'implicit'
      ? gen`, ${compileTransport(gen`_TaoCapabilityReceiver`, witness.receiver)}`
      : gen.noop()
  }${
    gen.join(supplied, input => {
      if (
        witness.receiverPlacement.kind === 'parameter'
        && input.declaration === witness.receiverPlacement.parameter
      ) {
        return gen`, ${compileTransport(gen`_TaoCapabilityReceiver`, witness.receiver)}`
      }
      const transport = inputs.get(input.declaration)
      if (!transport) {
        Assert(input.omissible, 'Expected unmatched implementation inputs to have defaults.')
        return gen`, undefined`
      }
      return gen`, ${
        compileTransport(
          gen.scopeName({ name: Type.parameterName(transport.required.declaration) }),
          transport.plan,
        )
      }`
    }, { separator: '' })
  })
      return ${compileTransport(gen`_TaoCapabilityResult`, witness.result)}
    })
  )`
}
