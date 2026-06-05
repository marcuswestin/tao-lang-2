import { AST } from '@parser'
import { Switch } from '@shared'
import { type Compiled, gen, genJoin, genList, genName, genNameLiteral } from '../codegen-util'
import { Compile } from '../Compile'

export default {
  /** CompileUiDeclaration compiles a Tao ui declaration into a runtime ui component. */
  CompileUiDeclaration(ui: AST.UiDeclaration): Compiled {
    return gen`
      const ${genName(ui)} = TR.UiDeclaration(
        ${genNameLiteral(ui)},
        ${Compile.ViewParameterList(ui)},
        _ViewProps => {
          ${Compile.ViewBlock(ui.block)}
        },
      )
    `
  },

  /** CompileViewParameterList compiles Tao ui parameters into runtime parameter metadata. */
  CompileViewParameterList(ui: AST.UiDeclaration): Compiled {
    const parameters = ui.parameterList?.parameters ?? []
    const parameterEntries = genJoin(parameters, Compile.ParameterDeclaration)
    return gen`TR.ViewParameterList({ ${parameterEntries} })`
  },

  CompileParameterDeclaration(param: AST.ParameterDeclaration): Compiled {
    return gen`${genName(param)}: ${Compile.ParameterType(param)}`
  },

  /** CompileParameterType returns the generated Tao primitive type name for a Tao parameter. */
  CompileParameterType(param: AST.ParameterDeclaration): Compiled {
    return Switch.value(param.type, {
      number: () => gen`'number'`,
      text: () => gen`'text'`,
    })
  },

  /** CompileViewBlock compiles a Tao ui block into a runtime view block. */
  CompileViewBlock(block: AST.Block): Compiled {
    return gen`
      return TR.ViewBlock(_ViewProps, () => {
        const _ViewElements: React.ReactNode[] = []
        ${genList(block.statements, Compile.ViewStatement)}
        return _ViewElements
      })
    `
  },

  /** CompileViewStatement compiles one statement inside a ui block. */
  CompileViewStatement(statement: AST.Statement): Compiled {
    return Switch.type(statement, {
      AliasDeclaration: Compile.AliasDeclaration,
      AppDeclaration: Compile.App,
      AppUi: Compile.AppUi,
      Injection: Compile.Injection,
      Render: render => {
        if ((render.block?.statements.length ?? 0) === 0) {
          return gen`_ViewElements.push(${Compile.Render(render)})`
        }
        return gen`
          _ViewElements.push(
            ${Compile.Render(render)},
          )
        `
      },
      UiDeclaration: Compile.UiDeclaration,
    })
  },
} as const
