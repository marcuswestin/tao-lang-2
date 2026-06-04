import { AST, Langium } from '@parser'
import { Switch } from '@shared'
import { type Compiled, gen, genList, genNoop, refResolved } from '../codegen-util'

/** compileFile compiles a parsed Tao file into Expo-compatible TSX source. */
export function compileFile(taoFile: AST.TaoFile): string {
  return Langium.toString(Compile.TaoFile(taoFile))
}

/** Compile compiles parsed Tao AST nodes into Expo-compatible TSX source. */
export const Compile = {
  /** TaoFile compiles a parsed Tao file into a default React component module. */
  TaoFile(taoFile: AST.TaoFile): Compiled {
    const declarations = taoFile.statements.filter(AST.isDeclaration)
    if (declarations.length !== taoFile.statements.length) {
      throw new Error('Unsupported top-level syntax. Only app and ui declarations can be compiled.')
    }

    const app = Compile.App(declarations)
    const root = Compile.AppRoot(app)
    const rootView = refResolved(root.ui, `App ${app.name} root ui`)
    const views = declarations.filter(AST.isViewDeclaration)

    return gen`
      import React from 'react'
      import * as RN from 'react-native'

      ${Compile.TaoTextValue()}

      ${genList(views, Compile.ViewDeclaration, { newLines: 2 })}
      export default function TaoApp() {
        return <${rootView.name} />
      }
    `
  },

  /** App returns the file's single app declaration. */
  App(declarations: readonly AST.Declaration[]): AST.AppDeclaration {
    const apps = declarations.filter(AST.isAppDeclaration)
    if (apps.length !== 1) {
      throw new Error(`Expected exactly one app declaration, found ${apps.length}.`)
    }
    return apps[0]!
  },

  /** AppRoot returns the app's single root ui declaration. */
  AppRoot(app: AST.AppDeclaration): AST.AppUi {
    const unsupported = app.block.statements.filter(statement => !AST.isAppUi(statement))
    if (unsupported.length > 0) {
      throw new Error(`Unsupported app block syntax. Only root ui declarations can be compiled in app ${app.name}.`)
    }

    const roots = app.block.statements.filter(AST.isAppUi)
    if (roots.length !== 1) {
      throw new Error(`App ${app.name} must declare exactly one root ui, found ${roots.length}.`)
    }
    return roots[0]!
  },

  /** TaoTextValue compiles the temporary text runtime helper. */
  TaoTextValue(): Compiled {
    return gen`
      type TaoTextValue = {
        jsValue: string
        evaluate(): TaoTextValue
      }

      function taoText(jsValue: string): TaoTextValue {
        return {
          jsValue,
          evaluate() {
            return this
          },
        }
      }
    `
  },

  /** ViewDeclaration compiles a Tao ui declaration into a React function component. */
  ViewDeclaration(view: AST.ViewDeclaration): Compiled {
    return gen`
      function ${view.name}(_ViewProps: ${Compile.ViewParameterList(view)}) {
        ${Compile.ViewBlock(view.block)}
      }
    `
  },

  /** ViewParameterList compiles Tao ui parameters into the component props type. */
  ViewParameterList(view: AST.ViewDeclaration): string {
    const params = view.parameterList?.parameters ?? []
    if (params.length === 0) {
      return '{ children?: React.ReactNode }'
    }

    const entries = params.map((param) => {
      if (param.type !== 'text') {
        throw new Error(`Unsupported parameter type '${param.type}' on ${view.name}.${param.name}.`)
      }
      return `${param.name}: TaoTextValue`
    })
    return `{ children?: React.ReactNode; ${entries.join('; ')} }`
  },

  /** ViewBlock compiles a Tao ui block into a component return body. */
  ViewBlock(block: AST.Block): Compiled {
    const statements = block.statements
    if (statements.length === 0) {
      return gen`
        return _ViewProps.children ?? null
      `
    }

    if (statements.length === 1 && AST.isRender(statements[0]) && statements[0].injection !== undefined) {
      return Compile.Injection(statements[0].injection)
    }

    return gen`
      return (
        <>
          ${genList(statements, Compile.ViewStatement)}
        </>
      )
    `
  },

  /** ViewStatement compiles a supported statement inside a ui block. */
  ViewStatement(statement: AST.Statement): Compiled {
    if (!AST.isRender(statement) || statement.injection !== undefined) {
      throw new Error(
        `Unsupported view statement '${statement.$type}'. Only view renders are supported in multi-statement blocks.`,
      )
    }
    return Compile.Render(statement)
  },

  /** Render compiles a Tao render statement into JSX. */
  Render(render: AST.Render): Compiled {
    if (render.view === undefined) {
      throw new Error('Render statement must target a view or inject TSX.')
    }

    const view = refResolved(render.view, 'render target')
    const props = Compile.RenderProps(render, view)
    const children = render.block?.statements ?? []
    if (children.length === 0) {
      return gen`
        <${view.name}${props} />
      `
    }

    return gen`
      <${view.name}${props}>
        ${genList(children, Compile.ViewStatement)}
      </${view.name}>
    `
  },

  /** RenderProps compiles render arguments into JSX props. */
  RenderProps(render: AST.Render, view: AST.ViewDeclaration): Compiled {
    const params = view.parameterList?.parameters ?? []
    const args = render.argumentList?.arguments ?? []
    if (args.length !== params.length) {
      throw new Error(`Render of ${view.name} expected ${params.length} argument(s), found ${args.length}.`)
    }
    if (params.length === 0) {
      return genNoop()
    }

    return Langium.joinToNode(
      params,
      (param, index) => gen` ${param.name}={${Compile.Argument(args[index]!, param)}}`,
    )!
  },

  /** Argument compiles a Tao render argument into a runtime value expression. */
  Argument(argument: AST.Argument, param: AST.ParameterDeclaration): Compiled {
    if (param.type !== 'text') {
      throw new Error(`Unsupported argument type '${param.type}' for ${param.name}.`)
    }
    return Compile.Expression(argument.value)
  },

  /** Expression compiles a Tao expression into a runtime value expression. */
  Expression(expression: AST.StringLiteral): Compiled {
    return Switch.type(expression, {
      StringLiteral: Compile.StringLiteral,
    })
  },

  /** StringLiteral compiles a Tao string literal into a temporary text runtime value. */
  StringLiteral(str: AST.StringLiteral): Compiled {
    return gen`taoText(${JSON.stringify(str.value)})`
  },

  /** Injection compiles a supported inject block into component body statements. */
  Injection(injection: AST.Injection): Compiled {
    const code = stripTsFence(injection.tsCodeBlock)
    return Switch.value(injection.type, {
      raw: () =>
        gen`
        ${indentContinuationLines(code, 2)}
      `,
      undefined: () =>
        gen`
        return (function() {
          ${indentContinuationLines(code, 4)}
        })()
      `,
    })
  },
}

function stripTsFence(code: string): string {
  return trimSharedIndent(
    code.replace(/^```ts[ \t]*(?:\r?\n)?/, '').replace(/(?:\r?\n)?```$/, ''),
  ).trim()
}

function trimSharedIndent(code: string): string {
  const lines = code.replace(/\r\n/g, '\n').split('\n')
  const indents = lines
    .filter(line => line.trim().length > 0)
    .map(line => line.match(/^[ \t]*/)?.[0] ?? '')
  const sharedIndent = indents.length === 0 ? '' : indents.reduce(commonPrefix)

  return lines.map(line => line.startsWith(sharedIndent) ? line.slice(sharedIndent.length) : line).join('\n')
}

function commonPrefix(left: string, right: string): string {
  let index = 0
  while (index < left.length && index < right.length && left[index] === right[index]) {
    index += 1
  }
  return left.slice(0, index)
}

function indentContinuationLines(code: string, spaces: number): string {
  const lines = code.split('\n')
  const prefix = ' '.repeat(spaces)
  return lines.map((line, index) => index === 0 || line.length === 0 ? line : `${prefix}${line}`).join('\n')
}
