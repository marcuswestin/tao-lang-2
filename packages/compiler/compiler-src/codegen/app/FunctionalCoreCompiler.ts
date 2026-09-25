import { ASTUtils, Type } from '@ast-utils'
import { AST } from '@parser'
import { Assert, Switch } from '@shared'
import { type CodegenOptions, type Compiled, gen } from '../codegen-util'
import { Compile } from '../Compile'
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
    return gen`
      ${gen.scopeName(fn)} = TR.Function((${gen.join(parameters, Compile.FunctionRuntimeParameter)}) => {
        return TR.BlockScope(_Scope, _Scope => {
          ${gen.list(parameters, Compile.FunctionParameterBinding)}
          ${Compile.FunctionBlockBody(fn.block)}
        })
      })
    `
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
    return gen`return ${Compile.Expression(statement.value)}`
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
    return gen`
      ${gen.scopeName(phrase)} = TR.Function((${gen.join(parameters, Compile.FunctionRuntimeParameter)}) => {
        return TR.BlockScope(_Scope, _Scope => {
          ${gen.list(parameters, Compile.FunctionParameterBinding)}
          ${Compile.PhraseBody(phrase)}
        })
      })
    `
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
    return gen`${functionRuntimeParameterName(parameter.index)}${
      parameter.parameter.defaultValue === undefined ? '' : '?'
    }: ${Compile.ParameterType(parameter.parameter)}`
  },

  /** FunctionParameterBinding exposes one positional argument through Tao lexical scope. */
  FunctionParameterBinding(parameter: FunctionParameter): Compiled {
    const name = { name: Type.parameterName(parameter.parameter) }
    const runtimeParameter = functionRuntimeParameterName(parameter.index)
    return parameter.parameter.defaultValue === undefined
      ? gen`${gen.scopeName(name)} = ${runtimeParameter}`
      : gen`${gen.scopeName(name)} = ${runtimeParameter} ?? ${Compile.Expression(parameter.parameter.defaultValue)}`
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

  /** WhenRenderStatement evaluates one subject and renders one lazy case. */
  WhenRenderStatement(statement: AST.WhenRenderStatement, options: CodegenOptions = {}): Compiled {
    return gen`
      {TR.WhenCaseRender(${Compile.Expression(statement.subject)}, [
        ${
      gen.list(
        statement.branches,
        branch =>
          gen`[${gen.jsLiteral(branch.case)}, _TaoCasePayload => TR.BlockScope(_Scope, _Scope => {
            ${branch.payload ? gen`${gen.scopeName(branch.payload)} = _TaoCasePayload` : ''}
            ${Compile.RenderBlockBody(branch.block, options)}
          })],`,
      )
    }
      ], () => TR.BlockScope(_Scope, _Scope => {
        ${Compile.RenderBlockBody(statement.otherwise.block, options)}
      }))}
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
          gen`[${gen.jsLiteral(branch.case)}, _TaoCasePayload => TR.BlockScope(_Scope, _Scope => {
          ${branch.payload ? gen`${gen.scopeName(branch.payload)} = _TaoCasePayload` : ''}
          ${branch.block ? Compile.RenderBlockBody(branch.block, options) : gen`return null`}
        })],`,
      )
    }
      ], () => <>
        ${Compile.RenderBlockFragments(remaining, options)}
      </>)}
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
      const _TaoActionContinuation = TR.ActionContinuation()
      return TR.BlockScope(_Scope, async _Scope => {
        ${gen.scopeName(loop)} = ${functionRuntimeParameterName(0)}
        ${Compile.ActionBlockBody(block)}
      })
    }`
  },
} as const

function functionRuntimeParameterName(index: number): Compiled {
  return gen.Name({ name: `_TaoFunctionArg${index}` })
}
