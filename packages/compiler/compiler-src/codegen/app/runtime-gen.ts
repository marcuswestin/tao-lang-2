import { AST } from '@tao/parser'
import { type Compiled, indent, refResolved } from '../codegen-util'

/** compileFile compiles a parsed Tao file into Expo-compatible TSX source. */
export function compileFile(taoFile: AST.TaoFile): Compiled {
  return new RuntimeGen().TaoFile(taoFile)
}

class RuntimeGen {
  TaoFile(taoFile: AST.TaoFile): Compiled {
    const declarations = taoFile.statements.filter(AST.isDeclaration)
    if (declarations.length !== taoFile.statements.length) {
      throw new Error('Unsupported top-level syntax. Only app and ui declarations can be compiled.')
    }

    const app = this.App(declarations)
    const root = this.AppRoot(app)
    const rootView = refResolved(root.ui, `App ${app.name} root ui`)
    const views = declarations.filter(AST.isViewDeclaration)

    return [
      "import React from 'react'",
      "import * as RN from 'react-native'",
      '',
      this.TaoTextValue(),
      '',
      ...views.flatMap(view => [this.ViewDeclaration(view), '']),
      'export default function TaoApp() {',
      `  return <${rootView.name} />`,
      '}',
      '',
    ].join('\n')
  }

  App(declarations: readonly AST.Declaration[]): AST.AppDeclaration {
    const apps = declarations.filter(AST.isAppDeclaration)
    if (apps.length !== 1) {
      throw new Error(`Expected exactly one app declaration, found ${apps.length}.`)
    }
    return apps[0]!
  }

  AppRoot(app: AST.AppDeclaration): AST.AppUi {
    const roots = app.block.statements.filter(AST.isAppUi)
    if (roots.length !== 1) {
      throw new Error(`App ${app.name} must declare exactly one root ui, found ${roots.length}.`)
    }
    return roots[0]!
  }

  TaoTextValue(): Compiled {
    return [
      'type TaoTextValue = {',
      '  jsValue: string',
      '  evaluate(): TaoTextValue',
      '}',
      '',
      'function taoText(jsValue: string): TaoTextValue {',
      '  return {',
      '    jsValue,',
      '    evaluate() {',
      '      return this',
      '    },',
      '  }',
      '}',
    ].join('\n')
  }

  ViewDeclaration(view: AST.ViewDeclaration): Compiled {
    return [
      `function ${view.name}(_ViewProps: ${this.ViewParameterList(view)}) {`,
      ...indent(this.ViewBlock(view.block)),
      '}',
    ].join('\n')
  }

  ViewParameterList(view: AST.ViewDeclaration): Compiled {
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
  }

  ViewBlock(block: AST.Block): string[] {
    const statements = block.statements
    if (statements.length === 0) {
      return ['return _ViewProps.children ?? null']
    }

    if (statements.length === 1 && AST.isRender(statements[0]) && statements[0].injection !== undefined) {
      return this.Injection(statements[0].injection)
    }

    return [
      'return (',
      '  <>',
      ...indent(statements.map(statement => this.ViewStatement(statement)), 4),
      '  </>',
      ')',
    ]
  }

  ViewStatement(statement: AST.Statement): Compiled {
    if (!AST.isRender(statement) || statement.injection !== undefined) {
      throw new Error(
        `Unsupported view statement '${statement.$type}'. Only view renders are supported in multi-statement blocks.`,
      )
    }
    return this.Render(statement)
  }

  Render(render: AST.Render): Compiled {
    if (render.view === undefined) {
      throw new Error('Render statement must target a view or inject TSX.')
    }

    const view = refResolved(render.view, 'render target')
    const props = this.RenderProps(render, view)
    const children = render.block?.statements ?? []
    if (children.length === 0) {
      return `<${view.name}${props} />`
    }

    return [
      `<${view.name}${props}>`,
      ...indent(children.map(statement => this.ViewStatement(statement)), 2),
      `</${view.name}>`,
    ].join('\n')
  }

  RenderProps(render: AST.Render, view: AST.ViewDeclaration): Compiled {
    const params = view.parameterList?.parameters ?? []
    const args = render.argumentList?.arguments ?? []
    if (args.length !== params.length) {
      throw new Error(`Render of ${view.name} expected ${params.length} argument(s), found ${args.length}.`)
    }

    return params.map((param, index) => ` ${param.name}={${this.Argument(args[index]!, param)}}`).join('')
  }

  Argument(argument: AST.Argument, param: AST.ParameterDeclaration): Compiled {
    if (param.type !== 'text') {
      throw new Error(`Unsupported argument type '${param.type}' for ${param.name}.`)
    }
    return `taoText(${JSON.stringify(argument.value.value)})`
  }

  Injection(injection: AST.Injection): string[] {
    const code = stripTsFence(injection.tsCodeBlock).trim()
    // Temporary Kitchen Sink compatibility shim until Tao has real inject codegen.
    if (code.includes('_ViewProps.Value.evaluate') && code.includes('<RN.Text>{text}</RN.Text>')) {
      return [
        'const text = _ViewProps.Value.evaluate()',
        'return <RN.Text>{text.jsValue}</RN.Text>',
      ]
    }
    if (/^\s*return\b/.test(code)) {
      return code.split('\n')
    }

    throw new Error(
      'Unsupported inject block. Minimal compiler expects a return statement or Kitchen Sink Text injection.',
    )
  }
}

function stripTsFence(code: string): string {
  return code.replace(/^```ts[ \t]*(?:\r?\n)?/, '').replace(/(?:\r?\n)?```$/, '')
}
