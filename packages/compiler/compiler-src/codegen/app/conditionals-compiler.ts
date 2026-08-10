import { AST } from '@parser'
import { type Compiled, gen } from '../codegen-util'
import { Compile } from '../Compile'

export const ConditionalsCompiler = {
  /** WhenRenderStatement compiles conditional rendering into lazily evaluated runtime branches. */
  WhenRenderStatement(when: AST.WhenRenderStatement): Compiled {
    return gen`
      {TR.WhenRender([
        ${
      gen.list(
        when.branches,
        branch =>
          gen`[() => ${Compile.Expression(branch.condition)}, () => ${Compile.WhenRenderBranchBody(branch.block)}],`,
      )
    }
      ], () => ${Compile.WhenRenderBranchBody(when.otherwise.block)})}
    `
  },

  /** WhenRenderBranchBody compiles one conditional branch body into a scoped JSX fragment. */
  WhenRenderBranchBody(block: AST.Block): Compiled {
    return gen`
      TR.BlockScope(_Scope, _Scope => {
        ${Compile.RenderBlockBody(block)}
      })
    `
  },

  /** WhenActionStatement compiles conditional action logic into runtime branches. */
  WhenActionStatement(when: AST.WhenActionStatement): Compiled {
    return gen`
      TR.WhenAction([
        ${
      gen.list(
        when.branches,
        branch =>
          gen`[() => ${Compile.Expression(branch.condition)}, () => ${Compile.WhenActionBranchBody(branch.block)}],`,
      )
    }
      ], () => ${Compile.WhenActionBranchBody(when.otherwise.block)})
    `
  },

  /** ForRenderStatement compiles iteration into a keyed runtime list render. */
  ForRenderStatement(forStatement: AST.ForRenderStatement): Compiled {
    return gen`
      {TR.ForRender(${Compile.Expression(forStatement.collection)}, (_TaoItem: any) =>
        TR.BlockScope(_Scope, _Scope => {
          ${gen.scopeName(forStatement.item)} = TR.Value(_TaoItem)
          ${Compile.RenderBlockBody(forStatement.block)}
        }))}
    `
  },

  /** WhenActionBranchBody compiles one conditional action branch body into a scoped callback. */
  WhenActionBranchBody(block: AST.ActionBlock): Compiled {
    return gen`
      TR.BlockScope(_Scope, _Scope => {
        ${gen.list(block.statements, Compile.ActionStatement)}
      })
    `
  },
} as const
