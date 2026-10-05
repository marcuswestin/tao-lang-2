import { ASTUtils, Type } from '@ast-utils'
import { AST } from '@parser'
import { Assert, Switch } from '@shared'
import { BridgeMetadata } from '../../../bridge-metadata'
import { foreignActionTestStubKey } from '../../../foreign-action-test-stubs'
import { type Compiled, gen, resolveRef } from '../codegen-util'
import { Compile } from '../Compile'
import {
  actionBlockInterruptsAsk,
  actionBlockRequiresAsync,
  actionInstrumentationEnabled,
  actionInvocationRequiresAsync,
} from './action-control-flow'
import { actionResultBridgeTypeOptions } from './action-result-bridge-types'
import { authLibraryExport, needsAuthContext, withAuthContextFactory } from './auth-context'
import { compileArgumentForType } from './capability-projection'
import { compileDeclarationIdentity, declarationModuleName } from './declaration-identity'
import { foreignActionBindingName } from './injection-plan'
import { compileReactiveArgument, compileWritableTarget } from './reactive-parameters'
import { compileRuntimeType } from './runtime-type-compiler'

type ActionParameter = {
  index: number
  parameter: AST.ParameterDeclaration
}

export const ActionsCompiler = {
  /** ActionDeclaration compiles a named Tao action into a runtime action value. */
  ActionDeclaration(action: AST.ActionDeclaration): Compiled {
    if (action.foreign) {
      if (authLibraryExport(action)) {
        return withAuthContextFactory(
          action,
          gen`${gen.scopeName(action)} = ${gen.Name({ name: foreignActionBindingName(action) })}(_TaoAuthScope!)`,
        )
      }
      return compileForeignAction(action)
    }
    const parameters = actionParameters(action)
    const asyncKeyword = actionBlockRequiresAsync(action.block) ? gen`async ` : gen``
    return withAuthContextFactory(
      action,
      gen`
      ${gen.scopeName(action)} = TR.Action(${asyncKeyword}(${gen.join(parameters, Compile.ActionRuntimeParameter)}) => {
        return ${Compile.ActionScopedBlock(action.block, gen.list(parameters, Compile.ActionParameterBinding))}
      }, {
        name: ${gen.jsLiteral(action.name)},
        ${AST.findOwningView(action) ? gen`owner: _TaoActionOwner,` : gen``}
        ${actionBlockInterruptsAsk(action.block) ? gen`interrupt: true,` : gen``}
      })
    `,
    )
  },

  /** AssociatedActionDeclaration publishes one entity-bound factory for a source action. */
  AssociatedActionDeclaration(action: AST.ActionDeclaration): Compiled {
    const associated = AST.associatedEntityActionReceiver(action)
    Assert.defined(associated, 'associated action factory has an entity receiver declaration')
    Assert(!action.foreign, 'associated action factory handles source actions only')
    Assert.defined(action.block, 'source associated action has a body')

    const ownerType = Type.ofAssociatedOwner(associated.owner)
    const domainType = associated.cardinality === 'many'
      ? { kind: 'list' as const, element: ownerType }
      : ownerType
    const parameters = actionParameters(action)
    const asyncKeyword = actionBlockRequiresAsync(action.block) ? gen`async ` : gen``
    const interrupt = actionBlockInterruptsAsk(action.block)
    const bindings = gen`
      ${
      gen.scopeName({ name: associated.cardinality === 'many' ? associated.owner.name : associated.owner.singularName })
    } = _TaoAssociatedReceiver
      ${gen.list(parameters, Compile.ActionParameterBinding)}
    `

    return gen`(
      _TaoAssociatedReceiver: ${compileRuntimeType(domainType)},
      options: NonNullable<Parameters<typeof TR.Action>[1]> = {},
      ${needsAuthContext(action) ? gen`_TaoAuthScope: TR.AuthScope | undefined = undefined,` : gen.noop()}
    ) => TR.Action(${asyncKeyword}(${gen.join(parameters, Compile.ActionRuntimeParameter)}) => {
      return ${Compile.ActionScopedBlock(action.block, bindings)}
    }, {
      ...options,
      name: ${gen.jsLiteral(action.name)},
      interrupt: ${interrupt},
    })`
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
      const initial = defaultValue === undefined
        ? fill
        : gen`${fill} ?? ${compileReactiveArgument(defaultValue)}`
      const binding = slot.parameter.copy ? gen`TR.Cell(TR.Copy(${initial}))` : initial
      return gen`${gen.scopeName({ name: slot.name })} = ${binding}`
    })
    const inFills = (body: Compiled) =>
      gen`_TaoFills => TR.BlockScope(_Scope, _Scope => {
        const _TaoAuthScope = _TaoFills["__taoAuth"]?.evaluate().jsValue as TR.AuthScope | undefined
        void _TaoAuthScope
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
          scope: ${compileCommandScope(command)},
          static: {
            ${compileStaticCommandMember(command, 'Title', 'title')}
            ${compileStaticCommandMember(command, 'Description', 'description')}
            ${compileStaticCommandMember(command, 'Summary', 'summary')}
            ${compileStaticCommandMember(command, 'Label', 'label')}
            ${compileStaticCommandMember(command, 'Icon', 'icon')}
            ${compileStaticShortcut(command)}
          },
          slots: [
            ${
          gen.list(ASTUtils.commandSlots(command), slot =>
            gen`{
              name: ${gen.jsLiteral(slot.name)},
              type: ${gen.jsLiteral(slot.typeName)},
              ${
              slot.type.kind === 'primitive' && ['text', 'number', 'boolean'].includes(slot.type.primitive)
                ? gen`scalarType: ${gen.jsLiteral(slot.type.primitive)},`
                : gen.noop()
            }
              entity: ${slot.type.kind === 'entity' ? 'true' : 'false'},
              required: ${slot.parameter.defaultValue === undefined ? 'true' : 'false'},
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
      return ${Compile.ActionScopedBlock(action.block)}
      }, { ${AST.findOwningView(action) ? gen`owner: _TaoActionOwner,` : gen``}
        ${actionBlockInterruptsAsk(action.block) ? gen`interrupt: true,` : gen``} })
    `
  },

  /** ActionParameterBinding binds one runtime action argument into the action-local scope. */
  ActionParameterBinding(parameter: ActionParameter): Compiled {
    const name = { name: Type.parameterName(parameter.parameter) }
    const runtimeParameter = actionRuntimeParameterName(parameter.index)
    const initial = parameter.parameter.defaultValue === undefined
      ? gen`${runtimeParameter}`
      : gen`${runtimeParameter} ?? ${compileReactiveArgument(parameter.parameter.defaultValue)}`
    return gen`${gen.scopeName(name)} = ${parameter.parameter.copy ? gen`TR.Cell(TR.Copy(${initial}))` : initial}`
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
      ActionResultStatement: Compile.ActionResultStatement,
      CheckStatement: Compile.CheckStatement,
      ContextualPresentStatement: Compile.ContextualPresentStatement,
      DeleteStatement: Compile.DeleteStatement,
      RetryStatement: Compile.RetryStatement,
      DeclarationSlotFill: Compile.DeclarationSlotFill,
      DismissStatement: Compile.DismissStatement,
      DoStatement: Compile.DoStatement,
      DeferStatement: Compile.DeferStatement,
      AliasDeclaration: Compile.AliasDeclaration,
      ReturnStatement: Compile.ActionReturnStatement,
      WhenActionStatement: Compile.WhenActionStatement,
      WhenDoStatement: Compile.WhenDoStatement,
      GuardActionStatement: Compile.GuardActionStatement,
      IfActionStatement: Compile.IfActionStatement,
      ReplaceStatement: Compile.ReplaceStatement,
      RespondStatement: Compile.RespondStatement,
      SelectionActivateStatement: Compile.SelectionActivateStatement,
      SetStatement: Compile.SetStatement,
      ToggleStatement: Compile.ToggleStatement,
      UpdateStatement: Compile.UpdateStatement,
      FailStatement: Compile.FailStatement,
      ForStatement: Compile.ActionForStatement,
    })
  },

  /** ActionForStatement snapshots collection membership and joins each lexical iteration frame. */
  ActionForStatement(statement: AST.ForStatement): Compiled {
    Assert.is(statement.block, AST.isActionBlock, 'action loop owns an action block')
    const block = statement.block
    const owner = AST.findOwningAction(statement)
    const hasSourceReturn = owner && AST.isActionDeclaration(owner)
      ? ASTUtils.sourceActionResult(owner, value => value).some(({ statement: result }) =>
        isWithinStatement(result, statement)
      )
      : false
    const returnGuard = hasSourceReturn
      ? gen`if (_TaoSourceReturn.returned) return _TaoSourceReturn.value;`
      : gen.noop()
    const awaitBlock = actionBlockRequiresAsync(block) ? gen`await ` : gen``
    return gen`{
      const _TaoActionLoopCollection = ${Compile.Expression(statement.collection)}.evaluate().jsValue
      if (Array.isArray(_TaoActionLoopCollection)) {
        for (const _TaoActionLoopItem of [..._TaoActionLoopCollection]) {
          ${awaitBlock}${
      Compile.ActionScopedBlock(
        block,
        gen`${gen.scopeName(statement)} = TR.Value(_TaoActionLoopItem)`,
      )
    }
          ${returnGuard}
        }
      }
    }`
  },

  /** ActionScopedBlock returns the completion of one lexical action frame and its local bindings. */
  ActionScopedBlock(
    block: AST.ActionBlock | undefined,
    bindings?: Compiled,
    asyncBoundary = false,
  ): Compiled {
    const asyncKeyword = actionBlockRequiresAsync(block) ? gen`async ` : gen``
    const boundaryKeyword = asyncBoundary ? gen`async ` : gen``
    const owner = block ? AST.findOwningAction(block) : undefined
    const sourceReturns = owner ? ASTUtils.sourceActionResult(owner, value => value) : []
    const hasReturnContext = Boolean(
      block && sourceReturns.some(({ statement }) => isWithinBlock(statement, block)),
    )
    const ownsReturnContext = Boolean(owner && block?.$container === owner && hasReturnContext)
    const returnContext = ownsReturnContext
      ? gen`const _TaoSourceReturn: { returned: boolean; value: unknown } = { returned: false, value: undefined };
        void _TaoSourceReturn;`
      : gen.noop()
    return gen`TR.BlockScope(_Scope, ${boundaryKeyword}_Scope => TR.ActionScope(${asyncKeyword}() => {
      const _TaoActionContinuation = TR.ActionContinuation()
      ${returnContext}
      ${bindings ?? gen.noop()}
      ${Compile.ActionBlockBody(block, hasReturnContext)}
    }))`
  },

  /** ActionBlockBody compiles one callback-owned action block. */
  ActionBlockBody(block: AST.ActionBlock | undefined, hasReturnContext = false): Compiled {
    // Every caller declares the continuation before the body; an empty body must still read it,
    // or a generated app compiled with unused-local checks rejects `on submit -> { }`.
    if (!block || block.statements.length === 0) {
      return gen`void _TaoActionContinuation`
    }
    const returnCheck = hasReturnContext
      ? gen`if (_TaoSourceReturn.returned) return _TaoSourceReturn.value`
      : gen.noop()
    const returnFallthrough = hasReturnContext ? gen`return undefined` : gen.noop()
    if (!actionInstrumentationEnabled()) {
      return gen`${
        gen.list(block.statements, statement =>
          gen`
        TR.ResumeActionContinuation(_TaoActionContinuation)
        ${Compile.ActionStatement(statement)}
        TR.ResumeActionContinuation(_TaoActionContinuation)
        ${returnCheck}
      `)
      } ${returnFallthrough}`
    }
    const owner = debugOwner(block)
    return gen`${
      gen.list(block.statements.map((statement, index) => ({ index, statement })), ({ index, statement }) =>
        gen`
        TR.ResumeActionContinuation(_TaoActionContinuation)
        await TR.Debug.At({ action: ${gen.jsLiteral(owner.name)}, path: ${
          gen.jsLiteral(statementPath(block, index))
        }, declaration: ${compileDeclarationIdentity(owner.declaration)}.canonical, statement: ${
          gen.jsLiteral(structuralStatementIdentity(statement, owner.declaration))
        } }, _Scope)
        TR.ResumeActionContinuation(_TaoActionContinuation)
        ${Compile.ActionStatement(statement)}
        TR.ResumeActionContinuation(_TaoActionContinuation)
        ${returnCheck}
      `)
    } ${returnFallthrough}`
  },

  /** DeclarationSlotFill is metadata consumed by its owning action or view compiler. */
  DeclarationSlotFill(): Compiled {
    return gen.noop()
  },

  /** AsyncActionStatement launches an isolated action sub-block without delaying its caller. */
  AsyncActionStatement(statement: AST.AsyncActionStatement): Compiled {
    return gen`TR.Async(() => {
      return ${Compile.ActionScopedBlock(statement.block, undefined, true)}
    })`
  },

  ActionResultStatement(statement: AST.ActionResultStatement): Compiled {
    const invocation = statement.invocation
    const type = BridgeMetadata.resultType(Type.ofValueDeclaration(statement), actionResultBridgeTypeOptions())
    if (invocation.then) {
      return Compile.JoinedDoStatement(
        invocation,
        gen`() => TR.DoResult<${type}>(${Compile.Expression(invocation.action)}${
          Compile.ActionArguments(invocation)
        }).then(_TaoActionResult => {
          ${gen.scopeName(statement)} = _TaoActionResult
          return _TaoActionResult
        })`,
      )
    }
    return gen`${gen.scopeName(statement)} = await TR.DoResult<${type}>(${Compile.Expression(invocation.action)}${
      Compile.ActionArguments(invocation)
    })`
  },

  /** DoStatement compiles Tao action invocation. */
  DoStatement(invocation: AST.DoStatement): Compiled {
    if (invocation.then) {
      return Compile.JoinedDoStatement(invocation)
    }
    const awaitKeyword = actionInvocationRequiresAsync(invocation) ? gen`await ` : gen``
    return gen`${awaitKeyword}TR.Do(${Compile.Expression(invocation.action)}${Compile.ActionArguments(invocation)})`
  },

  /** JoinedDoStatement runs a `do ... then` call and waits for its success/failure branch. */
  JoinedDoStatement(statement: AST.DoStatement, invocationCall?: Compiled): Compiled {
    const invocation = statement
    const passesDoneValue = statement.outcomes.some(outcome => outcome.case === 'done' && outcome.payload)
    const invoke = invocationCall ?? (passesDoneValue
      ? compileDoResultInvocation(invocation)
      : gen`() => TR.Do(${Compile.Expression(invocation.action)}${Compile.ActionArguments(invocation)})`)
    return gen`await TR.ThenDo(${invoke}, {
      name: ${gen.jsLiteral(effectOutcomeName(invocation))},
      ${compileEffectContract(invocation, statement.outcomes)}
    }, [
      ${compileJoinedOutcomes(statement)}
      ${
      statement.otherwise
        ? gen`['otherwise', async () => ${Compile.ActionScopedBlock(statement.otherwise.block)}],`
        : gen.noop()
    }
    ])`
  },

  /**
   * WhenDoStatement runs its verb inside the caller's transaction as `do` does, but the runtime
   * contains the verb's failure at this site and runs the outcome it names. The verb's effective
   * failure contract travels with it, which is what tells a declared case from an undeclared error.
   */
  WhenDoStatement(statement: AST.WhenDoStatement): Compiled {
    const invocation = statement.invocation
    const invocationCall = invocation.then
      ? gen`async () => ${Compile.JoinedDoStatement(invocation)}`
      : gen`() => TR.Do(${Compile.Expression(invocation.action)}${Compile.ActionArguments(invocation)})`
    return gen`await TR.WhenDo(${invocationCall}, {
      name: ${gen.jsLiteral(effectOutcomeName(statement))},
      ${isAuthEffect(invocation) ? gen`success: 'completed',` : gen.noop()}
      ${compileEffectContract(invocation, statement.outcomes)}
    }, [
      ${
      gen.list(
        statement.outcomes,
        outcome =>
          gen`[${gen.jsLiteral(outcome.case)}, async _TaoCasePayload => ${
            Compile.ActionScopedBlock(
              outcome.block,
              outcome.payload ? gen`${gen.scopeName(outcome.payload)} = _TaoCasePayload` : gen.noop(),
            )
          }],`,
      )
    }
      ${
      statement.otherwise
        ? gen`['otherwise', async () => ${Compile.ActionScopedBlock(statement.otherwise.block)}],`
        : gen.noop()
    }
    ])`
  },

  /** WhenActionStatement captures all subject matches before joining selected action bodies. */
  WhenActionStatement(statement: AST.WhenActionStatement): Compiled {
    const owner = AST.findOwningAction(statement)
    const hasSourceReturn = owner && AST.isActionDeclaration(owner)
      ? ASTUtils.sourceActionResult(owner, value => value).some(({ statement: result }) =>
        isWithinStatement(result, statement)
      )
      : false
    const returnGuard = hasSourceReturn
      ? gen`if (_TaoSourceReturn.returned) return _TaoSourceReturn.value;`
      : gen.noop()
    return gen`await TR.WhenAll(${Compile.Expression(statement.subject)}, [
        ${
      gen.list(statement.branches, branch =>
        gen`[${gen.jsLiteral(AST.canonicalSubjectCase(branch.case))}, async _TaoCasePayload => {
        ${branch.payload ? gen`${gen.scopeName(branch.payload)} = _TaoCasePayload;` : gen.noop()}
        ${returnGuard}
        return ${Compile.ActionScopedBlock(branch.block)}
      }],`)
    }
    ], ${
      statement.otherwise
        ? gen`async () => {
        ${returnGuard}
        return ${Compile.ActionScopedBlock(statement.otherwise.block)}
      }`
        : gen`undefined`
    })`
  },

  /** ActionReturnStatement saves a synchronous source-action result until its lexical scopes drain. */
  ActionReturnStatement(statement: AST.ReturnStatement): Compiled {
    const action = AST.findOwningAction(statement)
    const belongsToSourceAction = action
      ? ASTUtils.sourceActionResult(action, value => value).some(result => result.statement === statement)
      : false
    if (!belongsToSourceAction) {
      return gen`return ${Compile.Expression(statement.value)}.evaluate().jsValue`
    }
    Assert.is(action, AST.isActionDeclaration, 'validated source action return has an action owner')
    const value = gen`${compileArgumentForType(statement.value, Type.ofActionResult(action))}.evaluate()`
    return gen`_TaoSourceReturn.value = ${value}; _TaoSourceReturn.returned = true;`
  },

  /** DeferStatement registers a lexical cleanup block or invocation for the current action scope. */
  DeferStatement(statement: AST.DeferStatement): Compiled {
    if (statement.block) {
      return gen`TR.Defer(() => ${Compile.ActionScopedBlock(statement.block)})`
    }
    Assert.defined(statement.invocation, 'validated defer shorthand has an invocation')
    const invocation = statement.invocation
    return gen`TR.Defer(() => TR.Do(${Compile.Expression(invocation.action)}${Compile.ActionArguments(invocation)}))`
  },

  /** FailStatement aborts the joined action transaction with one declared case and sentence. */
  FailStatement(statement: AST.FailStatement): Compiled {
    const failureCase = resolveRef(statement.case)
    return gen`TR.Fail(${compileFailureCase(failureCase)}, ${gen.jsLiteral(statement.sentence)})`
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

  /** ToggleStatement inverts a state or one validated stored yes/no field. */
  ToggleStatement(statement: AST.ToggleStatement): Compiled {
    const state = statement.target.ref
    Assert.defined(state, 'validated toggle resolves its target')
    if (Type.ofValueDeclaration(state).kind === 'entity') {
      Assert(statement.members.length === 1, 'validated row toggle names one field')
      return gen`TR.Data.Toggle(${Compile.ValueDeclarationReference(state)}, ${gen.jsLiteral(statement.members[0]!)})`
    }
    Assert(AST.isMutableDeclaration(state), 'validated non-row toggle targets a writable state')
    return gen`${AST.isParameterDeclaration(state) ? gen`await ` : gen``}TR.Toggle(${
      compileWritableTarget(state, statement.members)
    })`
  },

  /** GuardActionStatement stops only its enclosing action-block callback after a match. */
  GuardActionStatement(statement: AST.GuardActionStatement): Compiled {
    return gen`if (await TR.GuardAction(${Compile.Expression(statement.subject)}, [
      ${
      gen.list(
        ASTUtils.guardBranches(statement),
        branch =>
          gen`[${gen.jsLiteral(branch.case)}, async _TaoCasePayload => ${
            Compile.ActionScopedBlock(
              branch.block,
              branch.payload ? gen`${gen.scopeName(branch.payload)} = _TaoCasePayload` : gen.noop(),
            )
          }],`,
      )
    }
    ])) return`
  },

  /** CheckStatement ends its action's callback when the validated condition is false. */
  CheckStatement(statement: AST.CheckStatement): Compiled {
    return gen`if (TR.Check(${Compile.Expression(statement.condition)})) return`
  },

  /** IfActionStatement lazily executes one action sub-block without terminating its caller. */
  IfActionStatement(statement: AST.IfActionStatement): Compiled {
    return gen`await TR.If(${Compile.Expression(statement.condition)}, async () =>
      ${Compile.ActionScopedBlock(statement.block)}
    )`
  },
} as const

function compileCommandScope(command: AST.CommandDeclaration): Compiled {
  const owner = AST.commandOwningView(command)
  return owner
    ? gen`{ kind: 'view', declaration: ${compileDeclarationIdentity(owner)}.canonical }`
    : gen`{ kind: 'module' }`
}

function compileStaticCommandMember(command: AST.CommandDeclaration, source: string, target: string): Compiled {
  const value = ASTUtils.commandStaticMemberText(command, source)
  return value === undefined ? gen.noop() : gen`${target}: ${gen.jsLiteral(value)},`
}

function compileStaticShortcut(command: AST.CommandDeclaration): Compiled {
  const shortcut = ASTUtils.commandStaticShortcut(command)
  return shortcut === undefined ? gen.noop() : gen`key: ${gen.jsLiteral(shortcut)},`
}

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

/**
 * compileEffectContract preserves both known cases and an unknown remainder through named callers.
 */
function compileEffectContract(
  invocation: AST.DoStatement,
  outcomes: readonly AST.WhenDoOutcome[],
): Compiled {
  if (isAuthEffect(invocation)) {
    return gen`declared: ['cancelled', 'rejected'],`
  }
  const contract = ASTUtils.invocationFailureContract(invocation)
  const cases = [...contract.cases]
  if (outcomes.some(outcome => outcome.case === 'cancelled') && !cases.includes('cancelled')) {
    cases.push('cancelled')
  }
  return gen`declared: [${gen.join(cases, failureCase => gen.jsLiteral(failureCase))}],
    ${contract.open ? gen`open: true,` : gen.noop()}`
}

/** Whether a helper-classified source return belongs to one synchronous lexical block. */
function isWithinBlock(statement: AST.ReturnStatement, block: AST.ActionBlock): boolean {
  let current: AST.Node | undefined = statement
  while (current && current !== block) {
    current = current.$container
  }
  return current === block
}

/** Whether a source-owned return occurs below one action statement without crossing its owner. */
function isWithinStatement(statement: AST.ReturnStatement, parent: AST.ActionStatement): boolean {
  let current: AST.Node | undefined = statement
  while (current && current !== parent) {
    current = current.$container
  }
  return current === parent
}

/** Result-bearing done arms receive the same Tao value produced by a bound action result. */
function compileDoResultInvocation(invocation: AST.DoStatement): Compiled {
  const action = ASTUtils.resolveActionInvocation(invocation).action
  Assert.is(action, AST.isActionDeclaration, 'validated result-bearing invocation resolves an action')
  const resultType = BridgeMetadata.resultType(Type.ofActionResult(action))
  return gen`() => TR.DoResult<${resultType}>(${Compile.Expression(invocation.action)}${
    Compile.ActionArguments(invocation)
  })`
}

function compileJoinedOutcomes(statement: AST.DoStatement): Compiled {
  const outcomeBlock = (outcome: AST.WhenDoOutcome): Compiled =>
    gen`async _TaoCasePayload => ${
      Compile.ActionScopedBlock(
        outcome.block,
        outcome.payload
          ? gen`${gen.scopeName(outcome.payload)} = _TaoCasePayload`
          : gen.noop(),
      )
    }`
  const direct = statement.outcomes.flatMap(outcome => {
    if (outcome.case === 'otherwise') {
      return [gen`['otherwise', async () => ${Compile.ActionScopedBlock(outcome.block)}],`]
    }
    return [gen`[${gen.jsLiteral(outcome.case)}, ${outcomeBlock(outcome)}],`]
  })
  return gen.list(direct, compiled => compiled)
}

/** effectOutcomeName is the verb name a failure message falls back to when nothing says more. */
function effectOutcomeName(statement: AST.WhenDoStatement | AST.DoStatement): string {
  const invocation = AST.isWhenDoStatement(statement) ? statement.invocation : statement
  const effect = ASTUtils.invokedEffect(statement)
  if (effect && !AST.isActionExpression(effect)) {
    return effect.name
  }
  const action = invocation.action
  return AST.isValueReference(action) || AST.isMemberAccessExpression(action)
    ? action.target.$refText
    : 'action'
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
      case: ${compileFailureCase(resolveRef(failure.case))},
      sentence: ${gen.jsLiteral(failure.sentence)},
    }`)
  }],
    { ${action.runsLatest ? gen`runs: "latest", ` : gen``}requiredArguments: ${requiredArguments},
      testStubKey: ${gen.jsLiteral(foreignActionTestStubKey(action))},
      ${AST.findOwningView(action) ? gen`owner: _TaoActionOwner,` : gen``} },
  )`
}

/** Named record failures use their source declaration name; enum failure values stay nominal. */
function compileFailureCase(failureCase: AST.FailureDeclaration): Compiled {
  return AST.isTypeDeclaration(failureCase)
    ? gen`${gen.jsLiteral(failureCase.name)}`
    : Compile.ValueDeclarationReference(failureCase)
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

/** debugOwner finds the canonical declaration and human label an action block belongs to. */
function debugOwner(block: AST.ActionBlock): { declaration: AST.Declaration; name: string } {
  let node: AST.Node | undefined = block
  let declaration: AST.Declaration | undefined
  let name = 'action'
  while (node) {
    if (AST.isActionDeclaration(node) || AST.isCommandDeclaration(node)) {
      name = node.name
    }
    if (AST.isDeclaration(node)) {
      // Continue to the outer authored declaration. Nested actions with the same spelling are then
      // separated by the structural route from their view/app owner to the statement.
      declaration = node
    }
    node = node.$container
  }
  Assert.defined(declaration, 'an action block belongs to a declaration')
  return { declaration, name }
}

/** structuralStatementIdentity is one statement's AST route from its canonical owning declaration. */
function structuralStatementIdentity(statement: AST.ActionStatement, owner: AST.Declaration): string {
  const segments: string[] = []
  let node: AST.Node | undefined = statement
  while (node && node !== owner) {
    const property: string | undefined = node.$containerProperty
    Assert.defined(property, 'a debugger statement route has a container property')
    segments.unshift(node.$containerIndex === undefined ? property : `${property}[${node.$containerIndex}]`)
    node = node.$container
  }
  Assert(node === owner, 'a debugger statement route reaches its owning declaration')
  return segments.join('.')
}

/** statementPath is the statement's position through nested blocks, root block first. */
function statementPath(block: AST.ActionBlock, index: number): string {
  const segments: number[] = [index]
  let node: AST.Node | undefined = block.$container
  while (node && !AST.isActionDeclaration(node) && !AST.isCommandDeclaration(node)) {
    const parent: AST.Node | undefined = node.$container
    if (parent && AST.isActionBlock(parent)) {
      segments.unshift(parent.statements.indexOf(node as AST.ActionStatement))
    }
    node = parent
  }
  return segments.join('.')
}

function isAuthEffect(invocation: AST.DoStatement): boolean {
  const effect = ASTUtils.invokedEffect(invocation)
  return effect !== undefined && authLibraryExport(effect) !== undefined
}
