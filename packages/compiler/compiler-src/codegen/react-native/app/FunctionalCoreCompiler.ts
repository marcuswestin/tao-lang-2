import { ASTUtils, Type } from '@ast-utils'
import { AST } from '@parser'
import { Assert, Switch } from '@shared'
import { type CodegenOptions, type Compiled, gen } from '../codegen-util'
import { Compile } from '../Compile'
import { withAuthContextFactory } from './auth-context'
import { compileArgumentForType } from './capability-projection'
import { compileDeclarationIdentity } from './declaration-identity'

type FunctionParameter = {
  index: number
  parameter: AST.ParameterDeclaration
}

/** FunctionalCoreCompiler compiles pure functions and render control flow. */
export const FunctionalCoreCompiler = {
  /** CaseSetDeclaration creates declaration-owned runtime case identities. */
  CaseSetDeclaration(declaration: AST.TypeDeclaration): Compiled {
    return gen`${gen.scopeName(declaration)} = TR.Enum(${compileDeclarationIdentity(declaration)}, [${
      gen.join(AST.caseSetCasesOf(declaration), caseSetCase => gen`${gen.jsLiteral(AST.caseSetCaseName(caseSetCase))}`)
    }])`
  },

  /** FunctionDeclaration compiles a return-oriented Tao pure function block. */
  FunctionDeclaration(fn: AST.FunctionDeclaration): Compiled {
    const parameters = AST.parametersOf(fn).map((parameter, index) => ({ index, parameter }))
    return withAuthContextFactory(
      fn,
      gen`
      ${gen.scopeName(fn)} = TR.Function((${gen.join(parameters, Compile.FunctionRuntimeParameter)}) => {
        return TR.BlockScope(_Scope, _Scope => {
          ${gen.list(parameters, Compile.FunctionParameterBinding)}
          ${Compile.FunctionBlockBody(fn.block)}
        })
      })
    `,
    )
  },

  /** FunctionBlockBody compiles source-ordered returns and one-sided early-return branches. */
  FunctionBlockBody(block: AST.FunctionBlock): Compiled {
    return gen.list(block.statements, Compile.FunctionStatement)
  },

  /** FunctionStatement compiles one statement inside a pure function block. */
  FunctionStatement(statement: AST.FunctionStatement): Compiled {
    return Switch.type(statement, {
      IfFunctionStatement: Compile.IfFunctionStatement,
      ReturnStatement: Compile.ReturnStatement,
    })
  },

  /** ReturnStatement returns one runtime-wrapped Tao value from the function callback. */
  ReturnStatement(statement: AST.ReturnStatement): Compiled {
    let owner: AST.Node | undefined = statement.$container
    while (
      owner && !AST.isFunctionDeclaration(owner) && !AST.isAssociatedFunctionDeclaration(owner)
      && !AST.isAssociatedConverterDeclaration(owner)
    ) {
      owner = owner.$container
    }
    Assert(
      owner && (AST.isFunctionDeclaration(owner) || AST.isAssociatedFunctionDeclaration(owner)
        || AST.isAssociatedConverterDeclaration(owner)),
      'Expected a function return owner.',
    )
    const result = AST.isAssociatedConverterDeclaration(owner)
      ? Type.associatedConverterDescriptor(owner)?.result
      : Type.ofFunctionReturn(owner)
    Assert.defined(result, 'a function or converter has its declared or inferred return domain')
    return gen`return ${compileArgumentForType(statement.value, result)}`
  },

  /** IfFunctionStatement preserves native callback return behavior for early exits. */
  IfFunctionStatement(statement: AST.IfFunctionStatement): Compiled {
    return gen`if (${Compile.Expression(statement.condition)}.evaluate().jsValue === true) {
      ${Compile.FunctionBlockBody(statement.block)}
    }`
  },

  /** PhraseDeclaration compiles named copy into a callable Tao pure-function value. */
  PhraseDeclaration(phrase: AST.PhraseDeclaration): Compiled {
    const parameters = AST.parametersOf(phrase).map((parameter, index) => ({ index, parameter }))
    return withAuthContextFactory(
      phrase,
      gen`
      ${gen.scopeName(phrase)} = TR.Function((${gen.join(parameters, Compile.FunctionRuntimeParameter)}) => {
        return TR.BlockScope(_Scope, _Scope => {
          ${gen.list(parameters, Compile.FunctionParameterBinding)}
          ${Compile.PhraseBody(phrase)}
        })
      })
    `,
    )
  },

  /** PhraseBody compiles a phrase's one interpolated string, or its plural-selected forms. */
  PhraseBody(phrase: AST.PhraseDeclaration): Compiled {
    if (!ASTUtils.phraseIsPlural(phrase)) {
      Assert.defined(phrase.text, 'validated non-plural phrase has one interpolated string')
      return gen`return ${Compile.Expression(phrase.text)}`
    }
    const numberParameter = ASTUtils.phraseNumberParameters(phrase)[0]
    Assert.defined(numberParameter, 'validated plural phrase has one number parameter')
    return gen`
      return TR.Plural(${gen.scopeName({ name: Type.parameterName(numberParameter) })}.evaluate(), {
        ${
      gen.list(
        phrase.forms,
        form => gen`${form.category}: ${Compile.Expression(form.text)},`,
      )
    }
      })
    `
  },

  /** FunctionRuntimeParameter emits one runtime-wrapped function parameter. */
  FunctionRuntimeParameter(parameter: FunctionParameter): Compiled {
    const hasDefault = parameter.parameter.defaultValue !== undefined
    const list = parameter.parameter.$container
    const followedByRequired = AST.isParameterList(list)
      && list.parameters.slice(parameter.index + 1).some(input => input.defaultValue === undefined)
    return gen`${functionRuntimeParameterName(parameter.index)}${hasDefault && !followedByRequired ? '?' : ''}: ${
      Compile.ParameterType(parameter.parameter)
    }${hasDefault && followedByRequired ? gen` | undefined` : gen.noop()}`
  },

  /** FunctionParameterBinding exposes one positional argument through Tao lexical scope. */
  FunctionParameterBinding(parameter: FunctionParameter): Compiled {
    return compileFunctionParameterBinding(parameter)
  },

  /** RenderFragmentStatement compiles one child render/control-flow fragment. */
  RenderFragmentStatement(
    statement: AST.RenderFragment,
    options: CodegenOptions = {},
  ): Compiled {
    return Switch.type(statement, {
      ForStatement: value => Compile.ForStatement(value, options),
      GuardRenderStatement: value => Compile.GuardRenderStatement(value, [], options),
      IfRenderStatement: value => Compile.IfRenderStatement(value, options),
      WhenRenderStatement: value => Compile.WhenRenderStatement(value, options),
      CallerContentStatement: Compile.CallerContentStatement,
      RenderSlotUse: Compile.RenderSlotUse,
      RenderStatement: value => Compile.Render(value, options),
      ViewRender: value => Compile.Render(value, options),
    })
  },

  /** WhenRenderStatement observes one subject and renders its matching lazy cases. */
  WhenRenderStatement(statement: AST.WhenRenderStatement, options: CodegenOptions = {}): Compiled {
    if (!statement.subject) {
      return gen`{TR.WhenPredicatesRender([
        ${
        gen.list(statement.branches, branch => {
          Assert.defined(branch.condition, 'predicate render branch has a condition')
          return gen`[() => ${Compile.Expression(branch.condition)}, () => TR.BlockScope(_Scope, _Scope => {
            ${Compile.RenderBlockBody(branch.block, options)}
          })],`
        })
      }
      ]${
        statement.otherwise
          ? gen`, () => TR.BlockScope(_Scope, _Scope => {
        ${Compile.RenderBlockBody(statement.otherwise.block, options)}
      })`
          : gen.noop()
      })}`
    }
    const availability = Type.ofExpression(statement.subject).kind === 'entity'
    return gen`
      {TR.${availability ? 'WhenReadRender' : 'WhenAllRender'}(${Compile.Expression(statement.subject)}, [
        ${
      gen.list(
        statement.branches,
        branch =>
          gen`[${
            gen.jsLiteral(AST.canonicalSubjectCase(branch.case!))
          }, _TaoCasePayload => TR.BlockScope(_Scope, _Scope => {
            ${branch.payload ? gen`${gen.scopeName(branch.payload)} = _TaoCasePayload` : ''}
            ${Compile.RenderBlockBody(branch.block, options)}
          })],`,
      )
    }
      ], ${
      statement.otherwise
        ? gen`() => TR.BlockScope(_Scope, _Scope => {
        ${Compile.RenderBlockBody(statement.otherwise.block, options)}
      })`
        : gen`undefined`
    }${availability ? gen`, _ViewProps.__tao` : gen.noop()})}
    `
  },

  /** IfRenderStatement conditionally renders only its own child block. */
  IfRenderStatement(statement: AST.IfRenderStatement, options: CodegenOptions = {}): Compiled {
    return gen`
      {TR.If(${Compile.Expression(statement.condition)}, () =>
        TR.BlockScope(_Scope, _Scope => {
          ${Compile.RenderBlockBody(statement.block, options)}
        })
      ) ?? null}
    `
  },

  /** GuardRenderStatement preserves preceding siblings and owns only the remainder of its block. */
  GuardRenderStatement(
    statement: AST.GuardRenderStatement,
    remaining: readonly AST.RenderFragment[],
    options: CodegenOptions = {},
  ): Compiled {
    return gen`
      {TR.GuardRender(${Compile.Expression(statement.subject)}, [
        ${
      gen.list(
        ASTUtils.guardBranches(statement),
        branch =>
          gen`[${
            gen.jsLiteral(AST.canonicalSubjectCase(branch.case!))
          }, _TaoCasePayload => TR.BlockScope(_Scope, _Scope => {
          ${branch.payload ? gen`${gen.scopeName(branch.payload)} = _TaoCasePayload` : ''}
          ${branch.block ? Compile.RenderBlockBody(branch.block, options) : gen`return null`}
        })],`,
      )
    }
      ], () => <>
        ${Compile.RenderBlockFragments(remaining, options)}
      </>, _ViewProps.__tao${readHint(statement.subject)})}
    `
  },

  /**
   * AppGuardStatement builds a partial read net. Each handler receives the guard site's context.
   */
  AppGuardStatement(statement: AST.AppGuardStatement, options: CodegenOptions = {}): Compiled {
    return gen`
      TR.ReadNet({
        ${
      gen.list(
        statement.branches,
        branch =>
          gen`${
            gen.jsLiteral(AST.canonicalSubjectCase(branch.case!))
          }: (_ViewProps, _TaoCasePayload) => TR.BlockScope(_Scope, _Scope => {
          ${branch.payload ? gen`${gen.scopeName(branch.payload)} = _TaoCasePayload` : ''}
          ${
            branch.block
              ? Compile.RenderBlockBody(branch.block, options)
              : gen`return <>${Compile.RenderFragmentStatement(requiredRender(branch), options)}</>`
          }
        }),`,
      )
    }
      })
    `
  },

  /** ForStatement compiles repeated rendering with an iteration-local Tao value binding. */
  ForStatement(statement: AST.ForStatement, options: CodegenOptions = {}): Compiled {
    const selectHandler = AST.loopSelectHandlers(statement)[0]
    const cst = statement.$cstNode
    Assert.defined(cst, 'compiled loop has source coordinates')
    return gen`
      {TR.ForEach(${Compile.Expression(statement.collection)}, ${functionRuntimeParameterName(0)} =>
        TR.BlockScope(_Scope, _Scope => {
          ${gen.scopeName(statement)} = ${functionRuntimeParameterName(0)}
          ${Compile.RenderBlockBody(statement.block, options)}
        })
      , ${selectHandler ? Compile.LoopSelectHandlerCallback(selectHandler) : 'undefined'}, {
        declaration: ${gen.jsLiteral(AST.findOwningView(statement)?.name ?? 'loop')},
        source: {
          path: ${gen.jsLiteral(AST.getDocument(statement).uri.fsPath)},
          start: ${cst.offset},
          end: ${cst.end},
        },
        interaction: ${Compile.OutlineLoopReference(statement)},
        ${selectHandler ? gen`owner: _TaoActionOwner,` : gen.noop()}
      })}
    `
  },

  /** LoopSelectHandler emits no standalone content; its owning loop compiles it as row behavior. */
  LoopSelectHandler(): Compiled {
    return gen.noop()
  },

  /** LoopSelectHandlerCallback binds the selected row before running its validated inline action. */
  LoopSelectHandlerCallback(handler: AST.LoopSelectHandler): Compiled {
    const loop = AST.directLoopForSelectHandler(handler)
    const block = handler.block
    Assert.defined(loop, 'validated loop select handler is a direct loop child')
    Assert.defined(block, 'validated loop select handler has an inline action block')
    return gen`${functionRuntimeParameterName(0)} => {
      return ${
      Compile.ActionScopedBlock(
        block,
        gen`${gen.scopeName(loop)} = ${functionRuntimeParameterName(0)}`,
        true,
      )
    }
    }`
  },
} as const

/** A projected contract can supply its defining-module default without rebinding it in the caller. */
export function compileFunctionParameterBinding(parameter: FunctionParameter, defaultValue?: Compiled): Compiled {
  const name = { name: Type.parameterName(parameter.parameter) }
  const runtimeParameter = functionRuntimeParameterName(parameter.index)
  if (parameter.parameter.defaultValue === undefined) {
    return gen`${gen.scopeName(name)} = ${runtimeParameter}`
  }
  const fallback = defaultValue
    ?? compileArgumentForType(parameter.parameter.defaultValue, Type.ofParameter(parameter.parameter))
  return gen`${gen.scopeName(name)} = ${runtimeParameter} ?? ${fallback}`
}

/** A read net handler without a block is, by the grammar, one bare render. */
function requiredRender(branch: AST.AppGuardBranch): AST.ViewRender {
  Assert.defined(branch.render, 'parsed read net handler has a block or a render')
  return branch.render
}

/** Supply only source facts the compiler can identify without evaluating a read. */
function readHint(subject: AST.Expression): Compiled {
  if (!AST.isValueReference(subject)) {
    return gen.noop()
  }
  const target = subject.target.ref
  const type = Type.ofExpression(subject)
  const readKind = AST.isEntityQueryDeclaration(target) ? 'query' : type.kind === 'entity' ? 'entity' : undefined
  return readKind
    ? gen`, ${
      gen.jsLiteral({ readKind, subjectType: type.kind === 'entity' ? Type.dataEntityName(type.entity) : undefined })
    }`
    : gen.noop()
}

function functionRuntimeParameterName(index: number): Compiled {
  return gen.Name({ name: `_TaoFunctionArg${index}` })
}
