import { AST } from '@parser'
import { Switch } from '@shared'
import { type Compiled, gen, genList, genName, genScopeName } from '../codegen-util'
import { Compile } from '../Compile'

export default {
  /** ViewDeclaration compiles a Tao view declaration into a runtime component. */
  ViewDeclaration,

  /** UiDeclaration compiles a Tao ui declaration into a runtime component. */
  UiDeclaration: ViewDeclaration,

  /** LayoutDeclaration compiles a Tao layout declaration into a runtime component. */
  LayoutDeclaration: ViewDeclaration,

  /** ViewParameterList compiles Tao view parameters into generated React props. */
  ViewParameterList(ui: AST.ViewDeclaration): Compiled {
    const parameters = ui.parameterList?.parameters ?? []
    return gen`{
      ${genList(parameters, Compile.ParameterDeclaration)}
      __tao?: TR.TaoProps
      children?: React.ReactNode
    }`
  },

  /** ParameterDeclaration compiles one Tao parameter into a generated React prop. */
  ParameterDeclaration(param: AST.ParameterDeclaration): Compiled {
    return gen`${genName(param)}: ${Compile.ParameterType(param)}`
  },

  /** ParameterType returns the generated runtime value type for a Tao parameter. */
  ParameterType(param: AST.ParameterDeclaration): Compiled {
    return Switch.value(param.type, {
      number: () => gen`TR.Value<number>`,
      text: () => gen`TR.Value<string>`,
    })
  },

  /** RenderBlockBody compiles render child setup statements followed by JSX children. */
  RenderBlockBody(block: AST.Block): Compiled {
    const setupStatements = block.statements.filter(AST.isAliasDeclaration)
    const renders = block.statements.filter(AST.isRender)
    return gen`
      ${genList(setupStatements, Compile.Statement)}
      return <>
        ${genList(renders, Compile.Render)}
      </>
    `
  },

  /** ViewParameterBinding compiles one view parameter into the current generated scope. */
  ViewParameterBinding(parameter: AST.ParameterDeclaration): Compiled {
    return gen`${genScopeName(parameter)} = _ViewProps.${genName(parameter)}`
  },
} as const

function ViewDeclaration(ui: AST.ViewDeclaration): Compiled {
  return gen`
    ${genScopeName(ui)} = function ${genName(ui)}(_ViewProps: ${Compile.ViewParameterList(ui)}) {
      return TR.BlockScope(_Scope, _Scope => {
        ${genList(ui.parameterList?.parameters ?? [], Compile.ViewParameterBinding)}
        ${genList(ui.block.statements, Compile.Statement)}
      })
    }
  `
}
