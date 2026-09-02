import { ASTUtils, Type } from '@ast-utils'
import { AST } from '@parser'
import { Assert, Switch } from '@shared'
import { type Compiled, gen, resolveRef } from '../codegen-util'
import { Compile } from '../Compile'
import {
  actionBlockContainsRespond,
  actionBlockRequiresAsync,
  actionInvocationRequiresAsync,
} from './action-control-flow'
import { compileDeclarationIdentity, declarationModuleName } from './declaration-identity'
import { foreignActionBindingName } from './injection-plan'

type ActionParameter = {
  index: number
  parameter: AST.ParameterDeclaration
}

export const ActionsCompiler = {
  /** ActionDeclaration compiles a named Tao action into a runtime action value. */
  ActionDeclaration(action: AST.ActionDeclaration): Compiled {
    if (action.foreign) {
      return compileForeignAction(action)
    }
    const parameters = actionParameters(action)
    const asyncKeyword = actionBlockRequiresAsync(action.block) ? gen`async ` : gen``
    return gen`
      ${gen.scopeName(action)} = TR.Action(${asyncKeyword}(${gen.join(parameters, Compile.ActionRuntimeParameter)}) => {
        return TR.BlockScope(_Scope, ${asyncKeyword}_Scope => {
          ${gen.list(parameters, Compile.ActionParameterBinding)}
          ${Compile.ActionBlockBody(action.block)}
        })
      }, {
        name: ${gen.jsLiteral(action.name)},
        ${actionBlockContainsRespond(action.block) ? gen`interrupt: true,` : gen``}
      })
    `
  },

  /**
   * CommandDeclaration compiles the discoverable verb. Every member and the invocation itself are
   * functions of the slots the declaration left open, so one declaration serves every binding of it.
   * A slot is a parameter, so a defaulted one falls back exactly as an action parameter does.
   */
  CommandDeclaration(command: AST.CommandDeclaration): Compiled {
    const clause = AST.commandDoClauseOf(command)
    Assert.defined(clause, 'validated command names one do clause')
    const slots = ASTUtils.commandSlots(command)
    const members = AST.commandFillsOf(command)
    const bindSlots = gen.list(slots, slot => {
      const fill = gen`_TaoFills[${gen.jsLiteral(slot.name)}]`
      const defaultValue = slot.parameter.defaultValue
      return defaultValue === undefined
        ? gen`${gen.scopeName({ name: slot.name })} = ${fill}`
        : gen`${gen.scopeName({ name: slot.name })} = ${fill} ?? ${Compile.Expression(defaultValue)}`
    })
    const inFills = (body: Compiled) =>
      gen`_TaoFills => TR.BlockScope(_Scope, _Scope => {
        ${bindSlots}
        return ${body}
      })`
    return gen`${gen.scopeName(command)} = TR.Interaction.Command({
      name: ${gen.jsLiteral(command.name)},
      slots: [${gen.join(slots, slot => gen.jsLiteral(slot.name))}],
      action: ${inFills(Compile.Expression(clause.action))},
      arguments: ${inFills(gen`[${gen.join(commandInvocationArguments(clause), argument => argument)}]`)},
      members: {
        ${
      gen.list(
        members,
        member => gen`${gen.jsLiteral(member.name)}: ${inFills(Compile.Expression(member.value))},`,
      )
    }
      },
    })`
  },

  /**
   * CommandTable is what a module publishes about the verbs it owns: enough for a surface to ask
   * which commands act on what a person has in front of them, and the value to run when one is
   * chosen. The table is generated; registering it is handwritten runtime.
   */
  CommandTable(commands: readonly AST.CommandDeclaration[]): Compiled {
    const owner = commands[0]
    Assert.defined(owner, 'a command table is emitted only for a module that declares commands')
    return gen`{
      module: ${gen.jsLiteral(declarationModuleName(owner))},
      commands: [
        ${
      gen.list(commands, command =>
        gen`{
          identity: ${compileDeclarationIdentity(command)}.canonical,
          name: ${gen.jsLiteral(command.name)},
          slots: [
            ${
          gen.list(ASTUtils.commandSlots(command), slot =>
            gen`{
              name: ${gen.jsLiteral(slot.name)},
              type: ${gen.jsLiteral(slot.typeName)},
              entity: ${slot.type.kind === 'entity' ? 'true' : 'false'},
            },`)
        }
          ],
          command: () => ${gen.scopeName(command)},
        },`)
    }
      ],
    }`
  },

  /** ActionExpression compiles an inline Tao action into a runtime action value. */
  ActionExpression(action: AST.ActionExpression): Compiled {
    const asyncKeyword = actionBlockRequiresAsync(action.block) ? gen`async ` : gen``
    return gen`
      TR.Action(${asyncKeyword}() => {
        return TR.BlockScope(_Scope, ${asyncKeyword}_Scope => {
          ${Compile.ActionBlockBody(action.block)}
        })
      }${actionBlockContainsRespond(action.block) ? gen`, { interrupt: true }` : gen``})
    `
  },

  /** ActionParameterBinding binds one runtime action argument into the action-local scope. */
  ActionParameterBinding(parameter: ActionParameter): Compiled {
    const name = { name: Type.parameterName(parameter.parameter) }
    const runtimeParameter = actionRuntimeParameterName(parameter.index)
    return parameter.parameter.defaultValue === undefined
      ? gen`${gen.scopeName(name)} = ${runtimeParameter}`
      : gen`${gen.scopeName(name)} = ${runtimeParameter} ?? ${Compile.Expression(parameter.parameter.defaultValue)}`
  },

  /** ActionRuntimeParameter compiles one action callback parameter. */
  ActionRuntimeParameter(parameter: ActionParameter): Compiled {
    return gen`${actionRuntimeParameterName(parameter.index)}${
      parameter.parameter.defaultValue === undefined ? '' : '?'
    }: ${Compile.ParameterType(parameter.parameter)}`
  },

  /** ActionStatement compiles one statement inside a Tao action body. */
  ActionStatement(statement: AST.ActionStatement): Compiled {
    return Switch.type(statement, {
      AsyncActionStatement: Compile.AsyncActionStatement,
      CreateStatement: Compile.CreateStatement,
      AskStatement: Compile.AskStatement,
      ContextualPresentStatement: Compile.ContextualPresentStatement,
      DeleteStatement: Compile.DeleteStatement,
      DeclarationSlotFill: Compile.DeclarationSlotFill,
      DismissStatement: Compile.DismissStatement,
      DoStatement: Compile.DoStatement,
      GuardActionStatement: Compile.GuardActionStatement,
      IfActionStatement: Compile.IfActionStatement,
      ReplaceStatement: Compile.ReplaceStatement,
      RespondStatement: Compile.RespondStatement,
      SelectionActivateStatement: Compile.SelectionActivateStatement,
      SetStatement: Compile.SetStatement,
      ToggleStatement: Compile.ToggleStatement,
      UpdateStatement: Compile.UpdateStatement,
      FailStatement: Compile.FailStatement,
    })
  },

  /** ActionBlockBody compiles one callback-owned action block. */
  ActionBlockBody(block: AST.ActionBlock | undefined): Compiled {
    return gen.list(block?.statements ?? [], Compile.ActionStatement)
  },

  /** DeclarationSlotFill is metadata consumed by its owning action or view compiler. */
  DeclarationSlotFill(): Compiled {
    return gen.noop()
  },

  /** AsyncActionStatement launches an isolated action sub-block without delaying its caller. */
  AsyncActionStatement(statement: AST.AsyncActionStatement): Compiled {
    return gen`TR.Async(() =>
      TR.BlockScope(_Scope, async _Scope => {
        ${Compile.ActionBlockBody(statement.block)}
      })
    )`
  },

  /** DoStatement compiles Tao action invocation. */
  DoStatement(invocation: AST.DoStatement): Compiled {
    const awaitKeyword = actionInvocationRequiresAsync(invocation) ? gen`await ` : gen``
    return gen`${awaitKeyword}TR.Do(${Compile.Expression(invocation.action)}${Compile.ActionArguments(invocation)})`
  },

  /** FailStatement aborts the joined action transaction with one declared case and sentence. */
  FailStatement(statement: AST.FailStatement): Compiled {
    const failureCase = resolveRef(statement.case)
    return gen`TR.Fail(${Compile.ValueDeclarationReference(failureCase)}, ${gen.jsLiteral(statement.sentence)})`
  },

  /** AskStatement suspends its action and binds the response owned by this presented occurrence. */
  AskStatement(statement: AST.AskStatement): Compiled {
    const view = resolveRef(statement.view)
    const resolved = ASTUtils.resolveArgumentBindings(view, statement)
    Assert(resolved.diagnostics.length === 0, 'validated ask has no binding diagnostics')
    return gen`${gen.scopeName(statement)} = await TR.Navigation.Ask(
      _ViewProps.__tao,
      ${Compile.ViewValue(view)},
      { ${gen.list(resolved.pairs, Compile.NavigationArgument)} },
    )`
  },

  /** RespondStatement settles only the responding occurrence inherited by this render tree. */
  RespondStatement(statement: AST.RespondStatement): Compiled {
    const response = statement.case?.ref
    return gen`TR.Navigation.Respond(
      _ViewProps.__tao${response ? gen`, ${Compile.ValueDeclarationReference(response)}` : ''},
    )`
  },

  /** ActionArguments compiles action invocation argument expressions. */
  ActionArguments(invocation: AST.DoStatement): Compiled {
    return gen.join(actionInvocationArguments(invocation), argument => gen`, ${argument}`, {
      separator: '',
    })
  },

  /** ToggleStatement inverts a validated boolean state through the runtime. */
  ToggleStatement(statement: AST.ToggleStatement): Compiled {
    const state = statement.target.ref
    Assert.defined(state, 'validated toggle targets a state')
    return gen`TR.Toggle(${gen.scopeName(state)})`
  },

  /** GuardActionStatement stops only its enclosing action-block callback after a match. */
  GuardActionStatement(statement: AST.GuardActionStatement): Compiled {
    return gen`if (await TR.GuardAction(${Compile.Expression(statement.subject)}, [
      ${
      gen.list(
        ASTUtils.guardBranches(statement),
        branch =>
          gen`[${gen.jsLiteral(branch.case)}, async _TaoCasePayload => TR.BlockScope(_Scope, async _Scope => {
          ${branch.payload ? gen`${gen.scopeName(branch.payload)} = _TaoCasePayload` : ''}
          ${Compile.ActionBlockBody(branch.block)}
        })],`,
      )
    }
    ])) return`
  },

  /** IfActionStatement lazily executes one action sub-block without terminating its caller. */
  IfActionStatement(statement: AST.IfActionStatement): Compiled {
    return gen`await TR.If(${Compile.Expression(statement.condition)}, async () =>
      TR.BlockScope(_Scope, async _Scope => {
        ${Compile.ActionBlockBody(statement.block)}
      })
    )`
  },
} as const

function actionParameters(action: AST.ActionDeclaration): ActionParameter[] {
  return AST.parametersOf(action).map((parameter, index) => ({ index, parameter }))
}

function actionRuntimeParameterName(index: number): Compiled {
  return gen.Name({ name: `_TaoActionArg${index}` })
}

/** commandInvocationArguments compiles the arguments a command's `do` clause hands its action. */
function commandInvocationArguments(clause: AST.CommandDoClause): Compiled[] {
  const target = ASTUtils.resolveActionTarget(clause.action)
  if (target.kind !== 'named') {
    return AST.argumentsOf(clause).map(Compile.Argument)
  }
  const resolved = ASTUtils.resolveArgumentBindings(target.action, clause)
  Assert(resolved.diagnostics.length === 0, 'validated command has no binding diagnostics')
  return positionalArguments(AST.parametersOf(target.action), resolved.pairs)
}

function positionalArguments(
  parameters: readonly AST.ParameterDeclaration[],
  pairs: readonly ASTUtils.ActionInvocationPair[],
): Compiled[] {
  const argumentsByParameter = new Map(pairs.map(pair => [pair.parameter, pair.argument]))
  const lastProvidedIndex = Math.max(...pairs.map(pair => parameters.indexOf(pair.parameter)), -1)
  return parameters.slice(0, lastProvidedIndex + 1).map(parameter => {
    const argument = argumentsByParameter.get(parameter)
    return argument ? Compile.Argument(argument) : gen`undefined`
  })
}

function actionInvocationArguments(invocation: AST.DoStatement): Compiled[] {
  const resolved = ASTUtils.resolveActionInvocation(invocation)
  if (!resolved.action) {
    // Dynamic callbacks declare positional action(...) signatures, so preserve the
    // caller's source order instead of applying named-action type binding.
    return AST.argumentsOf(invocation).map(Compile.Argument)
  }
  Assert.defined(resolved.action, 'validated action invocation targets a named action')
  Assert(resolved.diagnostics.length === 0, 'validated action invocation has no binding diagnostics')
  return positionalArguments(AST.parametersOf(resolved.action), resolved.pairs)
}

function compileForeignAction(action: AST.ActionDeclaration): Compiled {
  const foreign = action.foreign
  Assert.defined(foreign, 'foreign action has an implementation')
  const implementation = { name: foreignActionBindingName(action) }
  const parameters = actionParameters(action)
  const requiredArguments = parameters.filter(({ parameter }) => parameter.defaultValue === undefined).length
  const adaptedImplementation = parameters.some(({ parameter }) => parameter.defaultValue !== undefined)
    ? gen`(${gen.join(parameters, parameter => actionRuntimeParameterName(parameter.index))}) =>
      TR.BlockScope(_Scope, _Scope => {
        ${gen.list(parameters, compileForeignActionParameterBinding)}
        return ${gen.Name(implementation)}(${
      gen.join(parameters, ({ parameter }) => {
        const name = { name: Type.parameterName(parameter) }
        return gen`${gen.scopeName(name)}.evaluate().jsValue`
      })
    })
      })`
    : gen.Name(implementation)
  return gen`${gen.scopeName(action)} = TR.ForeignAction(
    ${adaptedImplementation},
    ${gen.jsLiteral(action.name)},
    [${
    gen.join(foreign.failures, failure =>
      gen`{
      case: ${Compile.ValueDeclarationReference(resolveRef(failure.case))},
      sentence: ${gen.jsLiteral(failure.sentence)},
    }`)
  }],
    { ${action.runsLatest ? gen`runs: "latest", ` : gen``}requiredArguments: ${requiredArguments} },
  )`
}

function compileForeignActionParameterBinding(parameter: ActionParameter): Compiled {
  const runtimeParameter = actionRuntimeParameterName(parameter.index)
  const name = { name: Type.parameterName(parameter.parameter) }
  return parameter.parameter.defaultValue === undefined
    ? gen`${gen.scopeName(name)} = TR.Value(${runtimeParameter})`
    : gen`${gen.scopeName(name)} = ${runtimeParameter} == null
      ? ${Compile.Expression(parameter.parameter.defaultValue)}
      : TR.Value(${runtimeParameter})`
}
